#!/usr/bin/env node



const axios = require('axios');
const colors = require('colors');


axios.defaults.timeout = 10000;
axios.defaults.headers.common['Content-Type'] = 'application/json';

const BACKEND_URL = 'http://localhost:3001';


const testUser = {
  name: 'Test User',
  email: 'test@example.com',
  phone: '+1234567890',
  passportId: 'TEST123456'
};

let verificationCode = '';
let otpCode = '';
let familyOtp = '';

const log = {
  info: (msg) => console.log('ℹ️ '.blue + msg),
  success: (msg) => console.log('✅'.green + ' ' + msg.green),
  error: (msg) => console.log('❌'.red + ' ' + msg.red),
  warn: (msg) => console.log('⚠️ '.yellow + ' ' + msg.yellow),
  step: (msg) => console.log('\n🔍'.cyan + ' ' + msg.cyan.bold)
};

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testServerConnection() {
  log.step('Testing server connection...');
  try {
    const response = await axios.get(`${BACKEND_URL}/health`);
    log.success(`Server is running: ${response.data.message}`);
    return true;
  } catch (error) {
    log.error(`Server connection failed: ${error.message}`);
    return false;
  }
}

async function testRegistration() {
  log.step('Testing user registration...');
  try {
    const response = await axios.post(`${BACKEND_URL}/api/v1/auth/register`, testUser);
    log.success(`Registration successful: ${response.data.message}`);
    log.info('Check your email for the verification code');
    return true;
  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;
    log.error(`Registration failed: ${errorMsg}`);
    return false;
  }
}

async function testEmailVerification() {
  log.step('Testing email verification...');
  
  
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  verificationCode = await new Promise((resolve) => {
    readline.question('Enter the verification code from your email: ', (answer) => {
      readline.close();
      resolve(answer);
    });
  });
  
  if (!verificationCode) {
    log.error('No verification code provided');
    return false;
  }
  
  try {
    const response = await axios.post(`${BACKEND_URL}/api/v1/auth/verify-email`, {
      passportId: testUser.passportId,
      code: verificationCode
    });
    log.success(`Email verified: ${response.data.message}`);
    return true;
  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;
    log.error(`Email verification failed: ${errorMsg}`);
    return false;
  }
}

async function testLogin() {
  log.step('Testing login (requesting OTP)...');
  try {
    const response = await axios.post(`${BACKEND_URL}/api/v1/auth/login`, {
      email: testUser.email
    });
    log.success(`Login OTP sent: ${response.data.message}`);
    log.info('Check your email for the OTP code');
    return true;
  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;
    log.error(`Login failed: ${errorMsg}`);
    return false;
  }
}

async function testOtpVerification() {
  log.step('Testing OTP verification...');
  
  
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  otpCode = await new Promise((resolve) => {
    readline.question('Enter the OTP code from your email: ', (answer) => {
      readline.close();
      resolve(answer);
    });
  });
  
  if (!otpCode) {
    log.error('No OTP code provided');
    return false;
  }
  
  try {
    const response = await axios.post(`${BACKEND_URL}/api/v1/auth/verify-otp`, {
      email: testUser.email,
      otp: otpCode
    });
    log.success(`OTP verified successfully! Welcome ${response.data.name}`);
    return true;
  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;
    log.error(`OTP verification failed: ${errorMsg}`);
    return false;
  }
}

async function testFamilyLogin() {
  log.step('Testing family login (requesting family OTP)...');
  try {
    const response = await axios.post(`${BACKEND_URL}/api/family/auth/request-otp`, {
      email: testUser.email
    });
    log.success(`Family OTP sent: ${response.data.message}`);
    log.info('Check your email for the family OTP code');
    return true;
  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;
    log.error(`Family OTP request failed: ${errorMsg}`);
    return false;
  }
}

async function testFamilyOtpVerification() {
  log.step('Testing family OTP verification...');
  
  
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  familyOtp = await new Promise((resolve) => {
    readline.question('Enter the family OTP code from your email: ', (answer) => {
      readline.close();
      resolve(answer);
    });
  });
  
  if (!familyOtp) {
    log.error('No family OTP code provided');
    return false;
  }
  
  try {
    const response = await axios.post(`${BACKEND_URL}/api/family/auth/verify-otp`, {
      email: testUser.email,
      otp: familyOtp
    });
    log.success(`Family OTP verified! Tourist: ${response.data.name}`);
    return true;
  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;
    log.error(`Family OTP verification failed: ${errorMsg}`);
    return false;
  }
}

async function runFullTest() {
  console.log('🧪 Backend Integration Testing Suite'.bold.cyan);
  console.log('==================================='.cyan);
  
  
  if (!await testServerConnection()) {
    log.error('Cannot continue without server connection');
    process.exit(1);
  }
  
  await delay(1000);
  
  
  if (!await testRegistration()) {
    log.warn('Registration failed, trying to continue with existing user...');
  }
  
  await delay(2000);
  
  
  log.info('If registration was successful, verify your email:');
  if (!await testEmailVerification()) {
    log.warn('Email verification failed, trying to continue...');
  }
  
  await delay(2000);
  
  
  if (!await testLogin()) {
    log.error('Login test failed');
    return;
  }
  
  await delay(2000);
  
  
  if (!await testOtpVerification()) {
    log.error('OTP verification test failed');
    return;
  }
  
  await delay(2000);
  
  
  if (!await testFamilyLogin()) {
    log.error('Family login test failed');
    return;
  }
  
  await delay(2000);
  
  
  if (!await testFamilyOtpVerification()) {
    log.error('Family OTP verification test failed');
    return;
  }
  
  console.log('\n🎉 All tests completed successfully!'.green.bold);
  console.log('Backend integration is working properly.'.green);
}


const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Backend Integration Test Script');
  console.log('Usage: node test-backend.js [options]');
  console.log('Options:');
  console.log('  --help       Show this help message');
  console.log('  --server     Test server connection only');
  console.log('  --register   Test registration only');
  console.log('  --login      Test login flow only');
  process.exit(0);
}

if (args.includes('--server')) {
  testServerConnection();
} else if (args.includes('--register')) {
  testRegistration();
} else if (args.includes('--login')) {
  testLogin().then(() => testOtpVerification());
} else {
  runFullTest();
}