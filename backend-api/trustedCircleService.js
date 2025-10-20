/**
 * Trusted Circle Service
 * 
 * Manages trusted circle features for all user types:
 * - Create and manage circles
 * - Invite members
 * - Share location with circle
 * - Receive SOS alerts
 */

const db = require('./db');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');

// Email transporter (reuse from main app or create new)
let emailTransporter = null;

const initEmailTransporter = () => {
  if (emailTransporter) return emailTransporter;

  const emailConfig = {
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  };

  if (emailConfig.auth.user && emailConfig.auth.pass) {
    try {
      emailTransporter = nodemailer.createTransporter(emailConfig);
      console.log('[TrustedCircle] Email transporter initialized');
    } catch (error) {
      console.error('[TrustedCircle] Failed to initialize email:', error?.message || error);
    }
  }

  return emailTransporter;
};

/**
 * Create or get user's trusted circle
 */
async function getOrCreateCircle(passportId, ownerType = 'tourist', circleName = 'My Trusted Circle') {
  try {
    // Check if circle exists
    const existing = await db.pool.query(
      'SELECT * FROM trusted_circles WHERE owner_passport_id = $1 AND circle_name = $2',
      [passportId, circleName]
    );

    if (existing.rows.length > 0) {
      return existing.rows[0];
    }

    // Create new circle
    const result = await db.pool.query(
      `INSERT INTO trusted_circles (owner_passport_id, owner_type, circle_name)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [passportId, ownerType, circleName]
    );

    console.log(`[TrustedCircle] Created circle for ${passportId}`);
    return result.rows[0];
  } catch (error) {
    console.error('[TrustedCircle] Error creating circle:', error?.message || error);
    throw error;
  }
}

/**
 * Add member to trusted circle
 */
async function addMember(circleId, memberData) {
  const {
    name,
    email,
    phone,
    relationship,
    canViewLocation = true,
    canReceiveSOS = true
  } = memberData;

  try {
    // Generate access token for member
    const accessToken = uuidv4();

    const result = await db.pool.query(
      `INSERT INTO trusted_circle_members 
       (circle_id, member_name, member_email, member_phone, relationship, 
        can_view_location, can_receive_sos, access_token, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       ON CONFLICT (circle_id, member_email) 
       DO UPDATE SET 
         member_name = EXCLUDED.member_name,
         member_phone = EXCLUDED.member_phone,
         relationship = EXCLUDED.relationship,
         can_view_location = EXCLUDED.can_view_location,
         can_receive_sos = EXCLUDED.can_receive_sos,
         invited_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [circleId, name, email, phone, relationship, canViewLocation, canReceiveSOS, accessToken]
    );

    const member = result.rows[0];

    // Send invitation email
    if (email) {
      await sendInvitationEmail(member);
    }

    console.log(`[TrustedCircle] Added member ${email} to circle ${circleId}`);
    return member;
  } catch (error) {
    console.error('[TrustedCircle] Error adding member:', error?.message || error);
    throw error;
  }
}

/**
 * Send invitation email to circle member
 */
async function sendInvitationEmail(member) {
  const transporter = initEmailTransporter();
  
  if (!transporter) {
    console.warn('[TrustedCircle] Email not configured, skipping invitation email');
    return;
  }

  try {
    // Get circle info
    const circleResult = await db.pool.query(
      'SELECT * FROM trusted_circles WHERE id = $1',
      [member.circle_id]
    );

    if (circleResult.rows.length === 0) {
      console.error('[TrustedCircle] Circle not found for member');
      return;
    }

    const circle = circleResult.rows[0];

    // Get owner info
    let ownerName = 'A user';
    try {
      const ownerResult = await db.pool.query(
        'SELECT name FROM tourists WHERE passport_id = $1',
        [circle.owner_passport_id]
      );
      if (ownerResult.rows.length > 0) {
        ownerName = ownerResult.rows[0].name;
      }
    } catch (e) {
      // Try women_users table
      try {
        const ownerResult = await db.pool.query(
          'SELECT name FROM women_users WHERE id::text = $1 OR mobile_number = $1',
          [circle.owner_passport_id]
        );
        if (ownerResult.rows.length > 0) {
          ownerName = ownerResult.rows[0].name;
        }
      } catch (e2) {
        // ignore
      }
    }

    const acceptUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/trusted-circle/accept?token=${member.access_token}`;
    const rejectUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/trusted-circle/reject?token=${member.access_token}`;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: member.member_email,
      subject: `${ownerName} added you to their Trusted Circle`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #667eea;">Trusted Circle Invitation</h2>
          <p>Hello ${member.member_name},</p>
          <p><strong>${ownerName}</strong> has added you to their Trusted Circle: <strong>${circle.circle_name}</strong></p>
          
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0;">What does this mean?</h3>
            <ul style="line-height: 1.8;">
              ${member.can_view_location ? '<li>✓ You can view their real-time location</li>' : ''}
              ${member.can_receive_sos ? '<li>✓ You will receive SOS alerts</li>' : ''}
              <li>✓ You can help in emergencies</li>
              <li>✓ Your relationship: <strong>${member.relationship || 'Trusted Contact'}</strong></li>
            </ul>
          </div>

          <p>Please accept or reject this invitation:</p>
          
          <div style="margin: 30px 0;">
            <a href="${acceptUrl}" 
               style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; display: inline-block; margin-right: 10px;">
              Accept Invitation
            </a>
            <a href="${rejectUrl}" 
               style="background: #dc3545; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; display: inline-block;">
              Decline
            </a>
          </div>

          <p style="color: #666; font-size: 14px;">
            This invitation allows ${ownerName} to share their location with you for safety purposes.
            You can revoke access at any time.
          </p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`[TrustedCircle] Invitation email sent to ${member.member_email}`);
  } catch (error) {
    console.error('[TrustedCircle] Error sending invitation email:', error?.message || error);
  }
}

