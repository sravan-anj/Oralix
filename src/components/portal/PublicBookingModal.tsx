import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ToothIcon } from '../common/ToothIcon';
import { Appointment, Patient, User } from '../../types';
import { useToast } from '../common/Toast';
import { supabase } from '../../utils/supabaseClient';
import { StorageService } from '../../utils/storage';
import {
  Calendar,
  Clock,
  CheckCircle2,
  X,
  AlertCircle,
  Loader2,
  Ban,
  Check,
  Sparkles,
  Phone,
  Mail,
  User as UserIcon,
  Stethoscope
} from 'lucide-react';

interface PublicBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBookAppointment: (newApt: Appointment) => void | Promise<void>;
  existingPatients?: Patient[];
  currentUser?: User | null;
}

// 1. Extensible list of Dental Treatment Options
export const REASONS_FOR_VISIT = [
  'Root Canal',
  'Dental Cleaning',
  'Fillers',
  'Tooth Implant',
  'Braces',
  'Tooth Extraction',
  'Teeth Whitening',
  'Dental Check-up',
  'Crown',
  'Bridge',
  'Denture',
  'Gum Treatment',
  'Other'
] as const;

export type ReasonForVisit = typeof REASONS_FOR_VISIT[number];

// Standard Clinic Operating Slots (09:00 AM to 05:00 PM)
export const CLINIC_TIME_SLOTS = [
  '09:00 AM',
  '10:00 AM',
  '11:00 AM',
  '12:00 PM',
  '01:00 PM',
  '02:00 PM',
  '03:00 PM',
  '04:00 PM',
  '05:00 PM'
];

/**
 * Calculates current date in local timezone YYYY-MM-DD format (UTC conversion safe)
 */
export const getLocalDateString = (d: Date = new Date()): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Calculates exactly 1 month from current date in local timezone YYYY-MM-DD
 */
export const getOneMonthFutureDateString = (d: Date = new Date()): string => {
  const nextMonth = new Date(d);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  return getLocalDateString(nextMonth);
};

/**
 * Parses time string like "10:00 AM" or "02:30 PM" to minutes from midnight
 */
