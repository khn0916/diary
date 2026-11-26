begin;

create or replace function public.diary_save_observed_plan(
  expected_version integer, document_content jsonb, execution_id bigint default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := yeobaek_private.require_session();
  observed_at timestamptz;
  observed_day date;
  plan_id jsonb;
  plan_title jsonb;
  study jsonb;
  days jsonb;
  count_days integer;
  last_day jsonb;
  same_day boolean;
  sources jsonb;
  total_minutes numeric;
  has_saved_run boolean;
  entry jsonb;
  min_start timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 732));
  observed_at := clock_timestamp();
  observed_day := (observed_at at time zone 'Asia/Seoul')::date;
  perform public.diary_documents('put', 'plans', actor, expected_version, document_content);

  select content into study from yeobaek_private.documents where owner_id = actor and kind = 'study';
  days := coalesce(study->'days', '[]'::jsonb);
  count_days := jsonb_array_length(days);
  last_day := days->(count_days - 1);
  same_day := coalesce((last_day->>'date')::date = observed_day, false);

  if study is null then
    select plan->'id', plan->'title' into plan_id, plan_title
    from jsonb_array_elements(document_content->'plans') plan
    join jsonb_array_elements(document_content->'tasks') task on task->'plan_id' = plan->'id'
    join jsonb_array_elements(document_content->'executions') run on run->'task_id' = task->'id'
    where run->>'id' = execution_id::text and run->>'deleted_at' is null
      and task->>'deleted_at' is null and plan->>'deleted_at' is null;
    if plan_id is null then return null; end if;
  else
    plan_id := study->'plan_id';
    if plan_id is null or (not same_day and count_days >= 5) or
       (same_day and count_days = 2 and study ? 'change') then return study; end if;
    if count_days >= 2 and (not same_day or count_days > 2) then
      if not study ? 'change' then return study; end if;
      min_start := date_trunc('minute', (study->'change'->>'changed_at')::timestamptz);
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', run->'id', 'task_id', task->'id', 'title', task->'title', 'minutes', run->'actual_minutes'
    ) order by run->>'started_at', run->>'id'), '[]'::jsonb),
    sum((run->>'actual_minutes')::numeric),
    coalesce(bool_or(run->>'id' = execution_id::text), false)
  into sources, total_minutes, has_saved_run
  from jsonb_array_elements(document_content->'plans') plan
  join jsonb_array_elements(document_content->'tasks') task on task->'plan_id' = plan->'id'
  join jsonb_array_elements(document_content->'executions') run on run->'task_id' = task->'id'
  where plan->'id' = plan_id and plan->>'deleted_at' is null and task->>'deleted_at' is null
    and run->>'deleted_at' is null
    and ((run->>'started_at')::timestamptz at time zone 'Asia/Seoul')::date = observed_day
    and (run->>'ended_at')::timestamptz <= observed_at
    and (min_start is null or (run->>'started_at')::timestamptz >= min_start);

  if not same_day and (not has_saved_run or (last_day->>'date')::date > observed_day) then return study; end if;
  if study is null then
    study := jsonb_build_object(
      'question', '과제를 시작하기 전에 첫 할 일을 한 줄로 적으면 하루 실제 작업 시간이 늘어날까?',
      'metric', '실제 과제 작업 시간', 'unit', '분',
      'calculation', '선택한 계획에서 서울 기준 당일에 시작한 실제 작업 시간의 합계',
      'rule', '평소 방식대로 과제를 시작하고, 시작 전에 첫 할 일을 한 줄로 정하는 절차를 추가하지 않는다.',
      'configured_at', observed_at, 'plan_id', plan_id, 'plan_title', plan_title
    );
  end if;
  -- Leave an explicitly recorded zero intact if no executions exist for that date.
  if same_day and total_minutes is null and last_day->'value' = '0'::jsonb
     and last_day->'sources' = '[]'::jsonb then return study; end if;
  entry := jsonb_build_object('date', observed_day, 'value', total_minutes, 'sources', sources);
  if same_day then
    if last_day->'value' = entry->'value' and last_day->'sources' = sources then return study; end if;
    days := jsonb_set(days, array[(count_days - 1)::text], last_day || entry);
  else
    days := days || jsonb_build_array(entry || jsonb_build_object('recorded_at', observed_at));
  end if;
  study := jsonb_set(study, '{days}', days);
  insert into yeobaek_private.documents(owner_id, kind, content) values (actor, 'study', study)
  on conflict (owner_id, kind) do update
  set content = excluded.content, version = yeobaek_private.documents.version + 1;
  return study;
end
$$;
revoke all on function public.diary_save_observed_plan(integer,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.diary_save_observed_plan(integer,jsonb,bigint) to authenticated;

notify pgrst, 'reload schema';
commit;
