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
  isActive: boolean;
  authUserId: string | null;
  enrollmentStatus: EnrollmentStatus;
  accountActive: boolean;
};
type DirectoryFilter = 'all' | 'active' | 'archived' | 'no-account';
type DirectoryClass = { id: string; name: string };

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
        const { data: enrollmentData, error: enrollmentError } = await supabase
          .from('enrollments')
          .select('student_id,status,class_id')
          .eq('session_id', sessionId)
          .order('student_id');
        if (cancelled) return;
        if (enrollmentError || !Array.isArray(enrollmentData)) {
          setError('The selected class enrollment list could not be loaded.');
          return;
        }
        const enrollments = enrollmentData.flatMap((row) => (
          isRecord(row)
          && typeof row.student_id === 'string'
          && typeof row.class_id === 'string'
          && (row.status === 'active' || row.status === 'withdrawn' || row.status === 'completed')
            ? [{ studentId: row.student_id, classId: row.class_id, status: row.status }]
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

        const studentIds = enrollments.map((enrollment) => enrollment.studentId);
        const { data: studentData, error: studentError } = await supabase
          .from('students')
          .select('id,serial,full_name,gender,active,auth_user_id')
          .in('id', studentIds)
          .order('full_name');
        if (cancelled) return;
        if (studentError || !Array.isArray(studentData)) {
          setError('Student details for the selected session could not be loaded.');
          return;
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

        const enrollmentByStudent = new Map(enrollments.map((enrollment) => [
          enrollment.studentId,
          { classId: enrollment.classId, status: enrollment.status },
        ]));
        const classNames = new Map(classes.map((schoolClass) => [
          schoolClass.id,
          schoolClass.name,
        ]));
        setStudents(parsedStudents.flatMap((student) => {
          const enrollment = enrollmentByStudent.get(student.id);
          if (!enrollment) return [];
          return [{
            ...student,
            classId: enrollment.classId,
            className: classNames.get(enrollment.classId) ?? 'Unavailable class',
            enrollmentStatus: enrollment.status,
            accountActive: student.authUserId !== null
              && accountStatuses.get(student.authUserId) === true,
          }];
        }));
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
            onChange={(event) => setSearch(event.target.value)}
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
            onChange={(event) => setClassFilter(event.target.value)}
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
                <th scope="col">Class</th>
                <th scope="col">Enrollment</th>
                <th scope="col">Account</th>
              </tr>
            </thead>
            <tbody>
              {visibleStudents.map((student) => (
                <tr key={student.id}>
                  <td>
                    <strong>{student.fullName}</strong>
                    {student.gender && <small>{student.gender}</small>}
                  </td>
                  <td><code>{student.serial}</code></td>
                  <td>{student.className}</td>
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
    </section>
  );
}
