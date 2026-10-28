import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const MAX_BODY_LENGTH = 2048;

function response(status: number, body: Record<string, string>, origin?: string): Response {
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
    console.error(JSON.stringify({ event: 'password_change_configuration_missing' }));
    return response(503, { error: 'Password change is unavailable.' });
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
  const authorization = request.headers.get('authorization');
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!accessToken || !supabaseUrl || !serviceRoleKey) {
    return response(401, { error: 'Sign in before changing your password.' }, origin ?? undefined);
  }

  const body = await readJson(request);
  if (typeof body !== 'object' || body === null || !('newPassword' in body)
    || typeof body.newPassword !== 'string'
    || body.newPassword.length < 12
    || body.newPassword.length > 128) {
    return response(400, { error: 'Use a password between 12 and 128 characters.' }, origin ?? undefined);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error: userError } = await adminClient.auth.getUser(accessToken);
  if (userError || !data.user) {
    return response(401, { error: 'Sign in before changing your password.' }, origin ?? undefined);
  }

  const { data: account, error: accountError } = await adminClient
    .from('user_accounts')
    .select('user_id')
    .eq('user_id', data.user.id)
    .eq('active', true)
    .maybeSingle();
  if (accountError) {
    console.error(JSON.stringify({
      event: 'password_change_account_check_failed',
      requestId: crypto.randomUUID(),
      code: accountError.code ?? 'unknown',
    }));
    return response(503, { error: 'Password change is unavailable.' }, origin ?? undefined);
  }
  if (!account) {
    return response(403, { error: 'This school account is inactive.' }, origin ?? undefined);
  }

  const { error: sessionInvalidationError } = await adminClient.rpc(
    'invalidate_account_sessions',
    {
      p_user_id: data.user.id,
      p_actor_user_id: data.user.id,
      p_reason: null,
    },
  );
  if (sessionInvalidationError) {
    console.error(JSON.stringify({
      event: 'password_change_session_gate_failed',
      requestId: crypto.randomUUID(),
      code: sessionInvalidationError.code ?? 'unknown',
    }));
    return response(503, { error: 'Your password could not be changed because the secure session gate is unavailable. Please try again or contact the school.' }, origin ?? undefined);
  }

  const { error: updateError } = await adminClient.auth.admin.updateUserById(data.user.id, {
    password: body.newPassword,
    app_metadata: {
      ...data.user.app_metadata,
      must_change_password: false,
    },
  });
  if (updateError) {
    console.error(JSON.stringify({
      event: 'password_change_failed',
      requestId: crypto.randomUUID(),
      status: updateError.status ?? 'unknown',
    }));
    return response(503, { error: 'Your current session was invalidated, but the password could not be changed. Sign in again or contact the school.' }, origin ?? undefined);
  }

  return response(200, { message: 'Password changed. Sign in again with your new password.' }, origin ?? undefined);
});
