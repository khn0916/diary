// Run with a local @electric-sql/pglite module to verify the production SQL in an isolated database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require(process.env.DIARY_PGLITE || '@electric-sql/pglite');

async function main() {
  const db = new PGlite();
  const owners = ['a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002'];
  const sessions = ['10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002'];
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, encrypted_password text);
    create table auth.sessions (id uuid primary key, user_id uuid references auth.users on delete cascade, created_at timestamptz default now(), not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as
      $$ select (auth.jwt() ->> 'sub')::uuid $$;
    grant usage on schema auth to anon, authenticated;
  `);
  await db.exec(fs.readFileSync('supabase/migrations/20261125000000_diary_accounts.sql', 'utf8'));
  for (const [i, owner] of owners.entries()) {
    await db.query('insert into auth.users values ($1, $2)', [owner, 'mock-hash-' + i]);
    await db.query('insert into auth.sessions (id,user_id) values ($1,$2)', [sessions[i], owner]);
  }
  async function asUser(i) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(i == null ? {} : { sub: owners[i], session_id: sessions[i] })]);
    await db.exec(i == null ? 'set role anon' : 'set role authenticated');
  }
  const rpc = (operation, kind = null, owner = null, version = null, content = null) =>
    db.query('select public.diary_documents($1,$2,$3,$4,$5) as result', [operation,kind,owner,version,content]).then(r=>r.rows[0].result);
  const rejects = (request, code) => assert.rejects(request, error => error.code === code);
  await asUser(null);
  await rejects(rpc('get','journal'), 'PT401');
  for (const i of [0,1]) {
    await asUser(i);
    await rpc('put','journal',owners[i],0,{entries:{},notes:{record:'account '+i}});
  }
  for (const i of [0,1]) {
    await asUser(i);
    const before = await rpc('list');
    assert.equal(before.length,1);
    assert.equal(before[0].content.notes.record,'account '+i);
    assert.equal((await rpc('get','journal',owners[i])).version,1);
    for (const operation of ['list','get','put','delete']) {
      await rejects(rpc(operation,'journal',owners[1-i],1,{bad:true}), 'PT404');
    }
    await rejects(rpc('put','journal',owners[i],0,{bad:true}), 'PT409');
    await rejects(db.query('select * from yeobaek_private.documents'), '42501');
    assert.deepEqual(await rpc('list'), before);
  }
  await asUser(0);
  const study = (op, input) => db.query('select public.diary_study($1,$2) as result',[op,input]).then(r=>r.rows[0].result);
  await study('start',{question:'compare?',metric:'time',unit:'min',calculation:'sum',rule:'before'});
  await study('record',{value:5,evidence:'test fixture only'});
  await rejects(study('record',{value:8,evidence:'duplicate test'}),'PT409');
  await rejects(study('change',{rule:'after',reason:'too soon'}),'PT409');
  await rejects(rpc('put','study',owners[0],2,{days:[]}), 'PT403');

  const { rows: [dates] } = await db.query(`
    select ((now() at time zone 'Asia/Seoul')::date - 1)::text as yesterday,
      ((now() at time zone 'Asia/Seoul')::date - 2)::text as earlier,
      (now() at time zone 'Asia/Seoul')::date::text as today
  `);
  const execution = (id, taskId, date, minutes, deleted = false) => ({
    id, task_id: taskId, started_at: date + 'T00:05:00+09:00', actual_minutes: minutes,
    deleted_at: deleted ? date + 'T01:00:00+09:00' : null
  });
  await rpc('put', 'plans', owners[0], 0, { plans: [{ id: 7, title: 'Other owner only' }] });
  await asUser(1);
  const ownPlans = {
    plans: [{ id: 1, title: 'Study' }, { id: 2, title: 'Other plan' }],
    tasks: [{ id: 3, plan_id: 1, title: 'Read' }, { id: 4, plan_id: 2 }, { id: 5, plan_id: 1, deleted_at: dates.today }],
    executions: [
      execution(10, 3, dates.today, 15), execution(11, 3, dates.today, 25),
      execution(12, 3, dates.yesterday, 100), execution(13, 4, dates.today, 100),
      execution(14, 3, dates.today, 100, true), execution(15, 5, dates.today, 100)
    ]
  };
  await rpc('put', 'plans', owners[1], 0, ownPlans);
  const setup = { mode: 'execution', question: 'compare?', rule: 'before' };
  await rejects(study('start', { ...setup, plan_id: 7 }), 'PT400');
  const linked = await study('start', { ...setup, plan_id: 1, metric: 'ignored' });
  assert.equal(linked.metric, '실제 실행 시간');
  assert.equal(linked.unit, '분');
  const first = (await study('record', { value: 999 })).days[0];
  assert.equal(first.date, dates.today);
  assert.equal(first.value, 40);
  assert.deepEqual(first.sources.map(source => [source.id, source.title, source.minutes]),
    [[10, 'Read', 15], [11, 'Read', 25]]);
  await rpc('put', 'plans', owners[1], 1, { ...ownPlans, executions: [] });
  assert.deepEqual((await rpc('get', 'study')).content.days[0], first);
  await db.exec('reset role');
  await db.query("update yeobaek_private.documents set content = jsonb_set(content, '{days,0,date}', to_jsonb($2::text)) where owner_id = $1 and kind = 'study'", [owners[1], dates.earlier]);
  await asUser(1);
  const second = (await study('record', {})).days[1];
  assert.equal(second.value, null);
  assert.deepEqual(second.sources, []);
  await db.exec('reset role');
  await db.query("update yeobaek_private.documents set content = jsonb_set(content, '{days,1,date}', to_jsonb($2::text)) where owner_id = $1 and kind = 'study'", [owners[1], dates.yesterday]);
  await asUser(1);
  await rejects(study('record', {}), 'PT409');
  const changed = await study('change', { rule: 'after', reason: 'fixture comparison' });
  assert.deepEqual(changed.change.based_on, [dates.earlier, dates.yesterday]);
  await rejects(study('record', { zero: 'on' }), 'PT400');
  assert.equal((await study('record', { zero: 'on', evidence: 'No activity' })).days[2].value, 0);

  await db.exec('reset role');
  await db.query('delete from auth.sessions where id=$1',[sessions[0]]);
  await asUser(0);
  await rejects(rpc('list'), 'PT401');
  await db.exec('reset role');
  await db.query("update auth.users set encrypted_password='new-mock-hash' where id=$1",[owners[1]]);
  await asUser(1);
  await rejects(rpc('list'), 'PT401');
  await db.exec('reset role');
  await db.query('update auth.sessions set created_at=clock_timestamp() where id=$1',[sessions[1]]);
  await asUser(1);
  await rejects(db.query("select public.diary_delete_account('no')"), 'PT400');
  await db.query("select public.diary_delete_account('DELETE')");
  await rejects(rpc('list'),'PT401');
  await db.exec('reset role');
  assert.deepEqual((await db.query('select distinct owner_id from yeobaek_private.documents')).rows,[{owner_id:owners[0]}]);
  await db.close();
  console.log('PASS: SQL account scope, session denial, CAS, execution evidence, study order and account cascade.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
