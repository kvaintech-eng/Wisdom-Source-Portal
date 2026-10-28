create or replace function public.create_academic_session(
  p_name text,
  p_starts_on date,
  p_ends_on date,
  p_activate boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_session_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only an active Super Admin can create an academic session';
  end if;
  if nullif(trim(p_name), '') is null
    or length(trim(p_name)) > 100
    or p_starts_on is null
    or p_ends_on is null
    or p_starts_on > p_ends_on then
    raise exception 'Provide a session name and a valid start and end date';
  end if;

  if p_activate then
    update public.academic_sessions set is_active = false where is_active;
  end if;

  insert into public.academic_sessions (name, starts_on, ends_on, is_active)
  values (trim(p_name), p_starts_on, p_ends_on, p_activate)
  returning id into new_session_id;

  insert into public.audit_logs (actor_user_id, action, target_type, target_id, change_summary)
  values (
    auth.uid(),
    'academic_session.created',
    'academic_session',
    new_session_id::text,
    jsonb_build_object(
      'name', trim(p_name),
      'starts_on', p_starts_on,
      'ends_on', p_ends_on,
      'is_active', p_activate
    )
  );

  return new_session_id;
end
$$;

create or replace function public.activate_academic_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_session public.academic_sessions%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Only an active Super Admin can activate an academic session';
  end if;

  select session.* into selected_session
  from public.academic_sessions as session
  where session.id = p_session_id
  for update;
  if not found then
    raise exception 'Academic session was not found';
  end if;
  if selected_session.is_active then
    return;
  end if;

  update public.academic_sessions set is_active = false where is_active;
  update public.academic_sessions set is_active = true where id = p_session_id;

  insert into public.audit_logs (actor_user_id, action, target_type, target_id, change_summary)
  values (
    auth.uid(),
    'academic_session.activated',
    'academic_session',
    p_session_id::text,
    jsonb_build_object('name', selected_session.name)
  );
end
$$;

create or replace function public.create_academic_term(
  p_session_id uuid,
  p_name text,
  p_starts_on date,
  p_ends_on date,
  p_open_weekdays smallint[] default array[1, 2, 3, 4, 5]::smallint[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_term_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only an active Super Admin can create academic terms';
  end if;
  if p_name not in ('First Term', 'Second Term', 'Third Term')
    or p_starts_on is null
    or p_ends_on is null
    or p_starts_on > p_ends_on
    or p_open_weekdays is null
    or cardinality(p_open_weekdays) not between 1 and 7
    or exists (
      select day
      from unnest(p_open_weekdays) as days(day)
      where day < 1 or day > 7
    )
    or cardinality(p_open_weekdays) <> (
      select count(distinct day) from unnest(p_open_weekdays) as days(day)
    ) then
    raise exception 'Provide a valid term name, date range, and unique open weekdays';
  end if;
  if not exists (
    select 1
    from public.academic_sessions as session
    where session.id = p_session_id
  ) then
    raise exception 'Academic session was not found';
  end if;
  if exists (
    select 1
    from public.academic_terms as term
    where term.session_id = p_session_id
      and term.starts_on <= p_ends_on
      and term.ends_on >= p_starts_on
  ) then
    raise exception 'Academic term dates cannot overlap another term in the same session';
  end if;

  insert into public.academic_terms (
    session_id, name, starts_on, ends_on, open_weekdays
  )
  values (
    p_session_id, p_name, p_starts_on, p_ends_on, p_open_weekdays
  )
  returning id into new_term_id;

  insert into public.audit_logs (actor_user_id, action, target_type, target_id, change_summary)
  values (
    auth.uid(),
    'academic_term.created',
    'academic_term',
    new_term_id::text,
    jsonb_build_object(
      'session_id', p_session_id,
      'name', p_name,
      'starts_on', p_starts_on,
      'ends_on', p_ends_on,
      'open_weekdays', p_open_weekdays
    )
  );

  return new_term_id;
end
$$;

create or replace function public.save_grading_scale(p_bands jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_version integer;
  band_count integer;
begin
  if not public.is_super_admin() then
    raise exception 'Only an active Super Admin can update grading bands';
  end if;
  if jsonb_typeof(p_bands) is distinct from 'array'
    or jsonb_array_length(p_bands) not between 1 and 12 then
    raise exception 'A grading scale must contain between 1 and 12 bands';
  end if;

  select count(*) into band_count
  from jsonb_to_recordset(p_bands) as band(grade text, minimum_percentage numeric, maximum_percentage numeric)
  where band.grade is not null
    and length(trim(band.grade)) between 1 and 8
    and band.minimum_percentage between 0 and 100
    and band.maximum_percentage between 0 and 100
    and band.minimum_percentage <= band.maximum_percentage;

  if band_count <> jsonb_array_length(p_bands)
    or exists (
      select 1
      from jsonb_to_recordset(p_bands) as band(grade text, minimum_percentage numeric, maximum_percentage numeric)
      group by lower(trim(band.grade))
      having count(*) > 1
    ) then
    raise exception 'Every grading band must have a unique name and valid percentage range';
  end if;

  if (
    select min(band.minimum_percentage)
    from jsonb_to_recordset(p_bands) as band(grade text, minimum_percentage numeric, maximum_percentage numeric)
  ) <> 0
  or (
    select max(band.maximum_percentage)
    from jsonb_to_recordset(p_bands) as band(grade text, minimum_percentage numeric, maximum_percentage numeric)
  ) <> 100
  or exists (
    select 1
    from (
      select
        band.minimum_percentage,
        lag(band.maximum_percentage) over (order by band.minimum_percentage) as previous_maximum
      from jsonb_to_recordset(p_bands) as band(grade text, minimum_percentage numeric, maximum_percentage numeric)
    ) as ordered_bands
    where ordered_bands.previous_maximum is not null
      and ordered_bands.minimum_percentage <> ordered_bands.previous_maximum + 0.01
  ) then
    raise exception 'Grading bands must cover 0 through 100 without gaps or overlaps';
  end if;

  select coalesce(max(grade.configuration_version), 0) + 1
  into next_version
  from public.grading_bands as grade;

  insert into public.grading_bands (
    grade, minimum_percentage, maximum_percentage, configuration_version
  )
  select
    trim(band.grade),
    band.minimum_percentage,
    band.maximum_percentage,
    next_version
  from jsonb_to_recordset(p_bands) as band(grade text, minimum_percentage numeric, maximum_percentage numeric);

  insert into public.audit_logs (actor_user_id, action, target_type, target_id, change_summary)
  values (
    auth.uid(),
    'grading_scale.created',
    'grading_scale',
    next_version::text,
    jsonb_build_object('version', next_version, 'bands', p_bands)
  );

  return next_version;
end
$$;

revoke all on function public.create_academic_session(text, date, date, boolean)
  from public, anon;
revoke all on function public.activate_academic_session(uuid)
  from public, anon;
revoke all on function public.create_academic_term(uuid, text, date, date, smallint[])
  from public, anon;
revoke all on function public.save_grading_scale(jsonb)
  from public, anon;

grant execute on function public.create_academic_session(text, date, date, boolean)
  to authenticated;
grant execute on function public.activate_academic_session(uuid)
  to authenticated;
grant execute on function public.create_academic_term(uuid, text, date, date, smallint[])
  to authenticated;
grant execute on function public.save_grading_scale(jsonb)
  to authenticated;
