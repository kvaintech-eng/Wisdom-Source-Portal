import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

type StudentOption = { id: string; serial: string; full_name: string };
type SessionOption = { id: string; name: string; starts_on: string };
type ClassOption = { id: string; name: string; display_order: number };
type PromotionKind = 'normal' | 'repeat' | 'double' | 'special_placement' | 'graduation';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseStudents(value: unknown): StudentOption[] | null {
  if (!Array.isArray(value)) return null;
  const students: StudentOption[] = [];
  for (const row of value) {
    if (!isRecord(row)
      || typeof row.id !== 'string'
      || typeof row.serial !== 'string'
      || typeof row.full_name !== 'string') {
      return null;
    }
    students.push({ id: row.id, serial: row.serial, full_name: row.full_name });
  }
  return students;
}

function parseSessions(value: unknown): SessionOption[] | null {
  if (!Array.isArray(value)) return null;
  const sessions: SessionOption[] = [];
  for (const row of value) {
    if (!isRecord(row)
      || typeof row.id !== 'string'
      || typeof row.name !== 'string'
      || typeof row.starts_on !== 'string') {
      return null;
    }
    sessions.push({ id: row.id, name: row.name, starts_on: row.starts_on });
  }
  return sessions;
}

function parseClasses(value: unknown): ClassOption[] | null {
  if (!Array.isArray(value)) return null;
  const classes: ClassOption[] = [];
  for (const row of value) {
    if (!isRecord(row)
      || typeof row.id !== 'string'
      || typeof row.name !== 'string'
      || typeof row.display_order !== 'number') {
      return null;
    }
    classes.push({ id: row.id, name: row.name, display_order: row.display_order });
  }
  return classes;
}

