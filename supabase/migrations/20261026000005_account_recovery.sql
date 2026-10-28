create or replace function public.resolve_portal_login_account(p_login_hash text)
returns table (user_id uuid, role public.account_role)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Account lookup requires a trusted server operation';
  end if;
  if p_login_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  return query
  select account.user_id, account.role
  from private.portal_login_identities as identity
  join public.user_accounts as account on account.user_id = identity.user_id
  where identity.login_hash = p_login_hash
    and account.active
    and account.role in ('student', 'parent')
    and (
      (
        account.role = 'student'
        and exists (
          select 1 from public.students as student
          where student.auth_user_id = account.user_id and student.active
        )
      )
      or (
        account.role = 'parent'
        and exists (
          select 1 from public.parent_accounts as parent
          where parent.auth_user_id = account.user_id and parent.active
        )
      )
    );
end
$$;

revoke all on function public.resolve_portal_login_account(text) from public, anon, authenticated;
grant execute on function public.resolve_portal_login_account(text) to service_role;
