create table public.attendance_baselines (
  enrollment_id uuid not null references public.enrollments (id) on delete restrict,
  term_id uuid not null references public.academic_terms (id) on delete restrict,
  cutoff_date date not null,
  days_present integer not null check (days_present >= 0),
  created_by uuid not null references auth.users (id) on delete restrict,
  updated_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (enrollment_id, term_id)
);

alter table public.attendance_baselines enable row level security;
revoke all on public.attendance_baselines from public, anon, authenticated;
grant select on public.attendance_baselines to authenticated;

create policy attendance_baselines_admin_read
  on public.attendance_baselines for select to authenticated
  using (public.is_super_admin());

create or replace function public.class_attendance_baseline_register(
  p_class_id uuid,
  p_session_id uuid,
  p_term_id uuid,
  p_cutoff_date date
)
returns table (
  student_id uuid,
  enrollment_id uuid,
  serial text,
  full_name text,
  baseline_days_present integer,
  present_since_baseline integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  matching_term public.academic_terms%rowtype;
  latest_cutoff date;
begin
  if not public.is_super_admin() then
    raise exception 'Only an active Super Admin can view historical attendance totals';
  end if;

  select term.* into matching_term
  from public.academic_terms as term
  where term.id = p_term_id and term.session_id = p_session_id;
  if not found or p_cutoff_date < matching_term.starts_on
    or p_cutoff_date > least(matching_term.ends_on, current_date) then
    raise exception 'The cutoff date must be within the selected term and not later than today';
  end if;

  select max(baseline.cutoff_date) into latest_cutoff
  from public.attendance_baselines as baseline
  join public.enrollments as enrollment on enrollment.id = baseline.enrollment_id
  where enrollment.class_id = p_class_id
    and enrollment.session_id = p_session_id
    and baseline.term_id = p_term_id;
  if latest_cutoff is not null and p_cutoff_date < latest_cutoff then
    raise exception 'The cutoff date cannot be earlier than the existing saved cutoff';
  end if;

  return query
  select
    enrollment.student_id,
    enrollment.id,
    student.serial,
    student.full_name,
    coalesce(baseline.days_present, 0),
    coalesce(daily.present_count, 0)::integer
  from public.enrollments as enrollment
  join public.students as student on student.id = enrollment.student_id
  left join public.attendance_baselines as baseline
    on baseline.enrollment_id = enrollment.id and baseline.term_id = p_term_id
  left join lateral (
    select count(*) filter (where attendance.status = 'present')::integer as present_count
    from public.attendance_records as attendance
    where attendance.enrollment_id = enrollment.id
      and attendance.term_id = p_term_id
      and attendance.attendance_date > coalesce(
        baseline.cutoff_date,
        matching_term.starts_on - 1
      )
      and attendance.attendance_date <= p_cutoff_date
  ) as daily on true
  where enrollment.class_id = p_class_id
    and enrollment.session_id = p_session_id
    and enrollment.status = 'active'
  order by student.full_name, student.serial;
end
$$;

create or replace function public.save_class_attendance_baseline(
  p_class_id uuid,
  p_session_id uuid,
  p_term_id uuid,
  p_cutoff_date date,
  p_rows jsonb,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  matching_term public.academic_terms%rowtype;
  baseline_row record;
  scheduled_days integer;
  active_enrollment_count integer;
  saved_count integer := 0;
  latest_cutoff date;
begin
  if not public.is_super_admin() then
    raise exception 'Only an active Super Admin can save historical attendance totals';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'A reason of at least five characters is required when saving historical attendance totals';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Historical attendance totals must be supplied as a learner list';
  end if;
  if jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 500 then
    raise exception 'Historical attendance totals must include between 1 and 500 learners';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_rows) as entry(value)
    where jsonb_typeof(entry.value) is distinct from 'object'
      or jsonb_typeof(entry.value -> 'student_id') is distinct from 'string'
      or jsonb_typeof(entry.value -> 'days_present') is distinct from 'number'
      or (entry.value ->> 'days_present') !~ '^[0-9]+$'
  ) then
    raise exception 'Each learner total must contain a valid learner ID and a whole nonnegative number';
  end if;

  select term.* into matching_term
  from public.academic_terms as term
  where term.id = p_term_id and term.session_id = p_session_id;
  if not found or p_cutoff_date < matching_term.starts_on
    or p_cutoff_date > least(matching_term.ends_on, current_date) then
    raise exception 'The cutoff date must be within the selected term and not later than today';
  end if;

  select count(*)::integer into scheduled_days
  from generate_series(matching_term.starts_on, p_cutoff_date, interval '1 day') as school_day(day)
  where extract(isodow from school_day.day)::smallint = any(matching_term.open_weekdays)
    and not exists (
      select 1
      from public.school_calendar_events as calendar_event
      where calendar_event.session_id = p_session_id
        and (calendar_event.term_id is null or calendar_event.term_id = p_term_id)
        and school_day.day::date between calendar_event.starts_on and calendar_event.ends_on
        and (calendar_event.kind <> 'event' or not calendar_event.school_open)
    );

  select count(*)::integer into active_enrollment_count
  from public.enrollments as enrollment
  where enrollment.class_id = p_class_id
    and enrollment.session_id = p_session_id
    and enrollment.status = 'active';
  if active_enrollment_count = 0
    or jsonb_array_length(p_rows) <> active_enrollment_count then
    raise exception 'Historical attendance totals must include every active learner exactly once';
  end if;

  select max(baseline.cutoff_date) into latest_cutoff
  from public.attendance_baselines as baseline
  join public.enrollments as enrollment on enrollment.id = baseline.enrollment_id
  where enrollment.class_id = p_class_id
    and enrollment.session_id = p_session_id
    and baseline.term_id = p_term_id;
  if latest_cutoff is not null and p_cutoff_date < latest_cutoff then
    raise exception 'The cutoff date cannot be moved earlier than the existing saved cutoff';
  end if;

  for baseline_row in
    select submitted.student_id, submitted.days_present
    from jsonb_to_recordset(p_rows) as submitted(student_id uuid, days_present integer)
  loop
    if baseline_row.student_id is null
      or baseline_row.days_present is null
      or baseline_row.days_present < 0
      or baseline_row.days_present > scheduled_days then
      raise exception 'Each learner total must be between zero and the scheduled school days through the cutoff';
    end if;
    if not exists (
      select 1 from public.enrollments as enrollment
      where enrollment.student_id = baseline_row.student_id
        and enrollment.class_id = p_class_id
        and enrollment.session_id = p_session_id
        and enrollment.status = 'active'
    ) then
      raise exception 'Every learner must have an active enrollment in the selected class and session';
    end if;
    if (
      select count(*)
      from jsonb_to_recordset(p_rows) as submitted(student_id uuid, days_present integer)
      where submitted.student_id = baseline_row.student_id
    ) <> 1 then
      raise exception 'Each learner may appear only once in the historical attendance totals';
    end if;

    insert into public.attendance_baselines (
      enrollment_id, term_id, cutoff_date, days_present, created_by, updated_by
    )
    select enrollment.id, p_term_id, p_cutoff_date, baseline_row.days_present, auth.uid(), auth.uid()
    from public.enrollments as enrollment
    where enrollment.student_id = baseline_row.student_id
      and enrollment.class_id = p_class_id
      and enrollment.session_id = p_session_id
      and enrollment.status = 'active'
    on conflict (enrollment_id, term_id) do update
    set cutoff_date = excluded.cutoff_date,
        days_present = excluded.days_present,
        updated_by = excluded.updated_by,
        updated_at = now();

    saved_count := saved_count + 1;
  end loop;

  insert into public.audit_logs (
    actor_user_id, action, target_type, target_id, reason, change_summary
  )
  values (
    auth.uid(),
    'attendance.historical_totals_saved',
    'attendance_baseline',
    p_class_id::text,
    trim(p_reason),
    jsonb_build_object(
      'session_id', p_session_id,
      'term_id', p_term_id,
      'cutoff_date', p_cutoff_date,
      'learner_count', saved_count
    )
  );

  return saved_count;
