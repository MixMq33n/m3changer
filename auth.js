// Accounts on Firebase: email + password with email verification, Google sign-in, profile in Firestore (users/{uid}).
// Visitors never see Firebase pages: Google opens its own account chooser via Google Identity Services, and the
// links in verification / reset emails come back to this site (see handleAction), once the action URL is set in the console.
// Same markup and routes as before (#auth?mode=…, #account/…); commerce.js still receives the 'm3-session' event.
import { firebaseConfig, googleClientId, download } from './firebase-config.js';
const SDK = 'https://www.gstatic.com/firebasejs/11.0.2/';
const $ = selector => document.querySelector(selector);
const dialog = $('#authDialog'), form = $('#authForm'), message = $('#authMessage');
let fb = null, auth = null, db = null, initError = '', tokenClient = null, tokenWaiter = null;
let user = null, mode = 'register', ready = false, busy = false, previousHash = '', goAccount = false, pending = null;
const settings = { providers: { google: true }, download: { available: !!download.url, version: download.version }, commerce: { plans: [] } };

const errors = {
  'auth/email-already-in-use': 'Аккаунт с этим email уже есть. Войди или восстанови пароль.',
  'auth/invalid-credential': 'Неверный email или пароль.',
  'auth/wrong-password': 'Неверный email или пароль.',
  'auth/user-not-found': 'Неверный email или пароль.',
  'auth/invalid-email': 'Укажи корректный email.',
  'auth/weak-password': 'Пароль слишком простой. Нужно не менее 10 символов.',
  'auth/too-many-requests': 'Слишком много попыток. Подожди немного и попробуй снова.',
  'auth/network-request-failed': 'Нет соединения. Проверь интернет и попробуй ещё раз.',
  'auth/popup-blocked': 'Браузер заблокировал окно Google. Разреши всплывающие окна для сайта.',
  'auth/account-exists-with-different-credential': 'Этот email уже зарегистрирован другим способом. Войди по email и паролю.',
  'auth/unauthorized-domain': 'Этот адрес сайта ещё не добавлен в настройки входа Firebase.',
  'auth/operation-not-allowed': 'Этот способ входа ещё не включён в Firebase.',
  'auth/user-disabled': 'Аккаунт отключён. Напиши в поддержку.',
  'auth/configuration-not-found': 'Вход ещё не включён в настройках Firebase (Authentication → Sign-in method).',
  'auth/invalid-action-code': 'Ссылка устарела или уже использована. Запроси новое письмо.',
  'auth/expired-action-code': 'Ссылка устарела. Запроси новое письмо.',
  'permission-denied': 'Профиль не сохранился: проверь правила Firestore.'
};
const explain = error => errors[error && error.code] || (error && error.message) || 'Не удалось выполнить действие.';
function announce(element, text, error = false) { element.textContent = text; element.classList.toggle('is-error', error); }
// Email links come straight back to this page with ?mode=…&oobCode=… (handleCodeInApp), so the code is applied here
// even while the console keeps Firebase's default action URL. Firebase appends the query, so the URL has no hash.
const backTo = () => ({ url: location.origin + location.pathname, handleCodeInApp: true });

async function boot() {
  try {
    const [app, a, f] = await Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')]);
    fb = { ...a, ...f };
    const instance = app.initializeApp(firebaseConfig);
    auth = a.getAuth(instance); auth.languageCode = 'ru';
    db = f.getFirestore(instance);
    if (googleClientId) loadGoogle();
    await auth.authStateReady();
    await handleAction();
    a.onAuthStateChanged(auth, async current => {
      user = current ? await view(current) : null;
      ready = true; paintAccount();
      if (user && goAccount) { goAccount = false; location.hash = 'account/profile'; }
      route();
    });
  } catch (error) {
    initError = 'Вход временно недоступен: не удалось загрузить сервис входа. Проверь интернет и обнови страницу.';
    ready = true; paintAccount(); route();
  }
}

