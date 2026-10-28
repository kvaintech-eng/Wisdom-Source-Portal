drop policy finalizations_select_student_or_admin
  on public.class_result_finalizations;

create policy finalizations_select_admin
  on public.class_result_finalizations for select to authenticated
  using ((select public.is_super_admin()));
