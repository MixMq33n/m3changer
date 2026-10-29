// Checkout window: plan, installation ID and payment method, opened from the price cards and the account "Доступ" tab.
// Payment goes through the Yandex Cloud function (payments-function/, T-Bank): it creates the order and the payment,
// and after the bank confirms it writes the M3 key into the order, which the "Доступ" tab shows live.
import { PLANS, rub, perDay } from './plans.js';
import { paymentsUrl } from './firebase-config.js';
const $ = selector => document.querySelector(selector);
const dialog = $('#checkoutDialog'), form = $('#payForm'), message = $('#payMessage');
const DEVICE = /^[0-9A-F]{4}(-[0-9A-F]{4}){7}$/, PENDING = 'm3-pending-plan', LAST_DEVICE = 'm3-device';
let user = null, plan = PLANS.find(p => p.id === 'month') || PLANS[0];

function say(text, error = false) { message.textContent = text; message.classList.toggle('is-error', error); }

$('#payPlans').innerHTML = PLANS.map(p => `<button type="button" class="pay-plan" role="radio" data-pay-plan="${p.id}" aria-checked="false"><b>${p.name}</b><span>${rub(p.price)}</span></button>`).join('');

function paint() {
  document.querySelectorAll('[data-pay-plan]').forEach(button => { const on = button.dataset.payPlan === plan.id; button.setAttribute('aria-checked', String(on)); button.tabIndex = on ? 0 : -1; });
  $('#payPlanName').textContent = 'M3 Changer · ' + plan.name;
  $('#payPerDay').textContent = perDay(plan);
  $('#payTotal').textContent = rub(plan.price);
  $('#paySubmit').textContent = 'Оплатить ' + rub(plan.price);
  const verified = !!(user && user.email_verified);
  $('#payVerify').hidden = !user || verified;
  $('#paySubmit').disabled = !verified;
}

export function openCheckout(id, device) {
  plan = PLANS.find(p => p.id === id) || plan;
  let saved = '';
  try { saved = localStorage.getItem(LAST_DEVICE) || ''; } catch {}
  $('#payDevice').value = device || $('#payDevice').value || saved;
  say(''); paint();
  if (!dialog.open) dialog.showModal();
  // Confirmed in another tab or on the phone: pick that up before blocking the payment.
  if (user && !user.email_verified && window.M3Session) void window.M3Session.refresh();
}

$('#payVerifyCheck').addEventListener('click', async () => {
  const button = $('#payVerifyCheck'); button.disabled = true;
  const verified = window.M3Session ? await window.M3Session.refresh() : false;
  button.disabled = false;
  if (!verified) say('Почта пока не подтверждена. Открой письмо от M3 Changer и нажми ссылку, затем снова «Я подтвердил».', true);
  else say('');
});

$('#payPlans').addEventListener('click', event => { const button = event.target.closest('[data-pay-plan]'); if (!button) return; plan = PLANS.find(p => p.id === button.dataset.payPlan); say(''); paint(); });
$('#payPlans').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault();
  const index = PLANS.indexOf(plan), next = PLANS[(index + (event.key === 'ArrowRight' ? 1 : PLANS.length - 1)) % PLANS.length];
  plan = next; paint(); document.querySelector(`[data-pay-plan="${next.id}"]`).focus();
});

// "Выбрать" on a price card: straight to checkout when signed in, otherwise sign up first and continue afterwards.
document.addEventListener('click', event => {
  const button = event.target.closest('[data-choose-plan]'); if (!button) return;
  event.preventDefault();
  if (user) { openCheckout(button.dataset.choosePlan); return; }
  try { sessionStorage.setItem(PENDING, button.dataset.choosePlan); } catch {}
  location.hash = 'auth?mode=register';
});

// The account "Доступ" form opens the same window instead of the old server checkout.
document.addEventListener('submit', event => {
  if (event.target.id !== 'checkoutForm') return;
  event.preventDefault(); event.stopImmediatePropagation();
  openCheckout($('#billingPlan').value, $('#billingDevice').value.trim());
}, true);

document.addEventListener('m3-session', event => {
  user = event.detail.user;
  if (dialog.open) paint();
  paintAccessForm();
  watch();
  if (!user) return;
  let pending = null;
  try { pending = sessionStorage.getItem(PENDING); sessionStorage.removeItem(PENDING); } catch {}
  if (pending) setTimeout(() => openCheckout(pending), 350);
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!user) { dialog.close(); location.hash = 'auth?mode=login'; return; }
  const device = $('#payDevice').value.trim().toUpperCase();
  if (!DEVICE.test(device)) { say('Вставь ID установки из окна активации M3: 8 групп по 4 символа через дефис.', true); $('#payDevice').focus(); return; }
  $('#payDevice').value = device;
  try { localStorage.setItem(LAST_DEVICE, device); } catch {}
  const order = { plan: plan.id, days: plan.days, amount: plan.price, currency: 'RUB', method: form.elements.payMethod.value, device, uid: user.uid, email: user.email };
  const button = $('#paySubmit'); button.disabled = true; say('');
  try { await startPayment(order); }
  catch (error) { say(error && error.message ? error.message : 'Не удалось начать оплату. Попробуй ещё раз.', true); }
  finally { paint(); }
});

