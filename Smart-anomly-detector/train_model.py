"""Train the Smart Anomaly Detector offline model suite.

This script ingests historic GPS traces plus contextual incident reports,
engineers session-level features, and fits both an Isolation Forest (primary
ML detector) and a DBSCAN density model used for secondary scoring. All model
artifacts, metadata, and the hotspot index are saved to the model/ directory.
"""

import json
import os
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

from feature_engineering import (
    DEFAULT_GRID_SIZE,
    build_hotspot_index,
    compute_session_features,
    load_points_from_dataframe,
    save_hotspot_index,
)

BASE_DIR = os.path.dirname(__file__)
DATA_DIR = os.path.join(BASE_DIR, "data")
MODEL_DIR = os.path.join(BASE_DIR, "model")
HOTSPOT_PATH = os.path.join(MODEL_DIR, "hotspot_index.json")
os.makedirs(MODEL_DIR, exist_ok=True)


def _normalise_gps_df(df: pd.DataFrame) -> pd.DataFrame:
    """Ensure a GPS dataframe has the expected schema."""
    if df is None or df.empty:
        return pd.DataFrame(columns=["session_id", "lat", "lon", "timestamp"])

    cols = [c.strip().lower() for c in df.columns]
    df.columns = cols
    if "session_id" not in df.columns:
        if len(df.columns) != 4:
            raise RuntimeError(
                "gps csv must have columns session_id,lat,lon,timestamp or be four-column without headers"
            )
        df.columns = ["session_id", "lat", "lon", "timestamp"]
    required = ["session_id", "lat", "lon", "timestamp"]
    df = df.dropna(subset=required).copy()
    df["session_id"] = df["session_id"].astype(int)
    df["lat"] = df["lat"].astype(float)
    df["lon"] = df["lon"].astype(float)
    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    df = df.dropna(subset=["timestamp"])
    return df[required]


def load_gps_sessions() -> pd.DataFrame:
    frames = []
    logs_path = os.path.join(DATA_DIR, "gps_logs.csv")
    data_path = os.path.join(DATA_DIR, "gps_data.csv")

    if os.path.exists(logs_path):
        df_logs = pd.read_csv(logs_path)
        frames.append(_normalise_gps_df(df_logs))
    if os.path.exists(data_path):
        df_data = pd.read_csv(data_path)
        frames.append(_normalise_gps_df(df_data))

    if not frames:
        raise RuntimeError("No GPS CSVs found in data/. Provide gps_logs.csv or gps_data.csv.")

    merged = pd.concat(frames, ignore_index=True)
    merged = merged.drop_duplicates(subset=["session_id", "timestamp", "lat", "lon"])
    return merged


def load_reviews() -> pd.DataFrame:
    reviews_path = os.path.join(DATA_DIR, "reviews_reports.csv")
    if not os.path.exists(reviews_path):
        return pd.DataFrame()
    df = pd.read_csv(reviews_path)
    required = {"lat", "lon", "severity_score"}
    if not required.issubset(df.columns):
        return pd.DataFrame()
    df = df.dropna(subset=list(required)).copy()
    df["lat"] = df["lat"].astype(float)
    df["lon"] = df["lon"].astype(float)
    df["severity_score"] = df["severity_score"].astype(float)
    return df


