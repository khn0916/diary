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
    <details class="pds-card backup-panel" id="diaryStudy">
      <summary>5일 사용 기록</summary>
      <div data-study-view aria-live="polite"></div>
    </details>
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

  function totals(days, unit) {
    const values = days.map(day => day.value).filter(value => value !== null);
    if (!values.length) return '기록 없음';
    // Convert to four-decimal integer units before summation to avoid binary rounding drift.
    const ticks = values.reduce((sum, value) => sum + Math.round(Number(value) * 10000), 0);
    const rounded = n => (Math.floor((n + 50) / 100) / 100).toFixed(2);
    return `합계 ${rounded(ticks)} ${unit} · 평균 ${rounded(ticks / values.length)} ${unit} (${values.length}일)`;
  }

  function renderStudy(record) {
    if (!record) {
      view.innerHTML = studyForm('start',
        textField('답하려는 질문', 'question') + textField('관찰 지표 하나', 'metric') +
        textField('단위', 'unit', 32) + textField('값 계산 방법', 'calculation', 500) +
        textField('처음 적용할 계획 규칙', 'rule', 500), '1일차 기준 저장');
      return;
    }
    const unit = escape(record.unit), days = record.days;
    const changed = record.change;
    const intro = `<h3>${escape(record.question)}</h3>
      <p>${escape(record.metric)} (${unit}) · ${escape(record.calculation)}</p>
      <p>처음 계획 규칙 · ${escape(record.rule)}</p>
      <p class="subtle">서울 시간 기준 · 주 시작 월요일 · 하루에 한 번 기록 · 결측은 합계와 평균에서 제외 · 음수 및 입력 범위 밖 값은 거절하고 범위 안 값은 근거와 함께 보존 · 소수점 둘째 자리 반올림</p>`;
    const changeDetails = changed ? `<p class="improvement">변경한 규칙 · ${escape(changed.rule)}<br>
      이유 · ${escape(changed.reason)}<br>${escape(seoulTime.format(new Date(changed.changed_at)))} · 근거 날짜 ${escape(changed.based_on.join(', '))}</p>` : '';
    const entries = days.length ? `<ol>${days.map(day =>
      `<li><time>${escape(day.date)}</time> · ${day.value === null ? '결측' : escape(day.value) + ' ' + unit} · ${escape(day.evidence)}</li>`).join('')}</ol>` : '';
    const comparison = `<p><strong>전체</strong> · ${totals(days, unit)}</p>
      <p>변경 전 1~2일차 · ${totals(days.slice(0, 2), unit)}<br>변경 후 3~5일차 · ${totals(days.slice(2), unit)}</p>`;
    const action = days.length === 2 && !changed
      ? studyForm('change', textField('새 계획 규칙 한 가지', 'rule', 500) + textField('바꾸는 이유', 'reason', 500), '규칙 변경 기록')
      : days.length < 5 ? studyForm('record',
        `<label class="pds-field"><span>오늘 관찰한 값 (${unit})</span><input name="value" type="number" min="0" max="999999999.9999" step="0.0001" required></label>
          <label class="delete-confirm"><input type="checkbox" name="missing"> 오늘 값이 없어 결측으로 남기기</label>` +
          textField('오늘 기록의 근거', 'evidence', 1200), `${days.length + 1}일차 기록`) : '<p>5일 사용 기록이 완료되었어요.</p>';
    view.innerHTML = intro + changeDetails + entries + comparison + action;
  }

  async function refreshStudy() {
    try {
      view.textContent = '사용 기록을 불러오는 중이에요…';
      renderStudy((await cloud.read('study')).content);
    } catch (error) {
      view.textContent = error.message;
    }
  }

  study.addEventListener('toggle', () => { if (study.open) refreshStudy(); });
  document.getElementById('openDiaryStudy')?.addEventListener('click', () => {
    study.open = true;
    study.scrollIntoView({ block: 'start' });
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
    start: '1일차 기준이 이미 저장되었거나 입력이 비어 있어요.',
    record: '서울 시간 기준으로 같은 날짜의 중복 기록은 할 수 없어요. 3일차 전에 계획 규칙을 바꿔주세요.',
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
        renderStudy(await cloud.study(form.dataset.study, values));
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
})();