/**
 * Get circle members
 */
async function getCircleMembers(circleId) {
  try {
    const result = await db.pool.query(
      `SELECT * FROM trusted_circle_members 
       WHERE circle_id = $1 
       ORDER BY invited_at DESC`,
      [circleId]
    );

    return result.rows;
  } catch (error) {
    console.error('[TrustedCircle] Error getting members:', error?.message || error);
    throw error;
  }
}

/**
 * Get user's circles
 */
async function getUserCircles(passportId) {
  try {
    const result = await db.pool.query(
      `SELECT c.*, 
              COUNT(m.id) as member_count,
              COUNT(CASE WHEN m.status = 'accepted' THEN 1 END) as accepted_count
       FROM trusted_circles c
       LEFT JOIN trusted_circle_members m ON c.id = m.circle_id
       WHERE c.owner_passport_id = $1
       GROUP BY c.id
       ORDER BY c.created_at DESC`,
      [passportId]
    );

    return result.rows;
  } catch (error) {
    console.error('[TrustedCircle] Error getting circles:', error?.message || error);
    throw error;
  }
}

/**
 * Share location with circle members
 */
async function shareLocation(circleId, latitude, longitude, shareType = 'location') {
  try {
    // Get accepted members
    const members = await db.pool.query(
      `SELECT * FROM trusted_circle_members 
       WHERE circle_id = $1 AND status = 'accepted' AND can_view_location = true`,
      [circleId]
    );

    // Log shares
    for (const member of members.rows) {
      await db.pool.query(
        `INSERT INTO trusted_circle_shares 
         (circle_id, member_id, shared_latitude, shared_longitude, share_type)
         VALUES ($1, $2, $3, $4, $5)`,
        [circleId, member.id, latitude, longitude, shareType]
      );
    }

    // Notify members (via email or push notifications)
    if (shareType === 'sos') {
      await notifySOSToCircle(circleId, latitude, longitude, members.rows);
    }

    console.log(`[TrustedCircle] Shared ${shareType} with ${members.rows.length} members`);
    return { shared: members.rows.length };
  } catch (error) {
    console.error('[TrustedCircle] Error sharing location:', error?.message || error);
    throw error;
  }
}

/**
 * Notify SOS to circle members
 */
