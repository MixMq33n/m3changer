// Checkout window: plan, installation ID and payment method, opened from the price cards and the account "Доступ" tab.
// No payment provider is connected yet. startPayment() at the bottom is the one place to plug one in.
import { PLANS, rub, perDay } from './plans.js';
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
}

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

// Plug the payment provider in here. `order` has plan, days, amount (RUB), method ('sbp'), device, uid and email.
// Typical flow: send the order to your payment backend, get the provider's payment URL and location.assign() it.
// A separate script can also provide window.M3Payments = { start(order) { … } } without touching this file.
async function startPayment(order) {
  document.dispatchEvent(new CustomEvent('m3-checkout', { detail: order }));
  if (window.M3Payments && typeof window.M3Payments.start === 'function') return window.M3Payments.start(order);
  say('Приём оплаты скоро появится. Деньги не списаны, заказ на ' + order.days + ' дней за ' + rub(order.amount) + ' пока не создан.');
}
