import { useEffect, useState, type ChangeEvent } from 'react';
import {
  previewResultRows,
  type ImportStudent,
  type ImportSubject,
  type ResultImportRow,
} from '../domain/result-import';
import { parseCsvRows } from '../domain/csv';
import { supabase } from '../lib/supabase';

interface StudentRecord extends ImportStudent {
  readonly fullName: string;
}

interface AssessmentRecord extends ImportSubject {
  readonly version: number;
}

interface ImportPreview {
  readonly fileName: string;
  readonly sha256: string;
  readonly rows: readonly ResultImportRow[];
  readonly errors: readonly string[];
}
interface DraftContext {
  readonly classId: string;
  readonly sessionId: string;
  readonly termId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getImportErrorMessage(error: {
  code?: string;
  details?: string | null;
  message: string;
}): string {
  const message = error.message.toLocaleLowerCase();
  const details = error.details?.toLocaleLowerCase() ?? '';
  if (error.code === '23505') {
    const constraintMatch = `${error.message} ${error.details ?? ''}`
      .match(/constraint ["']?([a-z0-9_]+)["']?/i);
    const constraint = constraintMatch?.[1];
    if (constraint?.includes('result_import_batches')
      && constraint.includes('content_sha256')) {
      return 'This exact results file has already been imported for the selected class and term. The transaction was rolled back. Check the saved drafts and publication history before taking further action.';
    }
    if (constraint?.includes('results_one_draft_per_enrollment_schema')) {
      return 'The database found an existing draft while saving these marks (unique draft conflict). The transaction was rolled back. If replacement was checked, do not retry; ask the administrator to investigate a concurrent import or a draft that was not removed.';
    }
    return `The database rejected a duplicate record (error code 23505${constraint ? `, constraint ${constraint}` : ''}). The transaction was rolled back. Do not retry until this constraint has been checked.`;
  }
  if (message.includes('already been imported')
    || details.includes('result_import_batches_class_id_session_id_term_id_content_sha256_key')) {
    return 'This exact results file was already imported for the selected class and term. Do not retry the same file; check the import and publication history first.';
  }
  if (message.includes('confirm replacement')) {
    return 'Draft marks already exist for one or more rows. Review the file, check the replacement confirmation, and import again.';
  }
  if (message.includes('correction') || message.includes('reason')) {
    return 'At least one row changes a previously published mark. Enter a correction reason, then import again.';
  }
  if (message.includes('unknown subject') || message.includes('configured maximum')
    || message.includes('assessment maximum')) {
    return 'A mark or subject no longer matches the configured assessment maximums. Verify the class, term, and configured maximums, then validate the file again.';
  }
  if (message.includes('active enrollment') || message.includes('valid enrollment')) {
    return 'A learner in the file is not actively enrolled in the selected class and session. Check the roster and selected class/session.';
  }
  if (message.includes('duplicate learner and subject')
    || message.includes('duplicate learner-subject')) {
    return 'The file contains the same learner and subject more than once. Remove duplicate rows and validate it again.';
  }
  if (error.code && /^[A-Z0-9]{5}$/.test(error.code)) {
    return `The database rejected the import (error code ${error.code}); this import transaction was rolled back. Share the code with the administrator before retrying.`;
  }
  return 'The import could not be confirmed because of a connection or server response issue. Check import history before retrying to avoid duplicate records.';
}

function parseStudents(value: unknown): StudentRecord[] | null {
  if (!Array.isArray(value)) return null;
  const students: StudentRecord[] = [];
  for (const row of value) {
    if (!isRecord(row)
      || typeof row.id !== 'string'
      || typeof row.serial !== 'string'
      || typeof row.full_name !== 'string') {
      return null;
    }
    students.push({ id: row.id, serial: row.serial, fullName: row.full_name });
  }
  return students;
}

function parseAssessments(value: unknown): AssessmentRecord[] | null {
  if (!Array.isArray(value)) return null;
  const newestBySubject = new Map<string, AssessmentRecord>();
  for (const row of value) {
    if (!isRecord(row)
      || typeof row.subject_id !== 'string'
      || typeof row.ca_maximum !== 'number'
      || typeof row.exam_maximum !== 'number'
      || typeof row.version !== 'number') {
      return null;
    }
    const relatedSubject = Array.isArray(row.subjects) ? row.subjects[0] : row.subjects;
    if (!isRecord(relatedSubject)
      || typeof relatedSubject.id !== 'string'
      || typeof relatedSubject.name !== 'string'
      || relatedSubject.id !== row.subject_id) {
      return null;
    }
    const current = newestBySubject.get(row.subject_id);
    if (!current || row.version > current.version) {
      newestBySubject.set(row.subject_id, {
        id: row.subject_id,
        name: relatedSubject.name,
        caMaximum: row.ca_maximum,
        examMaximum: row.exam_maximum,
        version: row.version,
      });
    }
  }
  return [...newestBySubject.values()];
}

function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  return crypto.subtle.digest('SHA-256', bytes).then((hash) =>
    Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join(''));
}

export default function ResultsImportPanel({
  classId,
  sessionId,
  termId,
}: {
  classId: string;
  sessionId: string;
  termId: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [replaceDraftsConfirmed, setReplaceDraftsConfirmed] = useState(false);
  const [correctionReason, setCorrectionReason] = useState('');
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [draftsSaved, setDraftsSaved] = useState(false);
  const [draftContext, setDraftContext] = useState<DraftContext | null>(null);
  const [teacherComments, setTeacherComments] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setFile(null);
    setPreview(null);
    setReplaceDraftsConfirmed(false);
    setCorrectionReason('');
    setError('');
    setMessage('');
  }, [classId, sessionId, termId]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0] ?? null;
    setFile(selectedFile);
    setPreview(null);
    setReplaceDraftsConfirmed(false);
    setCorrectionReason('');
    setTeacherComments({});
    setMessage('');
    setError('');
  }

