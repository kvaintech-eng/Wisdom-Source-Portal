export interface CalendarClosure {
  readonly startsOn: string;
  readonly endsOn: string;
  readonly schoolOpen: boolean;
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnly(value: string): Date {
  if (!DATE_ONLY_PATTERN.test(value)) {
    throw new Error('Dates must use the YYYY-MM-DD format.');
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('The school calendar contains an invalid date.');
  }
  return date;
}

export function countScheduledSchoolDays(
  startsOn: string,
  endsOn: string,
  openWeekdays: readonly number[],
  closures: readonly CalendarClosure[],
): number {
  const start = parseDateOnly(startsOn);
  const end = parseDateOnly(endsOn);
  if (start > end) {
    throw new Error('The term start date must not be after its end date.');
  }

  const weekdays = new Set(openWeekdays);
  if (
    weekdays.size !== openWeekdays.length
    || weekdays.size === 0
    || [...weekdays].some((day) => !Number.isInteger(day) || day < 1 || day > 7)
  ) {
    throw new Error('Open weekdays must be unique ISO weekday numbers from 1 to 7.');
  }

  const closedRanges = closures
    .filter((closure) => !closure.schoolOpen)
    .map((closure) => {
      const closureStart = parseDateOnly(closure.startsOn);
      const closureEnd = parseDateOnly(closure.endsOn);
      if (closureStart > closureEnd) {
        throw new Error('A school closure cannot end before it starts.');
      }
      return { start: closureStart, end: closureEnd };
    });

  let scheduledDays = 0;
  for (let day = start.valueOf(); day <= end.valueOf(); day += 86_400_000) {
    const date = new Date(day);
    const isoWeekday = date.getUTCDay() || 7;
    if (!weekdays.has(isoWeekday)) {
      continue;
    }
    if (closedRanges.some(({ start: closureStart, end: closureEnd }) => (
      date >= closureStart && date <= closureEnd
    ))) {
      continue;
    }
    scheduledDays += 1;
  }

  return scheduledDays;
}
