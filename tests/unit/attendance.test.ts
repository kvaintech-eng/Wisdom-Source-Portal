import { describe, expect, it } from 'vitest';
import {
  countScheduledSchoolDays,
  markUnmarkedAttendancePresent,
} from '../../src/domain/attendance';

describe('markUnmarkedAttendancePresent', () => {
  it('marks only unmarked learners present and preserves existing statuses', () => {
    const savedAbsent = { student_id: 'a', attendance_status: 'absent' as const };
    const savedPresent = { student_id: 'b', attendance_status: 'present' as const };
    const unmarked = { student_id: 'c', attendance_status: null };

    expect(markUnmarkedAttendancePresent([savedAbsent, savedPresent, unmarked])).toEqual([
      savedAbsent,
      savedPresent,
      { student_id: 'c', attendance_status: 'present' },
    ]);
  });
});

describe('countScheduledSchoolDays', () => {
  it('subtracts a scheduled Monday holiday exactly once', () => {
    expect(countScheduledSchoolDays(
      '2026-10-26',
      '2026-10-30',
      [1, 2, 3, 4, 5],
      [{ startsOn: '2026-10-26', endsOn: '2026-10-26', schoolOpen: false }],
    )).toBe(4);
  });

  it('does not subtract a weekend holiday or an open-school event', () => {
    expect(countScheduledSchoolDays(
      '2026-10-26',
      '2026-10-30',
      [1, 2, 3, 4, 5],
      [
        { startsOn: '2026-10-31', endsOn: '2026-10-31', schoolOpen: false },
        { startsOn: '2026-10-28', endsOn: '2026-10-28', schoolOpen: true },
      ],
    )).toBe(5);
  });

  it('subtracts every scheduled weekday in a multi-day closure', () => {
    expect(countScheduledSchoolDays(
      '2026-10-26',
      '2026-10-30',
      [1, 2, 3, 4, 5],
      [{ startsOn: '2026-10-27', endsOn: '2026-10-29', schoolOpen: false }],
    )).toBe(2);
  });

  it('rejects malformed term dates and open-day definitions', () => {
    expect(() => countScheduledSchoolDays('2026-02-30', '2026-03-02', [1], []))
      .toThrow(/invalid date/i);
    expect(() => countScheduledSchoolDays('2026-03-02', '2026-03-01', [1], []))
      .toThrow(/start date/i);
    expect(() => countScheduledSchoolDays('2026-03-01', '2026-03-02', [1, 1], []))
      .toThrow(/unique/i);
  });
});
