import { useEffect, useState } from 'react';
import { formatOrdinalPosition } from '../domain/results';
import { supabase } from '../lib/supabase';

type ClassResultFinalization = {
  id: string;
  class_id: string;
  session_id: string;
  term_id: string;
  revision: number;
  finalized_at: string;
  result_snapshot: unknown;
};

type Publication = {
  finalization_id: string;
  snapshot: unknown;
  published_at: string;
};

type ReportSummary = {
  student_name: string;
  student_serial: string;
  overall_percentage: number;
  overall_grade: string | null;
  class_position: number;
  teacher_comment: string;
};

type PeriodLabel = { id: string; name: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseFinalizations(value: unknown): ClassResultFinalization[] | null {
  if (!Array.isArray(value)) return null;
  const records: ClassResultFinalization[] = [];
  for (const row of value) {
    if (!isRecord(row)
      || typeof row.id !== 'string'
      || typeof row.class_id !== 'string'
      || typeof row.session_id !== 'string'
      || typeof row.term_id !== 'string'
      || typeof row.revision !== 'number'
      || typeof row.finalized_at !== 'string') {
      return null;
    }
    records.push({
      id: row.id,
      class_id: row.class_id,
      session_id: row.session_id,
      term_id: row.term_id,
      revision: row.revision,
      finalized_at: row.finalized_at,
      result_snapshot: row.result_snapshot,
    });
  }
  return records;
}

function parsePublications(value: unknown): Publication[] | null {
  if (!Array.isArray(value)) return null;
  const records: Publication[] = [];
  for (const row of value) {
    if (!isRecord(row)
      || typeof row.finalization_id !== 'string'
      || typeof row.published_at !== 'string') {
      return null;
    }
    records.push({
      finalization_id: row.finalization_id,
      snapshot: row.snapshot,
      published_at: row.published_at,
    });
  }
  return records;
}

function parsePeriodLabels(value: unknown): PeriodLabel[] | null {
  if (!Array.isArray(value)) return null;
  const records: PeriodLabel[] = [];
  for (const row of value) {
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.name !== 'string') {
      return null;
    }
    records.push({ id: row.id, name: row.name });
  }
  return records;
}

function parseReportSummary(value: unknown): ReportSummary | null {
  if (!isRecord(value)
    || typeof value.student_name !== 'string'
    || typeof value.student_serial !== 'string'
    || typeof value.overall_percentage !== 'number'
    || (value.overall_grade !== null && typeof value.overall_grade !== 'string')
    || typeof value.class_position !== 'number'
    || typeof value.teacher_comment !== 'string') {
    return null;
  }
  return {
    student_name: value.student_name,
    student_serial: value.student_serial,
    overall_percentage: value.overall_percentage,
    overall_grade: value.overall_grade,
    class_position: value.class_position,
    teacher_comment: value.teacher_comment,
  };
}

function reportsFor(publications: Publication[], finalizationId: string): ReportSummary[] | null {
  const summaries: ReportSummary[] = [];
  for (const publication of publications.filter((item) => item.finalization_id === finalizationId)) {
    const summary = parseReportSummary(publication.snapshot);
    if (!summary) return null;
    summaries.push(summary);
  }
  return summaries;
}

