import { useEffect, useState } from 'react';
import {
  Bell,
  CalendarDays,
  CalendarCheck2,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Printer,
  TableProperties,
} from 'lucide-react';
import schoolLogo from '../assets/wisdom-source-logo.png';
import schoolSignature from '../assets/wisdom-source-signature.png';
import { formatOrdinalPosition } from '../domain/results';
import { supabase } from '../lib/supabase';

type StudentProfile = { id: string; serial: string; full_name: string };
type ReportSubject = {
  subject: string;
  obtained: number;
  obtainable: number;
  grade: string | null;
};
type ReportSnapshot = {
  academic_session: string;
  term: string;
  school_name?: string;
  report_card_footer?: string;
  student_serial: string;
  class: string;
  total_obtained: number;
  total_obtainable: number;
  overall_percentage: number;
  overall_grade: string | null;
  class_position: number;
  subjects: ReportSubject[];
  teacher_comment: string;
};
type ReportCard = {
  id: string;
  overall_percentage: number;
  class_position: number;
  attendance_present: number;
  attendance_scheduled: number;
  snapshot: ReportSnapshot;
  published_at: string;
};
type Announcement = { id: string; title: string; body: string; published_at: string };
type CalendarEvent = {
  id: string;
  title: string;
  description: string;
  starts_on: string;
  ends_on: string;
  kind: string;
};
type TimetableDocument = {
  id: string;
  object_path: string;
  original_filename: string;
  created_at: string;
};
type AttendanceRecord = {
  id: string;
  student_id: string;
  attendance_date: string;
  status: 'present' | 'absent';
};
type FamilySection = 'overview' | 'results' | 'attendance' | 'timetables' | 'calendar' | 'notices';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseStudents(value: unknown): StudentProfile[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is StudentProfile => isRecord(row)
    && typeof row.id === 'string'
    && typeof row.serial === 'string'
    && typeof row.full_name === 'string');
}

function parseSnapshot(value: unknown): ReportSnapshot | null {
  if (!isRecord(value)
    || typeof value.academic_session !== 'string'
    || typeof value.term !== 'string'
    || (value.school_name !== undefined && typeof value.school_name !== 'string')
    || (value.report_card_footer !== undefined && typeof value.report_card_footer !== 'string')
    || typeof value.student_serial !== 'string'
    || typeof value.class !== 'string'
    || typeof value.total_obtained !== 'number'
    || typeof value.total_obtainable !== 'number'
    || typeof value.overall_percentage !== 'number'
    || (value.overall_grade !== null && typeof value.overall_grade !== 'string')
    || typeof value.class_position !== 'number'
    || typeof value.teacher_comment !== 'string'
    || !Array.isArray(value.subjects)) {
    return null;
  }
  const subjects = value.subjects.filter((subject): subject is ReportSubject => isRecord(subject)
    && typeof subject.subject === 'string'
    && typeof subject.obtained === 'number'
    && typeof subject.obtainable === 'number'
    && (subject.grade === null || typeof subject.grade === 'string'));
  if (subjects.length !== value.subjects.length) return null;
  return {
    academic_session: value.academic_session,
    term: value.term,
    ...(typeof value.school_name === 'string' ? { school_name: value.school_name } : {}),
    ...(typeof value.report_card_footer === 'string' ? { report_card_footer: value.report_card_footer } : {}),
    student_serial: value.student_serial,
    class: value.class,
    total_obtained: value.total_obtained,
    total_obtainable: value.total_obtainable,
    overall_percentage: value.overall_percentage,
    overall_grade: value.overall_grade,
    class_position: value.class_position,
    subjects,
    teacher_comment: value.teacher_comment,
  };
}

function parseReports(value: unknown): ReportCard[] | null {
  if (!Array.isArray(value)) return null;
  const reports: ReportCard[] = [];
  for (const row of value) {
    if (!isRecord(row)
      || typeof row.id !== 'string'
      || typeof row.overall_percentage !== 'number'
      || typeof row.class_position !== 'number'
      || typeof row.attendance_present !== 'number'
      || typeof row.attendance_scheduled !== 'number'
      || typeof row.published_at !== 'string') {
      return null;
    }
    const snapshot = parseSnapshot(row.snapshot);
    if (!snapshot) return null;
    reports.push({
      id: row.id,
      overall_percentage: row.overall_percentage,
      class_position: row.class_position,
      attendance_present: row.attendance_present,
      attendance_scheduled: row.attendance_scheduled,
      snapshot,
      published_at: row.published_at,
    });
  }
  return reports;
}

