insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'school-timetables',
  'school-timetables',
  false,
  10485760,
  array['application/pdf', 'image/png', 'image/jpeg']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy timetable_files_read_authorized_enrollment
  on storage.objects for select to authenticated
  using (
    bucket_id = 'school-timetables'
    and exists (
      select 1
      from public.timetable_documents as document
      join public.academic_sessions as session
        on session.id = document.session_id
      join public.enrollments as enrollment
        on enrollment.class_id = document.class_id
        and enrollment.session_id = document.session_id
        and enrollment.status = 'active'
      where document.object_path = name
        and session.is_active
        and (
          (select public.is_super_admin())
          or (select private.can_access_student(enrollment.student_id))
        )
    )
  );

create policy timetable_files_admin_manage
  on storage.objects for all to authenticated
  using (
    bucket_id = 'school-timetables'
    and (select public.is_super_admin())
  )
  with check (
    bucket_id = 'school-timetables'
    and (select public.is_super_admin())
  );
