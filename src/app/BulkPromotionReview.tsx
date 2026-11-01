import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, GraduationCap, RotateCcw, UsersRound } from 'lucide-react';
import { suggestPromotion, type PromotionKind } from '../domain/promotions';
import { supabase } from '../lib/supabase';

type ReviewStatus = 'pending' | 'recorded' | 'failed';
type SessionOption = { id: string; name: string; starts_on: string; is_active: boolean };
type ClassOption = {
  id: string;
  name: string;
  level: string;
  active: boolean;
  display_order: number;
  next_class_id: string | null;
};
type PromotionRow = {
  student_id: string;
  serial: string;
  full_name: string;
  current_class_id: string;
  kind: PromotionKind;
  destination_class_id: string;
  reason: string;
  status: ReviewStatus;
  error?: string;
};

const VALID_KINDS = new Set<PromotionKind>([
  'normal', 'repeat', 'double', 'special_placement', 'graduation',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseSessions(value: unknown): SessionOption[] | null {
  if (!Array.isArray(value)) return null;
  const rows: SessionOption[] = [];
  for (const row of value) {
    if (!isRecord(row)
      || typeof row.id !== 'string'
      || typeof row.name !== 'string'
      || typeof row.starts_on !== 'string'
      || typeof row.is_active !== 'boolean') return null;
    rows.push({
      id: row.id,
      name: row.name,
      starts_on: row.starts_on,
      is_active: row.is_active,
    });
  }
  return rows;
}

function parseClasses(value: unknown): ClassOption[] | null {
  if (!Array.isArray(value)) return null;
  const rows: ClassOption[] = [];
  for (const row of value) {
    if (!isRecord(row)
      || typeof row.id !== 'string'
      || typeof row.name !== 'string'
      || typeof row.level !== 'string'
      || typeof row.active !== 'boolean'
      || typeof row.display_order !== 'number'
      || (row.next_class_id !== null && typeof row.next_class_id !== 'string')) return null;
    rows.push({
      id: row.id,
      name: row.name,
      level: row.level,
      active: row.active,
      display_order: row.display_order,
      next_class_id: row.next_class_id,
    });
  }
  return rows;
}

export default function BulkPromotionReview({ refreshKey }: { refreshKey: number }) {
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [targetSessionId, setTargetSessionId] = useState('');
  const [rows, setRows] = useState<PromotionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const activeSession = sessions.find((session) => session.is_active);
  const activeSessionId = activeSession?.id;
  const futureSessions = sessions.filter((session) => session.starts_on > today);
  const destinationClasses = classes.filter((schoolClass) => schoolClass.active);
  const classesById = useMemo(() => new Map(classes.map((schoolClass) => [
    schoolClass.id,
    schoolClass,
  ])), [classes]);

  useEffect(() => {
    let cancelled = false;
    async function loadOptions() {
      if (!supabase) {
        setError('School database is not configured.');
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError('');
      try {
        const [sessionResult, classResult] = await Promise.all([
          supabase.from('academic_sessions')
            .select('id,name,starts_on,is_active')
            .order('starts_on'),
          supabase.from('classes')
            .select('id,name,level,active,display_order,next_class_id')
            .order('display_order'),
        ]);
        if (cancelled) return;
        if (sessionResult.error || classResult.error) {
          setError('Academic sessions or class progression could not be loaded.');
          return;
        }
        const parsedSessions = parseSessions(sessionResult.data);
        const parsedClasses = parseClasses(classResult.data);
        if (!parsedSessions || !parsedClasses) {
          setError('Academic sessions or classes returned an unexpected response.');
          return;
        }
        setSessions(parsedSessions);
        setClasses(parsedClasses);
        const upcoming = parsedSessions.find((session) => session.starts_on > today);
        setTargetSessionId((current) => parsedSessions.some((session) => (
          session.id === current && session.starts_on > today
        )) ? current : upcoming?.id ?? '');
      } catch {
        if (!cancelled) setError('Promotion review options could not be loaded. Check your connection and try again.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, today]);

  useEffect(() => {
    let cancelled = false;
    async function loadReview() {
      if (!supabase || !activeSessionId || !targetSessionId) {
        setRows([]);
        return;
      }
      setIsLoading(true);
      setError('');
      setMessage('');
      try {
        const { data: enrollmentData, error: enrollmentError } = await supabase
          .from('enrollments')
          .select('student_id,class_id')
          .eq('session_id', activeSessionId)
          .eq('status', 'active');
        if (enrollmentError) {
          setError('Learner enrollments for the active session could not be loaded.');
          return;
        }
        const enrollments = (enrollmentData ?? []).filter((row) =>
          typeof row.student_id === 'string' && typeof row.class_id === 'string');
        if (enrollments.length === 0) {
          setRows([]);
          return;
        }
        const studentIds = [...new Set(enrollments.map((row) => row.student_id))];
        const [studentResult, decisionResult] = await Promise.all([
          supabase.from('students')
            .select('id,serial,full_name')
            .eq('active', true)
            .in('id', studentIds)
            .order('full_name'),
          supabase.from('promotion_decisions')
            .select('student_id,kind,destination_class_id')
            .eq('effective_session_id', targetSessionId),
        ]);
        if (cancelled) return;
        if (studentResult.error || decisionResult.error) {
          setError('Learner profiles or existing promotion decisions could not be loaded.');
          return;
        }
        const students = (studentResult.data ?? []).filter((student) =>
          typeof student.id === 'string'
          && typeof student.serial === 'string'
          && typeof student.full_name === 'string');
        const existingByStudent = new Map(
          (decisionResult.data ?? [])
            .filter((decision) => typeof decision.student_id === 'string')
            .map((decision) => [decision.student_id, decision]),
        );
        const firstClassByStudent = new Map<string, string>();
        for (const enrollment of enrollments) {
          if (!firstClassByStudent.has(enrollment.student_id)) {
            firstClassByStudent.set(enrollment.student_id, enrollment.class_id);
          }
        }
        const reviewRows: PromotionRow[] = [];
        for (const student of students) {
          const currentClassId = firstClassByStudent.get(student.id);
          const currentClass = currentClassId ? classesById.get(currentClassId) : undefined;
          if (!currentClassId || !currentClass) continue;
          const suggestion = suggestPromotion(currentClass, classesById);
          const existing = existingByStudent.get(student.id);
          reviewRows.push({
            student_id: student.id,
            serial: student.serial,
            full_name: student.full_name,
            current_class_id: currentClassId,
            ...suggestion,
            ...(existing && typeof existing.kind === 'string' && VALID_KINDS.has(existing.kind as PromotionKind)
              ? {
                  kind: existing.kind as PromotionKind,
                  destination_class_id: typeof existing.destination_class_id === 'string'
                    ? existing.destination_class_id
                    : '',
                  status: 'recorded' as const,
                }
              : { status: 'pending' as const }),
          });
        }
        setRows(reviewRows);
      } catch {
        if (!cancelled) setError('Promotion review could not be loaded. Check your connection and try again.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadReview();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, classesById, targetSessionId]);

  function updateDecision(studentId: string, updates: Partial<PromotionRow>) {
    setRows((current) => current.map((row) => row.student_id === studentId
      ? { ...row, ...updates }
      : row));
    setError('');
    setMessage('');
  }

  function changeKind(row: PromotionRow, kind: PromotionKind) {
    const currentClass = classesById.get(row.current_class_id);
    const suggestion = currentClass
      ? suggestPromotion(currentClass, classesById)
      : { kind: 'special_placement' as const, destination_class_id: '', reason: '' };
    const nextClass = currentClass?.next_class_id
      ? classesById.get(currentClass.next_class_id)
      : undefined;
    let destinationClassId = suggestion.destination_class_id;
    const reason = `End-of-session ${kind.replace('_', ' ')}`;
    if (kind === 'repeat') {
      destinationClassId = row.current_class_id;
    } else if (kind === 'double') {
      const doublePromotionClass = nextClass?.next_class_id
        ? classesById.get(nextClass.next_class_id)
        : undefined;
      destinationClassId = doublePromotionClass?.active ? doublePromotionClass.id : '';
    } else if (kind === 'special_placement') {
      destinationClassId = '';
    } else if (kind === 'graduation') {
      destinationClassId = '';
    }
    updateDecision(row.student_id, {
      kind,
      destination_class_id: destinationClassId,
      reason: kind === 'normal' && suggestion.kind === 'graduation'
        ? 'End-of-session normal promotion'
        : reason,
      status: 'pending',
    });
  }

  async function saveReview() {
    if (!supabase || isSaving || !targetSessionId) return;
    const pending = rows.filter((row) => row.status !== 'recorded');
    if (pending.length === 0) return;
    if (pending.some((row) => row.reason.trim().length < 5
      || (row.kind !== 'graduation' && !row.destination_class_id))) {
      setError('Complete a destination class and a reason of at least five characters for every learner before confirming.');
      return;
    }
    const sessionName = futureSessions.find((session) => session.id === targetSessionId)?.name
      ?? 'the selected future session';
    const confirmed = window.confirm(
      `Record ${pending.length} promotion decision${pending.length === 1 ? '' : 's'} for ${sessionName}? This will create future enrollments for learners with a class destination. Graduation decisions will not archive learners or disable their accounts.`,
    );
    if (!confirmed) return;

    setIsSaving(true);
    setError('');
    setMessage('');
    let recordedCount = 0;
    let failedCount = 0;
    for (const row of pending) {
      try {
        const { error: saveError } = await supabase.rpc('approve_student_promotion', {
          p_student_id: row.student_id,
          p_effective_session_id: targetSessionId,
          p_kind: row.kind,
          p_destination_class_id: row.kind === 'graduation' ? null : row.destination_class_id,
          p_reason: row.reason.trim(),
        });
        if (saveError) {
          failedCount += 1;
          updateDecision(row.student_id, {
            status: 'failed',
            error: 'Could not record. Check the destination session, existing enrollment, or prior decision.',
          });
        } else {
          recordedCount += 1;
          updateDecision(row.student_id, { status: 'recorded', error: undefined });
        }
      } catch {
        failedCount += 1;
        updateDecision(row.student_id, {
          status: 'failed',
          error: 'Could not connect to record this decision. Retry after checking your connection.',
        });
      }
    }
    setIsSaving(false);
    setMessage(
      `${recordedCount} decision${recordedCount === 1 ? '' : 's'} recorded${failedCount > 0
        ? `; ${failedCount} need review and can be retried`
        : ''}.`,
    );
  }

  const pendingCount = rows.filter((row) => row.status !== 'recorded').length;
  const graduatedCount = rows.filter((row) => row.status !== 'recorded' && row.kind === 'graduation').length;

  return (
    <section className="family-panel bulk-promotion-panel" aria-labelledby="bulk-promotion-heading">
      <div className="family-panel-heading">
        <div>
          <span className="eyebrow">End-of-session workflow</span>
          <h2 id="bulk-promotion-heading">Promotion review</h2>
        </div>
        <span className="family-profile-icon"><UsersRound size={17} aria-hidden="true" /></span>
      </div>
      <p className="bulk-promotion-intro">
        Review each active learner in the active session, then confirm decisions for a future session.
        Suggestions follow the configured class sequence; you can change any learner before saving.
      </p>
      <div className="bulk-promotion-controls">
        <label>
          <span className="field-label">Future academic session</span>
          <select
            className="text-field"
            disabled={isLoading || futureSessions.length === 0}
            onChange={(event) => setTargetSessionId(event.target.value)}
            value={targetSessionId}
          >
            {futureSessions.length === 0 && <option value="">No future sessions configured</option>}
            {futureSessions.map((session) => (
              <option key={session.id} value={session.id}>{session.name} · starts {session.starts_on}</option>
            ))}
          </select>
        </label>
        <div className="bulk-promotion-source">
          <span className="field-label">Learners from</span>
          <strong>{activeSession?.name ?? 'No active session'}</strong>
        </div>
      </div>
      {error && <p className="form-notice lifecycle-notice" role="alert">{error}</p>}
      {message && <p className="success-notice lifecycle-notice" role="status">{message}</p>}
      {isLoading ? (
        <p className="empty-state">Preparing the learner review…</p>
      ) : !activeSession ? (
        <p className="empty-state">Set an active academic session before reviewing promotions.</p>
      ) : !targetSessionId ? (
        <p className="empty-state">Create a future academic session before recording end-of-session decisions.</p>
      ) : rows.length === 0 ? (
        <p className="empty-state">No active learner enrollments were found for the active session.</p>
      ) : (
        <>
          <div className="bulk-promotion-summary" aria-live="polite">
            <span><strong>{rows.length}</strong> learners</span>
            <span><strong>{pendingCount}</strong> decisions to review</span>
            <span><strong>{graduatedCount}</strong> suggested graduations</span>
          </div>
          <div className="attendance-table-wrap bulk-promotion-table-wrap">
            <table className="attendance-table bulk-promotion-table">
              <thead>
                <tr>
                  <th scope="col">Learner</th>
                  <th scope="col">Current class</th>
                  <th scope="col">Decision</th>
                  <th scope="col">Next session class</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Review</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.student_id}>
                    <td><strong>{row.full_name}</strong><small>{row.serial}</small></td>
                    <td>{classesById.get(row.current_class_id)?.name ?? 'Unknown class'}</td>
                    <td>
                      <select
                        aria-label={`Promotion decision for ${row.full_name}`}
                        className="text-field bulk-promotion-input"
                        disabled={isSaving || row.status === 'recorded'}
                        onChange={(event) => {
                          const kind = event.target.value;
                          if (VALID_KINDS.has(kind as PromotionKind)) {
                            changeKind(row, kind as PromotionKind);
                          }
                        }}
                        value={row.kind}
                      >
                        <option value="normal">Promote one class</option>
                        <option value="repeat">Repeat current class</option>
                        <option value="double">Double promotion</option>
                        <option value="special_placement">Special placement</option>
                        <option value="graduation">Graduate</option>
                      </select>
                    </td>
                    <td>
                      {row.kind === 'graduation' ? (
                        <span className="bulk-promotion-graduation"><GraduationCap size={15} aria-hidden="true" /> Graduating</span>
                      ) : (
                        <select
                          aria-label={`Destination class for ${row.full_name}`}
                          className="text-field bulk-promotion-input"
                          disabled={isSaving || row.status === 'recorded'}
                          onChange={(event) => updateDecision(row.student_id, {
                            destination_class_id: event.target.value,
                            status: 'pending',
                          })}
                          value={row.destination_class_id}
                        >
                          <option value="">Select class</option>
                          {destinationClasses.map((schoolClass) => (
                            <option key={schoolClass.id} value={schoolClass.id}>{schoolClass.name}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      <input
                        aria-label={`Reason for ${row.full_name}`}
                        className="text-field bulk-promotion-input"
                        disabled={isSaving || row.status === 'recorded'}
                        maxLength={500}
                        minLength={5}
                        onChange={(event) => updateDecision(row.student_id, {
                          reason: event.target.value,
                          status: 'pending',
                        })}
                        value={row.reason}
                      />
                    </td>
                    <td>
                      <span className={`bulk-promotion-status bulk-promotion-status-${row.status}`}>
                        {row.status === 'recorded' ? 'Recorded' : row.status === 'failed' ? 'Needs retry' : 'Review'}
                      </span>
                      {row.error && <small className="bulk-promotion-row-error">{row.error}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bulk-promotion-footer">
            <p>
              {graduatedCount > 0
                ? 'Graduation records do not archive learners or disable their portal accounts.'
                : 'No learner records change until you confirm the decisions below.'}
            </p>
            <button
              className="sign-in-button bulk-promotion-submit"
              disabled={isSaving || pendingCount === 0}
              onClick={() => void saveReview()}
              type="button"
            >
              <span>{isSaving ? 'Recording decisions…' : `Review and record ${pendingCount} decision${pendingCount === 1 ? '' : 's'}`}</span>
              {isSaving ? <RotateCcw size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
