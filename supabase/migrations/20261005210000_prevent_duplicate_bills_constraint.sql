-- Migration: 20261005210000_prevent_duplicate_bills_constraint.sql
-- Description: Enforces backend/database level uniqueness to prevent duplicate bills for the same patient and bill context.

-- 1. Ensure test patients exist for duplicate prevention test suites
INSERT INTO public.patients (id, code, name, age, gender, phone, email, registered_date)
VALUES 
  ('p-rahul', 'DF-2026-RAHUL', 'Rahul', 32, 'Male', '+91 98765 00001', 'rahul@example.com', CURRENT_DATE),
  ('p-priya', 'DF-2026-PRIYA', 'Priya', 28, 'Female', '+91 98765 00002', 'priya@example.com', CURRENT_DATE)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, age = EXCLUDED.age, gender = EXCLUDED.gender;

-- 2. Create expression-based unique indexes for patient_id + description and patient_name + description
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_patient_id_description_unique
ON public.invoices (patient_id, LOWER(TRIM(description)))
WHERE description IS NOT NULL AND TRIM(description) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_patient_name_description_unique
ON public.invoices (LOWER(TRIM(patient_name)), LOWER(TRIM(description)))
WHERE description IS NOT NULL AND TRIM(description) <> '' AND patient_name IS NOT NULL AND TRIM(patient_name) <> '';

-- 3. Create database trigger function to reject duplicate bills with user-facing error message
CREATE OR REPLACE FUNCTION public.check_invoice_duplicate()
RETURNS TRIGGER AS $$
DECLARE
  v_dup_id TEXT;
BEGIN
  IF NEW.description IS NOT NULL AND TRIM(NEW.description) <> '' THEN
    SELECT id INTO v_dup_id
    FROM public.invoices
    WHERE id <> COALESCE(NEW.id, '')
      AND (
        patient_id = NEW.patient_id
        OR (NEW.patient_name IS NOT NULL AND LOWER(TRIM(patient_name)) = LOWER(TRIM(NEW.patient_name)))
      )
      AND LOWER(TRIM(description)) = LOWER(TRIM(NEW.description))
    LIMIT 1;

    IF v_dup_id IS NOT NULL THEN
      RAISE EXCEPTION 'This bill has already been created for this patient.' USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_check_invoice_duplicate'
  ) THEN
    CREATE TRIGGER trg_check_invoice_duplicate
    BEFORE INSERT OR UPDATE OF patient_id, patient_name, description
    ON public.invoices
    FOR EACH ROW
    EXECUTE FUNCTION public.check_invoice_duplicate();
  END IF;
END $$;
