create table public.student_testimonials (
  student_id uuid primary key references public.students (id) on delete restrict,
  graduation_decision_id uuid not null unique references public.promotion_decisions (id) on delete restrict,
  school_name text not null,
  school_address text not null default '',
  former_school_name text not null default '',
  started_on date not null,
  started_class text not null,
  completed_on date not null,
  subjects text[] not null,
  academic_ability text not null default '',
  curriculum_activities text not null default '',
  hobby text not null default '',
  school_office text not null default '',
  club_art text not null default '',
  remarks text not null default '',
  status text not null default 'draft' check (status in ('draft', 'approved')),
  created_by uuid not null references auth.users (id) on delete restrict,
  updated_by uuid not null references auth.users (id) on delete restrict,
  approved_by uuid references auth.users (id) on delete restrict,
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint student_testimonial_dates_valid check (started_on <= completed_on),
  constraint student_testimonial_started_class_nonempty check (length(trim(started_class)) > 0),
  constraint student_testimonial_subjects_valid check (
    cardinality(subjects) between 1 and 20
    and array_position(subjects, '') is null
  ),
  constraint student_testimonial_approval_consistent check (
    (status = 'draft' and approved_by is null and approved_at is null)
    or (status = 'approved' and approved_by is not null and approved_at is not null)
  )
);

alter table public.student_testimonials enable row level security;
revoke all on public.student_testimonials from public, anon, authenticated;
grant select on public.student_testimonials to authenticated;

create policy student_testimonials_admin_or_owner_read
  on public.student_testimonials for select to authenticated
  using (
    public.is_super_admin()
    or (
      status = 'approved'
      and exists (
        select 1
        from public.students as student
        where student.id = student_testimonials.student_id
          and student.auth_user_id = (select auth.uid())
          and student.active
      )
    )
  );

