/*
 * Прямой файл с TorrServer в браузере без Dolby/DTS (wasm-playback.js).
 * Файл читается по Range, libav.js (ffmpeg в WASM, своя сборка wasm-audio/)
 * разбирает контейнер, видео идёт как есть, звук декодируется и кодируется в
 * AAC 2.0 (стерео AAC/MP3/Opus/FLAC с настройкой кодека — как есть), всё
 * собирается во фрагментированный MP4 и уходит странице для MediaSource.
 * Текстовые субтитры (SRT/ASS/WebVTT) — репликами, все дорожки сразу.
 *
 * Сборка libav.js: VPS ~/wasm-build, libav.js v6.11.9.0.2 (ffmpeg 9.0.2),
 * конфиг torrstream (configs/mkconfig.js) — демуксеры matroska/mov/avi,
 * mp4-муксер, декодеры ac3/eac3/dca/truehd/mlp/aac/mp3/mp2/flac/vorbis/alac/
 * pcm*, h264/hevc (нужны демуксеру для DTS при B-кадрах), aac-кодер.
 *
 * Сообщения от страницы:
 *   {type:'open', url, base, audio, time}  — открыть файл (base — где wasm-audio/)
 *   {type:'tick', time}                    — где сейчас плеер
 *   {type:'seek', time, gen}               — перемотка за пределы буфера
 *   {type:'audio', index, time, gen}       — сменить дорожку
 * Страница получает: info, data {gen, bytes, t}, eof {gen}, cues, net, log,
 * error {code: 'ts' | 'net' | …, msg}.
 */
'use strict';
self.LibAV = { nothreads: true };

var LIBAV_JS = 'libav-6.11.9.0.2-torrstream.js';
// Две сборки одного кода: быстрая — с bulk memory (memory.copy/fill,
// Chrome 75+), совместимая — только базовый WebAssembly (Chrome 57–74, в том
// числе VIDAA ниже 9.5: Chrome 68 быструю не открывал — «unexpected section:
// Code»). Скачивается одна — какую браузер поймёт (wasmBulkMemory). Совместимая
// на ПК медленнее примерно на 16 % (tools/wasm-audio/build.js)
var LIBAV_WASM_FAST = 'libav-6.11.9.0.2-torrstream.wasm.wasm';
var LIBAV_WASM_MVP = 'libav-6.11.9.0.2-torrstream.mvp.wasm';
var libFast = true;

/** Понимает ли WebAssembly браузера memory.copy (bulk memory) */
function wasmBulkMemory() {
  // (module (memory 1) (func (memory.copy (i32.const 0) (i32.const 0) (i32.const 0))))
  var bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 3, 1, 0, 1,
    10, 14, 1, 12, 0, 65, 0, 65, 0, 65, 0, 252, 10, 0, 0, 11]);
  try { return WebAssembly.validate(bytes); } catch (e) { return false; }
}
var libName = 'torrstream';

// Запросы Range: после старта и каждой перемотки первый — CHUNK_MIN (быстрый
// старт на холодной раздаче), каждый следующий подряд — вдвое больше, до
// chunkMax (~6 с фильма по среднему битрейту, 2–16 МБ). По 2 МБ на 4K
// (30 Мбит/с) выходило 2–4 запроса в секунду: у TorrServer/MonoServer
// «читатель» то появлялся, то исчезал, и его окно докачки каждый раз
// начиналось заново
var CHUNK_MIN = 2 << 20;
var CHUNK_MAX = 16 << 20;
var chunkMax = CHUNK_MIN;
var cacheBytes = 16 << 20;    // сколько держим прочитанного (перемотка назад рядом)
var AHEAD = 25;               // секунд держим собранными впереди плеера
// Проснувшись, воркер собирает до AHEAD и засыпает, пока запас не станет
// меньше AHEAD − WAKE_GAP: чтение идёт заметными заходами, а не по полсекунды
var WAKE_GAP = 6;
// За один заход демуксера — около полсекунды фильма (по среднему битрейту):
// между заходами воркер замечает перемотку, крупные заходы её тормозили
var READ_LIMIT = 256 * 1024;

var libav, url, size;
var fmt, pkt, streams = [];
var vIdx = -1, aIdx = -1, audioList = [];
var vTb, aTb;
var outCodec = 'flac', copyAudio = false;
var dec = null, enc = null, mux = null;
var gen = 0, playhead = 0, outTime = 0, eof = false;
var pending = null;           // {kind:'seek'|'audio', time, gen, index}
var wake = null, sleeping = false;
var stats = { bytes: 0, requests: 0, workMs: 0, mediaSec: 0, aFrames: 0 };

// ---------- замеры скорости (диагностика: где теряется время) ----------
// Сеть: байты и время, пока идёт хоть один запрос к TorrServer (netBusyMs) —
// реальная скорость TorrServer → браузер. waitMs — сколько разбор файла
// простоял, ожидая кусок. Процессор: разбор (без ожидания), декодирование
// звука, кодирование AAC, сборка MP4. mediaSec — сколько секунд фильма
// собрано. Страница (wasm-playback.js) сводит это с MSE и пишет в консоль.
var perf = { netBytes: 0, netBusyMs: 0, waitMs: 0, readMs: 0, decMs: 0, encMs: 0, muxMs: 0, sleepMs: 0, mediaSec: 0 };
var netActive = 0, netBusyFrom = 0, perfPrev = null, perfAt = 0;
var PERF_MS = 2000;

function netStart() { if (netActive++ === 0) netBusyFrom = performance.now(); }
function netEnd() { if (--netActive === 0) perf.netBusyMs += performance.now() - netBusyFrom; }

/** Раз в PERF_MS — что изменилось за окно (а не с начала: важна текущая картина) */
function reportPerf(force) {
  var now = performance.now();
  if (!force && now - perfAt < PERF_MS) return;
  var cur = {}, k;
  for (k in perf) cur[k] = perf[k];
  if (netActive) cur.netBusyMs += now - netBusyFrom;   // запрос ещё идёт
  var w = { wallMs: perfPrev ? now - perfAt : 0 };
  for (k in cur) w[k] = cur[k] - (perfPrev ? perfPrev[k] : 0);
  perfPrev = cur; perfAt = now;
  if (w.wallMs > 0) postMessage({ type: 'perf', w: w, fast: !!libFast });
}

function log(msg) { postMessage({ type: 'log', msg: String(msg) }); }
function fail(e) { postMessage({ type: 'error', code: (e && e.code) || '', msg: (e && e.message) || String(e), stack: e && e.stack }); }
function codedError(code, msg) { var e = new Error(msg); e.code = code; return e; }

function isMpegTs(b) {
  var test = function (off, step) {
    for (var k = 0; k < 4; k++) if (b[off + k * step] !== 0x47) return false;
    return true;
  };
  return !!b && b.length >= 800 && (test(0, 188) || test(4, 192));
}

onmessage = function (ev) {
  var m = ev.data;
  if (m.type === 'open') open(m).catch(fail);
  else if (m.type === 'tick') { playhead = m.time; poke(); }
  else if (m.type === 'seek') { pending = { kind: 'seek', time: m.time, gen: m.gen }; poke(); }
  else if (m.type === 'audio') { pending = { kind: 'audio', time: m.time, gen: m.gen, index: m.index }; poke(); }
  else if (m.type === 'mem') postMessage({ type: 'mem', mem: memReport() });
};

function poke() { if (wake) { var w = wake; wake = null; w(); } }

/** Сколько памяти держит воркер: кучи WASM и свои буферы, в байтах */
function memReport() {
  var heap = function (m) {
    if (!m) return 0;
    if (m.HEAPU8) return m.HEAPU8.length;
    if (m.wasmMemory) return m.wasmMemory.buffer.byteLength;
    return -1;
  };
  var cached = 0;
  chunks.forEach(function (c) { cached += c.buf.length; });
  return {
    libavHeap: heap(libav),
    eac3Heap: dec && dec.kind === 'eac3' ? heap(dec.d.m) : 0,
    rangeCache: cached,
    muxOut: out.buf.length,
    rechunk: rechunk ? rechunk.planes.reduce(function (s, p) { return s + p.byteLength; }, 0) : 0,
    heldVideo: heldVideo.length,
    requests: stats.requests, bytes: stats.bytes, outTime: outTime, playhead: playhead, sleeping: !!wake,
    keepAlive: stats.keepAlive || 0, chunkMax: chunkMax, chunks: chunks.length
  };
}

// Вызовы libav.js (noworker) завершаются микрозадачами — пока есть работа,
// цикл не отдаёт поток, и сообщения страницы (перемотка, tick) ждут по 1–2 с.
// Раз в заход уступаем событийному циклу (MessageChannel — без задержки 4 мс
// у вложенных setTimeout).
var yieldCh = new MessageChannel(), yieldQ = [];
yieldCh.port1.onmessage = function () { var r = yieldQ.shift(); if (r) r(); };
function yieldTask() { return new Promise(function (r) { yieldQ.push(r); yieldCh.port2.postMessage(0); }); }
function sleep() {
  keepAlive();
  var ts0 = performance.now();
  return new Promise(function (r) { wake = r; setTimeout(poke, 500); }).then(function () { perf.sleepMs += performance.now() - ts0; reportPerf(); });
}

// ---------- удержание раздачи на паузе ----------
// <video src> на паузе держит соединение открытым, и у TorrServer остаётся
// «читатель». Наш воркер читает короткими запросами: на паузе их нет, и через
// TorrentDisconnectTimeout (по умолчанию 30 с) TorrServer закрывает раздачу —
// после паузы она заново ищет пиров. Пока спим, раз в KEEPALIVE_MS просим
// 1 байт с места, откуда читать дальше: таймер сбрасывается, а TorrServer
// заодно знает, какие куски понадобятся.
var KEEPALIVE_MS = 10000;
var lastNetAt = 0, nextPos = 0, keepAliveBusy = false;

