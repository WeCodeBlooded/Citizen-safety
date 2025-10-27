// ...existing code...
// ...existing code...
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const cookie = require("cookie");
const crypto = require("crypto");
const blockchainService = require("./blockchainService");
const {
  mintDigitalId,
  mintGroupId,
  logAlert: logAlertOnChain,
  logEmergency: logEmergencyOnChain,
  computePassportHash,
  fetchTourist,
  fetchAlerts,
  fetchEmergencies,
  fetchAuditTrail
} = blockchainService;
const axios = require("axios");
const cron = require("node-cron");
const nodemailer = require("nodemailer");
const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { body, validationResult } = require("express-validator");
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require("./db");
const { findNearbyServices, findNearbyServiceLists } = require("./emergencyService");
const fs = require("fs");
const dotenvPath = require('path').join(__dirname, '.env');
require("dotenv").config({ path: dotenvPath });
const womenService = require('./womenService');
const womenRouter = require('./womenService');
const authMeRouter = require('./routes/authMe');
const touristSupportRouter = require('./routes/touristSupport');
const touristNearbyRouter = require('./routes/touristNearby');

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

const PANIC_ALERT_SEVERITY = 3;

function sha256Hex(input) {
  try {
    return crypto.createHash('sha256').update(String(input)).digest('hex');
  } catch (error) {
    console.warn('[hash] sha256 failed', error && error.message);
    return null;
  }
}

async function ensureTouristChainState(passportId) {
  const normalized = normalizeGovernmentId(passportId, 'passport');
  if (!normalized) {
    return { id: null, passportHash: null, blockchainStatus: null };
  }
  try {
    const { rows } = await db.pool.query(
      `SELECT id, passport_hash, blockchain_status FROM tourists WHERE passport_id = $1 LIMIT 1`,
      [normalized]
    );
    if (!rows.length) {
      return { id: null, passportHash: null, blockchainStatus: null };
    }
    const row = rows[0];
    let passportHash = row.passport_hash;
    if (!passportHash) {
      try {
        passportHash = computePassportHash(normalized);
        if (passportHash) {
          await db.pool.query(`UPDATE tourists SET passport_hash = $1 WHERE id = $2`, [passportHash, row.id]);
        }
      } catch (hashErr) {
        console.warn('[blockchain] passport hash compute failed', hashErr && hashErr.message);
      }
    }
    return {
      id: row.id,
      passportHash: passportHash || null,
      blockchainStatus: row.blockchain_status || null
    };
  } catch (error) {
    console.warn('[blockchain] ensureTouristChainState failed', error && error.message);
    return { id: null, passportHash: null, blockchainStatus: null };
  }
}

async function recordBlockchainTransaction(entry) {
  if (!entry || !entry.txHash) {
    return;
  }
  const payloadJson = entry.payload ? JSON.stringify(entry.payload) : JSON.stringify({});
  const status = entry.blockNumber ? 'confirmed' : (entry.status || 'submitted');
  try {
    await db.pool.query(
      `INSERT INTO blockchain_transactions (passport_hash, entity_type, action, tx_hash, status, block_number, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (tx_hash) DO UPDATE SET
         passport_hash = EXCLUDED.passport_hash,
         entity_type = EXCLUDED.entity_type,
         action = EXCLUDED.action,
         status = EXCLUDED.status,
         block_number = EXCLUDED.block_number,
         payload = EXCLUDED.payload,
         updated_at = NOW()`
      , [entry.passportHash || null, entry.entityType || null, entry.action || null, entry.txHash, status, entry.blockNumber || null, payloadJson]
    );
  } catch (error) {
    console.warn('[blockchain] recordBlockchainTransaction failed', error && error.message);
  }
}

async function upsertBlockchainAlertRecord(entry) {
  if (!entry || !entry.alertId) {
    return;
  }
  const metadataJson = entry.metadata ? JSON.stringify(entry.metadata) : JSON.stringify({});
  try {
    await db.pool.query(
      `INSERT INTO blockchain_alerts (alert_id, passport_hash, location, severity, tx_hash, block_number, occurred_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (alert_id) DO UPDATE SET
         passport_hash = EXCLUDED.passport_hash,
         location = EXCLUDED.location,
         severity = EXCLUDED.severity,
         tx_hash = EXCLUDED.tx_hash,
         block_number = EXCLUDED.block_number,
         occurred_at = EXCLUDED.occurred_at,
         metadata = EXCLUDED.metadata`
      , [
        entry.alertId,
        entry.passportHash || null,
        entry.location || null,
        entry.severity || null,
        entry.txHash || null,
        entry.blockNumber || null,
        entry.occurredAt || new Date(),
        metadataJson
      ]
    );
  } catch (error) {
    console.warn('[blockchain] upsertBlockchainAlertRecord failed', error && error.message);
  }
}

async function upsertBlockchainEmergencyRecord(entry) {
  if (!entry || !entry.logId) {
    return;
  }
  const metadataJson = entry.metadata ? JSON.stringify(entry.metadata) : JSON.stringify({});
  try {
    await db.pool.query(
      `INSERT INTO blockchain_emergencies (log_id, passport_hash, evidence_hash, location, tx_hash, block_number, occurred_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (log_id) DO UPDATE SET
         passport_hash = EXCLUDED.passport_hash,
         evidence_hash = EXCLUDED.evidence_hash,
         location = EXCLUDED.location,
         tx_hash = EXCLUDED.tx_hash,
         block_number = EXCLUDED.block_number,
         occurred_at = EXCLUDED.occurred_at,
         metadata = EXCLUDED.metadata`
      , [
        entry.logId,
        entry.passportHash || null,
        entry.evidenceHash || null,
        entry.location || null,
        entry.txHash || null,
        entry.blockNumber || null,
        entry.occurredAt || new Date(),
        metadataJson
      ]
    );
  } catch (error) {
    console.warn('[blockchain] upsertBlockchainEmergencyRecord failed', error && error.message);
  }
}

const DEFAULT_BLOCKCHAIN_HISTORY_LIMIT = 10;

const WOMEN_PASSPORT_REGEX = /^WOMEN-/i;

function toIsoDate(value, assumeSeconds = false) {
  if (value == null) return null;
  try {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const millis = assumeSeconds ? value * 1000 : value;
      return new Date(millis).toISOString();
    }
    if (typeof value === 'bigint') {
      const millis = assumeSeconds ? Number(value) * 1000 : Number(value);
      return new Date(millis).toISOString();
    }
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? null : value.toISOString();
    }
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed.toISOString();
  } catch (err) {
    console.warn('[blockchain] toIsoDate failed', err && err.message);
    return null;
  }
}

function ensurePlainObject(value) {
  if (!value) return null;
  if (typeof value === 'object' && !Buffer.isBuffer(value)) {
    return value;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (err) {
      return { raw: value };
    }
  }
  return { raw: value };
}