function latestReportCardsByTerm(reports: readonly ReportCard[]): ReportCard[] {
  const seenTerms = new Set<string>();
  return [...reports]
    .sort((left, right) => right.published_at.localeCompare(left.published_at))
    .filter((report) => {
      const termKey = JSON.stringify([
        report.snapshot.academic_session,
        report.snapshot.term,
      ]);
      if (seenTerms.has(termKey)) return false;
      seenTerms.add(termKey);
      return true;
    });
}

function parseAnnouncements(value: unknown): Announcement[] | null {
  if (!Array.isArray(value)) return null;
  const records: Announcement[] = [];
  for (const row of value) {
    if (!isRecord(row)
      || typeof row.id !== 'string'
      || typeof row.title !== 'string'
      || typeof row.body !== 'string'
      || typeof row.published_at !== 'string') {
      return null;
    }
    records.push({
      id: row.id,
      title: row.title,
      body: row.body,
      published_at: row.published_at,
    });
  }
  return records;
}

function parseCalendar(value: unknown): CalendarEvent[] | null {
  if (!Array.isArray(value)) return null;
  const records: CalendarEvent[] = [];
  for (const row of value) {
    if (!isRecord(row)
      || typeof row.id !== 'string'
      || typeof row.title !== 'string'
      || typeof row.description !== 'string'
      || typeof row.starts_on !== 'string'
      || typeof row.ends_on !== 'string'
      || typeof row.kind !== 'string') {
      return null;
    }
    records.push({
      id: row.id,
      title: row.title,
      description: row.description,
      starts_on: row.starts_on,
      ends_on: row.ends_on,
      kind: row.kind,
    });
  }
  return records;
}

function parseTimetables(value: unknown): TimetableDocument[] | null {
  if (!Array.isArray(value)) return null;
  const records: TimetableDocument[] = [];
  for (const row of value) {
    if (!isRecord(row)
      || typeof row.id !== 'string'
      || typeof row.object_path !== 'string'
      || typeof row.original_filename !== 'string'
      || typeof row.created_at !== 'string') {
      return null;
    }
    records.push({
      id: row.id,
      object_path: row.object_path,
      original_filename: row.original_filename,
      created_at: row.created_at,
    });
  }
  return records;
}

function parseAttendance(value: unknown): AttendanceRecord[] | null {
  if (!Array.isArray(value)) return null;
  const records: AttendanceRecord[] = [];
  for (const row of value) {
    if (!isRecord(row)
      || typeof row.id !== 'string'
      || typeof row.student_id !== 'string'
      || typeof row.attendance_date !== 'string'
      || (row.status !== 'present' && row.status !== 'absent')) {
      return null;
    }
    records.push({
      id: row.id,
      student_id: row.student_id,
      attendance_date: row.attendance_date,
      status: row.status,
    });
  }
  return records;
}

