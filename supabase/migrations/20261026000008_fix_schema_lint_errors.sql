do $$
declare
  function_definition text;
  updated_definition text;
begin
  select pg_get_functiondef(
    'public.publish_class_results(uuid,uuid,uuid,jsonb)'::regprocedure
  ) into function_definition;

  updated_definition := replace(
    function_definition,
    'jsonb_object_length(p_teacher_comments) > 500',
    '(select count(*) from jsonb_object_keys(p_teacher_comments)) > 500'
  );

  if updated_definition = function_definition then
    if position('(select count(*) from jsonb_object_keys(p_teacher_comments)) > 500' in function_definition) = 0 then
      raise exception 'Could not locate the teacher-comment count check in publish_class_results';
    end if;
  else
    execute updated_definition;
  end if;

  select pg_get_functiondef(
    'public.save_result_drafts(uuid,uuid,uuid,text,text,jsonb,boolean,text)'::regprocedure
  ) into function_definition;

  updated_definition := regexp_replace(
    function_definition,
    'from jsonb_to_recordset\(p_rows\) as row_data\((\s*student_id uuid,\s*subject_id uuid,\s*ca_mark numeric,\s*exam_mark numeric\s*)\)\s*group by row_data\.student_id, row_data\.subject_id',
    'from jsonb_to_recordset(p_rows) as submitted_result(\1) group by submitted_result.student_id, submitted_result.subject_id'
  );

  if updated_definition = function_definition then
    if position('group by submitted_result.student_id, submitted_result.subject_id' in function_definition) = 0 then
      raise exception 'Could not locate the duplicate result-row check in save_result_drafts';
    end if;
  else
    execute updated_definition;
  end if;
end
$$;
