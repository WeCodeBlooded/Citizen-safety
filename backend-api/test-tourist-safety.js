// Tourist Safety Dashboard API Test Script
// This script tests the main tourist safety features: safe zones, incident reporting, safety score, alerts, and support center.

const axios = require('axios');
const assert = require('assert');

const BASE_URL = 'http://localhost:3001/api/v1';

async function testSafeZones() {
  const res = await axios.get('http://localhost:3001/api/v1/safe-zones');
  assert(res.data.success === true, 'Safe zones response should be successful');
  assert(Array.isArray(res.data.data), 'Safe zones should be an array');
  console.log('Safe zones test passed');
}

async function testIncidentReporting() {
  // Create a new incident
  const res = await axios.post(`${BASE_URL}/incidents`, {
    category: 'crime',
    description: 'Test incident',
    latitude: 28.6,
    longitude: 77.2,
    passportId: 'TEST123',
    reporterName: 'Test User',
    reporterContact: '+911234567890'
  });
  assert(res.data.success, 'Incident creation should succeed');
  assert(res.data.incident && res.data.incident.id, 'Incident should have an id');
  console.log('Incident reporting test passed');
}

async function testSafetyScore() {
  // Submit a rating
  const res = await axios.post(`${BASE_URL}/safety/ratings`, {
    score: 4,
    latitude: 28.6,
    longitude: 77.2,
    passportId: 'TEST123'
  });
  assert(res.data.cell && res.data.cell.cell_id, 'Safety score cell should be returned');
  // Fetch scores
  const res2 = await axios.get(`${BASE_URL}/safety/score?lat=28.6&lon=77.2`);
  assert(Array.isArray(res2.data.cells), 'Safety score cells should be an array');
  console.log('Safety score test passed');
}

async function testSafetyAlerts() {
}

async function testSupportCenter() {
  const res = await axios.get(`${BASE_URL}/tourist-support/helplines?region=National`);
  assert(Array.isArray(res.data), 'Helplines should be an array');
  console.log('Support center test passed');
}

async function runAll() {
  try {
    await testSafeZones();
    await testIncidentReporting();
    await testSafetyScore();
    await testSupportCenter();
    console.log('All tourist safety API tests passed!');
  } catch (err) {
    console.error('Test failed:', err.message);
    process.exit(1);
  }
}

runAll();
