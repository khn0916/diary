/* Shared, testable model for the static GitHub Pages application. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PDSModel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const FORMAT = 'yeobaek-pds-browser-v1';
  const planColors = Object.freeze({ cream: '크림', sky: '하늘', sage: '세이지', rose: '로즈' });
  const lists = ['plans', 'versions', 'tasks', 'executions', 'reviews', 'completions'];
  const clone = value => JSON.parse(JSON.stringify(value));
  function empty() { return { format: FORMAT, sequence: 0, plans: [], versions: [], tasks: [], executions: [], reviews: [], completions: [] }; }
  function fail(message) { throw new Error(message); }
  function text(data, key, max = 2000, required = true) {
    const value = String(data[key] ?? '').trim();
    if ((required && !value) || value.length > max) fail(`${key}: 필수 항목과 최대 ${max}자를 확인해주세요.`);
    return value;
  }
  function integer(value, min = 0, max = 1000000) {
    if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) fail(`숫자는 ${min}~${max} 사이의 정수로 입력해주세요.`);
    return Number(value);
  }
  function date(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) fail('날짜를 YYYY-MM-DD 형식으로 확인해주세요.');
    return value;
  }
  function period(data, from = 'start_date', to = 'end_date') {
    const start = date(data[from]), end = date(data[to]);
    if (start > end) fail('종료일은 시작일 이후여야 합니다.');
    return [start, end];
  }
  function localTime(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value))) fail('시각을 서울 시간 기준 분 단위로 입력해주세요.');
    const ms = Date.parse(value + '+09:00');
    if (!Number.isFinite(ms) || new Date(ms + 9 * 3600000).toISOString().slice(0, 16) !== value) fail('올바른 시작·종료 시각을 입력해주세요.');
    return new Date(ms).toISOString();
  }
  function today(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type).value).join('-');
  }
  function find(state, kind, id) {
    const value = state[kind].find(row => row.id === Number(id) && !row.deleted_at);
    if (!value) fail('기록이 없거나 삭제되었습니다. 목록을 다시 확인해주세요.');
    if (kind === 'tasks') find(state, 'plans', value.plan_id);
    return value;
  }
  function nextId(state) { if (state.sequence >= Number.MAX_SAFE_INTEGER) fail('새 기록 ID를 생성할 수 없습니다. 백업 후 저장소를 확인해주세요.'); return ++state.sequence; }
  function snapshot(state, plan, now) {
    state.versions.push({ id: nextId(state), plan_id: plan.id, version: state.versions.filter(v => v.plan_id === plan.id).length + 1, snapshot: clone(plan), created_at: now });
  }
  function planRevision(state, id) {
    return state.versions.reduce((latest, version) => version.plan_id === id ? Math.max(latest, version.id) : latest, 0);
  }
  function planValues(data) {
    const [start_date, end_date] = period(data);
    const color = data.color ?? 'cream';
    if (!Object.hasOwn(planColors, color)) fail('메모지 색을 선택해주세요.');
    return { title: text(data, 'title', 200), start_date, end_date, color, priority: integer(data.priority, 1, 3), success_criteria: text(data, 'success_criteria', 2000, false), estimated_minutes: integer(data.estimated_minutes ?? 0), tags: text(data, 'tags', 300, false) };
  }
  function apply(original, command, now = new Date().toISOString()) {
    const state = clone(original), d = command.data || {};
    let id, observedExecutionId;
    if (command.type === 'plan.save') {
      let plan;
      if (d.id) {
        plan = find(state, 'plans', d.id);
        if (d.expected_revision != null && integer(d.expected_revision, 1, Number.MAX_SAFE_INTEGER) !== planRevision(state, plan.id)) {
          fail('다른 탭에서 이 계획을 먼저 수정했어요. 입력 내용을 복사한 뒤 새로고침해서 최신 내용을 확인해주세요.');
        }
        Object.assign(plan, planValues({ ...plan, ...d }), { updated_at: now });
      } else {
        plan = { id: nextId(state), ...planValues(d), source_review_id: null, improvement: '', created_at: now, updated_at: now, deleted_at: null };
        state.plans.push(plan);
      }
      snapshot(state, plan, now); id = plan.id;
    } else if (command.type === 'plan.start') {
      const plan = find(state, 'plans', d.id);
      if (plan.completion) fail('이미 완료한 계획이에요.');
      plan.execution_started_at ??= now;
      id = plan.id;
    } else if (command.type === 'plan.complete') {
      const plan = find(state, 'plans', d.id);
      if (!plan.completion) {
        if (plan.execution_started_at) {
          const start = Date.parse(plan.execution_started_at), end = Date.parse(now);
          if (end < start) fail('작업 시작보다 종료 시각이 빨라요. 기기의 날짜와 시간을 확인해주세요.');
          const startMinute = Math.floor(start / 60000), endMinute = Math.floor(end / 60000);
          const taskId = nextId(state);
          state.tasks.push({ id: taskId, plan_id: plan.id, title: plan.title, due_date: plan.end_date,
            priority: plan.priority, tags: plan.tags, estimated_minutes: plan.estimated_minutes,
            completed: true, created_at: now, updated_at: now, deleted_at: null });
          state.completions.push({ task_id: taskId, completed_at: now });
          observedExecutionId = nextId(state);
          state.executions.push({ id: observedExecutionId, task_id: taskId,
            started_at: new Date(startMinute * 60000).toISOString(), ended_at: new Date(endMinute * 60000).toISOString(),
            actual_minutes: integer(endMinute - startMinute), blocked_reason: '', idempotency_key: `plan-completion-${plan.id}`,
            created_at: now, updated_at: now, deleted_at: null });
          delete plan.execution_started_at;
        }
        plan.completion = { date: today(new Date(now)), stamp: Math.floor(Math.random() * 3) + 1 };
        plan.updated_at = now;
      }
      id = plan.id;
    } else if (command.type === 'task.save') {
      const plan = find(state, 'plans', d.plan_id);
      const values = { title: text(d, 'title', 200), due_date: date(d.due_date), priority: integer(d.priority, 1, 3), tags: text(d, 'tags', 300, false), estimated_minutes: integer(d.estimated_minutes) };
      if (d.id) {
        const task = find(state, 'tasks', d.id);
        if (task.plan_id !== plan.id) fail('할 일의 계획 연결은 변경할 수 없습니다.');
        Object.assign(task, values, { updated_at: now }); id = task.id;
      } else {
        id = nextId(state);
        state.tasks.push({ id, plan_id: plan.id, ...values, completed: false, created_at: now, updated_at: now, deleted_at: null });
      }
    } else if (command.type === 'task.complete') {
      const task = find(state, 'tasks', d.task_id);
      if (![true, false, '1', '0'].includes(d.completed)) fail('완료 상태를 확인해주세요.');
      task.completed = d.completed === true || d.completed === '1'; task.updated_at = now;
      if (task.completed && !state.completions.some(c => c.task_id === task.id)) state.completions.push({ task_id: task.id, completed_at: now });
      if (!task.completed) state.completions = state.completions.filter(c => c.task_id !== task.id);
      id = task.id;
    } else if (command.type === 'execution.save') {
      const task = find(state, 'tasks', d.task_id);
      const started_at = localTime(d.started_at), ended_at = localTime(d.ended_at);
      if (ended_at < started_at) fail('종료 시각은 시작 시각 이후여야 합니다.');
      const actual_minutes = integer((Date.parse(ended_at) - Date.parse(started_at)) / 60000);
      const values = { started_at, ended_at, actual_minutes, blocked_reason: text(d, 'blocked_reason', 2000, false), updated_at: now };
      if (d.id) {
        const record = find(state, 'executions', d.id);
        if (record.task_id !== task.id) fail('실행 기록의 할 일 연결을 확인해주세요.');
        Object.assign(record, values); id = record.id;
      } else {
        const key = text(d, 'idempotency_key', 80);
        if (!/^[0-9a-f-]{36}$/i.test(key)) fail('저장 요청을 확인할 수 없습니다. 화면을 다시 열어주세요.');
        const prior = state.executions.find(r => r.idempotency_key === key);
        if (prior) {
          if (prior.task_id !== task.id) fail('다른 할 일에서 사용한 저장 요청입니다.');
          id = prior.id;
        } else {
          id = nextId(state); state.executions.push({ id, task_id: task.id, ...values, idempotency_key: key, created_at: now, deleted_at: null });
        }
      }
    } else if (command.type === 'review.save') {
      const plan = find(state, 'plans', d.plan_id);
      const [from_date, to_date] = period(d, 'from_date', 'to_date');
      const values = { from_date, to_date, reflection: text(d, 'reflection'), improvement: text(d, 'improvement'), updated_at: now };
      if (d.id) {
        const review = find(state, 'reviews', d.id);
        if (review.plan_id !== plan.id) fail('회고의 계획 연결을 확인해주세요.');
        Object.assign(review, values); id = review.id;
      } else {
        id = nextId(state); state.reviews.push({ id, plan_id: plan.id, ...values, created_at: now, deleted_at: null });
      }
    } else if (command.type === 'plan.next') {
      const review = find(state, 'reviews', d.review_id), previous = find(state, 'plans', review.plan_id);
      const prior = state.plans.find(p => p.source_review_id === review.id);
      if (prior) { if (prior.deleted_at) fail('이 회고로 만든 다음 계획은 삭제되었습니다. 새 계획을 등록해주세요.'); id = prior.id; }
      else {
        const [start_date, end_date] = period(d);
        const plan = { id: nextId(state), title: text(d, 'title', 200), start_date, end_date, color: previous.color ?? 'cream', priority: previous.priority, success_criteria: previous.success_criteria, estimated_minutes: previous.estimated_minutes, tags: '', source_review_id: review.id, improvement: review.improvement, created_at: now, updated_at: now, deleted_at: null };
        state.plans.push(plan); snapshot(state, plan, now); id = plan.id;
      }
    } else if (command.type === 'delete') {
      const kinds = { plan: 'plans', task: 'tasks', execution: 'executions', review: 'reviews' };
      if (!kinds[d.kind]) fail('삭제할 기록 종류를 확인해주세요.');
      const record = find(state, kinds[d.kind], d.id);
      record.deleted_at = now; record.updated_at = now; id = record.id;
    } else fail('지원하지 않는 작업입니다.');
    return observedExecutionId === undefined ? { state, id } : { state, id, observedExecutionId };
  }
  function tasks(state, planId, from = '', to = '') {
    find(state, 'plans', planId);
    if (from) date(from); if (to) date(to);
    if (from && to && from > to) fail('조회 종료일은 시작일 이후여야 합니다.');
    return state.tasks.filter(t => t.plan_id === Number(planId) && !t.deleted_at && (!from || t.due_date >= from) && (!to || t.due_date <= to)).map(t => {
      const records = state.executions.filter(r => r.task_id === t.id && !r.deleted_at);
      return { ...t, actual_minutes: records.reduce((n, r) => n + r.actual_minutes, 0), blocked: records.some(r => r.blocked_reason.trim()) };
    });
  }
  function summary(state, planId, from = '', to = '', currentDay = today()) {
    const all = tasks(state, planId, from, to);
    const groups = { planned: all, completed: all.filter(t => t.completed), delayed: all.filter(t => !t.completed && t.due_date < currentDay), blocked: all.filter(t => t.blocked) };
    const values = Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, rows.length]));
    values.estimated = all.reduce((n, t) => n + t.estimated_minutes, 0);
    values.actual = all.reduce((n, t) => n + t.actual_minutes, 0);
    values.difference = values.actual - values.estimated;
    return { values, groups };
  }
  function validate(candidate) {
    if (!candidate || candidate.format !== FORMAT || !Number.isSafeInteger(candidate.sequence) || candidate.sequence < 0) fail('이 앱에서 내보낸 백업 파일인지 확인해주세요.');
    const state = empty(); state.sequence = candidate.sequence;
    const timestamp = value => { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail('백업 시각 형식을 확인해주세요.'); return value; };
    const base = row => ({ id: integer(row.id, 1, Number.MAX_SAFE_INTEGER), created_at: timestamp(row.created_at), updated_at: timestamp(row.updated_at), deleted_at: row.deleted_at ? timestamp(row.deleted_at) : null });
    const completion = row => row.completion == null ? {} : {
      completion: { date: date(row.completion.date), stamp: integer(row.completion.stamp, 1, 3) }
    };
    for (const kind of lists) if (!Array.isArray(candidate[kind]) || candidate[kind].length > 50000) fail('백업의 데이터 구조 또는 크기를 확인해주세요.');
    state.plans = candidate.plans.map(p => ({ ...base(p), ...planValues(p), ...completion(p), source_review_id: p.source_review_id == null ? null : integer(p.source_review_id, 1, Number.MAX_SAFE_INTEGER), improvement: text(p, 'improvement', 2000, false) }));
    for (const [index, plan] of state.plans.entries()) {
      const started = candidate.plans[index].execution_started_at;
      if (started != null && !plan.completion) plan.execution_started_at = timestamp(started);
    }
    state.tasks = candidate.tasks.map(t => { if (typeof t.completed !== 'boolean') fail('완료 상태가 올바르지 않습니다.'); return { ...base(t), plan_id: integer(t.plan_id, 1, Number.MAX_SAFE_INTEGER), title: text(t, 'title', 200), due_date: date(t.due_date), priority: integer(t.priority, 1, 3), tags: text(t, 'tags', 300, false), estimated_minutes: integer(t.estimated_minutes), completed: t.completed }; });
    state.executions = candidate.executions.map(r => {
      const started_at = timestamp(r.started_at), ended_at = timestamp(r.ended_at), minutes = (Date.parse(ended_at) - Date.parse(started_at)) / 60000;
      if (integer(r.actual_minutes) !== minutes) fail('실행 기록의 시작·종료·소요 시간이 일치하지 않습니다.');
      return { ...base(r), task_id: integer(r.task_id, 1, Number.MAX_SAFE_INTEGER), started_at, ended_at, actual_minutes: minutes, blocked_reason: text(r, 'blocked_reason', 2000, false), idempotency_key: text(r, 'idempotency_key', 80) };
    });
    state.reviews = candidate.reviews.map(r => { const [from_date, to_date] = period(r, 'from_date', 'to_date'); return { ...base(r), plan_id: integer(r.plan_id, 1, Number.MAX_SAFE_INTEGER), from_date, to_date, reflection: text(r, 'reflection'), improvement: text(r, 'improvement') }; });
    state.versions = candidate.versions.map(v => {
      if (!v.snapshot || v.snapshot.id !== v.plan_id) fail('계획 이력의 연결이 올바르지 않습니다.');
      const parent = state.plans.find(p => p.id === v.plan_id);
      if (!parent) fail('계획 이력의 원래 계획이 없습니다.');
      const snapshot = { ...base(v.snapshot), ...planValues(v.snapshot), ...completion(v.snapshot), source_review_id: parent.source_review_id, improvement: text(v.snapshot, 'improvement', 2000, false) };
      return { id: integer(v.id, 1, Number.MAX_SAFE_INTEGER), plan_id: v.plan_id, version: integer(v.version, 1), snapshot, created_at: timestamp(v.created_at) };
    });
    state.completions = candidate.completions.map(c => ({ task_id: integer(c.task_id, 1, Number.MAX_SAFE_INTEGER), completed_at: timestamp(c.completed_at) }));
    const ids = lists.filter(k => k !== 'completions').flatMap(k => state[k].map(r => r.id));
    if (new Set(ids).size !== ids.length || ids.some(id => id > state.sequence)) fail('백업 ID가 중복되거나 순서가 올바르지 않습니다.');
    const exists = (kind, id) => state[kind].some(r => r.id === id);
    for (const t of state.tasks) if (!exists('plans', t.plan_id)) fail('할 일의 연결 계획이 없습니다.');
    for (const r of state.executions) if (!exists('tasks', r.task_id)) fail('실행 기록의 연결 할 일이 없습니다.');
    for (const r of state.reviews) if (!exists('plans', r.plan_id)) fail('회고의 연결 계획이 없습니다.');
    for (const p of state.plans) if (p.source_review_id && !exists('reviews', p.source_review_id)) fail('다음 계획의 원래 회고가 없습니다.');
    const unique = (rows, key) => new Set(rows.map(key)).size === rows.length;
    if (!unique(state.completions, c => c.task_id) || !unique(state.executions, r => r.idempotency_key) || !unique(state.versions, v => `${v.plan_id}:${v.version}`) || !unique(state.plans.filter(p => p.source_review_id), p => p.source_review_id)) fail('중복 완료·실행·계획 이력이 있습니다.');
    for (const c of state.completions) if (!exists('tasks', c.task_id) || !state.tasks.find(t => t.id === c.task_id).completed) fail('완료 기록과 할 일 상태가 일치하지 않습니다.');
    for (const t of state.tasks) if (t.completed !== state.completions.some(c => c.task_id === t.id)) fail('완료 기록이 누락되었습니다.');
    for (const p of state.plans) {
      const versions = state.versions.filter(v => v.plan_id === p.id).sort((a, b) => a.version - b.version);
      if (!versions.length || versions.some((v, index) => v.version !== index + 1)) fail('최초 계획 또는 수정 이력이 누락되었습니다.');
    }
    return state;
  }
  return { FORMAT, planColors, empty, apply, validate, find, planRevision, tasks, summary, today, date, localTime };
});
