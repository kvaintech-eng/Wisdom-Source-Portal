create extension if not exists pgcrypto with schema extensions;

create type public.account_role as enum ('super_admin', 'student', 'parent');
create type public.enrollment_status as enum ('active', 'withdrawn', 'completed');
create type public.attendance_status as enum ('present', 'absent');
create type public.result_status as enum ('draft', 'published');
create type public.calendar_event_kind as enum ('event', 'holiday', 'closure', 'break');
create type public.promotion_kind as enum (
  'normal',
  'repeat',
  'double',
  'special_placement',
  'graduation'
);

create table public.user_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.account_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  deactivated_at timestamptz,
  constraint user_accounts_deactivation_consistent check (
    (active and deactivated_at is null) or (not active and deactivated_at is not null)
  )
);

create table public.school_settings (
  id boolean primary key default true check (id),
  school_name text not null default 'Wisdom Source School',
  contact_details jsonb not null default '{}'::jsonb,
  report_card_footer text not null default '',
  watermark_object_path text,
  signature_object_path text,
  configuration_version integer not null default 1 check (configuration_version > 0),
  updated_at timestamptz not null default now()
);

insert into public.school_settings (id, school_name)
values (true, 'Wisdom Source School');

create table public.academic_sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  starts_on date not null,
  ends_on date not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint academic_sessions_dates_valid check (starts_on <= ends_on)
);

create unique index academic_sessions_one_active_idx
  on public.academic_sessions (is_active)
  where is_active;

create table public.academic_terms (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.academic_sessions (id) on delete restrict,
  name text not null check (name in ('First Term', 'Second Term', 'Third Term')),
  starts_on date not null,
  ends_on date not null,
  open_weekdays smallint[] not null default array[1, 2, 3, 4, 5]::smallint[],
  created_at timestamptz not null default now(),
  unique (session_id, name),
  unique (id, session_id),
  constraint academic_terms_dates_valid check (starts_on <= ends_on),
  constraint academic_terms_weekdays_valid check (
    cardinality(open_weekdays) between 1 and 7
    and array_position(open_weekdays, 0::smallint) is null
    and array_position(open_weekdays, 8::smallint) is null
  )
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  level text not null check (level in ('Kindergarten', 'Nursery', 'Primary', 'JSS', 'SS')),
  display_order smallint not null unique check (display_order > 0),
  next_class_id uuid references public.classes (id) on delete restrict,
  active boolean not null default true
);

insert into public.classes (name, level, display_order)
values
  ('KG 1', 'Kindergarten', 1),
  ('KG 2', 'Kindergarten', 2),
  ('Nursery 1', 'Nursery', 3),
  ('Nursery 2', 'Nursery', 4),
  ('Nursery 3', 'Nursery', 5),
  ('Primary 1', 'Primary', 6),
  ('Primary 2', 'Primary', 7),
  ('Primary 3', 'Primary', 8),
  ('Primary 4', 'Primary', 9),
  ('Primary 5', 'Primary', 10),
  ('Primary 6', 'Primary', 11),
  ('JSS 1', 'JSS', 12),
  ('JSS 2', 'JSS', 13),
  ('JSS 3', 'JSS', 14),
  ('SS 1', 'SS', 15),
  ('SS 2', 'SS', 16),
  ('SS 3', 'SS', 17);

update public.classes as destination
set next_class_id = successor.id
from public.classes as current_class
join public.classes as successor
  on successor.name = case current_class.name
    when 'KG 1' then 'KG 2'
    when 'KG 2' then 'Nursery 1'
    when 'Nursery 1' then 'Nursery 2'
    when 'Nursery 2' then 'Nursery 3'
    when 'Nursery 3' then 'Primary 1'
    when 'Primary 1' then 'Primary 2'
    when 'Primary 2' then 'Primary 3'
    when 'Primary 3' then 'Primary 4'
    when 'Primary 4' then 'Primary 5'
    when 'Primary 5' then 'Primary 6'
    when 'Primary 6' then 'JSS 1'
    when 'JSS 1' then 'JSS 2'
    when 'JSS 2' then 'JSS 3'
    when 'JSS 3' then 'SS 1'
    when 'SS 1' then 'SS 2'
    when 'SS 2' then 'SS 3'
    else null
  end
where destination.id = current_class.id;

