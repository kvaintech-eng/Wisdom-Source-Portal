import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

type AcademicTerm = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
};

type AcademicSession = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  is_active: boolean;
};

const TERM_NAMES = ['First Term', 'Second Term', 'Third Term'] as const;
const WEEKDAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseSessions(value: unknown): AcademicSession[] | null {
  if (!Array.isArray(value)) return null;
  const sessions: AcademicSession[] = [];
  for (const row of value) {
    if (!isRecord(row)
      || typeof row.id !== 'string'
      || typeof row.name !== 'string'
      || typeof row.starts_on !== 'string'
      || typeof row.ends_on !== 'string'
      || typeof row.is_active !== 'boolean') {
      return null;
    }
    sessions.push({
      id: row.id,
      name: row.name,
      starts_on: row.starts_on,
      ends_on: row.ends_on,
      is_active: row.is_active,
    });
  }
  return sessions;
}

function parseTerms(value: unknown): AcademicTerm[] | null {
  if (!Array.isArray(value)) return null;
  const terms: AcademicTerm[] = [];
  for (const row of value) {
    if (!isRecord(row)
      || typeof row.id !== 'string'
      || typeof row.name !== 'string'
      || typeof row.starts_on !== 'string'
      || typeof row.ends_on !== 'string') {
      return null;
    }
    terms.push({
      id: row.id,
      name: row.name,
      starts_on: row.starts_on,
      ends_on: row.ends_on,
    });
  }
  return terms;
}

