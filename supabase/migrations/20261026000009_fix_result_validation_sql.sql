do $$
declare
  function_definition text;
  updated_definition text;
  normalized_definition text;
begin
  select pg_get_functiondef(
    'public.publish_class_results(uuid,uuid,uuid,jsonb)'::regprocedure
  ) into function_definition;

  updated_definition := regexp_replace(
    function_definition,
    'extract\(isodow from scheduled_day\.day\)::smallint = any\(\s*\(\s*select term\.open_weekdays\s+from public\.academic_terms as term\s+where term\.id = p_term_id and term\.session_id = p_session_id\s*\)\s*\)',
    'extract(isodow from scheduled_day.day)::smallint = any(array(select unnest(term.open_weekdays) from public.academic_terms as term where term.id = p_term_id and term.session_id = p_session_id))'
  );

  if updated_definition = function_definition then
    normalized_definition := lower(regexp_replace(function_definition, '\s+', '', 'g'));
    if position(
      'extract(isodowfromscheduled_day.day)::smallint=any(array(selectunnest(term.open_weekdays)'
      in normalized_definition
    ) = 0 then
      raise exception 'Could not locate the scheduled-weekday check in publish_class_results';
    end if;
  else
    execute updated_definition;
  end if;

  select pg_get_functiondef(
    'public.save_result_drafts(uuid,uuid,uuid,text,text,jsonb,boolean,text)'::regprocedure
  ) into function_definition;

  updated_definition := regexp_replace(
    function_definition,
    'for row_data in\s+select row_data\.student_id, row_data\.subject_id, row_data\.ca_mark, row_data\.exam_mark\s+from jsonb_to_recordset\(p_rows\) as row_data\((\s*student_id uuid,\s*subject_id uuid,\s*ca_mark numeric,\s*exam_mark numeric\s*)\)',
    'for row_data in select submitted_result.student_id, submitted_result.subject_id, submitted_result.ca_mark, submitted_result.exam_mark from jsonb_to_recordset(p_rows) as submitted_result(\1)',
    'g'
  );

  if updated_definition = function_definition then
    normalized_definition := lower(regexp_replace(function_definition, '\s+', '', 'g'));
    if position(
      'forrow_datainselectsubmitted_result.student_id'
      in normalized_definition
    ) = 0 then
      raise exception 'Could not locate the result-validation loops in save_result_drafts';
    end if;
  else
    execute updated_definition;
  end if;
end
$$;
