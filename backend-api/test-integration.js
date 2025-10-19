
const axios = require('axios');

const BACKEND_URL = 'http://localhost:3001';

async function testBackendIntegration() {
  console.log('🧪 Testing Backend Integration...\n');
  
  
  try {
    console.log('1️⃣ Testing server connectivity...');
    const response = await axios.get(`${BACKEND_URL}/health`, { timeout: 5000 });
    console.log('✅ Server is running and accessible');
  } catch (error) {
    console.log('❌ Server connection failed:', error.message);
    return;
  }
  
  
  try {
    console.log('\n2️⃣ Testing registration endpoint...');
    const testUser = {
      name: 'Test User',
      email: 'test@example.com',
      phone: '+1234567890',
      passportId: 'TEST123456'
    };
    
    const response = await axios.post(`${BACKEND_URL}/api/v1/auth/register`, testUser);
    console.log('✅ Registration endpoint works:', response.data.message);
  } catch (error) {
    if (error.response?.status === 400 && error.response?.data?.message?.includes('already exists')) {
      console.log('✅ Registration endpoint works (user already exists)');
    } else {
      console.log('❌ Registration failed:', error.response?.data?.message || error.message);
    }
  }
  
  
  try {
    console.log('\n3️⃣ Testing login endpoint...');
    const response = await axios.post(`${BACKEND_URL}/api/v1/auth/login`, { 
      email: 'test@example.com' 
    });
    console.log('✅ Login endpoint works:', response.data.message);
  } catch (error) {
    console.log('❌ Login failed:', error.response?.data?.message || error.message);
  }
  
  console.log('\n🏁 Backend integration test completed!');
}

testBackendIntegration().catch(console.error);