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
        // Фоновая очередь (want(urls, {low: true})) — заранее «на потом»: всё
        // для главной под заставкой. Идёт, только когда срочная пуста, и не
        // больше LOW_CONCURRENCY разом: срочное и картинки страницы не ждут её
        LOW_QUEUE_MAX: 600,
        LOW_CONCURRENCY: 3,
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
    //
    // Второй канал — запросы вообще (BgFetch ниже): {rid, url, method,
    // headers, body, mode} → воркер делает запрос, читает ответ и, если это
    // JSON, разбирает его сам; основному потоку приходит готовый объект.
    // {rid, abort} обрывает запрос (AbortSignal вызывающей стороны).
    // mode "none" — тело не читаем (прогрев TorrServer: важен только ответ).
    // Последней строкой — {ready}: по нему основной поток узнаёт, что воркер
    // действительно исполняется (на части ТВ Blob-воркер создаётся, но молчит).
    var WORKER_SRC =
        'var q=[],lq=[],active=0,la=0,max=' + PF.CONCURRENCY + ',lmax=' + PF.LOW_CONCURRENCY + ',cap=' + PF.QUEUE_MAX + ',lcap=' + PF.LOW_QUEUE_MAX + ',acc="",ctl={};' +
        'onmessage=function(e){var d=e.data;if(d.accept)acc=d.accept;' +
        'if(d.rid){if(d.abort){if(ctl[d.rid]){try{ctl[d.rid].abort();}catch(x){}delete ctl[d.rid];}return;}req(d);return;}' +
        'if(d.urls&&d.low){for(var a=0;a<d.urls.length;a++){var w=d.urls[a];if(q.indexOf(w)===-1&&lq.indexOf(w)===-1)lq.push(w);}if(lq.length>lcap)lq.length=lcap;}' +
        'else if(d.urls){for(var i=d.urls.length-1;i>=0;i--){var u=d.urls[i],j=q.indexOf(u),k=lq.indexOf(u);if(j!==-1)q.splice(j,1);if(k!==-1)lq.splice(k,1);q.unshift(u);}' +
        'if(q.length>cap)q.length=cap;}pump();};' +
        'function req(d){var c=null;try{c=new AbortController();}catch(x){}if(c)ctl[d.rid]=c;' +
        'var o={method:d.method||"GET",headers:d.headers||{}};if(d.body!=null)o.body=d.body;if(c)o.signal=c.signal;if(d.keepalive)o.keepalive=true;' +
        'fetch(d.url,o).then(function(r){var m={rid:d.rid,status:r.status,statusText:r.statusText,ok:r.ok,ct:r.headers.get("content-type")||"",url:r.url,h:{}};try{r.headers.forEach(function(v,k){m.h[String(k).toLowerCase()]=v;});}catch(x){}' +
        'if(d.mode==="none"){postMessage(m);var fin=function(){delete ctl[d.rid];};r.blob().then(fin,fin);return;}' +
        'return r.text().then(function(t){delete ctl[d.rid];' +
        'if(d.mode!=="text"){var s=String(t).trim(),f=s.charAt(0);if(f==="{"||f==="["||/json/i.test(m.ct)){try{m.json=JSON.parse(t);m.parsed=1;postMessage(m);return;}catch(x){}}}' +
        'm.text=t;postMessage(m);});})' +
        '.catch(function(e){delete ctl[d.rid];postMessage({rid:d.rid,err:(e&&e.name)||"TypeError",msg:(e&&e.message)||""});});}' +
        'function pump(){while(active<max){if(q.length){active++;get(q.shift(),0);}else if(lq.length&&la<lmax){active++;la++;get(lq.shift(),1);}else break;}}' +
        'function get(u,low){fetch(u,{mode:"cors",headers:{Accept:acc}})' +
        '.then(function(r){if(!r.ok)throw 0;return r.blob();})' +
        '.then(function(){postMessage({ok:u});},function(){postMessage({fail:u});})' +
        '.then(function(){active--;if(low)la--;pump();});}' +
        'postMessage({ready:1});';

    var worker = null;
    var workerFailed = false;

    function getWorker() {
        if (worker || workerFailed) return worker;
        try {
            if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || !window.URL) throw 0;
            var url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
            worker = new Worker(url);
            worker.onmessage = onWorkerMessage;
            worker.onerror = function () { workerFailed = true; workerReady = false; worker = null; failAllRequests(); flushReadyWaiters(); };
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
        if (d.ready) { workerReady = true; workerSilent = false; flushReadyWaiters(); return; }
        if (d.rid) { settleRequest(d); return; }
        if (d.ok || d.fail) delete lowPending[d.ok || d.fail];
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
    var lowPending = {};      // url → стоит в фоновой очереди воркера

    function want(urls, opts) {
        if (!urls || !urls.length) return;
        var low = !!(opts && opts.low);
        var fresh = [];
        for (var i = 0; i < urls.length; i++) {
            var u = urls[i];
            if (!u) continue;
            var st = Object.prototype.hasOwnProperty.call(known, u) ? known[u] : null;
            // Ждёт в фоновой очереди, а теперь нужен срочно — поднимаем: воркер
            // переставит его из фоновой очереди в начало срочной
            if (st === 0 && !low && lowPending[u]) { delete lowPending[u]; fresh.push(u); continue; }
            if (st !== null && st !== -1) continue;    // скачан или в работе
            remember(u, 0);
            if (low) lowPending[u] = true;
            fresh.push(u);
        }
        if (!fresh.length) return;
        var w = getWorker();
        if (w) w.postMessage(low ? { urls: fresh, low: 1 } : { urls: fresh });
    }

    // ==================== ЗАПРОСЫ ЧЕРЕЗ ВОРКЕР (BgFetch) ====================
    // Запросы к нашему серверу (история, детали, логотипы, сезоны TMDB) и к
    // TorrServer (/torrents, stat раздачи, /cache, прогрев) идут не из
    // основного потока: воркер делает запрос, читает ответ и разбирает JSON
    // сам, основному потоку приходит готовый объект. Вызывающий код при этом
    // не меняется: BgFetch.fetch(url, init) отдаёт объект того же вида, что
    // Response, — ok, status, json(), text(), headers.get().
    //
    // Основной поток делает запрос сам, как раньше, если:
    //   • воркер ещё не прислал {ready} (или не поднимется вовсе — на части ТВ
    //     Blob-воркер создаётся, но молчит: тогда ни один запрос не повиснет);
    //   • тело не строка (FormData, Blob) — их незачем гонять через postMessage.
    // Воркер упал посреди запроса — запрос отклоняется, как fetch при обрыве
    // сети, и вызывающая сторона обработает это как обычно.
    var reqSeq = 0;
    var reqPending = {};      // rid → {resolve, reject, unlisten}
    var workerReady = false;

    /** Путь сервера → полный адрес: Blob-воркер не знает базы страницы */
    function absServerUrl(path) {
        var p = String(path || '');
        if (/^https?:\/\//i.test(p)) return p;
        try {
            if (window.TS_SERVER && typeof SERVER_URL !== 'undefined' && p.charAt(0) === '/' && p.charAt(1) !== '/') return SERVER_URL + p;
            return new URL(p, document.baseURI).href;
        } catch (e) { return p; }
    }

    /** Заголовки → простой объект (postMessage не клонирует Headers) */
    function plainHeaders(h) {
        var out = {};
        if (!h) return out;
        if (typeof h.forEach === 'function' && typeof h.get === 'function') {
            h.forEach(function (v, k) { out[k] = v; });
            return out;
        }
        for (var k in h) if (Object.prototype.hasOwnProperty.call(h, k)) out[k] = h[k];
        return out;
    }

    function hasHeader(h, name) {
        name = name.toLowerCase();
        for (var k in h) if (Object.prototype.hasOwnProperty.call(h, k) && k.toLowerCase() === name) return true;
        return false;
    }

    function makeError(name, msg) {
        var e = name === 'TypeError' ? new TypeError(msg || 'Failed to fetch') : new Error(msg || name);
        e.name = name;
        return e;
    }

    /** Ответ воркера → объект с интерфейсом Response (то, чем пользуется код) */
    function makeResponse(m) {
        var used = false;
        var take = function () {
            if (used) return Promise.reject(new TypeError('Body has already been consumed.'));
            used = true;
            return null;
        };
        return {
            ok: !!m.ok,
            status: m.status,
            statusText: m.statusText || '',
            url: m.url || '',
            headers: { get: function (n) { var h = m.h || {}; var v = h[String(n).toLowerCase()]; return v != null ? v : (/^content-type$/i.test(n) ? (m.ct || null) : null); } },
            json: function () {
                var r = take(); if (r) return r;
                if (m.parsed) return Promise.resolve(m.json);
                return Promise.resolve().then(function () { return JSON.parse(m.text || ''); });
            },
            text: function () {
                var r = take(); if (r) return r;
                return Promise.resolve(m.text != null ? m.text : (m.parsed ? JSON.stringify(m.json) : ''));
            }
        };
    }

    function settleRequest(d) {
        var job = reqPending[d.rid];
        if (!job) return;
        delete reqPending[d.rid];
        if (job.unlisten) job.unlisten();
        if (d.err) job.reject(makeError(d.err, d.msg));
        else job.resolve(makeResponse(d));
    }

    function failAllRequests() {
        for (var id in reqPending) {
            if (!reqPending.hasOwnProperty(id)) continue;
            settleRequest({ rid: id, err: 'TypeError', msg: 'Failed to fetch' });
        }
    }

    /**
     * fetch через воркер. init — как у fetch (method, headers, body-строка,
     * signal, keepalive) плюс bgMode: 'auto' (JSON разбирается в воркере) |
     * 'text' | 'none' (тело не читать — прогрев TorrServer).
     */
    function nativeFetch(url, init) {
        var o = {}, k;
        init = init || {};
        for (k in init) if (k !== 'bgMode' && Object.prototype.hasOwnProperty.call(init, k)) o[k] = init[k];
        return window.fetch(url, o);
    }

    /* Готовность воркера. Он создаётся при загрузке этого файла, а {ready}
     * присылает через десятки миллисекунд — ровно когда уходят стартовые
     * запросы. Их не отдаём основному потоку сразу, а ждём готовности, но не
     * дольше READY_WAIT_MS: воркер, который так и не ответил (на части ТВ
     * Blob-воркер создаётся, но молчит), больше не ждём вовсе. */
    var READY_WAIT_MS = 1000;
    var readyWaiters = [];
    var readyWaitTimer = null;
    var workerSilent = false;

    function whenWorkerReady(cb) {
        if (workerReady) { cb(true); return; }
        if (workerSilent || !getWorker()) { cb(false); return; }
        readyWaiters.push(cb);
        if (!readyWaitTimer) {
            readyWaitTimer = setTimeout(function () {
                readyWaitTimer = null;
                if (!workerReady) workerSilent = true;
                flushReadyWaiters();
            }, READY_WAIT_MS);
        }
    }

    function flushReadyWaiters() {
        if (readyWaitTimer && workerReady) { clearTimeout(readyWaitTimer); readyWaitTimer = null; }
        var list = readyWaiters;
        readyWaiters = [];
        for (var i = 0; i < list.length; i++) list[i](workerReady);
    }

    function bgFetch(url, init) {
        init = init || {};
        if (init.body != null && typeof init.body !== 'string') return nativeFetch(url, init);
        if (workerReady) return workerFetch(url, init);
        return new Promise(function (resolve) {
            whenWorkerReady(function (ok) {
                resolve(ok && worker ? workerFetch(url, init) : nativeFetch(url, init));
            });
        });
    }

    function workerFetch(url, init) {
        var w = getWorker();
        var body = init.body;
        if (!w) return nativeFetch(url, init);
        var headers = plainHeaders(init.headers);
        // Токен входа — как у обёртки fetch в config.js: только для запросов
        // на сервер TorrStream и только если вызывающий не задал свой
        try {
            if (typeof isTsServerUrl === 'function' && isTsServerUrl(url) &&
                typeof tsAuthToken === 'function' && !hasHeader(headers, 'Authorization')) {
                var token = tsAuthToken();
                if (token) headers.Authorization = 'Bearer ' + token;
            }
        } catch (e) { }
        var signal = init.signal;
        if (signal && signal.aborted) return Promise.reject(makeError('AbortError', 'The user aborted a request.'));

        return new Promise(function (resolve, reject) {
            var rid = 'r' + (++reqSeq);
            var job = { resolve: resolve, reject: reject, unlisten: null };
            if (signal && typeof signal.addEventListener === 'function') {
                var onAbort = function () {
                    if (!reqPending[rid]) return;
                    delete reqPending[rid];
                    if (worker) worker.postMessage({ rid: rid, abort: 1 });
                    reject(makeError('AbortError', 'The user aborted a request.'));
                };
                signal.addEventListener('abort', onAbort);
                job.unlisten = function () { signal.removeEventListener('abort', onAbort); };
            }
            reqPending[rid] = job;
            w.postMessage({
                rid: rid,
                url: absServerUrl(url),
                method: init.method || 'GET',
                headers: headers,
                body: body != null ? body : null,
                keepalive: !!init.keepalive,
                mode: init.bgMode || 'auto'
            });
        });
    }

    /**
     * JSON с сервера через фоновый поток. path — как для fetch (/api/...).
     * Одинаковые запросы, пока первый в пути, склеиваются: заранее запущенная
     * догрузка и открытие карточки ждут одного ответа. Промис отдаёт
     * разобранный ответ или null (ошибка HTTP, нет сети) и не отклоняется.
     */
    var jsonInflight = {};    // path → Promise

    function json(path) {
        if (!path) return Promise.resolve(null);
        if (jsonInflight[path]) return jsonInflight[path];
        var p = bgFetch(path, { headers: { Accept: 'application/json' } })
            .then(function (r) { return r.ok ? r.json() : null; })
            .catch(function () { return null; });
        jsonInflight[path] = p;
        p.then(function () { delete jsonInflight[path]; });
        return p;
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
        lowPending = {};
        try { localStorage.removeItem(storeKey); } catch (e) { }
    }

    try {
        if (typeof PerformanceObserver === 'function') {
            new PerformanceObserver(onResourceEntries).observe({ entryTypes: ['resource'] });
        }
    } catch (e) { }

    // Воркер поднимаем сразу: запросы пойдут через него, как только он
    // пришлёт {ready}; первые уйдут основным потоком, как раньше
    getWorker();

    window.PosterPrefetch = {
        want: want,
        json: json,
        fetch: bgFetch,
        // Для отладки: какой Accept сейчас и что насчитала самопроверка
        state: function () {
            return { accept: ACCEPTS[acceptIdx], idx: acceptIdx, calibrated: calibrated, stats: stats, known: knownOrder.length, worker: !!worker, ready: workerReady };
        }
    };

    // Общий вход для остальных модулей: BgFetch.fetch / BgFetch.json.
    // Модули зовут его через window.bgFetch — если этот файл не загрузился
    // (старая сборка с зеркала), там стоит обычный fetch.
    window.BgFetch = { fetch: bgFetch, json: json };

    // Запросы, которые config.js успел поставить в очередь до этого файла
    // (bgFetch там — заглушка): теперь их можно отправить через воркер
    var early = window._bgFetchQueue;
    if (early && early.length) {
        var q = early.splice(0);
        for (var i = 0; i < q.length; i++) q[i].resolve(bgFetch(q[i].url, q[i].init));
    }
})();

/** fetch через фоновый поток, если он есть (poster-prefetch.js: BgFetch) */
function bgFetch(url, init) {
    if (window.BgFetch && typeof window.BgFetch.fetch === 'function') return window.BgFetch.fetch(url, init);
    var o = {}, k;
    init = init || {};
    for (k in init) if (k !== 'bgMode' && Object.prototype.hasOwnProperty.call(init, k)) o[k] = init[k];
    return window.fetch(url, o);
}
