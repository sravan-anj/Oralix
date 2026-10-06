-- Migration: 20261006193000_prevent_duplicate_appointments_and_bills.sql
-- Description: Enforces backend/database level uniqueness to prevent duplicate appointments by email or phone,
-- duplicate bills for the same appointment, and provides atomic permanent deletion for cancelled appointments and patient data.

-- 1. Ensure columns exist on public.appointments
ALTER TABLE public.appointments 
ADD COLUMN IF NOT EXISTS patient_email text,
ADD COLUMN IF NOT EXISTS patient_phone text;

-- 2. Billing: Create unique index on invoices.appointment_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_appointment_id_unique
ON public.invoices (appointment_id)
WHERE appointment_id IS NOT NULL AND TRIM(appointment_id) <> '';

-- 3. Billing: Trigger function to reject duplicate bills
CREATE OR REPLACE FUNCTION public.check_invoice_duplicate()
RETURNS TRIGGER AS $$
DECLARE
  v_dup_id TEXT;
BEGIN
  -- 1. Enforce strictly one bill per appointment
  IF NEW.appointment_id IS NOT NULL AND TRIM(NEW.appointment_id) <> '' THEN
    SELECT id INTO v_dup_id
    FROM public.invoices
    WHERE id <> COALESCE(NEW.id, '')
      AND appointment_id = TRIM(NEW.appointment_id)
    LIMIT 1;

    IF v_dup_id IS NOT NULL THEN
      RAISE EXCEPTION 'Bill Already Created: A bill has already been created for this patient/appointment. You cannot create another bill for the same appointment.' USING ERRCODE = '23505';
    END IF;
  END IF;

  -- 2. Fallback for manual bills without appointment_id: prevent duplicate description for same patient
  IF NEW.description IS NOT NULL AND TRIM(NEW.description) <> '' THEN
    SELECT id INTO v_dup_id
    FROM public.invoices
    WHERE id <> COALESCE(NEW.id, '')
      AND (
        patient_id = NEW.patient_id
        OR (NEW.patient_name IS NOT NULL AND LOWER(TRIM(patient_name)) = LOWER(TRIM(NEW.patient_name)))
      )
      AND LOWER(TRIM(description)) = LOWER(TRIM(NEW.description))
      AND (
        (NEW.appointment_id IS NULL AND appointment_id IS NULL)
        OR (NEW.appointment_id = appointment_id)
      )
    LIMIT 1;

    IF v_dup_id IS NOT NULL THEN
      RAISE EXCEPTION 'Bill Already Created: A bill has already been created for this patient/appointment. You cannot create another bill for the same appointment.' USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Appointments: Unique indexes on email and normalized phone (last 10 digits)
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_patient_email_unique 
ON public.appointments (LOWER(TRIM(patient_email))) 
WHERE patient_email IS NOT NULL AND TRIM(patient_email) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_patient_phone_unique 
ON public.appointments (RIGHT(regexp_replace(patient_phone, '[^0-9]', '', 'g'), 10)) 
WHERE patient_phone IS NOT NULL AND regexp_replace(patient_phone, '[^0-9]', '', 'g') <> '';

-- 5. Appointments: Function to reject duplicate appointments by email OR phone
CREATE OR REPLACE FUNCTION public.check_appointment_duplicate()
RETURNS TRIGGER AS $$
DECLARE
  v_dup_id TEXT;
  v_email TEXT;
  v_phone_digits TEXT;
