/* IndexedDB transactions serialize simultaneous updates, including other tabs. */
(function () {
  'use strict';
  let connection;
  const accountId = window.diaryAccountId;
  const documentKey = accountId ? 'account:' + accountId : 'current';
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('yeobaek-pds-updates:' + documentKey) : null;
  async function open() {
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('브라우저 저장소를 사용할 수 없습니다. 일반 브라우저 창에서 다시 열어주세요.')); return; }
      const request = indexedDB.open('yeobaek-pds', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('documents');
      request.onerror = () => reject(new Error('저장소를 열지 못했습니다. 브라우저 저장소 설정을 확인해주세요.'));
      request.onblocked = () => reject(new Error('다른 탭을 닫고 화면을 다시 열어주세요.'));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); connection = null; };
        resolve(db);
      };
    });
    try { return await connection; } catch (error) { connection = null; throw error; }
  }
  async function transaction(command, replacement) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let result, failure;
      const tx = db.transaction('documents', command || replacement ? 'readwrite' : 'readonly');
      const store = tx.objectStore('documents');
      const request = store.get(documentKey);
      request.onsuccess = () => {
        try {
          const current = replacement ? null : request.result ? PDSModel.validate(request.result) : PDSModel.empty();
          result = replacement ? { state: PDSModel.validate(replacement) } : command ? PDSModel.apply(current, command) : { state: current };
          if (command || replacement) store.put(result.state, documentKey);
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => { if (command || replacement) channel?.postMessage('saved'); resolve(result); };
      tx.onabort = tx.onerror = () => reject(failure || new Error('저장하지 못했습니다. 입력 내용을 보관하고 저장 공간을 확인해주세요.'));
    });
  }
  window.PDSStorage = { read: () => transaction(), write: command => transaction(command), restore: data => transaction(null, data), channel };
})();