function keepAlive() {
  if (keepAliveBusy || !url || !size || Date.now() - lastNetAt < KEEPALIVE_MS) return;
  keepAliveBusy = true;
  lastNetAt = Date.now();
  var pos = Math.min(nextPos, size - 1);
  stats.keepAlive = (stats.keepAlive || 0) + 1;
  fetch(url, reqInit({ Range: 'bytes=' + pos + '-' + pos })).then(function (r) { return r.arrayBuffer(); })
    .catch(function () { }).then(function () { keepAliveBusy = false; });
}

// ---------- заголовки запросов ----------
// Только напрямую к TorrServer/MonoServer — через сервер TorrStream поток не
// ходит (решение пользователя). m.auth — вход TorrServer (Basic) из настроек
var net = { auth: '' };

function reqInit(extra, signal) {
  var h = {}, k;
  if (net.auth) h.Authorization = net.auth;
  for (k in extra) h[k] = extra[k];
  var init = { headers: h };
  if (signal) init.signal = signal;
  return init;
}

// ---------- чтение по Range ----------

// После долгой паузы TorrServer мог выгрузить раздачу, перезапуститься или
// отвечать медленно (снова ищет пиров). Без повторов первая же ошибка
// останавливала воркер, и видео вставало в конце буфера. Повторяем с
// нарастающей паузой около минуты; у каждой попытки свой тайм-аут; повтор
// продолжает кусок с того места, где оборвалось.
var RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000, 15000, 15000];
var ATTEMPT_TIMEOUT = 30000;

// Куски файла: { start, end, buf, got — сколько уже пришло, done, failed,
// waiters — кто ждёт байты, ac — обрыв запроса, prefetch }. Порядок — по
// давности использования (последний — свежий). Разбор получает данные по мере
// прихода, не дожидаясь конца куска: крупный кусок не задерживает старт
var chunks = [];
var lastEnd = -1, lastLen = 0;   // последний запрошенный кусок — для разгона
function noop() { }

function findChunk(pos, touch) {
  for (var i = chunks.length - 1; i >= 0; i--) {
    var c = chunks[i];
    if (pos >= c.start && pos <= c.end) {
      if (touch && i !== chunks.length - 1) { chunks.splice(i, 1); chunks.push(c); }
      return c;
    }
  }
  return null;
}

function newChunk(start, prefetch) {
  var len = start === lastEnd + 1 ? Math.min(chunkMax, Math.max(CHUNK_MIN, lastLen * 2)) : CHUNK_MIN;
  var end = Math.min(start + len, size) - 1;
  // не перекрывать уже прочитанное дальше
  for (var i = 0; i < chunks.length; i++) if (chunks[i].start > start && chunks[i].start <= end) end = chunks[i].start - 1;
  lastEnd = end; lastLen = end - start + 1;
  var c = { start: start, end: end, buf: new Uint8Array(end - start + 1), got: 0, done: false, failed: null,
    waiters: [], ac: null, prefetch: !!prefetch, aborted: false, next: false };
  chunks.push(c);
  trimCache();
  loadChunk(c);
  return c;
}

/** Держим не больше cacheBytes; идущие запросы и два свежих куска не трогаем */
function trimCache() {
  var total = 0, i;
  for (i = 0; i < chunks.length; i++) total += chunks[i].buf.length;
  for (i = 0; total > cacheBytes && i < chunks.length - 2;) {
    var c = chunks[i];
    if (!c.done) { i++; continue; }
    total -= c.buf.length;
    chunks.splice(i, 1);
  }
}

function dropChunk(c) { var i = chunks.indexOf(c); if (i >= 0) chunks.splice(i, 1); }

function notify(c) {
  c.waiters = c.waiters.filter(function (w) {
    if (c.failed) { w.rej(c.failed); return false; }
    if (c.got >= w.need || c.done) { w.res(); return false; }
    return true;
  });
}

/** Дождаться, пока у куска будет need байт с начала (или он кончится) */
function waitChunk(c, need) {
  if (c.got >= need || c.done) return Promise.resolve();
  if (c.failed) return Promise.reject(c.failed);
  return new Promise(function (res, rej) { c.waiters.push({ need: need, res: res, rej: rej }); });
}

/** Положить пришедшие байты; true — кусок полон */
function put(c, v) {
  if (c.aborted) return true;
  var room = c.buf.length - c.got;
  if (v.length > room) v = v.subarray(0, room);
  c.buf.set(v, c.got);
  c.got += v.length;
  stats.bytes += v.length; perf.netBytes += v.length;
  notify(c);
  return c.got >= c.buf.length;
}

function readInto(r, c, onProgress) {
  if (!r.body || typeof r.body.getReader !== 'function') {
    return r.arrayBuffer().then(function (b) { put(c, new Uint8Array(b)); });
  }
  var reader = r.body.getReader();
  function next() {
    return reader.read().then(function (x) {
      if (x.done) return;
      onProgress();
      // 200 на весь файл (сервер без Range) — берём сколько надо и обрываем
      if (put(c, x.value)) { try { reader.cancel(); } catch (e) { } return; }
      return next();
    });
  }
  return next();
}

function loadChunk(c) {
  var attempt = 0;
  function once() {
    if (c.aborted) return;
    var from = c.start + c.got;
    stats.requests++;
    lastNetAt = Date.now(); nextPos = c.end + 1;
    netStart();
    var netDone = false, endNet = function () { if (!netDone) { netDone = true; netEnd(); } };
    // Тайм-аут — на тишину, а не на весь запрос: с середины раздачи TorrServer
    // качает куски медленно (бывало 2 МБ дольше 30 с), и обрыв по общему
    // таймеру начинал запрос заново, хотя данные шли
    var ac = typeof AbortController === 'function' ? new AbortController() : null;
    c.ac = ac;
    var timer = null;
    var arm = function () { clearTimeout(timer); timer = setTimeout(function () { if (ac) ac.abort(); }, ATTEMPT_TIMEOUT); };
    arm();
    var gotBefore = c.got;
    fetch(url, reqInit({ Range: 'bytes=' + from + '-' + c.end }, ac && ac.signal)).then(function (r) {
      if (r.status === 200 && from > 0) throw codedError('net', 'сервер не отдаёт файл по частям (Range)');
      if (r.status !== 206 && r.status !== 200) throw new Error('HTTP ' + r.status);
      return readInto(r, c, arm);
    }).then(function () {
      clearTimeout(timer); endNet();
      if (c.aborted) return;
      if (c.got < c.buf.length) throw new Error(c.got > gotBefore ? 'ответ оборвался' : 'пустой ответ');
      c.done = true; c.ac = null;
      if (attempt) postMessage({ type: 'net', ok: true, attempt: attempt });
      notify(c);
    }, function (e) { clearTimeout(timer); endNet(); throw e; }).catch(function (e) {
      if (c.aborted) return;
      if (c.got > gotBefore) attempt = 0;   // данные шли — счёт попыток заново
      if (attempt >= RETRY_DELAYS.length) { c.failed = e; dropChunk(c); notify(c); return; }
      var delay = RETRY_DELAYS[attempt++];
      postMessage({ type: 'net', ok: false, attempt: attempt, delay: delay, error: (e && e.name === 'AbortError') ? 'тайм-аут' : String(e && e.message || e) });
      setTimeout(once, delay);
    });
  }
  once();
}

/**
 * Перемотка: недокачанные куски никому больше не нужны — обрываем, чтобы не
 * делили скорость с новым местом. Пришедшее оставляем (кусок укорачиваем)
 */
function abortLoads() {
  chunks = chunks.filter(function (c) {
    if (c.done || c.failed || c.waiters.length) return true;
    c.aborted = true;
    if (c.ac) try { c.ac.abort(); } catch (e) { }
    if (!c.got) return false;
    c.buf = c.buf.slice(0, c.got);
    c.end = c.start + c.got - 1;
    c.done = true;
    return true;
  });
  lastEnd = -1;
}

// Чтение — запросами с концом (Range a-b), а не одним длинным соединением на
// весь файл: на VIDAA такое соединение подвешивало воспроизведение
// (проверено пользователем, 2026-11-26)
function onBlockRead(name, pos, len) {
  var c = findChunk(pos, true) || newChunk(pos, false);
  // Следующий кусок — заранее, но когда этот догружен: на холодном старте с
  // середины раздачи они делили скорость, и нужный приходил вдвое позже
  if (!c.next && c.end + 1 < size) {
    c.next = true;
    waitChunk(c, c.buf.length).then(function () {
      if (!c.aborted && !findChunk(c.end + 1, false)) newChunk(c.end + 1, true);
    }, noop);
  }
  var need = Math.min(c.end, pos + Math.max(1, len) - 1) - c.start + 1;
  var tw = c.got >= need || c.done ? 0 : performance.now();
  return waitChunk(c, need).then(function () {
    if (tw) perf.waitMs += performance.now() - tw;
    return libav.ff_block_reader_dev_send(name, pos, c.buf.subarray(pos - c.start, c.got));
  });
}

