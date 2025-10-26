

const { Pool } = require("pg");
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE || process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});


const WOMEN_PASSPORT_REGEX = /^WOMEN-(\d+)$/i;

const mapWomenUserRowToParticipant = (row) => {
  if (!row) return null;
  const passportId = `WOMEN-${row.id}`;
  return {
    ...row,
    id: passportId,
    passport_id: passportId,
    group_name: 'Women Safety',
    emergency_contact: null,
    emergency_contact_1: null,
    emergency_contact_2: null,
    emergency_contact_email_1: null,
    emergency_contact_email_2: null,
    service_type: 'women_safety',
    source: 'women',
    women_id: row.id,
  };
};

const getAdminUserByEmail = async (email) => {
  if (!email) return null;
  const res = await pool.query(
    `SELECT id, email, password_hash, display_name, assigned_service, is_active, last_login
     FROM admin_users
     WHERE LOWER(email) = LOWER($1)
     LIMIT 1`,
    [email]
  );
  return res.rows[0] || null;
};

const getAdminUserById = async (id) => {
  if (!id) return null;
  const res = await pool.query(
    `SELECT id, email, password_hash, display_name, assigned_service, is_active, last_login
     FROM admin_users
     WHERE id = $1
     LIMIT 1`,
    [id]
  );
  return res.rows[0] || null;
};

const touchAdminLastLogin = async (id) => {
  if (!id) return null;
  try {
    await pool.query('UPDATE admin_users SET last_login = NOW(), updated_at = NOW() WHERE id = $1', [id]);
  } catch (e) {
    console.debug('touchAdminLastLogin skipped:', e && e.message);
  }
};

const getTouristByPassportId = async (passportId) => {
  if (!passportId) return null;

  const womenMatch = String(passportId).match(WOMEN_PASSPORT_REGEX);
  if (womenMatch) {
    const womenId = parseInt(womenMatch[1], 10);
    if (!Number.isInteger(womenId)) return null;
    const womenRes = await pool.query(
      `SELECT id, name, mobile_number, aadhaar_number, email, profile_picture_url, is_verified,
              latitude, longitude, last_seen, status, created_at, updated_at
       FROM women_users
       WHERE id = $1
       LIMIT 1`,
      [womenId]
    );
    if (!womenRes.rows?.length) return null;
    return mapWomenUserRowToParticipant(womenRes.rows[0]);
  }

  const res = await pool.query("SELECT * FROM tourists WHERE passport_id = $1", [
    passportId,
  ]);
  if (!res.rows?.length) return null;
  const row = res.rows[0];
  return {
    ...row,
    service_type: row.service_type || 'tourist_safety',
    source: 'tourist',
  };
};

const getAllActiveGroups = async () => {
  const res = await pool.query(`
    SELECT g.id, g.group_name 
    FROM groups g
    JOIN group_members gm ON g.id = gm.group_id
    GROUP BY g.id
    HAVING COUNT(gm.tourist_id) >= 2
  `);
  return res.rows;
};

const getGroupMembersWithLocation = async (groupId) => {
  const res = await pool.query(
    `
    SELECT t.passport_id, t.name, lh.latitude, lh.longitude
    FROM tourists t
    JOIN group_members gm ON t.id = gm.tourist_id
    LEFT JOIN (
      SELECT passport_id, latitude, longitude, 
             ROW_NUMBER() OVER(PARTITION BY passport_id ORDER BY created_at DESC) as rn -- USE created_at HERE
      FROM location_history
    ) lh ON t.passport_id = lh.passport_id AND lh.rn = 1
    WHERE gm.group_id = $1
  `,
    [groupId]
  );
  return res.rows;
};

const getActiveGroupMembers = async (groupName) => {
  const res = await pool.query(
    `SELECT t.passport_id FROM tourists t
     JOIN group_members gm ON t.id = gm.tourist_id
     JOIN groups g ON gm.group_id = g.id
     WHERE g.group_name = $1 AND t.status = 'active'`,
    [groupName]
  );
  return res.rows;
};


const saveRecording = async (passportId, url, fileName) => {
  const res = await pool.query(
    'INSERT INTO recordings (passport_id, url, file_name) VALUES ($1, $2, $3) RETURNING *',
    [passportId, url, fileName]
  );
  return res.rows[0];
};

const listRecordings = async () => {
  const res = await pool.query('SELECT * FROM recordings ORDER BY created_at DESC');
  return res.rows;
};

const deleteRecording = async (id) => {
  const res = await pool.query('DELETE FROM recordings WHERE id = $1 RETURNING *', [id]);
  return res.rows[0];
};


