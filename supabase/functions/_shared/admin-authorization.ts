interface AccessTokenClaims {
  readonly sub?: unknown;
  readonly iat?: unknown;
  readonly app_metadata?: unknown;
}

export interface AdminAccount {
  readonly role: string;
  readonly sessions_invalid_before: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeClaims(accessToken: string): AccessTokenClaims | null {
  const payload = accessToken.split('.')[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isRecord(claims) ? claims : null;
  } catch {
    return null;
  }
}

function requiresPasswordChange(metadata: unknown): boolean {
  if (!isRecord(metadata)) return false;
  const flag = metadata.must_change_password;
  return flag === true || flag === 'true';
}

export function hasValidSuperAdminSession(
  accessToken: string,
  userId: string,
  currentAppMetadata: unknown,
  account: AdminAccount,
): boolean {
  if (account.role !== 'super_admin' || requiresPasswordChange(currentAppMetadata)) return false;

  const claims = decodeClaims(accessToken);
  if (!claims || claims.sub !== userId
    || typeof claims.iat !== 'number' || !Number.isFinite(claims.iat)
    || requiresPasswordChange(claims.app_metadata)) {
    return false;
  }

  const invalidBefore = Date.parse(account.sessions_invalid_before);
  if (!Number.isFinite(invalidBefore)) return false;
  return invalidBefore < (claims.iat + 1) * 1000;
}