  const draftContextMatchesSelection = Boolean(draftContext
    && draftContext.classId === classId
    && draftContext.sessionId === sessionId
    && draftContext.termId === termId);

  async function loadPreview() {
    if (!supabase || !file || !classId || !sessionId || !termId) {
      setError('Select a class, session, term, and results file first.');
      return;
    }
    const fileName = file.name.toLowerCase();
    const isCsv = fileName.endsWith('.csv');
    const isXlsx = fileName.endsWith('.xlsx');
    if ((!isCsv && !isXlsx) || file.size === 0 || file.size > 2 * 1024 * 1024) {
      setError('Select a non-empty CSV or XLSX file no larger than 2 MB.');
      return;
    }

    setIsPreviewing(true);
    setError('');
    setMessage('');
    setPreview(null);
    try {
      let resultRows: readonly (readonly unknown[])[];
      if (isXlsx) {
        const { readSheet } = await import('read-excel-file/browser');
        resultRows = await readSheet(file);
        if (resultRows.length - 1 > 10_000) {
          setError('The file exceeds the 10,000 result-row limit.');
          return;
        }
      } else {
        const csvContent = (await file.text()).replace(/^\uFEFF/, '');
        resultRows = parseCsvRows(csvContent);
        if (resultRows.length - 1 > 10_000) {
          setError('The file exceeds the 10,000 result-row limit.');
          return;
        }
      }

      const { data: enrollmentData, error: enrollmentError } = await supabase
        .from('enrollments')
        .select('student_id')
        .eq('class_id', classId)
        .eq('session_id', sessionId)
        .eq('status', 'active');
      if (enrollmentError) {
        setError('The selected class enrollments could not be verified.');
        return;
      }
      const studentIds = Array.isArray(enrollmentData)
        ? enrollmentData.flatMap((row) => isRecord(row) && typeof row.student_id === 'string'
          ? [row.student_id]
          : [])
        : [];

      const [studentResult, assessmentResult] = await Promise.all([
        studentIds.length > 0
          ? supabase.from('students').select('id,serial,full_name').in('id', studentIds)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from('assessment_schemas')
          .select('subject_id,ca_maximum,exam_maximum,version,subjects(id,name)')
          .eq('class_id', classId)
          .eq('session_id', sessionId)
          .eq('term_id', termId),
      ]);
      if (studentResult.error || assessmentResult.error) {
        setError('The class roster or configured subjects could not be loaded.');
        return;
      }
      const students = parseStudents(studentResult.data);
      const subjects = parseAssessments(assessmentResult.data);
      if (!students || !subjects) {
        setError('The class roster or assessment configuration returned unexpected data.');
        return;
      }
      if (subjects.length === 0) {
        setError('Configure at least one subject and assessment maximum before importing results.');
        return;
      }

      const resultPreview = previewResultRows(resultRows, students, subjects);

      const sha256 = await sha256Hex(await file.arrayBuffer());
      setPreview({
        fileName: file.name,
        sha256,
        rows: resultPreview.rows,
        errors: resultPreview.errors,
      });
    } catch {
      setError('The CSV or XLSX file could not be read or validated. Check the file and try again.');
    } finally {
      setIsPreviewing(false);
    }
  }

