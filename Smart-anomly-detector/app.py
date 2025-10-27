"""
Full FastAPI service:
 - /ingest  (single GPS record)
 - /ingest/batch (multiple)
 - /zones (static zones upload)
 - /zones/dynamic (create ephemeral zone with TTL)
 - /predict (single log -> returns risk, factors)
 - /predict/window (array of points)
 - /predict/live/{session_id} (session-level prediction using saved CSV)
 - SQLite persistence of predictions/alerts
 - SHAP explanations for isolation forest
"""
import os
import time
import json
import math
from collections import defaultdict, deque

import joblib
import asyncio
import sqlite3  
import shap
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone
from shapely.geometry import shape, Point
from shapely.prepared import prep
from typing import List, Optional
from math import radians, sin, cos, asin, sqrt

from feature_engineering import (
    DEFAULT_HOTSPOT_RADIUS,
    compute_session_features,
    load_hotspot_index,
)

BASE_DIR = os.path.dirname(__file__)
DATA_DIR = os.path.join(BASE_DIR, "data")
MODEL_DIR = os.path.join(BASE_DIR, "model")
DB_PATH = os.path.join(BASE_DIR, "predictions.db")  
os.makedirs(DATA_DIR, exist_ok=True)
# Load environment variables
from dotenv import load_dotenv
load_dotenv(os.path.join(BASE_DIR, '.env'))
# Import DB functions
from database import init_db as db_init, save_prediction_row as db_save_prediction_row, pool


# Load models + artifacts

scaler = joblib.load(os.path.join(MODEL_DIR, "scaler.pkl"))
iso = joblib.load(os.path.join(MODEL_DIR, "isolation_forest.pkl"))
dbs = joblib.load(os.path.join(MODEL_DIR, "dbscan.pkl"))
feature_cols = joblib.load(os.path.join(MODEL_DIR, "feature_cols.pkl"))  # this contains 'session_id' too in our train script

# create SHAP explainer
try:
    explainer = shap.TreeExplainer(iso)
except Exception:
    explainer = None  # fallback later

HOTSPOT_INDEX_PATH = os.path.join(MODEL_DIR, "hotspot_index.json")
hotspot_index = load_hotspot_index(HOTSPOT_INDEX_PATH)
try:
    HOTSPOT_RADIUS = max(0, int(os.getenv("HOTSPOT_RADIUS_CELLS", str(DEFAULT_HOTSPOT_RADIUS))))
except Exception:
    HOTSPOT_RADIUS = DEFAULT_HOTSPOT_RADIUS

# In-memory & persisted zones
ZONES_FILE = os.path.join(DATA_DIR, "zones.json")
static_zones = []
static_zone_shapes = []
dynamic_zones = {}

def _load_static_zones():
    global static_zones, static_zone_shapes
    static_zones = []
    static_zone_shapes = []
    if os.path.exists(ZONES_FILE):
        try:
            static_zones = json.load(open(ZONES_FILE, "r"))
        except Exception as e:
            print(f"[zones] Failed to load zones.json: {e}")
            static_zones = []
    # build prepared shapes for faster lookup & tolerant validation
    for z in static_zones:
        try:
            geom = shape(z['geojson'])
            static_zone_shapes.append((z, prep(geom)))
        except Exception as e:
            print(f"[zones] Skipping invalid zone {z.get('zone_id')}: {e}")

_load_static_zones()

# Initialize MySQL DB
db_init()

# -------------------------
# Utilities
# -------------------------
def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat/2)**2 + cos(radians(lat1))*cos(radians(lat2))*sin(dlon/2)**2
    c = 2 * asin(math.sqrt(a))
    return R * c

# Use MySQL save_prediction_row

def load_sessions_from_csv():
    # look for gps_logs.csv and gps_data.csv
    logs_file = os.path.join(DATA_DIR, "gps_logs.csv")
    data_file = os.path.join(DATA_DIR, "gps_data.csv")
    dfs = []
    if os.path.exists(logs_file):
        df1 = pd.read_csv(logs_file)
        df1['timestamp'] = pd.to_datetime(df1['timestamp']).dt.strftime("%Y-%m-%dT%H:%M:%S")
        dfs.append(df1)
    if os.path.exists(data_file):
        df2 = pd.read_csv(data_file, header=None)
        if df2.shape[1] == 4:
            df2.columns = ['session_id','lat','lon','timestamp']
            df2['timestamp'] = pd.to_datetime(df2['timestamp']).dt.strftime("%Y-%m-%dT%H:%M:%S")
            dfs.append(df2)
    if dfs:
        return pd.concat(dfs, ignore_index=True)
    return pd.DataFrame(columns=['session_id','lat','lon','timestamp'])