export const parseSlotToMinutes = (timeStr: string): number => {
  const match = (timeStr || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return -1;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === 'PM' && hours < 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
};

/**
 * Checks if a slot time has already passed for TODAY in local time
 */
export const isSlotInPastForToday = (timeStr: string, dateStr: string): boolean => {
  const todayStr = getLocalDateString();
  if (dateStr !== todayStr) return false;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const slotMinutes = parseSlotToMinutes(timeStr);
  return slotMinutes >= 0 && slotMinutes <= currentMinutes;
};

export const PublicBookingModal: React.FC<PublicBookingModalProps> = ({
  isOpen,
  onClose,
  onBookAppointment,
  existingPatients = [],
  currentUser
}) => {
  const { showToast } = useToast();

  const todayStr = useMemo(() => getLocalDateString(), []);
  const maxDateStr = useMemo(() => getOneMonthFutureDateString(), []);

  // Form State: Exactly 6 Patient-Facing Fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [contact, setContact] = useState('');
  const [reason, setReason] = useState<string>('Dental Check-up');
  const [otherReason, setOtherReason] = useState('');
  const [appointmentDate, setAppointmentDate] = useState<string>(todayStr);
  const [appointmentTime, setAppointmentTime] = useState<string>('');

  // UI & Network States
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [bookedDetails, setBookedDetails] = useState<{
    token: string;
    name: string;
    date: string;
    time: string;
    procedure: string;
  } | null>(null);

  // Live booked appointments for selected date from Supabase
  const [dateBookedSlots, setDateBookedSlots] = useState<string[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);

  // Duplicate Booking Prevention State (Email or Phone duplicate)
  const [isDuplicateBooked, setIsDuplicateBooked] = useState(false);
  const [duplicateAppointment, setDuplicateAppointment] = useState<any | null>(null);

  // Real-time authoritative check against database for duplicate email/phone
  useEffect(() => {
    const cleanEmail = email.trim().toLowerCase();
    const cleanDigits = contact.replace(/\D/g, '').slice(-10);

    if (!cleanEmail && !cleanDigits) {
      setIsDuplicateBooked(false);
      setDuplicateAppointment(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from('appointments')
          .select('id, patient_name, patient_email, patient_phone, date, time, status');

        if (!error && Array.isArray(data)) {
          const matched = data.find(a => {
            const aEmail = (a.patient_email || '').trim().toLowerCase();
            const aDigits = (a.patient_phone || '').replace(/\D/g, '').slice(-10);
            const emailMatch = cleanEmail && aEmail && aEmail === cleanEmail;
            const phoneMatch = cleanDigits && aDigits && aDigits === cleanDigits;
            return Boolean(emailMatch || phoneMatch);
          });

          if (matched) {
            setIsDuplicateBooked(true);
            setDuplicateAppointment(matched);
            return;
          }
        }
        setIsDuplicateBooked(false);
        setDuplicateAppointment(null);
      } catch (_) {
        setIsDuplicateBooked(false);
        setDuplicateAppointment(null);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [email, contact]);

  // Pre-fill user data when opened or currentUser changes
  useEffect(() => {
    if (isOpen) {
      const activeUser = currentUser || StorageService.getCurrentUser();
      if (activeUser) {
        if (!name && activeUser.name) setName(activeUser.name);
        if (!email && activeUser.email) setEmail(activeUser.email);
        if (!contact && activeUser.phone) setContact(activeUser.phone);
      }
      setIsSuccess(false);
      setErrorMessage(null);
    }
  }, [isOpen, currentUser]);

  // Fetch booked slots from Supabase for the selected date
  const fetchBookedSlotsForDate = useCallback(async (targetDate: string) => {
    if (!targetDate) return;
    setIsLoadingSlots(true);
    try {
      const { data, error } = await supabase
        .from('appointments')
        .select('time, status')
        .eq('date', targetDate)
        .neq('status', 'cancelled');

      if (!error && Array.isArray(data)) {
        const bookedTimes = data
          .map(a => (a.time || '').trim().toLowerCase())
          .filter(Boolean);
        setDateBookedSlots(bookedTimes);
      } else {
        // Fallback to local storage appointments
        const localApts = StorageService.getAppointments();
        const bookedTimes = localApts
          .filter(a => a.date === targetDate && a.status !== 'cancelled')
          .map(a => a.time.trim().toLowerCase());
        setDateBookedSlots(bookedTimes);
      }
    } catch (err) {
      console.warn('[PublicBookingModal] Failed to fetch booked slots:', err);
      const localApts = StorageService.getAppointments();
      const bookedTimes = localApts
        .filter(a => a.date === targetDate && a.status !== 'cancelled')
        .map(a => a.time.trim().toLowerCase());
      setDateBookedSlots(bookedTimes);
    } finally {
      setIsLoadingSlots(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && appointmentDate) {
      fetchBookedSlotsForDate(appointmentDate);
    }
  }, [isOpen, appointmentDate, fetchBookedSlotsForDate]);

  // Reset selected time if date changes and previously selected slot is now booked or passed
  useEffect(() => {
    if (appointmentTime) {
      const isPast = isSlotInPastForToday(appointmentTime, appointmentDate);
      const isBooked = dateBookedSlots.includes(appointmentTime.trim().toLowerCase());
      if (isPast || isBooked) {
        setAppointmentTime('');
      }
    }
  }, [appointmentDate, dateBookedSlots, appointmentTime]);

  if (!isOpen) return null;

  const handleDateChange = (val: string) => {
    setAppointmentDate(val);
    setErrorMessage(null);
  };

  const handleSelectSlot = (slot: string, isBooked: boolean, isPast: boolean) => {
    if (isBooked || isPast) return;
    setAppointmentTime(slot);
    setErrorMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // 1. Mandatory Field Validation
    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedContact = contact.trim();
    const finalReason = reason === 'Other' ? otherReason.trim() : reason;

    if (!trimmedName) {
      setErrorMessage('Please enter your full name.');
      return;
    }
    if (!trimmedEmail || !trimmedEmail.includes('@') || !trimmedEmail.includes('.')) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    if (!trimmedContact || trimmedContact.replace(/\D/g, '').length < 7) {
      setErrorMessage('Please enter a valid contact / phone number (at least 7 digits).');
      return;
    }
    if (!finalReason) {
      setErrorMessage(reason === 'Other' ? 'Please specify your reason for visit.' : 'Please select a reason for visit.');
      return;
    }
    if (!appointmentDate) {
      setErrorMessage('Please select an appointment date.');
      return;
    }
    if (appointmentDate < todayStr) {
      setErrorMessage('Appointment date cannot be in the past. Please select today or a future date.');
      return;
    }
    if (appointmentDate > maxDateStr) {
      setErrorMessage('Appointments can only be scheduled up to 1 month from today.');
      return;
    }
    if (!appointmentTime) {
      setErrorMessage('Please select an available appointment time slot.');
      return;
    }
    if (isSlotInPastForToday(appointmentTime, appointmentDate)) {
      setErrorMessage('The selected time slot has already passed for today. Please select a future time slot.');
      return;
    }
    if (isDuplicateBooked) {
      setErrorMessage(
        'An appointment already exists for this email address or phone number. Please check your existing appointment instead of booking again.'
      );
      return;
    }

    // Authoritative pre-check against Supabase database for duplicate email/phone
    try {
      const { data: dbApts } = await supabase
        .from('appointments')
        .select('id, patient_email, patient_phone, date, time, status');
      if (Array.isArray(dbApts)) {
        const cleanPhoneDigits = trimmedContact.replace(/\D/g, '').slice(-10);
        const existingApt = dbApts.find(a => {
          const aEmail = (a.patient_email || '').trim().toLowerCase();
          const aDigits = (a.patient_phone || '').replace(/\D/g, '').slice(-10);
          return Boolean(
            (trimmedEmail && aEmail && aEmail === trimmedEmail) ||
            (cleanPhoneDigits.length >= 7 && aDigits && aDigits === cleanPhoneDigits)
          );
        });
        if (existingApt) {
          setIsDuplicateBooked(true);
          setDuplicateAppointment(existingApt);
          setErrorMessage(
            'An appointment already exists for this email address or phone number. Please check your existing appointment instead of booking again.'
          );
          return;
        }
      }
    } catch (_) {}

    setIsSubmitting(true);

    try {
      const token = `#D-${Math.floor(100 + Math.random() * 900)}`;

      // Resolve existing patient or create/link ID
      const cleanDigits = trimmedContact.replace(/\D/g, '');
      const matchedPatient = existingPatients.find(
        p =>
          (p.email && p.email.trim().toLowerCase() === trimmedEmail) ||
          (p.phone && p.phone.replace(/\D/g, '') === cleanDigits) ||
          p.name.trim().toLowerCase() === trimmedName.toLowerCase()
      );

      const activeUser = currentUser || StorageService.getCurrentUser();
      const resolvedPatientId =
        matchedPatient?.id ||
        activeUser?.patientId ||
        `p-${Date.now()}`;

      const newAppointment: Appointment = {
        id: `apt-${Date.now()}`,
        patientId: resolvedPatientId,
        patientName: trimmedName,
        patientEmail: trimmedEmail,
        patientPhone: trimmedContact,
        doctorName: 'Dr. Ananya Sharma',
        doctorId: 'u-doctor',
        chair: 'Chair 1 - Endodontics',
        date: appointmentDate,
        time: appointmentTime,
        durationMinutes: 30,
        procedure: finalReason,
        status: 'confirmed',
        tokenNumber: token,
        notes: `Online Patient Booking. Reason: ${finalReason}. Contact: ${trimmedContact}`
      };

      // Persist via StorageService (which calls /api/appointments and Supabase)
      const savedAppointment = await StorageService.addAppointment(newAppointment);

      // Notify parent / UI state
      if (onBookAppointment) {
        await onBookAppointment(savedAppointment);
      }

      setBookedDetails({
        token,
        name: trimmedName,
        date: appointmentDate,
        time: appointmentTime,
        procedure: finalReason
      });
      setIsSuccess(true);
      showToast(`Appointment confirmed! Queue Token: ${token}`, 'success');
    } catch (err: any) {
      console.error('[PublicBookingModal] Error submitting appointment:', err);
      const msg = err?.message || '';
      if (
        msg.includes('already exists for this email') ||
        msg.includes('Appointment Already Booked') ||
        msg.includes('idx_appointments_patient_')
      ) {
        setIsDuplicateBooked(true);
        setErrorMessage(
          'An appointment already exists for this email address or phone number. Please check your existing appointment instead of booking again.'
        );
        showToast(
          'Appointment Already Booked: An appointment already exists for this email address or phone number.',
          'error'
        );
      } else {
        const fallbackMsg = msg || 'Failed to book appointment. Please verify details and retry.';
        setErrorMessage(fallbackMsg);
        showToast(fallbackMsg, 'error');
      }
      // Refresh booked slots in case someone else booked in the meantime
      fetchBookedSlotsForDate(appointmentDate);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setIsSuccess(false);
    setErrorMessage(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-900/60 backdrop-blur-md overflow-y-auto">
      <div className="bg-white/95 backdrop-blur-2xl border border-stone-200/90 rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden text-[#252525] flex flex-col my-auto max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-5 border-b border-stone-200/80 bg-[#F7F5F1]/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl bg-[#EDE8DE] text-[#252525] flex items-center justify-center border border-[#C8B58D]/40 shadow-xs">
              <ToothIcon size={22} />
            </span>
            <div>
              <h2 className="text-lg font-black text-[#252525] tracking-tight font-display">
                {isSuccess ? 'Booking Confirmed' : 'Book Dental Appointment'}
              </h2>
              <p className="text-xs text-[#6F6D69] font-medium">
                {isSuccess
                  ? 'Your visit has been registered with Dentiflow'
                  : 'All fields are mandatory. Select an available time slot.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 text-[#6F6D69] hover:text-[#252525] flex items-center justify-center transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {isSuccess && bookedDetails ? (
            /* Success Confirmation Screen */
            <div className="text-center py-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
              <div className="w-16 h-16 rounded-3xl bg-emerald-50 text-emerald-600 border border-emerald-200 mx-auto flex items-center justify-center shadow-xs">
                <CheckCircle2 className="w-8 h-8" />
              </div>

              <div>
                <span className="inline-block px-3 py-1 rounded-full bg-[#EDE8DE] text-[#252525] text-xs font-black tracking-wider border border-[#C8B58D]/50 mb-2">
                  QUEUE TOKEN {bookedDetails.token}
                </span>
                <h3 className="text-xl font-extrabold text-[#252525]">
                  Appointment Successfully Scheduled!
                </h3>
                <p className="text-xs text-[#6F6D69] max-w-sm mx-auto mt-1">
                  Thank you, <strong className="text-[#252525]">{bookedDetails.name}</strong>. Your appointment has been recorded in Supabase and is immediately visible to the clinic doctors.
                </p>
              </div>

              <div className="bg-[#F7F5F1] border border-stone-200/80 rounded-2xl p-4 text-left space-y-2 text-xs">
                <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                  <span className="text-[#6F6D69] font-medium">Scheduled Date:</span>
                  <span className="font-bold text-[#252525] flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-[#C8B58D]" />
                    {bookedDetails.date}
                  </span>
                </div>
                <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                  <span className="text-[#6F6D69] font-medium">Reserved Time Slot:</span>
                  <span className="font-bold text-[#252525] flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-[#C8B58D]" />
                    {bookedDetails.time}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#6F6D69] font-medium">Reason for Visit:</span>
                  <span className="font-bold text-[#252525] text-right truncate max-w-[200px]">
                    {bookedDetails.procedure}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleClose}
                className="w-full py-2.5 px-4 rounded-xl font-bold text-xs bg-[#252525] text-[#F7F5F1] hover:bg-stone-800 transition cursor-pointer shadow-xs"
              >
                Close &amp; View in Dashboard
              </button>
            </div>
          ) : (
            /* Exactly 6 Mandatory Patient-Facing Fields Form */
            <form onSubmit={handleSubmit} className="space-y-4">
              {isDuplicateBooked && (
                <div className="p-4 rounded-2xl bg-amber-50/90 border-2 border-amber-300 text-amber-950 text-xs shadow-xs animate-in fade-in duration-200 space-y-1">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                    <span className="font-extrabold text-sm text-amber-900">Appointment Already Booked</span>
                  </div>
                  <p className="text-amber-800 leading-relaxed pl-7">
                    An appointment already exists for this email address or phone number. Please check your existing appointment instead of booking again.
                  </p>
                  {duplicateAppointment && (
                    <div className="mt-2 pl-7 pt-2 border-t border-amber-200/80 text-[11px] text-amber-900 flex flex-wrap items-center gap-2">
                      <span className="font-bold">Existing Booking:</span>
                      <span className="px-2 py-0.5 rounded-md bg-amber-100/90 font-mono font-bold">
                        {duplicateAppointment.date} at {duplicateAppointment.time}
                      </span>
                      <span className="capitalize font-semibold text-amber-800">
                        &bull; Status: {duplicateAppointment.status}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {errorMessage && !isDuplicateBooked && (
                <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2 animate-in fade-in duration-150">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* 1. Name */}
              <div>
                <label className="block text-xs font-bold text-[#252525] mb-1.5 flex items-center gap-1">
                  <UserIcon className="w-3.5 h-3.5 text-[#C8B58D]" />
                  <span>1. Full Name *</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Rahul Sharma"
                  className="w-full px-3.5 py-2.5 text-xs bg-white border border-stone-200 rounded-xl text-[#252525] focus:outline-none focus:ring-2 focus:ring-[#C8B58D] transition"
                />
              </div>

              {/* 2. Email & 3. Contact in responsive grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* 2. Email */}
                <div>
                  <label className="block text-xs font-bold text-[#252525] mb-1.5 flex items-center gap-1">
                    <Mail className="w-3.5 h-3.5 text-[#C8B58D]" />
                    <span>2. Email Address *</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="patient@example.com"
                    className="w-full px-3.5 py-2.5 text-xs bg-white border border-stone-200 rounded-xl text-[#252525] focus:outline-none focus:ring-2 focus:ring-[#C8B58D] transition"
                  />
                </div>

                {/* 3. Contact */}
                <div>
                  <label className="block text-xs font-bold text-[#252525] mb-1.5 flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-[#C8B58D]" />
                    <span>3. Contact Number *</span>
                  </label>
                  <input
                    type="tel"
                    required
                    value={contact}
                    onChange={e => setContact(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full px-3.5 py-2.5 text-xs bg-white border border-stone-200 rounded-xl text-[#252525] focus:outline-none focus:ring-2 focus:ring-[#C8B58D] transition"
                  />
                </div>
              </div>

              {/* 4. Reason for Visit (Dropdown + Specify if Other) */}
              <div>
                <label className="block text-xs font-bold text-[#252525] mb-1.5 flex items-center gap-1">
                  <Stethoscope className="w-3.5 h-3.5 text-[#C8B58D]" />
                  <span>4. Reason for Visit *</span>
                </label>
                <select
                  required
                  value={reason}
                  onChange={e => {
                    setReason(e.target.value);
                    if (e.target.value !== 'Other') setOtherReason('');
                  }}
                  className="w-full px-3.5 py-2.5 text-xs bg-white border border-stone-200 rounded-xl text-[#252525] focus:outline-none focus:ring-2 focus:ring-[#C8B58D] transition cursor-pointer"
                >
                  {REASONS_FOR_VISIT.map(opt => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>

                {reason === 'Other' && (
                  <div className="mt-2 animate-in fade-in duration-150">
                    <input
                      type="text"
                      required
                      value={otherReason}
                      onChange={e => setOtherReason(e.target.value)}
                      placeholder="Please specify reason for visit *"
                      className="w-full px-3.5 py-2 text-xs bg-stone-50 border border-stone-200 rounded-xl text-[#252525] focus:outline-none focus:ring-2 focus:ring-[#C8B58D] transition"
                    />
                  </div>
                )}
              </div>

              {/* 5. Appointment Date (Window: Today to +1 Month) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-[#252525] flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-[#C8B58D]" />
                    <span>5. Appointment Date *</span>
                  </label>
                  <span className="text-[10px] text-[#6F6D69] font-medium">
                    Allowed: Today through {maxDateStr}
                  </span>
                </div>
                <input
                  type="date"
                  required
                  min={todayStr}
                  max={maxDateStr}
                  value={appointmentDate}
                  onChange={e => handleDateChange(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs bg-white border border-stone-200 rounded-xl text-[#252525] focus:outline-none focus:ring-2 focus:ring-[#C8B58D] transition cursor-pointer font-medium"
                />
              </div>

              {/* 6. Appointment Time Slots (Blocks Past & Already Booked Slots) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-[#252525] flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-[#C8B58D]" />
                    <span>6. Appointment Time Slot *</span>
                  </label>
                  {isLoadingSlots && (
                    <span className="text-[10px] text-[#C8B58D] flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Checking availability...
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {CLINIC_TIME_SLOTS.map(slot => {
                    const normSlot = slot.trim().toLowerCase();
                    const isBooked = dateBookedSlots.includes(normSlot);
                    const isPast = isSlotInPastForToday(slot, appointmentDate);
                    const isSelected = appointmentTime === slot;

                    if (isBooked) {
                      return (
                        <div
                          key={slot}
                          className="px-3 py-2.5 rounded-xl border border-rose-200/80 bg-rose-50/70 text-rose-800 text-xs flex flex-col items-center justify-center opacity-70 cursor-not-allowed select-none shadow-2xs"
                          title="This slot has already been booked."
                        >
                          <span className="font-bold line-through">{slot}</span>
                          <span className="text-[9px] font-black uppercase text-rose-700 tracking-wider flex items-center gap-0.5 mt-0.5">
                            <Ban className="w-2.5 h-2.5" />
                            BOOKED
                          </span>
                        </div>
                      );
                    }

                    if (isPast) {
                      return (
                        <div
                          key={slot}
                          className="px-3 py-2.5 rounded-xl border border-stone-200 bg-stone-100/70 text-stone-400 text-xs flex flex-col items-center justify-center opacity-60 cursor-not-allowed select-none"
                          title="This time slot has already passed for today."
                        >
                          <span className="font-semibold line-through">{slot}</span>
                          <span className="text-[9px] font-bold uppercase tracking-wider mt-0.5">
                            Passed
                          </span>
                        </div>
                      );
                    }

                    return (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => handleSelectSlot(slot, false, false)}
                        className={`px-3 py-2.5 rounded-xl border text-xs font-bold transition flex flex-col items-center justify-center cursor-pointer shadow-2xs ${
                          isSelected
                            ? 'bg-[#252525] border-[#252525] text-[#F7F5F1] ring-2 ring-[#C8B58D]'
                            : 'bg-white border-stone-200 text-[#252525] hover:border-[#C8B58D] hover:bg-[#F7F5F1]'
                        }`}
                      >
                        <span className="flex items-center gap-1">
                          {isSelected && <Check className="w-3 h-3 text-[#C8B58D]" />}
                          <span>{slot}</span>
                        </span>
                        <span className={`text-[9px] font-semibold mt-0.5 ${isSelected ? 'text-[#C8B58D]' : 'text-emerald-600'}`}>
                          Available
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="pt-3 border-t border-stone-200/80 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-bold text-[#6F6D69] hover:bg-stone-100 rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || isDuplicateBooked}
                  className="px-5 py-2.5 text-xs font-bold bg-[#252525] hover:bg-stone-800 text-[#F7F5F1] rounded-xl transition shadow-xs cursor-pointer flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isDuplicateBooked ? (
                    <>
                      <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                      <span>Appointment Already Booked</span>
                    </>
                  ) : isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C8B58D]" />
                      <span>Confirming Slot...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5 text-[#C8B58D]" />
                      <span>Book Appointment</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
