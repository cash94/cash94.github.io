// poster-prefetch.js — постеры заранее, в HTTP-кэш браузера, из фонового потока.
//
// Зачем. Сетка категории грузит постер только в паузе навигации (isGridNavBusy в
// catalog.js): старт загрузки картинки стоит основному потоку 5–7 мс на
// эмуляторе ТВ, вставка — ещё кадр, и посреди прокрутки это рывки. Поэтому,
// пока листают, вместо постеров пустые рамки, а после остановки картинки ещё
// идут по сети — сотни миллисекунд на каждую.
//
// Здесь, пока человек листает, те же адреса качает Web Worker: его fetch
// основной поток не трогает вовсе. Файл ложится в HTTP-кэш, и когда сетка в
// паузе ставит <img> с тем же адресом, картинка приходит из кэша — замер в
// браузере: 2 мс против 500–600 по сети.
//
// Тонкость — Vary: Accept. Часть зеркал (tsimg, nmtmdb) отдаёт его, и кэш тогда
// привязан к заголовку Accept запроса. У fetch он по умолчанию «*/*», у <img> —
// свой у каждого браузера, и без совпадения кэш промахивается. Поэтому воркер
// шлёт Accept картинки: вариант по версии браузера, а дальше самопроверка —
// по Resource Timing видно, пришёл ли уже скачанный постер из кэша (единицы
// миллисекунд) или из сети. Не пришёл несколько раз подряд — пробуем
// следующий вариант; удачный запоминается.
//
// Воркер создаётся из Blob: отдельного файла на сервере не нужно (свои
// воркеры сервер TorrStream раздаёт только по известным именам, routes/proxy.js).
(function () {
    'use strict';

    var PF = {
        // Параллельных скачиваний: соединения к зеркалу общие со страницей,
        // видимым постерам должно оставаться место
        // Постеры раскиданы по зеркалам (pickMirror в catalog.js), а лимит
        // браузера — 6 соединений на хост, так что шесть разом не теснят
        // видимые постеры
        CONCURRENCY: 6,
        // Очередь не длиннее: свежие просьбы встают в начало, старые отваливаются
        QUEUE_MAX: 120,
        // Сколько адресов помним скачанными (дальше — забываем самые старые)
        DONE_MAX: 1500,
        // Загрузка <img> быстрее HIT_MS — пришла из кэша, дольше MISS_MS — из
        // сети, между ними — не считаем. Зазор широкий: на занятой странице и
        // попадание в кэш бывает дольше 40 мс, а сеть до зеркала — сотни
        HIT_MS: 80,
        MISS_MS: 250,
        // Столько промахов на одном зеркале без единого попадания — Accept не тот
        MISS_LIMIT: 4,
        STORE_KEY: 'ts_img_accept'
    };

    var ua = navigator.userAgent || '';
    var chromeMajor = (function () {
        var m = /Chrom(?:e|ium)\/(\d+)/.exec(ua);
        return m ? parseInt(m[1], 10) : 0;
    })();

    // Accept, который браузер шлёт за картинкой. Первый — самый вероятный для
    // этого браузера, остальные — запас для самопроверки.
    var ACCEPTS = [
        'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',   // Chrome 100+
        'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',                 // Chrome 85–99
        'image/webp,image/apng,image/*,*/*;q=0.8',                            // Chrome 66–84 (ТВ)
        'image/webp,*/*',                                                     // Chrome < 66
        'image/webp,image/avif,image/jxl,image/heic,image/heic-sequence,video/*;q=0.8,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5', // Safari
        'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5' // Firefox
    ];

    function guessAccept() {
        if (!chromeMajor) return /Firefox\//.test(ua) ? 5 : 4;
        if (chromeMajor >= 100) return 0;
        if (chromeMajor >= 85) return 1;
        if (chromeMajor >= 66) return 2;
        return 3;
    }

    var acceptIdx = guessAccept();
    var storeKey = PF.STORE_KEY + '_' + (chromeMajor || ua.length);
    try {
        var saved = parseInt(localStorage.getItem(storeKey), 10);
        if (saved >= 0 && saved < ACCEPTS.length) acceptIdx = saved;
    } catch (e) { }

    // ==================== ВОРКЕР ====================
    // Код воркера — строкой, в ES5: он исполняется тем же старым движком ТВ.
    // Очередь «свежие впереди»: фокус уехал — нужны уже другие постеры.
    var WORKER_SRC =
        'var q=[],active=0,max=' + PF.CONCURRENCY + ',cap=' + PF.QUEUE_MAX + ',acc="";' +
        'onmessage=function(e){var d=e.data;if(d.accept)acc=d.accept;' +
        'if(d.urls){for(var i=d.urls.length-1;i>=0;i--){var u=d.urls[i],j=q.indexOf(u);if(j!==-1)q.splice(j,1);q.unshift(u);}' +
        'if(q.length>cap)q.length=cap;}pump();};' +
        'function pump(){while(active<max&&q.length){active++;get(q.shift());}}' +
        'function get(u){fetch(u,{mode:"cors",headers:{Accept:acc}})' +
        '.then(function(r){if(!r.ok)throw 0;return r.blob();})' +
        '.then(function(){postMessage({ok:u});},function(){postMessage({fail:u});})' +
        '.then(function(){active--;pump();});}';

    var worker = null;
    var workerFailed = false;

    function getWorker() {
        if (worker || workerFailed) return worker;
        try {
            if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || !window.URL) throw 0;
            var url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
            worker = new Worker(url);
            worker.onmessage = onWorkerMessage;
            worker.onerror = function () { workerFailed = true; worker = null; };
            worker.postMessage({ accept: ACCEPTS[acceptIdx] });
        } catch (e) {
            workerFailed = true;
            worker = null;
        }
        return worker;
    }

    // ==================== УЧЁТ: ЧТО УЖЕ СКАЧАНО ====================
    // url → performance.now() окончания скачивания (0 — ещё в очереди/в работе)
    var known = {};
    var knownOrder = [];

    function remember(url, at) {
        if (!Object.prototype.hasOwnProperty.call(known, url)) {
            knownOrder.push(url);
            if (knownOrder.length > PF.DONE_MAX) delete known[knownOrder.shift()];
        }
        known[url] = at;
    }

    function onWorkerMessage(e) {
        var d = e.data || {};
        if (d.ok) remember(d.ok, now());
        // Не скачалось (зеркало молчит, нет CORS) — забываем: просьба придёт снова
        else if (d.fail && Object.prototype.hasOwnProperty.call(known, d.fail)) known[d.fail] = -1;
    }

    function now() {
        return (window.performance && performance.now) ? performance.now() : Date.now();
    }

    /**
     * Скачать адреса заранее. Уже скачанные и стоящие в очереди пропускаются;
     * переданные встают в начало очереди в своём порядке — первым передавайте
     * самое нужное.
     */
    function want(urls) {
        if (!urls || !urls.length) return;
        var fresh = [];
        for (var i = 0; i < urls.length; i++) {
            var u = urls[i];
            if (!u) continue;
            var st = Object.prototype.hasOwnProperty.call(known, u) ? known[u] : null;
            if (st !== null && st !== -1) continue;    // скачан или в работе
            remember(u, 0);
            fresh.push(u);
        }
        if (!fresh.length) return;
        var w = getWorker();
        if (w) w.postMessage({ urls: fresh });
    }

    // ==================== САМОПРОВЕРКА ACCEPT ====================
    // Скачанный воркером постер потом грузит <img>. По Resource Timing видно,
    // откуда он пришёл. Промахи считаем по зеркалам: у зеркала без Vary кэш
    // попадает при любом Accept, и его попадания ничего не говорят о других.
    var stats = {};       // host → {hit, miss}
    var calibrated = false;
    var switches = 0;     // сколько раз меняли Accept

    function hostOf(url) {
        var m = /^https?:\/\/([^/]+)/.exec(url);
        return m ? m[1] : '';
    }

    function onResourceEntries(list) {
        if (calibrated) return;
        var entries = list.getEntries();
        for (var i = 0; i < entries.length; i++) {
            var en = entries[i];
            if (en.initiatorType !== 'img') continue;
            var doneAt = known[en.name];
            // Только постеры, скачанные воркером ДО того, как их попросила картинка
            if (!(doneAt > 0) || en.startTime < doneAt) continue;
            var host = hostOf(en.name);
            var s = stats[host] || (stats[host] = { hit: 0, miss: 0 });
            // Попадание у зеркала без Vary ничего не доказывает (там кэш
            // попадает при любом Accept), поэтому решают промахи: зеркало,
            // которое ни разу не попало, — признак чужого Accept
            if (en.duration < PF.HIT_MS) s.hit++;
            else if (en.duration > PF.MISS_MS) s.miss++;
            else continue;
            if (s.miss >= PF.MISS_LIMIT && s.hit === 0) { nextAccept(); return; }
        }
        rememberIfGood();
    }

    /** Попаданий набралось, а упорно промахивающихся зеркал нет — вариант верный */
    function rememberIfGood() {
        var hits = 0;
        for (var h in stats) {
            if (!stats.hasOwnProperty(h)) continue;
            if (stats[h].hit === 0 && stats[h].miss > 0) return;
            hits += stats[h].hit;
        }
        if (hits >= 10) {
            try { localStorage.setItem(storeKey, String(acceptIdx)); } catch (e) { }
        }
    }

    function nextAccept() {
        // Прошли все варианты — дело не в Accept (кэш браузера не держит
        // картинки, зеркало без кэширования): больше не дёргаемся
        if (++switches >= ACCEPTS.length) { calibrated = true; return; }
        stats = {};
        acceptIdx = (acceptIdx + 1) % ACCEPTS.length;
        if (worker) worker.postMessage({ accept: ACCEPTS[acceptIdx] });
        // Скачанное со старым Accept для зеркал с Vary бесполезно — забываем,
        // пусть перекачается с новым
        known = {};
        knownOrder = [];
        try { localStorage.removeItem(storeKey); } catch (e) { }
    }

    try {
        if (typeof PerformanceObserver === 'function') {
            new PerformanceObserver(onResourceEntries).observe({ entryTypes: ['resource'] });
        }
    } catch (e) { }

    window.PosterPrefetch = {
        want: want,
        // Для отладки: какой Accept сейчас и что насчитала самопроверка
        state: function () {
            return { accept: ACCEPTS[acceptIdx], idx: acceptIdx, calibrated: calibrated, stats: stats, known: knownOrder.length, worker: !!worker };
        }
    };
})();
