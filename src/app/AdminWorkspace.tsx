import { useEffect, useState, type FormEvent } from 'react';
import {
  Activity,
  BookOpen,
  CalendarCheck2,
  CalendarDays,
  CheckCheck,
  ClipboardList,
  FileBadge2,
  LayoutDashboard,
  LogOut,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';
import AssessmentSetupPanel from './AssessmentSetupPanel';
import AcademicConfigurationPanel from './AcademicConfigurationPanel';
import AuditLogPanel from './AuditLogPanel';
import GradingScalePanel from './GradingScalePanel';
import ParentProvisionPanel from './ParentProvisionPanel';
import ReportHistoryPanel from './ReportHistoryPanel';
import ResultsImportPanel from './ResultsImportPanel';
import SchoolSettingsPanel from './SchoolSettingsPanel';
import SchoolUpdatesPanel from './SchoolUpdatesPanel';
import StudentBulkImportPanel from './StudentBulkImportPanel';
import StudentDirectoryPanel from './StudentDirectoryPanel';
import StudentLifecyclePanel from './StudentLifecyclePanel';
import TestimonialAdminPanel from './TestimonialAdminPanel';
import TimetablePanel from './TimetablePanel';
import { markUnmarkedAttendancePresent, type AttendanceStatus } from '../domain/attendance';
import { calculateAttendancePresentDays } from '../domain/attendanceBaseline';
import { supabase } from '../lib/supabase';

type AcademicSession = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  is_active: boolean;
};

type SchoolClass = {
  id: string;
  name: string;
  display_order: number;
};

type AcademicTerm = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
};

type AdminSection =
  | 'overview'
  | 'students'
  | 'attendance'
  | 'academics'
  | 'results'
  | 'school-day'
  | 'testimonials'
  | 'administration';
type AttendanceRow = {
  student_id: string;
  enrollment_id: string;
  serial: string;
  full_name: string;
  attendance_status: AttendanceStatus | null;
};
type IssuedStudentCredential = { loginId: string; temporaryPassword: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseSessions(value: unknown): AcademicSession[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is AcademicSession => isRecord(row)
    && typeof row.id === 'string'
    && typeof row.name === 'string'
    && typeof row.starts_on === 'string'
    && typeof row.ends_on === 'string'
    && typeof row.is_active === 'boolean');
}

function parseClasses(value: unknown): SchoolClass[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is SchoolClass => isRecord(row)
    && typeof row.id === 'string'
    && typeof row.name === 'string'
    && typeof row.display_order === 'number');
}

function parseTerms(value: unknown): AcademicTerm[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is AcademicTerm => isRecord(row)
    && typeof row.id === 'string'
    && typeof row.name === 'string'
    && typeof row.starts_on === 'string'
    && typeof row.ends_on === 'string');
}

function parseAttendanceRows(value: unknown): AttendanceRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: AttendanceRow[] = [];
  for (const row of value) {
    if (!isRecord(row)
      || typeof row.student_id !== 'string'
      || typeof row.enrollment_id !== 'string'
      || typeof row.serial !== 'string'
      || typeof row.full_name !== 'string'
      || (row.attendance_status !== null
        && row.attendance_status !== 'present'
        && row.attendance_status !== 'absent')) {
      return null;
    }
    rows.push({
      student_id: row.student_id,
      enrollment_id: row.enrollment_id,
      serial: row.serial,
      full_name: row.full_name,
      attendance_status: row.attendance_status,
    });
  }
  return rows;
}

function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function nextLocalDateString(dateString: string): string {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + 1);
  return localDateString(date);
}