// Google Identity Services token client: the click opens Google's own chooser on accounts.google.com.
// It is prepared in advance because browsers only allow the popup straight from the click.
function loadGoogle() {
  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
  script.onload = () => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: googleClientId, scope: 'openid email profile', prompt: 'select_account',
      callback: response => { const w = tokenWaiter; tokenWaiter = null; if (!w) return; if (response.error) w.reject(Object.assign(new Error(response.error_description || response.error), { code: 'gis/' + response.error })); else w.resolve(response.access_token); },
      error_callback: error => { const w = tokenWaiter; tokenWaiter = null; if (w) w.reject(Object.assign(new Error(error.message || error.type), { code: error.type === 'popup_closed' ? 'auth/popup-closed-by-user' : error.type === 'popup_failed_to_open' ? 'auth/popup-blocked' : 'gis/' + error.type })); }
    });
  };
  document.head.append(script);
}
function googleAccessToken() { return new Promise((resolve, reject) => { tokenWaiter = { resolve, reject }; tokenClient.requestAccessToken(); }); }

// Links from Firebase emails land here (?mode=…&oobCode=…) once the action URL points at this site.
async function handleAction() {
  const query = new URLSearchParams(location.search), action = query.get('mode'), code = query.get('oobCode');
  if (!action || !code) return;
  history.replaceState(null, '', location.pathname + location.hash);
  const box = $('#actionDialog'), title = $('#actionTitle'), text = $('#actionText'), reset = $('#resetForm');
  reset.hidden = true; announce($('#actionMessage'), '');
  const show = (heading, body) => { title.textContent = heading; text.textContent = body; if (!box.open) box.showModal(); };
  try {
    if (action === 'verifyEmail') { await fb.applyActionCode(auth, code); if (auth.currentUser) await fb.reload(auth.currentUser).catch(() => {}); show('Email подтверждён', 'Готово. Адрес подтверждён, аккаунт M3 полностью активен.'); $('#actionClose').dataset.next = 'account/profile'; }
    else if (action === 'recoverEmail') { await fb.applyActionCode(auth, code); show('Email восстановлен', 'Адрес аккаунта возвращён. Если это был не ты, смени пароль.'); }
    else if (action === 'resetPassword') {
      const email = await fb.verifyPasswordResetCode(auth, code);
      show('Новый пароль', 'Придумай новый пароль для ' + email + '.'); reset.hidden = false; $('#resetPassword').focus();
      reset.onsubmit = async event => {
        event.preventDefault();
        if ($('#resetPassword').value !== $('#resetConfirm').value) { announce($('#actionMessage'), 'Пароли не совпадают.', true); return; }
        $('#resetSubmit').disabled = true;
        try { await fb.confirmPasswordReset(auth, code, $('#resetPassword').value); reset.hidden = true; show('Пароль изменён', 'Теперь войди с новым паролем.'); $('#actionClose').dataset.next = 'auth?mode=login'; }
        catch (error) { announce($('#actionMessage'), explain(error), true); }
        finally { $('#resetSubmit').disabled = false; }
      };
    }
  } catch (error) {
    show('Ссылка не сработала', ['auth/invalid-action-code', 'auth/expired-action-code'].includes(error.code) ? 'Ссылка устарела или уже использована. Запроси новое письмо.' : explain(error));
  }
}

// Profile document: created on first sign-in (email or Google), then only the name changes.
async function view(current) {
  const ref = fb.doc(db, 'users', current.uid);
  let data = null;
  try {
    const snap = await fb.getDoc(ref);
    if (snap.exists()) data = snap.data();
    else {
      let name = ((pending && pending.name) || current.displayName || current.email.split('@')[0] || '').trim().slice(0, 60);
      if (name.length < 2) name = current.email.split('@')[0].slice(0, 60);
      data = { name, email: current.email, promo_code: (pending && pending.promo) || null, created_at: fb.serverTimestamp() };
      await fb.setDoc(ref, data);
      data = { ...data, created_at: null };
    }
  } catch (error) {
    data = { name: current.displayName || current.email.split('@')[0], email: current.email, promo_code: null, created_at: null };
    announce($('#accountMessage'), explain(error), true);
  }
  pending = null;
  const created = data.created_at && data.created_at.seconds ? data.created_at.seconds : Date.parse(current.metadata.creationTime) / 1000;
  const providers = current.providerData.map(p => p.providerId);
  return { uid: current.uid, name: data.name, email: current.email, promo_code: data.promo_code, created_at: created, email_verified: current.emailVerified, hasPassword: providers.includes('password'), providers: providers.includes('google.com') ? ['google'] : [] };
}

