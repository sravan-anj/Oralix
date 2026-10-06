import express, { Request, Response, Router } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function refreshEnv(): void {
  const envCandidates = [
    path.resolve(__dirname, '../.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'Dentiflow/.env')
  ];
  for (const envPath of envCandidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: true });
    }
  }
}

refreshEnv();

function getSupabaseConfig() {
  refreshEnv();
  const url = process.env.VITE_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  return { url, key };
}

/**
 * Extracts the canonical bill description / treatment title from any bill payload or database row.
 */
export function extractBillDescription(body: any): string {
  if (body?.description && typeof body.description === 'string' && body.description.trim()) {
    return body.description.trim();
  }
  if (body?.bill_name && typeof body.bill_name === 'string' && body.bill_name.trim()) {
    return body.bill_name.trim();
  }
  if (body?.billName && typeof body.billName === 'string' && body.billName.trim()) {
    return body.billName.trim();
  }
  if (body?.title && typeof body.title === 'string' && body.title.trim()) {
    return body.title.trim();
  }
  if (Array.isArray(body?.items) && body.items.length > 0) {
    const first = body.items[0];
    const desc = first?.description || first?.name || first?.title;
    if (desc && typeof desc === 'string' && desc.trim()) {
      return desc.trim();
    }
  }
  if (body?.chiefComplaint && typeof body.chiefComplaint === 'string' && body.chiefComplaint.trim()) {
    return body.chiefComplaint.trim();
  }
  if (body?.chief_complaint && typeof body.chief_complaint === 'string' && body.chief_complaint.trim()) {
    return body.chief_complaint.trim();
  }
  if (body?.diagnosis && typeof body.diagnosis === 'string' && body.diagnosis.trim()) {
    return body.diagnosis.trim();
  }
  return '';
}

/**
 * Checks whether an equivalent bill already exists in the database for the given patient and bill description.
 */
export async function checkDuplicateBill(
  patientId: string,
  patientName: string,
  description: string,
  excludeBillId?: string,
  appointmentId?: string
): Promise<{ isDuplicate: boolean; existingBill?: any }> {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return { isDuplicate: false };

  try {
    const endpoint = `${url}/rest/v1/invoices?select=id,invoice_number,patient_id,patient_name,appointment_id,description,items,total,total_amount,status`;
    const res = await fetch(endpoint, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`
      }
    });

    if (res.ok) {
      const rows = (await res.json()) as any[];
      const match = rows.find(r => {
        if (excludeBillId && r.id === excludeBillId) return false;
        
        // 1. Strict Appointment Uniqueness: only one bill per appointment
        if (appointmentId && r.appointment_id && r.appointment_id.trim() === appointmentId.trim()) {
          return true;
        }

        // If checking a non-appointment bill or different appointment, fallback to description & patient
        const cleanDesc = (description || '').trim().toLowerCase();
        if (!cleanDesc) return false;

        const rowDesc = (extractBillDescription(r) || '').trim().toLowerCase();
        if (rowDesc !== cleanDesc) return false;

        const samePatientId = patientId && r.patient_id && r.patient_id.trim() === patientId.trim();
        const samePatientName =
          patientName && r.patient_name && r.patient_name.trim().toLowerCase() === patientName.trim().toLowerCase();

        return Boolean(samePatientId || samePatientName);
      });

      if (match) {
        return { isDuplicate: true, existingBill: match };
      }
    }
  } catch (err) {
    console.error('[billingService] Error checking duplicate bill in Supabase:', err);
  }

  return { isDuplicate: false };
}

/**
 * Ensures patient exists in public.patients table to prevent foreign key errors.
 */
async function ensurePatientExists(patientId: string, patientName: string, phone?: string, email?: string) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key || !patientId) return;

  try {
    const checkRes = await fetch(`${url}/rest/v1/patients?id=eq.${encodeURIComponent(patientId)}&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    if (checkRes.ok) {
      const existing = await checkRes.json();
      if (existing && existing.length > 0) {
        const patchData: Record<string, any> = {};
        if (patientName && existing[0].name !== patientName) patchData.name = patientName;
        if (phone && (!existing[0].phone || existing[0].phone === '+91 98765 00000')) patchData.phone = phone;
        if (email && !existing[0].email) patchData.email = email;
        if (Object.keys(patchData).length > 0) {
          await fetch(`${url}/rest/v1/patients?id=eq.${encodeURIComponent(patientId)}`, {
            method: 'PATCH',
            headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(patchData)
          });
        }
        return;
      }
    }

    // Insert new patient with exact contact details
    const uniqueSuffix = `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`.toUpperCase();
    const patientCode = `DF-${uniqueSuffix}`;
    const insertRes = await fetch(`${url}/rest/v1/patients`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        id: patientId,
        code: patientCode,
        name: patientName || 'Patient',
        age: 32,
        gender: 'Male',
        phone: phone || '+91 98765 00000',
        email: email || null,
        registered_date: new Date().toISOString().split('T')[0],
        balance_due: 0
      })
    });
    if (!insertRes.ok) {
      console.warn('[billingService] ensurePatientExists insert failed:', insertRes.status, await insertRes.text());
    }
  } catch (err) {
    console.warn('[billingService] Unable to auto-ensure patient:', err);
  }
}

