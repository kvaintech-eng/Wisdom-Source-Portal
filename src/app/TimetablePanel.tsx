import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

type TimetableDocument = {
  id: string;
  object_path: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseDocuments(value: unknown): TimetableDocument[] | null {
  if (!Array.isArray(value)) return null;
  const documents: TimetableDocument[] = [];
  for (const row of value) {
    if (!isRecord(row)
      || typeof row.id !== 'string'
      || typeof row.object_path !== 'string'
      || typeof row.original_filename !== 'string'
      || typeof row.content_type !== 'string'
      || typeof row.size_bytes !== 'number'
      || typeof row.created_at !== 'string') {
      return null;
    }
    documents.push({
      id: row.id,
      object_path: row.object_path,
      original_filename: row.original_filename,
      content_type: row.content_type,
      size_bytes: row.size_bytes,
      created_at: row.created_at,
    });
  }
  return documents;
}

async function validateFile(file: File): Promise<string | null> {
  const fileTypes: Record<string, { extension: string; signature: number[] }> = {
    'application/pdf': { extension: '.pdf', signature: [0x25, 0x50, 0x44, 0x46, 0x2d] },
    'image/png': { extension: '.png', signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    'image/jpeg': { extension: '.jpg', signature: [0xff, 0xd8, 0xff] },
  };
  const format = fileTypes[file.type];
  if (!format || !file.name.toLowerCase().endsWith(format.extension)
    && !(file.type === 'image/jpeg' && file.name.toLowerCase().endsWith('.jpeg'))) {
    return 'Choose a PDF, PNG, or JPEG timetable file.';
  }
  if (file.size === 0 || file.size > 10 * 1024 * 1024) {
    return 'The timetable must be between 1 byte and 10 MiB.';
  }
  const signature = new Uint8Array(await file.slice(0, format.signature.length).arrayBuffer());
  if (!format.signature.every((byte, index) => signature[index] === byte)) {
    return 'The file contents do not match the selected file type.';
  }
  return null;
}

export default function TimetablePanel({
  classId,
  sessionId,
  termId,
}: {
  classId: string;
  sessionId: string;
  termId: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [documents, setDocuments] = useState<TimetableDocument[]>([]);
  const [publishedIds, setPublishedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [publishingId, setPublishingId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadDocuments() {
      if (!supabase || !classId || !sessionId || !termId) {
        setDocuments([]);
        setPublishedIds(new Set());
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError('');
      try {
        const { data, error: documentError } = await supabase
          .from('timetable_documents')
          .select('id,object_path,original_filename,content_type,size_bytes,created_at')
          .eq('class_id', classId)
          .eq('session_id', sessionId)
          .eq('term_id', termId)
          .order('created_at', { ascending: false });
        if (cancelled) return;
        if (documentError) {
          setError('Timetables could not be loaded. Refresh or contact the school.');
          return;
        }
        const parsed = parseDocuments(data);
        if (!parsed) {
          setError('Timetable records returned an unexpected response.');
          return;
        }
        setDocuments(parsed);
        if (parsed.length === 0) {
          setPublishedIds(new Set());
          return;
        }
        const { data: publications, error: publicationError } = await supabase
          .from('timetable_publications')
          .select('timetable_id')
          .in('timetable_id', parsed.map((document) => document.id));
        if (cancelled) return;
        if (publicationError || !Array.isArray(publications)) {
          setError('Timetable publication status could not be loaded.');
          return;
        }
        setPublishedIds(new Set(publications.flatMap((publication) => (
          isRecord(publication) && typeof publication.timetable_id === 'string'
            ? [publication.timetable_id]
            : []
        ))));
      } catch {
        if (!cancelled) setError('Timetables could not be loaded. Check your connection and try again.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadDocuments();
    return () => {
      cancelled = true;
    };
  }, [classId, sessionId, termId]);

  async function refreshDocuments() {
    if (!supabase) return;
    const { data, error: documentError } = await supabase
      .from('timetable_documents')
      .select('id,object_path,original_filename,content_type,size_bytes,created_at')
      .eq('class_id', classId)
      .eq('session_id', sessionId)
      .eq('term_id', termId)
      .order('created_at', { ascending: false });
    if (documentError) {
      setError('The timetable was saved, but the list could not be refreshed.');
      return;
    }
    const parsed = parseDocuments(data);
    if (!parsed) {
      setError('The timetable was saved, but the list returned an unexpected response.');
      return;
    }
    setDocuments(parsed);
    if (parsed.length === 0) {
      setPublishedIds(new Set());
      return;
    }
    const { data: publications, error: publicationError } = await supabase
      .from('timetable_publications')
      .select('timetable_id')
      .in('timetable_id', parsed.map((document) => document.id));
    if (publicationError || !Array.isArray(publications)) {
      setError('The timetable was saved, but publication status could not be refreshed.');
      return;
    }
    setPublishedIds(new Set(publications.flatMap((publication) => (
      isRecord(publication) && typeof publication.timetable_id === 'string'
        ? [publication.timetable_id]
        : []
    ))));
  }

  async function publish(documentId: string) {
    if (!supabase || publishingId) return;
    setPublishingId(documentId);
    setError('');
    setMessage('');
    try {
      const { error: publishError } = await supabase.rpc('publish_timetable', {
        p_timetable_id: documentId,
      });
      if (publishError) {
        setError('The timetable could not be published. Confirm the selected school period and try again.');
        return;
      }
      setPublishedIds((current) => new Set(current).add(documentId));
      setMessage('Timetable published for the selected class and school period.');
    } catch {
      setError('The timetable could not be published. Check your connection and try again.');
    } finally {
      setPublishingId('');
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !file || isUploading || !classId || !sessionId || !termId) return;
    setIsUploading(true);
    setError('');
    setMessage('');
    try {
      const validationError = await validateFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        setError('Your administrator session could not be verified. Sign in again.');
        return;
      }
      const extension = file.name.toLowerCase().endsWith('.jpeg') ? 'jpeg' : file.name.split('.').pop()?.toLowerCase();
      if (!extension) {
        setError('The timetable filename is invalid.');
        return;
      }
      const objectPath = `${sessionId}/${classId}/${crypto.randomUUID()}.${extension}`;
      const { error: storageError } = await supabase.storage
        .from('school-timetables')
        .upload(objectPath, file, { contentType: file.type, upsert: false });
      if (storageError) {
        setError('The timetable file could not be uploaded. Check the file and try again.');
        return;
      }
      const { data: document, error: insertError } = await supabase
        .from('timetable_documents')
        .insert({
          class_id: classId,
          session_id: sessionId,
          term_id: termId,
          object_path: objectPath,
          original_filename: file.name.slice(0, 255),
          content_type: file.type,
          size_bytes: file.size,
          uploaded_by: authData.user.id,
        })
        .select('id')
        .single();
      if (insertError || !document) {
        const { error: cleanupError } = await supabase.storage.from('school-timetables').remove([objectPath]);
        setError(cleanupError
          ? 'The timetable record could not be saved, and the uploaded file could not be cleaned up. Contact the system administrator.'
          : 'The timetable record could not be saved. The uploaded file was removed; verify the selected period and try again.');
        return;
      }
      const { error: publishError } = await supabase.rpc('publish_timetable', {
        p_timetable_id: document.id,
      });
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await refreshDocuments();
      if (publishError) {
        setError('The timetable was uploaded as a draft, but could not be published. Publish it from the list below.');
      } else {
        setPublishedIds((current) => new Set(current).add(document.id));
        setMessage('Timetable uploaded and published for the selected class and school period.');
      }
    } catch {
      setError('The timetable could not be uploaded. Check your connection and try again.');
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <section className="family-panel timetable-panel" aria-labelledby="timetable-heading">
      <div className="family-panel-heading">
        <div>
          <span className="eyebrow">Class resources</span>
          <h2 id="timetable-heading">Class timetable</h2>
        </div>
      </div>
      <form className="timetable-upload" onSubmit={(event) => void upload(event)}>
        <label>
          <span className="field-label">PDF, PNG, or JPEG file (maximum 10 MiB)</span>
          <input
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
            className="text-field file-field"
            disabled={isUploading || publishingId !== ''}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            ref={fileInputRef}
            required
            type="file"
          />
        </label>
        <button className="sign-in-button" disabled={!file || isUploading || publishingId !== ''} type="submit">
          <span>{isUploading ? 'Uploading timetable…' : 'Upload and publish'}</span>
        </button>
      </form>
      {error && <p className="form-notice" role="alert">{error}</p>}
      {message && <p className="success-notice" role="status">{message}</p>}
      {isLoading ? (
        <p className="empty-state">Loading class timetables…</p>
      ) : documents.length === 0 ? (
        <p className="empty-state">No timetable has been uploaded for this class and school period.</p>
      ) : (
        <ul className="timetable-list">
          {documents.map((document) => (
            <li key={document.id}>
              <div>
                <strong>{document.original_filename}</strong>
                <span>{(document.size_bytes / (1024 * 1024)).toFixed(2)} MiB · Uploaded {new Date(document.created_at).toLocaleDateString()}</span>
                <span>{publishedIds.has(document.id) ? 'Published' : 'Draft — not visible to families'}</span>
              </div>
              {!publishedIds.has(document.id) && (
                <button
                  className="sign-out-button"
                  disabled={publishingId !== ''}
                  onClick={() => void publish(document.id)}
                  type="button"
                >
                  {publishingId === document.id ? 'Publishing…' : 'Publish'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