function setMode(value) {
  mode = value; const registering = mode === 'register';
  $('#authTitle').textContent = registering ? 'Твоя коллекция начинается здесь.' : 'С возвращением.';
  $('#authSubtitle').textContent = registering ? 'Создай аккаунт M3 или продолжи через Google.' : 'Войди, чтобы открыть личный кабинет.';
  $('#authSubmit').textContent = registering ? 'Создать аккаунт' : 'Войти';
  document.querySelectorAll('[data-auth-mode]').forEach(button => { const selected = button.dataset.authMode === mode; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; });
  document.querySelectorAll('[data-register-only]').forEach(element => { element.hidden = !registering; element.querySelectorAll('input').forEach(input => { input.disabled = !registering; input.required = registering && input.name !== 'promo'; }); });
  document.querySelectorAll('[data-login-only]').forEach(element => element.hidden = registering);
  $('#authPassword').autocomplete = registering ? 'new-password' : 'current-password';
  $('#authPassword').minLength = registering ? 10 : 1;
  $('#authPassword').placeholder = registering ? 'Не менее 10 символов' : 'Твой пароль';
  announce(message, initError, !!initError);
}

function paintAccount() {
  document.dispatchEvent(new CustomEvent('m3-session', { detail: { user, csrf: '', settings } }));
  $('#accountButton').textContent = user ? 'Личный кабинет' : 'Войти';
  if (!user) return;
  $('#accountName').textContent = user.name;
  $('#accountEmail').textContent = user.email;
  $('#accountAvatar').textContent = Array.from(user.name)[0].toUpperCase();
  $('#profileName').value = user.name;
  $('#profileEmail').value = user.email;
  $('#profilePromo').textContent = user.promo_code || 'Не указан';
  $('#profileCreated').textContent = new Date(user.created_at * 1000).toLocaleDateString('ru-RU');
  $('#profileProviders').textContent = [...(user.hasPassword ? ['Email и пароль'] : []), ...user.providers.map(() => 'Google')].join(' · ');
  $('#emailStatus').textContent = user.email_verified ? 'Email подтверждён' : 'Подтверди email: мы отправили письмо на ' + user.email + '.';
  $('#resendEmail').hidden = user.email_verified;
  $('#downloadVersion').textContent = 'M3 Changer ' + settings.download.version;
  $('#accountDownload').disabled = !settings.download.available;
  $('#downloadAvailability').textContent = settings.download.available ? 'Windows 10 / 11 · нужен установленный Dota 2' : 'Ссылка на установщик появится здесь позже.';
}