/**
 * STEP 1: Create Bill Handler
 * Enforces backend/database-level uniqueness:
 * If an equivalent bill already exists for the same patient and bill title/description, returns 409 Conflict:
 * "This bill has already been created for this patient."
 */
export async function createBillHandler(req: Request, res: Response) {
  try {
    const rawBody = req.body || {};
    const body = rawBody.bill || rawBody;
    const patientId = (body.patient_id || body.patientId || '').trim();
    const patientName = (body.patient_name || body.patientName || '').trim();
    const description = extractBillDescription(body);
    const billId = body.id || `inv-${Date.now()}`;
    const invoiceNumber = body.invoice_number || body.invoiceNumber || `INV-2026-${Math.floor(100 + Math.random() * 900)}`;

    if (!patientId && !patientName) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error: Patient is required.'
      });
    }

    if (!description) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error: Bill description / treatment name is required.'
      });
    }

    const appointmentId = (body.appointment_id || body.appointmentId || '').trim() || null;
    const appointmentDate = body.appointment_date || body.appointmentDate || null;
    const appointmentTime = body.appointment_time || body.appointmentTime || null;
    const chiefComplaint = (body.chief_complaint || body.chiefComplaint || '').trim() || null;
    const diagnosis = (body.diagnosis || '').trim() || null;
    const attendingDoctor = (body.attending_doctor || body.attendingDoctor || '').trim() || null;
    const patientPhone = (body.patient_phone || body.patientPhone || '').trim() || null;
    const patientEmail = (body.patient_email || body.patientEmail || '').trim() || null;
    const total = Number(body.total_amount ?? body.total ?? body.totalAmount ?? 0);
    const amountPaid = Number(body.amount_paid ?? body.amountPaid ?? 0);
    const balanceDue = Number(
      body.balance_due !== undefined && body.balance_due !== null
        ? body.balance_due
        : body.balanceDue !== undefined && body.balanceDue !== null
        ? body.balanceDue
        : Math.max(0, total - amountPaid)
    );
    const netAmount = body.net_amount !== undefined ? Number(body.net_amount) : total;

    // 1. Authoritative Backend Uniqueness Check
    const dupCheck = await checkDuplicateBill(patientId, patientName, description, undefined, appointmentId || undefined);
    if (dupCheck.isDuplicate) {
      return res.status(409).json({
        success: false,
        error: 'Bill Already Created: A bill has already been created for this patient/appointment. You cannot create another bill for the same appointment.',
        existingBill: dupCheck.existingBill
      });
    }

    // 2. Ensure patient exists in patients table
    const effectivePatientId = patientId || `p-${patientName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'pat'}`;
    await ensurePatientExists(effectivePatientId, patientName, patientPhone || undefined, patientEmail || undefined);
    const status = body.status || (balanceDue <= 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid');
    const cleanDate = body.date ? String(body.date).split('T')[0] : new Date().toISOString().split('T')[0];
    const cleanDueDate = body.due_date ? String(body.due_date).split('T')[0] : (body.dueDate ? String(body.dueDate).split('T')[0] : new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]);
    const discountType = body.discount_type || body.discountType || null;
    const discountValue = body.discount_value !== undefined ? Number(body.discount_value) : null;

    const row = {
      id: billId,
      invoice_number: invoiceNumber,
      patient_id: effectivePatientId,
      patient_name: patientName || 'Patient',
      patient_code: body.patient_code || body.patientCode || null,
      patient_age: body.patient_age !== undefined ? Number(body.patient_age) : (body.patientAge !== undefined ? Number(body.patientAge) : 32),
      patient_gender: body.patient_gender || body.patientGender || 'Male',
      patient_phone: patientPhone,
      patient_email: patientEmail,
      date: cleanDate,
      due_date: cleanDueDate,
      items: body.items || [],
      description: description,
      diagnosis: diagnosis,
      attending_doctor: attendingDoctor,
      appointment_id: appointmentId,
      appointment_date: appointmentDate,
      appointment_time: appointmentTime,
      chief_complaint: chiefComplaint,
      subtotal: body.subtotal !== undefined ? Number(body.subtotal) : total,
      tax: body.tax !== undefined ? Number(body.tax) : 0,
      discount: body.discount !== undefined ? Number(body.discount) : 0,
      discount_type: discountType,
      discount_value: discountValue,
      net_amount: netAmount,
      total: total,
      total_amount: total,
      amount_paid: amountPaid,
      balance_due: balanceDue,
      status: status,
      payment_method: body.payment_method || body.paymentMethod || null,
      notes: body.notes || null,
      sent_to_receptionist: true,
      is_draft: body.is_draft ?? body.isDraft ?? false,
      updated_at: new Date().toISOString()
    };

    // 4. Authoritative Supabase Insert (Protected by Unique Index & Postgres Trigger)
    const { url, key } = getSupabaseConfig();
    if (!url || !key) {
      return res.status(500).json({
        success: false,
        error: 'Database configuration missing on server.'
      });
    }

    const postRes = await fetch(`${url}/rest/v1/invoices`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(row)
    });

    const resText = await postRes.text();
    let resJson: any;
    try {
      resJson = JSON.parse(resText);
    } catch {
      resJson = { message: resText };
    }

    // Detect unique violation error from Postgres or trigger
    if (!postRes.ok) {
      const errMsg = (resJson?.message || resJson?.details || resText || '').toLowerCase();
      if (
        postRes.status === 409 ||
        errMsg.includes('already been created') ||
        errMsg.includes('bill already created') ||
        errMsg.includes('unique') ||
        errMsg.includes('23505') ||
        errMsg.includes('idx_invoices_')
      ) {
        return res.status(409).json({
          success: false,
          error: 'Bill Already Created: A bill has already been created for this patient/appointment. You cannot create another bill for the same appointment.'
        });
      }

      return res.status(postRes.status || 500).json({
        success: false,
        error: resJson?.message || 'Database error creating bill.'
      });
    }

    const createdBill = Array.isArray(resJson) ? resJson[0] : row;
    const formattedCreated = {
      ...createdBill,
      invoiceNumber: createdBill.invoice_number || createdBill.invoiceNumber || createdBill.id,
      patientId: createdBill.patient_id || createdBill.patientId,
      patientName: createdBill.patient_name || createdBill.patientName,
      total: Number(createdBill.total ?? createdBill.total_amount ?? createdBill.totalAmount ?? 0),
      totalAmount: Number(createdBill.total_amount ?? createdBill.total ?? createdBill.totalAmount ?? 0),
      amountPaid: Number(createdBill.amount_paid ?? createdBill.amountPaid ?? 0),
      balanceDue: Number(createdBill.balance_due ?? createdBill.balanceDue ?? 0),
      appointmentId: createdBill.appointment_id || createdBill.appointmentId || null,
      appointmentDate: createdBill.appointment_date || createdBill.appointmentDate || null,
      appointmentTime: createdBill.appointment_time || createdBill.appointmentTime || null,
      chiefComplaint: createdBill.chief_complaint || createdBill.chiefComplaint || null,
      diagnosis: createdBill.diagnosis || null,
      attendingDoctor: createdBill.attending_doctor || createdBill.attendingDoctor || null,
      discountType: createdBill.discount_type || createdBill.discountType || null,
      discountValue: createdBill.discount_value !== undefined ? Number(createdBill.discount_value) : undefined,
      netAmount: createdBill.net_amount !== undefined ? Number(createdBill.net_amount) : Number(createdBill.total ?? 0),
      items: Array.isArray(createdBill.items) ? createdBill.items : []
    };
    return res.status(201).json({
      success: true,
      bill: formattedCreated,
      message: 'Bill created successfully.'
    });
  } catch (err: any) {
    console.error('[billingService] createBillHandler error:', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Internal server error creating bill.'
    });
  }
}

