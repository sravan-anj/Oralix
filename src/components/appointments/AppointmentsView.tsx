import React, { useState } from 'react';
import { Appointment, Patient, User, AppointmentStatus } from '../../types';
import { useToast } from '../common/Toast';
import { StorageService } from '../../utils/storage';
import {
  Calendar,
  Clock,
  Plus,
  Search,
  CheckCircle2,
  XCircle,
  Stethoscope,
  Filter,
  UserCheck,
  Sparkles,
  MapPin,
  AlertCircle,
  CalendarCheck,
  ChevronRight,
  Check,
  FileText,
  PhoneCall,
  Smile,
  ShieldCheck,
  Receipt,
  Trash2
} from 'lucide-react';

interface AppointmentsViewProps {
  currentUser: User;
  appointments: Appointment[];
  patients: Patient[];
  invoices?: any[];
  onSaveAppointments: (appointments: Appointment[]) => void;
  onDeleteAppointmentAndPatient?: (appointmentId: string, patientId: string) => Promise<void> | void;
  onSelectPatient: (patientId: string) => void;
  onNavigateToChart: () => void;
  onNavigateToBilling?: (patientId: string, appointmentId?: string) => void;
  isBookingModalOpen: boolean;
  setIsBookingModalOpen: (open: boolean) => void;
}

