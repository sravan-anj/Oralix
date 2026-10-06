import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const API_BASE = 'http://localhost:3000/api';

async function runTests() {
  console.log('====================================================');
  console.log('   DENTIFLOW AUTHORITATIVE BILLING TEST SUITE       ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
      failed++;
    }
  }

  // -------------------------------------------------------------
  // Test A: Create Bill (Patient: Rahul, Bill: Root Canal)
  // -------------------------------------------------------------
  console.log('\n--- Test A: Create Bill (Rahul, Root Canal) ---');
  const billAId = `inv-test-rahul-${Date.now()}`;
  const billAPayload = {
    id: billAId,
    invoiceNumber: `INV-TEST-A-${Date.now().toString().slice(-4)}`,
    patientId: 'p-rahul',
    patientName: 'Rahul',
    date: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
    items: [
      { id: 'item-1', description: 'Root Canal Treatment', quantity: 1, unitPrice: 4500, total: 4500 }
    ],
    subtotal: 4500,
    tax: 0,
    discount: 0,
    total: 4500,
    amountPaid: 0,
    balanceDue: 4500,
    status: 'unpaid',
    notes: 'Test A Root Canal'
  };

  const resA = await fetch(`${API_BASE}/bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(billAPayload)
  });
  const dataA = await resA.json();
  assert(resA.status === 201 && dataA.success === true, 'Test A: Bill created successfully', JSON.stringify(dataA));

  // Verify visible in GET /api/bills
  const getResA = await fetch(`${API_BASE}/bills`);
  const allBillsA = await getResA.json();
  const foundInDoctorViewA = allBillsA.bills?.find((b: any) => b.id === dataA.bill?.id);
  assert(Boolean(foundInDoctorViewA), 'Test A: Bill visible in Doctor/Receptionist views', `Found: ${Boolean(foundInDoctorViewA)}`);

  // -------------------------------------------------------------
  // Test B: Duplicate Creation Rejected (Rahul, Root Canal)
  // -------------------------------------------------------------
  console.log('\n--- Test B: Duplicate Creation Rejected (Rahul, Root Canal) ---');
  const duplicatePayload = {
    id: `inv-test-dup-${Date.now()}`,
    invoiceNumber: `INV-TEST-DUP-${Date.now().toString().slice(-4)}`,
    patientId: 'p-rahul',
    patientName: 'Rahul',
    date: new Date().toISOString().split('T')[0],
    dueDate: new Date().toISOString().split('T')[0],
    items: [
      { id: 'item-dup', description: 'Root Canal Treatment', quantity: 1, unitPrice: 4500, total: 4500 }
    ],
    subtotal: 4500,
    tax: 0,
    discount: 0,
    total: 4500,
    amountPaid: 0,
    balanceDue: 4500,
    status: 'unpaid'
  };

  const resB = await fetch(`${API_BASE}/bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(duplicatePayload)
  });
  const dataB = await resB.json();
  assert(resB.status === 409, 'Test B: Backend returns 409 Conflict', `Status: ${resB.status}`);
  assert(
    dataB.error === 'This bill has already been created for this patient.',
    'Test B: Backend returns exact duplicate error message',
    `Message: ${dataB.error}`
  );

  // -------------------------------------------------------------
  // Test C: Same bill name, different patient (Priya, Root Canal)
  // -------------------------------------------------------------
  console.log('\n--- Test C: Same Bill Name, Different Patient (Priya, Root Canal) ---');
  const billCPayload = {
    id: `inv-test-priya-${Date.now()}`,
    invoiceNumber: `INV-TEST-C-${Date.now().toString().slice(-4)}`,
    patientId: 'p-priya',
    patientName: 'Priya',
    date: new Date().toISOString().split('T')[0],
    dueDate: new Date().toISOString().split('T')[0],
    items: [
      { id: 'item-priya', description: 'Root Canal Treatment', quantity: 1, unitPrice: 4500, total: 4500 }
    ],
    subtotal: 4500,
    tax: 0,
    discount: 0,
    total: 4500,
    amountPaid: 0,
    balanceDue: 4500,
    status: 'unpaid'
  };

  const resC = await fetch(`${API_BASE}/bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(billCPayload)
  });
  const dataC = await resC.json();
  assert(resC.status === 201 && dataC.success === true, 'Test C: Priya bill created successfully', JSON.stringify(dataC));

  // -------------------------------------------------------------
  // Test D: Same patient, different bill (Rahul, Dental Implant)
  // -------------------------------------------------------------
  console.log('\n--- Test D: Same Patient, Different Bill (Rahul, Dental Implant) ---');
  const billDPayload = {
    id: `inv-test-rahul-implant-${Date.now()}`,
    invoiceNumber: `INV-TEST-D-${Date.now().toString().slice(-4)}`,
    patientId: 'p-rahul',
    patientName: 'Rahul',
    date: new Date().toISOString().split('T')[0],
    dueDate: new Date().toISOString().split('T')[0],
    items: [
      { id: 'item-implant', description: 'Dental Implant', quantity: 1, unitPrice: 25000, total: 25000 }
    ],
    subtotal: 25000,
    tax: 0,
    discount: 0,
    total: 25000,
    amountPaid: 0,
    balanceDue: 25000,
    status: 'unpaid'
  };

  const resD = await fetch(`${API_BASE}/bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(billDPayload)
  });
  const dataD = await resD.json();
  assert(resD.status === 201 && dataD.success === true, 'Test D: Rahul Dental Implant created successfully', JSON.stringify(dataD));

  // -------------------------------------------------------------
  // Test E: Doctor Edits Existing Bill (₹4,500 -> ₹5,000)
  // -------------------------------------------------------------
  console.log('\n--- Test E: Doctor Edits Existing Bill (₹4,500 -> ₹5,000) ---');
  const targetBillId = dataA.bill?.id || billAId;
  const updatePayload = {
    total: 5000,
    subtotal: 5000,
    balanceDue: 5000,
    items: [
      { id: 'item-1', description: 'Root Canal Treatment', quantity: 1, unitPrice: 5000, total: 5000 }
    ],
    notes: 'Doctor adjusted fee to ₹5,000'
  };

  const resE = await fetch(`${API_BASE}/bills/${targetBillId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updatePayload)
  });
  const dataE = await resE.json();
  assert(resE.status === 200 && dataE.bill?.total === 5000, 'Test E: Bill updated to ₹5,000', `Updated: ${dataE.bill?.total}`);

  // Check Receptionist & Doctor view reads ₹5,000 from the canonical record
  const checkResE = await fetch(`${API_BASE}/bills`);
  const allBillsE = await checkResE.json();
  const canonicalBillE = allBillsE.bills?.find((b: any) => b.id === targetBillId);
  assert(canonicalBillE?.total === 5000, 'Test E: Receptionist sees updated ₹5,000 total', `Total: ${canonicalBillE?.total}`);
  assert(canonicalBillE?.balanceDue === 5000, 'Test E: Balance due is updated to ₹5,000', `BalanceDue: ${canonicalBillE?.balanceDue}`);

  // -------------------------------------------------------------
  // Test F: Refresh Simulation (Both views maintain visibility)
  // -------------------------------------------------------------
  console.log('\n--- Test F: Refresh Simulation ---');
  const resRefresh = await fetch(`${API_BASE}/bills`);
  const refreshedBills = await resRefresh.json();
  const refreshedTarget = refreshedBills.bills?.find((b: any) => b.id === targetBillId);
  assert(Boolean(refreshedTarget), 'Test F: Bill remains visible after refresh', `Found: ${Boolean(refreshedTarget)}`);
  assert(refreshedTarget?.patientName === 'Rahul', 'Test F: Patient name is Rahul', `Patient: ${refreshedTarget?.patientName}`);

  // -------------------------------------------------------------
  // Test G: Razorpay Payment uses authoritative DB amount (₹5,000)
  // -------------------------------------------------------------
  console.log('\n--- Test G: Razorpay Authoritative Amount & Payment ---');
  // Client attempts to tamper or provide ₹1 (100 paise)
  const orderRes = await fetch(`${API_BASE}/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bill_id: targetBillId,
      amount: 100 // Tampered amount (₹1)
    })
  });
  const orderData = await orderRes.json();
  assert(orderRes.status === 200, 'Test G: Order created successfully', JSON.stringify(orderData));
  // Authoritative amount in paise must be 5000 * 100 = 500000
  assert(orderData.amount === 500000, 'Test G: Backend enforced ₹5,000 (500,000 paise) from DB, ignoring client amount', `Amount: ${orderData.amount}`);

  // 1. Verify invalid signature is rejected
  const badVerifyRes = await fetch(`${API_BASE}/verify-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order_id: orderData.order_id,
      payment_id: `pay_fake_${Date.now()}`,
      signature: 'bad_unauthenticated_signature',
      bill_id: targetBillId
    })
  });
  assert(badVerifyRes.status === 400, 'Test G: Unauthenticated payment rejected with 400', `Status: ${badVerifyRes.status}`);

  // 2. Verify valid HMAC signature is accepted
  const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
  const testPaymentId = `pay_auth_${Date.now()}`;
  const validSignature = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderData.order_id}|${testPaymentId}`)
    .digest('hex');

  const verifyRes = await fetch(`${API_BASE}/verify-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order_id: orderData.order_id,
      payment_id: testPaymentId,
      signature: validSignature,
      bill_id: targetBillId
    })
  });
  const verifyData = await verifyRes.json();
  assert(verifyRes.status === 200 && verifyData.success === true, 'Test G: Authenticated payment verified successfully', JSON.stringify(verifyData));

  // Check that the bill is now marked PAID in database
  const finalCheckRes = await fetch(`${API_BASE}/bills`);
  const finalBills = await finalCheckRes.json();
  const finalBill = finalBills.bills?.find((b: any) => b.id === targetBillId);
  assert(finalBill?.status === 'paid', 'Test G: Bill status updated to paid in canonical DB', `Status: ${finalBill?.status}`);
  assert(finalBill?.balanceDue === 0, 'Test G: Balance due updated to 0 in canonical DB', `BalanceDue: ${finalBill?.balanceDue}`);

  // -------------------------------------------------------------
  // Test Concurrency: Race-condition duplicate prevention
  // -------------------------------------------------------------
  console.log('\n--- Test Concurrent Requests: Race-Condition Protection ---');
  const concurrentPatient = 'Rahul';
  const concurrentDesc = `Concurrency Test ${Date.now()}`;
  const makeReq = () => fetch(`${API_BASE}/bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: `inv-race-${Math.random()}`,
      patientId: 'p-rahul',
      patientName: concurrentPatient,
      date: new Date().toISOString().split('T')[0],
      dueDate: new Date().toISOString().split('T')[0],
      items: [{ id: 'item-race', description: concurrentDesc, quantity: 1, unitPrice: 1000, total: 1000 }],
      total: 1000,
      balanceDue: 1000,
      status: 'unpaid'
    })
  });

  const concurrentResults = await Promise.all([makeReq(), makeReq(), makeReq(), makeReq()]);
  const statuses = concurrentResults.map(r => r.status);
  const successCount = statuses.filter(s => s === 201).length;
  const conflictCount = statuses.filter(s => s === 409).length;

  console.log(`Concurrent statuses: ${statuses.join(', ')}`);
  assert(successCount === 1, 'Concurrent Test: Exactly 1 request succeeded', `Success count: ${successCount}`);
  assert(conflictCount === 3, 'Concurrent Test: All 3 race requests rejected with 409', `Conflict count: ${conflictCount}`);

  console.log('\n====================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
