(function () {
  'use strict';

  const legacyPlans = window.PDSStorage;
  const account = window.diaryAccountId;
  const client = window.diaryDatabase;
  const journalChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('yeobaek-cloud-journal:' + account);

  async function call(name, args) {
    const { data, error, status } = await client.rpc(name, args);
    if (error) {
      const message = status === 401 ? '로그인 세션이 만료되었어요. 다시 로그인해주세요.'
        : status === 409 ? '다른 변경사항과 겹쳤어요. 내용을 확인한 뒤 다시 시도해주세요.'
        : '서버에 기록을 연결하지 못했어요. 잠시 후 다시 시도해주세요.';
      const failure = new Error(message);
      failure.status = status;
      failure.code = error.code;
      throw failure;
    }
    return data;
  }

  function request(operation, kind, options = {}) {
    return call('diary_documents', { operation, document_kind: kind, requested_owner: account, ...options });
  }

  function read(kind) {
    return request('get', kind);
  }

  async function update(kind, change) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await read(kind);
      const { content, id } = change(current.content);
      try {
        await request('put', kind, { expected_version: current.version, document_content: content });
        (kind === 'journal' ? journalChannel : legacyPlans.channel)?.postMessage('saved');
        return { state: content, id };
      } catch (error) {
        if (error.status !== 409 || attempt === 4) throw error;
      }
    }
  }

  function readJournalStorage(legacy) {
    const key = 'yeobaek.diary.v1' + (legacy ? '' : '.' + account);
    const journal = { entries: {}, notes: {} };
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    function apply(kind, date, value) {
      if (kind === 'entries' ? !/^\d{4,}-\d{2}-\d{2}$/.test(date) : !/^\d{4,}-\d{2}$/.test(date)) return;
      if (value === null) delete journal[kind][date];
      else if (kind === 'notes' && typeof value === 'string') journal.notes[date] = value;
      else if (kind === 'entries' && typeof value?.text === 'string' && typeof value.mood === 'string') journal.entries[date] = value;
    }
    for (const kind of ['entries', 'notes']) {
      for (const [date, value] of Object.entries(saved[kind] || {})) apply(kind, date, value);
    }
    for (let index = 0; index < localStorage.length; index++) {
      const storageKey = localStorage.key(index);
      if (!storageKey?.startsWith(key + '.')) continue;
      const match = /^(entries|notes)\.(.+)$/.exec(storageKey.slice(key.length + 1));
      if (match) apply(match[1], match[2], JSON.parse(localStorage.getItem(storageKey)));
    }
    return journal;
  }

  async function importFromBrowser(kind, legacy) {
    const content = kind === 'journal' ? readJournalStorage(legacy) : (await legacyPlans.readBrowserCopy(legacy)).state;
    const count = kind === 'journal' ? Object.keys(content.entries).length + Object.keys(content.notes).length : content.plans.length;
    if (!count) throw new Error('선택한 브라우저 저장소에 옮길 기록이 없어요.');
    const current = await read(kind);
    if (current.version !== 0) throw new Error('서버에 이미 저장된 기록이 있어 덮어쓰지 않았어요.');
    await request('put', kind, { expected_version: 0, document_content: content });
    (kind === 'journal' ? journalChannel : legacyPlans.channel)?.postMessage('saved');
    return count;
  }

  function planState(content) {
    return content?.format ? PDSModel.validate(content) : PDSModel.empty();
  }

  window.PDSStorage = {
    channel: legacyPlans.channel,
    read: async () => ({ state: planState((await read('plans')).content) }),
    write: command => {
      const now = new Date().toISOString();
      return update('plans', value => {
        const result = PDSModel.apply(planState(value), command, now);
        return { content: result.state, id: result.id };
      });
    },
    restore: data => update('plans', () => ({ content: PDSModel.validate(data) }))
  };

  window.DiaryCloud = {
    read, update, journalChannel, importFromBrowser,
    list: () => request('list', null),
    study: (operation, details) => call('diary_study', { operation, details }),
    deleteAccount: () => call('diary_delete_account', { confirmation: 'DELETE' })
  };
})();