export default function LearnerWorkspace({
  role,
  onSignOut,
  notice,
}: {
  role: 'student' | 'parent';
  onSignOut: () => void;
  notice: string;
}) {
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [reports, setReports] = useState<ReportCard[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [calendar, setCalendar] = useState<CalendarEvent[]>([]);
  const [timetables, setTimetables] = useState<TimetableDocument[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [activeSection, setActiveSection] = useState<FamilySection>('overview');
  const [openingTimetableId, setOpeningTimetableId] = useState('');
  const [timetableError, setTimetableError] = useState('');
  const [printingReportId, setPrintingReportId] = useState('');
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (refreshKey > 0) setIsRefreshing(true);
    async function loadWorkspace() {
      if (!supabase) {
        setErrors(['School database is not configured.']);
        setLoading(false);
        setIsRefreshing(false);
        return;
      }
      try {
        const [
          studentsResult,
          reportsResult,
          announcementsResult,
          calendarResult,
          timetablesResult,
          attendanceResult,
        ] = await Promise.all([
          supabase.from('students').select('id,serial,full_name').order('full_name'),
          supabase
            .from('published_report_cards')
            .select('id,overall_percentage,class_position,attendance_present,attendance_scheduled,snapshot,published_at')
            .order('published_at', { ascending: false })
            .limit(50),
          supabase
            .from('announcements')
            .select('id,title,body,published_at')
            .not('published_at', 'is', null)
            .order('published_at', { ascending: false })
            .limit(20),
          supabase
            .from('school_calendar_events')
            .select('id,title,description,starts_on,ends_on,kind')
            .gte('ends_on', new Date().toISOString().slice(0, 10))
            .order('starts_on')
            .limit(20),
          supabase
            .from('timetable_documents')
            .select('id,object_path,original_filename,created_at')
            .order('created_at', { ascending: false })
            .limit(20),
          supabase
            .from('attendance_records')
            .select('id,student_id,attendance_date,status')
            .order('attendance_date', { ascending: false })
            .limit(100),
        ]);
        if (cancelled) return;
        const issues: string[] = [];
        if (studentsResult.error) issues.push('Linked student records could not be loaded.');
        else setStudents(parseStudents(studentsResult.data));

        if (reportsResult.error) issues.push('Published report cards could not be loaded.');
        else {
          const parsed = parseReports(reportsResult.data);
          if (parsed === null) issues.push('Published report cards returned an unexpected response.');
          else setReports(latestReportCardsByTerm(parsed));
        }

        if (announcementsResult.error) issues.push('Announcements could not be loaded.');
        else {
          const parsed = parseAnnouncements(announcementsResult.data);
          if (parsed === null) issues.push('Announcements returned an unexpected response.');
          else setAnnouncements(parsed);
        }

        if (calendarResult.error) issues.push('The school calendar could not be loaded.');
        else {
          const parsed = parseCalendar(calendarResult.data);
          if (parsed === null) issues.push('The school calendar returned an unexpected response.');
          else setCalendar(parsed);
        }
        if (timetablesResult.error) issues.push('Published class timetables could not be loaded.');
        else {
          const parsed = parseTimetables(timetablesResult.data);
          if (parsed === null) issues.push('Published class timetables returned an unexpected response.');
          else setTimetables(parsed);
        }
        if (attendanceResult.error) issues.push('Attendance history could not be loaded.');
        else {
          const parsed = parseAttendance(attendanceResult.data);
          if (parsed === null) issues.push('Attendance history returned an unexpected response.');
          else setAttendanceRecords(parsed);
        }
        setErrors(issues);
      } catch {
        if (!cancelled) setErrors(['School information could not be loaded. Check your connection and try again.']);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setIsRefreshing(false);
        }
      }
    }
    void loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  function openSection(section: FamilySection) {
    setActiveSection(section);
    if (section === 'results') {
      setIsRefreshing(true);
      setRefreshKey((current) => current + 1);
    }
  }

  useEffect(() => {
    if (!printingReportId) return undefined;
    const clearPrintMode = () => {
      document.body.classList.remove('print-report');
      setPrintingReportId('');
    };
    document.body.classList.add('print-report');
    window.addEventListener('afterprint', clearPrintMode);
    const timeout = window.setTimeout(() => window.print(), 150);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('afterprint', clearPrintMode);
      document.body.classList.remove('print-report');
    };
  }, [printingReportId]);

  const studentNames = new Map(students.map((student) => [student.serial, student.full_name]));
  const navigation: { id: FamilySection; label: string; icon: typeof LayoutDashboard }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'results', label: role === 'parent' ? 'Learner results' : 'My results', icon: ClipboardList },
    { id: 'attendance', label: role === 'parent' ? 'Learner attendance' : 'My attendance', icon: CalendarCheck2 },
    { id: 'timetables', label: 'Class timetable', icon: TableProperties },
    { id: 'calendar', label: 'School calendar', icon: CalendarDays },
    { id: 'notices', label: 'School notices', icon: Bell },
  ];

  async function openTimetable(document: TimetableDocument) {
    if (!supabase || openingTimetableId) return;
    setOpeningTimetableId(document.id);
    setTimetableError('');
    try {
      const { data, error } = await supabase.storage
        .from('school-timetables')
        .createSignedUrl(document.object_path, 60, { download: document.original_filename });
      if (error || !data?.signedUrl) {
        setTimetableError('The secure timetable link could not be created. Refresh and try again.');
        return;
      }
      window.location.assign(data.signedUrl);
    } catch {
      setTimetableError('The secure timetable link could not be created. Check your connection and try again.');
    } finally {
      setOpeningTimetableId('');
    }
  }

  return (
    <main className="family-shell">
      <aside className="family-sidebar">
        <div className="brand-lockup family-sidebar-brand" aria-label="Wisdom Source School">
          <span className="brand-monogram" aria-hidden="true">WS</span>
          <span className="brand-name">
            <strong>Wisdom Source School</strong>
            <span>Student / Parent portal</span>
          </span>
        </div>
        <span className="family-nav-label">{role === 'parent' ? 'PARENT MENU' : 'STUDENT MENU'}</span>
        <nav aria-label={role === 'parent' ? 'Parent navigation' : 'Student navigation'} className="family-navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              aria-current={activeSection === id ? 'page' : undefined}
              className={`family-nav-button${activeSection === id ? ' is-active' : ''}`}
              key={id}
              onClick={() => openSection(id)}
              type="button"
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="family-sidebar-note">
          <span>School records are private to this account.</span>
        </div>
      </aside>

      <div className="family-main">
        <header className="brand-header workspace-header family-header">
          <div className="family-mobile-brand brand-lockup" aria-label="Wisdom Source School">
            <span className="brand-monogram" aria-hidden="true">WS</span>
            <span className="brand-name">
              <strong>Wisdom Source School</strong>
              <span>Student / Parent portal</span>
            </span>
          </div>
          <div className="workspace-user">
            <span className="role-badge">{role === 'parent' ? 'Parent' : 'Student'}</span>
            <button className="sign-out-button" onClick={onSignOut} type="button">
              <LogOut size={15} aria-hidden="true" />
              Sign out
            </button>
          </div>
        </header>

        <section className="family-content" aria-label="Student and parent portal">
        {errors.map((error) => <p className="form-notice" key={error} role="alert">{error}</p>)}
        {loading ? (
          <p className="empty-state">Loading your school information…</p>
        ) : (
          <>
            <section className="family-section" hidden={activeSection !== 'overview'}>
              <div className="admin-heading">
                <span className="eyebrow">Learning and school life</span>
                <h1 id="family-heading">
                  {role === 'parent' ? 'Family overview' : `Hi, ${students[0]?.full_name ?? 'there'}`}
                </h1>
                <p>View the latest school information available to this authenticated account.</p>
              </div>
              <div className="family-overview-grid">
                <article className="family-overview-card">
                  <span className="family-overview-icon"><ClipboardList size={18} aria-hidden="true" /></span>
                  <span className="admin-stat-label">Published reports</span>
                  <strong>{reports.length}</strong>
                  <button onClick={() => openSection('results')} type="button">View results</button>
                </article>
                <article className="family-overview-card">
                  <span className="family-overview-icon"><CalendarCheck2 size={18} aria-hidden="true" /></span>
                  <span className="admin-stat-label">Attendance entries</span>
                  <strong>{attendanceRecords.length === 100 ? '100+' : attendanceRecords.length}</strong>
                  <button onClick={() => setActiveSection('attendance')} type="button">View attendance</button>
                </article>
                <article className="family-overview-card">
                  <span className="family-overview-icon"><TableProperties size={18} aria-hidden="true" /></span>
                  <span className="admin-stat-label">Class timetables</span>
                  <strong>{timetables.length}</strong>
                  <button onClick={() => setActiveSection('timetables')} type="button">View timetables</button>
                </article>
                <article className="family-overview-card">
                  <span className="family-overview-icon"><Bell size={18} aria-hidden="true" /></span>
                  <span className="admin-stat-label">School notices</span>
                  <strong>{announcements.length}</strong>
                  <button onClick={() => setActiveSection('notices')} type="button">View notices</button>
                </article>
              </div>
              <section className="family-panel family-latest-panel" aria-labelledby="latest-school-info-heading">
                <div className="family-panel-heading">
                  <div>
                    <span className="eyebrow">Stay informed</span>
                    <h2 id="latest-school-info-heading">Coming up at school</h2>
                  </div>
                  <button className="sign-out-button" onClick={() => setActiveSection('calendar')} type="button">
                    Open calendar
                  </button>
                </div>
                {calendar.length === 0 ? (
                  <p className="empty-state">There are no upcoming calendar items.</p>
                ) : (
                  <ul className="notice-list">
                    {calendar.slice(0, 3).map((event) => (
                      <li key={event.id}>
                        <strong>{event.title}</strong>
                        <time dateTime={event.starts_on}>
                          {event.starts_on === event.ends_on
                            ? event.starts_on
                            : `${event.starts_on} to ${event.ends_on}`}
                        </time>
                        <p>{event.description || event.kind}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <p className="family-privacy-note">
                Published school records are shown only when this account is authorized to access them.
              </p>
            </section>

            <section className="family-section" hidden={activeSection !== 'results'}>
            <div className="admin-heading">
              <span className="eyebrow">Academic progress</span>
              <h1>{role === 'parent' ? 'Learner results' : 'My results'}</h1>
              <p>Review published report cards, subject results, and teacher comments.</p>
            </div>
            <section className="family-panel" aria-labelledby="reports-heading">
              <div className="family-panel-heading">
                <div>
                  <span className="eyebrow">Academic progress</span>
                  <h2 id="reports-heading">Published report cards</h2>
                </div>
                <div className="family-panel-actions">
                  <span className="attendance-count">{reports.length} reports</span>
                  <button
                    className="sign-out-button"
                    disabled={isRefreshing}
                    onClick={() => {
                      setIsRefreshing(true);
                      setRefreshKey((current) => current + 1);
                    }}
                    type="button"
                  >
                    {isRefreshing ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>
              </div>
              {reports.length === 0 ? (
                <p className="empty-state">No published report cards are available to this account.</p>
              ) : (
                <div className="report-list">
                  {reports.map((report) => (
                    <article
                      className="report-card report-document"
                      data-printing={printingReportId === report.id ? 'true' : undefined}
                      key={report.id}
                    >
                      <div className="report-card-toolbar">
                        <span className="report-revision-label">
                          Published {new Date(report.published_at).toLocaleDateString()}
                        </span>
                        <button
                          className="sign-out-button report-print-button"
                          onClick={() => setPrintingReportId(report.id)}
                          type="button"
                        >
                          <Printer size={14} aria-hidden="true" />
                          Print / Save PDF
                        </button>
                      </div>
                      <header className="report-document-heading">
                        <img
                          alt="Wisdom Source School logo"
                          className="report-school-logo"
                          src={schoolLogo}
                        />
                        <div className="report-school-title">
                          <span className="eyebrow">Wisdom Source</span>
                          <h2>{report.snapshot.school_name ?? 'Wisdom Source School'}</h2>
                          <p>Termly Academic Report</p>
                          <span className="report-period">
                            {report.snapshot.academic_session} Academic Session · {report.snapshot.term}
                          </span>
                        </div>
                      </header>
                      <section className="report-learner-details" aria-label="Learner details">
                        <div><span>Student</span><strong>{studentNames.get(report.snapshot.student_serial) ?? report.snapshot.student_serial}</strong></div>
                        <div><span>Serial number</span><strong>{report.snapshot.student_serial}</strong></div>
                        <div><span>Class</span><strong>{report.snapshot.class}</strong></div>
                        <div><span>Term</span><strong>{report.snapshot.term}</strong></div>
                        <div><span>Attendance</span><strong>{report.attendance_present} / {report.attendance_scheduled} days</strong></div>
                        <div>
                          <span>Date issued</span>
                          <strong>
                            <time dateTime={report.published_at}>
                              {new Date(report.published_at).toLocaleDateString()}
                            </time>
                          </strong>
                        </div>
                      </section>
                      <section className="report-subject-section" aria-label="Subject results">
                        <div className="report-section-heading">
                          <span className="eyebrow">Academic performance</span>
                          <h3>Subject results</h3>
                        </div>
                        <div className="attendance-table-wrap">
                          <table className="attendance-table report-subject-table">
                            <thead>
                              <tr>
                                <th scope="col">Subject</th>
                                <th scope="col">Score</th>
                                <th scope="col">Percentage</th>
                                <th scope="col">Grade</th>
                              </tr>
                            </thead>
                            <tbody>
                              {report.snapshot.subjects.map((subject) => (
                                <tr key={`${report.id}-${subject.subject}`}>
                                  <td>{subject.subject}</td>
                                  <td>{subject.obtained} / {subject.obtainable}</td>
                                  <td>{subject.obtainable > 0
                                    ? `${((subject.obtained / subject.obtainable) * 100).toFixed(1)}%`
                                    : '—'}</td>
                                  <td>{subject.grade ?? '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr>
                                <th scope="row">Overall total</th>
                                <td>{report.snapshot.total_obtained} / {report.snapshot.total_obtainable}</td>
                                <td>{report.overall_percentage.toFixed(1)}%</td>
                                <td>{report.snapshot.overall_grade ?? '—'}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </section>
                      <div className="report-summary-grid">
                        <section className="report-note-section">
                          <span className="eyebrow">Teacher’s comment</span>
                          <p>{report.snapshot.teacher_comment || 'No teacher comment was provided for this term.'}</p>
                        </section>
                        <section className="report-note-section report-attendance-summary">
                          <span className="eyebrow">Attendance summary</span>
                          <p>
                            Attended {report.attendance_present} out of {report.attendance_scheduled} scheduled
                            {' '}school days during this term.
                          </p>
                        </section>
                      </div>
                      <div className="report-result-strip" aria-label="Overall result">
                        <div><span>Overall average</span><strong>{report.overall_percentage.toFixed(1)}%</strong></div>
                        <div><span>Overall grade</span><strong>{report.snapshot.overall_grade ?? '—'}</strong></div>
                        <div><span>Class position</span><strong>{formatOrdinalPosition(report.class_position)}</strong></div>
                      </div>
                      <div className="report-signature">
                        <div className="report-signature-line">
                          <img
                            alt="Wisdom Source School authorised signature and stamp"
                            className="report-signature-image"
                            src={schoolSignature}
                          />
                          <span>Authorised signature and school stamp</span>
                          <strong>Principal / Proprietor</strong>
                          <small>{report.snapshot.school_name ?? 'Wisdom Source School'}</small>
                        </div>
                      </div>
                      <footer className="report-card-footer">
                        {report.snapshot.report_card_footer
                          || 'Official only when approved and published by the school.'}
                      </footer>
                    </article>
                  ))}
                </div>
              )}
            </section>
            </section>

            <section className="family-section" hidden={activeSection !== 'attendance'}>
              <div className="admin-heading">
                <span className="eyebrow">Attendance</span>
                <h1>{role === 'parent' ? 'Learner attendance' : 'My attendance'}</h1>
                <p>Review attendance entries recorded by the school.</p>
              </div>
            <section className="family-panel" aria-labelledby="my-attendance-heading">
              <div className="family-panel-heading">
                <div>
                  <span className="eyebrow">Attendance</span>
                  <h2 id="my-attendance-heading">
                    {role === 'parent' ? 'Learner attendance' : 'My attendance'}
                  </h2>
                </div>
                <span className="attendance-count">
                  {attendanceRecords.length === 100 ? 'Latest 100 entries' : `${attendanceRecords.length} entries`}
                </span>
              </div>
              {attendanceRecords.length === 0 ? (
                <p className="empty-state">No submitted attendance records are available to this account.</p>
              ) : (
                <>
                  <div className="attendance-table-wrap">
                    <table className="attendance-table">
                      <thead>
                        <tr>
                          {role === 'parent' && <th scope="col">Learner</th>}
                          <th scope="col">Date</th>
                          <th scope="col">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attendanceRecords.map((record) => (
                          <tr key={record.id}>
                            {role === 'parent' && (
                              <td>{students.find((student) => student.id === record.student_id)?.full_name ?? 'Linked learner'}</td>
                            )}
                            <td>
                              <time dateTime={record.attendance_date}>
                                {new Date(`${record.attendance_date}T00:00:00`).toLocaleDateString()}
                              </time>
                            </td>
                            <td>
                              <span className={`attendance-status attendance-status-${record.status}`}>
                                {record.status === 'present' ? 'Present' : 'Absent'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="attendance-history-note">
                    Only submitted attendance entries are shown. A date without an entry does not indicate
                    whether attendance was taken.
                  </p>
                </>
              )}
            </section>
            </section>

            <section className="family-section" hidden={activeSection !== 'timetables'}>
              <div className="admin-heading">
                <span className="eyebrow">Class resources</span>
                <h1>Class timetable</h1>
                <p>Open a secure download of a timetable published for your class.</p>
              </div>
            <section className="family-panel" aria-labelledby="timetables-heading">
              <div className="family-panel-heading">
                <div>
                  <span className="eyebrow">Class resources</span>
                  <h2 id="timetables-heading">Published timetables</h2>
                </div>
              </div>
              {timetableError && <p className="form-notice" role="alert">{timetableError}</p>}
              {timetables.length === 0 ? (
                <p className="empty-state">No published timetables are available to this account.</p>
              ) : (
                <ul className="notice-list timetable-family-list">
                  {timetables.map((document) => (
                    <li key={document.id}>
                      <strong>{document.original_filename}</strong>
                      <time dateTime={document.created_at}>
                        Uploaded {new Date(document.created_at).toLocaleDateString()}
                      </time>
                      <button
                        className="sign-out-button"
                        disabled={openingTimetableId !== ''}
                        onClick={() => void openTimetable(document)}
                        type="button"
                      >
                        {openingTimetableId === document.id ? 'Preparing secure link…' : 'Download timetable'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            </section>

            <section className="family-section" hidden={activeSection !== 'notices'}>
              <div className="admin-heading">
                <span className="eyebrow">From the school</span>
                <h1>School notices</h1>
                <p>Read announcements published by the school.</p>
              </div>
              <section className="family-panel" aria-labelledby="announcements-heading">
                <div className="family-panel-heading">
                  <div>
                    <span className="eyebrow">From the school</span>
                    <h2 id="announcements-heading">Announcements</h2>
                  </div>
                </div>
                {announcements.length === 0 ? (
                  <p className="empty-state">There are no current announcements.</p>
                ) : (
                  <ul className="notice-list">
                    {announcements.map((announcement) => (
                      <li key={announcement.id}>
                        <strong>{announcement.title}</strong>
                        <time dateTime={announcement.published_at}>
                          {new Date(announcement.published_at).toLocaleDateString()}
                        </time>
                        <p>{announcement.body}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </section>

            <section className="family-section" hidden={activeSection !== 'calendar'}>
              <div className="admin-heading">
                <span className="eyebrow">Dates to know</span>
                <h1>School calendar</h1>
                <p>View upcoming school events and important dates.</p>
              </div>
              <section className="family-panel" aria-labelledby="calendar-heading">
                <div className="family-panel-heading">
                  <div>
                    <span className="eyebrow">Dates to know</span>
                    <h2 id="calendar-heading">School calendar</h2>
                  </div>
                </div>
                {calendar.length === 0 ? (
                  <p className="empty-state">There are no upcoming calendar items.</p>
                ) : (
                  <ul className="notice-list">
                    {calendar.map((event) => (
                      <li key={event.id}>
                        <strong>{event.title}</strong>
                        <time dateTime={event.starts_on}>
                          {event.starts_on === event.ends_on
                            ? event.starts_on
                            : `${event.starts_on} to ${event.ends_on}`}
                        </time>
                        <p>{event.description || event.kind}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </section>
          </>
        )}
        <p className="workspace-status admin-limitation">
          These pages show published records and school notices only. Other portal features
          remain under development; contact the school to confirm important information.
        </p>
        {notice && <p className="form-notice" role="alert">{notice}</p>}
        </section>
        <footer className="family-footer">
          <span>Wisdom Source School Portal</span>
          <span>School records are private to this account</span>
        </footer>
      </div>
    </main>
  );
}
