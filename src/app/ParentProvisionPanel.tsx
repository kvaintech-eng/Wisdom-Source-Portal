import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

interface Learner {
  readonly id: string;
  readonly serial: string;
  readonly fullName: string;
}

interface ParentCredential {
  readonly loginId: string;
  readonly temporaryPassword: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseLearners(value: unknown): Learner[] | null {
  if (!Array.isArray(value)) return null;
  const learners: Learner[] = [];
  for (const row of value) {
    if (!isRecord(row)
      || typeof row.id !== 'string'
      || typeof row.serial !== 'string'
      || typeof row.full_name !== 'string') {
      return null;
    }
    learners.push({ id: row.id, serial: row.serial, fullName: row.full_name });
  }
  return learners;
}

export default function ParentProvisionPanel({ refreshKey }: { refreshKey: number }) {
  const [learners, setLearners] = useState<Learner[]>([]);
  const [parentName, setParentName] = useState('');
  const [relationship, setRelationship] = useState('Parent/guardian');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [verified, setVerified] = useState(false);
  const [credential, setCredential] = useState<ParentCredential | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadLearners() {
      if (!supabase) {
        setError('School database is not configured.');
        setLoading(false);
        return;
      }
      try {
        const { data, error: queryError } = await supabase
          .from('students')
          .select('id,serial,full_name')
          .eq('active', true)
          .order('full_name');
        if (cancelled) return;
        if (queryError) {
          setError('Active learners could not be loaded.');
          return;
        }
        const parsed = parseLearners(data);
        if (!parsed) {
          setError('The active learner list returned an unexpected response.');
          return;
        }
        setLearners(parsed);
      } catch {
        if (!cancelled) setError('Active learners could not be loaded. Check your connection and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadLearners();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  function toggleStudent(studentId: string) {
    setSelectedStudentIds((current) => current.includes(studentId)
      ? current.filter((id) => id !== studentId)
      : [...current, studentId]);
  }

  async function provisionParent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !parentName.trim() || !relationship.trim()
      || selectedStudentIds.length === 0 || !verified || saving || credential) return;
    setSaving(true);
    setError('');
    try {
      const { data, error: requestError } = await supabase.functions.invoke('provision-account', {
        body: {
          role: 'parent',
          parent: {
            displayName: parentName.trim(),
            students: selectedStudentIds.map((studentId) => ({
              studentId,
              relationship: relationship.trim(),
            })),
          },
        },
      });
      if (requestError || !isRecord(data)
        || typeof data.loginId !== 'string'
        || typeof data.temporaryPassword !== 'string') {
        setError('The parent account could not be created. Verify the selected learner links and try again.');
        return;
      }
      setCredential({ loginId: data.loginId, temporaryPassword: data.temporaryPassword });
      setParentName('');
      setSelectedStudentIds([]);
      setVerified(false);
    } catch {
      setError('The parent account could not be created. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="family-panel parent-provision-panel" aria-labelledby="parent-provision-heading">
      <div className="family-panel-heading">
        <div>
          <span className="eyebrow">Family access</span>
          <h2 id="parent-provision-heading">Create a parent account</h2>
        </div>
      </div>
      <p className="provisioning-context">
        Link only learners whose relationship has been verified by the school. This account can
        see the published school records for every selected learner.
      </p>
      {credential ? (
        <div className="credential-notice">
          <p>Share this temporary credential privately with the parent. They must change the password at first sign-in.</p>
          <dl>
            <div><dt>Parent login ID</dt><dd><code>{credential.loginId}</code></dd></div>
            <div><dt>Temporary password</dt><dd><code>{credential.temporaryPassword}</code></dd></div>
          </dl>
          <button className="sign-out-button" onClick={() => setCredential(null)} type="button">
            I have securely shared this credential
          </button>
        </div>
      ) : (
        <form className="parent-provision-form" onSubmit={(event) => void provisionParent(event)}>
          <div className="parent-fields">
            <label>
              <span className="field-label">Parent/guardian full name</span>
              <input
                className="text-field"
                maxLength={160}
                onChange={(event) => setParentName(event.target.value)}
                required
                value={parentName}
              />
            </label>
            <label>
              <span className="field-label">Relationship to selected learners</span>
              <input
                className="text-field"
                maxLength={80}
                onChange={(event) => setRelationship(event.target.value)}
                required
                value={relationship}
              />
            </label>
          </div>
          <fieldset className="learner-link-list">
            <legend>Choose linked learners</legend>
            {loading ? (
              <p className="selection-note">Loading active learners…</p>
            ) : learners.length === 0 ? (
              <p className="selection-note">No active learners are available.</p>
            ) : learners.map((learner) => (
              <label className="learner-link-option" key={learner.id}>
                <input
                  checked={selectedStudentIds.includes(learner.id)}
                  onChange={() => toggleStudent(learner.id)}
                  type="checkbox"
                />
                <span>{learner.fullName} · {learner.serial}</span>
              </label>
            ))}
          </fieldset>
          <label className="confirmation-option parent-verification">
            <input
              checked={verified}
              onChange={(event) => setVerified(event.target.checked)}
              type="checkbox"
            />
            <span>I confirm that the school has verified this parent/guardian relationship for each selected learner.</span>
          </label>
          <button
            className="sign-in-button provision-button"
            disabled={loading || saving || selectedStudentIds.length === 0 || !verified}
            type="submit"
          >
            <span>{saving ? 'Creating parent account…' : 'Create verified parent account'}</span>
          </button>
        </form>
      )}
      {error && <p className="form-notice" role="alert">{error}</p>}
    </section>
  );
}
