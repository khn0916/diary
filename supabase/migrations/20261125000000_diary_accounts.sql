begin;

create schema if not exists yeobaek_private;
revoke all on schema yeobaek_private from public, anon, authenticated;

create table if not exists yeobaek_private.documents (
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('journal', 'plans', 'study')),
  version integer not null default 1 check (version > 0),
  content jsonb not null check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 5242880),
  primary key (owner_id, kind)
);
alter table yeobaek_private.documents enable row level security;
revoke all on yeobaek_private.documents from public, anon, authenticated;

create table if not exists yeobaek_private.password_changes (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  changed_at timestamptz not null
);
alter table yeobaek_private.password_changes enable row level security;
revoke all on yeobaek_private.password_changes from public, anon, authenticated;

create or replace function yeobaek_private.record_password_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into yeobaek_private.password_changes(owner_id, changed_at)
  values (new.id, clock_timestamp())
  on conflict (owner_id) do update set changed_at = excluded.changed_at;
  return new;
end
$$;
revoke all on function yeobaek_private.record_password_change() from public, anon, authenticated;
create or replace trigger yeobaek_password_change
after update of encrypted_password on auth.users for each row
when (old.encrypted_password is distinct from new.encrypted_password)
execute function yeobaek_private.record_password_change();

create or replace function yeobaek_private.require_session()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  session_claim text := auth.jwt() ->> 'session_id';
begin
  if actor is null or session_claim is null or
     session_claim !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then
    raise sqlstate 'PT401' using message = 'Valid session required';
  end if;
  if not exists (
    select 1 from auth.sessions s
    left join yeobaek_private.password_changes p on p.owner_id = s.user_id
    where s.id = session_claim::uuid and s.user_id = actor
      and s.created_at + interval '24 hours' > clock_timestamp()
      and (s.not_after is null or s.not_after > clock_timestamp())
      and (p.changed_at is null or s.created_at > p.changed_at)
  ) then
    raise sqlstate 'PT401' using message = 'Valid session required';
  end if;
  return actor;
end
$$;
revoke all on function yeobaek_private.require_session() from public, anon, authenticated;

