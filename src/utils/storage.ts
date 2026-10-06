import { supabase } from './supabaseClient';
import {
  Patient,
  ToothFinding,
  Appointment,
  QueueItem,
  TreatmentPlan,
  ClinicalNote,
  Prescription,
  Invoice,
  InventoryItem,
  StaffMember,
  User,
  FinancingRequest,
  PaymentTransaction,
  TreatmentCatalogueItem
} from '../types';
import {
  INITIAL_USERS,
  INITIAL_PATIENTS,
  INITIAL_TOOTH_FINDINGS,
  INITIAL_APPOINTMENTS,
  INITIAL_QUEUE,
  INITIAL_TREATMENT_PLANS,
  INITIAL_CLINICAL_NOTES,
  INITIAL_PRESCRIPTIONS,
  INITIAL_INVOICES,
  INITIAL_INVENTORY,
  INITIAL_STAFF,
  INITIAL_TREATMENT_CATALOGUE
} from '../data/seedData';
import { mapProfileToUser } from './authService';

export const STORAGE_KEYS = {
  CURRENT_USER: 'dentiflow_current_user_v2',
  USERS: 'dentiflow_users_v2',
  PATIENTS: 'dentiflow_patients_v2',
  TOOTH_FINDINGS: 'dentiflow_tooth_findings_v2',
  APPOINTMENTS: 'dentiflow_appointments_v2',
  QUEUE: 'dentiflow_queue_v2',
  TREATMENT_PLANS: 'dentiflow_treatment_plans_v2',
  CLINICAL_NOTES: 'dentiflow_clinical_notes_v2',
  PRESCRIPTIONS: 'dentiflow_prescriptions_v2',
  INVOICES: 'dentiflow_invoices_v3',
  INVENTORY: 'dentiflow_inventory_v2',
  STAFF: 'dentiflow_staff_v2',
  FINANCING_REQUESTS: 'dentiflow_financing_requests_v2',
  TRANSACTIONS: 'dentiflow_transactions_v2',
  TREATMENT_CATALOGUE: 'dentiflow_treatment_catalogue_v2',
  CONSULTATION_FEE: 'dentiflow_consultation_fee_v1'
};

// Purge obsolete invoice cache
try {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('dentiflow_invoices_v2');
    localStorage.removeItem('dentiflow_invoices_v1');
  }
} catch (e) {}

function safeGet<T>(key: string, fallback: T): T {
  try {
    const item = localStorage.getItem(key);
    if (!item) return fallback;
    return JSON.parse(item) as T;
  } catch (err) {
    return fallback;
  }
}

function safeSet<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {}
}

