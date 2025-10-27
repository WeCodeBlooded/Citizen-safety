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
    passport_hash CHAR(66),
    blockchain_tx_hash VARCHAR(255),
    blockchain_status VARCHAR(30) DEFAULT 'pending',
    blockchain_registered_at TIMESTAMPTZ,
    blockchain_metadata_uri TEXT,
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
    service_type VARCHAR(50) DEFAULT 'general_safety', -- women_safety | tourist_safety | citizen_safety | general_safety
    CONSTRAINT tourists_passport_hash_unique UNIQUE (passport_hash)
);


CREATE TABLE groups (
    id SERIAL PRIMARY KEY,
    group_id UUID DEFAULT gen_random_uuid() NOT NULL,
    group_name VARCHAR(100) NOT NULL,
    created_by_tourist_id INTEGER REFERENCES tourists(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    blockchain_group_id VARCHAR(255),
    blockchain_tx_hash VARCHAR(255),
    blockchain_status VARCHAR(30) DEFAULT 'pending',
    blockchain_created_at TIMESTAMPTZ
);


CREATE TABLE group_members (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    tourist_id INTEGER NOT NULL REFERENCES tourists(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'accepted',
    UNIQUE(group_id, tourist_id)
);


CREATE TABLE IF NOT EXISTS blockchain_transactions (
    id SERIAL PRIMARY KEY,
    passport_hash CHAR(66),
    entity_type VARCHAR(40) NOT NULL,
    action VARCHAR(40) NOT NULL,
    tx_hash VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'submitted',
    block_number BIGINT,
    payload JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_blockchain_transactions_tourist FOREIGN KEY (passport_hash)
        REFERENCES tourists(passport_hash)
        ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX IF NOT EXISTS idx_blockchain_transactions_passport ON blockchain_transactions(passport_hash);
CREATE INDEX IF NOT EXISTS idx_blockchain_transactions_action ON blockchain_transactions(action);


CREATE TABLE IF NOT EXISTS blockchain_alerts (
    alert_id BIGINT PRIMARY KEY,
    passport_hash CHAR(66) NOT NULL,
    location TEXT,
    severity INTEGER,
    tx_hash VARCHAR(255),
    block_number BIGINT,
    occurred_at TIMESTAMPTZ,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_blockchain_alerts_tourist FOREIGN KEY (passport_hash)
        REFERENCES tourists(passport_hash)
        ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX IF NOT EXISTS idx_blockchain_alerts_passport ON blockchain_alerts(passport_hash);


CREATE TABLE IF NOT EXISTS blockchain_emergencies (
    log_id BIGINT PRIMARY KEY,
    passport_hash CHAR(66) NOT NULL,
    evidence_hash TEXT,
    location TEXT,
    tx_hash VARCHAR(255),
    block_number BIGINT,
    occurred_at TIMESTAMPTZ,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_blockchain_emergencies_tourist FOREIGN KEY (passport_hash)
        REFERENCES tourists(passport_hash)
        ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX IF NOT EXISTS idx_blockchain_emergencies_passport ON blockchain_emergencies(passport_hash);


CREATE TABLE IF NOT EXISTS blockchain_audit_log (
    audit_id BIGINT PRIMARY KEY,
    actor VARCHAR(66),
    action VARCHAR(100),
    subject_hash CHAR(66),
    details TEXT,
    tx_hash VARCHAR(255),
    block_number BIGINT,
    occurred_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_blockchain_audit_action ON blockchain_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_blockchain_audit_subject ON blockchain_audit_log(subject_hash);


CREATE TABLE IF NOT EXISTS blockchain_event_cursors (
    id SERIAL PRIMARY KEY,
    event_name VARCHAR(120) UNIQUE NOT NULL,
    last_block BIGINT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS tourist_helplines (
        id SERIAL PRIMARY KEY,
        region VARCHAR(120) NOT NULL,
        service_name VARCHAR(200) NOT NULL,
        phone_number VARCHAR(40) NOT NULL,
        availability VARCHAR(120) DEFAULT '24x7',
        languages TEXT[] DEFAULT '{}',
        description TEXT,
        priority INTEGER DEFAULT 100,
        UNIQUE(region, service_name, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_tourist_helplines_region ON tourist_helplines(region);
CREATE INDEX IF NOT EXISTS idx_tourist_helplines_priority ON tourist_helplines(priority);

INSERT INTO tourist_helplines (region, service_name, phone_number, availability, languages, description, priority) VALUES
    ('National', 'Incredible India Tourist Helpline (Ministry of Tourism)', '1800-11-1363 / 1363', '24x7', ARRAY['English','Hindi','Tamil','Telugu','Bengali','Kannada','Marathi'], 'Central multilingual helpline for tourists across India offering emergency guidance and travel assistance.', 1),
    ('National', 'Emergency Response Support System (ERSS)', '112', '24x7', ARRAY['English','Hindi'], 'Single emergency number that connects to police, fire, and medical services pan-India.', 2),
    ('National', 'Women & Child Helpline', '1091 / 181', '24x7', ARRAY['English','Hindi'], 'Dedicated helpline for women and child safety with rapid police escalation.', 3),
    ('Delhi', 'Delhi Tourist Police', '+91-8750871111', '24x7', ARRAY['English','Hindi'], 'Tourist police assistance within Delhi NCR including airport zone and heritage sites.', 10),
    ('Maharashtra', 'Maharashtra Tourism Helpline', '1800-229-933', '06:00 - 22:00 IST', ARRAY['English','Hindi','Marathi'], 'Support for tourists in Mumbai, Pune, and major Maharashtra destinations.', 12),
    ('Tamil Nadu', 'Tamil Nadu Tourism Helpline', '044-2533-2770', '24x7', ARRAY['English','Tamil'], 'Tourist assistance for Chennai, Madurai, Rameswaram, and other Tamil Nadu circuits.', 15),
    ('Karnataka', 'Karnataka Tourism Helpline', '1800-425-2577', '07:00 - 19:00 IST', ARRAY['English','Kannada','Hindi'], 'Guidance for Bengaluru, Mysuru, coastal Karnataka, and heritage trails.', 16),
    ('Kerala', 'Kerala Tourism Helpline', '1800-425-4747', '24x7', ARRAY['English','Malayalam','Hindi'], 'Round-the-clock support covering backwaters, hill stations, and coastal Kerala.', 18),
    ('Goa', 'Goa Tourism Safety Patrol', '+91-9623798080', '24x7', ARRAY['English','Konkani','Hindi'], 'Dedicated safety patrol hotline for beaches, nightlife zones, and tourist belts in Goa.', 20),
    ('Rajasthan', 'Rajasthan Tourism Helpline', '1800-180-6127', '08:00 - 22:00 IST', ARRAY['English','Hindi'], 'Assistance for Jaipur, Udaipur, Jodhpur, Jaisalmer, and desert circuits.', 22)
ON CONFLICT (region, service_name, phone_number) DO NOTHING;


CREATE TABLE IF NOT EXISTS tourist_support_faqs (
        id SERIAL PRIMARY KEY,
        keywords TEXT[] NOT NULL DEFAULT '{}',
        response_en TEXT NOT NULL,
        response_hi TEXT,
        response_bn TEXT,
        response_ta TEXT,
        response_te TEXT,
        response_mr TEXT,
        response_kn TEXT
);

CREATE INDEX IF NOT EXISTS idx_tourist_support_faqs_keywords ON tourist_support_faqs USING GIN (keywords);

INSERT INTO tourist_support_faqs (keywords, response_en, response_hi, response_bn, response_ta, response_te, response_mr, response_kn) VALUES
    (ARRAY['lost passport','passport lost','missing passport','documents lost'],
     'If your passport is lost, file an FIR at the nearest police station, contact your embassy or consulate, call the Ministry of Tourism helpline 1800-11-1363 for guidance, and keep digital copies of your identification documents handy.',
     'यदि आपका पासपोर्ट खो गया है तो नज़दीकी पुलिस थाने में एफआईआर दर्ज करें, अपने दूतावास या वाणिज्य दूतावास से संपर्क करें, मार्गदर्शन के लिए पर्यटन मंत्रालय हेल्पलाइन 1800-11-1363 पर कॉल करें और अपने पहचान दस्तावेज़ों की डिजिटल प्रतियां साथ रखें।',
     'পাসপোর্ট হারালে নিকটস্থ থানায় এফআইআর করুন, আপনার দূতাবাস বা কনস্যুলেটের সঙ্গে যোগাযোগ করুন, পরামর্শের জন্য পর্যটন মন্ত্রণালয়ের হেল্পলাইন ১৮০০-১১-১৩৬৩ নম্বরে ফোন করুন এবং পরিচয়পত্রের ডিজিটাল কপি সঙ্গে রাখুন।',
     'பாஸ்போர்ட் இழந்தால் அருகிலுள்ள காவல் நிலையத்தில் FIR பதிவு செய்யவும், உங்கள் தூதரகம் அல்லது துணைத்தூதரகத்தை தொடர்புகொள்ளவும், வழிகாட்டுதலுக்காக τουரிசம் அமைச்சின் 1800-11-1363 உதவி எண்ணை அழைக்கவும், அடையாள ஆவணங்களின் டிஜிட்டல் நகல்களை வைத்திருங்கள்.',
     'మీ పాస్‌పోర్ట్ పోతే సమీప పోలీస్ స్టేషన్లో FIR నమోదు చేయండి, మీ రాయబారి కార్యాలయం లేదా కాన్సులేట్‌ను సంప్రదించండి, మార్గదర్శకానికి పర్యాటక మంత్రిత్వ శాఖ హెల్ప్‌లైన్ 1800-11-1363 కి కాల్ చేయండి మరియు మీ గుర్తింపు పత్రాల డిజిటల్ ప్రతులను దగ్గర ఉంచుకోండి.',
     'पासपोर्ट हरवला असल्यास जवळच्या पोलीस ठाण्यात FIR दाखल करा, आपल्या दूतावास किंवा वाणिज्य दूतावासाशी संपर्क साधा, मार्गदर्शनासाठी पर्यटन मंत्रालय हेल्पलाइन 1800-11-1363 वर कॉल करा आणि ओळखपत्रांच्या डिजिटल प्रत्या सोबत ठेवा.',
     'ನಿಮ್ಮ ಪಾಸ್‌ಪೋರ್ಟ್ ಕಳೆದುಹೋದರೆ ಸಮೀಪದ ಪೊಲೀಸ್ ಠಾಣೆಯಲ್ಲಿ FIR ದಾಖಲು ಮಾಡಿ, ನಿಮ್ಮ ರಾಯಭಾರಿ ಕಚೇರಿ ಅಥವಾ ಕಾನ್ಸುಲೇಟ್ ಅನ್ನು ಸಂಪರ್ಕಿಸಿ, ಮಾರ್ಗದರ್ಶನಕ್ಕಾಗಿ ಪ್ರವಾಸೋದ್ಯಮ ಸಚಿವಾಲಯದ 1800-11-1363 ಸಹಾಯವಾಣಿ ಸಂಖ್ಯೆಗೆ ಕರೆ ಮಾಡಿ ಮತ್ತು ಗುರುತುಪತ್ರಗಳ ಡಿಜಿಟಲ್ ಪ್ರತಿಗಳನ್ನು ಹೊಂದಿಡಿ.'),
    (ARRAY['medical emergency','need doctor','injury','medical help'],
     'For medical emergencies dial 112 for immediate assistance, share your live location if possible, and request ambulance support. Government and private hospitals in major cities have dedicated tourist desks.',
     'चिकित्सा आपात स्थिति में त्वरित सहायता के लिए 112 पर कॉल करें, संभव हो तो अपना लाइव लोकेशन साझा करें और एम्बुलेंस सहायता का अनुरोध करें। बड़े शहरों के सरकारी और निजी अस्पतालों में पर्यटकों के लिए समर्पित डेस्क उपलब्ध हैं।',
     'জরুরি চিকিৎসার জন্য অবিলম্বে ১১২ নম্বরে ফোন করুন, সম্ভব হলে আপনার লাইভ লোকেশন শেয়ার করুন এবং অ্যাম্বুলেন্স সহায়তা চান। বড় শহরের সরকারি ও বেসরকারি হাসপাতালগুলোতে পর্যটকদের জন্য বিশেষ ডেস্ক রয়েছে।',
     'மருத்துவ அவசர நிலையிலேயே உடனடி உதவிக்கு 112 ஐ அழைக்கவும், முடிந்தால் உங்கள் நேரடி இருப்பிடத்தை பகிரவும் மற்றும் ஆம்புலன்ஸ் உதவியை கோரவும். பெருநகர மருத்துவமனைகளில்τουரிஸ்ட் சேவை மையங்கள் உள்ளன.',
     'వైద్య అత్యవసర పరిస్థితుల్లో వెంటనే సహాయానికి 112 కి కాల్ చేయండి, సాధ్యమైతే మీ ప్రత్యక్ష స్థానాన్ని షేర్ చేయండి మరియు అంబులెన్స్ కోసం అభ్యర్థించండి. ప్రధాన నగరాల్లో ప్రభుత్వం మరియు ప్రైవేట్ ఆసుపత్రుల్లో పర్యాటక డెస్కులు అందుబాటులో ఉన్నాయి.',
     'वैद्यकीय आपत्कालीन स्थितीत त्वरित मदतीसाठी 112 वर कॉल करा, शक्य असल्यास आपले थेट लोकेशन शेअर करा आणि रुग्णवाहिकेची मदत मागवा. मोठ्या शहरांतील सरकारी व खाजगी रुग्णालयांत पर्यटकांसाठी स्वतंत्र डेस्क आहेत.',
     'ವೈದ್ಯಕೀಯ ತುರ್ತು ಪರಿಸ್ಥಿತಿಗೆ ತಕ್ಷಣದ ಸಹಾಯಕ್ಕಾಗಿ 112 ಗೆ ಕರೆ ಮಾಡಿ, ಸಾಧ್ಯವಾದರೆ ನಿಮ್ಮ ಲೈವ್ ಲೊಕೇಶನ್ ಹಂಚಿಕೊಳ್ಳಿ ಮತ್ತು ಆಂಬುಲೆನ್ಸ್ ನೆರವು ಬೇಡಿ. ಪ್ರಮುಖ ನಗರಗಳ ಸರಕಾರಿ ಮತ್ತು ಖಾಸಗಿ ಆಸ್ಪತ್ರೆಗಳಲ್ಲಿ ಪ್ರವಾಸಿಗರಿಗಾಗಿ ವಿಶೇಷ ಡೆಸ್ಕ್‌ಗಳು ಇವೆ.'),
    (ARRAY['safety tip','unsafe area','feel unsafe','safety advice'],
     'Move to a well-lit public space, alert nearby authorities or security staff, and share your real-time location with trusted contacts through the app. You can also call the tourist police helpline listed for your region.',
     'कृपया रोशनी वाले सार्वजनिक स्थान पर जाएँ, नज़दीकी अधिकारियों या सुरक्षा कर्मियों को सूचित करें और ऐप के माध्यम से अपने विश्वसनीय संपर्कों के साथ वास्तविक समय लोकेशन साझा करें। अपने क्षेत्र की सूची में उपलब्ध टूरिस्ट पुलिस हेल्पलाइन पर भी कॉल कर सकते हैं।',
     'উজ্জ্বল আলোযুক্ত জনসমক্ষে চলে যান, আশেপাশের কর্তৃপক্ষ বা সুরক্ষা কর্মীদের জানান এবং অ্যাপের মাধ্যমে বিশ্বাসযোগ্য পরিচিতদের সঙ্গে আপনার রিয়েল-টাইম লোকেশন শেয়ার করুন। আপনার অঞ্চলের তালিকাভুক্ত পর্যটন পুলিশ হেল্পলাইনে ফোন করতে পারেন।',
     'ஒளியுடன் கூடிய பொதுப் பகுதிக்குச் செல்லவும், அருகிலுள்ள அதிகாரிகள் அல்லது பாதுகாப்பு பணியாளர்களுக்கு தகவல்伝டிக்கவும் மற்றும் பயன்பாட்டின் மூலம் நம்பகமான தொடர்புகளுடன் உங்கள் நேரடி இருப்பிடத்தை பகிரவும். உங்கள் பிராந்தியத்திற்கானτουரிஸ்ட் போலீஸ் உதவி எண்ணிற்கு அழைக்கவும்.',
     'బాగా వెలుతురు ఉన్న ప్రజా ప్రదేశానికి వెళ్లండి, సమీపంలోని అధికారులు లేదా భద్రతా సిబ్బందికి సమాచಾರమివ్వండి మరియు యాప్ ద్వారా విశ్వసనీయ పరిచయాలతో మీ ప్రత్యక్ష స్థానం పంచుకోండి. మీ ప్రాంతానికి సూచించిన పర్యాటక పోలీస్ హెల్ప్‌లైన్ కి కూడా కాల్ చేయండి.',
     'प्रकाशमान सार्वजनिक ठिकाणी जा, जवळच्या अधिकाऱ्यांना किंवा सुरक्षा कर्मचाऱ्यांना कळवा आणि अॅपद्वारे विश्वासू संपर्कांशी आपले प्रत्यक्ष स्थान शेअर करा. आपल्या प्रदेशासाठी सांगितलेल्या टूरिस्ट पोलिस हेल्पलाइनवरही कॉल करा.',
     'ಬೆಳಕುಳ್ಳ ಸಾರ್ವಜನಿಕ ಸ್ಥಳಕ್ಕೆ ಹೋಗಿ, ಸಮೀಪದ ಅಧಿಕಾರಿಗಳು ಅಥವಾ ಭದ್ರತೆಯವರಿಗೆ ತಿಳಿಸಿ ಮತ್ತು ಅಪ್ಲಿಕೇಷನ್ ಮೂಲಕ ವಿಶ್ವಾಸಾರ್ಹ ಸಂಪರ್ಕಗಳಿಗೆ ನಿಮ್ಮ ಲೈವ್ ಸ್ಥಾನವನ್ನು ಹಂಚಿಕೊಳ್ಳಿ. ನಿಮ್ಮ ಪ್ರದೇಶಕ್ಕೆ ಸೂಚಿಸಲಾದ ಪ್ರವಾಸಿ ಪೊಲೀಸ್ ಸಹಾಯವಾಣಿಗೆ ಕರೆ ಮಾಡಬಹುದು.'),
    (ARRAY['language help','translation','speak language','interpreter'],
     'Use the language switcher to receive guidance in your preferred language, show prepared travel cards with translated phrases, and call 1800-11-1363 for interpreter support if officials request clarification.',
     'अपनी पसंदीदा भाषा में मार्गदर्शन पाने के लिए भाषा स्विचर का उपयोग करें, अनुवादित वाक्यों वाले तैयार यात्रा कार्ड दिखाएँ और यदि अधिकारियों को स्पष्टीकरण चाहिए तो 1800-11-1363 पर कॉल करके दुभाषिया सहायता माँगें।',
     'আপনার পছন্দের ভাষায় নির্দেশনা পেতে ভাষা সুইচার ব্যবহার করুন, অনূদিত বাক্যসহ প্রস্তুত ভ্রমণ কার্ড দেখান এবং কর্মকর্তারা ব্যাখ্যা চাইলে ১৮০০-১১-১৩৬৩ নম্বরে ফোন করে দোভাষী সহায়তা নিন।',
     'உங்கள் விருப்பமான மொழியில் வழிகாட்டுதலை பெற மொழி மாற்றியை பயன்படுத்தவும், மொழிபெயர்க்கப்பட்ட சொற்றொடர்களுடன் பயண அட்டைகளை காட்டவும், அதிகாரிகள் தெளிவுபடுத்துமாறு கேட்டால் 1800-11-1363 என்ற எண்ணில் அழைத்து மொழிபெயர்ப்பாளர் உதவಿಯನ್ನುப் பெறவும்.',
     'మీ ఇష్టమైన భాషలో మార్గదర్శకత్వం పొందడానికి భాష స్విచర్‌ను ఉపయోగించండి, అనువదించిన వాక్యాలతో సిద్ధం చేసిన ప్రయాణ కార్డులను చూపండి మరియు అధికారులు వివరణ కోరితే 1800-11-1363 కి కాల్ చేసి అనువాదక సహాయాన్ని అడగండి.',
     'आपल्या पसंतीच्या भाषेत मार्गदर्शन मिळवण्यासाठी भाषा स्विचर वापरा, अनुवादित वाक्यांसह तयार ट्रॅव्हल कार्ड दाखवा आणि अधिकाऱ्यांनी स्पष्टता विचारल्यास 1800-11-1363 वर कॉल करून दुभाषी मदत घ्या.',
     'ನಿಮ್ಮ ಇಷ್ಟದ ಭಾಷೆಯಲ್ಲಿ ಮಾರ್ಗದರ್ಶನ ಪಡೆಯಲು ಭಾಷಾ ಸ್ವಿಚರ್ ಅನ್ನು ಬಳಸಿ, ಅನುವಾದಿತ ಪದಬಂಧಗಳಿರುವ ಪ್ರಯಾಣ ಕಾರ್ಡ್‌ಗಳನ್ನು ತೋರಿಸಿ ಮತ್ತು ಅಧಿಕಾರಿಗಳು ವಿವರಣೆ ಕೇಳಿದರೆ 1800-11-1363 ಗೆ ಕರೆ ಮಾಡಿ ಅನುವಾದಕರ ನೆರವನ್ನು ಪಡೆಯಿರಿ.'),
    (ARRAY['money exchange','currency','payment issue','card blocked'],
     'Use authorised currency exchange counters inside airports, RBI-approved forex outlets, or ATMs inside nationalised banks. For blocked cards contact your bank using the international helpline and keep emergency cash separated in small denominations.',
     'मुद्रा विनिमय के लिए हवाई अड्डों के अधिकृत काउंटर, आरबीआई अनुमोदित फॉरेक्स आउटलेट या राष्ट्रीयकृत बैंकों के एटीएम का उपयोग करें। कार्ड ब्लॉक होने पर अंतरराष्ट्रीय हेल्पलाइन पर अपने बैंक से संपर्क करें और आपातकाल के लिए छोटे मूल्य के नकद पैसे अलग रखें।',
     'মুদ্রা পরিবর্তনের জন্য বিমানবন্দরের অনুমোদিত কাউন্টার, আরবিআই অনুমোদিত ফরেক্স আউটলেট বা জাতীয়করণকৃত ব্যাংকের এটিএম ব্যবহার করুন। কার্ড ব্লক হলে আন্তর্জাতিক হেল্পলাইনের মাধ্যমে আপনার ব্যাংকের সঙ্গে যোগাযোগ করুন এবং জরুরি পরিস্থিতির জন্য ছোট অঙ্কের নগদ আলাদা করে রাখুন।',
     'நாணய மாற்றத்திற்காக விமான நிலைய அங்கீகரிக்கப்பட்ட கவுண்டர்கள், भारतीय ரிசர்வ் வங்கியால் அங்கீகரிக்கப்பட்ட ஃபாரெக்ஸ் மையங்கள் அல்லது தேசிய வங்கிகளின் ATM களை பயன்படுத்தவும். அட்டை முடக்கப்பட்டால் சர்வதேச உதவி எண்ணின் மூலம் உங்கள் வங்கியை தொடர்புகொள்ளவும் மற்றும் அவசரநிலைக்காக சிறு நோட்டுகளாக பணத்தை தனியே வைத்திருங்கள்.',
     'కరెన్సీ మార్పిడికి విమానాశ్రయంలోని అధికారిక కౌంటర్లు, RBI అనుమతించిన ఫారెక్స్ ఔట్‌లెట్లు లేదా జాతీయ బ్యాంకుల ATMలను ఉపయోగించండి. కార్డ్ బ్లాక్ అయితే అంతర్జాతీయ హెల్ప్‌లైన్ ద్వారా మీ బ్యాంక్‌ను సంప్రదించండి మరియు అత్యవసర పరిస్థితులకు చిన్న నామములలో నగదు విడిగా ఉంచుకోండి.',
     'चलन बदलण्यासाठी विमानतळावरील अधिकृत काउंटर, RBI मान्यताप्राप्त फॉरेक्स आउटलेट किंवा राष्ट्रीयीकृत बँकांच्या ATM चा वापर करा. कार्ड ब्लॉक झाल्यास आंतरराष्ट्रीय हेल्पलाइनवरून आपल्या बँकेशी संपर्क साधा आणि आपत्कालीन परिस्थितीसाठी कमी मूल्याच्या नोटा वेगळ्या ठेवा.',
     'ಕರೆನ್ಸಿ ವಿನಿಮಯಕ್ಕೆ ವಿಮಾನ ನಿಲ್ದಾಣದ ಅನುಮೋದಿತ ಕೌಂಟರ್‌ಗಳು, RBI ಅಂಗೀಕೃತ ಫಾರೆಕ್ಸ್ ಔಟ್‌ಲೆಟ್‌ಗಳು ಅಥವಾ ರಾಷ್ಟ್ರೀಕೃತ ಬ್ಯಾಂಕ್‌ಗಳ ATM‌ಗಳನ್ನು ಬಳಸಿ. ಕಾರ್ಡ್ ಬ್ಲಾಕ್ ಆದರೆ ಅಂತರರಾಷ್ಟ್ರೀಯ ಸಹಾಯವಾಣಿ ಮೂಲಕ ನಿಮ್ಮ ಬ್ಯಾಂಕನ್ನು ಸಂಪರ್ಕಿಸಿ ಮತ್ತು ತುರ್ತು ಸಂದರ್ಭಕ್ಕೆ ಸಣ್ಣ ಮೊತ್ತದ ನಗದನ್ನು ಪ್ರತ್ಯೇಕವಾಗಿ ಇಟ್ಟುಕೊಳ್ಳಿ.')
ON CONFLICT DO NOTHING;


-- Alert forwards: track which alerts were forwarded and to which services
CREATE TABLE IF NOT EXISTS alert_forwards (
    id SERIAL PRIMARY KEY,
    passport_id VARCHAR(50) NOT NULL,
    alert_type VARCHAR(50), -- e.g., 'panic', 'anomaly', 'distress'
    services JSONB,
    forwarded_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(passport_id, alert_type)
);

CREATE INDEX IF NOT EXISTS idx_alert_forwards_passport ON alert_forwards(passport_id);


-- Manual authority overrides picked by admin for a given passport/session
CREATE TABLE IF NOT EXISTS alert_authority_overrides (
    id SERIAL PRIMARY KEY,
    passport_id VARCHAR(50) NOT NULL,
    authority_type VARCHAR(30) NOT NULL, -- hospital | police | fire
    name TEXT,
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    distance_km DOUBLE PRECISION,
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(passport_id, authority_type)
);

CREATE INDEX IF NOT EXISTS idx_authority_overrides_passport ON alert_authority_overrides(passport_id);


-- Offline delivery queue for SMS/USSD fallbacks
CREATE TABLE IF NOT EXISTS sms_queue (
    id SERIAL PRIMARY KEY,
    passport_id VARCHAR(80),
    phone_number VARCHAR(80),
    message TEXT NOT NULL,
    channel VARCHAR(20) DEFAULT 'sms', -- 'sms' | 'ussd' | other
    status VARCHAR(20) DEFAULT 'pending', -- pending | sent | failed
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sms_queue_status ON sms_queue(status);
CREATE INDEX IF NOT EXISTS idx_sms_queue_passport ON sms_queue(passport_id);


-- Safe Zones: shelters, police, hospitals, treatment centres
CREATE TABLE IF NOT EXISTS safe_zones (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL, -- hospital | police | shelter | treatment_centre
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    address TEXT,
    contact VARCHAR(100),
    city VARCHAR(100),
    district VARCHAR(100),
    state VARCHAR(100),
    country VARCHAR(100) DEFAULT 'India',
    operational_hours VARCHAR(100),
    services TEXT[],
    facilities TEXT,
    verified BOOLEAN DEFAULT false,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_safe_zones_type ON safe_zones(type);
CREATE INDEX IF NOT EXISTS idx_safe_zones_city ON safe_zones(city);
CREATE INDEX IF NOT EXISTS idx_safe_zones_location ON safe_zones(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_safe_zones_active ON safe_zones(active);


-- Women streaming evidence capture (session + media segments)
CREATE TABLE IF NOT EXISTS women_stream_sessions (
    id SERIAL PRIMARY KEY,
    passport_id VARCHAR(50) NOT NULL,
    started_at TIMESTAMPTZ DEFAULT now(),
    ended_at TIMESTAMPTZ,
    status VARCHAR(20) DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_women_stream_sessions_passport ON women_stream_sessions(passport_id);

CREATE TABLE IF NOT EXISTS women_media_segments (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES women_stream_sessions(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    url TEXT NOT NULL,
    sequence INTEGER,
    size_bytes BIGINT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_women_media_segments_session ON women_media_segments(session_id);


-- Tourist Safety: Neighborhood Safety Ratings and Aggregated Score Cells
CREATE TABLE IF NOT EXISTS safety_ratings (
    id SERIAL PRIMARY KEY,
    passport_id VARCHAR(50),
    score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
    tags TEXT[],
    comment TEXT,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    cell_id VARCHAR(32) NOT NULL,
    cell_lat DOUBLE PRECISION NOT NULL,
    cell_lon DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_safety_ratings_cell ON safety_ratings(cell_id);
CREATE INDEX IF NOT EXISTS idx_safety_ratings_passport ON safety_ratings(passport_id);
CREATE INDEX IF NOT EXISTS idx_safety_ratings_created ON safety_ratings(created_at DESC);

CREATE TABLE IF NOT EXISTS safety_score_cells (
    cell_id VARCHAR(32) PRIMARY KEY,
    cell_lat DOUBLE PRECISION NOT NULL,
    cell_lon DOUBLE PRECISION NOT NULL,
    avg_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    ratings_count INTEGER NOT NULL DEFAULT 0,
    last_score DOUBLE PRECISION,
    last_updated TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_safety_cells_ratings ON safety_score_cells(ratings_count);

-- Geo-targeted Safety Alerts (crime, accidents, disasters)
CREATE TABLE IF NOT EXISTS safety_alerts (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    category VARCHAR(40) NOT NULL, -- crime | accident | disaster | other
    severity VARCHAR(20) DEFAULT 'medium', -- info | low | medium | high | critical
    description TEXT,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    radius_m INTEGER DEFAULT 1000,
    status VARCHAR(20) DEFAULT 'active', -- active | resolved | expired
    source VARCHAR(60),
    starts_at TIMESTAMPTZ DEFAULT now(),
    ends_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_safety_alerts_status ON safety_alerts(status);
CREATE INDEX IF NOT EXISTS idx_safety_alerts_geo ON safety_alerts(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_safety_alerts_category ON safety_alerts(category);


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