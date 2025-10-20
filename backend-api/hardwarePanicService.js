/**
 * Hardware Panic Trigger Service
 * Handles panic alerts triggered via hardware buttons (volume/power)
 */

const db = require('./db');

/**
 * Get user's hardware panic settings
 */
async function getHardwarePanicSettings({ passportId, userId, userType = 'tourist' }) {
  try {
    let query, params;
    
    if (userType === 'women' && userId) {
      query = 'SELECT * FROM hardware_panic_settings WHERE user_id = $1 AND user_type = $2';
      params = [userId, userType];
    } else if (passportId) {
      query = 'SELECT * FROM hardware_panic_settings WHERE passport_id = $1 AND user_type = $2';
      params = [passportId, userType];
    } else {
      return null;
    }

    const result = await db.pool.query(query, params);
    
    if (result.rows.length > 0) {
      return result.rows[0];
    }

    // Return default settings if none exist
    return {
      enabled: true,
      trigger_method: 'volume_up_3x',
      sensitivity: 'medium',
      confirmation_required: false,
      auto_record_audio: true,
      auto_share_location: true,
      vibration_feedback: true
    };
  } catch (error) {
    console.error('[hardwarePanicService] Error getting settings:', error);
    throw error;
  }
}

/**
 * Update user's hardware panic settings
 */
async function updateHardwarePanicSettings({
  passportId,
  userId,
  userType = 'tourist',
  settings
}) {
  try {
    const {
      enabled = true,
      trigger_method = 'volume_up_3x',
      custom_pattern = null,
      sensitivity = 'medium',
      confirmation_required = false,
      auto_record_audio = true,
      auto_share_location = true,
      vibration_feedback = true
    } = settings;

    let query, params;

    if (userType === 'women' && userId) {
      query = `
        INSERT INTO hardware_panic_settings 
        (user_id, user_type, enabled, trigger_method, custom_pattern, sensitivity, 
         confirmation_required, auto_record_audio, auto_share_location, vibration_feedback)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (passport_id, user_id) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          trigger_method = EXCLUDED.trigger_method,
          custom_pattern = EXCLUDED.custom_pattern,
          sensitivity = EXCLUDED.sensitivity,
          confirmation_required = EXCLUDED.confirmation_required,
          auto_record_audio = EXCLUDED.auto_record_audio,
          auto_share_location = EXCLUDED.auto_share_location,
          vibration_feedback = EXCLUDED.vibration_feedback,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `;
      params = [userId, userType, enabled, trigger_method, custom_pattern, sensitivity,
                confirmation_required, auto_record_audio, auto_share_location, vibration_feedback];
    } else if (passportId) {
      query = `
        INSERT INTO hardware_panic_settings 
        (passport_id, user_type, enabled, trigger_method, custom_pattern, sensitivity, 
         confirmation_required, auto_record_audio, auto_share_location, vibration_feedback)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (passport_id, user_id) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          trigger_method = EXCLUDED.trigger_method,
          custom_pattern = EXCLUDED.custom_pattern,
          sensitivity = EXCLUDED.sensitivity,
          confirmation_required = EXCLUDED.confirmation_required,
          auto_record_audio = EXCLUDED.auto_record_audio,
          auto_share_location = EXCLUDED.auto_share_location,
          vibration_feedback = EXCLUDED.vibration_feedback,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `;
      params = [passportId, userType, enabled, trigger_method, custom_pattern, sensitivity,
                confirmation_required, auto_record_audio, auto_share_location, vibration_feedback];
    } else {
      throw new Error('Either passportId or userId must be provided');
    }

    const result = await db.pool.query(query, params);
    return result.rows[0];
  } catch (error) {
    console.error('[hardwarePanicService] Error updating settings:', error);
    throw error;
  }
}

/**
 * Record hardware panic trigger
 */
