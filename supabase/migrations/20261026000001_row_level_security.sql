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
  limit 1
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_account_role() = 'super_admin', false)
$$;

create or replace function public.is_active_account()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_account_role() is not null
$$;

create or replace function public.allocate_student_serial()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  serial_number bigint;
  serial_suffix text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Student serial allocation requires a trusted server operation';
  end if;

  serial_number := nextval('public.student_serial_number_seq');
  serial_suffix := chr(65 + floor(random() * 26)::integer);
  return 'WIS-' || lpad(serial_number::text, 3, '0') || serial_suffix;
end
$$;

revoke all on function public.allocate_student_serial() from public, anon, authenticated;
grant execute on function public.allocate_student_serial() to service_role;

revoke all on sequence public.student_serial_number_seq from public, anon, authenticated;
grant usage, select on sequence public.student_serial_number_seq to service_role;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

revoke all on function public.current_account_role() from public, anon;
revoke all on function public.is_super_admin() from public, anon;
revoke all on function public.is_active_account() from public, anon;

create or replace function private.can_access_student(target_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.students as student
      where student.id = target_student_id
        and student.auth_user_id = (select auth.uid())
        and student.active
        and public.current_account_role() = 'student'
    )
    or exists (
      select 1
      from public.parent_student_links as link
      join public.parent_accounts as parent on parent.id = link.parent_id
      where link.student_id = target_student_id
        and link.active
        and link.verified_at is not null
        and parent.auth_user_id = (select auth.uid())
        and parent.active
        and public.current_account_role() = 'parent'
    )
$$;

