CREATE EXTENSION IF NOT EXISTS pgcrypto;


DROP TABLE IF EXISTS location_history CASCADE;
DROP TABLE IF EXISTS group_members CASCADE;
DROP TABLE IF EXISTS recordings CASCADE;
DROP TABLE IF EXISTS groups CASCADE;
DROP TABLE IF EXISTS tourists CASCADE;


CREATE OR REPLACE FUNCTION set_tourist_last_seen()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE tourists SET last_seen = now() WHERE id = NEW.tourist_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE TABLE tourists (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    passport_id VARCHAR(50) UNIQUE NOT NULL, -- Stores Passport ID or Aadhaar number depending on id_type
    id_type VARCHAR(20) DEFAULT 'passport', -- passport | aadhaar (others can extend)
    emergency_contact VARCHAR(100),
    status VARCHAR(20) DEFAULT 'active',
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMPTZ,
    group_name VARCHAR(255) DEFAULT 'default_group',
    email VARCHAR(255) UNIQUE,
    is_verified BOOLEAN DEFAULT false,
    verification_code VARCHAR(10),
    otp_code VARCHAR(10),
    profile_picture_url VARCHAR(255),
    blockchain_id VARCHAR(255),    
    country VARCHAR(100),
    visa_id VARCHAR(100),
    visa_expiry VARCHAR(50),
    emergency_contact_1 VARCHAR(100),
    emergency_contact_email_1 VARCHAR(255), 
    emergency_contact_2 VARCHAR(100),
    emergency_contact_email_2 VARCHAR(255), 
    passport_image_url VARCHAR(255),
    passport_image_secondary_url VARCHAR(255),
    visa_image_url VARCHAR(255),
    profile_complete BOOLEAN DEFAULT false,
    service_type VARCHAR(50) DEFAULT 'general_safety' -- women_safety | tourist_safety | citizen_safety | general_safety
);


CREATE TABLE groups (
    id SERIAL PRIMARY KEY,
    group_id UUID DEFAULT gen_random_uuid() NOT NULL,
    group_name VARCHAR(100) NOT NULL,
    created_by_tourist_id INTEGER REFERENCES tourists(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE group_members (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    tourist_id INTEGER NOT NULL REFERENCES tourists(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'accepted',
    UNIQUE(group_id, tourist_id)
);


CREATE TABLE location_history (
    id SERIAL PRIMARY KEY,
    tourist_id INTEGER REFERENCES tourists(id) ON DELETE CASCADE,
    passport_id VARCHAR(50) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);


CREATE TRIGGER update_tourist_last_seen
AFTER INSERT ON location_history
FOR EACH ROW
EXECUTE FUNCTION set_tourist_last_seen();


CREATE TABLE recordings (
    id SERIAL PRIMARY KEY,
    passport_id VARCHAR(50) NOT NULL,
    url VARCHAR(255) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);


CREATE INDEX idx_tourists_passport_id ON tourists(passport_id);
CREATE INDEX idx_location_history_passport_id ON location_history(passport_id);
CREATE INDEX idx_location_history_created_at ON location_history(created_at DESC);
CREATE INDEX idx_group_members_tourist_id ON group_members(tourist_id);


INSERT INTO groups (group_name) VALUES ('default') ON CONFLICT DO NOTHING;



CREATE TABLE IF NOT EXISTS family_otps (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    passport_id VARCHAR(50) NOT NULL,
    tourist_name VARCHAR(100),
    otp_code VARCHAR(10) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_family_otps_email ON family_otps(email);
CREATE INDEX IF NOT EXISTS idx_family_otps_expires_at ON family_otps(expires_at);


-- Citizen Safety: Incidents reporting (modular categories)
CREATE TABLE IF NOT EXISTS incidents (
    id SERIAL PRIMARY KEY,
    category VARCHAR(50) NOT NULL, -- women_safety | street_animal | tourist_safety | other
    sub_type VARCHAR(100),
    description TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    reporter_type VARCHAR(20) DEFAULT 'citizen', -- citizen | tourist | anon
    reporter_name VARCHAR(100),
    reporter_contact VARCHAR(100),
    passport_id VARCHAR(50), -- optional if tourist
    media_urls TEXT, -- JSON string array
    status VARCHAR(30) DEFAULT 'new', -- new | forwarded | in_progress | resolved | dismissed
    assigned_agency VARCHAR(120),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incidents_category ON incidents(category);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents(created_at DESC);

-- Track incident forward history (which services we notified)
CREATE TABLE IF NOT EXISTS incident_forwards (
    id SERIAL PRIMARY KEY,
    incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    services JSONB,
    forwarded_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_incident_forwards_incident ON incident_forwards(incident_id);

-- Women Safety Module: Independent user system with Aadhaar/Mobile authentication
CREATE TABLE IF NOT EXISTS women_users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    mobile_number VARCHAR(20) UNIQUE NOT NULL,
    aadhaar_number VARCHAR(20) UNIQUE,
    email VARCHAR(255) UNIQUE NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_women_users_email ON women_users(email);
CREATE INDEX IF NOT EXISTS idx_women_users_mobile ON women_users(mobile_number);
CREATE INDEX IF NOT EXISTS idx_women_users_aadhaar ON women_users(aadhaar_number);

-- Women Emergency Contacts
CREATE TABLE IF NOT EXISTS women_emergency_contacts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES women_users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    mobile_number VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    relationship VARCHAR(50),
    priority INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_women_emergency_contacts_user ON women_emergency_contacts(user_id);

-- Women Safety: SOS, Location, Contacts, Reports, Feedback
CREATE TABLE IF NOT EXISTS women_sos (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES women_users(id) ON DELETE CASCADE,
    location VARCHAR(255),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    accuracy DOUBLE PRECISION,
    source VARCHAR(30),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_women_sos_user_id ON women_sos(user_id);
CREATE INDEX IF NOT EXISTS idx_women_sos_created_at ON women_sos(created_at DESC);

CREATE TABLE IF NOT EXISTS women_location (
    user_id INTEGER PRIMARY KEY REFERENCES women_users(id) ON DELETE CASCADE,
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS women_contacts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES women_users(id) ON DELETE CASCADE,
    name VARCHAR(100),
    number VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS women_reports (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES women_users(id) ON DELETE CASCADE,
    description TEXT,
    anonymous BOOLEAN DEFAULT false,
    status VARCHAR(30) DEFAULT 'submitted',
    location JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_women_reports_user_id ON women_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_women_reports_status ON women_reports(status);

CREATE TABLE IF NOT EXISTS women_feedback (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES women_users(id) ON DELETE CASCADE,
    area VARCHAR(255),
    rating INTEGER,
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_women_reports_user_id ON women_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_women_reports_status ON women_reports(status);

CREATE TABLE IF NOT EXISTS women_feedback (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES women_users(id) ON DELETE CASCADE,
    area VARCHAR(255),
    rating INTEGER,
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_women_feedback_user_id ON women_feedback(user_id);

-- Women Location History
CREATE TABLE IF NOT EXISTS women_location_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES women_users(id) ON DELETE CASCADE,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    accuracy DOUBLE PRECISION,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_women_location_history_user_id ON women_location_history(user_id);
CREATE INDEX IF NOT EXISTS idx_women_location_history_created_at ON women_location_history(created_at DESC);

\echo '✅ Database schema created successfully!'