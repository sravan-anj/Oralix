# Dentiflow Gmail Integration Guide

This guide describes the complete Gmail Edge Function integration for connecting clinic doctors' Gmail accounts and dispatching automated transactional emails (billing receipts, appointments, and treatment plans) via the Google Gmail API.

Refer to [`supabase/functions/send-gmail/README.md`](../supabase/functions/send-gmail/README.md) and [`supabase/functions/google-gmail-oauth/README.md`](../supabase/functions/google-gmail-oauth/README.md) for individual Edge Function documentation.

---

## Architecture

```
Doctor Dashboard (Dentiflow UI)
       │
       ▼ [Click "Connect Gmail"]
Supabase Edge Function: google-gmail-oauth
       │ (Verifies doctor JWT session & creates HMAC-signed state)
       ▼
Google OAuth 2.0 Consent Screen
       │ (Doctor grants gmail.send permission)
       ▼
Google OAuth Callback (google-gmail-oauth?code=...&state=...)
       │
       ├─► 1. Verifies signed HMAC state parameter (validates authenticity & prevents CSRF)
       ├─► 2. Exchanges code server-side using GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET
       ├─► 3. Obtains access_token and refresh_token
       ├─► 4. Queries userinfo to fetch connected Gmail address
       ├─► 5. Upserts connection into public.gmail_connections table (never exposed to browser)
       └─► 6. Redirects doctor back to Doctor Dashboard with ?gmail_status=connected
              │
              ▼
Doctor Dashboard shows: "✓ Gmail Connected" [doctor@clinic.com] [Reconnect Gmail]
```

---

## Security Model

1. **Refresh Token Isolation**:
   - Stored exclusively in PostgreSQL table `public.gmail_connections` with `ROW LEVEL SECURITY` enabled.
   - Column-level privileges revoke `SELECT (refresh_token)` from `authenticated`, `anon`, and `public`.
   - React frontend NEVER receives or queries the refresh token.
   - Refresh token is NEVER logged in console or included in URL parameters.
2. **Tamper-Proof State Parameter**:
   - Edge function generates an HMAC-SHA256 signature containing doctor `userId`, `userEmail`, `returnUrl`, and timestamp.
   - Forged or expired (>30 minutes) state payloads are immediately rejected.
3. **Per-Doctor Connection**:
   - Each connection is unique per doctor (`UNIQUE(user_id)`). Reconnecting updates the existing connection without creating duplicate rows.
   - Doctor A cannot read or modify Doctor B's connection metadata.
4. **Sending Emails**:
   - `send-gmail` edge function validates the calling doctor session and retrieves their active refresh token directly from `gmail_connections`.

---

## Canonical Redirect URI

Add the exact redirect URI to your Google Cloud Console project under **APIs & Services > Credentials > Authorized redirect URIs**:

```
https://iycnohkobazaduldxiqc.supabase.co/functions/v1/google-gmail-oauth
```

---

## Database Migration

The dedicated table is defined in `supabase/migrations/20261005224000_create_gmail_connections.sql`:

```sql
CREATE TABLE IF NOT EXISTS public.gmail_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  refresh_token TEXT NOT NULL,
  scope TEXT DEFAULT 'https://www.googleapis.com/auth/gmail.send',
  status TEXT DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected', 'revoked')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Automated Verification Suites

Run the automated suites at any time:

```bash
# Verify complete Connect Gmail flow, HMAC signing, RLS isolation & secret leak prevention
npm run test:gmail:flow

# Verify OAuth parameters and scope minimization
npm run test:oauth

# Verify email MIME generation, RFC 2822 formatting and header injection protection
npm run test:gmail
```
