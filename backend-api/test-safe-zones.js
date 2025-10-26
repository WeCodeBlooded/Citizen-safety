/**
 * Test script for Safe Zones API
 * 
 * This script tests all safe zones endpoints including:
 * - List all safe zones with filters
 * - Get nearby safe zones (spatial query)
 * - Get safe zone details
 * - Create, update, and delete safe zones
 * 
 * Usage: node test-safe-zones.js
 */

const axios = require('axios');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001';
const API_BASE = `${BASE_URL}/api/v1/safe-zones`;

// ANSI color codes
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

let testsPassed = 0;
let testsFailed = 0;

function log(color, message) {
  console.log(`${color}${message}${RESET}`);
}

function logTest(name, passed, details = '') {
  if (passed) {
    testsPassed++;
    log(GREEN, `✓ ${name}`);
    if (details) console.log(`  ${details}`);
  } else {
    testsFailed++;
    log(RED, `✗ ${name}`);
    if (details) console.log(`  ${RED}${details}${RESET}`);
  }
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test 1: List all safe zones
async function testListSafeZones() {
  log(BLUE, '\n=== Test 1: List All Safe Zones ===');
  try {
    const response = await axios.get(API_BASE, { params: { limit: 50 } });
    const passed = response.status === 200 && Array.isArray(response.data.data);
    logTest(
      'List all safe zones',
      passed,
      passed ? `Found ${response.data.data.length} zones, Total: ${response.data.pagination.total}` : `Status: ${response.status}`
    );
    return passed ? response.data.data : [];
  } catch (error) {
    logTest('List all safe zones', false, error.message);
    return [];
  }
}

// Test 2: Filter safe zones by type
async function testFilterByType() {
  log(BLUE, '\n=== Test 2: Filter By Type ===');
  const types = ['police', 'hospital', 'shelter', 'treatment_centre'];
  
  for (const type of types) {
    try {
      const response = await axios.get(API_BASE, { params: { type, limit: 10 } });
      const passed = response.status === 200 && 
                     Array.isArray(response.data.data) &&
                     response.data.data.every(z => z.type === type);
      logTest(
        `Filter by type: ${type}`,
        passed,
        passed ? `Found ${response.data.data.length} ${type} zones` : 'Type mismatch in results'
      );
    } catch (error) {
      logTest(`Filter by type: ${type}`, false, error.message);
    }
  }
}

// Test 3: Filter safe zones by city
async function testFilterByCity() {
  log(BLUE, '\n=== Test 3: Filter By City ===');
  const cities = ['Delhi', 'Mumbai', 'Bangalore'];
  
  for (const city of cities) {
    try {
      const response = await axios.get(API_BASE, { params: { city, limit: 10 } });
      const passed = response.status === 200 && 
                     Array.isArray(response.data.data) &&
                     response.data.data.every(z => z.city === city);
      logTest(
        `Filter by city: ${city}`,
        passed,
        passed ? `Found ${response.data.data.length} zones in ${city}` : 'City mismatch in results'
      );
    } catch (error) {
      logTest(`Filter by city: ${city}`, false, error.message);
    }
  }
}

// Test 4: Get nearby safe zones (spatial query)
async function testNearbySearch() {
  log(BLUE, '\n=== Test 4: Nearby Search (Spatial Query) ===');
  
  // Test locations: Delhi center, Mumbai center, Bangalore center
  const testLocations = [
    { name: 'Delhi Center', lat: 28.6139, lon: 77.2090, radius: 5000 },
    { name: 'Mumbai Center', lat: 19.0760, lon: 72.8777, radius: 10000 },
    { name: 'Bangalore Center', lat: 12.9716, lon: 77.5946, radius: 5000 },
  ];
  
  for (const location of testLocations) {
    try {
      const response = await axios.get(`${API_BASE}/nearby`, {
        params: {
          latitude: location.lat,
          longitude: location.lon,
          radius: location.radius,
          limit: 20
        }
      });
      
      const passed = response.status === 200 && 
                     Array.isArray(response.data.data) &&
                     response.data.data.every(z => z.distance !== undefined);
      
      logTest(
        `Nearby search: ${location.name}`,
        passed,
        passed ? `Found ${response.data.data.length} zones within ${location.radius/1000}km` : 'Invalid response format'
      );
      
      // Verify distances are sorted
      if (passed && response.data.data.length > 1) {
        const sorted = response.data.data.every((z, i, arr) => 
          i === 0 || z.distance >= arr[i-1].distance
        );
        logTest(
          `  → Distance sorting`,
          sorted,
          sorted ? 'Distances sorted ascending' : 'Distances not properly sorted'
        );
      }
    } catch (error) {
      logTest(`Nearby search: ${location.name}`, false, error.message);
    }
  }
}

// Test 5: Get safe zone by ID
async function testGetById(zones) {
  log(BLUE, '\n=== Test 5: Get Safe Zone By ID ===');
  
  if (zones.length === 0) {
    log(YELLOW, '⚠ Skipping: No zones available from previous test');
    return;
  }
  
  const testZone = zones[0];
  try {
    const response = await axios.get(`${API_BASE}/${testZone.id}`);
    const passed = response.status === 200 && 
                   response.data.data &&
                   response.data.data.id === testZone.id;
    
    logTest(
      `Get zone by ID: ${testZone.id}`,
      passed,
      passed ? `Retrieved: ${response.data.data.name}` : 'Zone not found or ID mismatch'
    );
  } catch (error) {
    logTest(`Get zone by ID: ${testZone.id}`, false, error.message);
  }
}

// Test 6: Create a new safe zone
async function testCreateSafeZone() {
  log(BLUE, '\n=== Test 6: Create New Safe Zone ===');
  
  const newZone = {
    name: 'Test Hospital (Auto-generated)',
    type: 'hospital',
    latitude: 28.5500,
    longitude: 77.2500,
    address: '123 Test Street, Test Area',
    contact: '011-12345678',
    city: 'Delhi',
    district: 'Test District',
    state: 'Delhi',
    operational_hours: '24x7',
    services: ['Emergency', 'Testing'],
    verified: false
  };
  
  try {
    const response = await axios.post(API_BASE, newZone);
    const passed = response.status === 201 && response.data.data && response.data.data.id;
    
    logTest(
      'Create new safe zone',
      passed,
      passed ? `Created zone with ID: ${response.data.data.id}` : 'Failed to create zone'
    );
    
    return passed ? response.data.data : null;
  } catch (error) {
    logTest('Create new safe zone', false, error.response?.data?.message || error.message);
    return null;
  }
}

// Test 7: Update safe zone
async function testUpdateSafeZone(createdZone) {
  log(BLUE, '\n=== Test 7: Update Safe Zone ===');
  
  if (!createdZone) {
    log(YELLOW, '⚠ Skipping: No zone created in previous test');
    return;
  }
  
  const updates = {
    name: 'Test Hospital (Updated)',
    verified: true,
    services: ['Emergency', 'Testing', 'Updated Service']
  };
  
  try {
    const response = await axios.patch(`${API_BASE}/${createdZone.id}`, updates);
    const passed = response.status === 200 && 
                   response.data.data &&
                   response.data.data.name === updates.name &&
                   response.data.data.verified === true;
    
    logTest(
      `Update zone ID: ${createdZone.id}`,
      passed,
      passed ? 'Zone updated successfully' : 'Update failed or values not applied'
    );
  } catch (error) {
    logTest(`Update zone ID: ${createdZone.id}`, false, error.response?.data?.message || error.message);
  }
}

// Test 8: Delete safe zone
async function testDeleteSafeZone(createdZone) {
  log(BLUE, '\n=== Test 8: Delete Safe Zone (Soft Delete) ===');
  
  if (!createdZone) {
    log(YELLOW, '⚠ Skipping: No zone created in previous test');
    return;
  }
  
  try {
    const response = await axios.delete(`${API_BASE}/${createdZone.id}`);
    const passed = response.status === 200;
    
    logTest(
      `Delete zone ID: ${createdZone.id}`,
      passed,
      passed ? 'Zone soft-deleted successfully' : 'Delete failed'
    );
    
    // Verify soft delete by trying to fetch
    if (passed) {
      await delay(500); // Wait a bit
      try {
        const fetchResponse = await axios.get(`${API_BASE}/${createdZone.id}`);
        const notActive = !fetchResponse.data.data || !fetchResponse.data.data.active;
        logTest(
          '  → Verify soft delete',
          notActive,
          notActive ? 'Zone marked as inactive' : 'Zone still active after delete'
        );
      } catch (error) {
        logTest('  → Verify soft delete', true, 'Zone not returned (soft deleted)');
      }
    }
  } catch (error) {
    logTest(`Delete zone ID: ${createdZone.id}`, false, error.response?.data?.message || error.message);
  }
}

// Test 9: Pagination
async function testPagination() {
  log(BLUE, '\n=== Test 9: Pagination ===');
  
  try {
    const page1 = await axios.get(API_BASE, { params: { limit: 5, offset: 0 } });
    const page2 = await axios.get(API_BASE, { params: { limit: 5, offset: 5 } });
    
    const passed = page1.status === 200 && 
                   page2.status === 200 &&
                   page1.data.data.length <= 5 &&
                   page2.data.data.length <= 5 &&
                   (page1.data.data[0]?.id !== page2.data.data[0]?.id);
    
    logTest(
      'Pagination (limit & offset)',
      passed,
      passed ? `Page 1: ${page1.data.data.length} items, Page 2: ${page2.data.data.length} items` : 'Pagination not working correctly'
    );
  } catch (error) {
    logTest('Pagination (limit & offset)', false, error.message);
  }
}

// Test 10: Invalid requests
async function testErrorHandling() {
  log(BLUE, '\n=== Test 10: Error Handling ===');
  
  // Test invalid zone ID
  try {
    await axios.get(`${API_BASE}/999999`);
    logTest('Invalid zone ID returns 404', false, 'Expected 404 but got success');
  } catch (error) {
    const passed = error.response?.status === 404;
    logTest('Invalid zone ID returns 404', passed, passed ? 'Correctly returned 404' : `Got status: ${error.response?.status}`);
  }
  
  // Test invalid type filter
  try {
    const response = await axios.get(API_BASE, { params: { type: 'invalid_type' } });
    const passed = response.data.data.length === 0;
    logTest('Invalid type filter returns empty', passed, passed ? 'Returned empty array' : 'Should return empty for invalid type');
  } catch (error) {
    logTest('Invalid type filter returns empty', false, error.message);
  }
  
  // Test missing required fields on create
  try {
    await axios.post(API_BASE, { name: 'Incomplete' });
    logTest('Create with missing fields returns 400', false, 'Expected 400 but got success');
  } catch (error) {
    const passed = error.response?.status === 400;
    logTest('Create with missing fields returns 400', passed, passed ? 'Correctly returned 400' : `Got status: ${error.response?.status}`);
  }
}

// Main test runner
async function runAllTests() {
  log(YELLOW, '\n╔═══════════════════════════════════════════════╗');
  log(YELLOW, '║     Safe Zones API Test Suite                ║');
  log(YELLOW, `║     Backend: ${BASE_URL.padEnd(30)}║`);
  log(YELLOW, '╚═══════════════════════════════════════════════╝');
  
  const zones = await testListSafeZones();
  await testFilterByType();
  await testFilterByCity();
  await testNearbySearch();
  await testGetById(zones);
  
  const createdZone = await testCreateSafeZone();
  await testUpdateSafeZone(createdZone);
  await testDeleteSafeZone(createdZone);
  
  await testPagination();
  await testErrorHandling();
  
  // Summary
  log(YELLOW, '\n╔═══════════════════════════════════════════════╗');
  log(YELLOW, '║     Test Summary                              ║');
  log(YELLOW, '╚═══════════════════════════════════════════════╝');
  log(GREEN, `Tests Passed: ${testsPassed}`);
  if (testsFailed > 0) {
    log(RED, `Tests Failed: ${testsFailed}`);
  } else {
    log(GREEN, `Tests Failed: ${testsFailed}`);
  }
  log(YELLOW, `Total Tests: ${testsPassed + testsFailed}`);
  
  if (testsFailed === 0) {
    log(GREEN, '\n✓ All tests passed!');
    process.exit(0);
  } else {
    log(RED, '\n✗ Some tests failed');
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(error => {
  log(RED, `\n✗ Test suite crashed: ${error.message}`);
  console.error(error);
  process.exit(1);
});
