-- Migration: 20261006120000_appointments_billing_sync.sql
-- Description: Ensures appointment persistent schema, realtime publication, and synchronization policies.

-- 1. Ensure columns exist on public.appointments
ALTER TABLE public.appointments 
ADD COLUMN IF NOT EXISTS patient_email text,
ADD COLUMN IF NOT EXISTS patient_phone text;

-- 2. Enable Realtime publication for public.appointments
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'appointments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
  END IF;
END $$;

-- 3. Set replica identity full on appointments
ALTER TABLE public.appointments REPLICA IDENTITY FULL;

-- 4. Enable permissive policies on public.appointments for receptionists and sync
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'appointments' AND policyname = 'allow_receptionist_and_all_select_appointments'
  ) THEN
    CREATE POLICY "allow_receptionist_and_all_select_appointments" ON public.appointments FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'appointments' AND policyname = 'allow_receptionist_and_staff_write_appointments'
  ) THEN
    CREATE POLICY "allow_receptionist_and_staff_write_appointments" ON public.appointments FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 5. Index on invoices appointment_id
CREATE INDEX IF NOT EXISTS idx_invoices_appointment_id ON public.invoices(appointment_id);

-- 6. Ensure notes column exists on public.invoices
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS notes text;
