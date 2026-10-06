-- Migration: 20261005235500_add_receipt_and_payment_verification_fields.sql
-- Description: Adds payment verification and receipt email audit fields to public.invoices

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS receipt_email_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS receipt_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS receipt_email_error TEXT,
  ADD COLUMN IF NOT EXISTS receipt_pdf_generated_at TIMESTAMPTZ;

-- Backfill existing paid invoices to have consistent status
UPDATE public.invoices
SET payment_status = 'verified'
WHERE status = 'paid' AND (payment_status IS NULL OR payment_status = 'pending');
