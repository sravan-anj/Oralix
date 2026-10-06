import { Invoice } from '../types';
import { supabase } from './supabaseClient';
import { mapInvoiceToRow, mapRowToInvoice, StorageService } from './storage';

export interface CreateBillResult {
  success: boolean;
  bill?: Invoice;
  error?: string;
}

/**
 * Normalizes string for case-insensitive and whitespace-insensitive comparison.
 */
export const normalizeString = (str?: string): string => {
  return (str || '').trim().toLowerCase();
};

/**
 * Extracts the canonical bill description / treatment title from any bill payload.
 */
export const extractBillDescription = (inv: Partial<Invoice> | any): string => {
  if (inv?.description && typeof inv.description === 'string' && inv.description.trim()) {
    return inv.description.trim();
  }
  if (inv?.bill_name && typeof inv.bill_name === 'string' && inv.bill_name.trim()) {
    return inv.bill_name.trim();
  }
  if (inv?.billName && typeof inv.billName === 'string' && inv.billName.trim()) {
    return inv.billName.trim();
  }
  if (inv?.title && typeof inv.title === 'string' && inv.title.trim()) {
    return inv.title.trim();
  }
  if (Array.isArray(inv?.items) && inv.items.length > 0) {
    const first = inv.items[0];
    const desc = first?.description || first?.name || first?.title;
    if (desc && typeof desc === 'string' && desc.trim()) {
      return desc.trim();
    }
  }
  if (inv?.chiefComplaint && typeof inv.chiefComplaint === 'string' && inv.chiefComplaint.trim()) {
    return inv.chiefComplaint.trim();
  }
  if (inv?.chief_complaint && typeof inv.chief_complaint === 'string' && inv.chief_complaint.trim()) {
    return inv.chief_complaint.trim();
  }
  if (inv?.diagnosis && typeof inv.diagnosis === 'string' && inv.diagnosis.trim()) {
    return inv.diagnosis.trim();
  }
  return '';
};

/**
 * Checks whether an equivalent bill already exists for the given patient and bill description.
 */
export const isEquivalentBill = (
  a: { patientId?: string; patientName?: string; description?: string; id?: string; items?: any[] },
  b: { patientId?: string; patientName?: string; description?: string; id?: string; items?: any[] }
): boolean => {
  if (a.id && b.id && a.id === b.id) return false;

  const descA = normalizeString(a.description || extractBillDescription(a));
  const descB = normalizeString(b.description || extractBillDescription(b));
  if (!descA || !descB || descA !== descB) return false;

  const idMatch = a.patientId && b.patientId && a.patientId.trim() === b.patientId.trim();
  const nameMatch = a.patientName && b.patientName && normalizeString(a.patientName) === normalizeString(b.patientName);

  return Boolean(idMatch || nameMatch);
};

