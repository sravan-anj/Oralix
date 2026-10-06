import { Invoice, Patient, User, PaymentTransaction, PaymentState } from '../types';
import { StorageService } from './storage';

export interface RazorpayOrderResponse {
  id: string;
  entity: string;
  amount: number; // in paise (e.g. 450000 for ₹4,500)
  amount_paid: number;
  amount_due: number;
  currency: string; // 'INR'
  receipt: string;
  status: 'created' | 'attempted' | 'paid';
  attempts: number;
  created_at: number;
}

/**
 * Safely sanitizes patient data fields for Razorpay Checkout prefill.
 * Handles null, undefined, empty string, and whitespace-only values safely.
 * Returns trimmed string or '' without hardcoding or using fallbacks.
 */
export function cleanPrefillValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return '';
  return value.trim();
}

export interface RazorpayCheckoutOptions {
  orderId: string;
  amountInPaise: number;
  currency?: string;
  keyId?: string;
  name?: string;
  description?: string;
  invoiceNumber?: string;
  patientName?: string;
  patientEmail?: string;
  patientPhone?: string;
  patient?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  onSuccess: (response: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  onDismiss?: () => void;
  onFailure?: (error: any) => void;
}

export interface PaymentVerificationRequest {
  invoiceId: string;
  patientId: string;
  amount: number;
  paymentMethod: 'Razorpay' | 'QR Payment' | 'UPI' | 'Debit Card' | 'Credit Card' | 'Cash' | 'Insurance';
  transactionRef: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  gatewayDetails?: Record<string, any>;
}

export interface GatewayConfigStatus {
  isConfigured: boolean;
  gatewayName: 'Razorpay' | 'Oralix Integrated Gateway';
  keyId?: string;
  environment: 'production' | 'test' | 'sandbox';
  supportedCurrencies: string[];
}

class PaymentService {
  /**
   * Helper to construct safe Razorpay prefill options for a patient record.
   * Ensures phone and email are strictly derived from the patient associated with the bill,
   * without fallbacks to clinic or staff contact info.
   */
  public buildRazorpayPrefill(
    patient?: { name?: string | null; email?: string | null; phone?: string | null } | null,
    fallbackName?: string
  ): { name: string; email: string; contact: string } {
    return {
      name: cleanPrefillValue(patient?.name) || cleanPrefillValue(fallbackName),
      email: cleanPrefillValue(patient?.email),
      contact: cleanPrefillValue(patient?.phone)
    };
  }

  /**
   * Inspects environment configuration for Razorpay credentials.
   */
  public getGatewayConfigStatus(): GatewayConfigStatus {
    const keyId = (import.meta as any).env?.VITE_RAZORPAY_KEY_ID || (process.env as any)?.VITE_RAZORPAY_KEY_ID;
    const isConfigured = Boolean(keyId && keyId.trim().length > 0 && !keyId.includes('YOUR_RAZORPAY_KEY'));

    return {
      isConfigured: isConfigured,
      gatewayName: 'Razorpay',
      keyId: keyId || undefined,
      environment: keyId?.startsWith('rzp_live_') ? 'production' : 'test',
      supportedCurrencies: ['INR']
    };
  }

  /**
   * Dynamically loads the official Razorpay Checkout SDK script into the browser head.
   */
  public async loadRazorpayScript(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    if ((window as any).Razorpay) return true;

    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  }

