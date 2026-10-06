# Supabase Edge Function: `send-gmail`

The `send-gmail` Edge Function serves as the secure backend communication bridge between the Dentiflow application and the Google Gmail API. It enables Dentiflow to send clinic-authenticated transactional emails—such as patient invoices/receipts, payment confirmations, and appointment notifications—without exposing any private credentials to the frontend.

---

## Architecture Overview

```
Dentiflow React Frontend
        │
        ▼ (HTTPS POST + Supabase User JWT)
Supabase Edge Function (`send-gmail`)
        │
        ├─► Validates Request & Input (RFC 5322 & Header Injection Checks)
        ├─► Verifies Supabase Authentication (User Session / Service Key)
        ├─► Obtains/Refreshes Google Access Token (Server-to-Server OAuth 2.0)
        ├─► Constructs RFC 2822 / MIME Email & Encodes to Base64URL
        │
        ▼ (HTTPS POST + Google Bearer Token)
Google Gmail API (`/users/me/messages/send`)
        │
        ▼
Clinic Authorized Gmail Account (Dispatches Email to Patient)
```

---

## 1. What `send-gmail` Does

- **Server-Side Security**: All Google credentials and email dispatch logic reside exclusively on the server in Deno Edge Runtime.
- **Automated Token Refresh**: Obtains fresh Google access tokens on demand using a long-lived OAuth refresh token. No clinic staff need to re-login to Google during daily operations.
- **Warm Isolate In-Memory Caching**: Caches the ephemeral Google access token in memory while valid (approx. 1 hour) to minimize API roundtrips.
- **Request Validation & Security**:
  - Enforces HTTP `POST`.
  - Validates recipient email syntax and ensures required fields (`to`, `subject`, `body`) are non-empty.
  - Sanitizes against CRLF email header injection attacks.
  - Returns standardized JSON responses with proper HTTP status codes.
- **MIME & Unicode Handling**:
  - Encodes subjects using RFC 2047 for full Unicode and currency symbol support (e.g., `₹`, `🦷`).
  - Supports plain text bodies as well as rich HTML (`multipart/alternative` fallback).
  - Encodes message buffers into URL-safe Base64 without padding (RFC 4648 § 5) as expected by the Gmail API.
- **Safe Auditing & Diagnostics**: Logs only operational metadata (message IDs, HTTP error codes) and **never** logs patient clinical data, email contents, access tokens, or refresh tokens.

---

## 2. Required Supabase Secrets

The following environment variables must be stored in Supabase Secrets (never in `.env` files or Git):

| Secret Name | Description |
| :--- | :--- |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 Client ID generated in Google Cloud Console. |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 Client Secret generated in Google Cloud Console. |
| `GOOGLE_REFRESH_TOKEN` | Long-lived OAuth refresh token authorized once for the clinic Gmail account. |

