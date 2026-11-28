/**
 * Расширения (плагины) фронтенда — раздел настроек «Расширения».
 *
 * Плагин — это .js по ссылке. Выполняется он НЕ на странице приложения, а в
 * своём iframe с sandbox="allow-scripts" без allow-same-origin: у такого
 * документа «пустой» (opaque) origin, поэтому
 *   • DOM, localStorage, IndexedDB и cookie приложения ему недоступны —
 *     а там лежат authToken учётки (у админа это вход в /potate), пароль
 *     TorrServer (#auth-password), clientId устройства;
 *   • сеть закрыта CSP документа (connect-src 'none'): ни fetch, ни XHR, ни
 *     WebSocket. Запросы — только через TS.fetch, его выполняет приложение без
 *     cookie и отказывает адресам сервера TorrStream, TorrServer, самой
 *     страницы и домашней сети (сервер без пароля пускает запросы из LAN);
 *   • ни всплывающих окон, ни форм, ни перехода всей вкладки (нет allow-*).
 *
 * Всё, что плагину можно, — сообщения приложению (postMessage), каждое
 * проверяется здесь: свой CSS (без url() и @import — ими можно вынести
 * значения полей на чужой сервер), скрыть/переименовать элементы, кнопка в
 * карточке, блок в карточке (HTML чистится по белому списку), своё окно поверх
 * интерфейса, всплывающее сообщение, хранилище.
 *
 * Хранилище плагина — запись в IndexedDB приложения (база ts-extensions), у
 * каждого своя и с лимитом; другие плагины и данные приложения ему не видны.
 * Список установленных — в localStorage (extensions): маленький и нужен на
 * старте синхронно.
 *
 * Аварийный выход: ?noext=1 в адресе — запуск без расширений.
 *
 * Документация для авторов — https://cash94.github.io/docs/extensions/ (docs/extensions в репо зеркала).
 */
