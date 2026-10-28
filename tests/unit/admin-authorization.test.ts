import { describe, expect, it } from 'vitest';
import { hasValidSuperAdminSession, type AdminAccount } from '../../supabase/functions/_shared/admin-authorization';

const account: AdminAccount = {
  role: 'super_admin',
  sessions_invalid_before: '1970-01-01T00:16:40.500Z',
};

function token(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `header.${payload}.signature`;
}

const metadata = { role: 'super_admin' };

describe('hasValidSuperAdminSession', () => {
  it('accepts an active administrator token issued after the session cutoff', () => {
    expect(hasValidSuperAdminSession(
      token({ sub: 'admin-id', iat: 1000, app_metadata: metadata }),
      'admin-id',
      metadata,
      account,
    )).toBe(true);
  });

  it('rejects an administrator token issued before the session cutoff', () => {
    expect(hasValidSuperAdminSession(
      token({ sub: 'admin-id', iat: 999, app_metadata: metadata }),
      'admin-id',
      metadata,
      account,
    )).toBe(false);
  });

  it('rejects tokens requiring a password change and tokens for another user', () => {
    expect(hasValidSuperAdminSession(
      token({
        sub: 'admin-id',
        iat: 1000,
        app_metadata: { ...metadata, must_change_password: true },
      }),
      'admin-id',
      metadata,
      account,
    )).toBe(false);
    expect(hasValidSuperAdminSession(
      token({ sub: 'different-user', iat: 1000, app_metadata: metadata }),
      'admin-id',
      metadata,
      account,
    )).toBe(false);
  });

  it('fails closed for malformed tokens, invalid cutoffs, and non-admin accounts', () => {
    expect(hasValidSuperAdminSession('invalid', 'admin-id', metadata, account)).toBe(false);
    expect(hasValidSuperAdminSession(
      token({ sub: 'admin-id', iat: 1000, app_metadata: metadata }),
      'admin-id',
      metadata,
      { ...account, sessions_invalid_before: 'invalid' },
    )).toBe(false);
    expect(hasValidSuperAdminSession(
      token({ sub: 'admin-id', iat: 1000, app_metadata: metadata }),
      'admin-id',
      metadata,
      { ...account, role: 'student' },
    )).toBe(false);
  });
});
