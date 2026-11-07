export type TestimonialDocument = {
  school_name: string;
  school_address: string;
  former_school_name: string;
  student_name: string;
  started_on: string;
  started_class: string;
  completed_on: string;
  completed_class: string;
  graduation_session: string;
  subjects: string[];
  academic_ability: string;
  curriculum_activities: string;
  hobby: string;
  school_office: string;
  club_art: string;
  remarks: string;
  issued_at: string;
};

export type StudentTestimonialStatus = {
  eligible: boolean;
  status: 'not_eligible' | 'pending' | 'approved';
  document: TestimonialDocument | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseStudentTestimonialStatus(value: unknown): StudentTestimonialStatus | null {
  if (!isRecord(value)
    || typeof value.eligible !== 'boolean'
    || (value.status !== 'not_eligible' && value.status !== 'pending' && value.status !== 'approved')) {
    return null;
  }
  if (!value.eligible) {
    return value.status === 'not_eligible'
      ? { eligible: false, status: 'not_eligible', document: null }
      : null;
  }
  if (value.status === 'pending') {
    return value.document === undefined || value.document === null
      ? { eligible: true, status: 'pending', document: null }
      : null;
  }
  if (!isRecord(value.document)) return null;
  const document = value.document;
  if (typeof document.school_name !== 'string'
    || typeof document.school_address !== 'string'
    || typeof document.former_school_name !== 'string'
    || typeof document.student_name !== 'string'
    || typeof document.started_on !== 'string'
    || typeof document.started_class !== 'string'
    || typeof document.completed_on !== 'string'
    || typeof document.completed_class !== 'string'
    || typeof document.graduation_session !== 'string'
    || !Array.isArray(document.subjects)
    || !document.subjects.every((subject) => typeof subject === 'string')
    || typeof document.academic_ability !== 'string'
    || typeof document.curriculum_activities !== 'string'
    || typeof document.hobby !== 'string'
    || typeof document.school_office !== 'string'
    || typeof document.club_art !== 'string'
    || typeof document.remarks !== 'string'
    || typeof document.issued_at !== 'string') {
    return null;
  }
  return {
    eligible: true,
    status: 'approved',
    document: {
      school_name: document.school_name,
      school_address: document.school_address,
      former_school_name: document.former_school_name,
      student_name: document.student_name,
      started_on: document.started_on,
      started_class: document.started_class,
      completed_on: document.completed_on,
      completed_class: document.completed_class,
      graduation_session: document.graduation_session,
      subjects: document.subjects,
      academic_ability: document.academic_ability,
      curriculum_activities: document.curriculum_activities,
      hobby: document.hobby,
      school_office: document.school_office,
      club_art: document.club_art,
      remarks: document.remarks,
      issued_at: document.issued_at,
    },
  };
}
