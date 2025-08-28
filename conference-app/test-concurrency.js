#!/usr/bin/env node

/**
 * Concurrency test script for the conference app
 * Tests multiple simultaneous reads and writes to ensure SQLite WAL mode is working
 * Cleans up after itself by tracking and deleting created resources
 */

const https = require('https');

const BASE_URL = 'https://conf.sandbox.miren.cloud';

// Track created resources for cleanup
const createdTalks = [];
const createdAttendees = [];
let originalConferenceName = null;

// Helper to make HTTP requests
function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => {
        try {
          const result = {
            statusCode: res.statusCode,
            headers: res.headers,
            body: res.statusCode >= 200 && res.statusCode < 300 && body ? JSON.parse(body) : body
          };
          resolve(result);
        } catch {
          resolve({ statusCode: res.statusCode, body, headers: res.headers });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

// Test functions
async function createTalk(num) {
  const talk = {
    title: `Concurrent Talk ${num} - ${Date.now()}`,
    speaker: `Speaker ${num}`,
    description: `Testing concurrency with talk number ${num}`,
    start_time: `${10 + (num % 12)}:00`,
    end_time: `${11 + (num % 12)}:00`,
    room: `Room ${String.fromCharCode(65 + (num % 5))}`
  };

  const options = {
    hostname: 'conf.sandbox.miren.cloud',
    path: '/api/talks',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  };

  const start = Date.now();
  try {
    const result = await makeRequest(options, talk);
    const duration = Date.now() - start;

    // Track for cleanup
    if (result.statusCode === 200 && result.body?.id) {
      createdTalks.push(result.body.id);
    }

    return {
      success: result.statusCode === 200,
      duration,
      talkId: result.body?.id,
      operation: 'CREATE',
      num
    };
  } catch (error) {
    return {
      success: false,
      duration: Date.now() - start,
      error: error.message,
      operation: 'CREATE',
      num
    };
  }
}

async function createAttendee(num) {
  const attendee = {
    name: `Test User ${num}`,
    email: `testuser${num}_${Date.now()}@example.com`
  };

  const options = {
    hostname: 'conf.sandbox.miren.cloud',
    path: '/api/attendees',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  };

  const start = Date.now();
  try {
    const result = await makeRequest(options, attendee);
    const duration = Date.now() - start;

    // Track for cleanup (though we can't delete attendees via API)
    if (result.statusCode === 200 && result.body?.id) {
      createdAttendees.push(result.body.id);
    }

    return {
      success: result.statusCode === 200,
      duration,
      attendeeId: result.body?.id,
      operation: 'CREATE_ATTENDEE',
      num
    };
  } catch (error) {
    return {
      success: false,
      duration: Date.now() - start,
      error: error.message,
      operation: 'CREATE_ATTENDEE',
      num
    };
  }
}

async function updateConferenceName(num) {
  const names = [
    'Mega Conference 2024',
    'Ultra Tech Summit',
    'Hyper Dev Fest',
    'Quantum Code Con',
    'Cosmic Hack Palooza'
  ];

  const options = {
    hostname: 'conf.sandbox.miren.cloud',
    path: '/api/conference-name',
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    }
  };

  const start = Date.now();
  try {
    const result = await makeRequest(options, { name: names[num % names.length] + ` v${num}` });
    const duration = Date.now() - start;
    return {
      success: result.statusCode === 200,
      duration,
      operation: 'UPDATE_CONF_NAME',
      num
    };
  } catch (error) {
    return {
      success: false,
      duration: Date.now() - start,
      error: error.message,
      operation: 'UPDATE_CONF_NAME',
      num
    };
  }
}

async function readConferenceName(num) {
  const options = {
    hostname: 'conf.sandbox.miren.cloud',
    path: '/api/conference-name',
    method: 'GET'
  };

  const start = Date.now();
  try {
    const result = await makeRequest(options);
    const duration = Date.now() - start;
    return {
      success: result.statusCode === 200,
      duration,
      operation: 'READ_CONF_NAME',
      name: result.body?.name,
      num
    };
  } catch (error) {
    return {
      success: false,
      duration: Date.now() - start,
      error: error.message,
      operation: 'READ_CONF_NAME',
      num
    };
  }
}

// Cleanup function
async function cleanup() {
  console.log('\n🧹 Cleaning up test data...');

  // Delete created talks
  let deletedTalksCount = 0;
  for (const talkId of createdTalks) {
    try {
      const options = {
        hostname: 'conf.sandbox.miren.cloud',
        path: `/api/talks/${talkId}`,
        method: 'DELETE'
      };
      await makeRequest(options);
      deletedTalksCount++;
    } catch {
      // Silent fail - talk may already be deleted
    }
  }
  console.log(`   Deleted ${deletedTalksCount}/${createdTalks.length} test talks`);

  // Delete created attendees using the new API
  let deletedAttendeesCount = 0;
  for (const attendeeId of createdAttendees) {
    try {
      const options = {
        hostname: 'conf.sandbox.miren.cloud',
        path: `/api/attendees/${attendeeId}`,
        method: 'DELETE'
      };
      await makeRequest(options);
      deletedAttendeesCount++;
    } catch {
      // Silent fail - attendee may already be deleted
    }
  }
  console.log(`   Deleted ${deletedAttendeesCount}/${createdAttendees.length} test attendees`);

  // Restore original conference name if we saved it
  if (originalConferenceName) {
    try {
      const options = {
        hostname: 'conf.sandbox.miren.cloud',
        path: '/api/conference-name',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        }
      };
      await makeRequest(options, { name: originalConferenceName });
      console.log(`   Restored original conference name: "${originalConferenceName}"`);
    } catch {
      console.log('   Could not restore conference name');
    }
  }

  console.log('✨ Cleanup complete!');
}

