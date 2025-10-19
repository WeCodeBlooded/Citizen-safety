-- ============================================
-- Women Safety Module - Database Migration
-- Quick Reference SQL Commands
-- ============================================

-- STEP 1: BACKUP (Optional but recommended)
CREATE TABLE women_sos_backup AS SELECT * FROM women_sos;
CREATE TABLE women_location_backup AS SELECT * FROM women_location;
CREATE TABLE women_contacts_backup AS SELECT * FROM women_contacts;
CREATE TABLE women_reports_backup AS SELECT * FROM women_reports;
CREATE TABLE women_feedback_backup AS SELECT * FROM women_feedback;

-- STEP 2: DROP OLD TABLES
DROP TABLE IF EXISTS women_feedback CASCADE;
DROP TABLE IF EXISTS women_reports CASCADE;
DROP TABLE IF EXISTS women_contacts CASCADE;
DROP TABLE IF EXISTS women_location CASCADE;
DROP TABLE IF EXISTS women_sos CASCADE;

-- STEP 3: CREATE NEW WOMEN USERS TABLE
CREATE TABLE women_users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    mobile_number VARCHAR(20) UNIQUE NOT NULL,
    aadhaar_number VARCHAR(20) UNIQUE,
    email VARCHAR(255),
    profile_picture_url VARCHAR(255),
    is_verified BOOLEAN DEFAULT false,
    otp_code VARCHAR(10),
    otp_expires_at TIMESTAMPTZ,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    last_seen TIMESTAMPTZ,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_women_users_mobile ON women_users(mobile_number);
CREATE INDEX idx_women_users_aadhaar ON women_users(aadhaar_number);

-- STEP 4: CREATE EMERGENCY CONTACTS TABLE
CREATE TABLE women_emergency_contacts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES women_users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    mobile_number VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    relationship VARCHAR(50),
    priority INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_women_emergency_contacts_user ON women_emergency_contacts(user_id);

-- STEP 5: CREATE WOMEN MODULE TABLES
CREATE TABLE women_sos (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES women_users(id) ON DELETE CASCADE,
    location VARCHAR(255),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    accuracy DOUBLE PRECISION,
    source VARCHAR(30),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_women_sos_user_id ON women_sos(user_id);
CREATE INDEX idx_women_sos_created_at ON women_sos(created_at DESC);

CREATE TABLE women_location (
    user_id INTEGER PRIMARY KEY REFERENCES women_users(id) ON DELETE CASCADE,
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE women_contacts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES women_users(id) ON DELETE CASCADE,
    name VARCHAR(100),
    number VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE women_reports (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES women_users(id) ON DELETE CASCADE,
    description TEXT,
    anonymous BOOLEAN DEFAULT false,
    status VARCHAR(30) DEFAULT 'submitted',
    location JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_women_reports_user_id ON women_reports(user_id);
CREATE INDEX idx_women_reports_status ON women_reports(status);

CREATE TABLE women_feedback (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES women_users(id) ON DELETE CASCADE,
    area VARCHAR(255),
    rating INTEGER,
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_women_feedback_user_id ON women_feedback(user_id);

CREATE TABLE women_location_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES women_users(id) ON DELETE CASCADE,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    accuracy DOUBLE PRECISION,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_women_location_history_user_id ON women_location_history(user_id);
CREATE INDEX idx_women_location_history_created_at ON women_location_history(created_at DESC);

-- STEP 6: VERIFY MIGRATION
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name LIKE 'women_%'
ORDER BY table_name;

-- STEP 7: TEST DATA (OPTIONAL)
-- INSERT INTO women_users (name, mobile_number, is_verified)
-- VALUES ('Test User', '+919876543210', true);

-- SELECT * FROM women_users WHERE mobile_number = '+919876543210';
