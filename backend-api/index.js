// ...existing code...
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { mintDigitalId, mintGroupId } = require("./blockchainService");
const axios = require("axios");
const cron = require("node-cron");
const nodemailer = require("nodemailer");
const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { body, validationResult } = require("express-validator");
const db = require("./db");
const { findNearbyServices, findNearbyServiceLists } = require("./emergencyService");
const fs = require("fs");
const dotenvPath = require('path').join(__dirname, '.env');
require("dotenv").config({ path: dotenvPath });
const womenService = require('./womenService');
const womenRouter = require('./womenService');

const sanitizePhoneNumber = (input) => {
  if (!input && input !== 0) return '';
  let value = String(input).trim();
  if (!value) return '';
  const hasPlus = value.startsWith('+');
  value = value.replace(/[^0-9]/g, '');
  if (!value) return '';
  return hasPlus ? `+${value}` : value;
};

const normalizeGovernmentId = (input, idType = 'passport') => {
  if (!input && input !== 0) return '';
  let value = String(input).trim();
  if (!value) return '';
  if (idType === 'aadhaar') {
    return value.replace(/[^0-9]/g, '');
  }
  return value.toUpperCase();
};

let twilioClient = null;
const twilioConfig = {
  accountSid: process.env.TWILIO_ACCOUNT_SID || null,
  authToken: process.env.TWILIO_AUTH_TOKEN || null,
  smsFrom: process.env.TWILIO_SMS_FROM || null,
  whatsappFrom: process.env.TWILIO_WHATSAPP_FROM || null,
  enable: process.env.TWILIO_ENABLE_ALERTS !== 'false',
  allowSmsFallback: process.env.TWILIO_ALLOW_SMS_FALLBACK === 'true',
};

if (twilioConfig.accountSid && twilioConfig.authToken && twilioConfig.enable) {
  try {
    const twilioLib = require('twilio');
    twilioClient = twilioLib(twilioConfig.accountSid, twilioConfig.authToken);
  } catch (err) {
    console.warn('[Twilio] Initialization failed, SMS/WhatsApp alerts disabled:', err && err.message);
    twilioClient = null;
  }
} else if (twilioConfig.enable) {
  console.log('[Twilio] Credentials missing, SMS/WhatsApp alerts disabled.');
}

// ---------------- Citizen Safety: Government connectors scaffolding ----------------
// Define an adapter interface and a simple default mock connector. Real deployments can
// implement connectors per region (e.g., 112, city animal control, women helpline, etc.).
class GovernmentConnector {
  async notifyIncident(incident) {
    // incident: row from incidents
    // Return { forwarded: true, services: {...}, referenceId }
    return { forwarded: false, services: {}, referenceId: null };
  }
}
class MockConnector extends GovernmentConnector {
  async notifyIncident(incident) {
    // Use OSM to suggest nearest services; in real impl, call official APIs
    const lat = incident.latitude, lon = incident.longitude;
    let services = null;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      try { services = await findNearbyServices(lat, lon); } catch (_) { services = null; }
    }
    return { forwarded: true, services: services || {}, referenceId: `MOCK-${incident.id}` };
  }
}
const govConnector = new MockConnector();

// AI service endpoint and small helper used by detectorPredictPoint
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8001';
function hashToInt(str) {
  try {
    let h = 0;
    for (let i = 0; i < String(str).length; i++) {
      h = ((h << 5) - h) + String(str).charCodeAt(i);
      h |= 0; // Convert to 32bit integer
    }
    return Math.abs(h);
  } catch {
    return Math.floor(Math.random() * 1e9);
  }
}
/**
 * Generate a 6-digit numeric code for email verification and login OTPs
 */
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const connectedTourists = {};
const app = express();

// Ensure DB has expected columns/tables used by newer code and fix triggers
async function ensureDatabaseShape() {
  try {
    // Add missing columns on tourists (no-op if already present)
    const alters = [
      `ALTER TABLE IF EXISTS tourists ADD COLUMN IF NOT EXISTS country VARCHAR(100)` ,
      `ALTER TABLE IF EXISTS tourists ADD COLUMN IF NOT EXISTS visa_id VARCHAR(100)`,
      `ALTER TABLE IF EXISTS tourists ADD COLUMN IF NOT EXISTS visa_expiry VARCHAR(50)`,
      `ALTER TABLE IF EXISTS tourists ADD COLUMN IF NOT EXISTS emergency_contact_1 VARCHAR(100)`,
      `ALTER TABLE IF EXISTS tourists ADD COLUMN IF NOT EXISTS emergency_contact_email_1 VARCHAR(255)`,
      `ALTER TABLE IF EXISTS tourists ADD COLUMN IF NOT EXISTS emergency_contact_2 VARCHAR(100)`,
      `ALTER TABLE IF EXISTS tourists ADD COLUMN IF NOT EXISTS emergency_contact_email_2 VARCHAR(255)`,
      `ALTER TABLE IF EXISTS tourists ADD COLUMN IF NOT EXISTS profile_picture_url VARCHAR(255)`,
      `ALTER TABLE IF EXISTS tourists ADD COLUMN IF NOT EXISTS passport_image_url VARCHAR(255)`,
      `ALTER TABLE IF EXISTS tourists ADD COLUMN IF NOT EXISTS passport_image_secondary_url VARCHAR(255)`,
      `ALTER TABLE IF EXISTS tourists ADD COLUMN IF NOT EXISTS visa_image_url VARCHAR(255)`,
      `ALTER TABLE IF EXISTS tourists ADD COLUMN IF NOT EXISTS profile_complete BOOLEAN DEFAULT false`
    ];
    for (const sql of alters) {
      try { await db.pool.query(sql); } catch (e) { console.debug('Ensure column skipped:', e && e.message); }
    }

    // Ensure location_history.created_at exists
    try {
      await db.pool.query(`ALTER TABLE IF EXISTS location_history ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()`);
    } catch (_) {}

    // Fix last_seen trigger: drop incorrect trigger/function if they exist, then create correct AFTER INSERT trigger
    try { await db.pool.query(`DROP TRIGGER IF EXISTS update_tourist_last_seen ON location_history`); } catch (_) {}
    try { await db.pool.query(`DROP FUNCTION IF EXISTS update_last_seen_column()`); } catch (_) {}

    // Create helper function to update tourists.last_seen when a location is inserted
    await db.pool.query(`
      CREATE OR REPLACE FUNCTION set_tourist_last_seen()
      RETURNS TRIGGER AS $$
      BEGIN
        UPDATE tourists SET last_seen = now() WHERE id = NEW.tourist_id;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await db.pool.query(`
      CREATE TRIGGER update_tourist_last_seen
      AFTER INSERT ON location_history
      FOR EACH ROW
      EXECUTE FUNCTION set_tourist_last_seen();
    `);

    console.log('[DB] ensureDatabaseShape completed');

    // Ensure alert_forwards table exists to persist which alerts have been forwarded (with services JSON)
    try {
      await db.pool.query(`
        CREATE TABLE IF NOT EXISTS alert_forwards (
          id SERIAL PRIMARY KEY,
          passport_id VARCHAR(50) NOT NULL,
            -- type could be 'distress' or specific anomaly subtype
          alert_type VARCHAR(50),
          services JSONB,
          forwarded_at TIMESTAMPTZ DEFAULT now(),
          UNIQUE(passport_id, alert_type)
        );
        CREATE INDEX IF NOT EXISTS idx_alert_forwards_passport ON alert_forwards(passport_id);
        ALTER TABLE alert_forwards ADD COLUMN IF NOT EXISTS services JSONB; -- safe repeat
      `);
      console.log('[DB] alert_forwards table ready');
    } catch (e) {
      console.warn('[DB] could not ensure alert_forwards table:', e && e.message);
    }

    // Table to store manual overrides of dispatched authorities (chosen by admin editing)
    try {
      await db.pool.query(`
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
      `);
      console.log('[DB] alert_authority_overrides table ready');
    } catch (e) {
      console.warn('[DB] could not ensure alert_authority_overrides table:', e && e.message);
    }

    // Table to store alert history events
    try {
      await db.pool.query(`
        CREATE TABLE IF NOT EXISTS alert_history (
          id SERIAL PRIMARY KEY,
          passport_id VARCHAR(50) NOT NULL,
          event_type VARCHAR(40) NOT NULL, -- panic|anomaly|forwarded|reset|override|anomaly_risk_area|anomaly_ml etc
          details JSONB,
          created_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_alert_history_passport ON alert_history(passport_id);
      `);
      console.log('[DB] alert_history table ready');
    } catch (e) {
      console.warn('[DB] could not ensure alert_history table:', e && e.message);
    }

    // Incidents & forwards (citizen safety pivot)
    try {
      await db.pool.query(`
        CREATE TABLE IF NOT EXISTS incidents (
          id SERIAL PRIMARY KEY,
          category VARCHAR(50) NOT NULL,
          sub_type VARCHAR(100),
          description TEXT,
          latitude DOUBLE PRECISION,
          longitude DOUBLE PRECISION,
          reporter_type VARCHAR(20) DEFAULT 'citizen',
          reporter_name VARCHAR(100),
          reporter_contact VARCHAR(100),
          passport_id VARCHAR(50),
          media_urls TEXT,
          status VARCHAR(30) DEFAULT 'new',
          assigned_agency VARCHAR(120),
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_incidents_category ON incidents(category);
        CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
        CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents(created_at DESC);
        CREATE TABLE IF NOT EXISTS incident_forwards (
          id SERIAL PRIMARY KEY,
          incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
          services JSONB,
          forwarded_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_incident_forwards_incident ON incident_forwards(incident_id);
      `);
      console.log('[DB] incidents tables ready');
    } catch (e) {
      console.warn('[DB] could not ensure incidents tables:', e && e.message);
    }
  } catch (err) {
    console.warn('[DB] ensureDatabaseShape encountered errors:', err && err.message);
  }
}

// --- CORS: Must be first, before any static or route handlers ---
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      const allow = /localhost|127\.0\.0\.1|ngrok|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\./i.test(origin);
      if (allow) return callback(null, true);
      return callback(null, true); // still allow all in dev (fallback)
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "ngrok-skip-browser-warning", "Authorization"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  })
);

// CORS for static profile images
app.use('/uploads/profile-images', (req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || '*');
  res.header("Access-Control-Allow-Credentials", "true");
  next();
});
// --- Profile Image Upload and Retrieval ---
const PROFILE_IMAGE_DIR = path.join(__dirname, 'uploads', 'profile-images');
try { if (!fs.existsSync(PROFILE_IMAGE_DIR)) fs.mkdirSync(PROFILE_IMAGE_DIR, { recursive: true }); } catch (e) {}
const profileImageStorage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, PROFILE_IMAGE_DIR); },
  filename: function (req, file, cb) {
    // Use passportId from session or body, fallback to uuid
    let safeBase = 'unknown';
    if (req.body.passportId) safeBase = String(req.body.passportId).replace(/[^a-zA-Z0-9_-]/g, '_');
    else if (req.family && req.family.passportId) safeBase = String(req.family.passportId).replace(/[^a-zA-Z0-9_-]/g, '_');
    else if (req.user && req.user.passportId) safeBase = String(req.user.passportId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const ts = Date.now();
    cb(null, `${safeBase}-profile-${ts}${path.extname(file.originalname || '')}`);
  }
});
const profileImageUpload = multer({ storage: profileImageStorage, limits: { fileSize: 5 * 1024 * 1024 } });

// POST /api/user/profile-image (upload profile image for current user)
app.post('/api/user/profile-image', profileImageUpload.single('profileImage'), async (req, res) => {
  try {
    const passportId = req.body.passportId || (req.family && req.family.passportId) || (req.user && req.user.passportId);
    if (!passportId || !req.file) return res.status(400).json({ message: 'passportId and image file are required.' });
    const imageUrl = `/uploads/profile-images/${req.file.filename}`;
    // Save image URL to users table (or tourists if needed)
    // Update tourists table according to schema (profile_picture_url column)
    try {
      await db.pool.query('UPDATE tourists SET profile_picture_url = $1 WHERE passport_id = $2', [imageUrl, passportId]);
    } catch (dbErr) {
      console.warn('Primary update (tourists.profile_picture_url) failed, trying users.profile_image:', dbErr && dbErr.message);
      await db.pool.query('UPDATE users SET profile_image = $1 WHERE passport_id = $2', [imageUrl, passportId]);
    }
    return res.status(200).json({ url: imageUrl });
  } catch (e) {
    console.error('Failed to upload profile image:', e && e.message);
    return res.status(500).json({ message: 'Failed to upload image.' });
  }
});
app.get('/api/user/profile-image', async (req, res) => {
  try {
    // Use session or query param to get passportId
    const passportId = (req.family && req.family.passportId) || req.query.passportId || req.user?.passportId;
    if (!passportId) return res.json({ url: null });
    let url = null;
    try {
      // Prefer explicit profile picture URL
      const result = await db.pool.query('SELECT profile_picture_url, passport_image_url FROM tourists WHERE passport_id = $1', [passportId]);
      url = result.rows[0]?.profile_picture_url || result.rows[0]?.passport_image_url || null;
    } catch (dbErr) {
      console.warn('Primary select (tourists.profile_picture_url) failed, trying users.profile_image:', dbErr && dbErr.message);
      const result2 = await db.pool.query('SELECT profile_image FROM users WHERE passport_id = $1', [passportId]);
      url = result2.rows[0]?.profile_image || null;
    }
    // Validate that the file exists on disk; if not, fall back to default avatar
    try {
      if (url && url.startsWith('/uploads/')) {
        const localPath = path.join(__dirname, url);
        const rootPath = path.join(__dirname, '..', url);
        const exists = fs.existsSync(localPath) || fs.existsSync(rootPath);
        if (!exists) {
          console.warn(`Profile image file missing for ${passportId}:`, url);
          url = '/uploads/profile-images/default-avatar.png';
        }
      }
    } catch (_) {}
    return res.json({ url });
  } catch (e) {
    return res.json({ url: null });
  }
});

// Serve a built-in default avatar if the file is missing on disk
// Note: This route is defined before express.static so it always works even without a file.
app.get('/uploads/profile-images/default-avatar.png', (req, res) => {
  const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#e0e0e0"/><stop offset="100%" stop-color="#c8c8c8"/></linearGradient></defs><rect width="256" height="256" fill="url(#g)"/><circle cx="128" cy="96" r="48" fill="#ffffff" fill-opacity="0.9"/><path d="M32 232c0-40.6 43-72 96-72s96 31.4 96 72" fill="#ffffff" fill-opacity="0.9"/></svg>`;
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.type('image/svg+xml').send(svg);
});

// Serve profile images statically with strong caching for faster loads
app.use('/uploads/profile-images', express.static(
  path.join(__dirname, 'uploads', 'profile-images'),
  {
    etag: true,
    lastModified: true,
    maxAge: '7d', // browser cache duration
    setHeaders: (res, filePath) => {
      // Immutable since filenames are content-hashed by timestamp; new uploads use new names
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      // Ensure CORS header on static (mirrors earlier middleware)
      // Note: Express may coalesce headers from earlier middleware
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      // Content-Type will be set automatically by express.static based on extension
    }
  }
));
// Also try serving uploads from repository root (in case files were saved at E:\Tourist System\uploads)
try {
  const rootUploads = path.join(__dirname, '..', 'uploads');
  if (fs.existsSync(rootUploads)) {
    app.use('/uploads', express.static(rootUploads));
    app.use('/uploads/profile-images', express.static(path.join(rootUploads, 'profile-images')));
  }
} catch (_) {}
// Kick off DB shape assurance ASAP (don't block startup)
ensureDatabaseShape().catch(() => {});
const server = http.createServer(app);
// Socket.IO server with dynamic CORS mirroring logic similar to Express middleware
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allow = /localhost|127\.0\.0\.1|ngrok|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\./i.test(origin);
      if (allow) return callback(null, true);
      return callback(null, true); // dev fallback
    },
    credentials: true,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "ngrok-skip-browser-warning", "Authorization"],
  },
  transports: ["websocket", "polling"],
});
const userSockets = new Map();
// Track connected admin dashboards (socket.id -> displayName)
const adminSockets = new Map();
// Simple in-memory store for recent admin notifications (last 50)
const adminNotifications = [];
const port = 3001;
const transporter = nodemailer.createTransport({
  service: "gmail", // Or 'outlook', etc.
  auth: {
    user: process.env.EMAIL_USER, // Replace with your email
    pass: process.env.EMAIL_PASS, // Replace with your generated App Password
  },
});
const snoozedGroups = new Map(); // Tracks snoozed groups and their expiry time
const alertResponses = new Map(); // Tracks active alert responses
// Family auth and alerts tracking (sessions and alerts in-memory; OTPs now persisted in DB)
// family_otps are stored in Postgres (see schema.sql)
const familySessions = new Map(); // token -> { email, passportId, name, createdAt }
const familyAlerts = new Map(); // passportId -> { current: { type: 'panic'|'standard', startedAt, lat, lon, services? }, resolved: [ { type, lat, lon, resolvedAt } ] }
const familySocketSubscriptions = new Map(); // passportId -> Set of sockets listening for live updates
const socketFamilyMeta = new Map(); // socket.id -> { passportId }