const listRecordingsByPassport = async (passportId) => {
  const res = await pool.query(
    'SELECT * FROM recordings WHERE passport_id = $1 ORDER BY created_at DESC',
    [passportId]
  );
  return res.rows;
};


const getRecordingByFileName = async (fileName) => {
  const res = await pool.query(
    'SELECT * FROM recordings WHERE file_name = $1 LIMIT 1',
    [fileName]
  );
  return res.rows[0];
};


const deleteRecordingByFileName = async (fileName) => {
  const res = await pool.query(
    'DELETE FROM recordings WHERE file_name = $1 RETURNING *',
    [fileName]
  );
  return res.rows[0];
};

const listTouristHelplines = async ({ language, region, search, limit = 50 } = {}) => {
  const clauses = [];
  const params = [];

  if (region) {
    params.push(`%${region}%`);
    clauses.push(`(region ILIKE $${params.length} OR region ILIKE 'National%')`);
  }

  if (language) {
    const langLower = String(language).toLowerCase();
    // Map common 2-letter codes to full language names used in the seed data
    const langNameMap = {
      en: 'english', hi: 'hindi', bn: 'bengali', ta: 'tamil', te: 'telugu', mr: 'marathi', kn: 'kannada', ml: 'malayalam'
    };
    const mappedName = langNameMap[langLower];
    if (mappedName) {
      // push both code and full name so either form matches (e.g. 'en' or 'English')
      params.push(langLower);
      const idxCode = params.length;
      params.push(mappedName);
      const idxName = params.length;
      clauses.push(`EXISTS (SELECT 1 FROM UNNEST(languages) lang WHERE LOWER(lang) = $${idxCode} OR LOWER(lang) = $${idxName})`);
    } else {
      params.push(langLower);
      clauses.push(`EXISTS (SELECT 1 FROM UNNEST(languages) lang WHERE LOWER(lang) = $${params.length})`);
    }
  }

  if (search) {
    const sanitized = search.replace(/[%_]/g, '').trim();
    if (sanitized) {
      params.push(`%${sanitized}%`);
      const idx = params.length;
      clauses.push(`(
        service_name ILIKE $${idx}
        OR description ILIKE $${idx}
        OR region ILIKE $${idx}
        OR phone_number ILIKE $${idx}
      )`);
    }
  }

  let sql = `SELECT id, region, service_name, phone_number, availability, languages, description, priority
             FROM tourist_helplines`;
  if (clauses.length) {
    sql += ' WHERE ' + clauses.join(' AND ');
  }
  sql += ' ORDER BY priority ASC, region ASC, service_name ASC';

  const cappedLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  params.push(cappedLimit);
  sql += ` LIMIT $${params.length}`;

  const res = await pool.query(sql, params);

  // If no entries match a specific language, fall back to English national entries
  if ((!res.rows || res.rows.length === 0) && language && language !== 'en') {
    const fallbackRes = await pool.query(
      `SELECT id, region, service_name, phone_number, availability, languages, description, priority
       FROM tourist_helplines
       WHERE region ILIKE 'National%'
       ORDER BY priority ASC
       LIMIT $1`,
      [cappedLimit]
    );
    return fallbackRes.rows;
  }

  return res.rows;
};

const listTouristSupportFaqs = async () => {
  const res = await pool.query(`
    SELECT id, keywords, response_en, response_hi, response_bn, response_ta, response_te, response_mr, response_kn
    FROM tourist_support_faqs
    ORDER BY id ASC
  `);
  return res.rows;
};

module.exports = {
  pool,
  WOMEN_PASSPORT_REGEX,
  mapWomenUserRowToParticipant,
  getAdminUserByEmail,
  getAdminUserById,
  touchAdminLastLogin,
  getTouristByPassportId,
  getAllActiveGroups,
  getGroupMembersWithLocation,
  getActiveGroupMembers,
  saveRecording,
  listRecordings,
  listRecordingsByPassport,
  deleteRecording,
  getRecordingByFileName,
  deleteRecordingByFileName,
  listTouristHelplines,
  listTouristSupportFaqs,
  createIncident,
  listIncidents,
  getIncident,
  updateIncident,
  createIncidentForward,
  createWomenStreamSession,
  endWomenStreamSession,
  saveWomenMediaSegment,
  listWomenMediaSegments,
  getWomenStreamSession,
  listWomenStreamSessionsByPassport,
  getSafetyScoreForPoint,
};