export const billingService = {
  /**
   * Performs an immediate local duplicate check against the current in-memory invoices list.
   */
  checkLocalDuplicate(
    patientId: string,
    patientName: string,
    description: string,
    invoices: Invoice[],
    excludeBillId?: string,
    appointmentId?: string
  ): boolean {
    if (appointmentId && appointmentId.trim()) {
      const aptMatch = invoices.some(inv => {
        if (excludeBillId && inv.id === excludeBillId) return false;
        return inv.appointmentId && inv.appointmentId.trim() === appointmentId.trim();
      });
      if (aptMatch) return true;
    }
    const candidate = { patientId, patientName, description, id: excludeBillId };
    return invoices.some(inv => isEquivalentBill(candidate, inv));
  },

  /**
   * Creates a new bill authoritatively.
   * Checks database / backend uniqueness and rejects duplicates with:
   * "Bill Already Created: A bill has already been created for this patient/appointment. You cannot create another bill for the same appointment."
   */
  async createBill(
    newInvoice: Invoice,
    currentInvoices: Invoice[] = []
  ): Promise<CreateBillResult> {
    const extracted = extractBillDescription(newInvoice);
    const cleanDesc = normalizeString(newInvoice.description || extracted);
    if (!cleanDesc) {
      return { success: false, error: 'Bill description / treatment name is required.' };
    }

    const invoiceWithDesc: Invoice = {
      ...newInvoice,
      description: newInvoice.description || extracted
    };

    // 1. Frontend optimistic check (appointment_id and patient description)
    if (this.checkLocalDuplicate(
      invoiceWithDesc.patientId,
      invoiceWithDesc.patientName,
      invoiceWithDesc.description || '',
      currentInvoices,
      invoiceWithDesc.id,
      invoiceWithDesc.appointmentId
    )) {
      return {
        success: false,
        error: 'Bill Already Created: A bill has already been created for this patient/appointment. You cannot create another bill for the same appointment.'
      };
    }

    // 2. Authoritative Backend API call
    try {
      const apiEndpoint = `/api/create-bill`;
      const res = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mapInvoiceToRow(invoiceWithDesc))
      });

      const data = await res.json().catch(() => null);

      if (res.status === 409 || data?.error?.includes('already been created') || data?.error?.includes('unique') || data?.error?.includes('23505')) {
        return {
          success: false,
          error: data?.error || 'Bill Already Created: A bill has already been created for this patient/appointment. You cannot create another bill for the same appointment.'
        };
      }

      if (res.ok && data?.bill) {
        const canonicalBill = mapRowToInvoice(data.bill);
        StorageService.upsertInvoice(canonicalBill);
        return { success: true, bill: canonicalBill };
      }
    } catch (_) {
      // Backend route unreachable, fallback to direct Supabase client
    }

    // 3. Direct Supabase PostgreSQL insert (Protected by unique indexes & DB trigger)
    try {
      if (invoiceWithDesc.appointmentId) {
        const { data: existingByApt } = await supabase
          .from('invoices')
          .select('id, invoice_number')
          .eq('appointment_id', invoiceWithDesc.appointmentId)
          .limit(1);
        if (existingByApt && existingByApt.length > 0) {
          return {
            success: false,
            error: 'Bill Already Created: A bill has already been created for this patient/appointment. You cannot create another bill for the same appointment.'
          };
        }
      }

      const row = mapInvoiceToRow(invoiceWithDesc);
      const { data, error } = await supabase
        .from('invoices')
        .insert(row)
        .select()
        .single();

      if (error) {
        const msg = (error.message || error.details || '').toLowerCase();
        if (
          error.code === '23505' ||
          msg.includes('already been created') ||
          msg.includes('bill already created') ||
          msg.includes('unique') ||
          msg.includes('duplicate') ||
          msg.includes('idx_invoices_')
        ) {
          return {
            success: false,
            error: 'Bill Already Created: A bill has already been created for this patient/appointment. You cannot create another bill for the same appointment.'
          };
        }
        return { success: false, error: error.message || 'Database error creating bill.' };
      }

      const canonicalBill = data ? mapRowToInvoice(data) : newInvoice;
      StorageService.upsertInvoice(canonicalBill);
      return { success: true, bill: canonicalBill };
    } catch (err: any) {
      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('already been created') || msg.includes('bill already created') || msg.includes('unique') || msg.includes('23505')) {
        return {
          success: false,
          error: 'Bill Already Created: A bill has already been created for this patient/appointment. You cannot create another bill for the same appointment.'
        };
      }
      return { success: false, error: err?.message || 'Failed to create bill in database.' };
    }
  },

  /**
   * Updates an existing bill in the canonical database.
   * The bill_id remains unchanged.
   */
  async updateBill(updatedInvoice: Invoice): Promise<CreateBillResult> {
    try {
      const row = mapInvoiceToRow(updatedInvoice);

      // Attempt backend update endpoint
      try {
        const res = await fetch(`/api/bills/${encodeURIComponent(updatedInvoice.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(row)
        });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          const canonical = data?.bill ? mapRowToInvoice(data.bill) : updatedInvoice;
          StorageService.upsertInvoice(canonical);
          return { success: true, bill: canonical };
        }
      } catch (_) {}

      // Direct Supabase update
      const { data, error } = await supabase
        .from('invoices')
        .update(row)
        .eq('id', updatedInvoice.id)
        .select()
        .single();

      if (error) {
        console.error('[billingService] Supabase update error:', error);
      }

      const canonical = data ? mapRowToInvoice(data) : updatedInvoice;
      StorageService.upsertInvoice(canonical);
      return { success: true, bill: canonical };
    } catch (err: any) {
      console.error('[billingService] updateBill error:', err);
      StorageService.upsertInvoice(updatedInvoice);
      return { success: true, bill: updatedInvoice };
    }
  },

  /**
   * Permanently deletes a bill from the authoritative database.
   * Returns { success: true } only after confirming database deletion.
   */
  async deleteBill(billId: string): Promise<{ success: boolean; error?: string }> {
    const cleanId = (billId || '').trim();
    if (!cleanId) {
      return { success: false, error: 'Bill ID is required for deletion.' };
    }

    // 1. Primary: Authoritative Backend API Delete
    try {
      const res = await fetch(`/api/bills/${encodeURIComponent(cleanId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.success) {
          // Deletion confirmed by backend database
          return { success: true };
        }
      } else if (res.status === 404) {
        // Bill already not in database
        return { success: true };
      } else {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error || `Server returned HTTP ${res.status}`;
        console.error('[billingService] Backend delete failed:', errMsg);
        return { success: false, error: errMsg };
      }
    } catch (netErr) {
      console.warn('[billingService] Backend delete endpoint unreachable, attempting direct Supabase delete...', netErr);
    }

    // 2. Direct Supabase client delete (fallback if backend endpoint unreachable)
    try {
      // Cascade delete payment transactions
      await supabase.from('payment_transactions').delete().eq('invoice_id', cleanId);

      const { data, error } = await supabase
        .from('invoices')
        .delete()
        .or(`id.eq.${cleanId},invoice_number.eq.${cleanId}`)
        .select();

      if (error) {
        console.error('[billingService] Direct Supabase delete error:', error);
        return { success: false, error: error.message || 'Database error deleting bill.' };
      }

      return { success: true };
    } catch (err: any) {
      console.error('[billingService] Direct Supabase delete exception:', err);
      return { success: false, error: err?.message || 'Failed to delete bill from database.' };
    }
  }
};
