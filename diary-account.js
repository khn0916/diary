(function () {
  'use strict';

  const panel = document.getElementById('diaryAccount');
  const cloud = window.DiaryCloud;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const seoulTime = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' });
  const textField = (label, name, max = 200) =>
    `<label class="pds-field"><span>${label}</span><input name="${name}" maxlength="${max}" required></label>`;
  const studyForm = (action, input, label) =>
    `<form class="pds-form" data-study="${action}">${input}<button class="pds-button">${label}</button></form>`;

  panel.innerHTML = `
    <section class="pds-card backup-panel" id="diaryStudy" aria-labelledby="diaryStudyTitle">
      <h2 id="diaryStudyTitle">5일 사용 기록</h2>
      <div data-study-view aria-live="polite"></div>
    </section>
    <details class="pds-card backup-panel">
      <summary>계정과 전체 기록</summary>
      <form class="pds-form" data-diary-action="import">
        <h3>이 브라우저의 기록 옮기기</h3>
        <p class="subtle">이 브라우저에 직접 남겨 둔 본인 기록만 옮겨주세요. 서버에 이미 해당 종류의 기록이 있으면 이관을 중단합니다.</p>
        <label class="pds-field"><span>기록을 저장했던 버전</span><select name="source"><option value="legacy">과제 6에서 남긴 기록</option><option value="account">로그인 추가 후 이 브라우저에 남긴 기록</option></select></label>
        <label class="pds-field"><span>옮길 기록</span><select name="kind"><option value="journal">월간 메모와 하루 기록</option><option value="plans">계획·실행·회고</option></select></label>
        <label class="delete-confirm"><input type="checkbox" required> 내 기록을 이 계정으로 옮깁니다.</label>
        <button class="pds-button">기록 옮기기</button>
      </form>
      <form class="pds-form" data-diary-action="export">
        <h3>내 기록 전체 내보내기</h3>
        <button class="pds-button">JSON 파일 받기</button>
      </form>
      <form class="pds-form" data-diary-action="password">
        <h3>비밀번호 변경</h3>
        <label class="pds-field"><span>현재 비밀번호</span><input type="password" name="current" autocomplete="current-password" required></label>
        <label class="pds-field"><span>새 비밀번호</span><input type="password" name="password" minlength="8" autocomplete="new-password" required></label>
        <label class="pds-field"><span>새 비밀번호 확인</span><input type="password" name="repeat" minlength="8" autocomplete="new-password" required></label>
        <button class="pds-button">비밀번호 변경</button>
      </form>
      <form class="pds-form" data-diary-action="delete">
        <h3>계정 삭제</h3>
        <p class="subtle">계정과 서버에 저장된 다이어리·계획·5일 사용 기록을 함께 삭제합니다. 이미 내려받은 파일과 이관 전 브라우저 원본은 직접 관리할 수 있습니다.</p>
        ${textField('삭제하려면 DELETE를 입력하세요', 'confirmation', 6)}
        <button class="pds-button">계정과 서버 기록 삭제</button>
      </form>
    </details>
    <p class="pds-status" id="accountStatus" role="status"></p>`;
  const study = panel.querySelector('#diaryStudy');
  const view = panel.querySelector('[data-study-view]');
  const status = panel.querySelector('#accountStatus');
  let recordsRequest = 0;
  let studyRequest = 0;

  function totals(days, unit) {
    const values = days.map(day => day.value).filter(value => value !== null);
    if (!values.length) return '기록 없음';
    // Convert to four-decimal integer units before summation to avoid binary rounding drift.
    const ticks = values.reduce((sum, value) => sum + Math.round(Number(value) * 10000), 0);
    const rounded = n => (Math.floor((n + 50) / 100) / 100).toFixed(2);
    return `합계 ${rounded(ticks)} ${unit} · 평균 ${rounded(ticks / values.length)} ${unit} (${values.length}일)`;
  }

  function studyChange(change) {
    return change ? `<p class="improvement">변경한 규칙 · ${escape(change.rule)}<br>
      이유 · ${escape(change.reason)}<br>${escape(seoulTime.format(new Date(change.changed_at)))} · 근거 날짜 ${escape(change.based_on.join(', '))}</p>` : '';
  }

  function studyEntries(record, showPending = false) {
    const days = record?.days || [], unit = escape(record?.unit);
    if (!days.length && !showPending) return '<p class="subtle">아직 저장한 일별 기록이 없어요.</p>';
    const rows = showPending ? Array.from({ length: 5 }, (_, i) => days[i]) : days;
    return `<ol class="study-days">${rows.map((day, index) => {
      const label = `<strong>${index + 1}일차</strong><span>${index < 2 ? '변경 전' : '변경 후'}</span>`;
      if (!day) return `<li class="study-day">${label}<span class="subtle">기록 대기</span></li>`;
      const sources = day.sources?.map(source => `<li><a href="#plan=${encodeURIComponent(record.plan_id)}&amp;task=${encodeURIComponent(source.task_id)}&amp;execution=${encodeURIComponent(source.id)}">${escape(source.title)}</a> · 실행 #${escape(source.id)} · ${escape(source.minutes)}분</li>`).join('');
      return `<li class="study-day">${label}<span><time datetime="${escape(day.date)}">${escape(day.date)}</time> · ${day.value === null ? '결측' : escape(day.value) + ' ' + unit}</span>
        ${sources ? `<ul>${sources}</ul>` : ''}${day.evidence ? `<p class="subtle">${escape(day.evidence)}</p>` : ''}</li>`;
    }).join('')}</ol>`;
  }

  function studyComparison(record) {
    const unit = escape(record.unit), days = record.days;
    return `<p><strong>전체</strong> · ${totals(days, unit)}</p>
      <p>변경 전 1~2일차 · ${totals(days.slice(0, 2), unit)}<br>변경 후 3~5일차 · ${totals(days.slice(2), unit)}</p>`;
  }

  async function updatePlanStudy(record) {
    const summary = document.querySelector('[data-plan-study-summary]');
    const evidence = document.querySelector('[data-plan-study-evidence]');
    if (!summary || !evidence) return;
    const request = ++recordsRequest;
    try {
      const current = record === undefined ? (await cloud.read('study')).content : record;
      if (request !== recordsRequest || !summary.isConnected) return;
      if (!current || (current.plan_id != null && String(current.plan_id) !== summary.dataset.planStudySummary)) return;
      const scope = current.plan_id == null ? '직접 입력한 계정의 관찰 기록' : '선택한 계획의 관찰 기록';
      summary.innerHTML = `<h2>5일 실사용 집계</h2>
        <p>${escape(current.question)}</p>
        <p class="subtle">${scope} · ${escape(current.metric)} (${escape(current.unit)}) · ${current.days.length}/5일 저장</p>
        ${studyComparison(current)}`;
      evidence.innerHTML = `<h3>5일 실사용 근거</h3>
        <p class="subtle">서울 기준 저장한 관찰 날짜 전체를 보여줘요.</p>
        ${studyEntries(current)}${studyChange(current.change)}`;
      summary.hidden = false;
      evidence.hidden = false;
    } catch (error) {
      if (request !== recordsRequest || !summary.isConnected) return;
      summary.textContent = '5일 실사용 기록을 불러오지 못했어요. 페이지를 새로고침해 주세요.';
      summary.hidden = false;
    }
  }

  function renderStudy(record) {
    if (!record) {
      view.innerHTML = `<p class="subtle">실행 노트에 오늘 한 작업을 저장하면 이 목록이 자동으로 채워져요. 첫 실행을 저장한 계획으로 5일을 관찰해요.</p>
        <p><a href="#view=records" data-open-study-records>실행 기록 열기 ↗</a></p>${studyEntries(null, true)}`;
      return;
    }
    const unit = escape(record.unit), days = record.days;
    const changed = record.change;
    const linked = record.plan_id != null;
    const recordsUrl = linked ? `#view=records&amp;plan=${encodeURIComponent(record.plan_id)}` : '#view=records';
    const intro = `<h3>${escape(record.question)}</h3>
      <p>${escape(record.metric)} (${unit}) · ${escape(record.calculation)}</p>
      <p><a href="${recordsUrl}" data-open-study-records>${linked ? escape(record.plan_title) + '의 ' : ''}집계와 근거 기록 보기 ↗</a></p>
      <p>처음 계획 규칙 · ${escape(record.rule)}</p>
      <p class="subtle">서울 시간 기준 · 주 시작 월요일 · 하루에 한 번 기록 · 결측은 합계와 평균에서 제외 · 음수 및 입력 범위 밖 값은 거절하고 범위 안 값은 근거와 함께 보존 · 소수점 둘째 자리 반올림</p>`;
    const action = days.length === 2 && !changed
      ? '<p class="subtle">3일차 작업을 시작하기 전에 계획 규칙 하나를 바꿔주세요.</p>' +
        studyForm('change', textField('새 계획 규칙 한 가지', 'rule', 500) + textField('바꾸는 이유', 'reason', 500), '규칙 변경 기록')
      : days.length === 5 ? '<p>5일 사용 기록이 완료되었어요.</p>'
      : linked ? '<p class="subtle">같은 계획의 실행 노트에 작업을 저장하면 목록과 집계가 자동으로 갱신돼요.</p>'
      : studyForm('record',
        `<label class="pds-field"><span>오늘 관찰한 값 (${unit})</span><input name="value" type="number" min="0" max="999999999.9999" step="0.0001" required></label>
          <label class="delete-confirm"><input type="checkbox" name="missing"> 오늘 값이 없어 결측으로 남기기</label>`, `${days.length + 1}일차 기록`);
    view.innerHTML = `${studyEntries(record, true)}${intro}${studyChange(changed)}
      <h3>실사용 집계</h3>${studyComparison(record)}${action}`;
  }

  function acceptStudy(record) {
    ++studyRequest;
    const draft = view.querySelector('form[data-study="change"]');
    const rule = draft?.elements.rule.value, reason = draft?.elements.reason.value;
    renderStudy(record);
    const currentForm = view.querySelector('form[data-study="change"]');
    if (draft && currentForm) {
      currentForm.elements.rule.value = rule;
      currentForm.elements.reason.value = reason;
    }
    updatePlanStudy(record);
  }

  async function refreshStudy() {
    const request = ++studyRequest;
    try {
      const { content } = await cloud.read('study');
      if (request === studyRequest) acceptStudy(content);
    } catch (error) {
      if (request === studyRequest) status.textContent = error.message;
    }
  }

  document.addEventListener('click', event => {
    if (event.target.closest('[data-open-study-records]')) document.getElementById('pdsApp').scrollIntoView({ block: 'start' });
    if (!event.target.closest('#openDiaryStudy, [data-open-diary-study]')) return;
    study.scrollIntoView({ block: 'start' });
    refreshStudy();
  });
  panel.addEventListener('change', event => {
    if (event.target.name !== 'missing') return;
    const field = event.target.form.elements.value;
    field.disabled = event.target.checked;
  });

  function download(data) {
    const file = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const href = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = href;
    link.download = 'yeobaek-account-' + PDSModel.today() + '.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
  }

  const studyErrors = {
    record: '같은 날짜는 한 번만 기록할 수 있어요. 3일차 전 규칙 변경과 필수 입력도 확인해주세요.',
    change: '계획 규칙은 2일차 이후, 3일차 전에 한 번 바꿀 수 있어요. 새 규칙과 이유를 확인해주세요.'
  };
  panel.addEventListener('submit', async event => {
    const form = event.target;
    event.preventDefault();
    const button = form.querySelector('button');
    if (button.disabled) return;
    const values = Object.fromEntries(new FormData(form));
    const action = form.dataset.diaryAction;
    if (action === 'delete' && (values.confirmation !== 'DELETE' || !window.confirm('계정과 서버 기록을 모두 삭제할까요?'))) return;
    button.disabled = true;
    status.textContent = '처리 중이에요…';
    try {
      if (form.dataset.study) {
        if (form.dataset.study === 'record' && values.missing) values.value = null;
        const record = await cloud.study(form.dataset.study, values);
        acceptStudy(record);
        status.textContent = '사용 기록을 저장했어요.';
      } else if (action === 'import') {
        const count = await cloud.importFromBrowser(values.kind, values.source === 'legacy');
        status.textContent = `${count}건을 계정으로 옮겼어요. 페이지를 새로고침하면 볼 수 있어요.`;
      } else if (action === 'export') {
        download({ format: 'yeobaek-account-v1', exported_at: new Date().toISOString(), records: await cloud.list() });
        status.textContent = '내 기록 전체를 JSON 파일로 내보냈어요.';
      } else if (action === 'password') {
        if (values.password !== values.repeat) throw new Error('새 비밀번호 확인이 일치하지 않아요.');
        const auth = window.diaryDatabase.auth;
        const { error } = await auth.updateUser({ password: values.password, current_password: values.current });
        if (error) throw new Error('비밀번호를 바꾸지 못했어요. 현재 비밀번호와 새 비밀번호를 확인해주세요.');
        form.reset();
        try { await auth.signOut({ scope: 'local' }); } catch {}
        location.replace('../index.html');
      } else {
        await cloud.deleteAccount();
        try { await window.diaryDatabase.auth.signOut({ scope: 'local' }); } catch {}
        location.replace('../index.html');
      }
    } catch (error) {
      status.textContent = form.dataset.study && [400,409].includes(error.status) ? studyErrors[form.dataset.study] : error.message;
    } finally {
      button.disabled = false;
    }
  });
  window.DiaryStudy = { updatePlanStudy, acceptStudy };
  renderStudy(null);
  refreshStudy();
})();
