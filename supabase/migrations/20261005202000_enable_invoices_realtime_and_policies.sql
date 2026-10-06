-- Migration: 20261005202000_enable_invoices_realtime_and_policies.sql
-- Description: Enables Supabase Realtime publication on public.invoices and configures shared canonical policies for doctor and receptionist dashboards.

-- 1. Enable Realtime publication for public.invoices
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'invoices'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.invoices;
  END IF;
END $$;

-- 2. Set replica identity full so all columns are included in update/delete realtime payloads
ALTER TABLE public.invoices REPLICA IDENTITY FULL;

-- 3. Ensure permissive read and write policies for shared canonical bill record across Doctor and Receptionist dashboards
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'invoices' AND policyname = 'allow_receptionist_and_all_select_invoices'
  ) THEN
    CREATE POLICY "allow_receptionist_and_all_select_invoices" ON public.invoices FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'invoices' AND policyname = 'allow_receptionist_and_staff_write_invoices'
  ) THEN
    CREATE POLICY "allow_receptionist_and_staff_write_invoices" ON public.invoices FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