async function fileSize() {
  var r;
  try {
    r = await fetch(url, reqInit({ Range: 'bytes=0-0' }));
  } catch (e) {
    // TypeError без ответа: CORS или сеть. Старые браузеры (Chrome 68 на VIDAA
    // ниже 9.5) на fetch с Range шлют предзапрос OPTIONS, а TorrServer MatriX
    // Range в нём не разрешает: «Request header field Range is not allowed by
    // Access-Control-Allow-Headers». Свежий Chrome Range не проверяет,
    // MonoServer его разрешает. Обхода без посредника нет — говорим прямо
    var echo = null;
    try { echo = await fetch(url.replace(/\/(stream|play)([/?].*)?$/, '/echo')).then(function (x) { return x.ok ? x.text() : null; }); } catch (e2) { }
    if (echo !== null) throw codedError('cors', 'TorrServer ' + String(echo).trim().slice(0, 40) + ' не разрешает этому браузеру читать файл по частям (заголовок Range в CORS)');
    throw codedError('net', 'TorrServer не отвечает: ' + (e && e.message || e));
  }
  if (r.status === 401 || r.status === 403) throw codedError('net', 'TorrServer: нужен вход (HTTP ' + r.status + ')');
  if (r.status !== 206 && r.status !== 200) throw codedError('net', 'TorrServer: HTTP ' + r.status);
  var cr = r.headers.get('Content-Range');
  // тело не нужно (а на 200 без Range это был бы весь файл)
  try { if (r.body && r.body.cancel) r.body.cancel(); } catch (e) { }
  if (cr && /\/(\d+)$/.test(cr)) return Number(RegExp.$1);
  // Content-Range не выставлен для CORS — пробуем HEAD
  var init = reqInit({});
  init.method = 'HEAD';
  var h = await fetch(url, init);
  var cl = Number(h.headers.get('Content-Length'));
  if (cl > 0) return cl;
  throw new Error('Не узнать размер файла (нет Content-Range/Content-Length)');
}

// ---------- 64-битные метки ----------

var NOPTS_HI = -2147483648;
function ts(p, f) {
  var hi = p[f + 'hi'] || 0, lo = p[f];
  if (lo === undefined || (hi === NOPTS_HI && lo === 0)) return null;
  return hi * 4294967296 + (lo >>> 0);
}
function setTs(p, f, v) {
  var hi = Math.floor(v / 4294967296);
  p[f + 'hi'] = hi;
  p[f] = (v - hi * 4294967296) | 0;
}
// Ко всем меткам прибавляем OFFSET секунд, страница вычитает их через
// SourceBuffer.timestampOffset: так не бывает отрицательных DTS (B-кадры в
// начале файла, «разгон» AAC), а fMP4 их не любит.
var OFFSET = 10;

function rescale(p, from, to, streamIndex) {
  var pts = ts(p, 'pts'), dts = ts(p, 'dts');
  if (pts === null) pts = dts;
  if (dts === null) dts = pts;
  var k = (from[0] * to[1]) / (from[1] * to[0]);
  var off = Math.round(OFFSET * to[1] / to[0]);
  setTs(p, 'pts', Math.round(pts * k) + off);
  setTs(p, 'dts', Math.round(dts * k) + off);
  // libav.js 6.11: пакет с time_base ff_write_multi пересчитал бы второй раз
  delete p.time_base_num; delete p.time_base_den;
  if (p.duration !== undefined) {
    var d = ts(p, 'duration');
    if (d !== null) setTs(p, 'duration', Math.round(d * k));
  }
  p.stream_index = streamIndex;
  return p;
}

// ---------- открытие ----------

var COPY_OK = { aac: 'mp4a.40.2', opus: 'opus', flac: 'flac', mp3: 'mp4a.6B' };
// Звук, который браузер принимает в MSE сам (страница проверила isTypeSupported
// и прислала { кодек ffmpeg: строка кодека MSE }). Сейчас — только VIDAA:
// телевизор декодирует Dolby сам, кодировать в AAC незачем, а кодер AAC —
// почти вся работа воркера. Такой звук идёт как есть, со всеми каналами
var nativeAudio = {};

function hex2(n) { return ('0' + (n & 255).toString(16)).slice(-2).toUpperCase(); }

// ---------- HDR и Dolby Vision ----------
// Как серверный HLS (services/hls.js, doviPlan): HEVC — всегда с тегом hvc1
// (ffmpeg по умолчанию пишет hev1, а строка кодека для MSE была hvc1);
// Dolby Vision: P5 (без базового HDR10) — dvh1 с dvcC и строкой dvh1.05.LL;
// P8 и прочие с совместимым слоем — dvcC только если в настройках выбран
// Dolby Vision, иначе поток идёт как обычный HDR10. mov пишет dvcC/dvvC лишь
// при strict ≤ unofficial — этим и включаем/выключаем
var TAG_HVC1 = 0x31637668, TAG_DVH1 = 0x31687664;   // MKTAG('h','v','c','1'), ('d','v','h','1')
var AV_PKT_DATA_DOVI_CONF = 29;
var dvPreferred = false;
var video = { hdr: 'SDR', dv: null, dvKeep: false, tag: 0, strip: 0 };

/**
 * Dolby Vision выключен (P8 и другие с совместимым слоем): одного отсутствия
 * dvcC/dvvC мало — RPU (NAL 62) и слой улучшения (NAL 63) остаются в пакетах,
 * и телевизор с DV включает Dolby Vision по ним сам (VIDAA U6.12). Как сервер
 * (services/hls.js: dovi_rpu=strip=1) вырезаем их из каждого пакета.
 * Длина префикса NAL — из hvcC (lengthSizeMinusOne); не hvcC — не трогаем
 */
async function hevcNalLength(par) {
  var n = await libav.AVCodecParameters_extradata_size(par);
  if (!(n > 22)) return 0;
  var b = await libav.copyout_u8(await libav.AVCodecParameters_extradata(par), 23);
  if (b[0] !== 1) return 0;
  return (b[21] & 3) + 1;
}

/** Пакет HEVC без NAL 62/63; тот же массив, если вырезать нечего */
function stripDoviNals(data, len) {
  var n = data.length, o = 0, drop = 0, i, size, type;
  while (o + len <= n) {
    size = 0;
    for (i = 0; i < len; i++) size = size * 256 + data[o + i];
    if (o + len + size > n) return data;          // битый пакет — как есть
    type = (data[o + len] >> 1) & 0x3f;
    if (type === 62 || type === 63) drop += len + size;
    o += len + size;
  }
  if (!drop) return data;
  var out = new Uint8Array(n - drop), w = 0;
  o = 0;
  while (o + len <= n) {
    size = 0;
    for (i = 0; i < len; i++) size = size * 256 + data[o + i];
    type = (data[o + len] >> 1) & 0x3f;
    if (type !== 62 && type !== 63) { out.set(data.subarray(o, o + len + size), w); w += len + size; }
    o += len + size;
  }
  return out;
}

/** AVDOVIDecoderConfigurationRecord из параметров кодека или null */
async function doviConf(par) {
  var n = await libav.AVCodecParameters_nb_coded_side_data(par);
  if (!(n > 0)) return null;
  var sd = await libav.AVCodecParameters_coded_side_data(par);
  for (var i = 0; i < n; i++) {
    if ((await libav.AVPacketSideData_type(sd, i)) !== AV_PKT_DATA_DOVI_CONF) continue;
    var size = await libav.AVPacketSideData_size(sd, i);
    if (size < 8) return null;
    var b = await libav.copyout_u8(await libav.AVPacketSideData_data(sd, i), 8);
    // dv_version_major, minor, dv_profile, dv_level, rpu, el, bl, dv_bl_signal_compatibility_id
    return { profile: b[2], level: b[3], compat: b[7] };
  }
  return null;
}

async function inspectVideo() {
  var s = streams[vIdx], par = s.codecpar;
  var trc = await libav.AVCodecParameters_color_trc(par);
  video = { hdr: trc === 16 ? 'PQ' : trc === 18 ? 'HLG' : 'SDR', dv: null, dvKeep: false, tag: 0, strip: 0 };
  if (s.name !== 'hevc') return;
  video.tag = TAG_HVC1;
  try { video.dv = await doviConf(par); } catch (e) { log('Dolby Vision: ' + e.message); }
  if (!video.dv) return;
  if (video.dv.compat === 0) {
    // P5: базового HDR10 нет — без DV картинка с неверными цветами
    video.tag = TAG_DVH1; video.dvKeep = true;
    if (video.hdr === 'SDR') video.hdr = 'PQ';
  } else if (dvPreferred && [1, 2, 4].indexOf(video.dv.compat) >= 0) video.dvKeep = true;
  if (!video.dvKeep) {
    try { video.strip = await hevcNalLength(par); } catch (e) { log('hvcC: ' + e.message); }
  }
  log('Dolby Vision P' + video.dv.profile + '.' + video.dv.compat + ' L' + video.dv.level + (video.dvKeep ? ' — как Dolby Vision' : ' — как HDR10 (Dolby Vision выключен в настройках' + (video.strip ? ', RPU вырезаются' : '') + ')'));
}

function pad2(n) { return ('0' + n).slice(-2); }

async function videoCodecString(par, name) {
  var profile = await libav.AVCodecParameters_profile(par);
  var level = await libav.AVCodecParameters_level(par);
  if (name === 'h264') return 'avc1.' + hex2(profile > 0 ? profile : 100) + '00' + hex2(level > 0 ? level : 40);
  if (name === 'hevc' && video.tag === TAG_DVH1) return 'dvh1.' + pad2(video.dv.profile) + '.' + pad2(video.dv.level || 6);
  if (name === 'hevc') return 'hvc1.' + (profile > 0 ? profile : 1) + '.' + (profile === 2 ? '4' : '6') + '.L' + (level > 0 ? level : 120) + '.B0';
  if (name === 'av1') return 'av01.0.08M.08';
  if (name === 'vp9') return 'vp09.00.40.08';
  throw new Error('Видео ' + name + ' в MSE не положить');
}

