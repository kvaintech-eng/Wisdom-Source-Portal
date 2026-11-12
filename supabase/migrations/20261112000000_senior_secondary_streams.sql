alter table public.enrollments
  add column stream text
    check (stream is null or stream in ('Science', 'Art', 'Commercial'));

alter table public.assessment_schemas
  add column stream text
    check (stream is null or stream in ('Science', 'Art', 'Commercial'));

alter table public.result_import_batches
  add column stream text
    check (stream is null or stream in ('Science', 'Art', 'Commercial'));

alter table public.class_result_finalizations
  add column stream text
    check (stream is null or stream in ('Science', 'Art', 'Commercial'));

create function pg_temp.drop_unique_constraint(p_table regclass, p_columns text[])
returns void
language plpgsql
as $$
declare
  constraint_name text;
begin
  select constraint_record.conname into constraint_name
  from pg_catalog.pg_constraint as constraint_record
  where constraint_record.conrelid = p_table
    and constraint_record.contype = 'u'
    and (
      select array_agg(attribute.attname::text order by key_column.ordinality)
      from unnest(constraint_record.conkey) with ordinality as key_column(attribute_number, ordinality)
      join pg_catalog.pg_attribute as attribute
        on attribute.attrelid = constraint_record.conrelid
        and attribute.attnum = key_column.attribute_number
    ) = p_columns;

  if constraint_name is null then
    raise exception 'Could not find unique constraint on %.%', p_table, array_to_string(p_columns, ', ');
  end if;

  execute format('alter table %s drop constraint %I', p_table, constraint_name);
end
$$;

select pg_temp.drop_unique_constraint(
  'public.assessment_schemas'::regclass,
  array['class_id', 'session_id', 'term_id', 'subject_id', 'version']
);

create unique index assessment_schemas_context_subject_version_idx
  on public.assessment_schemas (
    class_id, session_id, term_id, subject_id, version, coalesce(stream, '')
  );

select pg_temp.drop_unique_constraint(
  'public.result_import_batches'::regclass,
  array['class_id', 'session_id', 'term_id', 'content_sha256']
);

create unique index result_import_batches_context_stream_hash_idx
  on public.result_import_batches (
    class_id, session_id, term_id, coalesce(stream, ''), content_sha256
  );

select pg_temp.drop_unique_constraint(
  'public.class_result_finalizations'::regclass,
  array['class_id', 'session_id', 'term_id', 'revision']
);

create unique index class_result_finalizations_context_stream_revision_idx
  on public.class_result_finalizations (
    class_id, session_id, term_id, coalesce(stream, ''), revision
  );

drop function pg_temp.drop_unique_constraint(regclass, text[]);

create or replace function public.validate_assessment_stream()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  class_level text;
begin
  select school_class.level into class_level
  from public.classes as school_class
  where school_class.id = new.class_id;

  if new.stream is not null and class_level is distinct from 'SS' then
    raise exception 'Streams may only be configured for senior secondary classes';
  end if;
  if class_level = 'SS' and new.stream is null then
    raise exception 'A stream is required for senior secondary assessments';
  end if;
  return new;
end
$$;

create trigger assessment_stream_valid_on_write
before insert or update of class_id, stream on public.assessment_schemas
for each row execute function public.validate_assessment_stream();

create or replace function public.validate_enrollment_stream()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  class_level text;
begin
  select school_class.level into class_level
  from public.classes as school_class
  where school_class.id = new.class_id;

  if new.stream is not null and class_level is distinct from 'SS' then
    raise exception 'Streams may only be assigned to senior secondary enrollments';
  end if;
  return new;
end
$$;

create trigger enrollment_stream_valid_on_write
before insert or update of class_id, stream on public.enrollments
for each row execute function public.validate_enrollment_stream();

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
    or enrollment.session_id <> assessment.session_id
    or enrollment.stream is distinct from assessment.stream then
    raise exception 'Result assessment must match the learner class, session, and stream';
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

