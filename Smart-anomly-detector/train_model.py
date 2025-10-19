# train_model.py
"""
Train models on merged gps_logs.csv and gps_data.csv.
Saves:
 - model/scaler.pkl
 - model/isolation_forest.pkl
 - model/dbscan.pkl
 - model/feature_cols.pkl
 - model/model_metadata.json
Also logs to MLflow if available.
"""

import os
import json
import math
import joblib
import pandas as pd
import numpy as np
from collections import Counter
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import IsolationForest
from sklearn.cluster import DBSCAN
from datetime import datetime
from math import radians, cos, sin, asin, sqrt

# Paths
BASE_DIR = os.path.dirname(__file__)
DATA_DIR = os.path.join(BASE_DIR, "data")
MODEL_DIR = os.path.join(BASE_DIR, "model")
os.makedirs(MODEL_DIR, exist_ok=True)

# ----------------------
# Helper functions
# ----------------------
def haversine_km(p1, p2):
    lat1, lon1 = p1[0], p1[1]
    lat2, lon2 = p2[0], p2[1]
    R = 6371.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat/2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon/2)**2
    c = 2 * asin(sqrt(a))
    return R * c

def detect_stops(points, threshold_km=0.2, dwell_seconds=300):
    """Return list of stop coords detected for a session"""
    stops = []
    for i in range(len(points)-1):
        p0 = (points[i]['lat'], points[i]['lon'])
        p1 = (points[i+1]['lat'], points[i+1]['lon'])
        dt = (pd.to_datetime(points[i+1]['timestamp']) - pd.to_datetime(points[i]['timestamp'])).total_seconds()
        if haversine_km(p0, p1) < threshold_km and dt > dwell_seconds:
            stops.append(p0)
    return stops

def extract_features_for_session(points):
    """points: list of dicts with lat, lon, timestamp"""
    feats = {}
    # sort by timestamp
    pts = sorted(points, key=lambda x: pd.to_datetime(x['timestamp']))
    # speeds (km/h)
    speeds = []
    dists = []
    for i in range(len(pts)-1):
        p0 = (pts[i]['lat'], pts[i]['lon'])
        p1 = (pts[i+1]['lat'], pts[i+1]['lon'])
        dist_km = haversine_km(p0, p1)
        dt_hours = (pd.to_datetime(pts[i+1]['timestamp']) - pd.to_datetime(pts[i]['timestamp'])).total_seconds() / 3600.0
        if dt_hours > 0:
            speeds.append(dist_km / dt_hours)
        dists.append(dist_km)
    feats['avg_speed'] = float(np.mean(speeds)) if speeds else 0.0
    feats['max_speed'] = float(np.max(speeds)) if speeds else 0.0
    feats['std_speed'] = float(np.std(speeds)) if speeds else 0.0
    total_distance = float(np.sum(dists)) if dists else 0.0
    feats['total_distance'] = total_distance

    # route deviation: ratio actual / straight-line
    straight_km = haversine_km((pts[0]['lat'], pts[0]['lon']), (pts[-1]['lat'], pts[-1]['lon'])) if len(pts) >= 2 else 0.0
    feats['route_deviation_ratio'] = float(total_distance / (straight_km + 1e-6))

    # stops
    stop_locs = detect_stops(pts)
    feats['isolated_stops'] = int(len(stop_locs))

    # night fraction
    hours = [pd.to_datetime(p['timestamp']).hour for p in pts]
    night_points = sum(1 for h in hours if h < 6 or h > 22)
    feats['night_fraction'] = float(night_points / len(pts)) if pts else 0.0

    # location entropy
    grid = [(round(p['lat'], 3), round(p['lon'], 3)) for p in pts]
    counts = Counter(grid)
    probs = [c/len(pts) for c in counts.values()] if pts else [0.0]
    entropy = -sum(p * math.log(p) for p in probs if p>0) if probs else 0.0
    feats['location_entropy'] = float(entropy)

    # time features (from first point)
    first_ts = pd.to_datetime(pts[0]['timestamp'])
    feats['hour'] = int(first_ts.hour)
    feats['day_of_week'] = int(first_ts.weekday())

    # inactivity / time_since_last (we will set time_since_last to 0 for training; backend can compute live)
    feats['time_since_last'] = 0.0

    # placeholder features for integrations (crime_rate, event_density)
    feats['crime_rate_local'] = 0.0
    feats['event_density_local'] = 0.0

    return feats

