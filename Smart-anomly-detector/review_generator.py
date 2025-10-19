#!/usr/bin/env python3
"""
generate_reviews_dataset.py

Generates a synthetic but realistic dataset of user reviews / reports about safety incidents.
Outputs CSV: data/reviews_reports.csv

Columns:
 - report_id: unique id
 - session_id: session/trip id (S###)
 - user_id: U###
 - lat, lon
 - timestamp (ISO)
 - review_text
 - threat_label
 - severity_score (0..1)
 - location_name (POI)
"""

import os
import csv
import random
from datetime import datetime, timedelta

# Output path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(BASE_DIR), "data")  # ../data from scripts/
os.makedirs(DATA_DIR, exist_ok=True)
OUT_CSV = os.path.join(DATA_DIR, "reviews_reports.csv")

# List of POIs (name, lat, lon) - representative tourist spots / city centers across India
POIS = [
    ("Connaught Place, Delhi", 28.6328, 77.2197),
    ("India Gate, Delhi", 28.6129, 77.2295),
    ("Qutub Minar, Delhi", 28.5244, 77.1855),
    ("Gateway of India, Mumbai", 18.9220, 72.8347),
    ("Marine Drive, Mumbai", 18.9438, 72.8230),
    ("Juhu Beach, Mumbai", 19.0986, 72.8268),
    ("Bandra, Mumbai", 19.0544, 72.8402),
    ("Bengaluru MG Road", 12.9759, 77.6051),
    ("Lalbagh, Bengaluru", 12.9507, 77.5848),
    ("Cubbon Park, Bengaluru", 12.9762, 77.5928),
    ("Marina Beach, Chennai", 13.0489, 80.2826),
    ("Besant Nagar, Chennai", 13.0094, 80.2677),
    ("Fort Kochi, Kochi", 9.9667, 76.2419),
    ("Varkala Beach, Kerala", 8.7376, 76.7160),
    ("Goa - Calangute", 15.5461, 73.7551),
    ("Pondicherry Promenade", 11.9340, 79.8307),
    ("Taj Mahal, Agra", 27.1751, 78.0421),
    ("Pink City, Jaipur", 26.9124, 75.7873),
    ("Hawa Mahal, Jaipur", 26.9239, 75.8267),
    ("Udaipur Lake Pichola", 24.5760, 73.6802),
    ("Jaisalmer Fort", 26.9157, 70.9083),
    ("Jodhpur Mehrangarh", 26.2969, 73.0180),
    ("Amritsar Golden Temple", 31.6200, 74.8765),
    ("Chandigarh Sector 17", 30.7333, 76.7794),
    ("Shimla Mall", 31.1048, 77.1734),
    ("Manali Mall", 32.2432, 77.1892),
    ("Leh Market", 34.1526, 77.5770),
    ("Srinagar Dal Lake", 34.0837, 74.7973),
    ("Darjeeling Mall", 27.0410, 88.2627),
    ("Kolkata Victoria Memorial area", 22.5448, 88.3426),
    ("Howrah Bridge area, Kolkata", 22.5831, 88.3462),
    ("Pune FC road area", 18.5204, 73.8567),
    ("Hyderabad Charminar", 17.3616, 78.4747),
    ("Rameswaram", 9.2881, 79.3122),
    ("Kanyakumari", 8.0883, 77.5385),
    ("Munnar", 10.0892, 77.0590),
    ("Ooty", 11.4064, 76.6950),
    ("Coorg Madikeri", 12.4244, 75.7382),
    ("Kolkata New Market", 22.5465, 88.3470),
    ("Patna Gandhi Maidan", 25.5941, 85.1376),
    ("Lucknow Hazratganj", 26.8470, 80.9470),
    ("Varanasi Dashashwamedh Ghat", 25.3100, 82.9736),
    ("Rishikesh Laxman Jhula", 30.0869, 78.2658),
    ("Haridwar Har-ki-Pauri", 29.9457, 78.1642),
    ("Kaziranga Park", 26.5775, 93.1714),
    ("Sundarbans Entry", 22.3085, 88.7688),
    ("Andaman Port Blair", 11.6234, 92.7265),
    ("Havelock Island", 11.9636, 92.9670),
    ("Kovalam, Trivandrum", 8.4864, 76.9366),
    ("Alleppey Backwaters", 9.4981, 76.3388),
    ("Puri Jagannath Temple", 19.8135, 85.8312),
    ("Konark Sun Temple area", 19.8870, 86.0945),
    ("Dharamshala", 32.2190, 76.3234),
    ("Amarnath base area (approx)", 33.9850, 75.2400),
    ("Ziro Valley", 27.6169, 93.8296),
    ("Tawang", 27.5860, 91.8640),
    ("Gangtok MG Marg", 27.3389, 88.6065),
]

