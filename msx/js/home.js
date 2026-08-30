// home.js — главная страница в стиле Netflix.
//
// Раскладка: во всю ширину баннер (широкий постер с названием, описанием и
// кнопкой «Смотреть»), а внизу — ОДИН ряд подборки. Стрелки вверх/вниз меняют
// именно ряд: прочие ряды лежат в DOM с display:none (класс home-row-hidden),
// поэтому на экране всегда ровно один. Баннер уходит под #home-topbar (шапка
// нарисована поверх его верхнего края собственным градиентом).
//
// Пока фокус стоит на карточке, в правом нижнем углу баннера заполняется
// кругляшок; заполнился — вместо картинки включается трейлер с RuTube (если
// он нашёлся). Поиск трейлера — fetchRutubeTrailer из catalog.js, проигрывание
// повторяет startTrailerBackground/stopTrailerBackground оттуда же, но своим
// видео внутри баннера: те функции жёстко привязаны к #detail-view и трогают
// AppState.trailerPlay, по которому control.js разбирает «назад» в детальном
// просмотре.
//
// Отдельный модуль: собственные ряды, собственные наблюдатели, собственная база
// в IndexedDB. С каталогом (catalog.js) делим только CSS-классы разметки
// (.catalog-row*, .catalog-row-card) и детальный просмотр — всё состояние своё,
// иначе переключение «Главная ↔ Каталог» перетирало бы ряды друг друга.
//
// Данные берём с TMDB через свой сервер: зеркало tsapi.hnar.online отвечает 302
// на другие хосты, а на редиректе нет Access-Control-Allow-*, поэтому из браузера
// телевизора запрос не проходит. Эндпоинт — GET /api/tmdb/collection?preset=...
// (routes/tmdb.js), он же держит серверный кэш на те же 3 дня.
//
// Всё, кроме истории просмотра, лежит в IndexedDB и обновляется раз в 3 дня:
// открытие главной на прогретом устройстве не делает ни одного запроса к TMDB.
// История — всегда живой GET /api/history, её кэшировать нельзя.
(function () {
    'use strict';

    // ==================== КОНСТАНТЫ ====================
    var HOME = {
        // Горизонт кэша подборок. Совпадает с COLLECTION_CACHE_TTL_MS на сервере.
        TTL_MS: 3 * 24 * 60 * 60 * 1000,
        // Пауза между «ряды в DOM» и «фокус на карточке»: столько же, сколько
        // CATALOG_CONSTANTS.FOCUS_DELAY_MS у каталога
        FOCUS_DELAY_MS: 100,
        POSTER_CONCURRENCY: 10,
        MAX_PARALLEL_ROW_LOADS: 3,
        FETCH_TIMEOUT_MS: 10000,
        ITEMS_PER_ROW: 20,
        // Ряд вне экрана — display:none. У каталога для этого visibility:hidden
        // (catalog-offscreen), но там ряды остаются на своих местах в потоке,
        // а здесь скрытый ряд не должен занимать высоту вовсе.
        HIDDEN_ROW_CLASS: 'home-row-hidden',

        // --- баннер и раскладка ---
        // Доля свободной высоты под ряд; остальное достаётся баннеру
        ROW_SHARE: 0.48,
        HERO_MIN_H: 190,
        // Нижний отступ #torrserver-section: на него ряд не должен наезжать
        BOTTOM_PAD_PX: 16,
        // Заголовок ряда + вертикальные padding'и трека, если замерить не вышло
        ROW_CHROME_FALLBACK_PX: 72,
        CARD_ASPECT: 460 / 260,      // те же пропорции, что у карточки ряда каталога
        CARD_MIN_W: 84,
        CARD_MAX_W: 240,
        // Пока фокус пробегает ряд, баннер не дёргаем на каждой карточке
        HERO_DEBOUNCE_MS: 260,
        // Столько кадр нового элемента может грузиться, не гася прежний. Не
        // пришёл — показываем подложку: кадр предыдущего фильма под новым
        // названием выглядит как баг (им и был).
        BACKDROP_GRACE_MS: 1200,
        // Сколько зеркал TMDB пробуем на один путь: первое + следующие по кругу.
        // Всех пяти не берём — кандидатов и так два набора (кадр и постер).
        BACKDROP_MIRROR_TRIES: 3,
        // Столько заполняется кругляшок; заполнился — включаем трейлер
        TRAILER_DELAY_MS: 5000,
        // Длина окружности кругляшка: 2πr при r = 19 (см. viewBox 0 0 44 44)
        RING_LEN: 119.4,
        // Как часто проверять, что играющий трейлер всё ещё «свой» и на экране
        WATCHDOG_MS: 1000,
        // Постеры соседних рядов подтягиваем заранее, но не мешая текущему
        PREFETCH_DELAY_MS: 700,

        // --- мышь и палец (см. раздел «ЖЕСТЫ») ---
        // Сколько «прокрутить» колесом, чтобы сменить подборку. Одна засечка
        // мыши — это уже 100 (у тачпада бывает 3-5), так что берём меньше.
        WHEEL_STEP_PX: 40,
        // Свайп: шаг за каждые столько пикселей пальца по вертикали
        SWIPE_STEP_PX: 60,
        // До этого порога направление свайпа не определено — столько же, сколько
        // TOUCH_AXIS_THRESHOLD у горизонтального драга рядов (control.js)
        SWIPE_AXIS_PX: 10,
        // Плавный тачпад присылает десятки событий подряд, а быстрый свайп
        // пальцем — сотни пикселей: не больше одной смены подборки за это время
        GESTURE_COOLDOWN_MS: 260,
        // Мышь у края ряда: пауза между шагами и длительность самого твина.
        // Твин чуть короче паузы, чтобы ряд успевал доехать и вставал ровно
        // по карточке, а не догонялся следующим шагом из середины пути.
        HOVER_SCROLL_MS: 320,
        HOVER_SCROLL_SEC: 0.3
    };

    // Эндпоинт модуля подборок Кинопоиска (kinopoisk-collections)
    var KP_ENDPOINT = '/api/kinopoisk/collection';

    // Порядок рядов сверху вниз. key для подборок TMDB — это preset эндпоинта.
    var HOME_ROWS = [
        { key: 'history', name: 'Продолжить просмотр', source: 'history' },
        { key: 'trending_week', name: 'В тренде на этой неделе', source: 'tmdb' },
        { key: 'pop_streaming', name: 'Что популярно · Онлайн', source: 'tmdb' },
        { key: 'pop_ontv', name: 'Что популярно · По ТВ', source: 'tmdb' },
        { key: 'pop_rent', name: 'Что популярно · Напрокат', source: 'tmdb' },
        { key: 'pop_theatres', name: 'Что популярно · В кинотеатрах', source: 'tmdb' },
        { key: 'top_movies', name: 'Топ рейтинга: фильмы', source: 'tmdb' },
        { key: 'top_tv', name: 'Топ рейтинга: сериалы', source: 'tmdb' },
        { key: 'popular_movies', name: 'Популярные фильмы', source: 'tmdb' },
        { key: 'popular_tv', name: 'Популярные сериалы', source: 'tmdb' },
        // Подборки Кинопоиска. Их отдаёт модуль kinopoisk-collections
        // (module-loader), поэтому у них свой endpoint вместо /api/tmdb/collection.
        // Формат ответа тот же, так что дальше по коду они ничем не отличаются
        // от остальных подборок. Названия и состав дублируют COLLECTIONS в модуле —
        // при правке менять в обоих местах.
        // Порядок здесь = порядок рядов на экране; лишний ряд убирается одной строкой.
        { key: 'kp_popular', name: 'Кинопоиск · Популярное', source: 'tmdb', endpoint: KP_ENDPOINT },
        { key: 'kp_pop_movies', name: 'Кинопоиск · Популярные фильмы', source: 'tmdb', endpoint: KP_ENDPOINT },
        { key: 'kp_pop_series', name: 'Кинопоиск · Популярные сериалы', source: 'tmdb', endpoint: KP_ENDPOINT },
        { key: 'kp_top250', name: 'Кинопоиск · Топ 250 фильмов', source: 'tmdb', endpoint: KP_ENDPOINT },
        { key: 'kp_top250_tv', name: 'Кинопоиск · Топ 250 сериалов', source: 'tmdb', endpoint: KP_ENDPOINT },
        { key: 'kp_releases', name: 'Кинопоиск · Скоро в кино', source: 'tmdb', endpoint: KP_ENDPOINT },
        { key: 'kp_family', name: 'Кинопоиск · Семейное', source: 'tmdb', endpoint: KP_ENDPOINT },
        { key: 'kp_comics', name: 'Кинопоиск · Комиксы', source: 'tmdb', endpoint: KP_ENDPOINT },
        { key: 'kp_love', name: 'Кинопоиск · Про любовь', source: 'tmdb', endpoint: KP_ENDPOINT },
        { key: 'kp_zombie', name: 'Кинопоиск · Про зомби', source: 'tmdb', endpoint: KP_ENDPOINT },
        { key: 'kp_vampire', name: 'Кинопоиск · Про вампиров', source: 'tmdb', endpoint: KP_ENDPOINT },
        { key: 'kp_disaster', name: 'Кинопоиск · Катастрофы', source: 'tmdb', endpoint: KP_ENDPOINT },
        { key: 'kp_kids', name: 'Кинопоиск · Мультфильмы детям', source: 'tmdb', endpoint: KP_ENDPOINT },
        { key: 'kp_oscar', name: 'Кинопоиск · Оскар 2021', source: 'tmdb', endpoint: KP_ENDPOINT }
    ];

    // Кнопки общей шапки #home-topbar в порядке DOM — по нему ходит навигация
    // влево/вправо. Это те же самые элементы, что и вкладки разделов
    // (#tab-*, #settings-btn): свои обработчики у них уже есть, новая тут
    // только «Главная» (#home-nav-home).
    var NAV_BUTTONS = ['home-nav-home', 'tab-catalog', 'tab-torrents',
        'tab-donate', 'tab-search', 'settings-btn'];

    var homeState = {
        built: false,            // ряды собраны и лежат в DOM
        loading: false,
        activated: false,        // фокус уже уехал на карточку → постеры можно грузить
        rows: [],                // [[card, ...], ...] в порядке показа
        rowEls: [],              // сами <section class="catalog-row"> по тому же индексу
        rowKeys: [],             // ключ ряда по его индексу в rows
        rowCols: [],             // на какой карточке стояли в каждом ряду
        activeRow: 0,            // единственный показанный ряд
        data: {},                // key → items
        lastRowKey: null,        // куда вернуть фокус (возврат из detail/поиска)
        lastColIndex: 0,
        lastNavBtnId: 'home-nav-home',
        posterQueue: [],
        activePosterLoads: 0,
        prefetchTimer: null,
        resizeTimer: null,
        cardWidth: 0,            // текущая ширина карточки (её же держит <style>)
        detailFromHome: false,
        heroDetails: {},         // id_mediaType → полные детали TMDB
        hero: {
            key: null,           // id_mediaType показанного элемента
            pendingKey: null,    // то же для элемента, ждущего в дебаунсе
            item: null,
            timer: null,         // дебаунс смены баннера
            ringTimer: null,     // «кругляшок заполнился»
            ringDone: false,
            gen: 0,              // поколение: гасит ответы по устаревшему элементу
            backdropUrl: null,
            trailerUrl: null,
            trailerSearched: false,
            video: null,
            hls: null,
            watchdog: null        // «главная ещё на экране?» пока играет трейлер
        }
    };

    // ==================== МЕЛКИЕ ХЕЛПЕРЫ ====================

    function el(id) { return document.getElementById(id); }

    function serverUrl() {
        return (window.SERVER_URL || window.location.origin);
    }

    function esc(s) {
        if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
        return s ? String(s).replace(/[&<>]/g, function (m) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m];
        }) : '';
    }

    function ratingColor(r) {
        if (typeof window.getRatingColor === 'function') return window.getRatingColor(r);
        return r >= 8 ? '#4caf50' : r >= 6 ? '#ffc107' : r >= 4 ? '#ff9800' : '#f44336';
    }

    function itemTitle(item) {
        return (item && (item.title || item.name)) || 'Без названия';
    }

    function itemYear(item) {
        var r = (item && (item.release_date || item.first_air_date)) || '';
        var m = String(r).match(/(19|20)\d{2}/);
        return m ? m[0] : null;
    }

    function posterSize() {
        return (typeof window.getPosterCardSize === 'function')
            ? window.getPosterCardSize() : 'w342';
    }

    // Зеркала постеров выбирает catalog.js (детерминированно по пути картинки,
    // чтобы работал HTTP-кэш браузера). Свой список тут не держим.
    function tmdbImage(path, size) {
        if (!path) return '';
        if (typeof window.getTmdbImageUrl === 'function') {
            return window.getTmdbImageUrl(path, size);
        }
        var p = String(path);
        if (/^https?:\/\//i.test(p)) return p;
        if (p.charAt(0) !== '/') p = '/' + p;
        return 'https://tsimg.hnar.online/t/p/' + size + p;
    }

    function posterUrlFor(path) { return tmdbImage(path, posterSize()); }
    function backdropUrlFor(path) { return tmdbImage(path, 'w1280'); }

    function invalidateFocus() {
        if (typeof window.invalidateFocusCache === 'function') window.invalidateFocusCache();
    }

    /**
     * Главная не прокручивается: баннер и ряд рассчитаны ровно на высоту экрана.
     * Позицию всё равно держим в нуле — showContentScreen('home') при возврате
     * восстанавливает AppState.contentScroll.home (app.js).
     */
    function scrollHomeToTop() {
        var mc = el('main-container');
        if (mc && isHomeVisible()) mc.scrollTop = 0;
        if (window.AppState) {
            AppState.contentScroll = AppState.contentScroll || {};
            AppState.contentScroll.home = 0;
        }
    }

    /** Главная смонтирована и видна (шапка + баннер + ряд на экране) */
    function isHomeVisible() {
        var screen = el('content-home');
        if (!screen || screen.hidden) return false;
        var section = el('torrserver-section');
        if (section && section.style.display === 'none') return false;
        return true;
    }

    /** Главная не только видна, но и владеет фокусом (сверху нет оверлеев) */
    function isHomeFocusable() {
        if (playerBusy()) return false;
        return isHomeVisible() && !!(window.AppState && AppState.currentScreen === 'home');
    }

    /**
     * Плеер уже в кадре или вот-вот в нём окажется. Проверок три, потому что путь
     * «Смотреть → поиск → воспроизведение» проходит через hideSearchResults
     * (torrents.js:3495): тот возвращает главную на экран и заводит отсчёт
     * кругляшка, а #torrserver-section плеер погасит только после запроса
     * метаданных — то есть через секунды. Без этой проверки в тот зазор успевал
     * запуститься трейлер и потом играл звуком поверх фильма.
     */
    function playerBusy() {
        if (window.AppState && AppState.currentScreen === 'player') return true;
        var overlay = el('playback-overlay');
        if (overlay && overlay.classList.contains('active')) return true;
        // #player-screen — position: fixed, offsetParent у него null и в
        // показанном виде. Смотрим на инлайновый display: в разметке он
        // 'none', плеер ставит 'block' (transitionToPlayerScreen), а базовое
        // правило в CSS всё равно display: none — то есть пустая строка тоже
        // означает «скрыт». Вычисленные стили тут не читаем: playerBusy зовётся
        // на каждое перемещение фокуса.
        var screen = el('player-screen');
        if (screen && screen.style.display && screen.style.display !== 'none') return true;
        return false;
    }

    /**
     * Заглушка загрузчика модулей (#module-loader в index.html) снимается по
     * первому показанному ряду — dismissModuleLoader ниже. Пока она на экране,
     * пользователь ничего не выбирал, и трейлер под ней играл бы звуком в
     * пустоту. Проверка страхует порядок: он зависит от сети.
     */
    function moduleLoaderUp() {
        var l = el('module-loader');
        if (!l) return false;
        // position: fixed, offsetParent === null и у показанного элемента (та же
        // история, что с #player-screen выше), поэтому смотрим на инлайновые
        // стили, которыми загрузчик и гасят. Про opacity важно: display: none
        // ставится только по концу перехода, то есть на 400 мс позже — за этот
        // зазор как раз успевает встать фокус на первую карточку.
        return l.style.display !== 'none' && l.style.opacity !== '0';
    }

    /**
     * Галка «Автовоспроизведение трейлеров» в UI Customizer. Спрашиваем каждый
     * раз, а не кэшируем: настройку переключают на живой странице. Нет самого
     * кастомайзера (старая копия на зеркале) — считаем, что включено.
     */
    function heroTrailersOn() {
        try {
            if (window.UICustomizer && typeof UICustomizer.getHeroTrailers === 'function') {
                return UICustomizer.getHeroTrailers();
            }
        } catch (e) { }
        return true;
    }

    /**
     * Раньше загрузчик ждал window.load, а тот наступает после ВСЕХ картинок и
     * шрифтов — на телевизоре это секунды спиннера поверх уже готовой главной.
     * Снимаем сами, как только первый ряд на экране: это и есть момент, когда
     * приложением можно пользоваться. Функцию определяет index.html до загрузки
     * модулей; ветка с display — на случай разметки без неё.
     */
    function dismissModuleLoader() {
        if (typeof window.hideModuleLoader === 'function') {
            window.hideModuleLoader();
            return;
        }
        var l = el('module-loader');
        if (l) l.style.display = 'none';
    }

    function homeFetch(url) {
        return new Promise(function (resolve) {
            var ctrl = null;
            try { ctrl = new AbortController(); } catch (e) { ctrl = null; }
            var timer = setTimeout(function () {
                if (ctrl) { try { ctrl.abort(); } catch (e) { } }
            }, HOME.FETCH_TIMEOUT_MS);
            fetch(url, ctrl ? { signal: ctrl.signal } : {})
                .then(function (r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.json();
                })
                .then(function (d) { clearTimeout(timer); resolve(d); })
                .catch(function (e) {
                    clearTimeout(timer);
                    console.warn('🏠 Запрос не удался:', url, e && e.message);
                    resolve(null);
                });
        });
    }

    // ==================== IndexedDB: HomeCacheDB ====================
    //
    // Своя база, а не PosterCacheDB из poster-db.js: там свои версии и миграции,
    // поднимать их из чужого модуля нельзя. Store один — collections,
    // запись {key, items, ts, v}.
    var DB_NAME = 'HomeCacheDB';
    var DB_VERSION = 1;
    var DB_STORE = 'collections';
    // Версия проекции подборки. Записи первой версии лежат без backdrop_path и
    // overview — баннеру они не годятся, поэтому считаем их просроченными.
    var ITEMS_SCHEMA_VERSION = 2;
    var dbPromise = null;

    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise(function (resolve) {
            if (!window.indexedDB) { resolve(null); return; }
            var req;
            try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { resolve(null); return; }
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(DB_STORE)) {
                    db.createObjectStore(DB_STORE, { keyPath: 'key' });
                }
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () {
                console.warn('🏠 IndexedDB недоступна:', req.error && req.error.message);
                resolve(null);
            };
            req.onblocked = function () { resolve(null); };
        });
        return dbPromise;
    }

    function dbGet(key) {
        return openDb().then(function (db) {
            if (!db) return null;
            return new Promise(function (resolve) {
                try {
                    var rq = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
                    rq.onsuccess = function () { resolve(rq.result || null); };
                    rq.onerror = function () { resolve(null); };
                } catch (e) { resolve(null); }
            });
        });
    }

    function dbPut(key, items) {
        return openDb().then(function (db) {
            if (!db) return;
            return new Promise(function (resolve) {
                try {
                    var tx = db.transaction(DB_STORE, 'readwrite');
                    tx.objectStore(DB_STORE).put({
                        key: key, items: items, ts: Date.now(), v: ITEMS_SCHEMA_VERSION
                    });
                    tx.oncomplete = function () { resolve(); };
                    tx.onerror = function () { resolve(); };
                    tx.onabort = function () { resolve(); };
                } catch (e) { resolve(); }
            });
        });
    }

    function dbClear() {
        return openDb().then(function (db) {
            if (!db) return;
            return new Promise(function (resolve) {
                try {
                    var tx = db.transaction(DB_STORE, 'readwrite');
                    tx.objectStore(DB_STORE).clear();
                    tx.oncomplete = function () { resolve(); };
                    tx.onerror = function () { resolve(); };
                    tx.onabort = function () { resolve(); };
                } catch (e) { resolve(); }
            });
        });
    }

    // ==================== ДАННЫЕ РЯДОВ ====================

    function loadHistoryItems() {
        return homeFetch(serverUrl() + '/api/history').then(function (data) {
            if (!data || !data.success || !data.history || !data.history.length) return [];
            return data.history.slice(0, HOME.ITEMS_PER_ROW).map(function (it) {
                // В истории путь постера лежит без ведущего слэша (или уже полным
                // URL) — приводим к тому виду, который ждёт getTmdbImageUrl
                var pp = it.posterPath;
                if (pp && pp.indexOf('http') !== 0) pp = (pp.charAt(0) === '/' ? pp : '/' + pp);
                return {
                    id: it.tmdbId,
                    title: it.title,
                    name: it.title,
                    media_type: it.mediaType,
                    poster_path: pp,
                    vote_average: null,
                    isHistoryItem: true
                };
            });
        });
    }

    /**
     * Свежая запись в IndexedDB → сеть не трогаем вообще.
     * Записи нет, ей больше 3 дней или она от прошлой версии проекции (нет полей
     * баннера) → запрос к серверу и перезапись.
     * Сеть молчит → рисуем что было; и этого нет — ряд не показываем.
     */
    function loadCollectionItems(cfg) {
        return dbGet(cfg.key).then(function (rec) {
            var fresh = rec && rec.items && rec.items.length &&
                rec.v === ITEMS_SCHEMA_VERSION &&
                (Date.now() - (rec.ts || 0)) < HOME.TTL_MS;
            if (fresh) return rec.items;

            // endpoint задают ряды из модулей (см. HOME_ROWS); у штатных подборок
            // его нет, и берётся серверный /api/tmdb/collection
            var endpoint = cfg.endpoint || '/api/tmdb/collection';
            return homeFetch(serverUrl() + endpoint + '?preset=' +
                encodeURIComponent(cfg.key)).then(function (data) {
                    if (data && data.success && data.items && data.items.length) {
                        // Запись в IndexedDB не блокирует показ ряда
                        dbPut(cfg.key, data.items);
                        return data.items;
                    }
                    if (rec && rec.items && rec.items.length) {
                        console.warn('🏠 Подборка ' + cfg.key + ': сеть недоступна, берём старый кэш');
                        return rec.items;
                    }
                    return [];
                });
        });
    }

    function loadRowItems(cfg) {
        if (cfg.source === 'history') return loadHistoryItems();
        return loadCollectionItems(cfg);
    }

    // ==================== БАННЕР: РАЗМЕТКА ====================

    function heroKey(item) {
        if (!item || item.id == null) return null;
        return String(item.id) + '_' + (item.media_type || 'movie');
    }

    function ensureHeroDom() {
        var hero = el('home-hero');
        if (hero) return hero;
        var screen = el('content-home');
        if (!screen) return null;

        hero = document.createElement('section');
        hero.id = 'home-hero';
        hero.innerHTML =
            '<div id="home-hero-media">' +
            '<div id="home-hero-backdrop" class="home-hero-empty"></div>' +
            '</div>' +
            '<div id="home-hero-shade"></div>' +
            // Кругляшок в правом нижнем углу постера: заполнился — вместо
            // картинки пойдёт трейлер. conic-gradient на Vidaa (Chrome 66) не
            // работает, поэтому дуга рисуется SVG через stroke-dashoffset,
            // а поворот на -90° задан атрибутом transform (у CSS-трансформа на
            // SVG-элементе там другая точка отсчёта).
            '<div class="home-hero-ring" id="home-hero-ring" hidden>' +
            '<svg viewBox="0 0 44 44">' +
            '<circle class="home-ring-track" cx="22" cy="22" r="19"></circle>' +
            '<circle class="home-ring-bar" cx="22" cy="22" r="19" transform="rotate(-90 22 22)"></circle>' +
            '</svg>' +
            '<div class="home-ring-icon">▶</div>' +
            '</div>' +
            '<div id="home-hero-body">' +
            '<h1 id="home-hero-title"></h1>' +
            '<div id="home-hero-meta"></div>' +
            '<div id="home-hero-overview"></div>' +
            // «Подробнее» тут намеренно нет: карточка открывается OK прямо с ряда
            '<button type="button" class="home-hero-btn" id="home-play-btn" hidden>' +
            '<span class="home-hero-btn-icon">▶</span>Смотреть</button>' +
            '</div>';

        var rows = el('home-rows');
        if (rows) screen.insertBefore(hero, rows);
        else screen.appendChild(hero);

        hero.addEventListener('click', function (e) {
            if (!e.target.closest) return;
            if (e.target.closest('#home-play-btn')) playHeroItem();
        });
        return hero;
    }

    function heroMetaText(item, details) {
        var src = details || item || {};
        var mt = (item && item.media_type) === 'tv' ? 'tv' : 'movie';
        var parts = [];
        parts.push(mt === 'tv' ? 'Сериал' : 'Фильм');
        var year = itemYear(src) || itemYear(item);
        if (year) parts.push(year);
        var rating = Number(src.vote_average || (item && item.vote_average));
        if (rating > 0) parts.push('★ ' + (Math.round(rating * 10) / 10));
        // media_type подставляем сами: у деталей TMDB его нет (там поле type), а
        // getNormalizedCatalogGenres по нему выбирает карту жанров фильмов или
        // сериалов — иначе часть id сериалов не расшифруется
        var genres = (typeof window.getNormalizedCatalogGenres === 'function')
            ? window.getNormalizedCatalogGenres({
                media_type: mt, genres: src.genres,
                genre_ids: src.genre_ids || (item && item.genre_ids)
            }) : [];
        if (genres.length) parts.push(genres.slice(0, 2).join(', '));
        return parts.join('  •  ');
    }

    // Поколение загрузки кадра: сменился элемент баннера — ответы прошлой
    // цепочки (у неё несколько попыток) должны молча уйти в никуда
    var backdropLoad = 0;
    var backdropTimer = null;
    // Цепочка добралась до конца, а показать было нечего. Держим отдельно от
    // hero.backdropUrl: пока попытки идут, повторный renderHero цепочку не
    // трогает, а вот сеть моргнула и всё упало — при следующем заходе на этот
    // же элемент пробуем ещё раз, иначе подложка осталась бы навсегда.
    var backdropFailed = false;

    function cancelBackdropTimer() {
        if (backdropTimer) { clearTimeout(backdropTimer); backdropTimer = null; }
    }

    /**
     * Ровная тёмная подложка вместо картинки. Инлайновый background-image именно
     * снимаем: у .home-hero-empty специфичность класса, инлайн её перебивает —
     * и в баннере оставался кадр ПРОШЛОГО фильма, хотя новый не загрузился.
     */
    function clearHeroBackdrop() {
        var box = el('home-hero-backdrop');
        if (!box) return;
        box.style.removeProperty('background-image');
        box.classList.add('home-hero-empty');
    }

    /** Тот же путь на других зеркалах — по порядку обхода getTmdbNextMirrorUrl */
    function pushMirrors(out, url) {
        if (!url || out.indexOf(url) !== -1) return;
        out.push(url);
        if (typeof window.getTmdbNextMirrorUrl !== 'function') return;
        var next = url;
        // getTmdbNextMirrorUrl ходит по кругу — выходим и по повтору.
        for (var i = 0; i < HOME.BACKDROP_MIRROR_TRIES - 1; i++) {
            next = window.getTmdbNextMirrorUrl(next);
            if (!next || out.indexOf(next) !== -1) break;
            out.push(next);
        }
    }

    /**
     * Кадр баннера. url — широкий кадр, extra — постер как запас (у истории
     * просмотра backdrop'а нет вовсе). Между ними перебираем зеркала: выбор
     * зеркала детерминированный (pickMirror в catalog.js), поэтому упавший или
     * отдающий обрезанные файлы хост валит один и тот же набор картинок всегда.
     *
     * Осечка или молчание дольше BACKDROP_GRACE_MS гасят картинку в тёмную
     * подложку и переводят на следующего кандидата: иначе в баннере висел бы
     * кадр предыдущего фильма под названием нового — тот самый баг. Повезёт
     * дальше по списку — кадр появится (хоть и позже), нет — останется подложка.
     */
    function applyHeroBackdrop(url, extra) {
        var box = el('home-hero-backdrop');
        if (!box) return;

        var queue = [];
        pushMirrors(queue, url);
        pushMirrors(queue, extra);
        if (!queue.length) {
            backdropLoad++;
            cancelBackdropTimer();
            homeState.hero.backdropUrl = null;
            clearHeroBackdrop();
            return;
        }
        // Этот кадр уже запрашивали (renderHero зовётся второй раз, с деталями) —
        // не перезапускаем цепочку, пока она идёт или уже показала картинку.
        // Ключ — первый кандидат, а не удавшийся: иначе успех с запасного
        // зеркала выглядел бы как новый запрос и мигал бы подложкой.
        if (homeState.hero.backdropUrl === queue[0] && !backdropFailed) return;
        homeState.hero.backdropUrl = queue[0];
        backdropFailed = false;

        var mine = ++backdropLoad;
        var at = 0;
        var shown = false;      // кадр этого элемента уже в баннере

        // Гасим только пока показывать нечего: опоздавший ответ мог вернуть
        // годную картинку, и осечка следующего кандидата не должна её стирать.
        function fallback() {
            if (!shown) clearHeroBackdrop();
        }

        function tryNext() {
            cancelBackdropTimer();
            if (shown) return;                              // уже нашли, дальше не ищем
            if (mine !== backdropLoad) return;              // элемент успели сменить
            if (at >= queue.length) { backdropFailed = true; fallback(); return; }
            var candidate = queue[at++];
            var img = new Image();
            var settled = false;

            // Прежний кадр держим, пока грузится новый — иначе баннер мигал бы
            // подложкой на каждой карточке. Но недолго: зависший запрос (ни
            // load, ни error могут не прийти десятками секунд) иначе оставил бы
            // на экране чужую картинку. Ответ этого кандидата не отбрасываем:
            // придёт с опозданием — заменит подложку.
            backdropTimer = setTimeout(function () {
                backdropTimer = null;
                if (mine !== backdropLoad) return;
                fallback();
                tryNext();
            }, HOME.BACKDROP_GRACE_MS);

            function finish() {
                if (settled) return;
                settled = true;
                if (mine !== backdropLoad) return;
                // naturalWidth — единственная надёжная проверка: decode() на
                // части устройств отклоняет и годные картинки, а обрезанный
                // файл фоном рисуется пустотой
                if (!img.naturalWidth) { fallback(); tryNext(); return; }
                cancelBackdropTimer();
                shown = true;
                backdropFailed = false;     // мог успеть выставиться, если это опоздавший ответ
                box.style.backgroundImage = 'url("' + candidate + '")';
                box.classList.remove('home-hero-empty');
            }

            img.onerror = function () {
                if (settled) return;
                settled = true;
                if (mine !== backdropLoad) return;
                fallback();
                tryNext();
            };
            img.onload = function () {
                if (typeof img.decode === 'function') img.decode().then(finish).catch(finish);
                else finish();
            };
            img.src = candidate;
        }

        tryNext();
    }

    function renderHero(item, details) {
        var hero = ensureHeroDom();
        if (!hero) return;
        var src = details || item || {};

        var t = el('home-hero-title');
        if (t) t.textContent = itemTitle(src) !== 'Без названия' ? itemTitle(src) : itemTitle(item);
        var m = el('home-hero-meta');
        if (m) m.textContent = heroMetaText(item, details);
        var o = el('home-hero-overview');
        if (o) o.textContent = src.overview || (item && item.overview) || '';
        var btn = el('home-play-btn');
        // Кнопка появляется вместе с первым элементом баннера — до этого её нет в
        // focusableElements, и без сброса кэша фокуса control.js её не увидит
        if (btn && btn.hidden) {
            btn.hidden = false;
            invalidateFocus();
        }

        // Постер — запас на две беды: у ряда «Продолжить просмотр» широкого кадра
        // нет вовсе, а у остальных он может не отдаться ни с одного зеркала.
        // Размер тот же, что у карточки: этот файл уже лежит в кэше браузера.
        var path = src.backdrop_path || (item && item.backdrop_path);
        var poster = (src.poster_path || (item && item.poster_path)) || '';
        applyHeroBackdrop(path ? backdropUrlFor(path) : '',
            poster ? posterUrlFor(poster) : '');
    }

    // ==================== БАННЕР: СМЕНА ЭЛЕМЕНТА ====================

    /** Дебаунс: при быстром пролистывании ряда баннер меняется один раз */
    function setHeroItem(item) {
        var k = heroKey(item);
        if (!k) return;
        if (k === homeState.hero.pendingKey) return;
        homeState.hero.pendingKey = k;
        // Сам элемент запоминаем сразу, не дожидаясь отрисовки: «Смотреть» могут
        // нажать быстрее, чем истечёт дебаунс
        homeState.hero.item = item;
        if (homeState.hero.timer) clearTimeout(homeState.hero.timer);
        homeState.hero.timer = setTimeout(function () {
            homeState.hero.timer = null;
            applyHero(item);
        }, HOME.HERO_DEBOUNCE_MS);
    }

    function applyHero(item) {
        var hero = ensureHeroDom();
        if (!hero || !item) return;
        var k = heroKey(item);
        // Поколение отсекает ответы (детали, поиск трейлера) по прошлому элементу
        var gen = ++homeState.hero.gen;

        stopHeroTrailer();
        resetHeroRing();
        homeState.hero.key = k;
        homeState.hero.pendingKey = k;
        homeState.hero.item = item;
        homeState.hero.trailerUrl = null;
        homeState.hero.trailerSearched = false;

        var cached = homeState.heroDetails[k] || null;
        renderHero(item, cached);

        if (cached || (item.backdrop_path && item.overview)) {
            if (!cached) homeState.heroDetails[k] = item;
            startTrailerCountdown(item, cached || item, gen);
        } else {
            enrichHero(item, k, gen);
        }
    }

    /**
     * Подборки уже отдают backdrop_path/overview/genre_ids (routes/tmdb.js), но у
     * ряда «Продолжить просмотр» их нет — дотягиваем полными деталями TMDB.
     */
    function enrichHero(item, k, gen) {
        if (typeof window.fetchCatalogItemDetails !== 'function') {
            startTrailerCountdown(item, null, gen);
            return;
        }
        Promise.resolve(window.fetchCatalogItemDetails(item)).then(function (d) {
            if (gen !== homeState.hero.gen) return;
            if (d) {
                homeState.heroDetails[k] = d;
                renderHero(item, d);
            }
            startTrailerCountdown(item, d, gen);
        }).catch(function () {
            if (gen !== homeState.hero.gen) return;
            startTrailerCountdown(item, null, gen);
        });
    }

    // ==================== БАННЕР: КРУГЛЯШОК ====================

    function ringBar() { return document.querySelector('#home-hero-ring .home-ring-bar'); }

    function runHeroRing() {
        var ring = el('home-hero-ring');
        if (ring) ring.hidden = false;
        var bar = ringBar();
        if (!bar) return;
        bar.style.transition = 'none';
        bar.style.strokeDashoffset = HOME.RING_LEN;
        // Двойной кадр: без него сброс и запуск склеятся в один стиль и анимации
        // не будет (тот же приём, что в startTrailerBackground)
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                if (!bar.isConnected) return;
                bar.style.transition = 'stroke-dashoffset ' +
                    (HOME.TRAILER_DELAY_MS / 1000) + 's linear';
                bar.style.strokeDashoffset = '0';
            });
        });
    }

    function resetHeroRing() {
        if (homeState.hero.ringTimer) {
            clearTimeout(homeState.hero.ringTimer);
            homeState.hero.ringTimer = null;
        }
        homeState.hero.ringDone = false;
        hideHeroRing();
        var bar = ringBar();
        if (bar) {
            bar.style.transition = 'none';
            bar.style.strokeDashoffset = HOME.RING_LEN;
        }
    }

    function hideHeroRing() {
        var ring = el('home-hero-ring');
        if (ring) ring.hidden = true;
    }

    /** Фокус всё ещё на той карточке, чей элемент показан в баннере */
    function focusedIsHeroCard() {
        var f = document.querySelector('.focused');
        if (!f || !f.dataset || !findCardPosition(f)) return false;
        var items = homeState.data[f.dataset.homeKey];
        var idx = parseInt(f.dataset.itemIndex, 10);
        if (!items || isNaN(idx) || !items[idx]) return false;
        return heroKey(items[idx]) === homeState.hero.key;
    }

    /**
     * Кругляшок — таймер ожидания, а не индикатор загрузки: ни трейлер, ни его
     * поиск до конца отсчёта не запускаются. Иначе каждая карточка, через
     * которую фокус просто прошёл, тянула бы за собой поиск на RuTube и поток
     * через /api/rutube/hls/proxy — на телевизоре от этого всё встаёт.
     * Заполнился, а фокус уже ушёл с карточки — не делаем ничего.
     */
    function startTrailerCountdown(item, details, gen) {
        if (gen !== homeState.hero.gen) return;
        if (!isHomeVisible() || playerBusy() || moduleLoaderUp()) return;
        // Галка выключена — баннер остаётся картинкой: ни кругляшка, ни поиска
        // на RuTube, ни запроса /api/rutube/hls
        if (!heroTrailersOn()) { hideHeroRing(); return; }
        runHeroRing();
        homeState.hero.ringTimer = setTimeout(function () {
            homeState.hero.ringTimer = null;
            if (gen !== homeState.hero.gen) return;
            homeState.hero.ringDone = true;
            if (!isHomeVisible() || playerBusy() || !focusedIsHeroCard()) { hideHeroRing(); return; }
            if (!heroTrailersOn()) { hideHeroRing(); return; }
            if (homeState.hero.trailerUrl) {
                startHeroTrailer(homeState.hero.trailerUrl, gen);
                return;
            }
            if (homeState.hero.trailerSearched) { hideHeroRing(); return; }
            findHeroTrailer(item, details, gen);
        }, HOME.TRAILER_DELAY_MS);
    }

    function findHeroTrailer(item, details, gen) {
        var src = details || item || {};
        var mt = item.media_type || 'movie';
        var cacheKey = String(item.id || '') + '_' + mt;
        var title = itemTitle(src) !== 'Без названия' ? itemTitle(src) : itemTitle(item);

        // Кэш общий с детальным просмотром (rutubeTrailerCache в catalog.js):
        // найденный здесь трейлер там сразу даёт кнопку, и наоборот
        var shared = window.rutubeTrailerCache;
        if (shared && shared[cacheKey] && shared[cacheKey].url) {
            onTrailerFound(shared[cacheKey].url, gen);
            return;
        }
        if (typeof window.fetchRutubeTrailer !== 'function') { onTrailerMissing(gen); return; }

        var orig = src.original_title || src.original_name || '';
        var date = src.release_date || src.first_air_date ||
            (item.release_date || item.first_air_date || '');
        Promise.resolve(window.fetchRutubeTrailer(title, orig, date)).then(function (res) {
            if (gen !== homeState.hero.gen) return;
            if (res && res.url) {
                if (shared) shared[cacheKey] = { url: res.url, title: res.title || title };
                onTrailerFound(res.url, gen);
            } else {
                onTrailerMissing(gen);
            }
        }).catch(function (e) {
            console.warn('🏠 Поиск трейлера не удался:', e && e.message);
            onTrailerMissing(gen);
        });
    }

    function onTrailerFound(url, gen) {
        if (gen !== homeState.hero.gen) return;
        homeState.hero.trailerUrl = url;
        homeState.hero.trailerSearched = true;
        // Пока искали, фокус мог уйти на другую карточку — включаем только «свой»
        if (homeState.hero.ringDone && !playerBusy() && focusedIsHeroCard()) startHeroTrailer(url, gen);
        else hideHeroRing();
    }

    function onTrailerMissing(gen) {
        if (gen !== homeState.hero.gen) return;
        homeState.hero.trailerSearched = true;
        hideHeroRing();
    }

    // ==================== БАННЕР: ТРЕЙЛЕР ====================

    function hlsUrl(url) {
        if (typeof window.wrapRutubeHls === 'function') return window.wrapRutubeHls(url);
        return url;
    }

    /**
     * Своё видео внутри баннера. startTrailerBackground из catalog.js повторить
     * нельзя: оно вставляет видео в #detail-view, гасит #catalog-detail-backdrop
     * и ставит AppState.trailerPlay, а по этому флагу control.js разбирает
     * «назад» в детальном просмотре. Настройки Hls и нарастание звука — те же.
     */
    function startHeroTrailer(url, gen) {
        if (!url || gen !== homeState.hero.gen) return;
        if (!isHomeVisible() || playerBusy()) return;
        // Последний рубеж: галку могли снять уже после отсчёта, пока искался трейлер
        if (!heroTrailersOn()) { hideHeroRing(); return; }
        var media = el('home-hero-media');
        if (!media) return;

        stopHeroTrailer();
        hideHeroRing();

        var video = document.createElement('video');
        video.id = 'home-hero-video';
        video.className = 'home-hero-video';
        video.muted = true;
        video.volume = 0;
        video.loop = true;
        video.autoplay = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        // Штатные контролы WebView не нужны совсем: на Android TV они и рисуют
        // тот значок «плей» поверх пустого видео (остальное добивает CSS)
        video.controls = false;
        video.removeAttribute('controls');
        video.setAttribute('disableremoteplayback', '');
        media.appendChild(video);
        homeState.hero.video = video;

        // Звук поднимаем с нуля: автозапуск со звуком браузер не разрешит
        var volumeStarted = false;
        function startVolumeFade() {
            if (volumeStarted) return;
            volumeStarted = true;
            try { video.muted = false; video.volume = 0; } catch (e) { }
            var vol = 0;
            video._volumeTimer = setInterval(function () {
                vol = Math.min(1, vol + 0.1);
                try { video.volume = vol; } catch (e) { }
                if (vol >= 1 && video._volumeTimer) {
                    clearInterval(video._volumeTimer);
                    video._volumeTimer = null;
                }
            }, 1000);
        }
        // Видео показываем только когда пошли настоящие кадры: включённое
        // заранее, оно на Android TV успевает нарисовать свой значок «плей»
        // (CSS его прячет, но пустой чёрный слой всё равно виден лишним мигом)
        // Класс на баннере ставим здесь же, а не по событию playing: на нём висит
        // и гашение кадра, и плавный уход подписей (название, рейтинги, описание,
        // «Смотреть»), а они должны уходить ровно тогда, когда появляется
        // картинка трейлера. Снимает его stopHeroTrailer — то есть любая
        // остановка возвращает подписи обратно.
        function revealVideo() {
            if (homeState.hero.video !== video) return;
            video.classList.add('home-hero-video-on');
            var hero = el('home-hero');
            if (hero) hero.classList.add('home-hero-playing');
        }
        video.addEventListener('playing', function () {
            revealVideo();
            startVolumeFade();
        });
        video.addEventListener('timeupdate', function () {
            // playing на части устройств приходит раньше первого кадра
            if (video.currentTime > 0) revealVideo();
            startVolumeFade();
        });

        if (window.Hls && Hls.isSupported()) {
            var hls = new Hls({
                maxBufferSize: 30 * 1024 * 1024,
                maxBufferLength: 10,
                startLevel: 2,
                enableWorker: true
            });
            hls.loadSource(hlsUrl(url));
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, function () {
                video.play().catch(function () { });
            });
            homeState.hero.hls = hls;
        } else {
            video.src = hlsUrl(url);
            video.play().catch(function () { });
        }

        startHeroWatchdog();
    }

    /**
     * Пока трейлер играет, следим, что главная всё ещё на экране. Плеер
     * (transitionToPlayerScreen в player.js) и внешние оверлеи гасят
     * #torrserver-section присваиванием style.display — события, на которое можно
     * подписаться, тут нет, а видео в скрытом контейнере продолжает играть
     * звуком. Раз в секунду и только пока есть что останавливать.
     */
    function startHeroWatchdog() {
        stopHeroWatchdog();
        homeState.hero.watchdog = setInterval(function () {
            if (!homeState.hero.video) { stopHeroWatchdog(); return; }
            if (isHomeVisible() && !playerBusy() && focusedIsHeroCard()) return;
            suspendHero();
        }, HOME.WATCHDOG_MS);
    }

    function stopHeroWatchdog() {
        if (homeState.hero.watchdog) {
            clearInterval(homeState.hero.watchdog);
            homeState.hero.watchdog = null;
        }
    }

    function stopHeroTrailer() {
        stopHeroWatchdog();
        var hero = el('home-hero');
        if (hero) hero.classList.remove('home-hero-playing');
        if (homeState.hero.hls) {
            try { homeState.hero.hls.destroy(); } catch (e) { }
            homeState.hero.hls = null;
        }
        var video = homeState.hero.video || el('home-hero-video');
        if (video) {
            if (video._volumeTimer) {
                clearInterval(video._volumeTimer);
                video._volumeTimer = null;
            }
            try { video.pause(); } catch (e) { }
            video.removeAttribute('src');
            try { video.load(); } catch (e) { }
            if (video.parentNode) video.parentNode.removeChild(video);
        }
        homeState.hero.video = null;
    }

    /**
     * Уходим с главной (раздел, детальный просмотр, поиск, плеер) — гасим всё
     * разом. Ключ элемента забываем: вернёмся — setHeroItem сравнивает новый
     * ключ с pendingKey, и без сброса тот же самый элемент не завёл бы отсчёт
     * заново (баннер остался бы картинкой без кругляшка).
     */
    function suspendHero() {
        homeState.hero.gen++;
        if (homeState.hero.timer) { clearTimeout(homeState.hero.timer); homeState.hero.timer = null; }
        homeState.hero.key = null;
        homeState.hero.pendingKey = null;
        resetHeroRing();
        stopHeroTrailer();
    }

    /**
     * Галку «Автовоспроизведение трейлеров» вернули обратно (ui-customizer.js) —
     * заводим отсчёт для карточки под фокусом, не дожидаясь, пока фокус куда-то
     * переедет. pendingKey сбрасываем, иначе setHeroItem сочтёт этот элемент уже
     * показанным и выйдет молча.
     */
    function rearmHeroTrailer() {
        if (!isHomeVisible() || !heroTrailersOn()) return;
        var f = document.querySelector('.focused');
        if (!f || !findCardPosition(f)) return;
        homeState.hero.pendingKey = null;
        setHeroFromCard(f);
    }

    // ==================== РАЗМЕРЫ: БАННЕР И КАРТОЧКИ ====================

    function userCardWidth() {
        try {
            if (window.UICustomizer && typeof UICustomizer.getCardSize === 'function') {
                var s = UICustomizer.getCardSize();
                if (s && s.width) return s.width;
            }
        } catch (e) { }
        return 0;
    }

    /**
     * Размер карточек нижнего ряда. Отдельным <style>, потому что геометрию
     * .catalog-row-card задаёт ui-customizer.js через !important — перебить его
     * можно только более специфичным селектором (.catalog-row-card.home-card:
     * два класса против одного), и порядок подключения тут уже не важен.
     */
    function applyCardCss(w, h) {
        if (homeState.cardWidth === w) return;
        homeState.cardWidth = w;
        var st = el('home-card-style');
        if (!st) {
            st = document.createElement('style');
            st.id = 'home-card-style';
            document.head.appendChild(st);
        }
        st.textContent =
            '.catalog-row-card.home-card,' +
            '.catalog-row-viewport .catalog-row-card.home-card{' +
            'flex:0 0 ' + w + 'px!important;width:' + w + 'px!important;height:' + h + 'px!important}' +
            '.catalog-row-card.home-card .torrent-poster,' +
            '.catalog-row-viewport .catalog-row-card.home-card .torrent-poster,' +
            '.catalog-row-card.home-card .row-poster-img{' +
            'width:' + w + 'px!important;height:' + h + 'px!important}';
    }

    /** Заголовок ряда + вертикальные padding'и трека: высота ряда минус карточка */
    function rowChrome() {
        var row = homeState.rowEls[homeState.activeRow];
        var cards = homeState.rows[homeState.activeRow];
        if (row && row.offsetHeight && cards && cards.length && cards[0].offsetHeight) {
            var c = row.offsetHeight - cards[0].offsetHeight;
            if (c > 20 && c < 220) return c;
        }
        return HOME.ROW_CHROME_FALLBACK_PX;
    }

    /**
     * Раскладка «баннер сверху, один ряд снизу». Считаем в JS, а не в CSS: высота
     * карточки приходит из ui-customizer с !important, высота липкой шапки в
     * каждом медиазапросе своя, а ряд должен упираться в нижний край экрана.
     */
    function layoutHome() {
        var hero = ensureHeroDom();
        if (!hero || !isHomeVisible()) return;
        var mc = el('main-container');
        if (mc && mc.scrollTop) mc.scrollTop = 0;
        var avail = (mc && mc.clientHeight) || window.innerHeight || 720;

        // Свой сдвиг снимаем перед замером, иначе прочитали бы позицию,
        // поднятую прошлым проходом, и баннер уползал бы вверх
        hero.style.marginTop = '0px';
        var mcTop = mc ? mc.getBoundingClientRect().top : 0;
        var heroTop = Math.max(0, Math.round(hero.getBoundingClientRect().top - mcTop));

        var free = Math.max(200, avail - heroTop - HOME.BOTTOM_PAD_PX);
        var chrome = rowChrome();

        var rowBlock = Math.round(free * HOME.ROW_SHARE);
        var maxRow = free - HOME.HERO_MIN_H;
        if (rowBlock > maxRow) rowBlock = maxRow;

        var w = Math.round((rowBlock - chrome) / HOME.CARD_ASPECT);
        var lim = userCardWidth();                       // ползунок «Размер карточек» — верхняя граница
        if (lim && w > lim) w = lim;
        w = Math.max(HOME.CARD_MIN_W, Math.min(HOME.CARD_MAX_W, w));
        var posterH = Math.round(w * HOME.CARD_ASPECT);
        applyCardCss(w, posterH);

        // Остаток высоты — баннеру. Отрицательный margin заводит его под шапку:
        // та лежит выше по z-index и рисует поверх свой градиент.
        var heroH = Math.max(HOME.HERO_MIN_H, free - (posterH + chrome));
        hero.style.marginTop = (-heroTop) + 'px';
        hero.style.height = (heroH + heroTop) + 'px';
    }

    // ==================== РАЗМЕТКА РЯДОВ ====================

    function createHomeCard(item, key, index) {
        var title = itemTitle(item);
        var mt = item.media_type || 'movie';
        var rating = item.vote_average ? Math.round(item.vote_average * 10) / 10 : null;
        var year = itemYear(item);
        var rc = rating ? ratingColor(rating) : '';

        var ratingHtml = rating ?
            '<div class="rating-badge" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.55);color:' + rc +
            ';font-weight:bold;font-size:13px;padding:3px 7px;border-radius:10px;z-index:10;border:1px solid ' + rc + '">' + rating + '</div>' : '';

        // Классы те же, что у карточки ряда каталога: размеры, фокус и настройки
        // из ui-customizer.js прописаны именно под них
        var card = document.createElement('div');
        card.className = 'torrent-card catalog-card catalog-row-card home-card';
        // data-home-key, а не data-catalog-key: restoreRowFocus() в catalog.js
        // ищет карточки по data-catalog-key без привязки к контейнеру, и ключ
        // history есть у обоих модулей — совпадение уводило бы фокус на главную
        card.dataset.homeKey = key;
        card.dataset.itemIndex = index;
        card.dataset.itemId = item.id;
        card.dataset.mediaType = mt;
        card.dataset.title = title;

        card.innerHTML =
            '<div class="torrent-poster">' +
            '<div class="row-poster-img"><div class="no-poster catalog-poster-loading"></div></div>' +
            ratingHtml +
            '</div>' +
            '<div class="torrent-info">' +
            '<div class="torrent-title">' + esc(title.length > 40 ? title.substring(0, 40) + '...' : title) + '</div>' +
            '<div class="torrent-meta"><span>' + (mt === 'tv' ? 'Сериал' : 'Фильм') + '</span>' +
            (year ? '<span>' + year + '</span>' : '') + '</div>' +
            '</div>';

        return card;
    }

    function createHomeRow(cfg, items) {
        var row = document.createElement('section');
        // Ряд появляется скрытым: показан всегда ровно один, его выбирает
        // setActiveRow (стрелки вверх/вниз)
        row.className = 'catalog-row home-row ' + HOME.HIDDEN_ROW_CLASS;
        row.dataset.homeKey = cfg.key;

        // Заголовок без «Показать все»: у подборок TMDB нет экрана-сетки,
        // открывать по нему нечего. Счётчик справа — единственная подсказка, что
        // рядов больше одного: соседние ряды на экране не видны.
        var header = document.createElement('div');
        header.className = 'catalog-row-header';
        header.innerHTML = '<h2 class="catalog-row-title">' + esc(cfg.name) + '</h2>' +
            '<div class="home-row-counter"></div>';
        row.appendChild(header);

        // Карусель: вьюпорт — окно-обрезка, двигается внутренний трек через
        // transform. Позицию читают/пишут getScrollX/setScrollX (control.js),
        // они ищут трек по классу catalog-row-track.
        var carousel = document.createElement('div');
        carousel.className = 'catalog-row-carousel';
        var viewport = document.createElement('div');
        viewport.className = 'catalog-row-viewport';
        var track = document.createElement('div');
        track.className = 'catalog-row-track';

        homeState.data[cfg.key] = items;

        var cards = [];
        for (var i = 0; i < items.length; i++) {
            var card = createHomeCard(items[i], cfg.key, i);
            track.appendChild(card);
            cards.push(card);
        }

        viewport.appendChild(track);
        carousel.appendChild(viewport);
        row.appendChild(carousel);

        homeState.rows.push(cards);
        homeState.rowEls.push(row);
        homeState.rowKeys.push(cfg.key);
        homeState.rowCols.push(0);
        return row;
    }

    function updateRowCounters() {
        var total = homeState.rowEls.length;
        for (var i = 0; i < total; i++) {
            var c = homeState.rowEls[i].querySelector('.home-row-counter');
            if (c) c.textContent = total > 1 ? (i + 1) + ' / ' + total : '';
        }
    }

    // ==================== ЛЕНИВАЯ ЗАГРУЗКА ПОСТЕРОВ ====================
    //
    // IntersectionObserver тут больше не нужен: на экране один ряд, и что
    // грузить — известно точно. Постеры берём рядом целиком (20 карточек),
    // соседние ряды — с задержкой, чтобы не отбирать канал у текущего.

    function setPosterFallback(box, url) {
        return new Promise(function (resolve) {
            var img = new Image();
            img.style.cssText = 'width:100%;height:100%;object-fit:cover';
            img.onload = function () {
                if (box.isConnected) { box.innerHTML = ''; box.appendChild(img); }
                resolve();
            };
            img.onerror = function () {
                if (box.isConnected) box.innerHTML = '<div class="no-poster">Нет постера</div>';
                resolve();
            };
            img.src = url;
        });
    }

    function loadCardPoster(card, item) {
        var box = card.querySelector('.row-poster-img');
        if (!box) return Promise.resolve();
        var url = item && item.poster_path ? posterUrlFor(item.poster_path) : '';
        if (!url) {
            box.innerHTML = '<div class="no-poster">Нет постера</div>';
            return Promise.resolve();
        }
        // setRowPosterImg (catalog.js) уже умеет img.decode() и переход на
        // следующее зеркало по onerror — свой велосипед только как запас
        if (typeof window.setRowPosterImg === 'function') {
            return window.setRowPosterImg(box, url);
        }
        return setPosterFallback(box, url);
    }

    /** Не больше POSTER_CONCURRENCY загрузок разом; между ними — кадр главному потоку */
    function processPosterQueue() {
        while (homeState.activePosterLoads < HOME.POSTER_CONCURRENCY &&
            homeState.posterQueue.length > 0) {
            var task = homeState.posterQueue.shift();
            if (!task.card.isConnected) continue;
            homeState.activePosterLoads++;
            loadCardPoster(task.card, task.item)
                .catch(function () { })
                .then(function () {
                    homeState.activePosterLoads--;
                    setTimeout(processPosterQueue, 5);
                });
        }
    }

    function loadRowPosters(index) {
        var cards = homeState.rows[index];
        if (!cards) return;
        var items = homeState.data[homeState.rowKeys[index]] || [];
        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            var box = card.querySelector('.row-poster-img');
            // Флаг ставится до самой загрузки, поэтому проверяем и картинку:
            // если очередь успели обнулить, карточка осталась бы пустой навсегда
            if (card.dataset.posterLoaded === '1' && box && box.querySelector('img')) continue;
            var idx = parseInt(card.dataset.itemIndex, 10);
            if (isNaN(idx) || !items[idx]) continue;
            card.dataset.posterLoaded = '1';
            homeState.posterQueue.push({ card: card, item: items[idx] });
        }
        processPosterQueue();
    }

    /** Соседние ряды — заранее, но после текущего: вверх/вниз тогда без пустых постеров */
    function prefetchNeighbourPosters(index) {
        if (homeState.prefetchTimer) clearTimeout(homeState.prefetchTimer);
        homeState.prefetchTimer = setTimeout(function () {
            homeState.prefetchTimer = null;
            loadRowPosters(index + 1);
            loadRowPosters(index - 1);
        }, HOME.PREFETCH_DELAY_MS);
    }

    function resetPosterQueue() {
        homeState.posterQueue = [];
        homeState.activePosterLoads = 0;
        if (homeState.prefetchTimer) {
            clearTimeout(homeState.prefetchTimer);
            homeState.prefetchTimer = null;
        }
    }

    // ==================== ПЕРЕКЛЮЧЕНИЕ РЯДА ====================

    /**
     * Показан всегда ровно один ряд: вверх/вниз меняют его, баннер остаётся на
     * месте. Скрытые ряды с display:none выпадают из focusableElements сами —
     * control.js фильтрует список по offsetParent.
     */
    function setActiveRow(index) {
        if (index < 0 || index >= homeState.rowEls.length) return false;
        var changed = homeState.activeRow !== index;
        homeState.activeRow = index;
        for (var i = 0; i < homeState.rowEls.length; i++) {
            if (i === index) homeState.rowEls[i].classList.remove(HOME.HIDDEN_ROW_CLASS);
            else homeState.rowEls[i].classList.add(HOME.HIDDEN_ROW_CLASS);
        }
        homeState.lastRowKey = homeState.rowKeys[index];
        if (changed) invalidateFocus();
        layoutHome();
        loadRowPosters(index);
        prefetchNeighbourPosters(index);
        return true;
    }

    // ==================== ФОКУС И НАВИГАЦИЯ ====================

    function getNavButtons() {
        var out = [];
        for (var i = 0; i < NAV_BUTTONS.length; i++) {
            var b = el(NAV_BUTTONS[i]);
            if (b && b.offsetParent !== null) out.push(b);
        }
        return out;
    }

    function playButton() {
        var b = el('home-play-btn');
        return (b && !b.hidden && b.offsetParent !== null) ? b : null;
    }

    function focusHomeEl(target) {
        if (!target) return true;
        if (typeof updateFocusableElements === 'function') updateFocusableElements();
        var list = window.focusableElements;
        var idx = (list && list.indexOf) ? list.indexOf(target) : -1;
        if (idx !== -1 && typeof setFocus === 'function') setFocus(idx);
        else if (typeof focusEl === 'function') focusEl(target);
        return true;
    }

    function scrollToCard(card) {
        if (typeof window.scrollRowToCard === 'function') {
            window.scrollRowToCard(card);
            return;
        }
        var viewport = card.closest ? card.closest('.catalog-row-viewport') : null;
        if (!viewport || typeof getScrollX !== 'function' || typeof setScrollX !== 'function') return;
        var cur = getScrollX(viewport);
        var cr = card.getBoundingClientRect(), vr = viewport.getBoundingClientRect();
        var pad = 50, target = null;
        if (cr.left < vr.left + pad) target = cur + (cr.left - vr.left - pad);
        else if (cr.right > vr.right - pad) target = cur + (cr.right - vr.right + pad);
        if (target === null) return;
        setScrollX(viewport, target, true, 0.42);
    }

    function focusCard(ri, ci, noScroll) {
        var cards = homeState.rows[ri];
        if (!cards || !cards[ci]) return true;
        if (ri !== homeState.activeRow) setActiveRow(ri);
        homeState.rowCols[ri] = ci;
        homeState.lastRowKey = homeState.rowKeys[ri];
        homeState.lastColIndex = ci;
        focusHomeEl(cards[ci]);
        // noScroll — фокус за курсором мыши: карточка и так под ним целиком,
        // а любой сдвиг ряда уводил бы её из-под указателя (см. «ЖЕСТЫ»)
        if (!noScroll) scrollToCard(cards[ci]);
        setHeroFromCard(cards[ci]);
        return true;
    }

    function setHeroFromCard(card) {
        var items = homeState.data[card.dataset.homeKey];
        var idx = parseInt(card.dataset.itemIndex, 10);
        if (!items || isNaN(idx) || !items[idx]) return;
        setHeroItem(items[idx]);
    }

    /** Фокус в показанный ряд, на запомненную для него карточку */
    function focusActiveRowCard(col) {
        var ri = homeState.activeRow;
        var cards = homeState.rows[ri];
        if (!cards || !cards.length) return focusTopbar();
        if (col === undefined || col === null || isNaN(col)) col = homeState.rowCols[ri] || 0;
        return focusCard(ri, Math.max(0, Math.min(cards.length - 1, col)));
    }

    function focusRow(index) {
        if (!setActiveRow(index)) return true;
        return focusActiveRowCard(homeState.rowCols[index]);
    }

    function findCardPosition(target) {
        var rows = homeState.rows;
        for (var i = 0; i < rows.length; i++) {
            for (var j = 0; j < rows[i].length; j++) {
                if (rows[i][j] === target) return { row: i, col: j };
            }
        }
        return null;
    }

    function focusTopbar() {
        var btns = getNavButtons();
        if (!btns.length) return true;
        var target = el(homeState.lastNavBtnId);
        if (!target || btns.indexOf(target) === -1) target = el('home-nav-home') || btns[0];
        return focusHomeEl(target);
    }

    /** Возврат фокуса туда, откуда уходили (detail, поиск, донат) */
    function restoreHomeFocus() {
        if (!homeState.rowEls.length) return focusTopbar();
        var idx = homeState.rowKeys.indexOf(homeState.lastRowKey);
        if (idx === -1) idx = Math.min(homeState.activeRow, homeState.rowEls.length - 1);
        setActiveRow(idx);
        var col = (homeState.rowKeys[idx] === homeState.lastRowKey)
            ? homeState.lastColIndex : homeState.rowCols[idx];
        return focusActiveRowCard(col);
    }

    function ensureHomeFocus(force) {
        if (force === undefined) force = false;
        if (!isHomeFocusable()) return false;
        if (window.AppState && AppState.restoringFocus) return false;
        var f = document.querySelector('.focused');
        if (!force && f && belongsToHome(f)) return true;
        return restoreHomeFocus();
    }

    function belongsToHome(target) {
        if (!target) return false;
        // Кнопки шапки лежат в #home-topbar, снаружи #content-home
        if (target.classList && target.classList.contains('home-nav-btn')) return true;
        if (!target.closest) return false;
        return !!target.closest('#content-home');
    }

    function handleHomeNavigation(dir) {
        // control.js читает направление при доводке скролла (setFocus → focusEl),
        // но стратегии главной его не передаёт — выставляем сами
        window.lastNavDirection = dir;
        var f = document.querySelector('.focused');
        var btns = getNavButtons();
        var bi = (f && btns.indexOf) ? btns.indexOf(f) : -1;

        // --- шапка ---
        if (bi !== -1) {
            homeState.lastNavBtnId = f.id || homeState.lastNavBtnId;
            if (dir === 'left') return focusHomeEl(btns[Math.max(0, bi - 1)]);
            if (dir === 'right') return focusHomeEl(btns[Math.min(btns.length - 1, bi + 1)]);
            if (dir === 'down') {
                var pb = playButton();
                if (pb) return focusHomeEl(pb);
                if (!homeState.rowEls.length) return true;
                return focusActiveRowCard();
            }
            return true;   // вверх с шапки уходить некуда
        }

        // --- кнопка «Смотреть» на баннере ---
        if (f && f.id === 'home-play-btn') {
            if (dir === 'up') return focusTopbar();
            if (dir === 'down') {
                if (!homeState.rowEls.length) return true;
                return focusActiveRowCard();
            }
            return true;   // влево/вправо на баннере некуда: кнопка одна
        }

        // --- нижний ряд ---
        var pos = f ? findCardPosition(f) : null;
        if (!pos) return ensureHomeFocus(true);
        var cards = homeState.rows[pos.row];

        if (dir === 'left') {
            if (pos.col > 0) return focusCard(pos.row, pos.col - 1);
            return true;
        }
        if (dir === 'right') {
            if (pos.col < cards.length - 1) return focusCard(pos.row, pos.col + 1);
            return true;
        }
        // Вверх/вниз меняют подборку в нижнем ряду, а не уводят фокус по вертикали:
        // на экране один ряд, остальные скрыты
        if (dir === 'up') {
            if (pos.row > 0) return focusRow(pos.row - 1);
            var pb2 = playButton();
            if (pb2) return focusHomeEl(pb2);
            return focusTopbar();
        }
        if (dir === 'down') {
            if (pos.row < homeState.rowEls.length - 1) return focusRow(pos.row + 1);
            return true;
        }
        return true;
    }

    function handleHomeBack() {
        var f = document.querySelector('.focused');
        var btns = getNavButtons();
        if (f && btns.indexOf(f) !== -1) return true;    // уже в шапке — уходить некуда
        if (f && f.id === 'home-play-btn') { focusTopbar(); return true; }
        if (f && findCardPosition(f)) {
            var pb = playButton();
            if (pb) { focusHomeEl(pb); return true; }
            focusTopbar();
            return true;
        }
        ensureHomeFocus(true);
        return true;
    }

    // ==================== ДЕЙСТВИЯ ====================

    function openHomeItem(item, key, index) {
        homeState.lastRowKey = key;
        homeState.lastColIndex = index;
        homeState.detailFromHome = true;
        suspendHero();
        scrollHomeToTop();
        if (window.AppState) {
            AppState.catalogIndex = index;
            AppState.androidBackCatalog = item;
            AppState.catalogPu = null;
            AppState.openInRow = true;
        }
        if (typeof window.showCatalogDetail === 'function') {
            window.showCatalogDetail(item, index, null);
        }
        return true;
    }

    /**
     * «Смотреть» — то же действие, что главная кнопка детального просмотра:
     * поиск торрентов по названию. showCatalogSearch целит «назад» в детальный
     * просмотр, но с главной он не открывался, поэтому возврат правим на home
     * (ветку returnTo === 'home' разбирает hideSearchResults в torrents.js).
     */
    function playHeroItem() {
        var item = homeState.hero.item;
        if (!item) return ensureHomeFocus(true);
        suspendHero();

        var details = homeState.heroDetails[heroKey(item)] || item;
        var title = itemTitle(details) !== 'Без названия' ? itemTitle(details) : itemTitle(item);
        var poster = item.poster_path ? posterUrlFor(item.poster_path) : null;

        if (typeof window.showCatalogSearch === 'function') {
            if (window.AppState) {
                AppState.androidBackCatalog = item;
                AppState.catalogIndex = homeState.lastColIndex;
            }
            window.showCatalogSearch(title, poster, item);
            if (window.AppState) AppState.searchReturnTo = 'home';
            return true;
        }
        // Поиска нет — открываем карточку, там кнопка «Смотреть» своя
        return openHomeItem(item, homeState.rowKeys[homeState.activeRow], homeState.lastColIndex);
    }

    function onHomeRowsClick(e) {
        var card = e.target.closest ? e.target.closest('.catalog-row-card') : null;
        if (!card) return;
        var key = card.dataset.homeKey;
        var idx = parseInt(card.dataset.itemIndex, 10);
        var items = homeState.data[key];
        if (!key || isNaN(idx) || !items || !items[idx]) return;
        openHomeItem(items[idx], key, idx);
    }

    function openSearchFromHome() {
        if (window.AppState) AppState.searchReturnTo = 'home';
        if (typeof window.showSearchResults === 'function') {
            window.showSearchResults({ focusQuery: true });
            return true;
        }
        var tab = el('tab-search');
        if (tab) tab.click();
        return true;
    }

    /**
     * Разделы открываем «настоящими» кнопками, которые главная прячет: вся
     * логика вкладок живёт в их обработчиках (app.js, donate.js), дублировать
     * её здесь нельзя — разъедется.
     */
    function clickHidden(id) {
        var target = el(id);
        if (!target) return false;
        try { target.click(); } catch (e) { return false; }
        return true;
    }

    function onNavButton(id, viaClick) {
        homeState.lastNavBtnId = id;

        // «Главная» — единственная кнопка шапки без своего обработчика
        if (id === 'home-nav-home') return goHome();

        // Уходим с главной: трейлер и кругляшок гасим, чтобы звук не играл
        // поверх чужого экрана
        suspendHero();
        scrollHomeToTop();

        // Остальные кнопки — настоящие вкладки разделов. Обработчики висят на
        // самих кнопках, а мы слушаем на перехвате — то есть до них. Повторный
        // click() открыл бы раздел дважды. С пульта клика нет — там мы его и
        // создаём.
        if (viaClick) return true;
        if (id === 'tab-search') return openSearchFromHome();
        return clickHidden(id);
    }

    /**
     * «Главная» работает из любого раздела: на самой главной это «вернуться к
     * первой подборке», из каталога / торрентов — полноценный возврат домой
     * (showHome прячет чужие экраны и снимает hidden с #content-home).
     */
    function goHome() {
        if (!isHomeVisible()) return showHome({ restoreFocus: true });
        if (!homeState.rowEls.length) return true;
        return focusRow(0);
    }

    function onHomeOk(f) {
        if (!f) return ensureHomeFocus(true);
        if (f.id === 'home-play-btn') return playHeroItem();
        if (f.classList && f.classList.contains('home-nav-btn')) return onNavButton(f.id);
        var pos = findCardPosition(f);
        if (pos) {
            var items = homeState.data[homeState.rowKeys[pos.row]];
            if (items && items[pos.col]) {
                return openHomeItem(items[pos.col], homeState.rowKeys[pos.row], pos.col);
            }
            return true;
        }
        return ensureHomeFocus(true);
    }

    // ==================== ПРОГРЕССИВНАЯ ЗАГРУЗКА РЯДОВ ====================

    function loadHomeRows() {
        var container = el('home-rows');
        if (!container) return Promise.resolve(false);

        var cfgs = HOME_ROWS;
        var results = new Array(cfgs.length);
        var nextToLoad = 0, nextToRender = 0;
        var activeLoads = 0, completedLoads = 0, renderedRows = 0;
        var finished = false;

        homeState.rows = [];
        homeState.rowEls = [];
        homeState.rowKeys = [];
        homeState.rowCols = [];
        homeState.activeRow = 0;
        homeState.data = {};
        homeState.activated = false;
        resetPosterQueue();

        container.innerHTML = '<div class="catalog-rows-loading">' +
            '<div class="loading-spinner" style="margin:0 auto 20px"></div>' +
            '<div style="font-size:16px;color:#aaa">Загрузка подборок...</div></div>';
        invalidateFocus();

        return new Promise(function (resolve) {
            function finish(value) {
                if (finished) return;
                finished = true;
                resolve(value);
            }

            function activate() {
                if (homeState.activated) return;
                homeState.activated = true;
                // Первый ряд на экране — заглушку загрузчика держать больше не за чем
                dismissModuleLoader();
                requestAnimationFrame(function () {
                    if (!isHomeFocusable()) { loadRowPosters(homeState.activeRow); return; }
                    if (typeof updateFocusableElements === 'function') updateFocusableElements();
                    setTimeout(function () {
                        // Фокус уезжает на карточку раньше картинок: постеры
                        // подтягиваются уже после него (setActiveRow → loadRowPosters)
                        if (isHomeFocusable()) restoreHomeFocus();
                        else loadRowPosters(homeState.activeRow);
                    }, HOME.FOCUS_DELAY_MS);
                });
            }

            function renderReadyRows() {
                if (!isHomeVisible()) { finish(false); return; }
                var appended = 0;
                while (nextToRender < cfgs.length && results[nextToRender] !== undefined) {
                    var res = results[nextToRender++];
                    if (!res.items || !res.items.length) continue;   // пустой ряд не показываем
                    var row = createHomeRow(res.cfg, res.items);
                    if (!row) continue;
                    if (renderedRows === 0) container.innerHTML = '';
                    container.appendChild(row);
                    renderedRows++;
                    appended++;
                    // Первый пришедший ряд и становится показанным; остальные
                    // ложатся скрытыми и ждут стрелки «вниз»
                    if (renderedRows === 1) setActiveRow(0);
                    activate();
                }
                if (appended) {
                    updateRowCounters();
                    // Кэш фокуса в control.js держится на счётчике поколений DOM —
                    // о новых карточках надо сказать явно
                    invalidateFocus();
                }
            }

            function scheduleLoads() {
                if (finished) return;
                if (!isHomeVisible()) { finish(false); return; }
                if (completedLoads === cfgs.length) {
                    if (renderedRows === 0) {
                        container.innerHTML = '<div class="catalog-rows-loading">' +
                            '<div style="font-size:48px;margin-bottom:20px">🎬</div>' +
                            '<div style="font-size:18px;color:#aaa">Подборки недоступны</div>' +
                            '<div style="font-size:14px;color:#777;margin-top:10px">Проверьте подключение к интернету</div></div>';
                        invalidateFocus();
                        if (isHomeFocusable()) focusTopbar();
                        // Рядов не будет вовсе — держать заглушку тем более не за чем
                        dismissModuleLoader();
                    }
                    finish(renderedRows > 0);
                    return;
                }
                while (activeLoads < HOME.MAX_PARALLEL_ROW_LOADS && nextToLoad < cfgs.length) {
                    (function (index, cfg) {
                        activeLoads++;
                        loadRowItems(cfg)
                            .then(function (items) { results[index] = { cfg: cfg, items: items || [] }; })
                            .catch(function () { results[index] = { cfg: cfg, items: [] }; })
                            .then(function () {
                                activeLoads--;
                                completedLoads++;
                                renderReadyRows();
                                scheduleLoads();
                            });
                    })(nextToLoad, cfgs[nextToLoad]);
                    nextToLoad++;
                }
            }

            scheduleLoads();
        });
    }

    // ==================== ПОКАЗ / СКРЫТИЕ ====================

    function showHome(opts) {
        opts = opts || {};
        var screen = el('content-home');
        if (!screen) return false;

        var section = el('torrserver-section');
        // index.html отдаёт секцию с display:none — показываем сами, до ответа
        // checkServer(): главная не должна ждать TorrServer
        if (section) section.style.display = 'block';

        var configScreen = el('config-screen');
        if (configScreen) configScreen.style.display = 'none';

        // Пока открыта главная, ни одна вкладка не активна — иначе обработчики
        // вкладок (они проверяют .active) не сработают с первого нажатия
        var tabs = document.querySelectorAll('.view-tab');
        for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');

        // Экран неизвестный для app.js → прячет и торренты, и каталог,
        // ставит AppState.currentScreen = 'home' и возвращает свой скролл.
        // Обёртка ниже снимает hidden с #content-home и подсвечивает «Главную».
        if (typeof window.showContentScreen === 'function') window.showContentScreen('home');
        else if (window.AppState) AppState.currentScreen = 'home';
        screen.hidden = false;
        var homeBtn = el('home-nav-home');
        if (homeBtn) homeBtn.classList.add('active');

        if (window.AppState) {
            AppState.inSearch = 'home';
            AppState.searchReturnTo = null;
            AppState.isSearch = false;
            AppState.isCatalogSearch = false;
        }
        ensureHeroDom();
        invalidateFocus();

        if (!homeState.built && !homeState.loading) {
            homeState.loading = true;
            layoutHome();
            loadHomeRows().then(function (ok) {
                homeState.loading = false;
                homeState.built = !!ok;
            });
            return true;
        }

        // Возврат на готовую главную: баннер пересобираем с нуля (кругляшок и
        // трейлер гасились при уходе), размеры пересчитываем — за это время мог
        // измениться и размер карточек в настройках
        homeState.hero.key = null;
        homeState.hero.pendingKey = null;
        homeState.cardWidth = 0;
        homeState.activated = true;
        setActiveRow(Math.min(homeState.activeRow, Math.max(0, homeState.rowEls.length - 1)));

        requestAnimationFrame(function () {
            if (!isHomeFocusable()) return;
            if (typeof updateFocusableElements === 'function') updateFocusableElements();
            setTimeout(function () {
                if (!isHomeFocusable()) return;
                if (opts.restoreFocus === false) return;
                restoreHomeFocus();
            }, HOME.FOCUS_DELAY_MS);
        });
        return true;
    }

    function refreshHome() {
        return dbClear().then(function () {
            suspendHero();
            homeState.built = false;
            homeState.loading = false;
            homeState.lastRowKey = null;
            homeState.lastColIndex = 0;
            homeState.heroDetails = {};
            return showHome();
        });
    }

    // ==================== ИНТЕГРАЦИЯ С ОСТАЛЬНЫМИ МОДУЛЯМИ ====================

    /**
     * app.js и catalog.js на телевизоре грузятся отдельными файлами, а точки
     * входа у них глобальные и вызываются по имени — поэтому расширяем их
     * обёртками, а не правками в этих файлах.
     */
    function patchGlobals() {
        // 1. Переключение контентных экранов: главная — третий экран рядом с
        //    торрентами и каталогом, но app.js про неё не знает.
        var origShowContentScreen = window.showContentScreen;
        window.showContentScreen = function (screen) {
            var homeScreen = el('content-home');
            var homeBtn = el('home-nav-home');
            if (window.AppState && AppState.currentScreen === 'home' && screen !== 'home') {
                // Главная не прокручивается — возвращаться на неё всегда сверху
                AppState.contentScroll = AppState.contentScroll || {};
                AppState.contentScroll.home = 0;
                homeState.detailFromHome = false;
                suspendHero();
            }
            // Экраны раздела живут в DOM постоянно, видимость переключается
            // через hidden. Уходя на главную, прячем чужие экраны сами: app.js
            // на телевизоре грузится со старого зеркала, и полагаться на то,
            // как он обходится с неизвестным ему экраном, нельзя.
            if (screen === 'home') {
                var screens = document.querySelectorAll('#torrserver-section .content-screen');
                for (var i = 0; i < screens.length; i++) {
                    if (screens[i] !== homeScreen) screens[i].hidden = true;
                }
            }
            if (homeScreen) homeScreen.hidden = (screen !== 'home');
            // «Главная» подсвечена по тому же правилу, что вкладки разделов:
            // .active — у того пункта, чей экран открыт
            if (homeBtn) {
                if (screen === 'home') homeBtn.classList.add('active');
                else homeBtn.classList.remove('active');
            }
            if (typeof origShowContentScreen === 'function') {
                return origShowContentScreen.apply(this, arguments);
            }
            if (window.AppState) AppState.currentScreen = screen;
        };

        // 2. Возврат из детального просмотра. app.js вычисляет returnTo как
        //    catalog / torrents / search и зовёт эту функцию по имени.
        var origRestoreFocus = window.restoreFocusAfterNavigation;
        window.restoreFocusAfterNavigation = function (returnTo) {
            if (homeState.detailFromHome && returnTo !== 'search') {
                homeState.detailFromHome = false;
                if (typeof window.hideDetailView === 'function') window.hideDetailView();
                showHome({ restoreFocus: true });
                return;
            }
            if (typeof origRestoreFocus === 'function') {
                return origRestoreFocus.apply(this, arguments);
            }
        };

        // 3. Закрытие доната. Он целится фокусом в кнопку #tab-donate, а на
        //    главной она скрыта — фокус остался бы нигде.
        var origCloseDonate = window.closeDonateOverlay;
        window.closeDonateOverlay = function () {
            var r = (typeof origCloseDonate === 'function')
                ? origCloseDonate.apply(this, arguments) : undefined;
            scheduleFocusAfterOverlay();
            return r;
        };
        // Кнопку закрытия донат подписал на свою локальную функцию, до обёртки
        // выше такой клик не доходит — ловим его отдельно
        document.addEventListener('click', function (e) {
            if (!e.target.closest) return;
            if (!e.target.closest('#donate-close-btn, .donate-overlay-backdrop')) return;
            scheduleFocusAfterOverlay();
        });

        // 4. Экран ушёл в фон (переключили вход, свернули браузер) — звук
        //    трейлера в фоне не нужен. Вернулись — заводим отсчёт заново.
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) { suspendHero(); return; }
            if (!isHomeVisible()) return;
            var f = document.querySelector('.focused');
            if (f && findCardPosition(f)) setHeroFromCard(f);
        });

        // 5. Началось воспроизведение. Путь «Смотреть → поиск → фильм» проходит
        //    через hideSearchResults, а тот возвращает главную на экран и заводит
        //    кругляшок заново (torrents.js:3495 → ветка returnTo === 'home').
        //    Гасим здесь: startHLSPlayback — единственная точка входа в плеер,
        //    и она вызывается раньше, чем плеер спрячет #torrserver-section.
        var origStartPlayback = window.startHLSPlayback;
        if (typeof origStartPlayback === 'function') {
            window.startHLSPlayback = function () {
                suspendHero();
                return origStartPlayback.apply(this, arguments);
            };
        }

        // 6. Раскладка привязана к высоте экрана — пересчитываем на resize
        window.addEventListener('resize', function () {
            if (!isHomeVisible()) return;
            if (homeState.resizeTimer) clearTimeout(homeState.resizeTimer);
            homeState.resizeTimer = setTimeout(function () {
                homeState.resizeTimer = null;
                homeState.cardWidth = 0;      // размер мог не измениться — но пересчитать надо
                layoutHome();
            }, 150);
        });
    }

    /** Оверлей закрылся — если под ним главная и фокус потерян, возвращаем его */
    function scheduleFocusAfterOverlay() {
        setTimeout(function () {
            if (!isHomeFocusable()) return;
            var f = document.querySelector('.focused');
            if (f && belongsToHome(f)) return;
            restoreHomeFocus();
        }, 160);
    }

    /** Стратегия экрана для control.js. Он грузится раньше, но подстрахуемся. */
    function registerStrategy() {
        if (typeof ScreenStrategies === 'undefined' || !ScreenStrategies.torrents) {
            setTimeout(registerStrategy, 100);
            return;
        }
        if (ScreenStrategies.home) return;
        ScreenStrategies.home = {
            getItems: function () {
                var out = getNavButtons();
                var pb = playButton();
                if (pb) out.push(pb);
                // Скрытые ряды (display:none) в список не попадают
                var cards = document.querySelectorAll('#home-rows .catalog-row-card');
                for (var i = 0; i < cards.length; i++) {
                    if (cards[i].offsetParent !== null) out.push(cards[i]);
                }
                return out;
            },
            ensureFocus: ensureHomeFocus,
            handleNavigation: handleHomeNavigation,
            onOk: onHomeOk
        };
    }

    // ==================== ЖЕСТЫ: КОЛЕСО И СВАЙП ====================
    //
    // Главная не прокручивается — баннер и один ряд рассчитаны ровно на высоту
    // экрана. Поэтому вертикальному жесту нечего скроллить, и мышью с тачем
    // дальше первой подборки было не уйти: с пульта ряд меняют стрелки, а
    // указателю такого действия не досталось. Переводим вертикальный жест в тот
    // же вызов, что и стрелки, — смену показанного ряда.
    //
    // Раскладка ролей: вертикаль — подборки, горизонталь — карточки внутри ряда.
    // Горизонтальный жест ведёт делегированный обработчик в control.js
    // (H_SCROLL_SELECTOR), туда же уходит shift + колесо; вертикальное колесо над
    // рядом главной он специально пропускает, не отменяя default. Отсюда проверка
    // e.defaultPrevented: событие с отменённым default он уже забрал себе.

    var wheelAccum = 0;         // сумма deltaY одного «маха» колеса
    var wheelAccumAt = 0;
    var wheelScrollable = false;
    var gestureLockUntil = 0;   // до этого времени новый шаг не делаем
    var swipe = null;

    /**
     * Обычно на главной прокручивать нечего, и жест мы забираем целиком
     * (preventDefault). Но на совсем низком окне раскладка может не сойтись —
     * тогда default не отменяем, иначе до вылезшего за экран содержимого будет
     * не добраться. Смену подборки это не отменяет.
     */
    function pageScrollable() {
        var mc = el('main-container');
        return !!(mc && mc.scrollHeight - mc.clientHeight > 2);
    }

    /**
     * Жест адресован главной? Смотрим на цель касания, а не на
     * AppState.currentScreen: тот на старте может ещё принадлежать торрентам
     * (checkServer и loadTorrents приходят позже первого жеста), а витрина уже
     * на экране — именно поэтому на телефоне свайп «оживал» только после
     * захода в карточку и возврата (showHome выставлял экран заново).
     * Заодно отсекается всё, что лежит поверх: detail-view и оверлеи поиска и
     * доната — отдельные ветки DOM. Шапку раздела берём отдельно: она общая для
     * торрентов и каталога и лежит рядом с #content-home, а не внутри.
     */
    function homeGestureTarget(target) {
        if (playerBusy() || moduleLoaderUp() || !isHomeVisible()) return false;
        if (!target || !target.closest) return false;
        return !!(target.closest('#content-home') || target.closest('#home-topbar'));
    }

    /** Один шаг вертикального жеста — то же, что стрелка вверх/вниз в ряду */
    function gestureStepRow(down) {
        if (!homeState.rowEls.length) return false;
        // Тем же способом, что handleHomeNavigation: control.js читает
        // направление при доводке скролла в focusEl
        window.lastNavDirection = down ? 'down' : 'up';

        var f = document.querySelector('.focused');
        var pos = f ? findCardPosition(f) : null;
        // Фокус в шапке или на «Смотреть»: вниз сначала уводим его в ряд —
        // ровно так же ведёт себя стрелка
        if (!pos && f && belongsToHome(f)) {
            if (!down) return false;
            focusActiveRowCard();
            return true;
        }
        // Опора — показанный ряд, а не фокус: на телефоне фокуса может не быть
        // вовсе (его ставят пультом или курсором), а листать подборки жест
        // обязан и без него.
        var from = pos ? pos.row : homeState.activeRow;
        var next = from + (down ? 1 : -1);
        if (next < 0 || next >= homeState.rowEls.length) return false;
        focusRow(next);
        return true;
    }

    function onHomeWheel(e) {
        if (e.defaultPrevented) return;      // колесо уже отработал control.js
        if (!homeGestureTarget(e.target)) return;

        var dy = e.deltaY || e.wheelDeltaY ||
            (e.wheelDelta ? -e.wheelDelta / 40 : 0) || e.detail || 0;
        var dx = e.deltaX || e.wheelDeltaX || 0;
        if (!dy || Math.abs(dx) > Math.abs(dy)) return;

        var now = Date.now();
        // Пауза или разворот — счёт с нуля: иначе докрутка в обратную сторону
        // складывалась бы с прежним направлением
        if (now - wheelAccumAt > 400 || (wheelAccum > 0) !== (dy > 0)) {
            wheelAccum = 0;
            // Раз на мах: чтение scrollHeight — принудительный layout, а тачпад
            // присылает событий десятками
            wheelScrollable = pageScrollable();
        }
        wheelAccumAt = now;
        wheelAccum += dy;
        if (!wheelScrollable) e.preventDefault();

        if (Math.abs(wheelAccum) < HOME.WHEEL_STEP_PX) return;
        if (now < gestureLockUntil) return;
        wheelAccum = 0;
        gestureLockUntil = now + HOME.GESTURE_COOLDOWN_MS;
        gestureStepRow(dy > 0);
    }

    function onHomeTouchStart(e) {
        swipe = null;
        touchedAt = Date.now();
        stopHoverScroll();      // палец не «висит» у края, как курсор
        if (!e.touches || e.touches.length !== 1) return;
        if (!homeGestureTarget(e.target)) return;
        var t = e.touches[0];
        swipe = { x: t.clientX, y: t.clientY, anchor: t.clientY, vertical: false, scrollable: false };
    }

    function onHomeTouchMove(e) {
        if (!swipe || !e.touches || e.touches.length !== 1) return;

        var t = e.touches[0];
        var dx = t.clientX - swipe.x;
        var dy = t.clientY - swipe.y;

        if (!swipe.vertical) {
            if (Math.abs(dx) < HOME.SWIPE_AXIS_PX && Math.abs(dy) < HOME.SWIPE_AXIS_PX) return;
            // Горизонтальный жест ведёт control.js — отпускаем до конца касания
            if (Math.abs(dx) > Math.abs(dy)) { swipe = null; return; }
            swipe.vertical = true;
            swipe.anchor = t.clientY;      // порог не считаем за пройденный путь
            swipe.scrollable = pageScrollable();   // раз на касание, а не на кадр
        }

        if (!swipe.scrollable) e.preventDefault();

        var now = Date.now();
        if (now < gestureLockUntil) return;
        // Палец вверх — вниз по подборкам, как при прокрутке страницы.
        // Шаг за каждые SWIPE_STEP_PX: длинный свайп проходит несколько рядов,
        // но не быстрее GESTURE_COOLDOWN_MS (каждый ряд тянет 20 постеров).
        var travel = t.clientY - swipe.anchor;
        if (Math.abs(travel) < HOME.SWIPE_STEP_PX) return;
        swipe.anchor = t.clientY;
        gestureLockUntil = now + HOME.GESTURE_COOLDOWN_MS;
        gestureStepRow(travel < 0);
    }

    function onHomeTouchEnd() {
        swipe = null;
        touchedAt = Date.now();
    }

    // ---------- Мышь у края ряда: прокрутка в эту сторону ----------
    //
    // Колесо на главной листает подборки, а горизонтального жеста у обычной
    // мыши нет — до дальних карточек ряда указателем было не добраться.
    // Держим курсор у правого или левого края ряда — он едет в эту сторону
    // шагами по карточке, пока не упрётся. Отсюда деление зон: у краёв курсор
    // прокручивает ряд, в середине — ставит фокус (hoverFocus ниже).

    var hover = { viewport: null, dir: 0, timer: null };
    // Метрики ряда под курсором: mousemove приходит десятками в секунду, а
    // getBoundingClientRect и offsetLeft посреди твина трека — это
    // принудительный пересчёт стилей. Полсекунды жизни хватает: раскладка
    // меняется только на resize и при смене ряда.
    var hoverMetrics = { el: null, at: 0, box: null, step: 0 };
    var lastMoveAt = 0;
    var lastMoveX = -1;
    var lastMoveY = -1;
    var touchedAt = 0;

    /** Шаг прокрутки — реальное расстояние между карточками этого ряда */
    function cardStep(viewport) {
        var track = viewport.firstElementChild;
        var cards = track ? track.children : null;
        if (cards && cards.length > 1) {
            var s = cards[1].offsetLeft - cards[0].offsetLeft;
            if (s > 10) return s;
        }
        if (cards && cards.length === 1) return cards[0].offsetWidth;
        return Math.max(120, (viewport.clientWidth || 600) * 0.25);
    }

    function rowMetrics(v) {
        var now = Date.now();
        if (hoverMetrics.el !== v || now - hoverMetrics.at > 500) {
            hoverMetrics.el = v;
            hoverMetrics.at = now;
            hoverMetrics.box = v.getBoundingClientRect();
            hoverMetrics.step = cardStep(v);
        }
        return hoverMetrics;
    }

    function stopHoverScroll() {
        if (hover.timer) { clearInterval(hover.timer); hover.timer = null; }
        hover.viewport = null;
        hover.dir = 0;
    }

    function hoverScrollStep() {
        var v = hover.viewport;
        if (!v || !v.isConnected || !hover.dir) { stopHoverScroll(); return; }
        // Проверка та же, что у жестов, но без цели события: таймер живёт сам
        if (playerBusy() || !isHomeVisible()) { stopHoverScroll(); return; }
        // Ряд под курсором могли сменить стрелками — скрытый двигать незачем
        if (v.offsetParent === null) { stopHoverScroll(); return; }
        if (typeof getScrollX !== 'function' || typeof setScrollX !== 'function') { stopHoverScroll(); return; }

        var cur = getScrollX(v);
        var max = (typeof getMaxScrollX === 'function') ? getMaxScrollX(v) : 0;
        // Доехали до края — таймер гасим, иначе он крутится вхолостую всё время,
        // пока курсор стоит на крайней карточке
        if ((hover.dir < 0 && cur <= 0.5) || (hover.dir > 0 && cur >= max - 0.5)) {
            stopHoverScroll();
            return;
        }
        setScrollX(v, cur + hover.dir * rowMetrics(v).step, true, HOME.HOVER_SCROLL_SEC);
    }

    /** @returns {boolean} true — ряд поехал (или уже едет), false — уже у края */
    function startHoverScroll(viewport, dir) {
        if (hover.viewport === viewport && hover.dir === dir && hover.timer) return true;
        stopHoverScroll();
        hover.viewport = viewport;
        hover.dir = dir;
        hoverScrollStep();                          // первый шаг сразу
        // Шаг мог упереться в край и всё погасить — тогда таймер не заводим
        if (!hover.dir) return false;
        hover.timer = setInterval(hoverScrollStep, HOME.HOVER_SCROLL_MS);
        return true;
    }

    // ---------- Мышь: фокус за курсором ----------
    //
    // С пультом фокус ведут стрелки, но указателем ожидается прямое попадание:
    // карточка под курсором и есть выбранная. Ведём фокус тем же путём, что
    // стрелки (focusCard / focusHomeEl), иначе разойдутся баннер и запомненная
    // для ряда колонка — с них потом продолжает пульт.

    /** Ближайший элемент под курсором, которому на главной положен фокус */
    function hoverFocusableFrom(node) {
        if (!node || !node.closest) return null;
        return node.closest('#home-rows .torrent-card.catalog-card') ||
            node.closest('#home-topbar .home-nav-btn') ||
            node.closest('#home-play-btn');
    }

    function hoverFocus(target) {
        // Курсор стоит на уже выбранном — самый частый случай, и делать нечего
        if (!target || target.classList.contains('focused')) return;

        var pos = findCardPosition(target);
        if (pos) {
            // Карточку, вылезающую за край вьюпорта, доводка скроллом подтянула
            // бы под фокус — ряд поехал бы под курсором, и следующий mousemove
            // целился бы уже в соседнюю. Такие края — забота краевой прокрутки.
            var vp = target.closest('.catalog-row-viewport');
            if (vp) {
                var cb = target.getBoundingClientRect(), vb = rowMetrics(vp).box;
                if (cb.left < vb.left - 1 || cb.right > vb.right + 1) return;
            }
            focusCard(pos.row, pos.col, true);
            return;
        }

        // Как и стрелками по шапке: помним кнопку, на которую вернёт «вверх»
        if (target.classList.contains('home-nav-btn')) {
            homeState.lastNavBtnId = target.id || homeState.lastNavBtnId;
        }
        focusHomeEl(target);
    }

    function onHomeMouseMove(e) {
        var now = Date.now();
        // Тап на тач-экране рисует ещё и mousemove: курсора там нет, и «зависший
        // у края» указатель прокручивал бы ряд до упора после каждого касания
        if (now - touchedAt < 800) return;
        if (now - lastMoveAt < 50) return;          // хватит и 20 проверок в секунду
        // Ряд поехал под неподвижным курсором — это не жест мышью
        if (e.clientX === lastMoveX && e.clientY === lastMoveY) return;
        lastMoveAt = now;
        lastMoveX = e.clientX;
        lastMoveY = e.clientY;

        if (!homeGestureTarget(e.target)) { stopHoverScroll(); return; }

        var v = (e.target && e.target.closest)
            ? e.target.closest('#home-rows .catalog-row-viewport') : null;
        if (v) {
            var m = rowMetrics(v);
            // Зона примерно в карточку шириной, но не уже 60px и не больше трети ряда
            var w = m.box.width || v.clientWidth || 0;
            var zone = Math.max(60, Math.min(m.step, w * 0.3));
            // У края ряд едет, фокус не трогаем: карточки под курсором меняются
            // сами. Ряд, доехавший до упора, зону освобождает — там снова фокус
            // (иначе до первой и последней карточки мышью было бы не добраться).
            if (e.clientX >= m.box.right - zone) {
                if (startHoverScroll(v, 1)) return;
            } else if (e.clientX <= m.box.left + zone) {
                if (startHoverScroll(v, -1)) return;
            }
        }
        stopHoverScroll();
        hoverFocus(hoverFocusableFrom(e.target));
    }

    function initGestures() {
        // На document и после control.js (home.js грузится последним): его
        // обработчик успевает пометить событие своим preventDefault
        document.addEventListener('wheel', onHomeWheel, { passive: false });
        document.addEventListener('touchstart', onHomeTouchStart, { passive: true });
        document.addEventListener('touchmove', onHomeTouchMove, { passive: false });
        document.addEventListener('touchend', onHomeTouchEnd, { passive: true });
        document.addEventListener('touchcancel', onHomeTouchEnd, { passive: true });
        // Указатель у края ряда. mouseout с пустым relatedTarget = курсор ушёл
        // за пределы окна: mousemove больше не придёт, а таймер бы остался.
        document.addEventListener('mousemove', onHomeMouseMove, { passive: true });
        document.addEventListener('mouseout', function (e) {
            if (!e.relatedTarget) stopHoverScroll();
        }, { passive: true });
        window.addEventListener('blur', stopHoverScroll);
    }

    // ==================== ЧАСЫ В ШАПКЕ ====================

    var CLOCK_DAYS = ['воскресенье', 'понедельник', 'вторник', 'среда',
        'четверг', 'пятница', 'суббота'];
    var CLOCK_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
        'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

    /**
     * Время, дата и день недели справа от «Настроек» (разметка в index.html).
     * Тикаем раз в секунду, а в DOM пишем только когда строка изменилась — то
     * есть раз в минуту, и раз в сутки для даты. На старых телевизорах
     * перерисовка липкой шапки каждую секунду стоит дороже самих часов, а
     * секунд мы всё равно не показываем.
     */
    function startTopbarClock() {
        var timeEl = el('home-clock-time');
        if (!timeEl) return;
        var dayEl = el('home-clock-day');
        var wdEl = el('home-clock-weekday');
        var lastTime = '';
        var lastDay = '';

        function pad(n) { return (n < 10 ? '0' : '') + n; }

        function tick() {
            var d = new Date();
            var t = d.getHours() + ':' + pad(d.getMinutes());
            if (t !== lastTime) {
                lastTime = t;
                timeEl.textContent = t;
            }
            var day = d.getDate() + ' ' + CLOCK_MONTHS[d.getMonth()] + ' ' +
                d.getFullYear() + 'г.';
            if (day !== lastDay) {
                lastDay = day;
                if (dayEl) dayEl.textContent = day;
                if (wdEl) wdEl.textContent = CLOCK_DAYS[d.getDay()];
            }
        }

        tick();
        setInterval(tick, 1000);
    }

    // ==================== ИНИЦИАЛИЗАЦИЯ ====================

    function initHome() {
        var screen = el('content-home');
        if (!screen) {
            console.warn('🏠 #content-home не найден — главная не запускается');
            return;
        }

        var topbar = el('home-topbar');
        if (topbar) {
            // Слушаем на перехвате: обработчики самих вкладок висят на кнопках,
            // и на всплытии главная уже была бы спрятана
            topbar.addEventListener('click', function (e) {
                var btn = e.target.closest ? e.target.closest('.home-nav-btn') : null;
                if (!btn) return;
                onNavButton(btn.id, true);
            }, true);
        }

        var rows = el('home-rows');
        if (rows) rows.addEventListener('click', onHomeRowsClick);

        startTopbarClock();
        patchGlobals();
        registerStrategy();
        initGestures();

        // Главная открывается сразу, не дожидаясь проверки TorrServer
        showHome({ initial: true });
        console.log('🏠 Главная страница инициализирована');
    }

    window.HomeScreen = {
        show: showHome,
        isActive: isHomeVisible,
        isFocusable: isHomeFocusable,
        ensureFocus: ensureHomeFocus,
        restoreFocus: restoreHomeFocus,
        handleBack: handleHomeBack,
        refresh: refreshHome,
        layout: layoutHome,
        stopTrailer: suspendHero,
        rearmTrailer: rearmHeroTrailer,
        state: homeState
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initHome);
    } else {
        initHome();
    }
})();