export default function ReportHistoryPanel() {
  const [finalizations, setFinalizations] = useState<ClassResultFinalization[]>([]);
  const [publications, setPublications] = useState<Publication[]>([]);
  const [classes, setClasses] = useState<PeriodLabel[]>([]);
  const [sessions, setSessions] = useState<PeriodLabel[]>([]);
  const [terms, setTerms] = useState<PeriodLabel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      if (!supabase) {
        setError('School database is not configured.');
        setIsLoading(false);
        return;
      }
      try {
        const { data, error: finalizationError } = await supabase
          .from('class_result_finalizations')
          .select('id,class_id,session_id,term_id,revision,finalized_at,result_snapshot')
          .order('finalized_at', { ascending: false })
          .limit(50);
        if (cancelled) return;
        if (finalizationError) {
          setError('Published results history could not be loaded.');
          return;
        }
        const parsedFinalizations = parseFinalizations(data);
        if (!parsedFinalizations) {
          setError('Published results history returned an unexpected response.');
          return;
        }
        setFinalizations(parsedFinalizations);
        if (parsedFinalizations.length === 0) return;

        const finalizationIds = parsedFinalizations.map((item) => item.id);
        const classIds = [...new Set(parsedFinalizations.map((item) => item.class_id))];
        const sessionIds = [...new Set(parsedFinalizations.map((item) => item.session_id))];
        const termIds = [...new Set(parsedFinalizations.map((item) => item.term_id))];
        const [publicationResult, classResult, sessionResult, termResult] = await Promise.all([
          supabase.from('published_report_cards')
            .select('finalization_id,snapshot,published_at')
            .in('finalization_id', finalizationIds),
          supabase.from('classes').select('id,name').in('id', classIds),
          supabase.from('academic_sessions').select('id,name').in('id', sessionIds),
          supabase.from('academic_terms').select('id,name').in('id', termIds),
        ]);
        if (cancelled) return;
        if (publicationResult.error || classResult.error || sessionResult.error || termResult.error) {
          setError('Report cards or school-period labels could not be loaded.');
          return;
        }
        const parsedPublications = parsePublications(publicationResult.data);
        const parsedClasses = parsePeriodLabels(classResult.data);
        const parsedSessions = parsePeriodLabels(sessionResult.data);
        const parsedTerms = parsePeriodLabels(termResult.data);
        if (!parsedPublications || !parsedClasses || !parsedSessions || !parsedTerms) {
          setError('Report history details returned an unexpected response.');
          return;
        }
        setPublications(parsedPublications);
        setClasses(parsedClasses);
        setSessions(parsedSessions);
        setTerms(parsedTerms);
        if (parsedFinalizations.some((record) => reportsFor(parsedPublications, record.id) === null)) {
          setError('At least one published report snapshot returned unexpected data.');
        }
      } catch {
        if (!cancelled) setError('Published results history could not be loaded. Check your connection and try again.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  const classNames = new Map(classes.map((record) => [record.id, record.name]));
  const sessionNames = new Map(sessions.map((record) => [record.id, record.name]));
  const termNames = new Map(terms.map((record) => [record.id, record.name]));

  return (
    <section className="family-panel report-history-panel" aria-labelledby="report-history-heading">
      <div className="family-panel-heading">
        <div>
          <span className="eyebrow">Academic records</span>
          <h2 id="report-history-heading">Published results history</h2>
        </div>
        <span className="attendance-count">{finalizations.length} publications</span>
      </div>
      {error && <p className="form-notice academic-notice" role="alert">{error}</p>}
      {isLoading ? (
        <p className="empty-state">Loading publication history…</p>
      ) : finalizations.length === 0 ? (
        <p className="empty-state">No class results have been published yet.</p>
      ) : (
        <ul className="report-history-list">
          {finalizations.map((record) => {
            const reports = reportsFor(publications, record.id);
            return (
              <li key={record.id}>
                <div className="report-history-summary">
                  <strong>
                    {classNames.get(record.class_id) ?? 'Class'} · Revision {record.revision}
                  </strong>
                  <span>
                    {sessionNames.get(record.session_id) ?? 'Session'} · {termNames.get(record.term_id) ?? 'Term'}
                    {' '}· Published {new Date(record.finalized_at).toLocaleString()}
                  </span>
                  <span>{reports?.length ?? 0} report cards</span>
                </div>
                {reports && reports.length > 0 && (
                  <details>
                    <summary>Review report snapshots and comments</summary>
                    <div className="attendance-table-wrap">
                      <table className="attendance-table">
                        <thead>
                          <tr>
                            <th scope="col">Learner</th>
                            <th scope="col">Score</th>
                            <th scope="col">Grade</th>
                            <th scope="col">Position</th>
                            <th scope="col">Teacher comment</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reports.map((report) => (
                            <tr key={`${record.id}-${report.student_serial}`}>
                              <td>{report.student_name} · {report.student_serial}</td>
                              <td>{report.overall_percentage.toFixed(1)}%</td>
                              <td>{report.overall_grade ?? '—'}</td>
                              <td>{formatOrdinalPosition(report.class_position)}</td>
                              <td>{report.teacher_comment || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="provisioning-context report-history-note">
        Published reports are immutable snapshots. To correct marks, import the corrected rows with a reason
        and publish a new revision; prior reports remain in this history.
      </p>
    </section>
  );
}
