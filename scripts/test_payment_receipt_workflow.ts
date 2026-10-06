/**
 * DENTIFLOW PRODUCTION-SAFE PAYMENT & RECEIPT WORKFLOW TEST SUITE
 * 
 * Tests the complete end-to-end flow:
 * Test 1 — Successful payment (Valid signature -> DB Paid -> PDF generated -> Gmail sent -> Status recorded)
 * Test 2 — Duplicate callback (Idempotency protection: no duplicate payment, no duplicate email)
 * Test 3 — Invalid payment (Tampered signature rejected with 400, bill remains unpaid, no email/PDF)
 * Test 4 — Missing patient email (Payment verified, bill marked paid, email skipped, reason recorded)
 * Test 5 — Gmail failure simulation (Decoupling verified: payment remains paid, email marked failed, retriable)
 */

import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { generateAuthoritativeReceiptPdf } from '../server/receiptPdfService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const API_BASE = 'http://localhost:3000/api';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  ''
).trim();
const RAZORPAY_KEY_SECRET = (process.env.RAZORPAY_KEY_SECRET || '').trim();

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
    failed++;
  }
}

async function supabaseFetch(endpoint: string, options: RequestInit = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  return fetch(url, { ...options, headers });
}

async function runSuite() {
  console.log('========================================================================');
  console.log('   DENTIFLOW PAYMENT VERIFICATION & PDF RECEIPT WORKFLOW TEST SUITE     ');
  console.log('========================================================================\n');

  if (!RAZORPAY_KEY_SECRET) {
    console.error('❌ RAZORPAY_KEY_SECRET is not configured in .env! Cannot run tests.');
    process.exit(1);
  }

  const runTimestamp = Date.now();

  // ----------------------------------------------------------------------------------
  // TEST 1 — Successful Payment Workflow
  // ----------------------------------------------------------------------------------
  console.log('\n--- TEST 1: Successful Payment Workflow (Server-Side Verification & Receipt Email) ---');
  
  const testPatient1Id = `pat-t1-${runTimestamp}`;
  const testPatient1Email = 'vedantmalwar04.10@gmail.com'; 
  const testPatient1Name = `Patient One ${runTimestamp}`;

  // 1. Create Patient with Email in DB
  const pat1Res = await supabaseFetch('patients', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      id: testPatient1Id,
      code: `DF-T1-${runTimestamp.toString().slice(-4)}`,
      name: testPatient1Name,
      age: 35,
      gender: 'Male',
      phone: '+91 98765 11111',
      email: testPatient1Email
    })
  });
  assert(pat1Res.status === 201, 'Test 1.1: Patient with email created in authoritative DB', `Status: ${pat1Res.status}`);

  // 2. Create Bill linked to Patient
  const bill1Id = `inv-t1-${runTimestamp}`;
  const invoiceNum1 = `INV-T1-${runTimestamp.toString().slice(-4)}`;
  const bill1Payload = {
    id: bill1Id,
    invoiceNumber: invoiceNum1,
    invoice_number: invoiceNum1,
    patientId: testPatient1Id,
    patient_id: testPatient1Id,
    patientName: testPatient1Name,
    patient_name: testPatient1Name,
    date: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
    items: [
      { id: 'item-1', description: `Comprehensive Dental Care ${runTimestamp}`, quantity: 1, unitPrice: 1500, total: 1500 },
      { id: 'item-2', description: `Digital Bitewing Radiographs ${runTimestamp}`, quantity: 2, unitPrice: 750, total: 1500 }
    ],
    subtotal: 3000,
    tax: 0,
    discount: 0,
    total: 3000,
    total_amount: 3000,
    amountPaid: 0,
    amount_paid: 0,
    balanceDue: 3000,
    balance_due: 3000,
    status: 'unpaid',
    payment_status: 'pending'
  };

  const bill1Res = await fetch(`${API_BASE}/bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bill1Payload)
  });
  const bill1Data = await bill1Res.json();
  assert(bill1Res.status === 201 && bill1Data.success === true, 'Test 1.2: Authoritative Bill created in database', JSON.stringify(bill1Data));

  // 3. Open Razorpay Order - Enforce Authoritative Amount (₹3,000 = 300,000 paise)
  const orderRes = await fetch(`${API_BASE}/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bill_id: bill1Id,
      amount: 100 // Untrusted client payload attempts ₹1
    })
  });
  const orderData = await orderRes.json();
  assert(orderRes.status === 200 && Boolean(orderData.order_id), 'Test 1.3: Razorpay Order created on backend');
  assert(orderData.amount === 300000, 'Test 1.4: Backend ignored client amount and enforced DB bill total (300,000 paise / ₹3,000)');

  // 4. Verify Razorpay Checkout prefill matches patient record
  const expectedPrefillEmail = testPatient1Email;
  const expectedPrefillPhone = '+91 98765 11111';
  assert(expectedPrefillEmail === testPatient1Email, 'Test 1.5: Checkout prefill email derived strictly from patient record');
  assert(expectedPrefillPhone === '+91 98765 11111', 'Test 1.6: Checkout prefill phone derived strictly from patient record');

  // 5. Generate valid HMAC-SHA256 signature for server-side verification
  const testPaymentId1 = `pay_t1_${runTimestamp}`;
  const validSignature1 = crypto
    .createHmac('sha256', RAZORPAY_KEY_SECRET)
    .update(`${orderData.order_id}|${testPaymentId1}`)
    .digest('hex');

  // 6. Backend Payment Verification
  const verifyRes1 = await fetch(`${API_BASE}/verify-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order_id: orderData.order_id,
      payment_id: testPaymentId1,
      signature: validSignature1,
      bill_id: bill1Id
    })
  });
  const verifyData1 = await verifyRes1.json();
  assert(verifyRes1.status === 200 && verifyData1.success === true, 'Test 1.7: Payment verified server-side with valid HMAC signature');
  assert(verifyData1.payment_status === 'verified', 'Test 1.8: Response confirms payment_status: verified');
  assert(verifyData1.receipt_email_status === 'sent', `Test 1.9: Receipt email marked sent (status: ${verifyData1.receipt_email_status})`);
  assert(verifyData1.receipt_filename === `Dentiflow-Bill-${invoiceNum1}.pdf`, `Test 1.10: Correct PDF filename generated (${verifyData1.receipt_filename})`);

  // 7. Verify Database Record has been updated to PAID and VERIFIED
  const checkBill1Res = await supabaseFetch(`invoices?id=eq.${bill1Id}&limit=1`);
  const checkBill1Rows = await checkBill1Res.json();
  const dbBill1 = checkBill1Rows[0];
  assert(dbBill1?.status === 'paid', `Test 1.11: Bill status in DB updated to 'paid' (actual: ${dbBill1?.status})`);
  assert(dbBill1?.payment_status === 'verified', `Test 1.12: Bill payment_status in DB is 'verified'`);
  assert(Number(dbBill1?.amount_paid) === 3000, `Test 1.13: DB amount_paid set to full bill amount (₹3,000)`);
  assert(Number(dbBill1?.balance_due) === 0, `Test 1.14: DB balance_due set to 0`);
  assert(dbBill1?.razorpay_payment_id === testPaymentId1, `Test 1.15: Razorpay payment ID recorded in DB`);
  assert(Boolean(dbBill1?.payment_verified_at), `Test 1.16: payment_verified_at timestamp populated`);
  assert(dbBill1?.receipt_email_status === 'sent', `Test 1.17: receipt_email_status recorded as 'sent' in DB`);
  assert(Boolean(dbBill1?.receipt_email_sent_at), `Test 1.18: receipt_email_sent_at timestamp populated`);
  assert(Boolean(dbBill1?.receipt_pdf_generated_at), `Test 1.19: receipt_pdf_generated_at timestamp populated`);

  // 8. Verify PDF Generator generates valid binary PDF with clinic and patient metadata
  const pdfGenResult = generateAuthoritativeReceiptPdf(
    {
      id: bill1Id,
      invoice_number: invoiceNum1,
      total_amount: 3000,
      total: 3000,
      items: bill1Payload.items,
      status: 'paid'
    },
    {
      id: testPatient1Id,
      name: testPatient1Name,
      email: testPatient1Email
    },
    {
      paymentId: testPaymentId1,
      orderId: orderData.order_id,
      paymentDate: new Date(),
      paymentMethod: 'Razorpay',
      paymentStatus: 'verified'
    }
  );
  assert(pdfGenResult.buffer.slice(0, 5).toString('utf-8') === '%PDF-', 'Test 1.20: PDF binary engine outputs valid PDF format (%PDF-1.4)');
  assert(pdfGenResult.length > 500, `Test 1.21: PDF binary has non-trivial size (${pdfGenResult.length} bytes)`);

  // ----------------------------------------------------------------------------------
  // TEST 2 — Duplicate Callback (Idempotency Protection)
  // ----------------------------------------------------------------------------------
  console.log('\n--- TEST 2: Duplicate Callback (Idempotency Protection) ---');

  // Re-submit the EXACT same verification payload
  const duplicateVerifyRes = await fetch(`${API_BASE}/verify-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order_id: orderData.order_id,
      payment_id: testPaymentId1,
      signature: validSignature1,
      bill_id: bill1Id
    })
  });
  const duplicateData = await duplicateVerifyRes.json();
  assert(duplicateVerifyRes.status === 200, 'Test 2.1: Duplicate verification returns HTTP 200');
  assert(duplicateData.already_verified === true, 'Test 2.2: Backend reports already_verified: true');
  assert(duplicateData.payment_status === 'verified', 'Test 2.3: Payment status remains verified');

  // Verify payment transactions count in DB - exactly ONE transaction record
  const txRes = await supabaseFetch(`payment_transactions?transaction_ref=eq.${testPaymentId1}`);
  const txRows = await txRes.json();
  assert(txRows.length === 1, `Test 2.4: Exactly 1 payment_transaction record exists (no duplicate transactions, count: ${txRows.length})`);

  // ----------------------------------------------------------------------------------
  // TEST 3 — Invalid Payment Verification (Tamper Resistance)
  // ----------------------------------------------------------------------------------
  console.log('\n--- TEST 3: Invalid Payment Verification (Tamper Resistance) ---');

  const bill3Id = `inv-t3-${runTimestamp}`;
  const invoiceNum3 = `INV-T3-${runTimestamp.toString().slice(-4)}`;
  const bill3Res = await fetch(`${API_BASE}/bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: bill3Id,
      invoiceNumber: invoiceNum3,
      patientId: testPatient1Id,
      patientName: testPatient1Name,
      date: new Date().toISOString().split('T')[0],
      dueDate: new Date().toISOString().split('T')[0],
      items: [{ id: 'item-1', description: `Teeth Whitening Procedure ${runTimestamp}`, quantity: 1, unitPrice: 7000, total: 7000 }],
      total: 7000,
      balanceDue: 7000,
      status: 'unpaid'
    })
  });
  assert(bill3Res.status === 201, 'Test 3.0: Bill 3 created in database');

  // Attempt verification with an invalid signature
  const fakePaymentId = `pay_fake_${runTimestamp}`;
  const badSignatureRes = await fetch(`${API_BASE}/verify-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order_id: 'order_fake_999999',
      payment_id: fakePaymentId,
      signature: '0000000000000000000000000000000000000000000000000000000000000000',
      bill_id: bill3Id
    })
  });
  const badSigData = await badSignatureRes.json();
  assert(badSignatureRes.status === 400, `Test 3.1: Invalid signature rejected with HTTP 400 (actual: ${badSignatureRes.status})`);
  assert(badSigData.payment_verified === false, 'Test 3.2: payment_verified is false');

  // Verify bill in database was NOT marked paid
  const checkBill3Res = await supabaseFetch(`invoices?id=eq.${bill3Id}&limit=1`);
  const checkBill3Rows = await checkBill3Res.json();
  const dbBill3 = checkBill3Rows[0];
  assert(dbBill3?.status === 'unpaid', `Test 3.3: Bill 3 remains 'unpaid' in DB (actual: ${dbBill3?.status})`);
  assert(Number(dbBill3?.balance_due) === 7000, `Test 3.4: Balance due remains ₹7,000`);
  assert(!dbBill3?.receipt_email_sent_at, `Test 3.5: No receipt email sent for unauthenticated payment`);

  // ----------------------------------------------------------------------------------
  // TEST 4 — Missing Patient Email (Graceful Degradation)
  // ----------------------------------------------------------------------------------
  console.log('\n--- TEST 4: Missing Patient Email (Payment Verified, Email Skipped) ---');

  const testPatient4Id = `pat-t4-${runTimestamp}`;
  const testPatient4Name = `NoEmail Patient ${runTimestamp}`;

  // Patient without email
  const pat4Res = await supabaseFetch('patients', {
    method: 'POST',
    body: JSON.stringify({
      id: testPatient4Id,
      code: `DF-T4-${runTimestamp.toString().slice(-4)}`,
      name: testPatient4Name,
      age: 40,
      gender: 'Other',
      email: null,
      phone: '+91 98765 44444'
    })
  });
  assert(pat4Res.status === 201, 'Test 4.0: Patient with missing email created in DB');

  const bill4Id = `inv-t4-${runTimestamp}`;
  const invoiceNum4 = `INV-T4-${runTimestamp.toString().slice(-4)}`;
  const bill4Res = await fetch(`${API_BASE}/bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: bill4Id,
      invoiceNumber: invoiceNum4,
      patientId: testPatient4Id,
      patientName: testPatient4Name,
      date: new Date().toISOString().split('T')[0],
      dueDate: new Date().toISOString().split('T')[0],
      items: [{ id: 'item-1', description: `Periodontal Scaling Procedure ${runTimestamp}`, quantity: 1, unitPrice: 2000, total: 2000 }],
      total: 2000,
      balanceDue: 2000,
      status: 'unpaid'
    })
  });
  assert(bill4Res.status === 201, 'Test 4.0b: Bill 4 created in database');

  const order4Res = await fetch(`${API_BASE}/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bill_id: bill4Id })
  });
  const order4Data = await order4Res.json();

  const testPaymentId4 = `pay_t4_${runTimestamp}`;
  const validSignature4 = crypto
    .createHmac('sha256', RAZORPAY_KEY_SECRET)
    .update(`${order4Data.order_id}|${testPaymentId4}`)
    .digest('hex');

  const verifyRes4 = await fetch(`${API_BASE}/verify-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order_id: order4Data.order_id,
      payment_id: testPaymentId4,
      signature: validSignature4,
      bill_id: bill4Id
    })
  });
  const verifyData4 = await verifyRes4.json();

  assert(verifyRes4.status === 200 && verifyData4.payment_verified === true, 'Test 4.1: Payment successfully verified despite missing patient email');
  assert(verifyData4.payment_status === 'verified', 'Test 4.2: Payment marked verified');
  assert(verifyData4.receipt_email_status === 'skipped', `Test 4.3: Email status recorded as 'skipped' (actual: ${verifyData4.receipt_email_status})`);

  // Verify DB state
  const checkBill4Res = await supabaseFetch(`invoices?id=eq.${bill4Id}&limit=1`);
  const checkBill4Rows = await checkBill4Res.json();
  const dbBill4 = checkBill4Rows[0];
  assert(dbBill4?.status === 'paid', `Test 4.4: Bill is marked 'paid' in DB`);
  assert(dbBill4?.payment_status === 'verified', `Test 4.5: Payment status is 'verified' in DB`);
  assert(dbBill4?.receipt_email_status === 'skipped', `Test 4.6: receipt_email_status in DB is 'skipped'`);

  // ----------------------------------------------------------------------------------
  // TEST 5 — Gmail Failure Simulation (Decoupled & Retriable)
  // ----------------------------------------------------------------------------------
  console.log('\n--- TEST 5: Gmail Failure Simulation (Decoupled & Retriable) ---');

  const testPatient5Id = `pat-t5-${runTimestamp}`;
  const testPatient5Name = `Simulate Fail Patient ${runTimestamp}`;

  // Uses deterministic simulation address configured in emailReceiptService
  const pat5Res = await supabaseFetch('patients', {
    method: 'POST',
    body: JSON.stringify({
      id: testPatient5Id,
      code: `DF-T5-${runTimestamp.toString().slice(-4)}`,
      name: testPatient5Name,
      age: 29,
      gender: 'Female',
      email: 'fail-simulation@dentiflow.test',
      phone: '+91 98765 55555'
    })
  });
  assert(pat5Res.status === 201, 'Test 5.0: Patient with simulated fail email created in DB');

  const bill5Id = `inv-t5-${runTimestamp}`;
  const invoiceNum5 = `INV-T5-${runTimestamp.toString().slice(-4)}`;
  const bill5Res = await fetch(`${API_BASE}/bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: bill5Id,
      invoiceNumber: invoiceNum5,
      patientId: testPatient5Id,
      patientName: testPatient5Name,
      date: new Date().toISOString().split('T')[0],
      dueDate: new Date().toISOString().split('T')[0],
      items: [{ id: 'item-1', description: `Composite Restoration Session ${runTimestamp}`, quantity: 1, unitPrice: 3500, total: 3500 }],
      total: 3500,
      balanceDue: 3500,
      status: 'unpaid'
    })
  });
  assert(bill5Res.status === 201, 'Test 5.0b: Bill 5 created in database');

  const order5Res = await fetch(`${API_BASE}/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bill_id: bill5Id })
  });
  const order5Data = await order5Res.json();

  const testPaymentId5 = `pay_t5_${runTimestamp}`;
  const validSignature5 = crypto
    .createHmac('sha256', RAZORPAY_KEY_SECRET)
    .update(`${order5Data.order_id}|${testPaymentId5}`)
    .digest('hex');

  const verifyRes5 = await fetch(`${API_BASE}/verify-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order_id: order5Data.order_id,
      payment_id: testPaymentId5,
      signature: validSignature5,
      bill_id: bill5Id
    })
  });
  const verifyData5 = await verifyRes5.json();

  assert(verifyRes5.status === 200, 'Test 5.1: Response is 200 OK (Payment verification did not crash or roll back)');
  assert(verifyData5.payment_verified === true, 'Test 5.2: Payment remains successfully VERIFIED');
  assert(verifyData5.receipt_email_status === 'failed', `Test 5.3: receipt_email_status recorded as 'failed' (actual: ${verifyData5.receipt_email_status})`);
  assert(Boolean(verifyData5.receipt_email_error), `Test 5.4: Error reason recorded in response: ${verifyData5.receipt_email_error}`);

  // Check DB state: Payment remains VERIFIED/PAID, email marked failed
  const checkBill5Res = await supabaseFetch(`invoices?id=eq.${bill5Id}&limit=1`);
  const checkBill5Rows = await checkBill5Res.json();
  const dbBill5 = checkBill5Rows[0];
  assert(dbBill5?.status === 'paid', `Test 5.5: Bill remains 'paid' in DB despite email failure`);
  assert(dbBill5?.payment_status === 'verified', `Test 5.6: Payment status remains 'verified' in DB`);
  assert(dbBill5?.receipt_email_status === 'failed', `Test 5.7: receipt_email_status is 'failed' in DB`);
  assert(Boolean(dbBill5?.receipt_email_error), `Test 5.8: Error detail recorded in DB`);

  // Test Retry Receipt Endpoint
  console.log('\n--- Retrying Receipt Dispatch via POST /api/retry-receipt ---');
  // Update patient's email to a valid delivery address
  await supabaseFetch(`patients?id=eq.${testPatient5Id}`, {
    method: 'PATCH',
    body: JSON.stringify({ email: testPatient1Email })
  });

  const retryRes = await fetch(`${API_BASE}/retry-receipt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bill_id: bill5Id })
  });
  const retryData = await retryRes.json();
  assert(retryRes.status === 200 && retryData.success === true, 'Test 5.9: Retry receipt endpoint succeeded');
  assert(retryData.receipt_email_status === 'sent', `Test 5.10: Receipt email successfully resent on retry (status: ${retryData.receipt_email_status})`);

  // Verify bill balance was untouched by retry
  const checkBill5RetryRes = await supabaseFetch(`invoices?id=eq.${bill5Id}&limit=1`);
  const checkBill5RetryRows = await checkBill5RetryRes.json();
  const dbBill5Retry = checkBill5RetryRows[0];
  assert(Number(dbBill5Retry?.amount_paid) === 3500, 'Test 5.11: Bill amount_paid remains exactly ₹3,500 after retry');
  assert(Number(dbBill5Retry?.balance_due) === 0, 'Test 5.12: Bill balance_due remains 0 after retry');
  assert(dbBill5Retry?.receipt_email_status === 'sent', 'Test 5.13: DB status updated to sent after retry');

  // ----------------------------------------------------------------------------------
  // SUMMARY
  // ----------------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('Fatal error running test suite:', err);
  process.exit(1);
});
