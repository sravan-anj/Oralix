import React, { useState, useEffect } from 'react';
import {
  Patient,
  Appointment,
  QueueItem,
  Invoice,
  User,
  TreatmentPlan
} from '../../types';
import { ActiveTab } from '../layout/Sidebar';
import { OperatoryChairModal } from './OperatoryChairModal';
import { TodaysVisitsModal } from './TodaysVisitsModal';
import { RevenueModal } from './RevenueModal';
import {
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  Plus,
  Stethoscope,
  UsersRound,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
  Activity,
  ShieldCheck,
  Sparkles,
  Shield,
  FileText,
  Pill,
  Check,
  ChevronRight,
  Info,
  HeartPulse,
  MapPin,
  Smile,
  Mail,
  Receipt,
  Trash2,
  AlertCircle,
  XCircle
} from 'lucide-react';
import { useToast } from '../common/Toast';
import { GmailAuthService } from '../../utils/gmailAuthService';
import { StorageService } from '../../utils/storage';

interface DashboardViewProps {
  currentUser: User;
  patients: Patient[];
  appointments: Appointment[];
  queue: QueueItem[];
  invoices: Invoice[];
  treatmentPlans: TreatmentPlan[];
  onNavigate: (tab: ActiveTab) => void;
  onOpenNewAppointment: () => void;
  onSelectPatient: (patientId: string) => void;
  onNavigateToBilling?: (patientId: string, appointmentId?: string) => void;
  onSaveAppointments?: (updated: Appointment[]) => void;
  onDeleteAppointmentAndPatient?: (appointmentId: string, patientId: string) => Promise<void> | void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  currentUser,
  patients,
  appointments,
  queue,
  invoices,
  treatmentPlans,
  onNavigate,
  onOpenNewAppointment,
  onSelectPatient,
  onNavigateToBilling,
  onSaveAppointments,
  onDeleteAppointmentAndPatient
}) => {
  const [isTodaysVisitsOpen, setIsTodaysVisitsOpen] = useState(false);
  const [isRevenueModalOpen, setIsRevenueModalOpen] = useState(false);
  const [selectedChairData, setSelectedChairData] = useState<any | null>(null);
  const [appointmentToDelete, setAppointmentToDelete] = useState<Appointment | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { showToast } = useToast();
  const [isGmailConnected, setIsGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState<string | null>(null);
  const [isGmailLoading, setIsGmailLoading] = useState(false);
  const [isGmailConnecting, setIsGmailConnecting] = useState(false);
  const [isGmailDisconnecting, setIsGmailDisconnecting] = useState(false);

  // Monitor and load Gmail connection state for the clinician
  useEffect(() => {
    let isMounted = true;

    // Check URL parameters for OAuth redirect callback
    const oauthParams = GmailAuthService.parseOAuthCallback();
    if (oauthParams.status === 'connected') {
      setIsGmailConnected(true);
      if (oauthParams.email) {
        setGmailEmail(oauthParams.email);
      }
      showToast(
        `Gmail connected successfully! ${oauthParams.email ? `(${oauthParams.email})` : ''}`,
        'success'
      );
      GmailAuthService.clearOAuthCallbackUrl();
    } else if (oauthParams.status === 'error') {
      showToast(`Gmail connection error: ${oauthParams.error || 'Authorization failed'}`, 'error');
      GmailAuthService.clearOAuthCallbackUrl();
    }

    // Query active connection status from Supabase
    if (currentUser.role === 'doctor' || currentUser.role === 'admin') {
      setIsGmailLoading(true);
      GmailAuthService.getStatus()
        .then(status => {
          if (!isMounted) return;
          setIsGmailConnected(status.isConnected);
          if (status.email) {
            setGmailEmail(status.email);
          }
        })
        .finally(() => {
          if (isMounted) setIsGmailLoading(false);
        });
    }

    // Listen for postMessage in case OAuth completed in a popup or child window
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'DENTIFLOW_GMAIL_CONNECTED') {
        setIsGmailConnected(true);
        if (event.data.email) {
          setGmailEmail(event.data.email);
        }
        showToast('Gmail connected successfully!', 'success');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => {
      isMounted = false;
      window.removeEventListener('message', handleMessage);
    };
  }, [currentUser.id, currentUser.role, showToast]);

  const handleCancelAppointment = async (appointmentId: string) => {
    try {
      const updated = appointments.map(a =>
        a.id === appointmentId ? { ...a, status: 'cancelled' as const } : a
      );
      StorageService.saveAppointments(updated);
      if (onSaveAppointments) {
        onSaveAppointments(updated);
      }
      showToast('Appointment cancelled. Record retained in database.', 'info');
    } catch (err: any) {
      showToast(err?.message || 'Failed to cancel appointment', 'error');
    }
  };

  const handleConfirmDelete = async () => {
    if (!appointmentToDelete) return;
    setIsDeleting(true);
    try {
      if (onDeleteAppointmentAndPatient) {
        await onDeleteAppointmentAndPatient(appointmentToDelete.id, appointmentToDelete.patientId);
      } else {
        await StorageService.deleteAppointmentAndPatient(appointmentToDelete.id, appointmentToDelete.patientId);
        if (onSaveAppointments) {
          onSaveAppointments(appointments.filter(a => a.id !== appointmentToDelete.id));
        }
      }
      setAppointmentToDelete(null);
      showToast('Appointment and associated patient permanently deleted.', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Failed to delete appointment', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleConnectGmail = async () => {
    setIsGmailConnecting(true);
    try {
      const res = await GmailAuthService.startOAuthFlow();
      if (!res.success || !res.url) {
        showToast(res.error || 'Failed to initiate Gmail authorization.', 'error');
        setIsGmailConnecting(false);
        return;
      }
      // Redirect doctor to Google OAuth consent screen
      window.location.href = res.url;
    } catch (err: any) {
      showToast(err?.message || 'Error redirecting to Google OAuth.', 'error');
      setIsGmailConnecting(false);
    }
  };

  const handleDisconnectGmail = async () => {
    setIsGmailDisconnecting(true);
    try {
      const res = await GmailAuthService.disconnect();
      if (res.success) {
        setIsGmailConnected(false);
        setGmailEmail(null);
        showToast('Clinic Gmail disconnected.', 'info');
      } else {
        showToast(res.error || 'Failed to disconnect Gmail.', 'error');
      }
    } catch (err: any) {
      showToast(err?.message || 'Error disconnecting Gmail.', 'error');
    } finally {
      setIsGmailDisconnecting(false);
    }
  };

  const isPatient = currentUser.role === 'patient';
  const currentPatient = isPatient
    ? patients.find(p => p.id === (currentUser.patientId || 'p-1')) || patients[0]
    : null;

  // Aggregate Metrics
  const todayVisitsCount = appointments.length;
  const completedCount = appointments.filter(a => a.status === 'completed').length;
  const inQueueCount = queue.filter(q => q.status === 'waiting' || q.status === 'in_chair').length;
  
  const totalCollected = invoices.reduce((acc, inv) => acc + inv.amountPaid, 0);
  const totalOutstanding = invoices.reduce((acc, inv) => acc + inv.balanceDue, 0);

  // Patient view specific calculations
  const patientAppointments = appointments.filter(a => a.patientId === currentPatient?.id);
  const patientPlans = treatmentPlans.filter(p => p.patientId === currentPatient?.id);
  const patientInvoices = invoices.filter(i => i.patientId === currentPatient?.id);

  if (isPatient && currentPatient) {
    const nextApt = patientAppointments.find(a => a.status === 'confirmed' || a.status === 'in_chair') || patientAppointments[0];
    const activePlan = patientPlans[0];
    const totalPaid = patientInvoices.reduce((acc, inv) => acc + (inv.amountPaid || 0), 0);
    const totalOutstanding = currentPatient.balanceDue ?? patientInvoices.reduce((acc, inv) => acc + (inv.balanceDue || 0), 0);

    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        {/* Welcome Banner */}
        <div className="bg-white/85 backdrop-blur-md border border-stone-200/80 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#EDE8DE] text-[#252525] text-[10px] font-extrabold uppercase tracking-wider mb-1.5 border border-[#C8B58D]/30">
              <Sparkles className="w-3 h-3 text-[#C8B58D]" />
              <span>Personal Dental Vault &bull; Record {currentPatient.code}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-[#252525] tracking-tight">
              Welcome, {currentPatient.name}
            </h1>
            <p className="text-xs text-[#6F6D69] mt-0.5">
              Primary Clinician: <strong className="text-[#252525] font-semibold">Dr. Ananya Sharma</strong> &bull; Blood Group: <strong className="text-[#252525] font-semibold">{currentPatient.bloodGroup || 'O+'}</strong>
            </p>
          </div>

          <button
            onClick={onOpenNewAppointment}
            className="btn-primary flex items-center justify-center gap-1.5 cursor-pointer self-start md:self-auto shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Book Appointment</span>
          </button>
        </div>

        {/* Medical Safety Alert Banner (if any) */}
        {currentPatient.medicalAlerts.length > 0 && (
          <div className="bg-[#C5A66A]/10 backdrop-blur-xs border border-[#C5A66A]/30 rounded-2xl p-4 flex items-start gap-3 text-xs text-[#252525] shadow-2xs">
            <div className="p-2 rounded-xl bg-[#C5A66A]/20 text-[#635028] shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <div className="font-bold text-[#252525] flex items-center gap-2">
                <span>Medical Safety Alerts on File</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#C5A66A]/20 text-[#635028] font-extrabold uppercase">
                  Verified by Clinician
                </span>
              </div>
              <p className="text-[#6F6D69] text-xs mt-0.5 leading-relaxed">
                {currentPatient.medicalAlerts.join(' • ')} &mdash; The clinical team takes standard prophylactic measures prior to administering local anesthetics or operative treatments.
              </p>
            </div>
          </div>
        )}

        {/* 1. NEXT APPOINTMENT SECTION */}
        <div className="bg-gradient-to-r from-[#252525] via-[#2D2A26] to-[#1A1A18] text-white rounded-2xl p-6 shadow-md relative overflow-hidden border border-[#C8B58D]/30">
          <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-[#C8B58D]/20 via-transparent to-transparent pointer-events-none" />
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full bg-[#C8B58D]/20 text-[#E8DCC4] text-[10px] font-extrabold uppercase tracking-wider border border-[#C8B58D]/30">
                  NEXT APPOINTMENT
                </span>
                {nextApt && (
                  <span className="px-2.5 py-0.5 rounded-full bg-[#8FA88D]/20 text-[#C3D9C1] text-[10px] font-extrabold uppercase tracking-wider border border-[#8FA88D]/30 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#8FA88D] animate-pulse" />
                    {nextApt.status.replace('_', ' ').toUpperCase()}
                  </span>
                )}
              </div>

              <h2 className="text-xl font-black text-white">
                {nextApt ? nextApt.procedure : 'No Upcoming Appointment Scheduled'}
              </h2>

              {nextApt ? (
                <p className="text-xs text-[#E8DCC4]/90 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-[#C8B58D]" />
                    <span>{nextApt.date} at {nextApt.time}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Stethoscope className="w-3.5 h-3.5 text-[#C8B58D]" />
                    <span>{nextApt.doctorName}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-[#C8B58D]" />
                    <span>{nextApt.chair || 'Operatory Chair 1'}</span>
                  </span>
                </p>
              ) : (
                <p className="text-xs text-[#E8DCC4]/70">
                  Schedule your routine 6-month checkup or consultation with Dr. Ananya Sharma.
                </p>
              )}
            </div>

            <div className="shrink-0">
              <button
                onClick={() => onNavigate('appointments')}
                className="btn-secondary text-xs cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Calendar className="w-3.5 h-3.5 text-[#C8B58D]" />
                <span>Manage Appointments</span>
              </button>
            </div>
          </div>
        </div>

        {/* 2. TREATMENT PLAN SECTION */}
        <div
          onClick={() => onNavigate('treatment-plans')}
          className="bg-white/85 backdrop-blur-md border border-stone-200/80 rounded-2xl p-6 shadow-xs space-y-4 hover:shadow-md transition cursor-pointer group"
        >
          <div className="flex items-center justify-between pb-3 border-b border-stone-100">
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#C8B58D] block mb-0.5">
                TREATMENT PLAN SUMMARY
              </span>
              <h3 className="text-base font-extrabold text-[#252525] flex items-center gap-2">
                <Activity className="w-5 h-5 text-[#C8B58D]" />
                <span>{activePlan ? activePlan.title : 'Comprehensive Restorative Care Plan'}</span>
              </h3>
            </div>
            <span className="text-xs font-bold text-[#252525] group-hover:text-[#C8B58D] flex items-center gap-1 shrink-0 transition">
              <span>View Full Plan</span>
              <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 bg-[#EDE8DE]/60 rounded-xl border border-stone-200/80">
              <span className="text-[10px] text-[#6F6D69] font-bold block uppercase">Current Status</span>
              <span className="font-extrabold text-[#252525] capitalize mt-0.5 block">
                {activePlan ? activePlan.status.replace('_', ' ') : 'Active Maintenance'}
              </span>
            </div>

            <div className="p-3 bg-[#EDE8DE]/60 rounded-xl border border-stone-200/80">
              <span className="text-[10px] text-[#6F6D69] font-bold block uppercase">Next Procedure Step</span>
              <span className="font-extrabold text-[#252525] mt-0.5 block truncate">
                {activePlan?.procedures?.[0]?.name || 'Tooth #16 Zirconia Crown Placement'}
              </span>
            </div>

            <div className="p-3 bg-[#EDE8DE]/60 rounded-xl border border-stone-200/80">
              <span className="text-[10px] text-[#6F6D69] font-bold block uppercase">Prescribed Date</span>
              <span className="font-extrabold text-[#6F6D69] mt-0.5 block">
                {activePlan ? activePlan.dateCreated : 'Recent Assessment'}
              </span>
            </div>
          </div>
        </div>

        {/* 3. DENTAL HEALTH / ODONTOGRAM PREVIEW SECTION */}
        <div className="bg-white/85 backdrop-blur-md border border-stone-200/80 rounded-2xl p-6 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-100">
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#C8B58D] block mb-0.5">
                DENTAL HEALTH SUMMARY
              </span>
              <h3 className="text-base font-extrabold text-[#252525] flex items-center gap-2">
                <Stethoscope className="w-5 h-5 text-[#C8B58D]" />
                <span>Dental Odontogram Status</span>
              </h3>
              <p className="text-xs text-[#6F6D69]">
                Live anatomical record of recorded conditions across your 32 adult teeth
              </p>
            </div>
            <button
              onClick={() => onNavigate('chart')}
              className="btn-secondary text-xs border border-stone-200 flex items-center gap-1 cursor-pointer shrink-0 self-start sm:self-auto"
            >
              <span>Open Full Dental Chart</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Clean Arch Preview Graphic */}
          <div className="bg-[#252525] text-white rounded-xl p-4 border border-stone-800 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-stone-300 border-b border-stone-800 pb-2">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#8FA88D]" />
                <span>Anatomical Teeth Map</span>
              </span>
              <span className="text-[10px] font-mono text-stone-400">32 Teeth Tracked</span>
            </div>

            {/* Teeth Pills Grid */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-1 overflow-x-auto pb-1">
                {Array.from({ length: 16 }, (_, i) => i + 1).map(num => {
                  const isCrown = num === 16;
                  const isRestored = num === 3 || num === 14;
                  const isWatch = num === 2;
                  return (
                    <div
                      key={num}
                      onClick={() => onNavigate('chart')}
                      title={`Tooth #${num} ${isCrown ? '(Crown)' : isRestored ? '(Restored)' : isWatch ? '(Watch)' : '(Healthy)'}`}
                      className={`w-7 h-8 rounded-md flex flex-col items-center justify-center text-[10px] font-extrabold shrink-0 border transition cursor-pointer ${
                        isCrown
                          ? 'bg-[#C8B58D] text-[#252525] border-[#E8DCC4]'
                          : isRestored
                          ? 'bg-[#8FA88D] text-white border-[#A4BDA2]'
                          : isWatch
                          ? 'bg-[#C5A66A] text-white border-[#D6B77B]'
                          : 'bg-stone-800 text-stone-300 border-stone-700'
                      }`}
                    >
                      <span>{num}</span>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between gap-1 overflow-x-auto pb-1">
                {Array.from({ length: 16 }, (_, i) => i + 17).map(num => {
                  const isRCT = num === 46;
                  const isMissing = num === 48;
                  return (
                    <div
                      key={num}
                      onClick={() => onNavigate('chart')}
                      title={`Tooth #${num} ${isRCT ? '(Root Canal)' : isMissing ? '(Missing)' : '(Healthy)'}`}
                      className={`w-7 h-8 rounded-md flex flex-col items-center justify-center text-[10px] font-extrabold shrink-0 border transition cursor-pointer ${
                        isRCT
                          ? 'bg-[#C8B58D] text-[#252525] border-[#E8DCC4]'
                          : isMissing
                          ? 'bg-stone-700 text-stone-400 border-stone-600'
                          : 'bg-stone-800 text-stone-300 border-stone-700'
                      }`}
                    >
                      <span>{num}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* 4. PAYMENT SUMMARY SECTION */}
        <div
          onClick={() => onNavigate('billing')}
          className="bg-white/85 backdrop-blur-md border border-stone-200/80 rounded-2xl p-6 shadow-xs space-y-4 hover:shadow-md transition cursor-pointer group"
        >
          <div className="flex items-center justify-between pb-3 border-b border-stone-100">
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#8FA88D] block mb-0.5">
                PAYMENT SUMMARY
              </span>
              <h3 className="text-base font-extrabold text-[#252525] flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-[#8FA88D]" />
                <span>Account &amp; Treatment Settlement</span>
              </h3>
            </div>
            <span className="text-xs font-bold text-[#252525] group-hover:text-[#C8B58D] flex items-center gap-1 shrink-0 transition">
              <span>View Payment Details</span>
              <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-4 bg-[#8FA88D]/15 rounded-xl border border-[#8FA88D]/30 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-extrabold text-[#3B4D3A] block uppercase">Amount Paid</span>
                <span className="text-2xl font-black text-[#252525] mt-1 block">
                  INR ₹{totalPaid.toLocaleString()}
                </span>
              </div>
              <CheckCircle2 className="w-8 h-8 text-[#8FA88D] opacity-80" />
            </div>

            <div className="p-4 bg-[#C5A66A]/15 rounded-xl border border-[#C5A66A]/30 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-extrabold text-[#594723] block uppercase">Outstanding Amount</span>
                <span className="text-2xl font-black text-[#252525] mt-1 block">
                  INR ₹{totalOutstanding.toLocaleString()}
                </span>
              </div>
              {totalOutstanding > 0 ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate('billing');
                  }}
                  className="btn-primary font-bold text-xs shrink-0 flex items-center gap-1"
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>Pay Now</span>
                </button>
              ) : (
                <CreditCard className="w-8 h-8 text-[#C5A66A] opacity-80" />
              )}
            </div>
          </div>
        </div>

      </div>
    );
  }

  // Doctor & Admin Dashboard View
  return (
    <div className="space-y-6">
      {/* Top Banner & Quick Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-stone-200/80">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#EDE8DE] text-[#252525] text-[10px] font-bold uppercase tracking-wider mb-1 border border-[#C8B58D]/30">
            <Sparkles className="w-3 h-3 text-[#C8B58D]" />
            <span>Clinic Operatory Terminal</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-[#252525] tracking-tight">
            Practice Overview
          </h1>
          <p className="text-xs text-[#6F6D69]">
            Real-time operatory chair status, queue times, and patient treatment workflows.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Clinic Gmail Connection Controls */}
          {(currentUser.role === 'doctor' || currentUser.role === 'admin') && (
            <>
              {isGmailLoading ? (
                <div className="h-8.5 px-3 rounded-xl bg-[#EDE8DE]/50 border border-stone-200/80 flex items-center gap-1.5 text-xs text-[#6F6D69] animate-pulse">
                  <span className="w-3 h-3 rounded-full border-2 border-[#C8B58D] border-t-transparent animate-spin" />
                  <span className="text-[11px] font-medium">Checking Gmail...</span>
                </div>
              ) : isGmailConnected ? (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#8FA88D]/15 border border-[#8FA88D]/40 text-[#252525] shadow-2xs">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#5B7C59]" />
                    <div className="flex flex-col text-left leading-tight">
                      <span className="text-[11px] font-extrabold text-[#2F4F2D]">
                        Gmail Connected
                      </span>
                      {gmailEmail && (
                        <span className="text-[10px] text-[#556F53] font-medium truncate max-w-[140px] sm:max-w-[190px]" title={gmailEmail}>
                          {gmailEmail}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={handleConnectGmail}
                    disabled={isGmailConnecting || isGmailDisconnecting}
                    title="Reconnect or reauthorize your Gmail account"
                    className="ml-1 text-[10px] px-2 py-0.5 rounded-md bg-white hover:bg-stone-50 text-[#252525] font-extrabold border border-stone-200 transition cursor-pointer shadow-2xs disabled:opacity-60"
                  >
                    {isGmailConnecting ? 'Connecting...' : 'Reconnect'}
                  </button>
                  <button
                    onClick={handleDisconnectGmail}
                    disabled={isGmailDisconnecting || isGmailConnecting}
                    title="Disconnect Gmail integration"
                    className="text-[10px] px-2 py-0.5 rounded-md bg-white hover:bg-red-50 text-red-600 font-extrabold border border-red-200 transition cursor-pointer shadow-2xs disabled:opacity-60"
                  >
                    {isGmailDisconnecting ? '...' : 'Disconnect'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleConnectGmail}
                  disabled={isGmailConnecting}
                  className="px-3.5 py-2 rounded-xl bg-white hover:bg-stone-50 border border-stone-300 hover:border-stone-400 text-[#252525] text-xs font-extrabold flex items-center gap-2 shadow-2xs hover:shadow-xs transition cursor-pointer disabled:opacity-60"
                >
                  {isGmailConnecting ? (
                    <>
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-[#C8B58D] border-t-transparent animate-spin" />
                      <span>Connecting...</span>
                    </>
                  ) : (
                    <>
                      <Mail className="w-4 h-4 text-[#EA4335]" />
                      <span>Connect Gmail</span>
                    </>
                  )}
                </button>
              )}
            </>
          )}

          {currentUser.role !== 'admin' && currentUser.role !== 'doctor' && (
            <button
              onClick={onOpenNewAppointment}
              className="btn-primary text-xs cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Book Appointment</span>
            </button>
          )}
          <button
            onClick={() => onNavigate('chart')}
            className="btn-secondary text-xs cursor-pointer flex items-center gap-1.5"
          >
            <Stethoscope className="w-4 h-4 text-[#C8B58D]" />
            <span>Open Odontogram</span>
          </button>
        </div>
      </div>

      {/* Clinic Communications Status Notice for Doctor */}
      {(currentUser.role === 'doctor' || currentUser.role === 'admin') && !isGmailConnected && !isGmailLoading && (
        <div className="bg-[#EDE8DE]/70 border border-[#C8B58D]/40 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-2xs">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-white text-[#C8B58D] border border-stone-200/60 shrink-0">
              <Mail className="w-4 h-4 text-[#EA4335]" />
            </div>
            <div>
              <span className="font-extrabold text-[#252525] block">
                Enable Automated Patient Receipts &amp; Notifications
              </span>
              <p className="text-[#6F6D69] text-xs mt-0.5">
                Connect your clinic Gmail account to allow Dentiflow to automatically email billing receipts and visit confirmations directly to patients.
              </p>
            </div>
          </div>
          <button
            onClick={handleConnectGmail}
            disabled={isGmailConnecting}
            className="btn-primary text-xs px-3.5 py-1.5 shrink-0 self-start sm:self-auto cursor-pointer flex items-center gap-1.5"
          >
            {isGmailConnecting ? (
              <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            <span>Connect Gmail</span>
          </button>
        </div>
      )}

      {/* Primary 4 Vertical Dashboard Options */}
      <div className="grid grid-cols-1 gap-4.5">
        
        {/* Option 1: TODAY'S VISITS */}
        <div
          onClick={() => setIsTodaysVisitsOpen(true)}
          className="bg-white/85 backdrop-blur-md border border-stone-200/80 rounded-2xl p-6 sm:p-7 shadow-xs hover:shadow-md transition cursor-pointer group flex items-center justify-between gap-4"
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[#6F6D69]">
              <span className="p-2.5 rounded-xl bg-[#EDE8DE] text-[#252525] group-hover:bg-[#C8B58D]/20 transition">
                <Calendar className="w-5 h-5 text-[#C8B58D]" />
              </span>
              <span className="text-sm font-extrabold uppercase tracking-wider text-[#252525] group-hover:text-[#C8B58D] transition">
                TODAY'S VISITS
              </span>
            </div>
            <p className="text-3xl sm:text-4xl font-black text-[#252525] tracking-tight pt-1">
              {todayVisitsCount}
            </p>
            <p className="text-xs text-[#252525] font-bold flex items-center gap-1">
              <span>Inspect Today's Appointments &amp; Live Waiting Room</span>
              <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform text-[#C8B58D]" />
            </p>
          </div>

          <div className="shrink-0 text-right hidden sm:block">
            <span className="px-3.5 py-1.5 rounded-xl bg-[#EDE8DE] text-[#252525] font-extrabold text-xs border border-[#C8B58D]/30">
              Appointments + Queue Hub &rarr;
            </span>
          </div>
        </div>

        {/* Option 2: APPOINTMENTS COMPLETED */}
        <div
          onClick={() => onNavigate('appointments')}
          className="bg-white/85 backdrop-blur-md border border-stone-200/80 rounded-2xl p-6 sm:p-7 shadow-xs hover:shadow-md transition cursor-pointer group flex items-center justify-between gap-4"
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[#6F6D69]">
              <span className="p-2.5 rounded-xl bg-[#8FA88D]/20 text-[#3B4D3A] group-hover:bg-[#8FA88D]/30 transition">
                <CheckCircle2 className="w-5 h-5 text-[#8FA88D]" />
              </span>
              <span className="text-sm font-extrabold uppercase tracking-wider text-[#252525] group-hover:text-[#8FA88D] transition">
                APPOINTMENTS COMPLETED
              </span>
            </div>
            <p className="text-3xl sm:text-4xl font-black text-[#252525] tracking-tight pt-1">
              {completedCount}
            </p>
            <p className="text-xs text-[#3B4D3A] font-bold flex items-center gap-1">
              <span>All clinical treatment notes signed &bull; Open Log</span>
              <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </p>
          </div>

          <div className="shrink-0 text-right hidden sm:block">
            <span className="px-3.5 py-1.5 rounded-xl bg-[#8FA88D]/20 text-[#3B4D3A] font-extrabold text-xs border border-[#8FA88D]/30">
              Completed Calendar &rarr;
            </span>
          </div>
        </div>

        {/* Option 3: IN QUEUE */}
        <div
          onClick={() => onNavigate('queue')}
          className="bg-white/85 backdrop-blur-md border border-stone-200/80 rounded-2xl p-6 sm:p-7 shadow-xs hover:shadow-md transition cursor-pointer group flex items-center justify-between gap-4"
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[#6F6D69]">
              <span className="p-2.5 rounded-xl bg-[#C5A66A]/20 text-[#594723] group-hover:bg-[#C5A66A]/30 transition">
                <UsersRound className="w-5 h-5 text-[#C5A66A]" />
              </span>
              <span className="text-sm font-extrabold uppercase tracking-wider text-[#252525] group-hover:text-[#C5A66A] transition">
                IN QUEUE
              </span>
            </div>
            <p className="text-3xl sm:text-4xl font-black text-[#252525] tracking-tight pt-1">
              {inQueueCount}
            </p>
            <p className="text-xs text-[#594723] font-bold flex items-center gap-1">
              <span>Patients currently checked-in / waiting &bull; Open Queue Board</span>
              <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </p>
          </div>

          <div className="shrink-0 text-right hidden sm:block">
            <span className="px-3.5 py-1.5 rounded-xl bg-[#C5A66A]/20 text-[#594723] font-extrabold text-xs border border-[#C5A66A]/30">
              Queue Display Screen &rarr;
            </span>
          </div>
        </div>

        {/* Option 4: REVENUE COLLECTED */}
        <div
          onClick={() => setIsRevenueModalOpen(true)}
          className="bg-white/85 backdrop-blur-md border border-stone-200/80 rounded-2xl p-6 sm:p-7 shadow-xs hover:shadow-md transition cursor-pointer group flex items-center justify-between gap-4"
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[#6F6D69]">
              <span className="p-2.5 rounded-xl bg-[#EDE8DE] text-[#252525] group-hover:bg-[#C8B58D]/20 transition">
                <CreditCard className="w-5 h-5 text-[#C8B58D]" />
              </span>
              <span className="text-sm font-extrabold uppercase tracking-wider text-[#252525] group-hover:text-[#C8B58D] transition">
                REVENUE COLLECTED
              </span>
            </div>
            <p className="text-3xl sm:text-4xl font-black text-[#252525] tracking-tight pt-1">
              INR ₹{totalCollected.toLocaleString()}
            </p>
            <p className="text-xs text-[#6F6D69] font-bold flex items-center gap-1">
              <span>₹{totalOutstanding.toLocaleString()} pending settlement &bull; Financial Ledger</span>
              <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </p>
          </div>

          <div className="shrink-0 text-right hidden sm:block">
            <span className="px-3.5 py-1.5 rounded-xl bg-[#EDE8DE] text-[#252525] font-extrabold text-xs border border-[#C8B58D]/30">
              Revenue Breakdown &rarr;
            </span>
          </div>
        </div>

      </div>

      {/* Clinician's Active Appointments & Direct Billing Hub */}
      {(currentUser.role === 'doctor' || currentUser.role === 'admin') && (
        <div className="bg-white/85 backdrop-blur-md border border-stone-200/80 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-stone-200/70">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#C8B58D]" />
              <h2 className="text-sm font-bold text-[#252525]">Clinical Appointments &amp; Billing Desk</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onNavigate('billing')}
                className="btn-primary text-xs cursor-pointer flex items-center gap-1.5 shadow-2xs py-1 px-3"
                title="Create Bill (from appointment or walk-in patient)"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Bill</span>
              </button>
              <span className="text-xs font-bold text-[#252525] bg-[#EDE8DE] px-2.5 py-0.5 rounded-full border border-[#C8B58D]/30">
                {appointments.length} Total Bookings
              </span>
              <button
                onClick={() => onNavigate('appointments')}
                className="text-xs font-bold text-[#C8B58D] hover:underline flex items-center gap-0.5 cursor-pointer"
              >
                <span>View All</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {appointments.length === 0 ? (
            <div className="text-center py-6 bg-stone-50/60 rounded-xl border border-dashed border-stone-200">
              <p className="text-xs text-[#6F6D69]">No clinical appointments currently scheduled.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-stone-200/80 text-[11px] font-extrabold uppercase text-[#6F6D69] tracking-wider">
                    <th className="pb-2.5 pr-3">Time / Date</th>
                    <th className="pb-2.5 px-3">Patient</th>
                    <th className="pb-2.5 px-3">Attending Doctor</th>
                    <th className="pb-2.5 px-3">Procedure</th>
                    <th className="pb-2.5 px-3 text-center">Status</th>
                    <th className="pb-2.5 pl-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {appointments.slice(0, 5).map(apt => {
                    const pt = patients.find(p => p.id === apt.patientId);
                    const existingInv = (invoices || []).find((inv: any) => inv.appointmentId === apt.id);
                    return (
                      <tr key={apt.id} className="hover:bg-stone-50/80 transition-colors group">
                        <td className="py-3 pr-3 font-semibold text-[#252525]">
                          <div>{apt.time || 'Scheduled'}</div>
                          <div className="text-[10px] text-[#6F6D69] font-normal">{apt.date}</div>
                        </td>
                        <td className="py-3 px-3">
                          <button
                            onClick={() => {
                              onSelectPatient(apt.patientId);
                              if (onNavigateToBilling) {
                                onNavigateToBilling(apt.patientId, apt.id);
                              } else {
                                onNavigate('chart');
                              }
                            }}
                            className="font-bold text-[#252525] group-hover:text-[#C8B58D] hover:underline text-left cursor-pointer flex items-center gap-1"
                          >
                            <span>{apt.patientName}</span>
                            <Receipt className="w-3 h-3 text-[#C8B58D] opacity-0 group-hover:opacity-100 transition-opacity" />
                          </button>
                          <div className="text-[10px] text-[#6F6D69] font-mono">
                            {pt?.code || apt.tokenNumber || 'PATIENT'}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-[#6F6D69]">
                          <div className="font-semibold text-[#252525]">{apt.doctorName}</div>
                          <div className="text-[10px]">{apt.chair}</div>
                        </td>
                        <td className="py-3 px-3 max-w-[200px] truncate text-[#252525] font-medium">
                          {apt.procedure}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                            apt.status === 'in_chair'
                              ? 'bg-sky-100 text-sky-800 border border-sky-200'
                              : apt.status === 'completed'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : apt.status === 'cancelled'
                              ? 'bg-rose-100 text-rose-800 border border-rose-200'
                              : 'bg-amber-100 text-amber-800 border border-amber-200'
                          }`}>
                            {apt.status === 'in_chair' ? 'In Chair' : apt.status === 'cancelled' ? 'Cancelled' : apt.status}
                          </span>
                        </td>
                        <td className="py-3 pl-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {existingInv ? (
                              <button
                                onClick={() => {
                                  onSelectPatient(apt.patientId);
                                  if (onNavigateToBilling) {
                                    onNavigateToBilling(apt.patientId, apt.id);
                                  } else {
                                    onNavigate('billing');
                                  }
                                }}
                                className="px-2 py-1 text-xs font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg transition cursor-pointer inline-flex items-center gap-1 shadow-2xs"
                                title={`Bill Created (${existingInv.invoiceNumber}) - Click to view/edit bill`}
                              >
                                <Receipt className="w-3 h-3 text-emerald-600" />
                                <span>Bill Created</span>
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  onSelectPatient(apt.patientId);
                                  if (onNavigateToBilling) {
                                    onNavigateToBilling(apt.patientId, apt.id);
                                  } else {
                                    onNavigate('billing');
                                  }
                                }}
                                className="px-2 py-1 text-xs font-bold bg-[#EDE8DE] hover:bg-[#C8B58D] text-[#252525] rounded-lg transition cursor-pointer inline-flex items-center gap-1 shadow-2xs"
                                title={`Create or open bill for appointment ${apt.id}`}
                              >
                                <Receipt className="w-3 h-3 text-[#252525]" />
                                <span>Create Bill</span>
                              </button>
                            )}

                            {apt.status !== 'cancelled' ? (
                              <button
                                onClick={() => handleCancelAppointment(apt.id)}
                                className="px-2 py-1 text-xs font-medium text-stone-500 hover:text-rose-600 hover:bg-rose-50 border border-stone-200 hover:border-rose-200 rounded-lg transition cursor-pointer inline-flex items-center gap-1"
                                title="Cancel appointment (keeps appointment in database)"
                              >
                                <XCircle className="w-3.5 h-3.5 text-stone-400 hover:text-rose-600" />
                                <span>Cancel</span>
                              </button>
                            ) : (
                              <button
                                onClick={() => setAppointmentToDelete(apt)}
                                className="px-2 py-1 text-xs font-bold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg transition cursor-pointer inline-flex items-center gap-1 shadow-2xs"
                                title="Permanently delete cancelled appointment and associated patient data"
                              >
                                <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                                <span>Delete</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Operatory Chairs Live Status */}
      <div className="bg-white/85 backdrop-blur-md border border-stone-200/80 rounded-2xl p-5 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#C8B58D]" />
            <h2 className="text-sm font-bold text-[#252525]">Operatory Dental Chairs</h2>
          </div>
          <span className="text-xs font-bold text-[#3B4D3A] bg-[#8FA88D]/20 px-2.5 py-0.5 rounded-full border border-[#8FA88D]/30">
            {appointments.filter(a => a.status === 'in_chair').length || 1} / 3 In Active Care
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Chair 1 */}
          {(() => {
            const chair1Apt = appointments.find(a => a.status === 'in_chair') || appointments[0];
            const chair1Pt = chair1Apt ? patients.find(p => p.id === chair1Apt.patientId) : undefined;
            return (
              <div
                onClick={() =>
                  setSelectedChairData({
                    chairId: 'chair-1',
                    chairName: 'Chair 1 - Endodontics',
                    doctorName: chair1Apt?.doctorName || 'Dr. Ananya Sharma',
                    appointment: chair1Apt,
                    patient: chair1Pt
                  })
                }
                className="border border-[#C8B58D]/30 bg-[#EDE8DE]/40 hover:bg-[#EDE8DE]/70 rounded-xl p-3.5 relative shadow-2xs cursor-pointer transition group"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-[#252525] group-hover:text-[#C8B58D] transition">Chair 1 - Endodontics</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#C8B58D] text-[#252525]">
                    {chair1Apt?.status === 'in_chair' ? 'In Chair' : 'Assigned'}
                  </span>
                </div>
                <p className="text-xs font-bold text-[#252525]">
                  {chair1Apt?.patientName || 'Aravind Kumar'} {chair1Pt?.code ? `(${chair1Pt.code})` : ''}
                </p>
                <p className="text-[11px] text-[#6F6D69]">
                  {chair1Apt?.doctorName || 'Dr. Ananya Sharma'} &bull; {chair1Apt?.procedure || 'Tooth RCT'}
                </p>
                <div className="mt-3 flex items-center justify-between text-[11px] text-[#6F6D69] border-t border-stone-200 pt-2">
                  <span>{chair1Apt?.tokenNumber || 'Token #D-101'}</span>
                  <span className="font-bold text-[#252525] group-hover:text-[#C8B58D] flex items-center gap-0.5 transition">
                    Inspect Operatory &rarr;
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Chair 2 */}
          {(() => {
            const chair1Apt = appointments.find(a => a.status === 'in_chair') || appointments[0];
            const chair2Apt = appointments.find(a => a.id !== chair1Apt?.id && a.status === 'confirmed') || appointments[1];
            const chair2Pt = chair2Apt ? patients.find(p => p.id === chair2Apt.patientId) : undefined;
            return (
              <div
                onClick={() =>
                  setSelectedChairData({
                    chairId: 'chair-2',
                    chairName: 'Chair 2 - Surgery',
                    doctorName: chair2Apt?.doctorName || 'Dr. Vikram Mehta',
                    appointment: chair2Apt,
                    patient: chair2Pt
                  })
                }
                className="border border-stone-200 bg-stone-50/70 hover:bg-stone-100 rounded-xl p-3.5 relative shadow-2xs cursor-pointer transition group"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-[#252525] group-hover:text-[#C8B58D] transition">Chair 2 - Surgery</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#C5A66A]/20 text-[#594723]">
                    {chair2Apt ? 'Next In Line' : 'Available'}
                  </span>
                </div>
                <p className="text-xs font-bold text-[#252525]">
                  {chair2Apt?.patientName || 'Medha Nair'} {chair2Pt?.code ? `(${chair2Pt.code})` : ''}
                </p>
                <p className="text-[11px] text-[#6F6D69]">
                  {chair2Apt?.doctorName || 'Dr. Vikram Mehta'} &bull; {chair2Apt?.procedure || 'Crown Revision'}
                </p>
                <div className="mt-3 flex items-center justify-between text-[11px] text-[#6F6D69] border-t border-stone-200 pt-2">
                  <span>{chair2Apt?.tokenNumber || 'Token #D-102'}</span>
                  <span className="font-bold text-[#252525] group-hover:text-[#C8B58D] flex items-center gap-0.5 transition">
                    Inspect Operatory &rarr;
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Chair 3 */}
          {(() => {
            const chair1Apt = appointments.find(a => a.status === 'in_chair') || appointments[0];
            const chair2Apt = appointments.find(a => a.id !== chair1Apt?.id && a.status === 'confirmed') || appointments[1];
            const chair3Apt = appointments.find(a => a.id !== chair1Apt?.id && a.id !== chair2Apt?.id) || appointments[2];
            const chair3Pt = chair3Apt ? patients.find(p => p.id === chair3Apt.patientId) : undefined;
            return (
              <div
                onClick={() =>
                  setSelectedChairData({
                    chairId: 'chair-3',
                    chairName: 'Chair 3 - Aesthetics & Hygiene',
                    doctorName: chair3Apt?.doctorName || 'Dr. Priya Sen',
                    appointment: chair3Apt,
                    patient: chair3Pt
                  })
                }
                className="border border-[#8FA88D]/30 bg-[#8FA88D]/10 hover:bg-[#8FA88D]/20 rounded-xl p-3.5 relative shadow-2xs cursor-pointer transition group"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-[#252525] group-hover:text-[#3B4D3A] transition">Chair 3 - Aesthetics</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#8FA88D]/20 text-[#3B4D3A]">
                    {chair3Apt ? 'In Preparation' : 'Sterilized / Ready'}
                  </span>
                </div>
                <p className="text-xs font-bold text-[#252525]">{chair3Apt?.patientName || 'Dr. Priya Sen'}</p>
                <p className="text-[11px] text-[#6F6D69]">{chair3Apt?.procedure || 'Ready for scaling & check-up'}</p>
                <div className="mt-3 flex items-center justify-between text-[11px] text-[#6F6D69] border-t border-[#8FA88D]/30 pt-2">
                  <span>{chair3Apt?.tokenNumber || 'Ready for patient'}</span>
                  <span className="font-bold text-[#3B4D3A] group-hover:underline flex items-center gap-0.5">
                    {chair3Apt ? 'Inspect Operatory &rarr;' : 'Assign Chair &rarr;'}
                  </span>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Operatory Chair Detail Modal */}
      <OperatoryChairModal
        isOpen={Boolean(selectedChairData)}
        onClose={() => setSelectedChairData(null)}
        chairData={selectedChairData}
        onSelectPatient={onSelectPatient}
        onNavigateToChart={() => onNavigate('chart')}
        onOpenNewAppointment={onOpenNewAppointment}
        onNavigateToBilling={onNavigateToBilling}
      />

      {/* Consolidated Today's Visits Modal */}
      <TodaysVisitsModal
        isOpen={isTodaysVisitsOpen}
        onClose={() => setIsTodaysVisitsOpen(false)}
        appointments={appointments}
        patients={patients}
        queue={queue}
        onSelectPatient={onSelectPatient}
        onNavigateToChart={() => onNavigate('chart')}
        onOpenNewAppointment={onOpenNewAppointment}
        onNavigateToBilling={onNavigateToBilling}
      />

      {/* Revenue Breakdown Modal */}
      <RevenueModal
        isOpen={isRevenueModalOpen}
        onClose={() => setIsRevenueModalOpen(false)}
        invoices={invoices}
        patients={patients}
        onSelectPatient={onSelectPatient}
        onNavigateToBilling={() => onNavigate('billing')}
      />

      {/* Delete Appointment Confirmation Dialog */}
      {appointmentToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-2xl w-full max-w-md p-6 space-y-4 text-[#252525]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">Delete Appointment?</h3>
                <p className="text-xs text-gray-500 font-mono">Patient: {appointmentToDelete.patientName}</p>
              </div>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed bg-rose-50/70 border border-rose-100 rounded-xl p-3">
              This will permanently delete this appointment and its associated patient data. This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setAppointmentToDelete(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100 rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-sm"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeleting ? 'Deleting...' : 'Delete'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
