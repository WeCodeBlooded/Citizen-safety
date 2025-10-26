const express = require('express');
const router = express.Router();
const { findNearbyAssistanceLists } = require('../emergencyService');

// GET /api/v1/tourist/nearby?lat=..&lon=..&radius=7000
router.get('/nearby', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const radius = Math.min(20000, Math.max(500, Number(req.query.radius) || 7000));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ message: 'lat and lon are required' });
    }
    const lists = await findNearbyAssistanceLists(lat, lon, radius, 20);
    res.json({
      total: Object.values(lists).reduce((sum, arr) => sum + (arr?.length || 0), 0),
      radius,
      categories: lists,
    });
  } catch (e) {
    console.error('[touristNearby] failed:', e && e.message);
    res.status(500).json({ message: 'Failed to load nearby assistance' });
  }
});

module.exports = router;
