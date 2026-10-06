-- Migration: 20261006110500_enable_payment_transactions_policies.sql
-- Description: Enables permissive read and write policies on public.payment_transactions for backend services, billing, and receptionists.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'payment_transactions' AND policyname = 'allow_receptionist_and_staff_select_transactions'
  ) THEN
    CREATE POLICY "allow_receptionist_and_staff_select_transactions" ON public.payment_transactions FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'payment_transactions' AND policyname = 'allow_receptionist_and_staff_write_transactions'
  ) THEN
    CREATE POLICY "allow_receptionist_and_staff_write_transactions" ON public.payment_transactions FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
