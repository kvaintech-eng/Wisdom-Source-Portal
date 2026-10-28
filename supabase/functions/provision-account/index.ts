import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { hasValidSuperAdminSession } from '../_shared/admin-authorization.ts';

const encoder = new TextEncoder();
const MAX_BODY_LENGTH = 16_384;
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%*-_';

type StudentInput = {
  fullName: string;
  gender: 'female' | 'male' | 'undisclosed' | null;
  classId: string;
  sessionId: string;
};

type ParentInput = {
  displayName: string;
  students: Array<{ studentId: string; relationship: string }>;
};

type ProvisionRequest =
  | { role: 'student'; student: StudentInput }
  | { role: 'parent'; parent: ParentInput };

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validProvisionRequest(value: unknown): value is ProvisionRequest {
  if (!isRecord(value)) return false;
  if (value.role === 'student' && isRecord(value.student)) {
    const student = value.student;
    return typeof student.fullName === 'string'
      && student.fullName.trim().length > 0
      && student.fullName.trim().length <= 160
      && (student.gender === null
        || student.gender === 'female'
        || student.gender === 'male'
        || student.gender === 'undisclosed')
      && isUuid(student.classId)
      && isUuid(student.sessionId);
  }
  if (value.role === 'parent' && isRecord(value.parent)) {
    const parent = value.parent;
    return typeof parent.displayName === 'string'
      && parent.displayName.trim().length > 0
      && parent.displayName.trim().length <= 160
      && Array.isArray(parent.students)
      && parent.students.length > 0
      && parent.students.length <= 10
      && parent.students.every((link) => isRecord(link)
        && isUuid(link.studentId)
        && typeof link.relationship === 'string'
        && link.relationship.trim().length > 0
        && link.relationship.trim().length <= 80)
      && new Set(parent.students.map((link) => isRecord(link) ? link.studentId : null)).size
        === parent.students.length;
  }
  return false;
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

function generatePassword(): string {
  const output: string[] = [];
  const cutoff = 256 - (256 % PASSWORD_ALPHABET.length);
  while (output.length < 32) {
    const randomBytes = crypto.getRandomValues(new Uint8Array(48));
    for (const byte of randomBytes) {
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

Deno.serve(async (request: Request) => {
  const appOrigin = Deno.env.get('PORTAL_ORIGIN');
  const origin = request.headers.get('origin');
  if (!appOrigin) {
    console.error(JSON.stringify({ event: 'account_provisioning_configuration_missing' }));
    return response(503, { error: 'Account provisioning is unavailable.' });
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
  if (!validProvisionRequest(body)) {
    return response(400, { error: 'Provide a valid student or parent account request.' }, origin ?? undefined);
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
  const { data: account, error: accountError } = await adminClient
    .from('user_accounts')
    .select('role,sessions_invalid_before')
    .eq('user_id', authData.user.id)
    .eq('active', true)
    .maybeSingle();
  if (accountError) {
    console.error(JSON.stringify({
      event: 'account_provisioning_authorization_failed',
      requestId,
      code: accountError.code ?? 'unknown',
    }));
    return response(503, { error: 'Account provisioning is unavailable.' }, origin ?? undefined);
  }
  if (!account || account.role !== 'super_admin') {
    return response(403, { error: 'Only an active Super Admin can provision school accounts.' }, origin ?? undefined);
  }
  if (!hasValidSuperAdminSession(
    accessToken,
    authData.user.id,
    authData.user.app_metadata,
    account,
  )) {
    return response(401, { error: 'An authorized Super Admin session is required.' }, origin ?? undefined);
  }

  let loginId: string;
  if (body.role === 'student') {
    const { data: serial, error: serialError } = await adminClient.rpc('allocate_student_serial');
    if (serialError || typeof serial !== 'string') {
      console.error(JSON.stringify({
        event: 'account_provisioning_serial_allocation_failed',
        requestId,
        code: serialError?.code ?? 'invalid_response',
      }));
      return response(503, { error: 'A student login ID could not be issued.' }, origin ?? undefined);
    }
    loginId = serial;
  } else {
    loginId = `WS-P-${crypto.randomUUID().replaceAll('-', '').toUpperCase()}`;
  }

  const authUserId = crypto.randomUUID();
  const authEmail = `${authUserId}@login.wisdom-source-school.invalid`;
  const password = generatePassword();
  const { error: createUserError } = await adminClient.auth.admin.createUser({
    id: authUserId,
    email: authEmail,
    email_confirm: true,
    password,
    app_metadata: { must_change_password: true },
  });
  if (createUserError) {
    console.error(JSON.stringify({
      event: 'account_provisioning_auth_user_creation_failed',
      requestId,
      code: createUserError.status ?? 'unknown',
    }));
    return response(503, { error: 'The school account could not be created.' }, origin ?? undefined);
  }

  const rpcParameters = body.role === 'student'
    ? {
      p_actor_user_id: authData.user.id,
      p_auth_user_id: authUserId,
      p_role: 'student',
      p_login_id: loginId,
      p_auth_email: authEmail,
      p_login_hash: await hashLoginId(loginId, loginIdHashSecret),
      p_student_name: body.student.fullName.trim(),
      p_student_gender: body.student.gender,
      p_class_id: body.student.classId,
      p_session_id: body.student.sessionId,
      p_parent_name: null,
      p_parent_links: [],
    }
    : {
      p_actor_user_id: authData.user.id,
      p_auth_user_id: authUserId,
      p_role: 'parent',
      p_login_id: loginId,
      p_auth_email: authEmail,
      p_login_hash: await hashLoginId(loginId, loginIdHashSecret),
      p_student_name: null,
      p_student_gender: null,
      p_class_id: null,
      p_session_id: null,
      p_parent_name: body.parent.displayName.trim(),
      p_parent_links: body.parent.students.map((link) => ({
        student_id: link.studentId,
        relationship: link.relationship.trim(),
      })),
    };

  const { data: provisioned, error: provisionError } = await adminClient.rpc(
    'create_school_account',
    rpcParameters,
  );
  if (provisionError || !Array.isArray(provisioned) || provisioned.length !== 1) {
    const { error: rollbackError } = await adminClient.auth.admin.deleteUser(authUserId);
    console.error(JSON.stringify({
      event: 'account_provisioning_database_failed',
      requestId,
      code: provisionError?.code ?? 'invalid_response',
      rollbackFailed: Boolean(rollbackError),
    }));
    return response(rollbackError ? 503 : 400, {
      error: rollbackError
        ? 'Account setup could not be completed or rolled back. Contact the system administrator.'
        : 'The account could not be provisioned. Verify the selected school records.',
    }, origin ?? undefined);
  }

  return response(201, {
    account: body.role,
    loginId,
    temporaryPassword: password,
  }, origin ?? undefined);
});
