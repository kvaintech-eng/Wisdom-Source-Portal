import { describe, expect, it } from 'vitest';
import {
  previewResultCsv,
  previewResultRows,
  type ImportStudent,
  type ImportSubject,
} from '../../src/domain/result-import';

const students: (ImportStudent & { fullName: string })[] = [
  { id: 'student-1', serial: 'WIS-001A', fullName: 'A Student' },
  { id: 'student-2', serial: 'WIS-002B', fullName: 'B Student' },
];

const subjects: ImportSubject[] = [
  { id: 'subject-1', name: 'English', caMaximum: 30, examMaximum: 70 },
  { id: 'subject-2', name: 'Mathematics', caMaximum: 20, examMaximum: 80 },
];

describe('previewResultCsv', () => {
  it('matches enrolled learner and subject identifiers without depending on letter case', () => {
    expect(previewResultCsv(
      'serial,subject,ca,exam\nwis-001a,english,20,65',
      students,
      subjects,
    )).toEqual({
      rows: [{
        student_id: 'student-1',
        subject_id: 'subject-1',
        ca_mark: 20,
        exam_mark: 65,
        serial: 'WIS-001A',
        studentName: 'A Student',
        subjectName: 'English',
      }],
      errors: [],
    });
  });

  it('rejects incorrect headers, missing rows, and malformed records', () => {
    expect(previewResultCsv('serial,subject,ca\nWIS-001A,English,10', students, subjects).errors)
      .toContain('Use these columns, in order: serial, subject, ca, exam.');
    expect(previewResultCsv('serial,subject,ca,exam', students, subjects).errors)
      .toContain('File must include the header and at least one result row.');
    expect(previewResultCsv(
      'serial,subject,ca,exam\nWIS-001A,English,10',
      students,
      subjects,
    ).errors[0]).toMatch(/exactly four columns/i);
  });

  it('rejects unknown learners, unknown subjects, invalid marks, and scores above maxima', () => {
    const preview = previewResultCsv([
      'serial,subject,ca,exam',
      'WIS-999Z,English,10,40',
      'WIS-001A,Science,10,40',
      'WIS-001A,English,1.234,40',
      'WIS-001A,English,31,40',
    ].join('\n'), students, subjects);
    expect(preview.rows).toHaveLength(0);
    expect(preview.errors).toHaveLength(4);
    expect(preview.errors[0]).toMatch(/serial not enrolled/i);
    expect(preview.errors[1]).toMatch(/subject not configured/i);
    expect(preview.errors[2]).toMatch(/at most two decimal places/i);
    expect(preview.errors[3]).toMatch(/exceeds the English maximum/i);
  });

  it('rejects duplicate learner-subject pairs and never imports a partial preview', () => {
    const preview = previewResultCsv([
      'serial,subject,ca,exam',
      'WIS-001A,English,10,40',
      'WIS-001A,English,11,40',
      'WIS-002B,Mathematics,15,70',
    ].join('\n'), students, subjects);
    expect(preview.rows).toHaveLength(0);
    expect(preview.errors).toEqual(['Record 3 duplicates this learner and subject.']);
  });
});

describe('previewResultRows', () => {
  it('validates spreadsheet cell values using the same roster and mark rules as CSV', () => {
    expect(previewResultRows([
      ['serial', 'subject', 'ca', 'exam'],
      ['wis-001a', 'english', 20, 65.5],
    ], students, subjects)).toEqual({
      rows: [{
        student_id: 'student-1',
        subject_id: 'subject-1',
        ca_mark: 20,
        exam_mark: 65.5,
        serial: 'WIS-001A',
        studentName: 'A Student',
        subjectName: 'English',
      }],
      errors: [],
    });
  });

  it('rejects blank cells and unsupported spreadsheet values', () => {
    const preview = previewResultRows([
      ['serial', 'subject', 'ca', 'exam'],
      ['WIS-001A', 'English', null, 60],
      ['WIS-002B', 'English', true, 60],
    ], students, subjects);
    expect(preview.rows).toHaveLength(0);
    expect(preview.errors).toHaveLength(2);
    expect(preview.errors[0]).toContain('missing value');
    expect(preview.errors[1]).toContain('non-negative marks');
  });
});
