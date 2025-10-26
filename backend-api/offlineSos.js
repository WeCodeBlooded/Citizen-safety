const express = require('express');

module.exports = function initOfflineSos(app, deps) {
  // deps: { db, twilioClient, twilioConfig, smsWorker }
  const router = express.Router();
  const db = deps.db;
  const twilioClient = deps.twilioClient;
  const twilioConfig = deps.twilioConfig;
  const smsWorker = deps.smsWorker;

  // Enqueue an SMS/USSD message for later delivery
  router.post('/enqueue-sms', async (req, res) => {
    try {
      const { passportId, phoneNumber, message, channel } = req.body || {};
      if (!message || !phoneNumber) return res.status(400).json({ success: false, error: 'phoneNumber and message required' });

      await db.pool.query(
        `INSERT INTO sms_queue(passport_id, phone_number, message, channel, status) VALUES($1,$2,$3,$4,'pending')`,
        [passportId || null, String(phoneNumber).trim(), String(message), channel || 'sms']
      );
      return res.json({ success: true });
    } catch (err) {
      console.error('[offlineSos] enqueue error:', err && err.message);
      return res.status(500).json({ success: false, error: 'server_error' });
    }
  });

  // List queue items (admin/developer use)
  router.get('/sms-queue', async (req, res) => {
    try {
      const { limit = 100 } = req.query;
      const { rows } = await db.pool.query(`SELECT * FROM sms_queue ORDER BY created_at DESC LIMIT $1`, [Math.min(1000, Number(limit) || 100)]);
      return res.json({ success: true, items: rows });
    } catch (err) {
      console.error('[offlineSos] list queue error:', err && err.message);
      return res.status(500).json({ success: false, error: 'server_error' });
    }
  });

  // Trigger queue processing (manual)
  router.post('/process-sms-queue', async (req, res) => {
    try {
      if (typeof smsWorker.processQueue !== 'function') {
        return res.status(500).json({ success: false, error: 'worker_missing' });
      }
      const result = await smsWorker.processQueue();
      return res.json({ success: true, result });
    } catch (err) {
      console.error('[offlineSos] process queue error:', err && err.message);
      return res.status(500).json({ success: false, error: 'server_error' });
    }
  });

  app.use('/api/v1/alert', router);
};