create table public.students (
  id uuid primary key default gen_random_uuid(),
  serial text not null unique,
  auth_user_id uuid unique references auth.users (id) on delete set null,
  full_name text not null,
  gender text check (gender in ('female', 'male', 'undisclosed')),
  active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint students_serial_format check (serial ~ '^WIS-[0-9]{3,}[A-Z]$'),
  constraint students_name_nonempty check (length(trim(full_name)) > 0),
  constraint students_archive_consistent check (active or archived_at is not null)
);

create sequence public.student_serial_number_seq start with 1;

create table public.parent_accounts (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  login_id text not null unique,
  display_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint parent_login_id_nonempty check (length(trim(login_id)) > 0),
  constraint parent_name_nonempty check (length(trim(display_name)) > 0)
);

create table public.parent_student_links (
  parent_id uuid not null references public.parent_accounts (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  relationship text not null,
  verified_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (parent_id, student_id)
);

alter table public.parent_student_links
  add constraint parent_student_relationship_nonempty
  check (length(trim(relationship)) > 0);

create unique index parent_accounts_login_id_case_insensitive_idx
  on public.parent_accounts (lower(login_id));

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete restrict,
  class_id uuid not null references public.classes (id) on delete restrict,
  session_id uuid not null references public.academic_sessions (id) on delete restrict,
  status public.enrollment_status not null default 'active',
  reason text,
  created_at timestamptz not null default now(),
  unique (student_id, session_id),
  unique (id, student_id, class_id, session_id)
);

create index enrollments_class_session_idx
  on public.enrollments (class_id, session_id, status);

create table public.school_calendar_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.academic_sessions (id) on delete restrict,
  term_id uuid,
  title text not null,
  description text not null default '',
  starts_on date not null,
  ends_on date not null,
  kind public.calendar_event_kind not null,
  school_open boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (term_id, session_id)
    references public.academic_terms (id, session_id) on delete restrict,
  constraint school_calendar_event_dates_valid check (starts_on <= ends_on),
  constraint school_calendar_event_closure_state check (
    kind = 'event' or not school_open
  ),
  constraint school_calendar_event_title_nonempty check (length(trim(title)) > 0)
);

create index school_calendar_events_session_dates_idx
  on public.school_calendar_events (session_id, starts_on, ends_on);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null,
  student_id uuid not null,
  class_id uuid not null,
  session_id uuid not null,
  term_id uuid not null,
  attendance_date date not null,
  status public.attendance_status not null,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  corrected_by uuid references auth.users (id) on delete restrict,
  corrected_at timestamptz,
  correction_reason text,
  foreign key (enrollment_id, student_id, class_id, session_id)
    references public.enrollments (id, student_id, class_id, session_id) on delete restrict,
  foreign key (term_id, session_id)
    references public.academic_terms (id, session_id) on delete restrict,
  unique (enrollment_id, attendance_date),
  constraint attendance_correction_consistent check (
    (
      corrected_at is null
      and correction_reason is null
      and corrected_by is null
    )
    or (
      corrected_at is not null
      and corrected_by is not null
      and length(trim(correction_reason)) > 0
    )
  )
);

create index attendance_class_date_idx
  on public.attendance_records (class_id, attendance_date, session_id, term_id);

create table public.timetable_documents (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete restrict,
  session_id uuid not null references public.academic_sessions (id) on delete restrict,
  term_id uuid not null,
  object_path text not null unique,
  original_filename text not null,
  content_type text not null check (
    content_type in ('application/pdf', 'image/png', 'image/jpeg')
  ),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (term_id, session_id)
    references public.academic_terms (id, session_id) on delete restrict,
  constraint timetable_filename_nonempty check (length(trim(original_filename)) > 0)
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  published_at timestamptz,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint announcements_title_nonempty check (length(trim(title)) > 0)
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true
);

create table public.assessment_schemas (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete restrict,
  session_id uuid not null references public.academic_sessions (id) on delete restrict,
  term_id uuid not null,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  ca_maximum numeric(7, 2) not null check (ca_maximum >= 0),
  exam_maximum numeric(7, 2) not null check (exam_maximum >= 0),
  version integer not null check (version > 0),
  created_at timestamptz not null default now(),
  foreign key (term_id, session_id)
    references public.academic_terms (id, session_id) on delete restrict,
  unique (class_id, session_id, term_id, subject_id, version),
  constraint assessment_schema_positive_total check (ca_maximum + exam_maximum > 0)
);

