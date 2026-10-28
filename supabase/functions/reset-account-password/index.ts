import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { hasValidSuperAdminSession } from '../_shared/admin-authorization.ts';

const encoder = new TextEncoder();
const MAX_BODY_LENGTH = 4096;
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%*-_';

function response(status: number, body: Record<string, unknown>, origin?: string): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin',
  });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function generatePassword(): string {
  const output: string[] = [];
  const cutoff = 256 - (256 % PASSWORD_ALPHABET.length);
  while (output.length < 32) {
    for (const byte of crypto.getRandomValues(new Uint8Array(48))) {
      if (byte < cutoff) output.push(PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]);
      if (output.length === 32) break;
    }
  }
  return output.join('');
}

async function hashLoginId(loginId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(loginId.trim().toUpperCase()),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readJson(request: Request): Promise<unknown | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_LENGTH) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

Deno.serve(async (request: Request) => {
  const appOrigin = Deno.env.get('PORTAL_ORIGIN');
  const origin = request.headers.get('origin');
  if (!appOrigin) {
    console.error(JSON.stringify({ event: 'password_reset_configuration_missing' }));
    return response(503, { error: 'Password reset is unavailable.' });
  }
  if (origin && origin !== appOrigin) {
    return response(403, { error: 'Request not allowed.' });
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': appOrigin,
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Vary': 'Origin',
      },
    });
  }
  if (request.method !== 'POST') {
    return response(405, { error: 'Method not allowed.' }, origin ?? undefined);
  }
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_BODY_LENGTH) {
    return response(413, { error: 'Request is too large.' }, origin ?? undefined);
  }
  const body = await readJson(request);
  if (typeof body !== 'object' || body === null
    || !('loginId' in body) || typeof body.loginId !== 'string'
    || body.loginId.trim().length > 64
    || !('reason' in body) || typeof body.reason !== 'string'
    || body.reason.trim().length < 5 || body.reason.trim().length > 500
    || !/^[A-Z0-9][A-Z0-9-]{0,63}$/i.test(body.loginId.trim())) {
    return response(400, { error: 'Provide a valid school login ID and a reason for the reset.' }, origin ?? undefined);
  }

  const authorization = request.headers.get('authorization');
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const loginIdHashSecret = Deno.env.get('LOGIN_ID_HASH_SECRET');
  if (!accessToken || !supabaseUrl || !serviceRoleKey
    || !loginIdHashSecret || encoder.encode(loginIdHashSecret).length < 32) {
    return response(401, { error: 'An authorized Super Admin session is required.' }, origin ?? undefined);
  }

  const requestId = crypto.randomUUID();
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await adminClient.auth.getUser(accessToken);
  if (authError || !authData.user) {
    return response(401, { error: 'An authorized Super Admin session is required.' }, origin ?? undefined);
  }
  const { data: actor, error: actorError } = await adminClient
    .from('user_accounts')
    .select('role,sessions_invalid_before')
    .eq('user_id', authData.user.id)
    .eq('active', true)
    .maybeSingle();
  if (actorError) {
    console.error(JSON.stringify({
      event: 'password_reset_authorization_failed',
      requestId,
      code: actorError.code ?? 'unknown',
    }));
    return response(503, { error: 'Password reset is unavailable.' }, origin ?? undefined);
  }
  if (!actor || actor.role !== 'super_admin') {
    return response(403, { error: 'Only an active Super Admin can reset school passwords.' }, origin ?? undefined);
  }
  if (!hasValidSuperAdminSession(
    accessToken,
    authData.user.id,
    authData.user.app_metadata,
    actor,
  )) {
    return response(401, { error: 'An authorized Super Admin session is required.' }, origin ?? undefined);
  }

  const loginId = body.loginId.trim().toUpperCase();
  const { data: accounts, error: accountLookupError } = await adminClient.rpc(
    'resolve_portal_login_account',
    { p_login_hash: await hashLoginId(loginId, loginIdHashSecret) },
  );
  if (accountLookupError) {
    console.error(JSON.stringify({
      event: 'password_reset_account_lookup_failed',
      requestId,
      code: accountLookupError.code ?? 'unknown',
    }));
    return response(503, { error: 'Password reset is unavailable.' }, origin ?? undefined);
  }
  const target = Array.isArray(accounts)
    ? accounts[0] as { user_id?: string; role?: string } | undefined
    : undefined;
  if (!target?.user_id || (target.role !== 'student' && target.role !== 'parent')) {
    return response(404, { error: 'No active student or parent account was found for that login ID.' }, origin ?? undefined);
  }

  const temporaryPassword = generatePassword();
  const { data: targetUser, error: targetUserError } = await adminClient.auth.admin.getUserById(target.user_id);
  if (targetUserError || !targetUser.user) {
    console.error(JSON.stringify({
      event: 'password_reset_target_auth_lookup_failed',
      requestId,
      code: targetUserError?.status ?? 'unknown',
    }));
    return response(503, { error: 'Password reset is unavailable.' }, origin ?? undefined);
  }
  const { error: sessionInvalidationError } = await adminClient.rpc(
    'invalidate_account_sessions',
    {
      p_user_id: target.user_id,
      p_actor_user_id: authData.user.id,
      p_reason: body.reason.trim(),
    },
  );
  if (sessionInvalidationError) {
    console.error(JSON.stringify({
      event: 'password_reset_session_gate_failed',
      requestId,
      code: sessionInvalidationError.code ?? 'unknown',
    }));
    return response(503, { error: 'The password could not be reset because the secure session gate is unavailable. Contact the system administrator.' }, origin ?? undefined);
  }

  const { error: updateError } = await adminClient.auth.admin.updateUserById(target.user_id, {
    password: temporaryPassword,
    app_metadata: {
      ...targetUser.user.app_metadata,
      must_change_password: true,
    },
  });
  if (updateError) {
    console.error(JSON.stringify({
      event: 'password_reset_update_failed',
      requestId,
      status: updateError.status ?? 'unknown',
    }));
    return response(503, { error: 'The account session was invalidated, but the password could not be reset. Contact the system administrator before retrying.' }, origin ?? undefined);
  }

  return response(200, {
    loginId,
    temporaryPassword,
  }, origin ?? undefined);
});
