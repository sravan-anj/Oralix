/**
 * DENTIFLOW APPOINTMENTS & BILLING SYNCHRONIZATION WORKFLOW TEST SUITE
 * 
 * Validates the complete required flow:
 * 1. Patient books an appointment -> persistent in Supabase appointments table.
 * 2. Doctor Dashboard fetches persistent appointment -> opens billing for specific appointment_id.
 * 3. Doctor creates bill -> linked to appointment_id and patient_id in Supabase invoices table.
 * 4. Bill appears in Doctor Dashboard from Supabase.
 * 5. SAME bill appears in Receptionist Dashboard from Supabase using same bill_id (single source of truth).
 * 6. Doctor edits bill -> updates existing bill record in Supabase (UPDATE WHERE id = existing_bill_id).
 * 7. Receptionist Dashboard fetches and displays the updated bill with same bill_id.
 * 8. Refresh simulation -> verify data persists across sessions/refreshes.
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

async function runAppointmentsBillingSyncSuite() {
  console.log('========================================================================');
  console.log('     DENTIFLOW APPOINTMENT & BILLING SYNCHRONIZATION TEST SUITE         ');
  console.log('========================================================================\n');

  const testSuffix = Date.now().toString().slice(-6);
  const testPatientId = `p-test-sync-${testSuffix}`;
  const testPatientName = `Rohan Sharma ${testSuffix}`;
  const testPatientEmail = `rohan.sharma.${testSuffix}@example.com`;
  const testPatientPhone = `+91 98765 ${testSuffix.slice(0, 5)}`;
  const testAppointmentId = `apt-sync-${testSuffix}`;
  const testDoctorId = 'u-doctor';
  const testDoctorName = 'Dr. Ananya Sharma';
  const testDate = new Date().toISOString().split('T')[0];
  const testTime = '10:30 AM';
  const testProcedure = 'Root Canal Therapy & Crown Placement';

  // -------------------------------------------------------------------------
  // STEP 0: Create/login as a patient
  // -------------------------------------------------------------------------
  console.log('--- Step 0: Create/login as a patient ---');
  const patientRes = await supabaseFetch('patients', {
    method: 'POST',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify({
      id: testPatientId,
      name: testPatientName,
      age: 28,
      gender: 'Male',
      email: testPatientEmail,
      phone: testPatientPhone,
      code: `DF-${testSuffix.slice(-4)}`,
      registered_date: testDate,
      balance_due: 0
    })
  });
  const patientData = await patientRes.json().catch(() => null);
  assert(
    patientRes.ok,
    'Step 0: Patient registered and stored persistently in Supabase',
    JSON.stringify(patientData)
  );

  // -------------------------------------------------------------------------
  // STEP 1: Patient books an appointment -> Persist in Supabase
  // -------------------------------------------------------------------------
  console.log('\n--- Step 1: Patient books an appointment persistently in Supabase ---');
  
  const aptPayload = {
    id: testAppointmentId,
    patient_id: testPatientId,
    patient_name: testPatientName,
    patient_email: testPatientEmail,
    patient_phone: testPatientPhone,
    doctor_id: testDoctorId,
    doctor_name: testDoctorName,
    date: testDate,
    time: testTime,
    duration_minutes: 45,
    procedure: testProcedure,
    status: 'confirmed',
    token_number: `#D-${testSuffix.slice(-3)}`,
    notes: 'Patient reports sharp pain in upper right premolar'
  };

  const createAptRes = await fetch(`${API_BASE}/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(aptPayload)
  });

  const createAptData = await createAptRes.json();
  assert(
    createAptRes.status === 201 && createAptData.success === true,
    'Step 1.1: POST /api/appointments returns 201 Created',
    JSON.stringify(createAptData)
  );

  // Directly verify persistence in Supabase PostgreSQL
  const dbAptRes = await supabaseFetch(`appointments?id=eq.${testAppointmentId}&select=*`);
  const dbAptRows = await dbAptRes.json();
  assert(
    Array.isArray(dbAptRows) && dbAptRows.length === 1,
    'Step 1.2: Appointment persistently found in Supabase database',
    `Found rows: ${dbAptRows.length}`
  );

  const savedApt = dbAptRows[0];
  assert(
    savedApt.patient_email === testPatientEmail && savedApt.patient_phone === testPatientPhone,
    'Step 1.3: Appointment preserves patient_email and patient_phone in Supabase',
    `Email: ${savedApt.patient_email}, Phone: ${savedApt.patient_phone}`
  );
  assert(
    savedApt.id === testAppointmentId && savedApt.doctor_id === testDoctorId,
    'Step 1.4: Appointment stores correct ID and doctor_id',
    `ID: ${savedApt.id}, Doctor: ${savedApt.doctor_id}`
  );

  // -------------------------------------------------------------------------
  // STEP 2: Doctor Dashboard fetches appointments from persistent database
  // -------------------------------------------------------------------------
  console.log('\n--- Step 2: Doctor Dashboard fetches appointment from database ---');
  
  const doctorAptsRes = await fetch(`${API_BASE}/appointments`);
  const doctorAptsData = await doctorAptsRes.json();
  assert(
    doctorAptsRes.ok && Array.isArray(doctorAptsData.appointments),
    'Step 2.1: Doctor appointment endpoint returns appointments list',
    `Status: ${doctorAptsRes.status}`
  );

  const foundAptInDoctorList = doctorAptsData.appointments.find((a: any) => a.id === testAppointmentId);
  assert(
    Boolean(foundAptInDoctorList),
    'Step 2.2: Newly booked appointment appears in Doctor appointments without hardcoded mock',
    `Appointment ID found: ${foundAptInDoctorList?.id}`
  );
  assert(
    foundAptInDoctorList?.patientId === testPatientId && foundAptInDoctorList?.patientName === testPatientName,
    'Step 2.3: Doctor appointment retains exact patient_id and patient_name',
    `Patient: ${foundAptInDoctorList?.patientName}`
  );

  // -------------------------------------------------------------------------
  // STEP 3: Doctor opens billing for THAT specific appointment and creates bill
  // -------------------------------------------------------------------------
  console.log('\n--- Step 3: Doctor creates bill for selected appointment_id ---');
  
  const testBillId = `inv-sync-${testSuffix}`;
  const testInvoiceNumber = `DF-INV-${testSuffix}`;
  const billPayload = {
    id: testBillId,
    invoiceNumber: testInvoiceNumber,
    patientId: testPatientId,
    patientName: testPatientName,
    patientCode: `DF-${testSuffix.slice(-4)}`,
    appointmentId: testAppointmentId,
    appointmentDate: testDate,
    appointmentTime: testTime,
    chiefComplaint: 'Tooth pain upon mastication',
    diagnosis: 'Irreversible Pulpitis #15',
    attendingDoctor: testDoctorName,
    date: testDate,
    dueDate: testDate,
    items: [
      { id: 'item-1', description: 'Endodontic RCT Single Canal', quantity: 1, unitPrice: 6500, total: 6500 },
      { id: 'item-2', description: 'Core Build-up with Post', quantity: 1, unitPrice: 2500, total: 2500 }
    ],
    subtotal: 9000,
    tax: 0,
    discount: 500,
    discountType: 'flat',
    discountValue: 500,
    total: 8500,
    totalAmount: 8500,
    netAmount: 8500,
    amountPaid: 2000,
    balanceDue: 6500,
    status: 'partial',
    paymentMethod: 'UPI',
    notes: 'Prescribed Amoxicillin 500mg post-op. Schedule crown prep next week.'
  };

  const createBillRes = await fetch(`${API_BASE}/bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(billPayload)
  });

  const createBillData = await createBillRes.json();
  assert(
    createBillRes.status === 201 && createBillData.success === true,
    'Step 3.1: POST /api/bills creates bill for appointment_id',
    JSON.stringify(createBillData)
  );

  // Verify bill in Supabase invoices table
  const dbBillRes = await supabaseFetch(`invoices?id=eq.${testBillId}&select=*`);
  const dbBillRows = await dbBillRes.json();
  assert(
    Array.isArray(dbBillRows) && dbBillRows.length === 1,
    'Step 3.2: Bill is inserted persistently into Supabase invoices table',
    `Found rows: ${dbBillRows.length}`
  );

  const savedBill = dbBillRows[0];
  assert(
    savedBill.appointment_id === testAppointmentId,
    'Step 3.3: Bill is strictly associated with appointment_id in database',
    `Bill appointment_id: ${savedBill.appointment_id}`
  );
  assert(
    savedBill.patient_id === testPatientId,
    'Step 3.4: Bill is associated with patient_id in database',
    `Bill patient_id: ${savedBill.patient_id}`
  );
  assert(
    Number(savedBill.total_amount) === 8500 && Number(savedBill.balance_due) === 6500,
    'Step 3.5: Bill financial amounts persisted correctly',
    `Total: ${savedBill.total_amount}, Balance: ${savedBill.balance_due}`
  );

  // -------------------------------------------------------------------------
  // STEP 4 & 5: Doctor Dashboard and Receptionist Dashboard reference SAME bill
  // -------------------------------------------------------------------------
  console.log('\n--- Steps 4 & 5: Doctor & Receptionist fetch the SAME persistent bill ---');
  
  // Doctor fetches bills
  const doctorBillsRes = await fetch(`${API_BASE}/bills`);
  const doctorBillsData = await doctorBillsRes.json();
  const doctorBill = doctorBillsData.bills?.find((b: any) => b.id === testBillId);
  assert(
    Boolean(doctorBill),
    'Step 4.1: Bill appears immediately in Doctor Dashboard',
    `Doctor Bill ID: ${doctorBill?.id}`
  );

  // Receptionist fetches bills
  const receptionistBillsRes = await supabaseFetch(`invoices?order=created_at.desc&select=*`);
  const receptionistBills = await receptionistBillsRes.json();
  const receptionistBill = receptionistBills.find((b: any) => b.id === testBillId);
  assert(
    Boolean(receptionistBill),
    'Step 5.1: SAME bill appears in Receptionist Dashboard from Supabase',
    `Receptionist Bill ID: ${receptionistBill?.id}`
  );

  assert(
    doctorBill.id === receptionistBill.id,
    'Step 5.2: Doctor and Receptionist dashboards reference the EXACT SAME bill_id',
    `Doctor ID: ${doctorBill?.id} === Receptionist ID: ${receptionistBill?.id}`
  );

  assert(
    doctorBill.invoiceNumber === receptionistBill.invoice_number,
    'Step 5.3: Doctor and Receptionist dashboards share the same invoice_number',
    `Doctor Invoice #: ${doctorBill?.invoiceNumber} === Receptionist: ${receptionistBill?.invoice_number}`
  );

  assert(
    doctorBill.appointmentId === receptionistBill.appointment_id && doctorBill.appointmentId === testAppointmentId,
    'Step 5.4: Both dashboards share the exact same appointment_id relationship',
    `Appointment ID: ${doctorBill?.appointmentId}`
  );

  // -------------------------------------------------------------------------
  // STEP 6: Doctor edits the bill -> Updates existing record (UPDATE WHERE id)
  // -------------------------------------------------------------------------
  console.log('\n--- Step 6: Doctor edits the bill (In-Place UPDATE, No Duplicate INSERT) ---');
  
  const updatedBillPayload = {
    ...billPayload,
    items: [
      { id: 'item-1', description: 'Endodontic RCT Single Canal', quantity: 1, unitPrice: 6500, total: 6500 },
      { id: 'item-2', description: 'Core Build-up with Post', quantity: 1, unitPrice: 2500, total: 2500 },
      { id: 'item-3', description: 'Zirconia Monolithic Crown (A2)', quantity: 1, unitPrice: 8000, total: 8000 }
    ],
    subtotal: 17000,
    discount: 1000,
    discountType: 'flat',
    discountValue: 1000,
    total: 16000,
    totalAmount: 16000,
    netAmount: 16000,
    amountPaid: 6000,
    balanceDue: 10000,
    status: 'partial',
    notes: 'Added Zirconia crown after shade selection A2. Patient paid 6000 initial advance.'
  };

  const updateRes = await fetch(`${API_BASE}/bills/${testBillId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updatedBillPayload)
  });

  const updateData = await updateRes.json();
  assert(
    updateRes.status === 200 && updateData.success === true,
    'Step 6.1: PUT /api/bills updates existing bill record',
    JSON.stringify(updateData)
  );

  // Verify only ONE bill exists for this ID in Supabase (no duplicate created)
  const allBillsWithIdRes = await supabaseFetch(`invoices?id=eq.${testBillId}&select=*`);
  const allBillsWithId = await allBillsWithIdRes.json();
  assert(
    Array.isArray(allBillsWithId) && allBillsWithId.length === 1,
    'Step 6.2: Exactly ONE database record exists (NO duplicate bill row created)',
    `Count of bills with ID ${testBillId}: ${allBillsWithId.length}`
  );

  const updatedDbBill = allBillsWithId[0];
  assert(
    Number(updatedDbBill.total_amount) === 16000 && Number(updatedDbBill.amount_paid) === 6000,
    'Step 6.3: Database record reflects updated treatment total (16000) and paid (6000)',
    `Total: ${updatedDbBill.total_amount}, Paid: ${updatedDbBill.amount_paid}`
  );

  assert(
    updatedDbBill.notes.includes('Zirconia crown'),
    'Step 6.4: Database record contains updated doctor notes',
    `Notes: ${updatedDbBill.notes}`
  );

  // -------------------------------------------------------------------------
  // STEP 7: Receptionist Dashboard sees the updated version of THAT SAME bill
  // -------------------------------------------------------------------------
  console.log('\n--- Step 7: Receptionist sees updated bill with same bill_id ---');
  
  const receptionistUpdatedRes = await supabaseFetch(`invoices?id=eq.${testBillId}&select=*`);
  const receptionistUpdatedRows = await receptionistUpdatedRes.json();
  const receptionistUpdatedBill = receptionistUpdatedRows[0];

  assert(
    receptionistUpdatedBill.id === testBillId,
    'Step 7.1: Receptionist reads the SAME bill_id after doctor edit',
    `Bill ID: ${receptionistUpdatedBill.id}`
  );

  assert(
    Number(receptionistUpdatedBill.total_amount) === 16000 && Number(receptionistUpdatedBill.balance_due) === 10000,
    'Step 7.2: Receptionist sees updated total fee (16000) and balance due (10000)',
    `Total: ${receptionistUpdatedBill.total_amount}, Balance: ${receptionistUpdatedBill.balance_due}`
  );

  assert(
    Array.isArray(receptionistUpdatedBill.items) && receptionistUpdatedBill.items.length === 3,
    'Step 7.3: Receptionist sees all 3 updated procedure items',
    `Items count: ${receptionistUpdatedBill.items?.length}`
  );

  // -------------------------------------------------------------------------
  // STEP 8: Refresh & Cross-Session Persistence
  // -------------------------------------------------------------------------
  console.log('\n--- Step 8: Verify persistence across simulated page refresh / logout ---');
  
  // Simulate complete fresh load from Supabase PostgreSQL (as StorageService.fetchAllFromSupabase does)
  const [freshAptRes, freshInvRes] = await Promise.all([
    supabaseFetch(`appointments?id=eq.${testAppointmentId}&select=*`),
    supabaseFetch(`invoices?id=eq.${testBillId}&select=*`)
  ]);

  const freshApts = await freshAptRes.json();
  const freshInvs = await freshInvRes.json();

  assert(
    freshApts.length === 1 && freshApts[0].id === testAppointmentId,
    'Step 8.1: Appointment persists after simulated refresh',
    `Appointment ID: ${freshApts[0]?.id}`
  );

  assert(
    freshInvs.length === 1 && freshInvs[0].id === testBillId,
    'Step 8.2: Bill persists after simulated refresh with identical ID',
    `Bill ID: ${freshInvs[0]?.id}`
  );

  assert(
    freshInvs[0].appointment_id === testAppointmentId,
    'Step 8.3: Appointment-to-bill relationship persists across refreshes',
    `Linked Appointment: ${freshInvs[0]?.appointment_id}`
  );

  // -------------------------------------------------------------------------
  // Clean up test records
  // -------------------------------------------------------------------------
  console.log('\n--- Cleaning up test records ---');
  await supabaseFetch(`invoices?id=eq.${testBillId}`, { method: 'DELETE' });
  await supabaseFetch(`appointments?id=eq.${testAppointmentId}`, { method: 'DELETE' });
  await supabaseFetch(`patients?id=eq.${testPatientId}`, { method: 'DELETE' });
  console.log('  Cleaned up test invoice, appointment, and patient.');

  // -------------------------------------------------------------------------
  // Final Results
  // -------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(`WORKFLOW TEST SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAppointmentsBillingSyncSuite().catch(err => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