/**
 * STEP 2: Update Bill Handler (Doctor Edits)
 * Updates the existing canonical bill in Supabase.
 * The bill_id and invoice_number remain unchanged.
 */
export async function updateBillHandler(req: Request, res: Response) {
  try {
    const billId = req.params.id || req.body.id || req.body.bill_id;
    if (!billId) {
      return res.status(400).json({ success: false, error: 'Bill ID is required.' });
    }

    const body = req.body || {};
    const { url, key } = getSupabaseConfig();
    if (!url || !key) {
      return res.status(500).json({ success: false, error: 'Database configuration missing.' });
    }

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString()
    };

    if (body.description !== undefined) updatePayload.description = body.description;
    if (body.items !== undefined) updatePayload.items = body.items;
    if (body.subtotal !== undefined) updatePayload.subtotal = Number(body.subtotal);
    if (body.tax !== undefined) updatePayload.tax = Number(body.tax);
    if (body.discount !== undefined) updatePayload.discount = Number(body.discount);
    if (body.discount_type !== undefined) updatePayload.discount_type = body.discount_type;
    if (body.discount_value !== undefined) updatePayload.discount_value = body.discount_value;
    if (body.total !== undefined || body.total_amount !== undefined || body.totalAmount !== undefined) {
      const tot = Number(body.total ?? body.total_amount ?? body.totalAmount);
      updatePayload.total = tot;
      updatePayload.total_amount = tot;
    }
    if (body.amount_paid !== undefined || body.amountPaid !== undefined) {
      updatePayload.amount_paid = Number(body.amount_paid ?? body.amountPaid);
    }
    if (body.balance_due !== undefined || body.balanceDue !== undefined) {
      updatePayload.balance_due = Number(body.balance_due ?? body.balanceDue);
    }
    if (body.status !== undefined) updatePayload.status = body.status;
    if (body.diagnosis !== undefined) updatePayload.diagnosis = body.diagnosis;
    if (body.attending_doctor !== undefined || body.attendingDoctor !== undefined) {
      updatePayload.attending_doctor = body.attending_doctor ?? body.attendingDoctor;
    }
    if (body.appointment_id !== undefined || body.appointmentId !== undefined) {
      updatePayload.appointment_id = body.appointment_id ?? body.appointmentId;
    }
    if (body.appointment_date !== undefined || body.appointmentDate !== undefined) {
      updatePayload.appointment_date = body.appointment_date ?? body.appointmentDate;
    }
    if (body.appointment_time !== undefined || body.appointmentTime !== undefined) {
      updatePayload.appointment_time = body.appointment_time ?? body.appointmentTime;
    }
    if (body.chief_complaint !== undefined || body.chiefComplaint !== undefined) {
      updatePayload.chief_complaint = body.chief_complaint ?? body.chiefComplaint;
    }
    if (body.net_amount !== undefined || body.netAmount !== undefined) {
      updatePayload.net_amount = Number(body.net_amount ?? body.netAmount);
    }
    if (body.notes !== undefined) updatePayload.notes = body.notes;
    if (body.sent_to_receptionist !== undefined) updatePayload.sent_to_receptionist = body.sent_to_receptionist;
    if (body.is_draft !== undefined) updatePayload.is_draft = body.is_draft;

    const patchRes = await fetch(`${url}/rest/v1/invoices?id=eq.${encodeURIComponent(billId)}`, {
      method: 'PATCH',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(updatePayload)
    });

    if (!patchRes.ok) {
      const errText = await patchRes.text();
      return res.status(patchRes.status).json({ success: false, error: errText });
    }

    const updatedRows = await patchRes.json();
    const updatedRow = updatedRows[0];
    const formattedBill = updatedRow ? {
      ...updatedRow,
      invoiceNumber: updatedRow.invoice_number || updatedRow.id,
      patientId: updatedRow.patient_id,
      patientName: updatedRow.patient_name,
      total: Number(updatedRow.total ?? updatedRow.total_amount ?? 0),
      totalAmount: Number(updatedRow.total_amount ?? updatedRow.total ?? 0),
      amountPaid: Number(updatedRow.amount_paid ?? 0),
      balanceDue: Number(updatedRow.balance_due ?? 0),
      appointmentId: updatedRow.appointment_id || null,
      appointmentDate: updatedRow.appointment_date || null,
      appointmentTime: updatedRow.appointment_time || null,
      chiefComplaint: updatedRow.chief_complaint || null,
      diagnosis: updatedRow.diagnosis || null,
      attendingDoctor: updatedRow.attending_doctor || null,
      discountType: updatedRow.discount_type || null,
      discountValue: updatedRow.discount_value !== undefined ? Number(updatedRow.discount_value) : undefined,
      netAmount: updatedRow.net_amount !== undefined ? Number(updatedRow.net_amount) : Number(updatedRow.total ?? 0),
      items: Array.isArray(updatedRow.items) ? updatedRow.items : []
    } : null;

    return res.status(200).json({
      success: true,
      bill: formattedBill,
      message: 'Bill updated successfully.'
    });
  } catch (err: any) {
    console.error('[billingService] updateBillHandler error:', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Internal server error updating bill.'
    });
  }
}

