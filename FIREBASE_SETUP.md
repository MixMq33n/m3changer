# Вход и регистрация через Firebase

Сайт статический: аккаунты, пароли и письма обслуживает Firebase (проект `m3changer`), профили лежат в Firestore (`users/{uid}`).
Посетитель не видит страниц Firebase: Google открывает своё окно выбора аккаунта, а ссылки из писем ведут на сайт.

Файлы: `firebase-config.js` (публичные настройки, Client ID для Google, ссылка на установщик), `auth.js` (вход, регистрация, кабинет), `firestore.rules` (правила доступа).

## Один раз в консоли Firebase

1. **Authentication → Get started → Sign-in method**
   - Email/Password → включить первый переключатель → Save.
   - Add new provider → Google → Enable → Support email → Save.
2. **Client ID для кнопки Google.** Authentication → Sign-in method → Google → «Web SDK configuration» → скопировать *Web client ID* в `googleClientId` в `firebase-config.js`.
3. **Разрешённые адреса для Google.** console.cloud.google.com → проект m3changer → APIs & Services → Credentials → «Web client (auto created by Google Service)» → *Authorized JavaScript origins*: `http://localhost:8791` (проверка) и адрес сайта, например `https://m3changer.ru`.
4. **Название в окне Google.** Google Auth Platform → Branding: App name `M3 Changer`, support email, логотип (`assets/icon-256.png`).
5. **Название в письмах.** Project settings → General → Public-facing name: `M3 Changer`.
6. **База профилей.** Firestore → Create database → eur3 → production mode. Затем Firestore → Rules → вставить `firestore.rules` → Publish.
7. **Письма ведут на сайт.** Authentication → Templates → для «Email address verification» и «Password reset»: язык шаблона русский, затем карандаш → *Customize action URL* → адрес главной страницы сайта (`https://m3changer.ru/`). Пока это не сделано, ссылка из письма открывает стандартную страницу Firebase.
8. **Домен сайта.** Authentication → Settings → Authorized domains → добавить домен сайта.

Письма уходят с адреса `noreply@m3changer.firebaseapp.com`. Отправитель со своим доменом настраивается в Authentication → Templates → Customize domain, когда будет домен.

## Как это работает

- Регистрация: email, пароль (от 10 символов), имя, промокод автора. После регистрации письмо подтверждения уходит автоматически; в кабинете есть «Отправить письмо ещё раз».
- Вход через Google: Google Identity Services отдаёт токен, Firebase создаёт или находит аккаунт по нему. Если email уже зарегистрирован, это тот же аккаунт.
- Профиль создаётся при первом входе. Потом меняется только имя, промокод и дата регистрации неизменны (это проверяют правила Firestore).
- Ссылки из писем (`?mode=verifyEmail|resetPassword&oobCode=…`) обрабатываются на главной странице: подтверждение почты и новый пароль задаются в окне сайта.
- Оплата (`commerce.js`) не тронута. Пока платёжная система не подключена, вкладка «Доступ» показывает «Приём оплаты пока не подключён».

Старая серверная версия входа (`server.mjs`, SQLite) больше не используется страницей; файлы сохранены. Копия сайта до перехода: `design-concepts/backup-site-2026-10-26-before-firebase`.
