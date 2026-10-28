begin;

set local search_path = public, extensions;

drop table if exists pg_temp.pgtap_output;
create temporary table pgtap_output (
  line text not null
);
grant all on pg_temp.pgtap_output to authenticated;
insert into pg_temp.pgtap_output(line) select plan(43);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  ('00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'student-a@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'student-b@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'parent-a@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated',
   'admin@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}');

insert into public.user_accounts (user_id, role)
values
  ('00000000-0000-0000-0000-000000000001', 'student'),
  ('00000000-0000-0000-0000-000000000002', 'student'),
  ('00000000-0000-0000-0000-000000000003', 'parent'),
  ('00000000-0000-0000-0000-000000000004', 'super_admin');

update public.school_settings
set school_name = 'Fictional Test School'
where id = true;

-- Use the fixture session as active only inside this rolled-back test transaction.
update public.academic_sessions
set is_active = false
where is_active;

insert into public.academic_sessions (id, name, starts_on, ends_on, is_active)
values (
  '10000000-0000-0000-0000-000000000001',
  'Test Session',
  '2026-10-01',
  '2026-12-31',
  true
);
insert into public.academic_terms (id, session_id, name, starts_on, ends_on)
values (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'First Term',
  '2026-10-01',
  '2026-12-31'
);
insert into public.classes (id, name, level, display_order)
values
  ('30000000-0000-0000-0000-000000000001', 'Test Primary A', 'Primary', 1001),
  ('30000000-0000-0000-0000-000000000002', 'Test Primary B', 'Primary', 1002);
insert into public.students (id, serial, auth_user_id, full_name)
values
  ('40000000-0000-0000-0000-000000000001', 'WIS-901A',
   '00000000-0000-0000-0000-000000000001', 'Fictional Student One'),
  ('40000000-0000-0000-0000-000000000002', 'WIS-902B',
   '00000000-0000-0000-0000-000000000002', 'Fictional Student Two');
insert into public.parent_accounts (id, auth_user_id, login_id, display_name)
values (
  '50000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000003',
  'PARENT-TEST-01',
  'Fictional Test Parent'
);
insert into public.parent_student_links (
  parent_id, student_id, relationship, verified_at
)
values (
  '50000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  'guardian',
  now()
);
insert into public.enrollments (id, student_id, class_id, session_id)
values
  (
    '60000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001'
  ),
  (
    '60000000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001'
  );
insert into public.attendance_records (
  enrollment_id, student_id, class_id, session_id, term_id,
  attendance_date, status, created_by
)
values (
  '60000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '2026-10-26',
  'present',
  '00000000-0000-0000-0000-000000000004'
), (
  '60000000-0000-0000-0000-000000000002',
  '40000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '2026-10-27',
  'present',
  '00000000-0000-0000-0000-000000000004'
);
insert into public.class_result_finalizations (
  id, class_id, session_id, term_id, revision, finalized_by, result_snapshot
)
values (
  '70000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  1,
  '00000000-0000-0000-0000-000000000004',
  '[{"student_id":"40000000-0000-0000-0000-000000000001","percentage":92.5},{"student_id":"40000000-0000-0000-0000-000000000002","percentage":41.0}]'::jsonb
);
insert into public.published_report_cards (
  enrollment_id, finalization_id, overall_percentage, class_position,
  attendance_present, attendance_scheduled, snapshot
)
values (
  '60000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  92.5,
  1,
  1,
  1,
  '{"student_id":"40000000-0000-0000-0000-000000000001","percentage":92.5}'::jsonb
);
insert into public.timetable_documents (
  id, class_id, session_id, term_id, object_path, original_filename,
  content_type, size_bytes, uploaded_by
)
values (
  '80000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'test/primary-a.pdf',
  'primary-a.pdf',
  'application/pdf',
  100,
  '00000000-0000-0000-0000-000000000004'
);
insert into public.timetable_publications (timetable_id, published_by)
values (
  '80000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000004'
);
insert into public.subjects (id, name)
values ('90000000-0000-0000-0000-000000000001', 'Replacement Test Subject');
insert into public.assessment_schemas (
  id, class_id, session_id, term_id, subject_id, ca_maximum, exam_maximum, version
)
values (
  '91000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000001',
  30,
  70,
  1
);
insert into public.results (
  enrollment_id, schema_id, ca_mark, exam_mark, status, created_by
)
values (
  '60000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001',
  20,
  50,
  'draft',
  '00000000-0000-0000-0000-000000000004'
);
delete from public.results
where enrollment_id = '60000000-0000-0000-0000-000000000001'
  and schema_id = '91000000-0000-0000-0000-000000000001'
  and status = 'draft';