export const mapRowToInvoice = (i: any): Invoice => {
  const total = Number(i.total_amount ?? i.total ?? 0);
  const amountPaid = Number(i.amount_paid ?? 0);
  const balanceDue = Number(
    i.balance_due !== undefined && i.balance_due !== null
      ? i.balance_due
      : Math.max(0, total - amountPaid)
  );

  return {
    id: i.id,
    invoiceNumber: i.invoice_number,
    patientId: i.patient_id,
    patientName: i.patient_name,
    patientCode: i.patient_code || undefined,
    patientAge: i.patient_age !== undefined && i.patient_age !== null ? Number(i.patient_age) : undefined,
    patientGender: i.patient_gender || undefined,
    patientEmail: i.patient_email || undefined,
    patientPhone: i.patient_phone || undefined,
    date: i.date ? String(i.date).split('T')[0] : new Date().toISOString().split('T')[0],
    dueDate: i.due_date ? String(i.due_date).split('T')[0] : new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
    items: Array.isArray(i.items) ? i.items : [],
    description: i.description || undefined,
    diagnosis: i.diagnosis || undefined,
    attendingDoctor: i.attending_doctor || undefined,
    appointmentId: i.appointment_id || undefined,
    appointmentDate: i.appointment_date || undefined,
    appointmentTime: i.appointment_time || undefined,
    chiefComplaint: i.chief_complaint || undefined,
    subtotal: i.subtotal !== undefined && i.subtotal !== null ? Number(i.subtotal) : undefined,
    tax: i.tax !== undefined && i.tax !== null ? Number(i.tax) : 0,
    discount: i.discount !== undefined && i.discount !== null ? Number(i.discount) : 0,
    discountType: i.discount_type || undefined,
    discountValue: i.discount_value !== undefined && i.discount_value !== null ? Number(i.discount_value) : undefined,
    netAmount: i.net_amount !== undefined && i.net_amount !== null ? Number(i.net_amount) : total,
    total: total,
    totalAmount: total,
    amountPaid: amountPaid,
    balanceDue: balanceDue,
    status: i.status || (balanceDue <= 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid'),
    paymentMethod: i.payment_method || undefined,
    paymentStatus: i.payment_status || (i.status === 'paid' ? 'verified' : 'pending'),
    razorpayPaymentId: i.razorpay_payment_id || undefined,
    razorpayOrderId: i.razorpay_order_id || undefined,
    paymentVerifiedAt: i.payment_verified_at || undefined,
    receiptEmailStatus: i.receipt_email_status || undefined,
    receiptEmailSentAt: i.receipt_email_sent_at || undefined,
    receiptEmailError: i.receipt_email_error || undefined,
    receiptPdfGeneratedAt: i.receipt_pdf_generated_at || undefined,
    sentToReceptionist: i.sent_to_receptionist ?? true,
    isDraft: i.is_draft ?? false
  };
};

export const mapRowToAppointment = (a: any): Appointment => ({
  id: a.id,
  patientId: a.patient_id,
  patientName: a.patient_name,
  doctorName: a.doctor_name,
  doctorId: a.doctor_id || 'u-doctor',
  chair: a.chair,
  date: a.date ? String(a.date).split('T')[0] : new Date().toISOString().split('T')[0],
  time: a.time,
  durationMinutes: a.duration_minutes || 30,
  procedure: a.procedure,
  status: a.status,
  notes: a.notes || null,
  tokenNumber: a.token_number || null,
  patientEmail: a.patient_email || undefined,
  patientPhone: a.patient_phone || undefined
});

export const mapInvoiceToRow = (i: Invoice): any => {
  const total = Number(i.totalAmount ?? i.total ?? 0);
  const amountPaid = Number(i.amountPaid ?? 0);
  const balanceDue = Number(
    i.balanceDue !== undefined && i.balanceDue !== null
      ? i.balanceDue
      : Math.max(0, total - amountPaid)
  );
  const cleanDate = (i.date ? String(i.date).split('T')[0] : new Date().toISOString().split('T')[0]);
  const cleanDueDate = (i.dueDate ? String(i.dueDate).split('T')[0] : new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]);

  return {
    id: i.id,
    invoice_number: i.invoiceNumber,
    patient_id: i.patientId,
    patient_name: i.patientName,
    patient_code: i.patientCode || null,
    patient_age: i.patientAge !== undefined && i.patientAge !== null ? Number(i.patientAge) : null,
    patient_gender: i.patientGender || null,
    patient_email: i.patientEmail || null,
    patient_phone: i.patientPhone || null,
    date: cleanDate,
    due_date: cleanDueDate,
    items: i.items || [],
    description: i.description || (Array.isArray(i.items) && i.items[0]?.description) || null,
    diagnosis: i.diagnosis || null,
    attending_doctor: i.attendingDoctor || null,
    appointment_id: i.appointmentId || null,
    appointment_date: i.appointmentDate || null,
    appointment_time: i.appointmentTime || null,
    chief_complaint: i.chiefComplaint || null,
    subtotal: i.subtotal !== undefined && i.subtotal !== null ? Number(i.subtotal) : null,
    tax: i.tax !== undefined && i.tax !== null ? Number(i.tax) : 0,
    discount: i.discount !== undefined && i.discount !== null ? Number(i.discount) : 0,
    discount_type: i.discountType || null,
    discount_value: i.discountValue !== undefined && i.discountValue !== null ? Number(i.discountValue) : null,
    net_amount: i.netAmount !== undefined && i.netAmount !== null ? Number(i.netAmount) : total,
    total: total,
    total_amount: total,
    amount_paid: amountPaid,
    balance_due: balanceDue,
    status: i.status || (balanceDue <= 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid'),
    payment_method: i.paymentMethod || null,
    payment_status: i.paymentStatus || (i.status === 'paid' ? 'verified' : 'pending'),
    razorpay_payment_id: i.razorpayPaymentId || null,
    razorpay_order_id: i.razorpayOrderId || null,
    payment_verified_at: i.paymentVerifiedAt || null,
    receipt_email_status: i.receiptEmailStatus || null,
    receipt_email_sent_at: i.receiptEmailSentAt || null,
    receipt_email_error: i.receiptEmailError || null,
    receipt_pdf_generated_at: i.receiptPdfGeneratedAt || null,
    sent_to_receptionist: i.sentToReceptionist ?? true,
    is_draft: i.isDraft ?? false,
    updated_at: new Date().toISOString()
  };
};

/**
 * StorageService: High-performance data layer connecting Dentiflow to Supabase PostgreSQL.
 * Provides instant optimistic local caching while synchronizing all mutations to Supabase.
 */
export const StorageService = {
  // -------------------------------------------------------------
  // Bulk Fetch from Supabase PostgreSQL
  // -------------------------------------------------------------
  fetchAllFromSupabase: async (): Promise<{
    patients: Patient[];
    appointments: Appointment[];
    toothFindings: ToothFinding[];
    treatmentPlans: TreatmentPlan[];
    clinicalNotes: ClinicalNote[];
    invoices: Invoice[];
    inventory: InventoryItem[];
    staff: StaffMember[];
    queue: QueueItem[];
    users: User[];
  }> => {
    try {
      const [
        pRes,
        aptRes,
        tfRes,
        planRes,
        cnRes,
        invRes,
        itemRes,
        staffRes,
        qRes,
        uRes
      ] = await Promise.all([
        supabase.from('patients').select('*'),
        supabase.from('appointments').select('*').order('date', { ascending: true }),
        supabase.from('tooth_findings').select('*'),
        supabase.from('treatment_plans').select('*'),
        supabase.from('clinical_notes').select('*'),
        supabase.from('invoices').select('*'),
        supabase.from('inventory').select('*'),
        supabase.from('staff').select('*'),
        supabase.from('queue').select('*'),
        supabase.from('profiles').select('*')
      ]);

      const patients: Patient[] = (pRes.data && pRes.data.length > 0)
        ? pRes.data.map((p: any) => ({
            id: p.id,
            code: p.code,
            name: p.name,
            age: p.age,
            gender: p.gender,
            phone: p.phone,
            email: p.email || '',
            address: p.address,
            emergencyContact: p.emergency_contact,
            bloodGroup: p.blood_group,
            medicalAlerts: p.medical_alerts || [],
            dentalHistorySummary: p.dental_history_summary,
            insuranceProvider: p.insurance_provider,
            insurancePolicyNumber: p.insurance_policy_number,
            balanceDue: Number(p.balance_due) || 0,
            lastVisitDate: p.last_visit_date,
            nextAppointmentDate: p.next_appointment_date,
            registeredDate: p.registered_date,
            avatarBg: p.avatar_bg
          }))
        : StorageService.getPatients();

      const appointments: Appointment[] = (aptRes.data && aptRes.data.length > 0)
        ? aptRes.data.map((a: any) => ({
            id: a.id,
            patientId: a.patient_id,
            patientName: a.patient_name,
            doctorName: a.doctor_name,
            doctorId: a.doctor_id || 'u-doctor',
            chair: a.chair,
            date: a.date,
            time: a.time,
            durationMinutes: a.duration_minutes || 30,
            procedure: a.procedure,
            status: a.status,
            notes: a.notes,
            tokenNumber: a.token_number,
            patientEmail: a.patient_email || undefined,
            patientPhone: a.patient_phone || undefined
          }))
        : StorageService.getAppointments();

      const toothFindings: ToothFinding[] = (tfRes.data && tfRes.data.length > 0)
        ? tfRes.data.map((tf: any) => ({
            id: tf.id,
            patientId: tf.patient_id,
            toothNumber: tf.tooth_number,
            universalNumber: tf.universal_number,
            condition: tf.condition,
            surfaces: tf.surfaces || [],
            diagnosis: tf.diagnosis,
            recommendedTreatment: tf.recommended_treatment,
            estimatedCost: Number(tf.estimated_cost) || 0,
            doctorName: tf.doctor_name,
            date: tf.date,
            notes: tf.notes
          }))
        : StorageService.getToothFindings();

      const treatmentPlans: TreatmentPlan[] = (planRes.data && planRes.data.length > 0)
        ? planRes.data.map((tp: any) => ({
            id: tp.id,
            patientId: tp.patient_id,
            patientName: tp.patient_name,
            doctorName: tp.doctor_name,
            dateCreated: tp.date_created,
            status: tp.status,
            title: tp.title,
            phase: tp.phase,
            totalCost: Number(tp.total_cost) || 0,
            discount: Number(tp.discount) || 0,
            insuranceCovered: Number(tp.insurance_covered) || 0,
            patientPortion: Number(tp.patient_portion) || 0,
            procedures: tp.procedures || [],
            notes: tp.notes
          }))
        : StorageService.getTreatmentPlans();

      const clinicalNotes: ClinicalNote[] = (cnRes.data && cnRes.data.length > 0)
        ? cnRes.data.map((cn: any) => ({
            id: cn.id,
            patientId: cn.patient_id,
            patientName: cn.patient_name,
            doctorName: cn.doctor_name,
            date: cn.date,
            chiefComplaint: cn.chief_complaint,
            subjective: cn.subjective,
            objective: cn.objective,
            assessment: cn.assessment,
            plan: cn.plan,
            vitals: cn.vitals || {},
            toothNumbers: cn.tooth_numbers || [],
            toothNumber: cn.tooth_number,
            signed: cn.signed,
            isSigned: cn.is_signed,
            signatureDate: cn.signature_date,
            prescriptions: cn.prescriptions || []
          }))
        : StorageService.getClinicalNotes();

      // Authoritative database invoices: Supabase is the source of truth
      // If invRes returned data (even if an empty array []), that is the exact list of bills.
      // Never merge with stale cache and never resurrect deleted bills.
      const invoices: Invoice[] = (!invRes.error && Array.isArray(invRes.data))
        ? invRes.data.map(mapRowToInvoice)
        : StorageService.getInvoices();

      const inventory: InventoryItem[] = (itemRes.data && itemRes.data.length > 0)
        ? itemRes.data.map((item: any) => ({
            id: item.id,
            name: item.name,
            category: item.category,
            brand: item.brand,
            sku: item.sku,
            currentStock: item.current_stock,
            minThreshold: item.min_threshold,
            unit: item.unit,
            costPerUnit: Number(item.cost_per_unit) || 0,
            supplier: item.supplier,
            expiryDate: item.expiry_date,
            lastRestocked: item.last_restocked,
            location: item.location,
            status: item.status
          }))
        : StorageService.getInventory();

      const staff: StaffMember[] = (staffRes.data && staffRes.data.length > 0)
        ? staffRes.data.map((s: any) => ({
            id: s.id,
            name: s.name,
            role: s.role,
            specialization: s.specialization,
            registrationNumber: s.registration_number,
            assignedChair: s.assigned_chair,
            availability: s.availability,
            email: s.email,
            phone: s.phone,
            activePatientsToday: s.active_patients_today,
            avatarText: s.avatar_text,
            status: s.status
          }))
        : StorageService.getStaff();

      const queue: QueueItem[] = (qRes.data && qRes.data.length > 0)
        ? qRes.data.map((q: any) => ({
            id: q.id,
            tokenNumber: q.token_number,
            patientId: q.patient_id,
            patientName: q.patient_name,
            patientPhone: q.patient_phone,
            doctorName: q.doctor_name,
            chair: q.chair,
            checkInTime: q.check_in_time,
            status: q.status,
            estimatedWaitMinutes: q.estimated_wait_minutes,
            procedure: q.procedure
          }))
        : StorageService.getQueue();

      const users: User[] = (uRes.data && uRes.data.length > 0)
        ? uRes.data.map(mapProfileToUser)
        : StorageService.getUsers();

      // Synchronize to cache for offline/instant initial renders
      safeSet(STORAGE_KEYS.PATIENTS, patients);
      safeSet(STORAGE_KEYS.APPOINTMENTS, appointments);
      safeSet(STORAGE_KEYS.TOOTH_FINDINGS, toothFindings);
      safeSet(STORAGE_KEYS.TREATMENT_PLANS, treatmentPlans);
      safeSet(STORAGE_KEYS.CLINICAL_NOTES, clinicalNotes);
      safeSet(STORAGE_KEYS.INVOICES, invoices);
      safeSet(STORAGE_KEYS.INVENTORY, inventory);
      safeSet(STORAGE_KEYS.STAFF, staff);
      safeSet(STORAGE_KEYS.QUEUE, queue);
      safeSet(STORAGE_KEYS.USERS, users);

      return {
        patients,
        appointments,
        toothFindings,
        treatmentPlans,
        clinicalNotes,
        invoices,
        inventory,
        staff,
        queue,
        users
      };
    } catch (err) {
      console.error('Failed to fetch datasets from Supabase, using cache fallback', err);
      return {
        patients: StorageService.getPatients(),
        appointments: StorageService.getAppointments(),
        toothFindings: StorageService.getToothFindings(),
        treatmentPlans: StorageService.getTreatmentPlans(),
        clinicalNotes: StorageService.getClinicalNotes(),
        invoices: StorageService.getInvoices(),
        inventory: StorageService.getInventory(),
        staff: StorageService.getStaff(),
        queue: StorageService.getQueue(),
        users: StorageService.getUsers()
      };
    }
  },

  // -------------------------------------------------------------
  // Users & Current Session
  // -------------------------------------------------------------
  getUsers: (): User[] => safeGet<User[]>(STORAGE_KEYS.USERS, INITIAL_USERS),

  saveUsers: (users: User[]): void => safeSet(STORAGE_KEYS.USERS, users),

  updateUser: (updatedUser: User): void => {
    const users = StorageService.getUsers();
    const index = users.findIndex(u => u.id === updatedUser.id);
    let updatedList: User[];
    if (index >= 0) {
      updatedList = [...users];
      updatedList[index] = updatedUser;
    } else {
      updatedList = [...users, updatedUser];
    }
    safeSet(STORAGE_KEYS.USERS, updatedList);

    // Sync to Supabase profiles
    supabase.from('profiles').upsert({
      id: updatedUser.id,
      oralix_id: updatedUser.oralixId,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role,
      avatar_text: updatedUser.avatarText,
      phone: updatedUser.phone,
      specialization: updatedUser.specialization,
      patient_id: updatedUser.patientId,
      department: updatedUser.department,
      license_number: updatedUser.licenseNumber,
      bio: updatedUser.bio,
      status: updatedUser.status || 'active',
      address: updatedUser.address,
      emergency_contact: updatedUser.emergencyContact
    }).then();

    const current = StorageService.getCurrentUser();
    if (current && current.id === updatedUser.id) {
      safeSet(STORAGE_KEYS.CURRENT_USER, updatedUser);
    }
  },

  getCurrentUser: (): User | null => safeGet<User | null>(STORAGE_KEYS.CURRENT_USER, null),
  setCurrentUser: (user: User | null): void => safeSet(STORAGE_KEYS.CURRENT_USER, user),
  saveCurrentUser: (user: User | null): void => safeSet(STORAGE_KEYS.CURRENT_USER, user),
  clearCurrentUser: (): void => {
    localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
    supabase.auth.signOut().catch(() => {});
  },

  // -------------------------------------------------------------
  // Patients
  // -------------------------------------------------------------
  getPatients: (): Patient[] => safeGet<Patient[]>(STORAGE_KEYS.PATIENTS, INITIAL_PATIENTS),

  savePatients: (patients: Patient[]): void => {
    safeSet(STORAGE_KEYS.PATIENTS, patients);
    // Asynchronously upsert to Supabase
    const rows = patients.map(p => ({
      id: p.id,
      code: p.code,
      name: p.name,
      age: p.age,
      gender: p.gender,
      phone: p.phone,
      email: p.email,
      address: p.address,
      emergency_contact: p.emergencyContact,
      blood_group: p.bloodGroup,
      medical_alerts: p.medicalAlerts || [],
      dental_history_summary: p.dentalHistorySummary,
      insurance_provider: p.insuranceProvider,
      insurance_policy_number: p.insurancePolicyNumber,
      balance_due: p.balanceDue,
      last_visit_date: p.lastVisitDate,
      next_appointment_date: p.nextAppointmentDate,
      registered_date: p.registeredDate,
      avatar_bg: p.avatarBg
    }));
    supabase.from('patients').upsert(rows).then();
  },

  updatePatient: (patient: Patient): void => {
    const list = StorageService.getPatients();
    const updated = list.map(p => (p.id === patient.id ? patient : p));
    StorageService.savePatients(updated);
  },

  // -------------------------------------------------------------
  // Appointments
  // -------------------------------------------------------------
  getAppointments: (): Appointment[] => safeGet<Appointment[]>(STORAGE_KEYS.APPOINTMENTS, INITIAL_APPOINTMENTS),

  safeSetAppointments: (appointments: Appointment[]): void => {
    safeSet(STORAGE_KEYS.APPOINTMENTS, appointments);
  },

  saveAppointments: (appointments: Appointment[]): void => {
    safeSet(STORAGE_KEYS.APPOINTMENTS, appointments);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dentiflow:appointments-updated', { detail: appointments }));
    }
    const rows = appointments.map(a => ({
      id: a.id,
      patient_id: a.patientId,
      patient_name: a.patientName,
      doctor_name: a.doctorName,
      doctor_id: a.doctorId || 'u-doctor',
      chair: a.chair,
      date: a.date,
      time: a.time,
      duration_minutes: a.durationMinutes || 30,
      procedure: a.procedure,
      status: a.status,
      notes: a.notes || null,
      token_number: a.tokenNumber || null,
      patient_email: a.patientEmail || null,
      patient_phone: a.patientPhone || null
    }));
    supabase.from('appointments').upsert(rows).then(({ error }) => {
      if (error) console.error('[storage] Error syncing appointments to Supabase:', error);
    });
  },

  addAppointment: async (appointment: Appointment): Promise<Appointment> => {
    const existing = StorageService.getAppointments();

    const row = {
      id: appointment.id,
      patient_id: appointment.patientId,
      patient_name: appointment.patientName,
      doctor_name: appointment.doctorName,
      doctor_id: appointment.doctorId || 'u-doctor',
      chair: appointment.chair,
      date: appointment.date,
      time: appointment.time,
      duration_minutes: appointment.durationMinutes || 30,
      procedure: appointment.procedure,
      status: appointment.status,
      notes: appointment.notes || null,
      token_number: appointment.tokenNumber || null,
      patient_email: appointment.patientEmail || null,
      patient_phone: appointment.patientPhone || null
    };

    // 1. Try server backend endpoint
    try {
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(row)
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.appointment) {
          const canonical = data.appointment;
          const merged = [canonical, ...existing.filter(a => a.id !== canonical.id)];
          safeSet(STORAGE_KEYS.APPOINTMENTS, merged);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('dentiflow:appointments-updated', { detail: merged }));
          }
          return canonical;
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        if (errData?.error) {
          throw new Error(errData.error);
        }
      }
    } catch (apiErr: any) {
      if (apiErr?.message && !apiErr.message.includes('fetch')) {
        throw apiErr;
      }
    }

    // 2. Direct Supabase insert fallback (with duplicate checks)
    const cleanEmail = (appointment.patientEmail || '').trim().toLowerCase();
    const cleanPhoneDigits = (appointment.patientPhone || '').replace(/\D/g, '').slice(-10);

    if (cleanEmail || cleanPhoneDigits) {
      const { data: existingApts } = await supabase
        .from('appointments')
        .select('id, patient_email, patient_phone');
      if (Array.isArray(existingApts)) {
        const duplicateFound = existingApts.find(a => {
          if (a.id === appointment.id) return false;
          const aEmail = (a.patient_email || '').trim().toLowerCase();
          const aPhoneDigits = (a.patient_phone || '').replace(/\D/g, '').slice(-10);
          return Boolean(
            (cleanEmail && aEmail && aEmail === cleanEmail) ||
            (cleanPhoneDigits && aPhoneDigits && aPhoneDigits === cleanPhoneDigits)
          );
        });
        if (duplicateFound) {
          throw new Error('Appointment Already Booked: An appointment already exists for this email address or phone number. Please check your existing appointment instead of booking again.');
        }
      }
    }

    const { data, error } = await supabase.from('appointments').insert(row).select().single();
    if (error) {
      const errMsg = (error.message || error.details || '').toLowerCase();
      if (
        error.code === '23505' ||
        errMsg.includes('appointment already booked') ||
        errMsg.includes('already exists for this email') ||
        errMsg.includes('idx_appointments_patient_')
      ) {
        throw new Error('Appointment Already Booked: An appointment already exists for this email address or phone number. Please check your existing appointment instead of booking again.');
      }
      if (errMsg.includes('already been booked for this date and time') || errMsg.includes('idx_appointments_date_time_unique')) {
        throw new Error('This appointment slot has already been booked for this date and time.');
      }
      throw new Error(error.message || 'Failed to save appointment to database.');
    }

    const canonical: Appointment = {
      ...appointment,
      id: data ? data.id : appointment.id,
      patientEmail: data?.patient_email || appointment.patientEmail,
      patientPhone: data?.patient_phone || appointment.patientPhone
    };
    const merged = [canonical, ...existing.filter(a => a.id !== canonical.id)];
    safeSet(STORAGE_KEYS.APPOINTMENTS, merged);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dentiflow:appointments-updated', { detail: merged }));
    }
    return canonical;
  },

  deleteAppointmentAndPatient: async (appointmentId: string, patientId?: string): Promise<{ success: boolean }> => {
    // 1. Try server backend endpoint
    try {
      await fetch(`/api/appointments/${encodeURIComponent(appointmentId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId })
      });
    } catch (_) {}

    // 2. Authoritative Supabase stored procedure or direct delete
    try {
      const { error: rpcError } = await supabase.rpc('delete_appointment_and_patient', {
        p_appointment_id: appointmentId,
        p_patient_id: patientId || null
      });
      if (rpcError) {
        await supabase.from('invoices').delete().eq('appointment_id', appointmentId);
        await supabase.from('appointments').delete().eq('id', appointmentId);
        if (patientId) {
          await supabase.from('patients').delete().eq('id', patientId);
        }
      }
    } catch (dbErr) {
      console.warn('[storage] DB delete fallback:', dbErr);
    }

    // 3. Update local storage & broadcast changes
    const remainingApts = StorageService.getAppointments().filter(a => a.id !== appointmentId);
    safeSet(STORAGE_KEYS.APPOINTMENTS, remainingApts);

    if (patientId) {
      const remainingPatients = StorageService.getPatients().filter(p => p.id !== patientId);
      safeSet(STORAGE_KEYS.PATIENTS, remainingPatients);

      const remainingQueue = StorageService.getQueue().filter(q => q.patientId !== patientId);
      safeSet(STORAGE_KEYS.QUEUE, remainingQueue);

      const remainingInvoices = StorageService.getInvoices().filter(
        i => i.patientId !== patientId && i.appointmentId !== appointmentId
      );
      safeSet(STORAGE_KEYS.INVOICES, remainingInvoices);

      const remainingFindings = StorageService.getToothFindings().filter(f => f.patientId !== patientId);
      safeSet(STORAGE_KEYS.TOOTH_FINDINGS, remainingFindings);

      const remainingPlans = StorageService.getTreatmentPlans().filter(tp => tp.patientId !== patientId);
      safeSet(STORAGE_KEYS.TREATMENT_PLANS, remainingPlans);

      const remainingNotes = StorageService.getClinicalNotes().filter(cn => cn.patientId !== patientId);
      safeSet(STORAGE_KEYS.CLINICAL_NOTES, remainingNotes);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dentiflow:appointments-updated', { detail: remainingApts }));
      if (patientId) {
        window.dispatchEvent(new CustomEvent('dentiflow:patients-updated', { detail: StorageService.getPatients() }));
        window.dispatchEvent(new CustomEvent('dentiflow:queue-updated', { detail: StorageService.getQueue() }));
        window.dispatchEvent(new CustomEvent('dentiflow:invoices-updated', { detail: StorageService.getInvoices() }));
      }
    }

    return { success: true };
  },

  // -------------------------------------------------------------
  // Tooth Findings
  // -------------------------------------------------------------
  getToothFindings: (): ToothFinding[] => safeGet<ToothFinding[]>(STORAGE_KEYS.TOOTH_FINDINGS, INITIAL_TOOTH_FINDINGS),

  saveToothFindings: (findings: ToothFinding[]): void => {
    safeSet(STORAGE_KEYS.TOOTH_FINDINGS, findings);
    const rows = findings.map(tf => ({
      id: tf.id,
      patient_id: tf.patientId,
      tooth_number: tf.toothNumber,
      universal_number: tf.universalNumber,
      condition: tf.condition,
      surfaces: tf.surfaces || [],
      diagnosis: tf.diagnosis,
      recommended_treatment: tf.recommendedTreatment,
      estimated_cost: tf.estimatedCost,
      doctor_name: tf.doctorName,
      date: tf.date,
      notes: tf.notes
    }));
    supabase.from('tooth_findings').upsert(rows).then();
  },

  // -------------------------------------------------------------
  // Queue
  // -------------------------------------------------------------
  getQueue: (): QueueItem[] => safeGet<QueueItem[]>(STORAGE_KEYS.QUEUE, INITIAL_QUEUE),

  saveQueue: (queue: QueueItem[]): void => {
    safeSet(STORAGE_KEYS.QUEUE, queue);
    const rows = queue.map(q => ({
      id: q.id,
      token_number: q.tokenNumber,
      patient_id: q.patientId,
      patient_name: q.patientName,
      patient_phone: q.patientPhone,
      doctor_name: q.doctorName,
      chair: q.chair,
      check_in_time: q.checkInTime,
      status: q.status,
      estimated_wait_minutes: q.estimatedWaitMinutes,
      procedure: q.procedure
    }));
    supabase.from('queue').upsert(rows).then();
  },

  // -------------------------------------------------------------
  // Treatment Plans
  // -------------------------------------------------------------
  getTreatmentPlans: (): TreatmentPlan[] => safeGet<TreatmentPlan[]>(STORAGE_KEYS.TREATMENT_PLANS, INITIAL_TREATMENT_PLANS),

  saveTreatmentPlans: (plans: TreatmentPlan[]): void => {
    safeSet(STORAGE_KEYS.TREATMENT_PLANS, plans);
    const rows = plans.map(tp => ({
      id: tp.id,
      patient_id: tp.patientId,
      patient_name: tp.patientName,
      doctor_name: tp.doctorName,
      date_created: tp.dateCreated,
      status: tp.status,
      title: tp.title,
      phase: tp.phase,
      total_cost: tp.totalCost,
      discount: tp.discount,
      insurance_covered: tp.insuranceCovered,
      patient_portion: tp.patientPortion,
      procedures: tp.procedures || [],
      notes: tp.notes
    }));
    supabase.from('treatment_plans').upsert(rows).then();
  },

  // -------------------------------------------------------------
  // Master Treatment Catalogue
  // -------------------------------------------------------------
  getTreatmentCatalogue: (): TreatmentCatalogueItem[] =>
    safeGet<TreatmentCatalogueItem[]>(STORAGE_KEYS.TREATMENT_CATALOGUE, INITIAL_TREATMENT_CATALOGUE),

  saveTreatmentCatalogue: (items: TreatmentCatalogueItem[]): void => {
    safeSet(STORAGE_KEYS.TREATMENT_CATALOGUE, items);
    const rows = items.map(item => ({
      id: item.id,
      name: item.name,
      price: item.price,
      category: item.category || 'General',
      description: item.description || '',
      code: item.code || '',
      updated_at: new Date().toISOString()
    }));
    supabase.from('treatment_catalogue').upsert(rows).then();
  },

  getConsultationFee: (): number => safeGet<number>(STORAGE_KEYS.CONSULTATION_FEE, 500),

  saveConsultationFee: (fee: number): void => {
    safeSet(STORAGE_KEYS.CONSULTATION_FEE, Math.max(0, Math.round(fee)));
  },

  // -------------------------------------------------------------
  // Clinical Notes
  // -------------------------------------------------------------
  getClinicalNotes: (): ClinicalNote[] => safeGet<ClinicalNote[]>(STORAGE_KEYS.CLINICAL_NOTES, INITIAL_CLINICAL_NOTES),

  saveClinicalNotes: (notes: ClinicalNote[]): void => {
    safeSet(STORAGE_KEYS.CLINICAL_NOTES, notes);
    const rows = notes.map(cn => ({
      id: cn.id,
      patient_id: cn.patientId,
      patient_name: cn.patientName,
      doctor_name: cn.doctorName,
      date: cn.date,
      chief_complaint: cn.chiefComplaint,
      subjective: cn.subjective,
      objective: cn.objective,
      assessment: cn.assessment,
      plan: cn.plan,
      vitals: cn.vitals || {},
      tooth_numbers: cn.toothNumbers || [],
      tooth_number: cn.toothNumber,
      signed: cn.signed,
      is_signed: cn.isSigned,
      signature_date: cn.signatureDate,
      prescriptions: cn.prescriptions || []
    }));
    supabase.from('clinical_notes').upsert(rows).then();
  },

  // -------------------------------------------------------------
  // Prescriptions
  // -------------------------------------------------------------
  getPrescriptions: (): Prescription[] => safeGet<Prescription[]>(STORAGE_KEYS.PRESCRIPTIONS, INITIAL_PRESCRIPTIONS),

  savePrescriptions: (prescriptions: Prescription[]): void => {
    safeSet(STORAGE_KEYS.PRESCRIPTIONS, prescriptions);
    const rows = prescriptions.map(rx => ({
      id: rx.id,
      patient_id: rx.patientId,
      patient_name: rx.patientName,
      patient_age: rx.patientAge,
      doctor_name: rx.doctorName,
      date: rx.date,
      diagnosis: rx.diagnosis,
      items: rx.items || [],
      instructions: rx.instructions
    }));
    supabase.from('prescriptions').upsert(rows).then();
  },

  // -------------------------------------------------------------
  // Invoices
  // -------------------------------------------------------------
  getInvoices: (): Invoice[] => {
    const list = safeGet<Invoice[] | null>(STORAGE_KEYS.INVOICES, null);
    // If the list is explicitly an array (even if empty []), respect it!
    // Never resurrect INITIAL_INVOICES when the bills list is empty.
    if (Array.isArray(list)) {
      return list;
    }
    return [];
  },

  safeSetInvoices: (invoices: Invoice[]): void => {
    safeSet(STORAGE_KEYS.INVOICES, invoices);
  },

  saveInvoices: (invoices: Invoice[]): void => {
    safeSet(STORAGE_KEYS.INVOICES, invoices);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dentiflow:invoices-updated', { detail: invoices }));
    }
    const rows = invoices.map(mapInvoiceToRow);
    if (rows.length > 0) {
      supabase.from('invoices').upsert(rows).then(({ error }) => {
        if (error) console.error('Error syncing invoices to Supabase:', error);
      });
    }
  },

  upsertInvoice: (invoice: Invoice): Invoice => {
    const list = StorageService.getInvoices();
    const idx = list.findIndex(i => i.id === invoice.id || (invoice.invoiceNumber && i.invoiceNumber === invoice.invoiceNumber));
    let updated: Invoice[];
    if (idx >= 0) {
      updated = [...list];
      updated[idx] = { ...list[idx], ...invoice, id: list[idx].id };
    } else {
      updated = [invoice, ...list];
    }
    safeSet(STORAGE_KEYS.INVOICES, updated);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dentiflow:invoices-updated', { detail: updated }));
    }
    const row = mapInvoiceToRow(invoice);
    supabase.from('invoices').upsert(row).then(({ error }) => {
      if (error) console.error('Error upserting single invoice to Supabase:', error);
    });
    return invoice;
  },

  deleteInvoice: async (invoiceId: string): Promise<{ success: boolean; error?: string }> => {
    const cleanId = (invoiceId || '').trim();
    if (!cleanId) return { success: false, error: 'Invoice ID is required' };

    try {
      // 1. Authoritative Backend / Database Deletion
      let deleted = false;
      try {
        const res = await fetch(`/api/bills/${encodeURIComponent(cleanId)}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' }
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.success) deleted = true;
        } else if (res.status === 404) {
          deleted = true;
        }
      } catch (_) {}

      if (!deleted) {
        // Direct Supabase delete fallback
        await supabase.from('payment_transactions').delete().eq('invoice_id', cleanId);
        const { error } = await supabase.from('invoices').delete().or(`id.eq.${cleanId},invoice_number.eq.${cleanId}`);
        if (error) {
          console.error('[StorageService] Supabase delete error:', error);
          return { success: false, error: error.message };
        }
      }

      // 2. Only after database deletion, update local storage cache
      const current = StorageService.getInvoices();
      const updated = current.filter(i => i.id !== cleanId && i.invoiceNumber !== cleanId);
      safeSet(STORAGE_KEYS.INVOICES, updated);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('dentiflow:invoices-updated', { detail: updated }));
      }

      return { success: true };
    } catch (err: any) {
      console.error('[StorageService] deleteInvoice error:', err);
      return { success: false, error: err?.message || 'Failed to delete invoice' };
    }
  },

  // -------------------------------------------------------------
  // Inventory
  // -------------------------------------------------------------
  getInventory: (): InventoryItem[] => safeGet<InventoryItem[]>(STORAGE_KEYS.INVENTORY, INITIAL_INVENTORY),

  saveInventory: (inventory: InventoryItem[]): void => {
    safeSet(STORAGE_KEYS.INVENTORY, inventory);
    const rows = inventory.map(item => ({
      id: item.id,
      name: item.name,
      category: item.category,
      brand: item.brand,
      sku: item.sku,
      current_stock: item.currentStock || item.quantity,
      min_threshold: item.minThreshold,
      unit: item.unit,
      cost_per_unit: item.costPerUnit,
      supplier: item.supplier,
      expiry_date: item.expiryDate,
      last_restocked: item.lastRestocked,
      location: item.location,
      status: item.status
    }));
    supabase.from('inventory').upsert(rows).then();
  },

  // -------------------------------------------------------------
  // Staff
  // -------------------------------------------------------------
  getStaff: (): StaffMember[] => safeGet<StaffMember[]>(STORAGE_KEYS.STAFF, INITIAL_STAFF),

  saveStaff: (staff: StaffMember[]): void => {
    safeSet(STORAGE_KEYS.STAFF, staff);
    const rows = staff.map(s => ({
      id: s.id,
      name: s.name,
      role: s.role,
      specialization: s.specialization || s.specialty,
      registration_number: s.registrationNumber || s.licenseNumber,
      assigned_chair: s.assignedChair || s.chairAssigned,
      availability: s.availability || s.schedule,
      email: s.email,
      phone: s.phone,
      active_patients_today: s.activePatientsToday,
      avatar_text: s.avatarText,
      status: s.status || 'active'
    }));
    supabase.from('staff').upsert(rows).then();
  },

  // -------------------------------------------------------------
  // Financing Requests
  // -------------------------------------------------------------
  getFinancingRequests: (): FinancingRequest[] => safeGet<FinancingRequest[]>(STORAGE_KEYS.FINANCING_REQUESTS, []),

  saveFinancingRequests: (requests: FinancingRequest[]): void => {
    safeSet(STORAGE_KEYS.FINANCING_REQUESTS, requests);
    const rows = requests.map(r => ({
      id: r.id,
      patient_id: r.patientId,
      patient_name: r.patientName,
      treatment_plan_id: r.treatmentPlanId,
      requested_amount: r.requestedAmount,
      tenure_months: r.tenureMonths,
      monthly_installment: r.monthlyInstallment,
      status: r.status,
      submitted_date: r.submittedDate,
      employment_status: r.employmentStatus,
      notes: r.notes
    }));
    supabase.from('financing_requests').upsert(rows).then();
  },

  // -------------------------------------------------------------
  // Transactions
  // -------------------------------------------------------------
  getTransactions: (): PaymentTransaction[] => safeGet<PaymentTransaction[]>(STORAGE_KEYS.TRANSACTIONS, []),

  saveTransactions: (txs: PaymentTransaction[]): void => {
    safeSet(STORAGE_KEYS.TRANSACTIONS, txs);
    const rows = txs.map(t => ({
      id: t.id,
      invoice_id: t.invoiceId,
      invoice_number: t.invoiceNumber,
      patient_id: t.patientId,
      patient_name: t.patientName,
      amount: t.amount,
      payment_method: t.paymentMethod,
      transaction_ref: t.transactionRef,
      status: t.status,
      timestamp: t.timestamp,
      gateway_response: t.gatewayResponse || {}
    }));
    supabase.from('payment_transactions').upsert(rows).then();
  },

  addTransaction: (tx: PaymentTransaction): void => {
    const existing = StorageService.getTransactions();
    safeSet(STORAGE_KEYS.TRANSACTIONS, [tx, ...existing]);

    supabase.from('payment_transactions').insert({
      id: tx.id,
      invoice_id: tx.invoiceId,
      invoice_number: tx.invoiceNumber,
      patient_id: tx.patientId,
      patient_name: tx.patientName,
      amount: tx.amount,
      payment_method: tx.paymentMethod,
      transaction_ref: tx.transactionRef,
      status: tx.status,
      timestamp: tx.timestamp,
      gateway_response: tx.gatewayResponse || {}
    }).then();
  },

  // Reset to initial seed
  resetAll: (): void => {
    Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
    supabase.auth.signOut().catch(() => {});
  }
};