const FAMILY_OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FAMILY_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (basic)

const createFamilyToken = () => `fam_${uuidv4()}`;

function getValidFamilySession(token) {
  if (!token) return null;
  const sess = familySessions.get(token);
  if (!sess) return null;
  if ((Date.now() - (sess.createdAt || 0)) > FAMILY_SESSION_TTL_MS) {
    familySessions.delete(token);
    return null;
  }
  return sess;
}

function subscribeFamilySocket(passportId, socket) {
  if (!passportId || !socket) return;
  if (!familySocketSubscriptions.has(passportId)) {
    familySocketSubscriptions.set(passportId, new Set());
  }
  familySocketSubscriptions.get(passportId).add(socket);
  socketFamilyMeta.set(socket.id, { passportId });
}

function unsubscribeFamilySocket(socket) {
  if (!socket) return;
  const meta = socketFamilyMeta.get(socket.id);
  if (meta && meta.passportId && familySocketSubscriptions.has(meta.passportId)) {
    const set = familySocketSubscriptions.get(meta.passportId);
    set.delete(socket);
    if (set.size === 0) {
      familySocketSubscriptions.delete(meta.passportId);
    }
  }
  socketFamilyMeta.delete(socket.id);
}

function emitToFamily(passportId, eventName, payload, targetSocket = null) {
  if (!passportId || !eventName) return;
  const sockets = targetSocket ? [targetSocket] : Array.from(familySocketSubscriptions.get(passportId) || []);
  sockets.forEach((sock) => {
    if (!sock || !sock.connected) {
      if (sock) unsubscribeFamilySocket(sock);
      return;
    }
    try { sock.emit(eventName, payload); } catch (err) {
      console.warn('Failed to emit family event', eventName, err && err.message);
    }
  });
}

async function loadFamilySnapshot(passportId) {
  if (!passportId) return null;
  try {
    const res = await db.pool.query(
      `SELECT passport_id, name, latitude, longitude, last_seen, status
       FROM tourists WHERE passport_id = $1 LIMIT 1`,
      [passportId]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      passportId: row.passport_id,
      name: row.name,
      latitude: row.latitude,
      longitude: row.longitude,
      lastSeen: row.last_seen,
      status: row.status,
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn('Failed to fetch family snapshot:', err && err.message);
    return null;
  }
}

// Simple bearer-token based family auth middleware (uses in-memory familySessions)
function requireFamilyAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    const token = m ? m[1] : null;
    const sess = getValidFamilySession(token);
    if (!sess) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    req.family = { email: sess.email, passportId: sess.passportId, name: sess.name };
    return next();
  } catch (e) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

function setCurrentAlert(passportId, alert) {
  if (!passportId || !alert) return;
  const entry = familyAlerts.get(passportId) || { current: null, resolved: [] };
  entry.current = {
    type: alert.type,
    startedAt: alert.startedAt || Date.now(),
    lat: alert.lat ?? null,
    lon: alert.lon ?? null,
    services: alert.services || null,
    source: alert.source || null,
    details: alert.details || null,
  };
  familyAlerts.set(passportId, entry);
  emitToFamily(passportId, 'familyAlertUpdate', { status: 'active', alert: { ...entry.current } });
}

function resolveCurrentAlert(passportId) {
  if (!passportId) return;
  const entry = familyAlerts.get(passportId);
  if (!entry || !entry.current) return;
  const { current } = entry;
  entry.resolved = entry.resolved || [];
  const resolvedRecord = {
    type: current.type,
    lat: current.lat ?? null,
    lon: current.lon ?? null,
    resolvedAt: Date.now(),
  };
  entry.resolved.unshift(resolvedRecord);
  entry.current = null;
  // keep only last 20
  entry.resolved = entry.resolved.slice(0, 20);
  emitToFamily(passportId, 'familyAlertResolved', { resolved: resolvedRecord });
}

function normalizeEmergencyPhone(input) {
  if (!input && input !== 0) return null;
  let raw = String(input).trim();
  if (!raw) return null;
  const hasPlus = raw.startsWith('+');
  raw = raw.replace(/[^0-9]/g, '');
  if (!raw) return null;
  return hasPlus ? `+${raw}` : null;
}

function formatWhatsAppAddress(number) {
  if (!number) return null;
  return number.startsWith('whatsapp:') ? number : `whatsapp:${number}`;
}

