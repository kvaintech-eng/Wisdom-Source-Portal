import { describe, expect, it } from 'vitest';
import { calculateAttendancePresentDays } from '../../src/domain/attendanceBaseline';

describe('attendance baseline calculations', () => {
  it('uses the per-learner baseline and counts only later daily attendance', () => {
    expect(calculateAttendancePresentDays(18, 2)).toBe(20);
    expect(calculateAttendancePresentDays(0, 3)).toBe(3);
  });
});