insert into pg_temp.pgtap_output(line) select is(
  (select count(*)::integer from public.results
   where enrollment_id = '60000000-0000-0000-0000-000000000001'
     and schema_id = '91000000-0000-0000-0000-000000000001'
     and status = 'draft'),
  0,
  'a draft result delete is not suppressed by the immutability trigger'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-000000000003',
    'role', 'authenticated',
    'iat', floor(extract(epoch from clock_timestamp()))::bigint + 10
  )::text,
  true
);

insert into pg_temp.pgtap_output(line) select is(
  (select count(*)::integer from public.students),
  1,
  'a parent sees only a linked child'
);
insert into pg_temp.pgtap_output(line) select is(
  (select count(*)::integer from public.students
   where id = '40000000-0000-0000-0000-000000000002'),
  0,
  'a parent cannot see an unlinked child by ID'
);
insert into pg_temp.pgtap_output(line) select is(
  (select count(*)::integer from public.attendance_records),
  1,
  'a parent sees linked-child attendance'
);
insert into pg_temp.pgtap_output(line) select is(
  (select count(*)::integer from public.enrollments),
  1,
  'a parent sees linked-child enrollment'
);
insert into pg_temp.pgtap_output(line) select is(
  (select count(*)::integer from public.school_settings),
  1,
  'an active parent can read school settings'
);
insert into pg_temp.pgtap_output(line) select is(
  (select count(*)::integer from public.published_report_cards),
  1,
  'a parent can still read the linked child report card'
);
insert into pg_temp.pgtap_output(line) select is(
  (select count(*)::integer from public.timetable_documents),
  1,
  'a parent can read a published timetable for a linked child'
);
insert into pg_temp.pgtap_output(line) select is(
  (select count(*)::integer from public.timetable_publications),
  1,
  'a parent can read publication status for a linked timetable'
);
insert into pg_temp.pgtap_output(line) select is(
  (select count(*)::integer from public.class_result_finalizations),
  0,
  'a parent cannot read class-wide result snapshots'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-000000000001',
    'role', 'authenticated',
    'iat', floor(extract(epoch from clock_timestamp()))::bigint + 10
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.pgtap_output(line) select is(
  (select count(*)::integer from public.students),
  1,
  'a student sees only their own student record'
);
insert into pg_temp.pgtap_output(line) select is(
  (select count(*)::integer from public.published_report_cards),
  1,
  'a student can still read their own report card'
);
insert into pg_temp.pgtap_output(line) select is(
  (select count(*)::integer from public.timetable_documents),
  1,
  'a student can read their published class timetable'
);
insert into pg_temp.pgtap_output(line) select is(
  (select count(*)::integer from public.timetable_publications),
  1,
  'a student can read publication status for their timetable'
);
insert into pg_temp.pgtap_output(line) select is(
  (select count(*)::integer from public.class_result_finalizations),
  0,
  'a student cannot read class-wide result snapshots'
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-000000000001',
    'role', 'authenticated',
    'iat', floor(extract(epoch from clock_timestamp()))::bigint + 10,
    'app_metadata', jsonb_build_object('must_change_password', true)
  )::text,
  true
);
insert into pg_temp.pgtap_output(line) select is(
  (select count(*)::integer from public.students),
  0,
  'an account requiring a password change cannot use database APIs directly'
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-000000000001',
    'role', 'authenticated',
    'iat', floor(extract(epoch from clock_timestamp()))::bigint + 10
  )::text,
  true
);
insert into pg_temp.pgtap_output(line) select is(
  (select count(*)::integer from public.students
   where id = '40000000-0000-0000-0000-000000000002'),
  0,
  'a student cannot see another student by ID'
);
insert into pg_temp.pgtap_output(line) select throws_ok(
  $$select public.create_academic_session(
      'Unauthorized Session',
      '2090-01-01',
      '2090-12-31',
      false
    )$$,
  'P0001',
  'Only an active Super Admin can create an academic session',
  'students cannot create academic sessions'
);
insert into pg_temp.pgtap_output(line) select is(
  (select count(*)::integer from public.attendance_records),
  1,
  'a student can see their own attendance'
);
insert into pg_temp.pgtap_output(line) select is(
  (select count(*)::integer from public.attendance_records
   where student_id = '40000000-0000-0000-0000-000000000002'),
  0,
  'a student cannot see another student attendance by ID'
);
insert into pg_temp.pgtap_output(line) select is(
  (select count(*)::integer from public.parent_accounts),
  0,
  'a student cannot read parent account records'
);
insert into pg_temp.pgtap_output(line) select ok(
  not has_table_privilege('authenticated', 'public.results', 'insert'),
  'clients cannot bypass the trusted results import workflow'
);
insert into pg_temp.pgtap_output(line) select ok(
  not has_table_privilege('authenticated', 'public.published_report_cards', 'insert'),
  'clients cannot publish report cards directly'
);
insert into pg_temp.pgtap_output(line) select ok(
  not has_table_privilege('authenticated', 'public.audit_logs', 'insert'),
  'clients cannot forge audit log records'
);
insert into pg_temp.pgtap_output(line) select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_school_account(uuid, uuid, public.account_role, text, text, text, text, text, uuid, uuid, text, jsonb)',
    'execute'
  ),
  'clients cannot call trusted account provisioning directly'
);
insert into pg_temp.pgtap_output(line) select ok(
  not has_table_privilege('authenticated', 'public.attendance_records', 'update'),
  'clients cannot bypass reasoned attendance corrections'
);
insert into pg_temp.pgtap_output(line) select ok(
  not has_function_privilege(
    'authenticated',
    'public.resolve_portal_login_account(text)',
    'execute'
  ),
  'clients cannot query private account identifiers for password recovery'
);
insert into pg_temp.pgtap_output(line) select ok(
  has_function_privilege(
    'service_role',
    'public.resolve_portal_login_account(text)',
    'execute'
  ),
  'only trusted server operations can resolve password-reset targets'
);
insert into pg_temp.pgtap_output(line) select throws_ok(
  $$select public.approve_student_promotion(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'normal',
      '30000000-0000-0000-0000-000000000001',
      'unauthorized test'
    )$$,
  'P0001',
  'Only an active Super Admin can approve a promotion',
  'students cannot approve promotion decisions'
);
insert into pg_temp.pgtap_output(line) select throws_ok(
  $$select public.archive_student(
      '40000000-0000-0000-0000-000000000001',
      'unauthorized test'
    )$$,
  'P0001',
  'Only an active Super Admin can archive student access',
  'students cannot archive learner accounts'
);