async function buildBlockchainSummary(passportId, options = {}) {
  const limit = Math.max(1, Math.min(50, Number(options.limit) || DEFAULT_BLOCKCHAIN_HISTORY_LIMIT));
  const normalized = normalizeGovernmentId(passportId, 'passport');
  if (!normalized) {
    return {
      supported: false,
      reason: 'passport_missing',
      passportId: null,
      blockchainStatus: 'unknown'
    };
  }

  if (WOMEN_PASSPORT_REGEX.test(normalized)) {
    return {
      supported: false,
      reason: 'service_not_blockchain_enabled',
      passportId: normalized,
      blockchainStatus: 'unsupported'
    };
  }

  const chainState = await ensureTouristChainState(normalized);
  let touristDb = null;
  try {
    const result = await db.pool.query(
      `SELECT id, name, passport_id, passport_hash, blockchain_status, blockchain_tx_hash, blockchain_registered_at, blockchain_metadata_uri, service_type
       FROM tourists WHERE passport_id = $1 LIMIT 1`,
      [normalized]
    );
    touristDb = result.rows[0] || null;
  } catch (error) {
    console.warn('[blockchain] failed to load tourist row', error && error.message);
  }

  let passportHash = chainState.passportHash || touristDb?.passport_hash || null;
  if (!passportHash) {
    try {
      passportHash = computePassportHash(normalized);
    } catch (err) {
      passportHash = null;
    }
  }

  let transactions = [];
  let alerts = [];
  let emergencies = [];

  if (passportHash) {
    try {
      const { rows } = await db.pool.query(
        `SELECT entity_type, action, tx_hash, status, block_number, payload, created_at, updated_at
         FROM blockchain_transactions
         WHERE passport_hash = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [passportHash, limit]
      );
      transactions = rows.map((row) => ({
        entityType: row.entity_type,
        action: row.action,
        txHash: row.tx_hash,
        status: row.status,
        blockNumber: row.block_number != null ? Number(row.block_number) : null,
        createdAt: toIsoDate(row.created_at),
        updatedAt: toIsoDate(row.updated_at),
        payload: ensurePlainObject(row.payload)
      }));
    } catch (error) {
      console.warn('[blockchain] failed to load transactions', error && error.message);
    }

    try {
      const { rows } = await db.pool.query(
        `SELECT alert_id, location, severity, tx_hash, block_number, occurred_at, metadata
         FROM blockchain_alerts
         WHERE passport_hash = $1
         ORDER BY occurred_at DESC NULLS LAST, alert_id DESC
         LIMIT $2`,
        [passportHash, limit]
      );
      alerts = rows.map((row) => ({
        id: row.alert_id != null ? Number(row.alert_id) : null,
        location: row.location || null,
        severity: row.severity != null ? Number(row.severity) : null,
        txHash: row.tx_hash || null,
        blockNumber: row.block_number != null ? Number(row.block_number) : null,
        occurredAt: toIsoDate(row.occurred_at),
        metadata: ensurePlainObject(row.metadata)
      }));
    } catch (error) {
      console.warn('[blockchain] failed to load alert mirror', error && error.message);
    }

    try {
      const { rows } = await db.pool.query(
        `SELECT log_id, evidence_hash, location, tx_hash, block_number, occurred_at, metadata
         FROM blockchain_emergencies
         WHERE passport_hash = $1
         ORDER BY occurred_at DESC NULLS LAST, log_id DESC
         LIMIT $2`,
        [passportHash, limit]
      );
      emergencies = rows.map((row) => ({
        id: row.log_id != null ? Number(row.log_id) : null,
        evidenceHash: row.evidence_hash || null,
        location: row.location || null,
        txHash: row.tx_hash || null,
        blockNumber: row.block_number != null ? Number(row.block_number) : null,
        occurredAt: toIsoDate(row.occurred_at),
        metadata: ensurePlainObject(row.metadata)
      }));
    } catch (error) {
      console.warn('[blockchain] failed to load emergency mirror', error && error.message);
    }
  }

  let contractTourist = null;
  let contractAlerts = [];
  let contractEmergencies = [];
  let auditTrail = [];

  if (passportHash) {
    try {
      contractTourist = await fetchTourist(normalized);
    } catch (error) {
      console.warn('[blockchain] fetchTourist failed', error && error.message);
    }

    try {
      const alertList = await fetchAlerts(normalized);
      contractAlerts = (alertList || [])
        .map((alert) => ({
          id: alert.id != null ? Number(alert.id) : null,
          location: alert.location || null,
          severity: alert.severity != null ? Number(alert.severity) : null,
          raisedBy: alert.raisedBy || null,
          timestamp: alert.timestamp != null ? Number(alert.timestamp) : null,
          occurredAt: alert.timestamp != null ? toIsoDate(Number(alert.timestamp) * 1000, false) : null,
          metadataURI: alert.metadataURI || null
        }))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, limit);
    } catch (error) {
      console.warn('[blockchain] fetchAlerts failed', error && error.message);
    }

    try {
      const emergencyList = await fetchEmergencies(normalized);
      contractEmergencies = (emergencyList || [])
        .map((entry) => ({
          id: entry.id != null ? Number(entry.id) : null,
          evidenceHash: entry.evidenceHash || null,
          location: entry.location || null,
          reportedBy: entry.reportedBy || null,
          timestamp: entry.timestamp != null ? Number(entry.timestamp) : null,
          occurredAt: entry.timestamp != null ? toIsoDate(Number(entry.timestamp) * 1000, false) : null,
          metadataURI: entry.metadataURI || null
        }))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, limit);
    } catch (error) {
      console.warn('[blockchain] fetchEmergencies failed', error && error.message);
    }

    if (options.includeAudit) {
      try {
        auditTrail = await fetchAuditTrail(Math.min(limit, 25));
      } catch (error) {
        console.warn('[blockchain] fetchAuditTrail failed', error && error.message);
      }
    }
  }

  let blockchainStatus = touristDb?.blockchain_status || chainState.blockchainStatus || 'pending';
  if (contractTourist && contractTourist.active) {
    blockchainStatus = 'registered';
  } else if (!passportHash) {
    blockchainStatus = 'unregistered';
  }

  const registrationDateIso = touristDb?.blockchain_registered_at
    ? toIsoDate(touristDb.blockchain_registered_at)
    : (contractTourist?.registrationDate ? toIsoDate(contractTourist.registrationDate * 1000, false) : null);

  const latestTransaction = transactions[0] || null;
  const latestAlert = alerts[0] || null;
  const latestEmergency = emergencies[0] || null;

  return {
    supported: true,
    passportId: normalized,
    serviceType: touristDb?.service_type || 'tourist_safety',
    passportHash,
    blockchainStatus,
    registration: {
      txHash: touristDb?.blockchain_tx_hash || null,
      registeredAt: registrationDateIso,
      metadataURI: touristDb?.blockchain_metadata_uri || contractTourist?.metadataURI || null
    },
    counts: {
      transactions: transactions.length,
      alerts: alerts.length,
      emergencies: emergencies.length,
      onChainAlerts: contractAlerts.length,
      onChainEmergencies: contractEmergencies.length
    },
    latest: {
      transaction: latestTransaction,
      alert: latestAlert,
      emergency: latestEmergency
    },
    transactions,
    alerts,
    emergencies,
    onChain: {
      tourist: contractTourist
        ? {
            name: contractTourist.name || null,
            account: contractTourist.account || null,
            issuer: contractTourist.issuer || null,
            active: Boolean(contractTourist.active),
            registrationDate: contractTourist.registrationDate ? toIsoDate(contractTourist.registrationDate * 1000, false) : null,
            metadataURI: contractTourist.metadataURI || null
          }
        : null,
      alerts: contractAlerts,
      emergencies: contractEmergencies,
      auditTrail: auditTrail
    }
  };
}

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

const DEFAULT_SOCKET_ORIGIN_REGEX = /localhost|127\.0\.0\.1|ngrok|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\./i;
const rawSocketOrigins = (process.env.SOCKET_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const SOCKET_RESPONDER_SECRET = process.env.SOCKET_RESPONDER_SECRET ? String(process.env.SOCKET_RESPONDER_SECRET).trim() : null;
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'changeme-admin-secret';
const ADMIN_TOKEN_COOKIE = process.env.ADMIN_TOKEN_COOKIE || 'admin_token';
const ADMIN_TOKEN_TTL_HOURS = Math.max(1, Number(process.env.ADMIN_TOKEN_TTL_HOURS || 12));
// Allow overriding cookie SameSite and secure behavior via env for cross-origin setups (ngrok, remote frontends)
const ADMIN_COOKIE_SAMESITE = process.env.ADMIN_COOKIE_SAMESITE || 'lax'; // 'lax' | 'strict' | 'none'
const ADMIN_COOKIE_SECURE = (typeof process.env.ADMIN_COOKIE_SECURE !== 'undefined')
  ? String(process.env.ADMIN_COOKIE_SECURE).toLowerCase() === 'true'
  : (process.env.NODE_ENV === 'production');
const ADMIN_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: ADMIN_COOKIE_SAMESITE,
  secure: ADMIN_COOKIE_SECURE,
  maxAge: ADMIN_TOKEN_TTL_HOURS * 60 * 60 * 1000,
};

const compiledOriginMatchers = rawSocketOrigins.map((entry) => {
  if (!entry) return null;
  if (entry === '*') return () => true;
  if (entry.toLowerCase().startsWith('regex:')) {
    try {
      const rx = new RegExp(entry.slice(6));
      return (origin) => !!origin && rx.test(origin);
    } catch (e) {
      console.warn('[socket-origin] invalid regex ignored:', entry, e && e.message);
      return null;
    }
  }
  if (entry.includes('*')) {
    const escaped = entry.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const rx = new RegExp(`^${escaped}$`, 'i');
    return (origin) => !!origin && rx.test(origin);
  }
  const normalized = (() => {
    try {
      return new URL(entry).origin;
    } catch {
      return entry;
    }
  })();
  return (origin) => {
    if (!origin) return false;
    try {
      return new URL(origin).origin === normalized;
    } catch {
      return origin === normalized;
    }
  };
}).filter(Boolean);

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (compiledOriginMatchers.length) {
    const matched = compiledOriginMatchers.some((matcher) => {
      try { return matcher(origin); } catch { return false; }
    });
    if (matched) return true;
    return DEFAULT_SOCKET_ORIGIN_REGEX.test(origin);
  }
  return DEFAULT_SOCKET_ORIGIN_REGEX.test(origin);
}

const connectedTourists = {};
const app = express();
const liveLocationPrefs = new Map();
const panicLocks = new Set();

const normalizeAdminService = (service) => {
  const val = String(service || '').toLowerCase();
  if (['both', 'all', 'dual', 'combined'].includes(val)) return 'both';
  if (['women', 'women_safety', 'women-safety'].includes(val)) return 'women';
  return 'tourist';
};

const sanitizeAdminRow = (row) => {
  if (!row) return null;
  const assigned = normalizeAdminService(row.assigned_service);
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name || row.email,
    assignedService: assigned,
    assigned_service: assigned,
    lastLogin: row.last_login || null,
  };
};

const issueAdminToken = (adminRow) => {
  const payload = {
    id: adminRow.id,
    email: adminRow.email,
    assigned_service: normalizeAdminService(adminRow.assigned_service),
    display_name: adminRow.display_name || adminRow.email,
  };
  return jwt.sign(payload, ADMIN_JWT_SECRET, { expiresIn: `${ADMIN_TOKEN_TTL_HOURS}h` });
};

const verifyAdminToken = (token) => {
  if (!token) return null;
  try {
    return jwt.verify(token, ADMIN_JWT_SECRET);
  } catch (err) {
    return null;
  }
};

const extractAdminTokenFromRequest = (req) => {
  if (req.cookies && req.cookies[ADMIN_TOKEN_COOKIE]) {
    return req.cookies[ADMIN_TOKEN_COOKIE];
  }
  const authHeader = req.headers?.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1];
  return null;
};

const extractAdminTokenFromCookieHeader = (cookieHeader) => {
  if (!cookieHeader) return null;
  try {
    const parsed = cookie.parse(cookieHeader);
    if (parsed && parsed[ADMIN_TOKEN_COOKIE]) return parsed[ADMIN_TOKEN_COOKIE];
  } catch (e) {
    console.debug('Failed to parse admin token from cookies:', e && e.message);
  }
  return null;
};

const adminCanAccessPassport = (admin, passportId) => {
  if (!admin || !passportId) return false;
  const assigned = normalizeAdminService(admin.assigned_service || admin.assignedService);
  if (assigned === 'both') return true;
  const isWomen = db.WOMEN_PASSPORT_REGEX.test(String(passportId));
  if (assigned === 'women') return isWomen;
  if (assigned === 'tourist') return !isWomen;
  return false;
};

const enforcePassportAccess = (res, admin, passportId) => {
  if (adminCanAccessPassport(admin, passportId)) return true;
  res.status(403).json({ message: 'Forbidden for assigned team' });
  return false;
};

const authenticateAdmin = async (req, res, next) => {
  try {
    const token = extractAdminTokenFromRequest(req);
    if (!token) return res.status(401).json({ message: 'Unauthorized' });
    const payload = verifyAdminToken(token);
    if (!payload || !payload.id) return res.status(401).json({ message: 'Unauthorized' });
    const adminRow = await db.getAdminUserById(payload.id);
    if (!adminRow || adminRow.is_active === false) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    req.admin = sanitizeAdminRow(adminRow);
    req.adminToken = token;
    return next();
  } catch (err) {
    console.warn('authenticateAdmin failed:', err && err.message);
    return res.status(401).json({ message: 'Unauthorized' });
  }
};

// Initialize SMS worker and offline SOS routes (requires express app)
let smsWorker = null;
try {
  const createSmsWorker = require('./smsWorker');
  smsWorker = createSmsWorker({ db, twilioClient, twilioConfig });
} catch (e) {
  console.warn('[smsWorker] failed to initialize:', e && e.message);
}

try {
  require('./offlineSos')(app, { db, twilioClient, twilioConfig, smsWorker });
  console.log('[offlineSos] routes registered');
} catch (e) {
  console.warn('[offlineSos] failed to register routes:', e && e.message);
}

// Initialize Safe Zones Service (government shelters, police stations, hospitals)
try {
  require('./safeZonesService')(app, db);
} catch (e) {
  console.warn('[SafeZones] failed to initialize:', e && e.message);
}

function resolvePassportId(req) {
  try {
    const body = req && req.body ? req.body : {};
    const query = req && req.query ? req.query : {};
    const cookies = req && req.cookies ? req.cookies : {};
    if (body.passportId) return String(body.passportId).trim();
    if (query.passportId) return String(query.passportId).trim();
    if (cookies.passportId) return String(cookies.passportId).trim();
    if (cookies.womenUserId) return `WOMEN-${String(cookies.womenUserId).trim()}`;
  } catch (err) {
    console.warn('[resolvePassportId] failed:', err && err.message);
  }
  return null;
}

function resolvePassportFromCookies(cookieHeader) {
  if (!cookieHeader) return null;
  try {
    const parsed = cookie.parse(cookieHeader);
    if (parsed.passportId) return String(parsed.passportId).trim();
    if (parsed.womenUserId) return `WOMEN-${String(parsed.womenUserId).trim()}`;
  } catch (err) {
    console.warn('[socket-auth] cookie parse failed:', err && err.message);
  }
  return null;
}

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
      `ALTER TABLE IF EXISTS tourists ADD COLUMN IF NOT EXISTS profile_complete BOOLEAN DEFAULT false`,
      `ALTER TABLE IF EXISTS tourists ADD COLUMN IF NOT EXISTS passport_hash CHAR(66)`,
      `ALTER TABLE IF EXISTS tourists ADD COLUMN IF NOT EXISTS blockchain_tx_hash VARCHAR(255)`,
      `ALTER TABLE IF EXISTS tourists ADD COLUMN IF NOT EXISTS blockchain_status VARCHAR(30) DEFAULT 'pending'`,
      `ALTER TABLE IF EXISTS tourists ADD COLUMN IF NOT EXISTS blockchain_registered_at TIMESTAMPTZ`,
      `ALTER TABLE IF EXISTS tourists ADD COLUMN IF NOT EXISTS blockchain_metadata_uri TEXT`
    ];
    for (const sql of alters) {
      try { await db.pool.query(sql); } catch (e) { console.debug('Ensure column skipped:', e && e.message); }
    }

    const groupAlterStatements = [
      `ALTER TABLE IF EXISTS groups ADD COLUMN IF NOT EXISTS blockchain_group_id VARCHAR(255)`,
      `ALTER TABLE IF EXISTS groups ADD COLUMN IF NOT EXISTS blockchain_tx_hash VARCHAR(255)`,
      `ALTER TABLE IF EXISTS groups ADD COLUMN IF NOT EXISTS blockchain_status VARCHAR(30) DEFAULT 'pending'`,
      `ALTER TABLE IF EXISTS groups ADD COLUMN IF NOT EXISTS blockchain_created_at TIMESTAMPTZ`
    ];
    for (const sql of groupAlterStatements) {
      try { await db.pool.query(sql); } catch (e) { console.debug('Ensure groups column skipped:', e && e.message); }
    }

    try {
      await db.pool.query(`ALTER TABLE IF EXISTS tourists ADD CONSTRAINT IF NOT EXISTS tourists_passport_hash_unique UNIQUE (passport_hash);`);
    } catch (e) {
      console.debug('[DB] unique passport_hash ensure skipped:', e && e.message);
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

    try {
      await db.pool.query(`
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
      `);
      console.log('[DB] blockchain tables ready');
    } catch (e) {
      console.warn('[DB] could not ensure blockchain tables:', e && e.message);
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

    // Admin users for dashboard authentication
    try {
      await db.pool.query(`
        CREATE TABLE IF NOT EXISTS admin_users (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          display_name VARCHAR(120),
          assigned_service VARCHAR(20) NOT NULL DEFAULT 'tourist',
          is_active BOOLEAN DEFAULT true,
          last_login TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_admin_users_service ON admin_users(assigned_service);
      `);
      console.log('[DB] admin_users table ready');
    } catch (e) {
      console.warn('[DB] could not ensure admin_users table:', e && e.message);
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

    // Women streaming evidence tables
    try {
      await db.pool.query(`
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
      `);
      console.log('[DB] women stream tables ready');
    } catch (e) {
      console.warn('[DB] could not ensure women stream tables:', e && e.message);
    }

    // Tourist helplines and multilingual FAQ content
    try {
      await db.pool.query(`
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
      `);

      // Table to persist offline SMS/USSD queue entries for fallback delivery
      await db.pool.query(`
        CREATE TABLE IF NOT EXISTS sms_queue (
          id SERIAL PRIMARY KEY,
          passport_id VARCHAR(80),
          phone_number VARCHAR(80),
          message TEXT NOT NULL,
          channel VARCHAR(20) DEFAULT 'sms', -- 'sms' or 'ussd' or other
          status VARCHAR(20) DEFAULT 'pending', -- pending|sent|failed
          attempts INTEGER DEFAULT 0,
          last_error TEXT,
          created_at TIMESTAMPTZ DEFAULT now(),
          sent_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_sms_queue_status ON sms_queue(status);
        CREATE INDEX IF NOT EXISTS idx_sms_queue_passport ON sms_queue(passport_id);
      `);

      // Table for Safe Zones (shelters, police stations, hospitals, treatment centres)
      await db.pool.query(`
        CREATE TABLE IF NOT EXISTS safe_zones (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          type VARCHAR(50) NOT NULL,
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
      `);
      console.log('[DB] safe_zones table ready');

      const { rows: helplineCountRows } = await db.pool.query('SELECT COUNT(*)::INT AS count FROM tourist_helplines');
      const currentHelplineCount = helplineCountRows?.[0]?.count || 0;
      if (currentHelplineCount === 0) {
        const helplineSeeds = [
          {
            region: 'National',
            service_name: 'Incredible India Tourist Helpline (Ministry of Tourism)',
            phone_number: '1800-11-1363 / 1363',
            availability: '24x7',
            languages: ['English', 'Hindi', 'Tamil', 'Telugu', 'Bengali', 'Kannada', 'Marathi'],
            description: 'Central multilingual helpline for tourists across India offering emergency guidance and travel assistance.',
            priority: 1
          },
          {
            region: 'National',
            service_name: 'Emergency Response Support System (ERSS)',
            phone_number: '112',
            availability: '24x7',
            languages: ['English', 'Hindi'],
            description: 'Single emergency number that connects to police, fire, and medical services pan-India.',
            priority: 2
          },
          {
            region: 'National',
            service_name: 'Women & Child Helpline',
            phone_number: '1091 / 181',
            availability: '24x7',
            languages: ['English', 'Hindi'],
            description: 'Dedicated helpline for women and child safety with rapid police escalation.',
            priority: 3
          },
          {
            region: 'Delhi',
            service_name: 'Delhi Tourist Police',
            phone_number: '+91-8750871111',
            availability: '24x7',
            languages: ['English', 'Hindi'],
            description: 'Tourist police assistance within Delhi NCR including airport zone and heritage sites.',
            priority: 10
          },
          {
            region: 'Maharashtra',
            service_name: 'Maharashtra Tourism Helpline',
            phone_number: '1800-229-933',
            availability: '06:00 - 22:00 IST',
            languages: ['English', 'Hindi', 'Marathi'],
            description: 'Support for tourists in Mumbai, Pune, and major Maharashtra destinations.',
            priority: 12
          },
          {
            region: 'Tamil Nadu',
            service_name: 'Tamil Nadu Tourism Helpline',
            phone_number: '044-2533-2770',
            availability: '24x7',
            languages: ['English', 'Tamil'],
            description: 'Tourist assistance for Chennai, Madurai, Rameswaram, and other Tamil Nadu circuits.',
            priority: 15
          },
          {
            region: 'Karnataka',
            service_name: 'Karnataka Tourism Helpline',
            phone_number: '1800-425-2577',
            availability: '07:00 - 19:00 IST',
            languages: ['English', 'Kannada', 'Hindi'],
            description: 'Guidance for Bengaluru, Mysuru, coastal Karnataka, and heritage trails.',
            priority: 16
          },
          {
            region: 'Kerala',
            service_name: 'Kerala Tourism Helpline',
            phone_number: '1800-425-4747',
            availability: '24x7',
            languages: ['English', 'Malayalam', 'Hindi'],
            description: 'Round-the-clock support covering backwaters, hill stations, and coastal Kerala.',
            priority: 18
          },
          {
            region: 'Goa',
            service_name: 'Goa Tourism Safety Patrol',
            phone_number: '+91-9623798080',
            availability: '24x7',
            languages: ['English', 'Konkani', 'Hindi'],
            description: 'Dedicated safety patrol hotline for beaches, nightlife zones, and tourist belts in Goa.',
            priority: 20
          },
          {
            region: 'Rajasthan',
            service_name: 'Rajasthan Tourism Helpline',
            phone_number: '1800-180-6127',
            availability: '08:00 - 22:00 IST',
            languages: ['English', 'Hindi'],
            description: 'Assistance for Jaipur, Udaipur, Jodhpur, Jaisalmer, and desert circuits.',
            priority: 22
          }
        ];

        for (const entry of helplineSeeds) {
          try {
            await db.pool.query(
              `INSERT INTO tourist_helplines (region, service_name, phone_number, availability, languages, description, priority)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (region, service_name, phone_number) DO NOTHING`,
              [entry.region, entry.service_name, entry.phone_number, entry.availability, entry.languages, entry.description, entry.priority]
            );
          } catch (seedErr) {
            console.warn('[DB] tourist_helplines seed failed:', seedErr && seedErr.message);
          }
        }
      }

      console.log('[DB] tourist_helplines table ready');
    } catch (e) {
      console.warn('[DB] could not ensure tourist_helplines table:', e && e.message);
    }

    try {
      await db.pool.query(`
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
      `);

      const { rows: faqCountRows } = await db.pool.query('SELECT COUNT(*)::INT AS count FROM tourist_support_faqs');
      const currentFaqCount = faqCountRows?.[0]?.count || 0;
      if (currentFaqCount === 0) {
        const faqSeeds = [
          {
            keywords: ['lost passport', 'passport lost', 'missing passport', 'documents lost'],
            response_en: 'If your passport is lost, file an FIR at the nearest police station, contact your embassy or consulate, call the Ministry of Tourism helpline 1800-11-1363 for guidance, and keep digital copies of your identification documents handy.',
            response_hi: 'यदि आपका पासपोर्ट खो गया है तो नज़दीकी पुलिस थाने में एफआईआर दर्ज करें, अपने दूतावास या वाणिज्य दूतावास से संपर्क करें, मार्गदर्शन के लिए पर्यटन मंत्रालय हेल्पलाइन 1800-11-1363 पर कॉल करें और अपने पहचान दस्तावेज़ों की डिजिटल प्रतियां साथ रखें।',
            response_bn: 'পাসপোর্ট হারালে নিকটস্থ থানায় এফআইআর করুন, আপনার দূতাবাস বা কনস্যুলেটের সঙ্গে যোগাযোগ করুন, পরামর্শের জন্য পর্যটন মন্ত্রণালয়ের হেল্পলাইন ১৮০০-১১-১৩৬৩ নম্বরে ফোন করুন এবং পরিচয়পত্রের ডিজিটাল কপি সঙ্গে রাখুন।',
            response_ta: 'பாஸ்போர்ட் இழந்தால் அருகிலுள்ள காவல் நிலையத்தில் FIR பதிவு செய்யவும், உங்கள் தூதரகம் அல்லது துணைத்தூதரகத்தை தொடர்புகொள்ளவும், வழிகாட்டுதலுக்காக τουரிசம் அமைச்சின் 1800-11-1363 உதவி எண்ணை அழைக்கவும், அடையாள ஆவணங்களின் டிஜிட்டல் நகல்களை வைத்திருங்கள்.',
            response_te: 'మీ పాస్‌పోర్ట్ పోతే సమీప పోలీస్ స్టేషన్లో FIR నమోదు చేయండి, మీ రాయబారి కార్యాలయం లేదా కాన్సులేట్‌ను సంప్రదించండి, మార్గదర్శకానికి పర్యాటక మంత్రిత్వ శాఖ హెల్ప్‌లైన్ 1800-11-1363 కి కాల్ చేయండి మరియు మీ గుర్తింపు పత్రాల డిజిటల్ ప్రతులను దగ్గర ఉంచుకోండి.',
            response_mr: 'पासपोर्ट हरवला असल्यास जवळच्या पोलीस ठाण्यात FIR दाखल करा, आपल्या दूतावास किंवा वाणिज्य दूतावासाशी संपर्क साधा, मार्गदर्शनासाठी पर्यटन मंत्रालय हेल्पलाइन 1800-11-1363 वर कॉल करा आणि ओळखपत्रांच्या डिजिटल प्रत्या सोबत ठेवा.',
            response_kn: 'ನಿಮ್ಮ ಪಾಸ್‌ಪೋರ್ಟ್ ಕಳೆದುಹೋದರೆ ಸಮೀಪದ ಪೊಲೀಸ್ ಠಾಣೆಯಲ್ಲಿ FIR ದಾಖಲು ಮಾಡಿ, ನಿಮ್ಮ ರಾಯಭಾರಿ ಕಚೇರಿ ಅಥವಾ ಕಾನ್ಸುಲೇಟ್ ಅನ್ನು ಸಂಪರ್ಕಿಸಿ, ಮಾರ್ಗದರ್ಶನಕ್ಕಾಗಿ ಪ್ರವಾಸೋದ್ಯಮ ಸಚಿವಾಲಯದ 1800-11-1363 ಸಹಾಯವಾಣಿ ಸಂಖ್ಯೆಗೆ ಕರೆ ಮಾಡಿ ಮತ್ತು ಗುರುತುಪತ್ರಗಳ ಡಿಜಿಟಲ್ ಪ್ರತಿಗಳನ್ನು ಹೊಂದಿಡಿ.'
          },
          {
            keywords: ['medical emergency', 'need doctor', 'injury', 'medical help'],
            response_en: 'For medical emergencies dial 112 for immediate assistance, share your live location if possible, and request ambulance support. Government and private hospitals in major cities have dedicated tourist desks.',
            response_hi: 'चिकित्सा आपात स्थिति में त्वरित सहायता के लिए 112 पर कॉल करें, संभव हो तो अपना लाइव लोकेशन साझा करें और एम्बुलेंस सहायता का अनुरोध करें। बड़े शहरों के सरकारी और निजी अस्पतालों में पर्यटकों के लिए समर्पित डेस्क उपलब्ध हैं।',
            response_bn: 'জরুরি চিকিৎসার জন্য অবিলম্বে ১১২ নম্বরে ফোন করুন, সম্ভব হলে আপনার লাইভ লোকেশন শেয়ার করুন এবং অ্যাম্বুলেন্স সহায়তা চান। বড় শহরের সরকারি ও বেসরকারি হাসপাতালগুলোতে পর্যটকদের জন্য বিশেষ ডেস্ক রয়েছে।',
            response_ta: 'மருத்துவ அவசர நிலையிலேயே உடனடி உதவிக்கு 112 ஐ அழைக்கவும், முடிந்தால் உங்கள் நேரடி இருப்பிடத்தை பகிரவும் மற்றும் ஆம்புலன்ஸ் உதவியை கோரவும். பெருநகர மருத்துவமனைகளில்τουரிஸ்ட் சேவை மையங்கள் உள்ளன.',
            response_te: 'వైద్య అత్యవసర పరిస్థితుల్లో వెంటనే సహాయానికి 112 కి కాల్ చేయండి, సాధ్యమైతే మీ ప్రత్యక్ష స్థానాన్ని షేర్ చేయండి మరియు అంబులెన్స్ కోసం అభ్యర్థించండి. ప్రధాన నగరాల్లో ప్రభుత్వం మరియు ప్రైవేట్ ఆసుపత్రుల్లో పర్యాటక డెస్కులు అందుబాటులో ఉన్నాయి.',
            response_mr: 'वैद्यकीय आपत्कालीन स्थितीत त्वरित मदतीसाठी 112 वर कॉल करा, शक्य असल्यास आपले थेट लोकेशन शेअर करा आणि रुग्णवाहिकेची मदत मागवा. मोठ्या शहरांतील सरकारी व खाजगी रुग्णालयांत पर्यटकांसाठी स्वतंत्र डेस्क आहेत.',
            response_kn: 'ವೈದ್ಯಕೀಯ ತುರ್ತು ಪರಿಸ್ಥಿತಿಗೆ ತಕ್ಷಣದ ಸಹಾಯಕ್ಕಾಗಿ 112 ಗೆ ಕರೆ ಮಾಡಿ, ಸಾಧ್ಯವಾದರೆ ನಿಮ್ಮ ಲೈವ್ ಲೊಕೇಶನ್ ಹಂಚಿಕೊಳ್ಳಿ ಮತ್ತು ಆಂಬುಲೆನ್ಸ್ ನೆರವು ಬೇಡಿ. ಪ್ರಮುಖ ನಗರಗಳ ಸರಕಾರಿ ಮತ್ತು ಖಾಸಗಿ ಆಸ್ಪತ್ರೆಗಳಲ್ಲಿ ಪ್ರವಾಸಿಗರಿಗಾಗಿ ವಿಶೇಷ ಡೆಸ್ಕ್‌ಗಳು ಇವೆ.'
          },
          {
            keywords: ['safety tip', 'unsafe area', 'feel unsafe', 'safety advice'],
            response_en: 'Move to a well-lit public space, alert nearby authorities or security staff, and share your real-time location with trusted contacts through the app. You can also call the tourist police helpline listed for your region.',
            response_hi: 'कृपया रोशनी वाले सार्वजनिक स्थान पर जाएँ, नज़दीकी अधिकारियों या सुरक्षा कर्मियों को सूचित करें और ऐप के माध्यम से अपने विश्वसनीय संपर्कों के साथ वास्तविक समय लोकेशन साझा करें। अपने क्षेत्र की सूची में उपलब्ध टूरिस्ट पुलिस हेल्पलाइन पर भी कॉल कर सकते हैं।',
            response_bn: 'উজ্জ্বল আলোযুক্ত জনসমক্ষে চলে যান, আশেপাশের কর্তৃপক্ষ বা সুরক্ষা কর্মীদের জানান এবং অ্যাপের মাধ্যমে বিশ্বাসযোগ্য পরিচিতদের সঙ্গে আপনার রিয়েল-টাইম লোকেশন শেয়ার করুন। আপনার অঞ্চলের তালিকাভুক্ত পর্যটন পুলিশ হেল্পলাইনে ফোন করতে পারেন।',
            response_ta: 'ஒளியுடன் கூடிய பொதுப் பகுதிக்குச் செல்லவும், அருகிலுள்ள அதிகாரிகள் அல்லது பாதுகாப்பு பணியாளர்களுக்கு தகவல்伝டிக்கவும் மற்றும் பயன்பாட்டின் மூலம் நம்பகமான தொடர்புகளுடன் உங்கள் நேரடி இருப்பிடத்தை பகிரவும். உங்கள் பிராந்தியத்திற்கானτουரிஸ்ட் போலீஸ் உதவி எண்ணிற்கு அழைக்கவும்.',
            response_te: 'బాగా వెలుతురు ఉన్న ప్రజా ప్రదేశానికి వెళ్లండి, సమీపంలోని అధికారులు లేదా భద్రతా సిబ్బందికి సమాచಾರమివ్వండి మరియు యాప్ ద్వారా విశ్వసనೀಯ పరిచయాలతో మీ ప్రత్యక్ష స్థానం పంచుకోండి. మీ ప్రాంతానికి సూచించిన పర్యాటక పోలీస్ హెల్ప్‌లైన్ కి కూడా కాల్ చేయండి.',
            response_mr: 'प्रकाशमान सार्वजनिक ठिकाणी जा, जवळच्या अधिकाऱ्यांना किंवा सुरक्षा कर्मचाऱ्यांना कळवा आणि अॅपद्वारे विश्वासू संपर्कांशी आपले प्रत्यक्ष स्थान शेअर करा. आपल्या प्रदेशासाठी सांगितलेल्या टूरिस्ट पोलिस हेल्पलाइनवरही कॉल करा.',
            response_kn: 'ಬೆಳಕುಳ್ಳ ಸಾರ್ವಜನಿಕ ಸ್ಥಳಕ್ಕೆ ಹೋಗಿ, ಸಮೀಪದ ಅಧಿಕಾರಿಗಳು ಅಥವಾ ಭದ್ರತೆಯವರಿಗೆ ತಿಳಿಸಿ ಮತ್ತು ಅಪ್ಲಿಕೇಷನ್ ಮೂಲಕ ವಿಶ್ವಾಸಾರ್ಹ ಸಂಪರ್ಕಗಳಿಗೆ ನಿಮ್ಮ ಲೈವ್ ಸ್ಥಾನವನ್ನು ಹಂಚಿಕೊಳ್ಳಿ. ನಿಮ್ಮ ಪ್ರದೇಶಕ್ಕೆ ಸೂಚಿಸಲಾದ ಪ್ರವಾಸಿ ಪೊಲೀಸ್ ಸಹಾಯವಾಣಿಗೆ ಕರೆ ಮಾಡಬಹುದು.'
          },
          {
            keywords: ['language help', 'translation', 'speak language', 'interpreter'],
            response_en: 'Use the language switcher to receive guidance in your preferred language, show prepared travel cards with translated phrases, and call 1800-11-1363 for interpreter support if officials request clarification.',
            response_hi: 'अपनी पसंदीदा भाषा में मार्गदर्शन पाने के लिए भाषा स्विचर का उपयोग करें, अनुवादित वाक्यों वाले तैयार यात्रा कार्ड दिखाएँ और यदि अधिकारियों को स्पष्टीकरण चाहिए तो 1800-11-1363 पर कॉल करके दुभाषिया सहायता माँगें।',
            response_bn: 'আপনার পছন্দের ভাষায় নির্দেশনা পেতে ভাষা সুইচার ব্যবহার করুন, অনূদিত বাক্যসহ প্রস্তুত ভ্রমণ কার্ড দেখান এবং কর্মকর্তারা ব্যাখ্যা চাইলে ১৮০০-১১-১৩৬৩ নম্বরে ফোন করে দোভাষী সহায়তা নিন।',
            response_ta: 'உங்கள் விருப்பமான மொழியில் வழிகாட்டுதலை பெற மொழி மாற்றியை பயன்படுத்தவும், மொழிபெயர்க்கப்பட்ட சொற்றொடர்களுடன் பயண அட்டைகளை காட்டவும், அதிகாரிகள் தெளிவுபடுத்துமாறு கேட்டால் 1800-11-1363 என்ற எண்ணில் அழைத்து மொழிபெயர்ப்பாளர் உதவியைப் பெறவும்.',
            response_te: 'మీ ఇష్టమైన భాషలో మార్గదర్శకత్వం పొందడానికి భాష స్విచర్‌ను ఉపయోగించండి, అనువదించిన వాక్యాలతో సిద్ధం చేసిన ప్రయాణ కార్డులను చూపండి మరియు అధికారులు వివరణ కోరితే 1800-11-1363 కి కాల్ చేసి అనువాదక సహాయాన్ని అడగండి.',
            response_mr: 'आपल्या पसंतीच्या भाषेत मार्गदर्शन मिळवण्यासाठी भाषा स्विचर वापरा, अनुवादित वाक्यांसह तयार ट्रॅव्हल कार्ड दाखवा आणि अधिकाऱ्यांनी स्पष्टता विचारल्यास 1800-11-1363 वर कॉल करून दुभाषी मदत घ्या.',
            response_kn: 'ನಿಮ್ಮ ಇಷ್ಟದ ಭಾಷೆಯಲ್ಲಿ ಮಾರ್ಗದರ್ಶನ ಪಡೆಯಲು ಭಾಷಾ ಸ್ವಿಚರ್ ಅನ್ನು ಬಳಸಿ, ಅನುವಾದಿತ ಪದಬಂಧಗಳಿರುವ ಪ್ರಯಾಣ ಕಾರ್ಡ್‌ಗಳನ್ನು ತೋರಿಸಿ ಮತ್ತು ಅಧಿಕಾರಿಗಳು ವಿವರಣೆ ಕೇಳಿದರೆ 1800-11-1363 ಗೆ ಕರೆ ಮಾಡಿ ಅನುವಾದಕರ ನೆರವನ್ನು ಪಡೆಯಿರಿ.'
          },
          {
            keywords: ['money exchange', 'currency', 'payment issue', 'card blocked'],
            response_en: 'Use authorised currency exchange counters inside airports, RBI-approved forex outlets, or ATMs inside nationalised banks. For blocked cards contact your bank using the international helpline and keep emergency cash separated in small denominations.',
            response_hi: 'मुद्रा विनिमय के लिए हवाई अड्डों के अधिकृत काउंटर, आरबीआई अनुमोदित फॉरेक्स आउटलेट या राष्ट्रीयकृत बैंकों के एटीएम का उपयोग करें। कार्ड ब्लॉक होने पर अंतरराष्ट्रीय हेल्पलाइन पर अपने बैंक से संपर्क करें और आपातकाल के लिए छोटे मूल्य के नकद पैसे अलग रखें।',
            response_bn: 'মুদ্রা পরিবর্তনের জন্য বিমানবন্দরের অনুমোদিত কাউন্টার, আরবিআই অনুমোদিত ফরেক্স আউটলেট বা জাতীয়করণকৃত ব্যাংকের এটিএম ব্যবহার করুন। কার্ড ব্লক হলে আন্তর্জাতিক হেল্পলাইনের মাধ্যমে আপনার ব্যাংকের সঙ্গে যোগাযোগ করুন এবং জরুরি পরিস্থিতির জন্য ছোট অঙ্কের নগদ আলাদা করে রাখুন।',
            response_ta: 'நாணய மாற்றத்திற்காக விமான நிலைய அங்கீகரிக்கப்பட்ட கவுண்டர்கள், இந்திய ரிசர்வ் வங்கியால் அங்கீகரிக்கப்பட்ட ஃபாரெக்ஸ் மையங்கள் அல்லது தேசிய வங்கிகளின் ATM களை பயன்படுத்தவும். அட்டை முடக்கப்பட்டால் சர்வதேச உதவி எண்ணின் மூலம் உங்கள் வங்கியை தொடர்புகொள்ளவும் மற்றும் அவசரநிலைக்காக சிறு நோட்டுகளாக பணத்தை தனியே வைத்திருங்கள்.',
            response_te: 'కరెన్సీ మార్పిడికి విమానాశ్రయంలోని అధికారిక కౌంటర్లు, RBI అనుమతించిన ఫారెక్స్ ఔట్‌లెట్లు లేదా జాతీయ బ్యాంకుల ATMలను ఉపయోగించండి. కార్డ్ బ్లాక్ అయితే అంతర్జాతీయ హెల్ప్‌లైన్ ద్వారా మీ బ్యాంక్‌ను సంప్రದించండి మరియు అత్యవసర పరిస్థితులకు చిన్న నామములలో నగదు విడిగా ఉంచుకోండి.',
            response_mr: 'चलन बदलासाठी विमानतळावरील अधिकृत काउंटर, RBI मान्यताप्राप्त फॉरेक्स आउटलेट किंवा राष्ट्रीयीकृत बँकांच्या ATM चा वापर करा. कार्ड ब्लॉक झाल्यास आंतरराष्ट्रीय हेल्पलाइनवरून आपल्या बँकेशी संपर्क साधा आणि आपत्कालीन परिस्थितीसाठी कमी मूल्याच्या नोटा वेगळ्या ठेवा.',
            response_kn: 'ಕರೆನ್ಸಿ ವಿನಿಮಯಕ್ಕೆ ವಿಮಾನ ನಿಲ್ದಾಣದ ಅನುಮೋದಿತ ಕೌಂಟರ್‌ಗಳು, RBI ಅಂಗೀಕೃತ ಫಾರೆಕ್ಸ್ ಔಟ್‌ಲೆಟ್‌ಗಳು ಅಥವಾ ರಾಷ್ಟ್ರೀಕೃತ ಬ್ಯಾಂಕ್‌ಗಳ ATM‌ಗಳನ್ನು ಬಳಸಿ. ಕಾರ್ಡ್ ಬ್ಲಾಕ್ ಆದರೆ ಅಂತರರಾಷ್ಟ್ರೀಯ ಸಹಾಯವಾಣಿ ಮೂಲಕ ನಿಮ್ಮ ಬ್ಯಾಂಕನ್ನು ಸಂಪರ್ಕಿಸಿ ಮತ್ತು ತುರ್ತು ಸಂದರ್ಭಕ್ಕೆ ಸಣ್ಣ ಕೊರತೆಗಳ ನಗದನ್ನು ಪ್ರತ್ಯೇಕವಾಗಿ ಇಟ್ಟುಕೊಳ್ಳಿ.'
          }
        ];

        for (const entry of faqSeeds) {
          try {
            await db.pool.query(
              `INSERT INTO tourist_support_faqs (keywords, response_en, response_hi, response_bn, response_ta, response_te, response_mr, response_kn)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [entry.keywords, entry.response_en, entry.response_hi, entry.response_bn, entry.response_ta, entry.response_te, entry.response_mr, entry.response_kn]
            );
          } catch (seedErr) {
            console.warn('[DB] tourist_support_faqs seed failed:', seedErr && seedErr.message);
          }
        }
      }

      console.log('[DB] tourist_support_faqs table ready');
    } catch (e) {
      console.warn('[DB] could not ensure tourist_support_faqs table:', e && e.message);
    }

    // Seed safe zones data
    try {
      const { rows: safeZonesCountRows } = await db.pool.query('SELECT COUNT(*)::INT AS count FROM safe_zones');
      const currentSafeZonesCount = safeZonesCountRows?.[0]?.count || 0;
      if (currentSafeZonesCount === 0) {
        const safeZonesSeeds = [
          // Delhi Safe Zones
          { name: 'Safdarjung Hospital', type: 'hospital', latitude: 28.5672, longitude: 77.2034, address: 'Ring Road, Safdarjung Enclave', contact: '011-26730007', city: 'Delhi', district: 'New Delhi', state: 'Delhi', operational_hours: '24x7', services: ['Emergency', 'Trauma', 'ICU'], verified: true },
          { name: 'All India Institute of Medical Sciences (AIIMS)', type: 'hospital', latitude: 28.5638, longitude: 77.2093, address: 'Ansari Nagar', contact: '011-26588500', city: 'Delhi', district: 'New Delhi', state: 'Delhi', operational_hours: '24x7', services: ['Emergency', 'Multi-Specialty', 'ICU'], verified: true },
          { name: 'Connaught Place Police Station', type: 'police', latitude: 28.6321, longitude: 77.2194, address: 'Connaught Place', contact: '011-23415050', city: 'Delhi', district: 'Central Delhi', state: 'Delhi', operational_hours: '24x7', services: ['Tourist Police', 'FIR', 'Women Safety'], verified: true },
          { name: 'Delhi Govt Night Shelter - Nizamuddin', type: 'shelter', latitude: 28.5889, longitude: 77.2506, address: 'Nizamuddin West', contact: '011-23358180', city: 'Delhi', district: 'South Delhi', state: 'Delhi', operational_hours: '18:00-08:00', services: ['Night Shelter', 'Meals', 'First Aid'], verified: true },
          
          // Mumbai Safe Zones
          { name: 'KEM Hospital', type: 'hospital', latitude: 19.0041, longitude: 73.0117, address: 'Parel', contact: '022-24107000', city: 'Mumbai', district: 'Mumbai', state: 'Maharashtra', operational_hours: '24x7', services: ['Emergency', 'Trauma', 'Burn Unit'], verified: true },
          { name: 'Colaba Police Station', type: 'police', latitude: 18.9186, longitude: 72.8253, address: 'Colaba Causeway', contact: '022-22151503', city: 'Mumbai', district: 'Mumbai City', state: 'Maharashtra', operational_hours: '24x7', services: ['Tourist Police', 'FIR'], verified: true },
          { name: 'Mumbai Govt Emergency Shelter', type: 'shelter', latitude: 19.0760, longitude: 72.8777, address: 'Andheri East', contact: '022-26827200', city: 'Mumbai', district: 'Mumbai Suburban', state: 'Maharashtra', operational_hours: '24x7', services: ['Emergency Shelter', 'Food', 'Medical Aid'], verified: true },
          
          // Bangalore Safe Zones
          { name: 'Victoria Hospital', type: 'hospital', latitude: 12.9637, longitude: 77.5894, address: 'Fort, KR Market', contact: '080-26700300', city: 'Bangalore', district: 'Bangalore Urban', state: 'Karnataka', operational_hours: '24x7', services: ['Emergency', 'General', 'ICU'], verified: true },
          { name: 'Cubbon Park Police Station', type: 'police', latitude: 12.9754, longitude: 77.5931, address: 'Kasturba Road', contact: '080-22867100', city: 'Bangalore', district: 'Bangalore Urban', state: 'Karnataka', operational_hours: '24x7', services: ['Tourist Safety', 'FIR'], verified: true },
          { name: 'Bangalore Night Shelter - Shivajinagar', type: 'shelter', latitude: 12.9835, longitude: 77.6023, address: 'Shivajinagar', contact: '080-22255678', city: 'Bangalore', district: 'Bangalore Urban', state: 'Karnataka', operational_hours: '19:00-07:00', services: ['Night Shelter', 'Meals'], verified: true },
          
          // Chennai Safe Zones
          { name: 'Government Stanley Hospital', type: 'hospital', latitude: 13.0784, longitude: 80.2826, address: 'Old Jail Road, Royapuram', contact: '044-25281351', city: 'Chennai', district: 'Chennai', state: 'Tamil Nadu', operational_hours: '24x7', services: ['Emergency', 'Trauma'], verified: true },
          { name: 'Marina Beach Police Station', type: 'police', latitude: 13.0502, longitude: 80.2828, address: 'Marina Beach Road', contact: '044-23452020', city: 'Chennai', district: 'Chennai', state: 'Tamil Nadu', operational_hours: '24x7', services: ['Beach Patrol', 'Tourist Safety'], verified: true },
          { name: 'Chennai Corporation Shelter', type: 'shelter', latitude: 13.0827, longitude: 80.2707, address: 'Park Town', contact: '044-25361200', city: 'Chennai', district: 'Chennai', state: 'Tamil Nadu', operational_hours: '24x7', services: ['Emergency Shelter', 'Food'], verified: true },
          
          // Kolkata Safe Zones
          { name: 'SSKM Hospital', type: 'hospital', latitude: 22.5414, longitude: 88.3536, address: '244 AJC Bose Road', contact: '033-22231200', city: 'Kolkata', district: 'Kolkata', state: 'West Bengal', operational_hours: '24x7', services: ['Emergency', 'Multi-Specialty'], verified: true },
          { name: 'Park Street Police Station', type: 'police', latitude: 22.5536, longitude: 88.3525, address: 'Park Street', contact: '033-22298000', city: 'Kolkata', district: 'Kolkata', state: 'West Bengal', operational_hours: '24x7', services: ['Tourist Police', 'FIR'], verified: true },
          { name: 'Kolkata Night Shelter - Sealdah', type: 'shelter', latitude: 22.5687, longitude: 88.3706, address: 'Sealdah Station Area', contact: '033-23502300', city: 'Kolkata', district: 'Kolkata', state: 'West Bengal', operational_hours: '20:00-06:00', services: ['Night Shelter', 'Meals'], verified: true },
          
          // Hyderabad Safe Zones
          { name: 'Gandhi Hospital', type: 'hospital', latitude: 17.4420, longitude: 78.4815, address: 'Musheerabad', contact: '040-27562613', city: 'Hyderabad', district: 'Hyderabad', state: 'Telangana', operational_hours: '24x7', services: ['Emergency', 'Trauma'], verified: true },
          { name: 'Hussain Sagar Police Station', type: 'police', latitude: 17.4281, longitude: 78.4752, address: 'Tank Bund Road', contact: '040-27604500', city: 'Hyderabad', district: 'Hyderabad', state: 'Telangana', operational_hours: '24x7', services: ['Tourist Safety', 'FIR'], verified: true },
          
          // Pune Safe Zones
          { name: 'Sassoon General Hospital', type: 'hospital', latitude: 18.5221, longitude: 73.8598, address: 'Near Railway Station', contact: '020-26126262', city: 'Pune', district: 'Pune', state: 'Maharashtra', operational_hours: '24x7', services: ['Emergency', 'Trauma', 'ICU'], verified: true },
          { name: 'Shivajinagar Police Station', type: 'police', latitude: 18.5304, longitude: 73.8445, address: 'Fergusson College Road', contact: '020-25532900', city: 'Pune', district: 'Pune', state: 'Maharashtra', operational_hours: '24x7', services: ['Tourist Help', 'FIR'], verified: true },
          
          // Jaipur Safe Zones
          { name: 'SMS Hospital', type: 'hospital', latitude: 26.9181, longitude: 75.7981, address: 'JLN Marg', contact: '0141-2516222', city: 'Jaipur', district: 'Jaipur', state: 'Rajasthan', operational_hours: '24x7', services: ['Emergency', 'Multi-Specialty'], verified: true },
          { name: 'M.I. Road Police Station', type: 'police', latitude: 26.9151, longitude: 75.8140, address: 'M.I. Road', contact: '0141-2566777', city: 'Jaipur', district: 'Jaipur', state: 'Rajasthan', operational_hours: '24x7', services: ['Tourist Police', 'FIR'], verified: true },
          
          // Ahmedabad Safe Zones
          { name: 'Civil Hospital', type: 'hospital', latitude: 23.0290, longitude: 72.5823, address: 'Asarwa', contact: '079-22680074', city: 'Ahmedabad', district: 'Ahmedabad', state: 'Gujarat', operational_hours: '24x7', services: ['Emergency', 'Trauma'], verified: true },
          { name: 'CG Road Police Station', type: 'police', latitude: 23.0290, longitude: 72.5585, address: 'C.G. Road', contact: '079-26560100', city: 'Ahmedabad', district: 'Ahmedabad', state: 'Gujarat', operational_hours: '24x7', services: ['Tourist Safety'], verified: true },
          
          // Goa Safe Zones
          { name: 'Goa Medical College Hospital', type: 'hospital', latitude: 15.4530, longitude: 73.8120, address: 'Bambolim', contact: '0832-2458700', city: 'Panaji', district: 'North Goa', state: 'Goa', operational_hours: '24x7', services: ['Emergency', 'Trauma', 'ICU'], verified: true },
          { name: 'Calangute Police Station', type: 'police', latitude: 15.5392, longitude: 73.7549, address: 'Calangute Beach Road', contact: '0832-2277333', city: 'Calangute', district: 'North Goa', state: 'Goa', operational_hours: '24x7', services: ['Beach Patrol', 'Tourist Police'], verified: true },
          
          // Treatment Centres (De-addiction/Rehab)
          { name: 'AIIMS National Drug Dependence Treatment Centre', type: 'treatment_centre', latitude: 28.5680, longitude: 77.2093, address: 'AIIMS Campus, Ansari Nagar', contact: '011-26593465', city: 'Delhi', district: 'New Delhi', state: 'Delhi', operational_hours: '09:00-17:00', services: ['De-addiction', 'Counseling', 'Rehabilitation'], verified: true },
          { name: 'NIMHANS Centre for Addiction Medicine', type: 'treatment_centre', latitude: 12.9434, longitude: 77.5969, address: 'Hosur Road', contact: '080-26995000', city: 'Bangalore', district: 'Bangalore Urban', state: 'Karnataka', operational_hours: '08:00-16:00', services: ['Mental Health', 'De-addiction', 'Therapy'], verified: true },
        ];

        for (const zone of safeZonesSeeds) {
          try {
            await db.pool.query(
              `INSERT INTO safe_zones(
                name, type, latitude, longitude, address, contact, city, district, state, country, operational_hours, services, facilities, verified, active
              ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
              [
                zone.name,
                zone.type,
                zone.latitude,
                zone.longitude,
                zone.address,
                zone.contact,
                zone.city,
                zone.district,
                zone.state,
                zone.country || 'India',
                zone.operational_hours,
                zone.services,
                zone.facilities || null,
                zone.verified,
                zone.active !== undefined ? zone.active : true
              ]
            );
          } catch (seedErr) {
            console.warn('[DB] safe_zones seed failed:', seedErr && seedErr.message);
          }
        }
        console.log('[DB] safe_zones seeded with sample data');
      }
    } catch (e) {
      console.warn('[DB] could not seed safe_zones:', e && e.message);
    }

    // Safety ratings, aggregated score cells, and geo-targeted safety alerts
    try {
      await db.pool.query(`
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
      `);
      console.log('[DB] safety ratings/score cells ready');
    } catch (e) {
      console.warn('[DB] could not ensure safety ratings/score cells:', e && e.message);
    }

    try {
      await db.pool.query(`
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
      `);
      console.log('[DB] safety alerts table ready');

      // Seed a couple of active alerts for demo if empty
      try {
        const { rows: sCnt } = await db.pool.query('SELECT COUNT(*)::INT AS count FROM safety_alerts');
        if ((sCnt?.[0]?.count || 0) === 0) {
          await db.pool.query(`
            INSERT INTO safety_alerts(title, category, severity, description, latitude, longitude, radius_m, status, source)
            VALUES
            ('Road Accident - Slow Down', 'accident', 'medium', 'Traffic disruption due to a multi-vehicle collision.', 28.6139, 77.2090, 1200, 'active', 'mock'),
            ('Heavy Rainfall Alert', 'disaster', 'high', 'Potential waterlogging in low-lying areas. Exercise caution.', 19.0760, 72.8777, 5000, 'active', 'mock')
            ON CONFLICT DO NOTHING;
          `);
          console.log('[DB] safety_alerts seeded with sample data');
        }
      } catch (seedErr) {
        console.warn('[DB] safety_alerts seed failed:', seedErr && seedErr.message);
      }
    } catch (e) {
      console.warn('[DB] could not ensure safety alerts table:', e && e.message);
    }
  } catch (err) {
    console.warn('[DB] ensureDatabaseShape encountered errors:', err && err.message);
  }
}

// --- CORS: Must be first, before any static or route handlers ---
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || isOriginAllowed(origin)) return callback(null, true);
      const err = new Error('Not allowed by CORS');
      err.status = 403;
      err.data = { origin };
      return callback(err);
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "ngrok-skip-browser-warning", "Authorization"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  })
);

// CORS for static profile images
app.use('/uploads/profile-images', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
  }
  next();
});
// --- Profile Image Upload and Retrieval ---
const PROFILE_IMAGE_DIR = path.join(__dirname, 'uploads', 'profile-images');
try { if (!fs.existsSync(PROFILE_IMAGE_DIR)) fs.mkdirSync(PROFILE_IMAGE_DIR, { recursive: true }); } catch (e) {}
const profileImageStorage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, PROFILE_IMAGE_DIR); },
  filename: function (req, file, cb) {
    // Use passportId (tourist) or email/aadhaarNumber (women) from session or body, fallback to uuid
    let safeBase = 'unknown';
    if (req.body.passportId) safeBase = String(req.body.passportId).replace(/[^a-zA-Z0-9_-]/g, '_');
    else if (req.family && req.family.passportId) safeBase = String(req.family.passportId).replace(/[^a-zA-Z0-9_-]/g, '_');
    else if (req.user && req.user.passportId) safeBase = String(req.user.passportId).replace(/[^a-zA-Z0-9_-]/g, '_');
    else if (req.body.email) safeBase = String(req.body.email).replace(/[^a-zA-Z0-9_-]/g, '_');
    else if (req.body.aadhaarNumber) safeBase = String(req.body.aadhaarNumber).replace(/[^a-zA-Z0-9_-]/g, '_');
    const ts = Date.now();
    cb(null, `${safeBase}-profile-${ts}${path.extname(file.originalname || '')}`);
  }
});
const profileImageUpload = multer({ storage: profileImageStorage, limits: { fileSize: 5 * 1024 * 1024 } });

// POST /api/user/profile-image (upload profile image for current user - tourist or women)
app.post('/api/user/profile-image', profileImageUpload.single('profileImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Image file is required.' });
    }

    const imageUrl = `/uploads/profile-images/${req.file.filename}`;
    
    // Try to identify user: tourist (passportId) or women (email/aadhaarNumber)
    const passportId = req.body.passportId || (req.family && req.family.passportId) || (req.user && req.user.passportId);
    const email = req.body.email || req.body.userEmail;
    const aadhaarNumber = req.body.aadhaarNumber || req.body.aadhaar;
    
    // Handle tourist users (with passportId)
    if (passportId) {
      try {
        await db.pool.query('UPDATE tourists SET profile_picture_url = $1 WHERE passport_id = $2', [imageUrl, passportId]);
        console.log(`[Profile Image] Updated for tourist: ${passportId}`);
        return res.status(200).json({ url: imageUrl, message: 'Profile image uploaded successfully.' });
      } catch (dbErr) {
        console.warn('Primary update (tourists.profile_picture_url) failed, trying users.profile_image:', dbErr && dbErr.message);
        await db.pool.query('UPDATE users SET profile_image = $1 WHERE passport_id = $2', [imageUrl, passportId]);
        console.log(`[Profile Image] Updated for user: ${passportId}`);
        return res.status(200).json({ url: imageUrl, message: 'Profile image uploaded successfully.' });
      }
    }
    
    // Handle women users (with email or aadhaarNumber)
    if (email || aadhaarNumber) {
      try {
        let updateQuery = '';
        let queryParams = [];
        
        if (email) {
          updateQuery = 'UPDATE women_users SET profile_picture_url = $1 WHERE email = $2';
          queryParams = [imageUrl, email];
        } else if (aadhaarNumber) {
          updateQuery = 'UPDATE women_users SET profile_picture_url = $1 WHERE aadhaar_number = $2';
          queryParams = [imageUrl, aadhaarNumber];
        }
        
        const result = await db.pool.query(updateQuery, queryParams);
        
        if (result.rowCount === 0) {
          return res.status(404).json({ message: 'User not found.' });
        }
        
        console.log(`[Profile Image] Updated for women user: ${email || aadhaarNumber}`);
        return res.status(200).json({ url: imageUrl, message: 'Profile image uploaded successfully.' });
      } catch (dbErr) {
        console.error('[Profile Image] Failed to update women user profile image:', dbErr);
        return res.status(500).json({ message: 'Failed to save profile image to database.' });
      }
    }
    
    // No valid identifier provided
    return res.status(400).json({ 
      message: 'User identifier required. Provide passportId (for tourists) or email/aadhaarNumber (for women users).' 
    });
    
  } catch (e) {
    console.error('Failed to upload profile image:', e && e.message);
    return res.status(500).json({ message: 'Failed to upload image.' });
  }
});
app.get('/api/user/profile-image', async (req, res) => {
  try {
    // Try to identify user: tourist (passportId) or women (email/aadhaarNumber)
    const passportId = (req.family && req.family.passportId) || req.query.passportId || req.user?.passportId;
    const email = req.query.email || req.query.userEmail;
    const aadhaarNumber = req.query.aadhaarNumber || req.query.aadhaar;
    
    let url = null;
    
    // Handle tourist users (with passportId)
    if (passportId) {
      try {
        // Prefer explicit profile picture URL
        const result = await db.pool.query('SELECT profile_picture_url, passport_image_url FROM tourists WHERE passport_id = $1', [passportId]);
        url = result.rows[0]?.profile_picture_url || result.rows[0]?.passport_image_url || null;
      } catch (dbErr) {
        console.warn('Primary select (tourists.profile_picture_url) failed, trying users.profile_image:', dbErr && dbErr.message);
        const result2 = await db.pool.query('SELECT profile_image FROM users WHERE passport_id = $1', [passportId]);
        url = result2.rows[0]?.profile_image || null;
      }
    }
    
    // Handle women users (with email or aadhaarNumber)
    if (!url && (email || aadhaarNumber)) {
      try {
        let selectQuery = '';
        let queryParams = [];
        
        if (email) {
          selectQuery = 'SELECT profile_picture_url FROM women_users WHERE email = $1';
          queryParams = [email];
        } else if (aadhaarNumber) {
          selectQuery = 'SELECT profile_picture_url FROM women_users WHERE aadhaar_number = $1';
          queryParams = [aadhaarNumber];
        }
        
        const result = await db.pool.query(selectQuery, queryParams);
        url = result.rows[0]?.profile_picture_url || null;
      } catch (dbErr) {
        console.warn('[Profile Image] Failed to fetch women user profile image:', dbErr);
      }
    }
    
    // Validate that the file exists on disk; if not, fall back to default avatar
    try {
      if (url && url.startsWith('/uploads/')) {
        const localPath = path.join(__dirname, url);
        const rootPath = path.join(__dirname, '..', url);
        const exists = fs.existsSync(localPath) || fs.existsSync(rootPath);
        if (!exists) {
          console.warn(`Profile image file missing:`, url);
          url = '/uploads/profile-images/default-avatar.png';
        }
      }
    } catch (_) {}
    
    return res.json({ url });
  } catch (e) {
    console.error('[Profile Image] Error fetching profile image:', e);
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
    origin(origin, callback) {
      if (!origin || isOriginAllowed(origin)) return callback(null, true);
      const err = new Error('CORS_ORIGIN_DENIED');
      err.data = { origin };
      return callback(err, false);
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
const responderSockets = new Map(); // socket.id -> responder metadata
// Simple in-memory store for recent admin notifications (last 50)
const adminNotifications = [];
const port = Number(process.env.PORT) || 3001;
let transporter = null;
const emailUser = process.env.EMAIL_USER;
const emailPass = process.env.EMAIL_PASS;
if (emailUser && emailPass) {
  transporter = nodemailer.createTransport({
    service: "gmail", // Or 'outlook', etc.
    auth: {
      user: emailUser,
      pass: emailPass,
    },
  });
} else {
  console.warn('[Email] EMAIL_USER/EMAIL_PASS not configured. Email notifications disabled.');
}

const sendMailSafely = async (mailOptions = {}) => {
  if (!transporter) {
    console.warn('[Email] Skipping email send because transporter is not configured.');
    return;
  }

  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error('[Email] Failed to send email:', error.message || error);
  }
};
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

// --- Safety score cell helpers (simple grid, no PostGIS required) ---
function gridCellFor(lat, lon, precision = 0.01) {
  const p = Number(precision) || 0.01;
  const clat = Math.floor(lat / p) * p;
  const clon = Math.floor(lon / p) * p;
  const fix = Math.max(0, String(p).includes('.') ? String(p).split('.')[1].length : 2);
  const cellId = `${clat.toFixed(fix)}_${clon.toFixed(fix)}`;
  return { cellId, cellLat: clat, cellLon: clon };
}
function degDeltaForRadiusMeters(lat, radiusMeters = 1000) {
  const latDelta = radiusMeters / 111320; // ~ meters per degree latitude
  const lonDelta = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180) || 1);
  return { latDelta, lonDelta };
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
    const phoneCandidates = [
      row.emergency_contact,
      row.emergency_contact_1,
      row.emergency_contact_2,
    ].filter(Boolean);

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

    await Promise.all(emails.map((to) => sendMailSafely({
      from: '"Smart Tourist Safety" <smarttouristsystem@gmail.com>',
      to,
      subject: `[${alertLabel}] ${touristName} needs assistance`,
      text: textBody,
      html: htmlBody,
    })));

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
          // Auto-enqueue SMS for offline fallback retry
          try {
            await db.pool.query(
              `INSERT INTO sms_queue(passport_id, phone_number, message, channel, status) VALUES($1,$2,$3,$4,'pending')`,
              [passportId, normalized, messageBody, 'sms']
            );
            console.log(`[Auto-Enqueue] SMS queued for ${passportId} to ${normalized}`);
          } catch (queueErr) {
            console.error('[Auto-Enqueue] Failed to queue SMS:', queueErr && queueErr.message);
          }
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
// Fallback middleware: echo Origin and ensure credentialed CORS headers for all routes
// This helps when requests come through proxies (ngrok) that require the exact Origin to be echoed
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
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

app.post('/api/v1/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }

    const adminRow = await db.getAdminUserByEmail(email);
    if (!adminRow || adminRow.is_active === false) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const passwordOk = await bcrypt.compare(password, adminRow.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = issueAdminToken(adminRow);
    res.cookie(ADMIN_TOKEN_COOKIE, token, ADMIN_COOKIE_OPTIONS);
    db.touchAdminLastLogin(adminRow.id).catch(() => {});

    return res.json({ admin: sanitizeAdminRow(adminRow) });
  } catch (err) {
    console.error('Admin login failed:', err && err.message);
    return res.status(500).json({ message: 'Failed to login admin' });
  }
});

app.post('/api/v1/admin/logout', (req, res) => {
  try {
    res.clearCookie(ADMIN_TOKEN_COOKIE, ADMIN_COOKIE_OPTIONS);
  } catch (e) {
    console.debug('clearCookie failed:', e && e.message);
  }
  res.json({ ok: true });
});

app.get('/api/v1/admin/me', authenticateAdmin, (req, res) => {
  res.json({ admin: req.admin });
});

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

// ---------------- Tourist Safety: Safety Score & Alerts API ----------------
// Submit a neighborhood safety rating (tourist-only usage path)
app.post('/api/v1/safety/ratings', async (req, res) => {
  try {
    const { score, latitude, longitude, passport_id, passportId, tags, comment, precision } = req.body || {};
    const s = parseInt(score, 10);
    if (!Number.isFinite(s) || s < 1 || s > 5) return res.status(400).json({ message: 'score must be 1..5' });
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ message: 'latitude/longitude required' });
    const pid = (passport_id || passportId || '').trim() || null;
    const p = Number(precision) || 0.01;
    const cell = gridCellFor(lat, lon, p);

    // Insert rating row
    await db.pool.query(
      `INSERT INTO safety_ratings(passport_id, score, tags, comment, latitude, longitude, cell_id, cell_lat, cell_lon)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [pid, s, Array.isArray(tags) ? tags : null, comment || null, lat, lon, cell.cellId, cell.cellLat, cell.cellLon]
    );

    // Upsert aggregate cell
    await db.pool.query(
      `INSERT INTO safety_score_cells(cell_id, cell_lat, cell_lon, avg_score, ratings_count, last_score)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT (cell_id)
       DO UPDATE SET
         avg_score = ((safety_score_cells.avg_score * safety_score_cells.ratings_count) + EXCLUDED.last_score)
                     / (safety_score_cells.ratings_count + 1),
         ratings_count = safety_score_cells.ratings_count + 1,
         last_score = EXCLUDED.last_score,
         last_updated = now()`,
      [cell.cellId, cell.cellLat, cell.cellLon, s, 1, s]
    );

    const q = await db.pool.query('SELECT cell_id, cell_lat, cell_lon, avg_score, ratings_count, last_updated FROM safety_score_cells WHERE cell_id = $1', [cell.cellId]);
    return res.status(201).json({ cell: q.rows[0] });
  } catch (e) {
    console.error('rating insert failed:', e && e.message);
    return res.status(500).json({ message: 'Failed to submit rating' });
  }
});

// Fetch aggregated safety score cells around a location
app.get('/api/v1/safety/score', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    const radius = Math.min(parseInt(req.query.radius, 10) || 2000, 10000);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ message: 'lat/lon required' });
    const { latDelta, lonDelta } = degDeltaForRadiusMeters(lat, radius);
    const minLat = lat - latDelta, maxLat = lat + latDelta;
    const minLon = lon - lonDelta, maxLon = lon + lonDelta;
    const rs = await db.pool.query(
      `SELECT cell_id, cell_lat, cell_lon, avg_score, ratings_count, last_updated
       FROM safety_score_cells
       WHERE cell_lat BETWEEN $1 AND $2 AND cell_lon BETWEEN $3 AND $4
       ORDER BY ratings_count DESC, avg_score DESC
       LIMIT 200`,
      [minLat, maxLat, minLon, maxLon]
    );
    // Weighted average for the area
    let sum = 0, count = 0;
    rs.rows.forEach(r => { sum += (r.avg_score || 0) * (r.ratings_count || 0); count += (r.ratings_count || 0); });
    const areaAvg = count > 0 ? Math.round((sum / count) * 10) / 10 : null;
    return res.json({ cells: rs.rows, areaAvg });
  } catch (e) {
    return res.status(500).json({ message: 'Failed to fetch safety score' });
  }
});