  async function importDrafts() {
    if (!supabase || !preview || preview.rows.length === 0 || preview.errors.length > 0 || isImporting) return;
    setIsImporting(true);
    setError('');
    setMessage('');
    try {
      const { error: importError } = await supabase.rpc('save_result_drafts', {
        p_class_id: classId,
        p_session_id: sessionId,
        p_term_id: termId,
        p_file_name: preview.fileName,
        p_sha256: preview.sha256,
        p_rows: preview.rows.map((row) => ({
          student_id: row.student_id,
          subject_id: row.subject_id,
          ca_mark: row.ca_mark,
          exam_mark: row.exam_mark,
        })),
        p_confirm_replace: replaceDraftsConfirmed,
        p_correction_reason: correctionReason.trim() || null,
      });
      if (importError) {
        setError(getImportErrorMessage(importError));
        return;
      }
      setDraftsSaved(true);
      setDraftContext({ classId, sessionId, termId });
      setTeacherComments({});
      setMessage(`${preview.rows.length} result rows were saved as drafts. Publish only after reviewing the complete class results.`);
    } catch {
      setError('The results could not be imported. Check your connection and try again.');
    } finally {
      setIsImporting(false);
    }
  }

  async function publishResults() {
    if (!supabase || !classId || !sessionId || !termId || isPublishing) return;
    if (draftContext && !draftContextMatchesSelection) return;
    const publicationContext = draftContext ?? { classId, sessionId, termId };
    const confirmed = window.confirm(
      'Publish the complete class results for the selected class, session, and term? The server will verify that every active learner has marks for every configured subject. Published results are visible to students and parents and cannot be edited in place.',
    );
    if (!confirmed) return;

    setIsPublishing(true);
    setError('');
    setMessage('');
    try {
      const { error: publishError } = await supabase.rpc('publish_class_results', {
        p_class_id: publicationContext.classId,
        p_session_id: publicationContext.sessionId,
        p_term_id: publicationContext.termId,
        p_teacher_comments: Object.fromEntries(
          Object.entries(teacherComments)
            .map(([studentId, comment]) => [studentId, comment.trim()])
            .filter(([, comment]) => comment.length > 0),
        ),
      });
      if (publishError) {
        setError('The results were not published. Confirm every enrolled learner has a mark for each configured subject and resolve any attendance or grading issues.');
      } else {
        setDraftsSaved(false);
        setDraftContext(null);
        setTeacherComments({});
        setPreview(null);
        setFile(null);
        setMessage('Class results were published. Students and linked parents can now view their report cards.');
      }
    } catch {
      setError('The results were not published. Check your connection and try again.');
    } finally {
      setIsPublishing(false);
    }
  }