// Main test runner
async function runConcurrencyTest() {
  console.log('🚀 Starting HEAVY concurrency test against', BASE_URL);
  console.log('='.repeat(60));

  // Save original conference name for restoration
  try {
    const options = {
      hostname: 'conf.sandbox.miren.cloud',
      path: '/api/conference-name',
      method: 'GET'
    };
    const result = await makeRequest(options);
    if (result.statusCode === 200) {
      originalConferenceName = result.body?.name;
      console.log(`📌 Saved original conference name: "${originalConferenceName}"`);
    }
  } catch {
    console.log('Could not save original conference name');
  }

  // Test 1: Heavy simultaneous writes (creates)
  console.log('\n📝 Test 1: 50 simultaneous CREATE operations (hitting it hard!)...');
  const createPromises = [];
  for (let i = 0; i < 50; i++) {
    createPromises.push(createTalk(i));
  }

  const createResults = await Promise.all(createPromises);
  const createSuccesses = createResults.filter(r => r.success).length;
  const createAvgTime =
    createResults.reduce((sum, r) => sum + r.duration, 0) / createResults.length;

  console.log(`✅ Successful creates: ${createSuccesses}/50`);
  console.log(`⏱️  Average time: ${createAvgTime.toFixed(2)}ms`);
  if (createSuccesses < 50) {
    const errors = createResults.filter(r => !r.success);
    console.log(`❌ Failed: ${errors.length} operations`);
  }

  // Test 2: Heavy attendee registration
  console.log('\n👥 Test 2: 40 simultaneous attendee registrations...');
  const attendeePromises = [];
  for (let i = 0; i < 40; i++) {
    attendeePromises.push(createAttendee(i));
  }

  const attendeeResults = await Promise.all(attendeePromises);
  const attendeeSuccesses = attendeeResults.filter(r => r.success).length;
  const attendeeAvgTime =
    attendeeResults.reduce((sum, r) => sum + r.duration, 0) / attendeeResults.length;

  console.log(`✅ Successful registrations: ${attendeeSuccesses}/40`);
  console.log(`⏱️  Average time: ${attendeeAvgTime.toFixed(2)}ms`);

  // Test 3: Heavy mixed reads and writes
  console.log('\n🔄 Test 3: Heavy mixed load (30 reads + 30 writes simultaneously)...');
  const mixedPromises = [];
  for (let i = 0; i < 30; i++) {
    mixedPromises.push(readConferenceName(i));
    mixedPromises.push(updateConferenceName(i));
  }

  const mixedResults = await Promise.all(mixedPromises);
  const readResults = mixedResults.filter(r => r.operation === 'READ_CONF_NAME');
  const writeResults = mixedResults.filter(r => r.operation === 'UPDATE_CONF_NAME');

  const readSuccesses = readResults.filter(r => r.success).length;
  const writeSuccesses = writeResults.filter(r => r.success).length;
  const readAvgTime = readResults.reduce((sum, r) => sum + r.duration, 0) / readResults.length;
  const writeAvgTime = writeResults.reduce((sum, r) => sum + r.duration, 0) / writeResults.length;

  console.log(`✅ Successful reads: ${readSuccesses}/30`);
  console.log(`⏱️  Average read time: ${readAvgTime.toFixed(2)}ms`);
  console.log(`✅ Successful writes: ${writeSuccesses}/30`);
  console.log(`⏱️  Average write time: ${writeAvgTime.toFixed(2)}ms`);

  // Test 4: Extreme concurrent writes (stress test)
  console.log('\n⚡ Test 4: EXTREME test - 100 concurrent writes at once!...');
  const extremePromises = [];
  for (let i = 0; i < 100; i++) {
    if (i % 3 === 0) {
      extremePromises.push(createTalk(100 + i));
    } else if (i % 3 === 1) {
      extremePromises.push(createAttendee(100 + i));
    } else {
      extremePromises.push(updateConferenceName(100 + i));
    }
  }

  const extremeResults = await Promise.all(extremePromises);
  const extremeSuccesses = extremeResults.filter(r => r.success).length;
  const extremeAvgTime =
    extremeResults.reduce((sum, r) => sum + r.duration, 0) / extremeResults.length;

  console.log(`✅ Successful operations: ${extremeSuccesses}/100`);
  console.log(`⏱️  Average time: ${extremeAvgTime.toFixed(2)}ms`);

  // Test 5: Sustained load
  console.log('\n🏋️ Test 5: Sustained load - 3 waves of 25 operations...');
  let sustainedTotal = 0;
  let sustainedSuccess = 0;

  for (let wave = 1; wave <= 3; wave++) {
    const wavePromises = [];
    for (let i = 0; i < 25; i++) {
      wavePromises.push(createTalk(200 + wave * 25 + i));
    }
    const waveResults = await Promise.all(wavePromises);
    const waveSuccesses = waveResults.filter(r => r.success).length;
    sustainedTotal += waveResults.length;
    sustainedSuccess += waveSuccesses;
    console.log(`   Wave ${wave}: ${waveSuccesses}/25 successful`);
  }

  console.log(`✅ Total sustained: ${sustainedSuccess}/${sustainedTotal}`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY:');
  const totalOps =
    createResults.length +
    attendeeResults.length +
    mixedResults.length +
    extremeResults.length +
    sustainedTotal;
  const totalSuccess =
    createSuccesses +
    attendeeSuccesses +
    readSuccesses +
    writeSuccesses +
    extremeSuccesses +
    sustainedSuccess;
  const successRate = ((totalSuccess / totalOps) * 100).toFixed(1);

  console.log(`Total operations: ${totalOps}`);
  console.log(`Successful operations: ${totalSuccess}`);
  console.log(`Success rate: ${successRate}%`);
  console.log(`Created ${createdTalks.length} talks and ${createdAttendees.length} attendees`);

  if (successRate >= 95) {
    console.log('\n✅ EXCELLENT: SQLite concurrency handling is working great!');
    console.log('   Your 3 instances are handling heavy load like champions! 🏆');
  } else if (successRate >= 80) {
    console.log('\n⚠️  GOOD: Most operations succeeded, but some concurrency issues detected');
    console.log('   Consider monitoring for SQLITE_BUSY errors in production');
  } else {
    console.log('\n❌ NEEDS ATTENTION: Significant concurrency issues detected');
    console.log('   Check server logs for SQLITE_BUSY errors and retry failures');
  }

  console.log('\n💡 Note: With WAL mode enabled, reads should never block and writes');
  console.log('   should retry automatically on SQLITE_BUSY errors.');
}

// Handle cleanup on exit
process.on('SIGINT', async () => {
  console.log('\n\n⚠️  Test interrupted! Cleaning up...');
  await cleanup();
  process.exit(1);
});

// Run the test with cleanup
async function runTest() {
  try {
    await runConcurrencyTest();
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await cleanup();
  }
}

// Run it!
runTest().catch(console.error);