/**
 * STEP 3: Get Bills Handler
 */
export async function getBillsHandler(_req: Request, res: Response) {
  try {
    const { url, key } = getSupabaseConfig();
    if (!url || !key) {
      return res.status(500).json({ success: false, error: 'Database configuration missing.' });
    }

    const fetchRes = await fetch(`${url}/rest/v1/invoices?select=*&order=created_at.desc`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`
      }
    });

    if (!fetchRes.ok) {
      const errText = await fetchRes.text();
      return res.status(fetchRes.status).json({ success: false, error: errText });
    }

    const rows = await fetchRes.json();
    const formattedBills = rows.map((r: any) => ({
      ...r,
      invoiceNumber: r.invoice_number || r.id,
      patientId: r.patient_id,
      patientName: r.patient_name,
      total: Number(r.total ?? r.total_amount ?? 0),
      totalAmount: Number(r.total_amount ?? r.total ?? 0),
      amountPaid: Number(r.amount_paid ?? 0),
      balanceDue: Number(r.balance_due ?? 0),
      appointmentId: r.appointment_id || null,
      appointmentDate: r.appointment_date || null,
      appointmentTime: r.appointment_time || null,
      chiefComplaint: r.chief_complaint || null,
      diagnosis: r.diagnosis || null,
      attendingDoctor: r.attending_doctor || null,
      discountType: r.discount_type || null,
      discountValue: r.discount_value !== undefined ? Number(r.discount_value) : undefined,
      netAmount: r.net_amount !== undefined ? Number(r.net_amount) : Number(r.total ?? 0),
      items: Array.isArray(r.items) ? r.items : []
    }));

    return res.status(200).json({ success: true, bills: formattedBills });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message });
  }
}

/**
 * STEP 4: Delete Bill Handler
 * Permanently deletes a bill from the database by ID or invoice_number.
 */
export async function deleteBillHandler(req: Request, res: Response) {
  try {
    const rawId = req.params.id || (req.query.id as string) || req.body?.id || req.body?.bill_id || req.body?.invoiceId;
    const billId = (rawId || '').trim();

    if (!billId) {
      return res.status(400).json({ success: false, error: 'Bill ID is required for deletion.' });
    }

    const { url, key } = getSupabaseConfig();
    if (!url || !key) {
      return res.status(500).json({ success: false, error: 'Database configuration missing.' });
    }

    // 1. Verify the bill exists in the database
    const checkEndpoint = `${url}/rest/v1/invoices?or=(id.eq.${encodeURIComponent(billId)},invoice_number.eq.${encodeURIComponent(billId)})&select=id,invoice_number,patient_name&limit=1`;
    const checkRes = await fetch(checkEndpoint, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`
      }
    });

    if (!checkRes.ok) {
      const errText = await checkRes.text();
      return res.status(checkRes.status).json({ success: false, error: `Failed to query database: ${errText}` });
    }

    const rows = await checkRes.json();
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: `Bill "${billId}" not found in database.` });
    }

    const authoritativeId = rows[0].id;
    const invoiceNum = rows[0].invoice_number;

    // 2. Cascade delete related payment_transactions if any exist
    try {
      await fetch(`${url}/rest/v1/payment_transactions?invoice_id=eq.${encodeURIComponent(authoritativeId)}`, {
        method: 'DELETE',
        headers: { apikey: key, Authorization: `Bearer ${key}` }
      });
    } catch (_) {}

    // 3. Delete from invoices using primary key id
    const deleteEndpoint = `${url}/rest/v1/invoices?id=eq.${encodeURIComponent(authoritativeId)}`;
    const delRes = await fetch(deleteEndpoint, {
      method: 'DELETE',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'return=representation'
      }
    });

    if (!delRes.ok) {
      const delErr = await delRes.text();
      console.error(`[billingService] Error deleting bill ${billId} from Supabase:`, delErr);
      return res.status(delRes.status).json({ success: false, error: `Database error deleting bill: ${delErr}` });
    }

    const deletedRows = await delRes.json();
    if (!Array.isArray(deletedRows) || deletedRows.length === 0) {
      return res.status(500).json({ success: false, error: 'Database deletion could not be verified.' });
    }

    console.log(`[billingService] Bill ${invoiceNum} (ID: ${authoritativeId}) permanently deleted from database.`);

    return res.status(200).json({
      success: true,
      message: `Bill ${invoiceNum} successfully deleted from database.`,
      deletedId: authoritativeId,
      invoiceNumber: invoiceNum
    });
  } catch (err: any) {
    console.error('[billingService] deleteBillHandler exception:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Internal server error deleting bill.' });
  }
}

