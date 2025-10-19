import csv
import random
from datetime import datetime, timedelta

# Path to the CSV file
csv_path = 'C:/Users/ASUS/OneDrive/Desktop/ai-service/smart-anomaly-detector/data/gps_data.csv'

# Read existing data to find last session and timestamp
with open(csv_path, 'r') as f:
    reader = csv.reader(f)
    rows = list(reader)

last_session = int(rows[-1][0])
last_time_str = rows[-1][3]
last_time = datetime.fromisoformat(last_time_str)

# Generate 10 more sessions, each with 25 points
with open(csv_path, 'a', newline='') as f:
    writer = csv.writer(f)
    for session in range(last_session + 1, last_session + 11):
        # Start time for session: next day or later
        start_time = last_time + timedelta(days=1, hours=random.randint(0, 23))
        # Start lat/lon random in Tokyo area (approximate)
        lat = random.uniform(35.65, 35.75)
        lon = random.uniform(139.70, 139.85)
        for i in range(25):
            time = start_time + timedelta(minutes=i * 3)  # every 3 minutes
            # Small random walk to simulate movement
            lat += random.uniform(-0.002, 0.002)
            lon += random.uniform(-0.002, 0.002)
            # Keep within reasonable bounds
            lat = max(35.60, min(35.80, lat))
            lon = max(139.65, min(139.90, lon))
            writer.writerow([session, lat, lon, time.isoformat()])

print("Additional GPS data generated and appended.")
