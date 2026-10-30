// =====================================================
// ЗАСТАВКА: КАРТИНКИ ДНЯ BING
// =====================================================
//
// Через IDLE_MS без нажатий на весь экран выходит заставка — картинки дня Bing,
// сменяются раз в SLIDE_MS. Сервер TorrStream здесь не участвует: Bing отдаёт
// список без CORS, поэтому раз в день его собирает GitHub Actions зеркала
// (tools/bing/build.js в cash94.github.io) и кладёт в msx/cache/bing.json —
// страницы GitHub отдаются с Access-Control-Allow-Origin: *. Сами картинки
// грузятся прямо с www.bing.com. Список не пришёл — заставки просто нет.
//
// Не включается, пока что-то играет: трейлер в карточке фильма и вообще любое
// <video>, которое идёт, — в том числе трейлер в баннере главной (так решил
// владелец: баннер тоже считается трейлером).
//
// В плеере — только на паузе, и раньше: через PLAYER_DIM_MS паузы без нажатий
// картинка гаснет (#player-dim — чёрная пелена поверх кадра), через
// PLAYER_IDLE_MS выходит заставка. Это одинаково работает с обычным <video> и
// с AVPlay на Tizen: tizen-avplay.js подменяет paused у #video-player, а кадр
// AVPlay рисуется слоем ПОД страницей, так что пелена его тоже затемняет.
// Любое нажатие убирает и заставку, и пелену и показывает HUD плеера.
//
// Грузится СРАЗУ после config.js — раньше всех, кто слушает клавиатуру на
// window в фазе захвата (osk.js, ui-customizer.js, torrserverstats.js). Только
// так нажатие, которое будит заставку, можно погасить до того, как его
// разберёт кто-то ещё: проснуться — это всё, что оно должно сделать.