function parseTimeSlotToMinutes(timeStr: string): number {
  const match = (timeStr || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return -1;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === 'PM' && hours < 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function getLocalDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMaxBookingDateString(d: Date = new Date()): string {
  const nextMonth = new Date(d);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  return getLocalDateString(nextMonth);
}

/**
 * STEP 5: Create Appointment Handler
 * Validates mandatory fields, date/time constraints, and persistently stores an appointment in Supabase.
 */
export async function createAppointmentHandler(req: Request, res: Response) {
  try {
    const rawBody = req.body || {};
    const body = rawBody.appointment || rawBody;
    const patientName = (body.patient_name || body.patientName || body.name || '').trim();
    const patientEmail = (body.patient_email || body.patientEmail || body.email || '').trim().toLowerCase();
    const patientPhone = (body.patient_phone || body.patientPhone || body.phone || body.contact || '').trim();
    const procedure = (body.procedure || body.reason || body.reasonForVisit || body.reason_for_visit || '').trim();
    const date = (body.date || body.appointmentDate || body.appointment_date || '').trim();
    const time = (body.time || body.appointmentTime || body.appointment_time || '').trim();

    // 1. Mandatory Field Validations
    if (!patientName) {
      return res.status(400).json({ success: false, error: 'Validation Error: Patient name is mandatory.' });
    }
    if (!patientEmail || !patientEmail.includes('@')) {
      return res.status(400).json({ success: false, error: 'Validation Error: A valid patient email is mandatory.' });
    }
    if (!patientPhone || patientPhone.replace(/\D/g, '').length < 7) {
      return res.status(400).json({ success: false, error: 'Validation Error: A valid contact number is mandatory.' });
    }
    if (!procedure) {
      return res.status(400).json({ success: false, error: 'Validation Error: Reason for visit is mandatory.' });
    }
    if (!date) {
      return res.status(400).json({ success: false, error: 'Validation Error: Appointment date is mandatory.' });
    }
    if (!time) {
      return res.status(400).json({ success: false, error: 'Validation Error: Appointment time slot is mandatory.' });
    }

    // 2. Appointment Date Window Validation (TODAY through NEXT 1 MONTH)
    const todayStr = getLocalDateString();
    const maxDateStr = getMaxBookingDateString();

    if (date < todayStr) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error: Appointments cannot be booked for past dates. Please select today or a future date.'
      });
    }
    if (date > maxDateStr) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error: Appointments can only be booked up to 1 month from today.'
      });
    }

    // 3. Past Time Slot Validation for TODAY
    if (date === todayStr) {
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const slotMinutes = parseTimeSlotToMinutes(time);
      if (slotMinutes >= 0 && slotMinutes <= currentMinutes) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error: The selected time slot has already passed for today. Please select a future time slot.'
        });
      }
    }

    const { url, key } = getSupabaseConfig();
    if (!url || !key) {
      return res.status(500).json({ success: false, error: 'Database configuration missing.' });
    }

    // 4. Authoritative Check: Prevent booking if an appointment already exists with the same email OR same phone
    const cleanEmail = (patientEmail || '').trim().toLowerCase();
    const cleanPhoneDigits = (patientPhone || '').replace(/\D/g, '').slice(-10);

    if (cleanEmail || cleanPhoneDigits) {
      try {
        const aptsRes = await fetch(
          `${url}/rest/v1/appointments?select=id,patient_name,patient_email,patient_phone,patient_id`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` } }
        );
        if (aptsRes.ok) {
          const existingList = (await aptsRes.json()) as any[];
          const duplicateFound = existingList.find(a => {
            if (body.id && a.id === body.id) return false;
            const aEmail = (a.patient_email || '').trim().toLowerCase();
            const aPhoneDigits = (a.patient_phone || '').replace(/\D/g, '').slice(-10);
            const emailMatch = cleanEmail && aEmail && aEmail === cleanEmail;
            const phoneMatch = cleanPhoneDigits && aPhoneDigits && aPhoneDigits === cleanPhoneDigits;
            return Boolean(emailMatch || phoneMatch);
          });

          if (duplicateFound) {
            return res.status(409).json({
              success: false,
              error: 'Appointment Already Booked: An appointment already exists for this email address or phone number. Please check your existing appointment instead of booking again.'
            });
          }
        }
      } catch (dupErr) {
        console.warn('[billingService] Duplicate appointment pre-check warning:', dupErr);
      }
    }

    // 5. Database-level Duplicate Slot Check
    try {
      const checkSlotRes = await fetch(
        `${url}/rest/v1/appointments?date=eq.${encodeURIComponent(date)}&status=neq.cancelled&select=id,patient_name,time`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      if (checkSlotRes.ok) {
        const existingApts = await checkSlotRes.json();
        const normTime = time.toLowerCase().trim();
        const isDup = Array.isArray(existingApts) && existingApts.some(
          a => (a.time || '').toLowerCase().trim() === normTime && a.id !== body.id
        );
        if (isDup) {
          return res.status(409).json({
            success: false,
            error: 'This appointment slot has already been booked for this date and time.'
          });
        }
      }
    } catch (checkErr) {
      console.warn('[billingService] Duplicate slot pre-check warning:', checkErr);
    }

    // 5. Patient Resolution and Database Association
    let resolvedPatientId = (body.patient_id || body.patientId || '').trim();
    if (!resolvedPatientId || resolvedPatientId === 'p-1') {
      try {
        const findPtRes = await fetch(
          `${url}/rest/v1/patients?or=(email.ilike.${encodeURIComponent(patientEmail)},phone.eq.${encodeURIComponent(patientPhone)})&select=id,name,phone,email&limit=1`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` } }
        );
        if (findPtRes.ok) {
          const matched = await findPtRes.json();
          if (Array.isArray(matched) && matched.length > 0) {
            resolvedPatientId = matched[0].id;
          }
        }
      } catch (_) {}
    }

    if (!resolvedPatientId || resolvedPatientId === 'p-1') {
      resolvedPatientId = `p-${Date.now()}`;
    }

    // Upsert patient record so phone, email, and name are accurately persisted
    await ensurePatientExists(resolvedPatientId, patientName, patientPhone, patientEmail);

    const id = body.id || `apt-${Date.now()}`;
    const doctorName = body.doctor_name || body.doctorName || 'Dr. Ananya Sharma';
    const doctorId = body.doctor_id || body.doctorId || 'u-doctor';
    const chair = body.chair || 'Chair 1 - Endodontics';
    const duration = Number(body.duration_minutes || body.durationMinutes || 30);
    const status = body.status || 'confirmed';
    const notes = body.notes || null;
    const token = body.token_number || body.tokenNumber || `#D-${Math.floor(100 + Math.random() * 900)}`;

    const row = {
      id,
      patient_id: resolvedPatientId,
      patient_name: patientName,
      doctor_name: doctorName,
      doctor_id: doctorId,
      chair,
      date,
      time,
      duration_minutes: duration,
      procedure,
      status,
      notes,
      token_number: token,
      patient_email: patientEmail,
      patient_phone: patientPhone,
      updated_at: new Date().toISOString()
    };

    const postRes = await fetch(`${url}/rest/v1/appointments`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(row)
    });

    const resJson = await postRes.json().catch(() => null);
    if (!postRes.ok) {
      const errMsg = (resJson?.message || '').toLowerCase();
      if (
        errMsg.includes('already been booked for this date and time') ||
        errMsg.includes('idx_appointments_date_time_unique')
      ) {
        return res.status(409).json({
          success: false,
          error: 'This appointment slot has already been booked for this date and time.'
        });
      }
      if (
        resJson?.code === '23505' ||
        errMsg.includes('appointment already booked') ||
        errMsg.includes('already exists for this email') ||
        errMsg.includes('idx_appointments_patient_')
      ) {
        return res.status(409).json({
          success: false,
          error: 'Appointment Already Booked: An appointment already exists for this email address or phone number. Please check your existing appointment instead of booking again.'
        });
      }
      return res.status(postRes.status || 500).json({
        success: false,
        error: resJson?.message || 'Database error creating appointment.'
      });
    }

    const created = Array.isArray(resJson) ? resJson[0] : row;
    return res.status(201).json({
      success: true,
      appointment: {
        id: created.id,
        patientId: created.patient_id,
        patientName: created.patient_name,
        doctorName: created.doctor_name,
        doctorId: created.doctor_id,
        chair: created.chair,
        date: created.date,
        time: created.time,
        durationMinutes: created.duration_minutes,
        procedure: created.procedure,
        status: created.status,
        notes: created.notes,
        tokenNumber: created.token_number,
        patientEmail: created.patient_email,
        patientPhone: created.patient_phone
      },
      message: 'Appointment booked successfully.'
    });
  } catch (err: any) {
    console.error('[billingService] createAppointmentHandler error:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Internal server error creating appointment.' });
  }
}