// List active safety alerts near a point (client polls periodically)
app.get('/api/v1/safety/alerts', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    const radius = Math.min(parseInt(req.query.radius, 10) || 3000, 20000);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ message: 'lat/lon required' });
    const { latDelta, lonDelta } = degDeltaForRadiusMeters(lat, radius + 1000);
    const minLat = lat - latDelta, maxLat = lat + latDelta;
    const minLon = lon - lonDelta, maxLon = lon + lonDelta;
    const q = await db.pool.query(
      `SELECT id, title, category, severity, description, latitude, longitude, radius_m, status, source, starts_at, ends_at, updated_at
       FROM safety_alerts
       WHERE status = 'active'
         AND latitude BETWEEN $1 AND $2 AND longitude BETWEEN $3 AND $4
       ORDER BY severity DESC, updated_at DESC
       LIMIT 200`,
      [minLat, maxLat, minLon, maxLon]
    );
    return res.json({ alerts: q.rows });
  } catch (e) {
    return res.status(500).json({ message: 'Failed to fetch safety alerts' });
  }
});

// Admin/testing: create a safety alert (guarded by optional secret)
app.post('/api/v1/safety/alerts', async (req, res) => {
  try {
    const secret = process.env.ADMIN_SECRET || '';
    if (secret && (req.headers['x-admin-secret'] !== secret)) return res.status(401).json({ message: 'Unauthorized' });
    const { title, category, severity, description, latitude, longitude, radius_m, status, source, starts_at, ends_at } = req.body || {};
    if (!title || !category || !Number.isFinite(parseFloat(latitude)) || !Number.isFinite(parseFloat(longitude))) {
      return res.status(400).json({ message: 'title, category, latitude, longitude required' });
    }
    const ins = await db.pool.query(
      `INSERT INTO safety_alerts(title, category, severity, description, latitude, longitude, radius_m, status, source, starts_at, ends_at)
       VALUES($1,$2,$3,$4,$5,$6,COALESCE($7,1000),COALESCE($8,'active'),$9,COALESCE($10,now()),$11)
       RETURNING id`,
      [title, String(category).toLowerCase(), (severity || 'medium'), description || null, parseFloat(latitude), parseFloat(longitude), radius_m ? parseInt(radius_m, 10) : null, status || null, source || 'manual', starts_at || null, ends_at || null]
    );
    const id = ins.rows[0].id;
    try { io.emit('safety_alerts:update', { type: 'created', id }); } catch (_) {}
    return res.status(201).json({ id });
  } catch (e) {
    console.error('create safety alert failed:', e && e.message);
    return res.status(500).json({ message: 'Failed to create alert' });
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

    // Women Safety: If passportId indicates a women user (WOMEN-<id>), persist into women tables instead of tourists
    const womenMatch = passportId && String(passportId).match(/^WOMEN-(\d+)$/i);
    if (womenMatch) {
      const womenId = parseInt(womenMatch[1], 10);
      if (!Number.isFinite(womenId)) return res.status(400).json({ message: 'Invalid women user id' });

      // Compute completeness for women profile (basic fields + at least one emergency contact)
      const baseComplete = [fullName, contactNumber, email].every(Boolean);
      const hasAnyEmergency = Boolean(emergencyPhone1 || emergencyEmail1 || emergencyPhone2 || emergencyEmail2);
      const profileComplete = baseComplete && hasAnyEmergency;

      try {
        // Update core fields in women_users
        await db.pool.query(
          `UPDATE women_users SET
            name = COALESCE($1, name),
            mobile_number = COALESCE($2, mobile_number),
            email = COALESCE($3, email),
            last_seen = NOW()
           WHERE id = $4`,
          [fullName || null, contactNumber || null, email || null, womenId]
        );

        // Refresh top two emergency contacts with priority 1 and 2
        // Simpler approach: delete existing priority 1/2, then insert fresh values present in the form
        await db.pool.query('DELETE FROM women_emergency_contacts WHERE user_id = $1 AND (priority = 1 OR priority = 2)', [womenId]);

        const inserts = [];
        if (emergencyPhone1) {
          inserts.push(db.pool.query(
            `INSERT INTO women_emergency_contacts (user_id, name, mobile_number, email, relationship, priority)
             VALUES ($1, $2, $3, $4, $5, 1)`,
            [womenId, 'Primary', emergencyPhone1 || null, emergencyEmail1 || null, 'family']
          ));
        }
        if (emergencyPhone2) {
          inserts.push(db.pool.query(
            `INSERT INTO women_emergency_contacts (user_id, name, mobile_number, email, relationship, priority)
             VALUES ($1, $2, $3, $4, $5, 2)`,
            [womenId, 'Secondary', emergencyPhone2 || null, emergencyEmail2 || null, 'family']
          ));
        }
        if (inserts.length) await Promise.all(inserts);

        // Note: Women flow currently ignores uploaded passport/visa files; retained on disk for audit if needed
        console.log('Saved women profile submission:', {
          userId: womenId,
          fullName, contactNumber, email,
          emergencyPhone1, emergencyEmail1, emergencyPhone2, emergencyEmail2,
          profileComplete,
        });

        // Fetch latest profile data to return
        const userRes = await db.pool.query('SELECT id, name, mobile_number, email FROM women_users WHERE id = $1', [womenId]);
        const userRow = userRes.rows[0] || {};
        const contactsRes = await db.pool.query('SELECT name, mobile_number, email, relationship, priority FROM women_emergency_contacts WHERE user_id = $1 ORDER BY priority', [womenId]);
        const contacts = contactsRes.rows || [];

        return res.status(200).json({
          message: 'Profile saved successfully!',
          profileComplete,
          profile: {
            fullName: userRow.name || '',
            contactNumber: userRow.mobile_number || '',
            email: userRow.email || '',
            passportId: `WOMEN-${womenId}`,
            emergencyContacts: contacts.map(c => ({
              name: c.name,
              number: c.mobile_number,
              email: c.email,
              relationship: c.relationship,
              priority: c.priority
            }))
          }
        });
      } catch (e) {
        console.error('Failed to persist women profile:', e && e.message);
        return res.status(500).json({ message: 'Failed to save profile.' });
      }
    }

    // Compute completeness (required fields + essential files)
    const requiredForComplete = [
      fullName, contactNumber, email, passportId, country, visaId, visaExpiry,
      emergencyPhone1, emergencyEmail1, emergencyPhone2, emergencyEmail2,
    ];
    // We require at least main passport and visa details files to be present
    const profileComplete = requiredForComplete.every(Boolean) && (!!passportMainUrl || !!req.body.passportMainUrl) && (!!visaDetailsUrl || !!req.body.visaDetailsUrl);

    // Persist full profile to tourists (default flow)
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
    const qpEmail = (qp.email || '').trim().toLowerCase();
    const aadhaarRaw = qp.aadhaar || qp.aadhaarId || qp.aadhaar_number || '';
    const qpAadhaar = normalizeGovernmentId(aadhaarRaw, 'aadhaar');
    const qpServiceType = (qp.serviceType || '').trim().toLowerCase();

    const qpPassportIdRaw = (qp.passportId || '').trim();
    let qpPassportId = qpPassportIdRaw || undefined;
    if (!qpPassportId) {
      if (qpServiceType === 'women_safety') {
        if (req.cookies?.womenUserId) {
          qpPassportId = `WOMEN-${req.cookies.womenUserId}`;
        }
      } else {
        if (req.cookies?.passportId) {
          qpPassportId = req.cookies.passportId;
        }
      }
    }

    const womenMatch = qpPassportId ? String(qpPassportId).match(/^WOMEN-(\d+)$/i) : null;
    let isWomenFlow = false;
    if (womenMatch) {
      isWomenFlow = true;
    } else if (qpServiceType === 'women_safety') {
      isWomenFlow = true;
    }

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

io.use((socket, next) => {
  try {
    const origin = socket.handshake.headers?.origin;
    if (origin && !isOriginAllowed(origin)) {
      const err = new Error('CORS_ORIGIN_DENIED');
      err.data = { origin };
      return next(err);
    }

    const auth = socket.handshake.auth || {};
    const query = socket.handshake.query || {};
    const clientTypeRaw = auth.clientType || query.clientType || null;
    const clientType = clientTypeRaw ? String(clientTypeRaw).toLowerCase() : null;
  // Accept responder secret via multiple names for compatibility
  const token = auth.responderSecret || auth.token || query.responderSecret || query.token || null;
    const name = auth.name || query.name || null;

    const cookiePassport = resolvePassportFromCookies(socket.handshake.headers?.cookie);
    let passportId = auth.passportId || auth.passport || query.passportId || query.passport || cookiePassport || null;
    if (passportId != null) passportId = String(passportId).trim();

    if (clientType === 'women' && passportId && /^\d+$/.test(passportId)) {
      passportId = `WOMEN-${passportId}`;
    }

    const isTouristClient = clientType === 'tourist' || clientType === 'women';
    const isResponderClient = clientType === 'responder' || clientType === 'admin';
    const isFamilyClient = clientType === 'family';

    if (isResponderClient) {
      if (SOCKET_RESPONDER_SECRET && SOCKET_RESPONDER_SECRET.length > 0) {
        if (!token || token !== SOCKET_RESPONDER_SECRET) {
          const err = new Error('UNAUTHORIZED');
          err.data = { reason: 'invalid_responder_token' };
          return next(err);
        }
      }
      socket.data.clientType = 'responder';
      if (name && String(name).trim()) {
        socket.data.displayName = String(name).trim();
      }
      return next();
    }

    if (isTouristClient || clientType === 'legacy' || !clientType) {
      if (!passportId) {
        const err = new Error('UNAUTHORIZED');
        err.data = { reason: 'missing_passport' };
        return next(err);
      }
      socket.data.clientType = clientType === 'women' ? 'women' : 'tourist';
      socket.data.passportId = passportId;
      return next();
    }

    if (isFamilyClient) {
      socket.data.clientType = 'family';
      return next();
    }

    const err = new Error('UNAUTHORIZED');
    err.data = { reason: 'unsupported_client_type', clientType };
    return next(err);
  } catch (error) {
    const err = error instanceof Error ? error : new Error('UNAUTHORIZED');
    if (!err.data) err.data = { reason: 'socket_auth_internal' };
    return next(err);
  }
});

io.on("connection", (socket) => {
  console.log("A user connected with socket id:", socket.id);

  const clientType = socket.data?.clientType;
  const passportFromAuth = socket.data?.passportId;
  if (passportFromAuth && (clientType === 'tourist' || clientType === 'women')) {
    userSockets.set(passportFromAuth, socket);
  }
  if (clientType === 'responder') {
    const displayName = socket.data?.displayName || `responder-${socket.id.slice(-4)}`;
    responderSockets.set(socket.id, { name: displayName });
    adminSockets.set(socket.id, displayName);
    io.emit('adminListUpdate', Array.from(adminSockets.values()));
  }

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
    if (responderSockets.has(socket.id)) {
      responderSockets.delete(socket.id);
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
          await sendMailSafely({
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
      await sendMailSafely({
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
    const rawEmail = req.body?.email;
    if (!rawEmail || !String(rawEmail).trim()) {
      return res.status(400).json({ message: 'Email is required' });
    }
    const email = String(rawEmail).trim().toLowerCase();

    let passportId = null;
    let name = null;
    // Attempt to match this email to a tourist's emergency contact emails or main email
    const q = await db.pool.query(
      `SELECT passport_id, name FROM tourists 
       WHERE LOWER(email) = $1 OR LOWER(emergency_contact_email_1) = $1 OR LOWER(emergency_contact_email_2) = $1 LIMIT 1`,
      [email]
    );
    if (q.rows.length > 0) {
      passportId = q.rows[0].passport_id;
      name = q.rows[0].name;
    } else {
      const womenQ = await db.pool.query(
        `SELECT wu.id, wu.name, wu.email AS user_email, c.email AS contact_email
         FROM women_users wu
         LEFT JOIN women_emergency_contacts c ON c.user_id = wu.id
         WHERE LOWER(wu.email) = $1 OR LOWER(c.email) = $1
         ORDER BY c.priority NULLS LAST, c.id
         LIMIT 1`,
        [email]
      );
      if (womenQ.rows.length) {
        const row = womenQ.rows[0];
        passportId = `WOMEN-${row.id}`;
        name = row.name;
      }
    }

    if (!passportId) {
      return res.status(404).json({ message: 'No traveller found for this emergency email.' });
    }

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

    await sendMailSafely({
      from: '"Smart Tourist Safety" <smarttouristsystem@gmail.com>',
      to: rawEmail,
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

    return res.json({ message: 'If this email is registered as an emergency contact, an OTP has been sent.' });
  } catch (e) {
    console.error('Error in /api/family/auth/request-otp:', e && e.message);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Step 2: verify OTP from Postgres and return a session token; clear OTP after success
app.post('/api/family/auth/verify-otp', async (req, res) => {
  try {
    const rawEmail = req.body?.email;
    const otp = req.body?.otp;
    if (!rawEmail || !String(rawEmail).trim() || !otp) {
      return res.status(400).json({ message: 'Email and OTP are required' });
    }
    const email = String(rawEmail).trim().toLowerCase();
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
    const mintResult = await mintDigitalId(touristInfo.rows[0].name, identifier);

    if (mintResult && mintResult.passportHash) {
      try {
        await db.pool.query(
          `UPDATE tourists
             SET passport_hash = COALESCE(passport_hash, $1),
                 blockchain_tx_hash = COALESCE($2, blockchain_tx_hash),
                 blockchain_status = 'registered',
                 blockchain_registered_at = COALESCE(blockchain_registered_at, NOW())
           WHERE passport_id = $3`,
          [mintResult.passportHash, mintResult.txHash || null, identifier]
        );
      } catch (updateErr) {
        console.warn('[blockchain] failed to update tourist chain state:', updateErr && updateErr.message);
      }

      try {
        const payload = {
          name: touristInfo.rows[0].name,
          passportId: identifier
        };
        const status = mintResult.blockNumber ? 'confirmed' : 'submitted';
        await db.pool.query(
          `INSERT INTO blockchain_transactions (passport_hash, entity_type, action, tx_hash, status, block_number, payload)
           VALUES ($1, 'tourist', 'register', $2, $3, $4, $5::jsonb)
           ON CONFLICT (tx_hash) DO UPDATE
             SET status = EXCLUDED.status,
                 block_number = COALESCE(EXCLUDED.block_number, blockchain_transactions.block_number),
                 payload = COALESCE(EXCLUDED.payload, blockchain_transactions.payload),
                 updated_at = CURRENT_TIMESTAMP`,
          [
            mintResult.passportHash,
            mintResult.txHash || null,
            status,
            mintResult.blockNumber || null,
            JSON.stringify(payload)
          ]
        );
      } catch (txErr) {
        console.warn('[blockchain] failed to persist transaction record:', txErr && txErr.message);
      }
    }

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

      await sendMailSafely({
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

    await sendMailSafely({
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
app.get('/api/family/profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query?.token || req.cookies?.familyToken;
    if (!token) return res.status(401).json({ message: 'Missing family token' });
    // ...existing code to resolve tracked passportId...
    // Try to find user in tourists first
    const touristRes = await db.pool.query('SELECT passport_id, name, emergency_contact, emergency_contact_1, emergency_contact_email_1, emergency_contact_2, emergency_contact_email_2 FROM tourists WHERE passport_id = $1', [passportId]);
    if (touristRes.rows.length) {
      const t = touristRes.rows[0];
      return res.json({
        passportId: t.passport_id,
        name: t.name,
        emergencyContacts: [
          { number: t.emergency_contact_1, email: t.emergency_contact_email_1 },
          { number: t.emergency_contact_2, email: t.emergency_contact_email_2 }
        ].filter(c => c.number || c.email)
      });
    }
    // If not found, try women table
    const womenMatch = passportId && String(passportId).match(/^WOMEN-(\d+)$/i);
    if (womenMatch) {
      const womenId = parseInt(womenMatch[1], 10);
      if (!Number.isFinite(womenId)) return res.status(400).json({ message: 'Invalid women user id' });
      const userRes = await db.pool.query('SELECT id, name FROM women_users WHERE id = $1', [womenId]);
      if (!userRes.rows.length) return res.status(404).json({ message: 'User not found' });
      const contactsRes = await db.pool.query('SELECT name, mobile_number, email, relationship, priority FROM women_emergency_contacts WHERE user_id = $1 ORDER BY priority', [womenId]);
      return res.json({
        passportId,
        name: userRes.rows[0].name,
        emergencyContacts: contactsRes.rows.map(c => ({
          name: c.name,
          number: c.mobile_number,
          email: c.email,
          relationship: c.relationship,
          priority: c.priority
        }))
      });
    }
    return res.status(404).json({ message: 'User not found' });
  } catch (e) {
    console.error('Family profile fetch failed:', e && e.message);
    return res.status(500).json({ message: 'Failed to fetch profile' });
  }
});
// ...existing code...

app.get("/api/v1/tourists", authenticateAdmin, async (req, res) => {
  try {
    const assigned = normalizeAdminService(req.admin?.assigned_service);
    const includeTourists = assigned !== 'women';
    const includeWomen = assigned !== 'tourist';

    let tourists = [];
    if (includeTourists) {
      const touristResult = await db.pool.query(`
        SELECT 
          t.id,
          t.name,
          t.passport_id,
          t.emergency_contact,
          t.emergency_contact_1,
          t.emergency_contact_2,
          t.emergency_contact_email_1,
          t.emergency_contact_email_2,
          t.status,
          t.latitude,
          t.longitude,
          t.last_seen,
          t.profile_picture_url,
          t.created_at,
          NULL::timestamptz AS updated_at,
          t.service_type,
          t.blockchain_status,
          t.blockchain_tx_hash,
          t.blockchain_registered_at,
          t.blockchain_metadata_uri,
          t.passport_hash,
          COALESCE(g.group_name, 'No Group') AS group_name
        FROM tourists t
        LEFT JOIN group_members gm ON t.id = gm.tourist_id AND gm.status = 'accepted'
        LEFT JOIN groups g ON gm.group_id = g.id
        ORDER BY t.created_at DESC
      `);

      tourists = (touristResult.rows || []).map((row) => ({
        ...row,
        service_type: row.service_type || 'tourist_safety',
        source: 'tourist',
      }));
    }

    let womenParticipants = [];
    if (includeWomen) {
      const womenResult = await db.pool.query(`
        SELECT 
          id,
          name,
          mobile_number,
          email,
          status,
          latitude,
          longitude,
          last_seen,
          profile_picture_url,
          created_at,
          updated_at,
          is_verified
        FROM women_users
        ORDER BY created_at DESC
      `);

      womenParticipants = (womenResult.rows || [])
        .map((row) => db.mapWomenUserRowToParticipant(row))
        .filter(Boolean)
        .map((participant) => ({
          ...participant,
          status: participant.status || 'active',
        }));
    }

    console.log("Dashboard requested consolidated participant list for tourists and women safety.");
    res.json([...tourists, ...womenParticipants]);
  } catch (err) {
    console.error('Failed to list participants', err && err.message);
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

app.get('/api/v1/location/sharing', (req, res) => {
  const passportId = resolvePassportId(req);
  if (!passportId) {
    return res.status(400).json({ message: 'passportId required' });
  }
  const stored = liveLocationPrefs.has(passportId) ? !!liveLocationPrefs.get(passportId) : true;
  const locked = panicLocks.has(passportId);
  return res.json({ passportId, enabled: locked ? true : stored, locked });
});

app.post('/api/v1/location/sharing', (req, res) => {
  const passportId = resolvePassportId(req);
  if (!passportId) {
    return res.status(400).json({ message: 'passportId required' });
  }
  const locked = panicLocks.has(passportId);
  if (locked) {
    liveLocationPrefs.set(passportId, true);
    return res.json({ passportId, enabled: true, locked: true });
  }
  const enabled = !!(req.body && req.body.enabled);
  liveLocationPrefs.set(passportId, enabled);
  return res.json({ passportId, enabled, locked: false });
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
  const { latitude, longitude } = req.body || {};
  const passportId = resolvePassportId(req);
  if (!passportId || latitude == null || longitude == null) {
    return res.status(400).json({ message: "Passport ID and location are required." });
  }
  try {
    const womenMatch = String(passportId).match(/^WOMEN-(\d+)$/i);
    let services = null;

    if (womenMatch) {
      const womenId = parseInt(womenMatch[1], 10);
      if (Number.isFinite(womenId)) {
        try {
          await db.pool.query(
            "UPDATE women_users SET status = 'distress', latitude = $1, longitude = $2, last_seen = NOW() WHERE id = $3",
            [latitude, longitude, womenId]
          );
          await db.pool.query(
            "INSERT INTO alert_history(passport_id, event_type, details) VALUES($1,'panic',$2)",
            [passportId, JSON.stringify({ latitude, longitude })]
          );
        } catch (e) {
          console.warn('women panic update failed:', e && e.message);
        }
      }
      io.emit("panicAlert", { passport_id: passportId, status: "distress" });
      try {
        services = await findNearbyServices(latitude, longitude);
      } catch (svcErr) {
        console.warn('Nearby services lookup failed (women panic):', svcErr && svcErr.message);
      }
      if (services) {
        io.emit("emergencyResponseDispatched", {
          passport_id: passportId,
          message: `Panic alert automatically sent to nearest services.`,
          services,
        });
      }
      setCurrentAlert(passportId, { type: 'panic', startedAt: Date.now(), lat: latitude, lon: longitude, services, source: 'panic-button' });
      
      // Auto-enqueue SMS fallback for women users
      try {
        const userRes = await db.pool.query('SELECT mobile_number, name FROM women_users WHERE id = $1', [womenId]);
        if (userRes.rows.length > 0 && userRes.rows[0].mobile_number) {
          const phone = String(userRes.rows[0].mobile_number).trim();
          const userName = userRes.rows[0].name || 'User';
          const mapLink = `https://www.google.com/maps?q=${latitude},${longitude}`;
          const message = `Emergency Alert: ${userName} has triggered a panic alert. Location: ${mapLink}`;
          await db.pool.query(
            `INSERT INTO sms_queue(passport_id, phone_number, message, channel, status) VALUES($1,$2,$3,$4,'pending')`,
            [passportId, phone, message, 'sms']
          );
          console.log(`[Auto-Enqueue] Women panic SMS queued for ${passportId} to ${phone}`);
        }
      } catch (queueErr) {
        console.error('[Auto-Enqueue] Failed to queue women panic SMS:', queueErr && queueErr.message);
      }
    } else {
      await db.pool.query(
        "UPDATE tourists SET status = 'distress' WHERE passport_id = $1",
        [passportId]
      );
      try {
        await db.pool.query(
          `INSERT INTO alert_history(passport_id, event_type, details) VALUES($1,'panic',$2)`,
          [passportId, JSON.stringify({ latitude, longitude })]
        );
      } catch (e) {
        console.warn('panic history insert failed', e && e.message);
      }
      io.emit("panicAlert", { passport_id: passportId, status: "distress" });

      console.log(`IMMEDIATE FORWARD: Panic alert for ${passportId}. Finding nearby services...`);
      try {
        services = await findNearbyServices(latitude, longitude);
      } catch (svcErr) {
        console.warn('Nearby services lookup failed:', svcErr && svcErr.message);
      }
      if (services) {
        console.log("Found services:", services);
        io.emit("emergencyResponseDispatched", {
          passport_id: passportId,
          message: `Panic alert automatically sent to nearest services.`,
          services,
        });
        try {
          await db.pool.query(
            `INSERT INTO alert_forwards(passport_id, alert_type, services) VALUES($1,$2,$3)
             ON CONFLICT (passport_id, alert_type) DO UPDATE SET forwarded_at = now(), services = EXCLUDED.services`,
            [passportId, 'distress', JSON.stringify(services || {})]
          );
        } catch (e) {
          console.warn('Failed to persist panic forward record', e && e.message);
        }
      }
      setCurrentAlert(passportId, { type: 'panic', startedAt: Date.now(), lat: latitude, lon: longitude, services, source: 'panic-button' });
      notifyEmergencyContacts({ passportId, latitude, longitude, alertType: 'panic', source: 'panic-button' }).catch((err) => {
        console.warn('Emergency contact notification failed:', err && err.message);
      });

      const chainState = await ensureTouristChainState(passportId);
      if (chainState && chainState.passportHash && chainState.blockchainStatus === 'registered') {
        const locationString = `${latitude},${longitude}`;
        const metadata = {
          source: 'panic-button',
          forwarded: Boolean(services && Object.keys(services).length),
          timestamp: new Date().toISOString()
        };
        try {
          const alertResult = await logAlertOnChain(passportId, locationString, PANIC_ALERT_SEVERITY, JSON.stringify(metadata));
          if (alertResult && alertResult.txHash) {
            await recordBlockchainTransaction({
              passportHash: alertResult.passportHash || chainState.passportHash,
              entityType: 'alert',
              action: 'panic_alert',
              txHash: alertResult.txHash,
              blockNumber: alertResult.blockNumber || null,
              payload: metadata
            });
            await upsertBlockchainAlertRecord({
              alertId: alertResult.alertId,
              passportHash: alertResult.passportHash || chainState.passportHash,
              location: locationString,
              severity: PANIC_ALERT_SEVERITY,
              txHash: alertResult.txHash,
              blockNumber: alertResult.blockNumber || null,
              occurredAt: new Date(),
              metadata
            });
          }
        } catch (chainErr) {
          console.warn('[blockchain] panic alert sync failed', chainErr && chainErr.message);
        }
      } else if (chainState && chainState.blockchainStatus) {
        console.log(`[blockchain] Panic alert skipped for ${passportId}; chain status=${chainState.blockchainStatus}`);
      }
    }

    panicLocks.add(passportId);
    liveLocationPrefs.set(passportId, true);

    return res.status(200).json({ message: "Panic alert received and forwarded.", services: services || undefined });
  } catch (err) {
    console.error(err.message);
    return res.status(500).send("Server error");
  }
});

// ==================== Hardware Panic Trigger API Endpoints ====================
const hardwarePanicService = require('./hardwarePanicService');

// Get hardware panic settings
app.get('/api/v1/hardware-panic/settings', async (req, res) => {
  try {
    const passportId = resolvePassportId(req);
    
    let userId = null;
    let userType = 'tourist';
    
    // Check if this is a women's safety user
    const womenMatch = String(passportId || '').match(/^WOMEN-(\d+)$/i);
    if (womenMatch) {
      userId = parseInt(womenMatch[1], 10);
      userType = 'women';
    }
    
    const settings = await hardwarePanicService.getHardwarePanicSettings({
      passportId: userType === 'tourist' ? passportId : null,
      userId,
      userType
    });
    
    return res.json({ success: true, settings });
  } catch (error) {
    console.error('[Hardware Panic] Error getting settings:', error);
    return res.status(500).json({ success: false, message: 'Failed to get settings' });
  }
});

// Update hardware panic settings
app.post('/api/v1/hardware-panic/settings', async (req, res) => {
  try {
    const passportId = resolvePassportId(req);
    const settings = req.body;
    
    let userId = null;
    let userType = 'tourist';
    
    const womenMatch = String(passportId || '').match(/^WOMEN-(\d+)$/i);
    if (womenMatch) {
      userId = parseInt(womenMatch[1], 10);
      userType = 'women';
    }
    
    const updated = await hardwarePanicService.updateHardwarePanicSettings({
      passportId: userType === 'tourist' ? passportId : null,
      userId,
      userType,
      settings
    });
    
    return res.json({ success: true, settings: updated });
  } catch (error) {
    console.error('[Hardware Panic] Error updating settings:', error);
    return res.status(500).json({ success: false, message: 'Failed to update settings' });
  }
});

// Handle hardware panic trigger
app.post('/api/v1/hardware-panic/trigger', async (req, res) => {
  try {
    const passportId = resolvePassportId(req);
    const {
      triggerType,
      triggerPattern,
      triggerCount,
      latitude,
      longitude,
      accuracy,
      deviceInfo
    } = req.body;
    
    if (!passportId) {
      return res.status(400).json({ success: false, message: 'Authentication required' });
    }
    
    if (!triggerType || !latitude || !longitude) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: triggerType, latitude, longitude' 
      });
    }
    
    let userId = null;
    let userType = 'tourist';
    
    const womenMatch = String(passportId).match(/^WOMEN-(\d+)$/i);
    if (womenMatch) {
      userId = parseInt(womenMatch[1], 10);
      userType = 'women';
    }
    
    // Get user settings to check if hardware panic is enabled
    const settings = await hardwarePanicService.getHardwarePanicSettings({
      passportId: userType === 'tourist' ? passportId : null,
      userId,
      userType
    });
    
    if (!settings.enabled) {
      return res.json({ 
        success: false, 
        message: 'Hardware panic trigger is disabled in settings',
        settingsDisabled: true
      });
    }
    
    // Record the trigger
    const trigger = await hardwarePanicService.recordHardwareTrigger({
      passportId: userType === 'tourist' ? passportId : null,
      userId,
      userType,
      triggerType,
      triggerPattern,
      triggerCount,
      latitude,
      longitude,
      accuracy,
      deviceInfo
    });
    
    // Generate alert ID
    const alertId = `HW-PANIC-${trigger.id}-${Date.now()}`;
    
    // Update trigger with alert ID
    await hardwarePanicService.updateTriggerAlertStatus(trigger.id, alertId);
    
    // Record in alert history
    await hardwarePanicService.recordAlertHistory({
      passportId: userType === 'tourist' ? passportId : null,
      userId,
      userType,
      eventType: 'hardware_panic',
      triggerSource: `hardware_${triggerType}`,
      details: {
        triggerId: trigger.id,
        triggerPattern,
        triggerCount,
        deviceInfo
      },
      latitude,
      longitude
    });
    
    // Trigger actual panic alert using existing panic system
    let services = null;
    
    if (userType === 'women' && userId) {
      try {
        await db.pool.query(
          "UPDATE women_users SET status = 'distress', latitude = $1, longitude = $2, last_seen = NOW() WHERE id = $3",
          [latitude, longitude, userId]
        );
      } catch (e) {
        console.warn('[Hardware Panic] Women user update failed:', e && e.message);
      }
      
      io.emit("panicAlert", { passport_id: passportId, status: "distress" });
      
      try {
        services = await findNearbyServices(latitude, longitude);
      } catch (svcErr) {
        console.warn('[Hardware Panic] Nearby services lookup failed:', svcErr && svcErr.message);
      }
      
      if (services) {
        io.emit("emergencyResponseDispatched", {
          passport_id: passportId,
          message: `Hardware panic alert automatically sent to nearest services.`,
          services,
        });
      }
      
      setCurrentAlert(passportId, { 
        type: 'hardware_panic', 
        startedAt: Date.now(), 
        lat: latitude, 
        lon: longitude, 
        services, 
        source: `hardware_${triggerType}`,
        triggerId: trigger.id
      });
    } else {
      // Tourist user
      await db.pool.query(
        "UPDATE tourists SET status = 'distress', latitude = $1, longitude = $2 WHERE passport_id = $3",
        [latitude, longitude, passportId]
      );
      
      io.emit("panicAlert", { passport_id: passportId, status: "distress" });
      
      console.log(`[Hardware Panic] Alert for ${passportId}. Finding nearby services...`);
      
      try {
        services = await findNearbyServices(latitude, longitude);
      } catch (svcErr) {
        console.warn('[Hardware Panic] Nearby services lookup failed:', svcErr && svcErr.message);
      }
      
      if (services) {
        console.log("[Hardware Panic] Found services:", services);
        io.emit("emergencyResponseDispatched", {
          passport_id: passportId,
          message: `Hardware panic alert automatically sent to nearest services.`,
          services,
        });
        
        try {
          await db.pool.query(
            `INSERT INTO alert_forwards(passport_id, alert_type, services) VALUES($1,$2,$3)
             ON CONFLICT (passport_id, alert_type) DO UPDATE SET forwarded_at = now(), services = EXCLUDED.services`,
            [passportId, 'distress', JSON.stringify(services || {})]
          );
        } catch (e) {
          console.warn('[Hardware Panic] Failed to persist forward record', e && e.message);
        }
      }
      
      setCurrentAlert(passportId, { 
        type: 'hardware_panic', 
        startedAt: Date.now(), 
        lat: latitude, 
        lon: longitude, 
        services, 
        source: `hardware_${triggerType}`,
        triggerId: trigger.id
      });
      
      notifyEmergencyContacts({ 
        passportId, 
        latitude, 
        longitude, 
        alertType: 'panic', 
        source: `hardware_${triggerType}` 
      }).catch((err) => {
        console.warn('[Hardware Panic] Emergency contact notification failed:', err && err.message);
      });
    }
    
    panicLocks.add(passportId);
    liveLocationPrefs.set(passportId, true);
    
    return res.json({ 
      success: true, 
      message: 'Hardware panic alert triggered successfully',
      alertId,
      triggerId: trigger.id,
      services: services || undefined,
      autoRecordAudio: settings.auto_record_audio,
      autoShareLocation: settings.auto_share_location
    });
    
  } catch (error) {
    console.error('[Hardware Panic] Error triggering alert:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to trigger hardware panic alert' 
    });
  }
});

// Get hardware trigger history
app.get('/api/v1/hardware-panic/history', async (req, res) => {
  try {
    const passportId = resolvePassportId(req);
    const limit = parseInt(req.query.limit) || 50;
    
    let userId = null;
    let userType = 'tourist';
    
    const womenMatch = String(passportId || '').match(/^WOMEN-(\d+)$/i);
    if (womenMatch) {
      userId = parseInt(womenMatch[1], 10);
      userType = 'women';
    }
    
    const history = await hardwarePanicService.getHardwareTriggerHistory({
      passportId: userType === 'tourist' ? passportId : null,
      userId,
      userType,
      limit
    });
    
    return res.json({ success: true, history });
  } catch (error) {
    console.error('[Hardware Panic] Error getting history:', error);
    return res.status(500).json({ success: false, message: 'Failed to get history' });
  }
});

// Get hardware trigger statistics
app.get('/api/v1/hardware-panic/stats', async (req, res) => {
  try {
    const passportId = resolvePassportId(req);
    
    let userId = null;
    let userType = 'tourist';
    
    const womenMatch = String(passportId || '').match(/^WOMEN-(\d+)$/i);
    if (womenMatch) {
      userId = parseInt(womenMatch[1], 10);
      userType = 'women';
    }
    
    const stats = await hardwarePanicService.getHardwareTriggerStats({
      passportId: userType === 'tourist' ? passportId : null,
      userId,
      userType
    });
    
    return res.json({ success: true, stats });
  } catch (error) {
    console.error('[Hardware Panic] Error getting stats:', error);
    return res.status(500).json({ success: false, message: 'Failed to get stats' });
  }
});

// ==================== End Hardware Panic Trigger API ====================

app.post("/api/v1/alert/cancel", async (req, res) => {
  const passportId = resolvePassportId(req);
  if (!passportId) {
    return res.status(400).json({ message: "Passport ID is required." });
  }
  try {
    const womenMatch = String(passportId).match(/^WOMEN-(\d+)$/i);
    if (womenMatch) {
      const womenId = parseInt(womenMatch[1], 10);
      if (Number.isFinite(womenId)) {
        try {
          await db.pool.query(
            "UPDATE women_users SET status = 'active' WHERE id = $1",
            [womenId]
          );
        } catch (e) {
          console.warn('Failed to reset women user status on cancel:', e && e.message);
        }
      }
    } else {
      await db.pool.query(
        "UPDATE tourists SET status = 'active' WHERE passport_id = $1",
        [passportId]
      );
    }

    io.emit("statusUpdate", { passport_id: passportId, status: "active" });
    const userSocket = userSockets.get(passportId);
    if (userSocket) {
      try {
        userSocket.emit("cancelPanicMode", { passportId });
      } catch (e) {
        console.warn("Failed to emit cancelPanicMode to user socket:", e && e.message);
      }
    }

    console.log(`Panic alert cancelled for ${passportId}.`);
    resolveCurrentAlert(passportId);
    panicLocks.delete(passportId);
    return res.status(200).json({ message: "Panic alert has been cancelled." });
  } catch (err) {
    console.error("Error cancelling panic alert:", err.message);
    return res.status(500).send("Server error");
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
    const womenMatch = String(passportId).match(/^WOMEN-(\d+)$/i);
    if (womenMatch) {
      const womenId = parseInt(womenMatch[1], 10);
      if (!Number.isFinite(womenId)) {
        return res.status(400).json({ message: 'Invalid women participant id' });
      }

      const q = await db.pool.query(
        `SELECT latitude, longitude, accuracy, created_at
         FROM women_location_history
         WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '${interval}'
         ORDER BY created_at ASC`,
        [womenId]
      );
      return res.json({ locations: q.rows });
    }

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
    const womenMatch = String(passportId).match(/^WOMEN-(\d+)$/i);
    if (womenMatch) {
      const womenId = parseInt(womenMatch[1], 10);
      if (!Number.isFinite(womenId)) {
        return res.status(400).json({ message: 'Invalid participant id' });
      }
      await db.pool.query(
        "UPDATE women_users SET status = 'offline' WHERE id = $1",
        [womenId]
      );
    } else {
      await db.pool.query(
        "UPDATE tourists SET status = 'offline' WHERE passport_id = $1",
        [passportId]
      );
    }

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

app.post("/api/v1/tourists/:passportId/reset", authenticateAdmin, async (req, res) => {
  const { passportId } = req.params;
  try {
    if (!enforcePassportAccess(res, req.admin, passportId)) return;
    const womenMatch = String(passportId).match(/^WOMEN-(\d+)$/i);
    if (womenMatch) {
      const womenId = parseInt(womenMatch[1], 10);
      if (!Number.isFinite(womenId)) {
        return res.status(400).json({ message: 'Invalid women participant id' });
      }
      await db.pool.query(
        "UPDATE women_users SET status = 'active' WHERE id = $1",
        [womenId]
      );
    } else {
      await db.pool.query(
        "UPDATE tourists SET status = 'active' WHERE passport_id = $1",
        [passportId]
      );
    }

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
app.get('/api/v1/recordings', authenticateAdmin, async (req, res) => {
  try {
    const passportId = req.query?.passportId || req.query?.passport_id;
    if (passportId && !enforcePassportAccess(res, req.admin, passportId)) return;
    if (passportId) {
      const rows = await db.listRecordingsByPassport(passportId);
      return res.status(200).json(rows.filter((row) => adminCanAccessPassport(req.admin, row.passport_id)));
    }
    const rows = await db.listRecordings();
    return res.status(200).json(rows.filter((row) => adminCanAccessPassport(req.admin, row.passport_id)));
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

// ---------------- Women Emergency Contacts Management ----------------
// National helplines for women safety
const NATIONAL_HELPLINES = [
  { name: 'Women Helpline', number: '181' },
  { name: 'Emergency Services', number: '112' }
];

// List all emergency contacts for a women user, plus national helplines
app.get('/api/women/emergency-contacts', async (req, res) => {
  try {
    const passportId = req.query.passportId || req.cookies?.passportId || req.cookies?.womenUserId && `WOMEN-${req.cookies.womenUserId}`;
    let womenId = null;
    if (passportId && /^WOMEN-(\d+)$/.test(passportId)) {
      womenId = parseInt(passportId.replace('WOMEN-', ''), 10);
    }
    if (!womenId) return res.status(400).json({ message: 'Missing or invalid women passportId' });
    const contactsRes = await db.pool.query('SELECT id, name, mobile_number, email, relationship, priority FROM women_emergency_contacts WHERE user_id = $1 ORDER BY priority, id', [womenId]);
    return res.json({
      contacts: contactsRes.rows,
      helplines: NATIONAL_HELPLINES
    });
  } catch (e) {
    console.error('Failed to list women emergency contacts:', e && e.message);
    return res.status(500).json({ message: 'Failed to list contacts' });
  }
});

// Add a new emergency contact for a women user
app.post('/api/women/emergency-contacts', async (req, res) => {
  try {
    // Support both old (passportId) and new (userEmail/userAadhaarNumber) authentication
    const passportId = req.body.passportId || req.cookies?.passportId || req.cookies?.womenUserId && `WOMEN-${req.cookies.womenUserId}`;
    let womenId = null;
    
    // Try passportId format first (legacy)
    if (passportId && /^WOMEN-(\d+)$/.test(passportId)) {
      womenId = parseInt(passportId.replace('WOMEN-', ''), 10);
    }
    
    // If no passportId, try email/aadhaar authentication
    if (!womenId && (req.body.userEmail || req.body.userAadhaarNumber)) {
      const userEmail = req.body.userEmail;
      const userAadhaarNumber = req.body.userAadhaarNumber;
      
      let userQuery = 'SELECT id FROM women_users WHERE ';
      const params = [];
      
      if (userEmail) {
        userQuery += 'email = $1';
        params.push(userEmail);
      } else if (userAadhaarNumber) {
        userQuery += 'aadhaar_number = $1';
        params.push(userAadhaarNumber);
      }
      
      const userRes = await db.pool.query(userQuery, params);
      if (userRes.rows.length > 0) {
        womenId = userRes.rows[0].id;
      }
    }
    
    if (!womenId) return res.status(400).json({ message: 'Missing or invalid women user identification' });
    
    // Get contact information (use contact_email if provided, fallback to email for backward compatibility)
    const { name, mobile_number, contact_email, email, relationship } = req.body;
    const contactEmail = contact_email || email; // contact_email takes priority
    
    if (!name || !mobile_number) return res.status(400).json({ message: 'Name and mobile number required' });
    
    const priorityRes = await db.pool.query('SELECT MAX(priority) AS maxp FROM women_emergency_contacts WHERE user_id = $1', [womenId]);
    const nextPriority = (priorityRes.rows[0]?.maxp || 0) + 1;
    const insertRes = await db.pool.query(
      'INSERT INTO women_emergency_contacts (user_id, name, mobile_number, email, relationship, priority) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [womenId, name, mobile_number, contactEmail || null, relationship || 'trusted', nextPriority]
    );
    return res.status(201).json({ contact: insertRes.rows[0] });
  } catch (e) {
    console.error('Failed to add women emergency contact:', e && e.message);
    return res.status(500).json({ message: 'Failed to add contact' });
  }
});

// Remove an emergency contact for a women user
app.delete('/api/women/emergency-contacts/:id', async (req, res) => {
  try {
    const passportId = req.body?.passportId || req.query?.passportId || req.cookies?.passportId || req.cookies?.womenUserId && `WOMEN-${req.cookies.womenUserId}`;
    let womenId = null;
    if (passportId && /^WOMEN-(\d+)$/.test(passportId)) {
      womenId = parseInt(passportId.replace('WOMEN-', ''), 10);
    }
    const contactId = parseInt(req.params.id, 10);
    if (!womenId || !contactId) return res.status(400).json({ message: 'Missing or invalid parameters' });
    await db.pool.query('DELETE FROM women_emergency_contacts WHERE id = $1 AND user_id = $2', [contactId, womenId]);
    return res.json({ success: true });
  } catch (e) {
    console.error('Failed to remove women emergency contact:', e && e.message);
    return res.status(500).json({ message: 'Failed to remove contact' });
  }
});

// ---------------- Women Live Streaming ----------------
// Serve women stream media files from dedicated directory
const WOMEN_MEDIA_DIR = path.join(__dirname, 'uploads', 'women-media');
try { if (!fs.existsSync(WOMEN_MEDIA_DIR)) fs.mkdirSync(WOMEN_MEDIA_DIR, { recursive: true }); } catch (e) {}
app.use('/uploads/women-media', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  next();
}, express.static(WOMEN_MEDIA_DIR));

// Women live A/V streaming control and evidence upload
const avSegmentUpload = multer({ dest: path.join(__dirname, 'uploads', 'women-media', 'temp') }).single('chunk');

app.post('/api/women/stream/start', async (req, res) => {
  try {
    const passportId = resolvePassportId(req);
    if (!passportId || !/^WOMEN-/i.test(passportId)) return res.status(400).json({ message: 'Valid WOMEN passportId required' });
    const session = await db.createWomenStreamSession(passportId);
    // Notify admins and family subscribers
    try {
      io.emit('womenStreamStarted', { sessionId: session.id, passportId });
      emitToFamily(passportId, 'familyWomenStreamStarted', { sessionId: session.id, passportId });
    } catch (_) {}
    return res.json({ session });
  } catch (e) {
    console.error('[women-stream] start failed:', e && e.message);
    return res.status(500).json({ message: 'Failed to start stream' });
  }
});

app.post('/api/women/stream/:sessionId/chunk', (req, res) => {
  avSegmentUpload(req, res, async (err) => {
    if (err) return res.status(500).json({ message: err.message });
    const sessionId = parseInt(req.params.sessionId, 10);
    if (!Number.isFinite(sessionId) || !req.file) return res.status(400).json({ message: 'Missing sessionId or chunk' });
    try {
      const safeBase = String(req.body?.fileBase || `seg-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
      const ext = path.extname(req.file.originalname || '.webm') || '.webm';
      const finalName = `${safeBase}${ext}`;
      const finalDir = WOMEN_MEDIA_DIR;
      const finalPath = path.join(finalDir, finalName);
      try { if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true }); } catch (_) {}
      fs.renameSync(req.file.path, finalPath);
      const url = `/uploads/women-media/${finalName}`;
      const seq = req.body?.sequence ? parseInt(req.body.sequence, 10) : null;
      const size = req.file.size ? Number(req.file.size) : null;
      const saved = await db.saveWomenMediaSegment(sessionId, url, finalName, seq, size);
      // Lookup session to include passportId
      let session = null;
      try { session = await db.getWomenStreamSession(sessionId); } catch(_) {}
      const payload = { sessionId, url, fileName: finalName, sequence: seq, sizeBytes: size, created_at: saved.created_at, passportId: session?.passport_id || null };
      io.emit('womenStreamSegment', payload);
      if (payload.passportId) {
        try { emitToFamily(payload.passportId, 'familyWomenStreamSegment', payload); } catch(_) {}
      }
      return res.json({ ok: true, segment: saved });
    } catch (e2) {
      console.error('[women-stream] chunk failed:', e2 && e2.message);
      return res.status(500).json({ message: 'Failed to store chunk' });
    }
  });
});

app.post('/api/women/stream/:sessionId/end', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId, 10);
    if (!Number.isFinite(sessionId)) return res.status(400).json({ message: 'Invalid sessionId' });
    const updated = await db.endWomenStreamSession(sessionId);
    io.emit('womenStreamEnded', { sessionId, passportId: updated?.passport_id || null });
    if (updated?.passport_id) {
      try { emitToFamily(updated.passport_id, 'familyWomenStreamEnded', { sessionId, passportId: updated.passport_id }); } catch(_) {}
    }
    return res.json({ session: updated });
  } catch (e) {
    console.error('[women-stream] end failed:', e && e.message);
    return res.status(500).json({ message: 'Failed to end stream' });
  }
});

app.get('/api/women/stream/:sessionId/segments', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId, 10);
    if (!Number.isFinite(sessionId)) return res.status(400).json({ message: 'Invalid sessionId' });
    const rows = await db.listWomenMediaSegments(sessionId);
    return res.json({ segments: rows });
  } catch (e) {
    console.error('[women-stream] list segments failed:', e && e.message);
    return res.status(500).json({ message: 'Failed to list segments' });
  }
});

// List recent sessions by passport (public for admin/responder; family route below)
app.get('/api/women/stream/sessions', async (req, res) => {
  try {
    const passportId = req.query.passportId || req.query.passport_id || null;
    const limit = req.query.limit || 5;
    if (!passportId) return res.status(400).json({ message: 'passportId is required' });
    const rows = await db.listWomenStreamSessionsByPassport(passportId, limit);
    return res.json({ sessions: rows });
  } catch (e) {
    console.error('[women-stream] list sessions failed:', e && e.message);
    return res.status(500).json({ message: 'Failed to list sessions' });
  }
});

// Family-protected: list sessions for the tracked passport in token
app.get('/api/family/women/stream/sessions', requireFamilyAuth, async (req, res) => {
  try {
    const passportId = req.family?.passportId;
    if (!passportId) return res.status(400).json({ message: 'No tracked passport' });
    const rows = await db.listWomenStreamSessionsByPassport(passportId, req.query.limit || 5);
    return res.json({ sessions: rows });
  } catch (e) {
    console.error('[family women-stream] list sessions failed:', e && e.message);
    return res.status(500).json({ message: 'Failed to list sessions' });
  }
});

// Delete a recording by id (removes DB row and file)
app.delete('/api/v1/recordings/:id', authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const lookup = await db.pool.query('SELECT passport_id, file_name FROM recordings WHERE id = $1 LIMIT 1', [id]);
    if (!lookup.rows.length) return res.status(404).json({ message: 'Not found' });
    if (!enforcePassportAccess(res, req.admin, lookup.rows[0].passport_id)) return;
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
app.delete('/api/v1/recordings/file/:fileName', authenticateAdmin, async (req, res) => {
  const { fileName } = req.params;
  try {
    const lookup = await db.pool.query('SELECT passport_id, file_name FROM recordings WHERE file_name = $1 LIMIT 1', [fileName]);
    if (!lookup.rows.length) return res.status(404).json({ message: 'Not found' });
    if (!enforcePassportAccess(res, req.admin, lookup.rows[0].passport_id)) return;
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

// ============ Trusted Circle API Routes ============
const trustedCircleService = require('./trustedCircleService');

// Get or create user's trusted circle
app.get('/api/v1/trusted-circle', async (req, res) => {
  try {
    const { passportId, serviceType = 'tourist' } = req.query;
    
    if (!passportId) {
      return res.status(400).json({ message: 'passportId is required' });
    }

    const circle = await trustedCircleService.getOrCreateCircle(passportId, serviceType);
    const members = await trustedCircleService.getCircleMembers(circle.id);

    res.json({
      circle,
      members,
      memberCount: members.length,
      acceptedCount: members.filter(m => m.status === 'accepted').length
    });
  } catch (error) {
    console.error('[API] Error getting trusted circle:', error?.message || error);
    res.status(500).json({ message: 'Failed to get trusted circle' });
  }
});

// Get all user's circles
app.get('/api/v1/trusted-circles', async (req, res) => {
  try {
    const { passportId } = req.query;
    
    if (!passportId) {
      return res.status(400).json({ message: 'passportId is required' });
    }

    const circles = await trustedCircleService.getUserCircles(passportId);
    res.json({ circles });
  } catch (error) {
    console.error('[API] Error getting circles:', error?.message || error);
    res.status(500).json({ message: 'Failed to get circles' });
  }
});

// Add member to trusted circle
app.post('/api/v1/trusted-circle/members', async (req, res) => {
  try {
    const { circleId, name, email, phone, relationship, canViewLocation, canReceiveSOS } = req.body;
    
    if (!circleId || !name || !email) {
      return res.status(400).json({ message: 'circleId, name, and email are required' });
    }

    const member = await trustedCircleService.addMember(circleId, {
      name,
      email,
      phone,
      relationship,
      canViewLocation,
      canReceiveSOS
    });

    res.status(201).json({ member });
  } catch (error) {
    console.error('[API] Error adding member:', error?.message || error);
    res.status(500).json({ message: 'Failed to add member' });
  }
});

// Remove member from circle
app.delete('/api/v1/trusted-circle/members/:memberId', async (req, res) => {
  try {
    const { memberId } = req.params;
    const { circleId } = req.query;
    
    if (!circleId) {
      return res.status(400).json({ message: 'circleId is required' });
    }

    await trustedCircleService.removeMember(circleId, memberId);
    res.json({ message: 'Member removed successfully' });
  } catch (error) {
    console.error('[API] Error removing member:', error?.message || error);
    res.status(500).json({ message: 'Failed to remove member' });
  }
});

// Accept invitation
app.post('/api/v1/trusted-circle/accept', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ message: 'token is required' });
    }

    const member = await trustedCircleService.acceptInvitation(token);
    res.json({ message: 'Invitation accepted', member });
  } catch (error) {
    console.error('[API] Error accepting invitation:', error?.message || error);
    res.status(400).json({ message: error?.message || 'Failed to accept invitation' });
  }
});

// Reject invitation
app.post('/api/v1/trusted-circle/reject', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ message: 'token is required' });
    }

    const member = await trustedCircleService.rejectInvitation(token);
    res.json({ message: 'Invitation rejected', member });
  } catch (error) {
    console.error('[API] Error rejecting invitation:', error?.message || error);
    res.status(400).json({ message: error?.message || 'Failed to reject invitation' });
  }
});

// Share location with circle (called when user shares location or triggers SOS)
app.post('/api/v1/trusted-circle/share-location', async (req, res) => {
  try {
    const { passportId, latitude, longitude, shareType = 'location' } = req.body;
    
    if (!passportId || !latitude || !longitude) {
      return res.status(400).json({ message: 'passportId, latitude, and longitude are required' });
    }

    // Get user's circle
    const circles = await trustedCircleService.getUserCircles(passportId);
    
    if (circles.length === 0) {
      return res.json({ message: 'No trusted circle found', shared: 0 });
    }

    // Share with all circles
    let totalShared = 0;
    for (const circle of circles) {
      const result = await trustedCircleService.shareLocation(circle.id, latitude, longitude, shareType);
      totalShared += result.shared;
    }

    res.json({ message: 'Location shared with trusted circle', shared: totalShared });
  } catch (error) {
    console.error('[API] Error sharing location:', error?.message || error);
    res.status(500).json({ message: 'Failed to share location' });
  }
});

// Delete circle
app.delete('/api/v1/trusted-circle/:circleId', async (req, res) => {
  try {
    const { circleId } = req.params;
    const { passportId } = req.query;
    
    if (!passportId) {
      return res.status(400).json({ message: 'passportId is required' });
    }

    await trustedCircleService.deleteCircle(circleId, passportId);
    res.json({ message: 'Circle deleted successfully' });
  } catch (error) {
    console.error('[API] Error deleting circle:', error?.message || error);
    res.status(500).json({ message: 'Failed to delete circle' });
  }
});

// ============ End Trusted Circle Routes ============

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
      const chainSummary = await mintGroupId(String(newGroupIdChain));
      if (chainSummary) {
        try {
          await db.pool.query(
            `UPDATE groups
               SET blockchain_group_id = COALESCE(blockchain_group_id, $1),
                   blockchain_tx_hash = COALESCE($2, blockchain_tx_hash),
                   blockchain_status = 'registered',
                   blockchain_created_at = COALESCE(blockchain_created_at, NOW())
             WHERE id = $3`,
            [String(newGroupIdChain), chainSummary.txHash || null, newGroupIdDb]
          );
        } catch (groupChainErr) {
          console.warn('[blockchain] failed to update group chain state:', groupChainErr && groupChainErr.message);
        }

        try {
          const payload = {
            groupId: String(newGroupIdChain),
            groupName,
            creatorPassportId: passportId
          };
          const status = chainSummary.blockNumber ? 'confirmed' : 'submitted';
          await db.pool.query(
            `INSERT INTO blockchain_transactions (passport_hash, entity_type, action, tx_hash, status, block_number, payload)
             VALUES ($1, 'group', 'create', $2, $3, $4, $5::jsonb)
             ON CONFLICT (tx_hash) DO UPDATE
               SET status = EXCLUDED.status,
                   block_number = COALESCE(EXCLUDED.block_number, blockchain_transactions.block_number),
                   payload = COALESCE(EXCLUDED.payload, blockchain_transactions.payload),
                   updated_at = CURRENT_TIMESTAMP`,
            [null, chainSummary.txHash || null, status, chainSummary.blockNumber || null, JSON.stringify(payload)]
          );
        } catch (groupTxErr) {
          console.warn('[blockchain] failed to persist group transaction:', groupTxErr && groupTxErr.message);
        }
      }
    } catch (chainErr) {
      console.warn("Warning: Failed to mint group on chain:", chainErr && chainErr.message ? chainErr.message : chainErr);
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

    console.log(`Route Safety Analysis Complete. POI score: ${safetyScore}`);

    // Sample crowd-sourced safety cells along the route and compute an aggregated cell score
    const cellPromises = uniqueSamplePoints.map(async (point) => {
      const [lon, lat] = point;
      try {
        const cell = await db.getSafetyScoreForPoint(lat, lon);
        return { lat, lon, cell };
      } catch (e) {
        return { lat, lon, cell: null };
      }
    });
    const cellResults = await Promise.all(cellPromises);
    const cellScores = cellResults.map(r => r.cell).filter(Boolean);
    let combinedCellScore = null;
    if (cellScores.length) {
      const sum = cellScores.reduce((s, c) => s + (Number(c.avg_score || 0)), 0);
      combinedCellScore = sum / cellScores.length; // average 1..5
    }

    // Normalize combined safety: combine POI-based score (normalized by route length) and cell score (1..5 scaled)
    const normalizedPoiScore = Math.min(1, safetyScore / Math.max(1, uniqueSamplePoints.length * 4));
    const normalizedCellScore = combinedCellScore ? ((combinedCellScore - 1) / 4) : 0.5; // 0..1
    const combinedSafetyScore = Math.round(((normalizedPoiScore * 0.5) + (normalizedCellScore * 0.5)) * 100) / 100; // 0..1

    res.json({
      message: "Safe route calculated successfully",
      route: routeGeometry,
      poiSafetyScore: safetyScore,
      cellScores,
      combinedSafetyScore,
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

app.post("/api/v1/alerts/forward-to-emergency", authenticateAdmin, async (req, res) => {
  const { passportId } = req.body;
  try {
    if (!enforcePassportAccess(res, req.admin, passportId)) return;
    const participant = await db.getTouristByPassportId(passportId);
    if (!participant || participant.latitude == null || participant.longitude == null) {
      return res
        .status(404)
        .json({ message: "Participant location not available." });
    }

    const participantLabel = participant.service_type === 'women_safety' ? 'Women Safety participant' : 'Tourist';

    console.log(
      `MANUAL FORWARD: Alert for ${participantLabel} ${passportId}. Finding services...`
    );
    const services = await findNearbyServices(
      participant.latitude,
      participant.longitude
    );

    if (services) {
      console.log("Found services:", services);
      io.emit("emergencyResponseDispatched", {
        passport_id: passportId,
        message: `Emergency teams notified for ${participantLabel.toLowerCase()} ${passportId}.`,
        services,
      });
    }
    // Persist forward marker (use current status as type fallback)
    try {
      const alertType = participant.status || 'unknown';
      await db.pool.query(
        `INSERT INTO alert_forwards(passport_id, alert_type, services) VALUES($1,$2,$3)
         ON CONFLICT (passport_id, alert_type) DO UPDATE SET forwarded_at = now(), services = EXCLUDED.services`,
        [passportId, alertType, JSON.stringify(services || {})]
      );
    } catch(e) {
      console.warn('Failed to persist alert forward record:', e && e.message);
    }
    try { await db.pool.query(`INSERT INTO alert_history(passport_id, event_type, details) VALUES($1,'forwarded',$2)`, [passportId, JSON.stringify(services || {})]); } catch(e){ console.warn('forward history insert failed', e.message); }

    const chainState = await ensureTouristChainState(passportId);
    if (chainState && chainState.passportHash && chainState.blockchainStatus === 'registered') {
      const locationString = participant.latitude != null && participant.longitude != null
        ? `${participant.latitude},${participant.longitude}`
        : '';
      const forwardedBy = (req.admin && (req.admin.email || req.admin.username || req.admin.id)) || 'admin';
      const timestamp = new Date().toISOString();
      const metadata = {
        trigger: 'manual-forward',
        forwardedBy,
        services,
        participantStatus: participant.status || null,
        timestamp
      };
      const evidencePayload = {
        passportId,
        forwardedBy,
        location: locationString,
        services,
        timestamp
      };
      let evidenceHash = sha256Hex(JSON.stringify(evidencePayload));
      if (!evidenceHash) {
        evidenceHash = uuidv4().replace(/-/g, '');
      }
      try {
        const emergencyResult = await logEmergencyOnChain(passportId, String(evidenceHash), locationString, JSON.stringify(metadata));
        if (emergencyResult && emergencyResult.txHash) {
          await recordBlockchainTransaction({
            passportHash: emergencyResult.passportHash || chainState.passportHash,
            entityType: 'emergency',
            action: 'forward_to_emergency',
            txHash: emergencyResult.txHash,
            blockNumber: emergencyResult.blockNumber || null,
            payload: metadata
          });
          await upsertBlockchainEmergencyRecord({
            logId: emergencyResult.logId,
            passportHash: emergencyResult.passportHash || chainState.passportHash,
            evidenceHash: String(evidenceHash),
            location: locationString,
            txHash: emergencyResult.txHash,
            blockNumber: emergencyResult.blockNumber || null,
            occurredAt: new Date(),
            metadata
          });
        }
      } catch (chainErr) {
        console.warn('[blockchain] emergency forward sync failed', chainErr && chainErr.message);
      }
    } else if (chainState && chainState.blockchainStatus) {
      console.log(`[blockchain] Emergency forward skipped for ${passportId}; chain status=${chainState.blockchainStatus}`);
    }

    res.status(200).json({ message: "Alert forwarded successfully." });
  } catch (error) {
    console.error("Failed to forward alert:", error.message);
    res.status(500).send("Server error.");
  }
});

// Retrieve alert history for a tourist
app.get('/api/v1/alerts/:passportId/history', authenticateAdmin, async (req, res) => {
  const { passportId } = req.params;
  try {
    if (!enforcePassportAccess(res, req.admin, passportId)) return;
    const { rows } = await db.pool.query(`SELECT event_type, details, created_at FROM alert_history WHERE passport_id = $1 ORDER BY created_at DESC LIMIT 200`, [passportId]);
    res.json(rows);
  } catch(e) {
    console.error('Failed to retrieve alert history', e.message);
    res.status(500).json({ message: 'Failed to load history' });
  }
});

// Retrieve all forwarded alerts (optionally filter by current active statuses)
app.get('/api/v1/alerts/forwarded', authenticateAdmin, async (req, res) => {
  try {
    const { rows } = await db.pool.query('SELECT passport_id, alert_type, services, forwarded_at FROM alert_forwards ORDER BY forwarded_at DESC LIMIT 500');
    res.json(rows.filter((row) => adminCanAccessPassport(req.admin, row.passport_id)));
  } catch (e) {
    console.error('Failed to list forwarded alerts:', e && e.message);
    res.status(500).json({ message: 'Failed to load forwarded alerts' });
  }
});

// Per tourist forwarded services (latest)
app.get('/api/v1/alerts/:passportId/forwarded-services', authenticateAdmin, async (req, res) => {
  const { passportId } = req.params;
  try {
    if (!enforcePassportAccess(res, req.admin, passportId)) return;
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
    const participant = await db.getTouristByPassportId(passportId);
    if (!participant || participant.latitude == null || participant.longitude == null) return res.status(404).json({ message: 'Participant location not available' });
    const lists = await findNearbyServiceLists(Number(participant.latitude), Number(participant.longitude));
    res.json(lists);
  } catch (e) {
    console.error('Failed to get nearby services lists:', e.message);
    res.status(500).json({ message: 'Failed to retrieve services' });
  }
});

app.get('/api/v1/alerts/:passportId/blockchain', authenticateAdmin, async (req, res) => {
  const { passportId } = req.params;
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
  const includeAudit = String(req.query.includeAudit || req.query.include_audit).toLowerCase() === 'true';
  try {
    if (!enforcePassportAccess(res, req.admin, passportId)) return;
    const summary = await buildBlockchainSummary(passportId, { limit, includeAudit });
    res.json(summary);
  } catch (error) {
    console.error('[API] blockchain summary failed', error && error.message);
    res.status(500).json({ message: 'Failed to load blockchain summary' });
  }
});

// Reset all anomaly/distress statuses for a given group name (by group_name or groups table) and clear forwarded flags
app.post('/api/v1/groups/:groupName/reset-alerts', authenticateAdmin, async (req, res) => {
  const { groupName } = req.params;
  try {
    const assigned = normalizeAdminService(req.admin?.assigned_service);
    if (groupName === 'Women Safety') {
      if (assigned === 'tourist') {
        return res.status(403).json({ message: 'Forbidden for assigned team' });
      }
    } else if (assigned === 'women') {
      return res.status(403).json({ message: 'Forbidden for assigned team' });
    }
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

app.use('/api/women', womenService);
app.use('/api/v1/women', womenService);
app.use('/api/v1/auth/me', authMeRouter);
app.use('/api/v1/tourist-support', touristSupportRouter);
// Area Alerts feature removed as per requirements
// Tourist Nearby Assistance
try {
  const touristNearbyRouterLate = require('./routes/touristNearby');
  app.use('/api/v1/tourist', touristNearbyRouterLate);
  console.log('[TouristNearby] routes registered at /api/v1/tourist/nearby');
} catch (e) {
  console.warn('[TouristNearby] failed to register routes (late):', e && e.message);
}

// ==================== INCIDENT REPORTING API ====================
// Multer configuration for incident media uploads
const incidentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads', 'incidents');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const incidentUpload = multer({
  storage: incidentStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only images and videos are allowed'));
    }
  }
});

// POST /api/v1/incidents - Report a new incident
app.post('/api/v1/incidents', incidentUpload.array('media', 5), async (req, res) => {
  try {
    const {
      category,
      subType,
      description,
      latitude,
      longitude,
      passportId,
      reporterName,
      reporterContact
    } = req.body;

    // Validate required fields
    if (!category || !description) {
      return res.status(400).json({ 
        success: false, 
        message: 'Category and description are required' 
      });
    }

    // Build media URLs array
    const mediaUrls = req.files ? req.files.map(file => `/uploads/incidents/${file.filename}`) : [];

    // Insert incident into database
    const result = await db.pool.query(
      `INSERT INTO incidents (
        category, sub_type, description, latitude, longitude, 
        passport_id, reporter_name, reporter_contact, 
        reporter_type, media_urls, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        category,
        subType || null,
        description,
        latitude ? parseFloat(latitude) : null,
        longitude ? parseFloat(longitude) : null,
        passportId || null,
        reporterName || null,
        reporterContact || null,
        'tourist',
        JSON.stringify(mediaUrls),
        'new'
      ]
    );

    const incident = result.rows[0];

    // Notify government services (mock connector)
    try {
      const notification = await govConnector.notifyIncident(incident);
      if (notification.forwarded && notification.services) {
        await db.pool.query(
          `INSERT INTO incident_forwards (incident_id, services) VALUES ($1, $2)`,
          [incident.id, JSON.stringify(notification.services)]
        );
      }
    } catch (notifyErr) {
      console.error('[Incidents] Government notification failed:', notifyErr);
    }

    // Emit socket event for real-time updates
    io.emit('newIncident', {
      id: incident.id,
      category: incident.category,
      passportId: incident.passport_id,
      status: incident.status
    });

    res.status(201).json({
      success: true,
      message: 'Incident reported successfully',
      incident: {
        id: incident.id,
        category: incident.category,
        subType: incident.sub_type,
        description: incident.description,
        status: incident.status,
        mediaUrls: JSON.parse(incident.media_urls || '[]'),
        createdAt: incident.created_at
      }
    });
  } catch (error) {
    console.error('[Incidents] Error reporting incident:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to report incident',
      error: error.message 
    });
  }
});

// GET /api/v1/incidents - Get incidents (with optional filtering)
app.get('/api/v1/incidents', authenticateAdmin, async (req, res) => {
  try {
    const { passportId, category, status, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM incidents WHERE 1=1';
    const params = [];
    let paramCount = 0;

    if (passportId) {
      paramCount++;
      query += ` AND passport_id = $${paramCount}`;
      params.push(passportId);
    }

    if (category) {
      paramCount++;
      query += ` AND category = $${paramCount}`;
      params.push(category);
    }

    if (status) {
      paramCount++;
      query += ` AND status = $${paramCount}`;
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';
    
    paramCount++;
    query += ` LIMIT $${paramCount}`;
    params.push(parseInt(limit));

    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(parseInt(offset));

    const result = await db.pool.query(query, params);

    const incidents = result.rows
      .filter((incident) => !incident.passport_id || adminCanAccessPassport(req.admin, incident.passport_id))
      .map(incident => ({
      id: incident.id,
      category: incident.category,
      subType: incident.sub_type,
      description: incident.description,
      latitude: incident.latitude,
      longitude: incident.longitude,
      reporterName: incident.reporter_name,
      reporterContact: incident.reporter_contact,
      passportId: incident.passport_id,
      mediaUrls: JSON.parse(incident.media_urls || '[]'),
      status: incident.status,
      assignedAgency: incident.assigned_agency,
      createdAt: incident.created_at,
      updatedAt: incident.updated_at
    }));

    res.json({
      success: true,
      incidents,
      count: incidents.length
    });
  } catch (error) {
    console.error('[Incidents] Error fetching incidents:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch incidents',
      error: error.message 
    });
  }
});

// GET /api/v1/incidents/:id - Get a specific incident
app.get('/api/v1/incidents/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.pool.query(
      'SELECT * FROM incidents WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Incident not found'
      });
    }

    const incident = result.rows[0];

    if (incident.passport_id && !adminCanAccessPassport(req.admin, incident.passport_id)) {
      return res.status(403).json({ success: false, message: 'Forbidden for assigned team' });
    }

    res.json({
      success: true,
      incident: {
        id: incident.id,
        category: incident.category,
        subType: incident.sub_type,
        description: incident.description,
        latitude: incident.latitude,
        longitude: incident.longitude,
        reporterName: incident.reporter_name,
        reporterContact: incident.reporter_contact,
        passportId: incident.passport_id,
        mediaUrls: JSON.parse(incident.media_urls || '[]'),
        status: incident.status,
        assignedAgency: incident.assigned_agency,
        createdAt: incident.created_at,
        updatedAt: incident.updated_at
      }
    });
  } catch (error) {
    console.error('[Incidents] Error fetching incident:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch incident',
      error: error.message 
    });
  }
});

// PATCH /api/v1/incidents/:id - Update incident status
app.patch('/api/v1/incidents/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const assignedAgency = req.body.assignedAgency ?? req.body.assigned_agency ?? null;

    const existing = await db.pool.query('SELECT passport_id FROM incidents WHERE id = $1', [id]);

    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Incident not found'
      });
    }

    const { passport_id: existingPassportId } = existing.rows[0];
    if (existingPassportId && !adminCanAccessPassport(req.admin, existingPassportId)) {
      return res.status(403).json({ success: false, message: 'Forbidden for assigned team' });
    }

    const updates = [];
    const params = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      updates.push(`status = $${paramCount}`);
      params.push(status);
    }

    if (assignedAgency) {
      paramCount++;
      updates.push(`assigned_agency = $${paramCount}`);
      params.push(assignedAgency);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No updates provided'
      });
    }

    paramCount++;
    updates.push(`updated_at = $${paramCount}`);
    params.push(new Date());

    paramCount++;
    params.push(id);

    const query = `UPDATE incidents SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;

    const result = await db.pool.query(query, params);

    const incident = result.rows[0];

    res.json({
      success: true,
      message: 'Incident updated successfully',
      incident: {
        id: incident.id,
        status: incident.status,
        assignedAgency: incident.assigned_agency,
        updatedAt: incident.updated_at
      }
    });
  } catch (error) {
    console.error('[Incidents] Error updating incident:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update incident',
      error: error.message 
    });
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

