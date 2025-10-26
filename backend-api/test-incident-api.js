/**
 * Test script for Incident Reporting API
 * Run with: node test-incident-api.js
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const BACKEND_URL = 'http://localhost:3001';

async function testIncidentAPI() {
  console.log('🧪 Testing Incident Reporting API...\n');

  try {
    // Test 1: Submit a new incident without media
    console.log('Test 1: Submit incident without media');
    const incident1 = await axios.post(`${BACKEND_URL}/api/v1/incidents`, {
      category: 'crime',
      subType: 'Theft',
      description: 'Test incident report - laptop stolen from cafe',
      latitude: 28.6139,
      longitude: 77.2090,
      passportId: 'TEST123',
      reporterName: 'Test Tourist',
      reporterContact: '+911234567890'
    });
    console.log('✅ Incident created:', incident1.data.incident.id);
    console.log('   Category:', incident1.data.incident.category);
    console.log('   Status:', incident1.data.incident.status);
    console.log();

    // Test 2: Fetch all incidents
    console.log('Test 2: Fetch all incidents');
    const allIncidents = await axios.get(`${BACKEND_URL}/api/v1/incidents`, {
      params: { limit: 10 }
    });
    console.log('✅ Fetched incidents:', allIncidents.data.count);
    console.log();

    // Test 3: Fetch incidents by passport ID
    console.log('Test 3: Fetch incidents by passport ID');
    const myIncidents = await axios.get(`${BACKEND_URL}/api/v1/incidents`, {
      params: { passportId: 'TEST123' }
    });
    console.log('✅ My incidents:', myIncidents.data.count);
    console.log();

    // Test 4: Fetch specific incident
    console.log('Test 4: Fetch specific incident');
    const specificIncident = await axios.get(
      `${BACKEND_URL}/api/v1/incidents/${incident1.data.incident.id}`
    );
    console.log('✅ Incident details retrieved');
    console.log('   ID:', specificIncident.data.incident.id);
    console.log('   Description:', specificIncident.data.incident.description);
    console.log();

    // Test 5: Update incident status
    console.log('Test 5: Update incident status');
    const updatedIncident = await axios.patch(
      `${BACKEND_URL}/api/v1/incidents/${incident1.data.incident.id}`,
      {
        status: 'under_review',
        assignedAgency: 'Local Police Station'
      }
    );
    console.log('✅ Incident updated');
    console.log('   New status:', updatedIncident.data.incident.status);
    console.log('   Assigned to:', updatedIncident.data.incident.assignedAgency);
    console.log();

    // Test 6: Submit incident with media (if test image exists)
    const testImagePath = path.join(__dirname, 'test-image.jpg');
    if (fs.existsSync(testImagePath)) {
      console.log('Test 6: Submit incident with media');
      const formData = new FormData();
      formData.append('category', 'suspicious');
      formData.append('subType', 'Suspicious Person');
      formData.append('description', 'Test incident with photo evidence');
      formData.append('latitude', '28.6139');
      formData.append('longitude', '77.2090');
      formData.append('passportId', 'TEST123');
      formData.append('media', fs.createReadStream(testImagePath));

      const incident2 = await axios.post(
        `${BACKEND_URL}/api/v1/incidents`,
        formData,
        { headers: formData.getHeaders() }
      );
      console.log('✅ Incident with media created:', incident2.data.incident.id);
      console.log('   Media files:', incident2.data.incident.mediaUrls.length);
      console.log();
    } else {
      console.log('Test 6: Skipped (no test image found)');
      console.log();
    }

    console.log('✅ All tests passed successfully!');
    console.log('\n📝 Summary:');
    console.log('   - Incident submission: ✅');
    console.log('   - Fetch all incidents: ✅');
    console.log('   - Fetch by passport ID: ✅');
    console.log('   - Fetch specific incident: ✅');
    console.log('   - Update incident status: ✅');
    console.log('   - Media upload: ' + (fs.existsSync(testImagePath) ? '✅' : '⏭️'));

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
    process.exit(1);
  }
}

// Run tests
testIncidentAPI();