async function open(m) {
  url = m.url;
  // Цель перекодирования: AAC 2.0 (по умолчанию) или AC3 (Dolby Digital) со
  // всеми каналами до 5.1 — на Tizen, где телевизор AC3 декодирует сам или
  // отдаёт саундбару (настройка «Преобразовать DTS в Dolby Digital»)
  outCodec = m.encode === 'ac3' ? 'ac3' : 'aac';
  net = { auth: m.auth || '' };
  dvPreferred = !!m.dv;
  jsMuxOff = !!m.libavMux;
  nativeAudio = m.native || {};
  // Сборка libav.js лежит не рядом с воркером (он идёт через маршрут сервера
  // или Blob): адрес папки wasm-audio/ присылает страница — зеркало или
  // локальный public/ при ?local=1
  var base = String(m.base || '').replace(/\/+$/, '');
  var tl = performance.now();
  importScripts(base + '/' + LIBAV_JS);
  // без base/wasmurl сборка ищет .wasm.js и .wasm рядом с воркером
  // m.mvp — отладка (?wasm=mvp у страницы): путь старых браузеров на ПК
  var fast = !m.mvp && wasmBulkMemory();
  libFast = fast;
  libav = await LibAV.LibAV({ noworker: true, nothreads: true, base: base, wasmurl: base + '/' + (fast ? LIBAV_WASM_FAST : LIBAV_WASM_MVP) });
  log('libav.js ' + LibAV.VER + (fast ? '' : ' (совместимая сборка)') + ', загрузка ' + Math.round(performance.now() - tl) + ' мс');
  libav.onblockread = onBlockRead;
  libav.onwrite = onWrite;
  size = await fileSize();
  // MPEG-TS (.ts, .m2ts) не поддерживаем: у libav.js в нём раздувается куча
  // (сотни МБ) и после перемотки пропадает звук. Узнаём по синхробайту 0x47
  // каждые 188 байт (у M2TS — 192, со сдвигом 4) — по имени файла не всегда
  var head = newChunk(0, false);
  await waitChunk(head, Math.min(1024, size));
  if (isMpegTs(head.buf.subarray(0, head.got))) throw codedError('ts', 'MPEG-TS не поддерживается');
  await libav.mkblockreaderdev('in', size);
  var t0 = performance.now();
  var r = await libav.ff_init_demuxer_file('in');
  fmt = r[0]; streams = r[1];
  pkt = await libav.av_packet_alloc();

  var duration = 0, list = [];
  for (var i = 0; i < streams.length; i++) {
    var s = streams[i];
    s.name = await libav.avcodec_get_name(s.codec_id);
    var d = (await libav.AVStream_duration(s.ptr)) + (await libav.AVStream_durationhi(s.ptr)) * 4294967296;
    if (d > 0 && d < 1e15) duration = Math.max(duration, d * s.time_base_num / s.time_base_den);
    if (s.codec_type === libav.AVMEDIA_TYPE_VIDEO && vIdx < 0 && !/^(mjpeg|png|bmp|gif)$/.test(s.name)) vIdx = i;
    if (s.codec_type === libav.AVMEDIA_TYPE_AUDIO) {
      audioList.push(i);
      s.channels = libav.AVCodecParameters_channels ? await libav.AVCodecParameters_channels(s.codecpar) : 0;
    }
    list.push({ index: i, type: s.codec_type === libav.AVMEDIA_TYPE_VIDEO ? 'video' : s.codec_type === libav.AVMEDIA_TYPE_AUDIO ? 'audio' : s.codec_type === libav.AVMEDIA_TYPE_SUBTITLE ? 'subtitle' : 'other', codec: s.name, channels: s.channels || 0, text: !!TEXT_SUBS[s.name] });
  }
  if (vIdx < 0) throw new Error('В файле нет видео');
  // ненужные потоки демуксер может не разбирать
  aIdx = audioList[Math.min(m.audio || 0, audioList.length - 1)];
  await applyDiscard();
  vTb = [streams[vIdx].time_base_num, streams[vIdx].time_base_den];
  var fn = 0, fd = 0;
  if (libav.AVStream_avg_frame_rate_num) {   // 6.0
    fn = await libav.AVStream_avg_frame_rate_num(streams[vIdx].ptr); fd = await libav.AVStream_avg_frame_rate_den(streams[vIdx].ptr);
    if (!(fn > 0 && fd > 0)) { fn = await libav.AVStream_r_frame_rate_num(streams[vIdx].ptr); fd = await libav.AVStream_r_frame_rate_den(streams[vIdx].ptr); }
  } else if (libav.AVCodecParameters_framerate_num) {   // 6.11: частота — в параметрах кодека
    fn = await libav.AVCodecParameters_framerate_num(streams[vIdx].codecpar); fd = await libav.AVCodecParameters_framerate_den(streams[vIdx].codecpar);
  }
  if (fn > 0 && fd > 0) streams[vIdx].fps = fn / fd;
  if (!duration && libav.AVFormatContext_duration) {
    // 6.11: длительность файла целиком (в мкс) — без перемотки в конец
    var fdur = (await libav.AVFormatContext_duration(fmt)) +
      (libav.AVFormatContext_durationhi ? await libav.AVFormatContext_durationhi(fmt) : 0) * 4294967296;
    if (fdur > 0 && fdur < 1e15) duration = fdur / 1e6;
  }
  if (!duration) duration = await probeDuration();
  if (duration > 0) {
    var bps = size / duration;
    READ_LIMIT = Math.max(64 * 1024, Math.min(4 << 20, Math.round(bps * 0.5)));
    // запас впереди — не больше ~80 МБ: у Chrome лимит MSE на видео около
    // 150 МБ, а 25 с ремукса на 80 Мбит/с — это 250 МБ
    // m.maxAhead — меньше на iPhone (ManagedMediaSource, памяти меньше)
    AHEAD = Math.max(6, Math.min(25, (m.maxAhead > 0 ? m.maxAhead : 80e6) / bps));
    WAKE_GAP = Math.min(6, AHEAD / 3);
    // запрос — около 6 с фильма; кэш — два таких и ещё немного
    chunkMax = Math.max(CHUNK_MIN, Math.min(CHUNK_MAX, Math.round(bps * 6)));
    cacheBytes = Math.max(16 << 20, 2 * chunkMax + CHUNK_MIN);
  }
  await inspectVideo();
  var vCodec = await videoCodecString(streams[vIdx].codecpar, streams[vIdx].name);
  await setupAudio();
  postMessage({
    type: 'info', duration: duration, size: size, streams: list,
    audioTracks: audioList.map(function (i) { return { index: i, codec: streams[i].name, channels: streams[i].channels }; }),
    audio: audioList.indexOf(aIdx), vCodec: vCodec, aCodec: aCodecString(), offset: OFFSET,
    hdr: video.hdr, dv: video.dv ? { profile: video.dv.profile, level: video.dv.level, compat: video.dv.compat, kept: video.dvKeep } : null,
    chunkMax: chunkMax,
    openMs: Math.round(performance.now() - t0)
  });
  pending = { kind: 'seek', time: m.time || 0, gen: 0, first: true };
  run().catch(fail);
}

/**
 * В MKV длительность часто есть только у файла целиком, а её в этой сборке
 * не достать — перематываемся в конец и смотрим метки последних кадров
 * (одно-два чтения Range хвоста файла). В плеере длительность и так известна.
 */
async function probeDuration() {
  var ret = await libav.avformat_seek_file_max(fmt, vIdx, 0x7fffffff, 0, 0);
  if (ret < 0) return 0;
  var max = 0;
  for (var n = 0; n < 4; n++) {
    var r = await libav.ff_read_frame_multi(fmt, pkt, { limit: 256 * 1024, unify: true });
    (r[1][0] || []).forEach(function (p) {
      var s = streams[p.stream_index], t = ts(p, 'pts');
      if (s && t !== null) max = Math.max(max, t * s.time_base_num / s.time_base_den);
    });
    if (r[0] === libav.AVERROR_EOF) break;
  }
  return max;
}

async function applyDiscard() {
  for (var i = 0; i < streams.length; i++) {
    // AVDISCARD_ALL = 48, AVDISCARD_DEFAULT = 0. Текстовые субтитры читаем
    // все сразу — они крошечные, а переключение тогда без перечитывания
    var keep = i === vIdx || i === aIdx || TEXT_SUBS[streams[i].name];
    await libav.AVStream_discard_s(streams[i].ptr, keep ? 0 : 48);
  }
}

// ---------- субтитры ----------
// Текстовые дорожки: пакет = одна реплика. Картинки (PGS, VobSub) — пока нет.
var TEXT_SUBS = { subrip: 1, srt: 1, ass: 1, ssa: 1, webvtt: 1, mov_text: 1, text: 1 };
var utf8 = new TextDecoder('utf-8');

function cueText(name, data) {
  var s;
  if (name === 'mov_text') {
    // tx3g: 2 байта длины, потом текст (дальше — стили, их не берём)
    var n = (data[0] << 8) | data[1];
    s = utf8.decode(data.subarray(2, 2 + n));
  } else s = utf8.decode(data);
  if (name === 'ass' || name === 'ssa') {
    // в MKV: ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text
    var parts = s.split(',');
    if (parts.length >= 9) s = parts.slice(8).join(',');
    if (/\{[^}]*\\p[1-9]/.test(s)) return '';          // векторный рисунок
    // курсив и жирный — в теги VTTCue, прочие override-теги ({\c…}, {\pos…}) убираем
    s = s.replace(/\{([^}]*)\}/g, function (m, body) {
      var out = '';
      body.replace(/\\([ib])([01])(?![0-9])/g, function (x, tag, on) { out += on === '1' ? '<' + tag + '>' : '</' + tag + '>'; return x; });
      return out;
    }).replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ');
  }
  // VTTCue понимает <i>, <b>, <u>; остальное (<font …>) убираем
  s = s.replace(/<(?!\/?[ibu]>)[^>]*>/gi, '').replace(/\r/g, '').trim();
  return s;
}

