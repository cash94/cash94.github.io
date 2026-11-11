// best-torrents.js — кнопка «Лучшие» в карточке-«сцене» и её выпадающий список.
//
// Включается в настройках: раздел «Трекеры», «Показать лучшие торренты».
//
// Как идёт работа:
//  - пока кнопку не нажали, ничего не происходит: к Jacred карточка не ходит.
//    Смотреть раздачи приходят не на каждую карточку, а запросы он считает;
//  - нажали → смотрим IndexedDB, нет записи — спрашиваем Jacred;
//  - запрос, разбор и подбор идут в TorrentsWorker, сюда приезжает несколько
//    коротких строк (best-torrents-pick.js). Воркер не поднялся — то же самое в
//    основном потоке;
//  - готовый список лежит в IndexedDB 3 дня;
//  - только что собранный список при первом показе проявляется по строке. Ответ
//    у Jacred один на всё, так что это не ход поиска, а показ его итога: когда
//    запрос ещё идёт, ниже крутится индикатор. Из кэша список виден сразу.
//
// Выбор строки запускает раздачу прямо из карточки, как «Продолжить»: сразу окно
// предзагрузки, поиск не открывается, из плеера — обратно в карточку
// (playBestPick в player.js).
(function () {
    'use strict';

    var STORAGE_KEY = 'bestTorrentsEnabled';
    var DB_NAME = 'BestTorrentsDB';
    var STORE_NAME = 'lists';
    var TTL_MS = 3 * 24 * 60 * 60 * 1000;
    /* Пустой ответ держим меньше: фильм мог только выйти, и ждать трое суток,
       пока раздачи появятся в списке, незачем */
    var EMPTY_TTL_MS = 6 * 60 * 60 * 1000;
    /** Поменялась формула или состав записи — поднять, старые записи отбросятся */
    var SCHEMA = 7;
    var REVEAL_STEP_MS = 170;
    var DEFAULT_TIMEOUT_MS = 15000;

    var state = {
        item: null, key: null, query: '', details: null,
        ready: false,        // детали получены, запрос можно собрать
        status: 'idle',      // idle | loading | ready | error | nohost (Jacred не указан)
        data: null,
        fresh: false,        // собран только что и ещё не показывался
        gen: 0,
        open: false,
        index: 0,
        groupIndex: 0,
        revealed: 0,
        revealTimer: null
    };

    function isEnabled() {
        return !!AppState.bestTorrentsEnabled;
    }

    function button() { return getEl('catalog-best-btn'); }
    function menu() { return getEl('catalog-best-menu'); }

    /* ==================== ХРАНИЛИЩЕ ==================== */
    var dbPromise = null;
    var swept = false;

    function openDB() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise(function (resolve, reject) {
            if (!window.indexedDB) { reject(new Error('IndexedDB недоступна')); return; }
            var req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'key' });
            };
            req.onsuccess = function (e) { resolve(e.target.result); };
            req.onerror = function () { dbPromise = null; reject(req.error); };
        });
        return dbPromise;
    }

    function isFresh(rec) {
        return !!(rec && rec.schema === SCHEMA && rec.expires > Date.now());
    }

    function readCache(key) {
        return openDB().then(function (db) {
            return new Promise(function (resolve) {
                var req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
                req.onsuccess = function () { resolve(isFresh(req.result) ? req.result.data : null); };
                req.onerror = function () { resolve(null); };
            });
        })['catch'](function () { return null; });
    }

    function writeCache(key, data) {
        var ttl = hasRows(data) ? TTL_MS : EMPTY_TTL_MS;
        openDB().then(function (db) {
            db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME)
                .put({ key: key, schema: SCHEMA, expires: Date.now() + ttl, data: data });
        })['catch'](function (e) { console.warn('⚠️ BestTorrentsDB: запись не сохранена:', e); });
    }

    /** Просроченное убираем раз за запуск: само оно из базы никуда не денется */
    function sweepCache() {
        if (swept) return;
        swept = true;
        openDB().then(function (db) {
            var tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).openCursor().onsuccess = function (e) {
                var cursor = e.target.result;
                if (!cursor) return;
                if (!isFresh(cursor.value)) cursor['delete']();
                cursor['continue']();
            };
        })['catch'](function () { });
    }

    /* ==================== ДАННЫЕ ==================== */
    function hasRows(data) {
        return visibleGroups(data).length > 0;
    }

    function visibleGroups(data) {
        var out = [], groups = (data && data.groups) || [];
        for (var i = 0; i < groups.length; i++) if (groups[i].rows && groups[i].rows.length) out.push(groups[i]);
        return out;
    }

    function isSerialItem(item) {
        return (item.media_type || AppState.mediaType) === 'tv';
    }

    function buildContext(item, details) {
        var d = details || {};
        var serial = isSerialItem(item);
        var seasons = [], list = d.seasons || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].season_number > 0) seasons.push({ n: list[i].season_number, episodes: list[i].episode_count || 0 });
        }
        var last = d.last_episode_to_air;
        return {
            serial: serial,
            minutes: d.runtime || 0,
            episodeMinutes: (last && last.runtime) || (d.episode_run_time && d.episode_run_time[0]) || 0,
            russianOriginal: d.original_language === 'ru',
            seasons: seasons
        };
    }

    /** Адрес берём у своего же тега: в нём уже учтены ?local=1, js-legacy и версия */
    function pickScriptUrl() {
        var s = document.querySelector('script[src*="best-torrents-pick.js"]');
        return s ? s.src : '';
    }

    function fetchOnMainThread(url, ctx, signal) {
        return (window.bgFetch ? window.bgFetch(url, { signal: signal }) : fetch(url, { signal: signal }))
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (body) {
                var raw = body && Array.isArray(body.Results) ? body.Results : (Array.isArray(body) ? body : []);
                return window.BestTorrentsPick.pick(raw.map(window.normalizeSearchResult), ctx);
            });
    }

    function fetchPicks(url, ctx, timeoutMs, signal) {
        if (typeof TorrentsWorker === 'undefined' || typeof TorrentsWorker.jacredBest !== 'function') {
            return fetchOnMainThread(url, ctx, signal);
        }
        return TorrentsWorker.jacredBest(url, ctx, pickScriptUrl(), timeoutMs + 5000, signal)['catch'](function (e) {
            // Отказал сам Jacred — второй запрос ничего не изменит и только
            // добавится к лимиту частоты. На основной поток уходим, лишь когда
            // подвёл воркер
            if (e && (e.name === 'AbortError' || e.workerKind === 'http' || e.workerKind === 'net')) throw e;
            console.warn('⚠️ Worker jacredBest failed, fallback:', e && e.message);
            return fetchOnMainThread(url, ctx, signal);
        });
    }

    /** Список по нажатию: сначала кэш, и только его нет — запрос */
    function load() {
        if (state.status === 'loading' || !state.ready || !state.item) return;
        var gen = state.gen, key = state.key;
        setStatus('loading');
        readCache(key).then(function (data) {
            if (gen !== state.gen) return;
            if (data) applyData(data, false);
            else requestJacred(gen, key);
        });
    }

    function requestJacred(gen, key) {
        // Адреса Jacred нет (приложение Tizen, поле пустое): спрашивать некого,
        // список предлагает открыть настройки (openJacredSettings)
        if (typeof window.getJacredHost === 'function' && !window.getJacredHost()) {
            setStatus('nohost');
            return;
        }
        var item = state.item, query = state.query, details = state.details;
        var timeoutMs = window.JACRED_TIMEOUT_MS || DEFAULT_TIMEOUT_MS;
        var controller = null;
        try { controller = new AbortController(); } catch (e) { controller = null; }
        var timeoutId = setTimeout(function () { if (controller) controller.abort(); }, timeoutMs);
        var target = window.buildJacredSearchUrl(query, window.buildJacredSearchHints(item, details));
        var ctx = buildContext(item, details);

        window.signJacredSearchUrl(target.url, target.host, query).then(function (url) {
            return fetchPicks(url, ctx, timeoutMs, controller ? controller.signal : undefined);
        }).then(function (data) {
            clearTimeout(timeoutId);
            // В кэш — даже если человек уже на другой карточке: ответ получен,
            // и вернувшись сюда, спрашивать Jacred снова незачем
            writeCache(key, data);
            if (gen === state.gen) applyData(data, true);
        }, function (e) {
            clearTimeout(timeoutId);
            console.warn('⚠️ Лучшие раздачи не получены:', e && e.message);
            if (gen === state.gen) setStatus('error');
        });
    }

    function applyData(data, fresh) {
        state.data = data;
        state.fresh = fresh && hasRows(data);
        state.groupIndex = defaultGroupIndex(data);
        state.index = 0;
        setStatus('ready');
    }

    /** Сезон, на котором человек остановился, иначе самый свежий */
    function defaultGroupIndex(data) {
        var groups = visibleGroups(data);
        var resume = window.HomeScreen && typeof HomeScreen.resumeFor === 'function' ? HomeScreen.resumeFor(state.item) : null;
        if (resume && resume.season !== undefined) {
            for (var i = 0; i < groups.length; i++) if (groups[i].season === Number(resume.season)) return i;
        }
        return Math.max(0, groups.length - 1);
    }

    function setStatus(status) {
        state.status = status;
        var btn = button();
        if (btn) btn.classList.toggle('is-loading', status === 'loading');
        if (state.open) renderMenu();
    }

    /* ==================== ПОДПИСИ ==================== */
    function plural(n, one, few, many) {
        var a = Math.abs(n) % 100, b = a % 10;
        if (a > 10 && a < 20) return many;
        if (b > 1 && b < 5) return few;
        return b === 1 ? one : many;
    }

    function formatSize(bytes) {
        var gb = bytes / 1073741824;
        if (gb >= 1) return gb.toFixed(1).replace('.', ',') + ' ГБ';
        return Math.round(bytes / 1048576) + ' МБ';
    }

    function seasonEpisodes(n) {
        var list = (state.details && state.details.seasons) || [];
        for (var i = 0; i < list.length; i++) if (list[i].season_number === n) return list[i].episode_count || 0;
        return 0;
    }

    /** Идущий сезон: сколько вышло на самом деле. У завершённого — null */
    function airedNote(n) {
        var d = state.details || {};
        var next = d.next_episode_to_air, last = d.last_episode_to_air;
        if (!next || next.season_number !== n) return '';
        var aired = last && last.season_number === n ? last.episode_number : Math.max(0, next.episode_number - 1);
        var total = seasonEpisodes(n);
        if (total > aired) return 'Вышло ' + aired + ' из ' + total + ' ' + plural(total, 'серии', 'серий', 'серий');
        return 'Вышло ' + aired + ' ' + plural(aired, 'серия', 'серии', 'серий');
    }

    /** У каждой строки своё число: в 1080 бывает на серию больше, чем в 4K */
    function episodesLabel(row, season) {
        if (row.seasons && row.seasons.length > 1) {
            var first = row.seasons[0], lastSeason = row.seasons[row.seasons.length - 1];
            return 'Сезоны ' + first + '–' + lastSeason +
                (row.have ? ' · ' + row.have + ' ' + plural(row.have, 'серия', 'серии', 'серий') : '');
        }
        if (!row.have) return '';
        var total = Math.max(row.total || 0, seasonEpisodes(season));
        if (total > row.have) return row.have + ' из ' + total + ' ' + plural(total, 'серии', 'серий', 'серий');
        return row.have + ' ' + plural(row.have, 'серия', 'серии', 'серий');
    }

    var MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

    /** Дата видна в строке: по ней сразу понятно, живая ли раздача */
    function formatDate(time) {
        var d = new Date(time);
        return MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    }

    function rowMeta(row) {
        var parts = [formatSize(row.size), row.sid + ' ' + plural(row.sid, 'сид', 'сида', 'сидов')];
        if (row.voices > 0) parts.push(row.voices + ' ' + plural(row.voices, 'озвучка', 'озвучки', 'озвучек'));
        if (row.date) parts.push(formatDate(row.date));
        return parts.join(' · ');
    }

    /* ==================== СПИСОК ==================== */
    function span(cls, text) {
        var el = document.createElement('span');
        el.className = cls;
        el.textContent = text;
        return el;
    }

    function currentGroup() {
        return visibleGroups(state.data)[state.groupIndex] || null;
    }

    function currentRows() {
        var g = currentGroup();
        return g ? g.rows : [];
    }

    function buildRow(row, index, group, animate) {
        var el = document.createElement('div');
        el.className = 'catalog-best-row' + (index === state.index ? ' active' : '') + (animate ? ' is-new' : '');
        el.setAttribute('data-index', index);
        el.appendChild(span('catalog-best-label', row.label));
        el.appendChild(span('catalog-best-meta', rowMeta(row)));
        var eps = group && group.season !== null ? episodesLabel(row, group.season) : '';
        if (eps) el.appendChild(span('catalog-best-episodes', eps));
        return el;
    }

    function statusText() {
        if (state.status === 'error') return 'Jacred не ответил. ОК — повторить';
        if (state.status === 'nohost') return 'Не указан адрес Jacred. ОК — открыть настройки';
        if (state.status === 'ready' && !hasRows(state.data)) return 'Подходящих раздач нет';
        return '';
    }

    function renderHead(m, groups, group) {
        var head = document.createElement('div');
        head.className = 'catalog-best-head';
        if (group && group.season !== null) {
            var left = span('catalog-best-arrow' + (state.groupIndex > 0 ? '' : ' is-off'), '‹');
            left.setAttribute('data-season-step', '-1');
            var right = span('catalog-best-arrow' + (state.groupIndex < groups.length - 1 ? '' : ' is-off'), '›');
            right.setAttribute('data-season-step', '1');
            head.appendChild(left);
            head.appendChild(span('catalog-best-title', 'Сезон ' + group.season));
            head.appendChild(right);
        } else {
            head.appendChild(span('catalog-best-title', 'Лучшие раздачи'));
        }
        m.appendChild(head);
        var note = group && group.season !== null ? airedNote(group.season) : '';
        if (note) m.appendChild(span('catalog-best-note', note));
    }

    function renderMenu() {
        var m = menu();
        if (!m) return;
        clearReveal();
        m.textContent = '';

        var groups = visibleGroups(state.data), group = currentGroup();
        renderHead(m, groups, group);

        var rows = document.createElement('div');
        rows.className = 'catalog-best-rows';
        m.appendChild(rows);

        var list = currentRows();
        if (state.fresh) {
            // Показ только один раз: закрыли на середине — дальше виден весь список
            state.fresh = false;
            state.revealed = 0;
            showSearching(m);
            revealNext();
            return;
        }
        state.revealed = list.length;
        for (var i = 0; i < list.length; i++) rows.appendChild(buildRow(list[i], i, group, false));

        if (state.status === 'loading') showSearching(m);
        else {
            var text = statusText();
            if (text) m.appendChild(span('catalog-best-status', text));
        }
    }

    function showSearching(m) {
        var el = document.createElement('div');
        el.className = 'catalog-best-status catalog-best-searching';
        el.appendChild(span('catalog-best-spinner', ''));
        el.appendChild(span('', 'Ищем лучшие раздачи'));
        m.appendChild(el);
    }

    function revealNext() {
        state.revealTimer = null;
        var m = menu(), list = currentRows();
        if (!m || !state.open) return;
        if (state.revealed >= list.length) {
            var s = m.querySelector('.catalog-best-searching');
            if (s) s.parentNode.removeChild(s);
            return;
        }
        var rows = m.querySelector('.catalog-best-rows');
        rows.appendChild(buildRow(list[state.revealed], state.revealed, currentGroup(), true));
        state.revealed++;
        state.revealTimer = setTimeout(revealNext, REVEAL_STEP_MS);
    }

    function clearReveal() {
        if (state.revealTimer) { clearTimeout(state.revealTimer); state.revealTimer = null; }
    }

    function highlight() {
        var m = menu();
        if (!m) return;
        var rows = m.querySelectorAll('.catalog-best-row');
        for (var i = 0; i < rows.length; i++) rows[i].classList.toggle('active', i === state.index);
    }

    function onOutsideClick(e) {
        var m = menu(), btn = button();
        if (m && m.contains(e.target)) return;
        if (btn && btn.contains(e.target)) return;
        close();
    }

    function open() {
        var m = menu(), btn = button();
        if (!m || !btn || state.open) return;
        state.open = true;
        state.index = 0;
        m.classList.remove('hidden');
        // Список стоит над своей кнопкой (кнопок в ряду разное число), но за край
        // ряда не вылезает: на телефоне он шире половины экрана
        var room = m.parentNode.clientWidth - m.offsetWidth;
        m.style.left = Math.max(0, Math.min(btn.offsetLeft, room)) + 'px';
        document.addEventListener('click', onOutsideClick, true);
        renderMenu();
        if (state.status === 'idle' || state.status === 'error' || state.status === 'nohost') load();
    }

    function close() {
        if (!state.open) return false;
        state.open = false;
        clearReveal();
        var m = menu();
        if (m) m.classList.add('hidden');
        document.removeEventListener('click', onOutsideClick, true);
        return true;
    }

    /** Пустой адрес Jacred: список закрываем и ведём в настройки на это поле */
    function openJacredSettings() {
        close();
        if (typeof window.requireJacredHost === 'function') window.requireJacredHost();
    }

    function stepSeason(step) {
        var groups = visibleGroups(state.data);
        var next = state.groupIndex + step;
        if (next < 0 || next >= groups.length) return;
        state.groupIndex = next;
        state.index = 0;
        renderMenu();
    }

    function showLaunchError(title, text) {
        if (typeof window.showErrorBanner === 'function') window.showErrorBanner(title, text);
    }

    function choose(row) {
        var group = currentGroup(), season = group ? group.season : null;
        close();
        window.playBestPick(state.item, row, season, button()).then(function (result) {
            if (result === 'dead') showLaunchError('Раздача не отвечает', 'За минуту не удалось получить её файлы. Выберите другую раздачу');
        }, function (e) {
            showLaunchError('Не удалось начать воспроизведение', e && e.message);
        });
    }

    function onMenuClick(e) {
        var t = e.target;
        var step = t.getAttribute && t.getAttribute('data-season-step');
        if (step) { stepSeason(parseInt(step, 10)); return; }
        var rowEl = t.closest ? t.closest('.catalog-best-row') : null;
        if (rowEl) {
            var row = currentRows()[parseInt(rowEl.getAttribute('data-index'), 10)];
            if (row) choose(row);
            return;
        }
        if (state.status === 'error') load();
        else if (state.status === 'nohost') openJacredSettings();
    }

    function onMenuHover(e) {
        var rowEl = e.target.closest ? e.target.closest('.catalog-best-row') : null;
        if (!rowEl) return;
        var i = parseInt(rowEl.getAttribute('data-index'), 10);
        if (i !== state.index) { state.index = i; highlight(); }
    }

    /* ==================== ПУЛЬТ ==================== */
    /* Фокус остаётся на кнопке, а строка выделяется своим классом — как в меню
       фильтров (control.js): строки живут и исчезают вместе со списком, и в
       общем учёте фокусируемого им делать нечего. */
    function handleArrow(dir) {
        if (dir === 'left' || dir === 'right') { stepSeason(dir === 'left' ? -1 : 1); return; }
        var next = state.index + (dir === 'up' ? -1 : 1);
        if (next < 0 || next >= state.revealed) return;
        state.index = next;
        highlight();
    }

    function handleOk() {
        if (state.status === 'error') { load(); return; }
        if (state.status === 'nohost') { openJacredSettings(); return; }
        var row = state.index < state.revealed ? currentRows()[state.index] : null;
        if (row) choose(row);
    }

    /* ==================== ЖИЗНЬ КАРТОЧКИ ==================== */
    function cardKey(item) {
        return (isSerialItem(item) ? 'tv' : 'movie') + ':' + item.id;
    }

    /** Карточка начала открываться: кнопка должна стоять в ряду с самого начала */
    function beginCard(item) {
        close();
        state.gen++;
        state.item = item;
        state.key = item && item.id ? cardKey(item) : null;
        state.query = '';
        state.details = null;
        state.ready = false;
        state.data = null;
        state.fresh = false;
        state.groupIndex = 0;
        setStatus('idle');
        var btn = button();
        if (btn) btn.classList.toggle('hidden', !isEnabled() || !state.key);
    }

    /** Детали и название известны: теперь запрос можно собрать */
    function cardReady(item, query, details) {
        if (!isEnabled() || !state.key || state.item !== item) return;
        state.query = query;
        state.details = details || null;
        state.ready = true;
        sweepCache();
        // Кнопку могли нажать, пока карточка ещё собиралась
        if (state.open) load();
    }

    function leave() {
        close();
    }

    function setEnabled(on) {
        AppState.bestTorrentsEnabled = !!on;
        try { localStorage.setItem(STORAGE_KEY, on ? 'true' : 'false'); } catch (e) { }
        var btn = button();
        if (btn) btn.classList.toggle('hidden', !on || !state.key);
        if (window.invalidateFocusCache) window.invalidateFocusCache();
    }

    function init() {
        var saved = false;
        try { saved = localStorage.getItem(STORAGE_KEY) === 'true'; } catch (e) { }
        AppState.bestTorrentsEnabled = saved;

        var box = getEl('best-torrents-enabled');
        if (box) {
            box.checked = saved;
            box.addEventListener('change', function (e) { setEnabled(e.target.checked); });
        }
        var btn = button();
        if (btn) btn.onclick = function () { if (state.open) close(); else open(); };
        var m = menu();
        if (m) {
            m.addEventListener('click', onMenuClick);
            m.addEventListener('mouseover', onMenuHover);
        }
    }

    window.BestTorrents = {
        isOpen: function () { return state.open; },
        close: close,
        handleArrow: handleArrow,
        handleOk: handleOk,
        beginCard: beginCard,
        cardReady: cardReady,
        leave: leave
    };

    init();
})();