/**
 * STEP 6: Get Appointments Handler
 */
export async function getAppointmentsHandler(_req: Request, res: Response) {
  try {
    const { url, key } = getSupabaseConfig();
    if (!url || !key) {
      return res.status(500).json({ success: false, error: 'Database configuration missing.' });
    }

    const fetchRes = await fetch(`${url}/rest/v1/appointments?select=*&order=date.asc`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });

    if (!fetchRes.ok) {
      return res.status(fetchRes.status).json({ success: false, error: await fetchRes.text() });
    }

    const rows = await fetchRes.json();
    const appointments = rows.map((r: any) => ({
      id: r.id,
      patientId: r.patient_id,
      patientName: r.patient_name,
      doctorName: r.doctor_name,
      doctorId: r.doctor_id,
      chair: r.chair,
      date: r.date,
      time: r.time,
      durationMinutes: r.duration_minutes,
      procedure: r.procedure,
      status: r.status,
      notes: r.notes,
      tokenNumber: r.token_number,
      patientEmail: r.patient_email,
      patientPhone: r.patient_phone
    }));

    return res.status(200).json({ success: true, appointments });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message });
  }
}

/**
 * STEP 7: Delete Appointment Handler
 * Permanently deletes the appointment and associated patient data from Supabase.
 */
