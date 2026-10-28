export interface AssessmentMark {
  readonly ca: number;
  readonly exam: number;
  readonly caMaximum: number;
  readonly examMaximum: number;
}

export interface GradeBand {
  readonly grade: string;
  readonly minimumPercentage: number;
}

export interface ResultSummary {
  readonly totalObtained: number;
  readonly totalObtainable: number;
  readonly overallPercentage: number;
  readonly grade: string;
}

export interface RankedResult {
  readonly studentId: string;
  readonly percentage: number;
}

export interface ClassPosition extends RankedResult {
  readonly position: number;
}

export function formatOrdinalPosition(position: number): string {
  if (!Number.isInteger(position) || position < 1) {
    throw new Error('Class position must be a positive whole number.');
  }
  const lastTwoDigits = position % 100;
  const suffix = lastTwoDigits >= 11 && lastTwoDigits <= 13
    ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' } as const)[position % 10] ?? 'th';
  return `${position}${suffix}`;
}

export const DEFAULT_GRADE_BANDS: readonly GradeBand[] = [
  { grade: 'A', minimumPercentage: 70 },
  { grade: 'B', minimumPercentage: 60 },
  { grade: 'C', minimumPercentage: 50 },
  { grade: 'D', minimumPercentage: 45 },
  { grade: 'E', minimumPercentage: 40 },
  { grade: 'F', minimumPercentage: 0 },
];

function assertValidBands(bands: readonly GradeBand[]): void {
  if (bands.length === 0) {
    throw new Error('At least one grading band is required.');
  }

  const grades = new Set<string>();
  const thresholds = new Set<number>();
  for (const band of bands) {
    if (!band.grade.trim() || band.minimumPercentage < 0 || band.minimumPercentage > 100) {
      throw new Error('Grading bands require a grade and a threshold from 0 to 100.');
    }
    if (grades.has(band.grade) || thresholds.has(band.minimumPercentage)) {
      throw new Error('Grading bands cannot repeat grades or percentage thresholds.');
    }
    grades.add(band.grade);
    thresholds.add(band.minimumPercentage);
  }

  if (!thresholds.has(0)) {
    throw new Error('Grading bands must assign every score, including zero.');
  }
}

export function gradeForPercentage(
  percentage: number,
  bands: readonly GradeBand[] = DEFAULT_GRADE_BANDS,
): string {
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new Error('Percentage must be a number from 0 to 100.');
  }
  assertValidBands(bands);

  const band = [...bands]
    .sort((left, right) => right.minimumPercentage - left.minimumPercentage)
    .find((candidate) => percentage >= candidate.minimumPercentage);
  if (!band) {
    throw new Error('No grading band matches the percentage.');
  }
  return band.grade;
}

export function calculateResult(
  marks: readonly AssessmentMark[],
  bands: readonly GradeBand[] = DEFAULT_GRADE_BANDS,
): ResultSummary {
  if (marks.length === 0) {
    throw new Error('At least one subject result is required.');
  }

  let totalObtained = 0;
  let totalObtainable = 0;
  for (const mark of marks) {
    const values = [mark.ca, mark.exam, mark.caMaximum, mark.examMaximum];
    if (values.some((value) => !Number.isFinite(value) || value < 0)) {
      throw new Error('Marks and assessment maximums must be finite, non-negative numbers.');
    }
    if (mark.caMaximum + mark.examMaximum === 0) {
      throw new Error('Each subject must have a positive total obtainable mark.');
    }
    if (mark.ca > mark.caMaximum || mark.exam > mark.examMaximum) {
      throw new Error('A subject mark cannot exceed its configured assessment maximum.');
    }
    totalObtained += mark.ca + mark.exam;
    totalObtainable += mark.caMaximum + mark.examMaximum;
  }

  const overallPercentage = Math.round((totalObtained / totalObtainable) * 10000) / 100;
  return {
    totalObtained,
    totalObtainable,
    overallPercentage,
    grade: gradeForPercentage(overallPercentage, bands),
  };
}

export function rankClassResults(results: readonly RankedResult[]): ClassPosition[] {
  const studentIds = new Set<string>();
  for (const result of results) {
    if (!result.studentId || studentIds.has(result.studentId)) {
      throw new Error('Every ranked result must have a unique student ID.');
    }
    if (!Number.isFinite(result.percentage) || result.percentage < 0 || result.percentage > 100) {
      throw new Error('Ranked percentages must be numbers from 0 to 100.');
    }
    studentIds.add(result.studentId);
  }

  const ordered = [...results].sort(
    (left, right) => right.percentage - left.percentage
      || left.studentId.localeCompare(right.studentId),
  );

  let previousPercentage: number | undefined;
  let position = 0;
  return ordered.map((result, index) => {
    if (result.percentage !== previousPercentage) {
      position = index + 1;
      previousPercentage = result.percentage;
    }
    return { ...result, position };
  });
}
