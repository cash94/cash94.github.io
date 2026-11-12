// episode-picker.js — окно серий раздачи из выдачи поиска.
//
// Долгое OK на раздаче в выдаче Jacred (control.js, ПКМ / долгое касание —
// contextmenu в torrents.js) открывает это окно поверх выдачи:
//  - раздачу поднимаем в TorrServer только «на посмотреть» — /stream?…&stat:
//    без сохранения в базу, ради списка файлов. Закрыли окно, ничего не выбрав, —
//    раздачу останавливаем (если до окна её на сервере не было);
//  - сверху название фильма или сериала, под ним описание серии (или фильма),
//    длительность и размер файла под фокусом;
//  - ниже горизонтальная лента файлов с кадрами серий из TMDB, если сериал
//    удалось опознать. Листается той же прокруткой, что и остальные ленты
//    (focusEl → scrollToElementIfNeeded, control.js), с тем же темпом шагов
//    (acceptNavStep);
//  - «Назад» закрывает окно, фокус возвращается на раздачу в выдаче;
//  - выбор серии добавляет раздачу в TorrServer и сразу её запускает
//    (playSearchResultFile, torrents.js). Из плеера — в карточку фильма, если
//    поиск открыли из неё, иначе в карточку раздачи, как в «Моих торрентах».
//
// TMDB: из карточки — её фильм; из свободного поиска — /api/tmdb/search по
// названию раздачи. Не нашли — окно работает и без него: имена файлов и размеры.
(function () {
    'use strict';

    // Сколько ждать метаданные раздачи (список файлов) от TorrServer
    var STAT_TIMEOUT_MS = 45000;
    var STAT_RETRY_MS = 1500;

    var root = null, els = {};
    var state = freshState();

    function freshState() {
        return {
            open: false,
            gen: (state && state.gen) || 0,
            result: null, hash: '', magnet: '',
            from: null,             // раздача в выдаче, к ней вернуть фокус
            preExisting: false,     // раздача была на сервере до окна — не останавливать
            chosen: false,
            serial: false,
            files: [], tiles: [],
            index: 0,
            title: '',
            tmdb: null,             // { id, type, title, overview, backdrop, runtime }
            episodeMeta: null       // { fileId: {season, episode, name, overview, stillPath, runtime} }
        };
    }

    /* ==================== РАЗМЕТКА ==================== */
    function build() {
        if (root) return;
        root = document.createElement('div');
        root.id = 'episode-picker';
        root.className = 'episode-picker hidden';
        root.innerHTML =
            '<div class="episode-picker-box">' +
            '<div class="episode-picker-bg"></div>' +
            '<div class="episode-picker-head">' +
            '<div class="episode-picker-title"></div>' +
            '<div class="episode-picker-sub"></div>' +
            '<div class="episode-picker-desc"></div>' +
            '<div class="episode-picker-meta"></div>' +
            '</div>' +
            '<div class="episode-picker-status"><span class="episode-picker-spinner"></span><span class="episode-picker-status-text"></span></div>' +
            '<div class="episode-picker-row" id="episode-picker-row"></div>' +
            '<div class="episode-picker-hint">OK — смотреть · Назад — закрыть</div>' +
            '</div>';
        document.body.appendChild(root);
        els.box = root.querySelector('.episode-picker-box');
        els.bg = root.querySelector('.episode-picker-bg');
        els.title = root.querySelector('.episode-picker-title');
        els.sub = root.querySelector('.episode-picker-sub');
        els.desc = root.querySelector('.episode-picker-desc');
        els.meta = root.querySelector('.episode-picker-meta');
        els.status = root.querySelector('.episode-picker-status');
        els.statusText = root.querySelector('.episode-picker-status-text');
        els.spinner = root.querySelector('.episode-picker-spinner');
        els.row = root.querySelector('.episode-picker-row');

        // Мышь и касание: клик по плитке — смотреть, мимо окна — закрыть
        root.addEventListener('click', function (e) {
            var tile = e.target.closest ? e.target.closest('.ep-picker-tile') : null;
            if (tile) { choose(tile._idx); return; }
            if (!els.box.contains(e.target)) close();
        });
        els.row.addEventListener('mouseover', function (e) {
            var tile = e.target.closest ? e.target.closest('.ep-picker-tile') : null;
            if (tile && tile._idx !== state.index) focusTile(tile._idx);
        });
    }

    function buildTile() {
        var tile = document.createElement('div');
        tile.className = 'ep-picker-tile';
        var img = document.createElement('img');
        img.decoding = 'async';
        img.alt = '';
        img.className = 'hidden';
        img.onload = function () { img.classList.remove('hidden'); };
        img.onerror = function () { img.classList.add('hidden'); };
        var play = document.createElement('div');
        play.className = 'ep-picker-play';
        play.textContent = '▶';
        var info = document.createElement('div');
        info.className = 'ep-picker-info';
        var name = document.createElement('div');
        name.className = 'ep-picker-name marquee-text';
        var nameText = document.createElement('span');
        name.appendChild(nameText);
        var size = document.createElement('div');
        size.className = 'ep-picker-size';
        info.appendChild(name);
        info.appendChild(size);
        tile.appendChild(img);
        tile.appendChild(play);
        tile.appendChild(info);
        tile._img = img;
        tile._name = nameText;
        tile._size = size;
        return tile;
    }

    /* ==================== ВСПОМОГАТЕЛЬНОЕ ==================== */
    function fmtBytes(b) {
        return typeof formatBytes === 'function' ? formatBytes(b) : Math.round((b || 0) / 1048576) + ' MB';
    }

    function fmtDuration(sec) {
        sec = Math.round(sec || 0);
        if (!(sec > 0)) return '';
        var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
        if (m === 60) { h++; m = 0; }
        return h ? h + ' ч' + (m ? ' ' + m + ' мин' : '') : m + ' мин';
    }

    function fileBaseName(f) {
        var p = String(f.path || f.name || '');
        var name = p.split('/').pop() || p;
        return name.replace(/\.[a-z0-9]{2,4}$/i, '');
    }

    function imageUrl(path, size) {
        if (!path) return '';
        if (/^https?:/i.test(path)) return path;
        return typeof buildTmdbPosterUrl === 'function' ? buildTmdbPosterUrl(path, size) : '';
    }

    function cardItem() {
        if (!AppState.searchLocked) return null;
        var item = AppState.pendingDetailItem || AppState.androidBackCatalog;
        return item && item.id ? item : null;
    }

    function isSerialResult(r) {
        if (!r) return false;
        if (Array.isArray(r.types) && (r.types.indexOf('tv') !== -1 || r.types.indexOf('serial') !== -1)) return true;
        return Array.isArray(r.seasons) && r.seasons.length > 0;
    }

    function setStatus(text, busy) {
        els.status.classList.toggle('hidden', !text);
        els.spinner.classList.toggle('hidden', !busy);
        els.statusText.textContent = text || '';
    }

    function pause(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    /* ==================== TORRSERVER ==================== */
    // Раздачу — в TorrServer без сохранения в базу, ответ — её статус с
    // file_stats. Метаданные приходят не сразу: пустой список или ошибку
    // переспрашиваем до STAT_TIMEOUT_MS
    function fetchStat(link, gen) {
        var deadline = Date.now() + STAT_TIMEOUT_MS;
        function attempt() {
            if (gen !== state.gen) return Promise.resolve(null);
            return torrServerFetch('/stream?link=' + encodeURIComponent(link) + '&index=1&stat', {
                method: 'GET', headers: { accept: 'application/json' }
            }).then(function (r) { return r.ok ? r.json() : null; })['catch'](function () { return null; })
                .then(function (data) {
                    var files = data && Array.isArray(data.file_stats) ? data.file_stats : [];
                    if (!files.length && data && data.data) {
                        try {
                            var parsed = JSON.parse(data.data);
                            if (parsed.TorrServer && Array.isArray(parsed.TorrServer.Files)) files = parsed.TorrServer.Files;
                        } catch (e) { }
                    }
                    if (files.length) return files;
                    if (gen !== state.gen || Date.now() > deadline) return null;
                    return pause(STAT_RETRY_MS).then(attempt);
                });
        }
        return attempt();
    }

    function hashOnServer(hash) {
        var list = (AppState && AppState.torrents) || [];
        for (var i = 0; i < list.length; i++) {
            if (String(list[i].hash || '').toLowerCase() === hash) return true;
        }
        return false;
    }

    /* ==================== TMDB ==================== */
    function searchTmdb(query, type, year) {
        if (!query) return Promise.resolve(null);
        var url = '/api/tmdb/search?query=' + encodeURIComponent(query) + '&type=' + type + '&year=' + (year || '');
        return fetch(url).then(function (r) { return r.ok ? r.json() : null; })['catch'](function () { return null; })
            .then(function (d) { return d && d.results && d.results[0] ? d.results[0] : null; });
    }

    /** Фильм или сериал раздачи: из карточки, иначе поиском по названию */
    function resolveTmdb(result, serial) {
        var item = cardItem();
        var type = item ? (item.media_type === 'tv' ? 'tv' : 'movie') : (serial ? 'tv' : 'movie');
        var found;
        if (item) {
            found = Promise.resolve({ id: item.id, title: item.title || item.name, overview: item.overview, backdrop_path: item.backdrop_path });
        } else {
            // Год у сериала не передаём: у раздачи пятого сезона он свой, а
            // TMDB ищет по году первого
            var year = !serial && result.released ? result.released : '';
            found = searchTmdb(result.name || result.title, type, year).then(function (r) {
                if (r || !result.originalname || result.originalname === result.name) return r;
                return searchTmdb(result.originalname, type, year);
            });
        }
        return found.then(function (r) {
            if (!r || !r.id) return null;
            var tm = { id: r.id, type: type, title: r.title || r.name || '', overview: r.overview || '', backdrop: r.backdrop_path || '', poster: r.poster_path || '', runtime: 0 };
            if (typeof getTmdbDetailsWithCache !== 'function') return tm;
            return Promise.resolve(getTmdbDetailsWithCache(tm.id, type))['catch'](function () { return null; }).then(function (d) {
                if (d) {
                    tm.title = tm.title || d.title || d.name || '';
                    tm.overview = tm.overview || d.overview || '';
                    tm.backdrop = tm.backdrop || d.backdrop_path || '';
                    tm.poster = tm.poster || d.poster_path || '';
                    tm.runtime = d.runtime || (Array.isArray(d.episode_run_time) && d.episode_run_time[0]) || 0;
                }
                return tm;
            });
        })['catch'](function () { return null; });
    }

    // Серии сезонов раздачи → сведения по файлам (buildEpisodeMetaByFile, torrents.js)
    function loadEpisodeMeta(tm, files, result) {
        var seasons = [];
        if (Array.isArray(result.seasons)) seasons = result.seasons.slice();
        if (!seasons.length) {
            for (var i = 0; i < files.length; i++) {
                var ref = parseEpisodeRef(files[i].path || files[i].name);
                if (ref && ref.season && seasons.indexOf(ref.season) === -1) seasons.push(ref.season);
            }
        }
        if (!seasons.length && typeof extractSeasonsFromTitle === 'function') seasons = extractSeasonsFromTitle(result.title || '');
        if (!seasons.length) seasons = [1];
        seasons.sort(function (a, b) { return a - b; });
        return Promise.all(seasons.map(function (sn) {
            return Promise.resolve(loadSeasonStills(tm.id, sn))['catch'](function () { return []; })
                .then(function (eps) { return { s: sn, e: eps || [] }; });
        })).then(function (arr) {
            var all = {};
            for (var k = 0; k < arr.length; k++) if (arr[k].e.length) all[arr[k].s] = arr[k].e;
            if (!Object.keys(all).length) return null;
            return buildEpisodeMetaByFile(files, seasons, all);
        });
    }

    /* ==================== ПОКАЗ ==================== */
    function tileMeta(f) {
        return state.episodeMeta ? state.episodeMeta[String(f.id)] || null : null;
    }

    function tileLabel(f, i) {
        var meta = tileMeta(f);
        if (meta) return formatEpisodeLabel(meta, i + 1);
        if (state.files.length === 1) return state.title || fileBaseName(f);
        return fileBaseName(f);
    }

    function renderTiles() {
        els.row.innerHTML = '';
        state.tiles = [];
        for (var i = 0; i < state.files.length; i++) {
            var tile = buildTile();
            tile._idx = i;
            els.row.appendChild(tile);
            state.tiles.push(tile);
        }
        refreshTiles();
    }

    function refreshTiles() {
        var tm = state.tmdb;
        for (var i = 0; i < state.tiles.length; i++) {
            var tile = state.tiles[i], f = state.files[i], meta = tileMeta(f);
            tile._name.textContent = tileLabel(f, i);
            tile._size.textContent = fmtBytes(f.length);
            // Кадр серии; у фильма — фон фильма
            var still = meta && meta.stillPath ? imageUrl(meta.stillPath, 'w300')
                : (!state.serial && tm && tm.backdrop ? imageUrl(tm.backdrop, 'w300') : '');
            if (still && tile._img.getAttribute('src') !== still) tile._img.src = still;
        }
        // Подпись под фокусом сменилась (имя файла → название серии из TMDB):
        // бегущую строку перемеряем, иначе она едет на сдвиг прежнего текста
        var focused = state.tiles[state.index];
        if (focused && focused.classList.contains('focused') && typeof applyTitleMarquee === 'function') {
            if (typeof clearTitleMarquee === 'function') clearTitleMarquee(focused);
            applyTitleMarquee(focused);
        }
        updateHead();
    }

    function updateHead() {
        var tm = state.tmdb;
        els.title.textContent = state.title;
        if (tm && tm.backdrop) {
            var bg = imageUrl(tm.backdrop, 'w780');
            if (els.bg._url !== bg) { els.bg._url = bg; els.bg.style.backgroundImage = bg ? 'url("' + bg + '")' : ''; }
        }
        var f = state.files[state.index];
        if (!f) { els.sub.textContent = ''; els.desc.textContent = ''; els.meta.textContent = ''; return; }
        var meta = tileMeta(f);
        els.sub.textContent = state.files.length > 1 || meta ? tileLabel(f, state.index) : '';
        els.desc.textContent = (meta && meta.overview) || (!state.serial && tm ? tm.overview : '') || '';
        // Длительность — только из TMDB: ffprobe файла (/ffp) тянул бы начало
        // файла из раздачи ради одной цифры
        var secs = (meta && meta.runtime ? meta.runtime * 60 : 0) ||
            (!state.serial && tm && tm.runtime && f === biggestFile() ? tm.runtime * 60 : 0);
        var parts = [];
        var d = fmtDuration(secs);
        if (d) parts.push(d);
        parts.push(fmtBytes(f.length));
        els.meta.textContent = parts.join(' · ');
    }

    function biggestFile() {
        var best = state.files[0];
        for (var i = 1; i < state.files.length; i++) if ((state.files[i].length || 0) > (best.length || 0)) best = state.files[i];
        return best;
    }

    function focusTile(i, dir) {
        var tile = state.tiles[i];
        if (!tile) return;
        state.index = i;
        if (typeof focusEl === 'function') focusEl(tile, dir ? { direction: dir } : undefined);
        else { for (var k = 0; k < state.tiles.length; k++) state.tiles[k].classList.toggle('focused', k === i); }
        updateHead();
    }

    /* ==================== ОТКРЫТЬ / ЗАКРЫТЬ ==================== */
    function openFor(itemEl) {
        var result = typeof window.getSearchResultForItem === 'function' ? window.getSearchResultForItem(itemEl) : null;
        if (result) open(result, itemEl);
    }

    function open(result, fromEl) {
        if (state.open) return;
        var hash = typeof searchResultHash === 'function' ? searchResultHash(result) : null;
        hash = String(hash || '').toLowerCase();
        if (!hash) {
            if (typeof window.showErrorBanner === 'function') window.showErrorBanner('Не удалось открыть раздачу', 'В результате поиска нет hash');
            return;
        }
        Promise.resolve(typeof ensureTorrserverOnline === 'function' ? ensureTorrserverOnline() : true).then(function (ok) {
            if (ok) start(result, fromEl, hash);
        });
    }

    function start(result, fromEl, hash) {
        if (state.open) return;
        build();
        var gen = state.gen + 1;
        state = freshState();
        state.gen = gen;
        state.open = true;
        state.result = result;
        state.hash = hash;
        state.magnet = result.magnet || hash;
        state.from = fromEl || null;
        state.preExisting = hashOnServer(hash);
        state.serial = isSerialResult(result) || !!(cardItem() && cardItem().media_type === 'tv');
        var card = cardItem();
        state.title = (card && (card.title || card.name)) || result.name || result.title || '';

        els.row.innerHTML = '';
        els.bg.style.backgroundImage = '';
        els.bg._url = '';
        els.sub.textContent = result.title && result.title !== state.title ? result.title : '';
        els.desc.textContent = '';
        els.meta.textContent = result.sizeName || '';
        els.title.textContent = state.title;
        setStatus('Получаем список файлов…', true);
        root.classList.remove('hidden');

        fetchStat(state.magnet, gen).then(function (files) {
            if (gen !== state.gen) {
                // Окно закрыли, пока TorrServer искал метаданные: раздача
                // добавилась уже после остановки — останавливаем ещё раз
                if (files && !state.chosen) dropIfTemporary(hash, state.preExisting);
                return;
            }
            var video = files ? extractVideoFiles(files) : [];
            if (!files) { setStatus('TorrServer не получил список файлов раздачи. Возможно, у неё нет сидов', false); return; }
            if (!video.length) { setStatus('В раздаче нет видеофайлов', false); return; }
            state.files = video;
            // Несколько файлов с номерами серий — сериал, даже если Jacred не сказал
            if (!state.serial && video.length > 1) {
                var numbered = 0;
                for (var i = 0; i < video.length; i++) if (parseEpisodeRef(video[i].path || video[i].name)) numbered++;
                if (numbered * 2 >= video.length) state.serial = true;
            }
            setStatus('', false);
            renderTiles();
            focusTile(0);
            resolveTmdb(result, state.serial).then(function (tm) {
                if (gen !== state.gen || !tm) return null;
                state.tmdb = tm;
                if (!card && tm.title) state.title = tm.title;
                refreshTiles();
                if (!state.serial || typeof buildEpisodeMetaByFile !== 'function') return null;
                return loadEpisodeMeta(tm, state.files, result).then(function (byFile) {
                    if (gen !== state.gen || !byFile) return;
                    state.episodeMeta = byFile;
                    // Плеер и карточка раздачи возьмут их же (torrents.js)
                    if (typeof setTorrentEpisodeMeta === 'function') setTorrentEpisodeMeta(hash, byFile);
                    refreshTiles();
                });
            })['catch'](function () { });
        });
    }

    function dropIfTemporary(hash, preExisting) {
        if (preExisting || !hash || typeof dropTorrentToServer !== 'function') return;
        Promise.resolve(dropTorrentToServer(hash))['catch'](function () { });
    }

    /**
     * @param {boolean} [keepTorrent] выбрали серию — раздачу не останавливать
     */
    function close(keepTorrent) {
        if (!state.open) return;
        var from = state.from, hash = state.hash, pre = state.preExisting;
        state.open = false;
        state.gen++;
        root.classList.add('hidden');
        els.row.innerHTML = '';
        state.tiles = [];
        if (!keepTorrent) dropIfTemporary(hash, pre);
        if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
        if (from && from.isConnected !== false && typeof focusEl === 'function') focusEl(from);
        else if (typeof window.focusSearchHome === 'function') window.focusSearchHome();
    }

    function choose(i) {
        var f = state.files[i];
        if (!state.open || !f) return;
        state.chosen = true;
        var result = state.result, tm = state.tmdb;
        var info = {
            tmdbId: tm ? tm.id : null,
            mediaType: tm ? tm.type : (state.serial ? 'tv' : 'movie'),
            poster: tm && tm.poster ? imageUrl(tm.poster, 'w342') : null
        };
        close(true);
        if (typeof window.playSearchResultFile === 'function') window.playSearchResultFile(result, f.id, i, info);
    }

    /* ==================== ПУЛЬТ ==================== */
    function handleArrow(dir) {
        if (!state.open || !state.tiles.length) return;
        if (dir === 'left' && state.index > 0) focusTile(state.index - 1, 'left');
        else if (dir === 'right' && state.index < state.tiles.length - 1) focusTile(state.index + 1, 'right');
    }

    function handleOk() {
        if (state.open && state.tiles.length) choose(state.index);
    }

    /* ==================== УДЕРЖАНИЕ ПАЛЬЦЕМ И МЫШЬЮ ====================
     * То же, что долгое OK с пульта: держим раздачу в выдаче HOLD_MS — окно.
     * Палец или курсор сдвинулся дальше HOLD_MOVE_PX — это прокрутка, не
     * удержание. Окно открылось — отпускание уже ничего не запускает: гасим
     * следующий за ним клик (и у касания — сам touchend, иначе браузер
     * досочинит из него клик мышью).
     *
     * Долгое касание на Android шлёт ещё и contextmenu (около 500 мс) — в
     * приложении это «Назад». Его на раздаче глотает обработчик выдачи
     * (torrents.js) и, пока идёт удержание пальцем, окно не открывает: откроет
     * таймер. */
    var HOLD_MS = 600;
    var HOLD_MOVE_PX = 10;
    var CLICK_SUPPRESS_MS = 700;
    var hold = null;
    var suppressClickUntil = 0;
    var lastTouchAt = 0;

    function holdItem(target) {
        if (!target || !target.closest || state.open) return null;
        var item = target.closest('.search-result-item');
        if (!item || !item.closest('#search-results')) return null;
        if (typeof currentScreen === 'function' && currentScreen() !== 'search') return null;
        return item;
    }

    function holdStart(item, x, y, touch) {
        holdCancel();
        hold = { item: item, x: x, y: y, touch: touch, fired: false, timer: null };
        hold.timer = setTimeout(function () {
            if (!hold || hold.item !== item) return;
            hold.timer = null;
            hold.fired = true;
            suppressClickUntil = Date.now() + 60000;   // до отпускания
            if (typeof focusEl === 'function') focusEl(item);
            openFor(item);
        }, HOLD_MS);
    }

    function holdMove(x, y) {
        if (!hold || hold.fired) return;
        if (Math.abs(x - hold.x) > HOLD_MOVE_PX || Math.abs(y - hold.y) > HOLD_MOVE_PX) holdCancel();
    }

    /** @returns {boolean} удержание сработало — отпускание надо погасить */
    function holdEnd() {
        if (!hold) return false;
        var fired = hold.fired;
        holdCancel();
        if (fired) suppressClickUntil = Date.now() + CLICK_SUPPRESS_MS;
        return fired;
    }

    function holdCancel() {
        if (hold && hold.timer) clearTimeout(hold.timer);
        hold = null;
    }

    document.addEventListener('touchstart', function (e) {
        lastTouchAt = Date.now();
        if (!e.touches || e.touches.length !== 1) { holdCancel(); return; }
        var item = holdItem(e.target);
        if (item) holdStart(item, e.touches[0].clientX, e.touches[0].clientY, true);
        else holdCancel();
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
        if (e.touches && e.touches.length) holdMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    document.addEventListener('touchend', function (e) {
        lastTouchAt = Date.now();
        if (holdEnd() && e.cancelable) e.preventDefault();
    }, { passive: false });
    document.addEventListener('touchcancel', holdCancel, { passive: true });

    document.addEventListener('mousedown', function (e) {
        // Мышь, которую браузер досочинил из касания, — не мышь
        if (e.button !== 0 || Date.now() - lastTouchAt < 1000) return;
        var item = holdItem(e.target);
        if (item) holdStart(item, e.clientX, e.clientY, false);
    }, true);
    document.addEventListener('mousemove', function (e) { holdMove(e.clientX, e.clientY); }, true);
    document.addEventListener('mouseup', function (e) { if (e.button === 0) holdEnd(); }, true);

    // Клик после сработавшего удержания — в перехвате, раньше выдачи
    document.addEventListener('click', function (e) {
        if (Date.now() >= suppressClickUntil) return;
        suppressClickUntil = 0;
        e.preventDefault();
        e.stopPropagation();
    }, true);

    window.EpisodePicker = {
        isOpen: function () { return state.open; },
        /** Идёт удержание пальцем (contextmenu от него окно не открывает) */
        isTouchHolding: function () { return !!(hold && hold.touch) || Date.now() - lastTouchAt < 1000; },
        openFor: openFor,
        open: open,
        close: close,
        handleArrow: handleArrow,
        handleOk: handleOk
    };
})();
