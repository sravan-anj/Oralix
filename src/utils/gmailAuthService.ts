import { supabase } from './supabaseClient';

export interface GmailConnectionStatus {
  isConnected: boolean;
  email?: string;
  status?: string;
  updatedAt?: string;
  error?: string;
}

/**
 * Service to manage clinic Gmail OAuth integration for Dentiflow doctors.
 * Associated with the shared/general Doctor account and clinic integration.
 */
export class GmailAuthService {
  /**
   * Checks whether the clinic/doctor has an active Gmail connection.
   * Row Level Security and column privileges guarantee refresh_token is never sent to the browser.
   */
  static async getStatus(): Promise<GmailConnectionStatus> {
    try {
      // 1. Try secure RPC function for clinic connection status first
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc('get_clinic_gmail_connection_status');
        if (!rpcError && rpcData) {
          const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
          if (row && (row.is_connected || row.status === 'connected')) {
            return {
              isConnected: true,
              email: row.email || undefined,
              status: row.status || 'connected',
              updatedAt: row.updated_at,
            };
          }
        }
      } catch {
        // Fallback to table SELECT below
      }

      // 2. Direct table SELECT on clinic connection (never requests refresh_token)
      try {
        const { data, error } = await supabase
          .from('gmail_connections')
          .select('id, user_id, clinic_id, email, status, updated_at')
          .eq('status', 'connected')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error && data && data.status === 'connected') {
          return {
            isConnected: true,
            email: data.email || undefined,
            status: data.status,
            updatedAt: data.updated_at,
          };
        }
      } catch {
        // Fallback to legacy function
      }

      // 3. Try legacy get_my_gmail_connection RPC
      try {
        const { data: legacyRpc, error: legacyErr } = await supabase.rpc('get_my_gmail_connection');
        if (!legacyErr && legacyRpc) {
          const row = Array.isArray(legacyRpc) ? legacyRpc[0] : legacyRpc;
          if (row && row.status === 'connected') {
            return {
              isConnected: true,
              email: row.email || undefined,
              status: row.status,
              updatedAt: row.updated_at,
            };
          }
        }
      } catch {
        // ignore
      }

      return { isConnected: false };
    } catch (err: any) {
      return { isConnected: false, error: err?.message || 'Failed to check connection' };
    }
  }

  /**
   * Initiates Google OAuth consent flow via Supabase Edge Function
   * The frontend only initiates "Connect Gmail" - no doctorId or doctorEmail is required.
   */
  static async startOAuthFlow(returnUrl?: string): Promise<{ success: boolean; url?: string; error?: string }> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const currentUrl = returnUrl || (typeof window !== 'undefined' ? window.location.href.split('?')[0] : 'http://localhost:3000');

      // Call google-gmail-oauth Edge Function without sending any doctor ID or email
      const { data, error } = await supabase.functions.invoke('google-gmail-oauth', {
        body: { returnUrl: currentUrl },
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : undefined,
      });

      if (error) {
        let serverError: string | undefined;
        try {
          if ('context' in error && (error as any).context && typeof (error as any).context.json === 'function') {
            const errBody = await (error as any).context.json();
            if (errBody?.error) {
              serverError = errBody.error;
            }
          }
        } catch {
          // ignore JSON parsing errors
        }

        return {
          success: false,
          error: serverError || error.message || 'Failed to communicate with Gmail OAuth service.',
        };
      }

      if (!data?.url) {
        return {
          success: false,
          error: data?.error || 'OAuth authorization URL could not be generated.',
        };
      }

      return {
        success: true,
        url: data.url,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Unexpected error initiating Gmail authorization.',
      };
    }
  }

  /**
   * Safely disconnects the clinic Gmail connection
   */
  static async disconnect(): Promise<{ success: boolean; error?: string }> {
    try {
      const { error: rpcErr } = await supabase.rpc('disconnect_clinic_gmail');
      if (!rpcErr) {
        return { success: true };
      }

      const { error: updateErr } = await supabase
        .from('gmail_connections')
        .update({ status: 'disconnected', updated_at: new Date().toISOString() })
        .eq('status', 'connected');

      if (!updateErr) {
        return { success: true };
      }

      return { success: false, error: updateErr.message };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to disconnect Gmail' };
    }
  }

  /**
   * Detects whether the current browser window was returned from Google OAuth
   */
  static parseOAuthCallback(): {
    status: 'connected' | 'error' | null;
    email?: string;
    error?: string;
  } {
    if (typeof window === 'undefined') return { status: null };

    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.substring(1));

    const gmailStatus = searchParams.get('gmail_status') || hashParams.get('gmail_status');
    const gmailEmail = searchParams.get('gmail_email') || hashParams.get('gmail_email');
    const gmailError = searchParams.get('gmail_error') || hashParams.get('gmail_error');

    if (gmailStatus === 'connected') {
      return {
        status: 'connected',
        email: gmailEmail || undefined,
      };
    }

    if (gmailError) {
      return {
        status: 'error',
        error: decodeURIComponent(gmailError).replace(/\+/g, ' '),
      };
    }

    return { status: null };
  }

  /**
   * Cleans OAuth parameters from the browser address bar
   */
  static clearOAuthCallbackUrl(): void {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('gmail_status');
      url.searchParams.delete('gmail_email');
      url.searchParams.delete('gmail_error');
      const cleanSearch = url.searchParams.toString();
      const newUrl = url.pathname + (cleanSearch ? `?${cleanSearch}` : '') + url.hash;
      window.history.replaceState(null, '', newUrl);
    } catch {
      // Ignore URL manipulation failures
    }
  }
}
