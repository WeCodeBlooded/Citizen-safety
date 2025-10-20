-- Women Safety: Fake Call / Escape Events
CREATE TABLE IF NOT EXISTS women_fake_events (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES women_users(id) ON DELETE CASCADE,
    event_type VARCHAR(30) NOT NULL, -- 'fake_call' | 'silent_alert'
    status VARCHAR(20) DEFAULT 'triggered', -- 'triggered' | 'cancelled' | 'completed'
    details TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_women_fake_events_user ON women_fake_events(user_id);
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
    category VARCHAR(60),
    police_station VARCHAR(160),
    reference_number VARCHAR(40) UNIQUE,
    external_ref_url TEXT,
    location JSONB,
    last_status_update TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_women_reports_user_id ON women_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_women_reports_status ON women_reports(status);
CREATE INDEX IF NOT EXISTS idx_women_reports_reference ON women_reports(reference_number);

CREATE TABLE IF NOT EXISTS women_report_updates (
    id SERIAL PRIMARY KEY,
    report_id INTEGER REFERENCES women_reports(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL,
    note TEXT,
    is_public BOOLEAN DEFAULT true,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_women_report_updates_report ON women_report_updates(report_id);
CREATE INDEX IF NOT EXISTS idx_women_report_updates_status ON women_report_updates(status);

CREATE TABLE IF NOT EXISTS women_feedback (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES women_users(id) ON DELETE CASCADE,
    area VARCHAR(255),
    rating INTEGER,
    comment TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    time_of_day VARCHAR(30),
    tags TEXT[],
    is_positive BOOLEAN,
    route_name VARCHAR(200),
    route_start JSONB,
    route_end JSONB,
    safety_level VARCHAR(30),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_women_feedback_user_id ON women_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_women_feedback_area ON women_feedback(area);
CREATE INDEX IF NOT EXISTS idx_women_feedback_route ON women_feedback(route_name);

-- Women Safety: Self defense content library (regionalized)
CREATE TABLE IF NOT EXISTS women_self_defense_guides (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    language_code VARCHAR(10) NOT NULL DEFAULT 'en',
    language_label VARCHAR(80),
    region VARCHAR(120),
    media_type VARCHAR(40) NOT NULL DEFAULT 'video',
    media_url TEXT,
    infographic_url TEXT,
    thumbnail_url TEXT,
    transcript_url TEXT,
    duration_seconds INTEGER,
    tags TEXT[],
    priority INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT women_self_defense_guides_language_title_unique UNIQUE(language_code, title)
);

CREATE INDEX IF NOT EXISTS idx_women_self_defense_language ON women_self_defense_guides(language_code);
CREATE INDEX IF NOT EXISTS idx_women_self_defense_active ON women_self_defense_guides(is_active);

-- Seed baseline guides (idempotent)
INSERT INTO women_self_defense_guides (title, description, language_code, language_label, region, media_type, media_url, infographic_url, thumbnail_url, priority, tags)
VALUES
    ('Street Awareness Basics', 'Practical tips to stay alert while navigating crowded markets or public transport hubs.', 'en', 'English', 'india', 'video', 'https://www.youtube.com/embed/X9v9Z6w4sNQ', NULL, 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=640&q=60', 1, ARRAY['awareness','travel']),
    ('Voice Break Technique', 'Learn how to project your voice and set clear verbal boundaries to deter aggressors.', 'en', 'English', 'india', 'video', 'https://www.youtube.com/embed/PdLKbTIPpls', NULL, 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=640&q=60', 2, ARRAY['de-escalation']),
    ('Pressure Point Quick Release', 'Target simple pressure points to quickly break holds and create an escape window.', 'en', 'English', 'india', 'infographic', NULL, 'https://images.unsplash.com/photo-1545239351-1141bd82e8a6?w=640&q=60', 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=640&q=60', 3, ARRAY['escape','pressure-points']),
    ('Bazaar Safety Tips', 'कैसे व्यस्त बाज़ारों और सार्वजनिक यातायात में सजग रहें और सुरक्षित निकलें।', 'hi', 'Hindi', 'delhi', 'video', 'https://www.youtube.com/embed/9_25Z8-HiZc', NULL, 'https://images.unsplash.com/photo-1521579971123-1192931a1452?w=640&q=60', 1, ARRAY['awareness','hindi']),
    ('आवाज़ से सुरक्षा', 'ज़ोर से बोलकर और स्पष्ट निर्देश देकर संभावित खतरे को रोकने की तकनीक।', 'hi', 'Hindi', 'delhi', 'infographic', NULL, 'https://images.unsplash.com/photo-1545239351-1141bd82e8a6?w=640&q=60', 'https://images.unsplash.com/photo-1524499982521-1ffd58dd89ea?w=640&q=60', 2, ARRAY['voice','hindi']),
    ('Neighbourhood Night Walk', 'Learn simple stance and flashlight techniques tailored for evening walks in coastal towns.', 'ta', 'Tamil', 'chennai', 'video', 'https://www.youtube.com/embed/Nv1u6wC9QpE', NULL, 'https://images.unsplash.com/photo-1471295253337-3ceaaedca402?w=640&q=60', 1, ARRAY['night','tamil']),
    ('Auto Stand Safety Card', 'Printable Tamil infographic with emergency words and quick self-defense cues.', 'ta', 'Tamil', 'chennai', 'infographic', NULL, 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=640&q=60', 'https://images.unsplash.com/photo-1489515217757-5fd1be406fef?w=640&q=60', 2, ARRAY['printable','infographic'])
ON CONFLICT (language_code, title) DO NOTHING;

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

-- Trusted Circle feature for all service types
CREATE TABLE IF NOT EXISTS trusted_circles (
    id SERIAL PRIMARY KEY,
    owner_passport_id VARCHAR(50) NOT NULL,
    owner_type VARCHAR(50) DEFAULT 'tourist', -- tourist | women | citizen
    circle_name VARCHAR(100) DEFAULT 'My Trusted Circle',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner_passport_id, circle_name)
);

CREATE INDEX IF NOT EXISTS idx_trusted_circles_owner ON trusted_circles(owner_passport_id);

CREATE TABLE IF NOT EXISTS trusted_circle_members (
    id SERIAL PRIMARY KEY,
    circle_id INTEGER REFERENCES trusted_circles(id) ON DELETE CASCADE,
    member_name VARCHAR(100) NOT NULL,
    member_email VARCHAR(255),
    member_phone VARCHAR(100),
    relationship VARCHAR(50),
    can_view_location BOOLEAN DEFAULT true,
    can_receive_sos BOOLEAN DEFAULT true,
    status VARCHAR(30) DEFAULT 'pending', -- pending | accepted | rejected | blocked
    invited_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    responded_at TIMESTAMPTZ,
    access_token VARCHAR(100), -- For family members to access location
    last_notified TIMESTAMPTZ,
    UNIQUE(circle_id, member_email)
);

CREATE INDEX IF NOT EXISTS idx_trusted_circle_members_circle ON trusted_circle_members(circle_id);
CREATE INDEX IF NOT EXISTS idx_trusted_circle_members_email ON trusted_circle_members(member_email);
CREATE INDEX IF NOT EXISTS idx_trusted_circle_members_token ON trusted_circle_members(access_token);

-- Trusted circle location sharing log
CREATE TABLE IF NOT EXISTS trusted_circle_shares (
    id SERIAL PRIMARY KEY,
    circle_id INTEGER REFERENCES trusted_circles(id) ON DELETE CASCADE,
    member_id INTEGER REFERENCES trusted_circle_members(id) ON DELETE CASCADE,
    shared_latitude DOUBLE PRECISION,
    shared_longitude DOUBLE PRECISION,
    share_type VARCHAR(30) DEFAULT 'location', -- location | sos | alert
    shared_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trusted_circle_shares_circle ON trusted_circle_shares(circle_id);
CREATE INDEX IF NOT EXISTS idx_trusted_circle_shares_member ON trusted_circle_shares(member_id);
CREATE INDEX IF NOT EXISTS idx_trusted_circle_shares_at ON trusted_circle_shares(shared_at DESC);

-- Hardware Panic Trigger feature
-- Tracks panic alerts triggered via hardware buttons (volume/power)
CREATE TABLE IF NOT EXISTS hardware_panic_triggers (
    id SERIAL PRIMARY KEY,
    passport_id VARCHAR(50),
    user_id INTEGER, -- For women_users
    user_type VARCHAR(30) DEFAULT 'tourist', -- tourist | women | citizen
    trigger_type VARCHAR(50) NOT NULL, -- volume_up | volume_down | power_button | pattern_combo
    trigger_pattern VARCHAR(100), -- e.g., 'volume_up_3x' or 'power_5x_rapid'
    trigger_count INTEGER DEFAULT 1, -- How many times button was pressed
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    accuracy DOUBLE PRECISION,
    device_info JSONB, -- Browser/device details
    alert_sent BOOLEAN DEFAULT false,
    alert_id VARCHAR(100), -- Reference to generated panic alert
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_women_user FOREIGN KEY (user_id) REFERENCES women_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_hardware_panic_passport ON hardware_panic_triggers(passport_id);
CREATE INDEX IF NOT EXISTS idx_hardware_panic_user ON hardware_panic_triggers(user_id);
CREATE INDEX IF NOT EXISTS idx_hardware_panic_created ON hardware_panic_triggers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hardware_panic_alert_sent ON hardware_panic_triggers(alert_sent);

-- Alert History: Track all types of alerts including hardware-triggered
CREATE TABLE IF NOT EXISTS alert_history (
    id SERIAL PRIMARY KEY,
    passport_id VARCHAR(50),
    user_id INTEGER,
    user_type VARCHAR(30) DEFAULT 'tourist',
    event_type VARCHAR(50) NOT NULL, -- panic | hardware_panic | sos | geofence | anomaly
    trigger_source VARCHAR(50), -- ui_button | hardware_volume | hardware_power | auto_detect
    details JSONB,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alert_history_passport ON alert_history(passport_id);
CREATE INDEX IF NOT EXISTS idx_alert_history_user ON alert_history(user_id);
CREATE INDEX IF NOT EXISTS idx_alert_history_type ON alert_history(event_type);
CREATE INDEX IF NOT EXISTS idx_alert_history_created ON alert_history(created_at DESC);

-- Hardware Panic Settings: User preferences for hardware triggers
CREATE TABLE IF NOT EXISTS hardware_panic_settings (
    id SERIAL PRIMARY KEY,
    passport_id VARCHAR(50),
    user_id INTEGER,
    user_type VARCHAR(30) DEFAULT 'tourist',
    enabled BOOLEAN DEFAULT true,
    trigger_method VARCHAR(50) DEFAULT 'volume_up_3x', -- volume_up_3x | volume_down_3x | power_5x | custom
    custom_pattern VARCHAR(100), -- For custom button patterns
    sensitivity VARCHAR(20) DEFAULT 'medium', -- low | medium | high
    confirmation_required BOOLEAN DEFAULT false, -- Show confirmation dialog before sending
    auto_record_audio BOOLEAN DEFAULT true,
    auto_share_location BOOLEAN DEFAULT true,
    vibration_feedback BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_settings UNIQUE (passport_id, user_id),
    CONSTRAINT fk_women_user_settings FOREIGN KEY (user_id) REFERENCES women_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_hardware_settings_passport ON hardware_panic_settings(passport_id);
CREATE INDEX IF NOT EXISTS idx_hardware_settings_user ON hardware_panic_settings(user_id);

\echo '✅ Database schema created successfully!'