BEGIN
  -- 1. Extract email and normalized phone from NEW appointment
  v_email := LOWER(TRIM(COALESCE(NEW.patient_email, '')));
  v_phone_digits := RIGHT(regexp_replace(COALESCE(NEW.patient_phone, ''), '[^0-9]', '', 'g'), 10);

  -- 2. Fallback to linked patient record if fields were empty on appointment
  IF (v_email = '' OR v_phone_digits = '') AND NEW.patient_id IS NOT NULL THEN
    SELECT 
      CASE WHEN v_email = '' THEN LOWER(TRIM(COALESCE(email, ''))) ELSE v_email END,
      CASE WHEN v_phone_digits = '' THEN RIGHT(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10) ELSE v_phone_digits END
    INTO v_email, v_phone_digits
    FROM public.patients
    WHERE id = NEW.patient_id;
  END IF;

  -- 3. Check if another appointment already exists with the same email OR same phone
  IF (v_email IS NOT NULL AND v_email <> '') OR (v_phone_digits IS NOT NULL AND v_phone_digits <> '') THEN
    SELECT a.id INTO v_dup_id
    FROM public.appointments a
    LEFT JOIN public.patients p ON a.patient_id = p.id
    WHERE a.id <> COALESCE(NEW.id, '')
      AND (
        (
          v_email IS NOT NULL AND v_email <> '' AND (
            LOWER(TRIM(COALESCE(a.patient_email, ''))) = v_email
            OR LOWER(TRIM(COALESCE(p.email, ''))) = v_email
          )
        )
        OR
        (
          v_phone_digits IS NOT NULL AND v_phone_digits <> '' AND (
            RIGHT(regexp_replace(COALESCE(a.patient_phone, ''), '[^0-9]', '', 'g'), 10) = v_phone_digits
            OR RIGHT(regexp_replace(COALESCE(p.phone, ''), '[^0-9]', '', 'g'), 10) = v_phone_digits
          )
        )
      )
    LIMIT 1;

    IF v_dup_id IS NOT NULL THEN
      RAISE EXCEPTION 'Appointment Already Booked: An appointment already exists for this email address or phone number. Please check your existing appointment instead of booking again.' USING ERRCODE = '23505';
    END IF;
  END IF;

  -- 4. Date and time slot check for active appointments
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

-- 6. Stored procedure to safely delete cancelled appointment and associated patient data
CREATE OR REPLACE FUNCTION public.delete_appointment_and_patient(
  p_appointment_id TEXT,
  p_patient_id TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_effective_patient_id TEXT;
  v_deleted_apts INT := 0;
  v_deleted_pts INT := 0;
BEGIN
  -- 1. Determine effective patient_id if not supplied
  IF p_patient_id IS NULL OR TRIM(p_patient_id) = '' THEN
    SELECT patient_id INTO v_effective_patient_id
    FROM public.appointments
    WHERE id = p_appointment_id;
  ELSE
    v_effective_patient_id := TRIM(p_patient_id);
  END IF;

  -- 2. Clear patient_id in profiles if linked
  IF v_effective_patient_id IS NOT NULL AND v_effective_patient_id <> '' THEN
    UPDATE public.profiles
    SET patient_id = NULL
    WHERE patient_id = v_effective_patient_id;
  END IF;

  -- 3. Delete invoices explicitly if tied to appointment
  IF p_appointment_id IS NOT NULL AND TRIM(p_appointment_id) <> '' THEN
    DELETE FROM public.invoices WHERE appointment_id = p_appointment_id;
  END IF;

  -- 4. Delete the appointment
  IF p_appointment_id IS NOT NULL AND TRIM(p_appointment_id) <> '' THEN
    DELETE FROM public.appointments WHERE id = p_appointment_id;
    GET DIAGNOSTICS v_deleted_apts = ROW_COUNT;
  END IF;

  -- 5. Delete associated patient data if valid
  IF v_effective_patient_id IS NOT NULL AND v_effective_patient_id <> '' THEN
    DELETE FROM public.patients WHERE id = v_effective_patient_id;
    GET DIAGNOSTICS v_deleted_pts = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_appointments', v_deleted_apts,
    'deleted_patients', v_deleted_pts,
    'patient_id', v_effective_patient_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.delete_appointment_and_patient(TEXT, TEXT) TO authenticated, anon, service_role;