(function () {
    'use strict';

    var IDLE_MS = 2 * 60 * 1000;
    // Плеер на паузе: сначала гаснет картинка, потом выходит заставка. Отсчёт —
    // от начала паузы или последнего нажатия, что позже
    var PLAYER_DIM_MS = 10 * 1000;
    var PLAYER_IDLE_MS = 60 * 1000;
    var SLIDE_MS = 30 * 1000;
    // Простой проверяем опросом, а не перезапуском таймера на каждое нажатие:
    // на автоповторе пульта это десятки clearTimeout/setTimeout в секунду.
    // Раз в секунду — ради пелены в плеере: 10 с при опросе раз в 5 с
    // превращались бы в 10–15. Вне плеера тик — одно сравнение времени
    var CHECK_MS = 1000;
    var FADE_MS = 1500;
    // Пелена уходит быстро: под ней сразу должен появиться HUD
    var DIM_OUT_MS = 300;
    // Список держим в IndexedDB три дня, чтобы не ходить за ним в сеть при
    // каждом засыпании и каждом запуске. Bing меняет картинку раз в сутки,
    // так что к концу срока в списке не хватает пары последних дней — для
    // заставки это неважно
    var LIST_TTL_MS = 3 * 24 * 60 * 60 * 1000;
    var DB_NAME = 'ScreensaverDB', DB_STORE = 'cache', DB_KEY = 'bing';
    // Зеркало не ответило — не спрашиваем на каждом тике
    var LIST_RETRY_MS = 10 * 60 * 1000;
    // Адрес зеркала тот же, что у всех скриптов в index.html, и с ?local=1
    // тоже: списка в public/ нет, его собирает только сборка сайта
    var LIST_URL = 'https://cash94.github.io/msx/cache/bing.json';
    // Мышь «дрожит» на столе — заставку будит только заметное движение
    var MOUSE_WAKE_PX = 12;

    var lastActivity = Date.now();
    var active = false;
    var root = null, layers = [], front = 0;
    var captionEl = null, clockEl = null;
    var images = [], listAt = 0, listFailedAt = 0, listLoading = false, dbChecked = false;
    var index = -1, slideTimer = null, slideGen = 0;
    var swallowKeyUp = null;
    var mouseX = -1, mouseY = -1;
    var swallowClickUntil = 0;
    var heroSuspended = false;
    var pausedSince = 0;           // с какого момента плеер стоит на паузе; 0 — не стоит
    var dimEl = null, dimmed = false;

    // ==================== ЧТО МОЖЕТ ПОМЕШАТЬ ====================

    function anyVideoPlaying() {
        var vids = document.getElementsByTagName('video');
        for (var i = 0; i < vids.length; i++) {
            var v = vids[i];
            if (!v.paused && !v.ended) return true;
        }
        return false;
    }

    /**
     * Плеер стоит на паузе, и это пауза человека: не загрузка потока, не
     * перемотка и не переход на серию (там <video> тоже paused, но смотреть
     * на экран сейчас будут).
     */
    function playerPaused() {
        var st = window.AppState;
        if (!st || st.currentScreen !== 'player' || st.isYoutubePlayback || st.isSeeking) return false;
        var v = document.getElementById('video-player');
        if (!v || !v.paused || v.readyState < 2) return false;
        var po = document.getElementById('player-overlay');
        if (po && po.classList.contains('loading')) return false;
        var pb = document.getElementById('playback-overlay');
        if (pb && pb.classList.contains('active')) return false;
        return true;
    }

    function canStart() {
        if (document.hidden) return false;
        var st = window.AppState;
        if (!st) return false;
        if (st.currentScreen === 'player') return playerPaused();
        if (st.isYoutubePlayback) return false;
        if (st.trailerPlay) return false;          // трейлер в карточке, даже пока грузится
        if (anyVideoPlaying()) return false;
        // Под заглушкой загрузки интерфейс ещё не готов
        var loader = document.getElementById('module-loader');
        if (loader && loader.style.display !== 'none') return false;
        return true;
    }

    // ==================== СПИСОК КАРТИНОК ====================

    /**
     * База открывается на каждую операцию и сразу закрывается: операций две за
     * сеанс-другой, а открытое соединение держало бы базу, мешая её обновлению
     * из соседней вкладки. Нет IndexedDB (приватный режим, урезанный браузер
     * телевизора) — cb(null), и список просто берётся из сети.
     */
    function withStore(mode, fn) {
        var called = false;
        var once = function (store) { if (!called) { called = true; fn(store); } };
        try {
            var req = window.indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = function () { req.result.createObjectStore(DB_STORE); };
            req.onerror = function () { once(null); };
            req.onblocked = function () { once(null); };
            req.onsuccess = function () {
                var db = req.result;
                try {
                    var tx = db.transaction(DB_STORE, mode);
                    tx.oncomplete = tx.onerror = tx.onabort = function () { db.close(); };
                    once(tx.objectStore(DB_STORE));
                } catch (e) {
                    db.close();
                    once(null);
                }
            };
        } catch (e) {
            once(null);
        }
    }

    function readCachedList(cb) {
        withStore('readonly', function (store) {
            if (!store) { cb(null); return; }
            var called = false;
            var once = function (v) { if (!called) { called = true; cb(v); } };
            try {
                var r = store.get(DB_KEY);
                r.onsuccess = function () { once(r.result || null); };
                r.onerror = function () { once(null); };
            } catch (e) {
                once(null);
            }
        });
    }

    function saveCachedList(list, at) {
        withStore('readwrite', function (store) {
            if (!store) return;
            try { store.put({ at: at, images: list }, DB_KEY); } catch (e) { }
        });
    }

    function fetchList(done) {
        var finish = function (list) {
            listLoading = false;
            if (list && list.length) {
                images = list;
                listAt = Date.now();
                listFailedAt = 0;
                saveCachedList(list, listAt);
            } else {
                // Просроченный список из базы, если он был, остаётся в images:
                // старые картинки лучше, чем никакой заставки
                listFailedAt = Date.now();
            }
            done();
        };
        try {
            // Без cookie: чужой источник, им там делать нечего
            fetch(LIST_URL, { credentials: 'omit' })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (d) { finish(d && d.images); })
                ['catch'](function () { finish(null); });
        } catch (e) {
            finish(null);
        }
    }

    /** Сначала база (один раз за сеанс), в сеть — только если там пусто или срок вышел */
    function loadList(done) {
        if (listLoading) return;
        listLoading = true;
        if (dbChecked) { fetchList(done); return; }
        readCachedList(function (rec) {
            dbChecked = true;
            if (rec && rec.images && rec.images.length) {
                images = rec.images;
                listAt = rec.at || 0;
                if (listFresh()) {
                    listLoading = false;
                    done();
                    return;
                }
            }
            fetchList(done);
        });
    }

    function listFresh() {
        return images.length && Date.now() - listAt < LIST_TTL_MS;
    }

    // ==================== РАЗМЕТКА ====================

    /**
     * Куда вешать заставку и пелену. Обычно в <body>, но если на весь экран
     * развернулся не документ, а #player-screen или <video>, браузер рисует
     * только его потомков (player.js: getOverlayHost). Смотрим при каждом
     * показе: элементы создаются лениво, переноса по fullscreenchange они не
     * застают.
     */
    function attachToHost(el) {
        var host = typeof window.getOverlayHost === 'function' ? window.getOverlayHost() : document.body;
        if (el.parentNode !== host) host.appendChild(el);
    }

    function build() {
        if (root) return;
        root = document.createElement('div');
        root.id = 'screensaver';
        for (var i = 0; i < 2; i++) {
            var layer = document.createElement('div');
            layer.className = 'screensaver-layer';
            root.appendChild(layer);
            layers.push(layer);
        }
        var info = document.createElement('div');
        info.className = 'screensaver-info';
        captionEl = document.createElement('div');
        captionEl.className = 'screensaver-caption';
        clockEl = document.createElement('div');
        clockEl.className = 'screensaver-clock';
        info.appendChild(captionEl);
        info.appendChild(clockEl);
        root.appendChild(info);
        document.body.appendChild(root);
    }

    function updateClock() {
        if (!clockEl) return;
        var d = new Date();
        var m = d.getMinutes();
        clockEl.textContent = d.getHours() + ':' + (m < 10 ? '0' : '') + m;
    }

    // ==================== ПОКАЗ ====================

    /**
     * Следующая картинка. В слой она попадает только скачанной: иначе вместо
     * плавной смены на полэкрана проявлялась бы недогруженная полоса. Картинка
     * не открылась — пробуем следующую, но не больше одного круга.
     */
    function showNext(tries) {
        if (!active || !images.length) return;
        if (tries === undefined) tries = images.length;
        if (tries <= 0) { scheduleSlide(); return; }
        index = (index + 1) % images.length;
        var item = images[index];
        var gen = ++slideGen;
        var img = new Image();
        img.onload = function () {
            img.onload = img.onerror = null;
            if (!active || gen !== slideGen) return;
            var next = 1 - front;
            layers[next].style.backgroundImage = 'url("' + item.url + '")';
            layers[next].style.opacity = '1';
            layers[front].style.opacity = '0';
            front = next;
            var text = item.title || '';
            if (item.copyright) text += (text ? ' ' : '') + item.copyright;
            captionEl.textContent = text;
            updateClock();
            scheduleSlide();
        };
        img.onerror = function () {
            img.onload = img.onerror = null;
            if (!active || gen !== slideGen) return;
            showNext(tries - 1);
        };
        img.src = item.url;
    }

    function scheduleSlide() {
        if (slideTimer) clearTimeout(slideTimer);
        slideTimer = setTimeout(function () {
            slideTimer = null;
            showNext();
        }, SLIDE_MS);
    }

    // Системная клавиатура ТВ (Tizen) рисуется поверх страницы, и заставка
    // оказывалась под ней. Снимаем нативный фокус с поля — клавиатура уходит;
    // фокус пульта (.focused) остаётся на поле, ОК после пробуждения откроет
    // её снова. Встроенную (osk.js) закрываем без отправки, введённое остаётся.
    function hideKeyboards() {
        try {
            var a = document.activeElement;
            if (typeof window.isTextEntryElement === 'function' && window.isTextEntryElement(a)) a.blur();
        } catch (e) { }
        try {
            if (window.OSK && OSK.isOpen()) OSK.close(false);
        } catch (e) { }
    }

    function start() {
        if (active) return;
        active = true;
        if (window.AppState) AppState.screensaverActive = true;
        hideKeyboards();
        build();

        // Отсчёт трейлера баннера главной ещё не кончился — гасим его, иначе
        // трейлер заиграл бы со звуком под заставкой. Играющий трейлер до сюда
        // не доходит: при нём заставка не включается (canStart).
        var home = window.HomeScreen;
        heroSuspended = false;
        if (home && home.state && home.state.hero && home.state.hero.timer &&
            typeof home.stopTrailer === 'function') {
            home.stopTrailer();
            heroSuspended = true;
        }

        // Первая картинка — с того же места, на котором остановились в прошлый
        // раз: при каждом засыпании начинать с сегодняшней значило бы видеть
        // одну и ту же
        attachToHost(root);
        root.style.display = 'block';
        // Кадр на display, затем — проявление: иначе переход не состоится
        requestAnimationFrame(function () {
            if (active) root.classList.add('screensaver-visible');
        });
        showNext();
    }

    function stop() {
        if (!active) return;
        active = false;
        slideGen++;
        if (window.AppState) AppState.screensaverActive = false;
        if (slideTimer) { clearTimeout(slideTimer); slideTimer = null; }
        if (root) {
            root.classList.remove('screensaver-visible');
            var r = root;
            setTimeout(function () {
                if (!active) r.style.display = 'none';
            }, FADE_MS);
        }
        if (heroSuspended) {
            heroSuspended = false;
            var home = window.HomeScreen;
            if (home && typeof home.rearmTrailer === 'function') home.rearmTrailer();
        }
    }

    // ==================== ПЕЛЕНА В ПЛЕЕРЕ ====================

    function dim() {
        if (dimmed) return;
        dimmed = true;
        if (!dimEl) {
            dimEl = document.createElement('div');
            dimEl.id = 'player-dim';
        }
        attachToHost(dimEl);
        dimEl.style.display = 'block';
        requestAnimationFrame(function () {
            if (dimmed) dimEl.classList.add('player-dim-visible');
        });
    }

    function undim() {
        if (!dimmed) return;
        dimmed = false;
        dimEl.classList.remove('player-dim-visible');
        setTimeout(function () {
            if (!dimmed) dimEl.style.display = 'none';
        }, DIM_OUT_MS);
    }

    /** HUD плеера с фокусом на воспроизведении — ОК следом снимет паузу */
    function showPlayerHud() {
        if (typeof window.showPlayerControls === 'function') window.showPlayerControls();
        else if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();
    }

    // ==================== ПРОСТОЙ ====================

    function idleReached() {
        if (pausedSince) return Date.now() - Math.max(lastActivity, pausedSince) >= PLAYER_IDLE_MS;
        return Date.now() - lastActivity >= IDLE_MS;
    }

    function tick() {
        // Пауза в плеере: отмечаем начало, пелену — через PLAYER_DIM_MS.
        // Заиграло (в том числе мимо пульта — с телефона) или ушли с плеера —
        // пелену снимаем; HUD при этом не показываем, нажатия не было
        if (playerPaused()) {
            if (!pausedSince) pausedSince = Date.now();
            if (!dimmed && Date.now() - Math.max(lastActivity, pausedSince) >= PLAYER_DIM_MS) dim();
        } else {
            pausedSince = 0;
            undim();
        }
        if (active) {
            // Что-то заиграло мимо пульта (трейлер, плеер с телефона) — уходим
            if (!canStart()) stop();
            else updateClock();
            return;
        }
        if (!idleReached()) return;
        if (!canStart()) return;
        if (listFresh()) { start(); return; }
        if (listFailedAt && Date.now() - listFailedAt < LIST_RETRY_MS) {
            // Старый список лучше, чем ничего
            if (images.length) start();
            return;
        }
        loadList(function () {
            if (!active && images.length && canStart() && idleReached()) start();
        });
    }

    // ==================== ВВОД ====================

    function wake(e) {
        lastActivity = Date.now();
        if (!active && !dimmed) return false;
        var inPlayer = !!(window.AppState && AppState.currentScreen === 'player');
        stop();
        undim();
        if (inPlayer) showPlayerHud();
        if (e) {
            if (e.cancelable) e.preventDefault();
            e.stopImmediatePropagation();
        }
        return true;
    }

    window.addEventListener('keydown', function (e) {
        var kc = e.keyCode || e.which;
        // Нажатие, которое разбудило, больше ничего не делает — и его keyup
        // тоже: на нём держатся удержание OK и отпускание стрелок в control.js
        if (wake(e)) swallowKeyUp = kc;
    }, true);

    window.addEventListener('keyup', function (e) {
        var kc = e.keyCode || e.which;
        if (swallowKeyUp !== null && kc === swallowKeyUp) {
            swallowKeyUp = null;
            e.stopImmediatePropagation();
        }
    }, true);

    // Клик, следующий за разбудившим mousedown/тапом, тоже не должен ничего
    // нажать: в плеере он поставил бы видео на воспроизведение
    var pointerWake = function (e) {
        if (wake(e)) swallowClickUntil = Date.now() + 1000;
    };
    window.addEventListener('mousedown', pointerWake, true);
    window.addEventListener('touchstart', pointerWake, true);
    window.addEventListener('wheel', function (e) { wake(e); }, true);
    window.addEventListener('click', function (e) {
        if (Date.now() < swallowClickUntil) {
            swallowClickUntil = 0;
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }, true);
    window.addEventListener('mousemove', function (e) {
        if (mouseX >= 0 && Math.abs(e.clientX - mouseX) + Math.abs(e.clientY - mouseY) < MOUSE_WAKE_PX) return;
        mouseX = e.clientX;
        mouseY = e.clientY;
        wake(null);
    }, true);

    // Вернулись из нативного плеера или из свёрнутого состояния — простой
    // считаем заново: время, пока страницы не было видно, бездействием не было
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) lastActivity = Date.now();
    });

    setInterval(tick, CHECK_MS);

    window.Screensaver = {
        isActive: function () { return active; },
        isDimmed: function () { return dimmed; },
        // Для отладки и проверки: показать немедленно / убрать
        show: function () { lastActivity = 0; if (pausedSince) pausedSince = 1; tick(); },
        hide: function () { wake(null); }
    };
})();
