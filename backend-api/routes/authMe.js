const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
  try {
    const isSecure = req.headers['x-forwarded-proto'] === 'https' || req.secure;
    const origin = req.headers.origin;
    if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
    }

    let serviceType = (req.query.serviceType || '').toLowerCase();

    if (serviceType === 'women_safety') {
      const womenId = req.cookies?.womenUserId;
      if (!womenId) {
        return res.status(401).json({ message: 'No women safety session found.' });
      }
      const wq = await db.pool.query(
        `SELECT id, name, email, mobile_number FROM women_users WHERE id = $1 LIMIT 1`,
        [womenId]
      );
      if (wq.rows.length === 0) {
        return res.status(401).json({ message: 'Women safety session invalid.' });
      }
      const user = wq.rows[0];
      return res.json({
        passportId: `WOMEN-${user.id}`,
        name: user.name,
        email: user.email,
        serviceType: 'women_safety',
      });
    }

    const passportId = req.cookies?.passportId;
    if (!passportId) {
      return res.status(401).json({ message: 'Not authenticated.' });
    }

    const tq = await db.pool.query(
      `SELECT passport_id, name, email, service_type FROM tourists WHERE passport_id = $1 LIMIT 1`,
      [passportId]
    );
    if (tq.rows.length === 0) {
      return res.status(401).json({ message: 'Tourist session invalid.' });
    }

    const user = tq.rows[0];
    return res.json({
      passportId: user.passport_id,
      name: user.name,
      email: user.email,
      serviceType: user.service_type || 'general_safety',
    });
  } catch (err) {
    console.error('Error in GET /api/v1/auth/me:', err?.message || err);
    return res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;