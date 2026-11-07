export function calculateAttendancePresentDays(
  baselineDaysPresent: number,
  presentDaysAfterBaseline: number,
): number {
  return baselineDaysPresent + presentDaysAfterBaseline;
}