/** Реплики из пакетов субтитров: [{s: поток, a: начало c, b: конец c, t: текст}] */
function subCues(list) {
  var cues = [];
  for (var i = 0; i < list.length; i++) {
    var p = list[i], st = streams[p.stream_index];
    if (!st || !TEXT_SUBS[st.name]) continue;
    var pts = ts(p, 'pts');
    if (pts === null) continue;
    var k = st.time_base_num / st.time_base_den;
    var d = ts(p, 'duration');
    var text = cueText(st.name, p.data);
    if (!text) continue;
    cues.push({ s: p.stream_index, a: pts * k, b: (pts + (d > 0 ? d : Math.round(4 / k))) * k, t: text });
  }
  return cues;
}

function aCodecString() {
  if (aIdx === undefined || aIdx < 0) return null;
  if (copyAudio) return nativeAudio[streams[aIdx].name] || COPY_OK[streams[aIdx].name] || (outCodec === 'ac3' && streams[aIdx].name === 'ac3' ? 'ac-3' : undefined);
  return { flac: 'flac', aac: 'mp4a.40.2', ac3: 'ac-3', opus: 'opus' }[outCodec];
}

// ---------- звук: декодер + кодер ----------

async function setupAudio() {
  if (dec) {
    if (dec.kind === 'eac3') dec.d.free();
    else await libav.ff_free_decoder(dec.c, dec.pkt, dec.frame);
    dec = null;
  }
  if (enc) { await libav.ff_free_encoder(enc.c, enc.frame, enc.pkt); enc = null; }
  if (aIdx === undefined || aIdx < 0) return;
  var s = streams[aIdx];
  // Как есть — только то, что уже стерео и с настройкой кодека (extradata):
  // цель — AAC 2.0, а у AAC из TS (ADTS) настройки нет — mov пишет moov с
  // пустым esds, и Chrome не может разобрать поток. Остальное перекодируем.
  copyAudio = false;
  // Цель AC3: строка кодека в MSE (ac-3) не должна меняться при смене
  // дорожки — SourceBuffer заведён под неё. Поэтому как есть только сам AC3,
  // остальное (AAC, E-AC3, DTS…) — в AC3
  if (outCodec === 'ac3') copyAudio = s.name === 'ac3';
  else if (nativeAudio[s.name] && s.name !== 'aac') copyAudio = true;
  else if (COPY_OK[s.name] || nativeAudio[s.name]) {
    var ch = libav.AVCodecParameters_ch_layout_nb_channels ? await libav.AVCodecParameters_ch_layout_nb_channels(s.codecpar)
      : (libav.AVCodecParameters_channels ? await libav.AVCodecParameters_channels(s.codecpar) : 0);
    var ex = await libav.AVCodecParameters_extradata_size(s.codecpar);
    // AAC без настройки кодека (ADTS из TS) — только перекодировать
    copyAudio = (ch > 0 && ch <= 2 || !!nativeAudio[s.name]) && (s.name === 'mp3' || ex >= 2);
  }
  aTb = [s.time_base_num, s.time_base_den];
  if (copyAudio) { log('звук ' + s.name + ' — как есть, без перекодирования'); return; }
  try {
    var r = await libav.ff_init_decoder(s.codec_id, s.codecpar);   // [codec, c, pkt, frame]
    dec = { kind: 'libav', c: r[1], pkt: r[2], frame: r[3] };
  } catch (e) {
    throw codedError('codec', 'Звук ' + s.name + ' не поддерживается');
  }
  // DTS-HD MA/HRA: только ядро DTS (до 5.1, 1,5 Мбит/с) — без lossless-слоя
  // XLL, который и есть основная работа декодера. Звук всё равно уходит в
  // AAC/AC3 с потерями, а у Blu-ray ядро обязательно. Нет ядра (не дождались
  // кадров) — decodePackets выключит это обратно
  if (s.name === 'dts' || s.name === 'dca') {
    try { await libav.av_opt_set(dec.c, 'core_only', '1', 1 /* AV_OPT_SEARCH_CHILDREN */); dec.coreOnly = true; dec.coreMiss = 0; } catch (e) { }
  }
  log('декодер ' + s.name + (dec.coreOnly ? ' (только ядро DTS)' : ''));
  enc = null;   // кодер — по первому кадру, когда известны частота и каналы
  rechunk = null;
}

/** Пакеты звука → кадры { data: Float32Array[] | …, nb_samples, channels, … } */
async function decodePackets(aIn) {
  if (dec.kind === 'eac3') {
    var frames = [];
    for (var i = 0; i < aIn.length; i++) {
      var r = dec.d.decode(aIn[i].data);
      if (!r.channelData.length) { dec.skipped = (dec.skipped || 0) + 1; continue; }
      frames.push({ data: r.channelData, nb_samples: r.channelData[0].length, channels: r.channelData.length,
        channel_layout: LAYOUTS[r.channelData.length], sample_rate: r.sampleRate, format: libav.AV_SAMPLE_FMT_FLTP,
        srcPts: ts(aIn[i], 'pts') });   // метка пакета, из которого кадр
    }
    return frames;
  }
  var decoded = await libav.ff_decode_multi(dec.c, dec.pkt, dec.frame, aIn, { ignoreErrors: true });
  if (dec.coreOnly) {
    if (decoded.length) dec.coreOnly = false;   // ядро есть — дальше не проверяем
    else if ((dec.coreMiss += aIn.length) > 60) {
      dec.coreOnly = false;
      log('у DTS нет ядра — декодирую целиком');
      try { await libav.av_opt_set(dec.c, 'core_only', '0', 1); } catch (e) { }
    }
  }
  return decoded;
}

var LAYOUTS = { 1: 0x4, 2: 0x3, 3: 0x7, 4: 0x33, 5: 0x37, 6: 0x60F, 7: 0x70F, 8: 0x63F };

async function setupEncoder(fr) {
  var inChannels = fr.channels || (Array.isArray(fr.data) && fr.data.length) || 2;
  var inLayout = fr.channel_layout || LAYOUTS[inChannels] || 0x3;
  // AAC — всегда стерео: многоканальное сводим сами (downmixMatrix).
  // AC3 — каналы как есть, если такую раскладку он знает (до 5.1), иначе
  // (7.1, 6.1, редкие маски) сводим в 5.1 (ac3Matrix)
  var channels = outCodec === 'aac' ? 2 : inChannels;
  var layout = outCodec === 'aac' ? 0x3 : inLayout;
  var mix = null;
  if (outCodec === 'aac') mix = channels === inChannels ? null : downmixMatrix(inLayout, inChannels);
  else if (outCodec === 'ac3' && !AC3_LAYOUTS[inLayout]) {
    layout = inLayout & 0x8 ? 0x60F : 0x607;
    channels = layout === 0x60F ? 6 : 5;
    mix = ac3Matrix(inLayout, inChannels, layout);
  }
  var sr = fr.sample_rate;
  var opts = {
    ctx: { sample_rate: sr, channels: channels, channel_layout: layout },
    time_base: [1, sr]
  };
  var name = outCodec, sfmt;
  if (name === 'flac') { sfmt = libav.AV_SAMPLE_FMT_S16; opts.options = { compression_level: '0' }; }
  else if (name === 'aac') {
    sfmt = libav.AV_SAMPLE_FMT_FLTP; opts.ctx.bit_rate = channels > 2 ? 384000 : 192000;
    // Кодер AAC — 85–90 % всей работы воркера (замер wasm-playback.js:
    // «кодер AAC 89 %»). По умолчанию у ffmpeg медленный twoloop; fast в разы
    // быстрее, для стерео 192 кбит/с на слух то же. На ТВ (VIDAA, Chrome 59–68)
    // именно он не успевал за 4K: буфер рос вдвое медленнее, чем шло видео
    opts.options = { aac_coder: 'fast' };
  }
  else if (name === 'ac3') { sfmt = libav.AV_SAMPLE_FMT_FLTP; opts.ctx.bit_rate = channels > 2 ? 640000 : 192000; }
  else if (name === 'opus') { name = 'libopus'; sfmt = libav.AV_SAMPLE_FMT_FLT; opts.ctx.bit_rate = channels > 2 ? 384000 : 160000; }
  opts.ctx.sample_fmt = sfmt;
  var r = await libav.ff_init_encoder(name, opts);
  enc = { c: r[1], frame: r[2], pkt: r[3], frameSize: r[4] || 4608, fmt: sfmt, channels: channels, layout: layout, sr: sr,
    inChannels: inChannels, mix: mix };
  log('кодер ' + outCodec + ': ' + inChannels + ' → ' + channels + ' кан., ' + sr + ' Гц, кадр ' + enc.frameSize);
}

/**
 * Коэффициенты сведения в стерео по маске каналов (порядок плоскостей —
 * порядок битов маски, как отдаёт ffmpeg). Центр и тылы −3 дБ, LFE не берём;
 * всё делим на 1 + 0.707, чтобы 5.1 не клиповал на громких местах.
 */
function downmixMatrix(layout, n) {
  var bits = [];
  for (var b = 0; b < 32 && bits.length < n; b++) if (layout & (1 << b)) bits.push(1 << b);
  while (bits.length < n) bits.push(0);
  var K = 0.7071, norm = n > 2 ? 1 / (1 + K) : 1;
  var L = { 0x1: 1, 0x4: K, 0x10: K, 0x200: K, 0x40: K, 0x100: 0.5 * K };
  var R = { 0x2: 1, 0x4: K, 0x20: K, 0x400: K, 0x80: K, 0x100: 0.5 * K };
  if (n === 1) return [[1], [1]];
  return [bits.map(function (x) { return (L[x] || 0) * norm; }), bits.map(function (x) { return (R[x] || 0) * norm; })];
}

