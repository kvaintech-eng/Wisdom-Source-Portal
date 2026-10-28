import { describe, expect, it } from 'vitest';
import {
  calculateResult,
  DEFAULT_GRADE_BANDS,
  formatOrdinalPosition,
  gradeForPercentage,
  rankClassResults,
} from '../../src/domain/results';

describe('formatOrdinalPosition', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [101, '101st'],
  ] as const)('formats position %i as %s', (position, expected) => {
    expect(formatOrdinalPosition(position)).toBe(expected);
  });

  it('rejects invalid positions', () => {
    expect(() => formatOrdinalPosition(0)).toThrow(/positive whole number/i);
    expect(() => formatOrdinalPosition(1.5)).toThrow(/positive whole number/i);
  });
});

describe('calculateResult', () => {
  it('calculates the weighted total and percentage across subjects', () => {
    const summary = calculateResult([
      { ca: 10, exam: 10, caMaximum: 20, examMaximum: 80 },
      { ca: 20, exam: 20, caMaximum: 20, examMaximum: 80 },
      { ca: 10, exam: 40, caMaximum: 20, examMaximum: 80 },
      { ca: 10, exam: 0, caMaximum: 20, examMaximum: 80 },
    ]);

    expect(summary).toEqual({
      totalObtained: 120,
      totalObtainable: 400,
      overallPercentage: 30,
      grade: 'F',
    });
  });

  it('rejects missing marks, invalid marks and impossible assessment maxima', () => {
    expect(() => calculateResult([])).toThrow(/at least one subject/i);
    expect(() => calculateResult([
      { ca: -1, exam: 1, caMaximum: 20, examMaximum: 80 },
    ])).toThrow(/non-negative/i);
    expect(() => calculateResult([
      { ca: 21, exam: 1, caMaximum: 20, examMaximum: 80 },
    ])).toThrow(/exceed/i);
    expect(() => calculateResult([
      { ca: 0, exam: 0, caMaximum: 0, examMaximum: 0 },
    ])).toThrow(/positive/i);
  });
});

describe('gradeForPercentage', () => {
  it.each([
    [0, 'F'],
    [39, 'F'],
    [40, 'E'],
    [44, 'E'],
    [45, 'D'],
    [49, 'D'],
    [50, 'C'],
    [59, 'C'],
    [60, 'B'],
    [69, 'B'],
    [70, 'A'],
    [100, 'A'],
  ] as const)('assigns %i%% to grade %s', (percentage, expectedGrade) => {
    expect(gradeForPercentage(percentage, DEFAULT_GRADE_BANDS)).toBe(expectedGrade);
  });

  it('rejects percentages outside the configured scale', () => {
    expect(() => gradeForPercentage(-1)).toThrow(/0 to 100/);
    expect(() => gradeForPercentage(101)).toThrow(/0 to 100/);
  });
});

describe('rankClassResults', () => {
  it('uses competition ranking, keeping tied percentages at the same position', () => {
    expect(rankClassResults([
      { studentId: 'three', percentage: 80 },
      { studentId: 'two', percentage: 90 },
      { studentId: 'one', percentage: 90 },
    ])).toEqual([
      { studentId: 'one', percentage: 90, position: 1 },
      { studentId: 'two', percentage: 90, position: 1 },
      { studentId: 'three', percentage: 80, position: 3 },
    ]);
  });

  it('does not mutate its input and rejects duplicate learner entries', () => {
    const results = [
      { studentId: 'second', percentage: 70 },
      { studentId: 'first', percentage: 90 },
    ];
    rankClassResults(results);
    expect(results[0]?.studentId).toBe('second');
    expect(() => rankClassResults([
      { studentId: 'same', percentage: 90 },
      { studentId: 'same', percentage: 80 },
    ])).toThrow(/unique student ID/i);
  });
});