  return (
    <section className="family-panel results-import-panel" aria-labelledby="results-import-heading">
      <div className="family-panel-heading">
        <div>
          <span className="eyebrow">Academic results</span>
          <h2 id="results-import-heading">Import and publish marks</h2>
        </div>
      </div>
      <p className="provisioning-context">
        CSV or the first XLSX worksheet must use columns <code>serial,subject,ca,exam</code>.
        Use exact learner serials and configured subject names. Marks are checked against each
        subject’s maximum. Optional teacher comments become part of each immutable report-card revision.
      </p>
      <div className="results-import-controls">
        <label>
          <span className="field-label">Results CSV or XLSX file</span>
          <input
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="text-field file-field"
            disabled={!classId || !sessionId || !termId || isPreviewing || isImporting || isPublishing}
            onChange={handleFileChange}
            type="file"
          />
        </label>
        <div className="results-file-actions">
          <a
            className="sign-out-button template-download"
            download="school-results-template.csv"
            href={`data:text/csv;charset=utf-8,${encodeURIComponent('serial,subject,ca,exam\r\n')}`}
          >
            Download CSV template
          </a>
          <button
            className="sign-out-button"
            disabled={!file || isPreviewing || isImporting || isPublishing}
            onClick={() => void loadPreview()}
            type="button"
          >
            {isPreviewing ? 'Validating file…' : 'Validate and preview'}
          </button>
        </div>
      </div>
      {draftsSaved && draftContext && (draftContext.classId !== classId
        || draftContext.sessionId !== sessionId || draftContext.termId !== termId) && (
        <p className="form-notice" role="status">
          Drafts remain saved for the class/session/term originally selected. Publishing below will apply to that saved selection.
        </p>
      )}
      {preview && (
        <div className="results-preview" aria-live="polite">
          <p className="preview-summary">
            {preview.errors.length > 0
              ? `${preview.errors.length} issue${preview.errors.length === 1 ? '' : 's'} found. Nothing will be imported until all are fixed.`
              : `${preview.rows.length} result rows validated successfully.`}
          </p>
          {preview.errors.length > 0 ? (
            <ul className="import-errors">
              {preview.errors.slice(0, 30).map((item) => <li key={item}>{item}</li>)}
              {preview.errors.length > 30 && (
                <li>And {preview.errors.length - 30} more issues; correct the file and validate it again.</li>
              )}
            </ul>
          ) : (
            <>
              <div className="attendance-table-wrap">
                <table className="attendance-table">
                  <thead>
                    <tr>
                      <th scope="col">Student</th>
                      <th scope="col">Subject</th>
                      <th scope="col">CA</th>
                      <th scope="col">Exam</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 100).map((row) => (
                      <tr key={`${row.student_id}-${row.subject_id}`}>
                        <td>{row.studentName} · {row.serial}</td>
                        <td>{row.subjectName}</td>
                        <td>{row.ca_mark}</td>
                        <td>{row.exam_mark}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.rows.length > 100 && (
                <p className="selection-note">Showing the first 100 of {preview.rows.length} validated result rows.</p>
              )}
              {draftsSaved && draftContextMatchesSelection && (
                <div className="teacher-comments">
                  <h3>Teacher comments for report cards (optional)</h3>
                  {[...new Map(preview.rows.map((row) => [row.student_id, row])).values()]
                    .map((row) => (
                      <label key={row.student_id}>
                        <span className="field-label">{row.studentName} · {row.serial}</span>
                        <textarea
                          className="text-field update-textarea"
                          disabled={isImporting || isPublishing}
                          maxLength={500}
                          onChange={(event) => setTeacherComments((current) => ({
                            ...current,
                            [row.student_id]: event.target.value,
                          }))}
                          value={teacherComments[row.student_id] ?? ''}
                        />
                      </label>
                    ))}
                </div>
              )}
              <div className="import-confirmations">
                <label className="confirmation-option">
                  <input
                    checked={replaceDraftsConfirmed}
                    disabled={isImporting || isPublishing}
                    onChange={(event) => setReplaceDraftsConfirmed(event.target.checked)}
                    type="checkbox"
                  />
                  <span>Confirm replacement if draft marks already exist for these learners and subjects.</span>
                </label>
                <label>
                  <span className="field-label">Correction reason (required if changing published marks)</span>
                  <input
                    className="text-field"
                    disabled={isImporting || isPublishing}
                    maxLength={500}
                    onChange={(event) => setCorrectionReason(event.target.value)}
                    value={correctionReason}
                  />
                </label>
                <div className="import-action-buttons">
                  <button
                    className="sign-in-button"
                    disabled={!replaceDraftsConfirmed || isImporting || isPublishing}
                    onClick={() => void importDrafts()}
                    type="button"
                  >
                    <span>{isImporting ? 'Saving result drafts…' : 'Import as drafts'}</span>
                  </button>
                  <button
                    className="sign-out-button"
                    disabled={
                      !classId
                      || !sessionId
                      || !termId
                      || (Boolean(draftContext) && !draftContextMatchesSelection)
                      || isPublishing
                      || isImporting
                    }
                    onClick={() => void publishResults()}
                    type="button"
                  >
                    {draftContext && !draftContextMatchesSelection
                      ? 'Return to the saved class/session/term to publish'
                      : isPublishing ? 'Publishing class results…' : 'Publish class results'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
      {error && <p className="form-notice" role="alert">{error}</p>}
      {message && <p className="success-notice" role="status">{message}</p>}
    </section>
  );
}