create table public.grading_bands (
  id uuid primary key default gen_random_uuid(),
  grade text not null,
  minimum_percentage numeric(5, 2) not null check (
    minimum_percentage between 0 and 100
  ),
  maximum_percentage numeric(5, 2) not null check (
    maximum_percentage between 0 and 100
  ),
  configuration_version integer not null check (configuration_version > 0),
  unique (configuration_version, grade),
  constraint grading_band_bounds_valid check (
    minimum_percentage <= maximum_percentage
  )
);

insert into public.grading_bands (
  grade,
  minimum_percentage,
  maximum_percentage,
  configuration_version
)
values
  ('A', 70, 100, 1),
  ('B', 60, 69.99, 1),
  ('C', 50, 59.99, 1),
  ('D', 45, 49.99, 1),
  ('E', 40, 44.99, 1),
  ('F', 0, 39.99, 1);

create table public.result_import_batches (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete restrict,
  session_id uuid not null references public.academic_sessions (id) on delete restrict,
  term_id uuid not null,
  original_filename text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  imported_by uuid not null references auth.users (id) on delete restrict,
  validation_summary jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (term_id, session_id)
    references public.academic_terms (id, session_id) on delete restrict,
  unique (class_id, session_id, term_id, content_sha256)
);

create table public.results (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments (id) on delete restrict,
  schema_id uuid not null references public.assessment_schemas (id) on delete restrict,
  import_batch_id uuid references public.result_import_batches (id) on delete restrict,
  ca_mark numeric(7, 2) not null check (ca_mark >= 0),
  exam_mark numeric(7, 2) not null check (exam_mark >= 0),
  grade text,
  status public.result_status not null default 'draft',
  revision integer not null default 1 check (revision > 0),
  previous_revision_id uuid references public.results (id) on delete restrict,
  correction_reason text,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  constraint results_ca_within_maximum check (ca_mark <= 1000000),
  constraint results_exam_within_maximum check (exam_mark <= 1000000),
  constraint results_publication_consistent check (
    (status = 'draft' and published_at is null)
    or (status = 'published' and published_at is not null)
  ),
  constraint results_revision_consistent check (
    (revision = 1 and previous_revision_id is null)
    or (
      revision > 1
      and previous_revision_id is not null
      and length(trim(correction_reason)) > 0
    )
  )
);

create index results_enrollment_schema_idx on public.results (enrollment_id, schema_id);
create unique index results_one_draft_per_enrollment_schema_idx
  on public.results (enrollment_id, schema_id)
  where status = 'draft';

create table public.class_result_finalizations (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete restrict,
  session_id uuid not null references public.academic_sessions (id) on delete restrict,
  term_id uuid not null,
  revision integer not null default 1 check (revision > 0),
  finalized_by uuid not null references auth.users (id) on delete restrict,
  finalized_at timestamptz not null default now(),
  result_snapshot jsonb not null,
  foreign key (term_id, session_id)
    references public.academic_terms (id, session_id) on delete restrict,
  unique (class_id, session_id, term_id, revision)
);

create table public.published_report_cards (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments (id) on delete restrict,
  finalization_id uuid not null references public.class_result_finalizations (id) on delete restrict,
  overall_percentage numeric(5, 2) not null check (
    overall_percentage between 0 and 100
  ),
  class_position integer not null check (class_position > 0),
  attendance_present integer not null check (attendance_present >= 0),
  attendance_scheduled integer not null check (
    attendance_scheduled >= attendance_present
  ),
  snapshot jsonb not null,
  published_at timestamptz not null default now(),
  unique (enrollment_id, finalization_id)
);

create table public.promotion_decisions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete restrict,
  from_enrollment_id uuid not null references public.enrollments (id) on delete restrict,
  destination_class_id uuid references public.classes (id) on delete restrict,
  effective_session_id uuid not null references public.academic_sessions (id) on delete restrict,
  kind public.promotion_kind not null,
  reason text not null,
  approved_by uuid not null references auth.users (id) on delete restrict,
  approved_at timestamptz not null default now(),
  constraint promotion_reason_nonempty check (length(trim(reason)) > 0),
  constraint promotion_destination_valid check (
    (kind = 'graduation' and destination_class_id is null)
    or (kind <> 'graduation' and destination_class_id is not null)
  )
);

create index promotion_decisions_student_effective_idx
  on public.promotion_decisions (student_id, effective_session_id);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  reason text,
  request_id text,
  change_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_action_nonempty check (length(trim(action)) > 0)
);

create index audit_logs_created_at_idx on public.audit_logs (created_at desc);