function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function StudentLifecyclePanel({
  onStudentListChanged,
  refreshKey,
}: {
  onStudentListChanged: () => void;
  refreshKey: number;
}) {
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [futureSessions, setFutureSessions] = useState<SessionOption[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [promotionStudentId, setPromotionStudentId] = useState('');
  const [effectiveSessionId, setEffectiveSessionId] = useState('');
  const [destinationClassId, setDestinationClassId] = useState('');
  const [promotionKind, setPromotionKind] = useState<PromotionKind>('normal');
  const [promotionReason, setPromotionReason] = useState('');
  const [archiveStudentId, setArchiveStudentId] = useState('');
  const [archiveReason, setArchiveReason] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadOptions() {
      if (!supabase) {
        setError('School database is not configured.');
        setIsLoading(false);
        return;
      }
      try {
        const [studentResult, sessionResult, classResult] = await Promise.all([
          supabase.from('students').select('id,serial,full_name').eq('active', true).order('full_name').limit(1000),
          supabase.from('academic_sessions').select('id,name,starts_on').order('starts_on'),
          supabase.from('classes').select('id,name,display_order').eq('active', true).order('display_order'),
        ]);
        if (cancelled) return;
        if (studentResult.error || sessionResult.error || classResult.error) {
          setError('Student, session, or class options could not be loaded.');
          return;
        }
        const parsedStudents = parseStudents(studentResult.data);
        const parsedSessions = parseSessions(sessionResult.data);
        const parsedClasses = parseClasses(classResult.data);
        if (!parsedStudents || !parsedSessions || !parsedClasses) {
          setError('School options returned an unexpected response.');
          return;
        }
        const availableSessions = parsedSessions.filter((session) => session.starts_on > localDateString(new Date()));
        setStudents(parsedStudents);
        setFutureSessions(availableSessions);
        setClasses(parsedClasses);
        setPromotionStudentId(parsedStudents[0]?.id ?? '');
        setArchiveStudentId(parsedStudents[0]?.id ?? '');
        setEffectiveSessionId(availableSessions[0]?.id ?? '');
        setDestinationClassId(parsedClasses[0]?.id ?? '');
      } catch {
        if (!cancelled) setError('School options could not be loaded. Check your connection and try again.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  async function approvePromotion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || isSaving || !promotionStudentId || !effectiveSessionId
      || (promotionKind !== 'graduation' && !destinationClassId)
      || promotionReason.trim().length < 5) return;
    setIsSaving(true);
    setError('');
    setMessage('');
    try {
      const { error: promotionError } = await supabase.rpc('approve_student_promotion', {
        p_student_id: promotionStudentId,
        p_effective_session_id: effectiveSessionId,
        p_kind: promotionKind,
        p_destination_class_id: promotionKind === 'graduation' ? null : destinationClassId,
        p_reason: promotionReason.trim(),
      });
      if (promotionError) {
        setError('The promotion was not recorded. Confirm the learner has a prior enrollment and that the destination session is in the future.');
        return;
      }
      const student = students.find((item) => item.id === promotionStudentId);
      const session = futureSessions.find((item) => item.id === effectiveSessionId);
      setPromotionReason('');
      setMessage(`${student?.full_name ?? 'Learner'}'s ${promotionKind.replace('_', ' ')} decision was saved for ${session?.name ?? 'the selected session'}.`);
    } catch {
      setError('The promotion was not recorded. Check your connection and try again.');
    } finally {
      setIsSaving(false);
    }
  }

  async function archiveStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || isSaving || !archiveStudentId || archiveReason.trim().length < 5) return;
    const student = students.find((item) => item.id === archiveStudentId);
    const confirmed = window.confirm(
      `Archive ${student?.full_name ?? 'this learner'}? This disables the learner account and active parent links. This action cannot be undone from this portal.`,
    );
    if (!confirmed) return;
    setIsSaving(true);
    setError('');
    setMessage('');
    try {
      const { error: archiveError } = await supabase.rpc('archive_student', {
        p_student_id: archiveStudentId,
        p_reason: archiveReason.trim(),
      });
      if (archiveError) {
        setError('The learner could not be archived. Verify the account is active and try again.');
        return;
      }
      const remainingStudents = students.filter((item) => item.id !== archiveStudentId);
      setStudents(remainingStudents);
      setArchiveStudentId(remainingStudents[0]?.id ?? '');
      if (promotionStudentId === archiveStudentId) {
        setPromotionStudentId(remainingStudents[0]?.id ?? '');
      }
      setArchiveReason('');
      setMessage(`${student?.full_name ?? 'Learner'} was archived. The access change has been recorded in the audit log.`);
      onStudentListChanged();
    } catch {
      setError('The learner could not be archived. Check your connection and try again.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="family-panel lifecycle-panel" aria-labelledby="lifecycle-heading">
      <div className="family-panel-heading">
        <div>
          <span className="eyebrow">Student administration</span>
          <h2 id="lifecycle-heading">Promotion and archive</h2>
        </div>
      </div>
      {isLoading ? (
        <p className="empty-state">Loading student lifecycle options…</p>
      ) : (
        <div className="updates-forms lifecycle-forms">
          <form className="update-form" onSubmit={(event) => void approvePromotion(event)}>
            <h3>Record a promotion decision</h3>
            <label>
              <span className="field-label">Learner</span>
              <select
                className="text-field"
                disabled={students.length === 0}
                onChange={(event) => setPromotionStudentId(event.target.value)}
                required
                value={promotionStudentId}
              >
                {students.length === 0 && <option value="">No active learners</option>}
                {students.map((student) => (
                  <option key={student.id} value={student.id}>{student.full_name} · {student.serial}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="field-label">Effective academic session</span>
              <select
                className="text-field"
                disabled={futureSessions.length === 0}
                onChange={(event) => setEffectiveSessionId(event.target.value)}
                required
                value={effectiveSessionId}
              >
                {futureSessions.length === 0 && <option value="">No future sessions are configured</option>}
                {futureSessions.map((session) => (
                  <option key={session.id} value={session.id}>{session.name} · starts {session.starts_on}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="field-label">Decision</span>
              <select
                className="text-field"
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === 'normal' || value === 'repeat' || value === 'double'
                    || value === 'special_placement' || value === 'graduation') {
                    setPromotionKind(value);
                  }
                }}
                value={promotionKind}
              >
                <option value="normal">Normal promotion</option>
                <option value="repeat">Repeat current class</option>
                <option value="double">Double promotion</option>
                <option value="special_placement">Special placement</option>
                <option value="graduation">Graduation</option>
              </select>
            </label>
            {promotionKind !== 'graduation' && (
              <label>
                <span className="field-label">Destination class</span>
                <select
                  className="text-field"
                  disabled={classes.length === 0}
                  onChange={(event) => setDestinationClassId(event.target.value)}
                  required
                  value={destinationClassId}
                >
                  {classes.length === 0 && <option value="">No active classes are configured</option>}
                  {classes.map((schoolClass) => (
                    <option key={schoolClass.id} value={schoolClass.id}>{schoolClass.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <span className="field-label">Reason (required)</span>
              <textarea
                className="text-field update-textarea"
                maxLength={500}
                minLength={5}
                onChange={(event) => setPromotionReason(event.target.value)}
                required
                value={promotionReason}
              />
            </label>
            <button className="sign-in-button" disabled={isSaving || students.length === 0 || futureSessions.length === 0} type="submit">
              <span>{isSaving ? 'Saving decision…' : 'Save promotion decision'}</span>
            </button>
          </form>
          <form className="update-form" onSubmit={(event) => void archiveStudent(event)}>
            <h3>Archive a learner account</h3>
            <p className="provisioning-context">
              Archiving disables learner sign-in and active parent links while preserving the academic record.
            </p>
            <label>
              <span className="field-label">Active learner</span>
              <select
                className="text-field"
                disabled={students.length === 0}
                onChange={(event) => setArchiveStudentId(event.target.value)}
                required
                value={archiveStudentId}
              >
                {students.length === 0 && <option value="">No active learners</option>}
                {students.map((student) => (
                  <option key={student.id} value={student.id}>{student.full_name} · {student.serial}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="field-label">Archive reason (required)</span>
              <textarea
                className="text-field update-textarea"
                maxLength={500}
                minLength={5}
                onChange={(event) => setArchiveReason(event.target.value)}
                required
                value={archiveReason}
              />
            </label>
            <button className="sign-out-button archive-student-button" disabled={isSaving || students.length === 0} type="submit">
              {isSaving ? 'Saving…' : 'Archive learner'}
            </button>
          </form>
        </div>
      )}
      {error && <p className="form-notice lifecycle-notice" role="alert">{error}</p>}
      {message && <p className="success-notice lifecycle-notice" role="status">{message}</p>}
    </section>
  );
}