create or replace function private.enrollment_student_id(target_enrollment_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select enrollment.student_id
  from public.enrollments as enrollment
  where enrollment.id = target_enrollment_id
$$;

create or replace function private.is_enrolled_in_class(
  target_student_id uuid,
  target_class_id uuid,
  target_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.enrollments as enrollment
    where enrollment.student_id = target_student_id
      and enrollment.class_id = target_class_id
      and enrollment.session_id = target_session_id
      and enrollment.status = 'active'
  )
$$;

create or replace function public.protect_student_serial()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Student records cannot be deleted; archive them to retain history';
  end if;

  if new.serial is distinct from old.serial then
    raise exception 'Student serials are permanent and cannot be changed';
  end if;
  return new;
end
$$;

create or replace function public.validate_academic_term()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  matching_session public.academic_sessions%rowtype;
begin
  select academic_session.* into matching_session
  from public.academic_sessions as academic_session
  where academic_session.id = new.session_id;

  if not found
    or new.starts_on < matching_session.starts_on
    or new.ends_on > matching_session.ends_on then
    raise exception 'Academic term dates must fall within the selected session';
  end if;

  return new;
end
$$;

create trigger academic_terms_validate_session_dates
before insert or update on public.academic_terms
for each row execute function public.validate_academic_term();

create or replace function public.validate_calendar_event_dates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  matching_session public.academic_sessions%rowtype;
  matching_term public.academic_terms%rowtype;
begin
  select academic_session.* into matching_session
  from public.academic_sessions as academic_session
  where academic_session.id = new.session_id;

  if not found
    or new.starts_on < matching_session.starts_on
    or new.ends_on > matching_session.ends_on then
    raise exception 'Calendar event dates must fall within the selected session';
  end if;

  if new.term_id is not null then
    select academic_term.* into matching_term
    from public.academic_terms as academic_term
    where academic_term.id = new.term_id
      and academic_term.session_id = new.session_id;

    if not found
      or new.starts_on < matching_term.starts_on
      or new.ends_on > matching_term.ends_on then
      raise exception 'Term calendar event dates must fall within the selected term';
    end if;
  end if;

  return new;
end
$$;

create trigger school_calendar_events_validate_dates
before insert or update on public.school_calendar_events
for each row execute function public.validate_calendar_event_dates();

create trigger students_serial_is_immutable
before update or delete on public.students
for each row execute function public.protect_student_serial();

create or replace function public.validate_attendance_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  matching_term public.academic_terms%rowtype;
begin
  select term.* into matching_term
  from public.academic_terms as term
  where term.id = new.term_id and term.session_id = new.session_id;

  if not found
    or new.attendance_date < matching_term.starts_on
    or new.attendance_date > matching_term.ends_on then
    raise exception 'Attendance date must fall within the selected term';
  end if;

  if extract(isodow from new.attendance_date)::smallint
    <> all(matching_term.open_weekdays) then
    raise exception 'Attendance cannot be recorded for a closed weekday';
  end if;

  if exists (
    select 1
    from public.school_calendar_events as calendar_event
    where calendar_event.session_id = new.session_id
      and (calendar_event.term_id is null or calendar_event.term_id = new.term_id)
      and new.attendance_date between calendar_event.starts_on and calendar_event.ends_on
      and (calendar_event.kind <> 'event' or not calendar_event.school_open)
  ) then
    raise exception 'Attendance cannot be recorded for a school closure or holiday';
  end if;

  if tg_op = 'INSERT' and auth.role() = 'authenticated'
    and new.created_by is distinct from auth.uid() then
    raise exception 'Attendance creator must match the authenticated user';
  end if;

  if tg_op = 'UPDATE' and new.created_by is distinct from old.created_by then
    raise exception 'Attendance creator cannot be changed';
  end if;

  if tg_op = 'UPDATE'
    and (
      new.corrected_by is distinct from old.corrected_by
      or new.corrected_at is distinct from old.corrected_at
      or new.correction_reason is distinct from old.correction_reason
    )
    and new.status is not distinct from old.status
    and new.attendance_date is not distinct from old.attendance_date
    and new.enrollment_id is not distinct from old.enrollment_id
    and new.term_id is not distinct from old.term_id
    and new.class_id is not distinct from old.class_id
    and new.session_id is not distinct from old.session_id then
    raise exception 'Attendance correction details cannot be changed without correcting a record';
  end if;

  if tg_op = 'UPDATE' and (
    new.status is distinct from old.status
    or new.attendance_date is distinct from old.attendance_date
    or new.enrollment_id is distinct from old.enrollment_id
    or new.term_id is distinct from old.term_id
    or new.class_id is distinct from old.class_id
    or new.session_id is distinct from old.session_id
    or new.created_by is distinct from old.created_by
  ) then
    if not public.is_super_admin()
      or nullif(trim(new.correction_reason), '') is null then
      raise exception 'Correcting attendance requires an administrator and a reason';
    end if;
    new.corrected_at := now();
    new.corrected_by := auth.uid();

    insert into public.audit_logs (
      actor_user_id,
      action,
      target_type,
      target_id,
      reason,
      change_summary
    )
    values (
      new.corrected_by,
      'attendance.corrected',
      'attendance_record',
      old.id::text,
      trim(new.correction_reason),
      jsonb_build_object(
        'before',
        jsonb_build_object(
          'status', old.status,
          'attendance_date', old.attendance_date,
          'class_id', old.class_id
        ),
        'after',
        jsonb_build_object(
          'status', new.status,
          'attendance_date', new.attendance_date,
          'class_id', new.class_id
        )
      )
    );
  end if;

  return new;
end
$$;

create trigger attendance_record_validate
before insert or update on public.attendance_records
for each row execute function public.validate_attendance_record();

create or replace function public.prevent_attendance_deletion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Attendance history cannot be deleted; use a reasoned correction';
end
$$;

create trigger attendance_history_is_retained
before delete on public.attendance_records
for each row execute function public.prevent_attendance_deletion();

create or replace function public.validate_result_record()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  assessment public.assessment_schemas%rowtype;
  enrollment public.enrollments%rowtype;
begin
  select schema.* into assessment
  from public.assessment_schemas as schema
  where schema.id = new.schema_id;

  select current_enrollment.* into enrollment
  from public.enrollments as current_enrollment
  where current_enrollment.id = new.enrollment_id;

  if not found then
    raise exception 'Result must belong to a valid enrollment and assessment';
  end if;

  if enrollment.class_id <> assessment.class_id
    or enrollment.session_id <> assessment.session_id then
    raise exception 'Result assessment must match the learner enrollment';
  end if;

  if new.ca_mark > assessment.ca_maximum
    or new.exam_mark > assessment.exam_maximum then
    raise exception 'Result marks exceed the configured assessment maximum';
  end if;

  if new.status = 'published'
    and auth.role() is distinct from 'service_role'
    and current_user <> 'postgres' then
    raise exception 'Results must be published through the trusted finalization workflow';
  end if;

  return new;
end
$$;

create trigger results_validate_on_write
before insert or update on public.results
for each row execute function public.validate_result_record();

create or replace function public.protect_published_result()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'published' then
    raise exception 'Published results are immutable; create an audited revision';
  end if;
  return new;
end
$$;

create trigger published_results_are_immutable
before update or delete on public.results
for each row execute function public.protect_published_result();

create or replace function public.protect_published_report_card()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Published report cards are immutable';
end
$$;

create trigger published_report_cards_are_immutable
before update or delete on public.published_report_cards
for each row execute function public.protect_published_report_card();

create or replace function public.protect_audit_log_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Audit history is append-only';
end
$$;

create trigger audit_log_history_is_append_only
before update or delete on public.audit_logs
for each row execute function public.protect_audit_log_history();

alter table public.user_accounts enable row level security;
alter table public.school_settings enable row level security;
alter table public.academic_sessions enable row level security;
alter table public.academic_terms enable row level security;
alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.parent_accounts enable row level security;
alter table public.parent_student_links enable row level security;
alter table public.enrollments enable row level security;
alter table public.school_calendar_events enable row level security;
alter table public.attendance_records enable row level security;
alter table public.timetable_documents enable row level security;
alter table public.announcements enable row level security;
alter table public.subjects enable row level security;
alter table public.assessment_schemas enable row level security;
alter table public.grading_bands enable row level security;
alter table public.result_import_batches enable row level security;
alter table public.results enable row level security;
alter table public.class_result_finalizations enable row level security;
alter table public.published_report_cards enable row level security;
alter table public.promotion_decisions enable row level security;
alter table public.audit_logs enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant usage on schema public to authenticated;

grant select on public.user_accounts to authenticated;
grant select on public.school_settings, public.academic_sessions, public.academic_terms to authenticated;
grant select on public.classes, public.students, public.parent_accounts to authenticated;
grant select on public.parent_student_links, public.enrollments to authenticated;
grant select on public.school_calendar_events, public.attendance_records to authenticated;
grant select on public.timetable_documents, public.announcements to authenticated;
grant select on public.subjects, public.assessment_schemas, public.grading_bands to authenticated;
grant select on public.result_import_batches, public.results to authenticated;
grant select on public.class_result_finalizations, public.published_report_cards to authenticated;
grant select on public.promotion_decisions, public.audit_logs to authenticated;

grant insert, update, delete on public.school_settings, public.academic_sessions to authenticated;
grant insert, update, delete on public.academic_terms, public.classes to authenticated;
grant insert, update, delete on public.students, public.parent_accounts to authenticated;
grant insert, update, delete on public.parent_student_links, public.enrollments to authenticated;
grant insert, update, delete on public.school_calendar_events, public.attendance_records to authenticated;
grant insert, update, delete on public.timetable_documents, public.announcements to authenticated;
grant insert, update, delete on public.subjects, public.assessment_schemas, public.grading_bands to authenticated;
revoke delete on public.attendance_records from authenticated;
grant usage, select on sequence public.audit_logs_id_seq to service_role;
grant select on public.audit_logs to authenticated;
grant execute on function public.current_account_role() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.is_active_account() to authenticated;
grant execute on function private.can_access_student(uuid) to authenticated;
grant execute on function private.enrollment_student_id(uuid) to authenticated;
grant execute on function private.is_enrolled_in_class(uuid, uuid, uuid) to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

create policy user_accounts_select_self_or_admin
  on public.user_accounts for select to authenticated
  using (
    (select public.is_active_account())
    and (user_id = (select auth.uid()) or (select public.is_super_admin()))
  );

create policy school_settings_select_authenticated
  on public.school_settings for select to authenticated
  using ((select public.is_active_account()));
create policy school_settings_admin_manage
  on public.school_settings for all to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

create policy academic_sessions_select_authenticated
  on public.academic_sessions for select to authenticated
  using ((select public.is_active_account()));
create policy academic_sessions_admin_manage
  on public.academic_sessions for all to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

create policy academic_terms_select_authenticated
  on public.academic_terms for select to authenticated
  using ((select public.is_active_account()));
create policy academic_terms_admin_manage
  on public.academic_terms for all to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

create policy classes_select_authenticated
  on public.classes for select to authenticated
  using ((select public.is_active_account()));
create policy classes_admin_manage
  on public.classes for all to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

create policy students_select_self_parent_or_admin
  on public.students for select to authenticated
  using (
    (select public.is_active_account())
    and (
      (active and (select private.can_access_student(id)))
      or (select public.is_super_admin())
    )
  );
create policy students_admin_insert
  on public.students for insert to authenticated
  with check ((select public.is_super_admin()));
create policy students_admin_update
  on public.students for update to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

create policy parent_accounts_select_self_or_admin
  on public.parent_accounts for select to authenticated
  using (
    (select public.is_active_account())
    and (auth_user_id = (select auth.uid()) or (select public.is_super_admin()))
  );
create policy parent_accounts_admin_manage
  on public.parent_accounts for all to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

create policy parent_student_links_select_linked_parent_or_admin
  on public.parent_student_links for select to authenticated
  using (
    (select public.is_active_account())
    and (
      (select public.is_super_admin())
      or exists (
      select 1
      from public.parent_accounts as parent
      where parent.id = parent_student_links.parent_id
        and parent.auth_user_id = (select auth.uid())
        and parent_student_links.active
        and parent_student_links.verified_at is not null
      )
    )
  );
create policy parent_student_links_admin_manage
  on public.parent_student_links for all to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

create policy enrollments_select_authorized
  on public.enrollments for select to authenticated
  using (
    (select public.is_active_account())
    and (
      (select private.can_access_student(student_id))
      or (select public.is_super_admin())
    )
  );
create policy enrollments_admin_manage
  on public.enrollments for all to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

create policy calendar_select_authenticated
  on public.school_calendar_events for select to authenticated
  using ((select public.is_active_account()));
create policy calendar_admin_manage
  on public.school_calendar_events for all to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

create policy attendance_select_authorized
  on public.attendance_records for select to authenticated
  using (
    (select public.is_active_account())
    and (
      (select private.can_access_student(student_id))
      or (select public.is_super_admin())
    )
  );
create policy attendance_admin_manage
  on public.attendance_records for all to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

create policy timetable_documents_select_current_class
  on public.timetable_documents for select to authenticated
  using (
    (select public.is_active_account())
    and (
      (select public.is_super_admin())
      or exists (
      select 1
      from public.enrollments as enrollment
      join public.academic_sessions as session on session.id = timetable_documents.session_id
      where enrollment.class_id = timetable_documents.class_id
        and enrollment.session_id = timetable_documents.session_id
        and enrollment.status = 'active'
        and session.is_active
        and (select private.can_access_student(enrollment.student_id))
      )
    )
  );
create policy timetable_documents_admin_manage
  on public.timetable_documents for all to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

create policy announcements_select_published
  on public.announcements for select to authenticated
  using (
    (select public.is_active_account())
    and (published_at is not null or (select public.is_super_admin()))
  );
create policy announcements_admin_manage
  on public.announcements for all to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

create policy subjects_select_authenticated
  on public.subjects for select to authenticated
  using ((select public.is_active_account()));
create policy subjects_admin_manage
  on public.subjects for all to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

create policy assessment_schemas_select_authenticated
  on public.assessment_schemas for select to authenticated
  using ((select public.is_active_account()));
create policy assessment_schemas_admin_manage
  on public.assessment_schemas for all to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

create policy grading_bands_select_authenticated
  on public.grading_bands for select to authenticated
  using ((select public.is_active_account()));
create policy grading_bands_admin_manage
  on public.grading_bands for all to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

create policy result_import_batches_admin_only
  on public.result_import_batches for all to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

create policy results_select_student_published_or_admin
  on public.results for select to authenticated
  using (
    (select public.is_super_admin())
    or (
      status = 'published'
      and (select private.can_access_student(
        private.enrollment_student_id(enrollment_id)
      ))
    )
  );
create policy results_admin_insert
  on public.results for insert to authenticated
  with check ((select public.is_super_admin()));
create policy results_admin_update
  on public.results for update to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));
create policy results_admin_delete_drafts
  on public.results for delete to authenticated
  using (
    (select public.is_super_admin())
    and status = 'draft'
  );

create policy finalizations_select_student_or_admin
  on public.class_result_finalizations for select to authenticated
  using (
    (select public.is_super_admin())
    or exists (
      select 1
      from public.enrollments as enrollment
      join public.published_report_cards as report
        on report.finalization_id = class_result_finalizations.id
        and report.enrollment_id = enrollment.id
      where (select private.can_access_student(enrollment.student_id))
    )
  );
create policy finalizations_admin_manage
  on public.class_result_finalizations for all to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

create policy report_cards_select_student_or_admin
  on public.published_report_cards for select to authenticated
  using (
    (select public.is_super_admin())
    or (select private.can_access_student(
      private.enrollment_student_id(enrollment_id)
    ))
  );
create policy report_cards_admin_insert
  on public.published_report_cards for insert to authenticated
  with check ((select public.is_super_admin()));

create policy promotion_decisions_admin_only
  on public.promotion_decisions for all to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

create policy audit_logs_admin_read_only
  on public.audit_logs for select to authenticated
  using ((select public.is_super_admin()));