// Раскладки, которые кодер AC3 берёт как есть (ff_ac3_ch_layouts), с LFE и без
var AC3_LAYOUTS = {};
[0x4, 0x3, 0x103, 0x7, 0x603, 0x33, 0x107, 0x607, 0x37].forEach(function (m) { AC3_LAYOUTS[m] = 1; AC3_LAYOUTS[m | 0x8] = 1; });

/**
 * Сведение в 5.1/5.0 (боковые тылы) для AC3: тылы и боковые — в боковые,
 * задний центр — поровну в обе боковые, центры слева/справа — во фронт.
 * Где сходятся несколько каналов — делим на √k (мощность сохраняется)
 */
function ac3Matrix(inLayout, n, outLayout) {
  var bits = [];
  for (var b = 0; b < 32 && bits.length < n; b++) if (inLayout & (1 << b)) bits.push(1 << b);
  while (bits.length < n) bits.push(0);
  var outs = [];
  for (var ob = 0; ob < 32; ob++) if (outLayout & (1 << ob)) outs.push(1 << ob);
  var route = { 0x1: [0x1], 0x2: [0x2], 0x4: [0x4], 0x8: [0x8], 0x200: [0x200], 0x400: [0x400],
    0x10: [0x200], 0x20: [0x400], 0x100: [0x200, 0x400], 0x40: [0x1], 0x80: [0x2] };
  var rows = outs.map(function () { return bits.map(function () { return 0; }); });
  bits.forEach(function (bit, c) {
    var to = route[bit] || [];
    to.forEach(function (o) {
      var r = outs.indexOf(o);
      if (r >= 0) rows[r][c] = to.length > 1 ? 0.7071 : 1;
    });
  });
  rows.forEach(function (row) {
    var k = row.filter(function (x) { return x > 0; }).length;
    if (k > 1) for (var i = 0; i < row.length; i++) row[i] /= Math.sqrt(k);
  });
  return rows;
}

function downmix(planes) {
  if (!enc.mix) return planes;
  var n = planes[0].length, out = enc.mix.map(function () { return new Float32Array(n); });
  for (var o = 0; o < enc.mix.length; o++) {
    var row = enc.mix[o], dst = out[o];
    for (var c = 0; c < planes.length; c++) {
      var k = row[c]; if (!k) continue;
      var src = planes[c];
      for (var i = 0; i < n; i++) dst[i] += src[i] * k;
    }
  }
  return out;
}

// Перекладка декодированных кадров (обычно FLTP) в формат кодера и нарезка
// ровно по frame_size кодера (у AC3 1536 сэмплов, у FLAC — 4608 и т. п.)
var rechunk = null;   // { planes: Float32Array[] (накопленное), len, nextPts }

function pushFrames(frames, firstPts) {
  var out = [];
  for (var i = 0; i < frames.length; i++) {
    var fr = frames[i], ch = enc.inChannels, n = fr.nb_samples, planes = [];
    if (Array.isArray(fr.data)) {
      for (var c = 0; c < ch; c++) planes.push(toFloat(fr.data[c] || fr.data[0], fr.format));
    } else {
      // упакованный формат — разложить по каналам
      for (var c2 = 0; c2 < ch; c2++) planes.push(new Float32Array(n));
      var src = toFloat(fr.data, fr.format);
      for (var k = 0; k < n; k++) for (var c3 = 0; c3 < ch; c3++) planes[c3][k] = src[k * ch + c3];
    }
    planes = downmix(planes);
    if (!rechunk) rechunk = { planes: planes.map(function () { return new Float32Array(0); }), nextPts: firstPts };
    for (var p = 0; p < planes.length; p++) {
      var a = rechunk.planes[p], b = planes[p], j = new Float32Array(a.length + b.length);
      j.set(a); j.set(b, a.length); rechunk.planes[p] = j;
    }
    var fs = enc.frameSize;
    while (rechunk.planes[0].length >= fs) {
      out.push(makeFrame(rechunk.planes.map(function (pl) { return pl.subarray(0, fs); }), rechunk.nextPts));
      rechunk.planes = rechunk.planes.map(function (pl) { return pl.slice(fs); });
      rechunk.nextPts += fs;
    }
  }
  return out;
}

function toFloat(d, format) {
  if (d instanceof Float32Array) return d;
  if (d instanceof Int16Array) { var f = new Float32Array(d.length); for (var i = 0; i < d.length; i++) f[i] = d[i] / 32768; return f; }
  if (d instanceof Int32Array) { var g = new Float32Array(d.length); for (var j = 0; j < d.length; j++) g[j] = d[j] / 2147483648; return g; }
  return new Float32Array(d);
}

function makeFrame(planes, pts) {
  var ch = planes.length, n = planes[0].length, data;
  if (enc.fmt === libav.AV_SAMPLE_FMT_S16) {
    data = new Int16Array(n * ch);
    for (var k = 0; k < n; k++) for (var c = 0; c < ch; c++) {
      var v = planes[c][k]; v = v > 1 ? 1 : v < -1 ? -1 : v;
      data[k * ch + c] = Math.round(v * 32767);
    }
  } else if (enc.fmt === libav.AV_SAMPLE_FMT_FLT) {
    data = new Float32Array(n * ch);
    for (var k2 = 0; k2 < n; k2++) for (var c2 = 0; c2 < ch; c2++) data[k2 * ch + c2] = planes[c2][k2];
  } else {
    data = planes.map(function (pl) { return new Float32Array(pl); });   // FLTP
  }
  var fr = { data: data, channel_layout: enc.layout, channels: ch, format: enc.fmt, sample_rate: enc.sr, pts: 0, ptshi: 0 };
  setTs(fr, 'pts', pts);
  return fr;
}

// ---------- мультиплексор fMP4 ----------

// Выход мультиплексора — как файл: mov пишет заголовок moof с размером 0
// и потом возвращается дописать размер (pos у onwrite). Поэтому кладём байты
// по позиции, а странице отдаём только целиком дописанные боксы верхнего
// уровня. (Просто дописывать в конец нельзя: на настоящих 1080p-фрагментах
// поправка размера уезжала в конец, и Chrome падал «stream parsing failed».)
var out = { base: 0, buf: new Uint8Array(1 << 20), len: 0 };

function onWrite(name, pos, buf) {
  if (!mux || name !== mux.name) return;
  var at = pos - out.base;
  if (at < 0) { log('мультиплексор правит уже отданные байты @' + pos + ' — поток испорчен'); return; }
  var need = at + buf.length;
  if (need > out.buf.length) {
    var nb = new Uint8Array(Math.max(need, out.buf.length * 2));
    nb.set(out.buf.subarray(0, out.len));
    out.buf = nb;
  }
  out.buf.set(buf, at);
  if (need > out.len) out.len = need;
}

/** Сколько байт с начала — целые боксы верхнего уровня с проставленным размером */
function completeBoxes() {
  var b = out.buf, off = 0;
  while (off + 8 <= out.len) {
    var size = ((b[off] << 24) >>> 0) + (b[off + 1] << 16) + (b[off + 2] << 8) + b[off + 3];
    if (size === 1) {
      if (off + 16 > out.len) break;
      size = (((b[off + 8] << 24) >>> 0) + (b[off + 9] << 16) + (b[off + 10] << 8) + b[off + 11]) * 4294967296 +
        ((b[off + 12] << 24) >>> 0) + (b[off + 13] << 16) + (b[off + 14] << 8) + b[off + 15];
    }
    if (size < 8 || off + size > out.len) break;   // 0 — ещё не дописан
    off += size;
  }
  return off;
}

/** Типы целых боксов верхнего уровня, что уже лежат в выходе libav */
function topBoxes() {
  var b = out.buf, off = 0, types = [];
  while (off + 8 <= out.len) {
    var size = ((b[off] << 24) >>> 0) + (b[off + 1] << 16) + (b[off + 2] << 8) + b[off + 3];
    if (size < 8 || off + size > out.len) break;
    types.push(String.fromCharCode(b[off + 4], b[off + 5], b[off + 6], b[off + 7]));
    off += size;
  }
  return types;
}

function resetOut() { out = { base: 0, buf: new Uint8Array(1 << 20), len: 0 }; }

