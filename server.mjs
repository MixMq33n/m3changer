import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual, sign } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as oidc from 'openid-client';
import {createCommerce} from './commerce.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const scrypt = promisify(scryptCallback);
const random = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');
const now = () => Math.floor(Date.now()/1000);
const emailOf = value => typeof value==='string' ? value.trim().toLowerCase() : '';
const emailOK = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length<=254;
const cleanName = value => typeof value==='string' ? value.trim().replace(/[\u0000-\u001f]/g,'') : '';
const promoOf = value => typeof value==='string' ? value.trim().toUpperCase() : '';
function fail(message,status=400){const error=new Error(message);error.status=status;throw error;}
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split(/=(.*)/s)).filter(x=>x.length>=2).map(([k,v])=>[k,v]));}
async function body(req,form=false){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>16384)fail('Слишком большой запрос.',413);}try{return form?Object.fromEntries(new URLSearchParams(text)):JSON.parse(text||'{}');}catch{fail('Некорректный запрос.');}}

export function createApp(options={}){
 const env={...process.env,...options.env};
 const port=Number(env.PORT||8787),configuredOrigin=env.PUBLIC_ORIGIN||`http://127.0.0.1:${port}`;
 const publicURL=new URL(configuredOrigin);const origin=publicURL.origin;if(publicURL.pathname!=='/'||publicURL.search||publicURL.hash)throw Error('PUBLIC_ORIGIN must be an origin without path');
 if(publicURL.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(publicURL.hostname))throw Error('Public authentication requires HTTPS');
 const secure=publicURL.protocol==='https:';
 const dataDir=resolve(options.dataDir||env.DATA_DIR||join(root,'.data'));mkdirSync(dataDir,{recursive:true});
 const db=new DatabaseSync(join(dataDir,'accounts.sqlite'));
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT,promo_code TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,email_verified INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS identities(provider TEXT NOT NULL,subject TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),PRIMARY KEY(provider,subject));
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),csrf TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS oauth_states(state_hash TEXT PRIMARY KEY,provider TEXT NOT NULL,browser_hash TEXT NOT NULL,nonce TEXT NOT NULL,verifier TEXT NOT NULL,promo_code TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS attempts(bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);`);
 const q=(sql,...args)=>db.prepare(sql).get(...args);
 const run=(sql,...args)=>db.prepare(sql).run(...args);
 const commerce=createCommerce({db,env,origin,fetchImpl:options.fetchImpl,sendMail:options.sendMail,signingKey:options.signingKey});
 const setCookie=(res,name,value,age,sameSite='Lax')=>{const item=`${name}=${value}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${age}${secure?'; Secure':''}`;res.setHeader('Set-Cookie',[...(res.getHeader('Set-Cookie')||[]),item]);};
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 const redirect=(res,url)=>{res.writeHead(303,{Location:url,'Cache-Control':'no-store'});res.end();};
 function session(req){const raw=cookies(req).m3_session;if(!raw)return null;return q('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?',hash(raw),now());}
 function createSession(req,res,userId=null){const old=cookies(req).m3_session;if(old)run('DELETE FROM sessions WHERE token_hash=?',hash(old));const token=random(),csrf=random(),age=userId?604800:86400;run('INSERT INTO sessions VALUES(?,?,?,?)',hash(token),userId,csrf,now()+age);setCookie(res,'m3_session',token,age);return {user_id:userId,csrf};}
 function viewUser(id){const user=q('SELECT id,email,name,promo_code,created_at,email_verified FROM users WHERE id=?',id);if(!user)return null;const providers=db.prepare('SELECT provider FROM identities WHERE user_id=?').all(id).map(x=>x.provider);return {...user,email_verified:!!user.email_verified,providers,hasPassword:!!q('SELECT password_hash FROM users WHERE id=?',id).password_hash};}
 function guard(req){if(req.headers.origin!==publicURL.origin)fail('Обнови страницу и повтори действие.',403);const sess=session(req);if(!sess||req.headers['x-csrf-token']!==sess.csrf)fail('Обнови страницу и повтори действие.',403);return sess;}
 function authenticated(req){const sess=guard(req);if(!sess.user_id)fail('Сначала войди в аккаунт.',401);return sess;}
 function limit(req,scope,email=''){const ip=req.socket.remoteAddress||'unknown';for(const key of [`${scope}:ip:${ip}`,email?`${scope}:email:${hash(email)}`:null].filter(Boolean)){const existing=q('SELECT * FROM attempts WHERE bucket=?',key);if(existing&&existing.expires_at>now()&&existing.count>=20)fail('Слишком много попыток. Попробуй через 15 минут.',429);run('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END',key,now()+900,now(),now());}}
 function validatePromo(value){const promo=promoOf(value);if(promo&&!/^[A-ZА-ЯЁ0-9_-]{2,40}$/u.test(promo))fail('Промокод: от 2 до 40 букв, цифр, дефисов или подчёркиваний.');return promo;}
 const providers={google:!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET),apple:!!(secure&&env.APPLE_CLIENT_ID&&env.APPLE_TEAM_ID&&env.APPLE_KEY_ID&&env.APPLE_PRIVATE_KEY_PATH&&existsSync(resolve(env.APPLE_PRIVATE_KEY_PATH)))};
 let providerConfigs={};
 async function config(provider){const cached=providerConfigs[provider];if(cached&&cached.expires>now())return cached.value;let secret=env.GOOGLE_CLIENT_SECRET,id=env.GOOGLE_CLIENT_ID,issuer='https://accounts.google.com';if(provider==='apple'){id=env.APPLE_CLIENT_ID;issuer='https://appleid.apple.com';const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const input=encode({alg:'ES256',kid:env.APPLE_KEY_ID})+'.'+encode({iss:env.APPLE_TEAM_ID,iat:now(),exp:now()+3600,aud:issuer,sub:id});secret=input+'.'+sign('sha256',Buffer.from(input),{key:await readFile(resolve(env.APPLE_PRIVATE_KEY_PATH)),dsaEncoding:'ieee-p1363'}).toString('base64url');}const value=await oidc.discovery(new URL(issuer),id,secret);oidc.enableNonRepudiationChecks(value);providerConfigs[provider]={value,expires:now()+1800};return value;}
 async function oauthStart(req,res,provider,url){if(!providers[provider])return redirect(res,`/#auth?error=${provider}_unavailable`);limit(req,'oauth');const promo=validatePromo(url.searchParams.get('promo')||'');const state=oidc.randomState(),nonce=oidc.randomNonce(),verifier=oidc.randomPKCECodeVerifier(),browser=random();run('INSERT INTO oauth_states VALUES(?,?,?,?,?,?,?)',hash(state),provider,hash(browser),nonce,verifier,promo,now()+600);setCookie(res,`m3_oauth_${provider}`,browser,600,provider==='apple'?'None':'Lax');const params={redirect_uri:origin+`/auth/${provider}/callback`,scope:provider==='google'?'openid email profile':'openid email name',state,nonce};if(provider==='google'){params.code_challenge=await oidc.calculatePKCECodeChallenge(verifier);params.code_challenge_method='S256';params.prompt='select_account';}else params.response_mode='form_post';return redirect(res,oidc.buildAuthorizationUrl(await config(provider),params).href);}
 async function oauthCallback(req,res,provider,url){const params=req.method==='POST'?await body(req,true):Object.fromEntries(url.searchParams);const row=params.state?q('SELECT * FROM oauth_states WHERE state_hash=? AND provider=? AND expires_at>?',hash(params.state),provider,now()):null;const browser=cookies(req)[`m3_oauth_${provider}`];if(!row||!browser||hash(browser)!==row.browser_hash)fail('Не удалось подтвердить вход. Попробуй снова.',403);run('DELETE FROM oauth_states WHERE state_hash=?',row.state_hash);setCookie(res,`m3_oauth_${provider}`,'',0,provider==='apple'?'None':'Lax');const callback=new URL(origin+`/auth/${provider}/callback`);for(const [k,v] of Object.entries(params))callback.searchParams.set(k,v);const tokens=await oidc.authorizationCodeGrant(await config(provider),callback,{expectedState:params.state,expectedNonce:row.nonce,idTokenExpected:true,...(provider==='google'?{pkceCodeVerifier:row.verifier}:{})});const claims=tokens.claims();if(!claims?.sub)fail('Не удалось подтвердить аккаунт.',403);let identity=q('SELECT user_id FROM identities WHERE provider=? AND subject=?',provider,claims.sub);let userId=identity?.user_id;if(!userId){const email=emailOf(claims.email);if(!emailOK(email)||![true,'true'].includes(claims.email_verified))fail('Провайдер не подтвердил email аккаунта.',403);if(q('SELECT id FROM users WHERE email=?',email))return redirect(res,'/#auth?error=account_exists');let name=cleanName(claims.name)||email.split('@')[0];if(provider==='apple'&&params.user){try{const apple=JSON.parse(params.user);name=cleanName([apple.name?.firstName,apple.name?.lastName].filter(Boolean).join(' '))||name;}catch{}}
 db.exec('BEGIN');try{userId=Number(run('INSERT INTO users(email,name,promo_code,created_at,email_verified) VALUES(?,?,?,?,1)',email,name.slice(0,60),row.promo_code,now()).lastInsertRowid);run('INSERT INTO identities VALUES(?,?,?)',provider,claims.sub,userId);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
 createSession(req,res,userId);return redirect(res,'/#account/profile');}
 const dummySalt=random();
 async function passwordHash(password,salt=random()){return salt+':'+Buffer.from(await scrypt(password,salt,64)).toString('hex');}
 async function passwordMatches(password,stored){const [salt,expected]=(stored||`${dummySalt}:${'0'.repeat(128)}`).split(':');const result=Buffer.from(await scrypt(password,salt,64)),target=Buffer.from(expected,'hex');return result.length===target.length&&timingSafeEqual(result,target)&&!!stored;}
 const installer=env.INSTALLER_PATH?resolve(env.INSTALLER_PATH):null;
 const installerAvailable=!!(installer&&existsSync(installer));
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,publicURL);const path=url.pathname;
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://www.gstatic.com https://accounts.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://*.googleusercontent.com; media-src 'self' https://cdn.deadsouls.cc; connect-src 'self' https://*.googleapis.com https://accounts.google.com; frame-src https://accounts.google.com https://m3changer.firebaseapp.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'");
  if(secure)res.setHeader('Strict-Transport-Security','max-age=31536000');
  try{
   if(path==='/api/session'&&req.method==='GET'){let sess=session(req);if(!sess)sess=createSession(req,res);return json(res,200,{user:sess.user_id?viewUser(sess.user_id):null,csrf:sess.csrf,providers,commerce:commerce.settings(),download:{available:installerAvailable,version:env.INSTALLER_VERSION||'6.7.19'}});}
   if(path==='/api/email/resend'&&req.method==='POST'){const sess=authenticated(req);limit(req,'verify-resend');const user=viewUser(sess.user_id);if(!commerce.settings().mail)fail('Отправка писем пока не подключена.',503);commerce.sendVerification(user);void commerce.flush().catch(()=>{});return json(res,200,{sent:!user.email_verified});}
   if(path==='/api/email/verify'&&req.method==='POST'){const sess=guard(req);limit(req,'verify');const input=await body(req);const id=commerce.verifyEmail(input.token);return json(res,200,{verified:true,user:sess.user_id===id?viewUser(id):null});}
   if(path==='/api/billing/checkout'&&req.method==='POST'){const sess=authenticated(req);limit(req,'checkout');const order=await commerce.checkout(viewUser(sess.user_id),await body(req));return json(res,200,{order});}
   if(path==='/api/billing/orders'&&req.method==='GET'){const sess=session(req);if(!sess?.user_id)fail('Сначала войди в аккаунт.',401);return json(res,200,{orders:commerce.orders(sess.user_id)});}
   const orderRoute=path.match(/^\/api\/billing\/orders\/([a-f0-9-]{36})$/i);
   if(orderRoute&&req.method==='POST'){const sess=authenticated(req);limit(req,'payment-status');return json(res,200,{order:await commerce.status(sess.user_id,orderRoute[1])});}
   if(path==='/api/billing/yookassa/webhook'&&req.method==='POST'){const input=await body(req);if(input.type!=='notification'||!['payment.succeeded','payment.canceled'].includes(input.event)||typeof input.object?.id!=='string'||! /^[a-f0-9-]{36}$/i.test(input.object.id))fail('Некорректное уведомление.');await commerce.reconcile(input.object.id);void commerce.flush().catch(()=>{});return json(res,200,{received:true});}
   if(path==='/api/register'&&req.method==='POST'){guard(req);const input=await body(req),email=emailOf(input.email),name=cleanName(input.name),password=input.password;limit(req,'register',email);if(!emailOK(email))fail('Укажи корректный email.');if(name.length<2||name.length>60)fail('Имя должно содержать от 2 до 60 символов.');if(typeof password!=='string'||password.length<10||password.length>128)fail('Пароль должен содержать от 10 до 128 символов.');const promo=validatePromo(input.promo);if(q('SELECT id FROM users WHERE email=?',email))fail('Не удалось создать аккаунт. Если ты уже зарегистрирован, войди.',409);const encoded=await passwordHash(password);let id;try{id=Number(run('INSERT INTO users(email,name,password_hash,promo_code,created_at) VALUES(?,?,?,?,?)',email,name,encoded,promo,now()).lastInsertRowid);}catch(error){if(error.code?.includes('CONSTRAINT'))fail('Аккаунт уже существует. Войди по email.',409);throw error;}const sess=createSession(req,res,id);commerce.sendVerification(viewUser(id));void commerce.flush().catch(()=>{});return json(res,201,{user:viewUser(id),csrf:sess.csrf,verificationQueued:true});}
   if(path==='/api/login'&&req.method==='POST'){guard(req);const input=await body(req),email=emailOf(input.email);limit(req,'login',email);if(typeof input.password!=='string'||input.password.length>128)fail('Неверный email или пароль.',401);const user=q('SELECT id,password_hash FROM users WHERE email=?',email);if(!await passwordMatches(input.password,user?.password_hash))fail('Неверный email или пароль.',401);const sess=createSession(req,res,user.id);return json(res,200,{user:viewUser(user.id),csrf:sess.csrf});}
   if(path==='/api/logout'&&req.method==='POST'){guard(req);const sess=createSession(req,res);return json(res,200,{user:null,csrf:sess.csrf});}
   if(path==='/api/profile'&&req.method==='PATCH'){const sess=authenticated(req),input=await body(req),name=cleanName(input.name);if(name.length<2||name.length>60)fail('Имя должно содержать от 2 до 60 символов.');run('UPDATE users SET name=? WHERE id=?',name,sess.user_id);return json(res,200,{user:viewUser(sess.user_id)});}
   if(path==='/api/download'&&req.method==='GET'){const sess=session(req);if(!sess?.user_id)fail('Сначала войди в аккаунт.',401);if(!installerAvailable)fail('Установщик пока недоступен. Попробуй позже.',503);const info=await stat(installer);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="M3-Changer-Setup.exe"`,'Content-Length':info.size,'Cache-Control':'no-store'});const {createReadStream}=await import('node:fs');createReadStream(installer).pipe(res);return;}
   const oauthRoute=path.match(/^\/auth\/(google|apple)(\/callback)?$/);if(oauthRoute&&((!oauthRoute[2]&&req.method==='GET')||(oauthRoute[2]&&['GET','POST'].includes(req.method)))){if(oauthRoute[2])return await oauthCallback(req,res,oauthRoute[1],url);return await oauthStart(req,res,oauthRoute[1],url);}
   if(path.startsWith('/api/')||path.startsWith('/auth/'))fail('Страница не найдена.',404);
   if(!['GET','HEAD'].includes(req.method))fail('Метод не поддерживается.',405);
   const decoded=decodeURIComponent(path);const publicPath=decoded==='/'?'index.html':decoded.slice(1);
   if(!['index.html','style.css','app.js','auth.js','firebase-config.js','commerce.js','site-info.js','favicon.ico'].includes(publicPath)&&!/^assets\/[a-zA-Z0-9_.-]+$/.test(publicPath))fail('Страница не найдена.',404);
   const file=join(root,'dist',publicPath),content=await readFile(file);const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.ico':'image/x-icon'};
   res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':publicPath.startsWith('assets/')?'public,max-age=86400':'no-cache'});res.end(req.method==='HEAD'?undefined:content);
  }catch(error){if(res.headersSent){res.destroy();return;}if(path.startsWith('/auth/')){return redirect(res,'/#auth?error=oauth_failed');}const status=error.status||((error.code==='ENOENT')?404:500);if(status===500)console.error('Request failed:',error.code||error.name);json(res,status,{error:status===500?'Не удалось выполнить действие. Попробуй ещё раз.':(status===404?'Страница не найдена.':error.message)});}
 });
 const mailWorker=setInterval(()=>void commerce.maintain().catch(()=>{}),30000);mailWorker.unref();
 const cleanup=setInterval(()=>{run('DELETE FROM sessions WHERE expires_at<=?',now());run('DELETE FROM oauth_states WHERE expires_at<=?',now());run('DELETE FROM attempts WHERE expires_at<=?',now());},60000);cleanup.unref();
 server.on('close',()=>{clearInterval(cleanup);clearInterval(mailWorker);commerce.stop();db.close();});
 return {server,db,origin};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const app=createApp();app.server.listen(Number(process.env.PORT||8787),process.env.HOST||'127.0.0.1',()=>console.log(`M3 site: ${app.origin}`));
}
