"""
MySQL database connection for Smart Anomaly Detector
"""
import os
import json
from datetime import datetime, timezone
from dotenv import load_dotenv
import psycopg2
from psycopg2 import sql
from psycopg2.pool import SimpleConnectionPool

# Load .env
BASE_DIR = os.path.dirname(__file__)
dotenv_path = os.path.join(BASE_DIR, '.env')
load_dotenv(dotenv_path)

# Database configuration for Postgres
DB_CONFIG = {
    'user': os.getenv('DB_USER'),
    'password': os.getenv('DB_PASSWORD'),
    'host': os.getenv('DB_HOST'),
    'database': os.getenv('DB_DATABASE'),
    'port': int(os.getenv('DB_PORT', 5432)),
}

# Connection pool for Postgres
pool = SimpleConnectionPool(minconn=1, maxconn=5, **DB_CONFIG)

def init_db():
    """Initialize the predictions table in the Postgres database"""
    conn = pool.getconn()
    cursor = conn.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS predictions (
            id SERIAL PRIMARY KEY,
            session_id INT,
            user_id INT,
            group_id INT,
            lat DOUBLE PRECISION,
            lon DOUBLE PRECISION,
            timestamp TIMESTAMP,
            risk_score DOUBLE PRECISION,
            anomaly_flag SMALLINT,
            geo_flag SMALLINT,
            inactivity_flag SMALLINT,
            group_flag SMALLINT,
            reasons TEXT,
            created_at TIMESTAMP
        )
        """
    )
    conn.commit()
    cursor.close()
    pool.putconn(conn)


def save_prediction_row(row):
    """Save a prediction record to the Postgres database"""
    conn = pool.getconn()
    cursor = conn.cursor()
    cursor.execute(
        sql.SQL(
        """
        INSERT INTO predictions
        (session_id, user_id, group_id, lat, lon, timestamp, risk_score,
         anomaly_flag, geo_flag, inactivity_flag, group_flag, reasons, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """
        ),
        (
            row.get('session_id'), row.get('user_id'), row.get('group_id'),
            row.get('lat'), row.get('lon'), row.get('timestamp'), row.get('risk_score'),
            row.get('anomaly_flag'), row.get('geo_flag'), row.get('inactivity_flag'),
            row.get('group_flag'), json.dumps(row.get('reasons')), datetime.now(timezone.utc)
        )
    )
    conn.commit()
    cursor.close()
    pool.putconn(conn)