export default function AcademicConfigurationPanel({
  onSessionListChanged,
  onTermListChanged,
}: {
  onSessionListChanged: (activeSessionId?: string) => void;
  onTermListChanged: () => void;
}) {
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [terms, setTerms] = useState<AcademicTerm[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [sessionStartsOn, setSessionStartsOn] = useState('');
  const [sessionEndsOn, setSessionEndsOn] = useState('');
  const [activateNewSession, setActivateNewSession] = useState(false);
  const [termName, setTermName] = useState<(typeof TERM_NAMES)[number]>('First Term');
  const [termStartsOn, setTermStartsOn] = useState('');
  const [termEndsOn, setTermEndsOn] = useState('');
  const [openWeekdays, setOpenWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [isSavingTerm, setIsSavingTerm] = useState(false);
  const [isActivating, setIsActivating] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadSessions() {
      if (!supabase) {
        setError('School database is not configured.');
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError('');
      try {
        const { data, error: loadError } = await supabase
          .from('academic_sessions')
          .select('id,name,starts_on,ends_on,is_active')
          .order('starts_on', { ascending: false });
        if (cancelled) return;
        if (loadError) {
          setError('Academic sessions could not be loaded. Refresh or contact the system administrator.');
          return;
        }
        const parsed = parseSessions(data);
        if (!parsed) {
          setError('Academic sessions returned an unexpected response.');
          return;
        }
        setSessions(parsed);
        setSelectedSessionId((current) => parsed.some((session) => session.id === current)
          ? current
          : parsed.find((session) => session.is_active)?.id ?? parsed[0]?.id ?? '');
      } catch {
        if (!cancelled) setError('Academic sessions could not be loaded. Check your connection and try again.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadSessions();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  useEffect(() => {
    let cancelled = false;
    async function loadTerms() {
      if (!supabase || !selectedSessionId) {
        setTerms([]);
        return;
      }
      try {
        const { data, error: loadError } = await supabase
          .from('academic_terms')
          .select('id,name,starts_on,ends_on')
          .eq('session_id', selectedSessionId)
          .order('starts_on');
        if (cancelled) return;
        if (loadError) {
          setError('Terms for the selected session could not be loaded.');
          return;
        }
        const parsed = parseTerms(data);
        if (!parsed) {
          setError('Academic terms returned an unexpected response.');
          return;
        }
        setTerms(parsed);
        setTermName(TERM_NAMES.find((name) => !parsed.some((term) => term.name === name)) ?? 'First Term');
      } catch {
        if (!cancelled) setError('Terms for the selected session could not be loaded. Check your connection.');
      }
    }
    void loadTerms();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, selectedSessionId]);

  const selectedSession = sessions.find((session) => session.id === selectedSessionId);
  const missingTermNames = TERM_NAMES.filter((name) => !terms.some((term) => term.name === name));

  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || isSavingSession || !sessionName.trim()
      || !sessionStartsOn || !sessionEndsOn || sessionStartsOn > sessionEndsOn) return;
    setIsSavingSession(true);
    setError('');
    setMessage('');
    try {
      const { data, error: saveError } = await supabase.rpc('create_academic_session', {
        p_name: sessionName.trim(),
        p_starts_on: sessionStartsOn,
        p_ends_on: sessionEndsOn,
        p_activate: activateNewSession,
      });
      if (saveError || typeof data !== 'string') {
        setError(saveError?.code === '23505'
          ? 'An academic session with that name already exists.'
          : 'The academic session could not be created. Verify the name and date range.');
        return;
      }
      setSessionName('');
      setSessionStartsOn('');
      setSessionEndsOn('');
      setActivateNewSession(false);
      setSelectedSessionId(data);
      setMessage('Academic session created and recorded in the audit log.');
      onSessionListChanged(activateNewSession ? data : undefined);
      setRefreshKey((current) => current + 1);
    } catch {
      setError('The academic session could not be created. Check your connection and try again.');
    } finally {
      setIsSavingSession(false);
    }
  }

  async function activateSession(sessionId: string) {
    if (!supabase || isActivating) return;
    const session = sessions.find((item) => item.id === sessionId);
    if (!session || session.is_active) return;
    const confirmed = window.confirm(
      `Set ${session.name} as the active academic session? Family timetable access will use enrollments in this session.`,
    );
    if (!confirmed) return;
    setIsActivating(sessionId);
    setError('');
    setMessage('');
    try {
      const { error: activationError } = await supabase.rpc('activate_academic_session', {
        p_session_id: sessionId,
      });
      if (activationError) {
        setError('The academic session could not be activated. Refresh the session list and try again.');
        return;
      }
      setMessage(`${session.name} is now the active academic session.`);
      onSessionListChanged(sessionId);
      setRefreshKey((current) => current + 1);
    } catch {
      setError('The academic session could not be activated. Check your connection and try again.');
    } finally {
      setIsActivating('');
    }
  }

  async function createTerm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || isSavingTerm || !selectedSessionId || !missingTermNames.includes(termName)
      || !termStartsOn || !termEndsOn || termStartsOn > termEndsOn || openWeekdays.length === 0) return;
    if (selectedSession
      && (termStartsOn < selectedSession.starts_on || termEndsOn > selectedSession.ends_on)) {
      setError('Term dates must fall within the selected academic session.');
      return;
    }
    setIsSavingTerm(true);
    setError('');
    setMessage('');
    try {
      const { data, error: saveError } = await supabase.rpc('create_academic_term', {
        p_session_id: selectedSessionId,
        p_name: termName,
        p_starts_on: termStartsOn,
        p_ends_on: termEndsOn,
        p_open_weekdays: openWeekdays,
      });
      if (saveError || typeof data !== 'string') {
        setError(saveError?.code === '23505'
          ? 'That term already exists in the selected session.'
          : 'The academic term could not be created. Confirm its dates fall within the selected session.');
        return;
      }
      setTermStartsOn('');
      setTermEndsOn('');
      setMessage(`${termName} created and recorded in the audit log.`);
      onTermListChanged();
      setRefreshKey((current) => current + 1);
    } catch {
      setError('The academic term could not be created. Check your connection and try again.');
    } finally {
      setIsSavingTerm(false);
    }
  }

  return (
    <section className="family-panel academic-configuration-panel" aria-labelledby="academic-configuration-heading">
      <div className="family-panel-heading">
        <div>
          <span className="eyebrow">Academic calendar</span>
          <h2 id="academic-configuration-heading">Sessions and terms</h2>
        </div>
      </div>
      {isLoading ? (
        <p className="empty-state">Loading academic sessions…</p>
      ) : (
        <>
          <ul className="academic-session-list">
            {sessions.map((session) => (
              <li key={session.id}>
                <div>
                  <strong>{session.name}{session.is_active ? ' · Active' : ''}</strong>
                  <span>{session.starts_on} to {session.ends_on}</span>
                </div>
                {!session.is_active && (
                  <button
                    className="sign-out-button"
                    disabled={isActivating !== ''}
                    onClick={() => void activateSession(session.id)}
                    type="button"
                  >
                    {isActivating === session.id ? 'Activating…' : 'Set active'}
                  </button>
                )}
              </li>
            ))}
            {sessions.length === 0 && <li><span>No academic sessions have been configured.</span></li>}
          </ul>
          <div className="updates-forms academic-forms">
            <form className="update-form" onSubmit={(event) => void createSession(event)}>
              <h3>Create an academic session</h3>
              <label>
                <span className="field-label">Session name</span>
                <input
                  className="text-field"
                  maxLength={100}
                  onChange={(event) => setSessionName(event.target.value)}
                  required
                  value={sessionName}
                />
              </label>
              <div className="update-date-fields">
                <label>
                  <span className="field-label">Starts on</span>
                  <input
                    className="text-field"
                    onChange={(event) => setSessionStartsOn(event.target.value)}
                    required
                    type="date"
                    value={sessionStartsOn}
                  />
                </label>
                <label>
                  <span className="field-label">Ends on</span>
                  <input
                    className="text-field"
                    min={sessionStartsOn || undefined}
                    onChange={(event) => setSessionEndsOn(event.target.value)}
                    required
                    type="date"
                    value={sessionEndsOn}
                  />
                </label>
              </div>
              <label className="confirmation-option">
                <input
                  checked={activateNewSession}
                  onChange={(event) => setActivateNewSession(event.target.checked)}
                  type="checkbox"
                />
                <span>Make this the active session immediately.</span>
              </label>
              <button className="sign-in-button" disabled={isSavingSession} type="submit">
                <span>{isSavingSession ? 'Creating session…' : 'Create session'}</span>
              </button>
            </form>
            <form className="update-form" onSubmit={(event) => void createTerm(event)}>
              <h3>Add a term</h3>
              <label>
                <span className="field-label">Academic session</span>
                <select
                  className="text-field"
                  disabled={sessions.length === 0}
                  onChange={(event) => setSelectedSessionId(event.target.value)}
                  required
                  value={selectedSessionId}
                >
                  {sessions.length === 0 && <option value="">Create a session first</option>}
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.name}{session.is_active ? ' · Active' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="field-label">Term</span>
                <select
                  className="text-field"
                  disabled={missingTermNames.length === 0}
                  onChange={(event) => {
                    if (TERM_NAMES.some((name) => name === event.target.value)) {
                      setTermName(event.target.value as (typeof TERM_NAMES)[number]);
                    }
                  }}
                  value={termName}
                >
                  {missingTermNames.length === 0 && <option value="">All terms are configured</option>}
                  {missingTermNames.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <div className="update-date-fields">
                <label>
                  <span className="field-label">Starts on</span>
                  <input
                    className="text-field"
                    max={selectedSession?.ends_on}
                    min={selectedSession?.starts_on}
                    onChange={(event) => setTermStartsOn(event.target.value)}
                    required
                    type="date"
                    value={termStartsOn}
                  />
                </label>
                <label>
                  <span className="field-label">Ends on</span>
                  <input
                    className="text-field"
                    max={selectedSession?.ends_on}
                    min={termStartsOn || selectedSession?.starts_on}
                    onChange={(event) => setTermEndsOn(event.target.value)}
                    required
                    type="date"
                    value={termEndsOn}
                  />
                </label>
              </div>
              <fieldset className="weekday-options">
                <legend className="field-label">Scheduled school days</legend>
                <div>
                  {WEEKDAYS.map((day) => (
                    <label className="confirmation-option" key={day.value}>
                      <input
                        checked={openWeekdays.includes(day.value)}
                        onChange={(event) => setOpenWeekdays((current) => event.target.checked
                          ? [...current, day.value].sort((left, right) => left - right)
                          : current.filter((value) => value !== day.value))}
                        type="checkbox"
                      />
                      <span>{day.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <button
                className="sign-in-button"
                disabled={isSavingTerm || missingTermNames.length === 0 || !selectedSessionId || openWeekdays.length === 0}
                type="submit"
              >
                <span>{isSavingTerm ? 'Creating term…' : 'Create term'}</span>
              </button>
            </form>
          </div>
          {terms.length > 0 && (
            <ul className="academic-term-list">
              {terms.map((term) => (
                <li key={term.id}>
                  <strong>{term.name}</strong>
                  <span>{term.starts_on} to {term.ends_on}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {error && <p className="form-notice academic-notice" role="alert">{error}</p>}
      {message && <p className="success-notice academic-notice" role="status">{message}</p>}
    </section>
  );
}