*(Standard Supabase variables `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are automatically provided by the Supabase Edge Runtime).*

---

## 3. Required Google Cloud OAuth Credentials

To configure the Google integration:

1. Visit the [Google Cloud Console](https://console.cloud.google.com/).
2. Select or create a project (e.g., `Dentiflow-Clinic`).
3. Navigate to **APIs & Services** > **Library** and enable the **Gmail API**.
4. Navigate to **APIs & Services** > **OAuth consent screen**:
   - User Type: **External** (or **Internal** if using Google Workspace).
   - Add App name (e.g., `Dentiflow`), user support email, and developer contact.
   - Add the scope: `https://www.googleapis.com/auth/gmail.send`.
   - Under **Test Users**, add the clinic's Gmail address.
5. Navigate to **APIs & Services** > **Credentials**:
   - Click **Create Credentials** > **OAuth client ID**.
   - Application type: **Web application**.
   - Name: `Dentiflow Clinic Mailer`.
   - **Authorized redirect URIs**:
     - `http://localhost:8085/callback` (used by the setup script)
     - `https://developers.google.com/oauthplayground` (if using OAuth Playground)
6. Copy the generated **Client ID** and **Client Secret**.

---

## 4. One-Time Clinic Gmail Authorization

Dentiflow does **NOT** use a frontend "Connect Google" button. The clinic authorizes its Gmail account once during setup to produce a long-lived refresh token.

### Option A: Using the Dentiflow Setup Script (Recommended)

Dentiflow includes an automated CLI helper to obtain the refresh token:

```bash
# In the project directory:
npx tsx scripts/authorize_gmail.ts
```

1. Enter your `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` when prompted.
2. The script provides an authorization URL. Open it in a browser where the clinic Gmail account is signed in.
3. Grant permission to send emails on the clinic's behalf.
4. The local listener catches the callback and outputs the exact `supabase secrets set` command.

### Option B: Using Google OAuth 2.0 Playground

1. Go to [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
2. Click the gear icon (⚙️) in the upper right:
   - Check **Use your own OAuth credentials**.
   - Enter your **OAuth Client ID** and **OAuth Client Secret**.
3. Under **Step 1 (Select & authorize APIs)**, input the scope:
   `https://www.googleapis.com/auth/gmail.send`
4. Click **Authorize APIs** and log into the clinic's Gmail account.
5. Under **Step 2 (Exchange authorization code for tokens)**, click **Exchange authorization code for tokens**.
6. Copy the value in the **Refresh token** field.

---

## 5. How Secrets are Stored Securely

Once you have your credentials, store them directly in Supabase's encrypted secrets vault.

### Via Supabase CLI:

```bash
supabase secrets set \
  GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com" \
  GOOGLE_CLIENT_SECRET="your-client-secret" \
  GOOGLE_REFRESH_TOKEN="your-refresh-token"
```

### Via Supabase Dashboard:

1. Open your Supabase Dashboard: `https://supabase.com/dashboard/project/iycnohkobazaduldxiqc`
2. Navigate to **Project Settings** > **Edge Functions**.
3. Under **Function Secrets**, click **Add new secret** for each variable (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`).

> **Security Rule**: Never commit these secrets into `.env`, code repositories, or frontend variables (`VITE_*`).

---

## 6. How the Frontend Calls the Edge Function

When a feature (such as billing or receptionist) is ready to send an email, it calls the function using the Supabase client:

```typescript
import { supabase } from './utils/supabaseClient';

async function sendPatientReceipt(patientEmail: string, invoiceNumber: string, amount: number) {
  const { data, error } = await supabase.functions.invoke('send-gmail', {
    body: {
      to: patientEmail,
      subject: `Dentiflow Receipt #${invoiceNumber}`,
      body: `Thank you for your visit. We have received your payment of ₹${amount}.`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
          <h2 style="color: #0d9488;">Dentiflow Dental Care</h2>
          <p>Dear Patient,</p>
          <p>Thank you for choosing our clinic. Your payment has been received successfully.</p>
          <div style="background: #f1f5f9; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p><strong>Invoice:</strong> #${invoiceNumber}</p>
            <p><strong>Amount Paid:</strong> ₹${amount.toLocaleString()}</p>
            <p><strong>Status:</strong> Paid</p>
          </div>
          <p style="font-size: 12px; color: #64748b;">This is an automated notification from Dentiflow Clinic.</p>
        </div>
      `,
      fromName: 'Dentiflow Dental Clinic',
    },
  });

  if (error) {
    console.error('Failed to send email:', error);
    return { success: false, error: error.message };
  }

  console.log('Email sent successfully. Message ID:', data.messageId);
  return { success: true, messageId: data.messageId };
}
```

### API Request Schema

- **Method**: `POST`
- **Headers**:
  - `Content-Type: application/json`
  - `Authorization: Bearer <supabase_access_token>`
- **Body**:
  ```json
  {
    "to": "patient@example.com",
    "subject": "Your Dentiflow Receipt",
    "body": "Your payment has been received.",
    "html": "<h1>Receipt</h1><p>Your payment has been received.</p>",
    "fromName": "Dentiflow Clinic"
  }
  ```

### API Response Schema

#### Success (HTTP 200)
```json
{
  "success": true,
  "messageId": "18fa24b910ca8b01"
}
```

#### Error (HTTP 4xx / 5xx)
```json
{
  "success": false,
  "error": "Malformed recipient email address."
}
```

---

## 7. How to Deploy the Function

### 1. Link Project (if not already linked)

```bash
supabase link --project-ref iycnohkobazaduldxiqc
```

### 2. Deploy `send-gmail`

```bash
supabase functions deploy send-gmail --no-verify-jwt
```

*(Note: JWT verification is handled inside `index.ts` to allow standard CORS preflight negotiation and clean JSON error responses).*

### 3. Verify Deployed Status

```bash
supabase functions list
```