# -------------------------
# App state trackers
# -------------------------
last_seen = {}  # session_id -> datetime
group_members = {}  # group_id -> { user_id: (lat, lon, timestamp) }
try:
    SESSION_HISTORY_SIZE = max(10, int(os.getenv("SESSION_HISTORY_SIZE", "120")))
except Exception:
    SESSION_HISTORY_SIZE = 120
session_history = defaultdict(lambda: deque(maxlen=SESSION_HISTORY_SIZE))

# -------------------------
# API models
# -------------------------
class GPSLog(BaseModel):
    session_id: int
    user_id: int
    group_id: Optional[int] = None
    lat: float
    lon: float
    timestamp: str  # ISO "2025-09-07T10:00:00"

class BatchIngest(BaseModel):
    points: List[GPSLog]

class ZonePayload(BaseModel):
    zones: List[dict]

class DynamicZonePayload(BaseModel):
    zone_id: str
    name: Optional[str] = None
    risk_level: str = "high"
    geojson: dict
    ttl_seconds: int = 3600

# -------------------------
# FastAPI init
# -------------------------
app = FastAPI(
    title="Smart Anomaly Detector (full)",
    docs_url=None,      # disable Swagger UI
    redoc_url=None,     # disable ReDoc UI
    openapi_url=None    # disable OpenAPI schema endpoint
)

# -------------------------
# Helpers for zones
# -------------------------
def point_in_any_zone(lat, lon):
    """Return zone metadata if point lies inside or on boundary of any zone.
    Uses prepared geometries for performance and also treats boundary (intersects) as inside.
    """
    p = Point(lon, lat)
    # dynamic zones first
    for zid, zd in dynamic_zones.items():
        try:
            poly = shape(zd['geojson'])
            if poly.contains(p) or poly.intersects(p):
                return {"zone_id": zid, "name": zd.get('name'), "risk_level": zd.get('risk_level'), "dynamic": True}
        except Exception:
            continue
    # static prepared
    for z, prepped in static_zone_shapes:
        try:
            if prepped.contains(p) or prepped.intersects(p):
                return {"zone_id": z.get('zone_id'), "name": z.get('name'), "risk_level": z.get('risk_level'), "dynamic": False}
        except Exception:
            continue
    return None

def min_distance_km_to_static_zones(lat, lon):
    """Compute approximate min distance in KM from point to any static zone polygon exterior vertices.
    If no zones, returns large number."""
    if not static_zones:
        return 9999.0
    min_km = 9999.0
    for z in static_zones:
        try:
            coords_rings = z['geojson']['coordinates']
            for ring in coords_rings:
                for (x, y) in ring:  # (lon, lat)
                    d = haversine_km(lat, lon, y, x)
                    if d < min_km:
                        min_km = d
        except Exception:
            continue
    return min_km

def detect_open_water(lat, lon, zone_present):
    """Heuristic open-water detection.
    Conditions:
      - Not in any zone
      - Distance to nearest zone > OPEN_WATER_DISTANCE_KM (default 20 km)
      - Optional regional bounding box check to avoid false positives inland.
    """
    if zone_present:
        return 0
    try:
        threshold_km = float(os.getenv('OPEN_WATER_DISTANCE_KM', '20'))
    except Exception:
        threshold_km = 20.0
    dmin = min_distance_km_to_static_zones(lat, lon)
    # Optional simple India bounding box example (customize per deployment)
    # If coordinate roughly inside India main bounds but far from any zone, still may not be water; keep conservative.
    india_bounds = (6.0, 38.0, 68.0, 98.0)  # (lat_min, lat_max, lon_min, lon_max)
    in_india_box = (india_bounds[0] <= lat <= india_bounds[1] and india_bounds[2] <= lon <= india_bounds[3])
    if dmin > threshold_km and not in_india_box:
        return 1
    return 0

# -------------------------
# Background cleanup for dynamic zones
# -------------------------
async def cleanup_dynamic_zones():
    while True:
        now = datetime.now(timezone.utc)
        remove = []
        for zid, zd in list(dynamic_zones.items()):
            if zd['expires_at'] <= now:
                remove.append(zid)
        for zid in remove:
            del dynamic_zones[zid]
        await asyncio.sleep(30)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(cleanup_dynamic_zones())

