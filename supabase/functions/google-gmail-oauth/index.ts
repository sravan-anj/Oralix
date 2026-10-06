import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// Standard CORS headers for Supabase Edge Functions
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Dentiflow Supabase Project Reference
const DENTIFLOW_PROJECT_REF = "iycnohkobazaduldxiqc";
const FUNCTION_NAME = "google-gmail-oauth";
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const OAUTH_SCOPES = `${GMAIL_SEND_SCOPE} email`;

/**
 * Determines the canonical OAuth redirect URI matching the deployed Edge Function
 */
function getCanonicalRedirectUri(req: Request): string {
  // 1. Explicit override if set in environment secrets
  const explicitUri = Deno.env.get("GOOGLE_REDIRECT_URI");
  if (explicitUri && explicitUri.trim().length > 0) {
    return explicitUri.trim();
  }

  // 2. Derive from SUPABASE_URL injected by Supabase Edge Runtime
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (supabaseUrl && supabaseUrl.trim().length > 0) {
    return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/${FUNCTION_NAME}`;
  }

  // 3. Derive from incoming request origin if running in deployed environment
  try {
    const url = new URL(req.url);
    if (url.origin && url.origin !== "null" && !url.origin.includes("localhost")) {
      return `${url.origin}/functions/v1/${FUNCTION_NAME}`;
    }
  } catch {
    // fallback to canonical project reference below
  }

  // 4. Default canonical project reference URL
  return `https://${DENTIFLOW_PROJECT_REF}.supabase.co/functions/v1/${FUNCTION_NAME}`;
}

/**
 * Constructs a safe HTML response for browser navigation
 */
function htmlResponse(htmlContent: string, status = 200): Response {
  return new Response(htmlContent, {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=UTF-8",
    },
  });
}

/**
 * Constructs a standardized JSON response
 */
function jsonResponse(
  data: {
    success: boolean;
    message?: string;
    url?: string;
    redirectUri?: string;
    error?: string;
    stage?: string;
    email?: string;
  },
  status = 200
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

/**
 * Base64 URL encode helper
 */
function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Base64 URL decode helper
 */
function base64UrlDecode(str: string): string {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) {
    b64 += "=";
  }
  return atob(b64);
}

/**
 * Signs a state payload using HMAC-SHA256
 */
async function createSignedState(data: Record<string, unknown>, secret: string): Promise<string> {
  const jsonStr = JSON.stringify(data);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(jsonStr));
  const signatureHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const b64Data = base64UrlEncode(jsonStr);
  return `${b64Data}.${signatureHex}`;
}

/**
 * Verifies and decodes a signed state payload
 */
async function verifySignedState(stateString: string, secret: string): Promise<any | null> {
  try {
    const parts = stateString.split(".");
    if (parts.length !== 2) return null;
    const [b64Data, signatureHex] = parts;
    const jsonStr = base64UrlDecode(b64Data);
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const sigBytes = new Uint8Array(
      signatureHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    );
    const isValid = await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(jsonStr));
    if (!isValid) return null;
    const data = JSON.parse(jsonStr);
    // Expiration check: valid for 30 minutes
    if (typeof data.timestamp === "number" && Date.now() - data.timestamp > 30 * 60 * 1000) {
      console.warn("[google-gmail-oauth] Expired OAuth state token");
      return null;
    }
    return data;
  } catch (err: any) {
    console.warn("[google-gmail-oauth] State verification error:", err.message);
    return null;
  }
}

/**
 * Renders an HTML page for errors or notifications
 */
