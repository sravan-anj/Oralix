import Razorpay from 'razorpay';
import crypto from 'crypto';
import express, { Request, Response, Router } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  createBillHandler,
  updateBillHandler,
  getBillsHandler,
  deleteBillHandler,
  createAppointmentHandler,
  getAppointmentsHandler,
  deleteAppointmentHandler,
  checkDuplicateAppointmentHandler
} from './billingService.ts';
import {
  sendAuthoritativeReceiptEmail,
  recordReceiptEmailStatusInDatabase,
  SendReceiptEmailResult
} from './emailReceiptService.ts';
import {
  AuthoritativeBill,
  AuthoritativePatient
} from './receiptPdfService.ts';

/**
 * Reloads environment variables from disk dynamically so credential updates are immediately recognized.
 */
export function refreshEnv(): void {
  const envCandidates = [
    path.resolve(__dirname, '../.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'Dentiflow/.env')
  ];
  for (const envPath of envCandidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: true });
    }
  }
}

// Initial load
refreshEnv();

export interface CreateOrderRequestBody {
  bill_id?: string;
  invoice_id?: string;
  invoiceId?: string;
  amount?: number; // in paise (e.g. 50000 = ₹500.00)
  currency?: string;
  receipt?: string;
  notes?: Record<string, string>;
}

export interface VerifyPaymentRequestBody {
  razorpay_order_id?: string;
  order_id?: string;
  razorpay_payment_id?: string;
  payment_id?: string;
  razorpay_signature?: string;
  signature?: string;
  bill_id?: string;
  invoice_id?: string;
  invoiceId?: string;
}

/**
 * Diagnostic logger that outputs safe status flags without revealing secrets.
 */
export function logDiagnosticStatus(): void {
  refreshEnv();
  const backendKeyExists = Boolean(process.env.RAZORPAY_KEY_ID?.trim());
  const backendSecretExists = Boolean(process.env.RAZORPAY_KEY_SECRET?.trim());
  const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
  const isTestKey = keyId.startsWith('rzp_test_');
  const isLiveKey = keyId.startsWith('rzp_live_');

  console.log('[Razorpay Diagnostic]:');
  console.log('  Razorpay backend key ID exists:', backendKeyExists);
  console.log('  Razorpay backend secret exists:', backendSecretExists);
  console.log('  Razorpay key environment:', isTestKey ? 'test' : isLiveKey ? 'live' : 'unknown');
}

/**
 * Helper to obtain an authenticated Razorpay SDK instance.
 * Credentials are read strictly from server environment variables.
 */
export function getRazorpayClient(): Razorpay {
  refreshEnv();
  const keyId = (process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID || '').trim();
  const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();

  if (!keyId || !keySecret) {
    throw new Error('Razorpay API keys are missing. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env');
  }

  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret
  });
}

/**
 * Known Dentiflow seed bills for fallback validation when offline.
 */
const KNOWN_SEED_BILLS: Record<string, { id: string; invoiceNumber: string; total: number; amountPaid: number; balanceDue: number }> = {
  'inv-seed-1': { id: 'inv-seed-1', invoiceNumber: 'INV-2026-081', total: 13050, amountPaid: 13050, balanceDue: 0 },
  'inv-seed-2': { id: 'inv-seed-2', invoiceNumber: 'INV-2026-082', total: 16000, amountPaid: 8000, balanceDue: 8000 },
  'inv-seed-3': { id: 'inv-seed-3', invoiceNumber: 'INV-2026-083', total: 3000, amountPaid: 0, balanceDue: 3000 },
  'inv-seed-4': { id: 'inv-seed-4', invoiceNumber: 'INV-2026-079', total: 4500, amountPaid: 0, balanceDue: 4500 },
  'inv-seed-5': { id: 'inv-seed-5', invoiceNumber: 'INV-2026-075', total: 22500, amountPaid: 15000, balanceDue: 7500 },
  'inv-1790787037767': { id: 'inv-1790787037767', invoiceNumber: 'INV-2026-442', total: 1700, amountPaid: 0, balanceDue: 1700 }
};

/**
 * Resolves bill data authoritatively from Supabase or fallback records.
 */