export default function AdminWorkspace({
  onSignOut,
  notice,
}: {
  onSignOut: () => void;
  notice: string;
}) {
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [terms, setTerms] = useState<AcademicTerm[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [classId, setClassId] = useState('');
  const [termId, setTermId] = useState('');
  const [attendanceDate, setAttendanceDate] = useState(() => localDateString(new Date()));
  const [baselineCutoffDate, setBaselineCutoffDate] = useState('');
  const [baselineValues, setBaselineValues] = useState<Record<string, string>>({});
  const [baselineReason, setBaselineReason] = useState('Historical attendance totals entered from school records');
  const [savedBaselineCutoffDate, setSavedBaselineCutoffDate] = useState('');
  const [isLoadingBaseline, setIsLoadingBaseline] = useState(false);
  const [isSavingBaseline, setIsSavingBaseline] = useState(false);
  const [baselineError, setBaselineError] = useState('');
  const [baselineMessage, setBaselineMessage] = useState('');
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [correctionReason, setCorrectionReason] = useState('');
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [isLoadingRegister, setIsLoadingRegister] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [optionsRefreshKey, setOptionsRefreshKey] = useState(0);
  const [termsRefreshKey, setTermsRefreshKey] = useState(0);
  const [studentOptionsRefreshKey, setStudentOptionsRefreshKey] = useState(0);
  const [isBulkProvisioning, setIsBulkProvisioning] = useState(false);
  const [activeSection, setActiveSection] = useState<AdminSection>('overview');
  const [activeLearnerCount, setActiveLearnerCount] = useState<number | null>(null);
  const [overviewError, setOverviewError] = useState('');
  const [attendanceSummary, setAttendanceSummary] = useState<{ present: number; absent: number } | null>(null);
  const [attendanceSummaryError, setAttendanceSummaryError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentGender, setStudentGender] = useState<'female' | 'male' | 'undisclosed' | ''>('');
  const [isProvisioningStudent, setIsProvisioningStudent] = useState(false);
  const [provisionError, setProvisionError] = useState('');
  const [issuedCredential, setIssuedCredential] = useState<IssuedStudentCredential | null>(null);
  const [resetLoginId, setResetLoginId] = useState('');
  const [resetReason, setResetReason] = useState('');
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [resetError, setResetError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadLearnerCount() {
      if (!supabase) {
        setOverviewError('Dashboard totals are unavailable because the school database is not configured.');
        return;
      }
      const { count, error } = await supabase
        .from('students')
        .select('id', { count: 'exact', head: true })
        .eq('active', true);
      if (cancelled) return;
      if (error || count === null) {
        setOverviewError('Active learner totals could not be loaded. Refresh the page or contact the system administrator.');
        return;
      }
      setActiveLearnerCount(count);
      setOverviewError('');
    }
    void loadLearnerCount();
    return () => {
      cancelled = true;
    };
  }, [studentOptionsRefreshKey]);

  useEffect(() => {
    let cancelled = false;
    async function loadAttendanceSummary() {
      if (!supabase || !sessionId || !classId || !termId) {
        setAttendanceSummary(null);
        setAttendanceSummaryError('');
        return;
      }
      const client = supabase;
      const filters = (status: AttendanceStatus) => client
        .from('attendance_records')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sessionId)
        .eq('class_id', classId)
        .eq('term_id', termId)
        .eq('status', status);
      const [presentResult, absentResult] = await Promise.all([
        filters('present'),
        filters('absent'),
      ]);
      if (cancelled) return;
      if (presentResult.error || absentResult.error
        || presentResult.count === null || absentResult.count === null) {
        setAttendanceSummaryError('Attendance totals could not be loaded for the selected class and term.');
        setAttendanceSummary(null);
        return;
      }
      setAttendanceSummary({ present: presentResult.count, absent: absentResult.count });
      setAttendanceSummaryError('');
    }
    void loadAttendanceSummary().catch(() => {
      if (!cancelled) {
        setAttendanceSummaryError('Attendance totals could not be loaded. Check your connection and try again.');
        setAttendanceSummary(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, classId, termId, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    async function loadOptions() {
      if (!supabase) {
        setLoadError('School database is not configured.');
        setIsLoadingOptions(false);
        return;
      }
      setIsLoadingOptions(true);
      setLoadError('');
      try {
        const [sessionResult, classResult] = await Promise.all([
          supabase
            .from('academic_sessions')
            .select('id,name,starts_on,ends_on,is_active')
            .order('starts_on', { ascending: false }),
          supabase
            .from('classes')
            .select('id,name,display_order')
            .eq('active', true)
            .order('display_order'),
        ]);
        if (cancelled) return;
        if (sessionResult.error || classResult.error) {
          setLoadError('Academic sessions or classes could not be loaded. Please refresh or contact the school.');
        } else {
          const availableSessions = parseSessions(sessionResult.data);
          const availableClasses = parseClasses(classResult.data);
          setSessions(availableSessions);
          setClasses(availableClasses);
          setSessionId((current) => current || availableSessions.find((session) => session.is_active)?.id || '');
          setClassId((current) => current || availableClasses[0]?.id || '');
        }
      } catch {
        if (!cancelled) {
          setLoadError('Academic sessions or classes could not be loaded. Please refresh or contact the school.');
        }
      } finally {
        if (!cancelled) setIsLoadingOptions(false);
      }
    }
    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, [optionsRefreshKey]);

  useEffect(() => {
    let cancelled = false;
    async function loadTerms() {
      if (!supabase || !sessionId) {
        setTerms([]);
        setTermId('');
        return;
      }
      setLoadError('');
      try {
        const { data, error } = await supabase
          .from('academic_terms')
          .select('id,name,starts_on,ends_on')
          .eq('session_id', sessionId)
          .order('starts_on');
        if (cancelled) return;
        if (error) {
          setLoadError('Academic terms could not be loaded. Please refresh or contact the school.');
          setTerms([]);
          setTermId('');
          return;
        }
        const availableTerms = parseTerms(data);
        setTerms(availableTerms);
        setTermId((current) => availableTerms.some((term) => term.id === current)
          ? current
          : availableTerms.find((term) => {
            const today = localDateString(new Date());
            return term.starts_on <= today && term.ends_on >= today;
          })?.id ?? availableTerms[0]?.id ?? '');
      } catch {
        if (!cancelled) {
          setLoadError('Academic terms could not be loaded. Please refresh or contact the school.');
          setTerms([]);
          setTermId('');
        }
      }
    }
    void loadTerms();
    return () => {
      cancelled = true;
    };
  }, [sessionId, termsRefreshKey]);

  useEffect(() => {
    let cancelled = false;
    async function loadRegister() {
      if (!supabase || !sessionId || !classId || !termId || !attendanceDate) {
        setRows([]);
        setIsLoadingRegister(false);
        return;
      }
      setIsLoadingRegister(true);
      setLoadError('');
      try {
        const { data, error } = await supabase.rpc('class_attendance_register', {
          p_class_id: classId,
          p_session_id: sessionId,
          p_term_id: termId,
          p_attendance_date: attendanceDate,
        });
        if (cancelled) return;
        if (error) {
          setRows([]);
          setLoadError('The attendance register could not be loaded for this selection.');
        } else {
          const parsedRows = parseAttendanceRows(data);
          if (parsedRows === null) {
            setRows([]);
            setLoadError('The attendance register returned an unexpected response.');
          } else {
            setRows(parsedRows);
          }
        }
      } catch {
        if (!cancelled) {
          setRows([]);
          setLoadError('The attendance register could not be loaded for this selection.');
        }
      } finally {
        if (!cancelled) setIsLoadingRegister(false);
      }
    }
    void loadRegister();
    return () => {
      cancelled = true;
    };
  }, [attendanceDate, classId, refreshKey, sessionId, termId]);

  const selectedTerm = terms.find((term) => term.id === termId);
  const selectedTermStartsOn = selectedTerm?.starts_on;
  const selectedTermEndsOn = selectedTerm?.ends_on;
  const selectedSession = sessions.find((session) => session.id === sessionId);
  const learnerRosterKey = rows.map((row) => row.enrollment_id).join('|');

  useEffect(() => {
    setSavedBaselineCutoffDate('');
    setBaselineValues({});
    setBaselineError('');
    setBaselineMessage('');
  }, [classId, sessionId, termId]);

  useEffect(() => {
    if (!selectedTermStartsOn || !selectedTermEndsOn || !termId) return;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const cutoff = [localDateString(yesterday), selectedTermEndsOn].sort()[0];
    setBaselineCutoffDate(cutoff < selectedTermStartsOn ? selectedTermStartsOn : cutoff);
    setSavedBaselineCutoffDate('');
    setBaselineValues({});
    setBaselineError('');
    setBaselineMessage('');
  }, [termId, selectedTermStartsOn, selectedTermEndsOn]);

  useEffect(() => {
    let cancelled = false;
    async function loadBaseline() {
      const rosterIds = learnerRosterKey ? learnerRosterKey.split('|') : [];
      if (!supabase || !classId || !sessionId || !termId || !baselineCutoffDate || rosterIds.length === 0) {
        setBaselineValues({});
        setIsLoadingBaseline(false);
        return;
      }
      setIsLoadingBaseline(true);
      setBaselineError('');
      try {
        const baselineResult = await supabase.from('attendance_baselines')
          .select('enrollment_id,cutoff_date')
          .eq('term_id', termId)
          .in('enrollment_id', rosterIds);
        if (cancelled) return;
        if (baselineResult.error) {
          setBaselineError('Saved historical attendance totals could not be loaded.');
          return;
        }
        const existingBaselines = (baselineResult.data ?? []).filter((item) => (
          typeof item.enrollment_id === 'string'
          && typeof item.cutoff_date === 'string'
        ));
        const latestCutoff = existingBaselines.reduce(
          (latest, item) => item.cutoff_date > latest ? item.cutoff_date : latest,
          '',
        );
        setSavedBaselineCutoffDate(latestCutoff);
        if (latestCutoff && baselineCutoffDate < latestCutoff) {
          setBaselineCutoffDate(latestCutoff);
          return;
        }

        const { data, error } = await supabase.rpc('class_attendance_baseline_register', {
          p_class_id: classId,
          p_session_id: sessionId,
          p_term_id: termId,
          p_cutoff_date: baselineCutoffDate,
        });
        if (cancelled) return;
        if (error || !Array.isArray(data)) {
          setBaselineError('Historical attendance totals could not be prepared for this class.');
          return;
        }
        const values: Record<string, string> = {};
        for (const item of data) {
          if (!isRecord(item)
            || typeof item.enrollment_id !== 'string'
            || typeof item.baseline_days_present !== 'number'
            || typeof item.present_since_baseline !== 'number') {
            setBaselineError('Historical attendance totals returned an unexpected response.');
            return;
          }
          values[item.enrollment_id] = String(calculateAttendancePresentDays(
            item.baseline_days_present,
            item.present_since_baseline,
          ));
        }
        if (rosterIds.some((id) => values[id] === undefined)) {
          setBaselineError('Historical attendance totals could not be matched to every active learner.');
          return;
        }
        setBaselineValues(values);
      } catch {
        if (!cancelled) setBaselineError('Historical attendance totals could not be prepared. Check your connection and try again.');
      } finally {
        if (!cancelled) setIsLoadingBaseline(false);
      }
    }
    void loadBaseline();
    return () => {
      cancelled = true;
    };
  }, [baselineCutoffDate, classId, learnerRosterKey, refreshKey, sessionId, termId]);

  const dateIsInTerm = Boolean(selectedTerm
    && attendanceDate >= selectedTerm.starts_on
    && attendanceDate <= selectedTerm.ends_on
    && attendanceDate <= localDateString(new Date()));
  const attendanceDateIsAllowed = dateIsInTerm
    && (!savedBaselineCutoffDate || attendanceDate > savedBaselineCutoffDate);
  const dailyAttendanceCanBeSaved = attendanceDateIsAllowed && !isLoadingBaseline;
  const allStudentsMarked = rows.length > 0
    && rows.every((row) => row.attendance_status !== null);
  const unmarkedStudentCount = rows.filter((row) => row.attendance_status === null).length;
  const baselineValuesAreValid = rows.length > 0 && rows.every((row) => {
    const value = baselineValues[row.enrollment_id];
    return value !== undefined && /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
  });
  const baselineDateIsInTerm = Boolean(selectedTerm
    && baselineCutoffDate >= selectedTerm.starts_on
    && baselineCutoffDate <= selectedTerm.ends_on
    && baselineCutoffDate <= localDateString(new Date()));

  function updateAttendance(studentId: string, status: AttendanceStatus) {
    setRows((currentRows) => currentRows.map((row) => row.student_id === studentId
      ? { ...row, attendance_status: status }
      : row));
    setStatusMessage('');
    setSaveError('');
  }

  function markRemainingPresent() {
    if (isLoadingRegister || !dailyAttendanceCanBeSaved || unmarkedStudentCount === 0) return;
    setRows(markUnmarkedAttendancePresent);
    setStatusMessage(
      `${unmarkedStudentCount} unmarked learner${unmarkedStudentCount === 1 ? '' : 's'} set to present. Review the register and save when ready.`,
    );
    setSaveError('');
  }

  async function saveRegister() {
    if (!supabase || !allStudentsMarked || !dailyAttendanceCanBeSaved || isSaving) return;
    setIsSaving(true);
    setSaveError('');
    setStatusMessage('');
    try {
      const { error } = await supabase.rpc('save_attendance_register', {
        p_class_id: classId,
        p_session_id: sessionId,
        p_term_id: termId,
        p_attendance_date: attendanceDate,
        p_rows: rows.map((row) => ({
          student_id: row.student_id,
          status: row.attendance_status,
        })),
        p_correction_reason: correctionReason.trim() || null,
      });
      if (error) {
        setSaveError(error.message.toLowerCase().includes('baseline cutoff')
          ? 'Daily attendance must be recorded after the saved historical attendance cutoff.'
          : error.message.toLowerCase().includes('reason')
          ? 'Attendance has already been saved for one or more learners. Enter a correction reason, then save again.'
          : 'The register could not be saved. Verify the date and entries, then try again.');
      } else {
        setStatusMessage('Attendance register saved.');
        setCorrectionReason('');
        setRefreshKey((current) => current + 1);
      }
    } catch {
      setSaveError('The register could not be saved. Check your connection and try again.');
    } finally {
      setIsSaving(false);
    }
  }

  async function saveAttendanceBaseline() {
    if (!supabase || !baselineValuesAreValid || !baselineDateIsInTerm
      || baselineReason.trim().length < 5 || isSavingBaseline || isLoadingBaseline) return;
    const confirmed = window.confirm(
      `Save each learner's days-present total through ${baselineCutoffDate}? Daily attendance for this class and term will then be recorded from the following day onward.`,
    );
    if (!confirmed) return;

    setIsSavingBaseline(true);
    setBaselineError('');
    setBaselineMessage('');
    try {
      const { error } = await supabase.rpc('save_class_attendance_baseline', {
        p_class_id: classId,
        p_session_id: sessionId,
        p_term_id: termId,
        p_cutoff_date: baselineCutoffDate,
        p_rows: rows.map((row) => ({
          student_id: row.student_id,
          days_present: Number(baselineValues[row.enrollment_id]),
        })),
        p_reason: baselineReason.trim(),
      });
      if (error) {
        const detail = error.message.toLowerCase();
        setBaselineError(detail.includes('scheduled school days')
          ? 'A learner’s present-day total cannot exceed the scheduled school days through the cutoff date.'
          : detail.includes('cutoff date cannot')
            ? 'The cutoff cannot be moved earlier than the previous saved cutoff.'
            : detail.includes('active learner exactly once')
              ? 'The class list changed. Refresh the page, then review the learner totals again.'
              : detail.includes('reason')
                ? 'Enter a reason of at least five characters.'
                : 'Historical attendance totals could not be saved. Verify the totals and try again.');
        return;
      }
      setSavedBaselineCutoffDate(baselineCutoffDate);
      setBaselineMessage(`Historical attendance totals saved for ${rows.length} learners.`);
      const nextDate = nextLocalDateString(baselineCutoffDate);
      if (selectedTerm && nextDate <= selectedTerm.ends_on
        && nextDate <= localDateString(new Date())) {
        setAttendanceDate(nextDate);
      }
      setRefreshKey((current) => current + 1);
    } catch {
      setBaselineError('Historical attendance totals could not be saved. Check your connection and try again.');
    } finally {
      setIsSavingBaseline(false);
    }
  }

  async function provisionStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !studentName.trim() || !classId || !sessionId || issuedCredential) return;
    setIsProvisioningStudent(true);
    setProvisionError('');
    try {
      const { data, error } = await supabase.functions.invoke('provision-account', {
        body: {
          role: 'student',
          student: {
            fullName: studentName.trim(),
            gender: studentGender || null,
            classId,
            sessionId,
          },
        },
      });
      if (error || !isRecord(data)
        || typeof data.loginId !== 'string'
        || typeof data.temporaryPassword !== 'string') {
        setProvisionError('The student account could not be created. Verify the selected class and session, then try again.');
        return;
      }
      setIssuedCredential({
        loginId: data.loginId,
        temporaryPassword: data.temporaryPassword,
      });
      setStudentName('');
      setStudentGender('');
      setRefreshKey((current) => current + 1);
      setStudentOptionsRefreshKey((current) => current + 1);
    } catch {
      setProvisionError('The student account could not be created. Check your connection and try again.');
    } finally {
      setIsProvisioningStudent(false);
    }
  }

  async function resetSchoolPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || issuedCredential || !resetLoginId.trim() || !resetReason.trim()) return;
    setIsResettingPassword(true);
    setResetError('');
    try {
      const { data, error } = await supabase.functions.invoke('reset-account-password', {
        body: { loginId: resetLoginId.trim(), reason: resetReason.trim() },
      });
      if (error || !isRecord(data)
        || typeof data.loginId !== 'string'
        || typeof data.temporaryPassword !== 'string') {
        setResetError('The password could not be reset. Confirm the login ID and try again.');
        return;
      }
      setIssuedCredential({
        loginId: data.loginId,
        temporaryPassword: data.temporaryPassword,
      });
      setResetLoginId('');
      setResetReason('');
    } catch {
      setResetError('The password could not be reset. Check your connection and try again.');
    } finally {
      setIsResettingPassword(false);
    }
  }

  const navigation: { id: AdminSection; label: string; icon: typeof LayoutDashboard }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'students', label: 'Students & families', icon: Users },
    { id: 'attendance', label: 'Attendance', icon: CalendarCheck2 },
    { id: 'academics', label: 'Academic setup', icon: BookOpen },
    { id: 'results', label: 'Results & reports', icon: ClipboardList },
    { id: 'school-day', label: 'Timetable & updates', icon: CalendarDays },
    { id: 'testimonials', label: 'Testimonials', icon: FileBadge2 },
    { id: 'administration', label: 'School administration', icon: Settings },
  ];

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <div className="brand-lockup admin-sidebar-brand" aria-label="Wisdom Source School">
          <span className="brand-monogram" aria-hidden="true">WS</span>
          <span className="brand-name">
            <strong>Wisdom Source School</strong>
            <span>School operations</span>
          </span>
        </div>
        <span className="admin-nav-label">ADMINISTRATION</span>
        <nav aria-label="Administrator navigation" className="admin-navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              aria-current={activeSection === id ? 'page' : undefined}
              className={`admin-nav-button${activeSection === id ? ' is-active' : ''}`}
              key={id}
              onClick={() => setActiveSection(id)}
              type="button"
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-note">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>Private school administration</span>
        </div>
      </aside>

      <div className="admin-main">
        <header className="brand-header workspace-header">
          <div className="admin-mobile-brand brand-lockup" aria-label="Wisdom Source School">
            <span className="brand-monogram" aria-hidden="true">WS</span>
            <span className="brand-name">
              <strong>Wisdom Source School</strong>
              <span>School operations</span>
            </span>
          </div>
          <div className="workspace-user">
            <span className="role-badge">Super Admin</span>
            <button className="sign-out-button" onClick={onSignOut} type="button">
              <LogOut size={15} aria-hidden="true" />
              Sign out
            </button>
          </div>
        </header>

        <section className="admin-content" aria-labelledby="admin-heading">
          <div className="admin-context-bar" aria-label="Current academic context">
            <label>
              <span className="field-label">Academic session</span>
              <select
                className="text-field"
                disabled={isLoadingOptions || sessions.length === 0 || isBulkProvisioning}
                onChange={(event) => setSessionId(event.target.value)}
                value={sessionId}
              >
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>{session.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="field-label">Class</span>
              <select
                className="text-field"
                disabled={isLoadingOptions || classes.length === 0}
                onChange={(event) => setClassId(event.target.value)}
                value={classId}
              >
                {classes.map((schoolClass) => (
                  <option key={schoolClass.id} value={schoolClass.id}>{schoolClass.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="field-label">Term</span>
              <select
                className="text-field"
                disabled={!sessionId || terms.length === 0}
                onChange={(event) => setTermId(event.target.value)}
                value={termId}
              >
                {terms.map((term) => (
                  <option key={term.id} value={term.id}>{term.name}</option>
                ))}
              </select>
            </label>
          </div>
            <p className="attendance-date-help">
              To enter past attendance, choose a date in the selected term. Record one school day at a time;
              saved entries will load for review.
            </p>
          {loadError && <p className="form-notice" role="alert">{loadError}</p>}
          {notice && <p className="form-notice" role="alert">{notice}</p>}
          {overviewError && <p className="form-notice" role="alert">{overviewError}</p>}
          {attendanceSummaryError && activeSection === 'overview' && (
            <p className="form-notice" role="alert">{attendanceSummaryError}</p>
          )}

          <section className="admin-view admin-overview" hidden={activeSection !== 'overview'}>
            <div className="admin-heading">
              <span className="eyebrow">School overview</span>
              <h1 id="admin-heading">Good day, Administrator</h1>
              <p>Your school operations at a glance. Choose a section to manage daily work.</p>
            </div>
            <div className="admin-stat-grid">
              <article className="admin-stat-card">
                <span className="admin-stat-icon"><Users size={18} aria-hidden="true" /></span>
                <span className="admin-stat-label">Active learners</span>
                <strong>{activeLearnerCount === null ? '—' : activeLearnerCount}</strong>
                <span className="admin-stat-detail">Student records currently active</span>
              </article>
              <article className="admin-stat-card">
                <span className="admin-stat-icon"><BookOpen size={18} aria-hidden="true" /></span>
                <span className="admin-stat-label">Active classes</span>
                <strong>{classes.length || '—'}</strong>
                <span className="admin-stat-detail">Classes available for enrollment</span>
              </article>
              <article className="admin-stat-card">
                <span className="admin-stat-icon"><CalendarDays size={18} aria-hidden="true" /></span>
                <span className="admin-stat-label">Academic session</span>
                <strong className="admin-stat-session">
                  {sessions.find((session) => session.is_active)?.name ?? 'Not set'}
                </strong>
                <span className="admin-stat-detail">Current school year</span>
              </article>
              <article className="admin-stat-card">
                <span className="admin-stat-icon"><Activity size={18} aria-hidden="true" /></span>
                <span className="admin-stat-label">Attendance entries</span>
                <strong>
                  {attendanceSummary
                    ? attendanceSummary.present + attendanceSummary.absent
                    : sessionId && classId && termId ? '—' : '—'}
                </strong>
                <span className="admin-stat-detail">
                  {attendanceSummary
                    ? `${attendanceSummary.present} present · ${attendanceSummary.absent} absent`
                    : 'Selected class and term'}
                </span>
              </article>
            </div>
            <section className="family-panel admin-quick-actions" aria-labelledby="quick-actions-heading">
              <div className="family-panel-heading">
                <div>
                  <span className="eyebrow">Get started</span>
                  <h2 id="quick-actions-heading">Quick actions</h2>
                </div>
              </div>
              <div className="admin-quick-action-grid">
                <button onClick={() => setActiveSection('students')} type="button">
                  <Users size={17} aria-hidden="true" />
                  <span><strong>Manage learners</strong><small>Create accounts and manage enrollment</small></span>
                </button>
                <button onClick={() => setActiveSection('attendance')} type="button">
                  <CalendarCheck2 size={17} aria-hidden="true" />
                  <span><strong>Take attendance</strong><small>Open the selected class register</small></span>
                </button>
                <button onClick={() => setActiveSection('results')} type="button">
                  <ClipboardList size={17} aria-hidden="true" />
                  <span><strong>Manage results</strong><small>Set up assessments and publish marks</small></span>
                </button>
                <button onClick={() => setActiveSection('academics')} type="button">
                  <BookOpen size={17} aria-hidden="true" />
                  <span><strong>Academic setup</strong><small>Configure sessions, terms, and grading</small></span>
                </button>
              </div>
            </section>
            <p className="admin-development-note">
              Development environment only. Continue using fictional data until production readiness,
              privacy obligations, and operational procedures have been reviewed.
            </p>
          </section>

          <section className="admin-view" hidden={activeSection !== 'academics'}>
            <div className="admin-heading">
              <span className="eyebrow">Configuration</span>
              <h1>Academic setup</h1>
              <p>Maintain the academic calendar and the school’s grading rules.</p>
            </div>
        <AcademicConfigurationPanel
          onSessionListChanged={(activeSessionId) => {
            if (activeSessionId) setSessionId(activeSessionId);
            setOptionsRefreshKey((current) => current + 1);
            setTermsRefreshKey((current) => current + 1);
          }}
          onTermListChanged={() => setTermsRefreshKey((current) => current + 1)}
        />
        <GradingScalePanel />
          </section>

          <section className="admin-view" hidden={activeSection !== 'students'}>
            <div className="admin-heading">
              <span className="eyebrow">Student records</span>
              <h1>Students & families</h1>
              <p>Create learner accounts, manage parent access, and update enrollment status.</p>
            </div>
            <StudentDirectoryPanel
              classes={classes}
              refreshKey={studentOptionsRefreshKey}
              sessionId={sessionId}
            sessionName={selectedSession?.name ?? ''}
          />
          <section className="family-panel provisioning-panel" aria-labelledby="provision-heading">
          <div className="family-panel-heading">
            <div>
              <span className="eyebrow">New learner</span>
              <h2 id="provision-heading">Create a student account</h2>
            </div>
          </div>
          <p className="provisioning-context">
            New learner will be enrolled in {classes.find((schoolClass) => schoolClass.id === classId)?.name ?? 'the selected class'}
            {' '}for {selectedSession?.name ?? 'the selected session'}. Choose the class and session below before creating the account.
          </p>
          {issuedCredential ? (
            <div className="credential-notice">
              <p>This temporary password is shown once. Share it privately with the account holder. They must change it at their next sign-in.</p>
              <dl>
                <div><dt>Student login ID</dt><dd><code>{issuedCredential.loginId}</code></dd></div>
                <div><dt>Temporary password</dt><dd><code>{issuedCredential.temporaryPassword}</code></dd></div>
              </dl>
              <button
                className="sign-out-button"
                onClick={() => setIssuedCredential(null)}
                type="button"
              >
                I have securely shared this credential
              </button>
            </div>
          ) : (
            <>
              <form className="provision-form" onSubmit={(event) => void provisionStudent(event)}>
                <label>
                  <span className="field-label">Student full name</span>
                  <input
                    className="text-field"
                    maxLength={160}
                    onChange={(event) => setStudentName(event.target.value)}
                    required
                    value={studentName}
                  />
                </label>
                <label>
                  <span className="field-label">Gender (optional)</span>
                  <select
                    className="text-field"
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === '' || value === 'female' || value === 'male' || value === 'undisclosed') {
                        setStudentGender(value);
                      }
                    }}
                    value={studentGender}
                  >
                    <option value="">Not provided</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="undisclosed">Undisclosed</option>
                  </select>
                </label>
                <button
                  className="sign-in-button provision-button"
                  disabled={isProvisioningStudent || !classId || !sessionId}
                  type="submit"
                >
                  <span>{isProvisioningStudent ? 'Creating account…' : 'Create account and enroll'}</span>
                </button>
                {provisionError && <p className="form-notice" role="alert">{provisionError}</p>}
              </form>
              <form className="reset-form" onSubmit={(event) => void resetSchoolPassword(event)}>
                <h3>Reset a student or parent password</h3>
                <div className="reset-fields">
                  <label>
                    <span className="field-label">School login ID</span>
                    <input
                      className="text-field"
                      maxLength={64}
                      onChange={(event) => setResetLoginId(event.target.value)}
                      required
                      value={resetLoginId}
                    />
                  </label>
                  <label>
                    <span className="field-label">Reason for reset</span>
                    <input
                      className="text-field"
                      maxLength={500}
                      minLength={5}
                      onChange={(event) => setResetReason(event.target.value)}
                      required
                      value={resetReason}
                    />
                  </label>
                </div>
                <button
                  className="sign-out-button reset-password-button"
                  disabled={isResettingPassword}
                  type="submit"
                >
                  {isResettingPassword ? 'Resetting password…' : 'Issue temporary password'}
                </button>
                {resetError && <p className="form-notice" role="alert">{resetError}</p>}
              </form>
            </>
          )}
        </section>
        <StudentBulkImportPanel
          classes={classes.map(({ id, name }) => ({ id, name }))}
          onStudentCreated={() => setStudentOptionsRefreshKey((current) => current + 1)}
          onProcessingChange={setIsBulkProvisioning}
          sessionId={sessionId}
          sessionName={selectedSession?.name ?? ''}
        />
        <ParentProvisionPanel refreshKey={studentOptionsRefreshKey} />
        <StudentLifecyclePanel
          onStudentListChanged={() => setStudentOptionsRefreshKey((current) => current + 1)}
          refreshKey={studentOptionsRefreshKey}
        />
        </section>

        <section className="admin-view" hidden={activeSection !== 'attendance'}>
          <div className="admin-heading">
            <span className="eyebrow">Daily operations</span>
            <h1>Attendance register</h1>
            <p>Record attendance for the selected class and school day.</p>
          </div>
          <div className="attendance-toolbar attendance-date-toolbar">
          <label>
            <span className="field-label">Attendance date</span>
            <input
              className="text-field"
              disabled={!selectedTerm || isLoadingBaseline}
              max={selectedTerm
                ? [selectedTerm.ends_on, localDateString(new Date())].sort()[0]
                : undefined}
              min={savedBaselineCutoffDate
                ? nextLocalDateString(savedBaselineCutoffDate)
                : selectedTerm?.starts_on}
              onChange={(event) => setAttendanceDate(event.target.value)}
              type="date"
              value={attendanceDate}
            />
          </label>
          </div>
        {selectedSession && (
          <p className="selection-note">
            Session dates: {selectedSession.starts_on} to {selectedSession.ends_on}
          </p>
        )}
        {!dateIsInTerm && termId && (
          <p className="form-notice" role="status">
            Choose a school date within the selected term and not later than today.
          </p>
        )}
        {savedBaselineCutoffDate && attendanceDate <= savedBaselineCutoffDate && (
          <p className="form-notice" role="status">
            Historical totals already cover this class through {savedBaselineCutoffDate}. Daily attendance starts the following day.
          </p>
        )}
        <div className="attendance-baseline-card">
          <div className="attendance-card-header">
            <div>
              <strong>Enter historical attendance totals</strong>
              <span>Set each learner’s days present through a cutoff date; no individual past days are created.</span>
            </div>
            <span className="attendance-count">{rows.length} learners</span>
          </div>
          <div className="attendance-baseline-guidance">
            <p>
              Enter each learner’s own present-day total, including any attendance already recorded through the cutoff.
              After saving, the daily register starts on the next day and report cards add those later marks to this total.
              Totals affect report cards published afterward; publish a new revision to update an existing report.
            </p>
            <label>
              <span className="field-label">Count present through</span>
              <input
                className="text-field"
                disabled={!selectedTerm || isSavingBaseline}
                max={selectedTerm
                  ? [selectedTerm.ends_on, localDateString(new Date())].sort()[0]
                  : undefined}
                min={savedBaselineCutoffDate || selectedTerm?.starts_on}
                onChange={(event) => {
                  setBaselineCutoffDate(event.target.value);
                  setBaselineMessage('');
                  setBaselineError('');
                }}
                type="date"
                value={baselineCutoffDate}
              />
            </label>
          </div>
          {isLoadingBaseline ? (
            <p className="empty-state">Loading historical attendance totals…</p>
          ) : rows.length === 0 ? (
            <p className="empty-state">Select a class, session, and term with active learners to enter historical totals.</p>
          ) : (
            <div className="attendance-table-wrap">
              <table className="attendance-table attendance-baseline-table">
                <thead>
                  <tr>
                    <th scope="col">Learner</th>
                    <th scope="col">Days present through cutoff</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.enrollment_id}>
                      <td><strong>{row.full_name}</strong><small>{row.serial}</small></td>
                      <td>
                        <label className="visually-hidden" htmlFor={`baseline-${row.enrollment_id}`}>
                          Days present through {baselineCutoffDate} for {row.full_name}
                        </label>
                        <input
                          className="text-field attendance-baseline-input"
                          disabled={isSavingBaseline || !baselineDateIsInTerm}
                          id={`baseline-${row.enrollment_id}`}
                          inputMode="numeric"
                          min="0"
                          onChange={(event) => {
                            setBaselineValues((current) => ({
                              ...current,
                              [row.enrollment_id]: event.target.value,
                            }));
                            setBaselineMessage('');
                            setBaselineError('');
                          }}
                          type="number"
                          value={baselineValues[row.enrollment_id] ?? ''}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 0 && (
            <div className="attendance-baseline-actions">
              <label>
                <span className="field-label">Reason for entering or correcting totals</span>
                <input
                  className="text-field"
                  maxLength={500}
                  minLength={5}
                  onChange={(event) => setBaselineReason(event.target.value)}
                  value={baselineReason}
                />
              </label>
              <button
                className="sign-in-button save-attendance-button"
                disabled={!baselineValuesAreValid || !baselineDateIsInTerm
                  || baselineReason.trim().length < 5
                  || isLoadingBaseline || isSavingBaseline || isLoadingRegister}
                onClick={() => void saveAttendanceBaseline()}
                type="button"
              >
                <span>{isSavingBaseline ? 'Saving historical totals…' : 'Save historical totals'}</span>
              </button>
            </div>
          )}
          {baselineError && <p className="form-notice" role="alert">{baselineError}</p>}
          {baselineMessage && <p className="success-notice" role="status">{baselineMessage}</p>}
        </div>
        <div className="attendance-card">
          <div className="attendance-card-header">
            <div>
              <strong>{classes.find((schoolClass) => schoolClass.id === classId)?.name ?? 'Class register'}</strong>
              <span>{selectedTerm?.name ?? 'Select a term'} · {attendanceDate}</span>
            </div>
            <div className="attendance-register-actions">
              <span className="attendance-count">{rows.length} learners</span>
              {unmarkedStudentCount > 0 && (
                <button
                  aria-label={`Mark the ${unmarkedStudentCount} remaining unmarked learners present`}
                  className="attendance-mark-remaining"
                  disabled={!dailyAttendanceCanBeSaved || isLoadingRegister || isSaving}
                  onClick={markRemainingPresent}
                  type="button"
                >
                  <CheckCheck size={16} aria-hidden="true" />
                  <span>Mark remaining present ({unmarkedStudentCount})</span>
                </button>
              )}
            </div>
          </div>
          {isLoadingRegister ? (
            <p className="empty-state">Loading the class register…</p>
          ) : rows.length === 0 ? (
            <p className="empty-state">
              No active learners are enrolled in this class for the selected session.
            </p>
          ) : (
            <div className="attendance-table-wrap">
              <table className="attendance-table">
                <thead>
                  <tr><th scope="col">Student</th><th scope="col">Serial</th><th scope="col">Attendance</th></tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.enrollment_id}>
                      <td>{row.full_name}</td>
                      <td>{row.serial}</td>
                      <td>
                        <label className="visually-hidden" htmlFor={`attendance-${row.student_id}`}>
                          Attendance for {row.full_name}
                        </label>
                        <select
                          className="attendance-select"
                          id={`attendance-${row.student_id}`}
                          onChange={(event) => {
                            if (event.target.value === 'present' || event.target.value === 'absent') {
                              updateAttendance(row.student_id, event.target.value);
                            }
                          }}
                          value={row.attendance_status ?? ''}
                        >
                          <option value="">Choose status</option>
                          <option value="present">Present</option>
                          <option value="absent">Absent</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 0 && (
            <div className="attendance-actions">
              <label>
                <span className="field-label">Correction reason (required when changing a saved entry)</span>
                <input
                  className="text-field"
                  maxLength={500}
                  onChange={(event) => setCorrectionReason(event.target.value)}
                  placeholder="Explain the reason for correcting attendance"
                  value={correctionReason}
                />
              </label>
              <button
                className="sign-in-button save-attendance-button"
                disabled={!allStudentsMarked || !dailyAttendanceCanBeSaved || isSaving || isLoadingRegister}
                onClick={() => void saveRegister()}
                type="button"
              >
                <span>{isSaving ? 'Saving register…' : 'Save attendance register'}</span>
              </button>
            </div>
          )}
          {saveError && <p className="form-notice" role="alert">{saveError}</p>}
          {statusMessage && <p className="success-notice" role="status">{statusMessage}</p>}
        </div>
        </section>

        <section className="admin-view" hidden={activeSection !== 'results'}>
          <div className="admin-heading">
            <span className="eyebrow">Assessment</span>
            <h1>Results & reports</h1>
            <p>Configure assessments, publish marks, and review report history.</p>
          </div>
          {classId && sessionId && termId ? (
            <AssessmentSetupPanel classId={classId} sessionId={sessionId} termId={termId} />
          ) : (
            <p className="empty-state">Select an academic session, class, and term above to manage assessments and results.</p>
          )}
          {classId && sessionId && termId && (
            <ResultsImportPanel classId={classId} sessionId={sessionId} termId={termId} />
          )}
          <ReportHistoryPanel />
        </section>

        <section className="admin-view" hidden={activeSection !== 'school-day'}>
          <div className="admin-heading">
            <span className="eyebrow">School day</span>
            <h1>Timetable & updates</h1>
            <p>Publish class timetables, school notices, and calendar events.</p>
          </div>
          {classId && sessionId && termId && selectedTerm ? (
            <>
              <SchoolUpdatesPanel
                key={`${sessionId}-${termId}`}
                sessionId={sessionId}
                termEndsOn={selectedTerm.ends_on}
                termId={termId}
                termStartsOn={selectedTerm.starts_on}
              />
              <TimetablePanel classId={classId} sessionId={sessionId} termId={termId} />
            </>
          ) : (
            <p className="empty-state">Select an academic session, class, and term above to manage timetables and school updates.</p>
          )}
        </section>

        <section className="admin-view" hidden={activeSection !== 'testimonials'}>
          <div className="admin-heading">
            <span className="eyebrow">Graduation documents</span>
            <h1>Student testimonials</h1>
            <p>Prepare individualized testimonials for graduates and approve them before student access.</p>
          </div>
          <TestimonialAdminPanel />
        </section>

        <section className="admin-view" hidden={activeSection !== 'administration'}>
          <div className="admin-heading">
            <span className="eyebrow">Oversight</span>
            <h1>School administration</h1>
            <p>Manage school details and review the audit history of administrative actions.</p>
          </div>
          <SchoolSettingsPanel />
          <AuditLogPanel />
        </section>
        </section>
        <footer className="admin-footer">
          <span>Wisdom Source School Portal</span>
          <span>Development environment · Fictional data only</span>
        </footer>
      </div>
    </main>
  );
}