(function () {
    'use strict';

    var LIST_KEY = 'extensions';
    var DB_NAME = 'ts-extensions';
    var DB_STORE = 'data';
    // Лимит хранилища одного плагина — в символах JSON
    var STORAGE_LIMIT = 1000000;
    var CSS_LIMIT = 100000;
    var HTML_LIMIT = 50000;
    var FETCH_LIMIT = 2 * 1024 * 1024;
    var FETCH_TIMEOUT_MS = 15000;
    var FETCH_PARALLEL = 6;
    var MAX_BUTTONS = 3;
    // Старт после главной: на телевизоре первые секунды заняты рядами и баннером
    var START_DELAY_MS = 2500;
    var POLL_MS = 600;

    var plugins = [];          // записи из localStorage
    var running = {};          // id → состояние запущенного плагина
    var catalogCache = null;
    var panelPlugin = null;    // id плагина, чьё окно открыто
    var panelReturnFocus = null;

    function log() {
        try { console.log.apply(console, ['🧩'].concat([].slice.call(arguments))); } catch (e) { }
    }

    function mirrorBase() {
        return location.search.indexOf('local=1') !== -1 ? '/' : 'https://cash94.github.io/msx/';
    }

    // ==================== СПИСОК ====================

    function loadList() {
        try {
            var raw = JSON.parse(localStorage.getItem(LIST_KEY) || '[]');
            plugins = [];
            for (var i = 0; i < raw.length; i++) {
                if (raw[i] && raw[i].id && raw[i].url) plugins.push(raw[i]);
            }
        } catch (e) { plugins = []; }
    }

    function saveList() {
        try { localStorage.setItem(LIST_KEY, JSON.stringify(plugins)); } catch (e) { }
    }

    function findPlugin(id) {
        for (var i = 0; i < plugins.length; i++) if (plugins[i].id === id) return plugins[i];
        return null;
    }

    function pluginIdFor(url) {
        // Ссылка → короткий id (djb2): по нему хранилище, стили и кнопки
        var h = 5381;
        for (var i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) >>> 0;
        return 'x' + h.toString(36);
    }

    function nameFromUrl(url) {
        var m = /\/([^\/?#]+?)(?:\.js)?(?:[?#].*)?$/.exec(url);
        return m ? decodeURIComponent(m[1]) : url;
    }

    function parseUrl(url) {
        try { return new URL(url, location.href); } catch (e) { }
        var a = document.createElement('a');
        a.href = url;
        return { protocol: a.protocol, hostname: a.hostname, host: a.host, href: a.href, origin: a.protocol + '//' + a.host };
    }

    function validPluginUrl(url) {
        if (!/^https?:\/\/[^\s"'<>]+$/i.test(url)) return null;
        var u = parseUrl(url);
        if (!u || !/^https?:$/.test(u.protocol) || !u.hostname) return null;
        return u;
    }

    // ==================== ХРАНИЛИЩЕ (IndexedDB) ====================

    var dbPromise = null;
    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise(function (resolve) {
            try {
                if (!window.indexedDB) { resolve(null); return; }
                var req = indexedDB.open(DB_NAME, 1);
                req.onupgradeneeded = function () {
                    if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
                };
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { resolve(null); };
                req.onblocked = function () { resolve(null); };
            } catch (e) { resolve(null); }
        });
        return dbPromise;
    }

    function dbGet(id) {
        return openDb().then(function (db) {
            if (!db) return {};
            return new Promise(function (resolve) {
                try {
                    var r = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(id);
                    r.onsuccess = function () { resolve(r.result && typeof r.result === 'object' ? r.result : {}); };
                    r.onerror = function () { resolve({}); };
                } catch (e) { resolve({}); }
            });
        });
    }

    function dbPut(id, data) {
        return openDb().then(function (db) {
            if (!db) return;
            try {
                var store = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE);
                if (data === null) store['delete'](id); else store.put(data, id);
            } catch (e) { log('хранилище: запись не удалась', e); }
        });
    }

    function scheduleSave(st) {
        if (st.saveTimer) clearTimeout(st.saveTimer);
        st.saveTimer = setTimeout(function () { st.saveTimer = null; dbPut(st.id, st.data); }, 300);
    }

    // ==================== ПЕСОЧНИЦА ====================

    /*
     * Код внутри iframe. Сериализуется через toString(), поэтому никаких
     * ссылок наружу: всё, что ему нужно, приходит сообщением init.
     */
    function sandboxRuntime() {
        var parentWin = window.parent;
        var handlers = {};
        var pending = {};
        var reqSeq = 0;
        var store = {};
        var info = {};
        var keyHandlerSet = false;

        function send(msg) { msg.__tsx = 1; parentWin.postMessage(msg, '*'); }

        function emit(name, data) {
            var list = handlers[name] || [];
            var handled = false;
            for (var i = 0; i < list.length; i++) {
                try { if (list[i](data) === true) handled = true; } catch (e) { reportError(e); }
            }
            return handled;
        }

        function reportError(e) {
            send({ type: 'error', message: String(e && e.message || e).slice(0, 500) });
        }

        window.onerror = function (msg, src, line) {
            send({ type: 'error', message: String(msg).slice(0, 400) + (line ? ' (строка ' + line + ')' : '') });
        };

        function copy(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

        // ---- Навигация пультом внутри окна плагина ----
        // Фокусируемое — button, a, [data-focus]. Класс .focused на текущем.
        // Ходим рядами, как по рядам приложения: вверх-вниз — в ближайший ряд
        // (в нём на отмеченную .on кнопку — выбранная озвучка, сезон, — иначе на
        // ближайшую по горизонтали), влево-вправо — только в своём ряду
        function focusables() {
            var all = document.querySelectorAll('button, a[href], [data-focus]');
            var out = [];
            for (var i = 0; i < all.length; i++) {
                var el = all[i];
                if (el.disabled || el.offsetParent === null) continue;
                out.push(el);
            }
            return out;
        }
        function current() { return document.querySelector('.focused'); }
        function focus(el) {
            var c = current();
            if (c) c.classList.remove('focused');
            if (!el) return;
            el.classList.add('focused');
            if (el.scrollIntoView) { try { el.scrollIntoView({ block: 'nearest' }); } catch (e) { el.scrollIntoView(false); } }
        }
        function move(dir) {
            var list = focusables();
            if (!list.length) return;
            var c = current();
            if (!c || list.indexOf(c) === -1) { focus(list[0]); return; }
            var r = c.getBoundingClientRect();
            var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
            var i, q, best = null, bestScore = Infinity;
            if (dir === 'left' || dir === 'right') {
                for (i = 0; i < list.length; i++) {
                    if (list[i] === c) continue;
                    q = list[i].getBoundingClientRect();
                    var qy = q.top + q.height / 2, dx = q.left + q.width / 2 - cx;
                    // Свой ряд — центры по вертикали в пределах половины высоты
                    if (Math.abs(qy - cy) > Math.max(r.height, q.height) / 2) continue;
                    if (dir === 'left' ? dx >= -1 : dx <= 1) continue;
                    if (Math.abs(dx) < bestScore) { bestScore = Math.abs(dx); best = list[i]; }
                }
                if (best) focus(best);
                return;
            }
            // Вверх-вниз: сначала ближайший ряд, потом кнопка в нём
            var cand = [], rowY = null;
            for (i = 0; i < list.length; i++) {
                if (list[i] === c) continue;
                q = list[i].getBoundingClientRect();
                if (dir === 'down' ? q.top < r.bottom - 2 : q.bottom > r.top + 2) continue;
                var y = q.top + q.height / 2;
                cand.push({ el: list[i], q: q, y: y });
                if (rowY === null || Math.abs(y - cy) < Math.abs(rowY - cy)) rowY = y;
            }
            if (!cand.length) return;
            for (i = 0; i < cand.length; i++) {
                if (Math.abs(cand[i].y - rowY) > cand[i].q.height / 2) continue;
                var score = cand[i].el.classList.contains('on') ? -1 : Math.abs(cand[i].q.left + cand[i].q.width / 2 - cx);
                if (score < bestScore) { bestScore = score; best = cand[i].el; }
            }
            if (best) focus(best);
        }

        // Клавиши, нажатые, пока фокус ввода внутри окна (человек щёлкнул по нему
        // мышью), до приложения не доходят — пересылаем, приложение решит само
        document.addEventListener('keydown', function (e) {
            var t = e.target;
            if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
            send({ type: 'native-key', keyCode: e.keyCode || e.which || 0 });
            e.preventDefault();
        }, true);

        var TS = {
            version: 2,
            info: function () { return copy(info); },
            on: function (name, fn) {
                if (typeof fn !== 'function') return;
                (handlers[name] = handlers[name] || []).push(fn);
            },
            off: function (name, fn) {
                var list = handlers[name] || [];
                var i = list.indexOf(fn);
                if (i !== -1) list.splice(i, 1);
            },
            register: function (meta) {
                meta = meta || {};
                send({
                    type: 'register',
                    name: String(meta.name || '').slice(0, 60),
                    version: String(meta.version || '').slice(0, 20),
                    description: String(meta.description || '').slice(0, 300),
                    settings: !!meta.settings
                });
            },
            toast: function (text) { send({ type: 'toast', text: String(text).slice(0, 200) }); },
            storage: {
                get: function (key, def) { return store.hasOwnProperty(key) ? copy(store[key]) : def; },
                set: function (key, value) {
                    store[String(key)] = copy(value);
                    send({ type: 'storage', op: 'set', key: String(key), value: store[String(key)] });
                },
                remove: function (key) {
                    delete store[key];
                    send({ type: 'storage', op: 'remove', key: String(key) });
                },
                keys: function () { return Object.keys(store); },
                clear: function () { store = {}; send({ type: 'storage', op: 'clear' }); }
            },
            ui: {
                addStyle: function (css) { send({ type: 'style', css: String(css) }); },
                hide: function (selector) { send({ type: 'hide', selector: String(selector) }); },
                setText: function (selector, text) { send({ type: 'text', selector: String(selector), text: String(text) }); },
                // Кнопка в строке действий карточки. Где встать: before / after —
                // ключ кнопки приложения (TS.ui.detailButtons()) или 'ext:<id>' своей
                // кнопки; position: 'start' | 'end'. Вид: style 'round' (круг со
                // значком и подписью, как «Трейлер») | 'wide' (с текстом) |
                // 'primary' (белая, как «Продолжить»)
                addButton: function (opts) { send(buttonMsg('button', opts)); },
                // Только переданные поля: label, icon, hidden, style, before/after/position
                updateButton: function (id, changes) {
                    var m = buttonMsg('button-update', changes);
                    m.id = String(id || 'main');
                    send(m);
                },
                removeButton: function (id) { send({ type: 'button-remove', id: String(id || 'main') }); },
                // Кнопки строки сейчас: [{ key, label, visible, own }] по порядку
                detailButtons: function () { return call('detailButtons', {}); },
                setDetailBlock: function (html) { send({ type: 'block', html: String(html || '') }); }
            },
            panel: {
                open: function (title) { send({ type: 'panel', open: true, title: title ? String(title).slice(0, 80) : '' }); },
                close: function () { send({ type: 'panel', open: false }); },
                focus: function (el) { focus(el); }
            },
            fetch: function (url, opts) {
                opts = opts || {};
                return new Promise(function (resolve, reject) {
                    var id = ++reqSeq;
                    pending[id] = { resolve: resolve, reject: reject };
                    send({
                        type: 'fetch', reqId: id, url: String(url),
                        method: String(opts.method || 'GET').toUpperCase(),
                        headers: opts.headers || {},
                        body: opts.body == null ? null : String(opts.body)
                    });
                });
            },
            // Мост к DOM приложения: элементы — описания { h, tag, id, cls, text,
            // attrs, own, focused, visible, rect? }, h — номер для следующих вызовов
            dom: {
                query: function (selector, opts) { return call('query', { sel: String(selector), opts: opts || {} }); },
                closest: function (node, selector) { return call('closest', { h: hid(node), sel: String(selector) }); },
                children: function (node) { return call('children', { h: hid(node) }); },
                focused: function () { return call('focused', {}); },
                create: function (html, opts) {
                    opts = opts || {};
                    var parent = opts.parent;
                    return call('create', {
                        html: String(html),
                        parent: parent && typeof parent === 'object' ? parent.h : parent,
                        where: opts.where || 'append'
                    });
                },
                update: function (node, changes) { return call('update', { h: hid(node), ch: changes || {} }); },
                remove: function (node) { return call('remove', { h: hid(node) }); },
                click: function (node) { return call('click', { h: hid(node) }); },
                focus: function (node) { return call('focus', { h: hid(node) }); },
                on: function (selector, type, fn) {
                    if (typeof fn !== 'function') return;
                    var lid = ++reqSeq;
                    domHandlers[lid] = fn;
                    send({ type: 'listen', lid: lid, sel: String(selector), ev: String(type || 'click') });
                }
            },
            keys: {
                // Пульт плагину (стрелки, ОК → событие key), пока не вернёт или пока
                // не нажмут «Назад» — тот возвращает всегда. opts.keys — только эти
                // кнопки (['up','down','left','right','enter','back']), остальные
                // работают в приложении как обычно: например, стрелки свои, а ОК —
                // приложения, которое запускает серию или открывает карточку
                capture: function (on, opts) {
                    var keys = opts && opts.keys ? [].concat(opts.keys).map(String) : null;
                    send({ type: 'capture', on: !!on, keys: keys });
                }
            },
            app: {
                home: function () { return call('home', {}); },
                screen: function () { return call('screen', {}); },
                item: function (node) { return call('item', { h: hid(node) }); },
                // Ряд главной по номеру (из TS.app.home()) — с любого экрана, фокус на
                // карточку, где в ряду стояли
                openRow: function (index) { return call('openRow', { index: +index }); },
                // Категория каталога по ключу плитки (data-home-cat: movie, tv, anime…)
                openCategory: function (key) { return call('openCategory', { key: String(key) }); },
                // Рекомендуемые настройки «Внешнего вида» — в меню расширения появится
                // «Применить рекомендуемые настройки». Сами по себе не применяются
                recommend: function (settings) { send({ type: 'recommend', settings: settings || {} }); },
                // Сведения открытой карточки — свежие (IMDb, сезоны дописываются,
                // когда TMDB ответит), null — карточка не открыта
                detail: function () { return call('detail', {}); }
            },
            // Источник онлайн-просмотра: в карточке появится общая кнопка «Онлайн»
            // (одна на все такие расширения; источников несколько — приложение
            // спросит, какой). Нажали — событие 'online' { item } этому плагину
            online: {
                register: function (meta) {
                    meta = meta || {};
                    send({
                        type: 'online', on: true,
                        name: String(meta.name || '').slice(0, 40),
                        types: meta.types ? [].concat(meta.types).map(String) : null
                    });
                },
                unregister: function () { send({ type: 'online', on: false }); }
            },
            // Воспроизведение по ссылке — только в ответ на действие человека.
            // opts: url | quality {'1080p': url}, title, poster, subtitles
            // [{ label, url, language, default }], playlist [{ url | quality, title,
            // season, episode, subtitles }] + index, startAt (с), headers (Android)
            player: {
                play: function (opts) { return call('play', { opts: copy(opts || {}) }); }
            }
        };
        window.TS = TS;

        function buttonMsg(type, o) {
            o = o || {};
            var m = { type: type };
            if (o.id != null) m.id = String(o.id);
            if (o.label != null) m.label = String(o.label);
            if (o.icon != null) m.icon = String(o.icon);
            if (o.style != null) m.style = String(o.style);
            if (o.hidden != null) m.hidden = !!o.hidden;
            if (o.before != null) m.before = String(o.before);
            if (o.after != null) m.after = String(o.after);
            if (o.position != null) m.position = String(o.position);
            return m;
        }

        var domHandlers = {};
        function hid(x) { return x && typeof x === 'object' ? x.h : x; }
        function call(op, args) {
            return new Promise(function (resolve, reject) {
                var id = ++reqSeq;
                pending[id] = { resolve: resolve, reject: reject, call: true };
                send({ type: 'call', reqId: id, op: op, args: args });
            });
        }
        // Событиям nav и home нужна подписка: без неё приложение их не шлёт
        var origOn = TS.on;
        TS.on = function (name, fn) {
            if ((name === 'nav' || name === 'home') && !(handlers[name] && handlers[name].length)) {
                send({ type: 'subscribe', name: name });
            }
            origOn(name, fn);
        };

        window.addEventListener('message', function (e) {
            if (e.source !== parentWin) return;
            var m = e.data;
            if (!m || m.__tsx !== 1) return;
            if (m.type === 'init') {
                store = m.storage || {};
                info = m.info || {};
                document.documentElement.style.setProperty('--focus-color', m.focusColor || '#ff8c00');
                var s = document.createElement('script');
                s.src = m.src;
                // Не загрузился — чаще всего адрес в домашней сети: Chrome не
                // пускает документ с непубличным origin в локальную сеть
                // (Private Network Access). Тогда код скачивает приложение
                s.onerror = function () { send({ type: 'need-code' }); };
                document.head.appendChild(s);
            } else if (m.type === 'code') {
                if (m.error) { send({ type: 'error', message: m.error }); return; }
                try { (0, eval)(String(m.text) + '\n//# sourceURL=' + m.src); } catch (err) { reportError(err); }
            } else if (m.type === 'event') {
                if (m.name === 'key') {
                    if (!emit('key', m.data)) {
                        if (m.data === 'enter') {
                            var c = current();
                            if (c && c.click) c.click();
                        } else move(m.data);
                    }
                } else {
                    if (m.name === 'panel' && m.data && m.data.open && !current()) {
                        setTimeout(function () { var l = focusables(); if (l.length && !current()) focus(l[0]); }, 0);
                    }
                    emit(m.name, m.data);
                }
            } else if (m.type === 'call') {
                var pc = pending[m.reqId];
                if (!pc) return;
                delete pending[m.reqId];
                if (m.error) pc.reject(new Error(m.error)); else pc.resolve(m.result);
            } else if (m.type === 'dom-event') {
                var fn = domHandlers[m.lid];
                if (fn) { try { fn(m.node); } catch (err) { reportError(err); } }
            } else if (m.type === 'fetch') {
                var p = pending[m.reqId];
                if (!p) return;
                delete pending[m.reqId];
                if (m.error) { p.reject(new Error(m.error)); return; }
                var text = m.text || '';
                p.resolve({
                    ok: m.ok, status: m.status, url: m.url,
                    text: function () { return Promise.resolve(text); },
                    json: function () { try { return Promise.resolve(JSON.parse(text)); } catch (err) { return Promise.reject(err); } }
                });
            }
        });

        send({ type: 'hello' });
    }

    var SANDBOX_CSS =
        'html,body{margin:0;padding:0;background:transparent;color:#fff;' +
        'font-family:Inter,Roboto,"Segoe UI",Arial,sans-serif;font-size:20px;line-height:1.4}' +
        'body{padding:24px 32px;box-sizing:border-box}' +
        'button,a,[data-focus]{outline:none}' +
        'button{font:inherit;color:#fff;background:rgba(255,255,255,.12);border:0;border-radius:10px;' +
        'padding:10px 20px;margin:0 10px 10px 0;cursor:pointer}' +
        '.focused{background:var(--focus-color,#ff8c00)!important;color:#fff!important;' +
        'box-shadow:0 0 0 3px rgba(255,255,255,.45)}' +
        'a{color:inherit}';

    function escAttr(s) {
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function sandboxDocument(u) {
        // script-src — только сам код песочницы и источник плагина; сеть
        // (connect-src) закрыта целиком, картинки и медиа — только https
        var csp = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' " + u.origin +
            "; style-src 'unsafe-inline'; img-src https: data: blob:; media-src https: blob:; font-src https: data:; connect-src 'none'";
        return '<!doctype html><html><head><meta charset="utf-8">' +
            '<meta http-equiv="Content-Security-Policy" content="' + escAttr(csp) + '">' +
            '<style>' + SANDBOX_CSS + '</style>' +
            '<script>(' + sandboxRuntime.toString() + ')();<\/script>' +
            '</head><body></body></html>';
    }

    function hostLayer() {
        var el = document.getElementById('ext-host');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'ext-host';
        document.body.appendChild(el);
        return el;
    }

    function startPlugin(p) {
        if (running[p.id]) return;
        var u = validPluginUrl(p.url);
        if (!u) { p.error = 'Неверная ссылка'; return; }
        var frame = document.createElement('iframe');
        frame.className = 'ext-frame';
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.setAttribute('title', 'Расширение ' + (p.name || ''));
        frame.setAttribute('tabindex', '-1');
        frame.setAttribute('referrerpolicy', 'no-referrer');
        var st = {
            id: p.id, plugin: p, frame: frame, url: u, data: null, dataPromise: dbGet(p.id),
            buttons: [], styleEl: null, cssParts: [], block: '', fetching: 0, loads: 0, ready: false,
            // Мост к DOM: номера элементов, делегированные обработчики, откат
            // правок элементов приложения (при выключении плагина)
            nodes: [null], ids: window.WeakMap ? new WeakMap() : null, listeners: [], undo: [],
            wantsNav: false, wantsHome: false,
            // Переходы openRow/openCategory: когда плагину последний раз пришла кнопка
            // пульта (key или nav) и не потрачен ли разовый переход на старте
            keyAt: 0, startedAt: Date.now(), startOpen: true
        };
        running[p.id] = st;
        p.error = '';
        frame.addEventListener('load', function () {
            st.loads++;
            // Документ песочницы грузится один раз. Повторный load — плагин сам
            // перешёл по адресу (location = …): такой больше не наш, выключаем
            if (st.loads > 1) {
                log('плагин ушёл со своей страницы — остановлен:', p.name);
                stopPlugin(p.id);
                p.error = 'Остановлен: попытка перейти по другому адресу';
                renderSettings();
            }
        });
        frame.srcdoc = sandboxDocument(u);
        hostLayer().appendChild(frame);
        log('запуск', p.name || p.url);
    }

    function stopPlugin(id) {
        var st = running[id];
        if (!st) return;
        if (panelPlugin === id) closePanel();
        if (st.saveTimer) { clearTimeout(st.saveTimer); dbPut(id, st.data); }
        if (st.frame && st.frame.parentNode) st.frame.parentNode.removeChild(st.frame);
        if (st.styleEl && st.styleEl.parentNode) st.styleEl.parentNode.removeChild(st.styleEl);
        if (captureOwner === id) releaseCapture();
        if (extPlayback && extPlayback.st === st) finishExtPlayback('stopped');
        revertDom(st);
        delete running[id];
        renderDetailExtras();
    }

    function stateBySource(win) {
        for (var id in running) {
            if (running.hasOwnProperty(id) && running[id].frame.contentWindow === win) return running[id];
        }
        return null;
    }

    function post(st, msg) {
        if (!st || !st.frame.contentWindow) return;
        msg.__tsx = 1;
        try { st.frame.contentWindow.postMessage(msg, '*'); } catch (e) { }
    }

    function emitTo(st, name, data) {
        if (!st.ready) return;
        if (name === 'key' || name === 'nav') st.keyAt = Date.now();
        post(st, { type: 'event', name: name, data: data });
    }

    function emitAll(name, data) {
        for (var id in running) if (running.hasOwnProperty(id)) emitTo(running[id], name, data);
    }

    // ==================== САНИТАЙЗЕРЫ ====================

    /*
     * CSS без внешних загрузок. url()/image-set()/@import позволили бы
     * селектором по значению поля (input[value^="a"]) отправлять его на чужой
     * сервер; обратная косая черта запрещена целиком — экранированием эти
     * слова пишутся в обход проверки.
     */
    var CSS_FORBIDDEN = /\\|url\s*\(|image-set\s*\(|image\s*\(|cross-fade\s*\(|element\s*\(|@import|@namespace|@font-face|expression\s*\(|javascript:|behavior\s*:|-moz-binding|<\/?\s*style/i;

    function cleanCss(css) {
        css = String(css || '');
        if (css.length > CSS_LIMIT) return null;
        if (CSS_FORBIDDEN.test(css)) return null;
        return css;
    }

    function validSelector(sel) {
        sel = String(sel || '');
        if (!sel || sel.length > 500 || /[{}<>\\]/.test(sel)) return false;
        try { document.querySelector(sel); return true; } catch (e) { return false; }
    }

    /*
     * Закрытая зона: настройки (адрес и пароль TorrServer, учётка, Jacred),
     * поля паролей, окна самих расширений и встроенная клавиатура (она видит
     * всё, что печатают). Здесь плагин не читает, не пишет и не кликает.
     */
    var PROTECTED_SEL = '#config-screen, #ext-host, #ext-panel-head, .ext-modal, #osk, script, style, head, input[type="password"]';

    function isProtected(el) {
        if (!el || !el.closest || el.nodeType !== 1) return true;
        return !!el.closest(PROTECTED_SEL);
    }

    var HTML_TAGS = {
        DIV: 1, SPAN: 1, P: 1, B: 1, I: 1, U: 1, S: 1, STRONG: 1, EM: 1, SMALL: 1, BR: 1, HR: 1,
        UL: 1, OL: 1, LI: 1, H3: 1, H4: 1, H5: 1, IMG: 1, TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, TD: 1, TH: 1
    };
    // TS.dom.create: свои элементы плагина — ещё и разметка блоков и кнопки
    var RICH_TAGS = {
        BUTTON: 1, SECTION: 1, HEADER: 1, FOOTER: 1, NAV: 1, ASIDE: 1, ARTICLE: 1, LABEL: 1,
        H1: 1, H2: 1, H6: 1, FIGURE: 1, FIGCAPTION: 1
    };
    // Атрибуты, которые можно читать у элементов приложения и ставить им и своим
    var SAFE_ATTR = /^(data-(?!ext$)[\w-]+|aria-[\w-]+|title|role|alt|hidden)$/;

    function cleanStyleAttr(style) {
        var css = cleanCss(style);
        return css && css.length < 1000 ? css : '';
    }

    function cleanNode(src, dst, extId) {
        for (var n = src.firstChild; n; n = n.nextSibling) {
            if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.nodeValue)); continue; }
            if (n.nodeType !== 1) continue;
            var tag = n.tagName.toUpperCase();
            if (!HTML_TAGS[tag] && !(extId && RICH_TAGS[tag])) {
                // Неизвестный тег — только его текст (script/style — ничего)
                if (tag !== 'SCRIPT' && tag !== 'STYLE') cleanNode(n, dst, extId);
                continue;
            }
            var el = document.createElement(tag);
            if (extId) {
                // Метка владельца: по ней элементы убираются вместе с плагином,
                // и только свои он может удалять и наполнять разметкой
                el.setAttribute('data-ext', extId);
                for (var a = 0; a < n.attributes.length; a++) {
                    var an = n.attributes[a].name.toLowerCase();
                    if (SAFE_ATTR.test(an)) el.setAttribute(an, String(n.attributes[a].value).slice(0, 500));
                }
                // id — только с приставкой ext-: иначе свой элемент встал бы на
                // место элемента приложения в getEl (кэш по id)
                var nid = n.getAttribute('id');
                if (nid && /^ext-[\w-]{1,60}$/.test(nid)) el.id = nid;
                var ti = n.getAttribute('tabindex');
                if (ti !== null && /^-?\d$/.test(ti)) el.setAttribute('tabindex', ti);
                if (tag === 'BUTTON') el.setAttribute('type', 'button');
            }
            var cls = n.getAttribute('class');
            if (cls) el.setAttribute('class', String(cls).slice(0, 200));
            var style = n.getAttribute('style');
            if (style) { var cs = cleanStyleAttr(style); if (cs) el.setAttribute('style', cs); }
            var title = n.getAttribute('title');
            if (title) el.setAttribute('title', String(title).slice(0, 200));
            if (tag === 'IMG') {
                var s = String(n.getAttribute('src') || '');
                if (!/^https:\/\//i.test(s) && !/^data:image\/(png|jpe?g|gif|webp);/i.test(s)) continue;
                el.setAttribute('src', s);
                el.setAttribute('referrerpolicy', 'no-referrer');
                var alt = n.getAttribute('alt');
                if (alt) el.setAttribute('alt', String(alt).slice(0, 200));
            }
            cleanNode(n, el, extId);
            dst.appendChild(el);
        }
    }

    function cleanHtml(html, extId) {
        html = String(html || '');
        if (html.length > HTML_LIMIT) return null;
        var frag = document.createDocumentFragment();
        try {
            // Документ DOMParser неактивен: скрипты не выполняются, картинки не грузятся
            var doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
            cleanNode(doc.body, frag, extId);
        } catch (e) { return null; }
        return frag;
    }

    // ==================== МОСТ К DOM ====================
    /*
     * Плагин в песочнице не видит DOM приложения — ему отдаются описания
     * элементов (тег, классы, текст, безопасные атрибуты) с номером h, а
     * правки идут сообщениями и проверяются здесь. Закрытая зона (isProtected)
     * не читается и не меняется; значения полей (value) не отдаются нигде.
     * Кликать можно только по своим элементам и по навигации (CLICK_ALLOWED):
     * пункты шапки, карточки, плитки, кнопки карточки, кроме тех, что
     * что-то меняют (избранное), — плагин не должен действовать за человека.
     */
    var CLICK_ALLOWED = '.home-nav-btn, .catalog-row-card, .catalog-card, .home-cat-tile, .torrent-card, ' +
        '.search-result-item, .catalog-actor-card, .catalog-recommendation-card, .catalog-episode-card, ' +
        '#catalog-detail-actions > button:not(#catalog-favorite-btn), .back-btn';
    var QUERY_LIMIT = 500;
    var captureOwner = null;   // id плагина, которому отдан пульт
    var captureKeys = null;    // какие кнопки отданы (null — все)

    function releaseCapture() { captureOwner = null; captureKeys = null; }
    var CAPTURE_DIRS = ['up', 'down', 'left', 'right', 'enter', 'back'];
    var CAPTURE_SCAN = 32;     // сколько элементов списка keys вообще разбираем
    // Что умеет этот мост — плагин сверяется с TS.info().features
    var FEATURES = ['capture-keys', 'focus-home-row', 'open-row', 'open-category', 'recommend',
        'button-placement', 'button-style', 'online', 'player', 'detail'];

    function handleOf(st, el) {
        if (st.ids) {
            var known = st.ids.get(el);
            if (known && st.nodes[known] === el) return known;
        } else {
            for (var i = 1; i < st.nodes.length; i++) if (st.nodes[i] === el) return i;
        }
        // Отвалившиеся из документа — освобождаем, чтобы список не рос без конца
        if (st.nodes.length > 5000) {
            for (var j = 1; j < st.nodes.length; j++) {
                if (st.nodes[j] && !document.documentElement.contains(st.nodes[j])) st.nodes[j] = null;
            }
        }
        var h = st.nodes.length;
        st.nodes.push(el);
        if (st.ids) st.ids.set(el, h);
        return h;
    }

    function nodeOf(st, h) {
        var el = st.nodes[+h];
        if (!el || !document.documentElement.contains(el)) return null;
        return el;
    }

    function isOwn(st, el) { return el.getAttribute('data-ext') === st.id; }

    function safeUrl(u) {
        u = String(u || '');
        if (/^data:image\//i.test(u)) return u;
        return /^https?:/i.test(u) && !fetchAllowed(u) ? u : '';
    }

    function describe(st, el, opts) {
        opts = opts || {};
        var d = {
            h: handleOf(st, el),
            tag: el.tagName.toLowerCase(),
            id: el.id || '',
            cls: typeof el.className === 'string' ? el.className : (el.getAttribute('class') || ''),
            own: isOwn(st, el),
            focused: el.classList.contains('focused'),
            visible: el.offsetParent !== null || el === document.body
        };
        if (opts.text !== false) d.text = String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300);
        var attrs = {};
        for (var i = 0; i < el.attributes.length; i++) {
            var n = el.attributes[i].name;
            if (SAFE_ATTR.test(n)) attrs[n] = String(el.attributes[i].value).slice(0, 300);
        }
        // Адреса — только публичные: сервер и TorrServer не показываем
        if (el.tagName === 'IMG') { var s = safeUrl(el.getAttribute('src')); if (s) attrs.src = s; }
        d.attrs = attrs;
        if (opts.rect) {
            var r = el.getBoundingClientRect();
            d.rect = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        }
        return d;
    }

    function describeAll(st, list, opts) {
        var out = [];
        var limit = Math.min(+((opts || {}).limit) || 200, QUERY_LIMIT);
        for (var i = 0; i < list.length && out.length < limit; i++) {
            if (!isProtected(list[i])) out.push(describe(st, list[i], opts));
        }
        return out;
    }

    function logUndo(st, el, kind, name, old) {
        if (isOwn(st, el)) return;   // свои уйдут вместе с плагином
        st.undo.push({ el: el, kind: kind, name: name, old: old });
        if (st.undo.length > 5000) st.undo.splice(0, 1000);
    }

    /** Плагин выключили — его элементы прочь, правки элементов приложения назад */
    function revertDom(st) {
        var own = document.querySelectorAll('[data-ext="' + st.id + '"]');
        for (var i = 0; i < own.length; i++) if (own[i].parentNode) own[i].parentNode.removeChild(own[i]);
        for (var j = st.undo.length - 1; j >= 0; j--) {
            var u = st.undo[j], el = u.el;
            try {
                if (u.kind === 'class-add') el.classList.remove(u.name);
                else if (u.kind === 'class-remove') el.classList.add(u.name);
                else if (u.kind === 'style') el.style.setProperty(u.name, u.old.v, u.old.p);
                else if (u.kind === 'attr') { if (u.old === null) el.removeAttribute(u.name); else el.setAttribute(u.name, u.old); }
                else if (u.kind === 'text') el.textContent = u.old;
            } catch (e) { }
        }
        st.undo = [];
        st.nodes = [null];
        if (st.ids) st.ids = new WeakMap();
    }

    var CLASS_RE = /^[\w-]{1,60}$/;

    function classList(v) {
        var out = [];
        var parts = String(v || '').split(/\s+/);
        for (var i = 0; i < parts.length; i++) if (CLASS_RE.test(parts[i])) out.push(parts[i]);
        return out;
    }

    function applyUpdate(st, el, ch) {
        var own = isOwn(st, el);
        var leaf = !el.children.length && !/^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(el.tagName);
        if (ch.html != null) {
            if (!own) throw new Error('Разметку можно менять только у своих элементов');
            var frag = cleanHtml(ch.html, st.id);
            if (!frag) throw new Error('Разметка отклонена');
            while (el.firstChild) el.removeChild(el.firstChild);
            el.appendChild(frag);
        } else if (ch.text != null) {
            if (!own && !leaf) throw new Error('Текст можно менять только у элементов без вложенных');
            logUndo(st, el, 'text', null, el.textContent);
            el.textContent = String(ch.text).slice(0, 2000);
        }
        var add = classList(ch.addClass), rem = classList(ch.removeClass);
        for (var a = 0; a < add.length; a++) {
            if (!el.classList.contains(add[a])) { logUndo(st, el, 'class-add', add[a]); el.classList.add(add[a]); }
        }
        for (var r = 0; r < rem.length; r++) {
            if (el.classList.contains(rem[r])) { logUndo(st, el, 'class-remove', rem[r]); el.classList.remove(rem[r]); }
        }
        if (ch.style && typeof ch.style === 'object') {
            for (var prop in ch.style) {
                if (!ch.style.hasOwnProperty(prop) || !/^-?[a-z][a-z-]{0,40}$/.test(prop)) continue;
                var val = ch.style[prop] == null ? '' : String(ch.style[prop]);
                var important = /\s*!important\s*$/.test(val) ? 'important' : '';
                val = val.replace(/\s*!important\s*$/, '');
                if (val.length > 300 || CSS_FORBIDDEN.test(val) || /[;{}]/.test(val)) continue;
                logUndo(st, el, 'style', prop, { v: el.style.getPropertyValue(prop), p: el.style.getPropertyPriority(prop) });
                el.style.setProperty(prop, val, important);
            }
        }
        if (ch.attrs && typeof ch.attrs === 'object') {
            for (var name in ch.attrs) {
                if (!ch.attrs.hasOwnProperty(name)) continue;
                var n = String(name).toLowerCase();
                var v = ch.attrs[name];
                var ok = SAFE_ATTR.test(n) || (own && n === 'src' && el.tagName === 'IMG') ||
                    (own && n === 'id' && (v === null || /^ext-[\w-]{1,60}$/.test(v)));
                if (!ok) continue;
                if (n === 'src' && v !== null && !/^https:\/\//i.test(v) && !/^data:image\//i.test(v)) continue;
                logUndo(st, el, 'attr', n, el.getAttribute(n));
                if (v === null || v === false) el.removeAttribute(n); else el.setAttribute(n, String(v).slice(0, 500));
            }
        }
        if (typeof window.invalidateFocusCache === 'function') window.invalidateFocusCache();
    }

    function homeState() {
        return window.HomeScreen && HomeScreen.state && HomeScreen.state.built ? HomeScreen.state : null;
    }

    /** Элемент каталога за карточкой главной: data-item-index в данных её ряда */
    function cardItem(card) {
        var hs = homeState();
        if (!hs || !card) return null;
        for (var i = 0; i < hs.rows.length; i++) {
            var j = hs.rows[i] ? hs.rows[i].indexOf(card) : -1;
            if (j === -1) continue;
            var items = hs.data && hs.data[hs.rowKeys[i]];
            var idx = parseInt(card.getAttribute('data-item-index'), 10);
            var item = items ? items[isNaN(idx) ? j : idx] : null;
            return item && !item.catKey ? detailMeta(item) : null;
        }
        return null;
    }

    // Откуда расширение может увести на ряд главной или в категорию: только из
    // разделов главной, каталога и «Моих торрентов», и только когда поверх ничего нет —
    // ни карточки фильма или раздачи, ни окна, ни клавиатуры. Из настроек, плеера и
    // поиска переходов нет: расширение не уводит человека оттуда само
    var OPEN_FROM = { home: 1, catalog: 1, torrents: 1 };
    // И только в ответ на человека: в пределах OPEN_AFTER_KEY_MS после кнопки пульта,
    // пришедшей плагину (key или nav), — иначе плагин мог бы по таймеру раз за разом
    // уводить на свой ряд. Разово — в первые OPEN_ON_START_MS после запуска плагина:
    // открыть главную на выбранном разделе
    var OPEN_AFTER_KEY_MS = 2000;
    var OPEN_ON_START_MS = 20000;

    function openAllowed(st) {
        if (!OPEN_FROM[currentScreen()] || modal || panelPlugin) return false;
        if (window.OSK && OSK.isOpen && OSK.isOpen()) return false;
        var dv = document.getElementById('detail-view');
        if (dv && typeof _isScreenVisible === 'function' && _isScreenVisible(dv)) return false;
        var now = Date.now();
        if (now - st.keyAt < OPEN_AFTER_KEY_MS) return true;
        if (st.startOpen && now - st.startedAt < OPEN_ON_START_MS) { st.startOpen = false; return true; }
        return false;
    }

    /** TS.app.openRow: ряд главной по номеру */
    function openHomeRow(st, index) {
        var i = parseInt(index, 10);
        if (isNaN(i) || i < 0 || !window.HomeScreen || typeof HomeScreen.openRow !== 'function') throw new Error('Ряд недоступен');
        if (!openAllowed(st)) throw new Error('Сейчас переход недоступен');
        if (!HomeScreen.openRow(i)) throw new Error('Нет такого ряда');
        return true;
    }

    /** TS.app.openCategory: категория каталога по ключу плитки (movie, tv, anime…) */
    function openHomeCategory(st, key) {
        key = String(key || '');
        if (!/^[\w-]{1,40}$/.test(key) || !window.HomeScreen || typeof HomeScreen.openCategory !== 'function') {
            throw new Error('Категория недоступна');
        }
        if (!openAllowed(st)) throw new Error('Сейчас переход недоступен');
        if (!HomeScreen.openCategory(key)) throw new Error('Нет такой категории');
        return true;
    }

    /**
     * Рекомендации плагина: только ключи, которые «Внешний вид» разрешает рекомендовать,
     * и только допустимые значения — их проверяет и приводит к виду настроек он сам
     * (UICustomizer.recommendValue). Остальное отбрасывается
     */
    function cleanRecommend(settings) {
        if (!settings || typeof settings !== 'object' || !window.UICustomizer ||
            typeof UICustomizer.recommendKeys !== 'function') return null;
        var keys = UICustomizer.recommendKeys(), out = {}, any = false;
        for (var i = 0; i < keys.length; i++) {
            if (!Object.prototype.hasOwnProperty.call(settings, keys[i])) continue;
            var v = UICustomizer.recommendValue(keys[i], settings[keys[i]]);
            if (v === undefined) continue;
            out[keys[i]] = v;
            any = true;
        }
        return any ? out : null;
    }

    /**
     * Что из рекомендаций отличается от текущих настроек: { settings, text } — сами
     * значения (копия) и подпись для меню («Колонки каталога: 3, Широкие карточки: вкл»)
     */
    function recommendChanges(rec) {
        var cur = UICustomizer.get(), settings = {}, parts = [];
        for (var k in rec) {
            if (!Object.prototype.hasOwnProperty.call(rec, k) || String(cur[k]) === String(rec[k])) continue;
            settings[k] = rec[k];
            parts.push(typeof UICustomizer.recommendLabel === 'function' ? UICustomizer.recommendLabel(k, rec[k]) : k + ': ' + rec[k]);
        }
        return parts.length ? { settings: settings, text: parts.join(', ') } : null;
    }

    /** Рекомендации ещё не совпадают с текущими настройками — есть что применять */
    function recommendPending(st) {
        var rec = st && st.recommend;
        if (!rec || !window.UICustomizer || typeof UICustomizer.get !== 'function') return false;
        var cur = UICustomizer.get();
        for (var k in rec) {
            if (Object.prototype.hasOwnProperty.call(rec, k) && String(cur[k]) !== String(rec[k])) return true;
        }
        return false;
    }

    function homeData(st) {
        var hs = homeState();
        if (!hs) return { ready: false, rows: [] };
        var rows = [];
        for (var i = 0; i < hs.rowEls.length; i++) {
            var rowEl = hs.rowEls[i];
            var titleEl = rowEl && rowEl.querySelector('.catalog-row-title');
            var cards = hs.rows[i] || [];
            var list = [];
            for (var j = 0; j < cards.length; j++) {
                var c = cards[j];
                list.push({
                    h: handleOf(st, c),
                    title: c.getAttribute('data-title') ||
                        String((c.querySelector('.home-tile-label, .catalog-card-title, .torrent-title') || {}).textContent || '').trim(),
                    tile: c.classList.contains('home-cat-tile'),
                    item: cardItem(c)
                });
            }
            rows.push({
                index: i, key: String(hs.rowKeys[i] || ''),
                title: titleEl ? String(titleEl.textContent || '').replace(/\s+/g, ' ').trim() : '',
                h: rowEl ? handleOf(st, rowEl) : null,
                col: hs.rowCols[i] || 0,
                cards: list
            });
        }
        return { ready: true, activeRow: hs.activeRow, rows: rows };
    }

    function needNode(st, h) {
        var el = nodeOf(st, h);
        if (!el) throw new Error('Элемента больше нет на странице');
        if (isProtected(el)) throw new Error('Этот элемент расширениям закрыт');
        return el;
    }

    function domCall(st, op, a) {
        switch (op) {
            case 'query': {
                if (!validSelector(a.sel)) throw new Error('Неверный селектор');
                var root = a.opts && a.opts.root ? needNode(st, a.opts.root) : document;
                return describeAll(st, root.querySelectorAll(a.sel), a.opts);
            }
            case 'closest': {
                if (!validSelector(a.sel)) throw new Error('Неверный селектор');
                var c = needNode(st, a.h).closest(a.sel);
                return c && !isProtected(c) ? describe(st, c) : null;
            }
            case 'children':
                return describeAll(st, needNode(st, a.h).children, {});
            case 'focused': {
                var f = document.querySelector('.focused');
                return f && !isProtected(f) ? describe(st, f, { rect: true }) : null;
            }
            case 'create': {
                var parent = a.parent == null ? document.body :
                    typeof a.parent === 'number' ? needNode(st, a.parent) :
                    (validSelector(a.parent) ? document.querySelector(a.parent) : null);
                if (!parent || isProtected(parent) && parent !== document.body) throw new Error('Сюда вставлять нельзя');
                var where = a.where;
                if ((where === 'before' || where === 'after') && (!parent.parentNode || parent === document.body || isProtected(parent.parentNode))) {
                    throw new Error('Сюда вставлять нельзя');
                }
                var frag = cleanHtml(a.html, st.id);
                if (!frag) throw new Error('Разметка отклонена');
                var first = null;
                for (var n = frag.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) { first = n; break; }
                if (!first) throw new Error('В разметке нет элементов');
                if (where === 'prepend') parent.insertBefore(frag, parent.firstChild);
                else if (where === 'before') parent.parentNode.insertBefore(frag, parent);
                else if (where === 'after') parent.parentNode.insertBefore(frag, parent.nextSibling);
                else parent.appendChild(frag);
                if (typeof window.invalidateFocusCache === 'function') window.invalidateFocusCache();
                return describe(st, first);
            }
            case 'update':
                applyUpdate(st, needNode(st, a.h), a.ch || {});
                return true;
            case 'remove': {
                var el = needNode(st, a.h);
                if (!isOwn(st, el)) throw new Error('Удалять можно только свои элементы');
                el.parentNode.removeChild(el);
                if (typeof window.invalidateFocusCache === 'function') window.invalidateFocusCache();
                return true;
            }
            case 'click': {
                var t = needNode(st, a.h);
                if (!isOwn(st, t) && !(t.matches && t.matches(CLICK_ALLOWED))) throw new Error('По этому элементу расширению нажимать нельзя');
                t.click();
                return true;
            }
            case 'focus': {
                var target = needNode(st, a.h);
                // Карточки рядов главной, кроме показанного, спрятаны (home-row-hidden):
                // фокус на такую карточку — переход в её ряд, его делает стратегия главной
                var homeCard = currentScreen() === 'home' && target.isConnected &&
                    target.classList.contains('catalog-row-card') && !!target.closest('#home-rows');
                if (target.offsetParent === null && !homeCard) throw new Error('Элемент не виден');
                // Через стратегию экрана, как пульт: на главной ряд запомнит
                // колонку и сменит баннер
                var s = typeof ScreenStrategies !== 'undefined' && ScreenStrategies[currentScreen()];
                if (s && typeof s.focusItem === 'function') s.focusItem(target);
                else if (typeof window.focusEl === 'function') window.focusEl(target);
                return true;
            }
            case 'home':
                return homeData(st);
            case 'openRow':
                return openHomeRow(st, a.index);
            case 'openCategory':
                return openHomeCategory(st, a.key);
            case 'screen':
                return currentScreen();
            case 'item': {
                var card = needNode(st, a.h);
                return cardItem(card) || (card.closest('#detail-view') ? detailMeta(AppState.currentDetailItem) : null);
            }
            case 'detail':
                return currentScreen() === 'detail' && window.AppState ? detailMeta(AppState.currentDetailItem) : null;
            case 'detailButtons':
                return detailButtonsInfo(st);
            case 'play':
                return playForPlugin(st, a.opts || {});
        }
        throw new Error('Неизвестная операция ' + op);
    }

    /** Делегированные клики: TS.dom.on(selector, 'click', fn) */
    function onDocumentClick(e) {
        var t = e.target;
        if (!t || !t.closest || isProtected(t)) return;
        for (var id in running) {
            if (!running.hasOwnProperty(id)) continue;
            var st = running[id];
            for (var i = 0; i < st.listeners.length; i++) {
                var l = st.listeners[i];
                var m = null;
                try { m = t.closest(l.sel); } catch (err) { }
                if (m && !isProtected(m)) post(st, { type: 'dom-event', lid: l.lid, node: describe(st, m) });
            }
        }
    }

    /*
     * Событие nav — после каждой стрелки и ОК на обычных экранах: куда встал
     * фокус и сдвинулся ли он. moved: false на стрелке — край (так открывают
     * своё боковое меню «влево с первой карточки»).
     */
    var navTimer = null;

    function emitNav(dir, before, screen) {
        var any = false;
        for (var id in running) if (running.hasOwnProperty(id) && running[id].wantsNav) { any = true; break; }
        if (!any) return;
        if (navTimer) clearTimeout(navTimer);
        navTimer = setTimeout(function () {
            navTimer = null;
            var after = document.querySelector('.focused');
            for (var pid in running) {
                if (!running.hasOwnProperty(pid) || !running[pid].wantsNav) continue;
                var st = running[pid];
                emitTo(st, 'nav', {
                    key: dir, screen: screen, moved: after !== before,
                    focused: after && !isProtected(after) ? describe(st, after, { rect: true }) : null
                });
            }
        }, 60);
    }

    /** Ряды главной пересобрались — подписанным плагинам событие home */
    var homeSig = '';

    function pollHome() {
        var any = false;
        for (var id in running) if (running.hasOwnProperty(id) && running[id].wantsHome) { any = true; break; }
        if (!any) return;
        var hs = homeState();
        var sig = '';
        if (hs) {
            var n = 0;
            for (var i = 0; i < hs.rows.length; i++) n += hs.rows[i] ? hs.rows[i].length : 0;
            sig = hs.rowEls.length + ':' + n + ':' + (hs.rowEls[0] ? handleOfGlobal(hs.rowEls[0]) : '');
        }
        if (sig === homeSig) return;
        homeSig = sig;
        if (sig) emitAll('home', {});
    }

    // Метка самого DOM-элемента ряда: пересобрали ряды — элементы новые
    var globalMarks = window.WeakMap ? new WeakMap() : null, globalSeq = 0;
    function handleOfGlobal(el) {
        if (!globalMarks) return '';
        if (!globalMarks.has(el)) globalMarks.set(el, ++globalSeq);
        return globalMarks.get(el);
    }

    // ==================== СЕТЬ ====================

    function hostOf(url) {
        var u = url ? parseUrl(url) : null;
        return u && u.hostname ? String(u.hostname).toLowerCase() : '';
    }

    function isPrivateHost(h) {
        h = String(h || '').toLowerCase().replace(/^\[|\]$/g, '');
        if (!h) return true;
        if (h === 'localhost' || /\.(local|localhost|lan|home|internal|intranet)$/.test(h)) return true;
        if (h.indexOf(':') !== -1) {
            // IPv6: петля, локальные и уникальные локальные адреса, IPv4 внутри
            if (h === '::' || h === '::1' || /^(fc|fd|fe8|fe9|fea|feb)/.test(h)) return true;
            var m6 = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
            return m6 ? isPrivateHost(m6[1]) : false;
        }
        var m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
        if (!m) return !/\./.test(h);   // имя без точки — локальная сеть
        var a = +m[1], b = +m[2];
        return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
            (a === 100 && b >= 64 && b <= 127) || a >= 224;
    }

    function deniedHosts() {
        var list = [String(location.hostname || '').toLowerCase()];
        try { if (typeof SERVER_URL !== 'undefined') list.push(hostOf(SERVER_URL)); } catch (e) { }
        var A = window.AppState || {};
        list.push(hostOf(A.currentTorrserverUrl));
        var ts = document.getElementById('torrserver-url');
        if (ts && ts.value) list.push(hostOf(/^https?:/i.test(ts.value) ? ts.value : 'http://' + ts.value));
        return list;
    }

    function fetchAllowed(url) {
        var u = validPluginUrl(url);
        if (!u) return 'Разрешены только адреса http(s)';
        var h = String(u.hostname).toLowerCase();
        if (isPrivateHost(h)) return 'Адреса домашней сети расширениям закрыты';
        var denied = deniedHosts();
        for (var i = 0; i < denied.length; i++) {
            if (denied[i] && denied[i] === h) return 'Сервер TorrStream и TorrServer расширениям закрыты';
        }
        return '';
    }

    var HEADER_FORBIDDEN = /^(cookie|cookie2|host|origin|referer|x-ts-.*|proxy-.*|sec-.*)$/i;

    function doFetch(st, m) {
        function reply(r) { r.type = 'fetch'; r.reqId = m.reqId; post(st, r); }
        var why = fetchAllowed(m.url);
        if (why) { reply({ error: why }); return; }
        if (st.fetching >= FETCH_PARALLEL) { reply({ error: 'Слишком много запросов одновременно' }); return; }
        var method = /^(GET|HEAD|POST|PUT|PATCH|DELETE)$/.test(m.method) ? m.method : 'GET';
        var headers = {};
        if (m.headers && typeof m.headers === 'object') {
            for (var k in m.headers) {
                if (m.headers.hasOwnProperty(k) && !HEADER_FORBIDDEN.test(k)) headers[k] = String(m.headers[k]).slice(0, 2000);
            }
        }
        st.fetching++;
        var done = false;
        var timer = setTimeout(function () {
            if (done) return; done = true; st.fetching--;
            reply({ error: 'Нет ответа за ' + (FETCH_TIMEOUT_MS / 1000) + ' с' });
        }, FETCH_TIMEOUT_MS);
        var opts = {
            method: method, headers: headers, credentials: 'omit', referrerPolicy: 'no-referrer',
            cache: 'no-store',
            // Перенаправление могло бы увести запрос в домашнюю сеть. GET
            // проверяем по конечному адресу, запросы с последствиями не
            // перенаправляем вовсе
            redirect: method === 'GET' || method === 'HEAD' ? 'follow' : 'error'
        };
        if (m.body != null && method !== 'GET' && method !== 'HEAD') opts.body = String(m.body).slice(0, FETCH_LIMIT);
        fetch(m.url, opts).then(function (res) {
            if (res.url && fetchAllowed(res.url)) throw new Error('Перенаправление на закрытый адрес');
            return res.text().then(function (text) {
                if (text.length > FETCH_LIMIT) text = text.slice(0, FETCH_LIMIT);
                return { ok: res.ok, status: res.status, url: res.url, text: text };
            });
        }).then(function (r) {
            if (done) return; done = true; clearTimeout(timer); st.fetching--;
            reply(r);
        }, function (err) {
            if (done) return; done = true; clearTimeout(timer); st.fetching--;
            reply({ error: String(err && err.message || err || 'Ошибка сети') });
        });
    }

    // ==================== СООБЩЕНИЯ ОТ ПЛАГИНОВ ====================

    function onMessage(e) {
        var m = e.data;
        if (!m || m.__tsx !== 1 || typeof m.type !== 'string') return;
        var st = stateBySource(e.source);
        if (!st) return;
        var p = st.plugin;
        switch (m.type) {
            case 'hello':
                st.dataPromise.then(function (data) {
                    st.data = data || {};
                    st.ready = true;
                    post(st, {
                        type: 'init', src: st.url.href, storage: st.data,
                        info: { id: p.id, appVersion: 2, platform: platformName(), features: FEATURES.slice() },
                        focusColor: focusColor()
                    });
                    // Карточка уже открыта — пусть плагин узнает о ней сразу
                    if (lastDetailMeta && currentScreen() === 'detail') emitTo(st, 'detail', lastDetailMeta);
                    emitTo(st, 'screen', currentScreen());
                });
                break;
            case 'need-code':
                loadCode(st);
                break;
            case 'call':
                var result, error = '';
                try { result = domCall(st, String(m.op), m.args || {}); }
                catch (err) { error = String(err && err.message || err); }
                // Долгие операции (play) отвечают промисом — ждём его
                if (result && typeof result.then === 'function') {
                    var reqId = m.reqId;
                    result.then(function (v) { post(st, { type: 'call', reqId: reqId, result: v === undefined ? true : v, error: '' }); },
                        function (err) { post(st, { type: 'call', reqId: reqId, error: String(err && err.message || err || 'Ошибка') }); });
                    break;
                }
                post(st, { type: 'call', reqId: m.reqId, result: result, error: error });
                break;
            case 'listen':
                if (m.ev !== 'click' || !validSelector(m.sel) || st.listeners.length >= 50) return;
                st.listeners.push({ lid: m.lid, sel: m.sel });
                break;
            case 'subscribe':
                if (m.name === 'nav') st.wantsNav = true;
                if (m.name === 'home') { st.wantsHome = true; homeSig = ''; }
                break;
            case 'capture':
                if (m.on) {
                    // Не посреди просмотра и не поверх окон расширений
                    if (currentScreen() === 'player' || modal || panelPlugin) return;
                    // Список кнопок проверяем до того, как отдать пульт: пустой или
                    // целиком из неизвестных кнопок — ничего не захватываем (и не
                    // отбираем захват у другого плагина)
                    var keys = null;
                    if (m.keys != null) {
                        if (!Array.isArray(m.keys)) return;
                        keys = [];
                        // Длину не доверяем: смотрим не больше CAPTURE_SCAN элементов
                        for (var ck = 0; ck < m.keys.length && ck < CAPTURE_SCAN && keys.length < CAPTURE_DIRS.length; ck++) {
                            var kd = String(m.keys[ck]);
                            if (CAPTURE_DIRS.indexOf(kd) !== -1 && keys.indexOf(kd) === -1) keys.push(kd);
                        }
                        if (!keys.length) return;
                    }
                    captureOwner = st.id;
                    captureKeys = keys;
                } else if (captureOwner === st.id) {
                    releaseCapture();
                }
                break;
            case 'recommend':
                // Только на время работы плагина: он присылает их при каждом запуске,
                // и устаревшие рекомендации прежней версии не переживут обновление
                st.recommend = cleanRecommend(m.settings);
                break;
            case 'register':
                if (m.name) p.name = m.name;
                p.version = m.version || '';
                p.description = m.description || '';
                p.settings = !!m.settings;
                saveList();
                renderSettings();
                break;
            case 'error':
                p.error = String(m.message || '').slice(0, 300);
                log('ошибка в «' + (p.name || p.url) + '»:', p.error);
                renderSettings();
                break;
            case 'toast':
                if (typeof window.showToast === 'function') window.showToast((p.name ? p.name + ': ' : '') + m.text);
                break;
            case 'storage':
                if (!st.data) st.data = {};
                if (m.op === 'clear') st.data = {};
                else if (m.op === 'remove') delete st.data[m.key];
                else if (m.op === 'set') {
                    var prev = st.data[m.key];
                    st.data[m.key] = m.value;
                    if (JSON.stringify(st.data).length > STORAGE_LIMIT) {
                        if (prev === undefined) delete st.data[m.key]; else st.data[m.key] = prev;
                        p.error = 'Хранилище переполнено (больше ' + Math.round(STORAGE_LIMIT / 1000) + ' КБ)';
                        renderSettings();
                        return;
                    }
                }
                scheduleSave(st);
                break;
            case 'style':
                var css = cleanCss(m.css);
                if (css === null) { p.error = 'Стиль отклонён: url(), @import и «\\» запрещены'; renderSettings(); return; }
                addCss(st, css);
                break;
            case 'hide':
                if (!validSelector(m.selector)) return;
                addCss(st, m.selector + '{display:none!important}');
                break;
            case 'text':
                if (!validSelector(m.selector)) return;
                var els = document.querySelectorAll(m.selector);
                for (var i = 0; i < els.length && i < 50; i++) {
                    // Только «листья» вне настроек: подпись кнопки, заголовок
                    if (isProtected(els[i]) || els[i].children.length) continue;
                    if (/^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(els[i].tagName)) continue;
                    els[i].textContent = String(m.text).slice(0, 200);
                }
                break;
            case 'button':
                setButton(st, m, false);
                break;
            case 'button-update':
                setButton(st, m, true);
                break;
            case 'button-remove':
                for (var b = 0; b < st.buttons.length; b++) {
                    if (st.buttons[b].id === m.id) { st.buttons.splice(b, 1); break; }
                }
                renderDetailExtras();
                break;
            case 'online':
                if (m.on) {
                    var types = null;
                    if (Array.isArray(m.types)) {
                        types = [];
                        for (var ot = 0; ot < m.types.length && ot < 4; ot++) {
                            if ((m.types[ot] === 'movie' || m.types[ot] === 'tv') && types.indexOf(m.types[ot]) === -1) types.push(m.types[ot]);
                        }
                        if (!types.length) types = null;
                    }
                    st.online = { name: String(m.name || p.name || nameFromUrl(p.url)).slice(0, 40), types: types };
                } else {
                    st.online = null;
                }
                renderDetailExtras();
                break;
            case 'native-key':
                onPanelNativeKey(st, +m.keyCode || 0);
                break;
            case 'block':
                st.block = String(m.html || '').slice(0, HTML_LIMIT);
                renderDetailExtras();
                break;
            case 'panel':
                if (m.open) openPanel(st, m.title); else if (panelPlugin === st.id) closePanel();
                break;
            case 'fetch':
                doFetch(st, m);
                break;
        }
    }

    /**
     * Запасная загрузка кода расширения (см. need-code в песочнице): без
     * cookie и не с адресов сервера TorrStream и TorrServer — ссылкой
     * «расширения» иначе можно было бы дёрнуть их GET-маршрут.
     */
    function loadCode(st) {
        if (st.codeRequested) return;
        st.codeRequested = true;
        var src = st.url.href;
        function reply(r) { r.type = 'code'; r.src = src; post(st, r); }
        var h = String(st.url.hostname).toLowerCase();
        var denied = deniedHosts();
        // Отладка (?local=1): примеры из public/extensions/ раздаёт сам сервер
        var devLocal = location.search.indexOf('local=1') !== -1 && st.url.host === location.host &&
            /^\/extensions\/[\w.-]+\.js$/.test(st.url.pathname);
        for (var i = 0; i < denied.length && !devLocal; i++) {
            if (denied[i] && denied[i] === h) { reply({ error: 'С этого адреса расширения не загружаются' }); return; }
        }
        fetch(src, { credentials: 'omit', cache: 'no-cache', referrerPolicy: 'no-referrer' })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.text();
            })
            .then(function (text) {
                if (text.length > FETCH_LIMIT) throw new Error('Слишком большой файл');
                reply({ text: text });
            }, function (err) {
                reply({ error: 'Не удалось загрузить ' + src + ' (' + (err && err.message || err) + ')' });
            });
    }

    function addCss(st, css) {
        st.cssParts.push(css);
        if (!st.styleEl) {
            st.styleEl = document.createElement('style');
            st.styleEl.setAttribute('data-ext', st.id);
            if (suspended) st.styleEl.media = 'not all';
            document.head.appendChild(st.styleEl);
        }
        st.styleEl.textContent = st.cssParts.join('\n');
    }

    // ==================== КАРТОЧКА ====================

    var ICON_RE = /^[a-z0-9-]{1,40}$/;
    var BUTTON_STYLES = { round: 1, wide: 1, primary: 1 };

    /*
     * Кнопки строки действий, к которым расширение может пристроить свою:
     * ключ → id кнопки приложения. Ключи, а не id, — чтобы вёрстку приложения
     * можно было менять, не ломая плагины. «online» — общая кнопка источников
     * онлайн-просмотра (её рисует приложение, см. ниже).
     */
    var DETAIL_ANCHORS = {
        resume: 'catalog-resume-btn', torrents: 'catalog-watch-btn', best: 'catalog-best-btn',
        play: 'detail-progress-btn', overview: 'catalog-toggle-overview-btn', 'open-card': 'detail-open-card-btn',
        favorite: 'catalog-favorite-btn', trailer: 'catalog-trailer-btn', online: 'ext-online-btn'
    };
    var ONLINE_BTN_ID = 'ext-online-btn';
    var ANCHOR_RE = /^(start|end|ext:[\w-]{1,30}|[a-z-]{1,20})$/;

    /** Место кнопки: { before | after: ключ } или { position: 'start' | 'end' } */
    function cleanPlacement(m, into) {
        var before = m.before != null && ANCHOR_RE.test(m.before) ? m.before : null;
        var after = m.after != null && ANCHOR_RE.test(m.after) ? m.after : null;
        var pos = m.position === 'start' || m.position === 'end' ? m.position : null;
        if (before || after || pos) { into.before = before; into.after = before ? null : after; into.position = pos; }
    }

    /** addButton (update — false: создаёт или заменяет целиком) и updateButton (только переданное) */
    function setButton(st, m, update) {
        var id = String(m.id || 'main').slice(0, 30);
        var def = null;
        for (var i = 0; i < st.buttons.length; i++) if (st.buttons[i].id === id) { def = st.buttons[i]; break; }
        if (!def) {
            if (update || st.buttons.length >= MAX_BUTTONS) return;
            def = { id: id };
            st.buttons.push(def);
        } else if (!update) {
            // Повторный addButton — кнопка такая, как описана сейчас
            for (var k in def) if (def.hasOwnProperty(k) && k !== 'id') delete def[k];
        }
        if (!update || m.label != null) def.label = String(m.label || st.plugin.name || 'Расширение').slice(0, 30);
        if (!update || m.icon != null) def.icon = ICON_RE.test(m.icon) ? m.icon : 'puzzle';
        if (!update || m.style != null) def.style = BUTTON_STYLES[m.style] ? m.style : 'round';
        if (!update || m.hidden != null) def.hidden = !!m.hidden;
        cleanPlacement(m, def);
        renderDetailExtras();
    }

    function makeDetailButton(extId, buttonId, label, icon, style) {
        var btn = document.createElement('button');
        btn.className = 'catalog-toggle-overview-btn ext-detail-btn' + (style && style !== 'round' ? ' ext-detail-' + style : '');
        btn.setAttribute('data-label', label);
        btn.setAttribute('data-ext', extId);
        btn.setAttribute('data-ext-button', buttonId);
        btn.innerHTML = '<i class="fi fi-rr-' + icon + ' ext-detail-icon"></i>';
        btn.appendChild(document.createTextNode(' ' + label));
        return btn;
    }

    /**
     * Вставить кнопку по её месту. Несколько кнопок у одного якоря встают в
     * порядке появления: «после X» — за X и за теми, кого уже поставили после X;
     * «перед X» — вплотную перед X. Якоря нет на странице (кнопка приложения
     * спрятана — она остаётся в разметке, — или своей кнопки ещё нет) — в конец.
     */
    function placeDetailButton(row, btn, def, ownOf) {
        var key = def.before || def.after;
        var anchor = null;
        if (key) {
            if (key.indexOf('ext:') === 0) anchor = ownOf(key.slice(4));
            else if (DETAIL_ANCHORS.hasOwnProperty(key)) anchor = document.getElementById(DETAIL_ANCHORS[key]);
            if (anchor && anchor.parentNode !== row) anchor = null;
        }
        if (anchor && def.before) { row.insertBefore(btn, anchor); return; }
        if (anchor) {
            var ref = anchor;
            for (;;) {
                var next = ref.nextElementSibling;
                // Меню «Лучших» — продолжение своей кнопки, его не разрываем
                if (next && (next.id === 'catalog-best-menu' || next._extAfter === anchor)) { ref = next; continue; }
                break;
            }
            btn._extAfter = anchor;
            row.insertBefore(btn, ref.nextSibling);
            return;
        }
        if (def.position === 'start') {
            var first = row.firstElementChild;
            while (first && first._extStart) first = first.nextElementSibling;
            btn._extStart = true;
            row.insertBefore(btn, first);
            return;
        }
        row.appendChild(btn);
    }

    /** Источники онлайн-просмотра, подходящие открытой карточке */
    function onlineProviders(meta) {
        var out = [];
        if (!meta || !meta.tmdbId || meta.torrent) return out;
        for (var id in running) {
            if (!running.hasOwnProperty(id) || !running[id].online) continue;
            var o = running[id].online;
            if (o.types && o.types.indexOf(meta.type) === -1) continue;
            out.push(running[id]);
        }
        return out;
    }

    /** Кнопки расширений в строке действий и блоки под ней — перестраиваются целиком */
    function renderDetailExtras() {
        var row = document.getElementById('catalog-detail-actions');
        if (!row) return;
        // Кнопку в фокусе пересоздаём — фокус переносим на её замену
        var f = document.querySelector('.focused');
        var refocus = f && f.classList.contains('ext-detail-btn') && row.contains(f) ?
            f.getAttribute('data-ext') + '|' + f.getAttribute('data-ext-button') : '';
        var old = row.querySelectorAll('.ext-detail-btn');
        for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
        var oldBlocks = document.querySelectorAll('.ext-detail-block');
        for (var j = 0; j < oldBlocks.length; j++) oldBlocks[j].parentNode.removeChild(oldBlocks[j]);

        // «Онлайн» — первой: к ней могут пристраиваться кнопки расширений
        var meta = window.AppState ? detailMeta(AppState.currentDetailItem) : null;
        if (onlineProviders(meta).length) {
            var ob = makeDetailButton('app', 'online', 'Онлайн', 'play-alt', 'round');
            ob.id = ONLINE_BTN_ID;
            ob.addEventListener('click', onOnlineButton);
            placeDetailButton(row, ob, { after: 'torrents' }, function () { return null; });
        }

        var anchor = row.nextSibling;
        for (var id in running) {
            if (!running.hasOwnProperty(id)) continue;
            var st = running[id];
            var made = {};
            var ownOf = function (bid) { return made[bid] || null; };
            // Кнопки с якорем на свою ещё не поставленную — вторым проходом
            var later = [];
            for (var b = 0; b < st.buttons.length; b++) {
                var def = st.buttons[b];
                if (def.hidden) continue;
                var key = def.before || def.after || '';
                if (key.indexOf('ext:') === 0 && !made[key.slice(4)]) { later.push(def); continue; }
                made[def.id] = makeDetailButton(id, def.id, def.label, def.icon, def.style);
                placeDetailButton(row, made[def.id], def, ownOf);
            }
            for (var lb = 0; lb < later.length; lb++) {
                made[later[lb].id] = makeDetailButton(id, later[lb].id, later[lb].label, later[lb].icon, later[lb].style);
                placeDetailButton(row, made[later[lb].id], later[lb], ownOf);
            }
            for (var mb in made) if (made.hasOwnProperty(mb)) made[mb].addEventListener('click', onDetailButton);
            if (st.block) {
                var frag = cleanHtml(st.block);
                if (frag && frag.childNodes.length) {
                    var box = document.createElement('div');
                    box.className = 'ext-detail-block';
                    box.setAttribute('data-ext', id);
                    box.appendChild(frag);
                    row.parentNode.insertBefore(box, anchor);
                }
            }
        }
        if (typeof window.invalidateFocusCache === 'function') window.invalidateFocusCache();
        if (refocus) {
            var parts = refocus.split('|');
            var again = row.querySelector('.ext-detail-btn[data-ext="' + parts[0] + '"][data-ext-button="' + parts[1] + '"]');
            var target = again || row.querySelector('button.catalog-watch-btn');
            if (target && typeof window.focusEl === 'function') window.focusEl(target);
        }
    }

    /** TS.ui.detailButtons: что сейчас в строке, по порядку — чтобы выбрать якорь */
    function detailButtonsInfo(st) {
        var row = document.getElementById('catalog-detail-actions');
        var out = [];
        if (!row) return out;
        var byId = {};
        for (var k in DETAIL_ANCHORS) if (DETAIL_ANCHORS.hasOwnProperty(k)) byId[DETAIL_ANCHORS[k]] = k;
        var all = row.querySelectorAll('button');
        for (var i = 0; i < all.length; i++) {
            var b = all[i], key = null, own = false;
            if (byId[b.id]) key = byId[b.id];
            else if (b.getAttribute('data-ext') === st.id) { key = 'ext:' + b.getAttribute('data-ext-button'); own = true; }
            if (!key) continue;   // чужие кнопки расширений якорем не бывают
            out.push({
                key: key, own: own,
                label: String(b.getAttribute('data-label') || b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
                visible: b.offsetParent !== null && !b.classList.contains('hidden')
            });
        }
        return out;
    }

    function onDetailButton(e) {
        if (e && e.preventDefault) e.preventDefault();
        var btn = e.currentTarget;
        var st = running[btn.getAttribute('data-ext')];
        if (!st) return;
        panelReturnFocus = btn;
        st.actedAt = Date.now();
        // Сведения карточки могли дополниться после открытия — берём свежие
        var item = window.AppState ? detailMeta(AppState.currentDetailItem) : null;
        if (item) lastDetailMeta = item;
        emitTo(st, 'button', { id: btn.getAttribute('data-ext-button'), item: lastDetailMeta });
    }

    // ---------- «Онлайн»: общая кнопка источников ----------

    var ONLINE_LAST_KEY = 'extensions-online-last';

    function startOnline(st, btn) {
        var item = window.AppState ? detailMeta(AppState.currentDetailItem) : null;
        if (!item) return;
        lastDetailMeta = item;
        panelReturnFocus = btn || null;
        st.actedAt = Date.now();
        try { localStorage.setItem(ONLINE_LAST_KEY, st.id); } catch (e) { }
        emitTo(st, 'online', { item: item });
    }

    function onOnlineButton(e) {
        if (e && e.preventDefault) e.preventDefault();
        var btn = e.currentTarget;
        var list = onlineProviders(window.AppState ? detailMeta(AppState.currentDetailItem) : null);
        if (!list.length) return;
        if (list.length === 1) { startOnline(list[0], btn); return; }
        // Несколько источников — спросить; прошлый выбор первым и в фокусе
        var last = '';
        try { last = localStorage.getItem(ONLINE_LAST_KEY) || ''; } catch (err) { }
        list.sort(function (a, b) { return (b.id === last) - (a.id === last); });
        var html = '<h3>Смотреть онлайн</h3><div class="ext-modal-actions ext-modal-list">';
        for (var i = 0; i < list.length; i++) {
            html += '<button class="ext-modal-btn' + (i === 0 ? ' primary' : '') + '" data-online="' + esc(list[i].id) + '">' +
                esc(list[i].online.name) + '</button>';
        }
        html += '<button class="ext-modal-btn" data-act="cancel">Отмена</button></div>';
        var el = openModal(html, btn);
        el.addEventListener('click', function (ev) {
            var b = ev.target.closest ? ev.target.closest('button') : null;
            if (!b) return;
            if (b.getAttribute('data-act') === 'cancel') { closeModal(); return; }
            var st = running[b.getAttribute('data-online')];
            closeModal(true);
            if (st) startOnline(st, btn);
        });
    }

    /**
     * Что о карточке знает плагин: открытые сведения TMDB, без раздачи, хеша и
     * адресов. Раздачу (hash) не даём: с ней в TorrServer можно что угодно.
     */
    function detailMeta(item) {
        if (!item || item.isYoutube) return null;
        // Название и год — теми же функциями, что карточка (catalog.js): у
        // подборок NUMParser названия нет в title/name, оно в torrent[0].name,
        // а дата — «15.07.2026»
        var title = typeof getCatalogItemTitle === 'function' ? getCatalogItemTitle(item) : (item.title || item.name || '');
        if (title === 'Без названия') title = '';
        var year = typeof getCatalogItemYear === 'function' ? getCatalogItemYear(item) : null;
        if (!year) {
            var date = String(item.release_date || item.first_air_date || item.year || '');
            var ym = /(19|20)\d{2}/.exec(date);
            year = ym ? ym[0] : null;
        }
        var poster = item.poster_path || item.poster || null;
        if (poster && !/^https?:/i.test(poster)) poster = 'https://image.tmdb.org/t/p/w342' + poster;
        // В песочнице картинки только по https
        if (poster) poster = String(poster).replace(/^http:\/\/image\.tmdb\.org\//i, 'https://image.tmdb.org/');
        if (poster && !/^https:/i.test(poster)) poster = null;
        var tmdbId = item.tmdbId || item.tmdb_id || (item.hash ? null : item.id) || null;
        var type = item.media_type === 'tv' || (!item.media_type && (item.first_air_date || item.name)) ? 'tv' : 'movie';
        // Полные сведения TMDB открытой карточки (renderCinemaHead в catalog.js
        // кладёт их в AppState.currentDetailSource) — только если они о ней же
        var src = window.AppState && AppState.currentDetailSource;
        if (!src || !tmdbId || String(src.id) !== String(tmdbId)) src = {};
        var imdb = String(src.imdb_id || (src.external_ids && src.external_ids.imdb_id) || item.imdb_id || '');
        var kp = item.kinopoisk_id || item.kp_id || item.kinopoiskId || src.kinopoisk_id || null;
        var seasons = null;
        if (type === 'tv' && src.seasons && src.seasons.length) {
            seasons = [];
            for (var i = 0; i < src.seasons.length && seasons.length < 100; i++) {
                var s = src.seasons[i];
                // Нулевой сезон TMDB — «Спецматериалы», в онлайне его обычно нет
                if (s && s.season_number > 0) seasons.push({ season: +s.season_number, episodes: +s.episode_count || 0, name: String(s.name || '').slice(0, 100) });
            }
        }
        return {
            tmdbId: tmdbId ? String(tmdbId) : null,
            type: type,
            title: String(title || '').slice(0, 300),
            originalTitle: String(item.original_title || item.original_name || src.original_title || src.original_name || '').slice(0, 300),
            originalLanguage: String(item.original_language || src.original_language || '').slice(0, 10) || null,
            year: year ? +year : null,
            poster: poster,
            backdrop: tmdbImage(item.backdrop_path || src.backdrop_path, 'w1280'),
            vote: typeof item.vote_average === 'number' ? item.vote_average : null,
            imdbId: /^tt\d{3,12}$/.test(imdb) ? imdb : null,
            kinopoiskId: kp && /^\d{1,10}$/.test(String(kp)) ? String(kp) : null,
            seasons: seasons,
            torrent: !!item.hash
        };
    }

    function tmdbImage(path, size) {
        if (!path || typeof path !== 'string') return null;
        if (/^https:\/\//i.test(path)) return path;
        return path.charAt(0) === '/' ? 'https://image.tmdb.org/t/p/' + size + path : null;
    }

    // ==================== ВОСПРОИЗВЕДЕНИЕ (TS.player.play) ====================
    /*
     * Видео источника онлайн-просмотра. Только в ответ на человека: пока открыто
     * окно плагина или в пределах PLAY_GESTURE_MS после его кнопки, «Онлайн» или
     * клавиши, пришедшей плагину, — иначе плагин мог бы включать видео сам по
     * таймеру. Адреса — по правилам TS.fetch: не сервер TorrStream, не TorrServer
     * и не домашняя сеть (GET туда — тоже запрос с последствиями).
     */
    var PLAY_GESTURE_MS = 15000;
    var PLAYLIST_LIMIT = 500;
    var extPlayback = null;   // { st, items, index, web, seen, timer, handlers }

    function mediaUrl(u) {
        u = String(u || '');
        if (!validPluginUrl(u) || fetchAllowed(u)) return '';
        return u.slice(0, 4000);
    }

    /** Ярлык качества → число строк для сравнения: «1080p», «4K», «720» */
    function qualityLines(label) {
        var s = String(label).toLowerCase();
        if (/2160|4k|uhd/.test(s)) return 2160;
        var m = /(\d{3,4})/.exec(s);
        return m ? +m[1] : 0;
    }

    function cleanSubtitles(list) {
        var out = [];
        if (!Array.isArray(list)) return out;
        for (var i = 0; i < list.length && out.length < 30; i++) {
            var s = list[i];
            if (!s || typeof s !== 'object') continue;
            var url = mediaUrl(s.url);
            if (!url) continue;
            var lang = String(s.language || s.lang || '').toLowerCase();
            out.push({
                url: url,
                label: String(s.label || lang || 'Субтитры ' + (out.length + 1)).slice(0, 60),
                language: /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(lang) ? lang : '',
                'default': !!s['default']
            });
        }
        return out;
    }

    /** Элемент плейлиста: адрес (или лучшее из quality), подписи, субтитры */
    function cleanPlayItem(o, fallbackTitle) {
        if (!o || typeof o !== 'object') return null;
        var quality = null, best = '', bestLines = -1;
        if (o.quality && typeof o.quality === 'object') {
            var n = 0;
            for (var label in o.quality) {
                if (!o.quality.hasOwnProperty(label) || n >= 12) continue;
                var qu = mediaUrl(o.quality[label]);
                if (!qu) continue;
                quality = quality || {};
                quality[String(label).slice(0, 20)] = qu;
                n++;
                if (qualityLines(label) > bestLines) { bestLines = qualityLines(label); best = qu; }
            }
        }
        var url = mediaUrl(o.url) || best;
        if (!url) return null;
        var item = {
            url: url,
            title: String(o.title || fallbackTitle || 'Видео').slice(0, 200),
            quality: quality,
            subtitles: cleanSubtitles(o.subtitles)
        };
        if (+o.season > 0) item.season = Math.floor(+o.season);
        if (+o.episode > 0) item.episode = Math.floor(+o.episode);
        if (typeof o.hls === 'boolean') item.hls = o.hls;
        return item;
    }

    function playForPlugin(st, o) {
        var now = Date.now();
        var acted = Math.max(st.keyAt || 0, st.actedAt || 0);
        if (panelPlugin !== st.id && now - acted > PLAY_GESTURE_MS) {
            throw new Error('Видео включается только в ответ на действие человека (кнопка, ОК в окне расширения)');
        }
        var screen = currentScreen();
        if (screen === 'config') throw new Error('В настройках видео не включается');
        if (screen === 'player' && !(extPlayback && extPlayback.st === st)) throw new Error('Сейчас идёт другое видео');
        var base = cleanPlayItem(o, o.title);
        var items = [], index = 0;
        if (Array.isArray(o.playlist) && o.playlist.length) {
            for (var i = 0; i < o.playlist.length && items.length < PLAYLIST_LIMIT; i++) {
                var it = cleanPlayItem(o.playlist[i], o.title);
                if (it) items.push(it);
            }
            index = Math.max(0, Math.min(items.length - 1, Math.floor(+o.index) || 0));
            if (base && o.index == null) {
                for (var j = 0; j < items.length; j++) if (items[j].url === base.url) { index = j; break; }
            }
        } else if (base) {
            items.push(base);
        }
        if (!items.length) throw new Error('Нет ссылки на видео (или адрес закрыт: домашняя сеть, сервер TorrStream, TorrServer)');
        var opts = {
            startAt: +o.startAt > 0 ? Math.floor(+o.startAt) : 0,
            poster: /^https:\/\//i.test(String(o.poster || '')) ? String(o.poster).slice(0, 1000) : (lastDetailMeta && lastDetailMeta.poster) || '',
            headers: null
        };
        if (o.headers && typeof o.headers === 'object') {
            var hn = 0;
            for (var h in o.headers) {
                if (!o.headers.hasOwnProperty(h) || hn >= 10 || HEADER_FORBIDDEN.test(h) || !/^[\w-]{1,60}$/.test(h)) continue;
                opts.headers = opts.headers || {};
                opts.headers[h] = String(o.headers[h]).slice(0, 1000);
                hn++;
            }
        }
        if (panelPlugin === st.id) { panelReturnFocus = null; closePanel(); }
        if (window.AndroidJS && typeof AndroidJS.openPlayer === 'function') return playAndroid(st, items, index, opts);
        if (typeof window.openUrlInWebPlayer !== 'function') throw new Error('Плеер недоступен');
        return playWeb(st, items, index, opts);
    }

    /** Android: встроенный или внешний плеер приложения — формат плейлиста как у Lampa */
    function playAndroid(st, items, index, opts) {
        var cur = items[index];
        function lampa(it) {
            var o = { url: it.url, title: it.title };
            if (it.quality) o.quality = it.quality;
            if (it.subtitles.length) o.subtitles = it.subtitles.map(function (s) { return { url: s.url, label: s.label, language: s.language }; });
            if (it.season) o.season = it.season;
            if (it.episode) o.episode = it.episode;
            return o;
        }
        var meta = lastDetailMeta || {};
        var data = lampa(cur);
        data.iptv = false;
        data.poster = opts.poster;
        data.focus_color = focusColor();
        data.auto_next = AppState.autoSwitchEpisodes !== false;
        if (meta.title) data.title_base = meta.title;
        if (meta.tmdbId) { data.id = meta.tmdbId; data.tmdb_id = meta.tmdbId; data.type = meta.type; }
        if (opts.startAt) { data.timecode = opts.startAt; data.timeline = { hash: '', time: opts.startAt, duration: 0, percent: 0 }; }
        if (opts.headers) data.headers = opts.headers;
        if (items.length > 1) data.playlist = items.map(lampa);
        AndroidJS.openPlayer(cur.url, JSON.stringify(data));
        emitTo(st, 'player', { state: 'start', index: index, url: cur.url, player: 'android' });
        return true;
    }

    /** Веб-плеер: openUrlInWebPlayer (catalog.js); плейлист и события — здесь */
    function playWeb(st, items, index, opts) {
        if (extPlayback && extPlayback.st !== st) finishExtPlayback('replaced');
        if (!extPlayback) extPlayback = { st: st, items: items, index: index, web: true, seen: false, startedAt: Date.now() };
        extPlayback.items = items;
        extPlayback.index = index;
        return startWebItem(opts.startAt);
    }

    function startWebItem(startAt) {
        var pb = extPlayback;
        var it = pb.items[pb.index];
        bindVideoEvents(pb);
        return window.openUrlInWebPlayer({ url: it.url, title: it.title, startAt: startAt, hls: it.hls }).then(function () {
            if (extPlayback !== pb) return true;
            pb.seen = true;
            attachWebSubtitles(it);
            emitTo(pb.st, 'player', { state: 'start', index: pb.index, url: it.url, player: 'web' });
            return true;
        }, function (err) {
            if (extPlayback === pb && currentScreen() !== 'player') finishExtPlayback('error');
            throw err;
        });
    }

    /** Субтитры источника — в «Онлайн субтитры» веб-плеера (OnlineSubs в player.js) */
    function attachWebSubtitles(it) {
        var OS = window.OnlineSubs;
        if (!OS || typeof OS.reset !== 'function') return;
        OS.reset();
        if (!it.subtitles.length) return;
        OS.fileKey = 'ext|' + it.url;
        OS.hash = 'ext';
        OS.target = { ext: true };
        OS.list = it.subtitles.map(function (s) { return { url: s.url, lang: s.language || '', name: s.label, source: 'Источник', format: '' }; });
        for (var i = 0; i < it.subtitles.length; i++) {
            if (it.subtitles[i]['default']) { OS.load(OS.list[i], true); break; }
        }
    }

    function videoEl() { return document.getElementById('video-player'); }

    function bindVideoEvents(pb) {
        var vp = videoEl();
        if (!vp || pb.handlers) return;
        pb.handlers = {
            ended: function () {
                if (extPlayback !== pb || currentScreen() !== 'player') return;
                emitTo(pb.st, 'player', { state: 'ended', index: pb.index, position: vp.currentTime || 0, duration: vp.duration || 0 });
                // Следующая серия — как у торрентов: по настройке «Переключать серии автоматически»
                if (pb.index + 1 < pb.items.length && AppState.autoSwitchEpisodes !== false) {
                    pb.index++;
                    startWebItem(0)['catch'](function (err) {
                        if (typeof window.showToast === 'function') window.showToast('Следующая серия не открылась: ' + (err && err.message || err));
                    });
                }
            }
        };
        vp.addEventListener('ended', pb.handlers.ended);
    }

    /** Просмотр расширения закончился: из плеера ушли (или его сменили) */
    function finishExtPlayback(reason) {
        var pb = extPlayback;
        if (!pb) return;
        extPlayback = null;
        var vp = videoEl();
        if (vp && pb.handlers) vp.removeEventListener('ended', pb.handlers.ended);
        if (window.OnlineSubs && OnlineSubs.fileKey && String(OnlineSubs.fileKey).indexOf('ext|') === 0) OnlineSubs.reset();
        emitTo(pb.st, 'player', {
            state: 'exit', reason: reason, index: pb.index,
            url: pb.items[pb.index] ? pb.items[pb.index].url : '',
            position: pb.lastPos || 0, duration: pb.lastDur || 0
        });
    }

    /** Из опроса: позиция для события exit и уход с экрана плеера */
    function pollExtPlayback(screen) {
        var pb = extPlayback;
        if (!pb) return;
        if (screen === 'player') {
            var vp = videoEl();
            if (vp && vp.currentTime > 0) { pb.lastPos = vp.currentTime; pb.lastDur = isFinite(vp.duration) ? vp.duration : 0; }
            // Плеер занят уже не нами (запустили раздачу)
            if (pb.seen && window.AppState && !AppState.isYoutubePlayback) finishExtPlayback('replaced');
            return;
        }
        if (pb.seen || Date.now() - pb.startedAt > 60000) finishExtPlayback('exit');
    }

    /** Клавиша, нажатая с фокусом ввода внутри окна плагина (щёлкнули мышью) */
    function onPanelNativeKey(st, k) {
        if (panelPlugin !== st.id || !k) return;
        var dir = null;
        if (typeof isBackKey === 'function' && isBackKey(k)) dir = 'back';
        else if (typeof isArrowKey === 'function' && isArrowKey(k)) dir = arrowDir(k);
        else if (typeof isOkKey === 'function' && isOkKey(k)) dir = 'enter';
        if (!dir) return;
        if (dir === 'back') { closePanel(); return; }
        emitTo(st, 'key', dir);
    }

    // ==================== ЭКРАН И КАРТОЧКА: ОПРОС ====================

    var lastScreen = null, lastItem = null, lastDetailMeta = null;

    function currentScreen() {
        return (window.AppState && AppState.currentScreen) || '';
    }

    function poll() {
        var s = currentScreen();
        suspendInSettings(s === 'config');
        if (s !== lastScreen) {
            lastScreen = s;
            emitAll('screen', s);
            if (panelPlugin && s === 'player') closePanel();
            // Экран сменился — захват пульта снят, плагин закрывает своё меню
            if (captureOwner) {
                var owner = running[captureOwner];
                releaseCapture();
                if (owner) emitTo(owner, 'key', 'back');
            }
        }
        var item = window.AppState ? AppState.currentDetailItem : null;
        if (item !== lastItem) {
            lastItem = item;
            lastDetailMeta = detailMeta(item);
            if (lastDetailMeta && s === 'detail') emitAll('detail', lastDetailMeta);
            // Карточку перестроили — кнопки расширений могли выпасть из ряда. С
            // источниками онлайна — всегда: «Онлайн» есть не у всякой карточки
            if (hasOnline() || (hasDetailExtras() && !document.querySelector('#catalog-detail-actions .ext-detail-btn'))) renderDetailExtras();
        }
        pollExtPlayback(s);
    }

    function hasDetailExtras() {
        for (var id in running) {
            if (running.hasOwnProperty(id) && (running[id].buttons.length || running[id].block || running[id].online)) return true;
        }
        return false;
    }

    function hasOnline() {
        for (var id in running) if (running.hasOwnProperty(id) && running[id].online) return true;
        return false;
    }

    // ==================== ОКНО ПЛАГИНА ====================

    function panelHead() {
        var head = document.getElementById('ext-panel-head');
        if (head) return head;
        head = document.createElement('div');
        head.id = 'ext-panel-head';
        head.className = 'ext-panel-head';
        head.innerHTML = '<span class="ext-panel-title"></span><span class="ext-panel-hint">«Назад» — закрыть</span>' +
            '<span class="ext-panel-close" role="button" aria-label="Закрыть">✕</span>';
        head.querySelector('.ext-panel-close').addEventListener('click', closePanel);
        document.body.appendChild(head);
        return head;
    }

    function openPanel(st, title) {
        // Окно открывается только в ответ на действие пользователя в интерфейсе,
        // не само по себе посреди просмотра
        if (currentScreen() === 'player') return;
        if (panelPlugin && panelPlugin !== st.id) closePanel();
        panelPlugin = st.id;
        if (!panelReturnFocus) panelReturnFocus = document.querySelector('.focused');
        var head = panelHead();
        // Имя расширения — всегда приложением, не плагином: видно, чьё это окно
        head.querySelector('.ext-panel-title').textContent = 'Расширение «' + (st.plugin.name || nameFromUrl(st.plugin.url)) + '»' + (title ? ' — ' + title : '');
        head.classList.add('open');
        st.frame.classList.add('open');
        document.documentElement.classList.add('ext-panel-open');
        emitTo(st, 'panel', { open: true });
    }

    function closePanel() {
        var id = panelPlugin;
        if (!id) return;
        panelPlugin = null;
        var st = running[id];
        var head = document.getElementById('ext-panel-head');
        if (head) head.classList.remove('open');
        if (st) {
            st.frame.classList.remove('open');
            emitTo(st, 'panel', { open: false });
            // Щёлкнули мышью по окну — фокус ввода остался в iframe, и клавиши
            // шли бы в спрятанную песочницу. Возвращаем его странице
            if (document.activeElement === st.frame) { try { st.frame.blur(); window.focus(); } catch (e) { } }
        }
        document.documentElement.classList.remove('ext-panel-open');
        var back = panelReturnFocus;
        panelReturnFocus = null;
        if (back && back.isConnected !== false && back.offsetParent !== null && typeof window.focusEl === 'function') window.focusEl(back);
    }

    function onKeyDown(e) {
        var k = e.keyCode || e.which;
        if (modal) { onModalKey(e, k); return; }
        if (holdKeyDown(e, k)) return;
        var dir = null;
        if (typeof isBackKey === 'function' && isBackKey(k)) dir = 'back';
        else if (typeof isArrowKey === 'function' && isArrowKey(k)) dir = arrowDir(k);
        else if (typeof isOkKey === 'function' && isOkKey(k)) dir = 'enter';
        if (!dir) return;
        // Встроенная клавиатура открыта — клавиши её
        if (window.OSK && OSK.isOpen && OSK.isOpen()) return;
        if (panelPlugin) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (dir === 'back') { closePanel(); return; }
            if (running[panelPlugin]) emitTo(running[panelPlugin], 'key', dir);
            return;
        }
        var screen = currentScreen();
        if (captureOwner) {
            var cst = running[captureOwner];
            var taken = !captureKeys || captureKeys.indexOf(dir) !== -1;
            if (!cst || screen === 'player') { releaseCapture(); }
            else if (taken) {
                e.preventDefault();
                e.stopImmediatePropagation();
                // «Назад» возвращает пульт приложению всегда: плагин, забывший
                // отпустить захват, не запрёт человека в своём меню
                if (dir === 'back') releaseCapture();
                emitTo(cst, 'key', dir);
                return;
            } else if (dir === 'back') {
                // «Назад» не в списке кнопок — работает в приложении как обычно, но
                // пульт возвращается и тут: иначе захват держался бы до смены экрана,
                // а на главной «Назад» экран не меняет. Плагину — тот же «back»
                releaseCapture();
                emitTo(cst, 'key', 'back');
            }
        }
        if (dir === 'back' || screen === 'player' || screen === 'config') return;
        var a = document.activeElement;
        if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
        emitNav(dir, document.querySelector('.focused'), screen);
    }

    // ==================== НАСТРОЙКИ ====================

    function platformName() {
        try { if (typeof detectPlatform === 'function') return String(detectPlatform()); } catch (e) { }
        return '';
    }

    function focusColor() {
        try { if (window.UICustomizer && UICustomizer.getFocusColor) return UICustomizer.getFocusColor(); } catch (e) { }
        return '#ff8c00';
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function setStatus(text, isError) {
        var el = document.getElementById('extensions-status');
        if (!el) return;
        el.hidden = !text;
        el.textContent = text || '';
        el.classList.toggle('is-error', !!isError);
    }

    /*
     * Раздел в стиле менеджера приложений red.app: сетка плиток, первая —
     * пунктирная «Добавить». ОК на плитке — меню расширения, удержание ОК —
     * удаление (полоска заполняется). Плитки — .settings-chip внутри
     * .settings-chips: так control.js водит по ним как по ряду вариантов
     * (влево/вправо — по ряду, вверх/вниз — по строкам сетки).
     */
    var TILE_COLORS = ['#2b7fff', '#ff4d5e', '#8e5cf7', '#16a37a', '#f08a24', '#e0447c', '#1fa0c4', '#6b7a8f'];

    function tileColor(name) {
        var h = 0;
        name = String(name || '');
        for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
        return TILE_COLORS[h % TILE_COLORS.length];
    }

    function tileIcon(name) {
        var letter = String(name || '?').replace(/^[^0-9A-Za-zА-Яа-яЁё]+/, '').charAt(0).toUpperCase() || '?';
        return '<span class="ext-tile-icon" style="background-color:' + tileColor(name) + '">' + esc(letter) + '</span>';
    }

    function pluginTitle(p) { return p.name || nameFromUrl(p.url); }

    // Название под плиткой. marquee-text + span — бегущая строка приложения:
    // длинное проезжает у плитки в фокусе (applyTitleMarquee, control.js)
    function tileName(name) {
        return '<span class="ext-tile-name marquee-text"><span>' + esc(name) + '</span></span>';
    }

    function renderSettings() {
        var box = document.getElementById('extensions-installed');
        if (!box) return;
        var f = document.querySelector('.focused');
        var focusId = f && box.contains(f) ? (f.getAttribute('data-ext-id') || 'add') : '';
        var html = '<button class="settings-chip ext-tile add" data-ext-add="1">' +
            '<span class="ext-tile-box"><span class="ext-plus">+</span></span>' +
            tileName('Добавить') + '</button>';
        for (var i = 0; i < plugins.length; i++) {
            var p = plugins[i];
            var sub = p.error ? '⚠ Ошибка' : p.enabled ? (p.version ? 'Версия ' + p.version : 'Включено') : 'Выключено';
            html += '<button class="settings-chip ext-tile' + (p.enabled ? '' : ' is-off') + (p.error ? ' has-error' : '') +
                '" data-ext-id="' + esc(p.id) + '" title="' + esc(p.description || p.url) + '">' +
                '<span class="ext-tile-box">' + tileIcon(pluginTitle(p)) +
                '<span class="ext-tile-sub">' + esc(sub) + '</span>' +
                '<span class="ext-holdbar"><i></i></span></span>' +
                tileName(pluginTitle(p)) + '</button>';
        }
        box.innerHTML = html;
        renderCatalog();
        if (typeof window.invalidateFocusCache === 'function') window.invalidateFocusCache();
        if (focusId && !modal && typeof window.focusEl === 'function') {
            var again = focusId === 'add' ? box.querySelector('[data-ext-add]') :
                box.querySelector('[data-ext-id="' + focusId + '"]');
            window.focusEl(again || box.querySelector('[data-ext-add]'));
        }
    }

    function renderCatalog() {
        var box = document.getElementById('extensions-catalog');
        if (!box) return;
        if (!catalogCache) { box.innerHTML = '<p class="settings-lead">Загрузка…</p>'; return; }
        if (!catalogCache.length) { box.innerHTML = '<p class="settings-lead">Каталог недоступен.</p>'; return; }
        var f = document.querySelector('.focused');
        var focusIdx = f && box.contains(f) ? f.getAttribute('data-ext-catalog') : null;
        var html = '';
        for (var i = 0; i < catalogCache.length; i++) {
            var c = catalogCache[i];
            var installed = !!findPlugin(pluginIdFor(c.url));
            html += '<button class="settings-chip ext-tile' + (installed ? ' is-installed' : '') + '" data-ext-catalog="' + i +
                '" title="' + esc(c.description) + '">' +
                '<span class="ext-tile-box">' + tileIcon(c.name) +
                '<span class="ext-tile-sub">' + (installed ? '✓ Установлено' : 'Установить') + '</span></span>' +
                tileName(c.name) + '</button>';
        }
        box.innerHTML = html;
        if (focusIdx !== null && typeof window.focusEl === 'function') {
            var again = box.querySelector('[data-ext-catalog="' + focusIdx + '"]');
            if (again) window.focusEl(again);
        }
    }

    function loadCatalog() {
        fetch(mirrorBase() + 'extensions/catalog.json', { cache: 'no-cache', credentials: 'omit' })
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(function (list) {
                var out = [];
                list = list && list.plugins ? list.plugins : list;
                for (var i = 0; list && i < list.length; i++) {
                    var c = list[i];
                    if (!c || !c.url || !c.name) continue;
                    // Относительная ссылка — от каталога
                    var url = /^https?:/i.test(c.url) ? c.url : parseUrl(mirrorBase() + 'extensions/' + c.url).href;
                    out.push({ name: String(c.name), description: String(c.description || ''), url: url });
                }
                catalogCache = out;
            }, function () { catalogCache = []; })
            .then(renderCatalog);
    }

    function normalizeUrl(url) {
        url = String(url || '').trim();
        if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
        var u = validPluginUrl(url);
        return u ? u.href : '';
    }

    /** @returns {string} '' — установлено, иначе текст ошибки */
    function install(url, meta) {
        var href = normalizeUrl(url);
        if (!href) return 'Нужна ссылка на файл расширения вида https://…/plugin.js';
        var id = pluginIdFor(href);
        if (findPlugin(id)) return 'Это расширение уже установлено';
        var p = {
            id: id, url: href, enabled: true,
            name: meta && meta.name || nameFromUrl(href),
            description: meta && meta.description || '', version: ''
        };
        plugins.push(p);
        saveList();
        if (!noExtensions()) startPlugin(p);
        setStatus('Установлено: ' + p.name);
        renderSettings();
        return '';
    }

    function uninstall(id) {
        var p = findPlugin(id);
        stopPlugin(id);
        for (var i = 0; i < plugins.length; i++) {
            if (plugins[i].id === id) { plugins.splice(i, 1); break; }
        }
        saveList();
        dbPut(id, null);
        setStatus(p ? 'Удалено: ' + pluginTitle(p) : '');
        renderSettings();
    }

    function setEnabled(id, on) {
        var p = findPlugin(id);
        if (!p) return;
        p.enabled = !!on;
        saveList();
        if (on) { if (!noExtensions()) startPlugin(p); }
        else { stopPlugin(id); p.error = ''; }
        renderSettings();
    }

    function disableAll() {
        var n = 0;
        for (var i = 0; i < plugins.length; i++) {
            if (!plugins[i].enabled) continue;
            plugins[i].enabled = false;
            stopPlugin(plugins[i].id);
            n++;
        }
        saveList();
        renderSettings();
        setStatus(n ? 'Выключено расширений: ' + n + '. Включить — ОК на плитке' : 'Включённых расширений нет');
    }

    /*
     * В настройках расширения не действуют: их стили отключены, их элементы
     * спрятаны. Что бы плагин ни сломал в оформлении, раздел «Расширения»
     * остаётся рабочим — откатить можно на любом устройстве, в том числе там,
     * где адресной строки для ?noext=1 нет (приложения ТВ, Android).
     */
    var suspended = null;   // [[элемент, его style.cssText]] на время настроек

    function suspendInSettings(on) {
        if (on && !suspended) {
            suspended = [];
            for (var id in running) {
                if (running.hasOwnProperty(id) && running[id].styleEl) running[id].styleEl.media = 'not all';
            }
            var own = document.querySelectorAll('[data-ext]');
            for (var i = 0; i < own.length; i++) {
                if (own[i].closest('#ext-host') || own[i].tagName === 'STYLE') continue;
                suspended.push([own[i], own[i].style.cssText]);
                own[i].style.setProperty('display', 'none', 'important');
            }
        } else if (!on && suspended) {
            for (var rid in running) {
                if (running.hasOwnProperty(rid) && running[rid].styleEl) running[rid].styleEl.media = '';
            }
            for (var j = 0; j < suspended.length; j++) suspended[j][0].style.cssText = suspended[j][1];
            suspended = null;
        }
    }

    function openPluginSettings(id, from) {
        var st = running[id];
        if (!st) { setStatus('Расширение не запущено', true); return; }
        panelReturnFocus = from || null;
        emitTo(st, 'settings', {});
    }

    // ---------- Модальные окна: «Добавить» и меню расширения ----------

    var modal = null;   // { el, returnFocus }

    function modalFocusables() {
        if (!modal) return [];
        var all = modal.el.querySelectorAll('input, button');
        var out = [];
        for (var i = 0; i < all.length; i++) if (all[i].offsetParent !== null && !all[i].disabled) out.push(all[i]);
        return out;
    }

    function modalFocus(el) {
        var cur = document.querySelectorAll('.focused');
        for (var i = 0; i < cur.length; i++) cur[i].classList.remove('focused');
        if (el) el.classList.add('focused');
    }

    function modalMove(dir) {
        var list = modalFocusables();
        var c = modal.el.querySelector('.focused');
        if (!c) { modalFocus(list[0]); return; }
        var r = c.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        var best = null, bestScore = Infinity;
        for (var i = 0; i < list.length; i++) {
            if (list[i] === c) continue;
            var q = list[i].getBoundingClientRect();
            var dx = q.left + q.width / 2 - cx, dy = q.top + q.height / 2 - cy;
            var ok = dir === 'up' ? dy < -4 : dir === 'down' ? dy > 4 :
                dir === 'left' ? dx < -4 && Math.abs(dy) < 4 : dx > 4 && Math.abs(dy) < 4;
            if (!ok) continue;
            var score = (dir === 'up' || dir === 'down') ? Math.abs(dy) + Math.abs(dx) * 0.2 : Math.abs(dx);
            if (score < bestScore) { bestScore = score; best = list[i]; }
        }
        if (best) modalFocus(best);
    }

    function openModal(html, returnFocus) {
        closeModal(true);
        var el = document.createElement('div');
        el.className = 'ext-modal';
        el.innerHTML = '<div class="ext-modal-box">' + html + '</div>';
        el.addEventListener('click', function (e) { if (e.target === el) closeModal(); });
        var host = (typeof window.getOverlayHost === 'function') ? window.getOverlayHost() : document.body;
        host.appendChild(el);
        modal = { el: el, returnFocus: returnFocus || document.querySelector('.focused') };
        modalFocus(modalFocusables()[0]);
        return el;
    }

    function closeModal(silent) {
        if (!modal) return;
        var m = modal;
        modal = null;
        if (window.OSK && OSK.isOpen && OSK.isOpen()) OSK.close(false);
        if (m.el.parentNode) m.el.parentNode.removeChild(m.el);
        if (!silent && m.returnFocus && m.returnFocus.isConnected !== false && typeof window.focusEl === 'function') {
            window.focusEl(m.returnFocus);
        }
    }

    function showAddModal(from) {
        var el = openModal(
            '<h3>Добавить расширение</h3>' +
            '<label class="ext-modal-label">Ссылка на расширение</label>' +
            '<input type="text" class="text-input ext-modal-input" id="ext-add-url" placeholder="https://…/plugin.js" autocomplete="off" spellcheck="false">' +
            '<label class="ext-modal-label">Наименование <span class="ext-modal-opt">— необязательно, иначе возьмётся из расширения</span></label>' +
            '<input type="text" class="text-input ext-modal-input" id="ext-add-name" placeholder="Например: Посмотреть позже" autocomplete="off">' +
            '<div class="ext-modal-error" hidden></div>' +
            '<p class="ext-modal-note">Расширение работает в песочнице: паролей, входа в учётку и адресов серверов оно не видит. Но открытые вами фильмы видит — ставьте только то, чему доверяете.</p>' +
            '<div class="ext-modal-actions">' +
            '<button class="ext-modal-btn primary" data-act="save">Сохранить</button>' +
            '<button class="ext-modal-btn" data-act="cancel">Отмена</button></div>', from);
        el.addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('[data-act]') : null;
            if (!b) return;
            if (b.getAttribute('data-act') === 'cancel') { closeModal(); return; }
            var url = el.querySelector('#ext-add-url').value;
            var name = el.querySelector('#ext-add-name').value.trim();
            var err = install(url, name ? { name: name } : null);
            if (err) {
                var box = el.querySelector('.ext-modal-error');
                box.textContent = err;
                box.hidden = false;
                return;
            }
            closeModal(true);
            focusTile(pluginIdFor(normalizeUrl(url)));
        });
    }

    function showPluginMenu(id, from) {
        var p = findPlugin(id);
        if (!p) return;
        var info = p.error ? '<p class="ext-modal-error">⚠ ' + esc(p.error) + '</p>' :
            (p.description ? '<p class="ext-modal-desc">' + esc(p.description) + '</p>' : '');
        // Рекомендации — снимком на момент открытия меню: применится ровно то, что
        // человек видит в списке, даже если плагин пришлёт новые, пока меню открыто
        var rec = p.enabled && recommendPending(running[id]) ? recommendChanges(running[id].recommend) : null;
        if (rec) info += '<p class="ext-modal-desc">Рекомендует: ' + esc(rec.text) + '</p>';
        var el = openModal(
            '<div class="ext-modal-head">' + tileIcon(pluginTitle(p)) + '<div><h3>' + esc(pluginTitle(p)) + '</h3>' +
            '<div class="ext-modal-url">' + esc(p.url) + (p.version ? ' · версия ' + esc(p.version) : '') + '</div></div></div>' + info +
            '<div class="ext-modal-actions">' +
            (p.enabled && p.settings && running[id] ? '<button class="ext-modal-btn primary" data-act="open">Открыть</button>' : '') +
            (rec ? '<button class="ext-modal-btn primary" data-act="recommend">Применить рекомендуемые настройки</button>' : '') +
            '<button class="ext-modal-btn' + (p.enabled ? '' : ' primary') + '" data-act="toggle">' + (p.enabled ? 'Выключить' : 'Включить') + '</button>' +
            '<button class="ext-modal-btn danger" data-act="remove">Удалить</button>' +
            '<button class="ext-modal-btn" data-act="cancel">Отмена</button></div>', from);
        el.addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('[data-act]') : null;
            if (!b) return;
            var act = b.getAttribute('data-act');
            if (act === 'cancel') { closeModal(); return; }
            if (act === 'remove') {
                // Подтверждение повторным нажатием: confirm() в Android-приложении
                // молча отвечает «нет», а на телевизорах его бывает не видно
                if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Точно удалить?'; return; }
                closeModal(true); uninstall(id); focusTile('add'); return;
            }
            if (act === 'toggle') { closeModal(true); setEnabled(id, !p.enabled); focusTile(id); return; }
            if (act === 'recommend') {
                // Только по нажатию человека: плагин настройки сам не меняет
                closeModal(true);
                if (rec && window.UICustomizer && typeof UICustomizer.set === 'function') UICustomizer.set(rec.settings);
                setStatus('Применены настройки, рекомендованные «' + pluginTitle(p) + '»');
                focusTile(id);
                return;
            }
            if (act === 'open') { closeModal(true); focusTile(id); openPluginSettings(id, document.querySelector('.focused')); }
        });
    }

    function focusTile(id) {
        var box = document.getElementById('extensions-installed');
        if (!box || typeof window.focusEl !== 'function') return;
        var t = id === 'add' ? null : box.querySelector('[data-ext-id="' + id + '"]');
        window.focusEl(t || box.querySelector('[data-ext-add]'));
    }

    function onModalKey(e, k) {
        // Печатают в поле (системная клавиатура) — стрелки влево/вправо его
        var a = document.activeElement;
        var typing = a && a.tagName === 'INPUT' && modal.el.contains(a);
        var dir = null;
        if (typeof isBackKey === 'function' && isBackKey(k)) dir = 'back';
        else if (typeof isArrowKey === 'function' && isArrowKey(k)) dir = arrowDir(k);
        else if (typeof isOkKey === 'function' && isOkKey(k)) dir = 'enter';
        if (!dir) return;
        if (typing && (dir === 'left' || dir === 'right')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (typing) {
            try { a.blur(); } catch (err) { }
            if (dir === 'up' || dir === 'down') modalMove(dir);
            return;
        }
        if (dir === 'back') { closeModal(); return; }
        if (dir === 'enter') {
            var c = modal.el.querySelector('.focused');
            if (!c) return;
            if (c.tagName === 'INPUT') { try { c.focus(); } catch (err) { } }
            else c.click();
            return;
        }
        modalMove(dir);
    }

    // ---------- Удержание ОК на плитке — удаление ----------

    var HOLD_MS = 1200;
    var hold = null;   // { tile, id, timer, release }

    function holdStart(tile) {
        holdCancel();
        hold = { tile: tile, id: tile.getAttribute('data-ext-id') };
        tile.classList.add('holding');
        hold.timer = setTimeout(function () {
            var h = hold;
            hold = null;
            if (!h) return;
            if (h.release) clearTimeout(h.release);
            h.tile.classList.remove('holding');
            h.tile.classList.add('removing');
            // ОК ещё держат: его повторы не должны нажать то, что встанет на место
            swallowOk = true;
            setTimeout(function () { uninstall(h.id); focusTile('add'); }, 180);
        }, HOLD_MS);
    }

    function holdCancel() {
        if (!hold) return;
        clearTimeout(hold.timer);
        if (hold.release) clearTimeout(hold.release);
        hold.tile.classList.remove('holding');
        hold = null;
    }

    var swallowOk = false, swallowTimer = null;

    function holdKeyDown(e, k) {
        if (typeof isOkKey !== 'function' || !isOkKey(k)) return false;
        if (swallowOk) {
            if (swallowTimer) { clearTimeout(swallowTimer); swallowTimer = null; }
            e.preventDefault();
            e.stopImmediatePropagation();
            return true;
        }
        if (currentScreen() !== 'config') return false;
        var f = document.querySelector('.focused');
        if (!f || !f.classList.contains('ext-tile') || !f.hasAttribute('data-ext-id')) return false;
        // Apple TV: keyup за ОК бывает не приходит — удержание там не различить,
        // ОК сразу открывает меню (удалить можно из него)
        if (typeof isAppleRemote === 'function' && isAppleRemote()) return false;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (hold && hold.tile === f) {
            // Повтор удержания (на Tizen keyup приходит на каждый тик — ждём)
            if (hold.release) { clearTimeout(hold.release); hold.release = null; }
            return true;
        }
        holdStart(f);
        return true;
    }

    function onKeyUp(e) {
        var k = e.keyCode || e.which;
        if (typeof isOkKey !== 'function' || !isOkKey(k)) return;
        if (swallowOk) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (swallowTimer) clearTimeout(swallowTimer);
            swallowTimer = setTimeout(function () { swallowOk = false; swallowTimer = null; }, 250);
            return;
        }
        if (!hold) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (hold.release) return;
        // Отпускание засчитываем, если за ним не пришёл повтор нажатия
        hold.release = setTimeout(function () {
            var h = hold;
            if (!h) return;
            holdCancel();
            showPluginMenu(h.id, h.tile);
        }, 180);
    }

    // ---------- Клики ----------

    function onSettingsClick(e) {
        var t = e.target;
        var btn = t && t.closest ? t.closest('button') : null;
        if (!btn || modal) return;
        if (btn.hasAttribute('data-ext-add')) { showAddModal(btn); return; }
        if (btn.hasAttribute('data-ext-id')) { showPluginMenu(btn.getAttribute('data-ext-id'), btn); return; }
        if (btn.hasAttribute('data-ext-catalog')) {
            var c = catalogCache && catalogCache[+btn.getAttribute('data-ext-catalog')];
            if (!c) return;
            var id = pluginIdFor(normalizeUrl(c.url));
            if (findPlugin(id)) { showPluginMenu(id, btn); return; }
            var err = install(c.url, c);
            if (err) setStatus(err, true);
        }
    }

    /**
     * Ряд плиток прокручивается под плитку в фокусе, как ряды главной: фокус
     * ставит control.js классом .focused — ловим его появление в рядах.
     */
    function keepTileVisible(tile) {
        // Тем же, чем ряды главной (home.js scrollToCard → control.js)
        if (typeof window.scrollRowToCard === 'function') window.scrollRowToCard(tile);
    }

    function watchTileFocus(row) {
        if (!row || !window.MutationObserver) return;
        new MutationObserver(function (list) {
            for (var i = 0; i < list.length; i++) {
                var t = list[i].target;
                if (t.parentNode === row && t.classList.contains('focused')) { keepTileVisible(t); return; }
            }
        }).observe(row, { subtree: true, attributes: true, attributeFilter: ['class'] });
    }

    function setupSettings() {
        var tab = document.getElementById('extensions-tab-content');
        if (!tab) return;
        watchTileFocus(document.getElementById('extensions-installed'));
        var offAll = document.getElementById('extensions-disable-all');
        if (offAll) offAll.addEventListener('click', disableAll);
        watchTileFocus(document.getElementById('extensions-catalog'));
        tab.addEventListener('click', onSettingsClick);
        window.addEventListener('keyup', onKeyUp, true);
        if (noExtensions()) setStatus('Расширения отключены: в адресе страницы ?noext=1', true);
        renderSettings();
        // Каталог — при первом открытии раздела, не на старте приложения
        var loaded = false;
        function lazy() { if (!loaded && tab.style.display !== 'none') { loaded = true; loadCatalog(); } }
        if (window.MutationObserver) {
            new MutationObserver(lazy).observe(tab, { attributes: true, attributeFilter: ['style'] });
        } else {
            loadCatalog();
        }
    }

    function noExtensions() {
        return /[?&]noext=1/.test(location.search);
    }

    // ==================== СТАРТ ====================

    function start() {
        loadList();
        setupSettings();
        // Капчер на window — раньше перехватчика control.js на document: пока
        // окно расширения открыто, стрелки и OK уходят в него, «Назад» закрывает
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('message', onMessage);
        if (noExtensions()) { log('отключены (?noext=1)'); return; }
        var any = false;
        for (var i = 0; i < plugins.length; i++) {
            if (plugins[i].enabled) { any = true; break; }
        }
        setTimeout(function () {
            for (var j = 0; j < plugins.length; j++) if (plugins[j].enabled) startPlugin(plugins[j]);
        }, any ? START_DELAY_MS : 0);
        setInterval(function () { if (hasRunning()) { poll(); pollHome(); } }, POLL_MS);
        document.addEventListener('click', onDocumentClick, true);
    }

    function hasRunning() {
        for (var id in running) if (running.hasOwnProperty(id)) return true;
        return false;
    }

    window.Extensions = {
        install: install,
        uninstall: uninstall,
        setEnabled: setEnabled,
        list: function () { return JSON.parse(JSON.stringify(plugins)); },
        closePanel: closePanel,
        isPanelOpen: function () { return !!panelPlugin; },
        // для проверки правил
        _fetchAllowed: fetchAllowed,
        _running: function () { return running; },
        _cleanCss: cleanCss
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