function showLanding() { document.querySelector('main').hidden = false; $('#accountView').hidden = true; }
function route() {
  // The sign-in dialog opens at once; everything that depends on the session waits for Firebase.
  if (!ready && !location.hash.startsWith('#auth')) return;
  const wasAccount = !$('#accountView').hidden, fragment = location.hash.slice(1);
  if (fragment.startsWith('account/')) {
    if (!user) { location.hash = 'auth?mode=login'; return; }
    if (dialog.open) dialog.close();
    document.querySelector('main').hidden = true; $('#accountView').hidden = false;
    const tab = fragment.split('/')[1], selected = ['profile', 'access', 'download'].includes(tab) ? tab : 'profile';
    document.querySelectorAll('[data-account-tab]').forEach(button => { const active = button.dataset.accountTab === selected; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
    document.querySelectorAll('[data-account-panel]').forEach(panel => panel.hidden = panel.dataset.accountPanel !== selected);
    paintAccount(); void refreshVerification(); return;
  }
  showLanding();
  if (wasAccount && !fragment.startsWith('auth')) requestAnimationFrame(() => document.getElementById(fragment)?.scrollIntoView({ behavior: typeof motion !== 'undefined' && motion ? 'smooth' : 'instant' }));
  if (fragment.startsWith('auth')) {
    if (ready && user) { location.hash = 'account/profile'; return; }
    const params = new URLSearchParams(fragment.split('?')[1]);
    setMode(params.get('mode') === 'login' ? 'login' : 'register');
    if (!dialog.open) dialog.showModal();
  } else if (dialog.open) dialog.close();
}

// The verification link opens Firebase's page; when the person comes back, pick up the new status.
async function refreshVerification() {
  if (!auth || !auth.currentUser || auth.currentUser.emailVerified) return;
  try { await fb.reload(auth.currentUser); if (auth.currentUser.emailVerified) { user = { ...user, email_verified: true }; paintAccount(); } } catch {}
}

function setBusy(value, label) {
  busy = value; $('#authSubmit').disabled = value; form.setAttribute('aria-busy', String(value));
  $('#authSubmit').textContent = value ? label : (mode === 'register' ? 'Создать аккаунт' : 'Войти');
  document.querySelectorAll('[data-oauth]').forEach(button => button.disabled = value);
}

form.addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  if (!auth) { announce(message, initError || 'Сервис входа ещё загружается. Попробуй через секунду.', true); return; }
  const values = Object.fromEntries(new FormData(form)), email = String(values.email || '').trim(), password = String(values.password || '');
  if (mode === 'register' && password !== $('#authConfirm').value) { announce(message, 'Пароли не совпадают.', true); $('#authConfirm').focus(); return; }
  setBusy(true, mode === 'register' ? 'Создаём аккаунт…' : 'Входим…'); announce(message, '');
  try {
    if (mode === 'register') {
      pending = { name: String(values.name || '').trim(), promo: String(values.promo || '').trim() || null };
      goAccount = true;
      const credential = await fb.createUserWithEmailAndPassword(auth, email, password);
      await fb.updateProfile(credential.user, { displayName: pending ? pending.name : String(values.name || '').trim() }).catch(() => {});
      try { await fb.sendEmailVerification(credential.user, backTo('#account/profile')); }
      catch (error) { if (error.code === 'auth/unauthorized-continue-uri') await fb.sendEmailVerification(credential.user); else throw error; }
    } else {
      goAccount = true;
      await fb.signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) { goAccount = false; pending = null; announce(message, explain(error), true); }
  finally { setBusy(false); }
});

document.querySelectorAll('[data-oauth]').forEach(button => button.addEventListener('click', async () => {
  if (busy) return;
  if (!auth) { announce(message, initError || 'Сервис входа ещё загружается. Попробуй через секунду.', true); return; }
  const promo = mode === 'register' ? $('#authPromo').value.trim() : '';
  if (promo && !$('#authPromo').checkValidity()) { $('#authPromo').reportValidity(); return; }
  if (!tokenClient) { announce(message, googleClientId ? 'Вход через Google ещё загружается. Попробуй через секунду.' : 'Вход через Google ещё не настроен. Войди по email.', true); return; }
  const token = googleAccessToken();
  setBusy(true, mode === 'register' ? 'Создать аккаунт' : 'Войти'); announce(message, '');
  try {
    const accessToken = await token;
    pending = { name: '', promo: promo || null }; goAccount = true;
    await fb.signInWithCredential(auth, fb.GoogleAuthProvider.credential(null, accessToken));
  } catch (error) {
    goAccount = false; pending = null;
    if (!['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(error.code)) announce(message, explain(error), true);
  } finally { setBusy(false); }
}));

$('#forgotPassword').addEventListener('click', async () => {
  const field = $('#authEmail'), email = field.value.trim();
  if (!email || !field.checkValidity()) { announce(message, 'Впиши email выше, и мы пришлём ссылку для смены пароля.', true); field.focus(); return; }
  if (!auth) { announce(message, initError, true); return; }
  try { await fb.sendPasswordResetEmail(auth, email, backTo('#auth?mode=login')); }
  catch (error) { if (error.code === 'auth/unauthorized-continue-uri') { try { await fb.sendPasswordResetEmail(auth, email); } catch (e) { announce(message, explain(e), true); return; } } else if (error.code !== 'auth/user-not-found') { announce(message, explain(error), true); return; } }
  announce(message, 'Если аккаунт с адресом ' + email + ' существует, письмо со ссылкой уже в пути. Проверь также «Спам».');
});

$('#resendEmail').addEventListener('click', async () => {
  const button = $('#resendEmail'); button.disabled = true;
  try {
    try { await fb.sendEmailVerification(auth.currentUser, backTo('#account/profile')); }
    catch (error) { if (error.code === 'auth/unauthorized-continue-uri') await fb.sendEmailVerification(auth.currentUser); else throw error; }
    announce($('#emailMessage'), 'Письмо отправлено на ' + user.email + '. Проверь также папку «Спам».');
  } catch (error) { announce($('#emailMessage'), explain(error), true); }
  finally { button.disabled = false; }
});

document.querySelectorAll('[data-open-auth]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); previousHash = location.hash; location.hash = user ? 'account/profile' : 'auth?mode=' + button.dataset.openAuth; if (location.hash.startsWith('#auth')) route(); }));
$('#accountButton').addEventListener('click', () => { previousHash = location.hash; location.hash = user ? 'account/profile' : 'auth?mode=login'; route(); });
document.querySelectorAll('[data-auth-mode]').forEach((button, index, buttons) => {
  button.addEventListener('click', () => setMode(button.dataset.authMode));
  button.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + 1) % buttons.length; buttons[next].focus(); setMode(buttons[next].dataset.authMode); });
});
dialog.addEventListener('close', () => { form.reset(); $('#authPassword').type = 'password'; $('#passwordReveal').setAttribute('aria-pressed', 'false'); $('#passwordReveal').textContent = 'Показать'; if (location.hash.startsWith('#auth')) { history.replaceState(null, '', previousHash || location.pathname); showLanding(); } });
$('#passwordReveal').addEventListener('click', () => { const shown = $('#authPassword').type === 'text'; $('#authPassword').type = shown ? 'password' : 'text'; $('#passwordReveal').textContent = shown ? 'Показать' : 'Скрыть'; $('#passwordReveal').setAttribute('aria-pressed', String(!shown)); });
document.querySelectorAll('[data-account-tab]').forEach((button, index, buttons) => {
  button.addEventListener('click', () => location.hash = 'account/' + button.dataset.accountTab);
  button.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length; buttons[next].focus(); location.hash = 'account/' + buttons[next].dataset.accountTab; });
});
$('#profileForm').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('#profileSave'), name = $('#profileName').value.trim();
  if (name.length < 2 || name.length > 60) { announce($('#profileMessage'), 'Имя должно содержать от 2 до 60 символов.', true); return; }
  button.disabled = true; announce($('#profileMessage'), '');
  try { await fb.updateDoc(fb.doc(db, 'users', user.uid), { name }); await fb.updateProfile(auth.currentUser, { displayName: name }).catch(() => {}); user = { ...user, name }; paintAccount(); announce($('#profileMessage'), 'Изменения сохранены.'); }
  catch (error) { announce($('#profileMessage'), explain(error), true); }
  finally { button.disabled = false; }
});
$('#logoutButton').addEventListener('click', async () => { const button = $('#logoutButton'); button.disabled = true; try { await fb.signOut(auth); location.hash = 'top'; } catch (error) { announce($('#accountMessage'), explain(error), true); } finally { button.disabled = false; } });
$('#accountDownload').addEventListener('click', () => { if (user && settings.download.available) location.assign(download.url); });
$('#actionClose').addEventListener('click', () => { const next = $('#actionClose').dataset.next || (user ? 'account/profile' : ''); delete $('#actionClose').dataset.next; $('#actionDialog').close(); if (next) location.hash = next; else route(); });
addEventListener('hashchange', route);
addEventListener('focus', () => { void refreshVerification(); });
route();
void boot();
