# Oralix — Backend API & Persistence Server

Node.js, TypeScript, and Express REST API backend for Oralix Dental Practice Platform.

## Features
- **Authentication & RBAC:** PBKDF2-SHA256 password hashing (210,000 iterations), HttpOnly session cookies, role verification (Patient, Doctor, Admin, Receptionist).
- **Password Reset:** Cryptographic HMAC-SHA256 token hashing, 30-minute expiration, single-use enforcement, email delivery via Resend API (`noreply@oralix.online`).
- **Google OAuth Synchronization:** Backend session mapping with strict `patient` role enforcement.
- **Relational Persistence:** SQLite relational persistence engine (`backend/data/oralix.db`) with WAL mode, foreign keys, transactions, and migration tools.
- **Billing & Digital Receipts:** Invoice calculation, payment idempotency, balance tracking, and PDF receipts.
- **Appointments & Conflicts:** Double-booking prevention and status state machine.
- **Files & Scoping:** Strict MIME type validation, file size limits, and patient-scoped access control.

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```

### 3. Run Development Server
```bash
npm run dev
```
The server will run on `http://localhost:3001`.

### 4. Run Automated Tests
```bash
npm run test
```
Runs both the authentication test suite (`test_auth.ts`) and the domain matrix validation suite (`test_domain_matrix.ts`).