async function notifyEmergencyContacts({
  passportId,
  latitude = null,
  longitude = null,
  alertType = 'panic',
  location = null,
  source = null,
} = {}) {
  if (!passportId) return;
  try {
    const res = await db.pool.query(
      `SELECT name, emergency_contact, emergency_contact_1, emergency_contact_2,
              emergency_contact_email_1, emergency_contact_email_2
       FROM tourists WHERE passport_id = $1 LIMIT 1`,
      [passportId]
    );
    if (res.rows.length === 0) return;
    const row = res.rows[0];
    const touristName = row.name || passportId;
    const emails = Array.from(new Set([
      row.emergency_contact_email_1,
      row.emergency_contact_email_2,
    ].filter(Boolean)));
    const phoneCandidates = [row.emergency_contact, row.emergency_contact_1, row.emergency_contact_2].filter(Boolean);

    const mapLink = (Number.isFinite(latitude) && Number.isFinite(longitude))
      ? `https://www.google.com/maps?q=${latitude},${longitude}`
      : null;
    const alertLabel = alertType === 'panic' ? 'Panic Alert' : 'Safety Alert';
    const triggeredAt = new Date().toISOString();
    const plainLines = [
      `${alertLabel} triggered by ${touristName}`,
      `Passport ID: ${passportId}`,
      source ? `Source: ${source}` : null,
      location ? `Reported Location: ${location}` : null,
      Number.isFinite(latitude) && Number.isFinite(longitude) ? `Coordinates: ${latitude}, ${longitude}` : null,
      mapLink ? `Map Link: ${mapLink}` : null,
      `Triggered At: ${triggeredAt}`,
      '',
      'This alert was sent automatically by Smart Tourist Safety.',
    ].filter(Boolean);
    const textBody = plainLines.join('\n');
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2 style="color:#dc2626; margin-bottom:8px;">${alertLabel} - Immediate Attention Required</h2>
        <p><strong>Traveler:</strong> ${touristName} (${passportId})</p>
        ${source ? `<p><strong>Source:</strong> ${source}</p>` : ''}
        ${location ? `<p><strong>Reported Location:</strong> ${location}</p>` : ''}
        ${(Number.isFinite(latitude) && Number.isFinite(longitude)) ? `<p><strong>Coordinates:</strong> ${latitude}, ${longitude}</p>` : ''}
        ${mapLink ? `<p><a href="${mapLink}" target="_blank" rel="noopener">Open in Google Maps</a></p>` : ''}
        <p><strong>Triggered At:</strong> ${triggeredAt}</p>
        <p style="margin-top:16px;">This message was dispatched automatically by Smart Tourist Safety.</p>
      </div>
    `;

    await Promise.all(emails.map(async (to) => {
      try {
        await transporter.sendMail({
          from: '"Smart Tourist Safety" <smarttouristsystem@gmail.com>',
          to,
          subject: `[${alertLabel}] ${touristName} needs assistance`,
          text: textBody,
          html: htmlBody,
        });
      } catch (err) {
        console.warn('Failed to email emergency contact:', to, err && err.message);
      }
    }));

    if (twilioClient && twilioConfig.enable) {
      const normalized = phoneCandidates
        .map(normalizeEmergencyPhone)
        .find(Boolean);
      if (normalized) {
        const messageBody = `${alertLabel}: ${touristName} (${passportId}) – ${mapLink ? mapLink : 'coordinates shared via email.'}`;
        let sent = false;
        if (twilioConfig.whatsappFrom) {
          try {
            await twilioClient.messages.create({
              from: formatWhatsAppAddress(twilioConfig.whatsappFrom),
              to: formatWhatsAppAddress(normalized),
              body: messageBody,
            });
            sent = true;
          } catch (err) {
            console.warn('WhatsApp alert send failed:', err && err.message);
          }
        }
        if (!sent && twilioConfig.smsFrom && twilioConfig.allowSmsFallback) {
          try {
            await twilioClient.messages.create({
              from: twilioConfig.smsFrom,
              to: normalized,
              body: messageBody,
            });
            sent = true;
          } catch (err) {
            console.warn('SMS alert send failed:', err && err.message);
          }
        }
        if (!sent) {
          console.log('Emergency message not sent (no free channel available or send failed).');
        }
      }
    }
  } catch (err) {
    console.error('Failed to notify emergency contacts:', err && err.message);
  }
}

if (typeof womenService.setEmergencyNotifier === 'function') {
  womenService.setEmergencyNotifier(async (payload = {}) => {
    const {
      passportId,
      latitude = null,
      longitude = null,
      alertType = 'panic',
      location = null,
      source = 'women-sos',
    } = payload || {};
    if (passportId) {
      setCurrentAlert(passportId, {
        type: alertType || 'panic',
        startedAt: Date.now(),
        lat: latitude,
        lon: longitude,
        source,
      });
    }
    await notifyEmergencyContacts({ passportId, latitude, longitude, alertType, location, source });
  });
}

// Call Smart-anomly-detector /predict for a single point
const detectorPredictPoint = async (
  { lat, lon, passportId, groupId = null },
  timeout = 5000
) => {
  try {
    const nowISO = new Date().toISOString();
    const sessionId = hashToInt(passportId) % 1000000000;
    const userId = sessionId; // stable per passport
    const payload = {
      session_id: sessionId,
      user_id: userId,
      group_id: Number.isFinite(groupId) ? groupId : null,
      lat,
      lon,
      timestamp: nowISO,
    };
    const res = await axios.post(`${AI_SERVICE_URL}/predict`, payload, {
      headers: { "ngrok-skip-browser-warning": "true" },
      timeout,
    });
    return res.data;
  } catch (err) {
    console.warn(`Detector call failed (/predict):`, err.message || err);
    return null;
  }
};

const storage = multer.diskStorage({
  destination: "./uploads/",
  filename: function (req, file, cb) {
    cb(
      null,
      "profile-" +
        req.body.passportId +
        "-" +
        Date.now() +
        path.extname(file.originalname)
    );
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 1000000 }, // Limit file size to 1MB
}).single("profilePicture");

// Allow credentials (HTTP-only cookies) and echo origin to support various frontends (ngrok/local)
// Allow credentials and handle ngrok URLs properly
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      // Allow localhost and ngrok URLs
  if (/localhost|127\.0\.0\.1|ngrok|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\./i.test(origin)) {
        return callback(null, true);
      }

      // For other origins, you can either allow them or deny
      return callback(null, true); // Allow all for development
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "ngrok-skip-browser-warning", "Authorization"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  })
);

// Ensure OPTIONS preflight requests are handled by cors as well
// Use '/*' to avoid path-to-regexp errors with a bare '*'
// Fallback middleware: echo Origin and ensure credentialed CORS headers for all routes
// This helps when requests come through proxies (ngrok) that require the exact Origin to be echoed
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && /localhost|127\.0\.0\.1|ngrok|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\./i.test(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
    res.header(
      "Access-Control-Allow-Methods",
      "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS"
    );
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type,ngrok-skip-browser-warning,Authorization"
    );
  }
  if (req.method === "OPTIONS") {
    // Short-circuit preflight requests
    return res.sendStatus(204);
  }
  next();
});

app.use(cookieParser());
app.use(express.json());
app.use("/uploads", express.static("uploads"));
// Serve recordings so admin can fetch and play them
app.use("/recordings", express.static(path.join(__dirname, "recordings")));

// Simple health endpoint to debug tunnel / CORS issues
app.get('/health', (req, res) => {
  res.json({ ok: true, time: Date.now(), ip: req.ip });
});

// Global error handler for multer and other errors to prevent generic 500s on uploads
app.use((err, req, res, next) => {
  if (err && err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'File too large. Max 5MB.' });
    }
    return res.status(400).json({ message: `Upload error: ${err.message}` });
  }
  return next(err);
});

// Ensure profile upload directory exists
const PROFILE_DIR = path.join(__dirname, 'uploads', 'profiles');
try { if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true }); } catch (e) {}

// Multer for profile form files (three possible file fields)
const profileStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, PROFILE_DIR);
  },
  filename: function (req, file, cb) {
    const safeBase = (req.body.passportId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
    const ts = Date.now();
    cb(null, `${safeBase}-${file.fieldname}-${ts}${path.extname(file.originalname || '')}`);
  }
});
const profileUpload = multer({ storage: profileStorage, limits: { fileSize: 5 * 1024 * 1024 } });

// ---------------- Citizen Safety: Incidents REST API ----------------
// Create incident
app.post(
  '/api/v1/incidents',
  [
    body('category').isString().isLength({ min: 3 }).withMessage('category required'),
    body('description').optional().isString(),
    body('latitude').optional().isFloat({ min: -90, max: 90 }),
    body('longitude').optional().isFloat({ min: -180, max: 180 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const payload = {
        category: String(req.body.category).toLowerCase(),
        sub_type: req.body.sub_type || null,
        description: req.body.description || null,
        latitude: req.body.latitude != null ? parseFloat(req.body.latitude) : null,
        longitude: req.body.longitude != null ? parseFloat(req.body.longitude) : null,
        reporter_type: req.body.reporter_type || 'citizen',
        reporter_name: req.body.reporter_name || null,
        reporter_contact: req.body.reporter_contact || null,
        passport_id: req.body.passport_id || null,
        media_urls: req.body.media_urls ? JSON.stringify(req.body.media_urls) : null,
      };
      const row = await db.createIncident(payload);
      // Auto-forward certain categories
      let forward = null;
      if (['women_safety','street_animal','tourist_safety','fire','medical','police'].includes(payload.category)) {
        forward = await govConnector.notifyIncident(row);
        await db.createIncidentForward(row.id, forward.services || {});
        await db.updateIncident(row.id, { status: 'forwarded', assigned_agency: payload.category });
      }
      return res.status(201).json({ incident: await db.getIncident(row.id), forward });
    } catch (e) {
      console.error('create incident failed:', e);
      return res.status(500).json({ message: 'Failed to create incident' });
    }
  }
);

// List incidents
app.get('/api/v1/incidents', async (req, res) => {
  try {
    const { category, status, limit, offset } = req.query;
    const items = await db.listIncidents({
      category: category ? String(category).toLowerCase() : undefined,
      status: status ? String(status).toLowerCase() : undefined,
      limit: limit ? Math.min(parseInt(limit, 10) || 50, 200) : 50,
      offset: offset ? parseInt(offset, 10) || 0 : 0,
    });
    return res.json({ incidents: items });
  } catch (e) {
    return res.status(500).json({ message: 'Failed to list incidents' });
  }
});

// Update incident
app.patch('/api/v1/incidents/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });
    const patch = {};
    ['status','assigned_agency','description','media_urls','sub_type'].forEach(k => {
      if (k in req.body) patch[k] = req.body[k];
    });
    const updated = await db.updateIncident(id, patch);
    return res.json({ incident: updated });
  } catch (e) {
    return res.status(500).json({ message: 'Failed to update incident' });
  }
});
// Endpoint to save user profile
app.post('/api/user/profile', profileUpload.fields([
  { name: 'passportMain', maxCount: 1 },
  { name: 'passportSecondary', maxCount: 1 },
  { name: 'visaDetails', maxCount: 1 },
]), async (req, res) => {
  try {
    // Echo CORS with credentials when proxied via ngrok
    const origin = req.headers.origin;
    if (origin && /localhost|127\.0\.0\.1|ngrok|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\./i.test(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('ngrok-skip-browser-warning', 'true');

    const {
      fullName, contactNumber, email, passportId, country,
      visaId, visaExpiry, emergencyPhone1, emergencyEmail1,
      emergencyPhone2, emergencyEmail2,
    } = req.body;

    const files = req.files || {};
    const filePath = (arr) => (Array.isArray(arr) && arr[0] && arr[0].filename) ? `/uploads/profiles/${arr[0].filename}` : null;

    const passportMainUrl = filePath(files.passportMain);
    const passportSecondaryUrl = filePath(files.passportSecondary);
    const visaDetailsUrl = filePath(files.visaDetails);

    // Compute completeness (required fields + essential files)
    const requiredForComplete = [
      fullName, contactNumber, email, passportId, country, visaId, visaExpiry,
      emergencyPhone1, emergencyEmail1, emergencyPhone2, emergencyEmail2,
    ];
    // We require at least main passport and visa details files to be present
    const profileComplete = requiredForComplete.every(Boolean) && (!!passportMainUrl || !!req.body.passportMainUrl) && (!!visaDetailsUrl || !!req.body.visaDetailsUrl);

    // Persist full profile to tourists
    try {
      // Update text fields first
      await db.pool.query(
        `UPDATE tourists SET
          name = $1,
          emergency_contact = $2,
          country = $3,
          visa_id = $4,
          visa_expiry = $5,
          emergency_contact_1 = $6,
          emergency_contact_email_1 = $7,
          emergency_contact_2 = $8,
          emergency_contact_email_2 = $9,
          profile_complete = $10
        WHERE passport_id = $11`,
        [
          fullName || null,
          contactNumber || null,
          country || null,
          visaId || null,
          visaExpiry || null,
          emergencyPhone1 || null,
          emergencyEmail1 || null,
          emergencyPhone2 || null,
          emergencyEmail2 || null,
          !!profileComplete,
          passportId,
        ]
      );

      // Update file URL columns only if new files uploaded (avoid overwriting with null)
      if (passportMainUrl || passportSecondaryUrl || visaDetailsUrl) {
        await db.pool.query(
          `UPDATE tourists SET
            passport_image_url = COALESCE($1, passport_image_url),
            passport_image_secondary_url = COALESCE($2, passport_image_secondary_url),
            visa_image_url = COALESCE($3, visa_image_url)
          WHERE passport_id = $4`,
          [passportMainUrl, passportSecondaryUrl, visaDetailsUrl, passportId]
        );
      }
    } catch (e) {
      console.error('Failed to persist profile:', e && e.message);
      return res.status(500).json({ message: 'Failed to save profile.' });
    }

    const payload = {
      fullName, contactNumber, email, passportId, country,
      visaId, visaExpiry, emergencyPhone1, emergencyEmail1,
      emergencyPhone2, emergencyEmail2,
      passportMain: passportMainUrl,
      passportSecondary: passportSecondaryUrl,
      visaDetails: visaDetailsUrl,
      profileComplete,
    };
    console.log('Saved profile submission:', payload);

    return res.status(200).json({ message: 'Profile saved successfully!', profileComplete });
  } catch (err) {
    console.error('Error saving profile:', err && err.message);
    return res.status(500).json({ message: 'Failed to save profile.' });
  }
});

// Fetch profile details
app.get('/api/user/profile', async (req, res) => {
  try {
    const origin = req.headers.origin;
    if (origin && (origin.includes('localhost') || origin.includes('ngrok') || origin.includes('127.0.0.1'))) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('ngrok-skip-browser-warning', 'true');

    // Accept multiple identifiers: passportId (incl. WOMEN-<id>), email, aadhaar
    const qp = req.query || {};
    const qpPassportId = qp.passportId || (req.cookies && (req.cookies.passportId || (req.cookies.womenUserId ? `WOMEN-${req.cookies.womenUserId}` : undefined)));
    const qpEmail = (qp.email || '').trim().toLowerCase();
    const aadhaarRaw = qp.aadhaar || qp.aadhaarId || qp.aadhaar_number || '';
    const qpAadhaar = normalizeGovernmentId(aadhaarRaw, 'aadhaar');
    const qpServiceType = (qp.serviceType || '').toLowerCase();

    const womenMatch = qpPassportId ? String(qpPassportId).match(/^WOMEN-(\d+)$/i) : null;
    const isWomenFlow = !!(womenMatch || qpServiceType === 'women_safety' || req.cookies?.womenUserId);

    // Helper: map women row to profile payload
    const mapWomen = async (w) => {
      let e1 = '', e1e = '', e2 = '', e2e = '';
      try {
        const ec = await db.pool.query(
          'SELECT mobile_number, email FROM women_emergency_contacts WHERE user_id = $1 ORDER BY priority NULLS LAST, id LIMIT 2',
          [w.id]
        );
        if (ec.rows[0]) { e1 = ec.rows[0].mobile_number || ''; e1e = ec.rows[0].email || ''; }
        if (ec.rows[1]) { e2 = ec.rows[1].mobile_number || ''; e2e = ec.rows[1].email || ''; }
      } catch (_) {}
      return {
        fullName: w.name || '',
        contactNumber: w.mobile_number || '',
        email: w.email || '',
        passportId: `WOMEN-${w.id}`,
        serviceType: 'women_safety',
        country: '',
        visaId: '',
        visaExpiry: '',
        emergencyPhone1: e1,
        emergencyEmail1: e1e,
        emergencyPhone2: e2,
        emergencyEmail2: e2e,
        files: { passportMain: null, passportSecondary: null, visaDetails: null },
        profileComplete: !!(w.name && w.mobile_number && w.email),
      };
    };

    if (isWomenFlow) {
      // 1) Try WOMEN-<id> if provided
      if (womenMatch) {
        const womenId = parseInt(womenMatch[1], 10);
        if (!Number.isFinite(womenId)) return res.status(400).json({ message: 'Invalid women user id' });
        const wq = await db.pool.query(
          `SELECT id, name, email, mobile_number, aadhaar_number, status, profile_picture_url FROM women_users WHERE id = $1`,
          [womenId]
        );
        if (wq.rows.length > 0) return res.json(await mapWomen(wq.rows[0]));
        // Fallbacks if ID not found
      }
      // 2) Try via email
      if (qpEmail) {
        const wq2 = await db.pool.query(
          `SELECT id, name, email, mobile_number, aadhaar_number, status, profile_picture_url FROM women_users WHERE lower(email) = $1`,
          [qpEmail]
        );
        if (wq2.rows.length > 0) return res.json(await mapWomen(wq2.rows[0]));
      }
      // 3) Try via Aadhaar
      if (qpAadhaar) {
        const wq3 = await db.pool.query(
          `SELECT id, name, email, mobile_number, aadhaar_number, status, profile_picture_url FROM women_users WHERE aadhaar_number = $1`,
          [qpAadhaar]
        );
        if (wq3.rows.length > 0) return res.json(await mapWomen(wq3.rows[0]));
      }
      // 4) Try cookie womenUserId
      if (req.cookies?.womenUserId) {
        const cid = parseInt(req.cookies.womenUserId, 10);
        if (Number.isFinite(cid)) {
          const wq4 = await db.pool.query(
            `SELECT id, name, email, mobile_number, aadhaar_number, status, profile_picture_url FROM women_users WHERE id = $1`,
            [cid]
          );
          if (wq4.rows.length > 0) return res.json(await mapWomen(wq4.rows[0]));
        }
      }
      return res.status(404).json({ message: 'User not found by provided identifier(s).' });
    }

    // Tourist/general/citizen path: allow lookup by passportId OR email OR aadhaar
    let row = null;
    if (qpPassportId) {
      const q = await db.pool.query(
        `SELECT 
          name, emergency_contact, email, passport_id,
          country, visa_id, visa_expiry,
          emergency_contact_1, emergency_contact_email_1,
          emergency_contact_2, emergency_contact_email_2,
          passport_image_url, passport_image_secondary_url, visa_image_url,
          profile_complete, service_type
        FROM tourists WHERE passport_id = $1`,
        [qpPassportId]
      );
      if (q.rows.length > 0) row = q.rows[0];
    }
    if (!row && qpEmail) {
      const q2 = await db.pool.query(
        `SELECT 
          name, emergency_contact, email, passport_id,
          country, visa_id, visa_expiry,
          emergency_contact_1, emergency_contact_email_1,
          emergency_contact_2, emergency_contact_email_2,
          passport_image_url, passport_image_secondary_url, visa_image_url,
          profile_complete, service_type
        FROM tourists WHERE lower(email) = $1`,
        [qpEmail]
      );
      if (q2.rows.length > 0) row = q2.rows[0];
    }
    if (!row && qpAadhaar) {
      const q3 = await db.pool.query(
        `SELECT 
          name, emergency_contact, email, passport_id,
          country, visa_id, visa_expiry,
          emergency_contact_1, emergency_contact_email_1,
          emergency_contact_2, emergency_contact_email_2,
          passport_image_url, passport_image_secondary_url, visa_image_url,
          profile_complete, service_type
        FROM tourists WHERE passport_id = $1 OR (id_type = 'aadhaar' AND passport_id = $1)`,
        [qpAadhaar]
      );
      if (q3.rows.length > 0) row = q3.rows[0];
    }
    if (!row) return res.status(404).json({ message: 'User not found' });

    return res.json({
      fullName: row.name || '',
      contactNumber: row.emergency_contact || '',
      email: row.email || '',
      passportId: row.passport_id,
      serviceType: row.service_type || (qpServiceType || 'general_safety'),
      country: row.country || '',
      visaId: row.visa_id || '',
      visaExpiry: row.visa_expiry || '',
      emergencyPhone1: row.emergency_contact_1 || '',
      emergencyEmail1: row.emergency_contact_email_1 || '',
      emergencyPhone2: row.emergency_contact_2 || '',
      emergencyEmail2: row.emergency_contact_email_2 || '',
      files: {
        passportMain: row.passport_image_url || null,
        passportSecondary: row.passport_image_secondary_url || null,
        visaDetails: row.visa_image_url || null,
      },
      profileComplete: !!row.profile_complete,
    });
  } catch (err) {
    console.error('Error in GET /api/user/profile:', err && err.message);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Keep recording streams at module level so we can close them from any socket handler
const recordingStreams = {};

const { spawn } = require('child_process');

// Helper to try converting a webm file to mp3 using ffmpeg (if available)
const tryConvertToMp3 = (webmPath, mp3Path) => {
  return new Promise((resolve) => {
    // Spawn ffmpeg -y to overwrite if exists
    const ff = spawn('ffmpeg', ['-y', '-i', webmPath, '-vn', '-acodec', 'libmp3lame', '-ar', '44100', '-ac', '2', mp3Path]);
    let stderr = '';
    ff.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    ff.on('close', (code) => {
      if (code === 0) return resolve({ ok: true });
      console.warn('ffmpeg conversion failed:', code, stderr.slice(0,200));
      return resolve({ ok: false, error: stderr });
    });
    ff.on('error', (err) => {
      console.warn('ffmpeg spawn error (maybe not installed):', err.message);
      return resolve({ ok: false, error: err.message });
    });
  });
};

io.on("connection", (socket) => {
  console.log("A user connected with socket id:", socket.id);

  socket.on("identify", (passportId) => {
    console.log(`Socket ${socket.id} identified as user ${passportId}`);
    userSockets.set(passportId, socket); // Save the user's socket
  });

  // Admin dashboard identification (supports multiple admins)
  socket.on('identifyAdmin', (adminName) => {
    try {
      const name = (adminName && String(adminName).trim()) || `admin-${socket.id.slice(-4)}`;
      adminSockets.set(socket.id, name);
      io.emit('adminListUpdate', Array.from(adminSockets.values()));
      console.log(`Registered admin socket ${socket.id} as '${name}'`);
      // Send current notifications history only to this admin
      try { socket.emit('adminNotificationsInit', adminNotifications.slice()); } catch (_) {}
    } catch (e) {
      console.warn('identifyAdmin failed:', e && e.message);
    }
  });

  socket.on('identifyFamily', async (payload, ack) => {
    try {
      const token = typeof payload === 'string' ? payload : payload?.token;
      const sess = getValidFamilySession(token);
      if (!sess) {
        if (typeof ack === 'function') ack({ ok: false, error: 'UNAUTHORIZED' });
        return;
      }
      unsubscribeFamilySocket(socket);
      subscribeFamilySocket(sess.passportId, socket);
      const snapshot = await loadFamilySnapshot(sess.passportId);
      const currentAlert = familyAlerts.get(sess.passportId)?.current || null;
      if (typeof ack === 'function') {
        ack({ ok: true, passportId: sess.passportId, snapshot, alert: currentAlert });
      }
      if (snapshot) emitToFamily(sess.passportId, 'familyLocationInit', snapshot, socket);
      if (currentAlert) emitToFamily(sess.passportId, 'familyAlertUpdate', { status: 'active', alert: { ...currentAlert } }, socket);
    } catch (err) {
      console.warn('identifyFamily failed:', err && err.message);
      if (typeof ack === 'function') ack({ ok: false, error: 'SERVER_ERROR' });
    }
  });

  socket.on("disconnect", () => {
    console.log(`Socket ${socket.id} disconnected.`);
    // Clean up the map on disconnect
    for (const [passportId, userSocket] of userSockets.entries()) {
      if (userSocket.id === socket.id) {
        userSockets.delete(passportId);
        break;
      }
    }
    if (adminSockets.has(socket.id)) {
      adminSockets.delete(socket.id);
      io.emit('adminListUpdate', Array.from(adminSockets.values()));
    }
    unsubscribeFamilySocket(socket);
  });

  socket.on('testPing', (data, cb) => {
    console.log('Received testPing from socket', socket.id, 'data:', data);
    if (typeof cb === 'function') cb({ ok: true });
  });

  socket.on(
    "dislocationResponse",
    async ({ groupName, passportId, response }) => {
      try {
        console.log(
          `Received response from ${passportId} for group ${groupName}: ${response}`
        );

        const alertState = alertResponses.get(groupName);
        if (!alertState) return; // Ignore response if no alert is active

        // Always remove this responder from pending set to avoid re-alerting them
        alertState.membersToRespond.delete(passportId);

        const lower = String(response || '').toLowerCase();
        if (lower === "no") {
          io.emit("adminDislocationAlert", {
            groupName,
            dislocatedMember: passportId,
            message: `${passportId} reported they are NOT with their group. Immediate attention required.`,
          });
          try {
            const dislocatedMember = await db.getTouristByPassportId(passportId);
            if (dislocatedMember && dislocatedMember.latitude) {
              const services = await findNearbyServices(
                dislocatedMember.latitude,
                dislocatedMember.longitude
              );
              if (services) {
                io.emit("emergencyResponseDispatched", {
                  passport_id: passportId,
                  message: `Services located near dislocated member.`,
                  services,
                });
              }
            }
          } catch (svcErr) {
            console.warn("Service lookup failed (non-fatal):", svcErr.message);
          }
          // Snooze group for a short cooldown; stop further alerts
          const SNOOZE_MS = 5 * 60 * 1000;
          snoozedGroups.set(groupName, Date.now() + SNOOZE_MS);
          alertResponses.delete(groupName);
          return;
        }

        if (lower === "yes") {
          if (alertState.membersToRespond.size === 0) {
            io.emit("adminDislocationAlert", {
              groupName,
              message:
                `All members of ${groupName} confirmed they are aware and together. Snoozing further checks briefly.`,
            });
            const SNOOZE_MS = 2 * 60 * 1000;
            snoozedGroups.set(groupName, Date.now() + SNOOZE_MS);
            alertResponses.delete(groupName);
          }
          return;
        }
      } catch (err) {
        console.warn("Error processing dislocationResponse:", err && err.message);
      }
    }
  );

  // Removed socket-based audio streaming: the client now uploads final recording via HTTP POST.
});

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function checkGroupDislocation() {
  console.log("Running scheduled check for group dislocation...");
  try {
    const groups = await db.getAllActiveGroups();
    for (const group of groups) {
      const groupName = group.group_name;

      // Skip snoozed groups
      if (
        snoozedGroups.has(groupName) &&
        Date.now() < snoozedGroups.get(groupName)
      ) {
        console.log(`Group ${groupName} is snoozed. Skipping.`);
        continue;
      } else {
        snoozedGroups.delete(groupName); // Snooze expired
      }

      const members = await db.getGroupMembersWithLocation(group.id);
      if (members.length < 2) continue;

      let isDislocated = false;
      let alertDetails = {};

      // Check for dislocation
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const memberA = members[i];
          const memberB = members[j];
          if (!memberA.latitude || !memberB.latitude) continue;

          const distance = getDistance(
            memberA.latitude,
            memberA.longitude,
            memberB.latitude,
            memberB.longitude
          );
          const DISTANCE_THRESHOLD_KM = 1.0;

          if (distance > DISTANCE_THRESHOLD_KM) {
            isDislocated = true;
            alertDetails = {
              groupName: groupName,
              dislocatedMember: memberA.name,
              otherMember: memberB.name,
              distance: distance.toFixed(2),
            };
            break;
          }
        }
        if (isDislocated) break;
      }

      // --- NEW ALERT MANAGEMENT LOGIC ---
      if (isDislocated) {
        let alertState = alertResponses.get(groupName);

        if (!alertState) {
          // First time this dislocation is detected, create a new alert state
          console.log(
            `New dislocation detected for group ${groupName}. Sending first alert.`
          );
          alertState = {
            membersToRespond: new Set(members.map((m) => m.passport_id)),
            alertCount: 1,
          };
          alertResponses.set(groupName, alertState);
          // Notify admin dashboards immediately about new dislocation
          io.emit("adminDislocationAlert", {
            groupName,
            dislocatedMember: alertDetails.dislocatedMember,
            otherMember: alertDetails.otherMember,
            distanceKm: alertDetails.distance,
            message: `Group dislocation detected in ${groupName}: ${alertDetails.dislocatedMember} is separated from ${alertDetails.otherMember}.`
          });
          // Also send a legacy / broad event name if clients listen for it
          io.emit("dislocationAlert", {
            groupName,
            dislocatedMember: alertDetails.dislocatedMember,
            otherMember: alertDetails.otherMember,
            distanceKm: alertDetails.distance,
            message: `Dislocation detected: ${alertDetails.dislocatedMember} is away from ${alertDetails.otherMember} by ${alertDetails.distance} km.`
          });
        } else {
          // Alert is already pending, this is a subsequent check
          alertState.alertCount++;
          console.log(
            `Re-sending alert to group ${groupName}. Count: ${alertState.alertCount}`
          );
        }

        if (alertState.alertCount > 3) {
          // Timeout condition: 3 alerts sent with no full resolution
          console.log(
            `Group ${groupName} failed to respond after 3 alerts. Notifying admin.`
          );
          io.emit("adminDislocationAlert", {
            groupName: groupName,
            message: `Group members did not respond to dislocation alert for ${alertDetails.dislocatedMember}.`,
          });
          alertResponses.delete(groupName); // Clean up
        } else {
          // Send alert to all members who have not yet responded 'yes'
          alertState.membersToRespond.forEach((passportId) => {
            const memberSocket = userSockets.get(passportId);
            if (memberSocket) {
              memberSocket.emit("geoFenceAlert", { type: 'group-dislocation', ...alertDetails });
            }
          });
        }
      } else {
        // If the group is no longer dislocated, clear any pending alerts
        if (alertResponses.has(groupName)) {
          console.log(
            `Group ${groupName} is back together. Clearing pending alert.`
          );
          alertResponses.delete(groupName);
        }
      }
    }
  } catch (error) {
    console.error("Error in checkGroupDislocation job:", error.message);
  }
}
setInterval(checkGroupDislocation, 30000);

// --- API Endpoints ---

app.post(
  "/api/v1/auth/register",
  body("email").isEmail().withMessage("Please provide a valid email address."),
  body("name")
    .isLength({ min: 2 })
    .withMessage("Name must be at least 2 characters long."),
  body("passportId").notEmpty().withMessage("Government ID is required."),
  body("phone").notEmpty().withMessage("Phone number is required."),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { name, passportId, phone, email, service_type, idType } = req.body;
    const serviceType = service_type || 'general_safety'; // Default to general_safety
    const rawIdType = typeof idType === 'string' ? idType.trim().toLowerCase() : '';
    const resolvedIdType = ['passport', 'aadhaar'].includes(rawIdType)
      ? rawIdType
      : (serviceType === 'tourist_safety' ? 'passport' : 'aadhaar');
    const identifier = typeof passportId === 'string' ? passportId.trim() : passportId;
    const normalizedEmail = typeof email === 'string' ? email.trim() : email;
    const sanitizedPhone = sanitizePhoneNumber(phone);

    if (!identifier) {
      return res.status(400).json({ message: 'Government ID is required.' });
    }
    if (!sanitizedPhone) {
      return res.status(400).json({ message: 'Please provide a valid phone number.' });
    }

    try {
      if (serviceType === 'women_safety') {
        const normalizedAadhaar = normalizeGovernmentId(identifier, 'aadhaar');
        if (!normalizedAadhaar) {
          return res.status(400).json({ message: 'Please provide a valid Aadhaar number.' });
        }

      const normalizedEmailLower = normalizedEmail ? normalizedEmail.toLowerCase() : null;
      const normalizedAadhaarOrNull = normalizedAadhaar || null;
      const normalizedEmailOrNull = normalizedEmailLower || null;
        const verificationCode = generateCode();
        const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

        const existingWomen = await db.pool.query(
          `SELECT id, is_verified, email, mobile_number, aadhaar_number
           FROM women_users
        WHERE mobile_number = $1
          OR LOWER(email) = LOWER($2::text)
          OR aadhaar_number = $3::text
           LIMIT 1`,
       [sanitizedPhone, normalizedEmailOrNull, normalizedAadhaarOrNull]
        );

        if (existingWomen.rows.length > 0) {
          const existing = existingWomen.rows[0];
          if (existing.is_verified) {
            return res.status(400).json({ message: 'An account with these details already exists. Please log in instead.' });
          }

          await db.pool.query(
            `UPDATE women_users
             SET name = $1,
                 mobile_number = $2,
                 aadhaar_number = $3,
                 email = $4,
                 otp_code = $5,
                 otp_expires_at = $6,
                 updated_at = NOW(),
                 is_verified = false
             WHERE id = $7`,
            [
              name,
              sanitizedPhone,
              normalizedAadhaarOrNull,
              normalizedEmail || null,
              verificationCode,
              otpExpiry,
              existing.id,
            ]
          );
        } else {
          await db.pool.query(
            `INSERT INTO women_users (name, mobile_number, aadhaar_number, email, otp_code, otp_expires_at, is_verified)
             VALUES ($1, $2, $3, $4, $5, $6, false)`,
            [
              name,
              sanitizedPhone,
              normalizedAadhaarOrNull,
              normalizedEmail || null,
              verificationCode,
              otpExpiry,
            ]
          );
        }

        if (normalizedEmail) {
          await transporter.sendMail({
            from: '"Smart Tourist Safety" <smarttouristsystem@gmail.com>',
            to: normalizedEmail,
            subject: 'Verify Your Women Safety Account',
            text: `Welcome to Smart Tourist Safety! Your verification code is: ${verificationCode}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #ec4899;">Welcome to Women Safety!</h2>
                <p>Thank you for registering with the Women Safety module. Please verify your email address using the code below:</p>
                <div style="background: #fdf2f8; border: 2px dashed #ec4899; padding: 20px; text-align: center; margin: 20px 0;">
                  <h3 style="color: #be185d; font-size: 24px; letter-spacing: 3px; margin: 0;">${verificationCode}</h3>
                </div>
                <p>This code will expire in 10 minutes for security reasons.</p>
              </div>
            `,
          });
        }

        return res.status(201).json({
          message: 'Registration successful. Please check your email for a verification code.',
          serviceType,
          requiresVerification: true,
          userType: 'women',
        });
      }

      // Default tourist/general registration flow
      const existingUser = await db.pool.query(
        "SELECT passport_id, email FROM tourists WHERE passport_id = $1 OR LOWER(email) = LOWER($2)",
        [identifier, normalizedEmail]
      );

      if (existingUser.rows.length > 0) {
        const existing = existingUser.rows[0];
        if (existing.passport_id === identifier) {
          const label = resolvedIdType === 'passport' ? 'Passport ID' : 'Aadhaar number';
          return res.status(400).json({ message: `A user with this ${label} already exists.` });
        }
        if (existing.email && existing.email.toLowerCase() === (normalizedEmail || '').toLowerCase()) {
          return res.status(400).json({ message: 'A user with this email address already exists.' });
        }
      }

      const verificationCode = generateCode();
      await db.pool.query(
        "INSERT INTO tourists (name, passport_id, emergency_contact, email, verification_code, is_verified, service_type, id_type) VALUES ($1, $2, $3, $4, $5, false, $6, $7)",
        [name, identifier, sanitizedPhone, normalizedEmail, verificationCode, serviceType, resolvedIdType]
      );
      await transporter.sendMail({
        from: '"Smart Tourist Safety" <smarttouristsystem@gmail.com>',
        to: normalizedEmail || email,
        subject: 'Verify Your Account',
        text: `Welcome to Smart Tourist Safety! Your verification code is: ${verificationCode}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #4fd1c5;">Welcome to Smart Tourist Safety!</h2>
            <p>Thank you for registering with us. Please verify your email address using the code below:</p>
            <div style="background: #f8fafc; border: 2px dashed #4fd1c5; padding: 20px; text-align: center; margin: 20px 0;">
              <h3 style="color: #1f2937; font-size: 24px; letter-spacing: 3px; margin: 0;">${verificationCode}</h3>
            </div>
            <p>This code will expire in 10 minutes for security reasons.</p>
            <p style="color: #6b7280; font-size: 14px;">If you didn't request this verification, please ignore this email.</p>
          </div>
        `,
      });
      res.status(201).json({
        message:
          'Registration successful. Please check your email for a verification code.',
        serviceType,
        requiresVerification: true,
        userType: 'tourist',
      });
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server error during registration.');
    }
  }
);

// --- Family Authentication Endpoints ---
// Step 1: request OTP for emergency email (store OTP in Postgres)
app.post('/api/family/auth/request-otp', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ message: 'Email is required' });

    // Attempt to match this email to a tourist's emergency contact emails or main email
    const q = await db.pool.query(
      `SELECT passport_id, name FROM tourists 
       WHERE email = $1 OR emergency_contact_email_1 = $1 OR emergency_contact_email_2 = $1 LIMIT 1`,
      [email]
    );
    if (q.rows.length === 0) {
      return res.status(404).json({ message: 'No tourist found for this emergency email.' });
    }
    const { passport_id: passportId, name } = q.rows[0];

    const otp = generateCode();

    // Upsert OTP into family_otps with 5-minute expiry
    const expiresAt = new Date(Date.now() + FAMILY_OTP_TTL_MS);
    await db.pool.query(
      `INSERT INTO family_otps (email, passport_id, tourist_name, otp_code, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email)
       DO UPDATE SET passport_id = EXCLUDED.passport_id,
                     tourist_name = EXCLUDED.tourist_name,
                     otp_code = EXCLUDED.otp_code,
                     expires_at = EXCLUDED.expires_at,
                     created_at = now()`,
      [email, passportId, name, otp, expiresAt]
    );

    // Send OTP to the provided email
    try {
      await transporter.sendMail({
        from: '"Smart Tourist Safety" <smarttouristsystem@gmail.com>',
        to: email,
        subject: 'Your Family Login OTP',
        text: `Your One-Time Password is ${otp}. It expires in 5 minutes.`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #4fd1c5;">Family Access Request</h2>
            <p>A family login request has been made for your emergency contact. Your OTP code is:</p>
            <div style="background: #f8fafc; border: 2px dashed #4fd1c5; padding: 20px; text-align: center; margin: 20px 0;">
              <h3 style="color: #1f2937; font-size: 24px; letter-spacing: 3px; margin: 0;">${otp}</h3>
            </div>
            <p>This code will expire in 5 minutes for security reasons.</p>
            <p style="color: #6b7280; font-size: 14px;">If you didn't request family access, please contact support immediately.</p>
          </div>
        `,
      });
    } catch (mailErr) {
      console.warn('Failed to send family OTP email:', mailErr && mailErr.message);
    }

    return res.json({ message: 'If this email is registered as an emergency contact, an OTP has been sent.' });
  } catch (e) {
    console.error('Error in /api/family/auth/request-otp:', e && e.message);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Step 2: verify OTP from Postgres and return a session token; clear OTP after success
app.post('/api/family/auth/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) return res.status(400).json({ message: 'Email and OTP are required' });
    // Fetch OTP record from DB
    const r = await db.pool.query(
      `SELECT email, passport_id, tourist_name, otp_code, expires_at FROM family_otps WHERE email = $1`,
      [email]
    );
    if (r.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }
    const rec = r.rows[0];
    if (new Date(rec.expires_at).getTime() < Date.now()) {
      // Expired: clean up
      await db.pool.query(`DELETE FROM family_otps WHERE email = $1`, [email]);
      return res.status(400).json({ message: 'OTP expired' });
    }
    if (String(otp) !== String(rec.otp_code)) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    // Issue a simple bearer token for family session
    const token = createFamilyToken();
    familySessions.set(token, { email, passportId: rec.passport_id, name: rec.tourist_name, createdAt: Date.now() });
    // clear OTP after success
    await db.pool.query(`DELETE FROM family_otps WHERE email = $1`, [email]);

    return res.json({ token, passportId: rec.passport_id, name: rec.tourist_name });
  } catch (e) {
    console.error('Error in /api/family/auth/verify-otp:', e && e.message);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Family-protected: latest location for tracked tourist and their group
app.get('/api/family/location', requireFamilyAuth, async (req, res) => {
  try {
    const { passportId } = req.family;
    // latest location for tourist
    const tRes = await db.pool.query(
      `SELECT t.passport_id, t.name, t.latitude, t.longitude
       FROM tourists t WHERE t.passport_id = $1`,
      [passportId]
    );
    if (tRes.rows.length === 0) return res.status(404).json({ message: 'Tourist not found' });
    const tourist = tRes.rows[0];

    // group and members with last known coordinates
    const gRes = await db.pool.query(
      `SELECT g.id, g.group_name FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       JOIN tourists t ON gm.tourist_id = t.id
       WHERE t.passport_id = $1 AND gm.status = 'accepted' AND g.group_name != 'default'
       LIMIT 1`,
      [passportId]
    );

    let group = null;
    if (gRes.rows.length > 0) {
      const groupIdDb = gRes.rows[0].id;
      const membersRes = await db.pool.query(
        `SELECT t.passport_id, t.name, t.profile_picture_url, gm.status, lh.latitude, lh.longitude
         FROM tourists t
         JOIN group_members gm ON t.id = gm.tourist_id
         LEFT JOIN (
           SELECT passport_id, latitude, longitude,
                  ROW_NUMBER() OVER(PARTITION BY passport_id ORDER BY created_at DESC) as rn
           FROM location_history
         ) lh ON t.passport_id = lh.passport_id AND lh.rn = 1
         WHERE gm.group_id = $1`,
        [groupIdDb]
      );
      group = { groupName: gRes.rows[0].group_name, members: membersRes.rows };
    }

    return res.json({ tourist, group });
  } catch (e) {
    console.error('Error in /api/family/location:', e && e.message);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Family-protected: alerts view with timing rules
app.get('/api/family/alerts', requireFamilyAuth, async (req, res) => {
  try {
    const { passportId } = req.family;
    const entry = familyAlerts.get(passportId) || { current: null, resolved: [] };
    const now = Date.now();
    const standard = [];
    const panic = [];

    if (entry.current) {
      const elapsed = now - (entry.current.startedAt || 0);
      if (entry.current.type === 'standard') {
        if (elapsed >= 60 * 60 * 1000) { // > 1 hour
          standard.push({ ...entry.current, elapsedMs: elapsed });
        }
      } else if (entry.current.type === 'panic') {
        if (elapsed >= 30 * 60 * 1000) { // > 30 minutes
          panic.push({ ...entry.current, elapsedMs: elapsed });
        }
      }
    }

    const resolved = (entry.resolved || []).map(r => ({ ...r }));
    return res.json({ standard, panic, resolved });
  } catch (e) {
    console.error('Error in /api/family/alerts:', e && e.message);
    return res.status(500).json({ message: 'Server error' });
  }
});

app.post("/api/v1/auth/verify-email", async (req, res) => {
  const { passportId, code, serviceType, email } = req.body;
  const identifier = typeof passportId === 'string' ? passportId.trim() : passportId;
  const normalizedCode = typeof code === 'string' ? code.trim() : code;

  if (!identifier || !normalizedCode) {
    return res.status(400).json({ message: 'Verification code and identifier are required.' });
  }

  if (serviceType === 'women_safety') {
    try {
      const normalizedAadhaar = normalizeGovernmentId(identifier, 'aadhaar');
      const sanitizedPhoneCandidate = sanitizePhoneNumber(identifier);
      const sanitizedPhone = sanitizedPhoneCandidate && sanitizedPhoneCandidate.length > 0 ? sanitizedPhoneCandidate : null;
      const normalizedEmailLower = email ? String(email).trim().toLowerCase() : null;
      const normalizedAadhaarOrNull = normalizedAadhaar || null;
      const normalizedEmailOrNull = normalizedEmailLower || null;

      const result = await db.pool.query(
        `SELECT id, otp_code, otp_expires_at, is_verified
         FROM women_users
         WHERE aadhaar_number = $1::text
            OR mobile_number = $2::text
            OR LOWER(email) = LOWER($3::text)
         LIMIT 1`,
        [normalizedAadhaarOrNull, sanitizedPhone, normalizedEmailOrNull]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'Account not found for verification. Please register again.' });
      }

      const user = result.rows[0];
      if (user.is_verified) {
        return res.status(400).json({ message: 'Account already verified. You can log in now.' });
      }

      if (user.otp_code !== normalizedCode) {
        return res.status(400).json({ message: 'Invalid verification code.' });
      }

      if (user.otp_expires_at && new Date() > new Date(user.otp_expires_at)) {
        return res.status(400).json({ message: 'Verification code expired. Please request a new one.' });
      }

      await db.pool.query(
        `UPDATE women_users
         SET is_verified = true, otp_code = NULL, otp_expires_at = NULL, updated_at = NOW()
         WHERE id = $1`,
        [user.id]
      );

      return res.status(200).json({ message: 'Email verified successfully. You can now log in.' });
    } catch (error) {
      console.error('Women verification failed:', error && error.message);
      return res.status(500).json({ message: 'Server error during verification.' });
    }
  }

  try {
    const result = await db.pool.query(
      "SELECT verification_code FROM tourists WHERE passport_id = $1",
      [identifier]
    );
    if (result.rows.length === 0 || result.rows[0].verification_code !== normalizedCode) {
      return res
        .status(400)
        .json({ message: "Invalid Passport ID or verification code." });
    }

    // Mark as verified and clear the code
    await db.pool.query(
      "UPDATE tourists SET is_verified = true, verification_code = NULL WHERE passport_id = $1",
      [identifier]
    );

    // Mint the Digital ID only after successful email verification
    const touristInfo = await db.pool.query(
      "SELECT name FROM tourists WHERE passport_id = $1",
      [identifier]
    );
    await mintDigitalId(touristInfo.rows[0].name, identifier);

    res
      .status(200)
      .json({ message: "Email verified successfully. You can now log in." });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error.");
  }
});

app.post("/api/v1/auth/login", async (req, res) => {
  const { email } = req.body || {};
  if (!email || !String(email).trim()) {
    return res.status(400).json({ message: "Email address is required." });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  try {
    const touristResult = await db.pool.query(
      "SELECT passport_id, email, is_verified, service_type, name FROM tourists WHERE LOWER(email) = $1",
      [normalizedEmail]
    );

    if (touristResult.rows.length > 0) {
      const user = touristResult.rows[0];
      if (!user.is_verified) {
        return res
          .status(403)
          .json({ message: "Please verify your email before logging in." });
      }

      const otpCode = generateCode();
      const passportId = user.passport_id;

      await db.pool.query(
        "UPDATE tourists SET otp_code = $1 WHERE passport_id = $2",
        [otpCode, passportId]
      );

      await transporter.sendMail({
        from: '"Smart Tourist Safety" <smarttouristsystem@gmail.com>',
        to: user.email,
        subject: "Your Login OTP Code",
        text: `Your One-Time Password for login is: ${otpCode}`,
        html: `
          <div style=\"font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;\">
            <h2 style=\"color: #4fd1c5;\">Login Verification</h2>
            <p>Your One-Time Password for login is:</p>
            <div style=\"background: #f8fafc; border: 2px dashed #4fd1c5; padding: 20px; text-align: center; margin: 20px 0;\">
              <h3 style=\"color: #1f2937; font-size: 24px; letter-spacing: 3px; margin: 0;\">${otpCode}</h3>
            </div>
            <p>This code will expire in 10 minutes for security reasons.</p>
            <p style=\"color: #6b7280; font-size: 14px;\">If you didn't request this login, please secure your account immediately.</p>
          </div>
        `,
      });

      return res.status(200).json({
        message: "OTP has been sent to your registered email.",
        serviceType: user.service_type || 'general_safety',
        userType: 'tourist',
      });
    }

    const womenResult = await db.pool.query(
      "SELECT id, name, email, is_verified FROM women_users WHERE LOWER(email) = $1",
      [normalizedEmail]
    );

    if (womenResult.rows.length === 0) {
      return res.status(404).json({ message: "User not found." });
    }

    const womenUser = womenResult.rows[0];
    if (!womenUser.is_verified) {
      return res.status(403).json({ message: 'Please verify your email before logging in.' });
    }

    const otpCode = generateCode();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    await db.pool.query(
      "UPDATE women_users SET otp_code = $1, otp_expires_at = $2 WHERE id = $3",
      [otpCode, otpExpiry, womenUser.id]
    );

    await transporter.sendMail({
      from: '"Women Safety - Smart Tourist" <smarttouristsystem@gmail.com>',
      to: womenUser.email,
      subject: "Your Women Safety Login OTP",
      text: `Your One-Time Password for login is: ${otpCode}`,
      html: `
        <div style=\"font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;\">
          <h2 style=\"color: #ec4899;\">Women Safety Login</h2>
          <p>Your One-Time Password for login is:</p>
          <div style=\"background: #fdf2f8; border: 2px dashed #ec4899; padding: 20px; text-align: center; margin: 20px 0;\">
            <h3 style=\"color: #be185d; font-size: 24px; letter-spacing: 3px; margin: 0;\">${otpCode}</h3>
          </div>
          <p>This code will expire in 10 minutes for security reasons.</p>
        </div>
      `,
    });

    return res.status(200).json({
      message: "OTP has been sent to your registered email.",
      serviceType: 'women_safety',
      userType: 'women',
    });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).send("Server error");
  }
});

// NEW: /verify-otp endpoint
app.post("/api/v1/auth/verify-otp", async (req, res) => {
  const { email, otp, serviceType: requestedServiceType, userType: requestedUserType } = req.body || {};
  if (!email || !String(email).trim() || !otp) {
    return res.status(400).json({ message: "Email and OTP are required." });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedOtp = String(otp).trim();
  try {
  const preferWomen = (requestedServiceType === 'women_safety') || (requestedUserType === 'women');

    if (!preferWomen) {
      const touristResult = await db.pool.query(
        "SELECT passport_id, name, otp_code, profile_picture_url, service_type FROM tourists WHERE LOWER(email) = $1",
        [normalizedEmail]
      );
      if (touristResult.rows.length > 0) {
        const user = touristResult.rows[0];
        if (String(user.otp_code || '').trim() !== normalizedOtp) {
          return res.status(400).json({ message: "Invalid OTP." });
        }

        const passportId = user.passport_id;

        await db.pool.query(
          "UPDATE tourists SET otp_code = NULL, status = 'active' WHERE passport_id = $1",
          [passportId]
        );

        io.emit("statusUpdate", { passport_id: passportId, status: "active" });

        const isSecure = req.headers["x-forwarded-proto"] === "https" || req.secure;
        res.cookie("passportId", passportId, {
          httpOnly: true,
          sameSite: isSecure ? "none" : "lax",
          secure: !!isSecure,
          maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        return res.json({
          message: "Login successful",
          token: "fake.jwt.token.for." + user.name,
          name: user.name,
          passportId,
          profilePictureUrl: user.profile_picture_url,
          serviceType: user.service_type || 'general_safety',
          userType: 'tourist',
        });
      }
    }

    const womenResult = await db.pool.query(
      "SELECT id, name, mobile_number, aadhaar_number, email, otp_code, otp_expires_at FROM women_users WHERE LOWER(email) = $1",
      [normalizedEmail]
    );

    if (womenResult.rows.length === 0) {
      return res.status(404).json({ message: "User not found." });
    }

    const womenUser = womenResult.rows[0];

    if (String(womenUser.otp_code || '').trim() !== normalizedOtp) {
      return res.status(400).json({ message: "Invalid OTP." });
    }

    if (womenUser.otp_expires_at && new Date() > new Date(womenUser.otp_expires_at)) {
      return res.status(400).json({ message: "OTP expired. Please request a new one." });
    }

    await db.pool.query(
      "UPDATE women_users SET otp_code = NULL, otp_expires_at = NULL, last_seen = NOW() WHERE id = $1",
      [womenUser.id]
    );

    const pseudoPassport = `WOMEN-${womenUser.id}`;
    const isSecure = req.headers["x-forwarded-proto"] === "https" || req.secure;
    res.cookie("womenUserId", womenUser.id, {
      httpOnly: true,
      sameSite: isSecure ? "none" : "lax",
      secure: !!isSecure,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({
      message: "Login successful",
      token: "women.jwt.token." + womenUser.id,
      name: womenUser.name,
      passportId: pseudoPassport,
      serviceType: 'women_safety',
      userType: 'women',
      womenUser: {
        id: womenUser.id,
        name: womenUser.name,
        mobileNumber: womenUser.mobile_number,
        aadhaarNumber: womenUser.aadhaar_number,
        email: womenUser.email,
      },
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// Return current authenticated user from cookie
app.get("/api/v1/auth/me", async (req, res) => {
  try {
    const cookies = req.cookies || {};
    const passportId = cookies.passportId;
    const womenUserId = cookies.womenUserId;

    if (passportId) {
      // Tourist session
      const result = await db.pool.query(
        "SELECT passport_id, name, profile_picture_url, status, service_type FROM tourists WHERE passport_id = $1",
        [passportId]
      );
      if (result.rows.length === 0)
        return res.status(404).json({ message: "User not found" });
      const u = result.rows[0];
      return res.json({
        passportId: u.passport_id,
        name: u.name,
        profilePictureUrl: u.profile_picture_url,
        status: u.status,
        serviceType: u.service_type || 'general_safety',
        userType: 'tourist',
      });
    }

    if (womenUserId) {
      // Women-safety session
      const idNum = Number(womenUserId);
      if (!Number.isFinite(idNum) || idNum <= 0) {
        return res.status(401).json({ message: 'Not authenticated' });
      }
      const result = await db.pool.query(
        'SELECT id, name, email, mobile_number, aadhaar_number, status, latitude, longitude FROM women_users WHERE id = $1',
        [idNum]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'User not found' });
      }
      const w = result.rows[0];
      return res.json({
        passportId: `WOMEN-${w.id}`,
        name: w.name,
        email: w.email,
        mobileNumber: w.mobile_number,
        aadhaarNumber: w.aadhaar_number,
        status: w.status || 'safe',
        location: (Number.isFinite(w.latitude) && Number.isFinite(w.longitude)) ? { latitude: w.latitude, longitude: w.longitude } : null,
        serviceType: 'women_safety',
        userType: 'women',
      });
    }

    return res.status(401).json({ message: "Not authenticated" });
  } catch (err) {
    console.error("Error in /auth/me:", err.message);
    res.status(500).send("Server error");
  }
});

app.get("/api/v1/tourists", async (req, res) => {
  try {
    // This new query joins the tables to get the correct group name
    const query = `
            SELECT 
                t.id, t.name, t.passport_id, t.emergency_contact, t.status, 
                t.latitude, t.longitude, t.last_seen, t.profile_picture_url,
                COALESCE(g.group_name, 'No Group') AS group_name 
            FROM tourists t
            LEFT JOIN group_members gm ON t.id = gm.tourist_id AND gm.status = 'accepted'
            LEFT JOIN groups g ON gm.group_id = g.id
            ORDER BY t.created_at DESC
        `;
    const result = await db.pool.query(query);
    console.log(
      "Dashboard requested the list of all tourists with correct group names."
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// Runtime flag for attempted accuracy column creation
let ensuredAccuracyColumn = false;
app.post("/api/v1/location", async (req, res) => {
  const { latitude, longitude, accuracy, passportId } = req.body;
  if (latitude == null || longitude == null || !passportId) {
    return res.status(400).json({ message: "Latitude, longitude, and passportId are required." });
  }

  // one-time attempt to add accuracy column if missing (tourists history)
  if (!ensuredAccuracyColumn) {
    try {
      await db.pool.query("ALTER TABLE location_history ADD COLUMN IF NOT EXISTS accuracy DOUBLE PRECISION");
    } catch (e) {
      // ignore
    } finally {
      ensuredAccuracyColumn = true;
    }
  }

  const safeAccuracy = (typeof accuracy === 'number' && isFinite(accuracy)) ? accuracy : null;

  try {
    // Special handling for Women Safety pseudo passport (WOMEN-<id>)
    const womenMatch = String(passportId).match(/^WOMEN-(\d+)$/i);
    if (womenMatch) {
      const womenId = parseInt(womenMatch[1], 10);
      if (!Number.isFinite(womenId)) {
        return res.status(400).json({ message: 'Invalid women user id' });
      }

      // Fetch current state
      const wRes = await db.pool.query(
        'SELECT id, status, latitude, longitude FROM women_users WHERE id = $1',
        [womenId]
      );
      if (wRes.rows.length === 0) {
        return res.status(404).json({ message: 'Women user not found.' });
      }
      const w = wRes.rows[0];

      // Compute movement
      let movedMeters = null;
      if (w.latitude != null && w.longitude != null) {
        const toRad = d => d * Math.PI / 180;
        const R = 6371000; // m
        const dLat = toRad(latitude - w.latitude);
        const dLon = toRad(longitude - w.longitude);
        const a = Math.sin(dLat/2)**2 + Math.cos(toRad(w.latitude)) * Math.cos(toRad(latitude)) * Math.sin(dLon/2)**2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        movedMeters = R * c;
      }
      const MOVEMENT_THRESHOLD_M = 10;
      const shouldInsertHistory = movedMeters == null || movedMeters > MOVEMENT_THRESHOLD_M;

      const newStatus = w.status === 'distress' ? 'distress' : 'active';
      await db.pool.query(
        'UPDATE women_users SET latitude = $1, longitude = $2, last_seen = NOW(), status = $4 WHERE id = $3',
        [latitude, longitude, womenId, newStatus]
      );
      if (shouldInsertHistory) {
        await db.pool.query(
          'INSERT INTO women_location_history (user_id, latitude, longitude, accuracy, created_at) VALUES ($1,$2,$3,$4,NOW())',
          [womenId, latitude, longitude, safeAccuracy]
        );
      }

      // Emit generic update so clients tracking this pseudo-passport receive it
      io.emit('locationUpdate', { passport_id: passportId, latitude, longitude, status: newStatus, accuracy: safeAccuracy });
      console.log(`Updated women location for ${passportId} (movedMeters=${movedMeters?.toFixed?.(1) ?? 'n/a'}, inserted=${shouldInsertHistory})`);

      try {
        const det = await detectorPredictPoint({ lat: latitude, lon: longitude, passportId });
        if (det && (det.final_risk_score >= 0.6 || det.geo_flag || det.anomaly_flag)) {
          const riskStatus = det.geo_flag ? 'anomaly_risk_area' : (det.anomaly_flag ? 'anomaly_ml' : 'anomaly');
          await db.pool.query('UPDATE women_users SET status = $1 WHERE id = $2', [riskStatus, womenId]);
          io.emit('anomalyAlert', { passport_id: passportId, status: riskStatus, details: det });
        }
      } catch (aiError) {
        console.error('Detector check error (women):', aiError.message || aiError);
      }

      return res.status(200).json({ status: 'ok' });
    }

    // Default: Tourist flow
    const touristResult = await db.pool.query(
      "SELECT id, status, latitude, longitude FROM tourists WHERE passport_id = $1",
      [passportId]
    );
    if (touristResult.rows.length === 0) {
      return res.status(404).json({ message: "Tourist not found." });
    }
    const touristInfo = touristResult.rows[0];
    const touristId = touristInfo.id;

    // Compute movement distance (meters) to suppress redundant inserts
    let movedMeters = null;
    if (touristInfo.latitude != null && touristInfo.longitude != null) {
      const toRad = d => d * Math.PI / 180;
      const R = 6371000; // m
      const dLat = toRad(latitude - touristInfo.latitude);
      const dLon = toRad(longitude - touristInfo.longitude);
      const a = Math.sin(dLat/2)**2 + Math.cos(toRad(touristInfo.latitude)) * Math.cos(toRad(latitude)) * Math.sin(dLon/2)**2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      movedMeters = R * c;
    }

    // Determine if we should record to history
    const MOVEMENT_THRESHOLD_M = 10; // skip tiny jitter
    const shouldInsertHistory = movedMeters == null || movedMeters > MOVEMENT_THRESHOLD_M;

    let newStatus = touristInfo.status === "distress" ? "distress" : "active";

    await db.pool.query(
      "UPDATE tourists SET latitude = $1, longitude = $2, last_seen = NOW(), status = $4 WHERE passport_id = $3",
      [latitude, longitude, passportId, newStatus]
    );

    if (shouldInsertHistory) {
      const cols = safeAccuracy != null ? "(tourist_id, passport_id, latitude, longitude, accuracy, created_at)" : "(tourist_id, passport_id, latitude, longitude, created_at)";
      const vals = safeAccuracy != null ? [touristId, passportId, latitude, longitude, safeAccuracy] : [touristId, passportId, latitude, longitude];
      const placeholders = safeAccuracy != null ? "$1,$2,$3,$4,$5,NOW()" : "$1,$2,$3,$4,NOW()";
      await db.pool.query(`INSERT INTO location_history ${cols} VALUES (${placeholders})`, vals);
    }

    io.emit("locationUpdate", { passport_id: passportId, latitude, longitude, status: newStatus, accuracy: safeAccuracy });
    emitToFamily(passportId, 'familyLocationUpdate', {
      passportId,
      latitude,
      longitude,
      accuracy: safeAccuracy,
      status: newStatus,
      updatedAt: new Date().toISOString(),
    });
    console.log(`Updated location for ${passportId} (movedMeters=${movedMeters?.toFixed?.(1) ?? 'n/a'}, inserted=${shouldInsertHistory})`);

    try {
      const det = await detectorPredictPoint({ lat: latitude, lon: longitude, passportId });
      if (det && (det.final_risk_score >= 0.6 || det.geo_flag || det.anomaly_flag)) {
        console.log(`🚨 DETECTOR RISK for Passport ID: ${passportId} | risk=${det.final_risk_score} 🚨`);
        const riskStatus = det.geo_flag ? "anomaly_risk_area" : (det.anomaly_flag ? "anomaly_ml" : "anomaly" );
        await db.pool.query("UPDATE tourists SET status = $1 WHERE passport_id = $2", [riskStatus, passportId]);
        io.emit("anomalyAlert", { passport_id: passportId, status: riskStatus, details: det });
        setCurrentAlert(passportId, { type: 'standard', startedAt: Date.now(), lat: latitude, lon: longitude });
        try { await db.pool.query(`INSERT INTO alert_history(passport_id, event_type, details) VALUES($1,$2,$3)`, [passportId, riskStatus, JSON.stringify(det)]); } catch(e) { console.warn('anomaly history insert failed', e.message); }
      }
    } catch (aiError) {
      console.error("Detector check error:", aiError.message || aiError);
    }

    res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

app.post("/api/v1/location/reverse-geocode", async (req, res) => {
  const { latitude, longitude } = req.body;

  if (!latitude || !longitude) {
    return res
      .status(400)
      .json({ message: "Latitude and longitude are required." });
  }

  try {
    const apiKey = process.env.GEOAPIFY_API_KEY;
    const geoapifyUrl = `https://api.geoapify.com/v1/geocode/reverse?lat=${latitude}&lon=${longitude}&apiKey=${apiKey}`;

    try {
      // Slightly higher timeout to reduce flakiness, but still bounded
      const response = await axios.get(geoapifyUrl, { timeout: 8000 });
      // Forward Geoapify response directly to frontend when successful
      return res.json(response.data);
    } catch (err) {
      // More detailed logging to help diagnose DNS / network failures
      console.error("Geoapify request failed:", {
        message: err.message,
        code: err.code,
        hostname: err.hostname || "api.geoapify.com",
        status: err.response && err.response.status,
      });

      // If DNS resolution failed (ENOTFOUND) or temporary DNS/TCP errors (EAI_AGAIN)
      // or request timed out (ECONNABORTED), attempt a lightweight fallback using
      // OpenStreetMap Nominatim so the app still receives a human-readable location.
      const isDnsError = err.code === "ENOTFOUND" || err.code === "EAI_AGAIN";
      const isTimeout = err.code === "ECONNABORTED" || (err.message && err.message.includes('timeout'));
      if (isDnsError || isTimeout) {
        try {
          const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&accept-language=en`;
          const nomRes = await axios.get(nominatimUrl, {
            timeout: 6000,
            headers: { "User-Agent": "TouristSystem/1.0 (fallback)" },
          });

          // Return a small wrapper to indicate this was a fallback provider.
          return res.json({
            provider: "nominatim",
            data: nomRes.data,
          });
        } catch (nomErr) {
          console.error("Nominatim fallback also failed:", nomErr && nomErr.message);
          return res.status(500).json({ message: "Failed to get location name (all providers)." });
        }
      }

      // For non-DNS errors just return a generic error to the client with logs.
      return res.status(502).json({ message: "Failed to get location name from Geoapify." });
    }
  } catch (error) {
    console.error("Unexpected error in reverse-geocode handler:", error && error.message);
    res.status(500).json({ message: "Failed to get location name." });
  }
});

app.post("/api/v1/safety/score", async (req, res) => {
  const { latitude, longitude, passportId } = req.body;

  if (latitude == null || longitude == null || !passportId) {
    return res
      .status(400)
      .json({ message: "Latitude, longitude, and passportId are required." });
  }

  try {
    const det = await detectorPredictPoint({ lat: latitude, lon: longitude, passportId });

    // 1) Base risk from detector (0..1)
    let modelRisk = 0.3; // default if missing
    let flags = { geo: 0, ml: 0, group: 0, inactivity: 0 };
    if (det && typeof det.final_risk_score === 'number') {
      modelRisk = Math.max(0, Math.min(1, Number(det.final_risk_score)));
      flags = { geo: det.geo_flag ? 1 : 0, ml: det.anomaly_flag ? 1 : 0, group: det.group_flag ? 1 : 0, inactivity: det.inactivity_flag ? 1 : 0 };
    }

    // 2) Heuristic risk from recent movement history (adds variability across locations/behavior)
    let heuristicRisk = 0.0;
    try {
      const q = await db.pool.query(
        `SELECT latitude, longitude, created_at
         FROM location_history
         WHERE passport_id = $1
         ORDER BY created_at DESC
         LIMIT 10`,
        [passportId]
      );
      const rows = q.rows || [];
      if (rows.length > 0) {
        const toRad = (d) => (d * Math.PI) / 180;
        const R = 6371; // km
        let totalDistKm = 0;
        let speeds = [];
        for (let i = 0; i < rows.length - 1; i++) {
          const a = rows[i];
          const b = rows[i + 1];
          const lat1 = Number(a.latitude), lon1 = Number(a.longitude);
          const lat2 = Number(b.latitude), lon2 = Number(b.longitude);
          const dLat = toRad(lat2 - lat1);
          const dLon = toRad(lon2 - lon1);
          const hav = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
          const c = 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
          const dKm = R * c;
          totalDistKm += dKm;
          const t1 = new Date(a.created_at).getTime();
          const t2 = new Date(b.created_at).getTime();
          const dtHours = Math.max(0.0001, Math.abs(t1 - t2) / 3600000);
          const vKmh = dKm / dtHours;
          if (isFinite(vKmh)) speeds.push(vKmh);
        }
        const lastTs = new Date(rows[0].created_at).getTime();
        const minsSinceLast = Math.max(0, (Date.now() - lastTs) / 60000);

        // Heuristic components
        // - Long inactivity (>15m) raises risk
        if (minsSinceLast > 15) heuristicRisk += 0.15;
        if (minsSinceLast > 60) heuristicRisk += 0.10; // extra if very stale
        // - Very low movement across last 10 points -> slight risk (possible lost/stuck)
        if (totalDistKm < 0.05) heuristicRisk += 0.05;
        // - Very high speed (>100 km/h) -> slight risk (vehicle on highway)
        const maxSpeed = speeds.length ? Math.max(...speeds) : 0;
        if (maxSpeed > 100) heuristicRisk += 0.05;
      }
    } catch (e) {
      // best-effort heuristic; ignore errors
    }

    // Time-of-day adjustment: late night slightly higher risk
    try {
      const hour = new Date().getHours();
      if (hour >= 23 || hour < 5) heuristicRisk += 0.05; // night time
    } catch {}

    // 3) Combine risks
    let finalRisk = Math.max(0, Math.min(1, 0.75 * modelRisk + 0.25 * heuristicRisk));
    // If detector says high-risk zone, clamp to high risk
    if (flags.geo) finalRisk = Math.max(finalRisk, 0.75); // => safety <= 25

    // 4) Map to safety (100..0)
    let safety = Math.round(100 * (1 - finalRisk));
    safety = Math.max(0, Math.min(100, safety));

    res.json({ score: safety, detector: det ? { risk: modelRisk, flags } : null, heuristic: { risk: Number(heuristicRisk.toFixed(3)) } });
  } catch (error) {
    console.error("Error calculating safety score:", error.message || error);
    res.status(500).json({ score: "N/A" });
  }
});

app.post("/api/v1/alert/panic", async (req, res) => {
  const { passportId, latitude, longitude } = req.body; // Assume frontend sends location
  if (!passportId || !latitude || !longitude) {
    return res
      .status(400)
      .json({ message: "Passport ID and location are required." });
  }
  try {
    await db.pool.query(
      "UPDATE tourists SET status = 'distress' WHERE passport_id = $1",
      [passportId]
    );
    try { await db.pool.query(`INSERT INTO alert_history(passport_id, event_type, details) VALUES($1,'panic',$2)`, [passportId, JSON.stringify({ latitude, longitude })]); } catch(e) { console.warn('panic history insert failed', e.message); }
    io.emit("panicAlert", { passport_id: passportId, status: "distress" });

    // --- NEW: FORWARD TO EMERGENCY SERVICES ---
    console.log(
      `IMMEDIATE FORWARD: Panic alert for ${passportId}. Finding nearby services...`
    );
    const services = await findNearbyServices(latitude, longitude);
    if (services) {
      console.log("Found services:", services);
      // For the prototype, we log this and notify the admin dashboard
      io.emit("emergencyResponseDispatched", {
        passport_id: passportId,
        message: `Panic alert automatically sent to nearest services.`,
        services,
      });
      // Persist forward marker for panic with services
      try {
        await db.pool.query(
          `INSERT INTO alert_forwards(passport_id, alert_type, services) VALUES($1,$2,$3)
           ON CONFLICT (passport_id, alert_type) DO UPDATE SET forwarded_at = now(), services = EXCLUDED.services`,
          [passportId, 'distress', JSON.stringify(services || {})]
        );
      } catch(e) { console.warn('Failed to persist panic forward record', e && e.message); }
    }
    // Track panic alert for family dashboard
    setCurrentAlert(passportId, { type: 'panic', startedAt: Date.now(), lat: latitude, lon: longitude, services, source: 'panic-button' });
    notifyEmergencyContacts({ passportId, latitude, longitude, alertType: 'panic', source: 'panic-button' }).catch((err) => {
      console.warn('Emergency contact notification failed:', err && err.message);
    });
    // --- END NEW LOGIC ---

    res.status(200).json({ message: "Panic alert received and forwarded." });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

app.post("/api/v1/alert/cancel", async (req, res) => {
  const { passportId } = req.body;
  if (!passportId) {
    return res.status(400).json({ message: "Passport ID is required." });
  }
  try {
    // We set the status back to 'active' from 'distress'
    await db.pool.query(
      "UPDATE tourists SET status = 'active' WHERE passport_id = $1",
      [passportId]
    );

    // Notify the admin dashboard that the alert is cancelled
    io.emit("statusUpdate", { passport_id: passportId, status: "active" });
    // Also send a targeted cancelPanicMode to the user's socket so the client stops recording
    const userSocket = userSockets.get(passportId);
    if (userSocket) {
      try {
        userSocket.emit("cancelPanicMode", { passportId });
      } catch (e) {
        console.warn("Failed to emit cancelPanicMode to user socket:", e && e.message);
      }
    }

    console.log(`Panic alert cancelled for ${passportId}.`);
    // Mark resolved for family dashboard
    resolveCurrentAlert(passportId);
    res.status(200).json({ message: "Panic alert has been cancelled." });
  } catch (err) {
    console.error("Error cancelling panic alert:", err.message);
    res.status(500).send("Server error");
  }
});

// Retrieve historical location points for a tourist within a timeframe
// Supported query params: since=2h (m,h,d) or timeframe alias
app.get('/api/v1/tourists/:passportId/locations', async (req, res) => {
  const { passportId } = req.params;
  const since = req.query.since || req.query.timeframe || '2h';
  // Parse timeframe like 30m,1h,6h,24h,2d
  const m = String(since).match(/^(\d+)(m|h|d)$/i);
  let interval = '2 hours';
  if (m) {
    const val = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    if (unit === 'm') interval = `${Math.min(val, 720)} minutes`;
    else if (unit === 'h') interval = `${Math.min(val, 168)} hours`;
    else if (unit === 'd') interval = `${Math.min(val, 30)} days`;
  }
  try {
    const q = await db.pool.query(
      `SELECT latitude, longitude, created_at
       FROM location_history
       WHERE passport_id = $1 AND created_at >= NOW() - INTERVAL '${interval}'
       ORDER BY created_at ASC`,
      [passportId]
    );
    return res.json({ locations: q.rows });
  } catch (e) {
    console.error('Failed to fetch location history:', e && e.message);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Broadcast an admin notification message to all connected admins (and optionally all clients)
app.post('/api/v1/admin/notify', async (req, res) => {
  const { message, scope } = req.body || {};
  if (!message) return res.status(400).json({ message: 'message is required' });
  const payload = {
    id: Date.now(),
    message: String(message).slice(0, 500),
    scope: scope === 'all' ? 'all' : 'admins',
    ts: new Date().toISOString()
  };
  try {
    // Emit separate events so frontend can choose what to display
    if (payload.scope === 'all') io.emit('adminNotification', payload);
    else io.emit('adminNotificationAdmins', payload);
    // Persist (in-memory) and trim
    adminNotifications.push(payload);
    if (adminNotifications.length > 50) adminNotifications.splice(0, adminNotifications.length - 50);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ message: 'Failed to broadcast notification' });
  }
});

// List recent admin notifications
app.get('/api/v1/admin/notify', (req, res) => {
  return res.json({ notifications: adminNotifications.slice().reverse() });
});

app.post("/api/v1/auth/logout", async (req, res) => {
  const { passportId } = req.body;
  if (!passportId) {
    return res
      .status(400)
      .json({ message: "Passport ID is required to log out." });
  }
  try {
    await db.pool.query(
      "UPDATE tourists SET status = 'offline' WHERE passport_id = $1",
      [passportId]
    );

    console.log(`User ${passportId} logged out.`);

    io.emit("statusUpdate", { passport_id: passportId, status: "offline" });

    // Clear the HTTP-only cookie as part of logout
    res.clearCookie("passportId");

    res.status(200).json({ message: "Logout successful" });
  } catch (err) {
    console.error("Logout error:", err.message);
    res.status(500).send("Server error");
  }
});

app.post("/api/v1/tourists/:passportId/reset", async (req, res) => {
  const { passportId } = req.params;
  try {
    await db.pool.query(
      "UPDATE tourists SET status = 'active' WHERE passport_id = $1",
      [passportId]
    );

    // Remove any persisted forward markers so alert can be forwarded again next time
    try {
      await db.pool.query('DELETE FROM alert_forwards WHERE passport_id = $1', [passportId]);
    } catch (e) {
      console.warn('Failed to clear alert_forwards on reset:', e && e.message);
    }

    console.log(`Status reset for user ${passportId}`);
  // On reset, mark current alert resolved if any
  resolveCurrentAlert(passportId);
    try { await db.pool.query(`INSERT INTO alert_history(passport_id, event_type, details) VALUES($1,'reset',NULL)`, [passportId]); } catch(e){ console.warn('reset history insert failed', e.message); }

    io.emit("statusUpdate", { passport_id: passportId, status: "active" });
    const userSocket = userSockets.get(passportId);
    if (userSocket) {
      try {
        userSocket.emit("cancelPanicMode", { passportId });
      } catch (e) {
        console.warn("Failed to emit cancelPanicMode on reset:", e && e.message);
      }
    }

    res.status(200).json({ message: "Status reset successfully" });
  } catch (err) {
    console.error("Status reset error:", err.message);
    res.status(500).send("Server error");
  }
});

app.post("/api/v1/user/upload-profile-picture", (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      return res.status(500).json({ message: err.message });
    }
    if (req.file == undefined) {
      return res.status(400).json({ message: "No file selected!" });
    }

    try {
      const passportId = req.body.passportId;
      const imageUrl = `/uploads/${req.file.filename}`;

      await db.pool.query(
        "UPDATE tourists SET profile_picture_url = $1 WHERE passport_id = $2",
        [imageUrl, passportId]
      );

      res.status(200).json({
        message: "Profile picture uploaded successfully!",
        imageUrl: imageUrl,
      });
    } catch (dbError) {
      console.error(dbError.message);
      res.status(500).send("Error saving file path to database.");
    }
  });
});

// Endpoint to accept final recording uploads (reliable fallback)
const recordingUpload = multer({ dest: path.join(__dirname, 'recordings_temp') }).single('recording');
app.post('/api/v1/alert/upload-recording', (req, res) => {
  // Ensure recordings_temp directory exists
  const tempDir = path.join(__dirname, 'recordings_temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  recordingUpload(req, res, async (err) => {
    if (err) return res.status(500).json({ message: err.message });
    if (!req.file || !req.body.passportId) return res.status(400).json({ message: 'Missing file or passportId' });

    try {
      const recordingsDir = path.join(__dirname, 'recordings');
      if (!fs.existsSync(recordingsDir)) {
        fs.mkdirSync(recordingsDir, { recursive: true });
        console.log('Created recordings directory:', recordingsDir);
      }

      const originalName = req.file.originalname || `upload-${Date.now()}.webm`;
      const targetName = `${path.parse(originalName).name}-${Date.now()}${path.extname(originalName) || '.webm'}`;
      const targetPath = path.join(recordingsDir, targetName);

      console.log('Moving temp file from:', req.file.path, 'to:', targetPath);

      // Move temp file to recordings
      fs.renameSync(req.file.path, targetPath);

      console.log('File moved successfully to:', targetPath);

      // Prefer MP3 for widest compatibility when ffmpeg is available.
      const mp3Name = targetName.replace(/\.webm$/i, '.mp3');
      const mp3Path = path.join(recordingsDir, mp3Name);
      let finalName = targetName;
      let finalUrl = `/recordings/${targetName}`;
      try {
        const conv = await tryConvertToMp3(targetPath, mp3Path);
        if (conv && conv.ok && fs.existsSync(mp3Path)) {
          // Conversion succeeded: remove the original file to avoid duplicates
          try {
            if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
          } catch (rmErr) {
            console.warn('Failed to remove original recording after conversion:', rmErr && rmErr.message);
          }
          finalName = mp3Name;
          finalUrl = `/recordings/${mp3Name}`;
        } else {
          // Conversion failed or ffmpeg not present; keep original file (WEBM)
          finalName = targetName;
          finalUrl = `/recordings/${targetName}`;
        }
      } catch (e) {
        console.warn('Upload conversion attempt failed, serving original:', e && e.message);
        finalName = targetName;
        finalUrl = `/recordings/${targetName}`;
      }

      // Save recording metadata to DB
      try {
        console.log('Saving recording to database:', { passportId: req.body.passportId, finalUrl, finalName });
        const saved = await db.saveRecording(req.body.passportId, finalUrl, finalName);
        console.log('Recording saved to database with ID:', saved.id);
  io.emit('newRecording', { passportId: req.body.passportId, url: finalUrl, fileName: finalName, id: saved.id, created_at: saved.created_at });
  res.status(200).json({ message: 'Uploaded', url: finalUrl, id: saved.id });
      } catch (dberr) {
        console.error('Failed to save recording metadata:', dberr && dberr.message);
        // Still emit for admin but return success for upload
  io.emit('newRecording', { passportId: req.body.passportId, url: finalUrl, fileName: finalName });
  res.status(200).json({ message: 'Uploaded', url: finalUrl });
      }
    } catch (e) {
      console.error('Error handling uploaded recording:', e && e.message);
      res.status(500).json({ message: 'Server error' });
    }
  });
});

// List recordings: optionally filter by passportId (or passport_id)
app.get('/api/v1/recordings', async (req, res) => {
  try {
    const passportId = req.query.passportId || req.query.passport_id;
    if (passportId) {
      const rows = await db.listRecordingsByPassport(passportId);
      return res.status(200).json(rows);
    }
    const rows = await db.listRecordings();
    return res.status(200).json(rows);
  } catch (e) {
    console.error('Failed to list recordings:', e && e.message);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Serve recording files with ngrok skip header
app.get('/api/v1/recordings/file/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(__dirname, 'recordings', filename);

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'Recording not found' });
  }

  // Set headers to skip ngrok warning and serve the file
  res.setHeader('ngrok-skip-browser-warning', 'true');
  // Set content-type based on extension for better browser support
  if (/\.mp3$/i.test(filename)) {
    res.setHeader('Content-Type', 'audio/mpeg');
  } else if (/\.webm$/i.test(filename)) {
    res.setHeader('Content-Type', 'audio/webm');
  } else if (/\.wav$/i.test(filename)) {
    res.setHeader('Content-Type', 'audio/wav');
  } else {
    res.setHeader('Content-Type', 'application/octet-stream');
  }
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

  // Stream the file
  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);

  fileStream.on('error', (err) => {
    console.error('Error streaming recording file:', err);
    res.status(500).json({ message: 'Error serving recording' });
  });
});

// Delete a recording by id (removes DB row and file)
app.delete('/api/v1/recordings/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const rec = await db.deleteRecording(id);
    if (!rec) return res.status(404).json({ message: 'Not found' });
    // remove file
    const filePath = path.join(__dirname, 'recordings', rec.file_name);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { console.warn('Failed to delete file', filePath, e && e.message); }
    res.status(200).json({ message: 'Deleted' });
  } catch (e) {
    console.error('Failed to delete recording:', e && e.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete by file name to support clients that only know the file name
app.delete('/api/v1/recordings/file/:fileName', async (req, res) => {
  const { fileName } = req.params;
  try {
    const rec = await db.deleteRecordingByFileName(fileName);
    if (!rec) return res.status(404).json({ message: 'Not found' });
    const filePath = path.join(__dirname, 'recordings', rec.file_name);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { console.warn('Failed to delete file', filePath, e && e.message); }
    return res.status(200).json({ message: 'Deleted' });
  } catch (e) {
    console.error('Failed to delete recording (by file):', e && e.message);
    return res.status(500).json({ message: 'Server error' });
  }
});

app.post("/api/v1/groups/create", async (req, res) => {
  const { groupName, passportId } = req.body;
  try {
    // 1. Get the tourist's ID
    const touristRes = await db.pool.query(
      "SELECT id FROM tourists WHERE passport_id = $1",
      [passportId]
    );
    if (touristRes.rows.length === 0) {
      return res.status(404).json({ message: "Creator tourist not found." });
    }
    const creatorId = touristRes.rows[0].id;

    // 2. Create the group and get its new ID
    const newGroup = await db.pool.query(
      "INSERT INTO groups (group_name, created_by_tourist_id) VALUES ($1, $2) RETURNING id, group_id, group_name",
      [groupName, creatorId]
    );
    const newGroupIdDb = newGroup.rows[0].id;
    const newGroupIdChain = newGroup.rows[0].group_id;

    // 3. Add the creator as the first member of the group
    await db.pool.query(
      "INSERT INTO group_members (group_id, tourist_id, status) VALUES ($1, $2, 'accepted')",
      [newGroupIdDb, creatorId]
    );

    // 4. Mint the Group ID on the blockchain (non-blocking errors are logged)
    try {
      await mintGroupId(newGroupIdChain);
    } catch (chainErr) {
      console.warn("Warning: Failed to mint group on chain:", chainErr.message);
    }

    res.status(201).json({
      message: "Group created successfully!",
      group: newGroup.rows[0],
    });
  } catch (error) {
    console.error("Error creating group:", error.message);
    res.status(500).send("Server error.");
  }
});

app.get("/api/v1/groups/my-group/:passportId", async (req, res) => {
  const { passportId } = req.params;
  try {
    // Find the group this tourist belongs to. Include the internal numeric id so we can fetch members.
    const groupRes = await db.pool.query(
      `SELECT g.id, g.group_id, g.group_name FROM groups g
             JOIN group_members gm ON g.id = gm.group_id
             JOIN tourists t ON gm.tourist_id = t.id
             WHERE t.passport_id = $1 AND gm.status = 'accepted'
             AND g.group_name != 'default'`,
      [passportId]
    );

    if (groupRes.rows.length === 0) {
      return res.json(null); // Not in a group
    }

    const groupInfo = groupRes.rows[0];
    const groupIdDb = groupInfo.id;
    if (!groupIdDb) {
      console.warn("Group internal id missing for group_id", groupInfo.group_id);
      return res.json(null);
    }

    // Find all members of that group
    const membersRes = await db.pool.query(
      `SELECT t.passport_id, t.name, t.profile_picture_url, gm.status, lh.latitude, lh.longitude
       FROM tourists t
       JOIN group_members gm ON t.id = gm.tourist_id
       LEFT JOIN (
         SELECT passport_id, latitude, longitude,
                ROW_NUMBER() OVER(PARTITION BY passport_id ORDER BY created_at DESC) as rn
         FROM location_history
       ) lh ON t.passport_id = lh.passport_id AND lh.rn = 1
       WHERE gm.group_id = $1`,
      [groupIdDb]
    );

    groupInfo.members = membersRes.rows;
    res.json(groupInfo);
  } catch (error) {
    console.error("Error fetching group data:", error.message);
    res.status(500).send("Server error.");
  }
});

// NEW: Invite a member to a group
// MODIFIED: Invite a member to a group
app.post("/api/v1/groups/invite", async (req, res) => {
  const { groupId, inviteeEmail } = req.body; // groupId is the UUID string
  try {
    // 1. Find the tourist to invite by their email
    const inviteeRes = await db.pool.query(
      "SELECT id FROM tourists WHERE email = $1",
      [inviteeEmail]
    );
    if (inviteeRes.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "A tourist with that email does not exist." });
    }
    const inviteeId = inviteeRes.rows[0].id;

    // *** RECOMMENDED: Check if the user is already in an active group ***
    const existingGroupRes = await db.pool.query(
      "SELECT * FROM group_members WHERE tourist_id = $1 AND status = 'accepted'",
      [inviteeId]
    );
    if (existingGroupRes.rows.length > 0) {
      return res
        .status(400)
        .json({ message: "This user is already in a group." });
    }

    // 2. Find the group's internal DB id (PK) from its public UUID
    const groupRes = await db.pool.query(
      "SELECT id FROM groups WHERE group_id = $1",
      [groupId]
    );
    if (groupRes.rows.length === 0) {
      return res.status(404).json({ message: "Group not found." });
    }
    const groupIdDb = groupRes.rows[0].id;

    // 3. Create a 'pending' invitation
    await db.pool.query(
      "INSERT INTO group_members (group_id, tourist_id, status) VALUES ($1, $2, 'pending') ON CONFLICT (group_id, tourist_id) DO UPDATE SET status = 'pending'",
      [groupIdDb, inviteeId]
    );

    console.log(`Invitation sent to ${inviteeEmail} for group ${groupId}`);
    res.status(200).json({ message: `Invitation sent to ${inviteeEmail}.` });
  } catch (error) {
    console.error("Error sending invitation:", error.message);
    res.status(500).send("Server error.");
  }
});

// NEW: Accept a group invitation
app.post("/api/v1/groups/accept-invite", async (req, res) => {
  const { passportId, groupId } = req.body; // groupId is the UUID string
  try {
    // 1. Get the tourist's and group's internal IDs
    const touristRes = await db.pool.query(
      "SELECT id FROM tourists WHERE passport_id = $1",
      [passportId]
    );
    const groupRes = await db.pool.query(
      "SELECT id FROM groups WHERE group_id = $1",
      [groupId]
    );

    if (touristRes.rows.length === 0 || groupRes.rows.length === 0) {
      return res.status(404).json({ message: "Tourist or Group not found." });
    }
    const touristId = touristRes.rows[0].id;
    const groupIdDb = groupRes.rows[0].id;

    // 2. Update the status from 'pending' to 'accepted'
    const updateRes = await db.pool.query(
      "UPDATE group_members SET status = 'accepted' WHERE tourist_id = $1 AND group_id = $2 AND status = 'pending'",
      [touristId, groupIdDb]
    );

    if (updateRes.rowCount === 0) {
      return res
        .status(400)
        .json({ message: "No pending invitation found to accept." });
    }

    res.status(200).json({ message: "Successfully joined the group!" });
  } catch (error) {
    console.error("Error accepting invite:", error.message);
    res.status(500).send("Server error.");
  }
});

app.get("/api/v1/groups/invitations/:passportId", async (req, res) => {
  const { passportId } = req.params;
  try {
    const result = await db.pool.query(
      `SELECT g.group_id, g.group_name FROM groups g
             JOIN group_members gm ON g.id = gm.group_id
             JOIN tourists t ON gm.tourist_id = t.id
             WHERE t.passport_id = $1 AND gm.status = 'pending'`,
      [passportId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching invitations:", error.message);
    res.status(500).send("Server error.");
  }
});

// List all groups with member counts (excluding any 'default' placeholder if present)
app.get('/api/v1/groups', async (req, res) => {
  try {
    const { rows } = await db.pool.query(`
      SELECT g.group_name AS name, COUNT(gm.tourist_id) AS member_count
      FROM groups g
      LEFT JOIN group_members gm ON g.id = gm.group_id AND gm.status = 'accepted'
      WHERE g.group_name IS NOT NULL AND g.group_name <> 'default'
      GROUP BY g.group_name
      ORDER BY LOWER(g.group_name)
    `);
    res.json(rows);
  } catch (e) {
    console.error('Failed to list groups', e && e.message);
    res.status(500).json({ message: 'Failed to list groups' });
  }
});

// Persist an edited authority override for a forwarded alert
app.post('/api/v1/alerts/:passportId/update-authority', async (req, res) => {
  const { passportId } = req.params;
  const { authorityType, service } = req.body || {};
  if (!authorityType || !service) return res.status(400).json({ message: 'authorityType and service required' });
  if (!['hospital','police','fire'].includes(authorityType)) return res.status(400).json({ message: 'Invalid authorityType' });
  try {
    const { name, lat, lon, distance_km } = service;
    await db.pool.query(`
      INSERT INTO alert_authority_overrides(passport_id, authority_type, name, lat, lon, distance_km, updated_at)
      VALUES($1,$2,$3,$4,$5,$6, now())
      ON CONFLICT(passport_id, authority_type)
      DO UPDATE SET name = EXCLUDED.name, lat = EXCLUDED.lat, lon = EXCLUDED.lon, distance_km = EXCLUDED.distance_km, updated_at = now()
    `, [passportId, authorityType, name || null, lat || null, lon || null, distance_km || null]);
    try { await db.pool.query(`INSERT INTO alert_history(passport_id, event_type, details) VALUES($1,'override',$2)`, [passportId, JSON.stringify({ authorityType, service })]); } catch(e) { console.warn('override history insert failed', e.message); }
    console.log(`Authority override saved for ${passportId} (${authorityType}) -> ${name || 'Unnamed'} @ ${lat},${lon}`);
    res.json({ message: 'Authority override saved' });
  } catch (e) {
    console.error('Failed to save authority override', e && e.message);
    res.status(500).json({ message: 'Failed to save override' });
  }
});

app.post("/api/v1/safety/route", async (req, res) => {
  const { start, end } = req.body;

  if (!start || !end) {
    return res
      .status(400)
      .json({ message: "Start and end points are required." });
  }

  // Ensure route length is within Geoapify's synchronous API limits
  try {
    // getDistance returns kilometers
    const distanceKm = getDistance(start.lat, start.lon, end.lat, end.lon);
    const distanceMeters = Math.round(distanceKm * 1000);
    const MAX_METERS = 100000; // 100 km for regular API calls
    if (distanceMeters > MAX_METERS) {
      return res.status(400).json({
        message:
          `Distance between points is too long (${distanceMeters} m). ` +
          `Geoapify synchronous routing limits requests to ${MAX_METERS} m. ` +
          `Please choose a nearer destination or use an asynchronous/batched routing API.`,
      });
    }
  } catch (err) {
    console.warn(
      "Failed to validate distance before routing:",
      err.message || err
    );
    // If validation fails for any reason, continue and let Geoapify respond.
  }

  const apiKey = process.env.GEOAPIFY_API_KEY;
  const routeUrl = `https://api.geoapify.com/v1/routing?waypoints=${start.lat},${start.lon}|${end.lat},${end.lon}&mode=walk&apiKey=${apiKey}`;

  try {
    const routeResponse = await axios.get(routeUrl, { timeout: 7000 });

    if (!routeResponse.data.features || routeResponse.data.features.length === 0) {
      return res.status(404).json({ message: "Could not find a route for the given locations." });
    }

    const routeGeometry = routeResponse.data.features[0].geometry.coordinates[0];

    let safetyScore = 0;
    // Use Geoapify-supported category names. "commercial.cafe" and "commercial.restaurant"
    // are not valid — replace with the catering.* categories and a supported pharmacy/chemist category.
    const safeCategories =
      "commercial.supermarket,catering.cafe,catering.restaurant,commercial.chemist,building.public_and_civil,emergency.phone,tourism.attraction";

    const sampleIndices = [
      0,
      Math.floor(routeGeometry.length * 0.25),
      Math.floor(routeGeometry.length * 0.5),
      Math.floor(routeGeometry.length * 0.75),
      routeGeometry.length - 1,
    ];

    const uniqueSamplePoints = [...new Set(sampleIndices)].map(
      (index) => routeGeometry[index]
    );

    // Use resilient requests for place lookups. Individual failures should not
    // abort the whole route calculation -- we log and continue.
    const poiPromises = uniqueSamplePoints.map((point, idx) => {
      const [lon, lat] = point;
      const placesUrl = `https://api.geoapify.com/v2/places?categories=${safeCategories}&filter=circle:${lon},${lat},100&apiKey=${apiKey}`;
      return axios
        .get(placesUrl, { timeout: 5000 })
        .then((r) => ({ ok: true, data: r.data }))
        .catch((e) => ({ ok: false, error: e }));
    });

    const poiResponses = await Promise.all(poiPromises);

    poiResponses.forEach((resp, idx) => {
      if (resp.ok && resp.data && resp.data.features) {
        safetyScore += resp.data.features.length;
      } else {
        console.warn(`POI request #${idx} failed or returned no features:`, resp.error && (resp.error.message || resp.error.code));
      }
    });

    console.log(`Route Safety Analysis Complete. Score: ${safetyScore}`);

    res.json({
      message: "Safe route calculated successfully",
      route: routeGeometry,
      safetyScore: safetyScore,
    });
  } catch (error) {
    console.error("Geoapify routing error:", {
      message: error.message,
      code: error.code,
      status: error.response && error.response.status,
    });

    if (error.code === "ENOTFOUND" || error.code === "EAI_AGAIN") {
      return res.status(502).json({ message: "Routing provider unreachable (DNS)." });
    }

    return res.status(502).json({ message: "Failed to calculate route." });
  }
});

// wecodeblooded/backend-api/index.js

app.post("/api/v1/alerts/forward-to-emergency", async (req, res) => {
  const { passportId } = req.body;
  try {
    const tourist = await db.getTouristByPassportId(passportId);
    if (!tourist || !tourist.latitude) {
      return res
        .status(404)
        .json({ message: "Tourist location not available." });
    }

    console.log(
      `MANUAL FORWARD: Anomaly alert for ${passportId}. Finding services...`
    );
    const services = await findNearbyServices(
      tourist.latitude,
      tourist.longitude
    );

    if (services) {
      console.log("Found services:", services);
      io.emit("emergencyResponseDispatched", {
        passport_id: passportId,
        message: `Anomaly alert for ${passportId} was manually forwarded.`,
        services,
      });
    }
    // Persist forward marker (use current status as type fallback)
    try {
      const alertType = tourist.status || 'unknown';
      await db.pool.query(
        `INSERT INTO alert_forwards(passport_id, alert_type, services) VALUES($1,$2,$3)
         ON CONFLICT (passport_id, alert_type) DO UPDATE SET forwarded_at = now(), services = EXCLUDED.services`,
        [passportId, alertType, JSON.stringify(services || {})]
      );
    } catch(e) {
      console.warn('Failed to persist alert forward record:', e && e.message);
    }
    try { await db.pool.query(`INSERT INTO alert_history(passport_id, event_type, details) VALUES($1,'forwarded',$2)`, [passportId, JSON.stringify(services || {})]); } catch(e){ console.warn('forward history insert failed', e.message); }
    res.status(200).json({ message: "Alert forwarded successfully." });
  } catch (error) {
    console.error("Failed to forward alert:", error.message);
    res.status(500).send("Server error.");
  }
});

// Retrieve alert history for a tourist
app.get('/api/v1/alerts/:passportId/history', async (req, res) => {
  const { passportId } = req.params;
  try {
    const { rows } = await db.pool.query(`SELECT event_type, details, created_at FROM alert_history WHERE passport_id = $1 ORDER BY created_at DESC LIMIT 200`, [passportId]);
    res.json(rows);
  } catch(e) {
    console.error('Failed to retrieve alert history', e.message);
    res.status(500).json({ message: 'Failed to load history' });
  }
});

// Retrieve all forwarded alerts (optionally filter by current active statuses)
app.get('/api/v1/alerts/forwarded', async (req, res) => {
  try {
    const { rows } = await db.pool.query('SELECT passport_id, alert_type, services, forwarded_at FROM alert_forwards ORDER BY forwarded_at DESC LIMIT 500');
    res.json(rows);
  } catch (e) {
    console.error('Failed to list forwarded alerts:', e && e.message);
    res.status(500).json({ message: 'Failed to load forwarded alerts' });
  }
});

// Per tourist forwarded services (latest)
app.get('/api/v1/alerts/:passportId/forwarded-services', async (req, res) => {
  const { passportId } = req.params;
  try {
    const { rows } = await db.pool.query('SELECT passport_id, alert_type, services, forwarded_at FROM alert_forwards WHERE passport_id = $1 ORDER BY forwarded_at DESC LIMIT 1', [passportId]);
    if (!rows.length) return res.status(404).json({ message: 'No forwarded record' });
    res.json(rows[0]);
  } catch(e) {
    console.error('Failed to retrieve forwarded services:', e && e.message);
    res.status(500).json({ message: 'Failed to load forwarded services' });
  }
});

// Retrieve full list of nearby emergency services for a tourist (for editing selection)
app.get('/api/v1/alerts/:passportId/nearby-services', async (req, res) => {
  const { passportId } = req.params;
  try {
    const tourist = await db.getTouristByPassportId(passportId);
    if (!tourist || !tourist.latitude) return res.status(404).json({ message: 'Tourist location not available' });
    const lists = await findNearbyServiceLists(Number(tourist.latitude), Number(tourist.longitude));
    res.json(lists);
  } catch (e) {
    console.error('Failed to get nearby services lists:', e.message);
    res.status(500).json({ message: 'Failed to retrieve services' });
  }
});

// Reset all anomaly/distress statuses for a given group name (by group_name or groups table) and clear forwarded flags
app.post('/api/v1/groups/:groupName/reset-alerts', async (req, res) => {
  const { groupName } = req.params;
  try {
    // Resolve group id(s)
    const grp = await db.pool.query('SELECT id FROM groups WHERE group_name = $1 LIMIT 1', [groupName]);
    if (grp.rows.length === 0) {
      return res.status(404).json({ message: 'Group not found' });
    }
    const groupId = grp.rows[0].id;
    // Fetch member passport ids & tourist ids
    const members = await db.pool.query(`
      SELECT t.passport_id FROM group_members gm
      JOIN tourists t ON t.id = gm.tourist_id
      WHERE gm.group_id = $1
    `, [groupId]);
    const passportIds = members.rows.map(r => r.passport_id).filter(Boolean);
    if (passportIds.length === 0) return res.json({ message: 'No members to reset', count: 0 });
    // Update statuses
    await db.pool.query(`UPDATE tourists SET status = 'active' WHERE passport_id = ANY($1::text[])`, [passportIds]);
    // Clear forwarded markers
    await db.pool.query(`DELETE FROM alert_forwards WHERE passport_id = ANY($1::text[])`, [passportIds]);
    // Emit updates
    passportIds.forEach(pid => io.emit('statusUpdate', { passport_id: pid, status: 'active' }));
    res.json({ message: 'Group alerts reset', count: passportIds.length });
  } catch (e) {
    console.error('Failed to reset group alerts:', e.message);
    res.status(500).json({ message: 'Failed to reset group alerts' });
  }
});

app.get("/api/v1/location/autocomplete", async (req, res) => {
  const { text, lat, lon } = req.query; // We'll get the user's text and current location
  const apiKey = process.env.GEOAPIFY_API_KEY;

  if (!text) {
    return res.status(400).json({ message: "Text query is required." });
  }

  let url = `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(
    text
  )}&apiKey=${apiKey}`;

  // If we have the user's current location, we can get more relevant results
  if (lat && lon) {
    url += `&bias=proximity:${lon},${lat}`;
  }

  try {
    const response = await axios.get(url, { timeout: 4000 });
    return res.json(response.data);
  } catch (error) {
    console.error("Geoapify autocomplete error:", {
      message: error.message,
      code: error.code,
      status: error.response && error.response.status,
    });

    if (error.code === "ENOTFOUND" || error.code === "EAI_AGAIN") {
      // Return an empty suggestion set so the UI can continue operating.
      return res.json({ features: [] });
    }

    return res.status(502).json({ message: "Failed to get autocomplete suggestions." });
  }
});

cron.schedule("*/1 * * * *", async () => {
  console.log("Running scheduled safety checks for all tourists and groups...");

  try {
    // --- JOB 1: Inactivity Detection for ALL Active Tourists ---
    const INACTIVITY_THRESHOLD_HOURS = 1;
    const inactivityResult = await db.pool.query(
      `SELECT passport_id FROM tourists 
       WHERE status = 'active' AND last_seen < NOW() - INTERVAL '${INACTIVITY_THRESHOLD_HOURS} hours'`
    );

    if (inactivityResult.rows.length > 0) {
      for (const tourist of inactivityResult.rows) {
        const passportId = tourist.passport_id;
        const newStatus = "anomaly_inactive";

        console.log(`🚨 INACTIVITY ANOMALY for Passport ID: ${passportId}`);

        await db.pool.query(
          "UPDATE tourists SET status = $1 WHERE passport_id = $2",
          [newStatus, passportId]
        );

        io.emit("anomalyAlert", {
          passport_id: passportId,
          status: newStatus,
        });
      }
    }

    // --- JOB 2: Group dislocation anomaly (local rule-based) ---
    const groupsResult = await db.pool.query(
      "SELECT DISTINCT g.id, g.group_name FROM groups g JOIN group_members gm ON g.id = gm.group_id JOIN tourists t ON gm.tourist_id = t.id WHERE t.status = 'active' AND g.group_name != 'default'"
    );

    for (const group of groupsResult.rows) {
      const activeTouristsResult = await db.pool.query(
        `SELECT t.passport_id, t.latitude, t.longitude FROM tourists t
         JOIN group_members gm ON t.id = gm.tourist_id
         WHERE gm.group_id = $1 AND t.status = 'active' AND t.latitude IS NOT NULL AND t.longitude IS NOT NULL`,
        [group.id]
      );

      const activeTourists = activeTouristsResult.rows;
      if (activeTourists.length < 2) continue;

      // If any member is > 1km from the group's median location, flag them
      const lats = activeTourists.map(t => Number(t.latitude));
      const lons = activeTourists.map(t => Number(t.longitude));
      const median = (arr) => arr.sort((a,b)=>a-b)[Math.floor(arr.length/2)];
      const medLat = median(lats.slice());
      const medLon = median(lons.slice());

      const DISLOC_KM = 1.0;
      const farMembers = activeTourists.filter(t => {
        const d = getDistance(Number(t.latitude), Number(t.longitude), medLat, medLon);
        return d > DISLOC_KM;
      });

      for (const t of farMembers) {
        const passportId = t.passport_id;
        const newStatus = "anomaly_dislocation";
        console.log(`🚨 GROUP DISLOCATION for Passport ID: ${passportId} in ${group.group_name}`);
        await db.pool.query(
          "UPDATE tourists SET status = $1 WHERE passport_id = $2",
          [newStatus, passportId]
        );
        io.emit("anomalyAlert", { passport_id: passportId, status: newStatus });
        try {
          const tdb = await db.getTouristByPassportId(passportId);
          setCurrentAlert(passportId, { type: 'standard', startedAt: Date.now(), lat: tdb && tdb.latitude, lon: tdb && tdb.longitude });
        } catch (_) {}
      }
    }
  } catch (error) {
    console.error("Error in scheduled safety check job:", error.message);
  }
});

// Listen on all interfaces so other devices on the LAN can reach the API
server.listen(port, '0.0.0.0', () => {
  const os = require('os');
  const nets = os.networkInterfaces();
  const lanIps = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) lanIps.push(net.address);
    }
  }
  console.log(`Server is running on:`);
  console.log(`  Local:   http://localhost:${port}`);
  lanIps.forEach(ip => console.log(`  Network: http://${ip}:${port}`));
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('[warn] EMAIL_USER or EMAIL_PASS not set. OTP emails will fail.');
  }
});

app.use('/api/women', womenService);
