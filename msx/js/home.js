// home.js — главная страница в стиле Netflix.
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
        POSTER_OBSERVER_MARGIN_PX: 1200,
        POSTER_CONCURRENCY: 10,
        VISIBILITY_WINDOW_ROWS: 2,
        VISIBILITY_FALLBACK_MARGIN_PX: 800,
        MAX_PARALLEL_ROW_LOADS: 3,
        FETCH_TIMEOUT_MS: 10000,
        ITEMS_PER_ROW: 20,
        // Тот же класс, что у каталога (styles.css): visibility: hidden.
        // display:none нельзя — обнулился бы прямоугольник, и наблюдатель уже
        // никогда не снял бы класс обратно.
        OFFSCREEN_CLASS: 'catalog-offscreen'
    };

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
        { key: 'popular_tv', name: 'Популярные сериалы', source: 'tmdb' }
    ];

    // Кнопки шапки: id → что делать по OK/клику
    var NAV_BUTTONS = ['home-nav-search', 'home-nav-home', 'home-nav-catalog',
        'home-nav-torrents', 'home-nav-donate', 'home-nav-settings'];

    var homeState = {
        built: false,            // ряды собраны и лежат в DOM
        loading: false,
        activated: false,        // фокус уже уехал на карточку → постеры можно грузить
        rows: [],                // [[card, ...], ...] в порядке показа
        rowKeys: [],             // ключ ряда по его индексу в rows
        data: {},                // key → items
        lastRowKey: null,        // куда вернуть фокус (возврат из detail/поиска)
        lastColIndex: 0,
        lastNavBtnId: 'home-nav-home',
        posterObserver: null,
        posterQueue: [],
        activePosterLoads: 0,
        pendingPosterRows: [],
        visibilityObserver: null,
        detailFromHome: false
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
    function posterUrlFor(path) {
        if (!path) return '';
        if (typeof window.getTmdbImageUrl === 'function') {
            return window.getTmdbImageUrl(path, posterSize());
        }
        var p = String(path);
        if (/^https?:\/\//i.test(p)) return p;
        if (p.charAt(0) !== '/') p = '/' + p;
        return 'https://tsimg.hnar.online/t/p/' + posterSize() + p;
    }

    function invalidateFocus() {
        if (typeof window.invalidateFocusCache === 'function') window.invalidateFocusCache();
    }

    /**
     * Запоминаем вертикальный скролл главной перед уходом на другой экран.
     * showContentScreen('home') при возврате читает именно AppState.contentScroll.home,
     * и без этого страница прыгала бы к началу: детальный просмотр, настройки и
     * донат уходят с главной, не вызывая showContentScreen вовсе.
     */
    function saveHomeScroll() {
        if (!window.AppState) return;
        var mc = el('main-container');
        if (!mc) return;
        AppState.contentScroll = AppState.contentScroll || {};
        AppState.contentScroll.home = mc.scrollTop;
    }

    /** Главная смонтирована и видна (шапка + ряды на экране) */
    function isHomeVisible() {
        var screen = el('content-home');
        if (!screen || screen.hidden) return false;
        var section = el('torrserver-section');
        if (section && section.style.display === 'none') return false;
        return true;
    }

    /** Главная не только видна, но и владеет фокусом (сверху нет оверлеев) */
    function isHomeFocusable() {
        return isHomeVisible() && !!(window.AppState && AppState.currentScreen === 'home');
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
    // запись {key, items, ts}.
    var DB_NAME = 'HomeCacheDB';
    var DB_VERSION = 1;
    var DB_STORE = 'collections';
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
                    tx.objectStore(DB_STORE).put({ key: key, items: items, ts: Date.now() });
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
     * Записи нет или ей больше 3 дней → запрос к серверу и перезапись.
     * Сеть молчит → рисуем просроченный кэш; и его нет — ряд не показываем.
     */
    function loadCollectionItems(cfg) {
        return dbGet(cfg.key).then(function (rec) {
            var fresh = rec && rec.items && rec.items.length &&
                (Date.now() - (rec.ts || 0)) < HOME.TTL_MS;
            if (fresh) return rec.items;

            return homeFetch(serverUrl() + '/api/tmdb/collection?preset=' +
                encodeURIComponent(cfg.key)).then(function (data) {
                    if (data && data.success && data.items && data.items.length) {
                        // Запись в IndexedDB не блокирует показ ряда
                        dbPut(cfg.key, data.items);
                        return data.items;
                    }
                    if (rec && rec.items && rec.items.length) {
                        console.warn('🏠 Подборка ' + cfg.key + ': сеть недоступна, берём просроченный кэш');
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
        row.className = 'catalog-row home-row';
        row.dataset.homeKey = cfg.key;

        // Заголовок без «Показать все»: у подборок TMDB нет экрана-сетки,
        // открывать по нему нечего
        var header = document.createElement('div');
        header.className = 'catalog-row-header';
        header.innerHTML = '<h2 class="catalog-row-title">' + esc(cfg.name) + '</h2>';
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
        homeState.rowKeys.push(cfg.key);
        return row;
    }

    // ==================== ЛЕНИВАЯ ЗАГРУЗКА ПОСТЕРОВ ====================

    function homeCards(root) {
        return (root || document).querySelectorAll('.catalog-row-card');
    }

    function observeCardsIn(root) {
        if (!homeState.posterObserver) return;
        var cards = root === document
            ? document.querySelectorAll('#home-rows .catalog-row-card')
            : homeCards(root);
        for (var i = 0; i < cards.length; i++) {
            if (cards[i].dataset.posterLoaded !== '1') homeState.posterObserver.observe(cards[i]);
        }
    }

    /**
     * Флаг posterLoaded ставится в момент попадания в зону видимости, до самой
     * загрузки. Если очередь после этого обнулили (пересоздание наблюдателя,
     * возврат на главную), карточка осталась бы с флагом и без картинки —
     * наблюдатель её больше не возьмёт. Тот же приём, что в catalog.js.
     */
    function resetStrandedPosters() {
        var cards = document.querySelectorAll('#home-rows .catalog-row-card');
        for (var i = 0; i < cards.length; i++) {
            if (cards[i].dataset.posterLoaded !== '1') continue;
            var box = cards[i].querySelector('.row-poster-img');
            if (box && !box.querySelector('img')) cards[i].dataset.posterLoaded = '0';
        }
    }

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

    function loadAllPostersDirect() {
        var cards = document.querySelectorAll('#home-rows .catalog-row-card');
        for (var i = 0; i < cards.length; i++) {
            var idx = parseInt(cards[i].dataset.itemIndex, 10);
            var items = homeState.data[cards[i].dataset.homeKey];
            if (isNaN(idx) || !items || !items[idx]) continue;
            if (cards[i].dataset.posterLoaded === '1') continue;
            cards[i].dataset.posterLoaded = '1';
            homeState.posterQueue.push({ card: cards[i], item: items[idx] });
        }
        processPosterQueue();
    }

    function initPosterObserver() {
        if (homeState.posterObserver) homeState.posterObserver.disconnect();
        homeState.posterQueue = [];
        homeState.activePosterLoads = 0;

        if (typeof IntersectionObserver !== 'function') {
            homeState.posterObserver = null;
            loadAllPostersDirect();
            return;
        }

        homeState.posterObserver = new IntersectionObserver(function (entries) {
            for (var i = 0; i < entries.length; i++) {
                if (!entries[i].isIntersecting) continue;
                var card = entries[i].target;
                if (card.dataset.posterLoaded === '1') continue;
                var idx = parseInt(card.dataset.itemIndex, 10);
                if (isNaN(idx)) continue;
                var items = homeState.data[card.dataset.homeKey];
                if (!items || !items[idx]) continue;
                card.dataset.posterLoaded = '1';       // защита от повторной постановки
                homeState.posterObserver.unobserve(card);
                homeState.posterQueue.push({ card: card, item: items[idx] });
            }
            processPosterQueue();
        }, { rootMargin: HOME.POSTER_OBSERVER_MARGIN_PX + 'px', threshold: 0.1 });

        observeCardsIn(document);
    }

    function resetPosterObserver() {
        if (homeState.posterObserver) {
            homeState.posterObserver.disconnect();
            homeState.posterObserver = null;
        }
        homeState.posterQueue = [];
        homeState.activePosterLoads = 0;
    }

    /**
     * До первого показа фокуса постеры не грузим вовсе: пользователь просил,
     * чтобы сначала уезжал фокус, а картинки подтягивались уже после. Ряды,
     * пришедшие в DOM раньше, ждут здесь.
     */
    function observeRowPosters(row) {
        if (!homeState.activated || !homeState.posterObserver) {
            homeState.pendingPosterRows.push(row);
            return;
        }
        observeCardsIn(row);
    }

    function flushPendingPosterRows() {
        homeState.pendingPosterRows = [];
        // initPosterObserver сам подхватывает все карточки, уже лежащие в DOM
        initPosterObserver();
    }

    // ==================== ОКОННАЯ ВИДИМОСТЬ РЯДОВ ====================
    //
    // Ряд дальше VISIBILITY_WINDOW_ROWS высот от вьюпорта получает
    // catalog-offscreen (visibility: hidden) и перестаёт отрисовываться.
    // visibility, а не display:none: бокс остаётся на месте, scrollHeight и
    // позиция скролла не меняются, наблюдатель продолжает видеть элемент,
    // а фокус по скрытым карточкам ходить может (offsetParent не null).

    function measureMargin(sample) {
        var h = sample ? sample.offsetHeight : 0;
        if (!h) return HOME.VISIBILITY_FALLBACK_MARGIN_PX;
        return Math.round(h * HOME.VISIBILITY_WINDOW_ROWS);
    }

    function createVisibilityObserver(marginPx) {
        return new IntersectionObserver(function (entries) {
            for (var i = 0; i < entries.length; i++) {
                var target = entries[i].target;
                // Прямоугольник нулевой — ряд не отрисован (ушли на другой экран,
                // секция погашена). Гасить по такому сообщению нельзя, иначе при
                // возврате увидим пустую страницу до следующего пересчёта.
                if (!entries[i].boundingClientRect.height) continue;
                if (entries[i].isIntersecting) target.classList.remove(HOME.OFFSCREEN_CLASS);
                else target.classList.add(HOME.OFFSCREEN_CLASS);
            }
        }, {
            root: el('main-container'),
            rootMargin: marginPx + 'px 0px',   // запас только по вертикали
            threshold: 0
        });
    }

    function initVisibilityObserver() {
        if (homeState.visibilityObserver) {
            homeState.visibilityObserver.disconnect();
            homeState.visibilityObserver = null;
        }
        if (typeof IntersectionObserver !== 'function') return;
        var rows = document.querySelectorAll('#home-rows .catalog-row');
        if (!rows.length) return;
        homeState.visibilityObserver = createVisibilityObserver(measureMargin(rows[0]));
        for (var i = 0; i < rows.length; i++) {
            rows[i].classList.remove(HOME.OFFSCREEN_CLASS);
            homeState.visibilityObserver.observe(rows[i]);
        }
    }

    /** Ряды добавляются по одному — наблюдателю отдаём их тоже по одному */
    function observeRowVisibility(row) {
        if (!homeState.visibilityObserver) { initVisibilityObserver(); return; }
        homeState.visibilityObserver.observe(row);
    }

    function resetVisibilityObserver() {
        if (!homeState.visibilityObserver) return;
        homeState.visibilityObserver.disconnect();
        homeState.visibilityObserver = null;
    }

    function revealAllHomeRows() {
        var rows = document.querySelectorAll('#home-rows .catalog-row');
        for (var i = 0; i < rows.length; i++) rows[i].classList.remove(HOME.OFFSCREEN_CLASS);
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
        homeState.rowKeys = [];
        homeState.data = {};
        homeState.activated = false;
        homeState.pendingPosterRows = [];
        resetPosterObserver();
        resetVisibilityObserver();

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
                requestAnimationFrame(function () {
                    if (!isHomeFocusable()) { flushPendingPosterRows(); return; }
                    if (typeof updateFocusableElements === 'function') updateFocusableElements();
                    setTimeout(function () {
                        if (isHomeFocusable()) restoreHomeFocus();
                        // Постеры включаются только теперь: фокус уже на карточке
                        flushPendingPosterRows();
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
                    observeRowPosters(row);
                    observeRowVisibility(row);
                    activate();
                }
                // Кэш фокуса в control.js держится на счётчике поколений DOM —
                // о новых карточках надо сказать явно
                if (appended) invalidateFocus();
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
                        resetVisibilityObserver();
                        invalidateFocus();
                        if (isHomeFocusable()) focusTopbar();
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

    // ==================== ФОКУС И НАВИГАЦИЯ ====================

    function scrollHomeToTop() {
        var mc = el('main-container');
        if (mc) mc.scrollTop = 0;
        if (window.AppState) {
            AppState.contentScroll = AppState.contentScroll || {};
            AppState.contentScroll.home = 0;
        }
    }

    function getNavButtons() {
        var out = [];
        for (var i = 0; i < NAV_BUTTONS.length; i++) {
            var b = el(NAV_BUTTONS[i]);
            if (b && b.offsetParent !== null) out.push(b);
        }
        return out;
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

    function focusCard(ri, ci) {
        var rows = homeState.rows;
        if (!rows[ri] || !rows[ri][ci]) return true;
        homeState.lastRowKey = homeState.rowKeys[ri];
        homeState.lastColIndex = ci;
        focusHomeEl(rows[ri][ci]);
        scrollToCard(rows[ri][ci]);
        return true;
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
        // Шапка липкая, но при уходе вверх из первого ряда всё равно поднимаем
        // страницу: иначе фокус на кнопке, а под ней виден обрезок ряда
        scrollHomeToTop();
        return focusHomeEl(target);
    }

    /** Возврат фокуса на ту карточку, с которой уходили (detail, поиск, донат) */
    function restoreHomeFocus() {
        var key = homeState.lastRowKey;
        if (key != null) {
            var card = document.querySelector('#home-rows .catalog-row-card[data-home-key="' +
                key + '"][data-item-index="' + homeState.lastColIndex + '"]');
            if (card && card.offsetParent !== null) {
                focusHomeEl(card);
                scrollToCard(card);
                return true;
            }
            var firstInRow = document.querySelector('#home-rows .catalog-row-card[data-home-key="' + key + '"]');
            if (firstInRow && firstInRow.offsetParent !== null) {
                focusHomeEl(firstInRow);
                scrollToCard(firstInRow);
                return true;
            }
        }
        if (homeState.rows.length) return focusCard(0, 0);
        return focusTopbar();
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
        if (!target || !target.closest) return false;
        return !!target.closest('#content-home');
    }

    function handleHomeNavigation(dir) {
        var f = document.querySelector('.focused');
        var btns = getNavButtons();
        var bi = (f && btns.indexOf) ? btns.indexOf(f) : -1;

        if (bi !== -1) {
            homeState.lastNavBtnId = f.id || homeState.lastNavBtnId;
            if (dir === 'left') return focusHomeEl(btns[Math.max(0, bi - 1)]);
            if (dir === 'right') return focusHomeEl(btns[Math.min(btns.length - 1, bi + 1)]);
            if (dir === 'down') {
                if (!homeState.rows.length) return true;
                return restoreHomeFocus();
            }
            return true;   // вверх с шапки уходить некуда
        }

        var pos = f ? findCardPosition(f) : null;
        if (!pos) return ensureHomeFocus(true);
        var rows = homeState.rows;

        if (dir === 'left') {
            if (pos.col > 0) return focusCard(pos.row, pos.col - 1);
            return true;
        }
        if (dir === 'right') {
            if (pos.col < rows[pos.row].length - 1) return focusCard(pos.row, pos.col + 1);
            return true;
        }
        if (dir === 'up') {
            if (pos.row > 0) {
                return focusCard(pos.row - 1, Math.min(pos.col, rows[pos.row - 1].length - 1));
            }
            return focusTopbar();
        }
        if (dir === 'down') {
            if (pos.row < rows.length - 1) {
                return focusCard(pos.row + 1, Math.min(pos.col, rows[pos.row + 1].length - 1));
            }
            return true;
        }
        return true;
    }

    function handleHomeBack() {
        var f = document.querySelector('.focused');
        var btns = getNavButtons();
        if (f && btns.indexOf(f) !== -1) return true;    // уже в шапке — уходить некуда
        if (f && findCardPosition(f)) { focusTopbar(); return true; }
        ensureHomeFocus(true);
        return true;
    }

    // ==================== ДЕЙСТВИЯ ====================

    function openHomeItem(item, key, index) {
        homeState.lastRowKey = key;
        homeState.lastColIndex = index;
        homeState.detailFromHome = true;
        saveHomeScroll();
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

    function onNavButton(id) {
        homeState.lastNavBtnId = id;
        saveHomeScroll();
        if (id === 'home-nav-search') return openSearchFromHome();
        if (id === 'home-nav-home') {
            scrollHomeToTop();
            if (homeState.rows.length) return focusCard(0, 0);
            return true;
        }
        if (id === 'home-nav-catalog') return clickHidden('tab-catalog');
        if (id === 'home-nav-torrents') return clickHidden('tab-torrents');
        if (id === 'home-nav-donate') return clickHidden('tab-donate');
        if (id === 'home-nav-settings') return clickHidden('settings-btn');
        return false;
    }

    function onHomeOk(f) {
        if (!f) return ensureHomeFocus(true);
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
        // Обёртка ниже показывает #content-home и добавляет класс home-active.
        if (typeof window.showContentScreen === 'function') window.showContentScreen('home');
        else if (window.AppState) AppState.currentScreen = 'home';
        screen.hidden = false;

        if (window.AppState) {
            AppState.inSearch = 'home';
            AppState.searchReturnTo = null;
            AppState.isSearch = false;
            AppState.isCatalogSearch = false;
        }
        invalidateFocus();

        if (!homeState.built && !homeState.loading) {
            homeState.loading = true;
            loadHomeRows().then(function (ok) {
                homeState.loading = false;
                homeState.built = !!ok;
            });
            return true;
        }

        // Ряды уже в DOM: наблюдателей могла отключить чистка памяти или уход
        // на другой экран — поднимаем заново, иначе постеры больше не догружаются
        revealAllHomeRows();
        resetStrandedPosters();
        initPosterObserver();
        initVisibilityObserver();
        homeState.activated = true;

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
            homeState.built = false;
            homeState.loading = false;
            homeState.lastRowKey = null;
            homeState.lastColIndex = 0;
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
            var section = el('torrserver-section');
            // Уходя с главной, сохраняем её скролл сами: оригинал запоминает
            // позицию только для torrents и catalog
            if (window.AppState && AppState.currentScreen === 'home' && screen !== 'home') {
                var mc = el('main-container');
                AppState.contentScroll = AppState.contentScroll || {};
                if (mc) AppState.contentScroll.home = mc.scrollTop;
                homeState.detailFromHome = false;
            }
            if (homeScreen) homeScreen.hidden = (screen !== 'home');
            if (section) {
                if (screen === 'home') section.classList.add('home-active');
                else section.classList.remove('home-active');
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

    // ==================== ИНИЦИАЛИЗАЦИЯ ====================

    function initHome() {
        var screen = el('content-home');
        if (!screen) {
            console.warn('🏠 #content-home не найден — главная не запускается');
            return;
        }

        var topbar = el('home-topbar');
        if (topbar) {
            topbar.addEventListener('click', function (e) {
                var btn = e.target.closest ? e.target.closest('.home-nav-btn') : null;
                if (!btn) return;
                onNavButton(btn.id);
            });
        }

        var rows = el('home-rows');
        if (rows) rows.addEventListener('click', onHomeRowsClick);

        patchGlobals();
        registerStrategy();

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
        state: homeState
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initHome);
    } else {
        initHome();
    }
})();
