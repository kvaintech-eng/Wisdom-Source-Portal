import { describe, expect, it } from 'vitest';
import { parseCsvRows } from '../../src/domain/csv';

describe('parseCsvRows', () => {
  it('parses comma-separated rows with Windows line endings', () => {
    expect(parseCsvRows('serial,subject,ca,exam\r\nWIS-001A,English,10,60\r\nWIS-002B,Maths,15,70'))
      .toEqual([
        ['serial', 'subject', 'ca', 'exam'],
        ['WIS-001A', 'English', '10', '60'],
        ['WIS-002B', 'Maths', '15', '70'],
      ]);
  });

  it('supports escaped quotes, commas, and line breaks inside quoted values', () => {
    expect(parseCsvRows('serial,note\r\nWIS-001A,"Called ""Sam"",\r\nthen left"'))
      .toEqual([
        ['serial', 'note'],
        ['WIS-001A', 'Called "Sam",\r\nthen left'],
      ]);
  });

  it('ignores blank lines and accepts a final row without a newline', () => {
    expect(parseCsvRows('serial,ca,exam\n\nWIS-001A,10,20\n'))
      .toEqual([['serial', 'ca', 'exam'], ['WIS-001A', '10', '20']]);
  });

  it('rejects malformed quoted fields', () => {
    expect(() => parseCsvRows('serial,note\nWIS-001A,"unclosed')).toThrow(/unclosed/i);
    expect(() => parseCsvRows('serial,note\nWIS-001A,"value"x')).toThrow(/after a quoted/i);
  });
});
