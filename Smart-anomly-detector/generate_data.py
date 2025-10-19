import pandas as pd
import numpy as np
import random
from datetime import datetime, timedelta

# Starting point (e.g., city center)
BASE_LAT, BASE_LON = 28.6139, 77.2090  # New Delhi, India
def generate_trip(session_id, normal=True):
    points = []
    timestamp = datetime(2025, 9, 4, 10, 0, 0)  # Start time

    lat, lon = BASE_LAT, BASE_LON
    for i in range(30):  # 30 GPS points per trip
        if normal:
            # Move gradually within ~2km radius
            lat += np.random.uniform(-0.002, 0.002)
            lon += np.random.uniform(-0.002, 0.002)
        else:
            # Anomalous: bigger jumps or random wandering
            lat += np.random.uniform(-0.01, 0.01)
            lon += np.random.uniform(-0.01, 0.01)

        timestamp += timedelta(seconds=random.randint(60, 300))  # 1–5 minutes apart
        points.append([session_id, lat, lon, timestamp.isoformat()])

    return points

def main():
    all_trips = []
    for sid in range(201, 301):  # 100 sessions
        if sid % 5 == 0:  # every 5th trip anomalous
            all_trips.extend(generate_trip(sid, normal=False))
        else:
            all_trips.extend(generate_trip(sid, normal=True))

    df = pd.DataFrame(all_trips, columns=["session_id", "lat", "lon", "timestamp"])
    df.to_csv("gps_data.csv", index=False)
    print("✅ Synthetic GPS data generated: gps_data.csv")

if __name__ == "__main__":
    main()
