import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Eye, FileBadge2, Save } from 'lucide-react';
import type { TestimonialDocument } from '../domain/testimonial';
import { supabase } from '../lib/supabase';
import TestimonialDocumentView from './TestimonialDocumentView';

type Graduate = {
  student_id: string;
  serial: string;
  full_name: string;
  class_name: string;
  graduation_session: string;
  graduation_decision_id: string;
};

type SavedTestimonial = {
  student_id: string;
  former_school_name: string;
  started_on: string;
  started_class: string;
  completed_on: string;
  subjects: string[];
  academic_ability: string;
  curriculum_activities: string;
  hobby: string;
  school_office: string;
  club_art: string;
  remarks: string;
  status: 'draft' | 'approved';
};

type TestimonialForm = Omit<SavedTestimonial, 'student_id' | 'status'>;

const EMPTY_FORM: TestimonialForm = {
  former_school_name: '',
  started_on: '',
  started_class: '',
  completed_on: '',
  subjects: [],
  academic_ability: '',
  curriculum_activities: '',
  hobby: '',
  school_office: '',
  club_art: '',
  remarks: '',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseGraduates(value: unknown): Graduate[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: Graduate[] = [];
  for (const row of value) {
    if (!isRecord(row)
      || typeof row.student_id !== 'string'
      || typeof row.serial !== 'string'
      || typeof row.full_name !== 'string'
      || typeof row.class_name !== 'string'
      || typeof row.graduation_session !== 'string'
      || typeof row.graduation_decision_id !== 'string') return null;
    parsed.push({
      student_id: row.student_id,
      serial: row.serial,
      full_name: row.full_name,
      class_name: row.class_name,
      graduation_session: row.graduation_session,
      graduation_decision_id: row.graduation_decision_id,
    });
  }
  return parsed;
}

function parseSavedTestimonials(value: unknown): Map<string, SavedTestimonial> | null {
  if (!Array.isArray(value)) return null;
  const saved = new Map<string, SavedTestimonial>();
  for (const row of value) {
    if (!isRecord(row)
      || typeof row.student_id !== 'string'
      || typeof row.former_school_name !== 'string'
      || typeof row.started_on !== 'string'
      || typeof row.started_class !== 'string'
      || typeof row.completed_on !== 'string'
      || !Array.isArray(row.subjects)
      || !row.subjects.every((subject) => typeof subject === 'string')
      || typeof row.academic_ability !== 'string'
      || typeof row.curriculum_activities !== 'string'
      || typeof row.hobby !== 'string'
      || typeof row.school_office !== 'string'
      || typeof row.club_art !== 'string'
      || typeof row.remarks !== 'string'
      || (row.status !== 'draft' && row.status !== 'approved')) return null;
    saved.set(row.student_id, {
      student_id: row.student_id,
      former_school_name: row.former_school_name,
      started_on: row.started_on,
      started_class: row.started_class,
      completed_on: row.completed_on,
      subjects: row.subjects,
      academic_ability: row.academic_ability,
      curriculum_activities: row.curriculum_activities,
      hobby: row.hobby,
      school_office: row.school_office,
      club_art: row.club_art,
      remarks: row.remarks,
      status: row.status,
    });
  }
  return saved;
}

export default function TestimonialAdminPanel() {
  const [graduates, setGraduates] = useState<Graduate[]>([]);
  const [savedTestimonials, setSavedTestimonials] = useState<Map<string, SavedTestimonial>>(new Map());
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [form, setForm] = useState<TestimonialForm>(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isSamplePreviewOpen, setIsSamplePreviewOpen] = useState(false);
  const [schoolHeader, setSchoolHeader] = useState<{ school_name: string; school_address: string } | null>(null);

  const selectedGraduate = graduates.find((graduate) => graduate.student_id === selectedStudentId);
  const savedStatus = savedTestimonials.get(selectedStudentId)?.status;
  const subjectsText = useMemo(() => form.subjects.join('\n'), [form.subjects]);
  const previewDocument: TestimonialDocument | null = selectedGraduate && schoolHeader
    ? {
      school_name: schoolHeader.school_name,
      school_address: schoolHeader.school_address,
      former_school_name: form.former_school_name,
      student_name: selectedGraduate.full_name,
      started_on: form.started_on,
      started_class: form.started_class,
      completed_on: form.completed_on,
      completed_class: 'SS 3',
      graduation_session: selectedGraduate.graduation_session,
      subjects: form.subjects.map((subject) => subject.trim()).filter(Boolean),
      academic_ability: form.academic_ability,
      curriculum_activities: form.curriculum_activities,
      hobby: form.hobby,
      school_office: form.school_office,
      club_art: form.club_art,
      remarks: form.remarks,
      issued_at: '',
    }
    : null;
  const samplePreviewDocument: TestimonialDocument | null = schoolHeader
    ? {
      school_name: schoolHeader.school_name,
      school_address: schoolHeader.school_address,
      former_school_name: 'Example Community School',
      student_name: 'Sample Graduate (Fictional)',
      started_on: '2021-09-06',
      started_class: 'JSS 1',
      completed_on: '2027-07-16',
      completed_class: 'SS 3',
      graduation_session: '2026/2027 (Example)',
      subjects: ['English Language', 'Mathematics', 'Biology', 'Chemistry', 'Physics'],
      academic_ability: 'Example remark',
      curriculum_activities: 'Example activity',
      hobby: 'Example hobby',
      school_office: 'Example office',
      club_art: 'Example club',
      remarks: 'This is sample text for preview only.',
      issued_at: '',
    }
    : null;

  useEffect(() => {
    let cancelled = false;
    async function loadTestimonials() {
      if (!supabase) {
        setError('School database is not configured.');
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError('');
      try {
        const [graduateResult, testimonialResult] = await Promise.all([
          supabase.rpc('graduated_students_for_testimonials'),
          supabase.from('student_testimonials')
            .select('student_id,former_school_name,started_on,started_class,completed_on,subjects,academic_ability,curriculum_activities,hobby,school_office,club_art,remarks,status'),
        ]);
        if (cancelled) return;
        if (graduateResult.error || testimonialResult.error) {
          setError('Graduated learners or testimonial records could not be loaded.');
          return;
        }
        const parsedGraduates = parseGraduates(graduateResult.data);
        const parsedSaved = parseSavedTestimonials(testimonialResult.data);
        if (!parsedGraduates || !parsedSaved) {
          setError('Graduated learners or testimonial records returned an unexpected response.');
          return;
        }
        setGraduates(parsedGraduates);
        setSavedTestimonials(parsedSaved);
        setSelectedStudentId((current) => parsedGraduates.some((graduate) => (
          graduate.student_id === current
        )) ? current : parsedGraduates[0]?.student_id ?? '');
      } catch {
        if (!cancelled) setError('Testimonial records could not be loaded. Check your connection and try again.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadTestimonials();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  useEffect(() => {
    const saved = savedTestimonials.get(selectedStudentId);
    setForm(saved ? {
      former_school_name: saved.former_school_name,
      started_on: saved.started_on,
      started_class: saved.started_class,
      completed_on: saved.completed_on,
      subjects: saved.subjects,
      academic_ability: saved.academic_ability,
      curriculum_activities: saved.curriculum_activities,
      hobby: saved.hobby,
      school_office: saved.school_office,
      club_art: saved.club_art,
      remarks: saved.remarks,
    } : EMPTY_FORM);
    setError('');
    setMessage('');
    setIsPreviewOpen(false);
    setPreviewError('');
  }, [selectedStudentId, savedTestimonials]);

  function updateForm<K extends keyof TestimonialForm>(key: K, value: TestimonialForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setError('');
    setMessage('');
  }

  async function togglePreview() {
    if (isPreviewOpen) {
      setIsPreviewOpen(false);
      return;
    }
    if (!supabase) {
      setPreviewError('School database is not configured.');
      return;
    }
    setPreviewError('');
    try {
      const { data, error: settingsError } = await supabase
        .from('school_settings')
        .select('school_name,contact_details')
        .eq('id', true)
        .maybeSingle();
      if (settingsError || !isRecord(data)
        || typeof data.school_name !== 'string'
        || !isRecord(data.contact_details)) {
        setPreviewError('School details could not be loaded for the preview. Refresh and try again.');
        return;
      }
      const address = data.contact_details.address;
      setSchoolHeader({
        school_name: data.school_name,
        school_address: typeof address === 'string' ? address : '',
      });
      setIsPreviewOpen(true);
    } catch {
      setPreviewError('School details could not be loaded for the preview. Check your connection and try again.');
    }
  }

  async function toggleSamplePreview() {
    if (isSamplePreviewOpen) {
      setIsSamplePreviewOpen(false);
      return;
    }
    if (schoolHeader) {
      setIsSamplePreviewOpen(true);
      return;
    }
    if (!supabase) {
      setPreviewError('School database is not configured.');
      return;
    }
    setPreviewError('');
    try {
      const { data, error: settingsError } = await supabase
        .from('school_settings')
        .select('school_name,contact_details')
        .eq('id', true)
        .maybeSingle();
      if (settingsError || !isRecord(data)
        || typeof data.school_name !== 'string'
        || !isRecord(data.contact_details)) {
        setPreviewError('School details could not be loaded for the sample preview. Refresh and try again.');
        return;
      }
      const address = data.contact_details.address;
      setSchoolHeader({
        school_name: data.school_name,
        school_address: typeof address === 'string' ? address : '',
      });
      setIsSamplePreviewOpen(true);
    } catch {
      setPreviewError('School details could not be loaded for the sample preview. Check your connection and try again.');
    }
  }

  async function saveTestimonial(approve: boolean) {
    if (!supabase || !selectedGraduate || isSaving) return;
    const subjects = form.subjects.map((subject) => subject.trim()).filter(Boolean);
    if (subjects.length === 0 || subjects.length > 20) {
      setError('Enter between 1 and 20 subjects, one per line.');
      return;
    }
    if (approve && !window.confirm(
      `Approve and make ${selectedGraduate.full_name}'s testimonial available in their student portal?`,
    )) return;

    setIsSaving(true);
    setError('');
    setMessage('');
    try {
      const { error: saveError } = await supabase.rpc('save_student_testimonial', {
        p_student_id: selectedGraduate.student_id,
        p_testimonial: {
          ...form,
          subjects,
        },
        p_approve: approve,
      });
      if (saveError) {
        const detail = saveError.message.toLowerCase();
        setError(detail.includes('graduation')
          ? 'A confirmed SS 3 graduation is required before preparing this testimonial.'
          : detail.includes('date')
            ? 'Check that the start and completion dates are valid and in the right order.'
            : detail.includes('subject')
              ? 'Enter between 1 and 20 subjects, one per line.'
              : 'The testimonial could not be saved. Check the required fields and try again.');
        return;
      }
      setMessage(approve
        ? 'Testimonial approved and made available to the graduate.'
        : 'Testimonial draft saved. It is not visible to the student until approved.');
      setRefreshKey((current) => current + 1);
    } catch {
      setError('The testimonial could not be saved. Check your connection and try again.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="family-panel testimonial-admin-panel" aria-labelledby="testimonial-admin-heading">
      <div className="family-panel-heading">
        <div>
          <span className="eyebrow">Graduation documents</span>
          <h2 id="testimonial-admin-heading">Prepare testimonials</h2>
        </div>
        <div className="family-panel-actions">
          <button
            className="sign-out-button"
            onClick={() => void toggleSamplePreview()}
            type="button"
          >
            <Eye size={15} aria-hidden="true" />
            {isSamplePreviewOpen ? 'Close sample' : 'Preview sample'}
          </button>
          <span className="family-profile-icon"><FileBadge2 size={17} aria-hidden="true" /></span>
        </div>
      </div>
      <p className="testimonial-admin-guidance">
        Only learners with a confirmed SS 3 graduation appear here. Save a draft for review, then approve it
        before the graduate can download or print it.
      </p>
      {error && <p className="form-notice" role="alert">{error}</p>}
      {message && <p className="success-notice" role="status">{message}</p>}
      {previewError && <p className="form-notice" role="alert">{previewError}</p>}
      {isSamplePreviewOpen && samplePreviewDocument && (
        <section className="testimonial-admin-preview" aria-label="Fictional sample testimonial preview">
          <p className="testimonial-preview-notice">
            Fictional example only. No graduate is selected; this preview is not saved, approved, or visible to students.
          </p>
          <TestimonialDocumentView
            document={samplePreviewDocument}
            preview
            previewLabel="Fictional sample · Not saved or published"
          />
        </section>
      )}
      {isLoading ? (
        <p className="empty-state">Loading eligible graduates…</p>
      ) : graduates.length === 0 ? (
        <p className="empty-state">No confirmed SS 3 graduates are eligible for a testimonial yet.</p>
      ) : (
        <>
          <div className="testimonial-admin-controls">
            <label>
              <span className="field-label">Graduate</span>
              <select
                className="text-field"
                disabled={isSaving}
                onChange={(event) => setSelectedStudentId(event.target.value)}
                value={selectedStudentId}
              >
                {graduates.map((graduate) => (
                  <option key={graduate.student_id} value={graduate.student_id}>
                    {graduate.full_name} · {graduate.serial} · {graduate.graduation_session}
                  </option>
                ))}
              </select>
            </label>
            {savedStatus && (
              <span className={`testimonial-review-status testimonial-review-status-${savedStatus}`}>
                {savedStatus === 'approved' ? 'Approved' : 'Draft · awaiting approval'}
              </span>
            )}
          </div>
          {selectedGraduate && (
            <>
            <form
              className="testimonial-admin-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveTestimonial(false);
              }}
            >
              <p className="testimonial-graduate-context">
                {selectedGraduate.class_name} graduate · {selectedGraduate.graduation_session}
              </p>
              <div className="testimonial-form-grid">
                <label>
                  <span className="field-label">Former school name (optional)</span>
                  <input
                    className="text-field"
                    maxLength={200}
                    onChange={(event) => updateForm('former_school_name', event.target.value)}
                    value={form.former_school_name}
                  />
                </label>
                <label>
                  <span className="field-label">Started school on</span>
                  <input
                    className="text-field"
                    onChange={(event) => updateForm('started_on', event.target.value)}
                    required
                    type="date"
                    value={form.started_on}
                  />
                </label>
                <label>
                  <span className="field-label">Class when first enrolled</span>
                  <input
                    className="text-field"
                    maxLength={100}
                    onChange={(event) => updateForm('started_class', event.target.value)}
                    placeholder="e.g. Basic 4"
                    required
                    value={form.started_class}
                  />
                </label>
                <label>
                  <span className="field-label">Completed school on</span>
                  <input
                    className="text-field"
                    onChange={(event) => updateForm('completed_on', event.target.value)}
                    required
                    type="date"
                    value={form.completed_on}
                  />
                </label>
                <label className="testimonial-subjects-field">
                  <span className="field-label">Subjects completed (one per line)</span>
                  <textarea
                    className="text-field update-textarea"
                    maxLength={2200}
                    onChange={(event) => updateForm('subjects', event.target.value.split(/\r?\n/))}
                    placeholder={'English Language\nMathematics\nBasic Science'}
                    required
                    value={subjectsText}
                  />
                </label>
                <label>
                  <span className="field-label">Academic ability</span>
                  <input
                    className="text-field"
                    maxLength={200}
                    onChange={(event) => updateForm('academic_ability', event.target.value)}
                    placeholder="Enter an approved remark"
                    value={form.academic_ability}
                  />
                </label>
                <label>
                  <span className="field-label">Curriculum activities</span>
                  <input
                    className="text-field"
                    maxLength={200}
                    onChange={(event) => updateForm('curriculum_activities', event.target.value)}
                    placeholder="Enter an approved remark"
                    value={form.curriculum_activities}
                  />
                </label>
                <label>
                  <span className="field-label">Hobby</span>
                  <input
                    className="text-field"
                    maxLength={200}
                    onChange={(event) => updateForm('hobby', event.target.value)}
                    value={form.hobby}
                  />
                </label>
                <label>
                  <span className="field-label">School office held</span>
                  <input
                    className="text-field"
                    maxLength={200}
                    onChange={(event) => updateForm('school_office', event.target.value)}
                    value={form.school_office}
                  />
                </label>
                <label>
                  <span className="field-label">Club, art, or other activity</span>
                  <input
                    className="text-field"
                    maxLength={200}
                    onChange={(event) => updateForm('club_art', event.target.value)}
                    value={form.club_art}
                  />
                </label>
                <label className="testimonial-remarks-field">
                  <span className="field-label">Remarks</span>
                  <textarea
                    className="text-field update-textarea"
                    maxLength={1000}
                    onChange={(event) => updateForm('remarks', event.target.value)}
                    value={form.remarks}
                  />
                </label>
              </div>
              <div className="testimonial-admin-actions">
                <button
                  className="sign-out-button"
                  onClick={() => void togglePreview()}
                  type="button"
                >
                  <Eye size={15} aria-hidden="true" />
                  {isPreviewOpen ? 'Close preview' : 'Preview draft'}
                </button>
                <button className="sign-out-button" disabled={isSaving} type="submit">
                  <Save size={15} aria-hidden="true" />
                  {isSaving ? 'Saving draft…' : 'Save draft'}
                </button>
                <button
                  className="sign-in-button"
                  disabled={isSaving || !form.started_on || !form.started_class.trim()
                    || !form.completed_on || form.subjects.filter((subject) => subject.trim()).length === 0}
                  onClick={() => void saveTestimonial(true)}
                  type="button"
                >
                  <CheckCircle2 size={16} aria-hidden="true" />
                  {isSaving ? 'Processing…' : 'Approve & publish'}
                </button>
              </div>
            </form>
            {previewError && <p className="form-notice" role="alert">{previewError}</p>}
            {isPreviewOpen && previewDocument && (
              <section className="testimonial-admin-preview" aria-label="Admin-only testimonial preview">
                <p className="testimonial-preview-notice">
                  Admin-only preview. This reflects the current form, is not saved, and is not visible to the student.
                </p>
                <TestimonialDocumentView document={previewDocument} preview />
              </section>
            )}
            </>
          )}
        </>
      )}
    </section>
  );
}
