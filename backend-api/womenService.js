const express = require('express');
const router = express.Router();
const db = require('./db');
const nodemailer = require('nodemailer');

let emergencyNotifier = null;

const { pool } = db;

// Email transporter configuration
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Generate 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const sanitizeNumber = (input) => {
  if (!input && input !== 0) return '';
  let value = String(input).trim();
  if (!value) return '';
  const hasPlus = value.startsWith('+');
  value = value.replace(/[^0-9]/g, '');
  if (!value) return '';
  return hasPlus ? `+${value}` : value;
};

const normalizeEmail = (input) => {
  if (!input && input !== 0) return '';
  const value = String(input).trim().toLowerCase();
  if (!value || !value.includes('@')) return '';
  return value;
};

// Extract user identifier from request (mobile or aadhaar)
const extractUserId = (req) => {
  const candidates = [
    req.body?.userId,
    req.body?.user_id,
    req.query?.userId,
    req.query?.user_id,
    req.body?.mobileNumber,
    req.query?.mobileNumber,
    req.body?.mobile,
    req.query?.mobile,
    req.body?.passportId,
    req.query?.passportId,
    req.body?.email,
    req.query?.email,
    req.body?.identifier,
    req.query?.identifier,
  ];
  for (const value of candidates) {
    if (value) {
      const normalized = String(value).trim();
      if (normalized) return normalized;
    }
  }
  return null;
};

// Resolve women user by user_id, mobile number, or aadhaar
async function resolveWomenUser({ userId, mobileNumber, aadhaarNumber, email, passportId }) {
  try {
    const normalizedUserId = (userId || userId === 0) ? String(userId).trim() : '';
    const normalizedPassportId = (passportId || passportId === 0) ? String(passportId).trim() : '';

    // Try by numeric ID first
    const numericId = Number(normalizedUserId);
    if (Number.isInteger(numericId) && numericId > 0) {
      const result = await pool.query(
        'SELECT id, name, mobile_number, aadhaar_number, email, is_verified FROM women_users WHERE id = $1 LIMIT 1',
        [numericId]
      );
      if (result.rows?.length) return result.rows[0];
    }

    // Try by email (explicit email param or identifiers that look like email)
    const emailCandidates = [];
    const normalizedEmailParam = normalizeEmail(email);
    if (normalizedEmailParam) emailCandidates.push(normalizedEmailParam);

    const normalizedEmailFromUserId = normalizeEmail(normalizedUserId);
    if (normalizedEmailFromUserId) emailCandidates.push(normalizedEmailFromUserId);

  const normalizedEmailFromMobile = normalizeEmail(mobileNumber);
    if (normalizedEmailFromMobile) emailCandidates.push(normalizedEmailFromMobile);

    const normalizedEmailFromAadhaar = normalizeEmail(aadhaarNumber);
    if (normalizedEmailFromAadhaar) emailCandidates.push(normalizedEmailFromAadhaar);

  const normalizedEmailFromPassport = normalizeEmail(normalizedPassportId);
  if (normalizedEmailFromPassport) emailCandidates.push(normalizedEmailFromPassport);

    if (emailCandidates.length) {
      const uniqueEmails = [...new Set(emailCandidates)];
      for (const candidate of uniqueEmails) {
        const result = await pool.query(
          'SELECT id, name, mobile_number, aadhaar_number, email, is_verified FROM women_users WHERE LOWER(email) = $1 LIMIT 1',
          [candidate]
        );
        if (result.rows?.length) return result.rows[0];
      }
    }
    
    // Try by mobile number
    if (mobileNumber && !String(mobileNumber).includes('@')) {
      const sanitized = sanitizeNumber(mobileNumber);
      if (sanitized) {
        const result = await pool.query(
          'SELECT id, name, mobile_number, aadhaar_number, email, is_verified FROM women_users WHERE mobile_number = $1 LIMIT 1',
          [sanitized]
        );
        if (result.rows?.length) return result.rows[0];
      }
    }
    
    // Try by aadhaar
    if (aadhaarNumber && !String(aadhaarNumber).includes('@')) {
      const sanitized = sanitizeNumber(aadhaarNumber);
      if (sanitized) {
        const result = await pool.query(
          'SELECT id, name, mobile_number, aadhaar_number, email, is_verified FROM women_users WHERE aadhaar_number = $1 LIMIT 1',
          [sanitized]
        );
        if (result.rows?.length) return result.rows[0];
      }
    }

    // Try passport style identifiers (may be numeric string or alphanumeric)
    if (normalizedPassportId) {
      // If it's purely numeric, attempt direct ID lookup (covers previous behavior)
      const numericPassport = Number(normalizedPassportId);
      if (Number.isInteger(numericPassport) && numericPassport > 0) {
        const result = await pool.query(
          'SELECT id, name, mobile_number, aadhaar_number, email, is_verified FROM women_users WHERE id = $1 LIMIT 1',
          [numericPassport]
        );
        if (result.rows?.length) return result.rows[0];
      }

      // If it's numeric but longer, try mobile / Aadhaar style lookups
      const sanitizedPassportDigits = sanitizeNumber(normalizedPassportId);
      if (sanitizedPassportDigits) {
        if (sanitizedPassportDigits.length >= 8 && sanitizedPassportDigits.length <= 12) {
          const result = await pool.query(
            'SELECT id, name, mobile_number, aadhaar_number, email, is_verified FROM women_users WHERE mobile_number = $1 LIMIT 1',
            [sanitizedPassportDigits]
          );
          if (result.rows?.length) return result.rows[0];
        }

        if (sanitizedPassportDigits.length === 12) {
          const result = await pool.query(
            'SELECT id, name, mobile_number, aadhaar_number, email, is_verified FROM women_users WHERE aadhaar_number = $1 LIMIT 1',
            [sanitizedPassportDigits]
          );
          if (result.rows?.length) return result.rows[0];
        }
      }

      // Otherwise try matching against email/mobile/aadhaar derivations handled above
    }
  } catch (error) {
    console.error('[womenService] resolveWomenUser failed:', error);
  }
  return null;
}

