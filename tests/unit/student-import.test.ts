import { describe, expect, it } from 'vitest';
import { previewStudentCsv } from '../../src/domain/student-import';

const classes = [
  { id: 'class-primary-1', name: 'Primary 1' },
  { id: 'class-ss-1', name: 'SS 1' },
];

describe('previewStudentCsv', () => {
  it('accepts configured classes, optional genders, and a UTF-8 BOM', () => {
    expect(previewStudentCsv(
      '\uFEFFfull_name,gender,class_name\r\n"Alex, Example",female,primary 1\r\nTaylor,,SS 1',
      classes,
    )).toEqual({
      rows: [
        {
          fullName: 'Alex, Example',
          gender: 'female',
          classId: 'class-primary-1',
          className: 'Primary 1',
          recordNumber: 2,
        },
        {
          fullName: 'Taylor',
          gender: null,
          classId: 'class-ss-1',
          className: 'SS 1',
          recordNumber: 3,
        },
      ],
      errors: [],
    });
  });

  it('rejects a missing data row or unexpected columns', () => {
    expect(previewStudentCsv('full_name,gender,class_name', classes).errors)
      .toContain('File must include the header and at least one student row.');
    expect(previewStudentCsv('name,gender,class_name\nAlex,female,Primary 1', classes).errors)
      .toContain('Use these columns, in order: full_name, gender, class_name.');
  });

  it('rejects malformed row shapes, blank names, long names, and invalid genders', () => {
    const preview = previewStudentCsv([
      'full_name,gender,class_name',
      ',female,Primary 1',
      `${'A'.repeat(161)},male,Primary 1`,
      'Alex,unknown,Primary 1',
      'Taylor,female,Primary 1,extra',
    ].join('\n'), classes);
    expect(preview.rows).toEqual([]);
    expect(preview.errors).toHaveLength(4);
  });

  it('rejects classes that are not active and configured in the portal', () => {
    expect(previewStudentCsv(
      'full_name,gender,class_name\nAlex,female,KG 1',
      classes,
    )).toEqual({
      rows: [],
      errors: ['Record 2 must specify an active class configured in the school portal.'],
    });
  });

  it('rejects batches above the 100-student safety limit', () => {
    const rows = Array.from({ length: 101 }, (_, index) => `Student ${index + 1},,Primary 1`).join('\n');
    expect(previewStudentCsv(`full_name,gender,class_name\n${rows}`, classes)).toEqual({
      rows: [],
      errors: ['A file can contain at most 100 students.'],
    });
  });
});