export const AppointmentsView: React.FC<AppointmentsViewProps> = ({
  currentUser,
  appointments,
  patients,
  invoices = [],
  onSaveAppointments,
  onDeleteAppointmentAndPatient,
  onSelectPatient,
  onNavigateToChart,
  onNavigateToBilling,
  isBookingModalOpen,
  setIsBookingModalOpen
}) => {
  const { showToast } = useToast();
  const isPatient = currentUser.role === 'patient';
  const currentPatient = isPatient
    ? patients.find(p => currentUser.patientId && p.id === currentUser.patientId) ||
      patients.find(p => currentUser.email && p.email?.toLowerCase() === currentUser.email.toLowerCase()) ||
      patients.find(p => currentUser.phone && p.phone === currentUser.phone) ||
      patients.find(p => p.name.toLowerCase() === currentUser.name.toLowerCase()) ||
      patients[0]
    : null;

  const [patientSubTab, setPatientSubTab] = useState<'upcoming' | 'history'>('upcoming');
  const [filterDoctor, setFilterDoctor] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [appointmentToDelete, setAppointmentToDelete] = useState<Appointment | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const filteredAppointments = appointments.filter(apt => {
    if (filterDoctor !== 'all' && apt.doctorName !== filterDoctor) return false;
    if (filterStatus !== 'all' && apt.status !== filterStatus) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        apt.patientName.toLowerCase().includes(q) ||
        apt.procedure.toLowerCase().includes(q) ||
        apt.chair.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleUpdateStatus = (id: string, newStatus: AppointmentStatus) => {
    const updated = appointments.map(a =>
      a.id === id ? { ...a, status: newStatus } : a
    );
    onSaveAppointments(updated);
    showToast(`Appointment status updated to ${newStatus.replace('_', ' ')}`, 'success');
  };

  const patientAppointments = appointments.filter(
    a =>
      (currentPatient && a.patientId === currentPatient.id) ||
      (currentUser.email && a.patientEmail?.toLowerCase() === currentUser.email.toLowerCase()) ||
      (currentUser.name && a.patientName.toLowerCase() === currentUser.name.toLowerCase()) ||
      (currentPatient && a.patientName.toLowerCase() === currentPatient.name.toLowerCase())
  );
  const upcomingPatientApts = patientAppointments.filter(
    a => a.status !== 'completed' && a.status !== 'cancelled'
  );
  const historyPatientApts = patientAppointments.filter(
    a => a.status === 'completed' || a.status === 'cancelled'
  );

  const handleAddToCalendar = (apt: Appointment) => {
    showToast(`Event "${apt.procedure}" exported to your calendar`, 'success');
  };

  const handleRequestReschedule = (apt: Appointment) => {
    showToast(`Reschedule requested for ${apt.time}. Clinic reception will call you within 15 mins.`, 'info');
  };

  // -------------------------------------------------------------
  // PATIENT VIEW: Dedicated, Level 10 Patient Appointments Portal
  // -------------------------------------------------------------
  if (isPatient && currentPatient) {
    return (
      <div className="space-y-6">
        {/* Top Header Banner matching Main UI */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-stone-200/80">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#EDE8DE] text-[#252525] text-[10px] font-extrabold uppercase tracking-wider mb-1.5 border border-[#C8B58D]/30 shadow-2xs">
              <Sparkles className="w-3 h-3 text-[#C8B58D]" />
              <span>Patient Care Schedule &bull; Record {currentPatient.code}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-[#252525] tracking-tight">
              My Appointments &amp; Visits
            </h1>
            <p className="text-xs text-[#6F6D69]">
              Review upcoming clinical appointments, chair allocations, visit history, and preparation instructions.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setIsBookingModalOpen(true)}
              className="btn-primary text-xs cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Book Appointment</span>
            </button>
            <button
              onClick={onNavigateToChart}
              className="btn-secondary text-xs cursor-pointer flex items-center gap-1.5"
            >
              <Stethoscope className="w-3.5 h-3.5 text-[#C8B58D]" />
              <span>Odontogram</span>
            </button>
          </div>
        </div>

        {/* 4 Patient KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white/85 backdrop-blur-md border border-stone-200/80 rounded-2xl p-4 shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-[#6F6D69]">Upcoming Visits</span>
              <span className="p-2 rounded-xl bg-[#EDE8DE] text-[#252525]">
                <CalendarCheck className="w-4 h-4 text-[#C8B58D]" />
              </span>
            </div>
            <p className="text-2xl font-black text-[#252525]">{upcomingPatientApts.length}</p>
            <p className="text-[11px] text-[#6F6D69] font-semibold mt-1">
              {upcomingPatientApts[0] ? `Next: ${upcomingPatientApts[0].date} at ${upcomingPatientApts[0].time}` : 'No upcoming visits'}
            </p>
          </div>

          <div className="bg-white/85 backdrop-blur-md border border-stone-200/80 rounded-2xl p-4 shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-[#6F6D69]">Primary Clinician</span>
              <span className="p-2 rounded-xl bg-[#EDE8DE] text-[#252525]">
                <Stethoscope className="w-4 h-4 text-[#C8B58D]" />
              </span>
            </div>
            <p className="text-lg font-black text-[#252525]">Dr. Ananya Sharma</p>
            <p className="text-[11px] text-[#6F6D69] font-semibold mt-1">Endodontics &amp; Restorative</p>
          </div>

          <div className="bg-white/85 backdrop-blur-md border border-stone-200/80 rounded-2xl p-4 shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-[#6F6D69]">Completed Visits</span>
              <span className="p-2 rounded-xl bg-[#8FA88D]/20 text-[#3B4D3A]">
                <CheckCircle2 className="w-4 h-4 text-[#8FA88D]" />
              </span>
            </div>
            <p className="text-2xl font-black text-[#252525]">{historyPatientApts.length}</p>
            <p className="text-[11px] text-[#3B4D3A] font-semibold mt-1">Clinical records archived</p>
          </div>

          <div className="bg-white/85 backdrop-blur-md border border-stone-200/80 rounded-2xl p-4 shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-[#6F6D69]">Assigned Operatory</span>
              <span className="p-2 rounded-xl bg-[#C5A66A]/20 text-[#594723]">
                <MapPin className="w-4 h-4 text-[#C5A66A]" />
              </span>
            </div>
            <p className="text-lg font-black text-[#252525]">Chair 1 &bull; Suite 101</p>
            <p className="text-[11px] text-[#594723] font-semibold mt-1">Equipped with 3D Scanner</p>
          </div>
        </div>

        {/* Sub-tabs: Upcoming vs History */}
        <div className="flex items-center gap-2 border-b border-stone-200 pb-2">
          <button
            onClick={() => setPatientSubTab('upcoming')}
            className={`px-4 py-2 text-xs font-bold rounded-xl transition cursor-pointer flex items-center gap-2 ${
              patientSubTab === 'upcoming'
                ? 'btn-primary text-[#252525] shadow-xs'
                : 'btn-secondary text-[#252525]'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Upcoming Visits ({upcomingPatientApts.length})</span>
          </button>
          <button
            onClick={() => setPatientSubTab('history')}
            className={`px-4 py-2 text-xs font-bold rounded-xl transition cursor-pointer flex items-center gap-2 ${
              patientSubTab === 'history'
                ? 'btn-primary text-[#252525] shadow-xs'
                : 'btn-secondary text-[#252525]'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Past Completed Visits ({historyPatientApts.length})</span>
          </button>
        </div>

        {/* Appointments List */}
        <div className="space-y-4">
          {(patientSubTab === 'upcoming' ? upcomingPatientApts : historyPatientApts).length === 0 ? (
            <div className="bg-white/85 backdrop-blur-md border border-stone-200/80 rounded-2xl p-8 text-center shadow-xs">
              <div className="w-12 h-12 rounded-2xl bg-[#EDE8DE] text-[#252525] flex items-center justify-center mx-auto mb-3 border border-[#C8B58D]/30">
                <Calendar className="w-6 h-6 text-[#C8B58D]" />
              </div>
              <h3 className="text-sm font-bold text-[#252525]">
                {patientSubTab === 'upcoming' ? 'No Upcoming Visits Scheduled' : 'No Past Visits on Record'}
              </h3>
              <p className="text-xs text-[#6F6D69] mt-1 max-w-sm mx-auto">
                {patientSubTab === 'upcoming'
                  ? 'Would you like to book your next routine checkup, scale & polish, or treatment follow-up?'
                  : 'Completed appointment records will appear here after clinical treatment.'}
              </p>
              {patientSubTab === 'upcoming' && (
                <button
                  onClick={() => setIsBookingModalOpen(true)}
                  className="mt-4 btn-primary text-xs cursor-pointer inline-flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Book Appointment Now</span>
                </button>
              )}
            </div>
          ) : (
            (patientSubTab === 'upcoming' ? upcomingPatientApts : historyPatientApts).map(apt => (
              <div
                key={apt.id}
                className="bg-white/85 backdrop-blur-md border border-stone-200/80 rounded-2xl p-5 shadow-xs transition hover:border-[#C8B58D]"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full bg-[#EDE8DE] text-[#252525] text-[10px] font-extrabold uppercase tracking-wider border border-[#C8B58D]/30">
                        {apt.chair}
                      </span>
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                        apt.status === 'in_chair'
                          ? 'bg-blue-100 text-blue-800 border border-blue-200 animate-pulse'
                          : apt.status === 'completed'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          : apt.status === 'cancelled'
                          ? 'bg-rose-100 text-rose-800 border border-rose-200'
                          : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      }`}>
                        {apt.status === 'in_chair' ? 'Currently In Chair' : apt.status.toUpperCase()}
                      </span>
                      <span className="text-xs font-mono font-bold text-slate-500">
                        Token: {apt.tokenNumber || '#D-342'}
                      </span>
                    </div>

                    <h3 className="text-base font-extrabold text-slate-900">
                      {apt.procedure}
                    </h3>

                    <p className="text-xs text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="flex items-center gap-1 font-semibold text-slate-900">
                        <Clock className="w-3.5 h-3.5 text-sky-600" />
                        <span>{apt.date} at {apt.time} ({apt.durationMinutes || 45} mins)</span>
                      </span>
                      <span>&bull;</span>
                      <span className="flex items-center gap-1">
                        <Stethoscope className="w-3.5 h-3.5 text-purple-600" />
                        <span>{apt.doctorName}</span>
                      </span>
                    </p>

                    <div className="p-3 bg-slate-50/90 rounded-xl border border-slate-200/80 text-xs text-slate-600">
                      <strong className="text-slate-800">Preparation &amp; Care Guidance: </strong>
                      {apt.notes || 'Please arrive 10 minutes prior to your time. Operatory has been sterilized with medical-grade autoclave. Bring any list of ongoing medications.'}
                    </div>
                  </div>

                  <div className="flex flex-row md:flex-col gap-2 shrink-0">
                    <button
                      onClick={() => handleAddToCalendar(apt)}
                      className="flex-1 md:flex-none px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-bold transition shadow-2xs cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Calendar className="w-3.5 h-3.5 text-sky-600" />
                      <span>Add to Calendar</span>
                    </button>
                    {apt.status !== 'completed' && (
                      <button
                        onClick={() => handleRequestReschedule(apt)}
                        className="flex-1 md:flex-none px-3.5 py-2 bg-slate-100/80 hover:bg-slate-200/70 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <Clock className="w-3.5 h-3.5 text-slate-500" />
                        <span>Reschedule</span>
                      </button>
                    )}
                    <button
                      onClick={onNavigateToChart}
                      className="flex-1 md:flex-none px-3.5 py-2 bg-sky-50 hover:bg-sky-100 text-sky-800 rounded-xl text-xs font-bold transition border border-sky-200 cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Stethoscope className="w-3.5 h-3.5 text-sky-600" />
                      <span>Odontogram</span>
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Preparation Guidelines Card */}
        <div className="bg-gradient-to-r from-sky-50 to-blue-50/60 border border-sky-200/80 rounded-2xl p-5 shadow-xs text-xs text-slate-700">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-sky-100 text-sky-700 shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-sky-950 text-sm">Oralix Clinical Standards &amp; Safety Protocol</h4>
              <p className="mt-1 leading-relaxed text-slate-600">
                All operatory chairs undergo ISO-certified surgical sterilization between patient sittings. If you experience unexpected tooth pain, cold sensitivity, or swelling prior to your appointment, please contact the clinic reception immediately at <span className="font-bold text-sky-900">+91 98765 43210</span>.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-200">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600">
            SCHEDULE &bull; OPERATORY QUEUE
          </span>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
            Appointments
          </h1>
          <p className="text-xs text-gray-500">
            Coordinate every chair, clinician, and patient seamlessly.
          </p>
        </div>

        {currentUser.role !== 'admin' && currentUser.role !== 'doctor' && (
          <button
            onClick={() => setIsBookingModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-semibold shadow-2xs transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Appointment</span>
          </button>
        )}
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-3.5 shadow-2xs">
          <div className="text-xs font-semibold text-gray-500">Total Visits Scheduled</div>
          <p className="text-2xl font-bold text-gray-900 mt-1">{appointments.length}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3.5 shadow-2xs">
          <div className="text-xs font-semibold text-gray-500">In Chair / In Progress</div>
          <p className="text-2xl font-bold text-blue-600 mt-1">
            {appointments.filter(a => a.status === 'in_chair').length}
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3.5 shadow-2xs">
          <div className="text-xs font-semibold text-gray-500">Confirmed</div>
          <p className="text-2xl font-bold text-amber-600 mt-1">
            {appointments.filter(a => a.status === 'confirmed').length}
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3.5 shadow-2xs">
          <div className="text-xs font-semibold text-gray-500">Completed Today</div>
          <p className="text-2xl font-bold text-emerald-600 mt-1">
            {appointments.filter(a => a.status === 'completed').length}
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search patient, procedure, chair..."
            className="w-full text-xs bg-transparent focus:outline-none text-gray-800"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <Filter className="w-3.5 h-3.5 text-gray-400" />
            <select
              value={filterDoctor}
              onChange={e => setFilterDoctor(e.target.value)}
              className="px-2 py-1 text-xs border border-gray-200 rounded bg-gray-50 text-gray-700"
            >
              <option value="all">All Doctors</option>
              <option value="Dr. Ananya Sharma">Dr. Ananya Sharma</option>
              <option value="Dr. Vikram Mehta">Dr. Vikram Mehta</option>
              <option value="Dr. Priya Sen">Dr. Priya Sen</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="px-2 py-1 text-xs border border-gray-200 rounded bg-gray-50 text-gray-700"
            >
              <option value="all">All Statuses</option>
              <option value="confirmed">Confirmed</option>
              <option value="in_chair">In Chair</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
      </div>

      {/* Appointments List / Table */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50/75 border-b border-gray-200 text-gray-500 font-semibold">
              <tr>
                <th className="py-3 px-4">Time &amp; Token</th>
                <th className="py-3 px-4">Patient</th>
                <th className="py-3 px-4">Doctor &amp; Operatory Chair</th>
                <th className="py-3 px-4">Procedure</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredAppointments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-400">
                    No appointments matching the selected filters.
                  </td>
                </tr>
              ) : (
                filteredAppointments.map(apt => (
                  <tr key={apt.id} className="hover:bg-gray-50/80 transition">
                    <td className="py-3 px-4">
                      <div className="font-bold text-gray-900">{apt.time}</div>
                      <div className="text-[10px] text-gray-400 font-medium">
                        {apt.tokenNumber || '#D-000'} &bull; {apt.date}
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <button
                        onClick={() => {
                          onSelectPatient(apt.patientId);
                          if (onNavigateToBilling) {
                            onNavigateToBilling(apt.patientId, apt.id);
                          } else {
                            onNavigateToChart();
                          }
                        }}
                        className="font-bold text-blue-600 hover:text-blue-800 hover:underline text-left cursor-pointer inline-flex items-center gap-1 group"
                        title={`Click to open ${apt.patientName}'s bill in Billing`}
                      >
                        <span>{apt.patientName}</span>
                        <Receipt className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 transition-opacity text-blue-500" />
                      </button>
                      <div className="text-[10px] text-gray-400">
                        {apt.durationMinutes} mins allocated &bull; Click name to view bill
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-semibold text-gray-800">{apt.doctorName}</div>
                      <div className="text-[10px] text-gray-500">{apt.chair}</div>
                    </td>

                    <td className="py-3 px-4 max-w-[220px]">
                      <div className="font-medium text-gray-900 truncate">
                        {apt.procedure}
                      </div>
                      {apt.notes && (
                        <div className="text-[10px] text-gray-400 truncate">
                          {apt.notes}
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-[10px] font-bold ${
                        apt.status === 'in_chair'
                          ? 'bg-blue-100 text-blue-800 border border-blue-200'
                          : apt.status === 'completed'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          : apt.status === 'cancelled'
                          ? 'bg-rose-100 text-rose-800 border border-rose-200'
                          : 'bg-amber-100 text-amber-800 border border-amber-200'
                      }`}>
                        {apt.status === 'in_chair' ? 'In Chair Now' : apt.status}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-right">
                      {(() => {
                        const existingInv = (invoices || []).find((inv: any) => inv.appointmentId === apt.id);
                        return (
                          <div className="flex items-center justify-end gap-1.5">
                            {existingInv ? (
                              <button
                                onClick={() => {
                                  onSelectPatient(apt.patientId);
                                  if (onNavigateToBilling) {
                                    onNavigateToBilling(apt.patientId, apt.id);
                                  } else {
                                    onNavigateToChart();
                                  }
                                }}
                                className="px-2 py-1 text-[11px] font-bold bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200 rounded transition cursor-pointer flex items-center gap-1"
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
                                    onNavigateToChart();
                                  }
                                }}
                                className="px-2 py-1 text-[11px] font-semibold bg-stone-100 text-stone-700 hover:bg-[#EDE8DE] hover:text-[#252525] rounded transition cursor-pointer flex items-center gap-1"
                                title={`Create Bill for ${apt.patientName}`}
                              >
                                <Receipt className="w-3 h-3 text-[#C8B58D]" />
                                <span>Create Bill</span>
                              </button>
                            )}

                            {apt.status !== 'in_chair' && apt.status !== 'completed' && apt.status !== 'cancelled' && (
                              <button
                                onClick={() => handleUpdateStatus(apt.id, 'in_chair')}
                                className="px-2 py-1 text-[11px] font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 rounded transition cursor-pointer"
                              >
                                To Chair
                              </button>
                            )}

                            {apt.status !== 'completed' && apt.status !== 'cancelled' && (
                              <button
                                onClick={() => handleUpdateStatus(apt.id, 'completed')}
                                className="px-2 py-1 text-[11px] font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded transition cursor-pointer"
                              >
                                Complete
                              </button>
                            )}

                            {apt.status !== 'cancelled' ? (
                              <button
                                onClick={() => handleUpdateStatus(apt.id, 'cancelled')}
                                className="p-1 text-gray-400 hover:text-rose-600 rounded transition cursor-pointer"
                                title="Cancel appointment"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() => setAppointmentToDelete(apt)}
                                className="px-2 py-1 text-[11px] font-bold bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 rounded transition cursor-pointer flex items-center gap-1"
                                title="Permanently delete cancelled appointment and patient data"
                              >
                                <Trash2 className="w-3 h-3 text-rose-600" />
                                <span>Delete</span>
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

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
                onClick={async () => {
                  if (!appointmentToDelete) return;
                  setIsDeleting(true);
                  try {
                    if (onDeleteAppointmentAndPatient) {
                      await onDeleteAppointmentAndPatient(appointmentToDelete.id, appointmentToDelete.patientId);
                    } else {
                      await StorageService.deleteAppointmentAndPatient(appointmentToDelete.id, appointmentToDelete.patientId);
                      onSaveAppointments(appointments.filter(a => a.id !== appointmentToDelete.id));
                    }
                    setAppointmentToDelete(null);
                  } catch (err: any) {
                    showToast(err?.message || 'Failed to delete appointment', 'error');
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                className="px-4 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-sm disabled:opacity-50"
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