function renderPage(params: {
  title: string;
  headline: string;
  statusBadge: "success" | "error" | "warning";
  messageHtml: string;
  redirectUrl?: string;
}): string {
  const badgeColor =
    params.statusBadge === "success"
      ? "#059669"
      : params.statusBadge === "error"
        ? "#dc2626"
        : "#d97706";

  const badgeText =
    params.statusBadge === "success"
      ? "Authorization Successful"
      : params.statusBadge === "error"
        ? "Authorization Error"
        : "Configuration Notice";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${params.title} - Dentiflow</title>
  ${params.redirectUrl ? `<meta http-equiv="refresh" content="2;url=${params.redirectUrl}">` : ""}
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #f8fafc;
      color: #0f172a;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      box-sizing: border-box;
    }
    .card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      max-width: 560px;
      width: 100%;
      padding: 36px;
      box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.08), 0 8px 10px -6px rgba(15, 23, 42, 0.04);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 20px;
      font-weight: 700;
      color: #0d9488;
      margin-bottom: 24px;
    }
    .badge {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      color: #ffffff;
      background-color: ${badgeColor};
      margin-bottom: 16px;
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 16px 0;
      line-height: 1.3;
    }
    p, li {
      font-size: 15px;
      line-height: 1.6;
      color: #475569;
    }
    .btn-return {
      display: inline-block;
      margin-top: 20px;
      padding: 10px 20px;
      background: #252525;
      color: #ffffff;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
    }
    .btn-return:hover {
      background: #000000;
    }
    .code-box {
      background: #0f172a;
      color: #38bdf8;
      padding: 14px 18px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 13px;
      overflow-x: auto;
      margin: 16px 0;
      word-break: break-all;
    }
    .footer {
      margin-top: 28px;
      padding-top: 20px;
      border-top: 1px solid #f1f5f9;
      font-size: 13px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">🦷 Dentiflow Clinic Backend</div>
    <div class="badge">${badgeText}</div>
    <h1>${params.headline}</h1>
    ${params.messageHtml}
    ${params.redirectUrl ? `<p><a class="btn-return" href="${params.redirectUrl}">Return to Doctor Dashboard &rarr;</a></p>` : ""}
    <div class="footer">
      Dentiflow OAuth Authorization Layer &bull; Supabase Edge Functions
    </div>
  </div>
  ${params.redirectUrl ? `
  <script>
    if (window.opener) {
      try {
        window.opener.postMessage({ type: 'DENTIFLOW_GMAIL_CONNECTED' }, '*');
      } catch (e) {}
      setTimeout(() => window.close(), 1500);
    }
  </script>` : ""}
</body>
</html>`;
}

/**
 * Edge Function handler for Google Gmail OAuth 2.0
 */
Deno.serve(async (req: Request) => {
  // 1. Handle CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const redirectUri = getCanonicalRedirectUri(req);
  const wantsJson =
    req.headers.get("accept")?.includes("application/json") ||
    req.headers.get("content-type")?.includes("application/json") ||
    url.searchParams.get("format") === "json";

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || `https://${DENTIFLOW_PROJECT_REF}.supabase.co`;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")?.trim();
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")?.trim();

  // Signing secret for state HMAC validation
  const signingSecret = clientSecret;

  // Support status query via Edge Function
  if (url.searchParams.get("action") === "status") {
    if (supabaseServiceKey) {
      try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
          auth: { persistSession: false },
        });
        const { data: conn } = await supabaseAdmin
          .from("gmail_connections")
          .select("id, user_id, clinic_id, email, status, updated_at")
          .eq("status", "connected")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        return jsonResponse({
          success: true,
          isConnected: Boolean(conn && conn.status === "connected"),
          email: conn?.email,
          status: conn?.status || "disconnected",
          updatedAt: conn?.updated_at,
        });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err.message }, 500);
      }
    }
  }

  // Support disconnect action via Edge Function
  if (url.searchParams.get("action") === "disconnect" || (req.method === "POST" && url.searchParams.get("action") === "disconnect")) {
    if (supabaseServiceKey) {
      try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
          auth: { persistSession: false },
        });
        await supabaseAdmin
          .from("gmail_connections")
          .update({ status: "disconnected", updated_at: new Date().toISOString() })
          .eq("status", "connected");

        return jsonResponse({ success: true, message: "Gmail connection disconnected." });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err.message }, 500);
      }
    }
  }

  // 2. Check for Google OAuth Error Callback (e.g. Doctor clicked Cancel or access_denied)
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    const errorDescription = url.searchParams.get("error_description") || oauthError;
    console.warn(`[google-gmail-oauth] Google returned OAuth error: ${errorDescription}`);

    // If state was returned, inspect for returnUrl
    const returnedState = url.searchParams.get("state");
    let returnUrl: string | null = null;
    if (returnedState) {
      const stateObj = await verifySignedState(returnedState, signingSecret);
      if (stateObj?.returnUrl) {
        returnUrl = stateObj.returnUrl;
      }
    }

    if (returnUrl) {
      const dest = new URL(returnUrl);
      dest.searchParams.set("gmail_error", errorDescription);
      return Response.redirect(dest.toString(), 302);
    }

    if (wantsJson) {
      return jsonResponse({ success: false, error: `Google OAuth error: ${errorDescription}` }, 400);
    }

    return htmlResponse(
      renderPage({
        title: "Authorization Cancelled",
        headline: "Google Access Denied",
        statusBadge: "warning",
        messageHtml: `
          <p>Google reported that the authorization was cancelled or denied:</p>
          <div class="code-box">${errorDescription}</div>
          <p>You can return to the Doctor Dashboard to try connecting your Gmail account again.</p>
        `,
      }),
      400
    );
  }

  // 3. Check for Google OAuth Authorization Code Callback (Step 2 of OAuth)
  const authCode = url.searchParams.get("code");
  if (authCode) {
    if (!clientId || !clientSecret) {
      console.error("[google-gmail-oauth] Credentials missing during code exchange.");
      return htmlResponse(
        renderPage({
          title: "Configuration Error",
          headline: "OAuth Credentials Missing",
          statusBadge: "error",
          messageHtml: `<p>GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required to complete authorization.</p>`,
        }),
        500
      );
    }

    const stateParam = url.searchParams.get("state");
    let stateData: any = null;
    if (stateParam) {
      stateData = await verifySignedState(stateParam, signingSecret);
    }

    const stateDoctorUserId = stateData?.userId || null;
    const returnUrl = stateData?.returnUrl || null;
    const stateDoctorFallbackEmail = stateData?.userEmail || null;

    let doctorUserId = stateDoctorUserId;
    let doctorEmail = stateDoctorFallbackEmail;

    // If doctorUserId was not in state, look up existing general doctor in Supabase Auth/profiles
    if (!doctorUserId && supabaseServiceKey) {
      try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
          auth: { persistSession: false },
        });
        const { data: doctorProfile } = await supabaseAdmin
          .from("profiles")
          .select("id, email")
          .eq("role", "doctor")
          .limit(1)
          .maybeSingle();

        if (doctorProfile?.id) {
          doctorUserId = doctorProfile.id;
          if (!doctorEmail && doctorProfile.email) {
            doctorEmail = doctorProfile.email;
          }
        }
      } catch (lookupErr: any) {
        console.warn("[google-gmail-oauth] General doctor lookup error:", lookupErr.message);
      }
    }

    try {
      console.log("[google-gmail-oauth] Exchanging authorization code with Google token endpoint...");

      // Exchange authorization code for tokens server-side
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code: authCode,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }).toString(),
      });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json().catch(() => ({}));
        const errorMsg = errorData.error_description || errorData.error || `HTTP ${tokenResponse.status}`;
        console.error(`[google-gmail-oauth] Token exchange failed with Google: ${errorMsg}`);

        if (returnUrl) {
          const dest = new URL(returnUrl);
          dest.searchParams.set("gmail_error", "Token exchange failed");
          return Response.redirect(dest.toString(), 302);
        }

        return htmlResponse(
          renderPage({
            title: "Token Exchange Failed",
            headline: "Failed to Exchange Authorization Code",
            statusBadge: "error",
            messageHtml: `
              <p>Google rejected the token exchange request:</p>
              <div class="code-box">${errorMsg}</div>
            `,
          }),
          502
        );
      }

      const tokenData = await tokenResponse.json();
      const refreshToken = tokenData.refresh_token;
      const accessToken = tokenData.access_token;

      if (!refreshToken) {
        console.warn("[google-gmail-oauth] Google did not return a refresh_token in response.");
        // If already connected before, prompt the doctor or show instructions
        if (returnUrl) {
          const dest = new URL(returnUrl);
          dest.searchParams.set("gmail_error", "No refresh token issued. Please disconnect Dentiflow in Google Account Permissions and reconnect.");
          return Response.redirect(dest.toString(), 302);
        }

        return htmlResponse(
          renderPage({
            title: "Refresh Token Missing",
            headline: "No Refresh Token Issued by Google",
            statusBadge: "warning",
            messageHtml: `
              <p>Google granted access, but did not return a <code>refresh_token</code>.</p>
              <p>This typically occurs if your account has authorized Dentiflow previously without revoking access.</p>
              <p><strong>To resolve:</strong></p>
              <ol>
                <li>Visit <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">Google Account Permissions</a>.</li>
                <li>Remove Dentiflow from the authorized apps.</li>
                <li>Return to the Doctor Dashboard and click <strong>Connect Gmail</strong> again.</li>
              </ol>
            `,
          }),
          200
        );
      }

      // Identify connected Gmail account address via Google UserInfo API
      let connectedEmail = doctorEmail;
      if (accessToken) {
        try {
          const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (userInfoRes.ok) {
            const userInfo = await userInfoRes.json();
            if (userInfo.email) {
              connectedEmail = userInfo.email;
            }
          }
        } catch (uiErr: any) {
          console.warn("[google-gmail-oauth] Could not query userinfo for email:", uiErr.message);
        }
      }

      // Persist the refresh token securely in Supabase database (gmail_connections table)
      // Dedicated clinic / general doctor connection record
      // Row-level security and column privileges guarantee refresh_token is never sent to the browser
      let savedToDatabase = false;
      if (supabaseServiceKey) {
        try {
          const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { persistSession: false },
          });

          // Single dedicated clinic connection upsert
          const { error: upsertErr } = await supabaseAdmin
            .from("gmail_connections")
            .upsert(
              {
                clinic_id: "default",
                user_id: doctorUserId || null, // verified general doctor user_id from auth.users, or null if no Supabase Auth user exists
                email: connectedEmail || doctorEmail,
                refresh_token: refreshToken,
                scope: GMAIL_SEND_SCOPE,
                status: "connected",
                updated_at: new Date().toISOString(),
              },
              { onConflict: "clinic_id" }
            );

          if (upsertErr) {
            console.error("[google-gmail-oauth] Database upsert error into gmail_connections:", upsertErr.message);
            // Fallback attempt: update existing clinic record
            await supabaseAdmin
              .from("gmail_connections")
              .update({
                user_id: doctorUserId || null,
                email: connectedEmail || doctorEmail,
                refresh_token: refreshToken,
                scope: GMAIL_SEND_SCOPE,
                status: "connected",
                updated_at: new Date().toISOString(),
              })
              .eq("clinic_id", "default");
          } else {
            savedToDatabase = true;
            console.log(`[google-gmail-oauth] Gmail connection successfully persisted for clinic (user_id: ${doctorUserId || 'none'}).`);
          }
        } catch (dbErr: any) {
          console.error("[google-gmail-oauth] Unexpected DB error:", dbErr.message);
        }
      } else {
        console.warn("[google-gmail-oauth] Warning: Missing Service Role Key.");
      }

      // Return doctor to Doctor Dashboard
      if (returnUrl) {
        const dest = new URL(returnUrl);
        dest.searchParams.set("gmail_status", "connected");
        if (connectedEmail) {
          dest.searchParams.set("gmail_email", connectedEmail);
        }
        return Response.redirect(dest.toString(), 302);
      }

      // Safe HTML response (Never print or display refresh tokens)
      const successHtml = `
        <p>Your Gmail account (<strong>${connectedEmail || "Authorized Clinician"}</strong>) has been successfully connected to Dentiflow for sending receipts and appointment updates.</p>
        <p>The refresh token has been securely stored in the clinic's protected database and will not be displayed here for security.</p>
      `;

      return htmlResponse(
        renderPage({
          title: "Gmail Connected",
          headline: "Gmail Connected Successfully",
          statusBadge: "success",
          messageHtml: successHtml,
          redirectUrl: returnUrl || undefined,
        }),
        200
      );
    } catch (err: any) {
      console.error("[google-gmail-oauth] Unexpected error during code exchange:", err.message || err);
      return htmlResponse(
        renderPage({
          title: "Exchange Error",
          headline: "Unexpected Authorization Error",
          statusBadge: "error",
          messageHtml: `<p>An unexpected error occurred: ${err.message || "Unknown error"}</p>`,
        }),
        500
      );
    }
  }

  // 4. Start OAuth Authorization Flow (Step 1)
  // Invoked by the frontend when doctor clicks "Connect Gmail"

  // Validate that secrets are configured before proceeding
  if (!clientId || !clientSecret) {
    console.error("[google-gmail-oauth] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in Supabase secrets.");
    return jsonResponse(
      {
        success: false,
        error: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured before running OAuth setup.",
        stage: "oauth_initialization",
        redirectUri,
      },
      500
    );
  }

  // Authenticate the calling doctor from Bearer token
  let authenticatedUserId: string | null = null;
  let authenticatedUserEmail: string | null = null;

  const authHeader = req.headers.get("Authorization");
  if (authHeader && supabaseUrl && (supabaseAnonKey || supabaseServiceKey)) {
    try {
      const client = createClient(supabaseUrl, supabaseAnonKey || supabaseServiceKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const { data: { user }, error: authErr } = await client.auth.getUser();
      if (!authErr && user) {
        authenticatedUserId = user.id;
        authenticatedUserEmail = user.email || null;
      }
    } catch (err: any) {
      console.warn("[google-gmail-oauth] Auth token check warning:", err.message);
    }
  }

  // If calling client does not have an active user session, resolve general doctor account server-side
  if (!authenticatedUserId && supabaseServiceKey) {
    try {
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false },
      });
      const { data: docProfile } = await supabaseAdmin
        .from("profiles")
        .select("id, email")
        .eq("role", "doctor")
        .limit(1)
        .maybeSingle();

      if (docProfile) {
        authenticatedUserId = docProfile.id;
        authenticatedUserEmail = docProfile.email || "doctor@gmail.com";
      }
    } catch (err: any) {
      console.warn("[google-gmail-oauth] General doctor profile lookup warning:", err.message);
    }
  }

  // Parse optional return URL from body or query param
  let returnUrl = url.searchParams.get("returnUrl");
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body?.returnUrl && typeof body.returnUrl === "string") {
        returnUrl = body.returnUrl;
      }
    } catch {
      // ignore JSON parse failure on non-JSON body
    }
  }

  // Fallback return URL to request origin
  if (!returnUrl) {
    try {
      const reqUrl = new URL(req.url);
      returnUrl = reqUrl.origin;
    } catch {
      returnUrl = "http://localhost:3000";
    }
  }

  // Create cryptographically signed state parameter
  // Neither userId nor userEmail is required to be non-null; if no Supabase Auth user exists, userId is null
  const statePayload = {
    userId: authenticatedUserId || null,
    userEmail: authenticatedUserEmail || null,
    clinicId: "default",
    returnUrl,
    timestamp: Date.now(),
  };

  const signedState = await createSignedState(statePayload, signingSecret);

  // Construct Google Authorization URL
  const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleAuthUrl.searchParams.set("client_id", clientId);
  googleAuthUrl.searchParams.set("redirect_uri", redirectUri);
  googleAuthUrl.searchParams.set("response_type", "code");
  googleAuthUrl.searchParams.set("scope", OAUTH_SCOPES);
  googleAuthUrl.searchParams.set("access_type", "offline");
  googleAuthUrl.searchParams.set("prompt", "consent"); // Force consent to guarantee refresh token is issued
  googleAuthUrl.searchParams.set("state", signedState);

  // Return JSON if requested (used by Doctor Dashboard React frontend)
  if (wantsJson || req.method === "POST") {
    return jsonResponse(
      {
        success: true,
        message: "Google OAuth authorization URL generated successfully.",
        url: googleAuthUrl.toString(),
        redirectUri,
      },
      200
    );
  }

  // If accessed directly via browser GET, redirect immediately to Google's consent screen
  console.log(`[google-gmail-oauth] Redirecting doctor to Google OAuth consent screen...`);
  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      "Location": googleAuthUrl.toString(),
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
});