const formatLocationString = (coords) => {
  if (!coords) return null;
  const { latitude, longitude } = coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
};

const mapContacts = (rows = []) => rows.map((row) => ({
  id: row.id,
  name: row.name,
  number: row.number,
  created_at: row.created_at,
}));

// ============ AUTHENTICATION ENDPOINTS ============

// Women Registration - Step 1: Request OTP
router.post('/auth/register/request-otp', async (req, res) => {
  try {
    const { mobileNumber, name, aadhaarNumber, email } = req.body;
    
    if (!mobileNumber || !name) {
      return res.status(400).json({ error: 'Mobile number and name are required.' });
    }

    const sanitizedMobile = sanitizeNumber(mobileNumber);
    if (!sanitizedMobile) {
      return res.status(400).json({ error: 'Invalid mobile number format.' });
    }

    // Check if user already exists
    const existing = await pool.query(
      'SELECT id, is_verified FROM women_users WHERE mobile_number = $1 LIMIT 1',
      [sanitizedMobile]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'User with this mobile number already exists.' });
    }

    // Check aadhaar if provided
    if (aadhaarNumber) {
      const sanitizedAadhaar = sanitizeNumber(aadhaarNumber);
      const aadhaarCheck = await pool.query(
        'SELECT id FROM women_users WHERE aadhaar_number = $1 LIMIT 1',
        [sanitizedAadhaar]
      );
      if (aadhaarCheck.rows.length > 0) {
        return res.status(400).json({ error: 'User with this Aadhaar number already exists.' });
      }
    }

    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Create user with OTP
    await pool.query(
      `INSERT INTO women_users (name, mobile_number, aadhaar_number, email, otp_code, otp_expires_at, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, false)`,
      [name, sanitizedMobile, aadhaarNumber ? sanitizeNumber(aadhaarNumber) : null, email, otp, otpExpiry]
    );

    // Send OTP via SMS (mock for now - in production, integrate with SMS gateway)
    console.log(`[WomenAuth] Registration OTP for ${sanitizedMobile}: ${otp}`);

    // If email provided, send OTP via email
    if (email) {
      try {
        await transporter.sendMail({
          from: '"Women Safety - Smart Tourist" <smarttouristsystem@gmail.com>',
          to: email,
          subject: 'Your Registration OTP',
          text: `Welcome! Your OTP for registration is: ${otp}. It expires in 10 minutes.`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #e91e63;">Women Safety Registration</h2>
              <p>Welcome to Women Safety Module! Your registration OTP is:</p>
              <div style="background: #fce4ec; border: 2px dashed #e91e63; padding: 20px; text-align: center; margin: 20px 0;">
                <h3 style="color: #880e4f; font-size: 24px; letter-spacing: 3px; margin: 0;">${otp}</h3>
              </div>
              <p>This code will expire in 10 minutes.</p>
            </div>
          `,
        });
      } catch (emailErr) {
        console.warn('[WomenAuth] Failed to send email OTP:', emailErr.message);
      }
    }

    return res.json({ 
      success: true, 
      message: 'OTP sent successfully. Please verify to complete registration.',
      mobileNumber: sanitizedMobile 
    });
  } catch (error) {
    console.error('[womenService] Registration OTP request failed:', error);
    return res.status(500).json({ error: 'Failed to initiate registration.' });
  }
});

// Women Registration - Step 2: Verify OTP and Complete Registration
router.post('/auth/register/verify-otp', async (req, res) => {
  try {
    const { mobileNumber, otp } = req.body;
    
    if (!mobileNumber || !otp) {
      return res.status(400).json({ error: 'Mobile number and OTP are required.' });
    }

    const sanitizedMobile = sanitizeNumber(mobileNumber);
    
    const result = await pool.query(
      `SELECT id, name, mobile_number, aadhaar_number, email, otp_code, otp_expires_at, is_verified 
       FROM women_users WHERE mobile_number = $1 LIMIT 1`,
      [sanitizedMobile]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = result.rows[0];

    if (user.is_verified) {
      return res.status(400).json({ error: 'User already verified. Please login.' });
    }

    if (user.otp_code !== otp) {
      return res.status(400).json({ error: 'Invalid OTP.' });
    }

    if (new Date() > new Date(user.otp_expires_at)) {
      return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
    }

    // Verify user
    await pool.query(
      'UPDATE women_users SET is_verified = true, otp_code = NULL, otp_expires_at = NULL WHERE id = $1',
      [user.id]
    );

    return res.json({ 
      success: true, 
      message: 'Registration completed successfully!',
      user: {
        id: user.id,
        name: user.name,
        mobileNumber: user.mobile_number,
        aadhaarNumber: user.aadhaar_number,
        email: user.email
      }
    });
  } catch (error) {
    console.error('[womenService] Registration OTP verification failed:', error);
    return res.status(500).json({ error: 'Failed to verify OTP.' });
  }
});

// Women Login - Step 1: Request OTP
router.post('/auth/login/request-otp', async (req, res) => {
  try {
    const { identifier } = req.body; // Should be email
    if (!identifier) {
      return res.status(400).json({ error: 'Email address is required.' });
    }
    const email = String(identifier).trim().toLowerCase();
    // Check if user exists by email
    const result = await pool.query(
      `SELECT id, name, mobile_number, email, is_verified 
       FROM women_users 
       WHERE email = $1 
       LIMIT 1`,
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found. Please register first.' });
    }
    const user = result.rows[0];
    if (!user.is_verified) {
      return res.status(400).json({ error: 'User not verified. Please complete registration.' });
    }
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    await pool.query(
      'UPDATE women_users SET otp_code = $1, otp_expires_at = $2 WHERE id = $3',
      [otp, otpExpiry, user.id]
    );
    console.log(`[WomenAuth] Login OTP for ${user.email}: ${otp}`);
    // Send OTP via email
    try {
      await transporter.sendMail({
        from: '"Women Safety - Smart Tourist" <smarttouristsystem@gmail.com>',
        to: user.email,
        subject: 'Your Login OTP',
        text: `Your OTP for login is: ${otp}. It expires in 5 minutes.`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #e91e63;">Women Safety Login</h2>
            <p>Your login OTP is:</p>
            <div style="background: #fce4ec; border: 2px dashed #e91e63; padding: 20px; text-align: center; margin: 20px 0;">
              <h3 style="color: #880e4f; font-size: 24px; letter-spacing: 3px; margin: 0;">${otp}</h3>
            </div>
            <p>This code will expire in 5 minutes.</p>
          </div>
        `,
      });
    } catch (emailErr) {
      console.warn('[WomenAuth] Failed to send login OTP email:', emailErr.message);
    }
    return res.json({ 
      success: true, 
      message: 'OTP sent successfully.',
      email: user.email
    });
  } catch (error) {
    console.error('[womenService] Login OTP request failed:', error);
    return res.status(500).json({ error: 'Failed to send login OTP.' });
  }
});

