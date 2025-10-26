const formatWhatsAppAddress = (num) => (num && String(num).startsWith('+')) ? `whatsapp:${num}` : `whatsapp:${num}`;

module.exports = function createSmsWorker({ db, twilioClient, twilioConfig }) {
  async function processQueue({ limit = 20 } = {}) {
    const results = { processed: 0, sent: 0, failed: 0 };
    try {
      const { rows } = await db.pool.query(`SELECT * FROM sms_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT $1`, [limit]);
      for (const row of rows) {
        results.processed++;
        const id = row.id;
        const phone = String(row.phone_number || '').trim();
        const msg = String(row.message || '');
        const channel = row.channel || 'sms';
        if (!phone || !msg) {
          await db.pool.query(`UPDATE sms_queue SET status='failed', attempts=attempts+1, last_error=$1 WHERE id=$2`, ['invalid_payload', id]);
          results.failed++;
          continue;
        }

        let sent = false;
        let lastError = null;

        if (twilioClient && twilioConfig.enable) {
          try {
            if (channel === 'whatsapp' && twilioConfig.whatsappFrom) {
              await twilioClient.messages.create({
                from: formatWhatsAppAddress(twilioConfig.whatsappFrom),
                to: formatWhatsAppAddress(phone),
                body: msg,
              });
              sent = true;
            } else if (twilioConfig.smsFrom) {
              await twilioClient.messages.create({
                from: twilioConfig.smsFrom,
                to: phone,
                body: msg,
              });
              sent = true;
            }
          } catch (err) {
            lastError = err && (err.message || JSON.stringify(err));
            console.warn('[smsWorker] send failed for', phone, lastError);
          }
        } else {
          // Twilio not configured: log and simulate send for dev
          console.log('[smsWorker] Twilio disabled - would send to', phone, 'message:', msg);
          lastError = 'twilio_not_configured';
        }

        if (sent) {
          await db.pool.query(`UPDATE sms_queue SET status='sent', attempts=attempts+1, sent_at=now() WHERE id=$1`, [id]);
          results.sent++;
        } else {
          const attempts = (row.attempts || 0) + 1;
          const status = attempts >= 5 ? 'failed' : 'pending';
          await db.pool.query(`UPDATE sms_queue SET attempts=$1, last_error=$2, status=$3 WHERE id=$4`, [attempts, lastError, status, id]);
          results.failed++;
        }
      }
    } catch (err) {
      console.error('[smsWorker] processQueue error:', err && err.message);
      throw err;
    }
    return results;
  }

  return { processQueue };
};