async function callPayments(route, body) {
  const token = await window.M3Session.idToken();
  const response = await fetch(paymentsUrl + (paymentsUrl.includes('?') ? '&' : '?') + 'route=' + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-M3-Token': token }, body: JSON.stringify(body)
  });
  let result = {};
  try { result = await response.json(); } catch {}
  if (!response.ok) throw new Error(result.error || 'Сервис оплаты не ответил (' + response.status + '). Попробуй ещё раз.');
  return result;
}

// The server decides the price from the plan id; the browser only says which plan and which installation.
async function startPayment(order) {
  if (!paymentsUrl) { say('Приём оплаты скоро появится. Деньги не списаны.'); return; }
  say('Создаём платёж…');
  const { orderId, paymentUrl } = await callPayments('create', { plan: order.plan, device: order.device });
  try { sessionStorage.setItem('m3-last-order', orderId); } catch {}
  location.assign(paymentUrl);
}

// Account "Доступ" tab: plan list in the form, and orders with keys straight from Firestore (updates by itself).
const STATUS = { new: 'Создаётся', pending: 'Ожидает оплаты', paid: 'Оплачено', review: 'Проверяется', rejected: 'Оплата не прошла', canceled: 'Отменён', expired: 'Время оплаты истекло', refunded: 'Возврат', error: 'Не создан' };
let watching = null, stopWatching = null;
function paintAccessForm() {
  const select = $('#billingPlan');
  if (!select.options.length) { select.innerHTML = PLANS.map(p => `<option value="${p.id}">${p.name} · ${rub(p.price)}</option>`).join(''); select.value = 'month'; }
  $('#checkoutSubmit').disabled = !user;
  $('#billingSetup').textContent = paymentsUrl ? 'Оплата через ЮKassa: карта, СБП и другие способы. Ключ появится здесь сам сразу после оплаты.' : 'Приём оплаты скоро появится.';
}
function watch() {
  const uid = user && user.uid;
  if (uid === watching) return;
  if (stopWatching) stopWatching();
  watching = uid; stopWatching = null;
  if (!uid || !window.M3Session) { renderOrders([]); return; }
  stopWatching = window.M3Session.watchOrders(uid, orders => { renderOrders(orders); checkReturning(orders); });
}
function renderOrders(orders) {
  const root = $('#billingOrders'); root.replaceChildren();
  const list = (orders || []).filter(o => o.status !== 'new').sort((a, b) => (b.createdTs || 0) - (a.createdTs || 0));
  if (!list.length) { const p = document.createElement('p'); p.textContent = orders === null ? 'Не удалось загрузить заказы. Обнови страницу.' : 'Покупок пока нет.'; root.append(p); return; }
  for (const order of list) {
    const card = document.createElement('article'); card.className = 'billing-order' + (order.status === 'paid' ? ' is-paid' : '');
    const head = document.createElement('div'); head.className = 'order-head';
    const title = document.createElement('strong'); title.textContent = (order.name || order.days + ' дней') + ' · ' + rub(order.amount);
    const badge = document.createElement('span'); badge.className = 'order-status status-' + order.status; badge.textContent = STATUS[order.status] || order.status;
    head.append(title, badge);
    const meta = document.createElement('p'); meta.className = 'order-meta';
    meta.textContent = 'ID …' + String(order.device || '').slice(-9) + (order.createdTs ? ' · ' + new Date(order.createdTs * 1000).toLocaleDateString('ru-RU') : '');
    card.append(head, meta);
    if (order.status === 'paid' && order.key) {
      const row = document.createElement('div'); row.className = 'order-key';
      const key = document.createElement('code'); key.textContent = order.key;
      const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'button small'; copy.textContent = 'Копировать';
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(order.key); copy.textContent = 'Скопировано'; } catch { getSelection().selectAllChildren(key); copy.textContent = 'Нажми Ctrl+C'; } });
      row.append(key, copy);
      const until = document.createElement('p'); until.className = 'order-meta'; until.textContent = 'Действует до ' + new Date(order.expiresAt * 1000).toLocaleDateString('ru-RU');
      card.append(row, until);
    } else if (order.status === 'paid') {
      const note = document.createElement('p'); note.className = 'order-meta'; note.textContent = 'Оплата получена, ключ выдадим вручную в ближайшее время.'; card.append(note);
    } else if (order.status === 'pending') {
      const actions = document.createElement('div'); actions.className = 'order-actions';
      if (order.paymentUrl) { const pay = document.createElement('a'); pay.className = 'button small'; pay.href = order.paymentUrl; pay.textContent = 'Продолжить оплату'; actions.append(pay); }
      const check = document.createElement('button'); check.type = 'button'; check.className = 'text-link'; check.textContent = 'Проверить оплату';
      check.addEventListener('click', async () => { check.disabled = true; try { await callPayments('check', { orderId: order.id }); } catch (e) { $('#billingMessage').textContent = e.message; } finally { check.disabled = false; } });
      actions.append(check); card.append(actions);
    }
    root.append(card);
  }
}
// Back from the payment form: if the bank's notification is late, ask the function to check the payment once.
let checked = false;
function checkReturning(orders) {
  let last = null; try { last = sessionStorage.getItem('m3-last-order'); } catch {}
  const order = last && (orders || []).find(o => o.id === last);
  if (!order || checked || !paymentsUrl) return;
  if (order.status !== 'pending') { try { sessionStorage.removeItem('m3-last-order'); } catch {} return; }
  checked = true;
  setTimeout(() => { callPayments('check', { orderId: order.id }).catch(() => {}); }, 2500);
}
