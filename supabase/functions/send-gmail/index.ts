import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// Standard CORS headers for Dentiflow frontend
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface SendEmailAttachment {
  filename: string;
  content: string; // Base64 encoded file content
  type?: string;   // e.g. "application/pdf"
}

interface SendEmailRequest {
  to?: unknown;
  subject?: unknown;
  body?: unknown;
  html?: unknown;
  fromName?: unknown;
  attachments?: unknown;
}

// In-memory cache for access token within the warm isolate
let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0; // Milliseconds timestamp

/**
 * Generates a clean JSON response with appropriate CORS headers
 */
function jsonResponse(
  data: { success: boolean; messageId?: string; error?: string },
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
 * Validates email format according to standard RFC 5322 pattern
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return emailRegex.test(email);
}

/**
 * Encodes a subject line to RFC 2047 MIME header format if it contains non-ASCII characters
 */
function encodeSubject(subject: string): string {
  // If pure ASCII without special characters, return as is
  if (/^[\x20-\x7E]*$/.test(subject) && !subject.includes("=?")) {
    return subject;
  }
  // Base64 encode for UTF-8 MIME header (RFC 2047)
  const utf8Bytes = new TextEncoder().encode(subject);
  let binary = "";
  for (let i = 0; i < utf8Bytes.length; i++) {
    binary += String.fromCharCode(utf8Bytes[i]);
  }
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

/**
 * URL-safe Base64 encoding without padding (RFC 4648 § 5) required by Gmail API.
 * Uses safe chunking to prevent stack overflow on large PDF binary streams.
 */
function base64UrlEncode(str: string): string {
  const utf8Bytes = new TextEncoder().encode(str);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < utf8Bytes.length; i += chunkSize) {
    const chunk = utf8Bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Constructs an RFC 2822 / MIME compliant email message.
 * Supports plain text, HTML (multipart/alternative), and binary attachments (multipart/mixed).
 */
function buildRfc2822Message(params: {
  to: string;
  subject: string;
  body: string;
  html?: string;
  fromName?: string;
  fromEmail?: string;
  attachments?: SendEmailAttachment[];
}): string {
  const { to, subject, body, html, fromName, fromEmail, attachments } = params;
  const encodedSubject = encodeSubject(subject);
  const fromAddr = fromEmail && fromEmail.includes("@") ? fromEmail : "me";
  const fromHeader = fromName ? `${fromName} <${fromAddr}>` : `Dentiflow Clinic <${fromAddr}>`;

  // Case 1: When attachments are present, use top-level multipart/mixed
  if (attachments && attachments.length > 0) {
    const mixedBoundary = `dentiflow_mixed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const altBoundary = `dentiflow_alt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const parts: string[] = [
      `From: ${fromHeader}`,
      `To: ${to}`,
      `Subject: ${encodedSubject}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
      ``,
      `--${mixedBoundary}`,
    ];

    if (html && typeof html === "string" && html.trim().length > 0) {
      parts.push(
        `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
        ``,
        `--${altBoundary}`,
        `Content-Type: text/plain; charset="UTF-8"`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        body,
        ``,
        `--${altBoundary}`,
        `Content-Type: text/html; charset="UTF-8"`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        html,
        ``,
        `--${altBoundary}--`
      );
    } else {
      const isHtml = /<[a-z][\s\S]*>/i.test(body);
      const contentType = isHtml ? 'text/html; charset="UTF-8"' : 'text/plain; charset="UTF-8"';
      parts.push(
        `Content-Type: ${contentType}`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        body
      );
    }

    for (const att of attachments) {
      const safeFilename = (att.filename || 'attachment.pdf').replace(/[\r\n"/\\]/g, '_');
      const mimeType = att.type || 'application/pdf';
      const cleanContent = att.content.replace(/^data:[^;]+;base64,/i, '').replace(/[\r\n\s]/g, '');

      parts.push(
        ``,
        `--${mixedBoundary}`,
        `Content-Type: ${mimeType}; name="${safeFilename}"`,
        `Content-Disposition: attachment; filename="${safeFilename}"`,
        `Content-Transfer-Encoding: base64`,
        ``,
        cleanContent
      );
    }

    parts.push(``, `--${mixedBoundary}--`);
    return parts.join("\r\n");
  }

  // Case 2: No attachments - rich HTML multipart/alternative
  if (html && typeof html === "string" && html.trim().length > 0) {
    const boundary = `dentiflow_mime_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const parts = [
      `From: ${fromHeader}`,
      `To: ${to}`,
      `Subject: ${encodedSubject}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      `Content-Transfer-Encoding: 7bit`,
      ``,
      body,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset="UTF-8"`,
      `Content-Transfer-Encoding: 7bit`,
      ``,
      html,
      ``,
      `--${boundary}--`,
    ];
    return parts.join("\r\n");
  }

  // Case 3: Simple body (text or HTML)
  const isHtml = /<[a-z][\s\S]*>/i.test(body);
  const contentType = isHtml ? 'text/html; charset="UTF-8"' : 'text/plain; charset="UTF-8"';

  const parts = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    `MIME-Version: 1.0`,
    `Content-Type: ${contentType}`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    body,
  ];
  return parts.join("\r\n");
}

/**
 * Requests a fresh access token from Google OAuth endpoint using the stored refresh token
 */
async function getGoogleAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  forceRefresh = false
): Promise<string> {
  // Use cached token if valid (with 60-second safety window)
  if (!forceRefresh && cachedAccessToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }

  const tokenParams = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: tokenParams.toString(),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const errorDesc = errorData.error_description || errorData.error || "Token refresh failed";
    // Never log client secrets or refresh tokens
    console.error(`[send-gmail] Google OAuth refresh error (HTTP ${res.status}): ${errorDesc}`);
    throw new Error(`Google OAuth authorization failed: ${errorDesc}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Google OAuth response missing access_token");
  }

  cachedAccessToken = data.access_token;
  const expiresInSeconds = Number(data.expires_in) || 3600;
  tokenExpiresAt = Date.now() + expiresInSeconds * 1000;
  return data.access_token;
}

/**
 * Dispatches the RFC 2822 email message to the Google Gmail API
 */
async function sendToGmailApi(
  accessToken: string,
  rawBase64Url: string
): Promise<{ id: string }> {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: rawBase64Url }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const errorMsg = errorData?.error?.message || `Gmail API responded with HTTP ${res.status}`;
    // Never log email contents or patient personal data
    console.error(`[send-gmail] Gmail API send error: ${res.status} - ${errorMsg}`);
    const err = new Error(errorMsg);
    (err as any).status = res.status;
    throw err;
  }

  return await res.json();
}

/**
 * Supabase Edge Function Handler
 */
Deno.serve(async (req: Request) => {
  // 1. Handle CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // 2. Enforce HTTP POST
  if (req.method !== "POST") {
    return jsonResponse(
      { success: false, error: "Method not allowed. Only POST is supported." },
      405
    );
  }

  try {
    // 3. Authenticate caller using existing Supabase Auth architecture
    const authHeader = req.headers.get("Authorization");
    const apikeyHeader = req.headers.get("apikey") || req.headers.get("x-api-key");
    if (!authHeader && !apikeyHeader) {
      return jsonResponse(
        { success: false, error: "Unauthorized: Missing Authorization or apikey header." },
        401
      );
    }

    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, "").trim() : (apikeyHeader || "").trim();
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const canonicalAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5Y25vaGtvYmF6YWR1bGR4aXFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2NzUxMzIsImV4cCI6MjEwNjI1MTEzMn0.HhZzx9yzQGvk0LqDU5ZVk3qKKMyFMWlI3tLDsCqsPKw";

    let isAuthorized = false;
    let callingDoctor: { id: string; email?: string } | null = null;

    // Check for Supabase service role key, anon key, or canonical project key (for backend/clinic invocations)
    if (
      (serviceRoleKey && (token === serviceRoleKey || apikeyHeader === serviceRoleKey)) ||
      (supabaseAnonKey && (token === supabaseAnonKey || apikeyHeader === supabaseAnonKey)) ||
      token === canonicalAnonKey ||
      apikeyHeader === canonicalAnonKey
    ) {
      isAuthorized = true;
    } else {
      // Validate authenticated user session token with Supabase Auth
      if (supabaseUrl && (supabaseAnonKey || serviceRoleKey)) {
        const supabaseClient = createClient(supabaseUrl, supabaseAnonKey || serviceRoleKey, {
          global: { headers: { Authorization: authHeader || `Bearer ${token}` } },
          auth: { persistSession: false },
        });

        const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
        if (!userError && user) {
          isAuthorized = true;
          callingDoctor = { id: user.id, email: user.email };
        }
      }
    }

    if (!isAuthorized) {
      return jsonResponse(
        { success: false, error: "Unauthorized: Valid Dentiflow user session required." },
        401
      );
    }

    // 4. Parse JSON payload
    let payload: SendEmailRequest;
    try {
      payload = await req.json();
    } catch {
      return jsonResponse(
        { success: false, error: "Invalid JSON in request body." },
        400
      );
    }

    const { to, subject, body, html, fromName, attachments } = payload || {};

    // 5. Validate input fields
    if (
      typeof to !== "string" ||
      typeof subject !== "string" ||
      typeof body !== "string"
    ) {
      return jsonResponse(
        {
          success: false,
          error: "Missing required fields: 'to', 'subject', and 'body' must be strings.",
        },
        400
      );
    }

    const cleanTo = to.trim();
    const cleanSubject = subject.trim();
    const cleanBody = body.trim();

    if (!cleanTo) {
      return jsonResponse({ success: false, error: "Field 'to' cannot be empty." }, 400);
    }

    if (!cleanSubject) {
      return jsonResponse({ success: false, error: "Field 'subject' cannot be empty." }, 400);
    }

    if (!cleanBody) {
      return jsonResponse({ success: false, error: "Field 'body' cannot be empty." }, 400);
    }

    // Prevent header injection attacks
    if (cleanTo.includes("\r") || cleanTo.includes("\n")) {
      return jsonResponse({ success: false, error: "Invalid characters in recipient email." }, 400);
    }

    if (cleanSubject.includes("\r") || cleanSubject.includes("\n")) {
      return jsonResponse({ success: false, error: "Invalid characters in email subject." }, 400);
    }

    // Validate email format
    if (!isValidEmail(cleanTo)) {
      return jsonResponse({ success: false, error: "Malformed recipient email address." }, 400);
    }

    // Validate attachments if provided
    const validAttachments: SendEmailAttachment[] = [];
    if (attachments !== undefined && attachments !== null) {
      if (!Array.isArray(attachments)) {
        return jsonResponse({ success: false, error: "Field 'attachments' must be an array." }, 400);
      }
      for (const att of attachments) {
        if (!att || typeof att !== 'object' || typeof att.filename !== 'string' || typeof att.content !== 'string') {
          return jsonResponse({ success: false, error: "Each attachment must have 'filename' and 'content' string properties." }, 400);
        }
        if (att.filename.includes("\r") || att.filename.includes("\n")) {
          return jsonResponse({ success: false, error: "Invalid characters in attachment filename." }, 400);
        }
        validAttachments.push({
          filename: att.filename.trim(),
          content: att.content.trim(),
          type: typeof att.type === 'string' ? att.type.trim() : 'application/pdf'
        });
      }
    }

    // 6. Verify Google OAuth Secrets configuration & obtain refresh token
    const SERVER_DEFAULT_CLIENT_ID = "YOUR_GOOGLE_CLIENT_ID";
    const SERVER_DEFAULT_CLIENT_SECRET = "YOUR_GOOGLE_CLIENT_SECRET";

    const googleClientId = (Deno.env.get("GOOGLE_CLIENT_ID") || SERVER_DEFAULT_CLIENT_ID)?.trim();
    const googleClientSecret = (Deno.env.get("GOOGLE_CLIENT_SECRET") || SERVER_DEFAULT_CLIENT_SECRET)?.trim();
    const envRefreshToken = Deno.env.get("GOOGLE_REFRESH_TOKEN")?.trim();

    let activeRefreshToken = envRefreshToken;
    let doctorEmail: string | undefined = undefined;

    // Check clinic / general doctor connection stored in gmail_connections table
    if (serviceRoleKey && supabaseUrl) {
      try {
        const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
          auth: { persistSession: false },
        });

        // 1. If calling doctor has an id, check their record first
        let conn: any = null;
        if (callingDoctor?.id) {
          const { data } = await supabaseAdmin
            .from("gmail_connections")
            .select("refresh_token, email, status")
            .eq("user_id", callingDoctor.id)
            .eq("status", "connected")
            .maybeSingle();
          conn = data;
        }

        // 2. If not found, lookup the dedicated clinic / general doctor connection
        if (!conn) {
          const { data } = await supabaseAdmin
            .from("gmail_connections")
            .select("refresh_token, email, status")
            .eq("status", "connected")
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          conn = data;
        }

        if (conn?.refresh_token) {
          activeRefreshToken = conn.refresh_token;
          if (conn.email) {
            doctorEmail = conn.email;
          }
        }
      } catch (dbErr: any) {
        console.warn("[send-gmail] Notice: Exception querying gmail_connections, fallback to env:", dbErr.message);
      }
    }

    if (!googleClientId || !googleClientSecret || !activeRefreshToken) {
      console.error("[send-gmail] Google OAuth credentials or doctor refresh token missing.");
      return jsonResponse(
        {
          success: false,
          error: "Gmail connection not found. Please connect your clinic Gmail account from the Doctor Dashboard.",
        },
        400
      );
    }

    // 7. Obtain Google Access Token via OAuth token-refresh flow
    let accessToken: string;
    try {
      accessToken = await getGoogleAccessToken(
        googleClientId,
        googleClientSecret,
        activeRefreshToken
      );
    } catch (tokenErr: any) {
      return jsonResponse(
        { success: false, error: tokenErr.message || "Failed to obtain Google access token." },
        502
      );
    }

    // 8. Build RFC 2822 / MIME message and Base64URL encode
    const rfcMessage = buildRfc2822Message({
      to: cleanTo,
      subject: cleanSubject,
      body: cleanBody,
      html: typeof html === "string" ? html : undefined,
      fromName: typeof fromName === "string" ? fromName.trim() : undefined,
      fromEmail: doctorEmail,
      attachments: validAttachments.length > 0 ? validAttachments : undefined,
    });
    const base64UrlMessage = base64UrlEncode(rfcMessage);

    // 9. Send via Google Gmail API
    let sendResult: { id: string };
    try {
      sendResult = await sendToGmailApi(accessToken, base64UrlMessage);
    } catch (sendErr: any) {
      // If 401 Unauthorized, force token refresh once and retry
      if (sendErr.status === 401) {
        console.warn("[send-gmail] Received 401 from Gmail API. Attempting token refresh and retry...");
        try {
          accessToken = await getGoogleAccessToken(
            googleClientId,
            googleClientSecret,
            activeRefreshToken,
            true // force refresh
          );
          sendResult = await sendToGmailApi(accessToken, base64UrlMessage);
        } catch (retryErr: any) {
          return jsonResponse(
            { success: false, error: `Gmail API error: ${retryErr.message}` },
            502
          );
        }
      } else {
        return jsonResponse(
          { success: false, error: `Gmail API error: ${sendErr.message}` },
          502
        );
      }
    }

    // 10. Return clean success response
    console.log(`[send-gmail] Email sent successfully. Message ID: ${sendResult.id}`);
    return jsonResponse(
      {
        success: true,
        messageId: sendResult.id,
      },
      200
    );
  } catch (err: any) {
    console.error("[send-gmail] Unexpected internal error:", err?.message || err);
    return jsonResponse(
      {
        success: false,
        error: "Internal server error occurred while processing email request.",
      },
      500
    );
  }
});
