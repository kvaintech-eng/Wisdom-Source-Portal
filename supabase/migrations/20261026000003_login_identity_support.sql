create table private.portal_login_identities (
  login_hash text primary key check (login_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  auth_email text not null unique,
  created_at timestamptz not null default now()
);

create table private.portal_login_rate_limits (
  login_hash text primary key check (login_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count > 0)
);

alter table private.portal_login_identities enable row level security;
alter table private.portal_login_rate_limits enable row level security;

grant usage on schema private to service_role;
grant all on private.portal_login_identities to service_role;
grant all on private.portal_login_rate_limits to service_role;

create or replace function public.resolve_portal_login(p_login_hash text)
returns table (auth_email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Login resolution requires a trusted server operation';
  end if;

  if p_login_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  return query
  select identity.auth_email
  from private.portal_login_identities as identity
  join public.user_accounts as account on account.user_id = identity.user_id
  where identity.login_hash = p_login_hash
    and account.active
    and (
      (
        account.role = 'student'
        and exists (
          select 1
          from public.students as student
          where student.auth_user_id = account.user_id
            and student.active
        )
      )
      or (
        account.role = 'parent'
        and exists (
          select 1
          from public.parent_accounts as parent
          where parent.auth_user_id = account.user_id
            and parent.active
        )
      )
      or account.role = 'super_admin'
    );
end
$$;

create or replace function public.consume_portal_login_attempt(p_login_hash text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  attempts integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Login throttling requires a trusted server operation';
  end if;

  if p_login_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid login throttle key';
  end if;

  insert into private.portal_login_rate_limits (
    login_hash,
    window_started_at,
    attempt_count
  )
  values (
    p_login_hash,
    clock_timestamp(),
    1
  )
  on conflict (login_hash) do update
  set
    window_started_at = case
      when private.portal_login_rate_limits.window_started_at
        <= now() - interval '15 minutes'
      then now()
      else private.portal_login_rate_limits.window_started_at
    end,
    attempt_count = case
      when private.portal_login_rate_limits.window_started_at
        <= now() - interval '15 minutes'
      then 1
      else least(private.portal_login_rate_limits.attempt_count + 1, 6)
    end
  returning attempt_count into attempts;

  return attempts <= 5;
end
$$;

revoke all on function public.resolve_portal_login(text) from public, anon, authenticated;
revoke all on function public.consume_portal_login_attempt(text) from public, anon, authenticated;
grant execute on function public.resolve_portal_login(text) to service_role;
grant execute on function public.consume_portal_login_attempt(text) to service_role;
