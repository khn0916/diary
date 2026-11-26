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
  const client = window.supabase?.createClient(
    'https://vyyihfaqdlyopjymfxyq.supabase.co',
    'sb_publishable_ckhHNDge1S8s_br6Rksofg_uOGgjxUv',
    { auth: { detectSessionInUrl: false, flowType: 'pkce' } }
  );
  const auth = client?.auth;

  const scripts = new Map();
  let afterLogin, userId, busy = false, signingUp = false, leaving = false;

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
    await load('pds-storage.js?v=3');
    window.diaryDatabase = client;
    await load('diary-cloud.js?v=1');
    try {
      const saved = await window.DiaryCloud.read(journal ? 'journal' : 'plans');
      if (journal) window.DiaryCloud.initialJournal = saved.content;
    } catch (error) {
      if (error.status === 401) {
        userId = null;
        const { error: signOutError } = await auth.signOut({ scope: 'local' });
        if (signOutError) throw signOutError;
        lock(true);
      }
      throw error;
    }
    if (journal) {
      await load('holidays.js?v=1');
      await load('app.js?v=15');
    } else {
      await load('diary-account.js?v=4');
      await load('pds-web.js?v=18');
    }
  }

  function lock(reauthenticate = false) {
    if (leaving) return;
    leaving = true;
    (journal || plans).hidden = true;
    document.getElementById('entryDialog')?.close();
    const destination = new URL(landing);
    if (reauthenticate) {
      destination.searchParams.set('login', plans ? 'pds' : '1');
      if (plans) destination.hash = location.hash;
    }
    location.replace(destination);
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
    if (error?.code === 'email_not_confirmed') return '이메일의 확인 링크를 먼저 눌러주세요.';
    if (error?.status === 429) return '로그인 요청이 많아요. 잠시 후 다시 시도해주세요.';
    if (error?.status >= 500 || error?.name === 'AuthRetryableFetchError') {
      return '로그인 서버에 연결할 수 없어요. 잠시 후 다시 시도해주세요.';
    }
    return '이메일과 비밀번호를 다시 확인해주세요.';
  }


  const confirmationNotice = '받은편지함에서 확인 링크를 눌러주세요. 이미 가입했다면 바로 로그인할 수 있어요.';

  async function register(credentials) {
    const { data, error } = await auth.signUp({
      ...credentials,
      options: { emailRedirectTo: 'https://khn0916.github.io/diary/' }
    });
    if (!error && data.session && data.user) {
      await unlock(data.user);
      return;
    }
    if (!error || error.code === 'user_already_exists' || error.code === 'email_exists') {
      setFormMode(false);
      message.textContent = confirmationNotice;
      return;
    }
    if (error.code === 'signup_disabled') {
      message.textContent = '지금은 공개 회원가입을 준비 중이에요.';
    } else if (error.code === 'email_address_not_authorized') {
      message.textContent = '현재 메일 설정에서 이 주소로 가입 확인 메일을 보낼 수 없어요.';
    } else if (error.code === 'weak_password') {
      message.textContent = '더 길고 추측하기 어려운 비밀번호를 입력해주세요.';
    } else if (error.status === 429) {
      message.textContent = '가입 요청이 많아요. 잠시 후 다시 시도해주세요.';
    } else {
      message.textContent = '가입을 완료하지 못했어요. 이메일 주소를 확인하고 다시 시도해주세요.';
    }
  }

  function setFormMode(registering) {
    signingUp = registering;
    const { password, passwordConfirm } = form.elements;
    const confirmation = document.getElementById('signupConfirm');
    confirmation.hidden = !registering;
    password.autocomplete = registering ? 'new-password' : 'current-password';
    password.minLength = registering ? 8 : 0;
    password.value = passwordConfirm.value = '';
    passwordConfirm.required = registering;
    passwordConfirm.disabled = !registering;
    document.getElementById('loginTitle').textContent = registering ? '여백 회원가입' : '여백 로그인';
    document.getElementById('loginDescription').textContent = registering
      ? '나만의 계정을 만들어보세요.'
      : '로그인하고 나의 기록을 이어가세요.';
    form.querySelector('.login-submit').textContent = registering ? '가입하기' : '로그인';
    document.getElementById('signupSwitch').textContent = registering ? '로그인으로 돌아가기' : '회원가입';
    message.textContent = '';
  }

  async function confirmEmail(code, flowId) {
    const page = new URL(location.href);
    page.searchParams.delete('code');
    page.searchParams.delete('sb_flow_id');
    history.replaceState(history.state, '', page);
    let confirmed = false;
    try {
      if (auth) {
        const { data, error } = await auth.exchangeCodeForSession(code, { flowId });
        confirmed = !error && !!data.session;
      }
    } catch {
      // Another browser can confirm the address but will not have the PKCE verifier.
    }
    if (confirmed) {
      document.getElementById('coverInvitation').textContent = '이메일 확인이 끝났어요. 표지를 눌러 다이어리를 펼쳐보세요.';
    } else {
      showLogin('이메일 확인 링크를 열었어요. 가입할 때 입력한 이메일과 비밀번호로 로그인해주세요.');
    }
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
    document.getElementById('signupSwitch').addEventListener('click', () => {
      setFormMode(!signingUp);
      form.elements.email.focus();
    });
    dialog.querySelector('[data-login-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('close', () => {
      form.reset();
      setFormMode(false);
      coverButton.focus();
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || !auth) return;
      const { email, password, passwordConfirm } = form.elements;
      if (signingUp && password.value !== passwordConfirm.value) {
        message.textContent = '두 비밀번호가 같도록 다시 입력해주세요.';
        passwordConfirm.focus();
        return;
      }
      const credentials = { email: email.value.trim(), password: password.value };
      busy = true;
      let credentialsAccepted = false;
      editForm(true);
      message.textContent = signingUp ? '가입 요청을 보내는 중이에요…' : '로그인하는 중이에요…';
      try {
        if (signingUp) {
          password.value = passwordConfirm.value = '';
          await register(credentials);
          return;
        }
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
    logout.textContent = '로그아웃 중…';
    try {
      await window.savePendingDiaryNotes?.();
      const { error } = await auth.signOut({ scope: 'global' });
      if (error) throw error;
      lock();
    } catch {
      const status = document.getElementById('saveStatus') || document.getElementById('appStatus');
      status.textContent = '저장이나 로그아웃을 마치지 못했어요. 연결을 확인하고 다시 시도해주세요.';
      logout.textContent = '로그아웃';
      logout.disabled = false;
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
  } else {
    const params = new URLSearchParams(location.search);
    if (params.has('code')) confirmEmail(params.get('code'), params.get('sb_flow_id') || undefined);
    else if (params.get('login') === '1') {
      document.addEventListener('DOMContentLoaded', () => coverButton.click(), { once: true });
    }
  }
})();
