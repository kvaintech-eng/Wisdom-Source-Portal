create table public.grade_scale_versions (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version > 0),
  created_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.class_result_publications (
  id uuid primary key default gen_random_uuid(),
  finalization_id uuid not null references public.class_result_finalizations (id) on delete restrict,
  published_by uuid not null references auth.users (id) on delete restrict,
  published_at timestamptz not null default now(),
  unique (finalization_id)
);

create table public.timetable_publications (
  timetable_id uuid primary key references public.timetable_documents (id) on delete restrict,
  published_by uuid not null references auth.users (id) on delete restrict,
  published_at timestamptz not null default now()
);

insert into public.grade_scale_versions (version, created_by)
values (1, null);

alter table public.grade_scale_versions enable row level security;
alter table public.class_result_publications enable row level security;
alter table public.timetable_publications enable row level security;

revoke all on public.grade_scale_versions from anon, authenticated;
revoke all on public.class_result_publications from anon, authenticated;
revoke all on public.timetable_publications from anon, authenticated;
grant select on public.grade_scale_versions, public.class_result_publications,
  public.timetable_publications to authenticated;
grant all on public.grade_scale_versions, public.class_result_publications,
  public.timetable_publications to service_role;

create policy grade_scale_versions_admin_read
  on public.grade_scale_versions for select to authenticated
  using ((select public.is_super_admin()));
create policy class_result_publications_linked_read
  on public.class_result_publications for select to authenticated
  using (
    (select public.is_active_account())
    and (
      (select public.is_super_admin())
      or exists (
        select 1
        from public.published_report_cards as report
        join public.enrollments as enrollment on enrollment.id = report.enrollment_id
        where report.finalization_id = class_result_publications.finalization_id
          and (select private.can_access_student(enrollment.student_id))
      )
    )
  );
create policy timetable_publications_linked_read
  on public.timetable_publications for select to authenticated
  using (
    (select public.is_active_account())
    and (
      (select public.is_super_admin())
      or exists (
        select 1
        from public.timetable_documents as document
        join public.academic_sessions as session on session.id = document.session_id
        join public.enrollments as enrollment
          on enrollment.class_id = document.class_id
          and enrollment.session_id = document.session_id
          and enrollment.status = 'active'
        where document.id = timetable_publications.timetable_id
          and session.is_active
          and (select private.can_access_student(enrollment.student_id))
      )
    )
  );

drop policy timetable_documents_select_current_class on public.timetable_documents;
create policy timetable_documents_select_current_class
  on public.timetable_documents for select to authenticated
  using (
    (select public.is_active_account())
    and exists (
      select 1
      from public.timetable_publications as publication
      join public.academic_sessions as session
        on session.id = timetable_documents.session_id
      where publication.timetable_id = timetable_documents.id
        and session.is_active
        and (
          (select public.is_super_admin())
          or exists (
            select 1
            from public.enrollments as enrollment
            where enrollment.class_id = timetable_documents.class_id
              and enrollment.session_id = timetable_documents.session_id
              and enrollment.status = 'active'
              and (select private.can_access_student(enrollment.student_id))
          )
        )
    )
  );

