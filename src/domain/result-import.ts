import { parseCsvRows } from './csv';

export interface ImportStudent {
  readonly id: string;
  readonly serial: string;
}

export interface ImportSubject {
  readonly id: string;
  readonly name: string;
  readonly caMaximum: number;
  readonly examMaximum: number;
}

export interface ResultImportRow {
  readonly student_id: string;
  readonly subject_id: string;
  readonly ca_mark: number;
  readonly exam_mark: number;
  readonly serial: string;
  readonly studentName: string;
  readonly subjectName: string;
}

export interface ResultImportPreview {
  readonly rows: readonly ResultImportRow[];
  readonly errors: readonly string[];
}

export function previewResultCsv(
  content: string,
  students: readonly (ImportStudent & { readonly fullName: string })[],
  subjects: readonly ImportSubject[],
): ResultImportPreview {
  let csvRows: string[][];
  try {
    csvRows = parseCsvRows(content);
  } catch (error) {
    return {
      rows: [],
      errors: [error instanceof Error ? error.message : 'CSV file could not be parsed.'],
    };
  }

  return previewResultRows(csvRows, students, subjects);
}

export function previewResultRows(
  sheetRows: readonly (readonly unknown[])[],
  students: readonly (ImportStudent & { readonly fullName: string })[],
  subjects: readonly ImportSubject[],
): ResultImportPreview {
  const normalizedRows = sheetRows.map((row) => row.map((cell) => (
    cell === null || cell === undefined ? '' : String(cell)
  )));

  if (normalizedRows.length < 2) {
    return { rows: [], errors: ['File must include the header and at least one result row.'] };
  }
  const header = normalizedRows[0]?.map((cell) => cell.trim().toLowerCase());
  if (!header || header.length !== 4
    || header[0] !== 'serial'
    || header[1] !== 'subject'
    || header[2] !== 'ca'
    || header[3] !== 'exam') {
    return {
      rows: [],
      errors: ['Use these columns, in order: serial, subject, ca, exam.'],
    };
  }

  const studentsBySerial = new Map(students.map((student) => [
    student.serial.trim().toUpperCase(),
    student,
  ]));
  const subjectsByName = new Map(subjects.map((subject) => [
    subject.name.trim().toLowerCase(),
    subject,
  ]));
  const seen = new Set<string>();
  const rows: ResultImportRow[] = [];
  const errors: string[] = [];

  normalizedRows.slice(1).forEach((cells, index) => {
    const recordNumber = index + 2;
    if (cells.length !== 4) {
      errors.push(`Record ${recordNumber} must contain exactly four columns.`);
      return;
    }
    const [serialCell, subjectCell, caCell, examCell] = cells.map((cell) => cell.trim());
    if (!serialCell || !subjectCell || !caCell || !examCell) {
      errors.push(`Record ${recordNumber} has a missing value.`);
      return;
    }
    const student = studentsBySerial.get(serialCell.toUpperCase());
    if (!student) {
      errors.push(`Record ${recordNumber} uses a student serial not enrolled in this class and session.`);
      return;
    }
    const subject = subjectsByName.get(subjectCell.toLocaleLowerCase());
    if (!subject) {
      errors.push(`Record ${recordNumber} uses a subject not configured for this class and term.`);
      return;
    }
    const caMark = parseMark(caCell);
    const examMark = parseMark(examCell);
    if (caMark === null || examMark === null) {
      errors.push(`Record ${recordNumber} must contain non-negative marks with at most two decimal places.`);
      return;
    }
    if (caMark > subject.caMaximum || examMark > subject.examMaximum) {
      errors.push(
        `Record ${recordNumber} exceeds the ${subject.name} maximum `
        + `(CA ${subject.caMaximum}, exam ${subject.examMaximum}).`,
      );
      return;
    }
    const resultKey = `${student.id}:${subject.id}`;
    if (seen.has(resultKey)) {
      errors.push(`Record ${recordNumber} duplicates this learner and subject.`);
      return;
    }
    seen.add(resultKey);
    rows.push({
      student_id: student.id,
      subject_id: subject.id,
      ca_mark: caMark,
      exam_mark: examMark,
      serial: student.serial,
      studentName: student.fullName,
      subjectName: subject.name,
    });
  });

  return { rows: errors.length === 0 ? rows : [], errors };
}

function parseMark(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const mark = Number(value);
  return Number.isFinite(mark) ? mark : null;
}