def main():
    print("📦 Loading GPS sessions …")
    gps_df = load_gps_sessions()
    session_points = load_points_from_dataframe(gps_df)
    if not session_points:
        raise RuntimeError("No session data available after preprocessing.")

    print("📊 Loaded", len(session_points), "sessions (", len(gps_df), "points )")

    print("🛰️ Building hotspot index …")
    reviews_df = load_reviews()
    hotspot_index = None
    if not reviews_df.empty:
        grid_size = float(os.getenv("HOTSPOT_GRID_SIZE", DEFAULT_GRID_SIZE))
        hotspot_index = build_hotspot_index(reviews_df, grid_size=grid_size)
        save_hotspot_index(hotspot_index, HOTSPOT_PATH)
        print(
            "   Hotspot grid size:", grid_size,
            "| cells:", len(hotspot_index.get("cells", {})),
        )
    else:
        hotspot_index = None
        if os.path.exists(HOTSPOT_PATH):
            os.remove(HOTSPOT_PATH)
        print("   No incident reviews found; hotspot features disabled.")

    print("🧮 Engineering features …")
    feature_rows = []
    for session_id, points in session_points.items():
        feats = compute_session_features(points, session_id=session_id, hotspot_index=hotspot_index)
        feature_rows.append(feats)

    features_df = pd.DataFrame(feature_rows).fillna(0.0)
    if features_df.empty:
        raise RuntimeError("Feature dataframe is empty. Check input data quality.")

    feature_cols = [
        "session_id",
        "avg_speed",
        "max_speed",
        "std_speed",
        "total_distance",
        "route_deviation_ratio",
        "isolated_stops",
        "night_fraction",
        "location_entropy",
        "hour",
        "day_of_week",
        "time_since_last",
        "crime_rate_local",
        "event_density_local",
    ]
    missing_cols = [c for c in feature_cols if c not in features_df.columns]
    if missing_cols:
        raise RuntimeError(f"Missing engineered feature columns: {missing_cols}")

    X = features_df[feature_cols].copy()
    X.pop("session_id")

    scaler = StandardScaler()
    Xs = scaler.fit_transform(X.values)

    n_sessions = len(features_df)
    base_contamination = float(os.getenv("IFOREST_CONTAMINATION", "0.05"))
    contamination = max(0.01, min(0.2, base_contamination))
    if contamination * n_sessions < 1:
        contamination = max(0.01, min(0.2, 2.0 / max(n_sessions, 10)))

    iso = IsolationForest(
        n_estimators=300,
        contamination=contamination,
        random_state=42,
        bootstrap=False,
        max_samples="auto",
    )
    iso.fit(Xs)

    eps = float(os.getenv("DBSCAN_EPS", "2.5"))
    min_samples = int(os.getenv("DBSCAN_MIN_SAMPLES", "3"))
    dbs = DBSCAN(eps=eps, min_samples=min_samples)
    dbs.fit(Xs)

    print("💾 Saving artifacts …")
    joblib.dump(scaler, os.path.join(MODEL_DIR, "scaler.pkl"))
    joblib.dump(iso, os.path.join(MODEL_DIR, "isolation_forest.pkl"))
    joblib.dump(dbs, os.path.join(MODEL_DIR, "dbscan.pkl"))
    joblib.dump(feature_cols, os.path.join(MODEL_DIR, "feature_cols.pkl"))

    decision_scores = iso.decision_function(Xs)
    metadata = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "n_sessions": int(n_sessions),
        "gps_points": int(len(gps_df)),
        "feature_cols": feature_cols,
        "iforest": {
            "contamination": float(contamination),
            "n_estimators": int(iso.n_estimators),
            "decision_score_min": float(np.min(decision_scores)),
            "decision_score_max": float(np.max(decision_scores)),
            "decision_score_median": float(np.median(decision_scores)),
        },
        "dbscan": {
            "eps": float(eps),
            "min_samples": int(min_samples),
            "n_clusters": int(len(set(label for label in dbs.labels_ if label >= 0))),
            "noise_ratio": float((dbs.labels_ == -1).sum() / len(dbs.labels_)),
        },
        "hotspot": {
            "enabled": bool(hotspot_index),
            "grid_size": float(hotspot_index.get("grid_size")) if hotspot_index else None,
            "cells": int(len(hotspot_index.get("cells", {}))) if hotspot_index else 0,
        },
    }
    with open(os.path.join(MODEL_DIR, "model_metadata.json"), "w", encoding="utf-8") as fh:
        json.dump(metadata, fh, indent=2)

    print("✅ Training complete. Models saved to", MODEL_DIR)
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
