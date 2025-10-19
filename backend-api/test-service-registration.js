/**
 * Service Selection Feature Test
 * 
 * This script tests the new service selection and registration flow
 * Run with: node test-service-registration.js
 */

const axios = require('axios');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// Configure axios to skip ngrok warning
axios.defaults.headers.common['ngrok-skip-browser-warning'] = 'true';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testServiceRegistration() {
  log('\n=== Testing Service Selection Registration Feature ===\n', 'blue');

  const testData = [
    {
      name: 'Sarah Johnson',
      passportId: 'WS' + Date.now(),
      phone: '+1234567890',
      email: `sarah.${Date.now()}@test.com`,
      service_type: 'women_safety',
      idType: 'aadhaar',
    },
    {
      name: 'John Tourist',
      passportId: 'TS' + Date.now(),
      phone: '+1234567891',
      email: `john.${Date.now()}@test.com`,
      service_type: 'tourist_safety',
      idType: 'passport',
    },
    {
      name: 'Mike Citizen',
      passportId: 'CS' + Date.now(),
      phone: '+1234567892',
      email: `mike.${Date.now()}@test.com`,
      service_type: 'citizen_safety',
      idType: 'aadhaar',
    },
    {
      name: 'Emma General',
      passportId: 'GS' + Date.now(),
      phone: '+1234567893',
      email: `emma.${Date.now()}@test.com`,
      service_type: 'general_safety',
      idType: 'aadhaar',
    },
    {
      name: 'Default User',
      passportId: 'DU' + Date.now(),
      phone: '+1234567894',
      email: `default.${Date.now()}@test.com`,
      idType: 'aadhaar',
      // No service_type - should default to 'general_safety'
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const user of testData) {
    try {
      log(`\nTesting registration for: ${user.name} (${user.service_type || 'default'})`, 'yellow');
      
      const response = await axios.post(`${BACKEND_URL}/api/v1/auth/register`, user);
      
      if (response.status === 201 && response.data.message.includes('successful')) {
        log(`✓ Registration successful for ${user.name}`, 'green');
        log(`  Service Type: ${user.service_type || 'general_safety (default)'}`, 'blue');
        log(`  ID (${user.idType || 'passport'}): ${user.passportId}`, 'blue');
        passed++;
      } else {
        log(`✗ Unexpected response for ${user.name}`, 'red');
        failed++;
      }
    } catch (error) {
      if (error.response) {
        log(`✗ Registration failed for ${user.name}`, 'red');
        log(`  Status: ${error.response.status}`, 'red');
        log(`  Message: ${error.response.data.message || error.response.data}`, 'red');
      } else {
        log(`✗ Network error for ${user.name}: ${error.message}`, 'red');
      }
      failed++;
    }
  }

  log('\n=== Test Summary ===', 'blue');
  log(`Passed: ${passed}/${testData.length}`, passed === testData.length ? 'green' : 'yellow');
  log(`Failed: ${failed}/${testData.length}`, failed === 0 ? 'green' : 'red');

  if (passed === testData.length) {
    log('\n✅ All service registration tests passed!', 'green');
    log('\nNext steps:', 'blue');
    log('1. Check your email for verification codes');
    log('2. Test the frontend ServiceRegistration component');
    log('3. Verify service_type is stored in the database');
    log('4. Test the complete registration flow in the PWA');
  } else {
    log('\n❌ Some tests failed. Check the backend server logs.', 'red');
  }
}

// Run tests
testServiceRegistration().catch(err => {
  log(`\n❌ Test script error: ${err.message}`, 'red');
  process.exit(1);
});
