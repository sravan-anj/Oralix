-- Migration: 20261005224000_create_gmail_connections.sql
-- Description: Create dedicated gmail_connections table for secure per-doctor Gmail OAuth refresh tokens

CREATE TABLE IF NOT EXISTS public.gmail_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  refresh_token TEXT NOT NULL,
  scope TEXT DEFAULT 'https://www.googleapis.com/auth/gmail.send',
  status TEXT DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected', 'revoked')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index on user_id for high performance lookups
CREATE INDEX IF NOT EXISTS idx_gmail_connections_user_id ON public.gmail_connections(user_id);

-- Enable Row Level Security
ALTER TABLE public.gmail_connections ENABLE ROW LEVEL SECURITY;

-- Column level security: Prevent any client-side access to refresh_token
REVOKE ALL ON public.gmail_connections FROM anon, public;
GRANT SELECT (id, user_id, email, scope, status, created_at, updated_at) ON public.gmail_connections TO authenticated;
GRANT ALL ON public.gmail_connections TO service_role;
GRANT ALL ON public.gmail_connections TO postgres;

-- Policy: Authenticated users can only select their own connection metadata
CREATE POLICY "Users can view own gmail connection"
ON public.gmail_connections
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Secure RPC function to inspect connection status safely
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
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_gmail_connection() TO authenticated;
