export const SENIOR_SECONDARY_STREAMS = ['Science', 'Art', 'Commercial'] as const;

export type SeniorSecondaryStream = (typeof SENIOR_SECONDARY_STREAMS)[number];

export function isSeniorSecondaryStream(value: unknown): value is SeniorSecondaryStream {
  return typeof value === 'string'
    && SENIOR_SECONDARY_STREAMS.some((stream) => stream === value);
}