reset role;
update public.user_accounts
set sessions_invalid_before = clock_timestamp() + interval '1 hour'
where user_id = '00000000-0000-0000-0000-000000000001';
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-000000000001',
    'role', 'authenticated',
    'iat', floor(extract(epoch from clock_timestamp()))::bigint - 10
  )::text,
  true
);
set local role authenticated;
insert into pg_temp.pgtap_output(line) select is(
  (select count(*)::integer from public.students),
  0,
  'an active account cannot use a token issued before its credential update'
);
reset role;
update public.user_accounts
set sessions_invalid_before = clock_timestamp() - interval '2 seconds'
where user_id = '00000000-0000-0000-0000-000000000001';
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-000000000001',
    'role', 'authenticated',
    'iat', floor(extract(epoch from clock_timestamp()))::bigint + 10
  )::text,
  true
);
set local role authenticated;
insert into pg_temp.pgtap_output(line) select is(
  (select count(*)::integer from public.students),
  1,
  'a token issued after the credential update can access its account'
);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-000000000004',
    'role', 'authenticated',
    'iat', floor(extract(epoch from clock_timestamp()))::bigint + 10
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.pgtap_output(line) select ok(
  public.create_academic_session(
    'Fictional Future Session',
    '2090-01-01',
    '2090-12-31',
    false
  ) is not null,
  'an active Super Admin can create a future academic session'
);
insert into pg_temp.pgtap_output(line) select ok(
  public.create_academic_term(
    (
      select id from public.academic_sessions
      where name = 'Fictional Future Session'
    ),
    'First Term',
    '2090-01-01',
    '2090-04-30',
    array[1, 2, 3, 4, 5]::smallint[]
  ) is not null,
  'an active Super Admin can create a session-bounded academic term'
);
insert into pg_temp.pgtap_output(line) select throws_ok(
  $$select public.create_academic_term(
      (
        select id from public.academic_sessions
        where name = 'Fictional Future Session'
      ),
      'Second Term',
      '2090-04-01',
      '2090-08-31',
      array[1, 2, 3, 4, 5]::smallint[]
    )$$,
  'P0001',
  'Academic term dates cannot overlap another term in the same session',
  'academic terms cannot overlap within the same session'
);
create temporary table grading_version_before_test as
select coalesce(max(configuration_version), 0) as version
from public.grading_bands;

