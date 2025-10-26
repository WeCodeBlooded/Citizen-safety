// Tourist Helpline & Language Support - Complete Test Script
const axios = require('axios');
const assert = require('assert');

const BASE_URL = 'http://localhost:3001/api/v1/tourist-support';
const TEST_PASSPORT_ID = 'TEST-TOURIST-123';

// Test configuration
const config = {
  headers: {
    'Cookie': `passportId=${TEST_PASSPORT_ID}`,
    'ngrok-skip-browser-warning': 'true'
  },
  withCredentials: true
};

console.log('🚀 Starting Tourist Helpline & Language Support Tests...\n');

// Test 1: Get National Helplines in English
async function testNationalHelplinesEnglish() {
  console.log('Test 1: Get National Helplines (English)');
  try {
    const res = await axios.get(`${BASE_URL}/helplines`, {
      params: { language: 'en', region: 'National' },
      ...config
    });
    
    assert(res.data.language === 'en', 'Language should be English');
    assert(res.data.total >= 3, 'Should have at least 3 national helplines');
    assert(Array.isArray(res.data.helplines), 'Helplines should be an array');
    
    const incredibleIndia = res.data.helplines.find(h => h.phoneNumber.includes('1800-11-1363'));
    assert(incredibleIndia, 'Should include Incredible India helpline');
    assert(incredibleIndia.availability === '24x7', 'Should be 24x7 available');
    
    console.log('✅ PASSED - Found', res.data.total, 'helplines\n');
  } catch (err) {
    console.error('❌ FAILED:', err.response?.data?.message || err.message, '\n');
    throw err;
  }
}

// Test 2: Get Regional Helplines (Delhi)
async function testRegionalHelplines() {
  console.log('Test 2: Get Regional Helplines (Delhi)');
  try {
    const res = await axios.get(`${BASE_URL}/helplines`, {
      params: { language: 'en', region: 'Delhi' },
      ...config
    });
    
    assert(Array.isArray(res.data.helplines), 'Helplines should be an array');
    const delhiPolice = res.data.helplines.find(h => h.region === 'Delhi');
    assert(delhiPolice, 'Should include Delhi-specific helpline');
    
    console.log('✅ PASSED - Found', res.data.total, 'Delhi helplines\n');
  } catch (err) {
    console.error('❌ FAILED:', err.response?.data?.message || err.message, '\n');
    throw err;
  }
}

// Test 3: Search Helplines by Keyword
async function testSearchHelplines() {
  console.log('Test 3: Search Helplines (keyword: "police")');
  try {
    const res = await axios.get(`${BASE_URL}/helplines`, {
      params: { language: 'en', query: 'police' },
      ...config
    });
    
    assert(Array.isArray(res.data.helplines), 'Helplines should be an array');
    assert(res.data.helplines.length > 0, 'Should find police-related helplines');
    
    console.log('✅ PASSED - Found', res.data.total, 'police helplines\n');
  } catch (err) {
    console.error('❌ FAILED:', err.response?.data?.message || err.message, '\n');
    throw err;
  }
}

// Test 4: Chat - Lost Passport (English)
async function testChatLostPassportEnglish() {
  console.log('Test 4: Chat - Lost Passport Query (English)');
  try {
    const res = await axios.post(`${BASE_URL}/chat`, {
      message: 'I lost my passport. What should I do?',
      language: 'en'
    }, config);
    
    assert(res.data.reply, 'Should return a reply');
    assert(res.data.language === 'en', 'Reply should be in English');
    assert(res.data.reply.toLowerCase().includes('passport'), 'Reply should mention passport');
    assert(res.data.reply.toLowerCase().includes('fir'), 'Reply should mention FIR');
    assert(Array.isArray(res.data.matchedKeywords), 'Should return matched keywords');
    assert(Array.isArray(res.data.suggestedHelplines), 'Should suggest helplines');
    assert(!res.data.usedFallback, 'Should match FAQ, not use fallback');
    
    console.log('✅ PASSED - Matched FAQ ID:', res.data.faqId);
    console.log('   Keywords:', res.data.matchedKeywords.join(', '));
    console.log('   Reply preview:', res.data.reply.substring(0, 80) + '...\n');
  } catch (err) {
    console.error('❌ FAILED:', err.response?.data?.message || err.message, '\n');
    throw err;
  }
}

