// account.js — аккаунт: вход, регистрация, выход, восстановление пароля.
//
// Как устроено (сервер: services/accounts.js). Все данные приложения —
// история, позиции просмотра, выбор дорожек, настройки TorrServer — сервер
// хранит по clientId. У аккаунта свой идентификатор данных (dataId), и после
// входа устройство просто работает под ним как под своим clientId: тот же
// приём, что у «Синхронизации» по коду. Поэтому остальные модули ничего про
// аккаунт не знают, а нативная часть Android (каналы, «Продолжить просмотр»,
// встроенный плеер) подхватывает его сама — она берёт clientId из
// localStorage страницы.
//
// localStorage:
//   authToken       — токен сессии (не пароль: пароль на устройстве не лежит)
//   authLogin       — логин, для подписи «Вы вошли как …»
//   deviceClientId  — собственный clientId устройства до входа; при выходе
//                     устройство возвращается к нему и к своей истории
//
// Вход и выход перезагружают страницу: clientId читают десятки мест, и
// подменить его на лету надёжно нельзя.
//
// Совместимость: ES5 (Chrome 66 на телевизорах).
(function () {
    'use strict';

    var LS_TOKEN = 'authToken';
    var LS_LOGIN = 'authLogin';
    var LS_DEVICE = 'deviceClientId';
    // Флаг «уже перезагружались, чтобы выровнять clientId» — от зацикливания
    var SS_ALIGN = 'authAlignReload';

    function ls(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
    function lsSet(key, val) { try { localStorage.setItem(key, val); } catch (e) { } }
    function lsDel(key) { try { localStorage.removeItem(key); } catch (e) { } }

    function el(id) { return document.getElementById(id); }
    function show(id, on) { var e = el(id); if (e) { if (on) e.removeAttribute('hidden'); else e.setAttribute('hidden', ''); } }

    function isSignedIn() { return !!ls(LS_TOKEN); }

    function api(path, body, token) {
        var opts = { method: body ? 'POST' : 'GET', headers: {} };
        if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
        if (token) opts.headers.Authorization = 'Bearer ' + token;
        return fetch(SERVER_URL + '/api/account/' + path, opts).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (data) {
                data._status = r.status;
                return data;
            });
        });
    }

    // ------------------------------------------------------------ сообщения

    function message(text, isError) {
        var m = el('account-message');
        if (!m) return;
        if (!text) { m.setAttribute('hidden', ''); m.textContent = ''; return; }
        m.textContent = text;
        m.classList.toggle('account-message-error', !!isError);
        m.removeAttribute('hidden');
    }

    function busy(on) {
        var ids = ['account-login-btn', 'account-register-btn', 'account-forgot-btn', 'account-logout-btn',
            'account-recover-check-btn', 'account-recover-reset-btn'];
        for (var i = 0; i < ids.length; i++) { var b = el(ids[i]); if (b) b.disabled = !!on; }
    }

    // --------------------------------------------------------- переключение

    /** Какое из четырёх состояний вкладки показать. */
    function render(state) {
        show('account-signed-out', state === 'out');
        show('account-signed-in', state === 'in');
        show('account-recovery-banner', state === 'banner');
        show('account-recover', state === 'recover');
        if (state === 'in') {
            var cur = el('account-current-login');
            if (cur) cur.textContent = ls(LS_LOGIN) || '';
        }
        // Состав кнопок вкладки поменялся — пульту нужен свежий список
        if (typeof window.invalidateFocusCache === 'function') window.invalidateFocusCache();
    }

    /** Фокус пульта — на элемент вкладки, если пульт сейчас внутри неё. */
    function focusIn(id) {
        var e = el(id);
        if (!e || typeof window.focusEl !== 'function') return;
        var f = document.querySelector('#account-tab-content .focused');
        if (f || document.activeElement && document.activeElement.closest && document.activeElement.closest('#account-tab-content')) {
            window.focusEl(e);
        }
    }

    // ------------------------------------------------------------ вход/выход

    /**
     * Устройство переходит на данные аккаунта. Свой clientId запоминаем один
     * раз — при первом входе; повторный вход (после восстановления пароля)
     * его не перетирает.
     */
    function enterAccount(data) {
        var current = ls('clientId');
        if (!ls(LS_DEVICE) && current && current !== data.dataId) lsSet(LS_DEVICE, current);
        lsSet(LS_TOKEN, data.token);
        lsSet(LS_LOGIN, data.login);
        lsSet('clientId', data.dataId);
    }

    function reloadSoon(text) {
        message(text || 'Готово, перезагружаем приложение…', false);
        setTimeout(function () { location.reload(); }, 1200);
    }

    function credentials() {
        var l = el('account-login'), p = el('account-password');
        return { login: l ? l.value.trim() : '', password: p ? p.value : '' };
    }

    /** clientId для слияния: данные этого устройства уходят в аккаунт. */
    function deviceIdForMerge() {
        return ls('clientId') || undefined;
    }

    function doLogin() {
        var c = credentials();
        if (!c.login || !c.password) { message('Введите логин и пароль', true); return; }
        busy(true); message('Входим…', false);
        api('login', { login: c.login, password: c.password, clientId: deviceIdForMerge() }).then(function (d) {
            if (!d.success) { busy(false); message(d.error || 'Не удалось войти', true); return; }
            enterAccount(d);
            reloadSoon('Вы вошли как ' + d.login + '. Перезагружаем приложение…');
        })['catch'](function () { busy(false); message('Сервер недоступен', true); });
    }

    var pendingAccount = null;   // аккаунт после регистрации — входим после показа кода

    function doRegister() {
        var c = credentials();
        if (!c.login || !c.password) { message('Придумайте логин и пароль', true); return; }
        busy(true); message('Создаём аккаунт…', false);
        api('register', { login: c.login, password: c.password, clientId: deviceIdForMerge() }).then(function (d) {
            busy(false);
            if (!d.success) { message(d.error || 'Не удалось зарегистрироваться', true); return; }
            // Сразу входим: токен уже выдан. Перезагрузка — после того как
            // человек увидит и сохранит код, иначе код исчез бы вместе со страницей
            enterAccount(d);
            pendingAccount = d;
            message('', false);
            var nl = el('account-new-login'); if (nl) nl.textContent = d.login;
            var rc = el('account-recovery-code'); if (rc) rc.textContent = d.recoveryCode;
            render('banner');
            focusIn('account-recovery-ok-btn');
        })['catch'](function () { busy(false); message('Сервер недоступен', true); });
    }

    function doRecoveryOk() {
        pendingAccount = null;
        reloadSoon();
    }

    /** Выход: токен отзываем на сервере, устройство возвращается к своим данным. */
    function signOutLocal() {
        var device = ls(LS_DEVICE);
        lsDel(LS_TOKEN); lsDel(LS_LOGIN); lsDel(LS_DEVICE);
        // Своего clientId не было (зашли на «чистом» устройстве) — сервер выдаст новый
        if (device) lsSet('clientId', device); else lsDel('clientId');
    }

    function doLogout() {
        var token = ls(LS_TOKEN);
        busy(true); message('Выходим…', false);
        var finish = function () { signOutLocal(); reloadSoon('Вы вышли из аккаунта. Перезагружаем приложение…'); };
        api('logout', {}, token).then(finish, finish);
    }

    // ------------------------------------------------------- восстановление

    var recoverCode = '';

    function openRecover() {
        message('', false);
        recoverCode = '';
        var c = el('account-recover-code'); if (c) { c.value = ''; c.disabled = false; }
        var p = el('account-new-password'); if (p) p.value = '';
        show('account-recover-step2', false);
        show('account-recover-check-btn', true);
        show('account-recover-reset-btn', false);
        render('recover');
        focusIn('account-recover-code');
    }

    function doRecoverCheck() {
        var c = el('account-recover-code');
        var code = c ? c.value.trim() : '';
        if (!code) { message('Введите код восстановления', true); return; }
        busy(true); message('Проверяем код…', false);
        api('recover/check', { code: code }).then(function (d) {
            busy(false);
            if (!d.success) { message(d.error || 'Неверный код', true); return; }
            recoverCode = code;
            message('', false);
            var l = el('account-recover-login'); if (l) l.textContent = d.login;
            if (c) c.disabled = true;
            show('account-recover-step2', true);
            show('account-recover-check-btn', false);
            show('account-recover-reset-btn', true);
            if (typeof window.invalidateFocusCache === 'function') window.invalidateFocusCache();
            focusIn('account-new-password');
        })['catch'](function () { busy(false); message('Сервер недоступен', true); });
    }

    function doRecoverReset() {
        var p = el('account-new-password');
        var password = p ? p.value : '';
        if (!password) { message('Введите новый пароль', true); return; }
        busy(true); message('Сохраняем пароль…', false);
        api('recover/reset', { code: recoverCode, password: password, clientId: deviceIdForMerge() }).then(function (d) {
            if (!d.success) { busy(false); message(d.error || 'Не удалось сменить пароль', true); return; }
            enterAccount(d);
            reloadSoon('Пароль изменён, вы вошли как ' + d.login + '. Перезагружаем приложение…');
        })['catch'](function () { busy(false); message('Сервер недоступен', true); });
    }

    function cancelRecover() {
        message('', false);
        render(isSignedIn() ? 'in' : 'out');
        focusIn(isSignedIn() ? 'account-logout-btn' : 'account-login');
    }

    // -------------------------------------------------- проверка при старте

    /**
     * Сессия ещё жива? Выход на другом устройстве её не трогает, а вот
     * восстановление пароля закрывает все сессии аккаунта — такое устройство
     * молча возвращаем к его собственным данным.
     *
     * Если clientId разошёлся с аккаунтом (например, поверх сделали
     * «Синхронизацию» по коду), выравниваем его — один раз за сессию вкладки,
     * чтобы не уйти в цикл перезагрузок.
     */
    function verifySession() {
        var token = ls(LS_TOKEN);
        if (!token) return;
        api('me', null, token).then(function (d) {
            if (d._status === 401) {
                signOutLocal();
                location.reload();
                return;
            }
            if (!d.success) return;
            if (d.login && d.login !== ls(LS_LOGIN)) { lsSet(LS_LOGIN, d.login); render('in'); }
            if (d.dataId && ls('clientId') !== d.dataId) {
                var aligned = false;
                try { aligned = sessionStorage.getItem(SS_ALIGN) === '1'; } catch (e) { }
                if (aligned) return;
                try { sessionStorage.setItem(SS_ALIGN, '1'); } catch (e) { }
                lsSet('clientId', d.dataId);
                location.reload();
            }
        })['catch'](function () { /* сервер недоступен — работаем как есть */ });
    }

    // ----------------------------------------------------------- подключение

    function bind(id, fn) {
        var e = el(id);
        if (e) e.addEventListener('click', function (ev) { ev.preventDefault(); fn(); });
    }

    function init() {
        if (!el('account-tab-content')) return;
        bind('account-login-btn', doLogin);
        bind('account-register-btn', doRegister);
        bind('account-forgot-btn', openRecover);
        bind('account-logout-btn', doLogout);
        bind('account-recovery-ok-btn', doRecoveryOk);
        bind('account-recover-check-btn', doRecoverCheck);
        bind('account-recover-reset-btn', doRecoverReset);
        bind('account-recover-cancel-btn', cancelRecover);
        render(isSignedIn() ? 'in' : 'out');
        verifySession();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.Account = {
        isSignedIn: isSignedIn,
        login: function () { return ls(LS_LOGIN); }
    };
})();