insert into pg_temp.pgtap_output(line) select is(
  public.save_grading_scale(
    '[
      {"grade":"A","minimum_percentage":70,"maximum_percentage":100},
      {"grade":"B","minimum_percentage":60,"maximum_percentage":69.99},
      {"grade":"C","minimum_percentage":50,"maximum_percentage":59.99},
      {"grade":"D","minimum_percentage":45,"maximum_percentage":49.99},
      {"grade":"E","minimum_percentage":40,"maximum_percentage":44.99},
      {"grade":"F","minimum_percentage":0,"maximum_percentage":39.99}
    ]'::jsonb
  ),
  (select version + 1 from pg_temp.grading_version_before_test),
  'an active Super Admin can save the next complete grading-scale version'
);
insert into pg_temp.pgtap_output(line) select throws_ok(
  $$select public.save_grading_scale(
      '[
        {"grade":"A","minimum_percentage":70,"maximum_percentage":100},
        {"grade":"F","minimum_percentage":0,"maximum_percentage":69.98}
      ]'::jsonb
    )$$,
  'P0001',
  'Grading bands must cover 0 through 100 without gaps or overlaps',
  'grading-scale versions cannot contain gaps'
);

insert into pg_temp.pgtap_output(line) select is(
  (
    select count(*)::integer
    from public.students
    where id in (
      '40000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000002'
    )
  ),
  2,
  'an active Super Admin can see both fictional test students'
);
reset role;
insert into pg_temp.pgtap_output(line) select throws_ok(
  $$update public.students
    set serial = 'WIS-999Z'
    where id = '40000000-0000-0000-0000-000000000001'$$,
  'P0001',
  'Student serials are permanent and cannot be changed',
  'even administrators cannot change a permanent student serial'
);
set local role authenticated;
insert into pg_temp.pgtap_output(line) select ok(
  not has_table_privilege('authenticated', 'public.students', 'delete'),
  'authenticated users cannot delete student records directly'
);

reset role;
insert into pg_temp.pgtap_output(line) select throws_ok(
  $$delete from public.students
    where id = '40000000-0000-0000-0000-000000000001'$$,
  'P0001',
  'Student records cannot be deleted; archive them to retain history',
  'the database preserves serials even against privileged deletion'
);
update public.user_accounts
set active = false, deactivated_at = now()
where user_id = '00000000-0000-0000-0000-000000000003';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-000000000003',
    'role', 'authenticated',
    'iat', floor(extract(epoch from clock_timestamp()))::bigint + 10
  )::text,
  true
);
set local role authenticated;
insert into pg_temp.pgtap_output(line) select is(
  (select count(*)::integer from public.students),
  0,
  'a deactivated parent cannot keep reading student data with an old token'
);
insert into pg_temp.pgtap_output(line) select is(
  (select count(*)::integer from public.school_settings),
  0,
  'a deactivated parent cannot read portal data'
);

insert into pg_temp.pgtap_output(line) select * from finish();
select line from pg_temp.pgtap_output order by ctid;
rollback;