async function openMuxer(g, strictFallback, firstA) {
  var cfg = [];
  var vpar = await libav.avcodec_parameters_alloc();
  await libav.avcodec_parameters_copy(vpar, streams[vIdx].codecpar);
  await libav.AVCodecParameters_codec_tag_s(vpar, video.tag);
  cfg.push([vpar, vTb[0], vTb[1]]);
  var apar = 0;
  if (aIdx >= 0 && (copyAudio || enc)) {
    apar = await libav.avcodec_parameters_alloc();
    if (copyAudio) {
      await libav.avcodec_parameters_copy(apar, streams[aIdx].codecpar);
      await libav.AVCodecParameters_codec_tag_s(apar, 0);
      cfg.push([apar, aTb[0], aTb[1]]);
    } else {
      await libav.avcodec_parameters_from_context(apar, enc.c);
      cfg.push([apar, 1, enc.sr]);
    }
  }
  var name = 'out' + g + '.mp4';
  var r = await libav.ff_init_muxer({ format_name: 'mp4', filename: name, device: true, open: true, codecpars: true }, cfg);
  var oc = r[0], pb = r[2];
  // ff_init_muxer обнуляет codec_tag у потоков — тег hvc1/dvh1 ставим после
  if (video.tag) {
    var vst = await libav.AVFormatContext_streams_a(oc, 0);
    await libav.AVCodecParameters_codec_tag_s(await libav.AVStream_codecpar(vst), video.tag);
  }
  // свои метки сохраняем как есть (иначе после перемотки всё съедет к нулю)
  await libav.av_opt_set(oc, 'avoid_negative_ts', 'disabled', 0);
  lastVDts = null;
  // dvcC/dvvC mov пишет только при strict ≤ unofficial (см. inspectVideo).
  // Не принял заголовок на normal — повтор с experimental, как было до 1.0.69
  await libav.av_opt_set(oc, 'strict', strictFallback ? 'experimental' : video.dvKeep ? 'unofficial' : 'normal', 0);
  // frag_discont + use_editlist=0: tfdt первого фрагмента = DTS первого
  // пакета (как у сегментатора HLS в ffmpeg). Без этого mov сдвигает начало
  // каждой дорожки к нулю — рассинхрон и время «с нуля» после перемотки.
  // AC3/EAC3 как есть: настройку кодека (dac3/dec3) mov берёт из первого
  // пакета — moov пишем вместе с первым фрагментом (delay_moov), иначе
  // «Cannot write moov atom before AC3 packets»
  // AC3 из своего кодера — так же (extradata mov для AC3 не читает), но moov
  // выталкиваем сразу первым пакетом звука (firstA, см. ниже)
  var ac3Enc = !copyAudio && !!enc && outCodec === 'ac3';
  var delay = (copyAudio && aIdx >= 0 && /^e?ac3$/.test(streams[aIdx].name)) || ac3Enc ? '+delay_moov' : '';
  await libav.av_opt_set(oc, 'movflags', 'frag_keyframe+empty_moov+default_base_moof+frag_discont' + delay, 1 /* AV_OPT_SEARCH_CHILDREN */);
  await libav.av_opt_set(oc, 'use_editlist', '0', 1);
  // фрагмент не длиннее секунды (иначе ждём ключевой кадр, а GOP бывает 5–10 с)
  await libav.av_opt_set(oc, 'frag_duration', '1000000', 1);
  resetOut();
  mux = { oc: oc, pb: pb, name: name, pkt: await libav.av_packet_alloc(), gen: g, pars: [vpar, apar] };
  var ret = await libav.avformat_write_header(oc, 0);
  if (ret < 0 && !strictFallback) {
    log('avformat_write_header: ' + ret + ' — повтор со strict experimental');
    await closeMuxer();
    for (var k = 0; k < cfg.length; k++) try { await libav.avcodec_parameters_free_js(cfg[k][0]); } catch (e) { }
    return openMuxer(g, true, firstA);
  }
  if (ret < 0) throw new Error('avformat_write_header: ' + ret);
  // метки дальше переводим сами — в time_base, который выбрал мультиплексор
  mux.vTbOut = [await libav.AVStream_time_base_num(await libav.AVFormatContext_streams_a(oc, 0)), await libav.AVStream_time_base_den(await libav.AVFormatContext_streams_a(oc, 0))];
  if (cfg.length > 1) mux.aTbOut = [await libav.AVStream_time_base_num(await libav.AVFormatContext_streams_a(oc, 1)), await libav.AVStream_time_base_den(await libav.AVFormatContext_streams_a(oc, 1))];
  // AC3 из своего кодера: один пакет звука (копия — у самого пакета метки
  // не трогаем, он пойдёт в первый фрагмент) и сброс av_write_frame(NULL) —
  // mov с delay_moov пишет ftyp+moov с dac3 и выходит, не начиная фрагмент.
  // Пакет остаётся в libav и пропадает вместе с ним, а фрагменты дальше
  // собирает jsWrite — тот же быстрый путь, что у AAC
  var primed = false;
  if (ac3Enc && firstA && !jsMuxOff && mux.aTbOut) {
    var p0 = rescale(Object.assign({}, firstA), [1, enc.sr], mux.aTbOut, 1);
    await libav.ff_write_multi(oc, mux.pkt, [p0], false);
    await libav.av_write_frame(oc, 0);
    primed = true;
  }
  // moov после avformat_write_header ещё в буфере AVIO — вытолкнуть
  if ((!delay || primed) && !jsMuxOff) { try { await libav.avio_flush(pb); } catch (e) { } }
  var hasMoov = topBoxes().indexOf('moov') >= 0;
  var initBytes = flushOut(g, 0);   // init-сегмент (ftyp+moov)
  // Дальше фрагменты собираем сами (jsWrite), если заголовок вышел целиком.
  // AC3/E-AC3 как есть (delay_moov): moov ещё не записан — остаётся libav
  if ((!delay || primed) && !jsMuxOff && hasMoov && initBytes > 0 && out.len === 0) {
    var tb = { v: mux.vTbOut, a: mux.aTbOut };
    await closeMuxer();
    mux = { js: true, gen: g, vTbOut: tb.v, aTbOut: tb.a, seq: 0,
      tracks: [{ held: null, lastDur: 0 }, tb.a ? { held: null, lastDur: 0 } : null] };
  }
}

async function closeMuxer() {
  if (!mux) return;
  var m = mux; mux = null;
  if (m.js) return;
  try { await libav.ff_free_muxer(m.oc, m.pb); } catch (e) { }
  try { await libav.av_packet_free_js(m.pkt); } catch (e) { }
  try { await libav.unlink(m.name); } catch (e) { }
  resetOut();
}

/** Отдать странице готовые боксы из выхода libav; сколько байт ушло */
function flushOut(g, t) {
  var n = completeBoxes();
  if (!n) return 0;
  var all = out.buf.slice(0, n);
  out.buf.copyWithin(0, n, out.len);
  out.len -= n;
  out.base += n;
  postMessage({ type: 'data', gen: g, bytes: all, t: t }, [all.buffer]);
  return n;
}

// ---------- свой сборщик фрагментов fMP4 ----------
// Мультиплексор libav на каждом пакете: копия данных из JS обратно в WASM,
// копия в буфер фрагмента, копия фрагмента из WASM наружу и ещё срез — на
// Tizen 5.0 (Chromium 63, совместимая сборка) это было 55 % работы воркера
// («MP4» в диагностике), и 4K не успевал. Заголовок (ftyp+moov) по-прежнему
// пишет libav, а фрагменты moof+mdat собираем здесь: данные пакета копируются
// один раз — сразу в выходной фрагмент. Метки — как у libav (frag_discont,
// default_base_moof, без editlist): tfdt = DTS первого сэмпла (+OFFSET).
// ?wasm=libavmux — отладка: фрагменты снова собирает libav
var jsMuxOff = false;
var FLAG_SYNC = 0x02000000;          // sample_depends_on = 2 (ни от кого)
var FLAG_NON_SYNC = 0x01010000;      // depends_on = 1, is_non_sync_sample

/** Пакет → сэмпл в шкале дорожки init-сегмента (с OFFSET) */
function sampleOf(p, from, to) {
  var k = (from[0] * to[1]) / (from[1] * to[0]);
  var off = Math.round(OFFSET * to[1] / to[0]);
  var pts = ts(p, 'pts'), dts = ts(p, 'dts');
  if (pts === null) pts = dts;
  if (dts === null) dts = pts;
  if (dts === null) dts = pts = 0;
  var d = Math.round(dts * k);
  return { dts: d + off, cto: Math.round(pts * k) - d, data: p.data, key: !!(p.flags & 1), dur: 0 };
}

/**
 * Сэмплы дорожки, готовые к записи: длительность — до DTS следующего, поэтому
 * последний придерживаем до следующего захода (final — отдать и его)
 */
function jsTake(tr, list, final) {
  var all = tr.held ? [tr.held].concat(list) : list;
  tr.held = null;
  if (!all.length) return [];
  if (!final) tr.held = all[all.length - 1];
  var ready = final ? all : all.slice(0, -1);
  for (var i = 0; i < ready.length; i++) {
    var d = i + 1 < all.length ? all[i + 1].dts - ready[i].dts : tr.lastDur;
    if (!(d > 0)) d = tr.lastDur > 0 ? tr.lastDur : 1;
    ready[i].dur = d;
    tr.lastDur = d;
  }
  return ready;
}

/** moof (mfhd + traf на дорожку: tfhd, tfdt v1, trun v1) + mdat */
function jsFragment(trafs) {
  var moofSize = 8 + 16, payload = 0;
  trafs.forEach(function (t) {
    t.size = 8 + 16 + 20 + 20 + 16 * t.samples.length;
    t.bytes = 0;
    t.samples.forEach(function (s) { t.bytes += s.data.length; });
    moofSize += t.size;
    payload += t.bytes;
  });
  var buf = new Uint8Array(moofSize + 8 + payload), dv = new DataView(buf.buffer), o = 0;
  var box = function (size, type) {
    dv.setUint32(o, size);
    for (var c = 0; c < 4; c++) buf[o + 4 + c] = type.charCodeAt(c);
    o += 8;
  };
  box(moofSize, 'moof');
  box(16, 'mfhd'); dv.setUint32(o, 0); dv.setUint32(o + 4, ++mux.seq); o += 8;
  var dataOff = moofSize + 8;
  trafs.forEach(function (t) {
    box(t.size, 'traf');
    box(16, 'tfhd'); dv.setUint32(o, 0x020000); dv.setUint32(o + 4, t.id); o += 8;   // default-base-is-moof
    var base = t.samples[0].dts;
    box(20, 'tfdt'); dv.setUint32(o, 0x01000000); dv.setUint32(o + 4, Math.floor(base / 4294967296)); dv.setUint32(o + 8, base % 4294967296); o += 12;
    // trun v1: data-offset, duration, size, flags, composition offset (со знаком)
    box(20 + 16 * t.samples.length, 'trun'); dv.setUint32(o, 0x01000F01); dv.setUint32(o + 4, t.samples.length); dv.setInt32(o + 8, dataOff); o += 12;
    t.samples.forEach(function (s) {
      dv.setUint32(o, s.dur); dv.setUint32(o + 4, s.data.length);
      dv.setUint32(o + 8, !t.video || s.key ? FLAG_SYNC : FLAG_NON_SYNC); dv.setInt32(o + 12, s.cto);
      o += 16;
    });
    dataOff += t.bytes;
  });
  box(8 + payload, 'mdat');
  trafs.forEach(function (t) {
    t.samples.forEach(function (s) { buf.set(s.data, o); o += s.data.length; });
  });
  return buf;
}

