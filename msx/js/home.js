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
        // Вход в категорию: столько гаснет главная (openCategory), дальше сетка
        // проявляется сама, когда нарисована. Коротко — это уже ожидание
        CATEGORY_FADE_S: 0.2,
        // Карточка фильма закрывает главную за ~0,38 с (DETAIL_FADE.show в
        // animations.js) — после этого трейлер разбираем и ряд возвращаем к началу
        DETAIL_COVER_MS: 450,
        POSTER_CONCURRENCY: 10,
        MAX_PARALLEL_ROW_LOADS: 3,
        FETCH_TIMEOUT_MS: 10000,
        ITEMS_PER_ROW: 20,
        // Ряд вне экрана — display:none. У каталога для этого visibility:hidden
        // (catalog-offscreen), но там ряды остаются на своих местах в потоке,
        // а здесь скрытый ряд не должен занимать высоту вовсе.
        HIDDEN_ROW_CLASS: 'home-row-hidden',
        // Соседний ряд (±1 от показанного), заранее разложенный, но невидимый:
        // position: absolute + visibility: hidden поверх показанного. Первый
        // показ ряда из display:none — это расчёт стилей ~190 элементов прямо
        // в обработчике «вниз» (замер на Chrome 66: 35 мс на ПК против 5 мс у
        // уже показанного). Прогретый ряд переключается за те же 5 мс.
        // HIDDEN_ROW_CLASS на нём остаётся — по нему списки фокуса (getItems
        // здесь и в control.js) отсекают ряды вне экрана.
        WARM_ROW_CLASS: 'home-row-warm',

        // --- баннер и раскладка ---
        // Доля свободной высоты под ряд; остальное достаётся баннеру
        ROW_SHARE: 0.48,
        HERO_MIN_H: 190,
        // На низком экране (телефон в альбомной ориентации, ~410px) минимум баннера —
        // эта доля свободной высоты: с жёсткими 190px ряд с карточкой минимальной
        // ширины не помещался, и низ карточек уходил за экран. На ТВ доля больше
        // 190px, и там всё как было
        HERO_MIN_SHARE: 0.45,
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
        // Логотип названия. Обычно он уже лежит в элементе подборки (item.logo,
        // сервер кладёт его при сборке), а картинки логотипов показанного ряда
        // грузятся заранее (preloadNearLogos) — баннер ставит логотип сразу.
        // Нет поля logo («Продолжить просмотр», старый сервер) — спрашиваем
        // GET /api/tmdb/logo. Пока ждём — текст названия невидим; не дождались
        // за LOGO_WAIT_MS — показываем текст, логотип придёт — встанет на место.
        LOGO_WAIT_MS: 700,
        LOGO_FETCH_TIMEOUT_MS: 6000,
        LOGO_SIZE: 'w500',
        // Заранее грузим логотипы карточек рядом с фокусом (±LOGO_NEAR), в
        // простое и не больше LOGO_PRELOAD_MAX за раз. Раньше грузился сразу
        // весь ряд (20 картинок) в момент перехода на него — замер на
        // эмуляторе ТВ: +25–30 мс к каждому «вниз» против версии без логотипов.
        LOGO_NEAR: 2,
        LOGO_PRELOAD_MAX: 2,
        // Кадры и логотипы соседних карточек (±ART_NEAR) — фоновым потоком
        // (PosterPrefetch) в HTTP-кэш, когда фокус постоял ART_PREFETCH_DELAY_MS
        // и кнопку не держат. Тот же кадр w1280 и логотип w500 берёт и
        // карточка фильма (catalog.js), так что открывается она тоже из кэша.
        ART_NEAR: 2,
        ART_PREFETCH_DELAY_MS: 150,
        // Под заставкой запуска (prefetchHomeStartup) — всё, что понадобится на
        // главной дальше первого экрана: картинки STARTUP_ITEMS карточек каждого
        // ряда, кадры баннера первых STARTUP_BACKDROPS, логотипы, баннеры плиток
        // категорий (STARTUP_CAT_BANNERS фильмов каждой). Уже скачанное приходит
        // из HTTP-кэша мгновенно, так что второй запуск почти ничего не качает
        // Ряд целиком: при переходе на ряд loadRowPosters грузит все его
        // плитки, и с 12 последние восемь шли по сети (замер: 100–500 мс)
        STARTUP_ITEMS: 20,
        STARTUP_BACKDROPS: 2,
        STARTUP_CAT_BANNERS: 2,
        // Заглушка загрузчика ждёт постеры первого ряда и картинку баннера,
        // но не дольше этого после появления ряда: медленное зеркало не должно
        // держать пользователя перед заставкой. Опрос готовности — с этим шагом
        LOADER_POSTERS_MAX_MS: 6000,
        // Сколько от старта заставка ждёт проверку обновления каталогов
        // (catalog-idb-patch.js: CatalogStartup); дальше она идёт в фоне
        LOADER_CATALOGS_MAX_MS: 8000,
        LOADER_POLL_MS: 100,
        // Столько заполняется кругляшок; заполнился — включаем трейлер
        TRAILER_DELAY_MS: 5000,
        // Длина окружности кругляшка: 2πr при r = 19 (см. viewBox 0 0 44 44)
        RING_LEN: 119.4,
        // Шаг заполнения кругляшка. Не CSS-переход: анимация stroke-dashoffset
        // идёт на главном потоке, и все 5 с отсчёта — а он заводится заново на
        // каждой карточке, то есть всё время, пока листают ряд, — браузер
        // пересчитывал и перерисовывал кадр 60 раз в секунду (замер на Chrome 66:
        // ~70 кадров главного потока и ~55 отрисовок за 2 с против 4 и 2 без
        // кругляшка). Таймером — 4 обновления в секунду.
        RING_TICK_MS: 250,
        // Как часто проверять, что играющий трейлер всё ещё «свой» и на экране
        WATCHDOG_MS: 1000,
        // Постеры соседних рядов подтягиваем заранее, но не мешая текущему
        PREFETCH_DELAY_MS: 700,

        // --- плитки категорий (ряд «Категории», см. раздел «БАННЕР: КАТЕГОРИЯ») ---
        // Фильмы категории на баннере сменяются по концу трейлера, а если
        // трейлеры выключены (или трейлер не нашёлся, не запустился) — через
        // столько после показа фильма
        CATEGORY_ROTATE_MS: 20000,
        // Затухание кадра и подписей при смене фильма; то же число — transition в CSS
        CATEGORY_FADE_MS: 350,
        // Дольше этого погасший баннер кадра следующего фильма не ждёт
        CATEGORY_REVEAL_MAX_MS: 1500,
        // Сколько загруженных картинок баннера держать элементами (createImgStore)
        HERO_BACKDROP_KEEP: 3,
        // Логотипы лёгкие; запас — на соседей обоих рядов (preloadNearLogos ±2)
        // и плитки категории, иначе вытесненный логотип грузился бы второй раз
        HERO_LOGO_KEEP: 10,
        // Сколько ждать картинку плитки с одного зеркала, прежде чем идти на следующее
        TILE_IMG_TIMEOUT_MS: 4000,
        // Списка категории нет в памяти: столько ждём его, не трогая прежний
        // баннер, потом показываем заглушку с названием категории
        CATEGORY_PLACEHOLDER_MS: 400,
        // Подпись под плиткой категории (название): 12% высоты ряда в этих пределах
        CATEGORY_LABEL_PX: 40,
        CATEGORY_LABEL_MIN_PX: 22,
        // Плитка не шире этой доли экрана — соседняя выглядывает и на телефоне
        CATEGORY_TILE_MAX_SHARE: 0.62,

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

    // Порядок рядов сверху вниз. key для подборок TMDB — это preset эндпоинта.
    var HOME_ROWS = [
        { key: 'history', name: 'Продолжить просмотр', source: 'history' },
        // Плитки категорий каталога (CATALOG_CONFIG в catalog.js) — вместо
        // отдельного раздела «Каталог». OK открывает категорию сеткой, а
        // «назад» из неё возвращает сюда (showCatalogList → главная)
        { key: 'categories', name: 'Категории', source: 'categories' },
        // Сезонная подборка (SEASONS в config.js): вне окна ряда нет вовсе.
        // Отдаёт её модуль halloween-collection — url вместо source: 'tmdb',
        // формат ответа тот же. Модуль не установлен — 404, ряд пустой и не рисуется.
        { key: 'halloween', name: 'Хэллоуин', url: '/api/halloween/collection', season: 'halloween' },
        { key: 'trending_week', name: 'В тренде на этой неделе', source: 'tmdb' },
        { key: 'pop_streaming', name: 'Что популярно · Онлайн', source: 'tmdb' },
        { key: 'pop_ontv', name: 'Что популярно · По ТВ', source: 'tmdb' },
        { key: 'pop_rent', name: 'Что популярно · Напрокат', source: 'tmdb' },
        { key: 'pop_theatres', name: 'Что популярно · В кинотеатрах', source: 'tmdb' },
        { key: 'top_movies', name: 'Топ рейтинга: фильмы', source: 'tmdb' },
        { key: 'top_tv', name: 'Топ рейтинга: сериалы', source: 'tmdb' },
        { key: 'popular_movies', name: 'Популярные фильмы', source: 'tmdb' },
        { key: 'popular_tv', name: 'Популярные сериалы', source: 'tmdb' },
        // Подборки Кинопоиска (модуль kinopoisk-collections). Здесь только
        // мелкие — те, где элементов пятьдесят и меньше: на категорию каталога
        // такой не хватает, а на ряд в самый раз. Крупные лежат категориями в
        // CATALOG_CONFIG (catalog.js), сразу после «Русских».
        // source отличается от 'tmdb' только эндпоинтом, см. loadCollectionItems;
        // формат ответа и кэш в IndexedDB — общие. Модуль не установлен —
        // запрос отвечает 404, ряд получает пустой список и не рисуется.
        { key: 'kp_zombie', name: 'Кинопоиск · Про зомби', source: 'kinopoisk' },
        { key: 'kp_vampire', name: 'Кинопоиск · Про вампиров', source: 'kinopoisk' },
        { key: 'kp_disaster', name: 'Кинопоиск · Катастрофы', source: 'kinopoisk' },
        { key: 'kp_kids', name: 'Кинопоиск · Мультфильмы детям', source: 'kinopoisk' }
    ];

    // Кнопки общей шапки #home-topbar в порядке DOM — по нему ходит навигация
    // влево/вправо. Это те же самые элементы, что и вкладки разделов
    // (#tab-*, #settings-btn): свои обработчики у них уже есть, новая тут
    // только «Главная» (#home-nav-home). «Каталога» нет: его категории — ряд
    // главной, а кнопка #tab-catalog осталась в разметке скрытой (на неё
    // ссылаются app.js и catalog.js)
    var NAV_BUTTONS = ['home-nav-home', 'tab-torrents',
        'tab-donate', 'tab-favorites', 'tab-search', 'settings-btn'];

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
        historySync: null,       // идущий запрос истории (updateHistoryResume)
        historyAgain: null,      // повтор следом за ним
        historyGen: 0,           // счётчик удалений из ряда «Продолжить просмотр»
        historyMore: false,      // в истории на сервере записей больше, чем в ряду
        lastRowKey: null,       // куда вернуть фокус (возврат из detail/поиска)
        lastColIndex: 0,
        lastNavBtnId: 'home-nav-home',
        posterQueue: [],
        activePosterLoads: 0,
        prefetchTimer: null,
        resizeTimer: null,
        cardWidth: 0,            // текущая ширина плитки ряда (её же держит <style>)
        cardCssKey: null,        // размеры, под которые написан <style> (applyCardCss)
        tileImgSize: 'w300',     // размер кадра TMDB для плиток — от их ширины
        heroTopCache: null,      // {h, w, top} — замер отступа баннера, см. cachedHeroTop
        heroDetails: {},         // id_mediaType → полные детали TMDB
        // id_mediaType → {url, loaded} | null (логотипа нет). Нет ключа — ещё
        // не спрашивали. На сессию: сервер держит свой кэш на неделю.
        logos: {},
        logoInflight: {},
        // backdrop_path → адрес зеркала, отдавшего кадр (preloadBackdrop), и
        // ожидающие его загрузки
        goodBackdrops: {},
        backdropWaiters: {},
        logoUnsupported: false,  // сервер без /api/tmdb/logo (старая версия)
        hero: {
            key: null,           // id_mediaType показанного элемента
            pendingKey: null,    // то же для элемента, ждущего в дебаунсе
            item: null,
            timer: null,         // дебаунс смены баннера
            ringTimer: null,     // «кругляшок заполнился»
            ringTick: null,      // шаги заполнения кругляшка (RING_TICK_MS)
            ringDone: false,
            gen: 0,              // поколение: гасит ответы по устаревшему элементу
            backdropUrl: null,
            trailerUrl: null,
            trailerSearched: false,
            video: null,
            hls: null,
            watchdog: null,       // «главная ещё на экране?» пока играет трейлер
            logoTimer: null,      // LOGO_WAIT_MS: не дождались логотипа → текст
            logoKey: null,        // чей логотип ждёт баннер (applyHeroLogo)
            // Фокус на плитке категории: баннер по кругу показывает её фильмы
            cat: {
                key: null,        // категория на баннере; null — обычный режим
                list: [],
                index: 0,
                seq: 0,           // поколение показа категории (не путать с gen)
                timer: null,      // смена фильма (CATEGORY_ROTATE_MS)
                fadeTimer: null,
                placeholderTimer: null
            }
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
        return getPrimaryImageBase() + size + p;
    }

    function posterUrlFor(path) { return tmdbImage(path, posterSize()); }
    /**
     * Кадр баннера — всегда w1280. Плитка ряда берёт тот же кадр меньшего
     * размера (tileImgSize): общий файл с баннером значил бы w1280 в каждой
     * плитке — около 3,6 МБ памяти на плитку после декодирования, на
     * телевизоре это слишком, а w780 во всю ширину баннера выходит мыльным.
     */
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

    /**
     * Первый ряд на экране — но заглушку снимаем, только когда главная
     * дорисована: постеры видимых карточек готовы (загрузились или упали —
     * «Нет постера» тоже готовый вид) и баннер с картинкой. Иначе после
     * заставки секунду-другую видны пустые рамки. Не дольше
     * LOADER_POSTERS_MAX_MS. Опрос, а не событие: постеры идут через очередь
     * и setRowPosterImg с перебором зеркал, общего «готово» у них нет; проверка
     * — десяток карточек раз в 100 мс.
     */
    function dismissLoaderWhenReady() {
        if (!moduleLoaderUp()) return;
        var started = Date.now();
        (function check() {
            if (!moduleLoaderUp()) return;
            var postersPart = (visiblePostersReady() && heroBackdropReady()) ||
                Date.now() - started >= HOME.LOADER_POSTERS_MAX_MS;
            if (!isHomeVisible() || (postersPart && catalogsStartupReady())) {
                dismissModuleLoader();
                // Под заглушкой отсчёт трейлера не заводится (startTrailerCountdown),
                // а фокус на первую карточку встал раньше — заводим его теперь
                rearmHeroTrailer();
                return;
            }
            setTimeout(check, HOME.LOADER_POLL_MS);
        })();
    }

    /**
     * Проверка обновления каталогов закончилась или ждать её дольше нельзя
     * (HOME.LOADER_CATALOGS_MAX_MS от её старта). Нет самого модуля (старая
     * копия catalog-idb-patch.js на зеркале) или проверка не запускалась —
     * считаем готовым: заставку из-за этого не держим.
     */
    function catalogsStartupReady() {
        var cs = window.CatalogStartup;
        if (!cs || typeof cs.isDone !== 'function') return true;
        var at = cs.startedAt();
        if (!at || cs.isDone()) return true;
        return Date.now() - at >= HOME.LOADER_CATALOGS_MAX_MS;
    }

    /** Карточки показанного ряда, попадающие в экран: постер вставлен или не нашёлся */
    function visiblePostersReady() {
        var cards = homeState.rows[homeState.activeRow];
        if (!cards || !cards.length) return false;
        var w = window.innerWidth;
        var seen = 0;
        for (var i = 0; i < cards.length; i++) {
            var r = cards[i].getBoundingClientRect();
            if (!r.width) return false;             // ряд ещё не разложен
            if (r.left >= w) break;                 // дальше — за правым краем
            seen++;
            var d = cards[i].dataset;
            if (d.posterLoaded !== '1' || d.posterPending === '1') return false;
        }
        return seen > 0;
    }

    /**
     * Картинка баннера на месте, или зеркала её не отдали — ждать нечего.
     * Баннер ещё не выбрал фильм (фокус не на карточке: на старте экран
     * может числиться за торрентами) — тоже не ждём: ему нечего грузить
     */
    function heroBackdropReady() {
        var box = el('home-hero-backdrop');
        if (!box || (!homeState.hero.key && !homeState.hero.pendingKey)) return true;
        return backdropFailed || !box.classList.contains('home-hero-empty');
    }

    function homeFetch(url) {
        return new Promise(function (resolve) {
            var ctrl = null;
            try { ctrl = new AbortController(); } catch (e) { ctrl = null; }
            var timer = setTimeout(function () {
                if (ctrl) { try { ctrl.abort(); } catch (e) { } }
            }, HOME.FETCH_TIMEOUT_MS);
            // История, подборки, детали — через фоновый поток (BgFetch в
            // poster-prefetch.js): запрос и разбор JSON идут в воркере
            var init = ctrl ? { signal: ctrl.signal } : {};
            (window.bgFetch ? window.bgFetch(url, init) : fetch(url, init))
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
    // 3 — элементы несут logo (логотип названия): подборки, сохранённые раньше,
    // перезапрашиваем разом, а не спрашиваем логотип на каждой карточке.
    var ITEMS_SCHEMA_VERSION = 3;
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

    function historyRowItem(it) {
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
            isHistoryItem: true,
            // Где остановились — для «Продолжить» в баннере (heroResume)
            resume: it.resume || null
        };
    }

    function loadHistoryItems() {
        return homeFetch(withClientId(serverUrl() + '/api/history')).then(function (data) {
            if (!data || !data.success || !data.history || !data.history.length) return [];
            homeState.historyMore = data.history.length > HOME.ITEMS_PER_ROW;
            return data.history.slice(0, HOME.ITEMS_PER_ROW).map(historyRowItem);
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

            // Подборки Кинопоиска и сезонные отдают модули-расширения, всё
            // остальное — routes/tmdb.js. Формат ответа у них одинаковый,
            // поэтому дальше ветвиться уже незачем.
            var url = cfg.url ? serverUrl() + cfg.url
                : cfg.source === 'kinopoisk'
                ? serverUrl() + '/api/kinopoisk/collection?preset=' + encodeURIComponent(cfg.key)
                : serverUrl() + '/api/tmdb/collection?preset=' + encodeURIComponent(cfg.key);

            return homeFetch(url).then(function (data) {
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

    /**
     * Плитки ряда «Категории»: категории каталога в его порядке, без истории
     * (она тут же рядом «Продолжить просмотр») и избранного (своя кнопка в
     * шапке). Без сети: список задан в CATALOG_CONFIG, оформление — CATEGORY_ART.
     */
    function loadCategoryTiles() {
        var cfgs = (typeof CATALOG_CONFIG !== 'undefined') ? CATALOG_CONFIG : {};
        var out = [];
        for (var k in cfgs) {
            if (!cfgs.hasOwnProperty(k)) continue;
            var c = cfgs[k];
            if (!c || c.isHistory || c.isFavorites || !c.url) continue;
            out.push({ catKey: k, name: c.name });
        }
        return Promise.resolve(out);
    }

    function loadRowItems(cfg) {
        if (cfg.source === 'history') return loadHistoryItems();
        if (cfg.source === 'categories') return loadCategoryTiles();
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
            // Логотип и название — в рамке постоянной высоты (styles.css,
            // #home-hero-head): иначе подписи прыгали вверх-вниз на каждом шаге
            // по ряду — у одного фильма название в строку, у другого в две, у
            // третьего логотип
            '<div id="home-hero-head">' +
            '<div id="home-hero-logo"><img alt=""></div>' +
            '<h1 id="home-hero-title"></h1>' +
            '</div>' +
            '<div id="home-hero-meta"></div>' +
            '<div id="home-hero-overview"></div>' +
            // Кнопки — в одном flex-ряду: стрелки тянутся по высоте «Смотреть»
            // при любом кегле из медиазапросов (styles.css, .home-hero-actions)
            '<div class="home-hero-actions">' +
            // «Подробнее» тут намеренно нет: карточка открывается OK прямо с ряда
            '<button type="button" class="home-hero-btn" id="home-play-btn" hidden>' +
            '<span class="home-hero-btn-icon">▶</span><span id="home-play-label">Смотреть</span></button>' +
            // Листание фильмов категории — только пока фокус на её плитке
            // (setCategoryArrows); у обычной карточки их нет
            '<button type="button" class="home-hero-btn home-hero-arrow" id="home-prev-btn" hidden' +
            ' title="Предыдущий"><i class="fi fi-rr-angle-left"></i></button>' +
            '<button type="button" class="home-hero-btn home-hero-arrow" id="home-next-btn" hidden' +
            ' title="Следующий"><i class="fi fi-rr-angle-right"></i></button>' +
            // Какой фильм категории из скольких — только когда фокус на плитке
            // категории (раздел «БАННЕР: КАТЕГОРИЯ»). В ряду кнопок, а не в
            // углу баннера: там кругляшок трейлера, и его место в каждом
            // медиазапросе своё
            '<div class="home-hero-dots" id="home-hero-dots" hidden></div>' +
            '</div>' +
            '</div>';

        var rows = el('home-rows');
        if (rows) screen.insertBefore(hero, rows);
        else screen.appendChild(hero);

        hero.addEventListener('click', function (e) {
            if (!e.target.closest) return;
            if (e.target.closest('#home-play-btn')) playHeroItem();
            else if (e.target.closest('#home-prev-btn')) stepCategory(-1);
            else if (e.target.closest('#home-next-btn')) stepCategory(1);
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
     * Загруженные картинки баннера — сами элементы <img>, по адресу.
     *
     * Раньше картинку проверяли отдельным new Image(), а показывали адресом:
     * кадр — через background-image, логотип — через src у <img> в разметке.
     * Это второй запрос той же картинки: из кэша памяти, а у зеркал без
     * заголовков кэширования — и по сети заново. Теперь в баннер встаёт тот
     * самый элемент, что уже загрузился, и второго запроса нет вовсе.
     *
     * Держим немного: декодированный кадр 1280 — мегабайты памяти, а на
     * телевизоре её мало. Кадров — текущий и два соседа (смена фильма
     * категории), логотипов — побольше, они маленькие.
     */
    function createImgStore(max) {
        var order = [];
        var map = {};
        return {
            get: function (url) { return (url && map[url]) || null; },
            put: function (url, img) {
                if (!url || !img) return;
                var i = order.indexOf(url);
                if (i !== -1) order.splice(i, 1);
                order.push(url);
                map[url] = img;
                while (order.length > max) delete map[order.shift()];
            }
        };
    }
    var backdropImgs = createImgStore(HOME.HERO_BACKDROP_KEEP);
    var logoImgs = createImgStore(HOME.HERO_LOGO_KEEP);

    /** Кадр в баннер — загруженным элементом (см. createImgStore) */
    function showBackdropImg(box, img) {
        img.className = 'home-hero-bd-img';
        img.alt = '';
        if (img.parentNode !== box) {
            while (box.firstChild) box.removeChild(box.firstChild);
            box.appendChild(img);
        }
        box.classList.remove('home-hero-empty');
    }

    /**
     * Ровная тёмная подложка вместо картинки: снимаем и сам кадр, иначе в
     * баннере оставался кадр ПРОШЛОГО фильма, хотя новый не загрузился.
     */
    function clearHeroBackdrop() {
        var box = el('home-hero-backdrop');
        if (!box) return;
        while (box.firstChild) box.removeChild(box.firstChild);
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
    function applyHeroBackdrop(url, extra, onDone) {
        var box = el('home-hero-backdrop');
        // onDone — один раз, когда кадр встал или показывать нечего: по нему
        // смена фильма категории проявляет баннер (showCategoryItem)
        var doneCalled = false;
        var done = function () {
            if (doneCalled || typeof onDone !== 'function') return;
            doneCalled = true;
            onDone();
        };
        if (!box) { done(); return; }

        var queue = [];
        pushMirrors(queue, url);
        pushMirrors(queue, extra);
        if (!queue.length) {
            backdropLoad++;
            cancelBackdropTimer();
            homeState.hero.backdropUrl = null;
            clearHeroBackdrop();
            done();
            return;
        }
        // Этот кадр уже запрашивали (renderHero зовётся второй раз, с деталями) —
        // не перезапускаем цепочку, пока она идёт или уже показала картинку.
        // Ключ — первый кандидат, а не удавшийся: иначе успех с запасного
        // зеркала выглядел бы как новый запрос и мигал бы подложкой.
        if (homeState.hero.backdropUrl === queue[0] && !backdropFailed) { done(); return; }

        // Кадр уже загружен (заранее — preloadBackdrop, или показывали его
        // недавно) — ставим тот же элемент сразу, без запроса и без перебора
        for (var c = 0; c < queue.length; c++) {
            var ready = backdropImgs.get(queue[c]);
            if (!ready) continue;
            backdropLoad++;
            cancelBackdropTimer();
            homeState.hero.backdropUrl = queue[0];
            backdropFailed = false;
            showBackdropImg(box, ready);
            done();
            return;
        }
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
            if (at >= queue.length) { backdropFailed = true; fallback(); done(); return; }
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
                backdropImgs.put(candidate, img);
                showBackdropImg(box, img);
                done();
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

    function renderHero(item, details, onBackdrop) {
        var hero = ensureHeroDom();
        if (!hero) { if (onBackdrop) onBackdrop(); return; }
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
        setPlayLabel(item);

        // Постер — запас на две беды: у ряда «Продолжить просмотр» широкого кадра
        // нет вовсе, а у остальных он может не отдаться ни с одного зеркала.
        // Размер тот же, что у карточки: этот файл уже лежит в кэше браузера.
        var path = src.backdrop_path || (item && item.backdrop_path);
        var poster = (src.poster_path || (item && item.poster_path)) || '';
        // Кадр уже загружали заранее (preloadBackdrop) — начинаем с зеркала,
        // которое его отдало: картинка в кэше, и встанет она без перебора
        var bd = path ? (homeState.goodBackdrops[path] || backdropUrlFor(path)) : '';
        applyHeroBackdrop(bd, poster ? posterUrlFor(poster) : '', onBackdrop);
    }

    /**
     * Кадр баннера — в кэш браузера заранее, с тем же перебором зеркал, что у
     * applyHeroBackdrop. Удачный адрес запоминаем (goodBackdrops): по нему
     * renderHero потом ставит кадр сразу. done(ok) — когда кадр готов или
     * зеркала кончились.
     */
    function preloadBackdrop(path, done) {
        if (!path) { if (done) done(false); return; }
        // Готово, только пока сам элемент ещё в backdropImgs: вытесненный
        // оттуда кадр показ загрузил бы заново
        if (backdropImgs.get(homeState.goodBackdrops[path])) { if (done) done(true); return; }
        var waiting = homeState.backdropWaiters[path];
        if (waiting) { if (done) waiting.push(done); return; }
        waiting = homeState.backdropWaiters[path] = done ? [done] : [];
        var queue = [];
        // Кадр уже отдавало какое-то зеркало (прошлый показ) — с него и
        // начинаем, не ждём упавшее первое
        pushMirrors(queue, homeState.goodBackdrops[path] || backdropUrlFor(path));
        loadFirstImg(queue, HOME.BACKDROP_GRACE_MS, function (img, url) {
            if (url) {
                homeState.goodBackdrops[path] = url;
                // Показ возьмёт этот же элемент — второго запроса не будет
                backdropImgs.put(url, img);
            }
            delete homeState.backdropWaiters[path];
            for (var i = 0; i < waiting.length; i++) waiting[i](!!url);
        });
    }

    /**
     * Первая отдавшая картинка из queue — адреса по порядку, обычно зеркала
     * одного файла (pushMirrors). На каждого — не дольше timeoutMs: зеркало
     * может молчать вовсе, ни load, ни error. done(img, url), не вышло —
     * done(null, null). alive() — ещё нужна ли картинка (плитку могли убрать).
     */
    function loadFirstImg(queue, timeoutMs, done, alive) {
        var at = 0;
        var next = function () {
            if (at >= queue.length || (alive && !alive())) { done(null, null); return; }
            var url = queue[at++];
            var img = new Image();
            img.decoding = 'async';
            var settled = false;
            var timer = setTimeout(function () {
                if (settled) return;
                settled = true;
                next();
            }, timeoutMs);
            img.onload = function () {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (img.naturalWidth) done(img, url); else next();
            };
            img.onerror = function () {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                next();
            };
            img.src = url;
        };
        next();
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

        // С плитки категории ушли на фильм — её показ закончен
        leaveCategoryHero();
        stopHeroTrailer();
        resetHeroRing();
        homeState.hero.key = k;
        homeState.hero.pendingKey = k;
        homeState.hero.item = item;
        homeState.hero.trailerUrl = null;
        homeState.hero.trailerSearched = false;

        var cached = homeState.heroDetails[k] || null;
        renderHero(item, cached);
        applyHeroLogo(item, k);

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

    // ==================== БАННЕР: ЛОГОТИП НАЗВАНИЯ ====================

    /**
     * Логотип из данных элемента: {url, loaded} — есть, null — у TMDB нет,
     * undefined — данные о нём молчат (поля logo нет).
     */
    function logoFromData(src) {
        if (!src || !Object.prototype.hasOwnProperty.call(src, 'logo')) return undefined;
        return (src.logo && src.logo.file_path)
            ? { url: tmdbImage(src.logo.file_path, HOME.LOGO_SIZE), loaded: false }
            : null;
    }

    /** Что известно о логотипе без сети: запомненное, из элемента, из деталей */
    function knownLogo(item, k) {
        if (Object.prototype.hasOwnProperty.call(homeState.logos, k)) return homeState.logos[k];
        var info = logoFromData(item);
        if (info === undefined) info = logoFromData(homeState.heroDetails[k]);
        if (info !== undefined) homeState.logos[k] = info;
        return info;
    }

    /**
     * Адрес логотипа, который главная уже знает, — для карточки фильма
     * (renderCinemaLogo в catalog.js): в ответе /api/tmdb/details логотипа нет,
     * а спрашивать его отдельно — лишний запрос. Если картинка уже грузилась,
     * адрес — с того зеркала, что её отдало (preloadLogo), и карточка берёт
     * файл из HTTP-кэша. Сети здесь нет: не знаем — null.
     */
    function knownLogoUrl(item) {
        var k = heroKey(item);
        if (!k) return null;
        var info = knownLogo(item, k);
        return (info && info.url) ? info.url : null;
    }

    /** Ответ /api/tmdb/logo — для элементов без поля logo */
    function fetchHeroLogo(item, k) {
        var known = knownLogo(item, k);
        if (known !== undefined) return Promise.resolve(known);
        if (homeState.logoUnsupported) return Promise.resolve(null);
        if (homeState.logoInflight[k]) return homeState.logoInflight[k];

        var url = serverUrl() + '/api/tmdb/logo?id=' + encodeURIComponent(item.id) +
            '&type=' + ((item.media_type === 'tv') ? 'tv' : 'movie');
        var timeout = new Promise(function (resolve, reject) {
            setTimeout(function () { reject(new Error('timeout')); }, HOME.LOGO_FETCH_TIMEOUT_MS);
        });
        var req = window.bgFetch ? window.bgFetch(url) : fetch(url);   // через фоновый поток
        var p = Promise.race([req, timeout]).then(function (r) {
            // 404 — сервер старше этой возможности: больше не спрашиваем
            if (r.status === 404) { homeState.logoUnsupported = true; return null; }
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json().then(function (d) {
                var info = logoFromData(d || {});
                if (info === undefined) info = null;
                homeState.logos[k] = info;
                return info;
            });
        }).catch(function () {
            // Сбой сети не запоминаем — в следующий раз спросим снова
            return null;
        });
        homeState.logoInflight[k] = p;
        p.then(function () { delete homeState.logoInflight[k]; });
        return p;
    }

    /**
     * Картинка логотипа в кэш браузера. done(true|false) — один раз на
     * загрузку; не отдалась — на эту сессию элемент живёт с текстом.
     */
    function preloadLogo(k, info, done) {
        if (info.loaded) { if (done) done(true); return; }
        if (!info.waiters) info.waiters = [];
        if (done) info.waiters.push(done);
        if (info.loading) return;
        info.loading = true;
        var tries = 0;
        var finish = function (ok) {
            info.loading = false;
            info.loaded = ok;
            if (!ok) homeState.logos[k] = null;
            var w = info.waiters;
            info.waiters = [];
            for (var i = 0; i < w.length; i++) w[i](ok);
        };
        // Зеркало выбирается по пути картинки, и упавшее зеркало валит один и
        // тот же набор логотипов всегда. Поэтому, как и у кадра баннера
        // (pushMirrors), пробуем следующие; удачный адрес запоминаем в info.url
        var tryUrl = function (url) {
            var im = new Image();
            var settled = false;
            var fail = function () {
                if (settled) return;
                settled = true;
                var next = (++tries < HOME.BACKDROP_MIRROR_TRIES && typeof window.getTmdbNextMirrorUrl === 'function')
                    ? window.getTmdbNextMirrorUrl(url) : null;
                if (next && next !== url) tryUrl(next);
                else finish(false);
            };
            // Зеркало может молчать вовсе — ни load, ни error; ждём как кадр баннера
            var timer = setTimeout(fail, HOME.BACKDROP_GRACE_MS);
            im.onload = function () {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                info.url = url;
                // Баннер поставит этот же элемент (setHeroLogoState)
                logoImgs.put(url, im);
                finish(true);
            };
            im.onerror = function () { clearTimeout(timer); fail(); };
            im.src = url;
        };
        tryUrl(info.url);
    }

    /**
     * Логотипы соседних карточек — заранее: шагнул вбок — логотип уже в кэше
     * и встаёт сразу, без «сначала пусто, потом появилось». Только в простое
     * (requestIdleCallback) и не больше LOGO_PRELOAD_MAX новых загрузок за
     * раз: во время листания главный поток занят постерами и прокруткой.
     * Берём только известные из данных подборки; за теми, у кого поля нет,
     * отдельно не ходим.
     */
    var logoPreloadJob = null;

    function preloadNearLogos(items, idx) {
        if (logoPreloadJob !== null) {
            if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(logoPreloadJob);
            else clearTimeout(logoPreloadJob);
        }
        var runJob = function () {
            logoPreloadJob = null;
            var started = 0;
            // Сначала ближние: +1, -1, +2, -2
            for (var d = 1; d <= HOME.LOGO_NEAR && started < HOME.LOGO_PRELOAD_MAX; d++) {
                var pair = [idx + d, idx - d];
                for (var j = 0; j < 2 && started < HOME.LOGO_PRELOAD_MAX; j++) {
                    var it = items[pair[j]];
                    var k = it ? heroKey(it) : null;
                    if (!k) continue;
                    var info = knownLogo(it, k);
                    if (!info || info.loaded || info.loading) continue;
                    preloadLogo(k, info, null);
                    started++;
                }
            }
        };
        logoPreloadJob = (typeof window.requestIdleCallback === 'function')
            ? window.requestIdleCallback(runJob, { timeout: 1500 })
            : setTimeout(runJob, 400);
    }

    function setHeroLogoState(hasLogo, url) {
        var body = el('home-hero-body');
        if (!body) return;
        if (homeState.hero.logoTimer) {
            clearTimeout(homeState.hero.logoTimer);
            homeState.hero.logoTimer = null;
        }
        var box = hasLogo ? el('home-hero-logo') : null;
        if (box) {
            var cur = box.querySelector('img');
            // Уже загруженный элемент (preloadLogo) — вставляем его самого:
            // src у разметки запросил бы ту же картинку второй раз
            var ready = logoImgs.get(url);
            if (ready) {
                if (cur !== ready) {
                    ready.alt = '';
                    if (cur) box.replaceChild(ready, cur);
                    else box.appendChild(ready);
                }
            } else if (cur && cur.getAttribute('src') !== url) {
                cur.setAttribute('src', url);
            }
        }
        // Классы трогаем, только если они меняются: каждое касание — пересчёт
        // стилей подписей баннера, а зовётся это на каждой смене карточки
        var cl = body.classList;
        if (cl.contains('home-hero-has-logo') !== !!hasLogo) cl.toggle('home-hero-has-logo', !!hasLogo);
        if (cl.contains('home-hero-logo-wait')) cl.remove('home-hero-logo-wait');
    }

    /**
     * Логотип вместо текста названия. Картинку сначала грузим отдельным Image и
     * только загруженную ставим в баннер — иначе на месте названия мелькала бы
     * пустота. Уже загруженный в этой сессии логотип ставится сразу.
     */
    /**
     * «Свой» ли ответ, решает logoKey — какой элемент сейчас НАРИСОВАН в
     * баннере, — а не поколение hero.gen. Поколение растёт и без перерисовки:
     * suspendHero (ушли с главной на миг, плеер, заставка), повторный показ
     * той же категории. Логотип при этом догружался, но считался чужим, и
     * название оставалось спрятанным (home-hero-logo-wait) навсегда.
     */
    function applyHeroLogo(item, k) {
        var body = el('home-hero-body');
        if (!body) return;
        homeState.hero.logoKey = k;
        var known = k ? knownLogo(item, k) : null;
        if (known === null || (known === undefined && homeState.logoUnsupported)) {
            setHeroLogoState(false);
            return;
        }
        if (known && known.loaded) { setHeroLogoState(true, known.url); return; }

        body.classList.remove('home-hero-has-logo');
        body.classList.add('home-hero-logo-wait');
        if (homeState.hero.logoTimer) clearTimeout(homeState.hero.logoTimer);
        homeState.hero.logoTimer = setTimeout(function () {
            homeState.hero.logoTimer = null;
            if (homeState.hero.logoKey === k) body.classList.remove('home-hero-logo-wait');
        }, HOME.LOGO_WAIT_MS);

        fetchHeroLogo(item, k).then(function (info) {
            if (homeState.hero.logoKey !== k) return;
            if (!info) { setHeroLogoState(false); return; }
            preloadLogo(k, info, function (ok) {
                if (homeState.hero.logoKey === k) setHeroLogoState(ok, info.url);
            });
        });
    }

    // ==================== БАННЕР: КАТЕГОРИЯ ====================
    //
    // Фокус на плитке категории (ряд «Категории») — баннер по кругу показывает
    // её фильмы: первые десять с описанием, кадром и логотипом. Список собирает
    // и держит сутки в IndexedDB category-banners.js.
    //
    // Каждый фильм показывается так же, как карточка ряда: кругляшок, потом
    // трейлер. Смена фильма — по концу трейлера; если трейлеры выключены, не
    // нашлись или не пошли — через CATEGORY_ROTATE_MS после показа. Кнопки
    // «‹» и «›» на баннере листают фильмы вручную, «Смотреть» ищет торренты
    // показанного фильма.
    //
    // hero.cat.key — признак режима. hero.gen по-прежнему меняется на каждом
    // фильме (им отсекаются логотип, поиск трейлера и сам трейлер прошлого
    // фильма), а hero.cat.seq — на каждой смене категории: им отсекается
    // сборка списка, которая может идти несколько секунд.

    function stopCategoryTimers() {
        var c = homeState.hero.cat;
        if (c.timer) { clearTimeout(c.timer); c.timer = null; }
        if (c.fadeTimer) { clearTimeout(c.fadeTimer); c.fadeTimer = null; }
        if (c.placeholderTimer) { clearTimeout(c.placeholderTimer); c.placeholderTimer = null; }
        var hero = el('home-hero');
        if (hero && hero.classList.contains('home-hero-fading')) hero.classList.remove('home-hero-fading');
    }

    /** Обычный режим баннера: точки и стрелки прячем, категорию забываем */
    function leaveCategoryHero() {
        var c = homeState.hero.cat;
        if (!c.key) return;
        stopCategoryTimers();
        c.seq++;
        c.key = null;
        c.list = [];
        c.index = 0;
        renderCategoryDots();
        setCategoryArrows(false);
    }

    function renderCategoryDots() {
        var box = el('home-hero-dots');
        if (!box) return;
        var c = homeState.hero.cat;
        var n = c.key ? c.list.length : 0;
        if (n < 2) {
            if (!box.hidden) { box.hidden = true; box.innerHTML = ''; }
            return;
        }
        var html = '';
        for (var i = 0; i < n; i++) html += '<span' + (i === c.index ? ' class="home-dot-on"' : '') + '></span>';
        box.innerHTML = html;
        box.hidden = false;
    }

    /** Стрелки «‹ ›» видны только у категории, где есть что листать */
    function setCategoryArrows(on) {
        var changed = false;
        var ids = ['home-prev-btn', 'home-next-btn'];
        for (var i = 0; i < ids.length; i++) {
            var b = el(ids[i]);
            if (b && b.hidden === !!on) { b.hidden = !on; changed = true; }
        }
        // Кнопки входят в список фокуса control.js только видимыми
        if (changed) invalidateFocus();
    }

    function categoryName(key) {
        var cfg = (typeof CATALOG_CONFIG !== 'undefined') ? CATALOG_CONFIG[key] : null;
        return (cfg && cfg.name) || '';
    }

    /** Дебаунс, как у setHeroItem: пролистывая ряд, категорию меняем один раз */
    function setHeroCategory(catKey) {
        var pk = 'cat:' + catKey;
        if (pk === homeState.hero.pendingKey) return;
        homeState.hero.pendingKey = pk;
        if (homeState.hero.timer) clearTimeout(homeState.hero.timer);
        homeState.hero.timer = setTimeout(function () {
            homeState.hero.timer = null;
            applyCategoryHero(catKey);
        }, HOME.HERO_DEBOUNCE_MS);
    }

    function applyCategoryHero(catKey) {
        if (!ensureHeroDom()) return;
        var c = homeState.hero.cat;
        homeState.hero.key = 'cat:' + catKey;
        homeState.hero.pendingKey = homeState.hero.key;

        // Та же категория (вернулись на плитку из карточки, поиска, с кнопок
        // баннера) — продолжаем с того фильма, на котором остановились
        if (c.key === catKey && c.list.length) {
            showCategoryItem(c.index, false);
            return;
        }

        homeState.hero.gen++;
        stopHeroTrailer();
        resetHeroRing();
        stopCategoryTimers();
        var seq = ++c.seq;
        c.key = catKey;
        c.list = [];
        c.index = 0;
        renderCategoryDots();
        setCategoryArrows(false);

        if (!window.CategoryBanners) { renderCategoryPlaceholder(catKey, true); return; }

        var shown = false;
        c.placeholderTimer = setTimeout(function () {
            c.placeholderTimer = null;
            if (seq === c.seq && !shown) renderCategoryPlaceholder(catKey, false);
        }, HOME.CATEGORY_PLACEHOLDER_MS);

        function first(list) {
            if (seq !== c.seq || shown || !list.length) return;
            shown = true;
            c.list = list;
            showCategoryItem(0, false);
        }

        CategoryBanners.get(catKey, first).then(function (list) {
            if (seq !== c.seq) return;
            if (c.placeholderTimer) { clearTimeout(c.placeholderTimer); c.placeholderTimer = null; }
            if (!list.length) { if (!shown) renderCategoryPlaceholder(catKey, true); return; }
            if (!shown) { first(list); return; }
            // Первые фильмы уже на экране — дописываем остальные, не начиная
            // показ заново
            var cur = c.list[c.index];
            c.list = list;
            var idx = list.indexOf(cur);
            c.index = idx === -1 ? 0 : idx;
            renderCategoryDots();
            setCategoryArrows(list.length > 1);
        });
    }

    /** Список ещё собирается (или пуст): название категории и её картинка */
    function renderCategoryPlaceholder(catKey, empty) {
        homeState.hero.item = null;
        var t = el('home-hero-title');
        if (t) t.textContent = categoryName(catKey);
        var m = el('home-hero-meta');
        if (m) m.textContent = empty ? 'Категория' : 'Подбираем фильмы…';
        var o = el('home-hero-overview');
        if (o) o.textContent = '';
        // Опоздавший логотип прошлого фильма сюда не встанет
        homeState.hero.logoKey = null;
        setHeroLogoState(false);
        var poster = (typeof POSTER_URLS !== 'undefined' && POSTER_URLS[catKey]) || '';
        applyHeroBackdrop(poster, '');
    }

    /**
     * Показать фильм категории под номером idx. fade — плавно (автосмена и
     * стрелки): кадр и подписи гаснут, меняются и проявляются.
     */
    function showCategoryItem(idx, fade) {
        var c = homeState.hero.cat;
        if (!c.key || !c.list.length) return;
        var n = c.list.length;
        idx = ((idx % n) + n) % n;
        stopCategoryTimers();
        stopHeroTrailer();
        resetHeroRing();
        var gen = ++homeState.hero.gen;

        var hero = el('home-hero');
        if (!fade || !hero) { renderCategoryItem(idx, gen, null); return; }

        // Плавная смена: баннер гаснет, и проявляется только когда НОВЫЙ кадр
        // встал. Раньше проявление шло по сроку затухания, а кадр следующего
        // фильма ещё грузился — и полсекунды под новым названием был виден
        // прежний. Кадр к этому моменту обычно уже в кэше (preloadBackdrop
        // соседей), но ждём не дольше CATEGORY_REVEAL_MAX_MS.
        hero.classList.add('home-hero-fading');
        var item = c.list[idx];
        var faded = false, ready = false, rendered = false, shown = false;
        var reveal = function () {
            if (shown || gen !== homeState.hero.gen) return;
            shown = true;
            if (c.fadeTimer) { clearTimeout(c.fadeTimer); c.fadeTimer = null; }
            hero.classList.remove('home-hero-fading');
        };
        // И догрузка кадра, и запасной срок ведут сюда — рисуем один раз
        var tryRender = function () {
            if (rendered || !faded || !ready || gen !== homeState.hero.gen) return;
            rendered = true;
            if (c.fadeTimer) { clearTimeout(c.fadeTimer); c.fadeTimer = null; }
            renderCategoryItem(idx, gen, reveal);
            c.fadeTimer = setTimeout(reveal, HOME.CATEGORY_REVEAL_MAX_MS);
        };
        preloadBackdrop(item && item.backdrop_path, function () { ready = true; tryRender(); });
        c.fadeTimer = setTimeout(function () {
            c.fadeTimer = null;
            faded = true;
            if (!ready) {
                // Кадр всё ещё грузится — не держим баннер пустым бесконечно
                c.fadeTimer = setTimeout(function () { ready = true; tryRender(); }, HOME.CATEGORY_REVEAL_MAX_MS);
            }
            tryRender();
        }, HOME.CATEGORY_FADE_MS);
    }

    /** Кадры соседних фильмов — заранее: «‹ ›» и автосмена не ждут сети */
    function preloadCategoryNeighbours(idx) {
        var c = homeState.hero.cat;
        var n = c.list.length;
        if (n < 2) return;
        var next = c.list[(idx + 1) % n];
        var prev = c.list[(idx - 1 + n) % n];
        preloadBackdrop(next && next.backdrop_path, null);
        if (prev !== next) preloadBackdrop(prev && prev.backdrop_path, null);
    }

    function renderCategoryItem(idx, gen, onBackdrop) {
        var c = homeState.hero.cat;
        var item = c.list[idx];
        if (!item) return;
        c.index = idx;
        var k = heroKey(item);
        // «Смотреть» и поиск трейлера берут фильм отсюда
        homeState.hero.item = item;
        homeState.hero.trailerUrl = null;
        homeState.hero.trailerSearched = false;
        homeState.heroDetails[k] = item;

        renderHero(item, item, onBackdrop);
        // Категория первой: на этом баннере фильм — пример того, что внутри
        var m = el('home-hero-meta');
        if (m) m.textContent = categoryName(c.key) + '  •  ' + heroMetaText(item, item);
        applyHeroLogo(item, k);
        renderCategoryDots();
        setCategoryArrows(c.list.length > 1);
        // Логотипы и кадры соседних — заранее, чтобы смена не мигала текстом
        // названия и прежним кадром
        preloadNearLogos(c.list, idx);
        preloadCategoryNeighbours(idx);

        // Запасной срок смены. Пошёл трейлер — срок снимается, и смену делает
        // конец ролика (startHeroTrailer); трейлеров нет — смена по сроку
        c.timer = setTimeout(function () {
            c.timer = null;
            advanceCategory(gen);
        }, HOME.CATEGORY_ROTATE_MS);
        if (heroTrailersOn()) startTrailerCountdown(item, item, gen);
        else hideHeroRing();
    }

    /** Следующий фильм. Главная не на экране — ждём следующего срока */
    function advanceCategory(gen) {
        var c = homeState.hero.cat;
        if (!c.key || gen !== homeState.hero.gen) return;
        if (!isHomeVisible() || playerBusy() || moduleLoaderUp() ||
            (window.AppState && AppState.screensaverActive)) {
            c.timer = setTimeout(function () {
                c.timer = null;
                advanceCategory(gen);
            }, HOME.CATEGORY_ROTATE_MS);
            return;
        }
        if (c.list.length < 2) {
            // Один фильм: трейлер отыграл — показываем его же заново (кругляшок)
            showCategoryItem(c.index, false);
            return;
        }
        showCategoryItem(c.index + 1, true);
    }

    /** Кнопки «‹ ›» на баннере */
    function stepCategory(delta) {
        var c = homeState.hero.cat;
        if (!c.key || c.list.length < 2) return true;
        showCategoryItem(c.index + delta, true);
        return true;
    }

    /** Кнопка баннера: «Смотреть» или стрелка категории */
    function isHeroButton(f) {
        return !!(f && (f.id === 'home-play-btn' || f.id === 'home-prev-btn' || f.id === 'home-next-btn'));
    }

    // ==================== БАННЕР: КРУГЛЯШОК ====================

    function ringBar() { return document.querySelector('#home-hero-ring .home-ring-bar'); }

    /** Заполнение ступеньками по таймеру — см. HOME.RING_TICK_MS */
    function runHeroRing() {
        stopRingTick();
        var ring = el('home-hero-ring');
        if (ring) ring.hidden = false;
        var bar = ringBar();
        if (!bar) return;
        bar.style.strokeDashoffset = HOME.RING_LEN;
        var started = Date.now();
        homeState.hero.ringTick = setInterval(function () {
            var p = Math.min(1, (Date.now() - started) / HOME.TRAILER_DELAY_MS);
            if (!bar.isConnected) { stopRingTick(); return; }
            bar.style.strokeDashoffset = (HOME.RING_LEN * (1 - p)).toFixed(1);
            if (p >= 1) stopRingTick();
        }, HOME.RING_TICK_MS);
    }

    function stopRingTick() {
        if (homeState.hero.ringTick) {
            clearInterval(homeState.hero.ringTick);
            homeState.hero.ringTick = null;
        }
    }

    function resetHeroRing() {
        if (homeState.hero.ringTimer) {
            clearTimeout(homeState.hero.ringTimer);
            homeState.hero.ringTimer = null;
        }
        homeState.hero.ringDone = false;
        hideHeroRing();
        var bar = ringBar();
        if (bar) bar.style.strokeDashoffset = HOME.RING_LEN;
    }

    function hideHeroRing() {
        stopRingTick();
        var ring = el('home-hero-ring');
        if (ring) ring.hidden = true;
    }

    /** Фокус на какой-нибудь карточке ряда главной */
    function focusedIsHomeCard() {
        var f = document.querySelector('.focused');
        return !!(f && findCardPosition(f));
    }

    /** Фокус всё ещё на той карточке, чей элемент показан в баннере */
    function focusedIsHeroCard() {
        var f = document.querySelector('.focused');
        // Кнопки баннера категории («Смотреть», «‹ ›») — часть её показа:
        // трейлер под ними играет дальше
        if (homeState.hero.cat.key && isHeroButton(f)) return true;
        if (!f || !f.dataset || !findCardPosition(f)) return false;
        // Плитка категории «своя», пока баннер показывает её фильмы
        if (f.dataset.homeCat) return f.dataset.homeCat === homeState.hero.cat.key;
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
        // найденный здесь трейлер там сразу даёт кнопку, и наоборот. Читаем и
        // пишем только через его функции: у записи там срок жизни
        var getShared = window.getCachedRutubeTrailer;
        var putShared = window.putCachedRutubeTrailer;
        var shared = getShared ? getShared(cacheKey) : null;
        if (shared) {
            onTrailerFound(shared.url, gen);
            return;
        }
        if (typeof window.fetchRutubeTrailer !== 'function') { onTrailerMissing(gen); return; }

        var orig = src.original_title || src.original_name || '';
        var date = src.release_date || src.first_air_date ||
            (item.release_date || item.first_air_date || '');
        // С кэшем на сервере (catalog.js: fetchRutubeTrailerCached) — по id фильма
        var find = window.fetchRutubeTrailerCached
            ? window.fetchRutubeTrailerCached({ id: item.id, type: item.media_type }, title, orig, date)
            : window.fetchRutubeTrailer(title, orig, date);
        Promise.resolve(find).then(function (res) {
            if (gen !== homeState.hero.gen) return;
            if (res && res.url) {
                if (putShared) putShared(cacheKey, res.url, res.title || title);
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

        // Прошлый трейлер, если его разбор ещё ждёт простоя, добиваем сейчас:
        // отсчёт кругляшка — не прокрутка, а два видео на один декодер — лишнее
        stopHeroTrailer(true);
        hideHeroRing();

        var video = document.createElement('video');
        video.id = 'home-hero-video';
        video.className = 'home-hero-video';
        video.muted = true;
        video.volume = 0;
        // У категории ролик не крутится по кругу: его конец — смена фильма
        var catMode = !!homeState.hero.cat.key;
        video.loop = !catMode;
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
            // pause() в stopHeroTrailer шлёт timeupdate уже снятому видео
            if (volumeStarted || homeState.hero.video !== video) return;
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
        // гашение кадра-картинки и вписывание трейлера справа, а это должно
        // случиться ровно тогда, когда появляется картинка трейлера. Снимает его
        // stopHeroTrailer — любая остановка возвращает баннер как был.
        function revealVideo() {
            if (homeState.hero.video !== video) return;
            if (video.classList.contains('home-hero-video-on')) return;
            fitTrailerBox(video);
            video.classList.add('home-hero-video-on');
            var hero = el('home-hero');
            if (hero) hero.classList.add('home-hero-playing');
        }
        // Размер кадра известен с метаданных и может смениться при переходе
        // hls.js на другое качество
        video.addEventListener('loadedmetadata', function () { fitTrailerBox(video); });
        video.addEventListener('resize', function () { fitTrailerBox(video); });
        video.addEventListener('playing', function () {
            revealVideo();
            startVolumeFade();
        });
        video.addEventListener('timeupdate', function () {
            // playing на части устройств приходит раньше первого кадра
            if (video.currentTime > 0) revealVideo();
            startVolumeFade();
        });
        if (catMode) {
            // Ролик пошёл — смену делает его конец, а не CATEGORY_ROTATE_MS.
            // Запасной срок всё же оставляем — на длину ролика с запасом: поток
            // может встать без ошибки, и баннер застыл бы навсегда
            var catGuard = function () {
                if (homeState.hero.video !== video) return;
                var c = homeState.hero.cat;
                if (c.timer) clearTimeout(c.timer);
                var d = video.duration;
                var ms = (d && isFinite(d)) ? Math.round(d * 1000) + 15000 : 5 * 60 * 1000;
                c.timer = setTimeout(function () {
                    c.timer = null;
                    advanceCategory(gen);
                }, ms);
            };
            var catNext = function () {
                if (homeState.hero.video === video) advanceCategory(gen);
            };
            video.addEventListener('playing', catGuard);
            video.addEventListener('ended', catNext);
            video.addEventListener('error', catNext);
        }

        if (window.trailerUsesHlsJs ? window.trailerUsesHlsJs() : (window.Hls && Hls.isSupported())) {
            var hls = new Hls({
                maxBufferSize: 30 * 1024 * 1024,
                maxBufferLength: 10,
                startLevel: 2,
                enableWorker: true
            });
            hls.loadSource(hlsUrl(url));
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, function () {
                // Трейлер могли снять раньше, чем пришёл манифест: hls.js разбирают
                // на простое (queueHeroTeardown), и до того манифест ещё может прийти
                if (homeState.hero.video !== video) return;
                video.play().catch(function () { });
            });
            if (catMode) {
                hls.on(Hls.Events.ERROR, function (ev, data) {
                    if (data && data.fatal && homeState.hero.video === video) advanceCategory(gen);
                });
            }
            homeState.hero.hls = hls;
        } else {
            video.src = hlsUrl(url);
            video.play().catch(function () { });
        }

        startHeroWatchdog();
    }

    /**
     * Ширина кадра трейлера (см. «Трейлер почти целиком» в styles.css): высота
     * баннера × пропорция кадра, но не шире баннера. Кадр во всю высоту
     * баннера — вровень с картинкой, так же уходит верхом под шапку.
     * Пишется в --trailer-w на #home-hero.
     */
    // Блок кадра шире пропорции ролика на столько (влево): кадр целиком по
    // высоте выходил узковат. Лишнее срезает object-fit: cover — по ~4%
    // сверху и снизу, на глаз незаметно.
    var TRAILER_WIDEN = 1.08;

    function fitTrailerBox(video) {
        var hero = el('home-hero');
        if (!hero || !video) return;
        var ar = (video.videoWidth && video.videoHeight) ? video.videoWidth / video.videoHeight : 16 / 9;
        var h = hero.clientHeight - 2;                  // видео на 2px короче баннера
        var w = Math.min(hero.clientWidth, Math.round(h * ar * TRAILER_WIDEN));
        if (w > 0) hero.style.setProperty('--trailer-w', w + 'px');
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
            // Фокус переехал на другую карточку, а её дебаунс ещё не истёк:
            // suspendHero снял бы таймер setHeroItem вместе с pendingKey, и
            // applyHero для новой карточки не выполнился бы — баннер так и
            // остался бы на прошлом элементе без кругляшка. Гасим только трейлер,
            // остальное сделает applyHero по таймеру
            if (homeState.hero.timer && isHomeVisible() && !playerBusy() && focusedIsHomeCard()) {
                stopHeroTrailer();
                resetHeroRing();
                return;
            }
            // Фокус просто ушёл с карточки — разбор на простой; главную закрыл
            // плеер или оверлей — декодер нужен им, отдаём сразу
            suspendHero(!isHomeVisible() || playerBusy());
        }, HOME.WATCHDOG_MS);
    }

    function stopHeroWatchdog() {
        if (homeState.hero.watchdog) {
            clearInterval(homeState.hero.watchdog);
            homeState.hero.watchdog = null;
        }
    }

    /**
     * Разбор отыгравшего трейлера — очередь шагов, по одному на простой.
     * Останавливают трейлер при смене карточки, то есть посреди прокрутки ряда,
     * а дорогие тут две вещи: video.load() (освобождает декодер, на эмуляторе
     * Android TV 10–40 мс) и hls.destroy() (отцепляет MediaSource и разбирает
     * десяток контроллеров — 30–50 мс одной задачей). Звук и картинку
     * stopHeroTrailer гасит сразу (pause + снятие из разметки), так что
     * остальное ждёт простоя, причём каждый шаг — отдельной задачей. Докачку
     * фрагмента, начатую до stopLoad, hls.js доведёт в пустой буфер — это
     * дешевле, чем обрывать её посреди прокрутки.
     * Пока держат стрелку (navHold), шаги не трогаем: сработают после, а
     * timeout не даёт очереди висеть дольше полутора секунд.
     */
    var heroTeardownQueue = [];
    var heroTeardownJob = false;

    function queueHeroTeardown(video, hls) {
        if (hls) {
            // stopLoad тоже не бесплатный (обрыв загрузок, сброс трансмуксера —
            // до 30 мс на эмуляторе), поэтому и он в очереди, а не в кадре смены.
            // detachMedia сам снимает src и зовёт load() — декодер уходит здесь
            heroTeardownQueue.push(function () { hls.stopLoad(); });
            heroTeardownQueue.push(function () { hls.detachMedia(); });
            heroTeardownQueue.push(function () { hls.destroy(); });
        }
        if (video) {
            // Прямой src (без hls.js) или detachMedia не сработал — декодер
            // держит сам элемент, освобождаем его вручную
            heroTeardownQueue.push(function () {
                if (!video.hasAttribute('src') && !video.currentSrc) return;
                video.removeAttribute('src');
                video.load();
            });
        }
        scheduleHeroTeardown();
    }

    function scheduleHeroTeardown() {
        if (heroTeardownJob || !heroTeardownQueue.length) return;
        heroTeardownJob = true;
        var run = function (deadline) {
            heroTeardownJob = false;
            if (window.navHold && !(deadline && deadline.didTimeout)) { scheduleHeroTeardown(); return; }
            var step = heroTeardownQueue.shift();
            if (step) { try { step(); } catch (e) { } }
            scheduleHeroTeardown();
        };
        if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 1500 });
        else setTimeout(run, 600);
    }

    /**
     * Разобрать всё немедленно. Перед плеером и уходом в фон: декодеров на ТВ
     * мало, и внешний плеер Android их делит с WebView, а простоя в фоне
     * (pauseTimers) можно не дождаться вовсе. Перед новым трейлером — чтобы
     * два видео не держали декодер одновременно.
     */
    function flushHeroTeardown() {
        while (heroTeardownQueue.length) {
            try { heroTeardownQueue.shift()(); } catch (e) { }
        }
    }

    function stopHeroTrailer(now) {
        stopHeroWatchdog();
        var hero = el('home-hero');
        if (hero) hero.classList.remove('home-hero-playing');
        var hls = homeState.hero.hls;
        homeState.hero.hls = null;
        var video = homeState.hero.video || el('home-hero-video');
        homeState.hero.video = null;
        if (video) {
            if (video._volumeTimer) {
                clearInterval(video._volumeTimer);
                video._volumeTimer = null;
            }
            try { video.muted = true; video.pause(); } catch (e) { }
            if (video.parentNode) video.parentNode.removeChild(video);
        }
        if (hls || video) queueHeroTeardown(video, hls);
        if (now) flushHeroTeardown();
    }

    /**
     * Уходим с главной (раздел, детальный просмотр, поиск, плеер) — гасим всё
     * разом. Ключ элемента забываем: вернёмся — setHeroItem сравнивает новый
     * ключ с pendingKey, и без сброса тот же самый элемент не завёл бы отсчёт
     * заново (баннер остался бы картинкой без кругляшка).
     * now — разобрать видео немедленно, а не на простое (см. flushHeroTeardown).
     */
    /**
     * Уход с главной с затуханием (вход в категорию, в карточку фильма): пока
     * главная гаснет, баннер должен стоять как есть. suspendHero сразу
     * убирает видео трейлера, и под ним одним кадром проступал статичный кадр
     * фона — вспышка в начале плавного ухода. Здесь всё останавливаем, а видео
     * только замирает на текущем кадре и замолкает; разбирает его suspendHero,
     * когда главная уже не видна.
     */
    function pauseHeroForExit() {
        homeState.hero.gen++;
        if (homeState.hero.timer) { clearTimeout(homeState.hero.timer); homeState.hero.timer = null; }
        stopCategoryTimers();
        resetHeroRing();
        var video = homeState.hero.video || el('home-hero-video');
        if (video) { try { video.muted = true; video.pause(); } catch (e) { } }
    }

    function suspendHero(now) {
        homeState.hero.gen++;
        if (homeState.hero.timer) { clearTimeout(homeState.hero.timer); homeState.hero.timer = null; }
        // Смену фильмов категории останавливаем, но саму категорию помним:
        // вернёмся на плитку — показ продолжится с того же фильма
        stopCategoryTimers();
        homeState.hero.key = null;
        homeState.hero.pendingKey = null;
        resetHeroRing();
        stopHeroTrailer(now);
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
     * Геометрия плитки ряда — у фильмов и у категорий одна: картинка 16:9 и
     * название под ней.
     *
     * Ширина — два постера с зазором (cardW — ширина постера, которую
     * layoutHome считает, как раньше, от высоты ряда и ползунка «Размер
     * карточек»). Так плиток в экране столько же, сколько было бы пар
     * постеров: от высоты ряда напрямую плитка выходила втрое шире постера, и
     * на 1080p в экран влезало три. Телефон вертикально: два постера шире
     * экрана — плитка не шире CATEGORY_TILE_MAX_SHARE, соседняя выглядывает.
     *
     * Подпись — от высоты постера (на телефоне 40px были бы в полплитки).
     * Зазор между карточками в медиазапросах разный (18/14/10px) — берём долю
     * ширины, это около него.
     */
    function tileGeometry(cardW, posterH, availW) {
        var labelH = Math.max(HOME.CATEGORY_LABEL_MIN_PX,
            Math.min(HOME.CATEGORY_LABEL_PX, Math.round(posterH * 0.12)));
        var w = Math.round(cardW * 2.08);
        if (availW && w > availW * HOME.CATEGORY_TILE_MAX_SHARE) w = Math.round(availW * HOME.CATEGORY_TILE_MAX_SHARE);
        var imgH = Math.round(w * 9 / 16);
        return { w: w, imgH: imgH, labelH: labelH, h: imgH + labelH };
    }

    /**
     * Размер плиток ряда. Отдельным <style>, потому что геометрию
     * .catalog-row-card задаёт ui-customizer.js через !important — перебить его
     * можно только более специфичным селектором (.catalog-row-card.home-card:
     * два класса против одного), и порядок подключения тут уже не важен.
     */
    function applyCardCss(g) {
        var key = g.w + 'x' + g.h;
        if (homeState.cardCssKey === key) return;
        homeState.cardCssKey = key;
        homeState.cardWidth = g.w;
        // Кадр плитки: до 400 физических точек хватает w300 (720p, в том
        // числе с масштабом 1.25), шире — w780 (1080p). w300 легче вчетверо.
        // Разрешение интерфейса в Android (index.html: uiViewport) уменьшает
        // страницу масштабом, а devicePixelRatio о нём не знает
        var vp = window.uiViewport;
        var dpr = (window.devicePixelRatio || 1) * (vp ? vp.native / vp.width : 1);
        homeState.tileImgSize = g.w * dpr <= 400 ? 'w300' : 'w780';
        var st = el('home-card-style');
        if (!st) {
            st = document.createElement('style');
            st.id = 'home-card-style';
            document.head.appendChild(st);
        }
        st.textContent =
            '.catalog-row-card.home-card,' +
            '.catalog-row-viewport .catalog-row-card.home-card{' +
            'flex:0 0 ' + g.w + 'px!important;width:' + g.w + 'px!important;height:' + g.h + 'px!important}' +
            '.catalog-row-card.home-card .torrent-poster,' +
            '.catalog-row-viewport .catalog-row-card.home-card .torrent-poster,' +
            '.catalog-row-card.home-card .row-poster-img{' +
            'width:' + g.w + 'px!important;height:' + g.imgH + 'px!important}' +
            '.home-tile-label{height:' + g.labelH + 'px;line-height:' + g.labelH + 'px;' +
            'font-size:' + Math.round(g.labelH * 0.5) + 'px}' +
            // Значок категории — треть высоты плитки, водяной знак — больше самой плитки
            '.home-cat-mark{font-size:' + Math.round(g.imgH * 0.34) + 'px}' +
            '.home-cat-text{font-size:' + Math.round(g.imgH * 0.3) + 'px}' +
            '.home-cat-watermark{font-size:' + Math.round(g.imgH * 1.15) + 'px}';
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
     * Отступ баннера от верха контейнера при нулевом margin.
     *
     * Замер дорог не сам по себе, а тем, что делается СРАЗУ ПОСЛЕ записи
     * marginTop. Чтение геометрии после записи заставляет браузер пересчитать
     * раскладку синхронно, посреди обработчика, — а layoutHome зовётся из
     * showRow, то есть на каждое нажатие «вверх/вниз» на главной. На слабом
     * Android TV это и есть рывок при переключении ряда.
     *
     * Величина зависит только от высоты липкой шапки и размера контейнера, а
     * между нажатиями пульта ни то, ни другое не меняется. Поэтому меряем один
     * раз, а ключом кэша служит сам размер контейнера — он уже прочитан
     * вызывающей стороной, так что проверка бесплатна и сбрасывать кэш по
     * resize отдельно не нужно.
     *
     * Сброс всё же есть (invalidateHeroTop): высоту шапки может изменить
     * ui-customizer, не тронув размер окна.
     */
    function cachedHeroTop(hero, mc, availH, availW) {
        var c = homeState.heroTopCache;
        if (c && c.h === availH && c.w === availW) return c.top;

        // Свой сдвиг снимаем перед замером, иначе прочитали бы позицию,
        // поднятую прошлым проходом, и баннер уползал бы вверх. Возвращать его
        // не нужно: layoutHome в конце пишет marginTop заново в любом случае.
        hero.style.marginTop = '0px';
        var mcTop = mc ? mc.getBoundingClientRect().top : 0;
        var top = Math.max(0, Math.round(hero.getBoundingClientRect().top - mcTop));

        homeState.heroTopCache = { h: availH, w: availW, top: top };
        return top;
    }

    /** Замер отступа баннера устарел: сменились шрифт, плотность или размер карточек */
    function invalidateHeroTop() { homeState.heroTopCache = null; }
    window.invalidateHomeLayoutCache = invalidateHeroTop;

    /**
     * Раскладка «баннер сверху, один ряд снизу». Считаем в JS, а не в CSS: высота
     * карточки приходит из ui-customizer с !important, высота липкой шапки в
     * каждом медиазапросе своя, а ряд должен упираться в нижний край экрана.
     *
     * Функция разделена на две фазы: сначала ВСЕ чтения геометрии, потом ВСЕ
     * записи. Порядок здесь не косметика — раскладку форсирует только первое
     * чтение после записи, поэтому слипшиеся чтения стоят один пересчёт на всю
     * функцию, а чередование чтений с записями стоило бы по пересчёту на пару.
     */
    function layoutHome() {
        // Спрятана под карточкой — все замеры дали бы нули; пересчитаем при возврате
        if (cover.on) { cover.layoutPending = true; return; }
        var hero = ensureHeroDom();
        if (!hero || !isHomeVisible()) return;
        var mc = el('main-container');

        // ===== ФАЗА ЧТЕНИЯ: ни одной записи до самого конца блока =====
        var avail = (mc && mc.clientHeight) || window.innerHeight || 720;
        var availW = (mc && mc.clientWidth) || 0;
        // Прокрутку читаем здесь же, а обнуляем ниже, вместе с остальными
        // записями: раньше запись стояла перед замерами и делала грязной
        // раскладку, которую тут же приходилось пересчитывать ради clientHeight
        var needScrollReset = !!(mc && mc.scrollTop);
        // Хром ряда — тоже чтение (offsetHeight), и стоять оно должно ДО
        // cachedHeroTop: тот при промахе кэша пишет marginTop, и всё, что
        // читается после него, стоило бы ещё одного пересчёта
        var chrome = rowChrome();
        // Последним: при попадании в кэш не читает и не пишет вовсе
        var heroTop = cachedHeroTop(hero, mc, avail, availW);

        // ===== ФАЗА ВЫЧИСЛЕНИЙ: чистая арифметика, DOM не трогаем =====
        var free = Math.max(200, avail - heroTop - HOME.BOTTOM_PAD_PX);

        var heroMin = Math.min(HOME.HERO_MIN_H, Math.round(free * HOME.HERO_MIN_SHARE));
        var rowBlock = Math.round(free * HOME.ROW_SHARE);
        var maxRow = free - heroMin;
        if (rowBlock > maxRow) rowBlock = maxRow;

        var w = Math.round((rowBlock - chrome) / HOME.CARD_ASPECT);
        var lim = userCardWidth();                       // ползунок «Размер карточек» — верхняя граница
        if (lim && w > lim) w = lim;
        w = Math.max(HOME.CARD_MIN_W, Math.min(HOME.CARD_MAX_W, w));
        var posterH = Math.round(w * HOME.CARD_ASPECT);
        // В рядах — широкие плитки (tileGeometry), w и posterH — только мерка
        // для них: плитка ниже постера, и освободившееся место уходит баннеру
        var tile = tileGeometry(w, posterH, availW);
        // Остаток высоты — баннеру. Отрицательный margin заводит его под шапку:
        // та лежит выше по z-index и рисует поверх свой градиент.
        var heroH = Math.max(heroMin, free - (tile.h + chrome));

        // ===== ФАЗА ЗАПИСИ: копится до конца кадра, пересчёта не вызывает =====
        if (needScrollReset) mc.scrollTop = 0;
        applyCardCss(tile);
        hero.style.marginTop = (-heroTop) + 'px';
        hero.style.height = (heroH + heroTop) + 'px';
        // Высота баннера сменилась, а трейлер играет — вписываем кадр заново.
        // Чтение после записей, но только пока идёт трейлер: это редкость.
        if (homeState.hero.video) fitTrailerBox(homeState.hero.video);
    }

    // ==================== РАЗМЕТКА РЯДОВ ====================

    /**
     * Плитка фильма: широкий кадр и название под ним — тот же вид, что у
     * плиток категорий (createCategoryTile). Год, тип и оценка — на баннере,
     * он показывает фильм под фокусом.
     */
    function createHomeCard(item, key, index) {
        var title = itemTitle(item);
        var mt = item.media_type || 'movie';

        // Классы те же, что у карточки ряда каталога: фокус и настройки из
        // ui-customizer.js прописаны именно под них; размеры — applyCardCss
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
            '</div>' +
            '<div class="home-tile-label">' + esc(title) + '</div>';
        if (item.isHistoryItem) setCardProgress(card, item.resume);

        return card;
    }

    /**
     * Полоска «сколько посмотрено» внизу постера — у карточек «Продолжить
     * просмотр», где сервер знает место (resume). Узел один на карточку,
     * обновление — только ширина.
     */
    function setCardProgress(card, r) {
        var pct = (r && r.duration > 0) ? Math.min(100, Math.max(0, r.timecode / r.duration * 100)) : 0;
        var bar = card._progressBar;
        if (!(pct > 0)) {
            if (bar) bar.parentNode.style.display = 'none';
            return;
        }
        if (!bar) {
            var poster = card.querySelector('.torrent-poster');
            if (!poster) return;
            var track = document.createElement('div');
            track.className = 'home-card-progress';
            bar = document.createElement('i');
            track.appendChild(bar);
            poster.appendChild(track);
            card._progressBar = bar;
        }
        bar.parentNode.style.display = '';
        bar.style.width = pct.toFixed(1) + '%';
    }

    /**
     * Плитка категории: широкая картинка и название под ней. Классы те же, что
     * у карточки фильма, — фокус и навигация общие, размеры свои
     * (categoryTileCss); отличает её data-home-cat — по нему баннер переходит в
     * режим категории, а OK открывает сетку.
     */
    function createCategoryTile(item, key, index) {
        var card = document.createElement('div');
        card.className = 'torrent-card catalog-card catalog-row-card home-card home-cat-tile';
        card.dataset.homeKey = key;
        card.dataset.itemIndex = index;
        card.dataset.homeCat = item.catKey;
        card.dataset.title = item.name;
        // Грузить нечего — плитка готова сразу (visiblePostersReady ждёт этот флаг)
        card.dataset.posterLoaded = '1';
        card.innerHTML =
            '<div class="torrent-poster">' +
            '<div class="row-poster-img">' + categoryTileArt(item.catKey) + '</div>' +
            '</div>' +
            '<div class="home-tile-label">' + esc(item.name) + '</div>';
        return card;
    }

    /**
     * Оформление плиток: свои цвета и значок из шрифта uicons (он уже
     * подключён для шапки). Ни одного запроса и ни одного декодирования
     * картинки — плитка рисуется градиентом и глифом. Подборки Кинопоиска — в
     * одной оранжевой гамме, чтобы читались семейством. text — надпись вместо
     * значка. Категории, которой тут нет, достаётся CATEGORY_ART_DEFAULT.
     */
    var CATEGORY_ART = {
        halloween: { icon: 'pumpkin', c1: '#ff8a1f', c2: '#3d1403' },
        movie: { icon: 'film', c1: '#e5383b', c2: '#33090e' },
        tv: { icon: 'tv-retro', c1: '#3a86ff', c2: '#0a1a40' },
        cartoons: { icon: 'balloons', c1: '#ffb703', c2: '#4d2a00' },
        cartoons_tv: { icon: 'child-head', c1: '#14c9a0', c2: '#03302a' },
        anime: { icon: 'dragon', c1: '#b86bff', c2: '#250b3d' },
        rus: { icon: 'flag', c1: '#2f6fd6', c2: '#7a1620' },
        kp_popular: { icon: 'fire-flame-curved', c1: '#ff6a00', c2: '#2b1000' },
        kp_pop_movies: { icon: 'clapperboard', c1: '#ff7f11', c2: '#2e1300' },
        kp_pop_series: { icon: 'screen', c1: '#f28c18', c2: '#2b1500' },
        kp_top250: { icon: 'trophy', c1: '#f2b705', c2: '#332500' },
        kp_top250_tv: { icon: 'medal', c1: '#e8a33d', c2: '#2e1d00' },
        kp_family: { icon: 'family', c1: '#ff9b42', c2: '#33190a' },
        kp_comics: { icon: 'bolt', c1: '#ff5e3a', c2: '#330d05' },
        kp_love: { icon: 'heart', c1: '#ff5a76', c2: '#3a0a16' },
        quadhd: { text: '4K', icon: 'diamond', c1: '#00b4d8', c2: '#031c4a' },
        legends: { icon: 'crown', c1: '#d9a62e', c2: '#261b00' }
    };
    var CATEGORY_ART_DEFAULT = { icon: 'film', c1: '#5a5f8a', c2: '#1c1d33' };

    function categoryTileArt(catKey) {
        var a = CATEGORY_ART[catKey] || CATEGORY_ART_DEFAULT;
        var mark = a.text
            ? '<span class="home-cat-mark home-cat-text">' + esc(a.text) + '</span>'
            : '<i class="fi fi-rr-' + a.icon + ' home-cat-mark"></i>';
        return '<div class="home-cat-art" style="--cat-c1:' + a.c1 + ';--cat-c2:' + a.c2 + '">' +
            '<i class="fi fi-rr-' + a.icon + ' home-cat-watermark"></i>' + mark + '</div>';
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

        // Карусель: вьюпорт прокручивается нативно по scrollLeft, трек — просто
        // флекс-лента. Позицию читают/пишут getScrollX/setScrollX (control.js).
        // При AppState.homeRowTransform (по умолчанию) вьюпорт — окно-обрезка, а ряд
        // двигает transform трека (isTxScroller в control.js). Только здесь:
        // в каталоге тот же приём дороже, см. createCatalogRow в catalog.js.
        var carousel = document.createElement('div');
        carousel.className = 'catalog-row-carousel';
        var viewport = document.createElement('div');
        viewport.className = 'catalog-row-viewport';
        var track = document.createElement('div');
        track.className = 'catalog-row-track';
        if (window.AppState && AppState.homeRowTransform) {
            viewport.className += ' row-tx';
            viewport._txTrack = track;
        }

        homeState.data[cfg.key] = items;

        var cards = [];
        for (var i = 0; i < items.length; i++) {
            var card = items[i].catKey
                ? createCategoryTile(items[i], cfg.key, i)
                : createHomeCard(items[i], cfg.key, i);
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
            // .row-poster-img>img без .loaded прозрачна (проявление постера в
            // styles.css); вставляем уже загруженную — значит, сразу видимой
            img.className = 'loaded poster-instant';
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

    /**
     * Картинка плитки фильма — широкий кадр (backdrop_path) размера
     * tileImgSize: под ширину плитки, а не баннера (см. backdropUrlFor). Подборки отдают кадр сразу (routes/tmdb.js); у «Продолжить
     * просмотр» его нет — спрашиваем /api/tmdb/item (у сервера свой кэш) и
     * запоминаем в элементе. Кадра нет и там — постер, обрезанный по ширине.
     */
    function loadCardPoster(card, item) {
        var box = card.querySelector('.row-poster-img');
        if (!box || !item) return Promise.resolve();
        return tileBackdropPath(item).then(function (path) {
            if (path) {
                return loadTileImg(box, tmdbImage(path, homeState.tileImgSize)).then(function (url) {
                    if (!url) return loadTilePoster(box, item);
                });
            }
            return loadTilePoster(box, item);
        });
    }

    function tileBackdropPath(item) {
        if (item.backdrop_path) return Promise.resolve(item.backdrop_path);
        if (item.backdropChecked || item.id == null) return Promise.resolve(null);
        var url = serverUrl() + '/api/tmdb/item?id=' + encodeURIComponent(item.id) +
            '&type=' + (item.media_type === 'tv' ? 'tv' : 'movie');
        return homeFetch(url).then(function (d) {
            item.backdropChecked = true;
            if (d && d.backdrop_path) item.backdrop_path = d.backdrop_path;
            // Баннеру пригодятся и описание с жанрами: «Продолжить просмотр»
            // иначе дотягивал бы их отдельно (enrichHero)
            if (d && d.overview && !item.overview) item.overview = d.overview;
            return item.backdrop_path || null;
        });
    }

    function loadTilePoster(box, item) {
        var url = item.poster_path ? posterUrlFor(item.poster_path) : '';
        if (!url) {
            box.innerHTML = '<div class="no-poster">Нет постера</div>';
            return Promise.resolve();
        }
        return loadTileImg(box, url).then(function (ok) {
            if (!ok && box.isConnected) box.innerHTML = '<div class="no-poster">Нет постера</div>';
        });
    }

    /**
     * Картинка в плитку с перебором зеркал (pushMirrors) и сторожем на
     * молчащее зеркало. setRowPosterImg из catalog.js тут не годится: он
     * переписывает адрес под размер постера (getPosterCardSize), а у плитки
     * размер кадра. resolve(адрес) — картинка на месте, с этого зеркала;
     * resolve(null) — ни одно не отдало.
     */
    function loadTileImg(box, url) {
        return new Promise(function (resolve) {
            var queue = [];
            pushMirrors(queue, url);
            loadFirstImg(queue, HOME.TILE_IMG_TIMEOUT_MS, function (img, src) {
                if (!img) { resolve(null); return; }
                var insert = function () {
                    if (!box.isConnected) { resolve(null); return; }
                    // Вставляем уже загруженную — видимой сразу и без перехода:
                    // .row-poster-img>img без .loaded прозрачна (styles.css)
                    img.className = 'loaded poster-instant';
                    box.innerHTML = '';
                    box.appendChild(img);
                    resolve(src);
                };
                if (typeof img.decode === 'function') img.decode().then(insert, insert);
                else insert();
            }, function () { return box.isConnected; });
        });
    }

    /** Не больше POSTER_CONCURRENCY загрузок разом; между ними — кадр главному потоку */
    function processPosterQueue() {
        while (homeState.activePosterLoads < HOME.POSTER_CONCURRENCY &&
            homeState.posterQueue.length > 0) {
            var task = homeState.posterQueue.shift();
            if (!task.card.isConnected) { delete task.card.dataset.posterPending; continue; }
            homeState.activePosterLoads++;
            // Карточку берём в замыкание: task переиспользуется на следующем
            // витке while, а снять пометку надо именно с этой
            (function (card, item) {
                loadCardPoster(card, item)
                    .catch(function () { })
                    .then(function () {
                        if (card.dataset) delete card.dataset.posterPending;
                        homeState.activePosterLoads--;
                        setTimeout(processPosterQueue, 5);
                    });
            })(task.card, task.item);
        }
    }

    function loadRowPosters(index) {
        var cards = homeState.rows[index];
        if (!cards) return;
        var items = homeState.data[homeState.rowKeys[index]] || [];
        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            var box = card.querySelector('.row-poster-img');
            // Карточка уже в очереди или грузится. Одного posterLoaded мало:
            // проверка ниже пропускает её, только когда картинка УЖЕ в боксе, а
            // между постановкой в очередь и вставкой проходит запрос и декод.
            // В это окно ряд успевают попросить повторно (setActiveRow,
            // prefetchNeighbourPosters, восстановление фокуса) — и одна карточка
            // грузилась дважды: два запроса, два декода и два <img> в рамке.
            if (card.dataset.posterPending === '1') continue;
            // Плитка категории нарисована целиком в разметке — постера у неё нет
            if (card.dataset.homeCat) continue;
            // Флаг ставится до самой загрузки, поэтому проверяем и картинку:
            // если очередь успели обнулить, карточка осталась бы пустой навсегда
            if (card.dataset.posterLoaded === '1' && box && box.querySelector('img')) continue;
            var idx = parseInt(card.dataset.itemIndex, 10);
            if (isNaN(idx) || !items[idx]) continue;
            card.dataset.posterLoaded = '1';
            card.dataset.posterPending = '1';
            homeState.posterQueue.push({ card: card, item: items[idx] });
        }
        processPosterQueue();
    }

    /**
     * Соседние ряды — заранее, но после текущего: вверх/вниз тогда без пустых
     * постеров и без расчёта стилей в момент нажатия (WARM_ROW_CLASS). По паузе:
     * пока ряды листают, соседи меняются на каждом шаге.
     */
    function prefetchNeighbourPosters(index) {
        if (homeState.prefetchTimer) clearTimeout(homeState.prefetchTimer);
        homeState.prefetchTimer = setTimeout(function () {
            homeState.prefetchTimer = null;
            if (homeState.activeRow !== index) return;
            warmRow(index + 1);
            warmRow(index - 1);
            loadRowPosters(index + 1);
            loadRowPosters(index - 1);
        }, HOME.PREFETCH_DELAY_MS);
    }

    function warmRow(i) {
        var row = homeState.rowEls[i];
        if (row && i !== homeState.activeRow) row.classList.add(HOME.WARM_ROW_CLASS);
    }

    function resetPosterQueue() {
        // Снимаем пометку с тех, до кого очередь не дошла: иначе они навсегда
        // остались бы «в работе» и второго шанса загрузиться не получили бы
        for (var i = 0; i < homeState.posterQueue.length; i++) {
            var c = homeState.posterQueue[i].card;
            if (c && c.dataset) delete c.dataset.posterPending;
        }
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
            var cl = homeState.rowEls[i].classList;
            if (i === index) cl.remove(HOME.HIDDEN_ROW_CLASS);
            else cl.add(HOME.HIDDEN_ROW_CLASS);
            // Прогрев — только у соседей нового ряда, и заводит его
            // prefetchNeighbourPosters по паузе. Прогретые соседи прежнего ряда
            // возвращаются в display:none, кроме тех, кто и новому сосед:
            // гасить и тут же разогревать их заново незачем.
            if (i === index || Math.abs(i - index) > 1) cl.remove(HOME.WARM_ROW_CLASS);
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

    /** Видимые кнопки баннера слева направо */
    function heroButtons() {
        var out = [];
        var ids = ['home-play-btn', 'home-prev-btn', 'home-next-btn'];
        for (var i = 0; i < ids.length; i++) {
            var b = el(ids[i]);
            if (b && !b.hidden && b.offsetParent !== null) out.push(b);
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
        if (card.dataset.homeCat) { setHeroCategory(card.dataset.homeCat); return; }
        var items = homeState.data[card.dataset.homeKey];
        var idx = parseInt(card.dataset.itemIndex, 10);
        if (!items || isNaN(idx) || !items[idx]) return;
        setHeroItem(items[idx]);
        prefetchNearArt(items, idx);
        preloadNearLogos(items, idx);
    }

    /**
     * Кадры баннера и логотипы соседей — в HTTP-кэш фоновым потоком
     * (poster-prefetch.js): основной поток не создаёт ни одного Image и не
     * разбирает ни одного ответа. Шагнул вбок — кадр баннера приходит из
     * кэша, а не после сотен миллисекунд сети.
     *
     * Свою карточку не берём: её кадр сразу грузит сам баннер (applyHero), и
     * параллельное скачивание того же файла воркером было бы вторым запросом.
     * Пока кнопку держат — ждём: фокус проскакивает карточки быстрее, чем
     * качаются кадры по ~150 КБ, и очередь забивалась бы ненужным.
     */
    /**
     * Главная целиком — заранее, пока идёт заставка запуска.
     *
     * Без этого под заставкой грузился только первый экран (ряд и баннер), а
     * всё остальное — при первом же нажатии: «вниз» — пустые плитки ряда и
     * кадр баннера по сети, плитка категории — десятки запросов за её
     * фильмами. Теперь, как только данные рядов на месте, фоновый поток
     * (PosterPrefetch, фоновая очередь) кладёт в HTTP-кэш:
     *   1. картинки плиток всех рядов (STARTUP_ITEMS первых) — их видно сразу
     *      при переходе на ряд;
     *   2. кадры баннера первых STARTUP_BACKDROPS карточек каждого ряда;
     *   3. логотипы названий;
     *   4. баннеры плиток категорий: список фильмов (CategoryBanners, он же
     *      ложится в IndexedDB на сутки) и кадры с логотипами первых.
     * Показанный ряд пропускаем — его картинки грузит сама страница, а
     * параллельное скачивание того же файла воркером было бы вторым запросом.
     * Фоновая очередь идёт после срочной и не больше трёх файлов разом, так
     * что первый экран и снятие заставки это не задерживает. Один раз за запуск.
     */
    var startupPrefetchDone = false;

    function prefetchHomeStartup() {
        if (startupPrefetchDone || !window.PosterPrefetch) return;
        startupPrefetchDone = true;
        var tiles = [], tilesRest = [], backdrops = [], backdropsRest = [], logos = [];
        var seen = {};
        var add = function (list, url) { if (url && !seen[url]) { seen[url] = true; list.push(url); } };

        for (var r = 0; r < homeState.rowKeys.length; r++) {
            var items = homeState.data[homeState.rowKeys[r]] || [];
            var shown = (r === homeState.activeRow);
            for (var i = 0; i < items.length && i < HOME.STARTUP_ITEMS; i++) {
                var it = items[i];
                if (!it || it.homeCat) continue;
                // Картинка плитки — как в loadCardPoster: широкий кадр, иначе постер
                if (!shown) {
                    var tile = it.backdrop_path
                        ? tmdbImage(it.backdrop_path, homeState.tileImgSize)
                        : (it.poster_path ? posterUrlFor(it.poster_path) : '');
                    add(i < 6 ? tiles : tilesRest, tile);
                }
                if (it.backdrop_path && i < HOME.STARTUP_BACKDROPS && !(shown && i === 0)) {
                    var bd = homeState.goodBackdrops[it.backdrop_path] || backdropUrlFor(it.backdrop_path);
                    if (!backdropImgs.get(bd)) add(i === 0 ? backdrops : backdropsRest, bd);
                }
                var k = heroKey(it);
                var info = k ? knownLogo(it, k) : null;
                if (info && info.url && !info.loaded && !info.loading) add(logos, info.url);
            }
        }
        // Порядок — по пользе: то, что видно при первом «вниз», впереди
        window.PosterPrefetch.want(tiles.concat(backdrops, logos, tilesRest, backdropsRest), { low: true });
        prefetchCategoryBanners();
    }

    /** Баннеры плиток категорий — списки по одной категории, картинки первых фильмов */
    function prefetchCategoryBanners() {
        if (!window.CategoryBanners || typeof CategoryBanners.get !== 'function') return;
        var keys = [];
        for (var r = 0; r < homeState.rows.length; r++) {
            var cards = homeState.rows[r] || [];
            for (var c = 0; c < cards.length; c++) {
                var key = cards[c].dataset && cards[c].dataset.homeCat;
                if (key && keys.indexOf(key) === -1) keys.push(key);
            }
        }
        // По одной: у каждой категории десятки запросов (CategoryBanners), и
        // разом они заняли бы соединения к серверу, нужные прямо сейчас
        var at = 0;
        (function next() {
            if (at >= keys.length) return;
            var key = keys[at++];
            Promise.resolve(CategoryBanners.get(key)).then(function (list) {
                var urls = [];
                for (var i = 0; list && i < list.length && i < HOME.STARTUP_CAT_BANNERS; i++) {
                    var it = list[i];
                    if (it && it.backdrop_path) {
                        var bd = homeState.goodBackdrops[it.backdrop_path] || backdropUrlFor(it.backdrop_path);
                        if (!backdropImgs.get(bd)) urls.push(bd);
                    }
                    var info = logoFromData(it);
                    if (info && info.url) urls.push(info.url);
                }
                if (urls.length) window.PosterPrefetch.want(urls, { low: true });
            }, function () { }).then(next);
        })();
    }

    var artPrefetchTimer = null;

    function prefetchNearArt(items, idx) {
        if (!window.PosterPrefetch) return;
        if (artPrefetchTimer) clearTimeout(artPrefetchTimer);
        artPrefetchTimer = setTimeout(function run() {
            if (window.navHold) { artPrefetchTimer = setTimeout(run, HOME.ART_PREFETCH_DELAY_MS); return; }
            artPrefetchTimer = null;
            var urls = [];
            for (var d = 1; d <= HOME.ART_NEAR; d++) {
                var pair = [idx + d, idx - d];
                for (var j = 0; j < 2; j++) {
                    var it = items[pair[j]];
                    var k = it ? heroKey(it) : null;
                    if (!k) continue;
                    var path = it.backdrop_path;
                    if (path) {
                        var bd = homeState.goodBackdrops[path] || backdropUrlFor(path);
                        if (!backdropImgs.get(bd)) urls.push(bd);
                    }
                    var info = knownLogo(it, k);
                    if (info && info.url && !info.loaded && !info.loading) urls.push(info.url);
                }
            }
            if (urls.length) window.PosterPrefetch.want(urls);
        }, HOME.ART_PREFETCH_DELAY_MS);
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

    /**
     * Убирает запись из «Продолжить просмотр» на месте: запрос на сервер уже
     * ушёл (removeHistoryCard, catalog.js), а ряд собирается один раз за показ
     * главной — перезагружать её ради одной карточки незачем. focusNext —
     * карточка была под фокусом: ставим его на соседнюю.
     */
    function removeHistoryItem(id, mediaType, focusNext) {
        var ri = homeState.rowKeys.indexOf('history');
        if (ri === -1) return false;
        var cards = homeState.rows[ri];
        var ci = -1;
        for (var i = 0; i < cards.length; i++) {
            if (String(cards[i].dataset.itemId) === String(id) && cards[i].dataset.mediaType === mediaType) { ci = i; break; }
        }
        if (ci === -1) return false;
        // На сервере записей больше, чем в ряду, — дочитываем историю, и
        // syncHistoryRow допишет следующую в конец (запрос на удаление уже
        // завершён, ответ придёт без убранной записи)
        var refill = homeState.historyMore;
        homeState.historyGen++;
        var card = cards[ci];
        if (card.parentNode) card.parentNode.removeChild(card);
        cards.splice(ci, 1);
        if (homeState.data.history) homeState.data.history.splice(ci, 1);
        // По itemIndex баннер и клик находят запись в homeState.data
        for (var k = ci; k < cards.length; k++) cards[k].dataset.itemIndex = k;
        invalidateFocus();

        if (cards.length) {
            homeState.rowCols[ri] = Math.min(ci, cards.length - 1);
            if (homeState.lastRowKey === 'history') homeState.lastColIndex = homeState.rowCols[ri];
            if (focusNext) focusCard(ri, homeState.rowCols[ri]);
            if (refill) updateHistoryResume();
            return true;
        }

        // Последняя карточка — ряд убираем целиком, показываем соседний
        var rowEl = homeState.rowEls[ri];
        if (rowEl.parentNode) rowEl.parentNode.removeChild(rowEl);
        var wasActive = homeState.activeRow === ri;
        homeState.rows.splice(ri, 1);
        homeState.rowEls.splice(ri, 1);
        homeState.rowKeys.splice(ri, 1);
        homeState.rowCols.splice(ri, 1);
        if (homeState.activeRow > ri) homeState.activeRow--;
        updateRowCounters();
        invalidateFocus();
        if (!homeState.rowEls.length) return focusNext ? focusTopbar() : true;
        if (wasActive) {
            homeState.activeRow = -1;   // иначе setActiveRow не сочтёт ряд сменившимся
            setActiveRow(Math.min(ri, homeState.rowEls.length - 1));
            if (focusNext) focusActiveRowCard(0);
        }
        return true;
    }

    /** Возврат фокуса туда, откуда уходили (detail, поиск, донат) */
    function restoreHomeFocus() {
        uncoverHome();
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

        // --- кнопки баннера: «Смотреть», у категории ещё «‹ ›» ---
        if (isHeroButton(f)) {
            var hb = heroButtons();
            var hi = hb.indexOf(f);
            if (dir === 'left') return hi > 0 ? focusHomeEl(hb[hi - 1]) : true;
            if (dir === 'right') return hi < hb.length - 1 ? focusHomeEl(hb[hi + 1]) : true;
            if (dir === 'down') {
                if (!homeState.rowEls.length) return true;
                return focusActiveRowCard();
            }
            if (dir === 'up') {
                // Кнопки категории стоят «над» её рядом, а не над первым
                // рядом: вверх с них — в ряд выше, иначе «Продолжить просмотр»
                // был бы с плиток недостижим
                if (homeState.hero.cat.key && homeState.activeRow > 0) return focusRow(homeState.activeRow - 1);
                return focusTopbar();
            }
            return true;
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
            // С плитки категории — на кнопки её баннера (листать фильмы,
            // «Смотреть»); ряд выше — следующим «вверх» уже с них
            if (f.dataset && f.dataset.homeCat && f.dataset.homeCat === homeState.hero.cat.key) {
                var pbc = playButton();
                if (pbc) return focusHomeEl(pbc);
            }
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
        if (isHeroButton(f)) { focusTopbar(); return true; }
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

    /**
     * Плитка категории → её сетка в #content-catalog, как раньше карточка
     * «Показать все» в рядах каталога. Шаг 'grid' в стеке переходов: «назад»
     * из сетки снимает его (backToCatalogList), а showCatalogList — экрана
     * списка категорий больше нет — возвращает на главную, на эту же плитку
     * (lastRowKey / lastColIndex).
     */
    /*
     * Вход в категорию — плавный, как вход в карточку фильма. Раньше главная
     * пропадала одним кадром, потом стоял чёрный экран, пока грузилась сетка, и
     * сетка впрыгивала целиком. Теперь:
     *  1. главная под шапкой гаснет (HOME.CATEGORY_FADE_S) — шапка остаётся;
     *  2. сетка до готовности прозрачна, а нарисовавшись — поднимается и
     *     проявляется (Animations.beginContentEnter / playContentEnter).
     * Только opacity и transform; постеры, как и раньше, проявляются сами.
     */
    function openCategory(catKey, key, index) {
        homeState.lastRowKey = key;
        homeState.lastColIndex = index;
        if (typeof window.loadCatalog !== 'function') return true;
        // Повторное OK, пока главная гаснет: открытие уже идёт
        if (homeState.openingCategory) return true;
        // Баннер замирает, а не пропадает: см. pauseHeroForExit
        pauseHeroForExit();
        if (window.Nav) Nav.push('grid', { key: 'cat:' + catKey, label: catKey });
        if (window.AppState) AppState.inSearch = 'catalog';
        if (typeof catalogState !== 'undefined') catalogState.favoritesFromTopbar = false;
        // Сетка начинается с первой карточки, а не с той, где стояли в прошлый раз
        try { localStorage.removeItem('lastCatalogCardIndex'); } catch (e) { }

        var homeEl = el('content-home');
        var anim = typeof Animations !== 'undefined' ? Animations : null;
        var canFade = !!(homeEl && anim && typeof anim.fadeOut === 'function' && anim.beginContentEnter);
        homeState.openingCategory = true;

        var go = function () {
            homeState.openingCategory = false;
            // Главной уже не видно — теперь трейлер можно разобрать
            suspendHero();
            // Пока главная гасла, ушли в другое место (шапка, «Назад») — не перебиваем
            if (window.AppState && AppState.currentScreen !== 'home') {
                if (canFade) anim.resetFade(homeEl);
                return;
            }
            scrollHomeToTop();
            var grid = el('catalog-grid');
            if (canFade && grid) anim.beginContentEnter(grid);
            if (typeof window.showContentScreen === 'function') window.showContentScreen('catalog');
            // Главная уже спрятана — погашенная прозрачность ей больше не нужна
            if (canFade) anim.resetFade(homeEl);
            // Фокус на первую карточку — сами, как вкладка «Избранное» (app.js):
            // loadCatalog его не ставит, и пульт ждал бы подстраховку фокуса
            Promise.resolve(window.loadCatalog(catKey)).then(function () {
                if (canFade && grid) anim.playContentEnter(grid);
                setTimeout(function () {
                    if (!window.AppState || AppState.currentScreen !== 'catalog') return;
                    if (typeof catalogState !== 'undefined' && catalogState.currentCatalog !== catKey) return;
                    if (typeof window.ensureCatalogFocus === 'function') window.ensureCatalogFocus(true);
                }, HOME.FOCUS_DELAY_MS);
            }, function () {
                if (canFade && grid) anim.clearContentEnter(grid);
            });
        };

        if (canFade) anim.fadeOut(homeEl, { duration: HOME.CATEGORY_FADE_S, keepFaded: true, onDone: go });
        else go();
        return true;
    }

    function openHomeItem(item, key, index) {
        if (item && item.catKey) return openCategory(item.catKey, key, index);
        homeState.lastRowKey = key;
        homeState.lastColIndex = index;
        if (window.Nav) Nav.push('detail', Nav.detailData(item, index));
        // Карточка проявляется поверх главной (Animations.animateDetailShow), и
        // пока она полупрозрачна, главная видна: баннер замирает, а не
        // пропадает, и ряд не прыгает к началу. Разбор трейлера и прокрутка —
        // когда карточка уже закрыла главную
        pauseHeroForExit();
        setTimeout(function () {
            suspendHero();
            if (window.AppState && AppState.currentScreen === 'home') {
                // Уже вернулись (карточку закрыли сразу): баннер заводим заново,
                // иначе он так и стоял бы замершим кадром трейлера
                var f = document.querySelector('.focused');
                if (f && findCardPosition(f)) setHeroFromCard(f);
                return;
            }
            scrollHomeToTop();
        }, HOME.DETAIL_COVER_MS);
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
    // ==================== «ПРОДОЛЖИТЬ» В БАННЕРЕ ====================
    //
    // На карточке ряда «Продолжить просмотр» кнопка баннера — не «Смотреть»
    // (поиск раздачи), а «Продолжить · С1 Е3 · 20:15»: запуск с того места,
    // где остановились, без захода в карточку (resumeWatching в player.js).
    // Место — поле resume записи истории (общий таймкод фильма/серии, сервер
    // 1.0.56). Нет его, или фильм досмотрен — кнопка обычная.

    /** resume элемента, если по нему есть что продолжать, иначе null */
    function heroResume(item) {
        var r = item && item.isHistoryItem ? item.resume : null;
        if (!r || !r.hash || !(r.timecode > 0)) return null;
        var finished = typeof window.isResumeFinished === 'function' && window.isResumeFinished(r);
        // Фильм досмотрен — продолжать нечего, остаётся «Смотреть»
        if (finished && item.media_type !== 'tv') return null;
        return r;
    }

    /**
     * То же для карточки фильма: её могли открыть и не из ряда истории (из
     * подборки, поиска, «Похожих»), а элемент в стеке переходов мог устареть.
     * Поэтому сначала ряд — его обновляет updateHistoryResume, — потом сам элемент.
     */
    function resumeForItem(item) {
        var list = homeState.data && homeState.data.history;
        var type = item && (item.media_type || 'movie');
        for (var i = 0; item && list && i < list.length; i++) {
            if (String(list[i].id) === String(item.id) && list[i].media_type === type) return heroResume(list[i]);
        }
        return heroResume(item);
    }

    /**
     * Место просмотра прямо с сервера. Ряд истории держит только начало списка,
     * а раздачу могут выбрать и давно заброшенному сериалу. Сервер не ответил —
     * что знает ряд.
     */
    function fetchResumeFor(item) {
        var saved = typeof awaitPendingTimecodeSave === 'function' ? awaitPendingTimecodeSave() : Promise.resolve();
        return saved.then(function () {
            return homeFetch(withClientId(serverUrl() + '/api/history'));
        }).then(function (data) {
            var list = data && data.success && data.history;
            if (!list) return resumeForItem(item);
            for (var i = 0; i < list.length; i++) {
                if (String(list[i].tmdbId) === String(item.id) && list[i].mediaType === item.media_type) return list[i].resume || null;
            }
            return null;
        });
    }

    function formatResumeTime(sec) {
        sec = Math.max(0, Math.floor(sec || 0));
        var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
        var mm = (h && m < 10 ? '0' : '') + m, ss = (s < 10 ? '0' : '') + s;
        return (h ? h + ':' : '') + mm + ':' + ss;
    }

    function resumeLabel(item, r) {
        var finished = typeof window.isResumeFinished === 'function' && window.isResumeFinished(r);
        var ep = r.season !== undefined && r.episode ? 'С' + r.season + ' Е' + r.episode : '';
        // Досмотренная серия — дальше следующая; номер её знает только список
        // файлов раздачи, поэтому без номера
        if (finished) return 'Следующая серия';
        return 'Продолжить' + (ep ? ' · ' + ep : '') + ' · ' + formatResumeTime(r.timecode);
    }

    function setPlayLabel(item) {
        var label = el('home-play-label');
        if (!label) return;
        var r = heroResume(item);
        var text = r ? resumeLabel(item, r) : 'Смотреть';
        if (label.textContent !== text) label.textContent = text;
    }

    function resumeHeroItem(item, r) {
        suspendHero();
        window.resumeWatching(item, r).then(function (res) {
            if (res === 'started' || res === 'offline') return;
            // Раздачу удалили из TorrServer (или в ней нет этого файла) —
            // открываем карточку: там «Смотреть» найдёт раздачу заново
            if (typeof window.showToast === 'function') window.showToast('Раздачи больше нет в TorrServer — выберите её заново');
            openHomeItem(item, homeState.rowKeys[homeState.activeRow], homeState.lastColIndex);
        }, function () {
            openHomeItem(item, homeState.rowKeys[homeState.activeRow], homeState.lastColIndex);
        });
        return true;
    }

    function historyKey(item) {
        return String(item.id) + '_' + item.media_type;
    }

    /**
     * Ряд «Продолжить просмотр» поверх уже собранной главной. createHomeRow
     * дописывает ряд в конец списков — переносим его в начало, как в HOME_ROWS.
     * Показанный ряд остаётся тем же (activeRow сдвигается вместе с ним).
     */
    function insertHistoryRow(list) {
        var container = el('home-rows');
        var cfg = null;
        for (var i = 0; i < HOME_ROWS.length; i++) if (HOME_ROWS[i].key === 'history') { cfg = HOME_ROWS[i]; break; }
        if (!container || !cfg) return;
        var hadRows = homeState.rowEls.length > 0;
        var row = createHomeRow(cfg, list);
        if (!row) return;
        homeState.rows.unshift(homeState.rows.pop());
        homeState.rowEls.unshift(homeState.rowEls.pop());
        homeState.rowKeys.unshift(homeState.rowKeys.pop());
        homeState.rowCols.unshift(homeState.rowCols.pop());
        // Без рядов в контейнере заглушка («Подборки недоступны») — её убираем
        if (!hadRows) container.innerHTML = '';
        container.insertBefore(row, container.firstChild);
        updateRowCounters();
        if (hadRows) homeState.activeRow++;
        else setActiveRow(0);
        invalidateFocus();
    }

    /**
     * Привести ряд к ответу сервера. Смотрели не с баннера, а из поиска или
     * другой раздачи — у записи новые раздача и таймкод, фильм мог подняться
     * в начало ряда, а новый — появиться. Известные записи остаются теми же
     * объектами и карточками: на них смотрят баннер и открытая карточка фильма,
     * а в карточках уже стоят постеры. Фокус остаётся на том же фильме.
     */
    function syncHistoryRow(fresh) {
        var old = homeState.data.history || [];
        var known = {}, i;
        for (i = 0; i < old.length; i++) known[historyKey(old[i])] = old[i];
        var same = fresh.length === old.length;
        var list = fresh.map(function (it, n) {
            var was = known[historyKey(it)];
            if (was) was.resume = it.resume;
            if (was !== old[n]) same = false;
            return was || it;
        });
        homeState.data.history = list;

        // Главная не собрана (с неё ушли, пока грузились ряды, или её ещё не
        // открывали): данные выше нужны карточке фильма (resumeFor), а ряды
        // соберутся заново при возврате — со свежей историей
        if (!homeState.built) return;

        // Ряда ещё нет (истории не было при сборке главной) — ставим его сейчас,
        // а не ждём следующей сборки: иначе первый же просмотр не появлялся на
        // главной до перезагрузки страницы
        var ri = homeState.rowKeys.indexOf('history');
        if (ri === -1) {
            if (list.length) insertHistoryRow(list);
            return;
        }
        var cards = homeState.rows[ri];
        if (!same) {
            var track = homeState.rowEls[ri].querySelector('.catalog-row-track');
            var anchor = cards[homeState.rowCols[ri]];
            var hadFocus = !!(anchor && anchor.classList.contains('focused'));
            var byKey = {};
            for (i = 0; i < cards.length; i++) byKey[cards[i].dataset.itemId + '_' + cards[i].dataset.mediaType] = cards[i];
            var next = list.map(function (it, n) {
                var card = byKey[historyKey(it)] || createHomeCard(it, 'history', n);
                card.dataset.itemIndex = n;
                return card;
            });
            for (i = 0; i < cards.length; i++) {
                if (next.indexOf(cards[i]) === -1 && cards[i].parentNode) cards[i].parentNode.removeChild(cards[i]);
            }
            for (i = 0; i < next.length; i++) track.appendChild(next[i]);
            homeState.rows[ri] = cards = next;
            var col = Math.max(0, next.indexOf(anchor));
            homeState.rowCols[ri] = col;
            if (homeState.lastRowKey === 'history') homeState.lastColIndex = col;
            invalidateFocus();
            loadRowPosters(ri);
            if (hadFocus) focusCard(ri, col);
        }
        for (i = 0; i < cards.length; i++) setCardProgress(cards[i], list[i].resume);
    }

    /**
     * Перечитать историю после просмотра и при каждом приходе на главную: ряд
     * собирается один раз, а смотреть могли откуда угодно. Сначала дожидаемся
     * таймкода выхода из плеера, иначе сервер ответит прежним местом.
     *
     * Попросили, пока запрос идёт, — его ответ может не знать о том, что
     * случилось после отправки (удалили ещё карточку, сохранился таймкод),
     * поэтому следом ещё один, общий для всех, кто попросил за это время.
     * Ответ на запрос, отправленный до удаления из ряда (historyGen сменился),
     * не применяем: он вернул бы убранную карточку.
     */
    function updateHistoryResume() {
        if (homeState.historySync) {
            if (!homeState.historyAgain) {
                homeState.historyAgain = homeState.historySync.then(function () {
                    homeState.historyAgain = null;
                    return updateHistoryResume();
                });
            }
            return homeState.historyAgain;
        }
        // Не только для собранной главной: сборку прерывает уход с неё, пока
        // грузятся ряды (built остаётся false), а карточке фильма история нужна всё равно
        if (!homeState.data) return Promise.resolve();
        var gen = homeState.historyGen;
        var saved = typeof awaitPendingTimecodeSave === 'function' ? awaitPendingTimecodeSave() : Promise.resolve();
        var sync = saved.then(function () {
            return homeFetch(withClientId(serverUrl() + '/api/history'));
        }).then(function (data) {
            if (gen !== homeState.historyGen) return;
            if (!data || !data.success || !data.history || !data.history.length) return;
            homeState.historyMore = data.history.length > HOME.ITEMS_PER_ROW;
            syncHistoryRow(data.history.slice(0, HOME.ITEMS_PER_ROW).map(historyRowItem));
            if (homeState.hero.item) setPlayLabel(homeState.hero.item);
        })['catch'](function () { }).then(function () {
            homeState.historySync = null;
        });
        homeState.historySync = sync;
        return sync;
    }

    function playHeroItem() {
        var item = homeState.hero.item;
        if (!item) return ensureHomeFocus(true);
        var resume = heroResume(item);
        if (resume && typeof window.resumeWatching === 'function') return resumeHeroItem(item, resume);
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
        // Свободный поиск с главной — строка редактируемая, контекст карточки
        // каталога (если был) больше не действует
        if (typeof window.setSearchLocked === 'function') window.setSearchLocked(false);
        if (typeof window.clearCatalogSearchContext === 'function') window.clearCatalogSearchContext();
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

        // Переход в раздел из шапки поверх карточки раздачи — та закрывается,
        // раздачу останавливаем, как и по «назад» (torrents.js)
        if (window.AppState && AppState.currentScreen === 'detail' &&
            typeof window.dropOpenTorrentDetail === 'function') window.dropOpenTorrentDetail();

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
        if (window.Nav) Nav.reset('home');
        if (!isHomeVisible()) return showHome({ restoreFocus: true });
        if (!homeState.rowEls.length) return true;
        return focusRow(0);
    }

    function onHomeOk(f) {
        if (!f) return ensureHomeFocus(true);
        if (f.id === 'home-play-btn') return playHeroItem();
        if (f.id === 'home-prev-btn') return stepCategory(-1);
        if (f.id === 'home-next-btn') return stepCategory(1);
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

        var cfgs = HOME_ROWS.filter(function (cfg) {
            return !cfg.season || isSeasonActive(cfg.season);
        });
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
        // Заглушка ещё на экране (первый запуск) — window.load её не снимет:
        // он приходит раньше постеров, их грузим мы. Снимет dismissLoaderWhenReady
        if (moduleLoaderUp() && typeof window.holdModuleLoader === 'function') {
            window.holdModuleLoader();
        }
        // Проверка обновления каталогов (фильмы, сериалы и т.д.) — на старте, пока
        // идёт заставка, а не при открытии каталога: там обновление перерисовывало
        // сетку под пользователем. Один раз за запуск; заставку держит
        // dismissLoaderWhenReady
        if (window.CatalogStartup && typeof window.CatalogStartup.start === 'function') {
            window.CatalogStartup.start();
        }

        container.innerHTML = '<div class="catalog-rows-loading">' +
            '<div class="loading-spinner" style="margin:0 auto 20px"></div>' +
            '<div style="font-size:16px;color:#aaa">Загрузка подборок...</div></div>';
        invalidateFocus();

        return new Promise(function (resolve) {
            function finish(value) {
                if (finished) return;
                finished = true;
                // Ни одного ряда так и не показали (главную покинули, рядов
                // нет) — заглушку, которую мы держали, отпускаем сразу
                if (!homeState.activated) dismissModuleLoader();
                resolve(value);
            }

            function activate() {
                if (homeState.activated) return;
                homeState.activated = true;
                // Первый ряд на экране — заглушка уходит, как только догрузятся
                // его постеры и баннер (их запрашивают следом, ниже)
                dismissLoaderWhenReady();
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
                    // Данные всех рядов на месте — остальное для главной фоном,
                    // пока ещё идёт заставка (prefetchHomeStartup)
                    if (renderedRows > 0) prefetchHomeStartup();
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
        uncoverHome();

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
            AppState.isCatalogSearch = false;
        }
        // Пришли на главную, а категория так и осталась открытой (ушли из
        // сетки кнопкой «Главная» в шапке): вернуться в неё теперь можно только
        // плиткой, то есть заново, — карточки в скрытом DOM не держим
        if (typeof catalogState !== 'undefined' && catalogState.currentCatalog &&
            typeof window.releaseCatalogGrid === 'function') {
            window.releaseCatalogGrid();
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
        homeState.cardCssKey = null;
        invalidateHeroTop();      // пока ходили по настройкам, шапка могла стать другой
        homeState.activated = true;
        setActiveRow(Math.min(homeState.activeRow, Math.max(0, homeState.rowEls.length - 1)));
        updateHistoryResume();

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
        var clearBanners = window.CategoryBanners ? CategoryBanners.clear() : null;
        return Promise.all([dbClear(), clearBanners]).then(function () {
            leaveCategoryHero();
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
            // Приход на главную — тем же проявлением, что у вкладок «Каталог» и
            // «Мои торренты» (showContentScreen в app.js). Только если главная была
            // спрятана: возврат из карточки или поиска, под которыми она так и
            // стояла, мигать не должен.
            if (homeScreen) {
                var canFade = typeof Animations !== 'undefined' && typeof Animations.fadeIn === 'function';
                if (screen === 'home' && homeScreen.hidden && canFade) {
                    Animations.fadeIn(homeScreen, { duration: Animations.UI_FADE.screen });
                } else {
                    if (canFade) Animations.resetFade(homeScreen);
                    homeScreen.hidden = (screen !== 'home');
                }
            }
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

        // 2. Возврат из карточки на главную ведёт стек переходов (nav.js):
        //    restoreFocusAfterNavigation('home') в app.js.

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
            if (document.hidden) { suspendHero(true); return; }
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
                suspendHero(true);
                return origStartPlayback.apply(this, arguments);
            };
        }

        // 6. Раскладка привязана к высоте экрана — пересчитываем на resize
        window.addEventListener('resize', function () {
            if (!isHomeVisible()) return;
            if (homeState.resizeTimer) clearTimeout(homeState.resizeTimer);
            homeState.resizeTimer = setTimeout(function () {
                homeState.resizeTimer = null;
                homeState.cardCssKey = null;  // размер мог не измениться — но пересчитать надо
                invalidateHeroTop();
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
                var out = getNavButtons().concat(heroButtons());
                // Спрашиваем РЯД, а не каждую карточку: вне экрана ряд скрыт
                // целиком (HIDDEN_ROW_CLASS, display: none), а offsetParent на
                // карточке заставлял браузер пересчитать раскладку всего
                // документа. Рядов тринадцать, карточек в них две с половиной
                // сотни — на замере это 134 мкс против 14 мкс за вызов.
                // Список получается тот же: карточки поштучно никто не прячет.
                var rows = document.querySelectorAll('#home-rows .catalog-row');
                for (var i = 0; i < rows.length; i++) {
                    if (rows[i].classList.contains(HOME.HIDDEN_ROW_CLASS)) continue;
                    var cards = rows[i].querySelectorAll('.catalog-row-card');
                    for (var k = 0; k < cards.length; k++) out.push(cards[k]);
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
    var gestureLockUntil = 0;   // до этого времени новый шаг не делаем
    var swipe = null;

    // Страница главной неподвижна: вертикальный жест забираем всегда
    // (preventDefault), а прокрутку контейнера держим на нуле (lockHomeScroll).
    // Раньше жест отдавали браузеру, если раскладка вылезала за экран, — а она
    // вылезает на 2–20 px пустых нижних отступов (1920×1080, телефон в
    // альбомной), и на телефоне ещё на высоту адресной строки (#main-container
    // — 100vh). Страница ехала под пальцем и тут же откатывалась к ряду —
    // свайп выглядел дёргано. Карточки при этом помещаются целиком.

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
        if (now - wheelAccumAt > 400 || (wheelAccum > 0) !== (dy > 0)) wheelAccum = 0;
        wheelAccumAt = now;
        wheelAccum += dy;
        e.preventDefault();

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
        swipe = { x: t.clientX, y: t.clientY, anchor: t.clientY, vertical: false };
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
        }

        e.preventDefault();

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
        // (прогретый соседний ряд разложен, offsetParent у него есть — смотрим класс)
        if (v.offsetParent === null || (v.closest && v.closest('.' + HOME.HIDDEN_ROW_CLASS))) { stopHoverScroll(); return; }
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

    /**
     * Прокрутку контейнера, пока активна главная, сразу возвращаем в ноль: её
     * может сдвинуть не только палец, но и доводка фокуса (focusEl) к карточке
     * у нижнего края. Только для активной главной — карточка фильма и другие
     * экраны прокручивают тот же #main-container.
     *
     * Сначала экран, потом scrollTop: чтение scrollTop посреди прокрутки — это
     * принудительный пересчёт стилей и раскладки, а событие scroll приходит на
     * каждом кадре твина и в каталоге, и в сетке категории. Замер на эмуляторе
     * Android TV: в сетке так набегало ~180 мс вынужденных Layout/Recalc Style
     * за 30 шагов — на экране, где этот обработчик ничего не делает.
     */
    function lockHomeScroll() {
        var mc = el('main-container');
        if (!mc) return;
        mc.addEventListener('scroll', function () {
            if (!window.AppState || AppState.currentScreen !== 'home') return;
            if (isHomeFocusable() && mc.scrollTop) mc.scrollTop = 0;
        }, { passive: true });
    }

    function initGestures() {
        lockHomeScroll();
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

    // ==================== ГЛАВНАЯ ПОД КАРТОЧКОЙ ====================
    /*
     * Карточка (#detail-view) — position: fixed поверх всего, и главная под ней
     * оставалась в раскладке: ~1700 элементов из ~2500, которые браузер
     * продолжал учитывать при каждом пересчёте стилей. Замер: переход фокуса в
     * карточке на ~20% дороже, общий пересчёт (смена «Внешнего вида») — на ~60%.
     *
     * Поэтому, когда карточка проявилась полностью, главную убираем из
     * раскладки классом (display: none), а при начале любого ухода из карточки
     * возвращаем. Не атрибутом hidden: по нему «назад» решает, что под
     * карточкой главная (isHomeUnderneath в control.js).
     *
     * Каталог так не прячем: там вернуть надо ещё и вертикальную прокрутку
     * длинной сетки, а она при display: none теряется.
     *
     * Возврат синхронный в трёх местах — animateDetailHide (animations.js),
     * showHome и restoreHomeFocus: сразу за ними идут замеры и прокрутка рядов,
     * а у спрятанной главной всё это нули. Наблюдатель за #detail-view ниже —
     * страховка для полутора десятков мест, которые гасят карточку напрямую.
     */
    var COVER_CLASS = 'home-under-detail';
    // Позже появления карточки (DETAIL_FADE.show = 380 мс) с запасом: прятать
    // главную можно только под непрозрачной карточкой, иначе она мигнёт
    var COVER_DELAY_MS = 700;
    var cover = { on: false, timer: null, rows: null, layoutPending: false };

    function detailShownState(dv) {
        if (!dv || !dv.style.display || dv.style.display === 'none') return false;
        return dv.getAttribute('data-hiding') !== '1';
    }

    function coverHome() {
        cover.timer = null;
        var screen = el('content-home');
        var dv = el('detail-view');
        if (cover.on || !screen || screen.hidden || !detailShownState(dv)) return;
        // Карточка ещё проявляется (или ждёт содержимое под «Загрузка…») — ждём
        if (parseFloat(window.getComputedStyle(dv).opacity) < 0.99) {
            cover.timer = setTimeout(coverHome, COVER_DELAY_MS);
            return;
        }
        // Прокрутку каруселей запоминаем: Chrome 66 может её не сохранить
        var vps = screen.querySelectorAll('.catalog-row-viewport');
        cover.rows = [];
        for (var i = 0; i < vps.length; i++) cover.rows.push([vps[i], vps[i].scrollLeft]);
        screen.classList.add(COVER_CLASS);
        cover.on = true;
    }

    /** Вернуть главную в раскладку. Безопасно звать когда угодно. */
    function uncoverHome() {
        if (cover.timer) { clearTimeout(cover.timer); cover.timer = null; }
        if (!cover.on) return false;
        cover.on = false;
        var screen = el('content-home');
        if (screen) screen.classList.remove(COVER_CLASS);
        var rows = cover.rows || [];
        cover.rows = null;
        for (var i = 0; i < rows.length; i++) {
            if (rows[i][0].isConnected && rows[i][0].scrollLeft !== rows[i][1]) rows[i][0].scrollLeft = rows[i][1];
        }
        if (cover.layoutPending) {
            cover.layoutPending = false;
            layoutHome();
        }
        return true;
    }

    function watchDetailForCover() {
        var dv = el('detail-view');
        if (!dv || typeof MutationObserver === 'undefined') return;
        new MutationObserver(function () {
            if (!detailShownState(dv)) { uncoverHome(); return; }
            if (!cover.on && !cover.timer) cover.timer = setTimeout(coverHome, COVER_DELAY_MS);
        }).observe(dv, { attributes: true, attributeFilter: ['style', 'data-hiding'] });
    }

    // ==================== ШАПКА РАЗДЕЛОВ ПОВЕРХ КАРТОЧКИ ====================
    /*
     * Из карточки можно уходить вглубь сколь угодно долго — по рекомендациям и
     * фильмографиям актёров, — и обратный путь тогда меряется десятком нажатий
     * «назад». Шапка разделов даёт выход в один шаг: «Главная», «Каталог»,
     * «Мои торренты» прямо из карточки.
     *
     * Копию шапки не делаем. Её кнопки — это ФИЗИЧЕСКИ те же элементы вкладок,
     * на которых висят обработчики разделов (index.html так и задуман: «не
     * пересоздаём, а переносим»), а второй набор тех же id сломал бы всё сразу.
     * Поэтому переносим саму шапку внутрь #detail-view.
     *
     * Переносим не на всё время карточки, а только пока шапка показана.
     * Причина практическая: #detail-view гасят напрямую примерно из полутора
     * десятков мест, и шапка, оставленная внутри, ушла бы вместе с ним — раздел
     * остался бы без навигации. Короткое окно закрывает почти всё, а на
     * остаток есть страховка ensureHome() из showContentScreen (app.js).
     */
    var topbarHome = null;      // куда возвращать: { parent, next }

    function detailTopbarShown() {
        var bar = el('home-topbar');
        return !!(bar && bar.parentNode && bar.parentNode.id === 'detail-view');
    }

    function detailTopbarShow() {
        var bar = el('home-topbar');
        var dv = el('detail-view');
        if (!bar || !dv) return false;
        if (detailTopbarShown()) return true;
        topbarHome = { parent: bar.parentNode, next: bar.nextSibling };
        bar.classList.add('detail-topbar');
        dv.insertBefore(bar, dv.firstChild);
        return true;
    }

    /** Вернуть шапку на своё место. Безопасно звать когда угодно. */
    function detailTopbarEnsureHome() {
        var bar = el('home-topbar');
        if (!bar || !detailTopbarShown()) return false;
        bar.classList.remove('detail-topbar');
        var parent = topbarHome && topbarHome.parent;
        if (parent && parent.isConnected) {
            var next = topbarHome.next;
            parent.insertBefore(bar, (next && next.parentNode === parent) ? next : null);
        } else {
            // Исходного места не осталось — кладём в начало секции, там она и жила
            var sec = el('torrserver-section');
            if (sec) sec.insertBefore(bar, sec.firstChild);
        }
        topbarHome = null;
        return true;
    }

    /*
     * Фокус в шапке ведём ровно так же, как на главной, — она одна и та же,
     * и вести себя в карточке иначе ей незачем:
     *
     *   • список кнопок — getNavButtons(): фиксированный порядок NAV_BUTTONS
     *     плюс отсев невидимых. querySelectorAll по классу этого не давал:
     *     скрытая кнопка попадала в список, и фокус уходил в пустоту;
     *
     *   • фокусируем через focusHomeEl(): он пересобирает список фокусируемых и
     *     зовёт setFocus(idx), а не focusEl напрямую. Разница существенная —
     *     focusEl не двигает currentFocusIndex в control.js, тот остаётся от
     *     прошлого элемента, и следующее нажатие уводит фокус не туда;
     *
     *   • куда встать при показе — в ту же кнопку, где стояли в прошлый раз
     *     (homeState.lastNavBtnId). Один счётчик на главную и на карточку:
     *     шапка одна, и «где я в ней был» тоже должно быть одно.
     */
    function detailTopbarFocus(btn) {
        if (!btn) return false;
        homeState.lastNavBtnId = btn.id || homeState.lastNavBtnId;
        focusHomeEl(btn);
        return true;
    }

    function detailTopbarPreferred() {
        var btns = getNavButtons();
        if (!btns.length) return null;
        var last = el(homeState.lastNavBtnId);
        if (last && btns.indexOf(last) !== -1) return last;
        return el('home-nav-home') || btns[0];
    }

    window.DetailTopbar = {
        show: detailTopbarShow,
        hide: detailTopbarEnsureHome,
        ensureHome: detailTopbarEnsureHome,
        isShown: detailTopbarShown,
        buttons: getNavButtons,
        focus: detailTopbarFocus,
        preferred: detailTopbarPreferred
    };

    // ==================== ИНИЦИАЛИЗАЦИЯ ====================

    // ==================== МЕНЮ РАЗДЕЛОВ НА ТЕЛЕФОНЕ ====================
    //
    // В книжной ориентации телефона кнопки шапки не помещаются в строку: они
    // лежат в #home-nav-drawer, который styles.css (блок «Телефон, книжная
    // ориентация») превращает в выезжающую слева панель. Открывает её нажатие на
    // название, закрывают затемнение, выбор раздела и «Назад». На ТВ и ПК
    // медиазапрос не срабатывает, класс на body ничего не меняет, а название
    // клик просто игнорирует.

    var MOBILE_NAV_QUERY = '(max-width: 600px) and (orientation: portrait)';
    var BACK_KEYS = { 8: 1, 27: 1, 461: 1, 10009: 1 };

    function mobileNavApplies() {
        return !!(window.matchMedia && window.matchMedia(MOBILE_NAV_QUERY).matches);
    }

    function mobileNavOpen() {
        return document.body.classList.contains('mobile-nav-open');
    }

    // Шапка поднята в карточку ради меню (кнопка ≡ в карточке) — при закрытии
    // меню её надо вернуть. Отдельный флаг: пультом шапку в карточку поднимает
    // control.js, и её мы не трогаем.
    var topbarRaisedForMenu = false;

    function setMobileNav(open) {
        if (open && !mobileNavApplies()) return;
        document.body.classList.toggle('mobile-nav-open', !!open);
        if (!open && topbarRaisedForMenu) {
            topbarRaisedForMenu = false;
            detailTopbarEnsureHome();
        }
    }

    /**
     * ≡ в карточке фильма: меню разделов живёт в шапке, а шапка — снаружи
     * карточки, под ней (#detail-view перекрывает #main-container). Поднимаем
     * её в карточку тем же DetailTopbar, что и стрелка вверх с пульта, — на
     * время, пока открыто меню: держать её там всё время карточки нельзя, её
     * гасят вместе с карточкой (см. «ШАПКА РАЗДЕЛОВ ПОВЕРХ КАРТОЧКИ»).
     */
    function openMenuFromDetail() {
        if (!mobileNavApplies()) return;
        if (!detailTopbarShown()) {
            if (!detailTopbarShow()) return;
            topbarRaisedForMenu = true;
        }
        setMobileNav(true);
    }

    // То же для экрана настроек: заголовок «Настройки» открывает список
    // разделов, выбор раздела и затемнение его закрывают.
    function settingsNavOpen() {
        return document.body.classList.contains('settings-nav-open');
    }

    function setSettingsNav(open) {
        if (open && !mobileNavApplies()) return;
        document.body.classList.toggle('settings-nav-open', !!open);
    }

    function initSettingsNav() {
        var title = document.querySelector('#config-screen .settings-title');
        if (title) title.addEventListener('click', function () { setSettingsNav(!settingsNavOpen()); });
        var backdrop = el('settings-nav-backdrop');
        if (backdrop) backdrop.addEventListener('click', function () { setSettingsNav(false); });
        var nav = document.querySelector('#config-screen .settings-nav');
        if (nav) {
            // Раздел переключает обработчик самого пункта, мы только закрываем.
            // На перехвате: обработчик пункта останавливает всплытие
            nav.addEventListener('click', function (e) {
                if (e.target.closest && e.target.closest('.menu-item')) setSettingsNav(false);
            }, true);
        }
    }

    function initMobileNav(topbar) {
        var detailMenu = el('detail-menu-btn');
        if (detailMenu) detailMenu.addEventListener('click', openMenuFromDetail);
        var logo = topbar.querySelector('.section-title-header');
        if (logo) {
            logo.addEventListener('click', function () { setMobileNav(!mobileNavOpen()); });
        }
        var backdrop = el('home-nav-backdrop');
        if (backdrop) backdrop.addEventListener('click', function () { setMobileNav(false); });

        // «Назад» закрывает меню и дальше не идёт: иначе control.js ещё и увёл бы
        // с экрана. Перехват на window раньше всех; popstate-обработчик
        // приложения тоже приходит сюда синтетическим Escape.
        window.addEventListener('keydown', function (e) {
            if (!mobileNavOpen() && !settingsNavOpen()) return;
            if (!BACK_KEYS[e.keyCode] && e.key !== 'Escape' && e.key !== 'GoBack') return;
            e.preventDefault();
            e.stopImmediatePropagation();
            setMobileNav(false);
            setSettingsNav(false);
        }, true);

        // Повернули телефон — панель там уже не нужна
        if (window.matchMedia) {
            var mq = window.matchMedia(MOBILE_NAV_QUERY);
            var onChange = function () {
                if (mq.matches) return;
                setMobileNav(false);
                setSettingsNav(false);
            };
            if (mq.addEventListener) mq.addEventListener('change', onChange);
            else if (mq.addListener) mq.addListener(onChange);
        }
        initSettingsNav();
    }

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
                // Раздел выбран — меню на телефоне закрываем сразу, до перехода
                setMobileNav(false);
                onNavButton(btn.id, true);
            }, true);
            initMobileNav(topbar);
        }

        // Уход в раздел прямо из карточки. Перехват вешаем на #detail-view, а не
        // на саму шапку: у шапки уже есть свой перехватчик (выше), а порядок
        // среди перехватов задаёт глубина — предок срабатывает раньше. Нам надо
        // раньше: карточку сперва закрыть и забыть её путь возвратов.
        var detailView = el('detail-view');
        if (detailView) {
            detailView.addEventListener('click', function (e) {
                var btn = e.target.closest ? e.target.closest('.home-nav-btn') : null;
                if (!btn) return;
                // Раздел или наложение — решает catalog.js: там же и знание
                // о том, что за путь возвратов у карточки
                if (typeof window.detailTopbarNavigate === 'function') {
                    window.detailTopbarNavigate(btn.id);
                }
            }, true);
        }

        var rows = el('home-rows');
        if (rows) rows.addEventListener('click', onHomeRowsClick);

        startTopbarClock();
        watchDetailForCover();
        patchGlobals();
        registerStrategy();
        initGestures();

        // Главная открывается сразу, не дожидаясь проверки TorrServer
        if (window.Nav) Nav.reset('home');
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
        uncover: uncoverHome,
        rearmTrailer: rearmHeroTrailer,
        removeHistoryItem: removeHistoryItem,
        updateResume: updateHistoryResume,
        resumeFor: resumeForItem,
        fetchResume: fetchResumeFor,
        resumeLabel: resumeLabel,
        logoUrl: knownLogoUrl,
        state: homeState
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initHome);
    } else {
        initHome();
    }
})();