create or replace function public.save_attendance_register(
  p_class_id uuid,
  p_session_id uuid,
  p_term_id uuid,
  p_attendance_date date,
  p_rows jsonb,
  p_correction_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  register_row record;
  affected_rows integer := 0;
begin
  if not public.is_super_admin() then
    raise exception 'Only an active Super Admin can save attendance';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Attendance register must contain at least one student';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'Attendance register exceeds the supported class size';
  end if;

  for register_row in
    select
      row_data.student_id,
      row_data.status
    from jsonb_to_recordset(p_rows) as row_data(student_id uuid, status text)
  loop
    if register_row.status is null or register_row.status not in ('present', 'absent') then
      raise exception 'Every attendance status must be present or absent';
    end if;
    if not exists (
      select 1 from public.enrollments as enrollment
      where enrollment.student_id = register_row.student_id
        and enrollment.class_id = p_class_id
        and enrollment.session_id = p_session_id
        and enrollment.status = 'active'
    ) then
      raise exception 'Every learner must have an active enrollment in the selected class and session';
    end if;

    if (
      select count(*)
      from jsonb_to_recordset(p_rows) as submitted(student_id uuid, status text)
      where submitted.student_id = register_row.student_id
    ) <> 1 then
      raise exception 'Each learner may appear only once in an attendance register';
    end if;

    if exists (
      select 1
      from public.attendance_records as existing
      join public.enrollments as enrollment on enrollment.id = existing.enrollment_id
      where enrollment.student_id = register_row.student_id
        and enrollment.class_id = p_class_id
        and enrollment.session_id = p_session_id
        and existing.attendance_date = p_attendance_date
        and (
          existing.status is distinct from register_row.status::public.attendance_status
          or existing.term_id is distinct from p_term_id
        )
    ) and nullif(trim(p_correction_reason), '') is null then
      raise exception 'Correcting saved attendance requires a reason';
    end if;

    insert into public.attendance_records (
      enrollment_id,
      student_id,
      class_id,
      session_id,
      term_id,
      attendance_date,
      status,
      created_by
    )
    select
      enrollment.id,
      enrollment.student_id,
      enrollment.class_id,
      enrollment.session_id,
      p_term_id,
      p_attendance_date,
      register_row.status::public.attendance_status,
      auth.uid()
    from public.enrollments as enrollment
    where enrollment.student_id = register_row.student_id
      and enrollment.class_id = p_class_id
      and enrollment.session_id = p_session_id
      and enrollment.status = 'active'
    on conflict (enrollment_id, attendance_date) do update
    set
      status = excluded.status,
      term_id = excluded.term_id,
      correction_reason = nullif(trim(p_correction_reason), '')
    where public.attendance_records.status is distinct from excluded.status
      or public.attendance_records.term_id is distinct from excluded.term_id;

    affected_rows := affected_rows + 1;
  end loop;

  return affected_rows;
end
$$;

create or replace function public.class_attendance_register(
  p_class_id uuid,
  p_session_id uuid,
  p_term_id uuid,
  p_attendance_date date
)
returns table (
  student_id uuid,
  enrollment_id uuid,
  serial text,
  full_name text,
  attendance_status public.attendance_status
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only an active Super Admin can view class attendance registers';
  end if;

  return query
  select
    enrollment.student_id,
    enrollment.id,
    student.serial,
    student.full_name,
    attendance.status
  from public.enrollments as enrollment
  join public.students as student on student.id = enrollment.student_id
  left join public.attendance_records as attendance
    on attendance.enrollment_id = enrollment.id
    and attendance.term_id = p_term_id
    and attendance.attendance_date = p_attendance_date
  where enrollment.class_id = p_class_id
    and enrollment.session_id = p_session_id
    and enrollment.status = 'active'
  order by student.full_name, student.serial;
end
$$;

create or replace function public.publish_class_results(
  p_class_id uuid,
  p_session_id uuid,
  p_term_id uuid,
  p_teacher_comments jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  enrollment_row record;
  student_summary record;
  finalization_id uuid;
  next_revision integer;
  schema_count integer;
  present_days integer;
  scheduled_days integer;
  result_snapshot jsonb := '[]'::jsonb;
  result_rows jsonb;
  band_record record;
  publication_timestamp timestamptz := now();
begin
  if not public.is_super_admin() then
    raise exception 'Only an active Super Admin can finalize and publish results';
  end if;
  if p_teacher_comments is null or jsonb_typeof(p_teacher_comments) <> 'object' then
    raise exception 'Teacher comments must be supplied as a student-keyed object';
  end if;
  if (select count(*) from jsonb_object_keys(p_teacher_comments)) > 500
    or exists (
      select 1
      from jsonb_each_text(p_teacher_comments) as comment_entry(student_id, comment)
      where comment_entry.student_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or length(comment_entry.comment) > 500
    ) then
    raise exception 'Teacher comments must use student IDs and contain at most 500 characters';
  end if;
  select count(distinct assessment.subject_id) into schema_count
  from public.assessment_schemas as assessment
  where assessment.class_id = p_class_id
    and assessment.session_id = p_session_id
    and assessment.term_id = p_term_id
    and assessment.version = (
      select max(latest.version)
      from public.assessment_schemas as latest
      where latest.class_id = assessment.class_id
        and latest.session_id = assessment.session_id
        and latest.term_id = assessment.term_id
        and latest.subject_id = assessment.subject_id
    );
  if schema_count = 0 then
    raise exception 'Configure subject assessment maximums before publishing results';
  end if;

  if not exists (
    select 1
    from public.enrollments as enrollment
    where enrollment.class_id = p_class_id
      and enrollment.session_id = p_session_id
      and enrollment.status = 'active'
  ) then
    raise exception 'The selected class has no active enrollments';
  end if;

  if exists (
    select 1
    from public.enrollments as enrollment
    cross join lateral (
      select latest.*
      from public.assessment_schemas as latest
      where latest.class_id = p_class_id
        and latest.session_id = p_session_id
        and latest.term_id = p_term_id
        and latest.version = (
          select max(current_version.version)
          from public.assessment_schemas as current_version
          where current_version.class_id = latest.class_id
            and current_version.session_id = latest.session_id
            and current_version.term_id = latest.term_id
            and current_version.subject_id = latest.subject_id
        )
    ) as assessment
    left join public.results as result
      on result.enrollment_id = enrollment.id
      and result.schema_id = assessment.id
      and result.status = 'draft'
    where enrollment.class_id = p_class_id
      and enrollment.session_id = p_session_id
      and enrollment.status = 'active'
      and result.id is null
  ) then
    raise exception 'Every active learner must have a draft mark for every configured subject';
  end if;

  select coalesce(max(finalization.revision), 0) + 1
  into next_revision
  from public.class_result_finalizations as finalization
  where finalization.class_id = p_class_id
    and finalization.session_id = p_session_id
    and finalization.term_id = p_term_id;

  for enrollment_row in
    select enrollment.id, enrollment.student_id
    from public.enrollments as enrollment
    where enrollment.class_id = p_class_id
      and enrollment.session_id = p_session_id
      and enrollment.status = 'active'
  loop
    select
      sum(result.ca_mark + result.exam_mark) as total_obtained,
      sum(assessment.ca_maximum + assessment.exam_maximum) as total_obtainable
    into student_summary
    from public.results as result
    join public.assessment_schemas as assessment on assessment.id = result.schema_id
    where result.enrollment_id = enrollment_row.id
      and result.status = 'draft'
      and assessment.class_id = p_class_id
      and assessment.session_id = p_session_id
      and assessment.term_id = p_term_id
      and assessment.version = (
        select max(latest.version)
        from public.assessment_schemas as latest
        where latest.class_id = assessment.class_id
          and latest.session_id = assessment.session_id
          and latest.term_id = assessment.term_id
          and latest.subject_id = assessment.subject_id
      );

    select coalesce(count(*) filter (where attendance.status = 'present'), 0)::integer
    into present_days
    from public.attendance_records as attendance
    where attendance.enrollment_id = enrollment_row.id
      and attendance.term_id = p_term_id;

    select count(*)::integer
    into scheduled_days
    from generate_series(
      (
        select term.starts_on
        from public.academic_terms as term
        where term.id = p_term_id and term.session_id = p_session_id
      ),
      (
        select         term.ends_on
        from public.academic_terms as term
        where term.id = p_term_id and term.session_id = p_session_id
      ),
      interval '1 day'
    ) as scheduled_day(day)
    where extract(isodow from scheduled_day.day)::smallint = any(array(
      select unnest(term.open_weekdays)
      from public.academic_terms as term
      where term.id = p_term_id and term.session_id = p_session_id
    ))
    and not exists (
      select 1
      from public.school_calendar_events as calendar_event
      where calendar_event.session_id = p_session_id
        and (calendar_event.term_id is null or calendar_event.term_id = p_term_id)
        and scheduled_day.day::date between calendar_event.starts_on and calendar_event.ends_on
        and (calendar_event.kind <> 'event' or not calendar_event.school_open)
    );

    if student_summary.total_obtainable is null
      or student_summary.total_obtainable <= 0
      or present_days > scheduled_days then
      raise exception 'Learner results or attendance are incomplete; resolve the record before publishing';
    end if;

    result_rows := (
      select jsonb_agg(
        jsonb_build_object(
          'subject', subject.name,
          'ca', result.ca_mark,
          'exam', result.exam_mark,
          'obtained', result.ca_mark + result.exam_mark,
          'obtainable', assessment.ca_maximum + assessment.exam_maximum,
          'grade', (
            select grade.grade
            from public.grading_bands as grade
            where grade.configuration_version = (
              select max(latest.configuration_version)
              from public.grading_bands as latest
            )
              and result.ca_mark + result.exam_mark
                >= (assessment.ca_maximum + assessment.exam_maximum)
                  * grade.minimum_percentage / 100
            order by grade.minimum_percentage desc
            limit 1
          )
        )
        order by subject.name
      )
      from public.results as result
      join public.assessment_schemas as assessment on assessment.id = result.schema_id
      join public.subjects as subject on subject.id = assessment.subject_id
      where result.enrollment_id = enrollment_row.id
        and result.status = 'draft'
        and assessment.term_id = p_term_id
        and assessment.class_id = p_class_id
        and assessment.session_id = p_session_id
        and assessment.version = (
          select max(latest.version)
          from public.assessment_schemas as latest
          where latest.class_id = assessment.class_id
            and latest.session_id = assessment.session_id
            and latest.term_id = assessment.term_id
            and latest.subject_id = assessment.subject_id
        )
    );

    result_snapshot := result_snapshot || jsonb_build_array(jsonb_build_object(
      'enrollment_id', enrollment_row.id,
      'student_id', enrollment_row.student_id,
      'total_obtained', student_summary.total_obtained,
      'total_obtainable', student_summary.total_obtainable,
      'percentage', round(student_summary.total_obtained * 100 / student_summary.total_obtainable, 2),
      'subjects', coalesce(result_rows, '[]'::jsonb)
    ));
  end loop;

  insert into public.class_result_finalizations (
    class_id,
    session_id,
    term_id,
    revision,
    finalized_by,
    result_snapshot
  )
  values (
    p_class_id,
    p_session_id,
    p_term_id,
    next_revision,
    auth.uid(),
    result_snapshot
  )
  returning id into finalization_id;

  insert into public.class_result_publications (finalization_id, published_by)
  values (finalization_id, auth.uid());

  for student_summary in
    select
      entry.value ->> 'enrollment_id' as enrollment_id,
      (entry.value ->> 'total_obtained')::numeric as total_obtained,
      (entry.value ->> 'total_obtainable')::numeric as total_obtainable,
      (entry.value ->> 'percentage')::numeric as percentage,
      entry.value -> 'subjects' as subjects
    from jsonb_array_elements(result_snapshot) as entry(value)
  loop
    select grade.grade into band_record
    from public.grading_bands as grade
    where grade.configuration_version = (
      select max(latest.configuration_version) from public.grading_bands as latest
    )
      and student_summary.percentage >= grade.minimum_percentage
    order by grade.minimum_percentage desc
    limit 1;

    update public.results as result
    set
      status = 'published',
      published_at = publication_timestamp,
      grade = (
        select subject_result.value ->> 'grade'
        from jsonb_array_elements(student_summary.subjects) as subject_result(value)
        where subject_result.value ->> 'subject' = subject.name
      )
    from public.assessment_schemas as current_assessment
    join public.subjects as subject on subject.id = current_assessment.subject_id
    where result.enrollment_id = student_summary.enrollment_id::uuid
      and result.schema_id = current_assessment.id
      and current_assessment.class_id = p_class_id
      and current_assessment.session_id = p_session_id
      and current_assessment.term_id = p_term_id
      and result.status = 'draft';

    insert into public.published_report_cards (
      enrollment_id,
      finalization_id,
      overall_percentage,
      class_position,
      attendance_present,
      attendance_scheduled,
      snapshot
    )
    select
      student_summary.enrollment_id::uuid,
      finalization_id,
      student_summary.percentage,
      (
        select count(*)::integer + 1
        from jsonb_array_elements(result_snapshot) as other_entry(value)
        where (other_entry.value ->> 'percentage')::numeric > student_summary.percentage
      ),
      coalesce((
        select count(*)::integer
        from public.attendance_records as attendance
        where attendance.enrollment_id = student_summary.enrollment_id::uuid
          and attendance.term_id = p_term_id
          and attendance.status = 'present'
      ), 0),
      scheduled_days,
      jsonb_build_object(
        'academic_session', (select session.name from public.academic_sessions as session where session.id = p_session_id),
        'term', (select term.name from public.academic_terms as term where term.id = p_term_id),
        'school_name', (select settings.school_name from public.school_settings as settings where settings.id),
        'report_card_footer', (select settings.report_card_footer from public.school_settings as settings where settings.id),
        'student_name', (
          select student.full_name
          from public.enrollments as enrollment
          join public.students as student on student.id = enrollment.student_id
          where enrollment.id = student_summary.enrollment_id::uuid
        ),
        'student_serial', (
          select student.serial
          from public.enrollments as enrollment
          join public.students as student on student.id = enrollment.student_id
          where enrollment.id = student_summary.enrollment_id::uuid
        ),
        'class', (select class.name from public.classes as class where class.id = p_class_id),
        'total_obtained', student_summary.total_obtained,
        'total_obtainable', student_summary.total_obtainable,
        'overall_percentage', student_summary.percentage,
        'overall_grade', band_record.grade,
        'class_position', (
          select count(*)::integer + 1
          from jsonb_array_elements(result_snapshot) as other_entry(value)
          where (other_entry.value ->> 'percentage')::numeric > student_summary.percentage
        ),
        'subjects', student_summary.subjects,
        'teacher_comment', coalesce(
          p_teacher_comments ->> (
            select enrollment.student_id::text
            from public.enrollments as enrollment
            where enrollment.id = student_summary.enrollment_id::uuid
          ),
          ''
        ),
        'attendance_present', coalesce((
          select count(*)::integer
          from public.attendance_records as attendance
          where attendance.enrollment_id = student_summary.enrollment_id::uuid
            and attendance.term_id = p_term_id
            and attendance.status = 'present'
        ), 0),
        'attendance_scheduled', scheduled_days,
        'grade_scale_version', (
          select max(grade.configuration_version) from public.grading_bands as grade
        ),
        'published_at', publication_timestamp
      );
  end loop;

  insert into public.audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    change_summary
  )
  values (
    auth.uid(),
    'results.class_published',
    'class_result_finalization',
    finalization_id::text,
    jsonb_build_object(
      'class_id', p_class_id,
      'session_id', p_session_id,
      'term_id', p_term_id,
      'student_count', jsonb_array_length(result_snapshot),
      'revision', next_revision
    )
  );

  return finalization_id;
end
$$;

create or replace function public.publish_timetable(p_timetable_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  timetable public.timetable_documents%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Only an active Super Admin can publish timetables';
  end if;

  select document.* into timetable
  from public.timetable_documents as document
  where document.id = p_timetable_id;
  if not found then
    raise exception 'Timetable not found';
  end if;

  insert into public.timetable_publications (timetable_id, published_by)
  values (p_timetable_id, auth.uid())
  on conflict (timetable_id) do update
    set published_by = excluded.published_by, published_at = now();

  insert into public.audit_logs (actor_user_id, action, target_type, target_id)
  values (auth.uid(), 'timetable.published', 'timetable_document', p_timetable_id::text);
end
$$;

create or replace function public.scheduled_school_days(
  p_session_id uuid,
  p_term_id uuid
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  matching_term public.academic_terms%rowtype;
  days integer;
begin
  if not public.is_active_account() then
    raise exception 'An active school account is required';
  end if;

  select term.* into matching_term
  from public.academic_terms as term
  where term.id = p_term_id and term.session_id = p_session_id;
  if not found then
    raise exception 'Academic term was not found for the selected session';
  end if;

  select count(*)::integer into days
  from generate_series(
    matching_term.starts_on,
    least(matching_term.ends_on, current_date),
    interval '1 day'
  ) as scheduled_day(day)
  where extract(isodow from scheduled_day.day)::smallint = any(matching_term.open_weekdays)
    and not exists (
      select 1
      from public.school_calendar_events as calendar_event
      where calendar_event.session_id = p_session_id
        and (calendar_event.term_id is null or calendar_event.term_id = p_term_id)
        and scheduled_day.day::date between calendar_event.starts_on and calendar_event.ends_on
        and (calendar_event.kind <> 'event' or not calendar_event.school_open)
    );

  return days;
end
$$;

create or replace function public.create_school_account(
  p_actor_user_id uuid,
  p_auth_user_id uuid,
  p_role public.account_role,
  p_login_id text,
  p_auth_email text,
  p_login_hash text,
  p_student_name text default null,
  p_student_gender text default null,
  p_class_id uuid default null,
  p_session_id uuid default null,
  p_parent_name text default null,
  p_parent_links jsonb default '[]'::jsonb
)
returns table (student_id uuid, student_serial text, parent_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  generated_serial text;
  created_student_id uuid;
  created_parent_id uuid;
  parent_link record;
  parent_id_value uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Account provisioning requires a trusted server operation';
  end if;
  if not exists (
    select 1
    from public.user_accounts as actor
    where actor.user_id = p_actor_user_id
      and actor.role = 'super_admin'
      and actor.active
  ) then
    raise exception 'An active Super Admin must authorize account provisioning';
  end if;
  if p_role not in ('student', 'parent') or length(trim(p_login_id)) = 0
    or p_auth_email !~ '^[a-f0-9-]+@login[.]wisdom-source-school[.]invalid$'
    or p_login_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Account provisioning request is invalid';
  end if;
  if p_role = 'student' and (
    nullif(trim(p_student_name), '') is null
    or p_class_id is null
    or p_session_id is null
  ) then
    raise exception 'Student name, class, and academic session are required';
  end if;
  if p_role = 'parent' and (
    nullif(trim(p_parent_name), '') is null
    or jsonb_typeof(p_parent_links) is distinct from 'array'
    or jsonb_array_length(p_parent_links) = 0
  ) then
    raise exception 'Parent name and at least one linked learner are required';
  end if;
  if exists (
    select 1 from private.portal_login_identities as identity
    where identity.login_hash = p_login_hash or identity.auth_email = lower(p_auth_email)
  ) then
    raise exception 'A school login ID must be unique';
  end if;

  insert into public.user_accounts (user_id, role)
  values (p_auth_user_id, p_role);

  insert into private.portal_login_identities (login_hash, user_id, auth_email)
  values (p_login_hash, p_auth_user_id, lower(p_auth_email));

  if p_role = 'student' then
    if p_student_gender is not null
      and p_student_gender not in ('female', 'male', 'undisclosed') then
      raise exception 'Student gender is not a supported value';
    end if;
    if not exists (
      select 1 from public.classes as class
      where class.id = p_class_id and class.active
    ) or not exists (
      select 1 from public.academic_sessions as session
      where session.id = p_session_id
    ) then
      raise exception 'The selected class or academic session is unavailable';
    end if;

    generated_serial := upper(trim(p_login_id));
    if generated_serial !~ '^WIS-[0-9]{3,}[A-Z]$'
      or exists (
        select 1 from public.students as existing_student
        where existing_student.serial = generated_serial
      ) then
      raise exception 'Student serial is invalid or has already been assigned';
    end if;

    insert into public.students (
      serial, auth_user_id, full_name, gender
    )
    values (
      generated_serial, p_auth_user_id, trim(p_student_name), p_student_gender
    )
    returning id into created_student_id;

    insert into public.enrollments (student_id, class_id, session_id)
    values (created_student_id, p_class_id, p_session_id);

    insert into public.audit_logs (
      actor_user_id, action, target_type, target_id, change_summary
    )
    values (
      p_actor_user_id,
      'student.account_provisioned',
      'student',
      created_student_id::text,
      jsonb_build_object('serial', generated_serial, 'class_id', p_class_id, 'session_id', p_session_id)
    );
  else
    insert into public.parent_accounts (
      auth_user_id, login_id, display_name
    )
    values (
      p_auth_user_id, upper(trim(p_login_id)), trim(p_parent_name)
    )
    returning id into created_parent_id;

    parent_id_value := created_parent_id;
    for parent_link in
      select row_data.student_id, row_data.relationship
      from jsonb_to_recordset(p_parent_links)
        as row_data(student_id uuid, relationship text)
    loop
      if nullif(trim(parent_link.relationship), '') is null
        or not exists (
          select 1 from public.students as student
          where student.id = parent_link.student_id and student.active
        ) then
        raise exception 'Every parent link requires an active learner and relationship';
      end if;

      insert into public.parent_student_links (
        parent_id, student_id, relationship, verified_at
      )
      values (
        created_parent_id,
        parent_link.student_id,
        trim(parent_link.relationship),
        now()
      );
    end loop;

    insert into public.audit_logs (
      actor_user_id, action, target_type, target_id, change_summary
    )
    values (
      p_actor_user_id,
      'parent.account_provisioned',
      'parent_account',
      created_parent_id::text,
      jsonb_build_object('linked_student_count', jsonb_array_length(p_parent_links))
    );
  end if;

  return query select created_student_id, generated_serial, parent_id_value;
end
$$;

create or replace function public.save_school_settings(
  p_school_name text,
  p_contact_details jsonb,
  p_report_card_footer text,
  p_watermark_object_path text,
  p_signature_object_path text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_version integer;
begin
  if not public.is_super_admin() then
    raise exception 'Only an active Super Admin can update school settings';
  end if;
  if nullif(trim(p_school_name), '') is null
    or jsonb_typeof(p_contact_details) is distinct from 'object' then
    raise exception 'School name and valid contact details are required';
  end if;

  update public.school_settings as settings
  set
    school_name = trim(p_school_name),
    contact_details = p_contact_details,
    report_card_footer = coalesce(p_report_card_footer, ''),
    watermark_object_path = p_watermark_object_path,
    signature_object_path = p_signature_object_path,
    configuration_version = settings.configuration_version + 1,
    updated_at = now()
  where settings.id;

  select settings.configuration_version into new_version
  from public.school_settings as settings where settings.id;

  insert into public.audit_logs (
    actor_user_id, action, target_type, target_id, change_summary
  )
  values (
    auth.uid(),
    'school.settings_updated',
    'school_settings',
    'school',
    jsonb_build_object('school_name', trim(p_school_name), 'configuration_version', new_version)
  );

  return new_version;
end
$$;

create or replace function public.save_calendar_event(
  p_session_id uuid,
  p_term_id uuid,
  p_title text,
  p_description text,
  p_starts_on date,
  p_ends_on date,
  p_kind public.calendar_event_kind,
  p_school_open boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_event_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only an active Super Admin can manage the school calendar';
  end if;

  insert into public.school_calendar_events (
    session_id, term_id, title, description, starts_on, ends_on,
    kind, school_open, created_by
  )
  values (
    p_session_id, p_term_id, trim(p_title), coalesce(p_description, ''),
    p_starts_on, p_ends_on, p_kind,
    case when p_kind = 'event' then coalesce(p_school_open, true) else false end,
    auth.uid()
  )
  returning id into new_event_id;

  insert into public.audit_logs (actor_user_id, action, target_type, target_id)
  values (auth.uid(), 'calendar.event_created', 'school_calendar_event', new_event_id::text);

  return new_event_id;
end
$$;

create or replace function public.publish_announcement(
  p_title text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_announcement_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only an active Super Admin can publish school announcements';
  end if;

  insert into public.announcements (title, body, published_at, created_by)
  values (trim(p_title), trim(p_body), now(), auth.uid())
  returning id into new_announcement_id;

  insert into public.audit_logs (actor_user_id, action, target_type, target_id)
  values (auth.uid(), 'announcement.published', 'announcement', new_announcement_id::text);

  return new_announcement_id;
end
$$;

create or replace function public.approve_student_promotion(
  p_student_id uuid,
  p_effective_session_id uuid,
  p_kind public.promotion_kind,
  p_destination_class_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_enrollment public.enrollments%rowtype;
  effective_session public.academic_sessions%rowtype;
  next_enrollment_id uuid;
  promotion_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only an active Super Admin can approve a promotion';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'A promotion reason is required';
  end if;

  select session.* into effective_session
  from public.academic_sessions as session
  where session.id = p_effective_session_id;
  if not found or effective_session.starts_on <= current_date then
    raise exception 'Promotion must target a future academic session';
  end if;

  select enrollment.* into current_enrollment
  from public.enrollments as enrollment
  join public.academic_sessions as session on session.id = enrollment.session_id
  where enrollment.student_id = p_student_id
    and enrollment.status = 'active'
    and session.starts_on < effective_session.starts_on
  order by session.starts_on desc
  limit 1;
  if not found then
    raise exception 'No prior active enrollment exists for this student';
  end if;

  select decision.id into promotion_id
  from public.promotion_decisions as decision
  where decision.student_id = p_student_id
    and decision.effective_session_id = p_effective_session_id;
  if found then
    if exists (
      select 1
      from public.promotion_decisions as decision
      where decision.id = promotion_id
        and decision.kind = p_kind
        and decision.destination_class_id is not distinct from p_destination_class_id
        and decision.reason = trim(p_reason)
    ) then
      return promotion_id;
    end if;
    raise exception 'A promotion decision already exists for this learner and future session';
  end if;

  if p_kind = 'graduation' then
    if p_destination_class_id is not null then
      raise exception 'Graduation must not specify a destination class';
    end if;
  else
    if p_destination_class_id is null or not exists (
      select 1 from public.classes as class
      where class.id = p_destination_class_id and class.active
    ) then
      raise exception 'A valid destination class is required';
    end if;

    insert into public.enrollments (student_id, class_id, session_id, reason)
    values (p_student_id, p_destination_class_id, p_effective_session_id, trim(p_reason))
    returning id into next_enrollment_id;
  end if;

  insert into public.promotion_decisions (
    student_id, from_enrollment_id, destination_class_id,
    effective_session_id, kind, reason, approved_by
  )
  values (
    p_student_id, current_enrollment.id, p_destination_class_id,
    p_effective_session_id, p_kind, trim(p_reason), auth.uid()
  )
  returning id into promotion_id;

  insert into public.audit_logs (
    actor_user_id, action, target_type, target_id, reason, change_summary
  )
  values (
    auth.uid(),
    'student.promotion_approved',
    'promotion_decision',
    promotion_id::text,
    trim(p_reason),
    jsonb_build_object(
      'student_id', p_student_id,
      'from_class_id', current_enrollment.class_id,
      'destination_class_id', p_destination_class_id,
      'effective_session_id', p_effective_session_id,
      'kind', p_kind,
      'new_enrollment_id', next_enrollment_id
    )
  );

  return promotion_id;
end
$$;

create or replace function public.archive_student(
  p_student_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  student public.students%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Only an active Super Admin can archive student access';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'An archive reason is required';
  end if;

  select current_student.* into student
  from public.students as current_student
  where current_student.id = p_student_id
  for update;
  if not found or not student.active then
    raise exception 'Student is not currently active';
  end if;

  update public.students
  set active = false, archived_at = now(), updated_at = now()
  where id = p_student_id;

  update public.user_accounts
  set active = false, deactivated_at = now()
  where user_id = student.auth_user_id and active;

  update public.parent_student_links
  set active = false
  where student_id = p_student_id and active;

  insert into public.audit_logs (
    actor_user_id, action, target_type, target_id, reason
  )
  values (
    auth.uid(), 'student.archived', 'student', p_student_id::text, trim(p_reason)
  );
end
$$;

create or replace function public.publish_current_timetable_path(
  p_class_id uuid,
  p_session_id uuid,
  p_term_id uuid
)
returns table (
  object_path text,
  original_filename text,
  content_type text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_active_account() then
    raise exception 'An active school account is required';
  end if;

  return query
  select document.object_path, document.original_filename, document.content_type
  from public.timetable_documents as document
  join public.timetable_publications as publication
    on publication.timetable_id = document.id
  join public.academic_sessions as session
    on session.id = document.session_id and session.is_active
  where document.class_id = p_class_id
    and document.session_id = p_session_id
    and document.term_id = p_term_id
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.enrollments as enrollment
        where enrollment.class_id = document.class_id
          and enrollment.session_id = document.session_id
          and enrollment.status = 'active'
          and private.can_access_student(enrollment.student_id)
      )
    )
  order by publication.published_at desc
  limit 1;
end
$$;

create or replace function public.audit_sensitive_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_id text;
  summary jsonb;
  operation_name text;
begin
  operation_name := lower(tg_op);
  affected_id := coalesce(
    to_jsonb(new) ->> 'id',
    to_jsonb(old) ->> 'id',
    to_jsonb(new) ->> 'student_id',
    to_jsonb(old) ->> 'student_id',
    to_jsonb(new) ->> 'name',
    to_jsonb(old) ->> 'name'
  );

  case tg_table_name
    when 'academic_sessions' then
      summary := jsonb_build_object(
        'name', coalesce(to_jsonb(new) ->> 'name', to_jsonb(old) ->> 'name'),
        'starts_on', coalesce(to_jsonb(new) ->> 'starts_on', to_jsonb(old) ->> 'starts_on'),
        'ends_on', coalesce(to_jsonb(new) ->> 'ends_on', to_jsonb(old) ->> 'ends_on')
      );
    when 'academic_terms' then
      summary := jsonb_build_object(
        'name', coalesce(to_jsonb(new) ->> 'name', to_jsonb(old) ->> 'name'),
        'session_id', coalesce(to_jsonb(new) ->> 'session_id', to_jsonb(old) ->> 'session_id'),
        'starts_on', coalesce(to_jsonb(new) ->> 'starts_on', to_jsonb(old) ->> 'starts_on'),
        'ends_on', coalesce(to_jsonb(new) ->> 'ends_on', to_jsonb(old) ->> 'ends_on')
      );
    when 'classes' then
      summary := jsonb_build_object(
        'name', coalesce(to_jsonb(new) ->> 'name', to_jsonb(old) ->> 'name'),
        'level', coalesce(to_jsonb(new) ->> 'level', to_jsonb(old) ->> 'level')
      );
    when 'subjects' then
      summary := jsonb_build_object(
        'name', coalesce(to_jsonb(new) ->> 'name', to_jsonb(old) ->> 'name')
      );
    when 'assessment_schemas' then
      summary := jsonb_build_object(
        'class_id', coalesce(to_jsonb(new) ->> 'class_id', to_jsonb(old) ->> 'class_id'),
        'term_id', coalesce(to_jsonb(new) ->> 'term_id', to_jsonb(old) ->> 'term_id'),
        'subject_id', coalesce(to_jsonb(new) ->> 'subject_id', to_jsonb(old) ->> 'subject_id'),
        'version', coalesce(to_jsonb(new) ->> 'version', to_jsonb(old) ->> 'version')
      );
    when 'grading_bands' then
      summary := jsonb_build_object(
        'grade', coalesce(to_jsonb(new) ->> 'grade', to_jsonb(old) ->> 'grade'),
        'configuration_version', coalesce(
          to_jsonb(new) ->> 'configuration_version',
          to_jsonb(old) ->> 'configuration_version'
        )
      );
    when 'school_calendar_events' then
      summary := jsonb_build_object(
        'title', coalesce(to_jsonb(new) ->> 'title', to_jsonb(old) ->> 'title'),
        'session_id', coalesce(to_jsonb(new) ->> 'session_id', to_jsonb(old) ->> 'session_id'),
        'starts_on', coalesce(to_jsonb(new) ->> 'starts_on', to_jsonb(old) ->> 'starts_on'),
        'ends_on', coalesce(to_jsonb(new) ->> 'ends_on', to_jsonb(old) ->> 'ends_on'),
        'kind', coalesce(to_jsonb(new) ->> 'kind', to_jsonb(old) ->> 'kind')
      );
    when 'announcements' then
      summary := jsonb_build_object(
        'title', coalesce(to_jsonb(new) ->> 'title', to_jsonb(old) ->> 'title')
      );
    when 'timetable_documents' then
      summary := jsonb_build_object(
        'class_id', coalesce(to_jsonb(new) ->> 'class_id', to_jsonb(old) ->> 'class_id'),
        'session_id', coalesce(to_jsonb(new) ->> 'session_id', to_jsonb(old) ->> 'session_id'),
        'term_id', coalesce(to_jsonb(new) ->> 'term_id', to_jsonb(old) ->> 'term_id')
      );
    else
      summary := '{}'::jsonb;
  end case;

  insert into public.audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    change_summary
  )
  values (
    auth.uid(),
    tg_table_name || '.' || operation_name,
    tg_table_name,
    affected_id,
    summary
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

create trigger academic_sessions_audit
after insert or update or delete on public.academic_sessions
for each row execute function public.audit_sensitive_change();
create trigger academic_terms_audit
after insert or update or delete on public.academic_terms
for each row execute function public.audit_sensitive_change();
create trigger classes_audit
after insert or update or delete on public.classes
for each row execute function public.audit_sensitive_change();
create trigger subjects_audit
after insert or update or delete on public.subjects
for each row execute function public.audit_sensitive_change();
create trigger assessment_schemas_audit
after insert or update or delete on public.assessment_schemas
for each row execute function public.audit_sensitive_change();
create trigger grading_bands_audit
after insert or update or delete on public.grading_bands
for each row execute function public.audit_sensitive_change();
create trigger school_calendar_events_audit
after insert or update or delete on public.school_calendar_events
for each row execute function public.audit_sensitive_change();
create trigger announcements_audit
after insert or update or delete on public.announcements
for each row execute function public.audit_sensitive_change();
create trigger timetable_documents_audit
after insert or update or delete on public.timetable_documents
for each row execute function public.audit_sensitive_change();

revoke execute on function public.save_attendance_register(uuid, uuid, uuid, date, jsonb, text) from public, anon;
revoke execute on function public.class_attendance_register(uuid, uuid, uuid, date) from public, anon;
revoke execute on function public.publish_class_results(uuid, uuid, uuid, jsonb) from public, anon;
revoke execute on function public.publish_timetable(uuid) from public, anon;
revoke execute on function public.scheduled_school_days(uuid, uuid) from public, anon;
revoke execute on function public.create_school_account(uuid, uuid, public.account_role, text, text, text, text, text, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.save_school_settings(text, jsonb, text, text, text) from public, anon;
revoke execute on function public.save_calendar_event(uuid, uuid, text, text, date, date, public.calendar_event_kind, boolean) from public, anon;
revoke execute on function public.publish_announcement(text, text) from public, anon;
revoke execute on function public.approve_student_promotion(uuid, uuid, public.promotion_kind, uuid, text) from public, anon;
revoke execute on function public.archive_student(uuid, text) from public, anon;
revoke execute on function public.publish_current_timetable_path(uuid, uuid, uuid) from public, anon;
revoke all on function public.audit_sensitive_change() from public, anon, authenticated;

grant execute on function public.save_attendance_register(uuid, uuid, uuid, date, jsonb, text) to authenticated;
grant execute on function public.class_attendance_register(uuid, uuid, uuid, date) to authenticated;
grant execute on function public.publish_class_results(uuid, uuid, uuid, jsonb) to authenticated;
grant execute on function public.publish_timetable(uuid) to authenticated;
grant execute on function public.scheduled_school_days(uuid, uuid) to authenticated;
grant execute on function public.create_school_account(uuid, uuid, public.account_role, text, text, text, text, text, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.save_school_settings(text, jsonb, text, text, text) to authenticated;
grant execute on function public.save_calendar_event(uuid, uuid, text, text, date, date, public.calendar_event_kind, boolean) to authenticated;
grant execute on function public.publish_announcement(text, text) to authenticated;
grant execute on function public.approve_student_promotion(uuid, uuid, public.promotion_kind, uuid, text) to authenticated;
grant execute on function public.archive_student(uuid, text) to authenticated;
grant execute on function public.publish_current_timetable_path(uuid, uuid, uuid) to authenticated;
grant execute on function public.audit_sensitive_change() to service_role;

create policy published_results_admin_read
  on public.class_result_publications for select to authenticated
  using ((select public.is_super_admin()));

create or replace function public.save_result_drafts(
  p_class_id uuid,
  p_session_id uuid,
  p_term_id uuid,
  p_file_name text,
  p_sha256 text,
  p_rows jsonb,
  p_confirm_replace boolean default false,
  p_correction_reason text default null
)
returns table (
  import_batch_id uuid,
  imported_rows integer,
  replaced_drafts integer,
  created_corrections integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  import_id uuid;
  import_count integer := 0;
  replaced_count integer := 0;
  correction_count integer := 0;
  row_data record;
  matching_enrollment public.enrollments%rowtype;
  matching_assessment public.assessment_schemas%rowtype;
  previous_result public.results%rowtype;
  has_previous boolean;
begin
  if not public.is_super_admin() then
    raise exception 'Only an active Super Admin can import result drafts';
  end if;
  if nullif(trim(p_file_name), '') is null
    or p_sha256 !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) = 0
    or jsonb_array_length(p_rows) > 10000 then
    raise exception 'Result import is missing a valid file, checksum, or row set';
  end if;
  if exists (
    select 1
    from public.result_import_batches as existing_batch
    where existing_batch.class_id = p_class_id
      and existing_batch.session_id = p_session_id
      and existing_batch.term_id = p_term_id
      and existing_batch.content_sha256 = p_sha256
  ) then
    raise exception 'This result file has already been imported for the selected class and term';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as submitted_result(
      student_id uuid,
      subject_id uuid,
      ca_mark numeric,
      exam_mark numeric
    )
    group by submitted_result.student_id, submitted_result.subject_id
    having count(*) > 1
  ) then
    raise exception 'Result import contains duplicate learner and subject rows';
  end if;

  for row_data in
    select submitted_result.student_id, submitted_result.subject_id, submitted_result.ca_mark, submitted_result.exam_mark
    from jsonb_to_recordset(p_rows) as submitted_result(
      student_id uuid,
      subject_id uuid,
      ca_mark numeric,
      exam_mark numeric
    )
  loop
    if row_data.student_id is null or row_data.subject_id is null
      or row_data.ca_mark is null or row_data.exam_mark is null
      or row_data.ca_mark < 0 or row_data.exam_mark < 0 then
      raise exception 'Each result row needs a learner, subject, and non-negative CA and exam marks';
    end if;

    select enrollment.* into matching_enrollment
    from public.enrollments as enrollment
    where enrollment.student_id = row_data.student_id
      and enrollment.class_id = p_class_id
      and enrollment.session_id = p_session_id
      and enrollment.status = 'active';
    if not found then
      raise exception 'Every imported learner must have an active enrollment in the selected class and session';
    end if;

    select assessment.* into matching_assessment
    from public.assessment_schemas as assessment
    where assessment.class_id = p_class_id
      and assessment.session_id = p_session_id
      and assessment.term_id = p_term_id
      and assessment.subject_id = row_data.subject_id
    order by assessment.version desc
    limit 1;
    if not found
      or row_data.ca_mark > matching_assessment.ca_maximum
      or row_data.exam_mark > matching_assessment.exam_maximum then
      raise exception 'A result row references an unknown subject or exceeds its configured maximum';
    end if;

    if exists (
      select 1
      from public.results as existing_result
      where existing_result.enrollment_id = matching_enrollment.id
        and existing_result.schema_id = matching_assessment.id
        and existing_result.status = 'draft'
    ) and not p_confirm_replace then
      raise exception 'Matching drafts already exist. Confirm replacement before importing again';
    end if;

    select result.* into previous_result
    from public.results as result
    where result.enrollment_id = matching_enrollment.id
      and result.schema_id in (
        select prior_schema.id
        from public.assessment_schemas as prior_schema
        where prior_schema.class_id = p_class_id
          and prior_schema.session_id = p_session_id
          and prior_schema.term_id = p_term_id
          and prior_schema.subject_id = row_data.subject_id
      )
      and result.status = 'published'
    order by result.revision desc
    limit 1;
    has_previous := found;

    if has_previous and nullif(trim(p_correction_reason), '') is null then
      raise exception 'Correcting a published score requires a reason for the audit history';
    end if;

    import_count := import_count + 1;
  end loop;

  select count(*)::integer into replaced_count
  from public.results as result
  join public.enrollments as enrollment on enrollment.id = result.enrollment_id
  join public.assessment_schemas as assessment on assessment.id = result.schema_id
  where enrollment.class_id = p_class_id
    and enrollment.session_id = p_session_id
    and assessment.term_id = p_term_id
    and result.status = 'draft'
    and exists (
      select 1
      from jsonb_to_recordset(p_rows) as submitted(
        student_id uuid,
        subject_id uuid,
        ca_mark numeric,
        exam_mark numeric
      )
      where submitted.student_id = enrollment.student_id
        and submitted.subject_id = assessment.subject_id
    );

  if replaced_count > 0 and not p_confirm_replace then
    raise exception 'Matching drafts already exist. Confirm replacement before importing again';
  end if;

  insert into public.result_import_batches (
    class_id,
    session_id,
    term_id,
    original_filename,
    content_sha256,
    imported_by,
    validation_summary
  )
  values (
    p_class_id,
    p_session_id,
    p_term_id,
    trim(p_file_name),
    p_sha256,
    auth.uid(),
    jsonb_build_object(
      'rows', import_count,
      'replaced_drafts', replaced_count,
      'confirmed', p_confirm_replace
    )
  )
  returning id into import_id;

  delete from public.results as result
  using public.enrollments as enrollment, public.assessment_schemas as assessment
  where result.enrollment_id = enrollment.id
    and result.schema_id = assessment.id
    and enrollment.class_id = p_class_id
    and enrollment.session_id = p_session_id
    and assessment.term_id = p_term_id
    and result.status = 'draft'
    and exists (
      select 1
      from jsonb_to_recordset(p_rows) as submitted(
        student_id uuid,
        subject_id uuid,
        ca_mark numeric,
        exam_mark numeric
      )
      where submitted.student_id = enrollment.student_id
        and submitted.subject_id = assessment.subject_id
    );

  for row_data in
    select submitted_result.student_id, submitted_result.subject_id, submitted_result.ca_mark, submitted_result.exam_mark
    from jsonb_to_recordset(p_rows) as submitted_result(
      student_id uuid,
      subject_id uuid,
      ca_mark numeric,
      exam_mark numeric
    )
  loop
    select enrollment.* into matching_enrollment
    from public.enrollments as enrollment
    where enrollment.student_id = row_data.student_id
      and enrollment.class_id = p_class_id
      and enrollment.session_id = p_session_id
      and enrollment.status = 'active';

    select assessment.* into matching_assessment
    from public.assessment_schemas as assessment
    where assessment.class_id = p_class_id
      and assessment.session_id = p_session_id
      and assessment.term_id = p_term_id
      and assessment.subject_id = row_data.subject_id
    order by assessment.version desc
    limit 1;

    select result.* into previous_result
    from public.results as result
    where result.enrollment_id = matching_enrollment.id
      and result.status = 'published'
      and result.schema_id in (
        select prior_schema.id
        from public.assessment_schemas as prior_schema
        where prior_schema.class_id = p_class_id
          and prior_schema.session_id = p_session_id
          and prior_schema.term_id = p_term_id
          and prior_schema.subject_id = row_data.subject_id
      )
    order by result.revision desc
    limit 1;
    has_previous := found;

    insert into public.results (
      enrollment_id,
      schema_id,
      import_batch_id,
      ca_mark,
      exam_mark,
      status,
      revision,
      previous_revision_id,
      correction_reason,
      created_by
    )
    values (
      matching_enrollment.id,
      matching_assessment.id,
      import_id,
      row_data.ca_mark,
      row_data.exam_mark,
      'draft',
      case when has_previous then previous_result.revision + 1 else 1 end,
      case when has_previous then previous_result.id else null end,
      case when has_previous then trim(p_correction_reason) else null end,
      auth.uid()
    );

    if has_previous then
      correction_count := correction_count + 1;
    end if;
  end loop;

  insert into public.audit_logs (
    actor_user_id, action, target_type, target_id, reason, change_summary
  )
  values (
    auth.uid(),
    'results.drafts_imported',
    'result_import_batch',
    import_id::text,
    nullif(trim(p_correction_reason), ''),
    jsonb_build_object(
      'class_id', p_class_id,
      'session_id', p_session_id,
      'term_id', p_term_id,
      'imported_rows', import_count,
      'replaced_drafts', replaced_count,
      'corrections', correction_count
    )
  );

  return query select import_id, import_count, replaced_count, correction_count;
end
$$;

revoke insert, update, delete on public.result_import_batches, public.results,
  public.class_result_finalizations, public.class_result_publications,
  public.published_report_cards, public.promotion_decisions,
  public.grade_scale_versions, public.timetable_publications
  from authenticated;
revoke insert, update, delete on public.attendance_records,
  public.school_calendar_events, public.announcements
  from authenticated;
revoke insert, update, delete on public.results, public.result_import_batches,
  public.class_result_finalizations, public.published_report_cards,
  public.class_result_publications, public.promotion_decisions,
  public.timetable_publications, public.audit_logs from authenticated;
revoke insert, update, delete on public.students, public.parent_accounts,
  public.parent_student_links, public.enrollments, public.school_settings
  from authenticated;

revoke execute on function public.save_result_drafts(uuid, uuid, uuid, text, text, jsonb, boolean, text)
  from public, anon;
grant execute on function public.save_result_drafts(uuid, uuid, uuid, text, text, jsonb, boolean, text)
  to authenticated;