export async function deleteAppointmentHandler(req: Request, res: Response) {
  try {
    const appointmentId = (req.params.id || req.body?.appointmentId || req.body?.id || '').trim();
    const patientId = (req.body?.patientId || req.query.patientId || '').trim();

    if (!appointmentId) {
      return res.status(400).json({ success: false, error: 'Appointment ID is required.' });
    }

    const { url, key } = getSupabaseConfig();
    if (!url || !key) {
      return res.status(500).json({ success: false, error: 'Database configuration missing.' });
    }

    // Call stored procedure public.delete_appointment_and_patient
    const rpcRes = await fetch(`${url}/rest/v1/rpc/delete_appointment_and_patient`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_appointment_id: appointmentId,
        p_patient_id: patientId || null
      })
    });

    if (!rpcRes.ok) {
      // Fallback: direct cascade deletion
      await fetch(`${url}/rest/v1/invoices?appointment_id=eq.${encodeURIComponent(appointmentId)}`, {
        method: 'DELETE',
        headers: { apikey: key, Authorization: `Bearer ${key}` }
      });
      await fetch(`${url}/rest/v1/appointments?id=eq.${encodeURIComponent(appointmentId)}`, {
        method: 'DELETE',
        headers: { apikey: key, Authorization: `Bearer ${key}` }
      });
      if (patientId) {
        await fetch(`${url}/rest/v1/patients?id=eq.${encodeURIComponent(patientId)}`, {
          method: 'DELETE',
          headers: { apikey: key, Authorization: `Bearer ${key}` }
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Appointment and associated patient data permanently deleted.'
    });
  } catch (err: any) {
    console.error('[billingService] deleteAppointmentHandler error:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to delete appointment.' });
  }
}

