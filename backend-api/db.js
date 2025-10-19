

const { Pool } = require("pg");
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD, 
  port: process.env.DB_PORT,
});


const getTouristByPassportId = async (passportId) => {
  const res = await pool.query("SELECT * FROM tourists WHERE passport_id = $1", [
    passportId,
  ]);
  return res.rows[0];
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

module.exports = {
  pool,
  
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
  // Incidents helpers
  async createIncident(payload) {
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
  },
  async listIncidents({ category, status, limit = 50, offset = 0 } = {}) {
    const clauses = [];
    const params = [];
    if (category) { params.push(category); clauses.push(`category = $${params.length}`); }
    if (status) { params.push(status); clauses.push(`status = $${params.length}`); }
    let sql = 'SELECT * FROM incidents';
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY created_at DESC LIMIT $' + (params.push(limit), params.length) + ' OFFSET $' + (params.push(offset), params.length);
    const res = await pool.query(sql, params);
    return res.rows;
  },
  async getIncident(id) {
    const res = await pool.query('SELECT * FROM incidents WHERE id = $1', [id]);
    return res.rows[0];
  },
  async updateIncident(id, patch) {
    const fields = [];
    const params = [];
    const allowed = ['status','assigned_agency','description','media_urls','sub_type'];
    for (const k of allowed) {
      if (k in patch) {
        params.push(patch[k]);
        fields.push(`${k} = $${params.length}`);
      }
    }
    if (!fields.length) return this.getIncident(id);
    params.push(id);
    const res = await pool.query(`UPDATE incidents SET ${fields.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING *`, params);
    return res.rows[0];
  },
  async createIncidentForward(incidentId, services) {
    const res = await pool.query('INSERT INTO incident_forwards (incident_id, services) VALUES ($1, $2) RETURNING *', [incidentId, services || {}]);
    return res.rows[0];
  },
};