create or replace function public.graduated_students_for_testimonials()
returns table (
  student_id uuid,
  serial text,
  full_name text,
  class_name text,
  graduation_session text,
  graduation_decision_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only an active Super Admin can manage student testimonials';
  end if;

  return query
  select distinct on (student.id)
    student.id,
    student.serial,
    student.full_name,
    school_class.name,
    session.name,
    decision.id
  from public.promotion_decisions as decision
  join public.enrollments as enrollment on enrollment.id = decision.from_enrollment_id
  join public.classes as school_class on school_class.id = enrollment.class_id
  join public.academic_sessions as session on session.id = enrollment.session_id
  join public.students as student on student.id = decision.student_id
  where decision.kind = 'graduation'
    and school_class.name = 'SS 3'
    and school_class.level = 'SS'
    and school_class.next_class_id is null
  order by student.id, decision.approved_at desc;
end
$$;

create or replace function public.my_student_testimonial()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_student public.students%rowtype;
  document public.student_testimonials%rowtype;
  is_eligible boolean;
begin
  if public.current_account_role() is distinct from 'student' then
    raise exception 'A student account is required to view a testimonial';
  end if;

  select student.* into current_student
  from public.students as student
  where student.auth_user_id = auth.uid()
    and student.active;
  if not found then
    return jsonb_build_object('eligible', false, 'status', 'not_eligible');
  end if;

  select exists (
    select 1
    from public.promotion_decisions as decision
    join public.enrollments as enrollment on enrollment.id = decision.from_enrollment_id
    join public.classes as school_class on school_class.id = enrollment.class_id
    where decision.student_id = current_student.id
      and decision.kind = 'graduation'
      and school_class.name = 'SS 3'
      and school_class.level = 'SS'
      and school_class.next_class_id is null
  ) into is_eligible;

  if not is_eligible then
    return jsonb_build_object('eligible', false, 'status', 'not_eligible');
  end if;

  select testimonial.* into document
  from public.student_testimonials as testimonial
  where testimonial.student_id = current_student.id;

  if not found then
    return jsonb_build_object('eligible', true, 'status', 'pending');
  end if;
  if document.status <> 'approved' then
    return jsonb_build_object('eligible', true, 'status', 'pending');
  end if;

  return jsonb_build_object(
    'eligible', true,
    'status', 'approved',
    'document', jsonb_build_object(
      'school_name', document.school_name,
      'school_address', document.school_address,
      'former_school_name', document.former_school_name,
      'student_name', current_student.full_name,
      'started_on', document.started_on,
      'started_class', document.started_class,
      'completed_on', document.completed_on,
      'completed_class', 'SS 3',
      'graduation_session', (
        select session.name
        from public.promotion_decisions as decision
        join public.enrollments as enrollment on enrollment.id = decision.from_enrollment_id
        join public.academic_sessions as session on session.id = enrollment.session_id
        where decision.id = document.graduation_decision_id
      ),
      'subjects', to_jsonb(document.subjects),
      'academic_ability', document.academic_ability,
      'curriculum_activities', document.curriculum_activities,
      'hobby', document.hobby,
      'school_office', document.school_office,
      'club_art', document.club_art,
      'remarks', document.remarks,
      'issued_at', document.approved_at
    )
  );
end
$$;

create or replace function public.save_student_testimonial(
  p_student_id uuid,
  p_testimonial jsonb,
  p_approve boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  graduation public.promotion_decisions%rowtype;
  current_student public.students%rowtype;
  school public.school_settings%rowtype;
  subject_list text[];
  next_status text;
begin
  if not public.is_super_admin() then
    raise exception 'Only an active Super Admin can manage student testimonials';
  end if;
  if jsonb_typeof(p_testimonial) is distinct from 'object' then
    raise exception 'Testimonial details must be supplied';
  end if;
  if jsonb_typeof(p_testimonial -> 'subjects') is distinct from 'array' then
    raise exception 'Enter at least one subject';
  end if;
  if jsonb_array_length(p_testimonial -> 'subjects') not between 1 and 20
    or exists (
      select 1
      from jsonb_array_elements(p_testimonial -> 'subjects') as subject(value)
      where jsonb_typeof(subject.value) is distinct from 'string'
        or length(trim(subject.value #>> '{}')) not between 1 and 100
    ) then
    raise exception 'Enter between 1 and 20 valid subjects';
  end if;
  if coalesce(p_testimonial ->> 'started_on', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or coalesce(p_testimonial ->> 'completed_on', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or length(trim(coalesce(p_testimonial ->> 'started_class', ''))) not between 1 and 100 then
    raise exception 'School start date, start class, and completion date are required';
  end if;
  if length(coalesce(p_testimonial ->> 'former_school_name', '')) > 200
    or length(coalesce(p_testimonial ->> 'academic_ability', '')) > 200
    or length(coalesce(p_testimonial ->> 'curriculum_activities', '')) > 200
    or length(coalesce(p_testimonial ->> 'hobby', '')) > 200
    or length(coalesce(p_testimonial ->> 'school_office', '')) > 200
    or length(coalesce(p_testimonial ->> 'club_art', '')) > 200
    or length(coalesce(p_testimonial ->> 'remarks', '')) > 1000 then
    raise exception 'Testimonial entries exceed the allowed length';
  end if;

  select student.* into current_student
  from public.students as student
  where student.id = p_student_id;
  if not found then
    raise exception 'Student was not found';
  end if;

  select decision.* into graduation
  from public.promotion_decisions as decision
  join public.enrollments as enrollment on enrollment.id = decision.from_enrollment_id
  join public.classes as school_class on school_class.id = enrollment.class_id
  where decision.student_id = p_student_id
    and decision.kind = 'graduation'
    and school_class.name = 'SS 3'
    and school_class.level = 'SS'
    and school_class.next_class_id is null
  order by decision.approved_at desc
  limit 1;
  if not found then
    raise exception 'A confirmed SS 3 graduation is required before issuing a testimonial';
  end if;

  if (p_testimonial ->> 'started_on')::date > (p_testimonial ->> 'completed_on')::date then
    raise exception 'The school start date must not be after the completion date';
  end if;

  select settings.* into school
  from public.school_settings as settings
  where settings.id;
  if not found then
    raise exception 'School settings were not found';
  end if;

  select array_agg(trim(subject.value #>> '{}') order by subject.ordinality)
    into subject_list
  from jsonb_array_elements(p_testimonial -> 'subjects') with ordinality as subject(value, ordinality);

  next_status := case when coalesce(p_approve, false) then 'approved' else 'draft' end;

  insert into public.student_testimonials (
    student_id,
    graduation_decision_id,
    school_name,
    school_address,
    former_school_name,
    started_on,
    started_class,
    completed_on,
    subjects,
    academic_ability,
    curriculum_activities,
    hobby,
    school_office,
    club_art,
    remarks,
    status,
    created_by,
    updated_by,
    approved_by,
    approved_at,
    updated_at
  )
  values (
    p_student_id,
    graduation.id,
    school.school_name,
    coalesce(school.contact_details ->> 'address', ''),
    trim(coalesce(p_testimonial ->> 'former_school_name', '')),
    (p_testimonial ->> 'started_on')::date,
    trim(p_testimonial ->> 'started_class'),
    (p_testimonial ->> 'completed_on')::date,
    subject_list,
    trim(coalesce(p_testimonial ->> 'academic_ability', '')),
    trim(coalesce(p_testimonial ->> 'curriculum_activities', '')),
    trim(coalesce(p_testimonial ->> 'hobby', '')),
    trim(coalesce(p_testimonial ->> 'school_office', '')),
    trim(coalesce(p_testimonial ->> 'club_art', '')),
    trim(coalesce(p_testimonial ->> 'remarks', '')),
    next_status,
    auth.uid(),
    auth.uid(),
    case when next_status = 'approved' then auth.uid() else null end,
    case when next_status = 'approved' then now() else null end,
    now()
  )
  on conflict (student_id) do update
  set graduation_decision_id = excluded.graduation_decision_id,
      school_name = excluded.school_name,
      school_address = excluded.school_address,
      former_school_name = excluded.former_school_name,
      started_on = excluded.started_on,
      started_class = excluded.started_class,
      completed_on = excluded.completed_on,
      subjects = excluded.subjects,
      academic_ability = excluded.academic_ability,
      curriculum_activities = excluded.curriculum_activities,
      hobby = excluded.hobby,
      school_office = excluded.school_office,
      club_art = excluded.club_art,
      remarks = excluded.remarks,
      status = excluded.status,
      updated_by = excluded.updated_by,
      approved_by = excluded.approved_by,
      approved_at = excluded.approved_at,
      updated_at = now();

  insert into public.audit_logs (
    actor_user_id, action, target_type, target_id, change_summary
  )
  values (
    auth.uid(),
    case when next_status = 'approved'
      then 'student.testimonial_approved'
      else 'student.testimonial_saved'
    end,
    'student_testimonial',
    p_student_id::text,
    jsonb_build_object(
      'graduation_decision_id', graduation.id,
      'status', next_status
    )
  );

  return next_status;
end
$$;

revoke execute on function public.graduated_students_for_testimonials() from public, anon;
grant execute on function public.graduated_students_for_testimonials() to authenticated;
revoke execute on function public.my_student_testimonial() from public, anon;
grant execute on function public.my_student_testimonial() to authenticated;
revoke execute on function public.save_student_testimonial(uuid, jsonb, boolean) from public, anon;
grant execute on function public.save_student_testimonial(uuid, jsonb, boolean) to authenticated;
