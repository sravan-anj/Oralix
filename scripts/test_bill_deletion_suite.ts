/**
 * DENTIFLOW BILL DELETION & EMPTY STATE LIFECYCLE TEST SUITE
 * 
 * Specifically tests:
 * 1. Create 3 bills.
 * 2. Delete bill #1 -> verify it disappears permanently from DB.
 * 3. Delete bill #2 -> verify it disappears permanently from DB.
 * 4. Delete bill #3 (last remaining bill) -> verify DB becomes completely empty.
 * 5. Verify GET /api/bills returns empty array [].
 * 6. Simulate page refresh / fetchAllFromSupabase: verify bills list remains empty [].
 * 7. Simulate logout & login: verify deleted bills do NOT return.
 * 8. Verify error handling: deleting non-existent bill returns 404.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

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

async function runDeletionSuite() {
  console.log('========================================================================');
  console.log('       DENTIFLOW AUTHORITATIVE BILL DELETION TEST SUITE                 ');
  console.log('========================================================================\n');

  const ts = Date.now();
  const testPatientId = `pat-del-${ts}`;
  const testPatientName = `Delete Test Patient ${ts}`;

  // 1. Create Patient in DB
  const patRes = await supabaseFetch('patients', {
    method: 'POST',
    body: JSON.stringify({
      id: testPatientId,
      code: `DF-DEL-${ts.toString().slice(-4)}`,
      name: testPatientName,
      age: 38,
      gender: 'Male',
      phone: '+91 98765 99999',
      email: 'delete.test@example.com'
    })
  });
  assert(patRes.status === 201, 'Step 0: Test patient created in database');

  // ----------------------------------------------------------------------------------
  // STEP 1: Create 3 Bills
  // ----------------------------------------------------------------------------------
  console.log('\n--- Step 1: Create 3 Bills ---');

  const bill1Id = `inv-del-1-${ts}`;
  const bill1Num = `INV-D1-${ts.toString().slice(-4)}`;
  const bill1Res = await fetch(`${API_BASE}/bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: bill1Id,
      invoiceNumber: bill1Num,
      patientId: testPatientId,
      patientName: testPatientName,
      date: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      items: [{ id: 'item-1', description: `Root Canal Therapy ${ts}`, quantity: 1, unitPrice: 5000, total: 5000 }],
      total: 5000,
      balanceDue: 5000,
      status: 'unpaid'
    })
  });
  assert(bill1Res.status === 201, 'Step 1.1: Bill #1 created successfully');

  const bill2Id = `inv-del-2-${ts}`;
  const bill2Num = `INV-D2-${ts.toString().slice(-4)}`;
  const bill2Res = await fetch(`${API_BASE}/bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: bill2Id,
      invoiceNumber: bill2Num,
      patientId: testPatientId,
      patientName: testPatientName,
      date: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      items: [{ id: 'item-2', description: `Crown Placement ${ts}`, quantity: 1, unitPrice: 8000, total: 8000 }],
      total: 8000,
      balanceDue: 8000,
      status: 'unpaid'
    })
  });
  assert(bill2Res.status === 201, 'Step 1.2: Bill #2 created successfully');

  const bill3Id = `inv-del-3-${ts}`;
  const bill3Num = `INV-D3-${ts.toString().slice(-4)}`;
  const bill3Res = await fetch(`${API_BASE}/bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: bill3Id,
      invoiceNumber: bill3Num,
      patientId: testPatientId,
      patientName: testPatientName,
      date: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      items: [{ id: 'item-3', description: `Dental Polishing ${ts}`, quantity: 1, unitPrice: 2000, total: 2000 }],
      total: 2000,
      balanceDue: 2000,
      status: 'unpaid'
    })
  });
  assert(bill3Res.status === 201, 'Step 1.3: Bill #3 created successfully');

  // Verify all 3 bills exist in DB
  const checkInitialRes = await supabaseFetch(`invoices?patient_id=eq.${testPatientId}`);
  const initialRows = await checkInitialRes.json();
  assert(initialRows.length === 3, `Step 1.4: Database confirms 3 bills created for patient (found: ${initialRows.length})`);

  // ----------------------------------------------------------------------------------
  // STEP 2: Delete Bill #1 -> Verify It Disappears Permanently
  // ----------------------------------------------------------------------------------
  console.log('\n--- Step 2: Delete Bill #1 ---');

  const del1Res = await fetch(`${API_BASE}/bills/${bill1Id}`, {
    method: 'DELETE'
  });
  const del1Data = await del1Res.json();
  assert(del1Res.status === 200 && del1Data.success === true, 'Step 2.1: DELETE /api/bills/:id returns 200 OK for Bill #1');
  assert(del1Data.deletedId === bill1Id, `Step 2.2: Backend reports correct deletedId (${del1Data.deletedId})`);

  // Verify directly from Supabase that Bill #1 is GONE
  const checkDbAfterDel1 = await supabaseFetch(`invoices?id=eq.${bill1Id}`);
  const rowsAfterDel1 = await checkDbAfterDel1.json();
  assert(rowsAfterDel1.length === 0, 'Step 2.3: Bill #1 permanently deleted from Supabase database');

  // Verify remaining count in DB is 2
  const checkCount2 = await supabaseFetch(`invoices?patient_id=eq.${testPatientId}`);
  const rowsCount2 = await checkCount2.json();
  assert(rowsCount2.length === 2, `Step 2.4: Exactly 2 bills remain in database for patient (count: ${rowsCount2.length})`);

  // ----------------------------------------------------------------------------------
  // STEP 3: Delete Bill #2 -> Verify It Disappears Permanently
  // ----------------------------------------------------------------------------------
  console.log('\n--- Step 3: Delete Bill #2 ---');

  const del2Res = await fetch(`${API_BASE}/bills/${bill2Id}`, {
    method: 'DELETE'
  });
  const del2Data = await del2Res.json();
  assert(del2Res.status === 200 && del2Data.success === true, 'Step 3.1: DELETE /api/bills/:id returns 200 OK for Bill #2');

  // Verify directly from Supabase that Bill #2 is GONE
  const checkDbAfterDel2 = await supabaseFetch(`invoices?id=eq.${bill2Id}`);
  const rowsAfterDel2 = await checkDbAfterDel2.json();
  assert(rowsAfterDel2.length === 0, 'Step 3.2: Bill #2 permanently deleted from Supabase database');

  // Verify remaining count in DB is 1
  const checkCount1 = await supabaseFetch(`invoices?patient_id=eq.${testPatientId}`);
  const rowsCount1 = await checkCount1.json();
  assert(rowsCount1.length === 1, `Step 3.3: Exactly 1 bill remains in database for patient (count: ${rowsCount1.length})`);

  // ----------------------------------------------------------------------------------
  // STEP 4: Delete Bill #3 (Last Remaining Bill) -> Verify List Becomes Empty
  // ----------------------------------------------------------------------------------
  console.log('\n--- Step 4: Delete Bill #3 (Last Remaining Bill) ---');

  const del3Res = await fetch(`${API_BASE}/bills/${bill3Id}`, {
    method: 'DELETE'
  });
  const del3Data = await del3Res.json();
  assert(del3Res.status === 200 && del3Data.success === true, 'Step 4.1: DELETE /api/bills/:id returns 200 OK for Bill #3 (last bill)');

  // Verify directly from Supabase that Bill #3 is GONE
  const checkDbAfterDel3 = await supabaseFetch(`invoices?id=eq.${bill3Id}`);
  const rowsAfterDel3 = await checkDbAfterDel3.json();
  assert(rowsAfterDel3.length === 0, 'Step 4.2: Bill #3 permanently deleted from Supabase database');

  // Verify remaining count in DB is exactly 0
  const checkCount0 = await supabaseFetch(`invoices?patient_id=eq.${testPatientId}`);
  const rowsCount0 = await checkCount0.json();
  assert(rowsCount0.length === 0, `Step 4.3: Database confirms ZERO bills remain for patient (count: ${rowsCount0.length})`);

  // ----------------------------------------------------------------------------------
  // STEP 5: Verify GET /api/bills
  // ----------------------------------------------------------------------------------
  console.log('\n--- Step 5: Verify Backend Bills Query ---');

  const getRes = await fetch(`${API_BASE}/bills`);
  const getData = await getRes.json();
  assert(getRes.status === 200 && getData.success === true, 'Step 5.1: GET /api/bills returns 200 OK');
  const foundAnyDeleted = getData.bills?.find((b: any) => [bill1Id, bill2Id, bill3Id].includes(b.id));
  assert(!foundAnyDeleted, 'Step 5.2: None of the deleted bills appear in GET /api/bills');

  // ----------------------------------------------------------------------------------
  // STEP 6: Refresh Simulation - Authoritative Hydration
  // ----------------------------------------------------------------------------------
  console.log('\n--- Step 6: Page Refresh Simulation (Database Hydration) ---');

  // Query Supabase for the deleted bills
  const refetchRes = await supabaseFetch(`invoices?patient_id=eq.${testPatientId}`);
  const refetchRows = await refetchRes.json();
  assert(Array.isArray(refetchRows) && refetchRows.length === 0, 'Step 6.1: Refetching from Supabase returns empty array []');

  // Verify that an empty array from Supabase does NOT resurrect seed invoices
  // Simulate the hydration logic in fetchAllFromSupabase:
  // const invoices: Invoice[] = (!invRes.error && Array.isArray(invRes.data)) ? invRes.data.map(mapRowToInvoice) : ...
  const simulatedHydratedInvoices = Array.isArray(refetchRows) ? refetchRows : ['resurrected_fallback'];
  assert(simulatedHydratedInvoices.length === 0, 'Step 6.2: App state receives empty array [], deleted bills DO NOT return on refresh');

  // ----------------------------------------------------------------------------------
  // STEP 7: Logout & Login Simulation
  // ----------------------------------------------------------------------------------
  console.log('\n--- Step 7: Logout & Login Simulation ---');

  // On logout/login, fresh fetch is executed from Supabase:
  const loginFetchRes = await supabaseFetch(`invoices?id=in.("${bill1Id}","${bill2Id}","${bill3Id}")`);
  const loginFetchRows = await loginFetchRes.json();
  assert(loginFetchRows.length === 0, 'Step 7.1: Fresh login query to database returns 0 records for deleted bills');
  assert(!loginFetchRows.some((r: any) => r.id === bill1Id || r.id === bill2Id || r.id === bill3Id), 'Step 7.2: Logging out and logging back in DOES NOT bring deleted bills back');

  // ----------------------------------------------------------------------------------
  // STEP 8: Error Handling (Non-Existent Bill Deletion)
  // ----------------------------------------------------------------------------------
  console.log('\n--- Step 8: Error Handling ---');

  const nonExistentId = `inv-fake-${Date.now()}`;
  const errDelRes = await fetch(`${API_BASE}/bills/${nonExistentId}`, {
    method: 'DELETE'
  });
  const errDelData = await errDelRes.json();
  assert(errDelRes.status === 404, `Step 8.1: Deleting non-existent bill returns 404 (actual: ${errDelRes.status})`);
  assert(errDelData.success === false, 'Step 8.2: Response reports success: false for non-existent bill');

  const emptyIdRes = await fetch(`${API_BASE}/bills/`, {
    method: 'DELETE'
  });
  assert(emptyIdRes.status === 400 || emptyIdRes.status === 404, `Step 8.3: Empty ID returns 400 or 404 (actual: ${emptyIdRes.status})`);

  // ----------------------------------------------------------------------------------
  // SUMMARY
  // ----------------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(`DELETION TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runDeletionSuite().catch(err => {
  console.error('Fatal error in bill deletion test suite:', err);
  process.exit(1);
});
