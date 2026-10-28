import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type AuditEntry = {
  id: number;
  actor_user_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  reason: string | null;
  change_summary: Record<string, unknown>;
  created_at: string;
};

const PAGE_SIZE = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAuditEntries(value: unknown): AuditEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: AuditEntry[] = [];
  for (const row of value) {
    if (!isRecord(row)
      || typeof row.id !== 'number'
      || (row.actor_user_id !== null && typeof row.actor_user_id !== 'string')
      || typeof row.action !== 'string'
      || typeof row.target_type !== 'string'
      || (row.target_id !== null && typeof row.target_id !== 'string')
      || (row.reason !== null && typeof row.reason !== 'string')
      || !isRecord(row.change_summary)
      || typeof row.created_at !== 'string') {
      return null;
    }
    entries.push({
      id: row.id,
      actor_user_id: row.actor_user_id,
      action: row.action,
      target_type: row.target_type,
      target_id: row.target_id,
      reason: row.reason,
      change_summary: row.change_summary,
      created_at: row.created_at,
    });
  }
  return entries;
}

function shortActorId(actorId: string | null): string {
  return actorId ? `${actorId.slice(0, 8)}…${actorId.slice(-4)}` : 'System';
}

export default function AuditLogPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [page, setPage] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState('');

  const loadPage = useCallback(async (cancelled: () => boolean) => {
    if (!supabase) {
      setError('School database is not configured.');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const firstRow = page * PAGE_SIZE;
      const { data, error: queryError } = await supabase
        .from('audit_logs')
        .select('id,actor_user_id,action,target_type,target_id,reason,change_summary,created_at')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(firstRow, firstRow + PAGE_SIZE);
      if (cancelled()) return;
      if (queryError) {
        setError('The audit history could not be loaded. Refresh or contact the system administrator.');
        return;
      }
      const parsed = parseAuditEntries(data);
      if (!parsed) {
        setError('The audit history returned an unexpected response.');
        return;
      }
      setHasNextPage(parsed.length > PAGE_SIZE);
      setEntries(parsed.slice(0, PAGE_SIZE));
    } catch {
      if (!cancelled()) setError('The audit history could not be loaded. Check your connection and try again.');
    } finally {
      if (!cancelled()) setIsLoading(false);
    }
  }, [page]);

  useEffect(() => {
    let cancelled = false;
    void loadPage(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadPage, refreshKey]);

  return (
    <section className="family-panel audit-log-panel" aria-labelledby="audit-log-heading">
      <div className="family-panel-heading">
        <div>
          <span className="eyebrow">Accountability</span>
          <h2 id="audit-log-heading">Administrative audit history</h2>
        </div>
        <button
          className="sign-out-button"
          disabled={isLoading}
          onClick={() => setRefreshKey((current) => current + 1)}
          type="button"
        >
          {isLoading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      <p className="provisioning-context">
        Read-only history of administrative changes. Entries are retained in the append-only database log.
      </p>
      {error && <p className="form-notice academic-notice" role="alert">{error}</p>}
      {isLoading ? (
        <p className="empty-state">Loading audit history…</p>
      ) : entries.length === 0 ? (
        <p className="empty-state">No administrative activity has been recorded yet.</p>
      ) : (
        <>
          <ol className="audit-log-list">
            {entries.map((entry) => (
              <li key={entry.id}>
                <div className="audit-entry-heading">
                  <strong>{entry.action.replaceAll('_', ' ')}</strong>
                  <time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString()}</time>
                </div>
                <div className="audit-entry-meta">
                  <span>Target: {entry.target_type}{entry.target_id ? ` · ${entry.target_id}` : ''}</span>
                  <span>Actor: {shortActorId(entry.actor_user_id)}</span>
                </div>
                {entry.reason && <p className="audit-entry-reason">Reason: {entry.reason}</p>}
                {Object.keys(entry.change_summary).length > 0 && (
                  <details>
                    <summary>Change details</summary>
                    <pre>{JSON.stringify(entry.change_summary, null, 2)}</pre>
                  </details>
                )}
              </li>
            ))}
          </ol>
          <div className="audit-pagination">
            <button
              className="sign-out-button"
              disabled={page === 0 || isLoading}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              type="button"
            >
              Newer entries
            </button>
            <span>Page {page + 1}</span>
            <button
              className="sign-out-button"
              disabled={!hasNextPage || isLoading}
              onClick={() => setPage((current) => current + 1)}
              type="button"
            >
              Older entries
            </button>
          </div>
        </>
      )}
    </section>
  );
}