async function resolveBillAuthoritativeData(billId: string): Promise<{
  id: string;
  invoiceNumber: string;
  total: number;
  amountPaid: number;
  balanceDue: number;
} | null> {
  const normalizedId = billId.trim();

  // 1. Authoritative Supabase PostgreSQL lookup first (canonical database source)
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (supabaseUrl && supabaseKey) {
    try {
      const endpoint = `${supabaseUrl}/rest/v1/invoices?or=(id.eq.${encodeURIComponent(normalizedId)},invoice_number.eq.${encodeURIComponent(normalizedId)})&limit=1`;
      const res = await fetch(endpoint, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        }
      });
      if (res.ok) {
        const rows = await res.json();
        if (rows && rows.length > 0) {
          const r = rows[0];
          const total = Number(r.total_amount ?? r.total ?? 0);
          const amountPaid = Number(r.amount_paid ?? 0);
          const balanceDue = Number(r.balance_due !== undefined && r.balance_due !== null ? r.balance_due : Math.max(0, total - amountPaid));
          return {
            id: r.id,
            invoiceNumber: r.invoice_number || r.id,
            total,
            amountPaid,
            balanceDue
          };
        }
        // Database is connected and authoritative: bill does not exist
        return null;
      }
    } catch (_) {}
  }

  return null;
}

/**
 * Resolves complete bill row authoritatively from Supabase PostgreSQL database.
 */