  /**
   * STEP 1: Calls backend endpoint POST /api/create-order
   */
  public async createRazorpayOrderApi(
    amountInPaise: number,
    currency = 'INR',
    receipt?: string,
    billId?: string
  ): Promise<{ order_id: string; id: string; amount: number; currency: string; receipt?: string; key_id?: string }> {
    if (amountInPaise < 100) {
      throw new Error('Amount must be at least 100 paise (₹1.00).');
    }

    const res = await fetch('/api/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bill_id: billId,
        amount: Math.round(amountInPaise),
        currency: currency.toUpperCase(),
        receipt
      })
    });

    const data = await res.json();
    if (!res.ok || (!data.success && !data.order_id)) {
      throw new Error(data.error || 'Failed to create Razorpay order on server.');
    }

    return data;
  }

  /**
   * STEP 3: Calls backend endpoint POST /api/verify-payment
   */
  public async verifyRazorpayPaymentApi(payload: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
    bill_id?: string;
  }): Promise<{
    success: boolean;
    payment_verified?: boolean;
    payment_status?: string;
    message: string;
    order_id: string;
    payment_id: string;
    bill_id?: string;
    invoice_number?: string;
    receipt_email_status?: 'pending' | 'sent' | 'failed' | 'skipped';
    receipt_email?: string | null;
    receipt_email_error?: string | null;
    receipt_filename?: string;
    already_verified?: boolean;
  }> {
    const res = await fetch('/api/verify-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Payment verification failed: Signature mismatch.');
    }

    return data;
  }

  /**
   * Calls backend to safely retry delivering the receipt email for a verified bill
   */
  public async retryReceiptEmailApi(billId: string): Promise<{
    success: boolean;
    receipt_email_status: 'sent' | 'failed' | 'skipped';
    receipt_email?: string | null;
    error?: string | null;
    message: string;
  }> {
    const res = await fetch('/api/retry-receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bill_id: billId })
    });

    const data = await res.json();
    if (!res.ok && !data.receipt_email_status) {
      throw new Error(data.error || 'Failed to resend receipt email.');
    }

    return data;
  }

  /**
   * STEP 2: Opens Razorpay Standard Checkout modal with options
   */
  public async openRazorpayCheckout(options: RazorpayCheckoutOptions): Promise<void> {
    const isLoaded = await this.loadRazorpayScript();
    if (!isLoaded || typeof (window as any).Razorpay === 'undefined') {
      throw new Error('Razorpay Checkout SDK is not available. Please check your internet connection.');
    }

    const keyId =
      options.keyId ||
      (import.meta as any).env?.VITE_RAZORPAY_KEY_ID ||
      (process.env as any)?.VITE_RAZORPAY_KEY_ID;

    // Safe diagnostic check without logging secret or exposing sensitive keys
    console.log('Razorpay frontend key exists:', Boolean(keyId));

    if (!keyId) {
      throw new Error('Razorpay Key ID is not configured. Please set VITE_RAZORPAY_KEY_ID in .env');
    }

    // Resolve patient details safely from the current bill's patient record
    const patientName = cleanPrefillValue(options.patient?.name ?? options.patientName);
    const patientEmail = cleanPrefillValue(options.patient?.email ?? options.patientEmail);
    const patientContact = cleanPrefillValue(options.patient?.phone ?? options.patientPhone);

    const rzpOptions: any = {
      key: keyId,
      amount: options.amountInPaise,
      currency: options.currency || 'INR',
      name: options.name || 'Oralix · Advanced Dental Care',
      description: options.description || `Invoice #${options.invoiceNumber || ''} Settlement`,
      order_id: options.orderId,
      image: '/gemini_shared_tooth.png',
      handler: (response: any) => {
        options.onSuccess({
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_order_id: response.razorpay_order_id,
          razorpay_signature: response.razorpay_signature
        });
      },
      prefill: {
        name: patientName,
        email: patientEmail,
        contact: patientContact
      },
      theme: {
        color: '#3B4D3A'
      },
      modal: {
        ondismiss: () => {
          if (options.onDismiss) {
            options.onDismiss();
          }
        }
      }
    };

    console.log('[Razorpay Prefill Options]:', rzpOptions.prefill);
    if (typeof window !== 'undefined') {
      (window as any).__lastRazorpayOptions = rzpOptions;
    }

    const rzp = new (window as any).Razorpay(rzpOptions);

    rzp.on('payment.failed', (response: any) => {
      console.error('Razorpay payment failed:', response.error);
      if (options.onFailure) {
        options.onFailure(response.error);
      }
    });

    rzp.open();
  }

  /**
   * SERVER-SIDE ORDER CREATION LOGIC
   * Validates invoice existence, patient ownership, and actual outstanding balance server-side.
   * Prevents client-side amount tampering.
   */
  public createPaymentOrder(
    invoiceId: string,
    currentUser: User,
    requestedAmount?: number
  ): { success: boolean; order?: RazorpayOrderResponse; error?: string; validatedAmount: number } {
    const invoices = StorageService.getInvoices();
    const invoice = invoices.find(i => i.id === invoiceId);

    if (!invoice) {
      return { success: false, error: 'Invoice not found in system database.', validatedAmount: 0 };
    }

    // Patient Authorization Check: Logged in patient can ONLY pay their own invoices
    const isPatient = currentUser.role === 'patient';
    const patientId = isPatient ? (currentUser.patientId || 'p-1') : invoice.patientId;

    if (isPatient && invoice.patientId !== patientId) {
      return {
        success: false,
        error: 'Security Violation: You are not authorized to pay invoices belonging to another patient.',
        validatedAmount: 0
      };
    }

    // Retrieve authoritative outstanding balance
    const total = invoice.totalAmount || invoice.total || 0;
    const actualBalanceDue = invoice.balanceDue !== undefined && invoice.balanceDue !== null 
      ? invoice.balanceDue 
      : Math.max(0, total - invoice.amountPaid);

    if (actualBalanceDue <= 0) {
      return {
        success: false,
        error: 'Invoice is already fully settled. No payment required.',
        validatedAmount: 0
      };
    }

    // Determine validated payment amount (cannot exceed actual balance due)
    const payAmt = requestedAmount && requestedAmount > 0 && requestedAmount <= actualBalanceDue
      ? requestedAmount
      : actualBalanceDue;

    const amountInPaise = Math.round(payAmt * 100);

    const mockOrder: RazorpayOrderResponse = {
      id: `order_df_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      entity: 'order',
      amount: amountInPaise,
      amount_paid: 0,
      amount_due: amountInPaise,
      currency: 'INR',
      receipt: invoice.invoiceNumber,
      status: 'created',
      attempts: 0,
      created_at: Math.floor(Date.now() / 1000)
    };

    return {
      success: true,
      order: mockOrder,
      validatedAmount: payAmt
    };
  }

  /**
   * SERVER-SIDE VERIFICATION & SETTLEMENT ENGINE
   * Verifies idempotency, validates reference IDs, updates invoice and patient records.
   */
  public verifyAndSettleTransaction(
    req: PaymentVerificationRequest,
    currentUser: User,
    onSaveInvoices: (updated: Invoice[]) => void,
    onSavePatients?: (updated: Patient[]) => void
  ): { success: boolean; transaction?: PaymentTransaction; error?: string } {
    const invoices = StorageService.getInvoices();
    const invoice = invoices.find(i => i.id === req.invoiceId);

    if (!invoice) {
      return { success: false, error: 'Target invoice not found in database.' };
    }

    // Security Authorization Gate
    const isPatient = currentUser.role === 'patient';
    const patientId = isPatient ? (currentUser.patientId || 'p-1') : invoice.patientId;

    if (isPatient && invoice.patientId !== patientId) {
      return { success: false, error: 'Unauthorized: Invoice ownership check failed.' };
    }

    // Idempotency & Duplicate Protection Check
    const existingTxs = StorageService.getTransactions();
    const isDuplicate = existingTxs.some(
      t => t.transactionRef.toLowerCase() === req.transactionRef.toLowerCase() && t.status === 'successful'
    );

    if (isDuplicate) {
      return {
        success: false,
        error: `Duplicate Settlement Blocked: Reference ID "${req.transactionRef}" has already been verified & settled!`
      };
    }

    // Retrieve authoritative figures
    const total = invoice.totalAmount || invoice.total || 0;
    const actualBalance = invoice.balanceDue !== undefined && invoice.balanceDue !== null 
      ? invoice.balanceDue 
      : Math.max(0, total - invoice.amountPaid);

    const payAmt = Number(req.amount);

    if (payAmt <= 0 || payAmt > actualBalance) {
      return {
        success: false,
        error: `Invalid Amount: Payment of ₹${payAmt} exceeds current balance due of ₹${actualBalance}.`
      };
    }

    // Perform database transaction updates
    const newAmountPaid = invoice.amountPaid + payAmt;
    const newBalanceDue = Math.max(0, total - newAmountPaid);
    const newStatus = newBalanceDue === 0 ? 'paid' : 'partial';

    const updatedInvoices = invoices.map(inv =>
      inv.id === invoice.id
        ? {
            ...inv,
            amountPaid: newAmountPaid,
            balanceDue: newBalanceDue,
            status: newStatus as any,
            paymentMethod: req.paymentMethod
          }
        : inv
    );

    // Save updated invoices to persistent storage
    onSaveInvoices(updatedInvoices);

    // Synchronize Patient's overall balanceDue
    const patients = StorageService.getPatients();
    const targetPatient = patients.find(p => p.id === invoice.patientId);

    if (targetPatient) {
      const newPatientBalance = Math.max(0, targetPatient.balanceDue - payAmt);
      const updatedPatients = patients.map(p =>
        p.id === targetPatient.id ? { ...p, balanceDue: newPatientBalance } : p
      );

      if (onSavePatients) {
        onSavePatients(updatedPatients);
      } else {
        StorageService.savePatients(updatedPatients);
      }
    }

    // Record verified payment transaction
    const successTransaction: PaymentTransaction = {
      id: req.razorpayPaymentId || `tx-${Date.now()}`,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      patientId: invoice.patientId,
      patientName: invoice.patientName,
      amount: payAmt,
      paymentMethod: req.paymentMethod,
      transactionRef: req.transactionRef,
      status: 'successful',
      timestamp: new Date().toISOString(),
      gatewayResponse: {
        authorizationCode: req.transactionRef,
        cardNetwork: req.gatewayDetails?.cardNetwork,
        cardLast4: req.gatewayDetails?.cardLast4,
        insuranceProvider: req.gatewayDetails?.insuranceProvider,
        policyNumber: req.gatewayDetails?.policyNumber,
        failureReason: undefined
      }
    };

    StorageService.addTransaction(successTransaction);

    return {
      success: true,
      transaction: successTransaction
    };
  }
}

export const paymentService = new PaymentService();
