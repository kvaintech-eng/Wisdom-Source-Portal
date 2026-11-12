import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { supabase } from '../lib/supabase';

type EnrollmentStatus = 'active' | 'withdrawn' | 'completed';
type StudentDirectoryRecord = {
  id: string;
  serial: string;
  fullName: string;
  gender: string | null;
  classId: string;
  className: string;
  stream: string | null;
  isActive: boolean;
  authUserId: string | null;
  enrollmentStatus: EnrollmentStatus;
  accountActive: boolean;
};
type DirectoryFilter = 'all' | 'active' | 'archived' | 'no-account';
type DirectoryClass = { id: string; name: string };

const DIRECTORY_PAGE_SIZE = 25;
const DIRECTORY_QUERY_SIZE = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export default function StudentDirectoryPanel({
  classes,
  refreshKey,
  sessionId,
  sessionName,
}: {
  classes: readonly DirectoryClass[];
  refreshKey: number;
  sessionId: string;
  sessionName: string;
}) {
  const [students, setStudents] = useState<StudentDirectoryRecord[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<DirectoryFilter>('all');
  const [classFilter, setClassFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadDirectory() {
      if (!supabase || !sessionId) {
        setStudents([]);
        setError(!supabase ? 'School database is not configured.' : '');
        return;
      }
      setIsLoading(true);
      setError('');
      setStudents([]);
      try {
        const enrollmentData: unknown[] = [];
        for (let offset = 0; ; offset += DIRECTORY_QUERY_SIZE) {
          const { data, error: enrollmentError } = await supabase
            .from('enrollments')
            .select('student_id,status,class_id,stream')
            .eq('session_id', sessionId)
            .order('student_id')
            .range(offset, offset + DIRECTORY_QUERY_SIZE - 1);
          if (cancelled) return;
          if (enrollmentError || !Array.isArray(data)) {
            setError('The selected class enrollment list could not be loaded.');
            return;
          }
          enrollmentData.push(...data);
          if (data.length < DIRECTORY_QUERY_SIZE) break;
        }
        const enrollments: {
          studentId: string;
          classId: string;
          stream: string | null;
          status: EnrollmentStatus;
        }[] = enrollmentData.flatMap((row) => (
          isRecord(row)
          && typeof row.student_id === 'string'
          && typeof row.class_id === 'string'
          && (row.stream === null || typeof row.stream === 'string')
          && (row.status === 'active' || row.status === 'withdrawn' || row.status === 'completed')
            ? [{ studentId: row.student_id, classId: row.class_id, stream: row.stream, status: row.status }]
            : []
        ));
        if (enrollments.length !== enrollmentData.length) {
          setError('The selected class enrollment list returned an unexpected response.');
          return;
        }
        if (enrollments.length === 0) {
          setStudents([]);
          return;
        }

        const studentIds = [...new Set(enrollments.map((enrollment) => enrollment.studentId))];
        const studentData: unknown[] = [];
        for (let offset = 0; offset < studentIds.length; offset += DIRECTORY_QUERY_SIZE) {
          const { data, error: studentError } = await supabase
            .from('students')
            .select('id,serial,full_name,gender,active,auth_user_id')
            .in('id', studentIds.slice(offset, offset + DIRECTORY_QUERY_SIZE))
            .order('full_name');
          if (cancelled) return;
          if (studentError || !Array.isArray(data)) {
            setError('Student details for the selected session could not be loaded.');
            return;
          }
          studentData.push(...data);
        }
        const parsedStudents = studentData.flatMap((row) => (
          isRecord(row)
          && typeof row.id === 'string'
          && typeof row.serial === 'string'
          && typeof row.full_name === 'string'
          && (row.gender === null || typeof row.gender === 'string')
          && typeof row.active === 'boolean'
          && (row.auth_user_id === null || typeof row.auth_user_id === 'string')
            ? [{
              id: row.id,
              serial: row.serial,
              fullName: row.full_name,
              gender: row.gender,
              isActive: row.active,
              authUserId: row.auth_user_id,
            }]
            : []
        ));
        if (parsedStudents.length !== studentData.length) {
          setError('Student details returned an unexpected response.');
          return;
        }

        const authUserIds = parsedStudents.flatMap((student) => (
          student.authUserId ? [student.authUserId] : []
        ));
        const accountStatuses = new Map<string, boolean>();
        for (let offset = 0; offset < authUserIds.length; offset += 500) {
          const { data: accountData, error: accountError } = await supabase
            .from('user_accounts')
            .select('user_id,active')
            .in('user_id', authUserIds.slice(offset, offset + 500));
          if (cancelled) return;
          if (accountError || !Array.isArray(accountData)) {
            setError('Student account status could not be loaded.');
            return;
          }
          for (const account of accountData) {
            if (!isRecord(account) || typeof account.user_id !== 'string'
              || typeof account.active !== 'boolean') {
              setError('Student account status returned an unexpected response.');
              return;
            }
            accountStatuses.set(account.user_id, account.active);
          }
        }

        const enrollmentByStudent = new Map<string, {
          classId: string;
          stream: string | null;
          status: EnrollmentStatus;
        }>(enrollments.map((enrollment) => [
          enrollment.studentId,
          { classId: enrollment.classId, stream: enrollment.stream, status: enrollment.status },
        ]));
        const classNames = new Map(classes.map((schoolClass) => [
          schoolClass.id,
          schoolClass.name,
        ]));
        const directoryStudents = parsedStudents.flatMap((student) => {
          const enrollment = enrollmentByStudent.get(student.id);
          if (!enrollment) return [];
          return [{
            ...student,
            classId: enrollment.classId,
            className: classNames.get(enrollment.classId) ?? 'Unavailable class',
            stream: enrollment.stream,
            enrollmentStatus: enrollment.status,
            accountActive: student.authUserId !== null
              && accountStatuses.get(student.authUserId) === true,
          }];
        });
        directoryStudents.sort((left, right) =>
          left.fullName.localeCompare(right.fullName)
          || left.serial.localeCompare(right.serial));
        setStudents(directoryStudents);
      } catch {
        if (!cancelled) setError('The student directory could not be loaded. Check your connection and try again.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadDirectory();
    return () => {
      cancelled = true;
    };
  }, [classes, sessionId, refreshKey]);

  useEffect(() => {
    setPage(0);
  }, [sessionId]);

  const visibleStudents = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return students.filter((student) => {
      const matchesSearch = !normalizedSearch
        || student.fullName.toLocaleLowerCase().includes(normalizedSearch)
        || student.serial.toLocaleLowerCase().includes(normalizedSearch)
        || student.className.toLocaleLowerCase().includes(normalizedSearch);
      const matchesFilter = filter === 'all'
        || (filter === 'active' && student.isActive)
        || (filter === 'archived' && !student.isActive)
        || (filter === 'no-account' && !student.accountActive);
      const matchesClass = classFilter === 'all' || student.classId === classFilter;
      return matchesSearch && matchesFilter && matchesClass;
    });
  }, [classFilter, filter, search, students]);

  const pageCount = Math.ceil(visibleStudents.length / DIRECTORY_PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const firstVisibleIndex = currentPage * DIRECTORY_PAGE_SIZE;
  const pageStudents = visibleStudents.slice(
    firstVisibleIndex,
    firstVisibleIndex + DIRECTORY_PAGE_SIZE,
  );
  const firstVisibleStudent = visibleStudents.length === 0 ? 0 : firstVisibleIndex + 1;
  const lastVisibleStudent = Math.min(firstVisibleIndex + DIRECTORY_PAGE_SIZE, visibleStudents.length);

  return (
    <section className="family-panel student-directory-panel" aria-labelledby="student-directory-heading">
      <div className="family-panel-heading">
        <div>
          <span className="eyebrow">Session roster</span>
          <h2 id="student-directory-heading">Student directory</h2>
        </div>
        <span className="attendance-count">
          {isLoading ? 'Loading…' : `${visibleStudents.length} of ${students.length} learners`}
        </span>
      </div>
      <p className="provisioning-context">
        All classes · {sessionName || 'Select an academic session'}.
        Filter by class or use search to find a learner.
      </p>
      <div className="student-directory-controls">
        <label className="student-directory-search">
          <span className="visually-hidden">Search students by name or serial</span>
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="Search students by name or serial"
            className="text-field"
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
            placeholder="Search name or student serial"
            type="search"
            value={search}
          />
        </label>
        <label>
          <span className="visually-hidden">Filter students</span>
          <select
            aria-label="Filter students"
            className="text-field"
            onChange={(event) => {
              const value = event.target.value;
              if (value === 'all' || value === 'active' || value === 'archived' || value === 'no-account') {
                setFilter(value);
                setPage(0);
              }
            }}
            value={filter}
          >
            <option value="all">All learners</option>
            <option value="active">Active learners</option>
            <option value="archived">Archived learners</option>
            <option value="no-account">No active portal account</option>
          </select>
        </label>
        <label>
          <span className="visually-hidden">Filter by class</span>
          <select
            aria-label="Filter by class"
            className="text-field"
            onChange={(event) => {
              setClassFilter(event.target.value);
              setPage(0);
            }}
            value={classFilter}
          >
            <option value="all">All classes</option>
            {classes.map((schoolClass) => (
              <option key={schoolClass.id} value={schoolClass.id}>{schoolClass.name}</option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="form-notice" role="alert">{error}</p>}
      {isLoading ? (
        <p className="empty-state">Loading the selected class roster…</p>
      ) : visibleStudents.length === 0 ? (
        <p className="empty-state">
          {students.length === 0
            ? 'No learners are enrolled for the selected session.'
            : 'No learners match the current search and filter.'}
        </p>
      ) : (
        <div className="student-directory-table-wrap">
          <table className="attendance-table">
            <thead>
              <tr>
                <th scope="col">Student</th>
                <th scope="col">Serial</th>
                <th scope="col">Class / stream</th>
                <th scope="col">Enrollment</th>
                <th scope="col">Account</th>
              </tr>
            </thead>
            <tbody>
              {pageStudents.map((student) => (
                <tr key={student.id}>
                  <td>
                    <strong>{student.fullName}</strong>
                    {student.gender && <small>{student.gender}</small>}
                  </td>
                  <td><code>{student.serial}</code></td>
                  <td>{student.className}{student.stream ? ` · ${student.stream}` : ''}</td>
                  <td>
                    <span className={`directory-status directory-status-${student.isActive ? student.enrollmentStatus : 'archived'}`}>
                      {student.isActive
                        ? student.enrollmentStatus[0]?.toUpperCase() + student.enrollmentStatus.slice(1)
                        : 'Archived'}
                    </span>
                  </td>
                  <td>
                    <span className={`directory-status directory-status-${student.accountActive ? 'active' : 'inactive'}`}>
                      {student.accountActive ? 'Active' : student.authUserId ? 'Disabled' : 'Not issued'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!isLoading && visibleStudents.length > 0 && (
        <nav className="student-directory-pagination" aria-label="Student directory pages">
          <span>
            Showing {firstVisibleStudent}–{lastVisibleStudent} of {visibleStudents.length} learners
          </span>
          <div>
            <button
              className="sign-out-button"
              disabled={currentPage === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              type="button"
            >
              Previous
            </button>
            <span aria-live="polite">Page {currentPage + 1} of {pageCount}</span>
            <button
              className="sign-out-button"
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
              type="button"
            >
              Next
            </button>
          </div>
        </nav>
      )}
    </section>
  );
}
