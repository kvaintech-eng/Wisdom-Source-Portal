import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

interface SubjectRecord {
  readonly id: string;
  readonly name: string;
}

interface AssessmentSetup {
  readonly subjectId: string;
  readonly caMaximum: number;
  readonly examMaximum: number;
  readonly version: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseSubjects(value: unknown): SubjectRecord[] | null {
  if (!Array.isArray(value)) return null;
  const subjects: SubjectRecord[] = [];
  for (const row of value) {
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.name !== 'string') return null;
    subjects.push({ id: row.id, name: row.name });
  }
  return subjects;
}

function parseAssessmentSetups(value: unknown): AssessmentSetup[] | null {
  if (!Array.isArray(value)) return null;
  const latestBySubject = new Map<string, AssessmentSetup>();
  for (const row of value) {
    if (!isRecord(row)
      || typeof row.subject_id !== 'string'
      || typeof row.ca_maximum !== 'number'
      || typeof row.exam_maximum !== 'number'
      || typeof row.version !== 'number') {
      return null;
    }
    const current = latestBySubject.get(row.subject_id);
    if (!current || row.version > current.version) {
      latestBySubject.set(row.subject_id, {
        subjectId: row.subject_id,
        caMaximum: row.ca_maximum,
        examMaximum: row.exam_maximum,
        version: row.version,
      });
    }
  }
  return [...latestBySubject.values()];
}