/** Пакеты захода → фрагмент странице (final — в конце файла, без придержанных) */
function jsWrite(vOut, aOut, final) {
  var trafs = [];
  var vs = jsTake(mux.tracks[0], vOut.map(function (p) { return sampleOf(p, vTb, mux.vTbOut); }), final);
  if (vs.length) trafs.push({ id: 1, video: true, samples: vs });
  if (mux.tracks[1]) {
    var from = copyAudio ? aTb : [1, enc ? enc.sr : 48000];
    var as = jsTake(mux.tracks[1], aOut.map(function (p) { return sampleOf(p, from, mux.aTbOut); }), final);
    if (as.length) trafs.push({ id: 2, samples: as });
  }
  if (!trafs.length) return;
  var bytes = jsFragment(trafs);
  postMessage({ type: 'data', gen: gen, bytes: bytes, t: outTime }, [bytes.buffer]);
}

// ---------- главный цикл ----------

async function doPending() {
  var p = pending; pending = null;
  sleeping = false;
  if (!p.first && p.kind === 'seek') abortLoads();
  await closeMuxer();
  if (p.kind === 'audio') {
    aIdx = audioList[p.index];
    await applyDiscard();
  }
  await setupAudio();   // свежий декодер — без хвоста до перемотки
  gen = p.gen;
  var target = Math.round(p.time * vTb[1] / vTb[0]);
  var hi = Math.floor(target / 4294967296);
  var ret = await libav.avformat_seek_file_max(fmt, vIdx, target - hi * 4294967296, hi, 0);
  if (ret < 0) log('перемотка: ' + ret);
  debugBatches = self.DEBUG_SEEK ? 6 : 0;
  eof = false; outTime = p.time; playhead = p.time;
  audioStart = null;
  log('позиция ' + p.time.toFixed(2) + ' c (поколение ' + gen + ')');
}

var audioStart = null;   // первая метка звука после перемотки, в сэмплах

async function run() {
  for (;;) {
    await yieldTask();
    if (pending) { await doPending(); continue; }
    var ahead = outTime - playhead;
    if (eof || ahead > AHEAD || (sleeping && ahead > AHEAD - WAKE_GAP)) { sleeping = true; await sleep(); continue; }
    sleeping = false;

    var t0 = performance.now(), w0 = perf.waitMs;
    var r = await libav.ff_read_frame_multi(fmt, pkt, { limit: READ_LIMIT, unify: true });
    perf.readMs += performance.now() - t0 - (perf.waitMs - w0);
    var res = r[0], list = r[1][0] || [];
    // реплики с абсолютным временем — годятся при любом поколении
    var cues = subCues(list);
    if (cues.length) postMessage({ type: 'cues', cues: cues });
    if (pending) continue;                // перемотали, пока читали — выбросить

    var vOut = [], aIn = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (self.DEBUG_TS && p.stream_index === vIdx && DEBUG_TS-- > 0) log('v pts=' + ts(p, 'pts') + ' dts=' + ts(p, 'dts') + ' key=' + (p.flags & 1));
      if (p.stream_index === vIdx) {
        if (video.strip && p.data) p.data = stripDoviNals(p.data, video.strip);
        vOut.push(p);
      } else if (p.stream_index === aIdx) aIn.push(p);
    }
    var aOut = [];
    if (aIn.length && copyAudio) aOut = aIn;
    else if (aIn.length) {
      var td = performance.now();
      var frames = await decodePackets(aIn);
      perf.decMs += performance.now() - td;
      stats.aFrames += frames.length;
      if (frames.length) {
        if (!enc) await setupEncoder(frames[0]);
        if (audioStart === null) {
          // начало звука — по метке пакета, из которого вышел первый кадр
          // (не первого пакета: декодер мог его пропустить — сдвиг на кадр)
          var f0 = frames[0], tb = aTb;
          var fp = f0.srcPts !== undefined ? f0.srcPts : ts(f0, 'pts');
          // libav.js 6.11: у кадра свой time_base (может быть 1/частота)
          if (f0.srcPts === undefined && f0.time_base_num && f0.time_base_den) tb = [f0.time_base_num, f0.time_base_den];
          if (fp === null || fp === undefined) { fp = ts(aIn[0], 'pts') || 0; tb = aTb; }
          audioStart = Math.round(fp * tb[0] / tb[1] * enc.sr);
          if (dec.skipped) log('декодер пропустил пакетов в начале: ' + dec.skipped);
        }
        var fr = pushFrames(frames, audioStart);
        var te = performance.now();
        aOut = fr.length ? await libav.ff_encode_multi(enc.c, enc.frame, enc.pkt, fr) : [];
        perf.encMs += performance.now() - te;
      }
    }
    if (!mux && (vOut.length || aOut.length)) {
      // AC3 из своего кодера — ещё и первый пакет: из него mov берёт dac3
      if (!copyAudio && aIdx >= 0 && (!enc || (outCodec === 'ac3' && !aOut.length))) {
        // звук ещё не пошёл (видео впереди звука) — подождём кодер, видео придержим
        heldVideo = heldVideo.concat(vOut);
        if (heldVideo.length < 400) continue;
      }
      await openMuxer(gen, false, aOut[0]);
      vOut = heldVideo.concat(vOut); heldVideo = [];
    }
    if (!mux) continue;

    fillVideoDts(vOut);
    var packets = [];
    var lastV = outTime;
    vOut.forEach(function (p) {
      var pts = ts(p, 'pts');
      if (pts !== null) lastV = Math.max(lastV, pts * vTb[0] / vTb[1]);
      if (!mux.js) packets.push(rescale(p, vTb, mux.vTbOut, 0));
    });
    // «Разгон» AAC (1024 сэмпла) кодер сам отражает в метках (первый пакет
    // с pts −1024) — сдвигать не нужно, замер совпадает с родным AAC
    if (mux.aTbOut && !mux.js) aOut.forEach(function (p) {
      packets.push(rescale(p, copyAudio ? aTb : [1, enc.sr], mux.aTbOut, 1));
    });
    if (debugBatches > 0) {
      debugBatches--;
      var vk = vOut.filter(function (p) { return p.flags & 1; }).length;
      log('порция: видео ' + vOut.length + ' (ключевых ' + vk + ', pts ' + (vOut.length ? (ts(vOut[0], 'pts') * vTb[0] / vTb[1]).toFixed(2) : '-') + '), звук ' + aIn.length + ' → ' + aOut.length +
        ', mux ' + (mux ? 'есть' : 'нет') + ', куча ' + Math.round((libav.HEAPU8 ? libav.HEAPU8.length : 0) / 1048576) + ' МБ, выход ' + out.len);
    }
    var tm = performance.now();
    if (packets.length) await libav.ff_write_multi(mux.oc, mux.pkt, packets);
    if (pending) continue;
    // секунды фильма, собранные этим заходом (без скачков перемотки)
    if (lastV > outTime && lastV - outTime < 30) perf.mediaSec += lastV - outTime;
    outTime = lastV;
    if (mux.js) jsWrite(vOut, aOut, res === libav.AVERROR_EOF);
    else flushOut(gen, outTime);
    perf.muxMs += performance.now() - tm;
    reportPerf();

    var dt = performance.now() - t0;
    stats.workMs += dt;
    stats.mediaSec += vOut.length ? vOut.length / 25 : 0;   // грубо, уточняет страница
    postMessage({ type: 'stats', bytes: stats.bytes, requests: stats.requests, workMs: Math.round(stats.workMs), outTime: outTime, aFrames: stats.aFrames });

    if (res === libav.AVERROR_EOF) {
      // дописать хвост: последний фрагмент мультиплексор отдаёт на трейлере
      // (свой сборщик отдал всё в jsWrite с final)
      if (!mux.js) {
        await libav.av_write_trailer(mux.oc).catch(function () { });
        flushOut(gen, outTime);
      }
      eof = true;
      postMessage({ type: 'eof', gen: gen });
    } else if (res < 0 && res !== -libav.EAGAIN && res !== -11) {
      throw new Error('Чтение файла: ошибка ' + res);
    }
  }
}
var heldVideo = [];
var DEBUG_TS = 0;
// журнал первых порций после старта/перемотки (pts — уже в шкале мультиплексора, +OFFSET)
self.DEBUG_SEEK = false;
var debugBatches = 0;
var lastVDts = null;   // последний записанный DTS видео (в его time_base)

/**
 * После старта и каждой перемотки демуксер не знает DTS первых кадров, пока
 * не набралась очередь B-кадров (pts=0 dts=?, pts=120 dts=?, pts=40 dts=0…).
 * Достраиваем назад от первого известного DTS с шагом кадра.
 */
function fillVideoDts(list) {
  var step = frameStep();
  for (var i = 0; i < list.length; i++) {
    if (ts(list[i], 'dts') !== null) { lastVDts = ts(list[i], 'dts'); continue; }
    var j = i + 1;
    while (j < list.length && ts(list[j], 'dts') === null) j++;
    var d;
    if (j < list.length) d = ts(list[j], 'dts') - (j - i) * step;
    else d = lastVDts !== null ? lastVDts + step : ts(list[i], 'pts');
    if (lastVDts !== null && d <= lastVDts) d = lastVDts + 1;
    var pts = ts(list[i], 'pts');
    if (pts !== null && d > pts) d = pts;
    setTs(list[i], 'dts', d);
    lastVDts = d;
  }
}

function frameStep() {
  var s = streams[vIdx];
  if (!s.fps) return Math.max(1, Math.round(vTb[1] / vTb[0] / 25));
  return Math.max(1, Math.round(vTb[1] / vTb[0] / s.fps));
}
