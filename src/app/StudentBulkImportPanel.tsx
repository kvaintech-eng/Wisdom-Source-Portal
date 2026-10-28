import { useState, type ChangeEvent } from 'react';
import { Download, Upload } from 'lucide-react';
import {
  previewStudentCsv,
  type StudentImportClass,
  type StudentImportRow,
} from '../domain/student-import';
import { supabase } from '../lib/supabase';

type StudentCredential = {
  readonly fullName: string;
  readonly className: string;
  readonly sessionName: string;
  readonly loginId: string;
  readonly temporaryPassword: string;
};

const MAX_FILE_BYTES = 1024 * 1024;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function downloadCredentials(credentials: readonly StudentCredential[]) {
  const json = JSON.stringify(credentials.map((credential) => ({
    student_name: credential.fullName,
    class_name: credential.className,
    academic_session: credential.sessionName,
    student_login_id: credential.loginId,
    temporary_password: credential.temporaryPassword,
  })), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'student-account-credentials.json';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function StudentBulkImportPanel({
  classes,
  onStudentCreated,
  onProcessingChange,
  sessionId,
  sessionName,
}: {
  classes: readonly StudentImportClass[];
  onStudentCreated: () => void;
  onProcessingChange: (processing: boolean) => void;
  sessionId: string;
  sessionName: string;
}) {
  const [fileName, setFileName] = useState('');
  const [previewRows, setPreviewRows] = useState<readonly StudentImportRow[]>([]);
  const [previewError, setPreviewError] = useState('');
  const [validationErrors, setValidationErrors] = useState<readonly string[]>([]);
  const [confirmation, setConfirmation] = useState(false);
  const [credentials, setCredentials] = useState<readonly StudentCredential[]>([]);
  const [completedCount, setCompletedCount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [batchError, setBatchError] = useState('');
  const [batchMessage, setBatchMessage] = useState('');
  const [batchStopped, setBatchStopped] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);

  function clearPreview() {
    setFileName('');
    setPreviewRows([]);
    setPreviewError('');
    setValidationErrors([]);
    setConfirmation(false);
    setCredentials([]);
    setCompletedCount(0);
    setBatchError('');
    setBatchMessage('');
    setBatchStopped(false);
    setFileInputKey((current) => current + 1);
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    clearPreview();
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv') || file.size === 0 || file.size > MAX_FILE_BYTES) {
      setPreviewError('Choose a non-empty CSV file no larger than 1 MB.');
      event.target.value = '';
      return;
    }
    try {
      const result = previewStudentCsv(await file.text(), classes);
      setFileName(file.name);
      setPreviewRows(result.rows);
      setValidationErrors(result.errors);
    } catch {
      setPreviewError('The selected CSV could not be read. Check the file and try again.');
    }
  }

  async function provisionBatch() {
    if (!supabase || isProcessing || !sessionId || !confirmation
      || previewRows.length === 0 || credentials.length > 0 || batchStopped) return;

    const selectedSessionId = sessionId;
    const selectedSessionName = sessionName;
    const currentCredentials: StudentCredential[] = [];
    setIsProcessing(true);
    setBatchError('');
    setBatchMessage('');
    setCompletedCount(0);
    setCredentials([]);
    onProcessingChange(true);

    try {
      for (const [index, student] of previewRows.entries()) {
        setCompletedCount(index);
        const { data, error } = await supabase.functions.invoke('provision-account', {
          body: {
            role: 'student',
            student: {
              fullName: student.fullName,
              gender: student.gender,
              classId: student.classId,
              sessionId: selectedSessionId,
            },
          },
        });
        if (error || !isRecord(data)
          || typeof data.loginId !== 'string'
          || typeof data.temporaryPassword !== 'string') {
          setCredentials(currentCredentials);
          setCompletedCount(index);
          setBatchStopped(true);
          setBatchError(
            `Creation stopped at record ${student.recordNumber}. The server may have processed the request even if its response was interrupted. Review the student roster and audit history before retrying this record.`,
          );
          onStudentCreated();
          return;
        }
        currentCredentials.push({
          fullName: student.fullName,
          className: student.className,
          sessionName: selectedSessionName,
          loginId: data.loginId,
          temporaryPassword: data.temporaryPassword,
        });
        setCredentials([...currentCredentials]);
        setCompletedCount(index + 1);
      }
      onStudentCreated();
      const classCount = new Set(currentCredentials.map((credential) => credential.className)).size;
      setBatchMessage(
        `Created ${currentCredentials.length} student account(s) across ${classCount} class(es) for ${selectedSessionName}.`,
      );
      setConfirmation(false);
    } catch {
      setCredentials(currentCredentials);
      setBatchStopped(true);
      onStudentCreated();
      setBatchError(
        'Creation stopped because the request could not be confirmed. Review the student roster and audit history before retrying any unfinished record.',
      );
    } finally {
      setIsProcessing(false);
      onProcessingChange(false);
    }
  }

  function clearStoppedBatch() {
    const confirmed = window.confirm(
      'Before clearing this stopped batch, review the student roster and audit history for accounts created by this import. Do not re-import records that may already have been processed. Clear the in-memory results?',
    );
    if (confirmed) clearPreview();
  }

  function handleCredentialDownload() {
    if (credentials.length === 0) return;
    const confirmed = window.confirm(
      'This download contains student login IDs and one-time temporary passwords. Save it only in an approved secure location, transfer credentials privately, and securely delete the file when no longer needed. Continue?',
    );
    if (confirmed) downloadCredentials(credentials);
  }

  return (
    <section className="family-panel student-bulk-import-panel" aria-labelledby="student-bulk-import-heading">
      <div className="family-panel-heading">
        <div>
          <span className="eyebrow">Bulk enrollment</span>
          <h2 id="student-bulk-import-heading">Create student accounts from CSV</h2>
        </div>
      </div>
      <p className="provisioning-context">
        Add up to 100 students to any active configured class for {sessionName || 'the selected session'}.
        Each row must include its class name; each account uses the same secure provisioning workflow as individual enrollment.
      </p>
      {!credentials.length && (
        <div className="student-bulk-controls">
          <label>
            <span className="field-label">Student CSV file</span>
            <input
              accept=".csv,text/csv"
              className="text-field file-field"
              disabled={isProcessing || batchStopped}
              key={fileInputKey}
              onChange={(event) => void handleFileChange(event)}
              type="file"
            />
          </label>
          <a
            className="sign-out-button template-download"
            download="student-import-template.csv"
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(
              `full_name,gender,class_name\nExample Student,female,${classes[0]?.name ?? 'Primary 1'}\n`,
            )}`}
          >
            <Download size={14} aria-hidden="true" />
            Download template
          </a>
        </div>
      )}
      {previewError && <p className="form-notice" role="alert">{previewError}</p>}
      {fileName && validationErrors.length === 0 && previewRows.length > 0 && (
        <>
          <p className="preview-summary">
            {fileName}: {previewRows.length} valid student record(s). Accounts will be created one at a time.
          </p>
          <div className="student-import-preview-wrap">
            <table className="attendance-table">
              <thead><tr><th scope="col">Record</th><th scope="col">Student name</th><th scope="col">Gender</th><th scope="col">Class</th></tr></thead>
              <tbody>
                {previewRows.slice(0, 10).map((student) => (
                  <tr key={student.recordNumber}>
                    <td>{student.recordNumber}</td>
                    <td>{student.fullName}</td>
                    <td>{student.gender ?? 'Not provided'}</td>
                    <td>{student.className}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {previewRows.length > 10 && (
              <p className="attendance-history-note">Previewing the first 10 of {previewRows.length} records.</p>
            )}
          </div>
          {credentials.length === 0 && (
            <div className="import-confirmations">
              <label className="confirmation-option">
                <input
                  checked={confirmation}
                  disabled={isProcessing}
                  onChange={(event) => setConfirmation(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  I verified these names and confirm that every account will be enrolled in the selected
                  class and academic session. I will deliver one-time credentials privately.
                </span>
              </label>
              <div className="import-action-buttons">
                <button
                  className="sign-in-button"
                  disabled={!confirmation || isProcessing || !sessionId || batchStopped}
                  onClick={() => void provisionBatch()}
                  type="button"
                >
                  <Upload size={15} aria-hidden="true" />
                  <span>{isProcessing
                    ? `Creating account ${Math.min(completedCount + 1, previewRows.length)} of ${previewRows.length}…`
                    : batchStopped ? 'Batch stopped; review before retrying'
                      : `Create ${previewRows.length} student accounts`}</span>
                </button>
                {!isProcessing && (batchStopped ? (
                  <button className="sign-out-button" onClick={clearStoppedBatch} type="button">
                    Reconcile and clear stopped batch
                  </button>
                ) : (
                  <button className="sign-out-button" onClick={clearPreview} type="button">Cancel import</button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {validationErrors.length > 0 && (
        <div className="student-import-errors" role="alert">
          <p>The file was not accepted. Correct every error before creating accounts.</p>
          <ul>{validationErrors.map((error) => <li key={error}>{error}</li>)}</ul>
        </div>
      )}
      {batchError && <p className="form-notice" role="alert">{batchError}</p>}
      {batchMessage && <p className="success-notice" role="status">{batchMessage}</p>}
      {credentials.length > 0 && (
        <div className="student-credentials">
          <p className="credential-warning">
            These one-time passwords are visible only in this page session. They are not stored for later
            retrieval. Securely download and deliver them privately before closing or refreshing this page.
          </p>
          <p className="preview-summary">
            {completedCount} of {previewRows.length} accounts confirmed by the server.
            {batchError ? ' The batch stopped early; see the warning above before retrying.' : ''}
          </p>
          <div className="student-import-preview-wrap">
            <table className="attendance-table">
              <thead><tr><th scope="col">Student</th><th scope="col">Class</th><th scope="col">Academic session</th><th scope="col">Login ID</th><th scope="col">Temporary password</th></tr></thead>
              <tbody>
                {credentials.map((credential) => (
                  <tr key={credential.loginId}>
                    <td>{credential.fullName}</td>
                    <td>{credential.className}</td>
                    <td>{credential.sessionName}</td>
                    <td><code>{credential.loginId}</code></td>
                    <td><code>{credential.temporaryPassword}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="import-action-buttons student-credential-actions">
            <button className="sign-in-button" onClick={handleCredentialDownload} type="button">
              <Download size={15} aria-hidden="true" />
              Download credentials securely
            </button>
            {!isProcessing && (
              <button
                className="sign-out-button"
                onClick={batchStopped ? clearStoppedBatch : clearPreview}
                type="button"
              >
                {batchStopped
                  ? 'Reconcile stopped batch and clear credentials'
                  : 'I have secured the credentials; clear them'}
              </button>
            )}
          </div>
        </div>
      )}
      {!fileName && !previewError && !credentials.length && (
        <p className="attendance-history-note">
          CSV columns: <code>full_name,gender,class_name</code>. Gender may be blank or one of female, male, undisclosed.
          Class names must match an active class configured in the portal. The selected academic session applies to all rows.
          No accounts are created until you review the preview and confirm.
        </p>
      )}
    </section>
  );
}
