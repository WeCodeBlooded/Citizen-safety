#!/usr/bin/env node
/*
 * Helper CLI to create or update admin dashboard users.
 * Usage examples:
 *   node scripts/create-admin.js --email=admin@example.com --password=Secret123 --display="Rescue Ops" --service=both
 *   npm run create-admin -- --email=safety@city.gov --password=Passw0rd! --service=women
 */

const path = require('path');
const bcrypt = require('bcryptjs');

// Ensure backend .env is loaded before db pool initialises
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../db');

const ARG_PATTERN = /^--([^=]+)=(.*)$/;

const parseArgs = () => {
  const args = process.argv.slice(2);
  const parsed = {};
  for (const raw of args) {
    if (!ARG_PATTERN.test(raw)) continue;
    const [, key, value] = raw.match(ARG_PATTERN);
    parsed[key.trim().toLowerCase()] = value.trim();
  }
  return parsed;
};

const normalizeService = (value) => {
  const val = String(value || '').toLowerCase();
  if (['both', 'all', 'dual', 'combined'].includes(val)) return 'both';
  if (['women', 'women_safety', 'women-safety'].includes(val)) return 'women';
  if (val === 'tourist' || val === 'tourist_safety') return 'tourist';
  return null;
};

(async () => {
  const args = parseArgs();
  const email = args.email || args.e;
  const password = args.password || args.p;
  const displayName = args.display || args.name || null;
  const role = args.role || args.r || 'admin';
  // Accept --service or --team as the service selector. Keep --role separate (e.g. admin).
  const service = normalizeService(args.service || args.team || 'tourist');

  if (!email || !password) {
    console.error('Usage: node scripts/create-admin.js --email=user@example.com --password=Secret123 [--display="Name"] [--service=tourist|women|both]');
    process.exitCode = 1;
    return;
  }

  if (!service) {
    console.error('Invalid service specified. Use tourist, women, or both.');
    process.exitCode = 1;
    return;
  }

  try {
    const hashed = await bcrypt.hash(password, 10);
    const now = new Date();
    await db.pool.query(
      `INSERT INTO admin_users (email, password_hash, display_name, assigned_service, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, true, $5, $5)
       ON CONFLICT (email)
       DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         display_name = EXCLUDED.display_name,
         assigned_service = EXCLUDED.assigned_service,
         is_active = true,
         updated_at = NOW()`,
      [email, hashed, displayName, service, now]
    );
    console.log(`Admin user "${email}" ready with assigned service "${service}".`);
    if (displayName) {
      console.log(`Display name: ${displayName}`);
    }
    console.log('You can now log in via the admin dashboard.');
  } catch (err) {
    console.error('Failed to upsert admin user:', err && err.message ? err.message : err);
    process.exitCode = 1;
  } finally {
    await db.pool.end().catch(() => {});
  }
})();