# ----------------------
# Main training
# ----------------------
def main():
    # Load both CSVs if present
    logs_path = os.path.join(DATA_DIR, "gps_logs.csv")
    data_path = os.path.join(DATA_DIR, "gps_data.csv")

    dfs = []
    if os.path.exists(logs_path):
        df_logs = pd.read_csv(logs_path)
        # ensure timestamps have consistent ISO format
        df_logs['timestamp'] = pd.to_datetime(df_logs['timestamp']).dt.strftime("%Y-%m-%dT%H:%M:%S")
        dfs.append(df_logs)
    if os.path.exists(data_path):
        df_data = pd.read_csv(data_path, header=0)
        # gps_data format in your example doesn't have headers. If it does have headers, adjust.
        # We'll try to infer: If there are 4 columns, assume session_id, lat, lon, timestamp
        if df_data.shape[1] == 4:
            df_data.columns = ['session_id','lat','lon','timestamp']
            df_data['timestamp'] = pd.to_datetime(df_data['timestamp']).dt.strftime("%Y-%m-%dT%H:%M:%S")
            dfs.append(df_data)
        else:
            raise RuntimeError("gps_data.csv shape unexpected. Ensure it has 4 columns: session_id,lat,lon,timestamp")

    if not dfs:
        raise RuntimeError("No GPS CSVs found in data/ folder. Please place gps_logs.csv or gps_data.csv")

    merged = pd.concat(dfs, ignore_index=True)

    # Build session-level rows
    feature_rows = []
    for sid, group in merged.groupby('session_id'):
        points = group.sort_values('timestamp').to_dict(orient='records')
        feats = extract_features_for_session(points)
        feats['session_id'] = int(sid)
        feature_rows.append(feats)

    features_df = pd.DataFrame(feature_rows).fillna(0.0)

    # Stable feature order - pick columns we engineered
    feature_cols = ['session_id','avg_speed','max_speed','std_speed','total_distance',
                    'route_deviation_ratio','isolated_stops','night_fraction','location_entropy',
                    'hour','day_of_week','time_since_last','crime_rate_local','event_density_local']
    feature_cols = [c for c in feature_cols if c in features_df.columns]
    X = features_df[feature_cols].copy()

    # scale (drop session_id from scaling)
    sess = X['session_id'].values.reshape(-1,1)
    X_nosess = X.drop(columns=['session_id']) if 'session_id' in X.columns else X
    scaler = StandardScaler()
    Xs = scaler.fit_transform(X_nosess.values)

    # Train IsolationForest on session features (not session_id)
    iso = IsolationForest(n_estimators=200, contamination=0.05, random_state=42)
    iso.fit(Xs)

    # DBSCAN fit on same scaled features
    dbs = DBSCAN(eps=1.5, min_samples=2).fit(Xs)

    # Save artifacts
    joblib.dump(scaler, os.path.join(MODEL_DIR, "scaler.pkl"))
    joblib.dump(iso, os.path.join(MODEL_DIR, "isolation_forest.pkl"))
    joblib.dump(dbs, os.path.join(MODEL_DIR, "dbscan.pkl"))
    joblib.dump(feature_cols, os.path.join(MODEL_DIR, "feature_cols.pkl"))

    # Save metadata
    metadata = {
        "trained_at": datetime.utcnow().isoformat(),
        "n_sessions": int(len(features_df)),
        "feature_cols": feature_cols
    }
    with open(os.path.join(MODEL_DIR, "model_metadata.json"), "w") as f:
        json.dump(metadata, f, indent=2)

    print("✅ Training complete. Models saved to", MODEL_DIR)
    print("Metadata:", metadata)

    # (Optional) log to mlflow if available
    try:
        import mlflow, mlflow.sklearn
        mlflow.set_experiment("tourist_safety")
        with mlflow.start_run():
            mlflow.log_params({"n_sessions": metadata['n_sessions'], "n_features": len(feature_cols)-1})
            mlflow.sklearn.log_model(iso, "isolation_forest")
            mlflow.log_artifact(os.path.join(MODEL_DIR, "model_metadata.json"))
            print("✅ logged to mlflow")
    except Exception:
        # mlflow optional
        pass

if __name__ == "__main__":
    main()