export default function AssessmentSetupPanel({
  classId,
  sessionId,
  termId,
}: {
  classId: string;
  sessionId: string;
  termId: string;
}) {
  const [subjects, setSubjects] = useState<SubjectRecord[]>([]);
  const [setups, setSetups] = useState<AssessmentSetup[]>([]);
  const [subjectId, setSubjectId] = useState('');
  const [newSubjectName, setNewSubjectName] = useState('');
  const [caMaximum, setCaMaximum] = useState('');
  const [examMaximum, setExamMaximum] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadConfiguration() {
      if (!supabase) {
        setError('School database is not configured.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const [subjectResult, schemaResult] = await Promise.all([
          supabase.from('subjects').select('id,name').eq('active', true).order('name'),
          supabase
            .from('assessment_schemas')
            .select('subject_id,ca_maximum,exam_maximum,version')
            .eq('class_id', classId)
            .eq('session_id', sessionId)
            .eq('term_id', termId),
        ]);
        if (cancelled) return;
        if (subjectResult.error || schemaResult.error) {
          setError('Subjects or assessment settings could not be loaded.');
          return;
        }
        const parsedSubjects = parseSubjects(subjectResult.data);
        const parsedSetups = parseAssessmentSetups(schemaResult.data);
        if (!parsedSubjects || !parsedSetups) {
          setError('Subject or assessment settings returned an unexpected response.');
          return;
        }
        setSubjects(parsedSubjects);
        setSetups(parsedSetups);
        setSubjectId((current) => parsedSubjects.some((subject) => subject.id === current)
          ? current
          : parsedSubjects[0]?.id ?? '');
      } catch {
        if (!cancelled) setError('Subjects or assessment settings could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadConfiguration();
    return () => {
      cancelled = true;
    };
  }, [classId, refreshKey, sessionId, termId]);

  useEffect(() => {
    const current = setups.find((setup) => setup.subjectId === subjectId);
    setCaMaximum(current ? String(current.caMaximum) : '');
    setExamMaximum(current ? String(current.examMaximum) : '');
  }, [setups, subjectId]);

  async function addSubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !newSubjectName.trim() || saving) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const { data, error: insertError } = await supabase
        .from('subjects')
        .insert({ name: newSubjectName.trim() })
        .select('id,name')
        .single();
      if (insertError) {
        setError(insertError.code === '23505'
          ? 'A subject with that name already exists.'
          : 'The subject could not be added. Verify its name and try again.');
        return;
      }
      if (!isRecord(data) || typeof data.id !== 'string' || typeof data.name !== 'string') {
        setError('The subject was added, but its saved record could not be verified.');
        return;
      }
      const newSubject = { id: data.id, name: data.name };
      setSubjects((current) => [...current, newSubject]
        .sort((left, right) => left.name.localeCompare(right.name)));
      setSubjectId(newSubject.id);
      setNewSubjectName('');
      setMessage('Subject added. Configure its assessment maximums for the selected class and term.');
    } catch {
      setError('The subject could not be added. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  async function saveAssessmentSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !subjectId || saving) return;
    const ca = Number(caMaximum);
    const exam = Number(examMaximum);
    if (!Number.isFinite(ca) || !Number.isFinite(exam)
      || ca < 0 || exam < 0 || ca + exam <= 0) {
      setError('Enter non-negative CA and exam maximums with a total greater than zero.');
      return;
    }
    const currentVersion = setups.find((setup) => setup.subjectId === subjectId)?.version ?? 0;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const { error: insertError } = await supabase.from('assessment_schemas').insert({
        class_id: classId,
        session_id: sessionId,
        term_id: termId,
        subject_id: subjectId,
        ca_maximum: ca,
        exam_maximum: exam,
        version: currentVersion + 1,
      });
      if (insertError) {
        setError('Assessment maximums could not be saved. Check that the values are valid and try again.');
        return;
      }
      setCaMaximum('');
      setExamMaximum('');
      setMessage('Assessment maximums saved as a new version. New imports will use this version.');
      setRefreshKey((current) => current + 1);
    } catch {
      setError('Assessment maximums could not be saved. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  const selectedSetup = setups.find((setup) => setup.subjectId === subjectId);

  return (
    <section className="family-panel assessment-setup-panel" aria-labelledby="assessment-setup-heading">
      <div className="family-panel-heading">
        <div>
          <span className="eyebrow">Class configuration</span>
          <h2 id="assessment-setup-heading">Subjects and assessment maximums</h2>
        </div>
      </div>
      <p className="provisioning-context">
        Assessment settings are versioned. Updating a maximum keeps the earlier setup intact;
        future imports use the newest version.
      </p>
      {loading ? (
        <p className="empty-state">Loading assessment settings…</p>
      ) : (
        <>
          {setups.length > 0 && (
            <ul className="assessment-setup-list">
              {setups.map((setup) => (
                <li key={setup.subjectId}>
                  <strong>{subjects.find((subject) => subject.id === setup.subjectId)?.name ?? 'Subject'}</strong>
                  <span>CA {setup.caMaximum} · Exam {setup.examMaximum} · Version {setup.version}</span>
                </li>
              ))}
            </ul>
          )}
          <form className="subject-create-form" onSubmit={(event) => void addSubject(event)}>
            <label>
              <span className="field-label">Add a subject</span>
              <input
                className="text-field"
                maxLength={100}
                onChange={(event) => setNewSubjectName(event.target.value)}
                placeholder="e.g. English Language"
                required
                value={newSubjectName}
              />
            </label>
            <button className="sign-out-button" disabled={saving} type="submit">
              Add subject
            </button>
          </form>
          <form className="assessment-setup-form" onSubmit={(event) => void saveAssessmentSetup(event)}>
            <label>
              <span className="field-label">Subject</span>
              <select
                className="text-field"
                disabled={subjects.length === 0}
                onChange={(event) => setSubjectId(event.target.value)}
                required
                value={subjectId}
              >
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>{subject.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="field-label">CA maximum</span>
              <input
                className="text-field"
                max="1000000"
                min="0"
                onChange={(event) => setCaMaximum(event.target.value)}
                placeholder={selectedSetup ? String(selectedSetup.caMaximum) : '0'}
                required
                step="0.01"
                type="number"
                value={caMaximum}
              />
            </label>
            <label>
              <span className="field-label">Exam maximum</span>
              <input
                className="text-field"
                max="1000000"
                min="0"
                onChange={(event) => setExamMaximum(event.target.value)}
                placeholder={selectedSetup ? String(selectedSetup.examMaximum) : '0'}
                required
                step="0.01"
                type="number"
                value={examMaximum}
              />
            </label>
            <button
              className="sign-in-button assessment-save-button"
              disabled={saving || subjects.length === 0}
              type="submit"
            >
              <span>{saving ? 'Saving settings…' : selectedSetup ? 'Save new version' : 'Configure subject'}</span>
            </button>
          </form>
        </>
      )}
      {error && <p className="form-notice" role="alert">{error}</p>}
      {message && <p className="success-notice" role="status">{message}</p>}
    </section>
  );
}
