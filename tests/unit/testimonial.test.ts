import { describe, expect, it } from 'vitest';
import { parseStudentTestimonialStatus } from '../../src/domain/testimonial';

describe('parseStudentTestimonialStatus', () => {
  const approvedDocument = {
    school_name: 'Wisdom Source School',
    school_address: 'School address',
    former_school_name: '',
    student_name: 'Ade Student',
    started_on: '2018-09-10',
    started_class: 'Basic 4',
    completed_on: '2025-07-18',
    completed_class: 'SS 3',
    graduation_session: '2024/2025',
    subjects: ['English Language', 'Mathematics'],
    academic_ability: 'Very good',
    curriculum_activities: '',
    hobby: 'Reading',
    school_office: '',
    club_art: 'Drama club',
    remarks: 'We wish Ade success.',
    issued_at: '2025-07-20T10:00:00Z',
  };

  it('represents a learner who is not eligible', () => {
    expect(parseStudentTestimonialStatus({
      eligible: false,
      status: 'not_eligible',
    })).toEqual({
      eligible: false,
      status: 'not_eligible',
      document: null,
    });
  });

  it('represents a qualifying learner whose testimonial awaits approval', () => {
    expect(parseStudentTestimonialStatus({
      eligible: true,
      status: 'pending',
      document: null,
    })).toEqual({
      eligible: true,
      status: 'pending',
      document: null,
    });
  });

  it('rejects malformed or unapproved document payloads', () => {
    expect(parseStudentTestimonialStatus({
      eligible: true,
      status: 'approved',
      document: { school_name: 'Wisdom Source School' },
    })).toBeNull();
    expect(parseStudentTestimonialStatus({
      eligible: false,
      status: 'approved',
    })).toBeNull();
  });

  it('parses an approved testimonial document', () => {
    expect(parseStudentTestimonialStatus({
      eligible: true,
      status: 'approved',
      document: approvedDocument,
    })).toEqual({
      eligible: true,
      status: 'approved',
      document: approvedDocument,
    });
  });
});
