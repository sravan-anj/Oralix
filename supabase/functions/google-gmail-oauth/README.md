# Supabase Edge Function: `google-gmail-oauth`

The `google-gmail-oauth` Edge Function is a dedicated, separate backend utility specifically designed for the **one-time Google OAuth authorization** of the clinic's Gmail account.

It is **NOT** responsible for sending emails. Its sole responsibility is to handle the OAuth consent flow, obtain the authorization code, exchange it with Google, and secure the long-lived refresh token used subsequently by [`send-gmail`](../send-gmail/README.md).

---

## Google Cloud Console Configuration

### Canonical Redirect URI

Add the exact redirect URI to your Google Cloud Console project:

```
https://iycnohkobazaduldxiqc.supabase.co/functions/v1/google-gmail-oauth
```

**Where to configure in Google Cloud Console:**
1. Navigate to: **APIs & Services** > **Credentials**.
2. Select your **OAuth 2.0 Client ID** (Web application).
3. Under **Authorized redirect URIs**, add:
   `https://iycnohkobazaduldxiqc.supabase.co/functions/v1/google-gmail-oauth`
4. Click **Save**.

---

## Complete OAuth Workflow

```
1. Setup Initiation
   Developer/Admin navigates to:
   https://iycnohkobazaduldxiqc.supabase.co/functions/v1/google-gmail-oauth

2. Google Authorization Consent
   Edge Function redirects browser to Google OAuth:
   https://accounts.google.com/o/oauth2/v2/auth
   • client_id: <GOOGLE_CLIENT_ID>
   • redirect_uri: https://iycnohkobazaduldxiqc.supabase.co/functions/v1/google-gmail-oauth
   • scope: https://www.googleapis.com/auth/gmail.send
   • access_type: offline
   • prompt: consent

3. Clinic Consent
   Clinic Gmail account owner logs in and grants permission.

4. Google Callback
   Google redirects to:
   https://iycnohkobazaduldxiqc.supabase.co/functions/v1/google-gmail-oauth?code=...

5. Server-Side Token Exchange
   Edge Function validates authorization code and exchanges with:
   https://oauth2.googleapis.com/token
   • grant_type: authorization_code

6. Refresh Token Storage
   Google returns access_token and refresh_token.
   • The refresh_token is NEVER displayed in the browser or logged.
   • The function securely persists the refresh token in PostgreSQL table `public.gmail_connections`
     associated directly with the authenticated doctor's user ID.
   • Row-Level Security and Column-Level Permissions prevent the client/browser from reading the token.

7. Email Sending (Routine Operations)
   Existing `send-gmail` function uses the doctor's stored refresh token to send patient invoices.
```

---

## Required Supabase Secrets

Before initiating authorization, configure the following secrets in Supabase:

| Secret Name | Required For |
| :--- | :--- |
| `GOOGLE_CLIENT_ID` | OAuth authorization initiation and token exchange |
| `GOOGLE_CLIENT_SECRET` | Token exchange with Google token endpoint |
| `SUPABASE_ACCESS_TOKEN` | *(Optional)* Enables automated saving of `GOOGLE_REFRESH_TOKEN` directly into Supabase Secrets |

Set via CLI:
```bash
supabase secrets set GOOGLE_CLIENT_ID="<client_id>" GOOGLE_CLIENT_SECRET="<client_secret>"
```

---

## How to Deploy

Deploy the function using the Supabase CLI:

```bash
supabase functions deploy google-gmail-oauth --no-verify-jwt
```

*(Note: `--no-verify-jwt` is required so Google's browser callback with `?code=...` can reach the function without requiring a Supabase JWT).*
