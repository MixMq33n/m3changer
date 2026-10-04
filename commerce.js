(() => {
 const $=id=>document.getElementById(id);
 let user,csrf='',config={plans:[]},orders=[],busy=false;
 const say=(id,text,error=false)=>{$(id).textContent=text;$(id).classList.toggle('is-error',error);};
 async function api(path,data){const response=await fetch(path,{credentials:'same-origin',...(data?{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(data)}:{})});const result=await response.json();if(!response.ok)throw Error(result.error||'Не удалось выполнить действие.');return result;}
 function paint(){
  if(!user)return;
  $('emailStatus').textContent=user.email_verified?'Email подтверждён':'Подтверди email, чтобы оплатить подписку.';
  $('resendEmail').hidden=user.email_verified;$('resendEmail').disabled=!config.mail;
  if(!user.email_verified&&!config.mail)say('emailMessage','Отправка писем пока недоступна. Аккаунт сохранён; подтверждение станет доступно после подключения почты.');
  else say('emailMessage','');
  const selected=$('billingPlan').value;$('billingPlan').replaceChildren();
  for(const plan of config.plans||[]){const option=document.createElement('option');option.value=plan.id;option.textContent=plan.name+(plan.price?' · '+Number(plan.price).toLocaleString('ru-RU')+' ₽':' · скоро');option.disabled=!plan.available;$('billingPlan').append(option);}
  if([...$('billingPlan').options].some(o=>o.value===selected&&!o.disabled))$('billingPlan').value=selected;
  $('checkoutSubmit').disabled=busy||!user.email_verified||!(config.plans||[]).some(p=>p.available);
  $('billingSetup').textContent=!config.payments?'Приём оплаты пока не подключён.':config.testMode?'Тестовый режим: реальные деньги не списываются.':'Оплата через СБП. Автоматическое списание при продлении не включено.';
 }
 async function loadOrders(){if(!user)return;try{orders=(await api('/api/billing/orders')).orders;try{const storageKey='m3-checkout-'+user.id;const pending=JSON.parse(sessionStorage.getItem(storageKey));if(pending&&orders.some(o=>o.id===pending.requestId&&['paid','canceled'].includes(o.status)))sessionStorage.removeItem(storageKey);}catch{}renderOrders();}catch(e){say('billingMessage',e.message,true);}}
 function renderOrders(){
  const root=$('billingOrders');root.replaceChildren();if(!orders.length){const p=document.createElement('p');p.textContent='Покупок пока нет.';root.append(p);return;}
  for(const order of orders){
   const card=document.createElement('article');card.className='billing-order';
   const title=document.createElement('strong');title.textContent=order.days+' дней · '+Number(order.amount).toLocaleString('ru-RU')+' ₽';
   const status=document.createElement('p');status.textContent=({creating:'Платёж создаётся',pending:'Ожидает оплаты',paid:'Оплачено',canceled:'Платёж отменён'})[order.status]||order.status;card.append(title,status);
   if(order.key){const expiry=document.createElement('p');expiry.textContent='Доступ до '+new Date(order.expiresAt*1000).toLocaleDateString('ru-RU');const key=document.createElement('textarea');key.readOnly=true;key.value=order.key;key.rows=3;key.setAttribute('aria-label','Ключ M3 на '+order.days+' дней');const copy=document.createElement('button');copy.type='button';copy.className='button small';copy.textContent='Копировать ключ';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(order.key);copy.textContent='Скопировано';}catch{key.focus();key.select();copy.textContent='Выделено — нажми Ctrl+C';}});card.append(expiry,key,copy);}
   else if(['pending','creating'].includes(order.status)){
    if(order.confirmationUrl){const pay=document.createElement('a');pay.className='button small';pay.textContent='Продолжить оплату';pay.href=order.confirmationUrl;card.append(pay);}
    const check=document.createElement('button');check.type='button';check.className='text-link';check.textContent=order.status==='creating'?'Повторить создание платежа':'Проверить оплату';check.addEventListener('click',async()=>{check.disabled=true;try{await api('/api/billing/orders/'+order.id,{});await loadOrders();}catch(e){say('billingMessage',e.message,true);}finally{check.disabled=false;}});card.append(check);
   }
   root.append(card);
  }
 }
 document.addEventListener('m3-session',event=>{({user,csrf}=event.detail);config=event.detail.settings.commerce||{plans:[]};if(!user){orders=[];return;}paint();void loadOrders();openVerification();});
 $('resendEmail').addEventListener('click',async()=>{const button=$('resendEmail');button.disabled=true;try{await api('/api/email/resend',{});say('emailMessage','Письмо для '+user.email+' готово к отправке. Оно придёт в ближайшее время; проверь также папку «Спам».');}catch(e){say('emailMessage',e.message,true);}finally{button.disabled=false;}});
 $('checkoutForm').addEventListener('submit',async event=>{event.preventDefault();if(busy)return;busy=true;paint();say('billingMessage','Создаём платёж…');try{const plan=$('billingPlan').value,device=$('billingDevice').value.trim();const storageKey='m3-checkout-'+user.id;let request;try{request=JSON.parse(sessionStorage.getItem(storageKey));}catch{}if(!request||request.plan!==plan||request.device!==device){request={plan,device,requestId:crypto.randomUUID()};sessionStorage.setItem(storageKey,JSON.stringify(request));}const {order}=await api('/api/billing/checkout',request);if(order.status==='paid'){sessionStorage.removeItem(storageKey);await loadOrders();say('billingMessage','Подписка оплачена. Ключ готов.');}else if(order.confirmationUrl)location.assign(order.confirmationUrl);else{await loadOrders();say('billingMessage','Проверь статус заказа ниже.');}}catch(e){say('billingMessage',e.message,true);}finally{busy=false;paint();}});
 function openVerification(){if(!csrf||!location.hash.startsWith('#verify?'))return;const token=new URLSearchParams(location.hash.split('?')[1]).get('token');$('verifyEmail').dataset.token=token||'';$('verifyEmail').hidden=false;say('verifyMessage','');if(!$('verifyDialog').open)$('verifyDialog').showModal();}
 $('verifyEmail').addEventListener('click',async()=>{const button=$('verifyEmail');button.disabled=true;try{const result=await api('/api/email/verify',{token:button.dataset.token});document.dispatchEvent(new CustomEvent('m3-email-verified',{detail:result.user}));say('verifyMessage','Email подтверждён. '+(result.user?'Теперь можно оплатить подписку.':'Войди в аккаунт, чтобы продолжить.'));button.hidden=true;history.replaceState(null,'',location.pathname);}catch(e){say('verifyMessage',e.message,true);}finally{button.disabled=false;}});
 $('verifyClose').addEventListener('click',()=>{$('verifyDialog').close();location.hash=user?'account/access':'auth?mode=login';});
 addEventListener('hashchange',()=>{openVerification();if(location.hash==='#account/access')void loadOrders();});
 setInterval(()=>{if(user&&!document.hidden&&location.hash==='#account/access'&&orders.some(o=>o.status==='pending'))void loadOrders();},10000);
 addEventListener('focus',()=>{if(location.hash==='#account/access')void loadOrders();});
})();