# -------------------------
# XAI: explain instance (SHAP)
# -------------------------
def explain_features(X_raw_2d):
    """X_raw_2d: 2D array of raw features in the same order used for train (excluding session_id)"""
    try:
        if explainer is None or scaler is None:
            return []
        # Note: our scaler transforms features; SHAP expects model input - use scaled features
        Xs = scaler.transform(X_raw_2d)
        vals = explainer.shap_values(Xs)
        sv = vals[0] if isinstance(vals, list) else vals
        feature_names = [c for c in feature_cols if c != 'session_id']
        per_sample = sv[0] if getattr(sv, 'ndim', 1) == 2 else sv
        # ensure lengths match
        try:
            vals_list = per_sample.tolist()
        except Exception:
            vals_list = list(per_sample)
        pairs = list(zip(feature_names, vals_list))
        pairs.sort(key=lambda x: abs(x[1]) if x[1] is not None else 0, reverse=True)
        total_abs = sum(abs(v) for _, v in pairs) or 1.0
        formatted = [{"name": name, "shap_value": float(val), "weight": float(abs(val)/total_abs)} for name, val in pairs[:6]]
        return formatted
    except Exception:
        return []

# -------------------------
# Endpoints
# -------------------------

@app.get("/")
def root():
    return {"status": "ok", "message": "Smart Anomaly Detector running. Use /docs for UI."}

@app.post("/ingest")
def ingest_point(p: GPSLog):
    # append to data/gps_logs.csv
    filepath = os.path.join(DATA_DIR, "gps_logs.csv")
    row = {"session_id": p.session_id, "lat": p.lat, "lon": p.lon, "timestamp": p.timestamp}
    df = pd.DataFrame([row])
    header = not os.path.exists(filepath)
    df.to_csv(filepath, mode='a', header=header, index=False)
    return {"status": "ok", "ingested": row}

@app.post("/ingest/batch")
def ingest_batch(b: BatchIngest):
    filepath = os.path.join(DATA_DIR, "gps_logs.csv")
    rows = [dict(session_id=p.session_id, lat=p.lat, lon=p.lon, timestamp=p.timestamp) for p in b.points]
    df = pd.DataFrame(rows)
    header = not os.path.exists(filepath)
    df.to_csv(filepath, mode='a', header=header, index=False)
    return {"status": "ok", "ingested": len(rows)}

@app.post("/zones")
def upload_zones(payload: ZonePayload):
    global static_zones
    static_zones = payload.zones
    with open(ZONES_FILE, "w") as f:
        json.dump(static_zones, f, indent=2)
    return {"status": "ok", "zones": len(static_zones)}

@app.post("/zones/dynamic")
def create_dynamic_zone(payload: DynamicZonePayload):
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=payload.ttl_seconds)
    dynamic_zones[payload.zone_id] = {
        "zone_id": payload.zone_id,
        "name": payload.name or payload.zone_id,
        "geojson": payload.geojson,
        "risk_level": payload.risk_level,
        "expires_at": expires_at
    }
    return {"status":"ok","zone_id": payload.zone_id, "expires_at": expires_at.isoformat()}

@app.get("/model/metadata")
def model_metadata():
    meta_file = os.path.join(MODEL_DIR, "model_metadata.json")
    if os.path.exists(meta_file):
        return json.load(open(meta_file))
    return {"error": "metadata not found"}

