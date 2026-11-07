import { Printer } from 'lucide-react';
import schoolLogo from '../assets/wisdom-source-logo.png';
import testimonialSeal from '../assets/wisdom-source-testimonial-seal.png';
import testimonialSignature from '../assets/wisdom-source-testimonial-signature.png';
import type { TestimonialDocument } from '../domain/testimonial';

function formatSchoolDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Not entered';
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString();
}

export default function TestimonialDocumentView({
  document,
  preview = false,
  printing = false,
  onPrint,
}: {
  document: TestimonialDocument;
  preview?: boolean;
  printing?: boolean;
  onPrint?: () => void;
}) {
  return (
    <article
      className="testimonial-document"
      data-printing={printing ? 'true' : undefined}
    >
      <div className="report-card-toolbar">
        <span className="report-revision-label">
          {preview
            ? 'Admin preview · Not saved or published'
            : `Approved ${new Date(document.issued_at).toLocaleDateString()}`}
        </span>
        {!preview && onPrint && (
          <button className="sign-out-button report-print-button" onClick={onPrint} type="button">
            <Printer size={14} aria-hidden="true" />
            Print / Save PDF
          </button>
        )}
      </div>
      <header className="report-document-heading testimonial-document-heading">
        <img alt="Wisdom Source School logo" className="report-school-logo" src={schoolLogo} />
        <div className="report-school-title">
          <span className="eyebrow">{preview ? 'Preview document' : 'Official school document'}</span>
          <h2>{document.school_name}</h2>
          {document.school_address && (
            <p className="testimonial-school-address">{document.school_address}</p>
          )}
          <p>Testimonial</p>
        </div>
      </header>
      <p className="testimonial-certification">
        This is to certify that <strong>{document.student_name}</strong> was a student
        of {document.school_name} and completed Senior Secondary 3 in the{' '}
        {document.graduation_session} academic session.
      </p>
      <dl className="testimonial-details">
        {document.former_school_name && (
          <div><dt>Previous school</dt><dd>{document.former_school_name}</dd></div>
        )}
        <div><dt>First enrolled</dt><dd>{formatSchoolDate(document.started_on)}</dd></div>
        <div><dt>Entry class</dt><dd>{document.started_class || 'Not entered'}</dd></div>
        <div><dt>Completed school</dt><dd>{formatSchoolDate(document.completed_on)}</dd></div>
        <div><dt>Graduating class</dt><dd>{document.completed_class}</dd></div>
        <div><dt>Graduation session</dt><dd>{document.graduation_session}</dd></div>
      </dl>
      <section className="testimonial-document-section">
        <h2>Subjects studied</h2>
        {document.subjects.length > 0 ? (
          <ul className="testimonial-subject-list">
            {document.subjects.map((subject, index) => <li key={`${subject}-${index}`}>{subject}</li>)}
          </ul>
        ) : (
          <p className="testimonial-preview-empty">Subjects will appear here when entered.</p>
        )}
      </section>
      <dl className="testimonial-details testimonial-observations">
        <div><dt>Academic ability</dt><dd>{document.academic_ability || 'Not recorded'}</dd></div>
        <div><dt>Curriculum activities</dt><dd>{document.curriculum_activities || 'Not recorded'}</dd></div>
        <div><dt>Hobby</dt><dd>{document.hobby || 'Not recorded'}</dd></div>
        <div><dt>School office held</dt><dd>{document.school_office || 'Not recorded'}</dd></div>
        <div><dt>Club, art, or other activity</dt><dd>{document.club_art || 'Not recorded'}</dd></div>
        <div className="testimonial-remarks"><dt>Remarks</dt><dd>{document.remarks || 'Not recorded'}</dd></div>
      </dl>
      <div className="report-signature testimonial-signature">
        <img
          alt="Wisdom Source School certificate seal"
          className="testimonial-seal-image"
          src={testimonialSeal}
        />
        <div className="report-signature-line">
          <img
            alt="Wisdom Source School signature and stamp"
            className="report-signature-image"
            src={testimonialSignature}
          />
          <span>Authorised signature and school stamp</span>
          <strong>Principal / Proprietor</strong>
          <small>{document.school_name}</small>
        </div>
      </div>
      <footer className="testimonial-document-footer">
        <span>{preview ? 'Preview only · Not approved or issued' : 'Approved by Wisdom Source School'}</span>
        {!preview && <span>Issued {new Date(document.issued_at).toLocaleDateString()}</span>}
      </footer>
    </article>
  );
}