end
$$;

create or replace function public.prevent_attendance_before_baseline_cutoff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  baseline_cutoff date;
begin
  select baseline.cutoff_date into baseline_cutoff
  from public.attendance_baselines as baseline
  where baseline.enrollment_id = new.enrollment_id
    and baseline.term_id = new.term_id;

  if found and new.attendance_date <= baseline_cutoff then
    raise exception 'Daily attendance must be recorded after the saved historical attendance cutoff';
  end if;

  return new;
end
$$;

create trigger attendance_records_after_baseline_cutoff
before insert or update on public.attendance_records
for each row execute function public.prevent_attendance_before_baseline_cutoff();

create or replace function public.apply_attendance_baseline_to_report_card()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_term_id uuid;
  baseline_record public.attendance_baselines%rowtype;
  present_days integer;
begin
  select finalization.term_id into report_term_id
  from public.class_result_finalizations as finalization
  where finalization.id = new.finalization_id;

  select baseline.* into baseline_record
  from public.attendance_baselines as baseline
  where baseline.enrollment_id = new.enrollment_id
    and baseline.term_id = report_term_id;

  if not found then
    return new;
  end if;

  select baseline_record.days_present + count(*) filter (where attendance.status = 'present')
    into present_days
  from public.attendance_records as attendance
  where attendance.enrollment_id = new.enrollment_id
    and attendance.term_id = report_term_id
    and attendance.attendance_date > baseline_record.cutoff_date;

  if present_days > new.attendance_scheduled then
    raise exception 'Historical and daily attendance exceeds the scheduled school days for this term';
  end if;

  new.attendance_present := present_days;
  new.snapshot := jsonb_set(new.snapshot, '{attendance_present}', to_jsonb(present_days), true);
  return new;
end
$$;

create trigger published_report_cards_apply_attendance_baseline
before insert on public.published_report_cards
for each row execute function public.apply_attendance_baseline_to_report_card();

revoke execute on function public.prevent_attendance_before_baseline_cutoff() from public, anon, authenticated;
revoke execute on function public.apply_attendance_baseline_to_report_card() from public, anon, authenticated;
revoke execute on function public.save_class_attendance_baseline(uuid, uuid, uuid, date, jsonb, text)
  from public, anon;
grant execute on function public.save_class_attendance_baseline(uuid, uuid, uuid, date, jsonb, text)
  to authenticated;
revoke execute on function public.class_attendance_baseline_register(uuid, uuid, uuid, date)
  from public, anon;
grant execute on function public.class_attendance_baseline_register(uuid, uuid, uuid, date)
  to authenticated;
