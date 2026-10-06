-- Migration: 20261006110000_enable_patients_policies.sql
-- Description: Enables permissive read and write policies on public.patients for backend services, billing, and receptionists.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'patients' AND policyname = 'allow_receptionist_and_all_select_patients'
  ) THEN
    CREATE POLICY "allow_receptionist_and_all_select_patients" ON public.patients FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'patients' AND policyname = 'allow_receptionist_and_staff_write_patients'
  ) THEN
    CREATE POLICY "allow_receptionist_and_staff_write_patients" ON public.patients FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