@app.post("/predict")
def predict_point(p: GPSLog):
    try:
        ts = pd.to_datetime(p.timestamp, utc=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid timestamp format")
    if pd.isna(ts):
        raise HTTPException(status_code=400, detail="Timestamp could not be parsed")
    ts_local = ts.to_pydatetime().replace(tzinfo=None)

    buf = session_history[p.session_id]
    buf.append({
        "lat": float(p.lat),
        "lon": float(p.lon),
        "timestamp": ts_local.isoformat(),
    })

    features = compute_session_features(
        list(buf),
        session_id=p.session_id,
        hotspot_index=hotspot_index,
        hotspot_radius=HOTSPOT_RADIUS,
    )
    features["hour"] = int(ts_local.hour)
    features["day_of_week"] = int(ts_local.weekday())
    if len(buf) >= 2:
        prev_ts = pd.to_datetime(buf[-2]["timestamp"], utc=True)
        prev_ts = prev_ts.to_pydatetime().replace(tzinfo=None)
        delta_minutes = max(0.0, (ts_local - prev_ts).total_seconds() / 60.0)
    else:
        delta_minutes = 0.0
    features["time_since_last"] = float(delta_minutes)

    fcols = [c for c in feature_cols if c != "session_id"]
    X_raw = np.array([[float(features.get(c, 0.0)) for c in fcols]])
    Xs = scaler.transform(X_raw)

    decision_score = float(iso.decision_function(Xs)[0])
    anomaly_flag = 1 if iso.predict(Xs)[0] == -1 else 0

    cluster_flag = 0
    cluster_distance = None
    try:
        core = getattr(dbs, "components_", None)
        eps = getattr(dbs, "eps", None)
        if core is not None and eps is not None and len(core):
            distances = np.linalg.norm(core - Xs[0], axis=1)
            cluster_distance = float(np.min(distances)) if len(distances) else None
            if cluster_distance is not None:
                cluster_flag = 1 if cluster_distance > float(eps) else 0
            else:
                cluster_flag = anomaly_flag
        else:
            cluster_flag = anomaly_flag
    except Exception:
        cluster_flag = anomaly_flag

    zone = point_in_any_zone(p.lat, p.lon)
    geo_flag = 0
    geo_risk_weight = 0.0
    if zone:
        rl = (zone.get("risk_level") or "").lower()
        if rl == "high":
            geo_flag = 1
            geo_risk_weight = 1.0
        elif rl == "medium":
            geo_flag = 1
            geo_risk_weight = 0.6
        elif rl == "low":
            geo_risk_weight = 0.2

    open_water_flag = detect_open_water(p.lat, p.lon, zone is not None)

    inact_flag = 0
    last = last_seen.get(p.session_id)
    if last:
        gap_minutes = (ts_local - last).total_seconds() / 60.0
        if gap_minutes > 10:
            inact_flag = 1
    last_seen[p.session_id] = ts_local

    group_flag = 0
    if p.group_id is not None:
        if p.group_id not in group_members:
            group_members[p.group_id] = {}
        group_members[p.group_id][p.user_id] = (p.lat, p.lon, ts_local)
        locs = list(group_members[p.group_id].values())
        for i in range(len(locs)):
            for j in range(i + 1, len(locs)):
                if haversine_km(locs[i][0], locs[i][1], locs[j][0], locs[j][1]) > 10.0:
                    group_flag = 1
                    break
            if group_flag:
                break

    anomaly_raw = -decision_score
    anomaly_score = float(1 / (1 + math.exp(-anomaly_raw)))

    crime_component = float(features.get("crime_rate_local", 0.0))
    density_component = float(features.get("event_density_local", 0.0))
    density_scaled = min(1.0, density_component / math.log1p(15.0)) if density_component > 0 else 0.0
    hotspot_score = min(1.0, 0.7 * crime_component + 0.3 * density_scaled)
    try:
        hotspot_threshold = float(os.getenv("HOTSPOT_ALERT_THRESHOLD", "0.6"))
    except Exception:
        hotspot_threshold = 0.6
    hotspot_flag = 1 if hotspot_score >= hotspot_threshold else 0

    w_ml = 0.5
    w_geo = 0.2
    w_rules = 0.15
    w_ocean = 0.05
    w_hotspot = 0.1
    rules_score = float(inact_flag or group_flag)
    final_risk = (
        w_ml * anomaly_score
        + w_geo * geo_risk_weight
        + w_rules * rules_score
        + w_ocean * (1.0 if open_water_flag else 0.0)
        + w_hotspot * hotspot_score
    )
    final_risk = round(min(1.0, final_risk), 3)

    factors = explain_features(X_raw) if explainer else []

    reasons = []
    if anomaly_flag:
        reasons.append("ml_anomaly")
    if cluster_flag:
        reasons.append("cluster_noise")
    if geo_flag and zone:
        reasons.append(f"in_zone_{zone.get('risk_level', 'unknown')}")
    if open_water_flag:
        reasons.append("open_water")
    if inact_flag:
        reasons.append("inactivity_gt_10m")
    if group_flag:
        reasons.append("group_distance_gt_10km")
    if hotspot_flag:
        reasons.append("local_hotspot")
    if crime_component >= 0.7:
        reasons.append("crime_hotspot_high")
    if density_component >= math.log1p(8):
        reasons.append("event_density_high")

    feature_snapshot = {c: float(features.get(c, 0.0)) for c in fcols}
    feature_snapshot["session_id"] = int(p.session_id)
    feature_snapshot["buffer_size"] = len(buf)

    out = {
        "session_id": p.session_id,
        "user_id": p.user_id,
        "group_id": p.group_id,
        "location": {"lat": p.lat, "lon": p.lon},
        "timestamp": p.timestamp,
        "anomaly_score": anomaly_score,
        "decision_score": decision_score,
        "cluster_distance": cluster_distance,
        "final_risk_score": final_risk,
        "reasons": reasons,
        "factors": factors,
        "zone": zone,
        "anomaly_flag": int(anomaly_flag),
        "cluster_flag": int(cluster_flag),
        "geo_flag": int(geo_flag),
        "open_water_flag": int(open_water_flag),
        "inactivity_flag": int(inact_flag),
        "group_flag": int(group_flag),
        "hotspot_flag": int(hotspot_flag),
        "hotspot": {
            "score": hotspot_score,
            "crime_rate": crime_component,
            "density_log": density_component,
            "threshold": hotspot_threshold,
        },
        "feature_snapshot": feature_snapshot,
        "history_points": len(buf),
    }

    db_save_prediction_row({
        "session_id": p.session_id,
        "user_id": p.user_id,
        "group_id": p.group_id,
        "lat": p.lat,
        "lon": p.lon,
        "timestamp": p.timestamp,
        "risk_score": final_risk,
        "anomaly_flag": int(anomaly_flag),
        "geo_flag": int(geo_flag),
        "inactivity_flag": int(inact_flag),
        "group_flag": int(group_flag),
        "reasons": reasons,
    })

    return JSONResponse(content=out)

@app.post('/zones/reload')
def reload_zones():
    """Reload zones.json from disk without restarting the service."""
    _load_static_zones()
    return {"status":"ok","zones": len(static_zones)}

@app.post("/predict/window")
def predict_window(points: List[GPSLog]):
    # convenience: score each point and return list of JSON objects
    results = []
    for p in points:
        resp = predict_point(p)
        # predict_point returns a JSONResponse
        if isinstance(resp, JSONResponse):
            try:
                # JSONResponse.content may not be directly accessible; use body if present
                body = resp.body
                content = json.loads(body.decode() if isinstance(body, (bytes, bytearray)) else body)
            except Exception:
                # fallback: try resp.rendered if available
                try:
                    rendered = resp.render()
                    content = json.loads(rendered.decode())
                except Exception:
                    content = {}
        else:
            content = resp
        results.append(content)
    return JSONResponse(content={"results": results})


@app.get('/health')
def health():
    """Health endpoint: checks model artifacts and DB connectivity."""
    ok = True
    details = {}
    # models
    try:
        for f in ['scaler.pkl', 'isolation_forest.pkl', 'dbscan.pkl', 'feature_cols.pkl']:
            p = os.path.join(MODEL_DIR, f)
            details[f] = os.path.exists(p)
            if not details[f]:
                ok = False
    except Exception as e:
        details['models_error'] = str(e)
        ok = False

    # DB
    try:
        conn = pool.getconn()
        cur = conn.cursor()
        cur.execute('SELECT 1')
        cur.close()
        pool.putconn(conn)
        details['db'] = True
    except Exception as e:
        details['db'] = False
        details['db_error'] = str(e)
        ok = False

    return {"ok": ok, "details": details}

@app.get("/predict/live/{session_id}")
def predict_live(session_id: int):
    # compute session-level features by aggregating CSV points for session
    df = load_sessions_from_csv()
    sess = df[df['session_id'] == session_id]
    if sess.empty:
        raise HTTPException(status_code=404, detail="No data for session")
    points = sess.sort_values('timestamp').to_dict(orient='records')
    # compute session-level features similar to train script
    # we will reuse extract_features logic from train if needed. For brevity compute a few
    # build a fake GPSLog using last point values and call predict_point
    last = points[-1]
    # choose user_id=0 if not available
    plog = GPSLog(session_id=int(last['session_id']), user_id=0, group_id=None, lat=float(last['lat']), lon=float(last['lon']), timestamp=last['timestamp'])
    return predict_point(plog)

@app.get("/alerts")
def fetch_alerts(limit: int = 50):
    conn = pool.getconn()
    cur = conn.cursor()
    cur.execute(
        "SELECT id, session_id, user_id, group_id, lat, lon, timestamp, risk_score, reasons, created_at"
        " FROM predictions ORDER BY id DESC LIMIT %s",
        (limit,)
    )
    rows = cur.fetchall()
    cur.close()
    pool.putconn(conn)
    keys = ["id", "session_id", "user_id", "group_id", "lat", "lon", "timestamp", "risk_score", "reasons", "created_at"]
    out = [dict(zip(keys, r)) for r in rows]
    for o in out:
        o['reasons'] = json.loads(o['reasons']) if o.get('reasons') else []
    return {"alerts": out}

if __name__ == "__main__":
    import uvicorn
    # Start the FastAPI application when running this script directly
    uvicorn.run(app, host="127.0.0.1", port=8001)
