import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const encoder = new TextEncoder();
const MAX_BODY_LENGTH = 4096;
const DECOY_EMAIL = 'no-account@invalid-login.wisdom-source-school.invalid';
const INVALID_CREDENTIALS_MESSAGE = 'We could not sign you in. Check your login ID and password, or contact the school.';

interface LoginRequest {
  loginId: string;
  password: string;
}

function jsonResponse(
  status: number,
  body: Record<string, string>,
  corsOrigin?: string,
): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin',
  });
  if (corsOrigin) {
    headers.set('Access-Control-Allow-Origin', corsOrigin);
    headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function validLoginRequest(value: unknown): value is LoginRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.loginId === 'string'
    && candidate.loginId.trim().length > 0
    && candidate.loginId.trim().length <= 254
    && typeof candidate.password === 'string'
    && candidate.password.length > 0
    && candidate.password.length <= 1024;
}

async function readJsonBody(request: Request): Promise<
  { body: unknown; error: null } | { body: null; error: 'invalid' | 'too_large' }
> {
  const reader = request.body?.getReader();
  if (!reader) return { body: null, error: 'invalid' };

  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_LENGTH) {
      await reader.cancel();
      return { body: null, error: 'too_large' };
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
    return { body: JSON.parse(new TextDecoder().decode(bytes)), error: null };
  } catch {
    return { body: null, error: 'invalid' };
  }
}

async function hashLoginId(loginId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(loginId.trim().toUpperCase()),
  );
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request: Request) => {
  const appOrigin = Deno.env.get('PORTAL_ORIGIN');
  const origin = request.headers.get('origin');

  if (!appOrigin) {
    console.error(JSON.stringify({ event: 'login_configuration_missing', key: 'PORTAL_ORIGIN' }));
    return jsonResponse(503, { error: 'Secure sign-in is temporarily unavailable.' });
  }

  if (origin && origin !== appOrigin) {
    return jsonResponse(403, { error: 'Request not allowed.' });
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
    return jsonResponse(405, { error: 'Method not allowed.' }, origin ?? undefined);
  }

  const contentLengthHeader = request.headers.get('content-length');
  const contentLength = contentLengthHeader === null ? 0 : Number(contentLengthHeader);
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_BODY_LENGTH) {
    return jsonResponse(413, { error: 'Request is too large.' }, origin ?? undefined);
  }

  const parsed = await readJsonBody(request);
  if (parsed.error === 'too_large') {
    return jsonResponse(413, { error: 'Request is too large.' }, origin ?? undefined);
  }
  if (parsed.error) {
    return jsonResponse(400, { error: 'Invalid sign-in request.' }, origin ?? undefined);
  }

  const body: unknown = parsed.body;
  if (!validLoginRequest(body)) {
    return jsonResponse(400, { error: 'Invalid sign-in request.' }, origin ?? undefined);
  }

  const normalizedLoginId = body.loginId.trim().toUpperCase();
  const isSchoolLoginId = /^[A-Z0-9][A-Z0-9-]{0,63}$/.test(normalizedLoginId);
  const isAdminEmail = /^[^@\s]{1,64}@[A-Z0-9.-]{1,189}\.[A-Z]{2,63}$/i.test(
    body.loginId.trim(),
  );
  if (!isSchoolLoginId && !isAdminEmail) {
    return jsonResponse(401, { error: INVALID_CREDENTIALS_MESSAGE }, origin ?? undefined);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
  const loginIdHashSecret = Deno.env.get('LOGIN_ID_HASH_SECRET');
  if (!supabaseUrl || !serviceRoleKey || !publishableKey || !loginIdHashSecret
    || encoder.encode(loginIdHashSecret).length < 32) {
    console.error(JSON.stringify({ event: 'login_configuration_missing', key: 'server_secret' }));
    return jsonResponse(503, { error: 'Secure sign-in is temporarily unavailable.' }, origin ?? undefined);
  }

  const requestId = crypto.randomUUID();
  const loginHash = await hashLoginId(normalizedLoginId, loginIdHashSecret);
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: withinRateLimit, error: rateLimitError } = await adminClient.rpc(
    'consume_portal_login_attempt',
    { p_login_hash: loginHash },
  );
  if (rateLimitError) {
    console.error(JSON.stringify({
      event: 'login_rate_limit_failed',
      requestId,
      code: rateLimitError.code ?? 'unknown',
    }));
    return jsonResponse(503, { error: 'Secure sign-in is temporarily unavailable.' }, origin ?? undefined);
  }

  let identity: { auth_email?: string } | undefined;
  if (withinRateLimit) {
    const { data: resolvedIdentity, error: resolveError } = await adminClient.rpc(
      'resolve_portal_login',
      { p_login_hash: loginHash },
    );
    if (resolveError) {
      console.error(JSON.stringify({
        event: 'login_identity_resolution_failed',
        requestId,
        code: resolveError.code ?? 'unknown',
      }));
      return jsonResponse(503, { error: 'Secure sign-in is temporarily unavailable.' }, origin ?? undefined);
    }
    identity = Array.isArray(resolvedIdentity)
      ? resolvedIdentity[0] as { auth_email?: string } | undefined
      : undefined;
  }

  const authEmail = !withinRateLimit
    ? DECOY_EMAIL
    : isAdminEmail
      ? body.loginId.trim().toLowerCase()
      : identity?.auth_email ?? DECOY_EMAIL;
  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authResult, error: authError } = await authClient.auth.signInWithPassword({
    email: authEmail,
    password: body.password,
  });

  if (authError && typeof authError.status === 'number' && authError.status >= 500) {
    console.error(JSON.stringify({
      event: 'login_auth_provider_failed',
      requestId,
      status: authError.status,
    }));
    return jsonResponse(503, { error: 'Secure sign-in is temporarily unavailable.' }, origin ?? undefined);
  }

  if (!withinRateLimit || authError || !authResult.session || !authResult.user) {
    return jsonResponse(401, { error: INVALID_CREDENTIALS_MESSAGE }, origin ?? undefined);
  }

  if (isAdminEmail) {
    const { data: account, error: accountError } = await adminClient
      .from('user_accounts')
      .select('role')
      .eq('user_id', authResult.user.id)
      .eq('active', true)
      .maybeSingle();
    if (accountError) {
      console.error(JSON.stringify({
        event: 'login_admin_account_check_failed',
        requestId,
        code: accountError.code ?? 'unknown',
      }));
      return jsonResponse(503, { error: 'Secure sign-in is temporarily unavailable.' }, origin ?? undefined);
    }
    if (account?.role !== 'super_admin') {
      return jsonResponse(401, { error: INVALID_CREDENTIALS_MESSAGE }, origin ?? undefined);
    }
  } else if (!identity) {
    return jsonResponse(401, { error: INVALID_CREDENTIALS_MESSAGE }, origin ?? undefined);
  }

  return new Response(JSON.stringify({
    session: {
      access_token: authResult.session.access_token,
      refresh_token: authResult.session.refresh_token,
      expires_in: authResult.session.expires_in,
      expires_at: authResult.session.expires_at,
      token_type: authResult.session.token_type,
    },
  }), {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': origin ?? appOrigin,
      'Vary': 'Origin',
    },
  });
});
