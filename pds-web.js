(function () {
  'use strict';
  const M = PDSModel, storage = PDSStorage;
  const app = document.getElementById('pdsApp'), status = document.getElementById('appStatus');
  const priorities = { 1: '높음', 2: '보통', 3: '낮음' };
  const metrics = { planned: '계획 수', completed: '완료 수', delayed: '지연 수', blocked: '막힘 수', estimated: '예상 시간', actual: '실제 시간', difference: '실제 − 예상' };
  const sorts = { due: '마감일 빠른 순 · ID 순', priority: '우선순위 높은 순 · 마감일 · ID 순', created: '등록 최신 순 · ID 역순', estimate: '예상 시간 짧은 순 · ID 순' };
  let state = M.empty(), loaded = false, refreshSerial = 0;
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const query = () => Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
  const url = values => '#' + new URLSearchParams(Object.entries(values).filter(([, v]) => v !== '' && v != null));
  const hidden = (name, value) => `<input type="hidden" name="${e(name)}" value="${e(value)}">`;
  function field(label, name, value = '', type = 'text', required = true, extra = '') {
    const attrs = required ? ' required' : '';
    const control = type === 'textarea' ? `<textarea name="${e(name)}" maxlength="2000"${attrs}>${e(value)}</textarea>` : `<input name="${e(name)}" type="${e(type)}" value="${e(value)}"${attrs} ${extra}>`;
    return `<label class="pds-field"><span>${e(label)}</span>${control}</label>`;
  }
  const options = (name, items, selected, label) => `<label class="pds-field"><span>${e(label)}</span><select name="${e(name)}">${Object.entries(items).map(([value, text]) => `<option value="${e(value)}"${String(value) === String(selected) ? ' selected' : ''}>${e(text)}</option>`).join('')}</select></label>`;
  const form = (action, content, button) => `<form class="pds-form" data-action="${e(action)}">${content}<button class="pds-button">${e(button)}</button></form>`;
  const row = content => `<div class="pds-row">${content}</div>`;
  function planBasics(p = {}) {
    return field('계획 이름', 'title', p.title, 'text', true, 'maxlength="200"') +
      row(field('시작일', 'start_date', p.start_date || M.today(), 'date') + field('종료일', 'end_date', p.end_date || M.today(), 'date')) +
      options('priority', priorities, p.priority || 2, '우선순위');
  }
  function colorPicker(selected = 'cream') {
    return `<fieldset class="plan-colors"><legend>메모지 색</legend>${Object.entries(M.planColors).map(([color, name]) =>
      `<label class="plan-paper" data-color="${color}"><input type="radio" name="color" value="${color}"${color === selected ? ' checked' : ''}><span>${name}</span></label>`
    ).join('')}</fieldset>`;
  }
  function planEditIdentity(plan) {
    return hidden('id', plan.id) + hidden('expected_revision', M.planRevision(state, plan.id));
  }
  function planFields(p) {
    return planEditIdentity(p) + planBasics(p) + colorPicker(p.color) +
      field('계획 전체 예상 시간 (분)', 'estimated_minutes', p.estimated_minutes, 'number', true, 'min="0" max="1000000"') +
      field('성공 기준', 'success_criteria', p.success_criteria, 'textarea', false);
  }
  const splitTags = value => [...new Set((value || '').split(/[#,\s]+/).filter(Boolean))];
  const tagChips = tags => tags.map(tag =>
    `<button type="button" class="plan-tag" data-remove-tag="${e(tag)}" aria-label="${e(tag)} 태그 삭제">#${e(tag)} <span aria-hidden="true">×</span></button>`
  ).join('');
  function tagField(plan = {}) {
    const tags = splitTags(plan.tags);
    return `<div class="plan-tag-field">${hidden('tags', tags.join(' '))}
      ${field('해시태그', 'tag_draft', '', 'text', false, 'maxlength="300" placeholder="#공부 #여행 · 엔터로 태그를 남겨보세요"')}
      <div class="plan-tag-list" aria-live="polite">${tagChips(tags)}</div>
      <p class="plan-tag-error" role="alert"></p>
    </div>`;
  }
  function updateTags(tagField, tags) {
    const value = tags.join(' ');
    tagField.querySelector('.plan-tag-error').textContent = value.length > 300 ? '해시태그는 모두 합쳐 300자까지 추가할 수 있어요.' : '';
    if (value.length > 300) return false;
    tagField.querySelector('[name="tags"]').value = value;
    tagField.querySelector('.plan-tag-list').innerHTML = tagChips(tags);
    return true;
  }
  function commitTagDraft(tagField) {
    const draft = tagField.querySelector('[name="tag_draft"]');
    const saved = tagField.querySelector('[name="tags"]').value;
    if (!updateTags(tagField, splitTags(saved + ' ' + draft.value))) return false;
    draft.value = '';
    return true;
  }
  function taskFields(plan, t = {}) {
    return hidden('id', t.id || '') + hidden('plan_id', plan) + field('할 일', 'title', t.title, 'text', true, 'maxlength="200"') +
      row(field('마감일', 'due_date', t.due_date || M.today(), 'date') + options('priority', priorities, t.priority || 2, '우선순위')) +
      row(field('태그 (쉼표로 구분)', 'tags', t.tags, 'text', false, 'maxlength="300"') + field('예상 시간 (분)', 'estimated_minutes', t.estimated_minutes ?? 0, 'number', true, 'min="0" max="1000000"'));
  }
  function localDate(value, input = false) {
    if (!value) return '';
    const iso = new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 16);
    return input ? iso : iso.replace('T', ' ');
  }
  function executionFields(task, r = {}) {
    return hidden('id', r.id || '') + hidden('task_id', task) + hidden('idempotency_key', crypto.randomUUID()) +
      row(field('시작 시각 (서울)', 'started_at', localDate(r.started_at, true), 'datetime-local') + field('종료 시각 (서울)', 'ended_at', localDate(r.ended_at, true), 'datetime-local')) +
      field('막힘 사유 (없으면 비워두세요)', 'blocked_reason', r.blocked_reason, 'textarea', false) + '<p class="subtle">실제 소요 시간은 시작·종료 시각 차이를 분으로 계산합니다. 원래 예상 시간은 변경되지 않습니다.</p>';
  }
  function reviewFields(plan, r = {}) {
    return hidden('id', r.id || '') + hidden('plan_id', plan.id) + row(field('회고 시작', 'from_date', r.from_date || plan.start_date, 'date') + field('회고 종료', 'to_date', r.to_date || plan.end_date, 'date')) +
      field('예상과 실제의 차이에서 배운 점', 'reflection', r.reflection, 'textarea') + field('다음 계획에 반영할 개선점 한 줄', 'improvement', r.improvement, 'textarea');
  }
  function deletion(kind, id, plan, task = '') {
    return form('delete', hidden('kind', kind) + hidden('id', id) + hidden('plan', plan) + hidden('task', task) + '<label class="delete-confirm"><input name="confirm" type="checkbox" required> 삭제 확인</label>', '삭제');
  }
  function heading(title, action = '') {
    return `<header class="pds-heading"><span class="eyebrow">PLAN · DO · SEE</span><h1>${e(title)}</h1><div class="pds-heading-row"><p>계획을 세우고, 하루를 실행하고, 다음 페이지에 배움을 남겨요.</p>${action}</div></header>`;
  }
  function planComposer() {
    return `<dialog id="planComposer" class="plan-composer plan-paper" data-color="cream" aria-labelledby="planComposerTitle">
      <h2 id="planComposerTitle">새 계획 등록</h2>
      <form data-action="plan.save" class="pds-form">
        ${planBasics()}${colorPicker()}${tagField()}
        <p class="plan-form-error" role="alert"></p>
        <div class="plan-form-actions"><button type="button" data-close-plan>취소</button><button class="pds-button" type="submit">추가하기</button></div>
      </form>
    </dialog>`;
  }
  function planBoard(plans) {
    const header = heading('나의 계획 메모', '<button type="button" class="pds-button" data-open-plan>+ 새 계획 등록</button>');
    const notes = plans.map(plan => `<button type="button" class="plan-note plan-paper" data-color="${plan.color}" data-view-plan="${plan.id}" aria-haspopup="dialog">
      <strong>${e(plan.title)}</strong><span>${e(plan.start_date)} – ${e(plan.end_date)}</span><small>우선순위 ${priorities[plan.priority]}</small>
      ${boardStamp(plan.completion)}
    </button>`).join('');
    return header + planComposer() + '<dialog id="planMemo" class="plan-memo plan-paper" aria-labelledby="planMemoTitle"></dialog>' + (notes
      ? `<section class="plan-board" aria-label="계획 메모지">${notes}</section>`
      : '<div class="empty-state"><img class="rabbit-emblem" src="../assets/rabbit-flowers.svg?v=5" alt="" width="160" height="180"><h2>첫 계획을 기다리고 있어요.</h2></div>');
  }
  const rabbitStamps = [
    '<path d="M36 47c-7-5-12-15-9-19 4-4 10 2 14 10-3-10-1-17 3-16 5 0 8 11 9 18 13 2 18 14 10 22-2 1-3 3-3 5 1 12-7 20-19 19-13 0-22-8-22-18 0-12 9-21 21-21 7 0 13 3 17 8"/><path d="M41 85c-6 0-9-5-6-9 4-5 9-2 10 2 1 3-1 6-4 7Z"/><circle cx="57" cy="47" r="2" fill="currentColor" stroke="none"/>',
    '<path d="M39 75c-8-7-10-18-6-29 1-3 2-6-1-9-7-7-1-17 8-18 7-2 14 3 19 9 9 4 18 12 15 17-3 4-10-1-16-5 5 7 10 16 13 25m-31 9c-6-3-7-12-3-13 4-1 6 6 3 11 2 4 5 8 9 10-9 2-7 8-1 8 11 0 21-3 27-7"/><path d="M71 72c0-5 5-8 9-5 8 5 3 18-5 16M45 39c2 9 8 16 11 14 3-2-2-10-5-14"/><circle cx="38" cy="29" r="2" fill="currentColor" stroke="none"/>',
    '<path d="M22 65c1-5 5-10 9-13-2-9-1-22 4-26 6-3 10 10 7 21 5-6 12-11 15-7 2 3-2 7-5 10 10-7 21-7 27-1 7-3 12 3 8 7 4 3 5 7 4 10 9 3 7 8 0 8H70m-32 0c-10 0-18-2-16-9m14 9h22c10-1 4-6-6-6"/><circle cx="32" cy="61" r="2" fill="currentColor" stroke="none"/>'
  ];
  function rabbitStampSvg(stamp) {
    return `<svg viewBox="0 0 110 110" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="55" cy="55" r="51"/>${rabbitStamps[stamp - 1]}</svg>`;
  }
  function boardStamp(completion) {
    if (!completion) return '';
    return `<span class="plan-note-stamp" role="img" aria-label="${e(completion.date)} 완료">${rabbitStampSvg(completion.stamp)}</span>`;
  }
  function memoStamp(completion) {
    if (!completion) return '';
    return `<figure class="memo-stamp">
      ${rabbitStampSvg(completion.stamp)}
      <figcaption><time datetime="${e(completion.date)}">${e(completion.date)}</time> 완료</figcaption>
    </figure>`;
  }
  function showMemo(plan, { editing = false, stamped = false } = {}) {
    const dialog = document.getElementById('planMemo');
    dialog.dataset.color = plan.color;
    dialog.dataset.planId = plan.id;
    const tags = splitTags(plan.tags);
    const error = '<p class="plan-form-error" role="alert"></p>';
    dialog.innerHTML = editing
      ? `<div class="memo-sheet"><h2 id="planMemoTitle">계획 수정</h2><form data-action="plan.save" class="pds-form">
          ${planEditIdentity(plan)}${planBasics(plan)}${colorPicker(plan.color)}${tagField(plan)}${error}
          <div class="plan-form-actions"><button type="button" data-cancel-memo>취소</button><button class="pds-button" type="submit">저장</button></div>
        </form></div>`
      : `<div class="memo-sheet${stamped ? ' memo-stamped' : ''}">
          <header class="memo-title memo-reveal"><h2 id="planMemoTitle">${e(plan.title)}</h2>
            ${plan.completion ? '' : form('plan.complete', hidden('id', plan.id), '완료')}
          </header>
          <p class="memo-dates memo-reveal"><time>${e(plan.start_date)}</time> – <time>${e(plan.end_date)}</time></p>
          <p class="memo-priority memo-reveal">우선순위 ${priorities[plan.priority]}</p>
          <div class="memo-stamp-slot">${memoStamp(plan.completion)}</div>${error}
          ${tags.length ? `<ul class="memo-tags" aria-label="해시태그">${tags.map(tag => `<li>#${e(tag)}</li>`).join('')}</ul>` : ''}
          <div class="plan-form-actions memo-actions">
            <form class="memo-delete-form" data-action="delete">
              ${hidden('kind', 'plan')}${hidden('id', plan.id)}${hidden('confirm', 'on')}
              <button type="submit" class="memo-delete-button">삭제</button>
            </form>
            <button type="button" data-edit-memo>수정</button>
            ${plan.completion
              ? '<button type="button" class="pds-button" data-review-memo>회고</button>'
              : '<button type="button" class="pds-button" data-close-memo>확인</button>'}
          </div>
        </div>`;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector(editing ? '[name="title"]' : '[data-close-memo], [data-review-memo]').focus();
  }
  function activePlans() {
    return state.plans.filter(p => !p.deleted_at).sort((a, b) => b.start_date.localeCompare(a.start_date) || b.id - a.id);
  }
  function recordsPage(q) {
    const plans = activePlans();
    const title = heading('실행 · 회고', '<button type="button" class="pds-button" data-open-diary-study>5일 사용 기록</button>');
    const studyEvidence = '<div class="history-item" data-plan-study-evidence aria-live="polite" hidden></div>';
    if (!plans.length) return title + '<section class="pds-card" data-plan-study-summary="" aria-live="polite" hidden></section>' +
      `<section id="evidence" class="pds-card"><h2>근거 기록</h2><p class="subtle">등록된 계획이 없어요.</p>${studyEvidence}</section>`;
    const plan = plans.find(p => p.id === Number(q.plan)) || plans[0], from = q.from || '', to = q.to || '';
    const { values, groups } = M.summary(state, plan.id, from, to);
    const filters = `<form data-action="filter" class="pds-filters">${options('plan', Object.fromEntries(plans.map(p => [p.id, p.title])), plan.id, '계획 선택')}${field('집계 시작 (마감일 기준)', 'from', from, 'date', false)}${field('집계 종료', 'to', to, 'date', false)}<button class="pds-button">기간 적용</button></form>`;
    const overview = `<section class="pds-card"><span class="eyebrow">PLAN #${plan.id}</span><h2>${e(plan.title)}</h2><p>${e(plan.start_date)} ~ ${e(plan.end_date)} · 우선순위 ${priorities[plan.priority]} · 계획 예상 ${plan.estimated_minutes}분</p><p class="preserve-lines">성공 기준: ${e(plan.success_criteria)}</p>${plan.source_review_id ? `<p class="improvement">회고 #${plan.source_review_id}에서 가져온 개선점: ${e(plan.improvement)}</p>` : ''}<p class="subtle">아래 예상 시간 집계는 개별 할 일의 예상 시간 합계입니다.</p></section>`;
    const cards = `<section class="metric-grid" aria-label="회고 집계">${Object.entries(metrics).map(([key, label]) => `<a class="metric" href="${e(url({ plan: plan.id, from, to, metric: key }))}" data-scroll-evidence><span>${label}</span><strong>${values[key]}<small>${['estimated', 'actual', 'difference'].includes(key) ? '분' : '건'}</small></strong><span>근거 기록 보기 ↗</span></a>`).join('')}</section>`;
    const studySummary = `<section class="pds-card" data-plan-study-summary="${plan.id}" aria-live="polite" hidden></section>`;
    const history = state.versions.filter(v => v.plan_id === plan.id).sort((a, b) => a.version - b.version).map(v => `<article class="history-item"><h3>버전 ${v.version}${v.version === 1 ? ' · 최초 계획' : ''}</h3><p>${e(v.snapshot.title)}</p><p>${e(v.snapshot.start_date)} ~ ${e(v.snapshot.end_date)} · ${priorities[v.snapshot.priority]} · ${v.snapshot.estimated_minutes}분</p><p class="preserve-lines">${e(v.snapshot.success_criteria)}</p><small>${e(localDate(v.created_at))} (서울)</small></article>`).join('');
    const edits = `<div class="pds-two"><details class="pds-card"><summary>계획 수정 · 최초 계획과 이력 보존</summary>${form('plan.save', planFields(plan), '계획 수정 및 이력 저장')}<h3>수정 이력</h3>${history}${deletion('plan', plan.id, plan.id)}</details><details class="pds-card"><summary>이 계획에 할 일 추가</summary>${form('task.save', taskFields(plan.id), '할 일 추가')}</details></div>`;
    const metric = Object.hasOwn(metrics, q.metric || '') ? q.metric : '', sort = Object.hasOwn(sorts, q.sort || '') ? q.sort : 'due';
    let tasks = (groups[metric] || groups.planned).filter(t => !q.q || (t.title + ' ' + t.tags).toLocaleLowerCase().includes(q.q.trim().toLocaleLowerCase()));
    if (q.state === 'done') tasks = tasks.filter(t => t.completed);
    if (q.state === 'open') tasks = tasks.filter(t => !t.completed);
    if (q.tag?.trim()) tasks = tasks.filter(t => t.tags.split(',').some(tag => tag.trim().toLocaleLowerCase() === q.tag.trim().toLocaleLowerCase()));
    const compare = { due: (a, b) => a.due_date.localeCompare(b.due_date) || a.id - b.id, priority: (a, b) => a.priority - b.priority || a.due_date.localeCompare(b.due_date) || a.id - b.id, created: (a, b) => b.id - a.id, estimate: (a, b) => a.estimated_minutes - b.estimated_minutes || a.id - b.id };
    tasks.sort(compare[sort]);
    const controls = `<form data-action="filter" class="pds-filters">${hidden('plan', plan.id) + hidden('from', from) + hidden('to', to) + hidden('metric', metric)}${field('제목·태그 검색', 'q', q.q, 'text', false)}${options('state', { '': '전체 상태', open: '미완료', done: '완료' }, q.state, '상태')}${field('태그 일치', 'tag', q.tag, 'text', false)}${options('sort', sorts, sort, '정렬 기준')}<button class="pds-button">조회</button></form>`;
    const rows = tasks.map(t => `<tr><td><a href="${e(url({ plan: plan.id, task: t.id }))}"><b>#${t.id} ${e(t.title)}</b></a><span class="table-note">${e(t.tags)}</span></td><td>${e(t.due_date)}</td><td>${priorities[t.priority]}</td><td>${t.completed ? '완료' : t.due_date < M.today() ? '지연' : '진행 중'}${t.blocked ? ' · 막힘' : ''}</td><td>${t.estimated_minutes} / ${t.actual_minutes}분</td><td>${form('task.complete', hidden('task_id', t.id) + hidden('plan_id', plan.id) + hidden('completed', t.completed ? '0' : '1'), t.completed ? '완료 취소' : '완료 처리')}</td></tr>`).join('');
    const table = `<section id="evidence" class="pds-card"><h2>${e(metrics[metric] || '할 일')} · 근거 기록</h2><p class="subtle">집계는 선택 계획의 삭제되지 않은 할 일과 마감일 기준입니다. 실제 시간은 해당 할 일의 유효 실행 기록 합계입니다. 할 일 제목을 누르면 실행 기록이 보입니다.</p>${studyEvidence}${controls}<p class="sort-label">정렬: ${sorts[sort]} · 검색 결과 ${tasks.length}건</p><div class="table-scroll"><table><thead><tr><th>할 일 / 태그</th><th>마감일</th><th>우선순위</th><th>상태</th><th>예상 / 실제</th><th>처리</th></tr></thead><tbody>${rows || '<tr><td colspan="6">해당하는 기록이 없습니다.</td></tr>'}</tbody></table></div></section>`;
    return title + filters + overview + cards + studySummary + edits + table + reviewSection(plan, { from, to });
  }
  function reviewSection(plan, { from = '', to = '', startDraft = false } = {}) {
    const reviews = state.reviews.filter(r => r.plan_id === plan.id && !r.deleted_at).sort((a, b) => b.id - a.id).map(r => {
      const next = state.plans.find(p => p.source_review_id === r.id && !p.deleted_at);
      const nextDate = new Date(Date.parse(r.to_date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
      const nextFields = hidden('review_id', r.id) + field('다음 계획 이름', 'title', plan.title.slice(0, 185) + ' · 다음 계획', 'text', true, 'maxlength="200"') + row(field('시작일', 'start_date', nextDate, 'date') + field('종료일', 'end_date', nextDate, 'date'));
      return `<article class="history-item" id="review-${r.id}" tabindex="-1"><h3>회고 #${r.id} · ${e(r.from_date)} ~ ${e(r.to_date)}</h3><p class="preserve-lines">${e(r.reflection)}</p><p class="improvement">다음에 바꿀 한 가지: ${e(r.improvement)}</p><p><a href="${e(url({ plan: plan.id, from: r.from_date, to: r.to_date, metric: 'planned' }))}" data-scroll-evidence>이 기간의 집계와 근거 보기 ↗</a></p>${next ? `<a class="pds-button" href="${e(url({ view: 'records', plan: next.id }))}">반영된 다음 계획 #${next.id} 열기</a>` : `<details><summary>개선점을 다음 계획에 반영하기</summary>${form('plan.next', nextFields, '개선점으로 다음 계획 만들기')}</details>`}<details><summary>회고 수정</summary>${form('review.save', reviewFields(plan, r), '회고 수정')}</details>${deletion('review', r.id, plan.id)}</article>`;
    }).join('');
    const draft = { from_date: from || plan.start_date, to_date: to || plan.end_date };
    const editor = form('review.save', reviewFields(plan, draft), '회고 저장');
    if (!reviews && startDraft) return `<section class="pds-card review-card"><h2>새 회고 작성</h2>${editor}</section>`;
    return `<section class="pds-card review-card"><h2>작성한 회고</h2>${reviews || '<p>아직 작성한 회고가 없어요.</p>'}</section>
      <details class="pds-card review-card"><summary>+ 새 회고 작성</summary>${editor}</details>`;
  }
  function reviewPage(id) {
    const plan = M.find(state, 'plans', id);
    return `<div class="review-page">${heading(plan.title + ' 회고', '<a class="pds-button" href="#">계획 메모로 돌아가기</a>')}${reviewSection(plan, { startDraft: true })}</div>`;
  }
  function taskPage(id) {
    const task = M.find(state, 'tasks', id), records = state.executions.filter(r => r.task_id === task.id && !r.deleted_at).sort((a, b) => b.started_at.localeCompare(a.started_at) || b.id - a.id);
    const logs = records.map(r => `<article class="history-item" id="execution-${r.id}" tabindex="-1"><h3>실행 #${r.id} · ${r.actual_minutes}분</h3><p>${e(localDate(r.started_at))} → ${e(localDate(r.ended_at))} (서울)</p><p class="preserve-lines">막힘 사유: ${e(r.blocked_reason || '없음')}</p><details><summary>실행 기록 수정</summary>${form('execution.save', executionFields(task.id, r), '실행 수정')}</details>${deletion('execution', r.id, task.plan_id, task.id)}</article>`).join('');
    return heading('실행 노트') + `<a href="${e(url({ plan: task.plan_id, metric: 'planned' }))}" data-scroll-evidence>← 계획 #${task.plan_id}의 근거 기록으로</a><section class="pds-card"><h2>할 일 #${task.id} · ${e(task.title)}</h2><p>예상 ${task.estimated_minutes}분 · 실제 합계 ${records.reduce((n, r) => n + r.actual_minutes, 0)}분 · 연결 계획 #${task.plan_id}</p>${form('task.save', taskFields(task.plan_id, task), '할 일 수정')}${deletion('task', task.id, task.plan_id)}</section><div class="pds-two"><section class="pds-card"><h2>실제 실행 기록하기</h2>${form('execution.save', executionFields(task.id), '실행 기록 저장')}</section><section class="pds-card"><h2>연결된 실행 기록</h2>${logs || '<p class="subtle">아직 실행 기록이 없습니다.</p>'}</section></div>`;
  }
  function message(text, error = false) { status.textContent = text; status.classList.toggle('is-error', error); if (error) status.scrollIntoView({ block: 'nearest' }); }
  function render() {
    if (!loaded) return;
    const q = query();
    try {
      if (q.task) app.innerHTML = taskPage(q.task);
      else if (q.view === 'review') app.innerHTML = reviewPage(q.plan);
      else if (q.view === 'records' || q.metric || q.from || q.to) app.innerHTML = recordsPage(q);
      else app.innerHTML = planBoard(activePlans());
    }
    catch (error) { app.innerHTML = heading('기록을 확인해주세요') + `<section class="pds-card"><p>${e(error.message)}</p><a class="pds-button" href="#">전체 계획으로 돌아가기</a></section>`; }
    app.setAttribute('aria-busy', 'false');
    window.DiaryStudy?.updatePlanStudy();
    if (q.task && q.execution) requestAnimationFrame(() => {
      if (query().execution === q.execution) document.getElementById(`execution-${q.execution}`)?.focus();
    });
    if (q.metric) requestAnimationFrame(() => document.getElementById('evidence')?.scrollIntoView({ block: 'start' }));
  }
  function navigate(values) {
    const next = url(values);
    if (location.hash.replace(/^#/, '') === next.slice(1)) render(); else location.hash = next;
  }
  async function refresh(initial = false) {
    const serial = ++refreshSerial;
    try {
      const result = await storage.read();
      if (serial !== refreshSerial) return;
      state = result.state; loaded = true; render();
      if (initial) message('계정에 기록됩니다. 중요한 기록은 파일로 백업해주세요.');
    } catch (error) { app.setAttribute('aria-busy', 'false'); message(error.message, true); }
  }
  app.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || !event.target.matches('[name="tag_draft"]')) return;
    event.preventDefault();
    if (!event.target.form.dataset.busy) commitTagDraft(event.target.closest('.plan-tag-field'));
  });
  app.addEventListener('submit', async event => {
    const target = event.target.closest('form[data-action]');
    if (!target) return;
    event.preventDefault();
    if (!loaded || target.dataset.busy) return;
    const tags = target.querySelector('.plan-tag-field');
    if (tags && !commitTagDraft(tags)) {
      tags.querySelector('[name="tag_draft"]').focus();
      return;
    }
    const data = Object.fromEntries(new FormData(target)), type = target.dataset.action;
    delete data.tag_draft;
    const memo = target.closest('#planMemo');
    if (type === 'filter') { navigate({ view: 'records', ...data }); return; }
    if (type === 'delete' && data.confirm !== 'on') return;
    if (type === 'delete' && memo && !window.confirm('이 계획 메모를 삭제할까요? 다이어리에서도 일정 표시가 사라집니다.')) return;
    target.dataset.busy = 'yes';
    const button = event.submitter || target.querySelector('button[type="submit"], button:not([type])');
    const composer = target.closest('#planComposer');
    const errorLine = (composer || memo)?.querySelector('.plan-form-error');
    if (errorLine) errorLine.textContent = '';
    button.disabled = true;
    try {
      const result = await storage.write({ type, data });
      state = result.state;
      composer?.close();
      if (memo) {
        if (!memo.isConnected) return;
        if (type === 'delete') {
          memo.close();
          render();
          app.querySelector('[data-open-plan]')?.focus({ preventScroll: true });
        } else {
          const plan = M.find(state, 'plans', result.id);
          const note = app.querySelector(`[data-view-plan="${result.id}"]`);
          if (type === 'plan.save') {
            memo.close();
            render();
            app.querySelector(`[data-view-plan="${result.id}"]`)?.focus({ preventScroll: true });
          } else if (type === 'plan.complete' && note && !note.querySelector('.plan-note-stamp')) {
            note.insertAdjacentHTML('beforeend', boardStamp(plan.completion));
          }
          showMemo(plan, { stamped: type === 'plan.complete' });
        }
      }
      else if (composer) render();
      else if (type === 'plan.save' || type === 'plan.next') navigate({ view: 'records', plan: result.id });
      else if (type === 'task.save') navigate({ plan: data.plan_id, task: result.id });
      else if (type === 'execution.save') navigate({ plan: query().plan, task: data.task_id });
      else if (query().view === 'review' && type === 'review.save') {
        render();
        const savedReview = document.getElementById(`review-${result.id}`);
        savedReview?.focus({ preventScroll: true });
        savedReview?.scrollIntoView({ block: 'start' });
      }
      else if (query().view === 'review' && type === 'delete' && data.kind === 'review') render();
      else if (type === 'delete') navigate(data.kind === 'plan' ? {} : data.kind === 'execution' ? { plan: data.plan, task: data.task } : { plan: data.plan, metric: 'planned' });
      else navigate({ ...query(), view: 'records', plan: data.plan_id });
      message(type === 'delete' ? '기록을 삭제했습니다. 변경 내용이 계정에 저장되었어요.' : '기록이 계정에 저장되었어요.');
    } catch (error) {
      if (errorLine) errorLine.textContent = error.message;
      else message(error.message, true);
    }
    finally { target.dataset.busy = ''; button.disabled = false; }
  });
  app.addEventListener('click', event => {
    const tagButton = event.target.closest('[data-remove-tag]');
    if (tagButton) {
      if (tagButton.form.dataset.busy) return;
      const tags = tagButton.closest('.plan-tag-field');
      const saved = splitTags(tags.querySelector('[name="tags"]').value);
      updateTags(tags, saved.filter(tag => tag !== tagButton.dataset.removeTag));
      tags.querySelector('[name="tag_draft"]').focus();
      return;
    }
    const composer = document.getElementById('planComposer');
    const note = event.target.closest('[data-view-plan]');
    if (note) {
      note.focus({ preventScroll: true });
      showMemo(M.find(state, 'plans', note.dataset.viewPlan));
      return;
    }
    const memo = event.target.closest('#planMemo');
    if (memo && !memo.querySelector('form[data-busy="yes"]')) {
      if (event.target.closest('[data-review-memo]')) {
        memo.close();
        navigate({ view: 'review', plan: memo.dataset.planId });
        window.scrollTo({ top: 0, behavior: 'instant' });
        return;
      }
      if (event.target === memo || event.target.closest('[data-close-memo]')) memo.close();
      if (event.target.closest('[data-edit-memo], [data-cancel-memo]')) {
        showMemo(M.find(state, 'plans', memo.dataset.planId), { editing: Boolean(event.target.closest('[data-edit-memo]')) });
      }
    }
    if (event.target.closest('[data-open-plan]')) {
      composer.querySelector('form').reset();
      updateTags(composer.querySelector('.plan-tag-field'), []);
      composer.querySelector('.plan-form-error').textContent = '';
      composer.dataset.color = 'cream';
      composer.showModal();
      composer.querySelector('[name="title"]').focus();
    }
    if (event.target.closest('[data-close-plan]') && !composer.querySelector('form').dataset.busy) composer.close();
    const evidenceLink = event.target.closest('[data-scroll-evidence]');
    if (evidenceLink && evidenceLink.getAttribute('href') === location.hash) requestAnimationFrame(() => document.getElementById('evidence')?.scrollIntoView({ block: 'start' }));
  });
  app.addEventListener('change', event => {
    const composer = event.target.closest('#planComposer, #planMemo');
    if (composer && event.target.name === 'color') composer.dataset.color = event.target.value;
  });
  app.addEventListener('cancel', event => {
    if (event.target.matches('#planComposer, #planMemo') && event.target.querySelector('form[data-busy="yes"]')) event.preventDefault();
  }, true);
  document.getElementById('exportData').addEventListener('click', async () => {
    try {
      const current = (await storage.read()).state;
      const backup = { ...current, exported_at: new Date().toISOString(), timezone: 'Asia/Seoul', duration_unit: 'minute', storage: 'browser-indexeddb' };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const href = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = href; a.download = `yeobaek-pds-${M.today()}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(href), 10000);
      message('전체 Plan–Do–See 기록을 JSON 파일로 내보냈습니다.');
    } catch (error) { message(error.message, true); }
  });
  document.getElementById('importForm').addEventListener('submit', async event => {
    event.preventDefault();
    const target = event.target, file = target.elements.backup.files[0], button = target.querySelector('button');
    if (!file || !target.elements.confirm.checked || button.disabled) return;
    if (file.size > 5 * 1024 * 1024) { message('5MB 이하의 백업 파일을 선택해주세요.', true); return; }
    button.disabled = true;
    try {
      const replacement = M.validate(JSON.parse(await file.text()));
      state = (await storage.restore(replacement)).state; loaded = true;
      navigate({}); target.reset(); message('백업을 복원했습니다. 종이 다이어리 메모는 변경하지 않았습니다.');
    } catch (error) { message('복원하지 못했습니다. ' + error.message, true); }
    finally { button.disabled = false; }
  });
  window.addEventListener('hashchange', render);
  // Other tabs notify without replacing a form that someone is currently editing.
  if (storage.channel) storage.channel.onmessage = () => message('다른 탭에서 기록이 변경되었어요. 새로고침하면 최신 기록을 볼 수 있어요.');
  refresh(true);
})();