create or replace function public.assign_student_stream(
  p_enrollment_id uuid,
  p_stream text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  enrollment public.enrollments%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Only an active Super Admin can assign a student stream';
  end if;
  if p_stream is null or p_stream not in ('Science', 'Art', 'Commercial')
    or nullif(trim(p_reason), '') is null
    or length(trim(p_reason)) > 500 then
    raise exception 'Choose a valid stream and provide a reason';
  end if;

  select current_enrollment.* into enrollment
  from public.enrollments as current_enrollment
  join public.classes as school_class on school_class.id = current_enrollment.class_id
  where current_enrollment.id = p_enrollment_id
    and current_enrollment.status = 'active'
    and school_class.level = 'SS'
  for update of current_enrollment;
  if not found then
    raise exception 'An active senior secondary enrollment is required';
  end if;
  if enrollment.stream is not null then
    raise exception 'A stream is already assigned; stream transfers are not enabled';
  end if;

  update public.enrollments
  set stream = p_stream
  where id = p_enrollment_id;

  insert into public.audit_logs (
    actor_user_id, action, target_type, target_id, reason, change_summary
  )
  values (
    auth.uid(),
    'student.stream_assigned',
    'enrollment',
    p_enrollment_id::text,
    trim(p_reason),
    jsonb_build_object(
      'student_id', enrollment.student_id,
      'class_id', enrollment.class_id,
      'session_id', enrollment.session_id,
      'stream', p_stream
    )
  );
end
$$;

create or replace function public.create_student_account_with_stream(
  p_actor_user_id uuid,
  p_auth_user_id uuid,
  p_login_id text,
  p_auth_email text,
  p_login_hash text,
  p_student_name text,
  p_student_gender text,
  p_class_id uuid,
  p_session_id uuid,
  p_stream text
)
returns table (student_id uuid, student_serial text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_level text;
  created_account record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Account provisioning requires a trusted server operation';
  end if;

  select school_class.level into selected_level
  from public.classes as school_class
  where school_class.id = p_class_id and school_class.active;
  if not found then
    raise exception 'The selected class is unavailable';
  end if;

  if (selected_level = 'SS' and (p_stream is null or p_stream not in ('Science', 'Art', 'Commercial')))
    or (selected_level <> 'SS' and p_stream is not null) then
    raise exception 'A valid stream is required only for senior secondary learners';
  end if;

  select * into created_account
  from public.create_school_account(
    p_actor_user_id,
    p_auth_user_id,
    'student',
    p_login_id,
    p_auth_email,
    p_login_hash,
    p_student_name,
    p_student_gender,
    p_class_id,
    p_session_id,
    null,
    '[]'::jsonb
  );

  update public.enrollments
  set stream = p_stream
  where public.enrollments.student_id = created_account.student_id
    and public.enrollments.class_id = p_class_id
    and public.enrollments.session_id = p_session_id;

  if p_stream is not null then
    insert into public.audit_logs (
      actor_user_id, action, target_type, target_id, change_summary
    )
    values (
      p_actor_user_id,
      'student.stream_assigned',
      'enrollment',
      (
        select enrollment.id::text
        from public.enrollments as enrollment
        where enrollment.student_id = created_account.student_id
          and enrollment.session_id = p_session_id
      ),
      jsonb_build_object('student_id', created_account.student_id, 'stream', p_stream)
    );
  end if;

  return query select created_account.student_id, created_account.student_serial;
end
$$;

revoke execute on function public.create_student_account_with_stream(
  uuid, uuid, text, text, text, text, text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.create_student_account_with_stream(
  uuid, uuid, text, text, text, text, text, uuid, uuid, text
) to service_role;

revoke execute on function public.assign_student_stream(uuid, text, text) from public, anon;
grant execute on function public.assign_student_stream(uuid, text, text) to authenticated;

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
  destination_level text;
  next_enrollment_id uuid;
  promotion_id uuid;
  next_stream text;
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
    select school_class.level into destination_level
    from public.classes as school_class
    where school_class.id = p_destination_class_id and school_class.active;
    if not found then
      raise exception 'A valid destination class is required';
    end if;

    next_stream := case when destination_level = 'SS' then current_enrollment.stream else null end;
    insert into public.enrollments (student_id, class_id, session_id, reason, stream)
    values (
      p_student_id,
      p_destination_class_id,
      p_effective_session_id,
      trim(p_reason),
      next_stream
    )
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
      'new_enrollment_id', next_enrollment_id,
      'stream', next_stream
    )
  );

  return promotion_id;
end
$$;

create function pg_temp.patch_result_function(
  p_function regprocedure,
  variadic p_replacements text[]
)
returns void
language plpgsql
as $$
declare
  function_source text := pg_get_functiondef(p_function);
  replacement_index integer;
begin
  if array_length(p_replacements, 1) is null
    or array_length(p_replacements, 1) % 2 <> 0 then
    raise exception 'Function patch needs old/new replacement pairs';
  end if;
  for replacement_index in 1..array_length(p_replacements, 1) by 2 loop
    if position(p_replacements[replacement_index] in function_source) = 0 then
      raise exception 'Could not apply expected stream patch to %', p_function;
    end if;
    function_source := replace(
      function_source,
      p_replacements[replacement_index],
      p_replacements[replacement_index + 1]
    );
  end loop;
  execute function_source;
end
$$;

select pg_temp.patch_result_function(
  'public.publish_class_results(uuid,uuid,uuid,jsonb)'::regprocedure,
  $old$begin
  if not public.is_super_admin() then$old$,
  $new$begin
  if exists (
    select 1 from public.classes as school_class
    where school_class.id = p_class_id and school_class.level = 'SS'
  ) and nullif(current_setting('app.result_stream', true), '') is null then
    raise exception 'Choose a stream when publishing senior secondary results';
  end if;
  if not public.is_super_admin() then$new$,
  $old$and enrollment.status = 'active'$old$,
  $new$and enrollment.status = 'active'
      and enrollment.stream is not distinct from nullif(current_setting('app.result_stream', true), '')$new$,
  $old$and assessment.term_id = p_term_id$old$,
  $new$and assessment.term_id = p_term_id
      and assessment.stream is not distinct from nullif(current_setting('app.result_stream', true), '')$new$,
  $old$and latest.subject_id = assessment.subject_id$old$,
  $new$and latest.subject_id = assessment.subject_id
        and latest.stream is not distinct from nullif(current_setting('app.result_stream', true), '')$new$,
  $old$and current_version.subject_id = latest.subject_id$old$,
  $new$and current_version.subject_id = latest.subject_id
            and current_version.stream is not distinct from nullif(current_setting('app.result_stream', true), '')$new$,
  $old$and finalization.term_id = p_term_id;$old$,
  $new$and finalization.term_id = p_term_id
    and finalization.stream is not distinct from nullif(current_setting('app.result_stream', true), '');$new$,
  $old$and current_assessment.term_id = p_term_id$old$,
  $new$and current_assessment.term_id = p_term_id
      and current_assessment.stream is not distinct from nullif(current_setting('app.result_stream', true), '')$new$,
  $old$    term_id,
    revision,$old$,
  $new$    term_id,
    stream,
    revision,$new$,
  $old$    p_term_id,
    next_revision,$old$,
  $new$    p_term_id,
    nullif(current_setting('app.result_stream', true), ''),
    next_revision,$new$
);

select pg_temp.patch_result_function(
  'public.save_result_drafts(uuid,uuid,uuid,text,text,jsonb,boolean,text)'::regprocedure,
  $old$begin
  if not public.is_super_admin() then$old$,
  $new$begin
  if exists (
    select 1 from public.classes as school_class
    where school_class.id = p_class_id and school_class.level = 'SS'
  ) and nullif(current_setting('app.result_stream', true), '') is null then
    raise exception 'Choose a stream when importing senior secondary results';
  end if;
  if not public.is_super_admin() then$new$,
  $old$and existing_batch.term_id = p_term_id
      and existing_batch.content_sha256 = p_sha256$old$,
  $new$and existing_batch.term_id = p_term_id
      and existing_batch.stream is not distinct from nullif(current_setting('app.result_stream', true), '')
      and existing_batch.content_sha256 = p_sha256$new$,
  $old$and enrollment.status = 'active'$old$,
  $new$and enrollment.status = 'active'
      and enrollment.stream is not distinct from nullif(current_setting('app.result_stream', true), '')$new$,
  $old$and assessment.term_id = p_term_id$old$,
  $new$and assessment.term_id = p_term_id
      and assessment.stream is not distinct from nullif(current_setting('app.result_stream', true), '')$new$,
  $old$and prior_schema.term_id = p_term_id$old$,
  $new$and prior_schema.term_id = p_term_id
          and prior_schema.stream is not distinct from nullif(current_setting('app.result_stream', true), '')$new$,
  $old$    term_id,
    original_filename,$old$,
  $new$    term_id,
    stream,
    original_filename,$new$,
  $old$    p_term_id,
    trim(p_file_name),$old$,
  $new$    p_term_id,
    nullif(current_setting('app.result_stream', true), ''),
    trim(p_file_name),$new$
);

drop function pg_temp.patch_result_function(regprocedure, text[]);

create or replace function public.save_stream_result_drafts(
  p_class_id uuid,
  p_session_id uuid,
  p_term_id uuid,
  p_stream text,
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
begin
  if p_stream is null or p_stream not in ('Science', 'Art', 'Commercial')
    or not exists (
      select 1 from public.classes as school_class
      where school_class.id = p_class_id
        and school_class.level = 'SS'
        and school_class.active
    ) then
    raise exception 'A valid senior secondary class and stream are required';
  end if;

  perform set_config('app.result_stream', p_stream, true);
  return query
  select * from public.save_result_drafts(
    p_class_id,
    p_session_id,
    p_term_id,
    p_file_name,
    p_sha256,
    p_rows,
    p_confirm_replace,
    p_correction_reason
  );
end
$$;

create or replace function public.publish_stream_class_results(
  p_class_id uuid,
  p_session_id uuid,
  p_term_id uuid,
  p_stream text,
  p_teacher_comments jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_stream is null or p_stream not in ('Science', 'Art', 'Commercial')
    or not exists (
      select 1 from public.classes as school_class
      where school_class.id = p_class_id
        and school_class.level = 'SS'
        and school_class.active
    ) then
    raise exception 'A valid senior secondary class and stream are required';
  end if;

  perform set_config('app.result_stream', p_stream, true);
  return public.publish_class_results(
    p_class_id,
    p_session_id,
    p_term_id,
    p_teacher_comments
  );
end
$$;

revoke execute on function public.save_stream_result_drafts(
  uuid, uuid, uuid, text, text, text, jsonb, boolean, text
) from public, anon;
grant execute on function public.save_stream_result_drafts(
  uuid, uuid, uuid, text, text, text, jsonb, boolean, text
) to authenticated;

revoke execute on function public.publish_stream_class_results(
  uuid, uuid, uuid, text, jsonb
) from public, anon;
grant execute on function public.publish_stream_class_results(
  uuid, uuid, uuid, text, jsonb
) to authenticated;