create or replace function public.diary_documents(
  operation text, document_kind text default null, requested_owner uuid default null,
  expected_version integer default null, document_content jsonb default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := yeobaek_private.require_session();
  doc yeobaek_private.documents%rowtype;
begin
  if requested_owner is not null and requested_owner <> actor then
    raise sqlstate 'PT404' using message = 'Record not found';
  end if;

  if operation = 'list' then
    return coalesce((
      select jsonb_agg(jsonb_build_object('kind', d.kind, 'version', d.version, 'content', d.content) order by d.kind)
      from yeobaek_private.documents d where d.owner_id = actor
    ), '[]'::jsonb);
  end if;

  if document_kind is null or document_kind not in ('journal', 'plans', 'study') then
    raise sqlstate 'PT400' using message = 'Invalid document kind';
  end if;
  if operation = 'get' then
    select * into doc from yeobaek_private.documents
    where owner_id = actor and kind = document_kind;
    return jsonb_build_object('version', coalesce(doc.version, 0), 'content', doc.content);
  end if;

  if document_kind = 'study' then
    raise sqlstate 'PT403' using message = 'Record study days through the study form';
  end if;
  if expected_version is null or expected_version < 0 then
    raise sqlstate 'PT400' using message = 'Invalid document version';
  end if;

  if operation = 'put' then
    if jsonb_typeof(document_content) is distinct from 'object' or octet_length(document_content::text) > 5242880 then
      raise sqlstate 'PT400' using message = 'Invalid document content';
    end if;
    if expected_version = 0 then
      insert into yeobaek_private.documents(owner_id, kind, content)
      values (actor, document_kind, document_content)
      on conflict do nothing
      returning * into doc;
    else
      update yeobaek_private.documents set content = document_content, version = version + 1
      where owner_id = actor and kind = document_kind and version = expected_version
      returning * into doc;
    end if;
  elsif operation = 'delete' then
    -- Keep the version advancing even after a clear, to avoid reusing stale versions.
    update yeobaek_private.documents set content = '{}'::jsonb, version = version + 1
    where owner_id = actor and kind = document_kind and version = expected_version
    returning * into doc;
  else
    raise sqlstate 'PT400' using message = 'Invalid document operation';
  end if;

  if not found then
    raise sqlstate 'PT409' using message = 'Record version changed';
  end if;
  return jsonb_build_object('version', doc.version, 'content', doc.content);
end
$$;
revoke all on function public.diary_documents(text,text,uuid,integer,jsonb) from public, anon, authenticated;
grant execute on function public.diary_documents(text,text,uuid,integer,jsonb) to anon, authenticated;

create or replace function public.diary_study(operation text, details jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := yeobaek_private.require_session();
  moment timestamptz;
  today date;
  current_state jsonb;
  days jsonb;
  count_days integer;
  metric_value numeric;
  entry jsonb;
  plans_state jsonb;
  study_plan jsonb;
  sources jsonb;
  evidence text;
begin
  if jsonb_typeof(details) is distinct from 'object' or octet_length(details::text) > 16384 then
    raise sqlstate 'PT400' using message = 'Invalid study input';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 732));
  moment := clock_timestamp();
  today := (moment at time zone 'Asia/Seoul')::date;
  select content into current_state from yeobaek_private.documents where owner_id = actor and kind = 'study';

  if operation = 'start' then
    if current_state is not null then
      raise sqlstate 'PT409' using message = 'The study has already started';
    end if;
    if nullif(btrim(details->>'question'), '') is null or nullif(btrim(details->>'rule'), '') is null then
      raise sqlstate 'PT400' using message = 'Complete the question, metric, unit, calculation and rule';
    end if;
    if details->>'mode' = 'execution' then
      select p into study_plan
      from yeobaek_private.documents d
      cross join lateral jsonb_array_elements(d.content->'plans') p
      where d.owner_id = actor and d.kind = 'plans' and p->>'id' = details->>'plan_id' and p->>'deleted_at' is null;
      if study_plan is null then
        raise sqlstate 'PT400' using message = 'Select one of your active plans';
      end if;
      details := details || jsonb_build_object('metric', '실제 실행 시간', 'unit', '분',
        'calculation', '선택한 계획에서 서울 기준 당일에 시작한 유효 실행 기록의 실제 시간 합계');
    elsif nullif(btrim(details->>'metric'), '') is null or nullif(btrim(details->>'unit'), '') is null or
          nullif(btrim(details->>'calculation'), '') is null then
      raise sqlstate 'PT400' using message = 'Complete the metric, unit and calculation';
    end if;
    current_state := jsonb_build_object(
      'question', btrim(details->>'question'), 'metric', btrim(details->>'metric'),
      'unit', btrim(details->>'unit'), 'calculation', btrim(details->>'calculation'),
      'rule', btrim(details->>'rule'), 'configured_at', moment, 'days', '[]'::jsonb
    );
    if study_plan is not null then
      current_state := current_state || jsonb_build_object('plan_id', study_plan->'id', 'plan_title', study_plan->'title');
    end if;
    insert into yeobaek_private.documents(owner_id, kind, content) values (actor, 'study', current_state);
    return current_state;
  end if;

  if current_state is null then
    raise sqlstate 'PT409' using message = 'Set the study rules first';
  end if;
  days := current_state->'days';
  count_days := jsonb_array_length(days);

  if operation = 'change' then
    if count_days <> 2 or current_state ? 'change' then
      raise sqlstate 'PT409' using message = 'Change one rule after day 2 and before day 3';
    end if;
    if nullif(btrim(details->>'rule'), '') is null or nullif(btrim(details->>'reason'), '') is null
       or btrim(details->>'rule') = current_state->>'rule' then
      raise sqlstate 'PT400' using message = 'Enter a different rule and the reason';
    end if;
    entry := jsonb_build_object('rule', btrim(details->>'rule'), 'reason', btrim(details->>'reason'),
      'changed_at', moment, 'based_on', jsonb_build_array(days->0->>'date', days->1->>'date'));
    current_state := jsonb_set(current_state, '{change}', entry);
  elsif operation = 'record' then
    if count_days >= 5 or (count_days = 2 and not current_state ? 'change') then
      raise sqlstate 'PT409' using message = 'Check the five-day limit and the required rule change';
    end if;
    if count_days > 0 and today <= (days->(count_days-1)->>'date')::date then
      raise sqlstate 'PT409' using message = 'Use a different Seoul date for each entry';
    end if;
    evidence := nullif(btrim(details->>'evidence'), '');
    if current_state ? 'plan_id' then
      select content into plans_state from yeobaek_private.documents where owner_id = actor and kind = 'plans';
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', run->'id', 'task_id', task->'id', 'title', task->'title',
        'minutes', run->'actual_minutes') order by run->>'started_at', run->>'id'), '[]'::jsonb),
        sum((run->>'actual_minutes')::numeric)
      into sources, metric_value
      from jsonb_array_elements(plans_state->'plans') plan
      cross join lateral jsonb_array_elements(plans_state->'tasks') task
      join lateral jsonb_array_elements(plans_state->'executions') run on run->'task_id' = task->'id'
      where plan->'id' = current_state->'plan_id' and plan->>'deleted_at' is null
        and task->'plan_id' = plan->'id' and task->>'deleted_at' is null and run->>'deleted_at' is null
        and ((run->>'started_at')::timestamptz at time zone 'Asia/Seoul')::date = today;
      if metric_value is null and details->>'zero' = 'on' then
        if evidence is null then
          raise sqlstate 'PT400' using message = 'Explain why there was no activity';
        end if;
        metric_value := 0;
      end if;
    else
      if evidence is null or
         (details->>'value' is not null and (details->>'value') !~ '^[0-9]{1,9}(\.[0-9]{1,4})?$') then
        raise sqlstate 'PT400' using message = 'Enter evidence and a nonnegative value or mark it missing';
      end if;
      metric_value := (details->>'value')::numeric;
    end if;
    entry := jsonb_build_object('date', today, 'recorded_at', moment,
      'value', metric_value, 'evidence', coalesce(evidence, ''));
    if sources is not null then
      entry := entry || jsonb_build_object('sources', sources);
    end if;
    current_state := jsonb_set(current_state, '{days}', days || jsonb_build_array(entry));
  else
    raise sqlstate 'PT400' using message = 'Invalid study operation';
  end if;

  update yeobaek_private.documents set content = current_state, version = version + 1
  where owner_id = actor and kind = 'study';
  return current_state;
end
$$;
revoke all on function public.diary_study(text,jsonb) from public, anon, authenticated;
grant execute on function public.diary_study(text,jsonb) to anon, authenticated;

create or replace function public.diary_delete_account(confirmation text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := yeobaek_private.require_session();
begin
  if confirmation is distinct from 'DELETE' then
    raise sqlstate 'PT400' using message = 'Account deletion confirmation required';
  end if;
  delete from auth.users where id = actor;
end
$$;
revoke all on function public.diary_delete_account(text) from public, anon, authenticated;
grant execute on function public.diary_delete_account(text) to authenticated;

notify pgrst, 'reload schema';
commit;