async function recordHardwareTrigger({
  passportId,
  userId,
  userType = 'tourist',
  triggerType,
  triggerPattern,
  triggerCount = 1,
  latitude,
  longitude,
  accuracy,
  deviceInfo,
  alertId = null
}) {
  try {
    const query = `
      INSERT INTO hardware_panic_triggers 
      (passport_id, user_id, user_type, trigger_type, trigger_pattern, trigger_count,
       latitude, longitude, accuracy, device_info, alert_id, alert_sent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;
    
    const params = [
      passportId || null,
      userId || null,
      userType,
      triggerType,
      triggerPattern,
      triggerCount,
      latitude || null,
      longitude || null,
      accuracy || null,
      deviceInfo ? JSON.stringify(deviceInfo) : null,
      alertId,
      !!alertId // alert_sent is true if alertId exists
    ];

    const result = await db.pool.query(query, params);
    return result.rows[0];
  } catch (error) {
    console.error('[hardwarePanicService] Error recording trigger:', error);
    throw error;
  }
}

/**
 * Update trigger with alert ID after panic is sent
 */
async function updateTriggerAlertStatus(triggerId, alertId) {
  try {
    const query = `
      UPDATE hardware_panic_triggers 
      SET alert_id = $1, alert_sent = true
      WHERE id = $2
      RETURNING *
    `;
    
    const result = await db.pool.query(query, [alertId, triggerId]);
    return result.rows[0];
  } catch (error) {
    console.error('[hardwarePanicService] Error updating trigger status:', error);
    throw error;
  }
}

/**
 * Get hardware trigger history for a user
 */
async function getHardwareTriggerHistory({ passportId, userId, userType = 'tourist', limit = 50 }) {
  try {
    let query, params;
    
    if (userType === 'women' && userId) {
      query = `
        SELECT * FROM hardware_panic_triggers 
        WHERE user_id = $1 AND user_type = $2
        ORDER BY created_at DESC
        LIMIT $3
      `;
      params = [userId, userType, limit];
    } else if (passportId) {
      query = `
        SELECT * FROM hardware_panic_triggers 
        WHERE passport_id = $1 AND user_type = $2
        ORDER BY created_at DESC
        LIMIT $3
      `;
      params = [passportId, userType, limit];
    } else {
      return [];
    }

    const result = await db.pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error('[hardwarePanicService] Error getting trigger history:', error);
    throw error;
  }
}

/**
 * Get statistics for hardware triggers
 */
async function getHardwareTriggerStats({ passportId, userId, userType = 'tourist' }) {
  try {
    let query, params;
    
    if (userType === 'women' && userId) {
      query = `
        SELECT 
          COUNT(*) as total_triggers,
          COUNT(CASE WHEN alert_sent = true THEN 1 END) as alerts_sent,
          COUNT(CASE WHEN alert_sent = false THEN 1 END) as triggers_without_alert,
          COUNT(CASE WHEN trigger_type = 'volume_up' THEN 1 END) as volume_up_triggers,
          COUNT(CASE WHEN trigger_type = 'volume_down' THEN 1 END) as volume_down_triggers,
          COUNT(CASE WHEN trigger_type = 'power_button' THEN 1 END) as power_triggers,
          MAX(created_at) as last_trigger_at
        FROM hardware_panic_triggers
        WHERE user_id = $1 AND user_type = $2
      `;
      params = [userId, userType];
    } else if (passportId) {
      query = `
        SELECT 
          COUNT(*) as total_triggers,
          COUNT(CASE WHEN alert_sent = true THEN 1 END) as alerts_sent,
          COUNT(CASE WHEN alert_sent = false THEN 1 END) as triggers_without_alert,
          COUNT(CASE WHEN trigger_type = 'volume_up' THEN 1 END) as volume_up_triggers,
          COUNT(CASE WHEN trigger_type = 'volume_down' THEN 1 END) as volume_down_triggers,
          COUNT(CASE WHEN trigger_type = 'power_button' THEN 1 END) as power_triggers,
          MAX(created_at) as last_trigger_at
        FROM hardware_panic_triggers
        WHERE passport_id = $1 AND user_type = $2
      `;
      params = [passportId, userType];
    } else {
      return null;
    }

    const result = await db.pool.query(query, params);
    return result.rows[0] || null;
  } catch (error) {
    console.error('[hardwarePanicService] Error getting trigger stats:', error);
    throw error;
  }
}

/**
 * Record alert in history
 */
async function recordAlertHistory({
  passportId,
  userId,
  userType = 'tourist',
  eventType,
  triggerSource,
  details,
  latitude,
  longitude
}) {
  try {
    const query = `
      INSERT INTO alert_history 
      (passport_id, user_id, user_type, event_type, trigger_source, details, latitude, longitude)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    
    const params = [
      passportId || null,
      userId || null,
      userType,
      eventType,
      triggerSource,
      details ? JSON.stringify(details) : null,
      latitude || null,
      longitude || null
    ];

    const result = await db.pool.query(query, params);
    return result.rows[0];
  } catch (error) {
    console.error('[hardwarePanicService] Error recording alert history:', error);
    throw error;
  }
}

module.exports = {
  getHardwarePanicSettings,
  updateHardwarePanicSettings,
  recordHardwareTrigger,
  updateTriggerAlertStatus,
  getHardwareTriggerHistory,
  getHardwareTriggerStats,
  recordAlertHistory
};
