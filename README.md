# DentiFlow / Oralix — Dental Practice Management Platform

This repository is strictly separated into dedicated **frontend** and **backend** applications.

## Directory Structure

```
.
├── frontend/    # Client application (React 19, TypeScript, Tailwind CSS, Vite)
├── backend/     # API server & database (Node.js, Express, TypeScript, PBKDF2 Auth)
├── package.json # Root workspace manager
└── README.md
```

---

## 🚀 Running the Projects

### 1. Frontend
```bash
cd frontend
npm install
npm run dev
```
Runs the frontend development server on `http://localhost:3000`.

### 2. Backend
```bash
cd backend
npm install
npm run dev
```
Runs the Express API server on `http://localhost:3001`.

### 3. Running from Root
You can also run commands directly from the root workspace:
- Start frontend: `npm run dev:frontend`
- Start backend: `npm run dev:backend`
- Build frontend: `npm run build:frontend`
- Test backend: `npm test` (Runs 76/76 automated auth and domain tests)

---

## 🌐 Production Deployment Architecture

```
                    ┌─────────────────────────┐
                    │      Oralix Users       │
                    └────────────┬────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 │                               │
        HTTPS (Frontend)                HTTPS (API / Cookies)
                 ▼                               ▼
     ┌───────────────────────┐       ┌───────────────────────┐
     │        Vercel         │       │  Node.js API Server   │
     │  https://oralix.online│       │https://api.oralix.online
     └───────────────────────┘       └───────────┬───────────┘
                                                 │
                                     ┌───────────┴───────────┐
                                     │   SQLite / Supabase   │
                                     │  Unified Persistence  │
                                     └───────────────────────┘
```

### 1. Frontend Deployment (Vercel)
- **Deployment Platform**: Vercel SPA deployment.
- **Root Directory**: `frontend/` (configured in `vercel.json` with SPA routing `/* -> /index.html`).
- **Domain**: `https://oralix.online` (or `https://www.oralix.online`).
- **Environment Variables**:
  - `VITE_API_URL`: `https://api.oralix.online` (points to the real backend deployment).
  - `VITE_APP_URL`: `https://oralix.online`
  - `VITE_SUPABASE_URL`: `https://iycnohkobazaduldxiqc.supabase.co`
  - `VITE_SUPABASE_ANON_KEY`: `<your-supabase-anon-key>`
  - `VITE_RAZORPAY_KEY_ID`: `<optional-razorpay-key>`

### 2. Backend Deployment (Persistent Node.js / Express)
- **Deployment Platform**: Persistent Node.js 20+ runtime (e.g. Render, Railway, Fly.io, AWS ECS, or Cloud Run).
- **Domain**: `https://api.oralix.online`
- **Environment Variables**:
  - `NODE_ENV`: `production`
  - `API_PORT`: `3001` (or port provided by host `$PORT`)
  - `FRONTEND_URL`: `https://oralix.online`
  - `APP_URL`: `https://oralix.online`
  - `RESEND_API_KEY`: `<your-production-resend-api-key>`
  - `MAIL_FROM`: `Oralix <noreply@oralix.online>`
  - `EMAIL_FROM`: `Oralix <noreply@oralix.online>`
  - `SESSION_SECRET`: `<secure-random-64-character-string>`
  - `AUTH_SECRET`: `<secure-random-64-character-string>`
  - `PASSWORD_RESET_SECRET`: `<secure-random-64-character-string>`
  - `FLASK_SECRET_KEY`: `<secure-random-64-character-string>`
  - `INITIAL_ADMIN_EMAIL`: `<admin-official-email>` (provisions initial admin safely on startup)
  - `INITIAL_ADMIN_PASSWORD`: `<strong-initial-password>`

### 3. Database Persistence
- Relational SQLite persistence engine located in `backend/data/oralix.db`.
- Contains automated legacy migration, foreign key enforcement, WAL mode, and indexes.
- Equivalent Postgres / Supabase migration script available at `supabase/migrations/20261003000000_init_oralix_schema.sql` and `backend/migrations/001_initial_schema.sql`.

### 4. CORS Allowlist
The backend enforces an explicit CORS origin allowlist:
- `https://oralix.online`
- `https://www.oralix.online`
- `http://localhost:3000`
- Configured with `credentials: true` for secure, cross-site HttpOnly session cookies (`oralix_session`).

### 5. Resend Email Delivery
- Production sender: `Oralix <noreply@oralix.online>`.
- Generates 30-minute single-use HMAC-SHA256 password reset tokens.
- All reset links are derived strictly from `FRONTEND_URL`: `https://oralix.online/reset-password?token=...`.
- Verified external dispatch via Resend API.

### 6. Supabase / Google OAuth Redirects
In your Supabase project dashboard (**Authentication > URL Configuration**):
- **Site URL**: `https://oralix.online`
- **Redirect URLs**:
  - `https://oralix.online/auth/callback`
  - `http://localhost:3000/auth/callback` (for local development)
Google OAuth sessions are securely synchronized with the Oralix backend via `POST /api/auth/oauth/google`, strictly assigning the `patient` role and issuing an authoritative HttpOnly session cookie.

### 7. Verification & Health Monitoring
Verify service health:
```bash
curl -I https://api.oralix.online/api/health
```
Expected response:
```json
{
  "ok": true,
  "service": "oralix-auth",
  "domain": "oralix.online",
  "status": "healthy",
  "database": "connected"
}
```
