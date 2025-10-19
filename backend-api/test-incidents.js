#!/usr/bin/env node
const axios = require('axios');

(async () => {
  const base = process.env.BASE || 'http://localhost:3001';
  try {
    const create = await axios.post(`${base}/api/v1/incidents`, {
      category: 'street_animal',
      sub_type: 'stray_dog',
      description: 'Aggressive stray dogs near park gate',
      latitude: 28.6139,
      longitude: 77.2090,
      reporter_name: 'Test Citizen',
      reporter_contact: '+910000000',
    }, { headers: { 'ngrok-skip-browser-warning': 'true' }});
    console.log('Created:', create.data);
    const id = create.data?.incident?.id || create.data?.id;

    const list = await axios.get(`${base}/api/v1/incidents?category=street_animal`);
    console.log('List count:', list.data?.incidents?.length || 0);

    if (id) {
      const upd = await axios.patch(`${base}/api/v1/incidents/${id}`, { status: 'in_progress' });
      console.log('Updated:', upd.data);
    }
  } catch (e) {
    console.error('Test failed:', e?.response?.data || e.message);
    process.exit(1);
  }
})();
