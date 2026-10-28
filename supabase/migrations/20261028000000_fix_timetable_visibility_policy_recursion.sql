create or replace function private.can_access_published_timetable(target_timetable_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.timetable_documents as document
    join public.timetable_publications as publication
      on publication.timetable_id = document.id
    join public.academic_sessions as session
      on session.id = document.session_id
    join public.enrollments as enrollment
      on enrollment.class_id = document.class_id
      and enrollment.session_id = document.session_id
      and enrollment.status = 'active'
    where document.id = target_timetable_id
      and session.is_active
      and private.can_access_student(enrollment.student_id)
  )
$$;

revoke all on function private.can_access_published_timetable(uuid) from public, anon;
grant execute on function private.can_access_published_timetable(uuid) to authenticated;

drop policy timetable_publications_linked_read
  on public.timetable_publications;
create policy timetable_publications_linked_read
  on public.timetable_publications for select to authenticated
  using (
    (select public.is_active_account())
    and (
      (select public.is_super_admin())
      or (select private.can_access_published_timetable(timetable_id))
    )
  );

drop policy timetable_documents_select_current_class
  on public.timetable_documents;
create policy timetable_documents_select_current_class
  on public.timetable_documents for select to authenticated
  using (
    (select public.is_active_account())
    and (
      (select public.is_super_admin())
      or (select private.can_access_published_timetable(id))
    )
  );

drop policy report_cards_select_student_or_admin
  on public.published_report_cards;
create policy report_cards_select_student_or_admin
  on public.published_report_cards for select to authenticated
  using (
    (select public.is_active_account())
    and (
      (select public.is_super_admin())
      or exists (
        select 1
        from public.enrollments as enrollment
        where enrollment.id = published_report_cards.enrollment_id
          and (select private.can_access_student(enrollment.student_id))
      )
    )
  );
