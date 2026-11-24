(function () {
  'use strict';

  const root = new URL('.', document.currentScript.src);
  const journal = document.getElementById('diaryWorkspace');
  const plans = document.getElementById('plansWorkspace');
  const dialog = document.getElementById('loginDialog');
  const form = document.getElementById('loginForm');
  const message = document.getElementById('loginStatus');
  const coverButton = document.getElementById('openDiary');
  const logout = document.getElementById('logoutDiary');
  const landing = new URL('index.html', root);
  const planPage = new URL('pds/index.html', root);
  const fromPlans = new URLSearchParams(location.search).get('login') === 'pds';
  const auth = window.supabase?.createClient(
    'https://vyyihfaqdlyopjymfxyq.supabase.co',
    'sb_publishable_ckhHNDge1S8s_br6Rksofg_uOGgjxUv',
    { auth: { detectSessionInUrl: false } }
  ).auth;

  const scripts = new Map();
  let afterLogin, userId, busy = false;

  function load(path) {
    if (!scripts.has(path)) {
      scripts.set(path, new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = new URL(path, root);
        script.onload = resolve;
        script.onerror = reject;
        document.head.append(script);
      }).catch(error => {
        scripts.delete(path);
        throw error;
      }));
    }
    return scripts.get(path);
  }

  async function prepare(user) {
    userId = user.id;
    Object.defineProperty(window, 'diaryAccountId', { value: userId, configurable: true });
    await load('pds-model.js?v=5');
    await load('pds-storage.js?v=2');
    if (journal) {
      await load('holidays.js?v=1');
      await load('app.js?v=14');
    } else {
      await load('pds-web.js?v=14');
    }
  }

  function lock() {
    (journal || plans).hidden = true;
    document.getElementById('entryDialog')?.close();
    location.replace(landing);
  }

  function editForm(disabled) {
    form.querySelector('fieldset').disabled = disabled;
    dialog.querySelector('[data-login-close]').disabled = disabled;
  }

  function showLogin(text = '') {
    message.textContent = text;
    if (!dialog.open) dialog.showModal();
    if (!auth) form.querySelector('fieldset').disabled = true;
  }

  function authenticationMessage(error) {
    if (error?.status === 429) return '로그인 요청이 많아요. 잠시 후 다시 시도해주세요.';
    if (error?.status >= 500 || error?.name === 'AuthRetryableFetchError') {
      return '로그인 서버에 연결할 수 없어요. 잠시 후 다시 시도해주세요.';
    }
    return '이메일과 비밀번호를 다시 확인해주세요.';
  }

  async function unlock(user) {
    if (fromPlans) {
      planPage.hash = location.hash;
      location.replace(planPage);
      return;
    }
    await prepare(user);
    if (dialog?.open) dialog.close();
    afterLogin?.();
  }

  async function checkSession() {
    const { data, error } = await auth.getUser();
    if (!error) return data.user;
    if (error.name === 'AuthSessionMissingError' || error.status === 401 || error.status === 403) return null;
    throw error;
  }

  async function enter(open) {
    if (busy || dialog.open) return;
    afterLogin = open;
    if (!auth) {
      showLogin('로그인 기능을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.');
      return;
    }
    busy = true;
    coverButton.disabled = true;
    try {
      const user = await checkSession();
      if (user) await unlock(user);
      else showLogin();
    } catch {
      showLogin('다이어리를 열 수 없어요. 연결 상태를 확인한 뒤 다시 시도해주세요.');
    } finally {
      busy = false;
      if (journal.hidden) coverButton.disabled = false;
    }
  }

  window.DiaryAuth = { enter };

  if (form) {
    editForm(false);
    dialog.querySelector('[data-login-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('close', () => {
      form.reset();
      message.textContent = '';
      coverButton.focus();
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || !auth) return;
      const { email, password } = form.elements;
      const credentials = { email: email.value.trim(), password: password.value };
      busy = true;
      let credentialsAccepted = false;
      editForm(true);
      message.textContent = '로그인하는 중이에요…';
      try {
        const { data, error } = await auth.signInWithPassword(credentials);
        if (error || !data?.session || !data.user) {
          message.textContent = authenticationMessage(error);
          password.value = '';
          return;
        }
        credentialsAccepted = true;
        password.value = '';
        await unlock(data.user);
      } catch {
        message.textContent = credentialsAccepted
          ? '다이어리를 불러오지 못했어요. 새로고침 후 표지를 다시 눌러주세요.'
          : '로그인 서버에 연결할 수 없어요. 잠시 후 다시 시도해주세요.';
      } finally {
        busy = false;
        editForm(false);
        if (dialog.open) password.focus();
      }
    });
  }

  if (auth) {
    auth.onAuthStateChange((event, session) => {
      if (userId && (event === 'SIGNED_OUT' || (session?.user && session.user.id !== userId))) lock();
    });
  }

  logout?.addEventListener('click', async () => {
    logout.disabled = true;
    try {
      await auth.signOut({ scope: 'local' });
    } catch {
      // Even if the network is unavailable, leave the record screen.
    } finally {
      lock();
    }
  });

  if (plans) {
    (async () => {
      try {
        const user = auth && await checkSession();
        if (user) {
          await prepare(user);
          plans.hidden = false;
        } else {
          const loginPage = new URL(landing);
          loginPage.searchParams.set('login', 'pds');
          loginPage.hash = location.hash;
          location.replace(loginPage);
        }
      } catch {
        document.getElementById('plansLoginError').hidden = false;
      }
    })();
  } else if (fromPlans) {
    enter(() => {});
  }
})();
