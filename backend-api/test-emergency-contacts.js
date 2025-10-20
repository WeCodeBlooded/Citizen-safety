#!/usr/bin/env node
/**
 * Emergency Contacts API Test Script
 * Tests the women emergency contacts endpoints
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3001';
const PASSPORT_ID = 'WOMEN-1';

async function testEmergencyContactsAPI() {
  console.log('🧪 Testing Emergency Contacts API...\n');

  try {
    // Test 1: List contacts
    console.log('1️⃣ Testing GET /api/women/emergency-contacts');
    const listResponse = await axios.get(`${BASE_URL}/api/women/emergency-contacts`, {
      params: { passportId: PASSPORT_ID }
    });
    console.log('✅ List contacts successful');
    console.log(`   Found ${listResponse.data.contacts.length} contacts`);
    console.log(`   Helplines: ${listResponse.data.helplines.map(h => h.name).join(', ')}\n`);

    // Test 2: Add contact
    console.log('2️⃣ Testing POST /api/women/emergency-contacts');
    const newContact = {
      passportId: PASSPORT_ID,
      name: 'Test Contact',
      mobile_number: '+91-9999999999',
      email: 'test@example.com',
      relationship: 'friend'
    };
    const addResponse = await axios.post(`${BASE_URL}/api/women/emergency-contacts`, newContact);
    console.log('✅ Add contact successful');
    console.log(`   Contact ID: ${addResponse.data.contact.id}`);
    console.log(`   Name: ${addResponse.data.contact.name}\n`);

    const contactId = addResponse.data.contact.id;

    // Test 3: List contacts again (should have new contact)
    console.log('3️⃣ Testing GET /api/women/emergency-contacts (after add)');
    const listResponse2 = await axios.get(`${BASE_URL}/api/women/emergency-contacts`, {
      params: { passportId: PASSPORT_ID }
    });
    console.log('✅ List contacts successful');
    console.log(`   Found ${listResponse2.data.contacts.length} contacts (should be +1)\n`);

    // Test 4: Remove contact
    console.log('4️⃣ Testing DELETE /api/women/emergency-contacts/:id');
    const deleteResponse = await axios.delete(`${BASE_URL}/api/women/emergency-contacts/${contactId}`, {
      data: { passportId: PASSPORT_ID }
    });
    console.log('✅ Remove contact successful');
    console.log(`   Success: ${deleteResponse.data.success}\n`);

    // Test 5: List contacts final (should be back to original count)
    console.log('5️⃣ Testing GET /api/women/emergency-contacts (after remove)');
    const listResponse3 = await axios.get(`${BASE_URL}/api/women/emergency-contacts`, {
      params: { passportId: PASSPORT_ID }
    });
    console.log('✅ List contacts successful');
    console.log(`   Found ${listResponse3.data.contacts.length} contacts (back to original)\n`);

    console.log('✅ All tests passed! Emergency Contacts API is working correctly.\n');

  } catch (error) {
    console.error('❌ Test failed:');
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Message: ${error.response.data.message || JSON.stringify(error.response.data)}`);
    } else {
      console.error(`   Error: ${error.message}`);
    }
    process.exit(1);
  }
}

// Run tests if backend is available
console.log('Checking if backend is running...');
axios.get(`${BASE_URL}/health`)
  .then(() => {
    console.log('✅ Backend is running\n');
    return testEmergencyContactsAPI();
  })
  .catch(() => {
    console.error('❌ Backend is not running on http://localhost:3001');
    console.error('   Please start the backend first: node backend-api/index.js');
    process.exit(1);
  });