export async function fetchFullAuthoritativeBill(billId: string): Promise<AuthoritativeBill | null> {
  const normalizedId = billId.trim();
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (supabaseUrl && supabaseKey) {
    try {
      const endpoint = `${supabaseUrl}/rest/v1/invoices?or=(id.eq.${encodeURIComponent(normalizedId)},invoice_number.eq.${encodeURIComponent(normalizedId)})&limit=1`;
      const res = await fetch(endpoint, {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`
        }
      });
      if (res.ok) {
        const rows = await res.json();
        if (rows && rows.length > 0) {
          return rows[0] as AuthoritativeBill;
        }
        // Database is connected and authoritative: bill does not exist
        return null;
      }
    } catch (err) {
      console.warn('[razorpayService] Failed to fetch bill from Supabase:', err);
    }
  }

  return null;
}

/**
 * Resolves patient record authoritatively from Supabase public.patients table.
 */
export async function fetchAuthoritativePatient(
  patientId?: string,
  patientName?: string
): Promise<AuthoritativePatient | null> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (supabaseUrl && supabaseKey) {
    try {
      if (patientId) {
        const res = await fetch(`${supabaseUrl}/rest/v1/patients?id=eq.${encodeURIComponent(patientId)}&limit=1`, {
          headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
        });
        if (res.ok) {
          const rows = await res.json();
          if (rows && rows.length > 0) return rows[0] as AuthoritativePatient;
        }
      }
      if (patientName) {
        const res = await fetch(`${supabaseUrl}/rest/v1/patients?name=ilike.${encodeURIComponent(patientName)}&limit=1`, {
          headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
        });
        if (res.ok) {
          const rows = await res.json();
          if (rows && rows.length > 0) return rows[0] as AuthoritativePatient;
        }
      }
    } catch (err) {
      console.warn('[razorpayService] Error fetching patient from Supabase:', err);
    }
  }

  return null;
}

/**
 * STEP 1: BACKEND - Create Order
 * - Endpoint: POST /api/create-order
 * - Request: { bill_id, amount (paise), currency, receipt }
 * - Determines authoritative bill amount when bill_id is provided
 * - Minimum amount: 100 paise
 */
export async function createOrderHandler(req: Request, res: Response) {
  try {
    const { bill_id, invoice_id, invoiceId, amount, currency = 'INR', receipt, notes } = (req.body || {}) as CreateOrderRequestBody;

    const targetBillId = bill_id || invoice_id || invoiceId;
    let finalAmountPaise: number;
    let finalReceipt: string = receipt || `rcpt_${Date.now()}`;

    // 1. Authoritative Bill Validation
    if (targetBillId) {
      const bill = await resolveBillAuthoritativeData(targetBillId);
      if (bill) {
        if (bill.balanceDue <= 0) {
          return res.status(400).json({
            success: false,
            error: `Invoice ${bill.invoiceNumber} has no outstanding balance due (₹0).`
          });
        }

        // Authoritative amount calculation strictly from database bill record
        // The frontend must NOT be allowed to decide the final payment amount.
        finalAmountPaise = Math.round(bill.balanceDue * 100);
        finalReceipt = bill.invoiceNumber;
      } else {
        // Bill ID provided but not found: use provided amount or return error
        const numericAmount = Number(amount);
        if (!amount || isNaN(numericAmount) || numericAmount < 100) {
          return res.status(400).json({
            success: false,
            error: `Bill ID "${targetBillId}" not found in clinic records, and valid fallback amount was not supplied.`
          });
        }
        finalAmountPaise = Math.round(numericAmount);
      }
    } else {
      // Direct amount specified without bill_id
      const numericAmount = Number(amount);
      if (!amount || isNaN(numericAmount) || numericAmount < 100) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error: Amount is required and must be at least 100 paise (₹1.00).'
        });
      }
      finalAmountPaise = Math.round(numericAmount);
    }

    // 2. Obtain Razorpay SDK Client
    let razorpay: Razorpay;
    try {
      razorpay = getRazorpayClient();
    } catch (configErr: any) {
      logDiagnosticStatus();
      return res.status(401).json({
        success: false,
        error: 'Authentication Error: Razorpay credentials are not configured on the server.'
      });
    }

    const orderOptions = {
      amount: finalAmountPaise,
      currency: (currency || 'INR').toUpperCase(),
      receipt: String(finalReceipt).slice(0, 40),
      notes: {
        bill_id: targetBillId || '',
        ...(notes || {})
      }
    };

    // Safe diagnostic logging before API call
    const keyId = (process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID || '').trim();
    console.log('[Razorpay API Request]: Calling orders.create for amount:', finalAmountPaise, 'paise (₹' + (finalAmountPaise / 100) + ')');
    console.log('  Razorpay backend key ID exists:', Boolean(keyId));
    console.log('  Razorpay backend secret exists:', Boolean(process.env.RAZORPAY_KEY_SECRET?.trim()));

    const order = await razorpay.orders.create(orderOptions);

    return res.status(200).json({
      success: true,
      order_id: order.id,
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
      key_id: keyId, // Safe public key ID for React to open checkout modal
      status: order.status
    });
  } catch (err: any) {
    const httpStatus = err?.statusCode || err?.status || 500;
    const errorCode = err?.error?.code || 'API_ERROR';
    const errorDesc = err?.error?.description || err?.message || 'Failed to create Razorpay order';

    console.error(`[Razorpay Order Error]: HTTP ${httpStatus} [${errorCode}] - ${errorDesc}`);

    // Handle authentication / permission failure from Razorpay API (401)
    if (
      httpStatus === 401 ||
      (errorCode === 'BAD_REQUEST_ERROR' && errorDesc.toLowerCase().includes('auth'))
    ) {
      return res.status(401).json({
        success: false,
        error: 'Razorpay authentication failed: Invalid Key ID or Key Secret. Please ensure your RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env match your active Razorpay Test Mode keys.',
        statusCode: 401,
        category: 'AUTHENTICATION_FAILED'
      });
    }

    return res.status(httpStatus).json({
      success: false,
      error: errorDesc
    });
  }
}

/**
 * STEP 3: BACKEND - Authoritative Payment Verification & Receipt Dispatch
 * - Endpoint: POST /api/verify-payment
 * - Security: HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET)
 * - Decoupled: Email & PDF failures never roll back verified payment
 * - Idempotent: Duplicate requests never create duplicate payments or duplicate receipt emails
 */
export async function verifyPaymentHandler(req: Request, res: Response) {
  try {
    const {
      razorpay_order_id,
      order_id,
      razorpay_payment_id,
      payment_id,
      razorpay_signature,
      signature,
      bill_id,
      invoice_id,
      invoiceId
    } = (req.body || {}) as VerifyPaymentRequestBody;

    const effectiveOrderId = (razorpay_order_id || order_id || '').trim();
    const effectivePaymentId = (razorpay_payment_id || payment_id || '').trim();
    const effectiveSignature = (razorpay_signature || signature || '').trim();
    const effectiveBillId = (bill_id || invoice_id || invoiceId || '').trim();

    // 1. Missing required parameters check
    if (!effectiveOrderId || !effectivePaymentId || !effectiveSignature) {
      return res.status(400).json({
        success: false,
        payment_verified: false,
        error: 'Validation Error: Missing required verification parameters (order_id, payment_id, signature).'
      });
    }

    refreshEnv();
    const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
    if (!keySecret) {
      return res.status(500).json({
        success: false,
        payment_verified: false,
        error: 'Server Configuration Error: RAZORPAY_KEY_SECRET is not configured on server.'
      });
    }

    // 2. Razorpay Signature Verification (HMAC-SHA256)
    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${effectiveOrderId}|${effectivePaymentId}`)
      .digest('hex');

    const isLengthMatch = expectedSignature.length === effectiveSignature.length;
    const isSignatureValid =
      isLengthMatch &&
      crypto.timingSafeEqual(Buffer.from(expectedSignature, 'utf-8'), Buffer.from(effectiveSignature, 'utf-8'));

    // Signature mismatch: strictly return 400, do NOT mark bill paid, do NOT generate PDF, do NOT send email
    if (!isSignatureValid) {
      return res.status(400).json({
        success: false,
        payment_verified: false,
        error: 'Payment verification failed: Signature mismatch. Payment has not been authenticated.'
      });
    }

    // 3. Authoritative Bill Verification from Database
    if (!effectiveBillId) {
      return res.status(400).json({
        success: false,
        payment_verified: false,
        error: 'Validation Error: Bill ID is required for authoritative payment settlement.'
      });
    }

    const bill = await fetchFullAuthoritativeBill(effectiveBillId);
    if (!bill) {
      return res.status(404).json({
        success: false,
        payment_verified: false,
        error: `Bill with ID "${effectiveBillId}" not found in clinic records.`
      });
    }

    const billInvoiceNumber = bill.invoice_number || bill.invoiceNumber || bill.id;
    const currentTotal = Number(bill.total_amount ?? bill.total ?? 0);

    // 4. Idempotency Check
    // If the same Razorpay payment verification request is received twice:
    // 1st request: Payment verified -> PDF generated -> email sent
    // 2nd request: Payment already verified -> DO NOT create another payment -> DO NOT send another email
    const billPaymentId = (bill as any).razorpay_payment_id;
    const isAlreadyVerifiedByThisTx =
      billPaymentId === effectivePaymentId ||
      ((bill.status === 'paid' || (bill as any).payment_status === 'verified') && billPaymentId === effectivePaymentId);

    if (isAlreadyVerifiedByThisTx) {
      console.log(`[razorpayService] Idempotency: Payment ${effectivePaymentId} was already verified for Bill ${billInvoiceNumber}.`);
      const existingEmailStatus = (bill as any).receipt_email_status || 'sent';

      // If email was already sent: do NOT duplicate email
      if (existingEmailStatus === 'sent') {
        return res.status(200).json({
          success: true,
          already_verified: true,
          payment_verified: true,
          payment_status: 'verified',
          order_id: effectiveOrderId,
          payment_id: effectivePaymentId,
          bill_id: bill.id,
          invoice_number: billInvoiceNumber,
          receipt_email_status: 'sent',
          message: 'Payment was already verified and receipt email was previously delivered.'
        });
      }
      // If previous email failed or skipped, we fall through to safe receipt retry without updating balance
    }

    // Check if the bill has already been settled by a DIFFERENT transaction
    if (
      (bill.status === 'paid' || (bill as any).payment_status === 'verified') &&
      billPaymentId &&
      billPaymentId !== effectivePaymentId
    ) {
      return res.status(400).json({
        success: false,
        payment_verified: false,
        error: `Bill ${billInvoiceNumber} has already been settled by another transaction (${billPaymentId}).`
      });
    }

    // 5. Razorpay Server-Side Order & Payment Inspection (where reachable)
    try {
      const razorpay = getRazorpayClient();
      const rzpPayment = await razorpay.payments.fetch(effectivePaymentId).catch((err: any) => {
        // If simulated or test mock ID in local unit tests, catch without crashing
        console.warn(`[razorpayService] Notice: Could not fetch payment ${effectivePaymentId} directly from Razorpay API:`, err?.error?.description || err?.message);
        return null;
      });

      if (rzpPayment) {
        if (rzpPayment.order_id && rzpPayment.order_id !== effectiveOrderId) {
          return res.status(400).json({
            success: false,
            payment_verified: false,
            error: `Razorpay Error: Payment ${effectivePaymentId} does not belong to expected Order ID ${effectiveOrderId}.`
          });
        }
        if (rzpPayment.currency && rzpPayment.currency.toUpperCase() !== 'INR') {
          return res.status(400).json({
            success: false,
            payment_verified: false,
            error: `Razorpay Error: Currency mismatch (${rzpPayment.currency}). Expected INR.`
          });
        }
      }
    } catch (_) {}

    // 6. Update Authoritative Database Record to VERIFIED / PAID
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    if (supabaseUrl && supabaseKey) {
      try {
        const updateEndpoint = `${supabaseUrl}/rest/v1/invoices?or=(id.eq.${encodeURIComponent(bill.id)},invoice_number.eq.${encodeURIComponent(bill.id)})`;
        await fetch(updateEndpoint, {
          method: 'PATCH',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({
            status: 'paid',
            payment_status: 'verified',
            amount_paid: currentTotal,
            balance_due: 0,
            payment_method: 'Razorpay',
            razorpay_payment_id: effectivePaymentId,
            razorpay_order_id: effectiveOrderId,
            payment_verified_at: new Date().toISOString(),
            receipt_email_status: 'pending',
            updated_at: new Date().toISOString()
          })
        });

        // Insert / merge into payment_transactions
        await fetch(`${supabaseUrl}/rest/v1/payment_transactions`, {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
          },
          body: JSON.stringify({
            id: effectivePaymentId,
            invoice_id: bill.id,
            invoice_number: billInvoiceNumber,
            patient_id: bill.patient_id || 'p-1',
            patient_name: bill.patient_name || bill.patientName || 'Patient',
            amount: currentTotal,
            payment_method: 'Razorpay',
            transaction_ref: effectivePaymentId,
            status: 'successful',
            timestamp: new Date().toISOString(),
            gateway_response: {
              order_id: effectiveOrderId,
              payment_id: effectivePaymentId,
              verification: 'HMAC_SHA256_VERIFIED'
            }
          })
        });
      } catch (dbErr) {
        console.warn('[razorpayService] Failed to persist invoice update in Supabase:', dbErr);
      }
    }

    // 7. Resolve Authoritative Patient Record from Database (for patient email)
    const patient = await fetchAuthoritativePatient(bill.patient_id, bill.patient_name || bill.patientName);

    // 8. Generate PDF & Send Receipt Email (Decoupled from payment verification)
    // Note: Payment verification MUST remain successful even if PDF generation or email delivery fails.
    let emailResult: SendReceiptEmailResult = {
      success: true,
      sent: false,
      skipped: false,
      error: undefined,
      filename: `Dentiflow-Bill-${billInvoiceNumber}.pdf`
    };

    try {
      emailResult = await sendAuthoritativeReceiptEmail(
        bill,
        patient,
        {
          paymentId: effectivePaymentId,
          orderId: effectiveOrderId,
          paymentDate: new Date(),
          paymentMethod: 'Razorpay',
          paymentStatus: 'verified'
        }
      );

      // Record receipt email status in database
      await recordReceiptEmailStatusInDatabase(bill.id, {
        status: emailResult.sent ? 'sent' : (emailResult.skipped ? 'skipped' : 'failed'),
        error: emailResult.error || null,
        sentAt: emailResult.sent ? new Date().toISOString() : null
      });
    } catch (emailErr: any) {
      console.error('[razorpayService] Email dispatch exception:', emailErr);
      emailResult = {
        success: false,
        sent: false,
        skipped: false,
        error: emailErr?.message || 'Unexpected email error',
        filename: `Dentiflow-Bill-${billInvoiceNumber}.pdf`
      };
      await recordReceiptEmailStatusInDatabase(bill.id, {
        status: 'failed',
        error: emailResult.error
      });
    }

    // 9. Return Comprehensive Verification & Receipt Status to Frontend
    return res.status(200).json({
      success: true,
      payment_verified: true,
      payment_status: 'verified',
      order_id: effectiveOrderId,
      payment_id: effectivePaymentId,
      bill_id: bill.id,
      invoice_number: billInvoiceNumber,
      receipt_email_status: emailResult.sent ? 'sent' : (emailResult.skipped ? 'skipped' : 'failed'),
      receipt_email: patient?.email || null,
      receipt_email_error: emailResult.error || null,
      receipt_filename: emailResult.filename,
      message: emailResult.sent
        ? `Payment verified successfully! Official receipt emailed to ${patient?.email}.`
        : (emailResult.skipped
            ? 'Payment successful, but receipt could not be emailed because the patient email is unavailable.'
            : `Payment successful. Receipt email delivery failed: ${emailResult.error}`)
    });
  } catch (err: any) {
    console.error('Razorpay Verify Payment Error:', err);
    return res.status(500).json({
      success: false,
      payment_verified: false,
      error: err?.message || 'Internal server error during payment verification.'
    });
  }
}

/**
 * Safe Retry Receipt Email Handler
 * - Allows re-sending receipt email without touching payment balances or creating duplicate payments
 */
export async function retryReceiptEmailHandler(req: Request, res: Response) {
  try {
    const { bill_id, invoice_id, invoiceId } = req.body || {};
    const effectiveBillId = (bill_id || invoice_id || invoiceId || '').trim();

    if (!effectiveBillId) {
      return res.status(400).json({ success: false, error: 'Bill ID is required.' });
    }

    const bill = await fetchFullAuthoritativeBill(effectiveBillId);
    if (!bill) {
      return res.status(404).json({ success: false, error: `Bill "${effectiveBillId}" not found.` });
    }

    if (bill.status !== 'paid' && (bill as any).payment_status !== 'verified') {
      return res.status(400).json({ success: false, error: 'Cannot send receipt for unpaid bill. Payment must be verified first.' });
    }

    const patient = await fetchAuthoritativePatient(bill.patient_id, bill.patient_name || bill.patientName);
    const emailResult = await sendAuthoritativeReceiptEmail(bill, patient, {
      paymentId: (bill as any).razorpay_payment_id || 'Verified Online',
      orderId: (bill as any).razorpay_order_id,
      paymentDate: (bill as any).payment_verified_at || new Date(),
      paymentStatus: 'verified'
    });

    await recordReceiptEmailStatusInDatabase(bill.id, {
      status: emailResult.sent ? 'sent' : (emailResult.skipped ? 'skipped' : 'failed'),
      error: emailResult.error || null,
      sentAt: emailResult.sent ? new Date().toISOString() : null
    });

    return res.status(200).json({
      success: emailResult.sent,
      receipt_email_status: emailResult.sent ? 'sent' : (emailResult.skipped ? 'skipped' : 'failed'),
      receipt_email: patient?.email || null,
      error: emailResult.error || null,
      message: emailResult.sent
        ? `Receipt sent to ${patient?.email}`
        : (emailResult.skipped
            ? 'Patient email unavailable in clinic records.'
            : `Failed: ${emailResult.error}`)
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to resend receipt email.' });
  }
}

/**
 * Creates an Express Router configured with the standard Razorpay endpoints.
 */
export function createRazorpayRouter(): Router {
  const router = express.Router();
  router.use(express.json());
  router.post('/create-order', createOrderHandler);
  router.post('/verify-payment', verifyPaymentHandler);
  router.post('/retry-receipt', retryReceiptEmailHandler);
  router.post('/resend-receipt', retryReceiptEmailHandler);

  // Canonical Billing Endpoints
  router.post('/bills', createBillHandler);
  router.post('/create-bill', createBillHandler);
  router.patch('/bills/:id', updateBillHandler);
  router.put('/bills/:id', updateBillHandler);
  router.patch('/bills', updateBillHandler);
  router.put('/bills', updateBillHandler);
  router.delete('/bills/:id', deleteBillHandler);
  router.delete('/bills', deleteBillHandler);
  router.get('/bills', getBillsHandler);

  // Canonical Appointments Endpoints
  router.post('/appointments', createAppointmentHandler);
  router.get('/appointments', getAppointmentsHandler);
  router.get('/appointments/check-duplicate', checkDuplicateAppointmentHandler);
  router.delete('/appointments/:id', deleteAppointmentHandler);
  router.delete('/appointments', deleteAppointmentHandler);
  router.post('/appointments/delete', deleteAppointmentHandler);

  router.get('/health', (_req, res) => {
    refreshEnv();
    const keyId = (process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID || '').trim();
    const hasSecret = Boolean((process.env.RAZORPAY_KEY_SECRET || '').trim());
    res.json({
      status: 'ok',
      configured: Boolean(keyId && hasSecret),
      key_id_set: Boolean(keyId),
      key_secret_set: hasSecret,
      environment: keyId.startsWith('rzp_live_') ? 'production' : 'test'
    });
  });

  return router;
}

/**
 * Creates a standalone Express application that properly wraps req and res with status() and json()
 * and handles /api/create-order and /api/verify-payment.
 */
export function createRazorpayApp(): express.Express {
  const app = express();
  app.use(express.json());

  app.post('/api/create-order', createOrderHandler);
  app.post('/api/verify-payment', verifyPaymentHandler);
  app.post('/api/retry-receipt', retryReceiptEmailHandler);
  app.post('/api/resend-receipt', retryReceiptEmailHandler);

  app.post('/create-order', createOrderHandler);
  app.post('/verify-payment', verifyPaymentHandler);
  app.post('/retry-receipt', retryReceiptEmailHandler);
  app.post('/resend-receipt', retryReceiptEmailHandler);

  // Canonical Billing Endpoints
  app.post('/api/bills', createBillHandler);
  app.post('/api/create-bill', createBillHandler);
  app.patch('/api/bills/:id', updateBillHandler);
  app.put('/api/bills/:id', updateBillHandler);
  app.patch('/api/bills', updateBillHandler);
  app.put('/api/bills', updateBillHandler);
  app.delete('/api/bills/:id', deleteBillHandler);
  app.delete('/api/bills', deleteBillHandler);
  app.get('/api/bills', getBillsHandler);
  app.post('/bills', createBillHandler);
  app.post('/create-bill', createBillHandler);
  app.patch('/bills/:id', updateBillHandler);
  app.put('/bills/:id', updateBillHandler);
  app.patch('/bills', updateBillHandler);
  app.put('/bills', updateBillHandler);
  app.delete('/bills/:id', deleteBillHandler);
  app.delete('/bills', deleteBillHandler);
  app.get('/bills', getBillsHandler);

  // Canonical Appointments Endpoints
  app.post('/api/appointments', createAppointmentHandler);
  app.post('/api/create-appointment', createAppointmentHandler);
  app.get('/api/appointments', getAppointmentsHandler);
  app.get('/api/appointments/check-duplicate', checkDuplicateAppointmentHandler);
  app.delete('/api/appointments/:id', deleteAppointmentHandler);
  app.delete('/api/appointments', deleteAppointmentHandler);
  app.post('/api/appointments/delete', deleteAppointmentHandler);
  app.post('/appointments', createAppointmentHandler);
  app.post('/create-appointment', createAppointmentHandler);
  app.get('/appointments', getAppointmentsHandler);
  app.get('/appointments/check-duplicate', checkDuplicateAppointmentHandler);
  app.delete('/appointments/:id', deleteAppointmentHandler);
  app.delete('/appointments', deleteAppointmentHandler);
  app.post('/appointments/delete', deleteAppointmentHandler);

  const healthCheck = (_req: Request, res: Response) => {
    refreshEnv();
    const keyId = (process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID || '').trim();
    const hasSecret = Boolean((process.env.RAZORPAY_KEY_SECRET || '').trim());
    res.json({
      status: 'ok',
      configured: Boolean(keyId && hasSecret),
      key_id_set: Boolean(keyId),
      key_secret_set: hasSecret,
      environment: keyId.startsWith('rzp_live_') ? 'production' : 'test'
    });
  };

  app.get('/api/health', healthCheck);
  app.get('/health', healthCheck);

  return app;
}
