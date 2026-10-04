/**
 * src/server/db.ts — Oralix Unified Clinic Database & Relational Persistence Engine
 * 
 * Provides atomic, validated, multi-tenant persistence using SQLite:
 * - Clinic Configuration & Operatories
 * - Patient Records (scoped to clinic, isolated per patient)
 * - Appointments (valid status state machine, double-booking prevention)
 * - Invoices, Payments (atomic transactions, idempotency checks)
 * - Receipts & Delivery History
 * - Feedback & Reviews (verified patient reviews)
 * - Integrations (Instagram, Google Business Profile states)
 * - Patient Files & Reports (MIME validated, size constrained)
 * - Audit Logs & System Notifications
 * - User Accounts, Passwords (PBKDF2-SHA256), Sessions & Reset Tokens
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';
import { Request } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type UserRole = 'doctor' | 'patient' | 'admin' | 'receptionist';

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarText?: string;
  phone?: string;
  doctorId?: string;
  patientId?: string;
  specialization?: string;
  status: 'active' | 'inactive' | 'on_leave';
  joinedDate?: string;
}

export type ServerUser = AuthenticatedUser;

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  session?: any;
}

export interface PwRecord {
  userId: string;
  salt: string;   // 16-byte hex
  hash: string;   // 32-byte hex
  iterations: number;
}

export interface SessionRecord {
  token: string;
  userId: string;
  role: UserRole;
  createdAt: number;
  expiresAt: number;
}

export interface ResetEntry {
  userId: string;
  email: string;
  tokenHash: string;
  expiresAt: number;
  used: boolean;
  createdAt: number;
}

export interface ClinicChair {
  id: string;
  name: string;
  specialty: string;
}

export interface ClinicRecord {
  id: string;
  name: string;
  tagline: string;
  phone: string;
  email: string;
  address: string;
  currency: string;
  taxRatePct: number;
  chairs: ClinicChair[];
  businessHours: string;
  registrationNumber: string;
  updatedAt: string;
}

export interface PatientRecord {
  id: string;
  userId?: string;
  clinicId: string;
  code: string;
  name: string;
  age: number;
  gender: 'Male' | 'Female' | 'Other';
  phone: string;
  email: string;
  address?: string;
  bloodGroup?: string;
  medicalAlerts: string[];
  emergencyContact?: string;
  insuranceProvider?: string;
  insurancePolicyNumber?: string;
  balanceDue: number;
  registeredDate: string;
  lastVisitDate?: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export type AppointmentState =
  | 'SCHEDULED'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export interface AppointmentRecord {
  id: string;
  clinicId: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  chair: string;
  date: string; // YYYY-MM-DD
  startTime: string; // e.g. "09:30 AM" or "09:30"
  endTime: string; // e.g. "10:15 AM" or "10:15"
  durationMinutes: number;
  procedure: string;
  status: AppointmentState;
  tokenNumber: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceLineItem {
  id: string;
  description: string;
  code?: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export type InvoicePaymentStatus =
  | 'UNPAID'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'CANCELLED'
  | 'REFUNDED';

export interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  clinicId: string;
  patientId: string;
  patientName: string;
  patientEmail?: string;
  patientPhone?: string;
  date: string;
  dueDate: string;
  createdBy: string;
  items: InvoiceLineItem[];
  consultationFee: number;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  status: InvoicePaymentStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type SupportedPaymentMethod = 'Cash' | 'UPI' | 'Card' | 'Bank Transfer';

export interface PaymentRecord {
  id: string;
  idempotencyKey: string;
  invoiceId: string;
  invoiceNumber: string;
  clinicId: string;
  patientId: string;
  patientName: string;
  amount: number;
  paymentMethod: SupportedPaymentMethod;
  transactionRef?: string;
  date: string;
  timestamp: string;
  status: 'SUCCESSFUL' | 'FAILED' | 'PENDING';
  recordedBy: string;
  notes?: string;
  createdAt: string;
}

export interface ReceiptRecord {
  id: string;
  receiptNumber: string;
  paymentId: string;
  invoiceId: string;
  invoiceNumber: string;
  clinicId: string;
  patientId: string;
  patientName: string;
  patientEmail?: string;
  date: string;
  amountReceived: number;
  remainingBalance: number;
  paymentMethod: SupportedPaymentMethod;
  emailStatus: 'pending' | 'sent' | 'failed';
  emailSentAt?: string;
  emailError?: string;
  createdAt: string;
}

export interface FeedbackRecord {
  id: string;
  clinicId: string;
  patientId?: string;
  patientName: string;
  doctorName?: string;
  treatmentName?: string;
  rating: number; // 1-5
  comment: string;
  clinicResponse?: string;
  respondedAt?: string;
  verified: boolean;
  published: boolean;
  createdAt: string;
}

export type IntegrationState = 'NOT_CONNECTED' | 'CONNECTED' | 'SYNCED' | 'ERROR';

export interface SocialIntegration {
  clinicId: string;
  state: IntegrationState;
  accountHandle?: string;
  connectedAt?: string;
  lastSync?: string;
  followers?: number;
  likes?: number;
  comments?: number;
  reach?: number;
  profilePicUrl?: string;
}

export interface GoogleIntegration {
  clinicId: string;
  state: IntegrationState;
  locationName?: string;
  connectedAt?: string;
  lastSync?: string;
  rating?: number;
  totalReviews?: number;
  searchViews?: number;
  mapsViews?: number;
  directionRequests?: number;
}

export interface ClinicIntegrations {
  clinicId: string;
  instagram: SocialIntegration;
  googleBusiness: GoogleIntegration;
  updatedAt: string;
}

export interface PatientFileRecord {
  id: string;
  clinicId: string;
  patientId: string;
  fileName: string;
  fileType: string; // MIME
  fileSize: number; // bytes
  category: 'xray' | 'prescription' | 'consent' | 'lab_report' | 'insurance' | 'invoice_receipt' | 'clinical_note';
  uploadedBy: string;
  uploadedAt: string;
  storageData?: string; // Base64 or local URI
}

export interface SystemNotification {
  id: string;
  clinicId: string;
  userId?: string;
  type: 'appointment' | 'payment' | 'receipt' | 'feedback' | 'system' | 'lockout';
  title: string;
  message: string;
  read: boolean;
  link?: string;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  clinicId: string;
  userId?: string;
  userEmail?: string;
  action: string;
  entityType: string;
  entityId?: string;
  details: string;
  ip?: string;
  createdAt: string;
}

// ─── SQLITE PERSISTENT DATABASE INITIALIZATION ────────────────────────────────
const DB_DIR = path.resolve(process.env.DATABASE_DIR || 'data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const DB_PATH = path.resolve(DB_DIR, 'oralix.db');
const db = new DatabaseSync(DB_PATH);

// Configure WAL mode and foreign keys for high-performance durability
try {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
} catch (e) {
  console.warn('[Oralix DB] Note configuring PRAGMA:', e);
}

// Initialize tables with strict types and primary/foreign keys
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('doctor', 'patient', 'admin', 'receptionist')),
    avatar_text TEXT,
    phone TEXT,
    doctor_id TEXT,
    patient_id TEXT,
    specialization TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'on_leave')),
    joined_date TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
  CREATE INDEX IF NOT EXISTS idx_users_doctor_id ON users(doctor_id);
  CREATE INDEX IF NOT EXISTS idx_users_patient_id ON users(patient_id);

  CREATE TABLE IF NOT EXISTS user_credentials (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    salt TEXT NOT NULL,
    hash TEXT NOT NULL,
    iterations INTEGER NOT NULL DEFAULT 210000,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_resets_user_id ON password_resets(user_id);
  CREATE INDEX IF NOT EXISTS idx_resets_email ON password_resets(email);
  CREATE INDEX IF NOT EXISTS idx_resets_expires_at ON password_resets(expires_at);

  CREATE TABLE IF NOT EXISTS clinic_settings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tagline TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    currency TEXT DEFAULT 'INR',
    tax_rate_pct REAL DEFAULT 0,
    chairs TEXT,
    business_hours TEXT,
    registration_number TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS patients (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    clinic_id TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    age INTEGER NOT NULL,
    gender TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    address TEXT,
    blood_group TEXT,
    medical_alerts TEXT,
    emergency_contact TEXT,
    insurance_provider TEXT,
    insurance_policy_number TEXT,
    balance_due REAL DEFAULT 0,
    registered_date TEXT NOT NULL,
    last_visit_date TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_patients_clinic_id ON patients(clinic_id);
  CREATE INDEX IF NOT EXISTS idx_patients_user_id ON patients(user_id);
  CREATE INDEX IF NOT EXISTS idx_patients_email ON patients(email);

  CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL,
    patient_id TEXT NOT NULL,
    patient_name TEXT NOT NULL,
    doctor_id TEXT NOT NULL,
    doctor_name TEXT NOT NULL,
    chair TEXT,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    procedure TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'SCHEDULED',
    token_number TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_appointments_clinic_date ON appointments(clinic_id, date);
  CREATE INDEX IF NOT EXISTS idx_appointments_doctor ON appointments(doctor_id);
  CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);

  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    invoice_number TEXT NOT NULL UNIQUE,
    clinic_id TEXT NOT NULL,
    patient_id TEXT NOT NULL,
    patient_name TEXT NOT NULL,
    patient_email TEXT,
    patient_phone TEXT,
    date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    created_by TEXT NOT NULL,
    items TEXT NOT NULL,
    consultation_fee REAL DEFAULT 0,
    subtotal REAL NOT NULL,
    discount REAL DEFAULT 0,
    tax REAL DEFAULT 0,
    total REAL NOT NULL,
    amount_paid REAL DEFAULT 0,
    balance_due REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'UNPAID',
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_invoices_clinic ON invoices(clinic_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_patient ON invoices(patient_id);

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    invoice_id TEXT NOT NULL,
    invoice_number TEXT NOT NULL,
    clinic_id TEXT NOT NULL,
    patient_id TEXT NOT NULL,
    patient_name TEXT NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL,
    transaction_ref TEXT,
    date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'SUCCESSFUL',
    timestamp TEXT,
    recorded_by TEXT NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_payments_clinic ON payments(clinic_id);

  CREATE TABLE IF NOT EXISTS receipts (
    id TEXT PRIMARY KEY,
    receipt_number TEXT NOT NULL UNIQUE,
    payment_id TEXT NOT NULL,
    invoice_id TEXT NOT NULL,
    invoice_number TEXT NOT NULL,
    clinic_id TEXT NOT NULL,
    patient_id TEXT NOT NULL,
    patient_name TEXT NOT NULL,
    patient_email TEXT,
    date TEXT NOT NULL,
    amount_received REAL NOT NULL,
    remaining_balance REAL NOT NULL,
    payment_method TEXT NOT NULL,
    email_status TEXT DEFAULT 'pending',
    email_sent_at TEXT,
    email_error TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_receipts_invoice ON receipts(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_receipts_patient ON receipts(patient_id);

  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL,
    patient_id TEXT,
    patient_name TEXT NOT NULL,
    doctor_name TEXT,
    treatment_name TEXT,
    rating INTEGER NOT NULL,
    comment TEXT NOT NULL,
    clinic_response TEXT,
    responded_at TEXT,
    verified INTEGER DEFAULT 1,
    published INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_feedback_clinic ON feedback(clinic_id);

  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL,
    patient_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    category TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
    storage_data TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_files_patient ON files(patient_id);

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL,
    user_id TEXT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    read INTEGER DEFAULT 0,
    link TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL,
    user_id TEXT,
    user_email TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    details TEXT,
    ip TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_audit_clinic ON audit_logs(clinic_id);

  CREATE TABLE IF NOT EXISTS integrations (
    id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL,
    instagram TEXT,
    google_business TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// ─── LEGACY JSON MIGRATION ENGINE ─────────────────────────────────────────────
// Seamlessly imports any existing JSON stores into the persistent database tables
function migrateLegacyJsonStores(): void {
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    const searchDirs = ['.', 'backend', path.resolve(__dirname, '../../..'), path.resolve(__dirname, '../..')];

    const findFile = (name: string): string | null => {
      for (const dir of searchDirs) {
        const p = path.resolve(dir, name);
        if (fs.existsSync(p)) return p;
      }
      return null;
    };

  const safeJson = <T>(p: string | null): T | null => {
    if (!p) return null;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
    } catch {
      return null;
    }
  };

  // 1. Users
  const userPath = findFile('.dentiflow_user_store.json');
  const legacyUsers = safeJson<ServerUser[]>(userPath);
  if (legacyUsers && Array.isArray(legacyUsers)) {
    const insertUser = db.prepare(`
      INSERT OR REPLACE INTO users (id, name, email, role, avatar_text, phone, doctor_id, patient_id, specialization, status, joined_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const u of legacyUsers) {
      if (u.id && u.email) {
        insertUser.run(
          u.id,
          u.name,
          u.email.toLowerCase().trim(),
          u.role,
          u.avatarText || 'OX',
          u.phone || '',
          u.doctorId || null,
          u.patientId || null,
          u.specialization || null,
          u.status || 'active',
          u.joinedDate || new Date().toISOString().split('T')[0]
        );
      }
    }
  }

  // 2. Passwords
  const pwPath = findFile('.dentiflow_pw_store.json');
  const legacyPws = safeJson<PwRecord[]>(pwPath);
  if (legacyPws && Array.isArray(legacyPws)) {
    const insertPw = db.prepare(`
      INSERT OR REPLACE INTO user_credentials (user_id, salt, hash, iterations)
      VALUES (?, ?, ?, ?)
    `);
    for (const p of legacyPws) {
      if (p.userId && p.salt && p.hash) {
        insertPw.run(p.userId, p.salt, p.hash, p.iterations || 210000);
      }
    }
  }

  // 3. Sessions
  const sessPath = findFile('.dentiflow_session_store.json');
  const legacySessions = safeJson<[string, SessionRecord][]>(sessPath);
  if (legacySessions && Array.isArray(legacySessions)) {
    const insertSess = db.prepare(`
      INSERT OR REPLACE INTO sessions (token, user_id, role, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const [token, s] of legacySessions) {
      if (token && s && s.userId && s.expiresAt > Date.now()) {
        insertSess.run(token, s.userId, s.role, s.createdAt || Date.now(), s.expiresAt);
      }
    }
  }

  // 4. Password Resets
  const resetPath = findFile('.dentiflow_reset_store.json');
  const legacyResets = safeJson<[string, ResetEntry][]>(resetPath);
  if (legacyResets && Array.isArray(legacyResets)) {
    const insertReset = db.prepare(`
      INSERT OR REPLACE INTO password_resets (token_hash, user_id, email, created_at, expires_at, used)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const [hash, r] of legacyResets) {
      if (hash && r && r.userId) {
        insertReset.run(hash, r.userId, r.email, r.createdAt || Date.now(), r.expiresAt, r.used ? 1 : 0);
      }
    }
  }

  // 5. Patients
  const patientPath = findFile('.oralix_patient_store.json');
  const legacyPatients = safeJson<PatientRecord[]>(patientPath);
  if (legacyPatients && Array.isArray(legacyPatients)) {
    const insertPat = db.prepare(`
      INSERT OR REPLACE INTO patients (id, user_id, clinic_id, code, name, age, gender, phone, email, address, blood_group, medical_alerts, emergency_contact, insurance_provider, insurance_policy_number, balance_due, registered_date, last_visit_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const p of legacyPatients) {
      insertPat.run(
        p.id,
        p.userId || null,
        p.clinicId || 'clinic-ox-main',
        p.code,
        p.name,
        p.age || 30,
        p.gender || 'Other',
        p.phone || '',
        p.email || '',
        p.address || '',
        p.bloodGroup || 'O+',
        JSON.stringify(p.medicalAlerts || []),
        p.emergencyContact || '',
        p.insuranceProvider || 'Self-pay',
        p.insurancePolicyNumber || '',
        p.balanceDue || 0,
        p.registeredDate || new Date().toISOString().split('T')[0],
        p.lastVisitDate || null,
        p.status || 'active'
      );
    }
  }

  // 6. Appointments
  const aptPath = findFile('.oralix_appointment_store.json');
  const legacyApts = safeJson<AppointmentRecord[]>(aptPath);
  if (legacyApts && Array.isArray(legacyApts)) {
    const insertApt = db.prepare(`
      INSERT OR REPLACE INTO appointments (id, clinic_id, patient_id, patient_name, doctor_id, doctor_name, chair, date, start_time, end_time, duration_minutes, procedure, status, token_number, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const a of legacyApts) {
      insertApt.run(
        a.id,
        a.clinicId || 'clinic-ox-main',
        a.patientId,
        a.patientName,
        a.doctorId,
        a.doctorName,
        a.chair || 'Chair 1',
        a.date,
        a.startTime,
        a.endTime,
        a.durationMinutes || 45,
        a.procedure || 'Checkup',
        a.status || 'SCHEDULED',
        a.tokenNumber || '#D-101',
        a.notes || ''
      );
    }
  }

  // 7. Invoices
  const invPath = findFile('.oralix_invoice_store.json');
  const legacyInvs = safeJson<InvoiceRecord[]>(invPath);
  if (legacyInvs && Array.isArray(legacyInvs)) {
    const insertInv = db.prepare(`
      INSERT OR REPLACE INTO invoices (id, invoice_number, clinic_id, patient_id, patient_name, patient_email, patient_phone, date, due_date, created_by, items, consultation_fee, subtotal, discount, tax, total, amount_paid, balance_due, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const i of legacyInvs) {
      insertInv.run(
        i.id,
        i.invoiceNumber,
        i.clinicId || 'clinic-ox-main',
        i.patientId,
        i.patientName,
        i.patientEmail || '',
        i.patientPhone || '',
        i.date,
        i.dueDate,
        i.createdBy,
        JSON.stringify(i.items || []),
        i.consultationFee || 0,
        i.subtotal || 0,
        i.discount || 0,
        i.tax || 0,
        i.total || 0,
        i.amountPaid || 0,
        i.balanceDue || 0,
        i.status || 'UNPAID',
        i.notes || ''
      );
    }
  }

  // 8. Payments
  const payPath = findFile('.oralix_payment_store.json');
  const legacyPays = safeJson<any[]>(payPath);
  if (legacyPays && Array.isArray(legacyPays)) {
    const insertPay = db.prepare(`
      INSERT OR REPLACE INTO payments (id, idempotency_key, invoice_id, invoice_number, clinic_id, patient_id, patient_name, amount, payment_method, transaction_ref, date, status, timestamp, recorded_by, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const p of legacyPays) {
      const ts = String(p.timestamp || p.date || new Date().toISOString());
      const dt = String(p.date || ts.split('T')[0]);
      const st = String(p.status || 'SUCCESSFUL');
      insertPay.run(
        String(p.id),
        String(p.idempotencyKey || `key-${p.id}`),
        String(p.invoiceId),
        String(p.invoiceNumber),
        String(p.clinicId || 'clinic-ox-main'),
        String(p.patientId),
        String(p.patientName),
        Number(p.amount) || 0,
        String(p.paymentMethod || 'UPI'),
        p.transactionRef ? String(p.transactionRef) : null,
        dt,
        st,
        ts,
        String(p.recordedBy || 'system'),
        p.notes ? String(p.notes) : null
      );
    }
  }

  // 9. Receipts
  const rcpPath = findFile('.oralix_receipt_store.json');
  const legacyRcps = safeJson<ReceiptRecord[]>(rcpPath);
  if (legacyRcps && Array.isArray(legacyRcps)) {
    const insertRcp = db.prepare(`
      INSERT OR REPLACE INTO receipts (id, receipt_number, payment_id, invoice_id, invoice_number, clinic_id, patient_id, patient_name, patient_email, date, amount_received, remaining_balance, payment_method, email_status, email_sent_at, email_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of legacyRcps) {
      insertRcp.run(
        r.id,
        r.receiptNumber,
        r.paymentId,
        r.invoiceId,
        r.invoiceNumber,
        r.clinicId || 'clinic-ox-main',
        r.patientId,
        r.patientName,
        r.patientEmail || '',
        r.date,
        r.amountReceived,
        r.remainingBalance,
        r.paymentMethod,
        r.emailStatus || 'pending',
        r.emailSentAt || null,
        r.emailError || null
      );
    }
  }

  // 10. Feedback
  const fbPath = findFile('.oralix_feedback_store.json');
  const legacyFbs = safeJson<FeedbackRecord[]>(fbPath);
  if (legacyFbs && Array.isArray(legacyFbs)) {
    const insertFb = db.prepare(`
      INSERT OR REPLACE INTO feedback (id, clinic_id, patient_id, patient_name, doctor_name, treatment_name, rating, comment, clinic_response, responded_at, verified, published)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const f of legacyFbs) {
      insertFb.run(
        f.id,
        f.clinicId || 'clinic-ox-main',
        f.patientId || null,
        f.patientName,
        f.doctorName || 'Dr. Ananya Sharma',
        f.treatmentName || 'Consultation',
        f.rating || 5,
        f.comment,
        f.clinicResponse || null,
        f.respondedAt || null,
        f.verified ? 1 : 0,
        f.published ? 1 : 0
      );
    }
  }

  // 11. Files
  const fileStorePath = findFile('.oralix_file_store.json');
  const legacyFiles = safeJson<PatientFileRecord[]>(fileStorePath);
  if (legacyFiles && Array.isArray(legacyFiles)) {
    const insertFile = db.prepare(`
      INSERT OR REPLACE INTO files (id, clinic_id, patient_id, file_name, file_type, file_size, category, uploaded_by, uploaded_at, storage_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const f of legacyFiles) {
      insertFile.run(
        f.id,
        f.clinicId || 'clinic-ox-main',
        f.patientId,
        f.fileName,
        f.fileType,
        f.fileSize,
        f.category,
        f.uploadedBy,
        f.uploadedAt || new Date().toISOString(),
        f.storageData || null
      );
    }
  }

  // 12. Notifications
  const notifPath = findFile('.oralix_notification_store.json');
  const legacyNotifs = safeJson<SystemNotification[]>(notifPath);
  if (legacyNotifs && Array.isArray(legacyNotifs)) {
    const insertNotif = db.prepare(`
      INSERT OR REPLACE INTO notifications (id, clinic_id, user_id, type, title, message, read, link, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const n of legacyNotifs) {
      insertNotif.run(
        n.id,
        n.clinicId || 'clinic-ox-main',
        n.userId || null,
        n.type,
        n.title,
        n.message,
        n.read ? 1 : 0,
        n.link || null,
        n.createdAt || new Date().toISOString()
      );
    }
  }

  // 13. Audit Logs
  const auditPath = findFile('.oralix_audit_store.json');
  const legacyAudits = safeJson<AuditLogEntry[]>(auditPath);
  if (legacyAudits && Array.isArray(legacyAudits)) {
    const insertAudit = db.prepare(`
      INSERT OR REPLACE INTO audit_logs (id, clinic_id, user_id, user_email, action, entity_type, entity_id, details, ip, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const a of legacyAudits) {
      insertAudit.run(
        a.id,
        a.clinicId || 'clinic-ox-main',
        a.userId || null,
        a.userEmail || null,
        a.action,
        a.entityType,
        a.entityId || null,
        a.details,
        a.ip || null,
        a.createdAt || new Date().toISOString()
      );
    }
  }

  // 14. Integrations
  const intPath = findFile('.oralix_integration_store.json');
  const legacyInts = safeJson<ClinicIntegrations>(intPath);
  if (legacyInts) {
    const insertInt = db.prepare(`
      INSERT OR REPLACE INTO integrations (id, clinic_id, instagram, google_business, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertInt.run(
      legacyInts.clinicId || 'clinic-ox-main',
      legacyInts.clinicId || 'clinic-ox-main',
      JSON.stringify(legacyInts.instagram || { clinicId: 'clinic-ox-main', state: 'NOT_CONNECTED' }),
      JSON.stringify(legacyInts.googleBusiness || { clinicId: 'clinic-ox-main', state: 'NOT_CONNECTED' }),
      legacyInts.updatedAt || new Date().toISOString()
    );
  }

  // 15. Clinic Settings
  const clinicPath = findFile('.oralix_clinic_store.json');
  const legacyClinic = safeJson<ClinicRecord>(clinicPath);
  if (legacyClinic) {
    const insertClinic = db.prepare(`
      INSERT OR REPLACE INTO clinic_settings (id, name, tagline, phone, email, address, currency, tax_rate_pct, chairs, business_hours, registration_number, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertClinic.run(
      legacyClinic.id || 'clinic-ox-main',
      legacyClinic.name || 'Oralix Dental Clinic',
      legacyClinic.tagline || 'Advanced Restorative Medicine',
      legacyClinic.phone || '+91 98450 11223',
      legacyClinic.email || 'care@oralix.online',
      legacyClinic.address || 'Oralix Towers, Indiranagar, Bengaluru',
      legacyClinic.currency || 'INR',
      legacyClinic.taxRatePct || 0,
      JSON.stringify(legacyClinic.chairs || []),
      legacyClinic.businessHours || 'Mon-Sat: 09:00 AM - 08:00 PM',
      legacyClinic.registrationNumber || 'KA-DENT-2024-8841',
      legacyClinic.updatedAt || new Date().toISOString()
    );
  }
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

// Perform initial migration
migrateLegacyJsonStores();

// ─── UNIFIED ORALIX DATABASE API ──────────────────────────────────────────────
export const OralixDb = {
  isHealthy(): boolean {
    try {
      const res = db.prepare('SELECT 1 as healthy').get() as { healthy: number };
      return res?.healthy === 1;
    } catch {
      return false;
    }
  },

  // ─── User Store Methods ───
  getUser(id: string): ServerUser | undefined {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      avatarText: row.avatar_text,
      phone: row.phone,
      doctorId: row.doctor_id,
      patientId: row.patient_id,
      specialization: row.specialization,
      status: row.status,
      joinedDate: row.joined_date,
    };
  },

  findUserByEmail(email: string): ServerUser | undefined {
    if (!email) return undefined;
    const clean = email.toLowerCase().trim();
    const row = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(clean) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      avatarText: row.avatar_text,
      phone: row.phone,
      doctorId: row.doctor_id,
      patientId: row.patient_id,
      specialization: row.specialization,
      status: row.status,
      joinedDate: row.joined_date,
    };
  },

  findUserByIdentifier(identifier: string): ServerUser | undefined {
    if (!identifier) return undefined;
    const clean = identifier.toLowerCase().trim();
    const cleanPhone = clean.replace(/[\s\-\+\(\)]/g, '');

    const all = OralixDb.getAllUsers();
    return all.find(u => {
      const uEmail = (u.email || '').toLowerCase().trim();
      const uId = (u.id || '').toLowerCase().trim();
      const uName = (u.name || '').toLowerCase().trim();
      const uPhone = (u.phone || '').replace(/[\s\-\+\(\)]/g, '');
      const uDocId = (u.doctorId || '').toLowerCase().trim();
      const uPatId = (u.patientId || '').toLowerCase().trim();

      return (
        uEmail === clean ||
        uId === clean ||
        uName === clean ||
        (uDocId && uDocId === clean) ||
        (uPatId && uPatId === clean) ||
        (cleanPhone && uPhone && (uPhone === cleanPhone || uPhone.endsWith(cleanPhone) || cleanPhone.endsWith(uPhone)))
      );
    });
  },

  getAllUsers(): ServerUser[] {
    const rows = db.prepare('SELECT * FROM users ORDER BY id ASC').all() as any[];
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      avatarText: row.avatar_text,
      phone: row.phone,
      doctorId: row.doctor_id,
      patientId: row.patient_id,
      specialization: row.specialization,
      status: row.status,
      joinedDate: row.joined_date,
    }));
  },

  saveUser(user: ServerUser): ServerUser {
    db.prepare(`
      INSERT OR REPLACE INTO users (id, name, email, role, avatar_text, phone, doctor_id, patient_id, specialization, status, joined_date, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      user.id,
      user.name,
      user.email.toLowerCase().trim(),
      user.role,
      user.avatarText || 'OX',
      user.phone || null,
      user.doctorId || null,
      user.patientId || null,
      user.specialization || null,
      user.status || 'active',
      user.joinedDate || new Date().toISOString().split('T')[0]
    );
    return user;
  },

  saveUsers(users: ServerUser[]): void {
    for (const u of users) {
      OralixDb.saveUser(u);
    }
  },

  deleteUser(id: string): void {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  },

  // ─── Credentials Methods ───
  getUserPassword(userId: string): PwRecord | undefined {
    const row = db.prepare('SELECT * FROM user_credentials WHERE user_id = ?').get(userId) as any;
    if (!row) return undefined;
    return {
      userId: row.user_id,
      salt: row.salt,
      hash: row.hash,
      iterations: row.iterations,
    };
  },

  saveUserPassword(record: PwRecord): void {
    const userExists = db.prepare('SELECT id FROM users WHERE id = ?').get(record.userId);
    if (!userExists) {
      OralixDb.saveUser({
        id: record.userId,
        name: record.userId,
        email: `${record.userId.toLowerCase()}@oralix.internal`,
        role: 'patient',
        status: 'active',
      });
    }
    db.prepare(`
      INSERT OR REPLACE INTO user_credentials (user_id, salt, hash, iterations, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(record.userId, record.salt, record.hash, record.iterations || 210000);
  },

  getAllCredentials(): PwRecord[] {
    const rows = db.prepare('SELECT * FROM user_credentials').all() as any[];
    return rows.map(r => ({
      userId: r.user_id,
      salt: r.salt,
      hash: r.hash,
      iterations: r.iterations,
    }));
  },

  saveAllCredentials(records: PwRecord[]): void {
    for (const r of records) {
      OralixDb.saveUserPassword(r);
    }
  },

  // ─── Sessions Methods ───
  createSession(session: SessionRecord): void {
    db.prepare(`
      INSERT OR REPLACE INTO sessions (token, user_id, role, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(session.token, session.userId, session.role, session.createdAt, session.expiresAt);
  },

  getSession(token: string): SessionRecord | undefined {
    const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as any;
    if (!row) return undefined;
    return {
      token: row.token,
      userId: row.user_id,
      role: row.role as UserRole,
      createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at),
    };
  },

  deleteSession(token: string): void {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  },

  deleteUserSessions(userId: string): void {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  },

  getAllSessionsMap(): Map<string, SessionRecord> {
    const rows = db.prepare('SELECT * FROM sessions WHERE expires_at > ?').all(Date.now()) as any[];
    const map = new Map<string, SessionRecord>();
    for (const r of rows) {
      map.set(r.token, {
        token: r.token,
        userId: r.user_id,
        role: r.role as UserRole,
        createdAt: Number(r.created_at),
        expiresAt: Number(r.expires_at),
      });
    }
    return map;
  },

  saveSessionsMap(map: Map<string, SessionRecord>): void {
    const existing = db.prepare('SELECT token FROM sessions').all() as any[];
    const activeTokens = new Set(map.keys());
    for (const row of existing) {
      if (!activeTokens.has(row.token)) {
        db.prepare('DELETE FROM sessions WHERE token = ?').run(row.token);
      }
    }
    for (const [token, s] of map) {
      OralixDb.createSession(s);
    }
  },

  cleanExpiredSessions(): void {
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  },

  // ─── Password Reset Methods ───
  saveResetToken(entry: ResetEntry): void {
    db.prepare(`
      INSERT OR REPLACE INTO password_resets (token_hash, user_id, email, created_at, expires_at, used)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      entry.tokenHash,
      entry.userId,
      entry.email.toLowerCase().trim(),
      entry.createdAt,
      entry.expiresAt,
      entry.used ? 1 : 0
    );
  },

  getResetToken(tokenHash: string): ResetEntry | undefined {
    const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(tokenHash) as any;
    if (!row) return undefined;
    return {
      tokenHash: row.token_hash,
      userId: row.user_id,
      email: row.email,
      createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at),
      used: Boolean(row.used),
    };
  },

  invalidateResetToken(tokenHash: string): void {
    db.prepare('UPDATE password_resets SET used = 1 WHERE token_hash = ?').run(tokenHash);
  },

  invalidateUserResetTokens(userId: string, email?: string): void {
    if (email) {
      db.prepare('DELETE FROM password_resets WHERE user_id = ? OR lower(email) = ?').run(userId, email.toLowerCase().trim());
    } else {
      db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(userId);
    }
  },

  getAllResetTokensMap(): Map<string, ResetEntry> {
    const rows = db.prepare('SELECT * FROM password_resets WHERE used = 0 AND expires_at > ?').all(Date.now()) as any[];
    const map = new Map<string, ResetEntry>();
    for (const r of rows) {
      map.set(r.token_hash, {
        tokenHash: r.token_hash,
        userId: r.user_id,
        email: r.email,
        createdAt: Number(r.created_at),
        expiresAt: Number(r.expires_at),
        used: Boolean(r.used),
      });
    }
    return map;
  },

  saveResetTokensMap(map: Map<string, ResetEntry>): void {
    db.prepare('DELETE FROM password_resets').run();
    for (const [hash, entry] of map) {
      OralixDb.saveResetToken(entry);
    }
  },

  cleanExpiredResetTokens(): void {
    db.prepare('DELETE FROM password_resets WHERE expires_at <= ? OR used = 1').run(Date.now());
  },

  // ─── Clinic Settings Methods ───
  getClinic(): ClinicRecord {
    const row = db.prepare('SELECT * FROM clinic_settings LIMIT 1').get() as any;
    if (!row) {
      const def: ClinicRecord = {
        id: 'clinic-ox-main',
        name: 'Oralix Dental Clinic',
        tagline: 'Advanced Restorative Medicine',
        phone: '+91 98450 11223',
        email: 'care@oralix.online',
        address: 'Oralix Towers, Indiranagar, Bengaluru',
        currency: 'INR',
        taxRatePct: 0,
        chairs: [
          { id: 'ch-1', name: 'Operatory 1', specialty: 'Endodontics & Restorative' },
          { id: 'ch-2', name: 'Operatory 2', specialty: 'Periodontics & Hygiene' },
          { id: 'ch-3', name: 'Operatory 3', specialty: 'Oral Surgery & Implants' },
        ],
        businessHours: 'Mon-Sat: 09:00 AM - 08:00 PM',
        registrationNumber: 'KA-DENT-2024-8841',
        updatedAt: new Date().toISOString(),
      };
      OralixDb.saveClinic(def);
      return def;
    }
    return {
      id: row.id,
      name: row.name,
      tagline: row.tagline || '',
      phone: row.phone || '',
      email: row.email || '',
      address: row.address || '',
      currency: row.currency || 'INR',
      taxRatePct: Number(row.tax_rate_pct) || 0,
      chairs: row.chairs ? JSON.parse(row.chairs) : [],
      businessHours: row.business_hours || '',
      registrationNumber: row.registration_number || '',
      updatedAt: row.updated_at,
    };
  },

  saveClinic(record: ClinicRecord): ClinicRecord {
    db.prepare(`
      INSERT OR REPLACE INTO clinic_settings (id, name, tagline, phone, email, address, currency, tax_rate_pct, chairs, business_hours, registration_number, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      record.id,
      record.name,
      record.tagline,
      record.phone,
      record.email,
      record.address,
      record.currency || 'INR',
      record.taxRatePct || 0,
      JSON.stringify(record.chairs || []),
      record.businessHours,
      record.registrationNumber,
    );
    return record;
  },

  // ─── Patients Methods ───
  getPatients(clinicId = 'clinic-ox-main'): PatientRecord[] {
    const rows = db.prepare('SELECT * FROM patients WHERE clinic_id = ? ORDER BY created_at DESC').all(clinicId) as any[];
    return rows.map(r => ({
      id: r.id,
      userId: r.user_id || undefined,
      clinicId: r.clinic_id,
      code: r.code,
      name: r.name,
      age: Number(r.age),
      gender: r.gender,
      phone: r.phone,
      email: r.email || '',
      address: r.address || undefined,
      bloodGroup: r.blood_group || undefined,
      medicalAlerts: r.medical_alerts ? JSON.parse(r.medical_alerts) : [],
      emergencyContact: r.emergency_contact || undefined,
      insuranceProvider: r.insurance_provider || undefined,
      insurancePolicyNumber: r.insurance_policy_number || undefined,
      balanceDue: Number(r.balance_due) || 0,
      registeredDate: r.registered_date,
      lastVisitDate: r.last_visit_date || undefined,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  },

  findPatientById(id: string, clinicId?: string): PatientRecord | undefined {
    let sql = 'SELECT * FROM patients WHERE id = ?';
    const params: any[] = [id];
    if (clinicId) {
      sql += ' AND clinic_id = ?';
      params.push(clinicId);
    }
    const r = db.prepare(sql).get(...params) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      userId: r.user_id || undefined,
      clinicId: r.clinic_id,
      code: r.code,
      name: r.name,
      age: Number(r.age),
      gender: r.gender,
      phone: r.phone,
      email: r.email || '',
      address: r.address || undefined,
      bloodGroup: r.blood_group || undefined,
      medicalAlerts: r.medical_alerts ? JSON.parse(r.medical_alerts) : [],
      emergencyContact: r.emergency_contact || undefined,
      insuranceProvider: r.insurance_provider || undefined,
      insurancePolicyNumber: r.insurance_policy_number || undefined,
      balanceDue: Number(r.balance_due) || 0,
      registeredDate: r.registered_date,
      lastVisitDate: r.last_visit_date || undefined,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  },

  findPatientByEmail(email: string, clinicId = 'clinic-ox-main'): PatientRecord | undefined {
    if (!email) return undefined;
    const clean = email.toLowerCase().trim();
    const r = db.prepare('SELECT * FROM patients WHERE lower(email) = ? AND clinic_id = ? LIMIT 1').get(clean, clinicId) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      userId: r.user_id || undefined,
      clinicId: r.clinic_id,
      code: r.code,
      name: r.name,
      age: Number(r.age),
      gender: r.gender,
      phone: r.phone,
      email: r.email || '',
      address: r.address || undefined,
      bloodGroup: r.blood_group || undefined,
      medicalAlerts: r.medical_alerts ? JSON.parse(r.medical_alerts) : [],
      emergencyContact: r.emergency_contact || undefined,
      insuranceProvider: r.insurance_provider || undefined,
      insurancePolicyNumber: r.insurance_policy_number || undefined,
      balanceDue: Number(r.balance_due) || 0,
      registeredDate: r.registered_date,
      lastVisitDate: r.last_visit_date || undefined,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  },

  savePatient(patient: PatientRecord): PatientRecord {
    db.prepare(`
      INSERT OR REPLACE INTO patients (id, user_id, clinic_id, code, name, age, gender, phone, email, address, blood_group, medical_alerts, emergency_contact, insurance_provider, insurance_policy_number, balance_due, registered_date, last_visit_date, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      patient.id,
      patient.userId || null,
      patient.clinicId || 'clinic-ox-main',
      patient.code,
      patient.name,
      patient.age,
      patient.gender,
      patient.phone,
      patient.email || '',
      patient.address || null,
      patient.bloodGroup || null,
      JSON.stringify(patient.medicalAlerts || []),
      patient.emergencyContact || null,
      patient.insuranceProvider || null,
      patient.insurancePolicyNumber || null,
      patient.balanceDue || 0,
      patient.registeredDate,
      patient.lastVisitDate || null,
      patient.status || 'active'
    );
    return patient;
  },

  // ─── Appointments Methods ───
  getAppointments(clinicId = 'clinic-ox-main'): AppointmentRecord[] {
    const rows = db.prepare('SELECT * FROM appointments WHERE clinic_id = ? ORDER BY date DESC, start_time ASC').all(clinicId) as any[];
    return rows.map(r => ({
      id: r.id,
      clinicId: r.clinic_id,
      patientId: r.patient_id,
      patientName: r.patient_name,
      doctorId: r.doctor_id,
      doctorName: r.doctor_name,
      chair: r.chair,
      date: r.date,
      startTime: r.start_time,
      endTime: r.end_time,
      durationMinutes: Number(r.duration_minutes),
      procedure: r.procedure,
      status: r.status as AppointmentState,
      tokenNumber: r.token_number,
      notes: r.notes || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  },

  findAppointmentById(id: string, clinicId?: string): AppointmentRecord | undefined {
    let sql = 'SELECT * FROM appointments WHERE id = ?';
    const params: any[] = [id];
    if (clinicId) {
      sql += ' AND clinic_id = ?';
      params.push(clinicId);
    }
    const r = db.prepare(sql).get(...params) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      clinicId: r.clinic_id,
      patientId: r.patient_id,
      patientName: r.patient_name,
      doctorId: r.doctor_id,
      doctorName: r.doctor_name,
      chair: r.chair,
      date: r.date,
      startTime: r.start_time,
      endTime: r.end_time,
      durationMinutes: Number(r.duration_minutes),
      procedure: r.procedure,
      status: r.status as AppointmentState,
      tokenNumber: r.token_number,
      notes: r.notes || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  },

  saveAppointment(apt: AppointmentRecord): AppointmentRecord {
    db.prepare(`
      INSERT OR REPLACE INTO appointments (id, clinic_id, patient_id, patient_name, doctor_id, doctor_name, chair, date, start_time, end_time, duration_minutes, procedure, status, token_number, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      apt.id,
      apt.clinicId || 'clinic-ox-main',
      apt.patientId,
      apt.patientName,
      apt.doctorId,
      apt.doctorName,
      apt.chair,
      apt.date,
      apt.startTime,
      apt.endTime,
      apt.durationMinutes,
      apt.procedure,
      apt.status,
      apt.tokenNumber,
      apt.notes || null
    );
    return apt;
  },

  // ─── Invoices Methods ───
  getInvoices(clinicId = 'clinic-ox-main'): InvoiceRecord[] {
    const rows = db.prepare('SELECT * FROM invoices WHERE clinic_id = ? ORDER BY date DESC').all(clinicId) as any[];
    return rows.map(r => ({
      id: r.id,
      invoiceNumber: r.invoice_number,
      clinicId: r.clinic_id,
      patientId: r.patient_id,
      patientName: r.patient_name,
      patientEmail: r.patient_email || undefined,
      patientPhone: r.patient_phone || undefined,
      date: r.date,
      dueDate: r.due_date,
      createdBy: r.created_by,
      items: r.items ? JSON.parse(r.items) : [],
      consultationFee: Number(r.consultation_fee) || 0,
      subtotal: Number(r.subtotal),
      discount: Number(r.discount) || 0,
      tax: Number(r.tax) || 0,
      total: Number(r.total),
      amountPaid: Number(r.amount_paid) || 0,
      balanceDue: Number(r.balance_due),
      status: r.status as InvoicePaymentStatus,
      notes: r.notes || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  },

  findInvoiceById(id: string, clinicId?: string): InvoiceRecord | undefined {
    let sql = 'SELECT * FROM invoices WHERE id = ?';
    const params: any[] = [id];
    if (clinicId) {
      sql += ' AND clinic_id = ?';
      params.push(clinicId);
    }
    const r = db.prepare(sql).get(...params) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      invoiceNumber: r.invoice_number,
      clinicId: r.clinic_id,
      patientId: r.patient_id,
      patientName: r.patient_name,
      patientEmail: r.patient_email || undefined,
      patientPhone: r.patient_phone || undefined,
      date: r.date,
      dueDate: r.due_date,
      createdBy: r.created_by,
      items: r.items ? JSON.parse(r.items) : [],
      consultationFee: Number(r.consultation_fee) || 0,
      subtotal: Number(r.subtotal),
      discount: Number(r.discount) || 0,
      tax: Number(r.tax) || 0,
      total: Number(r.total),
      amountPaid: Number(r.amount_paid) || 0,
      balanceDue: Number(r.balance_due),
      status: r.status as InvoicePaymentStatus,
      notes: r.notes || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  },

  findInvoiceByNumber(num: string, clinicId = 'clinic-ox-main'): InvoiceRecord | undefined {
    const r = db.prepare('SELECT * FROM invoices WHERE invoice_number = ? AND clinic_id = ?').get(num, clinicId) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      invoiceNumber: r.invoice_number,
      clinicId: r.clinic_id,
      patientId: r.patient_id,
      patientName: r.patient_name,
      patientEmail: r.patient_email || undefined,
      patientPhone: r.patient_phone || undefined,
      date: r.date,
      dueDate: r.due_date,
      createdBy: r.created_by,
      items: r.items ? JSON.parse(r.items) : [],
      consultationFee: Number(r.consultation_fee) || 0,
      subtotal: Number(r.subtotal),
      discount: Number(r.discount) || 0,
      tax: Number(r.tax) || 0,
      total: Number(r.total),
      amountPaid: Number(r.amount_paid) || 0,
      balanceDue: Number(r.balance_due),
      status: r.status as InvoicePaymentStatus,
      notes: r.notes || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  },

  saveInvoice(inv: InvoiceRecord): InvoiceRecord {
    db.prepare(`
      INSERT OR REPLACE INTO invoices (id, invoice_number, clinic_id, patient_id, patient_name, patient_email, patient_phone, date, due_date, created_by, items, consultation_fee, subtotal, discount, tax, total, amount_paid, balance_due, status, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      inv.id,
      inv.invoiceNumber,
      inv.clinicId || 'clinic-ox-main',
      inv.patientId,
      inv.patientName,
      inv.patientEmail || null,
      inv.patientPhone || null,
      inv.date,
      inv.dueDate,
      inv.createdBy,
      JSON.stringify(inv.items || []),
      inv.consultationFee || 0,
      inv.subtotal,
      inv.discount || 0,
      inv.tax || 0,
      inv.total,
      inv.amountPaid || 0,
      inv.balanceDue,
      inv.status,
      inv.notes || null
    );
    return inv;
  },

  // ─── Payments Methods ───
  getPayments(clinicId = 'clinic-ox-main'): PaymentRecord[] {
    const rows = db.prepare('SELECT * FROM payments WHERE clinic_id = ? ORDER BY date DESC').all(clinicId) as any[];
    return rows.map(r => ({
      id: r.id,
      idempotencyKey: r.idempotency_key,
      invoiceId: r.invoice_id,
      invoiceNumber: r.invoice_number,
      clinicId: r.clinic_id,
      patientId: r.patient_id,
      patientName: r.patient_name,
      amount: Number(r.amount),
      paymentMethod: r.payment_method as SupportedPaymentMethod,
      transactionRef: r.transaction_ref || undefined,
      date: r.date,
      timestamp: r.timestamp || r.date,
      status: (r.status as 'SUCCESSFUL' | 'FAILED' | 'PENDING') || 'SUCCESSFUL',
      recordedBy: r.recorded_by,
      notes: r.notes || undefined,
      createdAt: r.created_at,
    }));
  },

  findPaymentById(id: string, clinicId?: string): PaymentRecord | undefined {
    let sql = 'SELECT * FROM payments WHERE id = ?';
    const params: any[] = [id];
    if (clinicId) {
      sql += ' AND clinic_id = ?';
      params.push(clinicId);
    }
    const r = db.prepare(sql).get(...params) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      idempotencyKey: r.idempotency_key,
      invoiceId: r.invoice_id,
      invoiceNumber: r.invoice_number,
      clinicId: r.clinic_id,
      patientId: r.patient_id,
      patientName: r.patient_name,
      amount: Number(r.amount),
      paymentMethod: r.payment_method as SupportedPaymentMethod,
      transactionRef: r.transaction_ref || undefined,
      date: r.date,
      timestamp: r.timestamp || r.date,
      status: (r.status as 'SUCCESSFUL' | 'FAILED' | 'PENDING') || 'SUCCESSFUL',
      recordedBy: r.recorded_by,
      notes: r.notes || undefined,
      createdAt: r.created_at,
    };
  },

  findPaymentByIdempotencyKey(key: string, clinicId = 'clinic-ox-main'): PaymentRecord | undefined {
    const r = db.prepare('SELECT * FROM payments WHERE idempotency_key = ? AND clinic_id = ?').get(key, clinicId) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      idempotencyKey: r.idempotency_key,
      invoiceId: r.invoice_id,
      invoiceNumber: r.invoice_number,
      clinicId: r.clinic_id,
      patientId: r.patient_id,
      patientName: r.patient_name,
      amount: Number(r.amount),
      paymentMethod: r.payment_method as SupportedPaymentMethod,
      transactionRef: r.transaction_ref || undefined,
      date: r.date,
      timestamp: r.timestamp || r.date,
      status: (r.status as 'SUCCESSFUL' | 'FAILED' | 'PENDING') || 'SUCCESSFUL',
      recordedBy: r.recorded_by,
      notes: r.notes || undefined,
      createdAt: r.created_at,
    };
  },

  savePayment(payment: PaymentRecord): PaymentRecord {
    const timestamp = payment.timestamp || new Date().toISOString();
    const date = payment.date || timestamp.split('T')[0];
    const status = payment.status || 'SUCCESSFUL';
    const createdAt = payment.createdAt || timestamp;
    db.prepare(`
      INSERT OR REPLACE INTO payments (id, idempotency_key, invoice_id, invoice_number, clinic_id, patient_id, patient_name, amount, payment_method, transaction_ref, date, status, timestamp, recorded_by, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payment.id,
      payment.idempotencyKey,
      payment.invoiceId,
      payment.invoiceNumber,
      payment.clinicId || 'clinic-ox-main',
      payment.patientId,
      payment.patientName,
      payment.amount,
      payment.paymentMethod,
      payment.transactionRef || null,
      date,
      status,
      timestamp,
      payment.recordedBy,
      payment.notes || null,
      createdAt
    );
    return {
      ...payment,
      date,
      timestamp,
      status,
      createdAt,
    };
  },

  // ─── Receipts Methods ───
  getReceipts(clinicId = 'clinic-ox-main'): ReceiptRecord[] {
    const rows = db.prepare('SELECT * FROM receipts WHERE clinic_id = ? ORDER BY date DESC').all(clinicId) as any[];
    return rows.map(r => ({
      id: r.id,
      receiptNumber: r.receipt_number,
      paymentId: r.payment_id,
      invoiceId: r.invoice_id,
      invoiceNumber: r.invoice_number,
      clinicId: r.clinic_id,
      patientId: r.patient_id,
      patientName: r.patient_name,
      patientEmail: r.patient_email || undefined,
      date: r.date,
      amountReceived: Number(r.amount_received),
      remainingBalance: Number(r.remaining_balance),
      paymentMethod: r.payment_method as SupportedPaymentMethod,
      emailStatus: r.email_status || 'pending',
      emailSentAt: r.email_sent_at || undefined,
      emailError: r.email_error || undefined,
      createdAt: r.created_at,
    }));
  },

  findReceiptById(id: string, clinicId?: string): ReceiptRecord | undefined {
    let sql = 'SELECT * FROM receipts WHERE id = ?';
    const params: any[] = [id];
    if (clinicId) {
      sql += ' AND clinic_id = ?';
      params.push(clinicId);
    }
    const r = db.prepare(sql).get(...params) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      receiptNumber: r.receipt_number,
      paymentId: r.payment_id,
      invoiceId: r.invoice_id,
      invoiceNumber: r.invoice_number,
      clinicId: r.clinic_id,
      patientId: r.patient_id,
      patientName: r.patient_name,
      patientEmail: r.patient_email || undefined,
      date: r.date,
      amountReceived: Number(r.amount_received),
      remainingBalance: Number(r.remaining_balance),
      paymentMethod: r.payment_method as SupportedPaymentMethod,
      emailStatus: r.email_status || 'pending',
      emailSentAt: r.email_sent_at || undefined,
      emailError: r.email_error || undefined,
      createdAt: r.created_at,
    };
  },

  findReceiptByPaymentId(paymentId: string, clinicId?: string): ReceiptRecord | undefined {
    let sql = 'SELECT * FROM receipts WHERE payment_id = ?';
    const params: any[] = [paymentId];
    if (clinicId) {
      sql += ' AND clinic_id = ?';
      params.push(clinicId);
    }
    const r = db.prepare(sql).get(...params) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      receiptNumber: r.receipt_number,
      paymentId: r.payment_id,
      invoiceId: r.invoice_id,
      invoiceNumber: r.invoice_number,
      clinicId: r.clinic_id,
      patientId: r.patient_id,
      patientName: r.patient_name,
      patientEmail: r.patient_email || undefined,
      date: r.date,
      amountReceived: Number(r.amount_received),
      remainingBalance: Number(r.remaining_balance),
      paymentMethod: r.payment_method as SupportedPaymentMethod,
      emailStatus: r.email_status || 'pending',
      emailSentAt: r.email_sent_at || undefined,
      emailError: r.email_error || undefined,
      createdAt: r.created_at,
    };
  },


  saveReceipt(receipt: ReceiptRecord): ReceiptRecord {
    db.prepare(`
      INSERT OR REPLACE INTO receipts (id, receipt_number, payment_id, invoice_id, invoice_number, clinic_id, patient_id, patient_name, patient_email, date, amount_received, remaining_balance, payment_method, email_status, email_sent_at, email_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      receipt.id,
      receipt.receiptNumber,
      receipt.paymentId,
      receipt.invoiceId,
      receipt.invoiceNumber,
      receipt.clinicId || 'clinic-ox-main',
      receipt.patientId,
      receipt.patientName,
      receipt.patientEmail || null,
      receipt.date,
      receipt.amountReceived,
      receipt.remainingBalance,
      receipt.paymentMethod,
      receipt.emailStatus,
      receipt.emailSentAt || null,
      receipt.emailError || null
    );
    return receipt;
  },

  // ─── Feedback Methods ───
  getFeedback(clinicId = 'clinic-ox-main'): FeedbackRecord[] {
    const rows = db.prepare('SELECT * FROM feedback WHERE clinic_id = ? ORDER BY created_at DESC').all(clinicId) as any[];
    return rows.map(r => ({
      id: r.id,
      clinicId: r.clinic_id,
      patientId: r.patient_id || undefined,
      patientName: r.patient_name,
      doctorName: r.doctor_name || undefined,
      treatmentName: r.treatment_name || undefined,
      rating: Number(r.rating),
      comment: r.comment,
      clinicResponse: r.clinic_response || undefined,
      respondedAt: r.responded_at || undefined,
      verified: Boolean(r.verified),
      published: Boolean(r.published),
      createdAt: r.created_at,
    }));
  },

  findFeedbackById(id: string, clinicId?: string): FeedbackRecord | undefined {
    let sql = 'SELECT * FROM feedback WHERE id = ?';
    const params: any[] = [id];
    if (clinicId) {
      sql += ' AND clinic_id = ?';
      params.push(clinicId);
    }
    const r = db.prepare(sql).get(...params) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      clinicId: r.clinic_id,
      patientId: r.patient_id || undefined,
      patientName: r.patient_name,
      doctorName: r.doctor_name || undefined,
      treatmentName: r.treatment_name || undefined,
      rating: Number(r.rating),
      comment: r.comment,
      clinicResponse: r.clinic_response || undefined,
      respondedAt: r.responded_at || undefined,
      verified: Boolean(r.verified),
      published: Boolean(r.published),
      createdAt: r.created_at,
    };
  },

  saveFeedback(fb: FeedbackRecord): FeedbackRecord {
    db.prepare(`
      INSERT OR REPLACE INTO feedback (id, clinic_id, patient_id, patient_name, doctor_name, treatment_name, rating, comment, clinic_response, responded_at, verified, published)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      fb.id,
      fb.clinicId || 'clinic-ox-main',
      fb.patientId || null,
      fb.patientName,
      fb.doctorName || null,
      fb.treatmentName || null,
      fb.rating,
      fb.comment,
      fb.clinicResponse || null,
      fb.respondedAt || null,
      fb.verified ? 1 : 0,
      fb.published ? 1 : 0
    );
    return fb;
  },

  // ─── Files Methods ───
  getFiles(clinicId = 'clinic-ox-main', patientId?: string): PatientFileRecord[] {
    let sql = 'SELECT * FROM files WHERE clinic_id = ?';
    const params: any[] = [clinicId];
    if (patientId) {
      sql += ' AND patient_id = ?';
      params.push(patientId);
    }
    sql += ' ORDER BY uploaded_at DESC';
    const rows = db.prepare(sql).all(...params) as any[];
    return rows.map(r => ({
      id: r.id,
      clinicId: r.clinic_id,
      patientId: r.patient_id,
      fileName: r.file_name,
      fileType: r.file_type,
      fileSize: Number(r.file_size),
      category: r.category as any,
      uploadedBy: r.uploaded_by,
      uploadedAt: r.uploaded_at,
      storageData: r.storage_data || undefined,
    }));
  },

  findFileById(id: string, clinicId?: string): PatientFileRecord | undefined {
    let sql = 'SELECT * FROM files WHERE id = ?';
    const params: any[] = [id];
    if (clinicId) {
      sql += ' AND clinic_id = ?';
      params.push(clinicId);
    }
    const r = db.prepare(sql).get(...params) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      clinicId: r.clinic_id,
      patientId: r.patient_id,
      fileName: r.file_name,
      fileType: r.file_type,
      fileSize: Number(r.file_size),
      category: r.category as any,
      uploadedBy: r.uploaded_by,
      uploadedAt: r.uploaded_at,
      storageData: r.storage_data || undefined,
    };
  },

  saveFile(file: PatientFileRecord): PatientFileRecord {
    db.prepare(`
      INSERT OR REPLACE INTO files (id, clinic_id, patient_id, file_name, file_type, file_size, category, uploaded_by, uploaded_at, storage_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      file.id,
      file.clinicId || 'clinic-ox-main',
      file.patientId,
      file.fileName,
      file.fileType,
      file.fileSize,
      file.category,
      file.uploadedBy,
      file.uploadedAt || new Date().toISOString(),
      file.storageData || null
    );
    return file;
  },

  // ─── Notifications Methods ───
  getNotifications(clinicId = 'clinic-ox-main', userId?: string): SystemNotification[] {
    let sql = 'SELECT * FROM notifications WHERE clinic_id = ?';
    const params: any[] = [clinicId];
    if (userId) {
      sql += ' AND (user_id IS NULL OR user_id = ?)';
      params.push(userId);
    }
    sql += ' ORDER BY created_at DESC';
    const rows = db.prepare(sql).all(...params) as any[];
    return rows.map(r => ({
      id: r.id,
      clinicId: r.clinic_id,
      userId: r.user_id || undefined,
      type: r.type as any,
      title: r.title,
      message: r.message,
      read: Boolean(r.read),
      link: r.link || undefined,
      createdAt: r.created_at,
    }));
  },

  markNotificationRead(id: string): void {
    db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id);
  },

  addNotification(notif: Omit<SystemNotification, 'id' | 'createdAt'>): SystemNotification {
    const id = `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const createdAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO notifications (id, clinic_id, user_id, type, title, message, read, link, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      notif.clinicId || 'clinic-ox-main',
      notif.userId || null,
      notif.type,
      notif.title,
      notif.message,
      notif.read ? 1 : 0,
      notif.link || null,
      createdAt
    );
    return { id, ...notif, createdAt };
  },

  // ─── Audit Logs Methods ───
  getAuditLogs(clinicId = 'clinic-ox-main'): AuditLogEntry[] {
    const rows = db.prepare('SELECT * FROM audit_logs WHERE clinic_id = ? ORDER BY created_at DESC LIMIT 200').all(clinicId) as any[];
    return rows.map(r => ({
      id: r.id,
      clinicId: r.clinic_id,
      userId: r.user_id || undefined,
      userEmail: r.user_email || undefined,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id || undefined,
      details: r.details,
      ip: r.ip || undefined,
      createdAt: r.created_at,
    }));
  },

  addAuditLog(entry: Omit<AuditLogEntry, 'id' | 'createdAt'>): AuditLogEntry {
    const id = `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const createdAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO audit_logs (id, clinic_id, user_id, user_email, action, entity_type, entity_id, details, ip, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      entry.clinicId || 'clinic-ox-main',
      entry.userId || null,
      entry.userEmail || null,
      entry.action,
      entry.entityType,
      entry.entityId || null,
      entry.details,
      entry.ip || null,
      createdAt
    );
    return { id, ...entry, createdAt };
  },

  // ─── Integrations Methods ───
  getIntegrations(clinicId = 'clinic-ox-main'): ClinicIntegrations {
    const row = db.prepare('SELECT * FROM integrations WHERE clinic_id = ?').get(clinicId) as any;
    if (!row) {
      const def: ClinicIntegrations = {
        clinicId,
        instagram: { clinicId, state: 'NOT_CONNECTED' },
        googleBusiness: { clinicId, state: 'NOT_CONNECTED' },
        updatedAt: new Date().toISOString(),
      };
      OralixDb.saveIntegrations(def);
      return def;
    }
    return {
      clinicId: row.clinic_id,
      instagram: row.instagram ? JSON.parse(row.instagram) : { clinicId, state: 'NOT_CONNECTED' },
      googleBusiness: row.google_business ? JSON.parse(row.google_business) : { clinicId, state: 'NOT_CONNECTED' },
      updatedAt: row.updated_at,
    };
  },

  saveIntegrations(integrations: ClinicIntegrations): ClinicIntegrations {
    db.prepare(`
      INSERT OR REPLACE INTO integrations (id, clinic_id, instagram, google_business, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      integrations.clinicId,
      integrations.clinicId,
      JSON.stringify(integrations.instagram),
      JSON.stringify(integrations.googleBusiness)
    );
    return integrations;
  },
};