// Test 5: Chat - Medical Emergency (Hindi)
async function testChatMedicalEmergencyHindi() {
  console.log('Test 5: Chat - Medical Emergency (Hindi)');
  try {
    const res = await axios.post(`${BASE_URL}/chat`, {
      message: 'मुझे डॉक्टर की जरूरत है',
      language: 'hi'
    }, config);
    
    assert(res.data.reply, 'Should return a reply');
    assert(res.data.language === 'hi', 'Reply should be in Hindi');
    assert(Array.isArray(res.data.suggestedHelplines), 'Should suggest helplines');
    assert(res.data.suggestedHelplines.length > 0, 'Should have suggested helplines');
    
    console.log('✅ PASSED - Reply in Hindi received');
    console.log('   Suggested helplines:', res.data.suggestedHelplines.length);
    console.log('   Reply preview:', res.data.reply.substring(0, 80) + '...\n');
  } catch (err) {
    console.error('❌ FAILED:', err.response?.data?.message || err.message, '\n');
    throw err;
  }
}

// Test 6: Chat - Safety Advice (Tamil)
async function testChatSafetyAdviceTamil() {
  console.log('Test 6: Chat - Safety Advice (Tamil)');
  try {
    const res = await axios.post(`${BASE_URL}/chat`, {
      message: 'நான் பாதுகாப்பற்ற இடத்தில் இருக்கிறேன்',
      language: 'ta'
    }, config);
    
    assert(res.data.reply, 'Should return a reply');
    assert(res.data.language === 'ta', 'Reply should be in Tamil');
    
    console.log('✅ PASSED - Reply in Tamil received');
    console.log('   Reply preview:', res.data.reply.substring(0, 80) + '...\n');
  } catch (err) {
    console.error('❌ FAILED:', err.response?.data?.message || err.message, '\n');
    throw err;
  }
}

// Test 7: Chat - Language Help (Bengali)
async function testChatLanguageHelpBengali() {
  console.log('Test 7: Chat - Language Help (Bengali)');
  try {
    const res = await axios.post(`${BASE_URL}/chat`, {
      message: 'আমার ভাষা সহায়তা প্রয়োজন',
      language: 'bn'
    }, config);
    
    assert(res.data.reply, 'Should return a reply');
    assert(res.data.language === 'bn', 'Reply should be in Bengali');
    
    console.log('✅ PASSED - Reply in Bengali received');
    console.log('   Reply preview:', res.data.reply.substring(0, 80) + '...\n');
  } catch (err) {
    console.error('❌ FAILED:', err.response?.data?.message || err.message, '\n');
    throw err;
  }
}

// Test 8: Chat - Currency Exchange (Telugu)
async function testChatCurrencyExchangeTelugu() {
  console.log('Test 8: Chat - Currency Exchange (Telugu)');
  try {
    const res = await axios.post(`${BASE_URL}/chat`, {
      message: 'నా కార్డ్ బ్లాక్ అయింది',
      language: 'te'
    }, config);
    
    assert(res.data.reply, 'Should return a reply');
    assert(res.data.language === 'te', 'Reply should be in Telugu');
    
    console.log('✅ PASSED - Reply in Telugu received');
    console.log('   Reply preview:', res.data.reply.substring(0, 80) + '...\n');
  } catch (err) {
    console.error('❌ FAILED:', err.response?.data?.message || err.message, '\n');
    throw err;
  }
}

