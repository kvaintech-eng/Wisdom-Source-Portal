import { parseCsvRows } from './csv';

export type StudentGender = 'female' | 'male' | 'undisclosed' | null;

export interface StudentImportRow {
  readonly fullName: string;
  readonly gender: StudentGender;
  readonly classId: string;
  readonly className: string;
  readonly recordNumber: number;
}

export interface StudentImportClass {
  readonly id: string;
  readonly name: string;
}

export interface StudentImportPreview {
  readonly rows: readonly StudentImportRow[];
  readonly errors: readonly string[];
}

const MAX_STUDENTS_PER_IMPORT = 100;

export function previewStudentCsv(
  content: string,
  classes: readonly StudentImportClass[],
): StudentImportPreview {
  let records: string[][];
  try {
    records = parseCsvRows(content.replace(/^\uFEFF/, ''));
  } catch (error) {
    return {
      rows: [],
      errors: [error instanceof Error ? error.message : 'CSV file could not be parsed.'],
    };
  }

  if (records.length < 2) {
    return { rows: [], errors: ['File must include the header and at least one student row.'] };
  }
  const header = records[0]?.map((cell) => cell.trim().toLowerCase());
  if (!header || header.length !== 3
    || header[0] !== 'full_name'
    || header[1] !== 'gender'
    || header[2] !== 'class_name') {
    return { rows: [], errors: ['Use these columns, in order: full_name, gender, class_name.'] };
  }
  if (records.length - 1 > MAX_STUDENTS_PER_IMPORT) {
    return { rows: [], errors: [`A file can contain at most ${MAX_STUDENTS_PER_IMPORT} students.`] };
  }

  const rows: StudentImportRow[] = [];
  const errors: string[] = [];
  const classesByName = new Map(classes.map((schoolClass) => [
    schoolClass.name.trim().toLocaleLowerCase(),
    schoolClass,
  ]));
  records.slice(1).forEach((cells, index) => {
    const recordNumber = index + 2;
    if (cells.length !== 3) {
      errors.push(`Record ${recordNumber} must contain exactly three columns.`);
      return;
    }
    const fullName = cells[0]?.trim() ?? '';
    const genderValue = cells[1]?.trim().toLowerCase() ?? '';
    const classNameValue = cells[2]?.trim() ?? '';
    if (!fullName) {
      errors.push(`Record ${recordNumber} requires a student full name.`);
      return;
    }
    if (fullName.length > 160) {
      errors.push(`Record ${recordNumber} student full name must be 160 characters or fewer.`);
      return;
    }
    let gender: StudentGender = null;
    if (genderValue === 'female' || genderValue === 'male' || genderValue === 'undisclosed') {
      gender = genderValue;
    } else if (genderValue) {
      errors.push(`Record ${recordNumber} gender must be female, male, undisclosed, or blank.`);
      return;
    }
    const schoolClass = classesByName.get(classNameValue.toLocaleLowerCase());
    if (!schoolClass) {
      errors.push(`Record ${recordNumber} must specify an active class configured in the school portal.`);
      return;
    }
    rows.push({
      fullName,
      gender,
      classId: schoolClass.id,
      className: schoolClass.name,
      recordNumber,
    });
  });

  return { rows: errors.length === 0 ? rows : [], errors };
}