// Women Login - Step 2: Verify OTP and Login
router.post('/auth/login/verify-otp', async (req, res) => {
  try {
    const { identifier, otp } = req.body;
    if (!identifier || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required.' });
    }
    const email = String(identifier).trim().toLowerCase();
    const result = await pool.query(
      `SELECT id, name, mobile_number, aadhaar_number, email, otp_code, otp_expires_at, is_verified, profile_picture_url
       FROM women_users 
       WHERE email = $1 AND is_verified = true
       LIMIT 1`,
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found or not verified.' });
    }
    const user = result.rows[0];
    if (user.otp_code !== otp) {
      return res.status(400).json({ error: 'Invalid OTP.' });
    }
    if (new Date() > new Date(user.otp_expires_at)) {
      return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
    }
    // Clear OTP and update last seen
    await pool.query(
      'UPDATE women_users SET otp_code = NULL, otp_expires_at = NULL, last_seen = NOW() WHERE id = $1',
      [user.id]
    );
    // Set session cookie for women users so generic /api/v1/auth/me can work
    try {
      const isSecure = req.headers['x-forwarded-proto'] === 'https' || req.secure;
      res.cookie('womenUserId', user.id, {
        httpOnly: true,
        sameSite: isSecure ? 'none' : 'lax',
        secure: !!isSecure,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    } catch (cookieErr) {
      console.warn('[WomenAuth] Failed to set womenUserId cookie:', cookieErr && cookieErr.message);
    }
    // Get emergency contacts
    const contacts = await pool.query(
      'SELECT id, name, mobile_number, email, relationship FROM women_emergency_contacts WHERE user_id = $1 ORDER BY priority',
      [user.id]
    );
    return res.json({ 
      success: true, 
      message: 'Login successful!',
      token: 'women.jwt.token.' + user.id,
      passportId: `WOMEN-${user.id}`,
      serviceType: 'women_safety',
      userType: 'women',
      user: {
        id: user.id,
        name: user.name,
        mobileNumber: user.mobile_number,
        aadhaarNumber: user.aadhaar_number,
        email: user.email,
        profilePicture: user.profile_picture_url,
        emergencyContacts: contacts.rows
      }
    });
  } catch (error) {
    console.error('[womenService] Login OTP verification failed:', error);
    return res.status(500).json({ error: 'Failed to verify login OTP.' });
  }
});

// Get user profile
router.get('/auth/profile', async (req, res) => {
  try {
    const userId = extractUserId(req);
    const user = await resolveWomenUser({
      userId,
      mobileNumber: userId,
      email: req.query?.email || req.body?.email || userId,
      passportId: req.query?.passportId || req.body?.passportId || userId,
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const contacts = await pool.query(
      'SELECT id, name, mobile_number, email, relationship FROM women_emergency_contacts WHERE user_id = $1 ORDER BY priority',
      [user.id]
    );

    return res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        mobileNumber: user.mobile_number,
        aadhaarNumber: user.aadhaar_number,
        email: user.email,
        profilePicture: user.profile_picture_url,
        emergencyContacts: contacts.rows
      }
    });
  } catch (error) {
    console.error('[womenService] Profile fetch failed:', error);
    return res.status(500).json({ error: 'Failed to fetch profile.' });
  }
});

// Update user profile
router.put('/auth/profile', async (req, res) => {
  try {
    const userId = extractUserId(req);
    const user = await resolveWomenUser({
      userId,
      mobileNumber: userId,
      email: req.query?.email || req.body?.email || userId,
      passportId: req.query?.passportId || req.body?.passportId || userId,
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const { name, email, aadhaarNumber } = req.body;
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (email) {
      updates.push(`email = $${paramCount++}`);
      values.push(email);
    }
    if (aadhaarNumber) {
      updates.push(`aadhaar_number = $${paramCount++}`);
      values.push(sanitizeNumber(aadhaarNumber));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update.' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(user.id);

    await pool.query(
      `UPDATE women_users SET ${updates.join(', ')} WHERE id = $${paramCount}`,
      values
    );

    return res.json({ success: true, message: 'Profile updated successfully.' });
  } catch (error) {
    console.error('[womenService] Profile update failed:', error);
    return res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// ============ END AUTHENTICATION ENDPOINTS ============

const normalizeCoords = (payload) => {
  if (!payload) return null;
  const source = typeof payload === 'object' ? payload : {};
  const latitude = Number(source.latitude ?? source.lat);
  const longitude = Number(source.longitude ?? source.lon ?? source.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  const coords = { latitude, longitude };
  if (source.accuracy != null) {
    const accuracy = Number(source.accuracy);
    if (Number.isFinite(accuracy)) coords.accuracy = accuracy;
  }
  return coords;
};

router.post('/sos', async (req, res) => {
  const userId = extractUserId(req);
  const user = await resolveWomenUser({ 
    userId, 
    mobileNumber: req.body?.mobileNumber || req.body?.mobile,
    aadhaarNumber: req.body?.aadhaarNumber || req.body?.aadhaar,
    email: req.body?.email || req.body?.userEmail || userId,
    passportId: req.body?.passportId || req.query?.passportId || userId,
  });
  
  if (!user) {
    return res.status(404).json({ error: 'User not found for SOS trigger.' });
  }

  const coords = normalizeCoords(req.body?.location);
  const locationText = coords ? formatLocationString(coords) : (req.body?.location || null);
  const source = req.body?.source || 'manual';

  try {
    await pool.query(
      `INSERT INTO women_sos (user_id, location, latitude, longitude, accuracy, source, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        user.id,
        locationText,
        coords?.latitude ?? null,
        coords?.longitude ?? null,
        coords?.accuracy ?? null,
        source,
      ]
    );

    if (coords) {
      try {
        await pool.query(
          `INSERT INTO women_location (user_id, lat, lon, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (user_id) DO UPDATE SET lat = EXCLUDED.lat, lon = EXCLUDED.lon, updated_at = NOW()`,
          [user.id, coords.latitude, coords.longitude]
        );
        await pool.query(
          `INSERT INTO women_location_history (user_id, latitude, longitude, accuracy)
           VALUES ($1, $2, $3, $4)`,
          [user.id, coords.latitude, coords.longitude, coords.accuracy ?? null]
        );
      } catch (err) {
        console.warn('[womenService] Failed to append location history for SOS:', err?.message || err);
      }
    }

    const contactRes = await pool.query(
      'SELECT id, name, number, created_at FROM women_contacts WHERE user_id = $1 ORDER BY id DESC',
      [user.id]
    );

    if (typeof emergencyNotifier === 'function') {
      try {
        await emergencyNotifier({
          userId: user.id,
          mobileNumber: user.mobile_number,
          aadhaarNumber: user.aadhaar_number,
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
          alertType: 'panic',
          location: locationText || null,
          source,
        });
      } catch (notifyErr) {
        console.warn('[womenService] emergency notifier failed:', notifyErr?.message || notifyErr);
      }
    }

    return res.json({ success: true, contacts: mapContacts(contactRes.rows) });
  } catch (error) {
    console.error('[womenService] SOS insert failed:', error);
    return res.status(500).json({ error: 'Failed to send SOS alert.' });
  }
});

router.post('/location', async (req, res) => {
  const userId = extractUserId(req);
  const user = await resolveWomenUser({ 
    userId, 
    mobileNumber: req.body?.mobileNumber || req.body?.mobile,
    aadhaarNumber: req.body?.aadhaarNumber || req.body?.aadhaar,
    email: req.body?.email || req.body?.userEmail || userId,
    passportId: req.body?.passportId || req.query?.passportId || userId,
  });
  
  if (!user) {
    return res.status(404).json({ error: 'User not found for location sharing.' });
  }

  const coords = normalizeCoords(req.body) || normalizeCoords(req.body?.coords);
  if (!coords) {
    return res.status(400).json({ error: 'Valid latitude and longitude are required.' });
  }

  try {
    await pool.query(
      `INSERT INTO women_location (user_id, lat, lon, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET lat = EXCLUDED.lat, lon = EXCLUDED.lon, updated_at = NOW()`,
      [user.id, coords.latitude, coords.longitude]
    );

    await pool.query(
      `INSERT INTO women_location_history (user_id, latitude, longitude, accuracy)
       VALUES ($1, $2, $3, $4)`,
      [user.id, coords.latitude, coords.longitude, coords.accuracy ?? null]
    );

    return res.json({ success: true });
  } catch (error) {
    console.error('[womenService] location update failed:', error);
    return res.status(500).json({ error: 'Failed to update live location.' });
  }
});

router.get('/location', async (req, res) => {
  const userId = extractUserId(req);
  const user = await resolveWomenUser({ 
    userId, 
    mobileNumber: req.query?.mobileNumber || req.query?.mobile,
    aadhaarNumber: req.query?.aadhaarNumber || req.query?.aadhaar,
    email: req.query?.email || req.body?.email || userId,
    passportId: req.query?.passportId || req.body?.passportId || userId,
  });
  
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  try {
    const result = await pool.query(
      'SELECT lat, lon, updated_at FROM women_location WHERE user_id = $1 LIMIT 1',
      [user.id]
    );
    if (!result.rows?.length) {
      return res.json({ location: null });
    }
    const row = result.rows[0];
    return res.json({
      location: {
        latitude: row.lat,
        longitude: row.lon,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    console.error('[womenService] failed to fetch location:', error);
    return res.status(500).json({ error: 'Unable to retrieve latest location.' });
  }
});

router.get('/contacts', async (req, res) => {
  const userId = extractUserId(req);
  const user = await resolveWomenUser({ 
    userId, 
    mobileNumber: req.query?.mobileNumber || req.query?.mobile,
    aadhaarNumber: req.query?.aadhaarNumber || req.query?.aadhaar,
    email: req.query?.email || req.body?.email || req.query?.userEmail || req.body?.userEmail || userId,
    passportId: req.query?.passportId || req.body?.passportId || userId,
  });
  
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  try {
    const result = await pool.query(
      'SELECT id, name, number, created_at FROM women_contacts WHERE user_id = $1 ORDER BY id DESC',
      [user.id]
    );
    return res.json({ contacts: mapContacts(result.rows) });
  } catch (error) {
    console.error('[womenService] fetch contacts failed:', error);
    return res.status(500).json({ error: 'Failed to load contacts.' });
  }
});

router.post('/contacts', async (req, res) => {
  const userId = extractUserId(req);
  const user = await resolveWomenUser({ 
    userId, 
    mobileNumber: req.body?.mobileNumber || req.body?.mobile,
    aadhaarNumber: req.body?.aadhaarNumber || req.body?.aadhaar,
    email: req.body?.email || req.query?.email || req.body?.userEmail || req.query?.userEmail || userId,
    passportId: req.body?.passportId || req.query?.passportId || userId,
  });
  
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const name = (req.body?.name || '').trim();
  const number = sanitizeNumber(req.body?.number);
  if (!name) {
    return res.status(400).json({ error: 'Contact name is required.' });
  }
  if (!number) {
    return res.status(400).json({ error: 'Contact number is required.' });
  }

  try {
    const insert = await pool.query(
      `INSERT INTO women_contacts (user_id, name, number, created_at)
       VALUES ($1, $2, $3, NOW()) RETURNING id, name, number, created_at`,
      [user.id, name, number]
    );
    return res.status(201).json({ contact: insert.rows[0] });
  } catch (error) {
    console.error('[womenService] add contact failed:', error);
    return res.status(500).json({ error: 'Failed to add emergency contact.' });
  }
});

router.delete('/contacts/:id', async (req, res) => {
  const userId = extractUserId(req);
  const user = await resolveWomenUser({ 
    userId, 
    mobileNumber: req.body?.mobileNumber || req.body?.mobile,
    aadhaarNumber: req.body?.aadhaarNumber || req.body?.aadhaar,
    email: req.body?.email || req.query?.email || req.body?.userEmail || req.query?.userEmail || userId,
    passportId: req.body?.passportId || req.query?.passportId || userId,
  });
  
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const contactId = Number(req.params.id);
  if (!Number.isInteger(contactId)) {
    return res.status(400).json({ error: 'Invalid contact identifier.' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM women_contacts WHERE id = $1 AND user_id = $2 RETURNING id',
      [contactId, user.id]
    );
    if (!result.rows?.length) {
      return res.status(404).json({ error: 'Contact not found.' });
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('[womenService] delete contact failed:', error);
    return res.status(500).json({ error: 'Failed to delete emergency contact.' });
  }
});

router.post('/report', async (req, res) => {
  const userId = extractUserId(req);
  const user = await resolveWomenUser({ 
    userId, 
    mobileNumber: req.body?.mobileNumber || req.body?.mobile,
    aadhaarNumber: req.body?.aadhaarNumber || req.body?.aadhaar,
    email: req.body?.email || req.query?.email || req.body?.userEmail || req.query?.userEmail || userId,
    passportId: req.body?.passportId || req.query?.passportId || userId,
  });
  
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const description = (req.body?.desc || req.body?.description || '').trim();
  if (!description) {
    return res.status(400).json({ error: 'Please provide incident details.' });
  }
  const anonymous = Boolean(req.body?.anonymous);
  const coords = normalizeCoords(req.body?.location);
  const status = req.body?.status || 'submitted';

  try {
    const result = await pool.query(
  `INSERT INTO women_reports (user_id, description, anonymous, status, location, created_at)
   VALUES ($1, $2, $3, $4, $5, NOW())
   RETURNING id, description, anonymous, status, created_at`,
      [user.id, description, anonymous, status, coords ? JSON.stringify(coords) : null]
    );
    return res.status(201).json({ report: result.rows[0] });
  } catch (error) {
    console.error('[womenService] report insert failed:', error);
    return res.status(500).json({ error: 'Failed to submit report.' });
  }
});

router.get('/reports', async (req, res) => {
  const userId = extractUserId(req);
  const user = await resolveWomenUser({ 
    userId, 
    mobileNumber: req.query?.mobileNumber || req.query?.mobile,
    aadhaarNumber: req.query?.aadhaarNumber || req.query?.aadhaar,
    email: req.query?.email || req.body?.email || req.query?.userEmail || req.body?.userEmail || userId,
    passportId: req.query?.passportId || req.body?.passportId || userId,
  });
  
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  try {
    const result = await pool.query(
      `SELECT id, description, anonymous, status, created_at
       FROM women_reports
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [user.id]
    );
    return res.json({ reports: result.rows });
  } catch (error) {
    console.error('[womenService] fetch reports failed:', error);
    return res.status(500).json({ error: 'Failed to load reports.' });
  }
});

router.post('/feedback', async (req, res) => {
  const userId = extractUserId(req);
  const user = await resolveWomenUser({ 
    userId, 
    mobileNumber: req.body?.mobileNumber || req.body?.mobile,
    aadhaarNumber: req.body?.aadhaarNumber || req.body?.aadhaar,
    email: req.body?.email || req.query?.email || req.body?.userEmail || req.query?.userEmail || userId,
    passportId: req.body?.passportId || req.query?.passportId || userId,
  });
  
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  let area = (req.body?.area || req.body?.city || req.body?.zone || req.body?.location?.city || '').trim();
  if (!area) {
    area = 'General';
  }

  let rating = Number.parseInt(req.body?.rating, 10);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    rating = 5;
  }

  const comment = (req.body?.comment || req.body?.feedback || '').trim();

  try {
    const result = await pool.query(
      `INSERT INTO women_feedback (user_id, area, rating, comment, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, area, rating, comment, created_at`,
      [user.id, area, rating, comment || null]
    );
    return res.status(201).json({ feedback: result.rows[0] });
  } catch (error) {
    console.error('[womenService] feedback insert failed:', error);
    return res.status(500).json({ error: 'Failed to submit feedback.' });
  }
});

router.get('/feedback', async (req, res) => {
  const userId = extractUserId(req);
  const user = await resolveWomenUser({ 
    userId, 
    mobileNumber: req.query?.mobileNumber || req.query?.mobile,
    aadhaarNumber: req.query?.aadhaarNumber || req.query?.aadhaar,
    email: req.query?.email || req.body?.email || req.query?.userEmail || req.body?.userEmail || userId,
    passportId: req.query?.passportId || req.body?.passportId || userId,
  });

  try {
    const summary = await pool.query(
      `SELECT area, ROUND(AVG(rating)::numeric, 2) AS average_rating, COUNT(*) AS submissions
       FROM women_feedback
       WHERE area IS NOT NULL AND rating IS NOT NULL
       GROUP BY area
       ORDER BY average_rating DESC, submissions DESC
       LIMIT 20`
    );

    let recent = [];
    if (user) {
      const recentRes = await pool.query(
        `SELECT area, rating, comment, created_at
         FROM women_feedback
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 10`,
        [user.id]
      );
      recent = recentRes.rows;
    }

    return res.json({ summary: summary.rows, recent });
  } catch (error) {
    console.error('[womenService] fetch feedback failed:', error);
    return res.status(500).json({ error: 'Failed to load community feedback.' });
  }
});

router.get('/selfdefense', (req, res) => {
  return res.json([
    {
      title: 'Stay alert in crowded spaces',
      description: 'Keep your belongings close, identify safe exits, and trust your instincts.',
      video_url: 'https://www.youtube.com/embed/X9v9Z6w4sNQ',
    },
    {
      title: 'Voice as a defense tool',
      description: 'Use firm commands to create distance and draw attention to the situation.',
      video_url: 'https://www.youtube.com/embed/PdLKbTIPpls',
    },
    {
      title: 'Pressure point basics',
      description: 'Target nose, eyes, and knees to disengage and create a window to escape.',
    },
  ]);
});

// Fake call / silent alert endpoint
router.post('/fake-event', async (req, res) => {
  const userId = extractUserId(req);
  const user = await resolveWomenUser({ 
    userId, 
    mobileNumber: req.body?.mobileNumber || req.body?.mobile,
    aadhaarNumber: req.body?.aadhaarNumber || req.body?.aadhaar,
    email: req.body?.email || req.body?.userEmail || userId,
    passportId: req.body?.passportId || userId,
  });

  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const eventType = req.body?.event_type || req.body?.eventType || 'fake_call';
  const validTypes = ['fake_call', 'silent_alert'];
  if (!validTypes.includes(eventType)) {
    return res.status(400).json({ error: 'Invalid event_type. Use fake_call or silent_alert.' });
  }

  // Extract location if provided
  const location = req.body?.location || null;
  const latitude = location?.latitude || req.body?.latitude || null;
  const longitude = location?.longitude || req.body?.longitude || null;

  try {
    // Log the fake event to database
    const result = await pool.query(
      `INSERT INTO women_fake_events (user_id, event_type, status, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, event_type, status, created_at`,
      [user.id, eventType, 'triggered']
    );

    const event = result.rows[0];
    console.log(`[womenService] Fake event triggered: ${eventType} for user ${user.email || user.mobile_number}`);

    // Fetch emergency contacts for this user
    const contactsResult = await pool.query(
      'SELECT id, name, mobile_number, email, relationship FROM women_emergency_contacts WHERE user_id = $1 ORDER BY priority',
      [user.id]
    );

    const emergencyContacts = contactsResult.rows;

    // Send notifications to emergency contacts (only for silent_alert)
    if (eventType === 'silent_alert' && emergencyContacts.length > 0) {
      const userName = user.name || user.email || 'A user';
      const alertMessage = `URGENT: ${userName} has triggered a silent alert. ` +
        (latitude && longitude 
          ? `Location: https://www.google.com/maps?q=${latitude},${longitude}` 
          : 'Location not available.');

      // Send emails to contacts
      const emailPromises = emergencyContacts
        .filter(contact => contact.email)
        .map(contact => {
          return transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: contact.email,
            subject: `🚨 Silent Alert from ${userName}`,
            html: `
              <div style="font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5;">
                <div style="background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                  <h2 style="color: #dc3545; margin-bottom: 20px;">🚨 Silent Alert</h2>
                  <p style="font-size: 16px; line-height: 1.6;">
                    <strong>${userName}</strong> has triggered a silent alert and may need assistance.
                  </p>
                  ${latitude && longitude ? `
                    <div style="margin: 20px 0; padding: 15px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 5px;">
                      <p style="margin: 0; font-size: 14px;"><strong>📍 Location:</strong></p>
                      <a href="https://www.google.com/maps?q=${latitude},${longitude}" 
                         style="color: #0066cc; text-decoration: none; font-size: 14px; display: inline-block; margin-top: 8px;">
                        View on Google Maps →
                      </a>
                    </div>
                  ` : '<p style="color: #856404; background: #fff3cd; padding: 10px; border-radius: 5px; font-size: 14px;">📍 Location not available</p>'}
                  <p style="font-size: 14px; color: #666; margin-top: 20px;">
                    Time: ${new Date().toLocaleString()}
                  </p>
                  <p style="font-size: 13px; color: #999; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                    This is an automated alert from Secure Safar Women Safety System.
                  </p>
                </div>
              </div>
            `
          }).catch(err => {
            console.error(`[womenService] Failed to send email to ${contact.email}:`, err);
          });
        });

      // Wait for all emails to be sent
      await Promise.allSettled(emailPromises);

      console.log(`[womenService] Notifications sent to ${emergencyContacts.length} emergency contacts`);
    }

    return res.status(201).json({ 
      success: true,
      event: event,
      notificationsSent: eventType === 'silent_alert' ? emergencyContacts.length : 0,
      message: eventType === 'fake_call' 
        ? 'Fake call triggered successfully' 
        : `Silent alert sent successfully. ${emergencyContacts.length} emergency contacts notified.`
    });
  } catch (error) {
    console.error('[womenService] fake-event insert failed:', error);
    return res.status(500).json({ error: 'Failed to trigger fake event.' });
  }
});

// Get recent fake events
router.get('/fake-events', async (req, res) => {
  const userId = extractUserId(req);
  const user = await resolveWomenUser({ 
    userId, 
    mobileNumber: req.query?.mobileNumber || req.query?.mobile,
    aadhaarNumber: req.query?.aadhaarNumber || req.query?.aadhaar,
    email: req.query?.email || req.body?.email || req.query?.userEmail || req.body?.userEmail || userId,
    passportId: req.query?.passportId || req.body?.passportId || userId,
  });

  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  try {
    const result = await pool.query(
      `SELECT id, event_type, status, created_at
       FROM women_fake_events
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [user.id]
    );

    return res.json({ events: result.rows });
  } catch (error) {
    console.error('[womenService] fetch fake-events failed:', error);
    return res.status(500).json({ error: 'Failed to load fake events.' });
  }
});

module.exports = router;
module.exports.setEmergencyNotifier = (fn) => {
  emergencyNotifier = typeof fn === 'function' ? fn : null;
};
