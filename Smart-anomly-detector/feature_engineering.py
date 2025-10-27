"""Shared feature engineering utilities for the Smart Anomaly Detector.

This module centralises feature extraction so the training pipeline and the
FastAPI inference service stay in sync. It also manages the lightweight
hotspot index built from historic incident reports to enrich each GPS sample
with context-aware signals.
"""
from __future__ import annotations

import json
import math
import os
from collections import Counter
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

DEFAULT_GRID_SIZE = 0.02  # ~2.2km at the equator
DEFAULT_HOTSPOT_RADIUS = 1  # look at the centre cell plus immediate neighbours


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Compute haversine distance between two lat/lon pairs in kilometres."""
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(
        math.radians(lat2)
    ) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


def _grid_scale(grid_size: float) -> int:
    return max(1, int(round(1.0 / max(grid_size, 1e-6))))


def _cell_key(lat_idx: int, lon_idx: int) -> str:
    return f"{lat_idx}|{lon_idx}"


def _cell_indices(lat: float, lon: float, grid_size: float) -> Tuple[int, int]:
    scale = _grid_scale(grid_size)
    lat_idx = int(round(lat * scale))
    lon_idx = int(round(lon * scale))
    return lat_idx, lon_idx


def build_hotspot_index(
    reviews_df: pd.DataFrame,
    grid_size: float = DEFAULT_GRID_SIZE,
) -> Dict[str, object]:
    """Aggregate incident/review severities into a grid for fast lookup."""
    if reviews_df is None or reviews_df.empty:
        return {
            "grid_size": float(grid_size),
            "scale": _grid_scale(grid_size),
            "cells": {},
        }

    cells: Dict[str, Dict[str, float]] = {}
    required = {"lat", "lon", "severity_score"}
    if not required.issubset(reviews_df.columns):
        raise ValueError("reviews dataframe missing required columns")

    scale = _grid_scale(grid_size)
    for row in reviews_df.itertuples(index=False):
        lat = float(getattr(row, "lat"))
        lon = float(getattr(row, "lon"))
        sev = float(getattr(row, "severity_score"))
        lat_idx, lon_idx = _cell_indices(lat, lon, grid_size)
        key = _cell_key(lat_idx, lon_idx)
        cell = cells.setdefault(
            key,
            {
                "lat_idx": lat_idx,
                "lon_idx": lon_idx,
                "count": 0,
                "severity_sum": 0.0,
                "max_severity": 0.0,
            },
        )
        cell["count"] += 1
        cell["severity_sum"] += sev
        if sev > cell["max_severity"]:
            cell["max_severity"] = sev

    return {
        "grid_size": float(grid_size),
        "scale": scale,
        "cells": cells,
    }


def save_hotspot_index(index: Dict[str, object], path: str) -> None:
    """Persist the hotspot index as JSON."""
    serialisable = {
        "grid_size": float(index.get("grid_size", DEFAULT_GRID_SIZE)),
        "scale": int(index.get("scale", _grid_scale(DEFAULT_GRID_SIZE))),
        "cells": {},
    }
    cells = index.get("cells", {}) or {}
    for key, cell in cells.items():
        serialisable["cells"][str(key)] = {
            "lat_idx": int(cell.get("lat_idx", 0)),
            "lon_idx": int(cell.get("lon_idx", 0)),
            "count": int(cell.get("count", 0)),
            "severity_sum": float(cell.get("severity_sum", 0.0)),
            "max_severity": float(cell.get("max_severity", 0.0)),
        }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(serialisable, fh, indent=2)


def load_hotspot_index(path: str) -> Optional[Dict[str, object]]:
    if not path or not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as fh:
        raw = json.load(fh)
    scale = int(raw.get("scale", _grid_scale(raw.get("grid_size", DEFAULT_GRID_SIZE))))
    grid_size = float(raw.get("grid_size", DEFAULT_GRID_SIZE))
    cells = {}
    for key, cell in (raw.get("cells") or {}).items():
        cells[str(key)] = {
            "lat_idx": int(cell.get("lat_idx", 0)),
            "lon_idx": int(cell.get("lon_idx", 0)),
            "count": int(cell.get("count", 0)),
            "severity_sum": float(cell.get("severity_sum", 0.0)),
            "max_severity": float(cell.get("max_severity", 0.0)),
        }
    return {"grid_size": grid_size, "scale": scale, "cells": cells}


def _compute_hotspot_stats(
    lat: float,
    lon: float,
    hotspot_index: Optional[Dict[str, object]],
    radius_cells: int = DEFAULT_HOTSPOT_RADIUS,
) -> Tuple[float, int]:
    """Return (avg_severity, total_count) for neighbouring hotspot cells."""
    if not hotspot_index:
        return 0.0, 0
    cells = hotspot_index.get("cells") or {}
    grid_size = float(hotspot_index.get("grid_size", DEFAULT_GRID_SIZE))
    scale = int(hotspot_index.get("scale", _grid_scale(grid_size)))
    lat_idx, lon_idx = _cell_indices(lat, lon, grid_size)

    total_count = 0
    total_severity = 0.0
    for dlat in range(-radius_cells, radius_cells + 1):
        for dlon in range(-radius_cells, radius_cells + 1):
            key = _cell_key(lat_idx + dlat, lon_idx + dlon)
            cell = cells.get(key)
            if not cell:
                continue
            c = int(cell.get("count", 0))
            if c <= 0:
                continue
            total_count += c
            total_severity += float(cell.get("severity_sum", 0.0))

    if total_count <= 0:
        return 0.0, 0
    return total_severity / total_count, total_count


def detect_stops(
    points: Sequence[Dict[str, object]],
    distance_threshold_km: float = 0.2,
    dwell_seconds: int = 300,
) -> int:
    """Count stationary segments lasting longer than dwell_seconds."""
    if len(points) < 2:
        return 0
    count = 0
    for i in range(len(points) - 1):
        p0 = points[i]
        p1 = points[i + 1]
        dist = haversine_km(float(p0["lat"]), float(p0["lon"]), float(p1["lat"]), float(p1["lon"]))
        dt = (p1["ts"] - p0["ts"]).total_seconds()
        if dist < distance_threshold_km and dt > dwell_seconds:
            count += 1
    return count


def _default_feature_row(session_id: Optional[int] = None) -> Dict[str, object]:
    return {
        "session_id": int(session_id) if session_id is not None else 0,
        "avg_speed": 0.0,
        "max_speed": 0.0,
        "std_speed": 0.0,
        "total_distance": 0.0,
        "route_deviation_ratio": 0.0,
        "isolated_stops": 0,
        "night_fraction": 0.0,
        "location_entropy": 0.0,
        "hour": 0,
        "day_of_week": 0,
        "time_since_last": 0.0,
        "crime_rate_local": 0.0,
        "event_density_local": 0.0,
    }


def compute_session_features(
    points: Iterable[Dict[str, object]],
    session_id: Optional[int] = None,
    hotspot_index: Optional[Dict[str, object]] = None,
    hotspot_radius: int = DEFAULT_HOTSPOT_RADIUS,
) -> Dict[str, object]:
    """Compute the engineered feature vector for a sequence of GPS points."""
    pts = list(points)
    feats = _default_feature_row(session_id=session_id)
    if not pts:
        return feats

    df = pd.DataFrame(pts)
    required = {"lat", "lon", "timestamp"}
    if not required.issubset(df.columns):
        return feats

    df = df.dropna(subset=["lat", "lon", "timestamp"]).copy()
    if df.empty:
        return feats

    df["lat"] = df["lat"].astype(float)
    df["lon"] = df["lon"].astype(float)
    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce", utc=True)
    df = df.dropna(subset=["timestamp"])
    if df.empty:
        return feats

    df = df.sort_values("timestamp")
    timestamps = [pd.Timestamp(ts).to_pydatetime().replace(tzinfo=None) for ts in df["timestamp"]]
    coords = list(zip(df["lat"].tolist(), df["lon"].tolist()))
    if not timestamps:
        return feats

    # Basic temporal features
    feats["hour"] = int(timestamps[-1].hour)
    feats["day_of_week"] = int(timestamps[-1].weekday())

    # Distance & speed metrics
    speeds: List[float] = []
    dists: List[float] = []
    gaps: List[float] = []
    for i in range(len(coords) - 1):
        lat1, lon1 = coords[i]
        lat2, lon2 = coords[i + 1]
        dist = haversine_km(lat1, lon1, lat2, lon2)
        dt_seconds = (timestamps[i + 1] - timestamps[i]).total_seconds()
        if dt_seconds > 0:
            speed_kmh = dist / (dt_seconds / 3600.0)
            speeds.append(speed_kmh)
            gaps.append(dt_seconds / 60.0)
        dists.append(dist)

    total_distance = float(np.sum(dists)) if dists else 0.0
    feats["avg_speed"] = float(np.mean(speeds)) if speeds else 0.0
    feats["max_speed"] = float(np.max(speeds)) if speeds else 0.0
    feats["std_speed"] = float(np.std(speeds)) if speeds else 0.0
    feats["total_distance"] = total_distance

    if len(coords) >= 2:
        straight = haversine_km(coords[0][0], coords[0][1], coords[-1][0], coords[-1][1])
        feats["route_deviation_ratio"] = float(total_distance / (straight + 1e-6))
    else:
        feats["route_deviation_ratio"] = 0.0

    enriched_points = [
        {"lat": coords[i][0], "lon": coords[i][1], "ts": timestamps[i]}
        for i in range(len(coords))
    ]
    feats["isolated_stops"] = detect_stops(enriched_points)

    night_points = sum(1 for ts in timestamps if ts.hour < 6 or ts.hour > 22)
    feats["night_fraction"] = float(night_points / len(timestamps)) if timestamps else 0.0

    grid = [(round(lat, 3), round(lon, 3)) for lat, lon in coords]
    counts = Counter(grid)
    probs = [c / len(grid) for c in counts.values()] if grid else []
    entropy = -sum(p * math.log(p) for p in probs if p > 0) if probs else 0.0
    feats["location_entropy"] = float(entropy)

    feats["time_since_last"] = float(gaps[-1]) if gaps else 0.0

    if hotspot_index:
        crime_vals: List[float] = []
        density_vals: List[float] = []
        for lat, lon in coords[-min(10, len(coords)) :]:
            sev, count = _compute_hotspot_stats(lat, lon, hotspot_index, radius_cells=hotspot_radius)
            crime_vals.append(sev)
            density_vals.append(math.log1p(count))
        feats["crime_rate_local"] = float(np.mean(crime_vals)) if crime_vals else 0.0
        feats["event_density_local"] = float(np.mean(density_vals)) if density_vals else 0.0
    else:
        feats["crime_rate_local"] = 0.0
        feats["event_density_local"] = 0.0

    return feats


def load_points_from_dataframe(df: pd.DataFrame) -> Dict[int, List[Dict[str, object]]]:
    required = {"session_id", "lat", "lon", "timestamp"}
    if not required.issubset(df.columns):
        missing = ", ".join(sorted(required - set(df.columns)))
        raise ValueError(f"missing columns in gps dataframe: {missing}")
    df = df.dropna(subset=list(required)).copy()
    df["session_id"] = df["session_id"].astype(int)
    groups = {}
    for session_id, group in df.groupby("session_id"):
        points = group.sort_values("timestamp").to_dict(orient="records")
        groups[int(session_id)] = points
    return groups
__all__ = [
    "DEFAULT_GRID_SIZE",
    "DEFAULT_HOTSPOT_RADIUS",
    "build_hotspot_index",
    "save_hotspot_index",
    "load_hotspot_index",
    "compute_session_features",
    "load_points_from_dataframe",
    "haversine_km",
]
