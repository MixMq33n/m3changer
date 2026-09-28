const $=s=>document.querySelector(s);document.documentElement.classList.add('js');
const heroes=[['phantom_assassin','Phantom Assassin'],['juggernaut','Juggernaut'],['pudge','Pudge'],['invoker','Invoker'],['drow_ranger','Drow Ranger'],['nevermore','Shadow Fiend']];
let switchTimer,categoryAnimations=[];heroes.forEach(([id,name],index)=>{const b=document.createElement('button');b.innerHTML=`<img src="assets/hero_${id}.png" alt="">`;b.setAttribute('aria-label',name);b.setAttribute('aria-pressed',String(index===0));b.addEventListener('click',()=>{clearTimeout(switchTimer);$('.hero-stage img').classList.add('switching');switchTimer=setTimeout(()=>{$('#heroArt').src=`assets/render_${id}.png`;$('#heroArt').alt=name+' из Dota 2';$('#heroName').textContent=name;$('.hero-selection-caption .muted').textContent=`0${index+1} / 06`;document.querySelectorAll('.hero-selector button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));$('#heroArt').classList.remove('switching');},motion?180:0)});$('.hero-selector').append(b)});
const reduce=matchMedia('(prefers-reduced-motion: reduce)');let motion=!reduce.matches;const motionButton=$('#motionToggle');function setMotion(value){motion=value;document.documentElement.style.scrollBehavior=value?"":"auto";if(!value){categoryAnimations.forEach(a=>a.cancel());categoryAnimations=[];}document.body.classList.toggle('no-motion',!value);motionButton.textContent=`Анимации: ${value?'вкл.':'выкл.'}`;motionButton.setAttribute('aria-pressed',String(value))}setMotion(motion);motionButton.onclick=()=>setMotion(!motion);reduce.addEventListener('change',e=>setMotion(!e.matches));
const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');observer.unobserve(e.target)}}),{threshold:.08});document.querySelectorAll('.reveal').forEach(e=>observer.observe(e));new IntersectionObserver(entries=>entries.forEach(e=>document.body.classList.toggle('paused',!e.isIntersecting)),{threshold:0}).observe($('.hero'));document.addEventListener('visibilitychange',()=>document.body.classList.toggle('paused',document.hidden));
let queued=false;function progress(){if(scrollY<100)document.querySelectorAll('header nav a.active').forEach(link=>{link.classList.remove('active');link.removeAttribute('aria-current')});document.querySelector('header').classList.toggle('scrolled',scrollY>24);const height=document.documentElement.scrollHeight-innerHeight;$('.scroll-progress').style.transform=`scaleX(${height>0?scrollY/height:0})`;queued=false}addEventListener('scroll',()=>{if(!queued){queued=true;requestAnimationFrame(progress)}},{passive:true});addEventListener('resize',progress);progress();
const data={heroes:['ОБРАЗЫ / СТИЛИ / ЭФФЕКТЫ','Тот самый герой.<br>Новый взгляд.','Подбирай предметы, переключай доступные стили и сохраняй любимые сочетания в пресеты.','<img src="assets/render_juggernaut.png" alt="Juggernaut"><img src="assets/render_invoker.png" alt="Invoker"><img src="assets/render_drow_ranger.png" alt="Drow Ranger">'],couriers:['КУРЬЕРЫ / САМОЦВЕТЫ','Маленький спутник.<br>Большая часть образа.','Выбирай курьера и сочетай поддерживаемые эффекты и призматические цвета.','<figure class="courier-feature"><img src="assets/courier-10478.png" alt="Lava Baby Roshan из Dota 2"><figcaption>Lava Baby Roshan <span>Курьер / Dota 2</span></figcaption></figure>'],world:['ПОГОДА / ЛАНДШАФТЫ / ИНТЕРФЕЙС','Атмосфера<br>по настроению.','Настраивай окружение, интерфейс и звуки. Все выбранные изменения собираются в одном профиле.','<img class="wide" src="assets/interface.png" alt="Коллекция интерфейсов Dota 2 в M3 Changer">']};
const tabs=[...document.querySelectorAll('[data-category]')];function selectTab(t){tabs.forEach(b=>{b.setAttribute('aria-selected',String(b===t));b.tabIndex=b===t?0:-1});const [tag,title,description,art]=data[t.dataset.category];$('#categoryTag').textContent=tag;$('#categoryTitle').innerHTML=title;$('#categoryText').textContent=description;$('#collectionArt').innerHTML=art;$('#categoryPanel').setAttribute('aria-labelledby',t.id);categoryAnimations.forEach(a=>a.cancel());categoryAnimations=[];if(motion)categoryAnimations=[$('.collection-copy'),$('#collectionArt')].map((element,i)=>element.animate([{opacity:0,transform:'scale(1.012)'},{opacity:1,transform:'scale(1)'}],{duration:420,delay:i*20,easing:'cubic-bezier(.22,1,.36,1)'}))}tabs.forEach((t,i)=>{t.onclick=()=>selectTab(t);t.onkeydown=e=>{let n=i;if(e.key==='ArrowRight')n=(i+1)%tabs.length;else if(e.key==='ArrowLeft')n=(i+tabs.length-1)%tabs.length;else if(e.key==='Home')n=0;else if(e.key==='End')n=tabs.length-1;else return;e.preventDefault();selectTab(tabs[n]);tabs[n].focus()}});

$('.app-zoom').onclick=()=>$('#lightbox').showModal();document.querySelectorAll('dialog').forEach(d=>{d.querySelectorAll('.dialog-close,.dialog-close-action').forEach(b=>b.onclick=()=>d.close());d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close()}})});

// Load footage near the viewport; pause offscreen and honour motion preferences.
const comparison=$('.comparison'),range=$('#comparisonRange');
const videos=[$('#vanillaVideo'),$('#moddedVideo')],playButton=$('#comparisonPlay');
let comparisonVisible=false,ready=false,userPaused=false,userInteracted=false,demoFrame=0,demoDone=false,playbackEpoch=0;
function position(value){range.value=String(value);comparison.style.setProperty('--position',value+'%');range.setAttribute('aria-valuetext',`Новое окружение — ${Math.round(value)} процентов`);$('.compare-label.left').style.opacity=value<18?'0':'1';$('.compare-label.right').style.opacity=value>82?'0':'1'}
function updatePlayback(){const epoch=++playbackEpoch;const play=ready&&comparisonVisible&&!document.hidden&&motion&&!userPaused;videos.forEach(v=>{if(play)v.play().catch(error=>{if(epoch!==playbackEpoch||error.name==='AbortError')return;userPaused=true;videos.forEach(x=>x.pause());playButton.textContent='Воспроизвести';playButton.setAttribute('aria-pressed','false')});else v.pause()});playButton.textContent=play?'Пауза':'Воспроизвести';playButton.setAttribute('aria-pressed',String(play));if(!play)cancelAnimationFrame(demoFrame)}
function demo(){if(demoDone||userInteracted||!motion||!comparisonVisible||document.hidden)return;demoDone=true;const start=performance.now();function frame(now){if(userInteracted||!motion||!comparisonVisible||document.hidden)return;const t=Math.min(1,(now-start)/2200);position(50+18*Math.sin(t*2*Math.PI)*Math.sin(t*Math.PI));if(t<1)demoFrame=requestAnimationFrame(frame);else position(50)}demoFrame=requestAnimationFrame(frame)}
function interact(){userInteracted=true;cancelAnimationFrame(demoFrame)}
range.addEventListener('input',()=>{interact();position(Number(range.value))});range.addEventListener('keydown',interact);
let pointer=null;
range.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;interact();pointer=e.pointerId;range.setPointerCapture(pointer);comparison.classList.add('dragging');if(e.pointerType!=='touch')move(e)});
function move(e){if(e.pointerId!==pointer)return;const rect=comparison.getBoundingClientRect();position(Math.max(0,Math.min(100,(e.clientX-rect.left)/rect.width*100)))}
range.addEventListener('pointermove',move);function release(){pointer=null;comparison.classList.remove('dragging')}range.addEventListener('pointerup',release);range.addEventListener('pointercancel',release);range.addEventListener('lostpointercapture',release);
function loaded(){if(!ready&&videos.every(v=>v.readyState>=2)){ready=true;comparison.dataset.state='ready';playButton.disabled=false;updatePlayback();demo()}}
videos.forEach(v=>{v.addEventListener('loadeddata',loaded);v.addEventListener('canplay',loaded);v.addEventListener('error',()=>{comparison.dataset.state='error';comparison.querySelector('.compare-status').textContent='Не удалось загрузить видео. Проверь подключение и обнови страницу.';ready=false;playButton.disabled=true;updatePlayback()})});
new IntersectionObserver(entries=>{comparisonVisible=entries[0].isIntersecting;if(comparisonVisible)videos.forEach(v=>{if(!v.hasAttribute('src')){v.src=v.dataset.src;v.load()}});updatePlayback();if(ready&&comparisonVisible)demo()},{rootMargin:'120px',threshold:0}).observe(comparison);
// Correct drift only when both videos are playing; avoid per-frame JS work.
videos[0].addEventListener('timeupdate',()=>{const [a,b]=videos;if(a.paused||b.paused||b.seeking||b.readyState<2)return;if(Math.abs(a.currentTime-b.currentTime)>.15)b.currentTime=a.currentTime});
playButton.onclick=()=>{interact();userPaused=!userPaused;if(!userPaused&&!motion)setMotion(true);updatePlayback()};
new MutationObserver(updatePlayback).observe(document.body,{attributes:true,attributeFilter:['class']});document.addEventListener('visibilitychange',updatePlayback);

// Small navigation cues, driven by visibility changes rather than a frame loop.
const sectionLinks=[...document.querySelectorAll('header nav a[href^="#"]')];
const sectionObserver=new IntersectionObserver(entries=>{
 for(const entry of entries)if(entry.isIntersecting){
  sectionLinks.forEach(link=>{const active=link.hash===`#${entry.target.id}`;link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current')});
 }
},{rootMargin:'-15% 0px -60% 0px',threshold:0});
sectionLinks.forEach(link=>{const section=document.querySelector(link.hash);if(section)sectionObserver.observe(section)});


// Soft light volumes and round motes. Sprites are painted once, then moved;
// no line geometry, live blur filters or per-frame layout measurements.
(()=>{
 const scene=document.body,canvas=$('#ambientCanvas'),ctx=canvas.getContext('2d');
 if(!ctx)return;
 const low=(navigator.hardwareConcurrency||4)<=4||matchMedia('(max-width:700px)').matches;
 const interval=1000/(low?30:60),motes=[];
 let width=0,height=0,frame=0,last=0,time=0;
 const cursor={x:0,y:0,targetX:0,targetY:0,active:false,power:0};
 let seed=37;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
 function sprite(color,size=256){const c=document.createElement('canvas');c.width=c.height=size;const g=c.getContext('2d'),r=size/2,gradient=g.createRadialGradient(r,r,0,r,r,r);gradient.addColorStop(0,`rgba(${color},.65)`);gradient.addColorStop(.25,`rgba(${color},.32)`);gradient.addColorStop(.6,`rgba(${color},.08)`);gradient.addColorStop(1,`rgba(${color},0)`);g.fillStyle=gradient;g.fillRect(0,0,size,size);return c;}
 const sage=sprite('114,157,132'),silver=sprite('139,161,177'),light=sprite('218,237,223',32);
 for(let i=0;i<(low?30:64);i++)motes.push({u:random(),v:random(),phase:random()*Math.PI*2,speed:5+random()*8,radius:.7+random()*1.2,alpha:.3+random()*.45,x:0,y:0});
 function resize(){width=innerWidth;height=innerHeight;const dpr=Math.min(devicePixelRatio||1,low?1:1.25);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);motes.forEach(p=>{p.x=p.u*width;p.y=p.v*height});}
 function glow(image,x,y,radius,opacity){ctx.globalAlpha=opacity;ctx.drawImage(image,x-radius,y-radius,radius*2,radius*2);}
 function draw(now){frame=0;if(!allowed()){sync();return;}frame=requestAnimationFrame(draw);if(now-last<interval-.5)return;const dt=Math.min(50,now-last||interval);last=now;time+=dt/1000;ctx.clearRect(0,0,width,height);const ease=1-Math.exp(-dt/240);cursor.x+=(cursor.targetX-cursor.x)*ease;cursor.y+=(cursor.targetY-cursor.y)*ease;cursor.power+=((cursor.active?1:0)-cursor.power)*ease;
  ctx.globalCompositeOperation='screen';const radius=Math.min(width*.36,470);
  glow(sage,width*.75+Math.sin(time*.35)*55,height*.23+Math.cos(time*.28)*36,radius,.30+Math.sin(time*.55)*.035);
  glow(silver,width*.19+Math.cos(time*.23)*36,height*.3+Math.sin(time*.3)*45,radius*.9,.12);
  glow(sage,width*.6+Math.sin(time*.25)*60,height*.72,radius*.85,.18);
  if(cursor.power>.01)glow(sage,cursor.x,cursor.y,160,.16*cursor.power);
  for(const p of motes){let x=p.u*width+Math.sin(time*.5+p.phase)*22,y=((p.v*height-time*p.speed)%height+height)%height;const dx=cursor.x-x,dy=cursor.y-y,d=Math.hypot(dx,dy),pull=Math.max(0,1-d/240)*.22*cursor.power;x+=dx*pull;y+=dy*pull;p.x+=(x-p.x)*ease;p.y+=(y-p.y)*ease;if(Math.abs(y-p.y)>height/2)p.y=y;const shimmer=.65+.35*Math.sin(time*.9+p.phase)**2;glow(light,p.x,p.y,p.radius*4,p.alpha*shimmer);ctx.globalAlpha=p.alpha*shimmer;ctx.fillStyle='#d9ebdf';ctx.beginPath();ctx.arc(p.x,p.y,p.radius*.55,0,Math.PI*2);ctx.fill();}
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
 }
 function allowed(){return motion&&!document.hidden;}
 function sync(){if(!allowed()){cancelAnimationFrame(frame);frame=0;last=0;ctx.clearRect(0,0,width,height);canvas.dataset.running='false';}else if(!frame){last=0;canvas.dataset.running='true';frame=requestAnimationFrame(draw);}}
 scene.addEventListener('pointermove',e=>{if(!motion||e.pointerType==='touch')return;cursor.targetX=e.clientX;cursor.targetY=e.clientY;if(!cursor.active){cursor.x=cursor.targetX;cursor.y=cursor.targetY;}cursor.active=true;},{passive:true});scene.addEventListener('pointerleave',()=>cursor.active=false);

 new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['class']});document.addEventListener('visibilitychange',sync);addEventListener('resize',resize,{passive:true});resize();sync();
})();
