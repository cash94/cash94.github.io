// =====================================================
// SAMSUNG TIZEN: КАРТОЧКИ SMART HUB PREVIEW
// =====================================================
//
// Аналог каналов Android TV (TorrStream-Android: channels/Channels.kt): над
// ярлыком TorrStream в Smart Hub — две колонки карточек: слева «Продолжить
// просмотр», справа «В тренде на этой неделе». Работает только в приложении
// TorrStream-Tizen (страница из пакета, есть window.tizen).
//
// С TorrStream-Tizen 1.2.0 — как у VoKino: в config.xml use.preview =
// endpoint_URL, и Smart Hub сам раз в 10 минут берёт JSON с сервера
// (GET /api/smarthub/preview на torrstream.online). Кто смотрит, Smart Hub не
// сообщает, поэтому здесь мы только отмечаемся на сервере
// (POST /api/smarthub/register): «с этого IP TorrStream открыт под этой
// учёткой» — по IP сервер и отдаёт историю. Так работает и на Tizen 5.5, где
// нет ни веб-служб, ни webapis.preview.
//
// Ниже — путь старых пакетов (до 1.2.0, use.preview = bg_service): если в
// пакете есть служба TorrStrm01.preview, ряды собираем сами (SECTIONS) и
// готовый JSON отдаём ей в данных запуска, а она — системе:
// webapis.preview.setPreviewData — и отвечает через messageport, принял ли
// его Smart Hub. Служба не запустилась или не ответила — тот же вызов из
// самой страницы. Что вышло — «Smart Hub» в «Об устройстве». Чаще раза в 10 минут Samsung его звать не
// велит (лишние вызовы молча теряются), поэтому отправляем только изменения и
// не чаще MIN_INTERVAL_MS.
//
// Нажатие на карточку запускает приложение (или будит запущенное — событие
// appcontrol) с PAYLOAD = action_data карточки. Карточку открываем поверх
// главной, как Android (MainActivity.openCardOverHome): «Назад» ведёт на главную.

