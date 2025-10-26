const express = require('express');

/**
 * Safe Zones Service
 * 
 * Provides API endpoints for managing and querying safe zones (shelters, police stations, hospitals, treatment centres)
 * Supports spatial queries for finding nearby safe zones
 */

module.exports = function initSafeZonesService(app, db) {
  const router = express.Router();

  // Haversine distance calculation (in kilometers)
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 6371; // Earth's radius in km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  /**
   * GET /api/v1/safe-zones
   * List all safe zones with optional filters
   * Query params: type, city, state, limit, offset, verified, active
   */
  router.get('/', async (req, res) => {
    try {
      const {
        type,
        city,
        state,
        limit = 100,
        offset = 0,
        verified,
        active = 'true'
      } = req.query;

      const conditions = [];
      const params = [];
      let paramCount = 0;

      if (type) {
        paramCount++;
        conditions.push(`type = $${paramCount}`);
        params.push(type);
      }

      if (city) {
        paramCount++;
        conditions.push(`LOWER(city) = LOWER($${paramCount})`);
        params.push(city);
      }

      if (state) {
        paramCount++;
        conditions.push(`LOWER(state) = LOWER($${paramCount})`);
        params.push(state);
      }

      if (verified !== undefined) {
        paramCount++;
        conditions.push(`verified = $${paramCount}`);
        params.push(verified === 'true');
      }

      if (active !== undefined) {
        paramCount++;
        conditions.push(`active = $${paramCount}`);
        params.push(active === 'true');
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      paramCount++;
      params.push(Math.min(1000, Number(limit) || 100));
      paramCount++;
      params.push(Math.max(0, Number(offset) || 0));

      const query = `
        SELECT id, name, type, latitude, longitude, address, contact,
               city, district, state, country, operational_hours, services,
               facilities, verified, active, created_at, updated_at
        FROM safe_zones
        ${whereClause}
        ORDER BY city, type, name
        LIMIT $${paramCount - 1} OFFSET $${paramCount}
      `;

      const { rows } = await db.pool.query(query, params);

      // Count total for pagination
      const countQuery = `SELECT COUNT(*)::INT as count FROM safe_zones ${whereClause}`;
      const { rows: countRows } = await db.pool.query(countQuery, params.slice(0, -2));
      const total = countRows[0]?.count || 0;

      return res.json({
        success: true,
        data: rows,
        pagination: {
          total,
          limit: Number(limit),
          offset: Number(offset),
          hasMore: (Number(offset) + rows.length) < total
        }
      });
    } catch (error) {
      console.error('[SafeZones] List error:', error && error.message);
      return res.status(500).json({ success: false, error: 'server_error' });
    }
  });

  /**
   * GET /api/v1/safe-zones/nearby
   * Find safe zones near a location
   * Query params: lat, lon, radius (km, default 10), type, limit
   */
  router.get('/nearby', async (req, res) => {
    try {
      const {
        lat,
        lon,
        radius = 10,
        type,
        limit = 50
      } = req.query;

      if (!lat || !lon) {
        return res.status(400).json({ success: false, error: 'lat and lon required' });
      }

      const latitude = parseFloat(lat);
      const longitude = parseFloat(lon);
      const radiusKm = parseFloat(radius) || 10;

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return res.status(400).json({ success: false, error: 'invalid coordinates' });
      }

      // Fetch all active zones (in production, use spatial DB extensions like PostGIS)
      let query = 'SELECT * FROM safe_zones WHERE active = true';
      const params = [];

      if (type) {
        params.push(type);
        query += ` AND type = $1`;
      }

      const { rows } = await db.pool.query(query, params);

      // Calculate distances and filter by radius
      const zonesWithDistance = rows
        .map(zone => ({
          ...zone,
          distance: calculateDistance(latitude, longitude, zone.latitude, zone.longitude)
        }))
        .filter(zone => zone.distance <= radiusKm)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, Math.min(200, Number(limit) || 50));

      return res.json({
        success: true,
        data: zonesWithDistance,
        query: { latitude, longitude, radius: radiusKm, type: type || 'all' }
      });
    } catch (error) {
      console.error('[SafeZones] Nearby error:', error && error.message);
      return res.status(500).json({ success: false, error: 'server_error' });
    }
  });

  /**
   * GET /api/v1/safe-zones/:id
   * Get details of a specific safe zone
   */
  router.get('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { rows } = await db.pool.query('SELECT * FROM safe_zones WHERE id = $1', [id]);

      if (rows.length === 0) {
        return res.status(404).json({ success: false, error: 'not_found' });
      }

      return res.json({ success: true, data: rows[0] });
    } catch (error) {
      console.error('[SafeZones] Get error:', error && error.message);
      return res.status(500).json({ success: false, error: 'server_error' });
    }
  });

  /**
   * POST /api/v1/safe-zones
   * Create a new safe zone (admin only - add auth middleware in production)
   */
  router.post('/', async (req, res) => {
    try {
      const {
        name,
        type,
        latitude,
        longitude,
        address,
        contact,
        city,
        district,
        state,
        country = 'India',
        operational_hours,
        services,
        facilities,
        verified = false
      } = req.body;

      if (!name || !type || !latitude || !longitude) {
        return res.status(400).json({ success: false, error: 'name, type, latitude, longitude required' });
      }

      const validTypes = ['shelter', 'police', 'hospital', 'treatment_centre'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ success: false, error: 'invalid type' });
      }

      const { rows } = await db.pool.query(
        `INSERT INTO safe_zones(name, type, latitude, longitude, address, contact, city, district, state, country, operational_hours, services, facilities, verified)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING *`,
        [name, type, latitude, longitude, address, contact, city, district, state, country, operational_hours, services, facilities, verified]
      );

      return res.status(201).json({ success: true, data: rows[0] });
    } catch (error) {
      console.error('[SafeZones] Create error:', error && error.message);
      return res.status(500).json({ success: false, error: 'server_error' });
    }
  });

  /**
   * PATCH /api/v1/safe-zones/:id
   * Update a safe zone (admin only)
   */
  router.patch('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      const allowedFields = ['name', 'type', 'latitude', 'longitude', 'address', 'contact', 'city', 'district', 'state', 'country', 'operational_hours', 'services', 'facilities', 'verified', 'active'];
      const setClause = [];
      const params = [];
      let paramCount = 0;

      Object.keys(updates).forEach(key => {
        if (allowedFields.includes(key)) {
          paramCount++;
          setClause.push(`${key} = $${paramCount}`);
          params.push(updates[key]);
        }
      });

      if (setClause.length === 0) {
        return res.status(400).json({ success: false, error: 'no_valid_fields' });
      }

      paramCount++;
      setClause.push(`updated_at = $${paramCount}`);
      params.push(new Date());

      paramCount++;
      params.push(id);

      const query = `UPDATE safe_zones SET ${setClause.join(', ')} WHERE id = $${paramCount} RETURNING *`;
      const { rows } = await db.pool.query(query, params);

      if (rows.length === 0) {
        return res.status(404).json({ success: false, error: 'not_found' });
      }

      return res.json({ success: true, data: rows[0] });
    } catch (error) {
      console.error('[SafeZones] Update error:', error && error.message);
      return res.status(500).json({ success: false, error: 'server_error' });
    }
  });

  /**
   * DELETE /api/v1/safe-zones/:id
   * Soft delete (deactivate) a safe zone
   */
  router.delete('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { rows } = await db.pool.query(
        'UPDATE safe_zones SET active = false, updated_at = NOW() WHERE id = $1 RETURNING *',
        [id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ success: false, error: 'not_found' });
      }

      return res.json({ success: true, data: rows[0] });
    } catch (error) {
      console.error('[SafeZones] Delete error:', error && error.message);
      return res.status(500).json({ success: false, error: 'server_error' });
    }
  });

  app.use('/api/v1/safe-zones', router);
  console.log('[SafeZones] API routes registered');
};
