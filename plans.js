// Subscription plans: one list for the checkout window and the account "Доступ" tab.
// The price cards on the landing page show the same numbers; keep them in sync when prices change.
export const PLANS = [
  { id: 'week', days: 7, price: 70, name: '7 дней' },
  { id: 'fortnight', days: 14, price: 140, name: '14 дней' },
  { id: 'month', days: 30, price: 250, name: '30 дней', badge: 'Популярно' },
  { id: 'year', days: 365, price: 2799, name: '365 дней', badge: 'Выгодно' }
];

export const rub = value => value.toLocaleString('ru-RU') + ' ₽';
export const perDay = plan => {
  const day = plan.price / plan.days;
  return (Number.isInteger(day) ? '' : '≈ ') + day.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' ₽ в день';
};