(function () {
    'use strict';

    if (!window.tizen || !tizen.application) return;

    var SERVICE_ID = 'TorrStrm01.preview';
    var PER_SECTION = 20;           // 2 ряда × 20 = 40 — предел Samsung
    var IMG_SIZE = 'w185';          // 2:3 — от 167×250 до 240×360
    var MIN_INTERVAL_MS = 10 * 60 * 1000;
    // Те же карточки повторяем раз в полдня: вдруг система их забыла
    var REPEAT_MS = 12 * 60 * 60 * 1000;
    var CHECK_MS = 10 * 60 * 1000;
    var FIRST_DELAY_MS = 5000;
    // Новый ключ: в первой версии «отправлено» значило лишь «служба запустилась»
    var SENT_KEY = 'tsSmartHubPreview2';
    var STATUS_KEY = 'tsSmartHubStatus';
    var STATUS_PORT = 'TS_PREVIEW_STATUS';
    var REPLY_MS = 30 * 1000;
    var COLD_KEY = 'tsPreviewColdDone';
    var TORRENT_HASH = /^[0-9a-f]{40}$/;

    // Две колонки, как у сервера (routes/smarthub.js): слева история, справа тренды
    var SECTIONS = [
        { key: 'history', title: 'Продолжить просмотр', source: 'history' },
        { key: 'trending_week', title: 'В тренде на этой неделе', source: 'tmdb' }
    ];
    // Отметка на сервере для endpoint_URL: Smart Hub ходит раз в 10 минут, а
    // сервер забывает телевизор через 2 месяца — раз в 3 часа с запасом
    var REGISTER_MS = 3 * 60 * 60 * 1000;
    var REGISTER_DELAY_MS = 8000;
    // Адрес, который зашит в config.xml пакета (endpoint_URL)
    var PREVIEW_HOST = 'torrstream.online';

    function log(msg) { try { console.log('📺 Smart Hub: ' + msg); } catch (e) { } }

    function serverUrl() { return window.SERVER_URL || window.location.origin; }

    // Web-служба есть не на всех ТВ: без неё launchAppControl, по словам
    // Samsung, ломает приложению картинки и видео (Smart Hub Preview Q&A, Q13)
    function serviceSupported() {
        try {
            return !!(tizen.systeminfo && tizen.systeminfo.getCapability('http://tizen.org/feature/web.service'));
        } catch (e) { return false; }
    }

    // ==================== КАРТОЧКИ ====================

    function imageUrl(pathOrUrl) {
        if (!pathOrUrl) return '';
        var p = String(pathOrUrl);
        if (typeof window.getTmdbImageUrl === 'function') return window.getTmdbImageUrl(p, IMG_SIZE);
        return /^https?:\/\//i.test(p) ? p : '';
    }

    function yearOf(item) {
        var m = String((item && (item.release_date || item.first_air_date || item.year)) || '').match(/(19|20)\d{2}/);
        return m ? m[0] : '';
    }

    function tile(sectionKey, card, poster, subtitle) {
        var img = imageUrl(poster);
        if (!img || !card.title) return null;
        // action_data у каждой карточки должен быть свой — отсюда ключ ряда:
        // один фильм бывает и в истории, и в подборке
        var data = { s: sectionKey, id: card.id ? String(card.id) : '', media_type: card.media_type || 'movie', title: card.title };
        if (card.hash) data.hash = card.hash;
        if (poster && !/^https?:/i.test(poster)) data.poster = poster;
        var t = {
            title: card.title,
            image_ratio: '2by3',
            image_url: img,
            action_data: JSON.stringify(data),
            is_playable: false
        };
        if (subtitle) t.subtitle = subtitle;
        return t;
    }

    function typeLabel(mediaType) { return mediaType === 'tv' ? 'Сериал' : 'Фильм'; }

    function historyTiles(key) {
        var hs = window.HomeScreen && HomeScreen.state;
        var items = (hs && hs.data && hs.data.history) || [];
        var out = [];
        for (var i = 0; i < items.length && out.length < PER_SECTION; i++) {
            var it = items[i];
            if (!it || it.id == null) continue;
            var title = it.title || it.name;
            var t = tile(key, { id: it.id, media_type: it.media_type, title: title }, it.poster_path,
                typeLabel(it.media_type));
            if (t) out.push(t);
        }
        return out;
    }

    function collectionItems(key) {
        var hs = window.HomeScreen && HomeScreen.state;
        var items = hs && hs.data && hs.data[key];
        if (items && items.length) return Promise.resolve(items);
        // Ряд скрыт в настройках главной или ещё не загрузился — спросим сами
        return fetch(serverUrl() + '/api/tmdb/collection?preset=' + encodeURIComponent(key))
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) { return (d && d.success && d.items) || []; })
            ['catch'](function () { return []; });
    }

    function collectionTiles(key) {
        return collectionItems(key).then(function (items) {
            var out = [];
            for (var i = 0; i < items.length && out.length < PER_SECTION; i++) {
                var it = items[i];
                if (!it || it.id == null) continue;
                var title = it.title || it.name;
                var year = yearOf(it);
                var t = tile(key, { id: it.id, media_type: it.media_type, title: title }, it.poster_path,
                    typeLabel(it.media_type) + (year ? ' · ' + year : ''));
                if (t) out.push(t);
            }
            return out;
        });
    }

    function buildPreview() {
        return Promise.all(SECTIONS.map(function (s) {
            if (s.source === 'history') return Promise.resolve(historyTiles(s.key));
            return collectionTiles(s.key);
        })).then(function (lists) {
            var sections = [];
            for (var i = 0; i < SECTIONS.length; i++) {
                if (lists[i] && lists[i].length) sections.push({ title: SECTIONS[i].title, position: i, tiles: lists[i] });
            }
            return sections.length ? { sections: sections } : null;
        });
    }

    // ==================== ОТПРАВКА СЛУЖБЕ ====================

    function hashOf(s) {
        var h = 5381;
        for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
        return String(h >>> 0) + ':' + s.length;
    }

    /** Последняя отправка: {h, at, ok} — ok, когда Smart Hub приём подтвердил */
    function readSent() {
        try { return JSON.parse(localStorage.getItem(SENT_KEY) || 'null') || {}; } catch (e) { return {}; }
    }

    function writeSent(h, ok) {
        try { localStorage.setItem(SENT_KEY, JSON.stringify({ h: h, at: Date.now(), ok: !!ok })); } catch (e) { }
    }

    function chunks(s, size) {
        var out = [];
        for (var i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
        return out;
    }

    // ==================== ДИАГНОСТИКА ====================
    //
    // Что вышло с карточками — строкой «Smart Hub» в «Об устройстве» (app.js:
    // renderDeviceInfo). Помним и между запусками: отправка бывает раз в 10 минут

    function readStatus() {
        try { return JSON.parse(localStorage.getItem(STATUS_KEY) || 'null'); } catch (e) { return null; }
    }

    function setStatus(text) {
        log(text);
        try { localStorage.setItem(STATUS_KEY, JSON.stringify({ text: text, at: Date.now() })); } catch (e) { }
        // Перерисовываем «Об устройстве», только если он сейчас открыт
        var box = document.getElementById('device-info');
        if (box && box.offsetParent && typeof window.renderDeviceInfo === 'function') {
            try { window.renderDeviceInfo(); } catch (e) { }
        }
    }

    function hhmm(t) {
        var d = new Date(t);
        return d.getDate() + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + ' ' +
            d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
    }

    function statusText() {
        var s = readStatus();
        if (!s) return 'ещё не отмечались';
        return s.text + ' (' + hhmm(s.at) + ')';
    }

    // Ответ службы: что сказал Smart Hub (preview/service.js шлёт его на этот
    // порт). Без него «передано службе» ничего не значит
    var pending = null;     // {json, h, tiles, timer} — ждём ответа службы

    (function listenService() {
        try {
            var port = tizen.messageport.requestLocalMessagePort(STATUS_PORT);
            port.addMessagePortListener(function (data) {
                var r = {};
                for (var i = 0; i < (data || []).length; i++) r[data[i].key] = data[i].value;
                // Служба получила карточки и зовёт Smart Hub — итог следом
                if (r.result === 'started') {
                    setStatus('служба получила карточки, жду ответ Smart Hub…');
                    return;
                }
                var p = pending;
                pending = null;
                if (p) clearTimeout(p.timer);
                if (r.result === 'ok') {
                    if (p) writeSent(p.h, true);
                    setStatus('Smart Hub принял карточки' + (p ? ': ' + p.tiles + ' шт.' : '') + ' (через службу)');
                    return;
                }
                var why = 'служба: ' + (r.message || r.result || 'ошибка');
                if (p) directSet(p.json, p.h, p.tiles, why); else setStatus(why);
            });
        } catch (e) {
            log('messageport: ' + e.message);
        }
    })();

    /**
     * Запасной путь — тот же вызов из самой страницы (webapis.js подключает
     * запускалка). Документация Samsung его не описывает, но и не запрещает
     */
    function directSet(json, h, tiles, why) {
        var api = window.webapis && webapis.preview;
        if (!api || typeof api.setPreviewData !== 'function') {
            setStatus(why + '; в приложении webapis.preview нет');
            return;
        }
        try {
            api.setPreviewData(json, function () {
                writeSent(h, true);
                setStatus('Smart Hub принял карточки: ' + tiles + ' шт. (из приложения; ' + why + ')');
            }, function (e) {
                setStatus(why + '; из приложения: ' + ((e && (e.message || e.name)) || 'ошибка'));
            });
        } catch (e) {
            setStatus(why + '; из приложения: ' + e.message);
        }
    }

    function sendToService(json, h, tiles) {
        writeSent(h, false);
        if (!serviceSupported()) return directSet(json, h, tiles, 'веб-служб на ТВ нет');
        try {
            var ctrl = new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/pick', null, null, null, [
                new tizen.ApplicationControlData('caller', ['ForegroundApp']),
                new tizen.ApplicationControlData('preview', chunks(json, 4000))
            ]);
            tizen.application.launchAppControl(ctrl, SERVICE_ID, function () {
                setStatus('передано службе: ' + tiles + ' шт., жду ответ…');
                if (pending) clearTimeout(pending.timer);
                pending = { json: json, h: h, tiles: tiles };
                pending.timer = setTimeout(function () {
                    var p = pending;
                    pending = null;
                    if (p) directSet(p.json, p.h, p.tiles, 'служба запустилась, но не ответила за ' + (REPLY_MS / 1000) + ' с');
                }, REPLY_MS);
            }, function (e) {
                directSet(json, h, tiles, 'служба не запустилась: ' + ((e && (e.message || e.name)) || 'ошибка'));
            });
        } catch (e) {
            directSet(json, h, tiles, 'служба не запустилась: ' + e.message);
        }
    }

    var updating = false, retryTimer = null;

    function countTiles(data) {
        var n = 0;
        for (var i = 0; i < data.sections.length; i++) n += data.sections[i].tiles.length;
        return n;
    }

    function update() {
        if (updating) return;
        // В плеере службу не трогаем: запуск приложения поверх AVPlay — лишний риск
        if (window.AppState && AppState.currentScreen === 'player') return;
        updating = true;
        buildPreview().then(function (data) {
            updating = false;
            if (!data) { setStatus('карточек нет: ряды пустые'); return; }
            var json = JSON.stringify(data);
            var h = hashOf(json);
            var sent = readSent();
            var since = Date.now() - (sent.at || 0);
            // Те же карточки, и Smart Hub их принял, — повторять незачем
            if (sent.ok && sent.h === h && since < REPEAT_MS) return;
            if (since < MIN_INTERVAL_MS) {
                // Рано: Samsung молча потеряет вызов
                if (!retryTimer) retryTimer = setTimeout(function () { retryTimer = null; update(); }, MIN_INTERVAL_MS - since + 1000);
                return;
            }
            sendToService(json, h, countTiles(data));
        }, function (e) {
            updating = false;
            setStatus('не собрал карточки: ' + (e && e.message));
        });
    }

    /** Ждём ряды главной (не дольше ~60 с), потом — update */
    function startWhenReady() {
        var tries = 0;
        (function wait() {
            var hs = window.HomeScreen && HomeScreen.state;
            var homeReady = hs && hs.built;
            if (!homeReady && ++tries < 60) { setTimeout(wait, 1000); return; }
            setTimeout(update, FIRST_DELAY_MS);
            setInterval(update, CHECK_MS);
        })();
    }

    // ==================== ОТМЕТКА ДЛЯ endpoint_URL ====================

    function serverHost() {
        var m = String(serverUrl()).match(/^https?:\/\/([^\/:?#]+)/i);
        return m ? m[1].toLowerCase() : '';
    }

    function register() {
        var host = serverHost();
        // Smart Hub берёт карточки с torrstream.online: на своём сервере
        // отмечаться без толку — у torrstream.online нет его истории
        if (host !== PREVIEW_HOST && host !== 'www.' + PREVIEW_HOST) {
            setStatus('карточки Smart Hub — только с сервером ' + PREVIEW_HOST + ' (здесь ' + (host || '?') + ')');
            return;
        }
        var url = serverUrl() + '/api/smarthub/register';
        if (typeof window.withClientId === 'function') url = window.withClientId(url);
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
            .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
            .then(function (d) {
                setStatus('сервер запомнил этот ТВ' + (d && d.ip ? ' (' + d.ip + ')' : '') +
                    ', карточки Smart Hub берёт сам раз в 10 минут');
            }, function (e) {
                setStatus('сервер не запомнил ТВ: ' + ((e && e.message) || 'ошибка'));
            });
    }

    /** Есть ли в пакете старая служба карточек (TorrStream-Tizen до 1.2.0) */
    function hasLegacyService(cb) {
        // getAppInfo чужого/несуществующего id бросает NotFoundError
        var found = false;
        try { found = !!tizen.application.getAppInfo(SERVICE_ID); } catch (e) { }
        cb(found);
    }

    // ==================== НАЖАТИЕ НА КАРТОЧКУ ====================

    /** action_data карточки из запроса запуска: PAYLOAD → {"values": "<action_data>"} */
    function payloadCard() {
        try {
            var req = tizen.application.getCurrentApplication().getRequestedAppControl();
            var data = (req && req.appControl && req.appControl.data) || [];
            for (var i = 0; i < data.length; i++) {
                if (data[i].key !== 'PAYLOAD' || !data[i].value || !data[i].value.length) continue;
                var values = JSON.parse(data[i].value[0]).values;
                return typeof values === 'string' ? JSON.parse(values) : values;
            }
        } catch (e) {
            log('PAYLOAD: ' + e.message);
        }
        return null;
    }

    /**
     * Карточка поверх главной — тот же путь, что у карточки канала Android
     * (MainActivity.openCardOverHome). Раздача — карточкой торрента по хешу,
     * не нашли её — карточкой фильма TMDB.
     */
    function openCard(raw) {
        if (!raw) return;
        var c = {
            id: raw.id ? String(raw.id) : '',
            hash: TORRENT_HASH.test(String(raw.hash || '').toLowerCase()) ? String(raw.hash).toLowerCase() : '',
            media_type: raw.media_type === 'tv' ? 'tv' : 'movie',
            title: String(raw.title || ''),
            poster: raw.poster ? String(raw.poster) : null
        };
        if (!c.id && !c.hash) return;
        log('открываю ' + c.title);
        var readyTries = 0, rowsTries = 0, listTries = 0, playerTries = 0;

        function ready() {
            return window.HomeScreen && window.Nav && window.AppState &&
                typeof window.showCatalogDetail === 'function' &&
                (!c.hash || typeof window.showDetail === 'function');
        }
        function findTorrent() {
            var l = AppState.torrents || [];
            for (var i = 0; i < l.length; i++) if (l[i].hash && l[i].hash.toLowerCase() === c.hash) return l[i];
            return null;
        }
        function openTmdb() {
            if (!c.id) return;
            var item = { id: c.id, media_type: c.media_type, title: c.title, name: c.title,
                poster_path: c.poster, torrent: [{ name: c.title }] };
            Nav.push('detail', Nav.detailData(item, 0));
            AppState.catalogIndex = 0;
            AppState.androidBackCatalog = item;
            AppState.catalogPu = null;
            AppState.openInRow = true;
            window.showCatalogDetail(item, 0, null);
        }
        function open() {
            if (!ready()) { if (++readyTries < 150) setTimeout(open, 200); return; }
            // Приложение будили из плеера — сначала выходим из него
            if (AppState.currentScreen === 'player') {
                if (playerTries++ === 0 && typeof window.showDetailView === 'function') window.showDetailView();
                if (playerTries < 25) { setTimeout(open, 200); return; }
            }
            // Ждём ряды главной (до ~15 с): на неё и вернёт «Назад»
            var st = HomeScreen.state;
            if (st && !st.built && ++rowsTries < 75) { setTimeout(open, 200); return; }
            if (c.hash && !AppState.torrentsLoaded && ++listTries < 75) { setTimeout(open, 200); return; }
            try {
                if (AppState.currentScreen === 'search' && typeof window.hideSearchResults === 'function') {
                    window.hideSearchResults({ returnTo: 'home' });
                }
            } catch (e) { }
            if (AppState.currentScreen !== 'home' && AppState.currentScreen !== 'detail') HomeScreen.show({ restoreFocus: false });
            Nav.reset('home');
            if (typeof HomeScreen.stopTrailer === 'function') HomeScreen.stopTrailer();
            if (window.Screensaver && typeof Screensaver.hide === 'function') Screensaver.hide();
            if (!c.hash) return openTmdb();
            var t = findTorrent();
            if (t) return window.showDetail(t);
            // Раздачу могли добавить после загрузки списка — перечитываем его один раз
            if (typeof window.refreshTorrentsList !== 'function') return openTmdb();
            window.refreshTorrentsList().then(function () {
                var t2 = findTorrent();
                if (t2) window.showDetail(t2); else openTmdb();
            }, openTmdb);
        }
        open();
    }

    // Запущенное приложение будит карточка Smart Hub (reload="disable" в config.xml)
    window.addEventListener('appcontrol', function () { openCard(payloadCard()); });

    // Холодный запуск карточкой. Запрос запуска живёт всю жизнь приложения, а
    // фронтенд перезагружает страницу (location.reload) — открываем один раз
    var cold = false;
    try { cold = !sessionStorage.getItem(COLD_KEY); sessionStorage.setItem(COLD_KEY, '1'); } catch (e) { }
    if (cold) openCard(payloadCard());

    hasLegacyService(function (legacy) {
        if (legacy) {
            startWhenReady();
            return;
        }
        setTimeout(register, REGISTER_DELAY_MS);
        setInterval(register, REGISTER_MS);
        // Вошли в учётку или вышли — Smart Hub должен показывать новую историю
        window.addEventListener('storage', function (e) { if (e && e.key === 'clientId') register(); });
    });

    window.TizenPreview = {
        update: update,
        register: register,
        build: buildPreview,
        open: openCard,
        statusText: statusText,
        // Отправить сейчас, без проверки «не изменились» (для отладки)
        force: function () { try { localStorage.removeItem(SENT_KEY); } catch (e) { } update(); }
    };
})();
