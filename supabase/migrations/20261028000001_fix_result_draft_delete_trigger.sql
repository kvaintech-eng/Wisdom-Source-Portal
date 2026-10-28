create or replace function public.protect_published_result()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'published' then
    raise exception 'Published results are immutable; create an audited revision';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end
$$;
