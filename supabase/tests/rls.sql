begin;

select plan(16);

select has_table('public', 'students', 'student records table exists');
select has_table('public', 'parent_student_links', 'verified parent links table exists');
select has_table('public', 'attendance_records', 'attendance table exists');
select has_table('public', 'published_report_cards', 'published report snapshots table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.students'::regclass),
  'Row Level Security is enabled for students'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.attendance_records'::regclass),
  'Row Level Security is enabled for attendance'
);
select ok(
  not has_table_privilege('anon', 'public.students', 'select'),
  'Unauthenticated role cannot select students'
);
select ok(
  not has_table_privilege('authenticated', 'public.audit_logs', 'insert'),
  'Authenticated clients cannot write audit logs'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.allocate_student_serial()',
    'execute'
  ),
  'Authenticated clients cannot allocate permanent student serials'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.allocate_student_serial()',
    'execute'
  ),
  'Unauthenticated callers cannot allocate student serials'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.allocate_student_serial()',
    'execute'
  ),
  'Only the trusted server role can allocate student serials'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.resolve_portal_login(text)',
    'execute'
  ),
  'Authenticated users cannot resolve login IDs'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.resolve_portal_login(text)',
    'execute'
  ),
  'Unauthenticated users cannot resolve login IDs'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.resolve_portal_login(text)',
    'execute'
  ),
  'Only the trusted server role can resolve login IDs'
);
select ok(
  not has_table_privilege('authenticated', 'private.portal_login_identities', 'select'),
  'Browser users cannot read private login identity mappings'
);
select ok(
  not has_table_privilege('authenticated', 'private.portal_login_rate_limits', 'select'),
  'Browser users cannot read private login throttling records'
);

select * from finish();
rollback;
