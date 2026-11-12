import { useEffect, useState } from 'react';
import { SENIOR_SECONDARY_STREAMS } from '../domain/streams';
import { supabase } from '../lib/supabase';

type UnassignedEnrollment = {
  id: string;
  studentId: string;
  studentName: string;
  serial: string;
  className: string;
  sessionName: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export default function StudentStreamAssignmentPanel({
  classes,
  onAssigned,
  refreshKey,
}: {
  classes: readonly { id: string; name: string; level: string }[];
  onAssigned: () => void;
  refreshKey: number;
}) {
  const [enrollments, setEnrollments] = useState<UnassignedEnrollment[]>([]);
  const [streams, setStreams] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadUnassignedEnrollments() {
      if (!supabase) {
        setError('School database is not configured.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const seniorClassIds = classes.filter((item) => item.level === 'SS').map((item) => item.id);
        if (seniorClassIds.length === 0) {
          setEnrollments([]);
          return;
        }
        const { data, error: enrollmentError } = await supabase
          .from('enrollments')
          .select('id,student_id,class_id,session_id')
          .eq('status', 'active')
          .is('stream', null)
          .in('class_id', seniorClassIds);
        if (cancelled) return;
        if (enrollmentError || !Array.isArray(data)) {
          setError('Unassigned Senior Secondary enrollments could not be loaded.');
          return;
        }
        const rows: { id: string; studentId: string; classId: string; sessionId: string }[] = [];
        for (const row of data) {
          if (!isRecord(row)
            || typeof row.id !== 'string'
            || typeof row.student_id !== 'string'
            || typeof row.class_id !== 'string'
            || typeof row.session_id !== 'string') {
            setError('The unassigned enrollment list returned unexpected data.');
            return;
          }
          rows.push({
            id: row.id,
            studentId: row.student_id,
            classId: row.class_id,
            sessionId: row.session_id,
          });
        }
        if (rows.length === 0) {
          setEnrollments([]);
          return;
        }
        const studentIds = [...new Set(rows.map((row) => row.studentId))];
        const sessionIds = [...new Set(rows.map((row) => row.sessionId))];
        const [studentResult, sessionResult] = await Promise.all([
          supabase.from('students').select('id,serial,full_name').in('id', studentIds),
          supabase.from('academic_sessions').select('id,name').in('id', sessionIds),
        ]);
        if (cancelled) return;
        if (studentResult.error || sessionResult.error
          || !Array.isArray(studentResult.data) || !Array.isArray(sessionResult.data)) {
          setError('Learner or academic session details could not be loaded.');
          return;
        }
        const students = new Map<string, { name: string; serial: string }>();
        for (const student of studentResult.data) {
          if (!isRecord(student) || typeof student.id !== 'string'
            || typeof student.full_name !== 'string' || typeof student.serial !== 'string') {
            setError('Learner details returned unexpected data.');
            return;
          }
          students.set(student.id, { name: student.full_name, serial: student.serial });
        }
        const sessions = new Map<string, string>();
        for (const session of sessionResult.data) {
          if (!isRecord(session) || typeof session.id !== 'string' || typeof session.name !== 'string') {
            setError('Academic session details returned unexpected data.');
            return;
          }
          sessions.set(session.id, session.name);
        }
        const classNames = new Map(classes.map((item) => [item.id, item.name]));
        const resolved: UnassignedEnrollment[] = [];
        for (const row of rows) {
          const student = students.get(row.studentId);
          const sessionName = sessions.get(row.sessionId);
          const className = classNames.get(row.classId);
          if (!student || !sessionName || !className) {
            setError('An enrollment references missing learner, class, or session data.');
            return;
          }
          resolved.push({
            id: row.id,
            studentId: row.studentId,
            studentName: student.name,
            serial: student.serial,
            className,
            sessionName,
          });
        }
        setEnrollments(resolved);
      } catch {
        if (!cancelled) setError('Unassigned Senior Secondary enrollments could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadUnassignedEnrollments();
    return () => {
      cancelled = true;
    };
  }, [classes, refreshKey]);

  async function assign(enrollmentId: string) {
    const stream = streams[enrollmentId];
    const reason = reasons[enrollmentId]?.trim() ?? '';
    if (!supabase || !stream || !reason || savingId) return;
    setSavingId(enrollmentId);
    setError('');
    setMessage('');
    try {
      const { error: assignmentError } = await supabase.rpc('assign_student_stream', {
        p_enrollment_id: enrollmentId,
        p_stream: stream,
        p_reason: reason,
      });
      if (assignmentError) {
        setError('The stream could not be assigned. The enrollment may already have been assigned; refresh and review it.');
        return;
      }
      setEnrollments((current) => current.filter((enrollment) => enrollment.id !== enrollmentId));
      setStreams((current) => {
        const next = { ...current };
        delete next[enrollmentId];
        return next;
      });
      setReasons((current) => {
        const next = { ...current };
        delete next[enrollmentId];
        return next;
      });
      setMessage('Stream assigned and recorded in the audit history.');
      onAssigned();
    } catch {
      setError('The stream assignment could not be confirmed. Refresh the list before trying again.');
    } finally {
      setSavingId('');
    }
  }

  return (
    <section className="family-panel" aria-labelledby="stream-assignment-heading">
      <div className="family-panel-heading">
        <div>
          <span className="eyebrow">Senior Secondary</span>
          <h2 id="stream-assignment-heading">Assign existing learners to a stream</h2>
        </div>
        <span className="attendance-count">{enrollments.length} unassigned</span>
      </div>
      <p className="provisioning-context">
        Existing active SS enrollments need a stream before assessment subjects or results can be processed.
        Assignments are audited; changing an assigned stream is not enabled.
      </p>
      {error && <p className="form-notice" role="alert">{error}</p>}
      {message && <p className="success-notice" role="status">{message}</p>}
      {loading ? (
        <p className="empty-state">Loading unassigned Senior Secondary enrollments…</p>
      ) : enrollments.length === 0 ? (
        <p className="empty-state">There are no active Senior Secondary enrollments awaiting stream assignment.</p>
      ) : (
        <ul className="report-history-list">
          {enrollments.map((enrollment) => (
            <li key={enrollment.id}>
              <div className="report-history-summary">
                <strong>{enrollment.studentName} · {enrollment.serial}</strong>
                <span>{enrollment.className} · {enrollment.sessionName}</span>
              </div>
              <div className="student-directory-controls">
                <label>
                  <span className="field-label">Stream</span>
                  <select
                    className="text-field"
                    disabled={savingId === enrollment.id}
                    onChange={(event) => setStreams((current) => ({
                      ...current,
                      [enrollment.id]: event.target.value,
                    }))}
                    value={streams[enrollment.id] ?? ''}
                  >
                    <option value="">Select stream</option>
                    {SENIOR_SECONDARY_STREAMS.map((stream) => (
                      <option key={stream} value={stream}>{stream}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="field-label">Reason for assignment</span>
                  <input
                    className="text-field"
                    maxLength={500}
                    minLength={5}
                    onChange={(event) => setReasons((current) => ({
                      ...current,
                      [enrollment.id]: event.target.value,
                    }))}
                    value={reasons[enrollment.id] ?? ''}
                  />
                </label>
                <button
                  className="sign-out-button"
                  disabled={savingId === enrollment.id || !streams[enrollment.id]
                    || (reasons[enrollment.id]?.trim().length ?? 0) < 5}
                  onClick={() => void assign(enrollment.id)}
                  type="button"
                >
                  {savingId === enrollment.id ? 'Assigning…' : 'Assign stream'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
