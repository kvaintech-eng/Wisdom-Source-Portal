alter table public.user_accounts
  add column sessions_invalid_before timestamptz not null default now();

create or replace function public.current_account_role()
returns public.account_role
language sql
stable
security definer
set search_path = ''
as $$
  select account.role
  from public.user_accounts as account
  where account.user_id = (select auth.uid())
    and account.active
    -- JWT `iat` is second-precision; allow the rest of the issue second for a new session.
    and account.sessions_invalid_before < pg_catalog.to_timestamp(
      ((select auth.jwt()) ->> 'iat')::double precision + 1
    )
    and coalesce(
      (select auth.jwt()) -> 'app_metadata' ->> 'must_change_password',
      'false'
    ) <> 'true'
  limit 1
$$;

create or replace function public.invalidate_account_sessions(
  p_user_id uuid,
  p_actor_user_id uuid,
  p_reason text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.account_role;
  session_cutoff timestamptz;
  audit_action text;
  audit_reason text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Credential changes require a trusted server operation';
  end if;

  select account.role into actor_role
  from public.user_accounts as account
  where account.user_id = p_actor_user_id and account.active;

  if not found then
    raise exception 'Credential change requires an active school account';
  end if;

  if p_actor_user_id = p_user_id then
    audit_action := 'account.password_change_started';
    audit_reason := null;
  elsif actor_role = 'super_admin' and length(trim(coalesce(p_reason, ''))) >= 5 then
    audit_action := 'account.password_reset_started';
    audit_reason := trim(p_reason);
  else
    raise exception 'Credential reset requires an active Super Admin and a reason';
  end if;

  update public.user_accounts as account
  set sessions_invalid_before = pg_catalog.clock_timestamp()
  where account.user_id = p_user_id
    and account.active
  returning account.sessions_invalid_before into session_cutoff;

  if not found then
    raise exception 'Credential target is not an active school account';
  end if;

  insert into public.audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    reason,
    change_summary
  )
  values (
    p_actor_user_id,
    audit_action,
    'user_account',
    p_user_id::text,
    audit_reason,
    '{}'::jsonb
  );

  return session_cutoff;
end
$$;

revoke all on function public.invalidate_account_sessions(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.invalidate_account_sessions(uuid, uuid, text)
  to service_role;