/**
 * STEP 8: Check Duplicate Appointment Handler
 * Debounced real-time duplicate check for booking form.
 */
export async function checkDuplicateAppointmentHandler(req: Request, res: Response) {
  try {
    const email = (req.query.email as string || '').trim().toLowerCase();
    const phone = (req.query.phone as string || '').replace(/\D/g, '').slice(-10);
    const excludeId = (req.query.excludeId as string || '').trim();

    if (!email && !phone) {
      return res.status(200).json({ isDuplicate: false });
    }

    const { url, key } = getSupabaseConfig();
    if (!url || !key) return res.status(200).json({ isDuplicate: false });

    const aptsRes = await fetch(
      `${url}/rest/v1/appointments?select=id,patient_name,patient_email,patient_phone,patient_id,date,time,status`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!aptsRes.ok) return res.status(200).json({ isDuplicate: false });

    const rows = (await aptsRes.json()) as any[];
    const match = rows.find(a => {
      if (excludeId && a.id === excludeId) return false;
      const aEmail = (a.patient_email || '').trim().toLowerCase();
      const aPhoneDigits = (a.patient_phone || '').replace(/\D/g, '').slice(-10);
      const emailMatch = email && aEmail && aEmail === email;
      const phoneMatch = phone && aPhoneDigits && aPhoneDigits === phone;
      return Boolean(emailMatch || phoneMatch);
    });

    if (match) {
      return res.status(200).json({
        isDuplicate: true,
        message: 'An appointment already exists for this email address or phone number. Please check your existing appointment instead of booking again.',
        existingAppointment: {
          id: match.id,
          date: match.date,
          time: match.time,
          status: match.status,
          patientName: match.patient_name
        }
      });
    }

    return res.status(200).json({ isDuplicate: false });
  } catch (err) {
    return res.status(200).json({ isDuplicate: false });
  }
}

/**
 * Creates an Express Router configured for canonical billing and appointments operations.
 */
export function createBillingRouter(): Router {
  const router = express.Router();
  router.use(express.json());

  router.post('/bills', createBillHandler);
  router.post('/create-bill', createBillHandler);
  router.patch('/bills/:id', updateBillHandler);
  router.put('/bills/:id', updateBillHandler);
  router.delete('/bills/:id', deleteBillHandler);
  router.delete('/bills', deleteBillHandler);
  router.get('/bills', getBillsHandler);

  router.post('/appointments', createAppointmentHandler);
  router.get('/appointments', getAppointmentsHandler);
  router.get('/appointments/check-duplicate', checkDuplicateAppointmentHandler);
  router.delete('/appointments/:id', deleteAppointmentHandler);
  router.delete('/appointments', deleteAppointmentHandler);
  router.post('/appointments/delete', deleteAppointmentHandler);

  return router;
}
