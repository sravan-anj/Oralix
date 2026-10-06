-- Migration: 20261005232000_general_doctor_gmail_connection.sql
-- Description: Support shared/general doctor account and dedicated clinic Gmail connection

-- 1. Make user_id nullable to allow clinic-wide connection without forcing fake user IDs
ALTER TABLE public.gmail_connections ALTER COLUMN user_id DROP NOT NULL;

-- 2. Add clinic_id column for single shared/primary clinic identifier
ALTER TABLE public.gmail_connections ADD COLUMN IF NOT EXISTS clinic_id TEXT DEFAULT 'default';
CREATE UNIQUE INDEX IF NOT EXISTS idx_gmail_connections_clinic_id ON public.gmail_connections(clinic_id);

-- 3. Grant column-level select permissions on non-sensitive columns
GRANT SELECT (id, user_id, clinic_id, email, scope, status, created_at, updated_at) 
ON public.gmail_connections TO authenticated, anon;

-- 4. Update RLS policy to allow reading clinic Gmail connection status
DROP POLICY IF EXISTS "Users can view own gmail connection" ON public.gmail_connections;
DROP POLICY IF EXISTS "Allow reading clinic gmail connection status" ON public.gmail_connections;

CREATE POLICY "Allow reading clinic gmail connection status"
ON public.gmail_connections
FOR SELECT
TO authenticated, anon
USING (true);

-- 5. RPC function to inspect clinic Gmail connection status
CREATE OR REPLACE FUNCTION public.get_clinic_gmail_connection_status()
RETURNS TABLE (
  is_connected BOOLEAN,
  email TEXT,
  status TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (gc.status = 'connected') AS is_connected,
    gc.email,
    gc.status,
    gc.updated_at
  FROM public.gmail_connections gc
  WHERE gc.status = 'connected'
  ORDER BY gc.updated_at DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_clinic_gmail_connection_status() TO authenticated, anon;

-- 6. Update legacy get_my_gmail_connection function to return primary connection
CREATE OR REPLACE FUNCTION public.get_my_gmail_connection()
RETURNS TABLE (
  id UUID,
  user_id UUID,
  email TEXT,
  status TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT id, user_id, email, status, created_at, updated_at
  FROM public.gmail_connections
  WHERE status = 'connected'
  ORDER BY updated_at DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_gmail_connection() TO authenticated, anon;

-- 7. RPC function to safely disconnect clinic Gmail
CREATE OR REPLACE FUNCTION public.disconnect_clinic_gmail()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.gmail_connections
  SET status = 'disconnected', updated_at = now()
  WHERE clinic_id = 'default' OR status = 'connected';
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.disconnect_clinic_gmail() TO authenticated, anon;
