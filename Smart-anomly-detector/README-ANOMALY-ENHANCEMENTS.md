# Smart Anomaly Detector Enhancements

## New Features
- Boundary-aware zone detection (point on polygon edge now counts as inside).
- Prepared geometry caching for faster lookups.
- Risk weighting by zone risk_level (high/medium/low).
- Open water heuristic: if point is far (>20km default) from any static zone and outside configured land bounding box, `open_water_flag=1` and reason `open_water` added.
- Adjustable distance threshold via `OPEN_WATER_DISTANCE_KM` environment variable.
- `/zones/reload` endpoint to reload `data/zones.json` without restart.
- Session-aware feature extraction powered by sliding buffers (configurable via `SESSION_HISTORY_SIZE`) so per-point predictions use recent trajectory metrics instead of zeros.
- Incident hotspot enrichment: a grid built from `data/reviews_reports.csv` contributes `crime_rate_local` and `event_density_local`; enable/disable with `HOTSPOT_GRID_SIZE`/`HOTSPOT_ALERT_THRESHOLD`.
- DBSCAN inference now measures distance to learned core samples rather than refitting, improving cluster noise flags.

## Response Additions ( /predict )
- `open_water_flag`: 1 if heuristic detects likely open water.
- `reasons` may now include: `in_zone_high`, `in_zone_medium`, `open_water`.
- `hotspot_flag` with associated `hotspot` detail (crime rate, density log, current threshold).
- `feature_snapshot` echoing engineered inputs for observability.

## Updating Zones
```
POST /zones
{ "zones": [ { "zone_id": "z1", "name": "Area", "risk_level": "high", "geojson": {"type":"Polygon","coordinates":[[[lon,lat],...]] } } ] }
```
Then reload without restart:
```
POST /zones/reload
```

## Tuning
Set `OPEN_WATER_DISTANCE_KM=30` (example) to make open water detection stricter.

## Notes
If you want medium/low zones to contribute less risk but still visible, they appear via `geo_flag=1` only for medium/high. Low risk zones only annotate reasons.