// Incidents helpers
async function createIncident(payload) {
  const {
    category, sub_type, description,
    latitude, longitude,
    reporter_type, reporter_name, reporter_contact,
    passport_id, media_urls,
    status = 'new', assigned_agency = null,
  } = payload || {};
  const res = await pool.query(
    `INSERT INTO incidents 
      (category, sub_type, description, latitude, longitude, reporter_type, reporter_name, reporter_contact, passport_id, media_urls, status, assigned_agency)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [category, sub_type || null, description || null,
     latitude ?? null, longitude ?? null,
     reporter_type || 'citizen', reporter_name || null, reporter_contact || null,
     passport_id || null, media_urls || null,
     status, assigned_agency]
  );
  return res.rows[0];
}
async function listIncidents({ category, status, limit = 50, offset = 0 } = {}) {
  const clauses = [];
  const params = [];
  if (category) { params.push(category); clauses.push(`category = $${params.length}`); }
  if (status) { params.push(status); clauses.push(`status = $${params.length}`); }
  let sql = 'SELECT * FROM incidents';
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
  sql += ' ORDER BY created_at DESC LIMIT $' + (params.push(limit), params.length) + ' OFFSET $' + (params.push(offset), params.length);
  const res = await pool.query(sql, params);
  return res.rows;
}
async function getIncident(id) {
  const res = await pool.query('SELECT * FROM incidents WHERE id = $1', [id]);
  return res.rows[0];
}
async function updateIncident(id, patch) {
  const fields = [];
  const params = [];
  const allowed = ['status','assigned_agency','description','media_urls','sub_type'];
  for (const k of allowed) {
    if (k in patch) {
      params.push(patch[k]);
      fields.push(`${k} = $${params.length}`);
    }
  }
  if (!fields.length) return getIncident(id);
  params.push(id);
  const res = await pool.query(`UPDATE incidents SET ${fields.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING *`, params);
  return res.rows[0];
}
async function createIncidentForward(incidentId, services) {
  const res = await pool.query('INSERT INTO incident_forwards (incident_id, services) VALUES ($1, $2) RETURNING *', [incidentId, services || {}]);
  return res.rows[0];
}
// Women stream sessions and media segments
async function createWomenStreamSession(passportId) {
  const res = await pool.query(
    `INSERT INTO women_stream_sessions (passport_id, started_at, status)
     VALUES ($1, NOW(), 'active') RETURNING *`,
    [passportId]
  );
  return res.rows[0];
}
async function endWomenStreamSession(sessionId) {
  const res = await pool.query(
    `UPDATE women_stream_sessions SET ended_at = NOW(), status = 'ended'
     WHERE id = $1 RETURNING *`,
    [sessionId]
  );
  return res.rows[0];
}
async function saveWomenMediaSegment(sessionId, url, fileName, sequence, sizeBytes) {
  const res = await pool.query(
    `INSERT INTO women_media_segments (session_id, file_name, url, sequence, size_bytes)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [sessionId, fileName, url, sequence ?? null, sizeBytes ?? null]
  );
  return res.rows[0];
}
async function listWomenMediaSegments(sessionId) {
  const res = await pool.query(
    `SELECT id, session_id, file_name, url, sequence, size_bytes, created_at
     FROM women_media_segments WHERE session_id = $1 ORDER BY COALESCE(sequence, 1e9) ASC, created_at ASC`,
    [sessionId]
  );
  return res.rows;
}
async function getWomenStreamSession(sessionId) {
  const res = await pool.query(
    `SELECT id, passport_id, started_at, ended_at, status FROM women_stream_sessions WHERE id = $1 LIMIT 1`,
    [sessionId]
  );
  return res.rows[0] || null;
}
async function listWomenStreamSessionsByPassport(passportId, limit = 5) {
  const res = await pool.query(
    `SELECT id, passport_id, started_at, ended_at, status
     FROM women_stream_sessions
     WHERE passport_id = $1
     ORDER BY started_at DESC
     LIMIT $2`,
    [passportId, Math.max(1, Math.min(50, Number(limit) || 5))]
  );
  return res.rows;
}

async function getSafetyScoreForPoint(lat, lon) {
  try {
    const res = await pool.query(
      `SELECT avg_score, ratings_count, cell_id, cell_lat, cell_lon,
        ( 6371000 * acos( least(1.0, cos(radians($1)) * cos(radians(cell_lat)) * cos(radians(cell_lon) - radians($2)) + sin(radians($1)) * sin(radians(cell_lat)) ) ) ) AS distance_m
       FROM safety_score_cells
       ORDER BY distance_m ASC
       LIMIT 1`,
      [lat, lon]
    );
    return res.rows[0] || null;
  } catch (e) {
    console.debug('getSafetyScoreForPoint failed', e && e.message);
    return null;
  }
}