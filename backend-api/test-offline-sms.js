/**
 * Test script for Offline SMS queue auto-enqueue
 * 
 * This script tests:
 * 1. Manual enqueue of SMS via POST /api/v1/alert/enqueue-sms
 * 2. Viewing the queue via GET /api/v1/alert/sms-queue
 * 3. Processing the queue via POST /api/v1/alert/process-sms-queue
 * 
 * Usage:
 *   node test-offline-sms.js
 */

const axios = require('axios');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

async function testOfflineSMS() {
  console.log('🧪 Testing Offline SMS Queue...\n');

  try {
    // Test 1: Enqueue an SMS
    console.log('1️⃣  Enqueuing test SMS...');
    const enqueueRes = await axios.post(`${BACKEND_URL}/api/v1/alert/enqueue-sms`, {
      passportId: 'TEST-123',
      phoneNumber: '+911234567890',
      message: 'Test emergency alert - this is a drill',
      channel: 'sms'
    }, {
      headers: { 'ngrok-skip-browser-warning': 'true' }
    });
    console.log('✅ Enqueue response:', enqueueRes.data);
    console.log();

    // Test 2: View queue
    console.log('2️⃣  Fetching queue...');
    const queueRes = await axios.get(`${BACKEND_URL}/api/v1/alert/sms-queue?limit=10`, {
      headers: { 'ngrok-skip-browser-warning': 'true' }
    });
    console.log('✅ Queue items:', queueRes.data.items.length);
    console.log('   Recent entries:');
    queueRes.data.items.slice(0, 3).forEach(item => {
      console.log(`   - ID: ${item.id}, Phone: ${item.phone_number}, Status: ${item.status}, Attempts: ${item.attempts}`);
    });
    console.log();

    // Test 3: Process queue
    console.log('3️⃣  Processing queue...');
    const processRes = await axios.post(`${BACKEND_URL}/api/v1/alert/process-sms-queue`, {}, {
      headers: { 'ngrok-skip-browser-warning': 'true' }
    });
    console.log('✅ Process result:', processRes.data.result);
    console.log();

    // Test 4: View queue again
    console.log('4️⃣  Fetching queue after processing...');
    const queueRes2 = await axios.get(`${BACKEND_URL}/api/v1/alert/sms-queue?limit=10`, {
      headers: { 'ngrok-skip-browser-warning': 'true' }
    });
    console.log('✅ Queue items after processing:');
    queueRes2.data.items.slice(0, 3).forEach(item => {
      console.log(`   - ID: ${item.id}, Phone: ${item.phone_number}, Status: ${item.status}, Attempts: ${item.attempts}`);
    });
    console.log();

    console.log('✅ All tests passed!\n');
    console.log('📝 Notes:');
    console.log('   - If Twilio is not configured, messages will be logged but marked as failed with "twilio_not_configured"');
    console.log('   - Check backend logs for [smsWorker] and [Auto-Enqueue] messages');
    console.log('   - To test auto-enqueue from panic, trigger a panic alert and check if SMS appears in queue');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    process.exit(1);
  }
}

// Run the test
testOfflineSMS();