// Test 9: Chat - Unknown Query (Fallback Test)
async function testChatFallback() {
  console.log('Test 9: Chat - Unknown Query (Fallback)');
  try {
    const res = await axios.post(`${BASE_URL}/chat`, {
      message: 'What is the weather today?',
      language: 'en'
    }, config);
    
    assert(res.data.reply, 'Should return a reply');
    assert(res.data.usedFallback === true, 'Should use fallback response');
    assert(res.data.reply.includes('1800-11-1363') || res.data.reply.includes('112'), 'Fallback should include helpline number');
    
    console.log('✅ PASSED - Fallback response triggered');
    console.log('   Reply preview:', res.data.reply.substring(0, 80) + '...\n');
  } catch (err) {
    console.error('❌ FAILED:', err.response?.data?.message || err.message, '\n');
    throw err;
  }
}

// Test 10: Chat - Empty Message (Error Handling)
async function testChatEmptyMessage() {
  console.log('Test 10: Chat - Empty Message (Error Handling)');
  try {
    await axios.post(`${BASE_URL}/chat`, {
      message: '',
      language: 'en'
    }, config);
    
    console.error('❌ FAILED - Should have rejected empty message\n');
    throw new Error('Empty message should be rejected');
  } catch (err) {
    if (err.response && err.response.status === 400) {
      console.log('✅ PASSED - Empty message correctly rejected\n');
    } else {
      console.error('❌ FAILED:', err.message, '\n');
      throw err;
    }
  }
}

// Test 11: Helplines - No Session (Error Handling)
async function testHelplinesNoSession() {
  console.log('Test 11: Helplines - No Session (Error Handling)');
  try {
    await axios.get(`${BASE_URL}/helplines`, {
      params: { language: 'en' },
      headers: { 'ngrok-skip-browser-warning': 'true' }
    });
    
    console.error('❌ FAILED - Should require tourist session\n');
    throw new Error('Should require tourist session');
  } catch (err) {
    if (err.response && err.response.status === 403) {
      console.log('✅ PASSED - Correctly requires tourist session\n');
    } else {
      console.error('❌ FAILED:', err.message, '\n');
      throw err;
    }
  }
}

// Test 12: All Supported Languages
async function testAllLanguages() {
  console.log('Test 12: All Supported Languages');
  const languages = ['en', 'hi', 'bn', 'ta', 'te', 'mr', 'kn'];
  
  try {
    for (const lang of languages) {
      const res = await axios.get(`${BASE_URL}/helplines`, {
        params: { language: lang, region: 'National' },
        ...config
      });
      
      assert(res.data.language === lang, `Language should be ${lang}`);
      assert(res.data.total >= 1, `Should have helplines for ${lang}`);
    }
    
    console.log('✅ PASSED - All 7 languages supported:', languages.join(', '), '\n');
  } catch (err) {
    console.error('❌ FAILED:', err.response?.data?.message || err.message, '\n');
    throw err;
  }
}

// Run all tests
async function runAllTests() {
  const tests = [
    testNationalHelplinesEnglish,
    testRegionalHelplines,
    testSearchHelplines,
    testChatLostPassportEnglish,
    testChatMedicalEmergencyHindi,
    testChatSafetyAdviceTamil,
    testChatLanguageHelpBengali,
    testChatCurrencyExchangeTelugu,
    testChatFallback,
    testChatEmptyMessage,
    testHelplinesNoSession,
    testAllLanguages
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch (err) {
      failed++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Passed: ${passed}/${tests.length}`);
  console.log(`❌ Failed: ${failed}/${tests.length}`);
  console.log('='.repeat(60));

  if (failed === 0) {
    console.log('\n🎉 ALL TESTS PASSED! Tourist Helpline & Language Support is fully functional.\n');
    process.exit(0);
  } else {
    console.log('\n⚠️ Some tests failed. Please check the errors above.\n');
    process.exit(1);
  }
}

// Check if server is running
async function checkServer() {
  try {
    await axios.get('http://localhost:3001/health');
    console.log('✅ Backend server is running\n');
    return true;
  } catch (err) {
    console.error('❌ Backend server is not running on http://localhost:3001');
    console.error('   Please start the backend with: cd backend-api && node index.js\n');
    return false;
  }
}

// Main execution
(async () => {
  const serverRunning = await checkServer();
  if (!serverRunning) {
    process.exit(1);
  }
  
  await runAllTests();
})();
