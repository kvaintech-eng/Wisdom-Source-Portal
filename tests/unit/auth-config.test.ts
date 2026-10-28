import { describe, expect, it } from 'vitest';
import { isPortalAuthEnabled } from '../../src/lib/auth-config';

describe('portal authentication configuration', () => {
  it('enables authentication in development when configured and explicitly enabled', () => {
    expect(isPortalAuthEnabled(true, 'true')).toBe(true);
  });

  it('keeps authentication disabled when the Supabase client is not configured', () => {
    expect(isPortalAuthEnabled(false, 'true')).toBe(false);
  });

  it('keeps authentication disabled unless the flag is exactly true', () => {
    expect(isPortalAuthEnabled(true, 'TRUE')).toBe(false);
    expect(isPortalAuthEnabled(true, 'false')).toBe(false);
    expect(isPortalAuthEnabled(true, undefined)).toBe(false);
  });

  it('allows explicitly enabled authentication in a production build', () => {
    expect(isPortalAuthEnabled(true, 'true')).toBe(true);
  });
});