async function notifySOSToCircle(circleId, latitude, longitude, members) {
  const transporter = initEmailTransporter();
  
  if (!transporter) {
    console.warn('[TrustedCircle] Email not configured, skipping SOS notifications');
    return;
  }

  try {
    // Get circle info
    const circleResult = await db.pool.query(
      'SELECT * FROM trusted_circles WHERE id = $1',
      [circleId]
    );

    if (circleResult.rows.length === 0) return;
    const circle = circleResult.rows[0];

    // Get owner info
    let ownerName = 'A user';
    try {
      const ownerResult = await db.pool.query(
        'SELECT name FROM tourists WHERE passport_id = $1',
        [circle.owner_passport_id]
      );
      if (ownerResult.rows.length > 0) {
        ownerName = ownerResult.rows[0].name;
      }
    } catch (e) {
      // ignore
    }

    const mapUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;

    for (const member of members) {
      if (!member.can_receive_sos || !member.member_email) continue;

      try {
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: member.member_email,
          subject: `🚨 URGENT: SOS Alert from ${ownerName}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 3px solid #dc3545; border-radius: 8px; overflow: hidden;">
              <div style="background: #dc3545; color: white; padding: 20px;">
                <h1 style="margin: 0;">🚨 SOS ALERT</h1>
              </div>
              <div style="padding: 20px;">
                <p style="font-size: 18px; font-weight: bold; color: #dc3545;">
                  ${ownerName} has triggered an SOS alert!
                </p>
                <p>They may be in danger and need immediate help.</p>
                
                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
                  <h3 style="margin-top: 0;">Location</h3>
                  <p><strong>Latitude:</strong> ${latitude}</p>
                  <p><strong>Longitude:</strong> ${longitude}</p>
                  <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
                </div>

                <a href="${mapUrl}" 
                   style="background: #dc3545; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold; margin: 20px 0;">
                  View Location on Map
                </a>

                <div style="margin-top: 30px; padding: 15px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
                  <p style="margin: 0; font-weight: bold;">⚡ Take Action:</p>
                  <ul style="margin: 10px 0;">
                    <li>Try calling ${ownerName} immediately</li>
                    <li>Contact local emergency services if needed</li>
                    <li>Share this location with authorities</li>
                  </ul>
                </div>
              </div>
            </div>
          `
        };

        await transporter.sendMail(mailOptions);
        
        // Update last notified time
        await db.pool.query(
          'UPDATE trusted_circle_members SET last_notified = CURRENT_TIMESTAMP WHERE id = $1',
          [member.id]
        );

        console.log(`[TrustedCircle] SOS notification sent to ${member.member_email}`);
      } catch (error) {
        console.error(`[TrustedCircle] Failed to notify ${member.member_email}:`, error?.message || error);
      }
    }
  } catch (error) {
    console.error('[TrustedCircle] Error notifying SOS:', error?.message || error);
  }
}

/**
 * Accept invitation
 */
async function acceptInvitation(accessToken) {
  try {
    const result = await db.pool.query(
      `UPDATE trusted_circle_members 
       SET status = 'accepted', responded_at = CURRENT_TIMESTAMP
       WHERE access_token = $1
       RETURNING *`,
      [accessToken]
    );

    if (result.rows.length === 0) {
      throw new Error('Invalid or expired invitation token');
    }

    console.log(`[TrustedCircle] Invitation accepted by ${result.rows[0].member_email}`);
    return result.rows[0];
  } catch (error) {
    console.error('[TrustedCircle] Error accepting invitation:', error?.message || error);
    throw error;
  }
}

/**
 * Reject invitation
 */
async function rejectInvitation(accessToken) {
  try {
    const result = await db.pool.query(
      `UPDATE trusted_circle_members 
       SET status = 'rejected', responded_at = CURRENT_TIMESTAMP
       WHERE access_token = $1
       RETURNING *`,
      [accessToken]
    );

    if (result.rows.length === 0) {
      throw new Error('Invalid or expired invitation token');
    }

    console.log(`[TrustedCircle] Invitation rejected by ${result.rows[0].member_email}`);
    return result.rows[0];
  } catch (error) {
    console.error('[TrustedCircle] Error rejecting invitation:', error?.message || error);
    throw error;
  }
}

/**
 * Remove member from circle
 */
async function removeMember(circleId, memberId) {
  try {
    await db.pool.query(
      'DELETE FROM trusted_circle_members WHERE circle_id = $1 AND id = $2',
      [circleId, memberId]
    );

    console.log(`[TrustedCircle] Removed member ${memberId} from circle ${circleId}`);
    return { success: true };
  } catch (error) {
    console.error('[TrustedCircle] Error removing member:', error?.message || error);
    throw error;
  }
}

/**
 * Delete circle
 */
async function deleteCircle(circleId, passportId) {
  try {
    const result = await db.pool.query(
      'DELETE FROM trusted_circles WHERE id = $1 AND owner_passport_id = $2',
      [circleId, passportId]
    );

    if (result.rowCount === 0) {
      throw new Error('Circle not found or unauthorized');
    }

    console.log(`[TrustedCircle] Deleted circle ${circleId}`);
    return { success: true };
  } catch (error) {
    console.error('[TrustedCircle] Error deleting circle:', error?.message || error);
    throw error;
  }
}

module.exports = {
  getOrCreateCircle,
  addMember,
  getCircleMembers,
  getUserCircles,
  shareLocation,
  acceptInvitation,
  rejectInvitation,
  removeMember,
  deleteCircle
};