# Threat types and templates
THREATS = {
    "theft": [
        "My bag was snatched near {}. I lost my phone and wallet.",
        "Pickpocketing at {} — they took my wallet during the crowd.",
        "Someone stole my backpack at {} while I was on my phone.",
        "Phone stolen at {}. Be careful around the market."
    ],
    "assault": [
        "I was attacked near {}. Got hurt and need police help.",
        "Group of men assaulted me close to {}.",
        "Physical assault happened near {} during the night."
    ],
    "harassment": [
        "I faced harassment near {}. People were catcalling and it felt unsafe.",
        "Verbal harassment at {} when I was walking alone.",
        "Eve-teasing incident near {}— women should avoid the area at night."
    ],
    "scam": [
        "I got scammed by a taxi driver around {}. They overcharged and threatened me.",
        "Fake guide scammed me at {} promising discount tours.",
        "Someone tried a credit-card scam near {}."
    ],
    "lost": [
        "I misplaced my passport at {}. Please help locate.",
        "Lost my wallet and ID near {} after crowding.",
        "Left my bag on a bench near {} and couldn't find it."
    ],
    "suspicious_person": [
        "Saw a suspicious person lurking near {} for hours.",
        "Group acting strange near {}. Could be a threat.",
        "Someone was following me near {}— very suspicious."
    ],
    "accident": [
        "Minor road accident near {}. No ambulance available immediately.",
        "I slipped and got injured at {}. Need medical help.",
        "Bike collided near {} and rider is badly hurt."
    ],
    "medical_emergency": [
        "Person fainted near {} and there was delay in help.",
        "Medical emergency at {} — we couldn't find first aid.",
        "Someone had severe allergic reaction near {}."
    ],
    "vandalism": [
        "Vandalism noticed near {}. Statues/graffiti and broken benches.",
        "Property damage near {} late at night.",
        "Public infrastructure vandalized at {}."
    ],
    "unsafe_transport": [
        "Auto driver refused meter and behaved aggressively near {}.",
        "Boat operator was reckless near {} and it felt unsafe.",
        "Taxi driver tried to drive off-route near {}."
    ]
}

# Severity base for each threat type (0..1)
SEVERITY_BASE = {
    "theft": 0.7,
    "assault": 0.95,
    "harassment": 0.6,
    "scam": 0.5,
    "lost": 0.4,
    "suspicious_person": 0.55,
    "accident": 0.85,
    "medical_emergency": 0.9,
    "vandalism": 0.3,
    "unsafe_transport": 0.5
}

def random_time(within_days=60):
    """Random timestamp within last `within_days` days"""
    now = datetime.now()
    past = now - timedelta(days=within_days)
    rand_dt = past + timedelta(seconds=random.randint(0, within_days * 24 * 3600))
    # Randomize time of day to cluster some at night for certain threats
    return rand_dt.replace(microsecond=0).isoformat(sep='T')

def jitter_coord(lat, lon, meters=200):
    """Small jitter around a lat/lon in degrees (approx). meters default 200m"""
    # ~111111 meters per degree latitude
    # longitude degrees vary by cos(lat)
    dlat = (random.uniform(-meters, meters) / 111111.0)
    dlon = (random.uniform(-meters, meters) / (111111.0 * max(0.01, abs(math.cos(math.radians(lat))))))
    return lat + dlat, lon + dlon

import math
def jitter(lat, lon, radius_m=150):
    # random point within radius_m meters
    r = random.random() * radius_m
    theta = random.random() * 2 * math.pi
    dy = r * math.sin(theta)
    dx = r * math.cos(theta)
    new_lat = lat + (dy / 111111.0)
    new_lon = lon + (dx / (111111.0 * math.cos(math.radians(lat) if abs(lat) < 89 else 0.0)))
    return new_lat, new_lon

def generate_reports(n_sessions=120, avg_points_per_session=6, out_csv=OUT_CSV):
    rows = []
    report_id = 1
    # Each "session" is a distinct reporter/trip
    for sidx in range(1, n_sessions + 1):
        session_id = f"S{sidx:04d}"
        user_id = f"U{random.randint(1000,9999)}"
        # pick a POI to originate the report cluster (some sessions may have multiple reports near same POI)
        poi_name, base_lat, base_lon = random.choice(POIS)
        # number of reports coming from this session
        n_reports = max(1, int(random.gauss(avg_points_per_session, 2)))
        for _ in range(n_reports):
            # pick threat type (skew distribution so theft/harassment/scam common)
            threat = random.choices(
                population=list(THREATS.keys()),
                weights=[0.20, 0.08, 0.15, 0.12, 0.07, 0.06, 0.04, 0.03, 0.05, 0.20],
                k=1
            )[0]
            template = random.choice(THREATS[threat])
            # jitter coordinates around POI (0-300m)
            lat, lon = jitter(base_lat, base_lon, radius_m=random.randint(20,300))
            # format text
            review_text = template.format(poi_name)
            # add small variations (time of day, "alone", "with family", numbers)
            suffixes = [
                "",
                " I was alone at that time.",
                " Happened at night.",
                " Reported to local police but no help.",
                " Took place during peak hours.",
                " Witnessed by many tourists.",
                " Lost valuables worth approx. INR 15,000."
            ]
            if random.random() < 0.35:
                review_text += random.choice(suffixes)
            # timestamp
            ts = random_time(within_days=90)
            # severity score around base ± small noise
            sev = min(1.0, max(0.0, SEVERITY_BASE.get(threat, 0.5) + random.uniform(-0.15, 0.15)))
            # assemble row
            rows.append({
                "report_id": f"R{report_id:06d}",
                "session_id": session_id,
                "user_id": user_id,
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "timestamp": ts,
                "review_text": review_text,
                "threat_label": threat,
                "severity_score": round(sev, 3),
                "location_name": poi_name
            })
            report_id += 1

    # Shuffle rows
    random.shuffle(rows)

    # Write CSV
    fieldnames = ["report_id","session_id","user_id","lat","lon","timestamp","review_text","threat_label","severity_score","location_name"]
    with open(out_csv, "w", newline='', encoding='utf8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows:
            writer.writerow(r)

    print(f"✅ Generated {len(rows)} reports -> {out_csv}")

if __name__ == "__main__":
    # generate ~ 120 sessions x ~6 reports = ~720 rows by default
    generate_reports(n_sessions=130, avg_points_per_session=6)
