-- Migration: 20261006180000_prevent_duplicate_appointments_constraint.sql
-- Description: Enforces backend/database level uniqueness to prevent duplicate appointment slot bookings for the same date and time.

-- 1. Ensure columns exist on public.appointments
ALTER TABLE public.appointments 
ADD COLUMN IF NOT EXISTS patient_email text,
ADD COLUMN IF NOT EXISTS patient_phone text;

-- 2. Create unique index preventing duplicate active bookings for the same date and time
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_date_time_unique
ON public.appointments (date, LOWER(TRIM(time)))
WHERE status <> 'cancelled';

-- 3. Create database trigger function to reject duplicate appointment slots with user-facing error message
CREATE OR REPLACE FUNCTION public.check_appointment_duplicate()
RETURNS TRIGGER AS $$
DECLARE
  v_dup_id TEXT;
BEGIN
  IF NEW.status <> 'cancelled' THEN
    SELECT id INTO v_dup_id
    FROM public.appointments
    WHERE id <> COALESCE(NEW.id, '')
      AND date = NEW.date
      AND LOWER(TRIM(time)) = LOWER(TRIM(NEW.time))
      AND status <> 'cancelled'
    LIMIT 1;

    IF v_dup_id IS NOT NULL THEN
      RAISE EXCEPTION 'This appointment slot has already been booked for this date and time.' USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_check_appointment_duplicate'
  ) THEN
    CREATE TRIGGER trg_check_appointment_duplicate
    BEFORE INSERT OR UPDATE OF date, time, status
    ON public.appointments
    FOR EACH ROW
    EXECUTE FUNCTION public.check_appointment_duplicate();
  END IF;
END $$;
