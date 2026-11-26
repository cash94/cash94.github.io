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
var LIBAV_WASM = 'libav-6.11.9.0.2-torrstream.wasm.wasm';
var libName = 'torrstream';

var CHUNK = 2 << 20;          // кусок одного запроса Range
var CACHE_CHUNKS = 8;         // сколько кусков держим (перемотка назад рядом)
var AHEAD = 25;               // секунд держим собранными впереди плеера
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
var wake = null;
var chunks = new Map();       // start -> Promise<Uint8Array>
var stats = { bytes: 0, requests: 0, workMs: 0, mediaSec: 0, aFrames: 0 };

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
  chunks.forEach(function (p) { cached += CHUNK; });
  return {
    libavHeap: heap(libav),
    eac3Heap: dec && dec.kind === 'eac3' ? heap(dec.d.m) : 0,
    rangeCache: cached,
    muxOut: out.buf.length,
    rechunk: rechunk ? rechunk.planes.reduce(function (s, p) { return s + p.byteLength; }, 0) : 0,
    heldVideo: heldVideo.length,
    requests: stats.requests, bytes: stats.bytes, outTime: outTime, playhead: playhead, sleeping: !!wake,
    keepAlive: stats.keepAlive || 0
  };
}

// Вызовы libav.js (noworker) завершаются микрозадачами — пока есть работа,
// цикл не отдаёт поток, и сообщения страницы (перемотка, tick) ждут по 1–2 с.
// Раз в заход уступаем событийному циклу (MessageChannel — без задержки 4 мс
// у вложенных setTimeout).
var yieldCh = new MessageChannel(), yieldQ = [];
yieldCh.port1.onmessage = function () { var r = yieldQ.shift(); if (r) r(); };
function yieldTask() { return new Promise(function (r) { yieldQ.push(r); yieldCh.port2.postMessage(0); }); }
function sleep() { keepAlive(); return new Promise(function (r) { wake = r; setTimeout(poke, 500); }); }

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
  fetch(url, { headers: { Range: 'bytes=' + pos + '-' + pos } }).then(function (r) { return r.arrayBuffer(); })
    .catch(function () { }).then(function () { keepAliveBusy = false; });
}

// ---------- чтение по Range ----------

// После долгой паузы TorrServer мог выгрузить раздачу, перезапуститься или
// отвечать медленно (снова ищет пиров). Без повторов первая же ошибка
// останавливала воркер, и видео вставало в конце буфера. Повторяем с
// нарастающей паузой около минуты; у каждой попытки свой тайм-аут.
var RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000, 15000, 15000];
var ATTEMPT_TIMEOUT = 30000;

function fetchRange(start, end) {
  var attempt = 0;
  function once() {
    stats.requests++;
    lastNetAt = Date.now(); nextPos = end + 1;
    // Тайм-аут — на тишину, а не на весь запрос: с середины раздачи TorrServer
    // качает куски медленно (бывало 2 МБ дольше 30 с), и обрыв по общему
    // таймеру начинал запрос заново, хотя данные шли
    var ac = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = null;
    var arm = function () { clearTimeout(timer); timer = setTimeout(function () { if (ac) ac.abort(); }, ATTEMPT_TIMEOUT); };
    arm();
    return fetch(url, { headers: { Range: 'bytes=' + start + '-' + end }, signal: ac ? ac.signal : undefined }).then(function (r) {
      if (r.status !== 206 && r.status !== 200) throw new Error('HTTP ' + r.status);
      return readBody(r, arm);
    }).then(function (b) {
      clearTimeout(timer);
      // 200 вместо 206 — сервер не умеет Range; берём нужный кусок
      var u = new Uint8Array(b);
      if (u.length > end - start + 1) u = u.subarray(start, end + 1);
      if (!u.length) throw new Error('пустой ответ');
      stats.bytes += u.length;
      if (attempt) postMessage({ type: 'net', ok: true, attempt: attempt });
      return u;
    }, function (e) { clearTimeout(timer); throw e; }).catch(function (e) {
      if (attempt >= RETRY_DELAYS.length) throw e;
      var delay = RETRY_DELAYS[attempt++];
      postMessage({ type: 'net', ok: false, attempt: attempt, delay: delay, error: (e && e.name === 'AbortError') ? 'тайм-аут' : String(e && e.message || e) });
      return new Promise(function (r) { setTimeout(r, delay); }).then(once);
    });
  }
  return once();
}

/** Тело ответа целиком; onProgress — на каждый пришедший кусок (сброс тайм-аута) */
function readBody(r, onProgress) {
  if (!r.body || typeof r.body.getReader !== 'function') return r.arrayBuffer();
  var reader = r.body.getReader(), parts = [], total = 0;
  function next() {
    return reader.read().then(function (x) {
      if (x.done) {
        var all = new Uint8Array(total), off = 0;
        for (var i = 0; i < parts.length; i++) { all.set(parts[i], off); off += parts[i].length; }
        return all.buffer;
      }
      parts.push(x.value); total += x.value.length;
      onProgress();
      return next();
    });
  }
  return next();
}

function getChunk(start) {
  var p = chunks.get(start);
  if (p) { chunks.delete(start); chunks.set(start, p); return p; }   // LRU
  var end = Math.min(start + CHUNK, size) - 1;
  p = fetchRange(start, end);
  p.catch(function () { chunks.delete(start); });
  chunks.set(start, p);
  while (chunks.size > CACHE_CHUNKS) chunks.delete(chunks.keys().next().value);
  return p;
}

function onBlockRead(name, pos, len) {
  var start = Math.floor(pos / CHUNK) * CHUNK;
  var p = getChunk(start);
  // Следующий кусок — заранее, но после текущего: на холодном старте с
  // середины раздачи они делили скорость, и нужный приходил вдвое позже
  if (start + CHUNK < size) p.then(function () { getChunk(start + CHUNK); }, function () { });
  return p.then(function (buf) {
    return libav.ff_block_reader_dev_send(name, start, buf);
  });
}

async function fileSize(u) {
  var r = await fetch(u, { headers: { Range: 'bytes=0-0' } });
  var cr = r.headers.get('Content-Range');
  if (cr && /\/(\d+)$/.test(cr)) return Number(RegExp.$1);
  // Content-Range не выставлен для CORS — пробуем HEAD
  var h = await fetch(u, { method: 'HEAD' });
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

function hex2(n) { return ('0' + (n & 255).toString(16)).slice(-2).toUpperCase(); }

async function videoCodecString(par, name) {
  var profile = await libav.AVCodecParameters_profile(par);
  var level = await libav.AVCodecParameters_level(par);
  if (name === 'h264') return 'avc1.' + hex2(profile > 0 ? profile : 100) + '00' + hex2(level > 0 ? level : 40);
  if (name === 'hevc') return 'hvc1.' + (profile > 0 ? profile : 1) + '.' + (profile === 2 ? '4' : '6') + '.L' + (level > 0 ? level : 120) + '.B0';
  if (name === 'av1') return 'av01.0.08M.08';
  if (name === 'vp9') return 'vp09.00.40.08';
  throw new Error('Видео ' + name + ' в MSE не положить');
}

async function open(m) {
  url = m.url; outCodec = 'aac';
  // Сборка libav.js лежит не рядом с воркером (он идёт через маршрут сервера
  // или Blob): адрес папки wasm-audio/ присылает страница — зеркало или
  // локальный public/ при ?local=1
  var base = String(m.base || '').replace(/\/+$/, '');
  var tl = performance.now();
  importScripts(base + '/' + LIBAV_JS);
  // без base/wasmurl сборка ищет .wasm.js и .wasm рядом с воркером
  libav = await LibAV.LibAV({ noworker: true, nothreads: true, base: base, wasmurl: base + '/' + LIBAV_WASM });
  log('libav.js ' + LibAV.VER + ', загрузка ' + Math.round(performance.now() - tl) + ' мс');
  libav.onblockread = onBlockRead;
  libav.onwrite = onWrite;
  size = await fileSize(url);
  // MPEG-TS (.ts, .m2ts) не поддерживаем: у libav.js в нём раздувается куча
  // (сотни МБ) и после перемотки пропадает звук. Узнаём по синхробайту 0x47
  // каждые 188 байт (у M2TS — 192, со сдвигом 4) — по имени файла не всегда
  var head = await getChunk(0);
  if (isMpegTs(head)) throw codedError('ts', 'MPEG-TS не поддерживается');
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
    AHEAD = Math.max(6, Math.min(25, 80e6 / bps));
  }
  var vCodec = await videoCodecString(streams[vIdx].codecpar, streams[vIdx].name);
  await setupAudio();
  postMessage({
    type: 'info', duration: duration, size: size, streams: list,
    audioTracks: audioList.map(function (i) { return { index: i, codec: streams[i].name, channels: streams[i].channels }; }),
    audio: audioList.indexOf(aIdx), vCodec: vCodec, aCodec: aCodecString(), offset: OFFSET,
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
  if (copyAudio) return COPY_OK[streams[aIdx].name];
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
  if (COPY_OK[s.name]) {
    var ch = libav.AVCodecParameters_ch_layout_nb_channels ? await libav.AVCodecParameters_ch_layout_nb_channels(s.codecpar)
      : (libav.AVCodecParameters_channels ? await libav.AVCodecParameters_channels(s.codecpar) : 0);
    var ex = await libav.AVCodecParameters_extradata_size(s.codecpar);
    copyAudio = ch > 0 && ch <= 2 && (s.name === 'mp3' || ex >= 2);
  }
  aTb = [s.time_base_num, s.time_base_den];
  if (copyAudio) return;
  try {
    var r = await libav.ff_init_decoder(s.codec_id, s.codecpar);   // [codec, c, pkt, frame]
    dec = { kind: 'libav', c: r[1], pkt: r[2], frame: r[3] };
  } catch (e) {
    throw codedError('codec', 'Звук ' + s.name + ' не поддерживается');
  }
  log('декодер ' + s.name);
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
  return libav.ff_decode_multi(dec.c, dec.pkt, dec.frame, aIn, { ignoreErrors: true });
}

var LAYOUTS = { 1: 0x4, 2: 0x3, 3: 0x7, 4: 0x33, 5: 0x37, 6: 0x60F, 7: 0x70F, 8: 0x63F };

async function setupEncoder(fr) {
  var inChannels = fr.channels || (Array.isArray(fr.data) && fr.data.length) || 2;
  var inLayout = fr.channel_layout || LAYOUTS[inChannels] || 0x3;
  // AAC — всегда стерео: многоканальное сводим сами (downmixMatrix)
  var channels = outCodec === 'aac' ? 2 : inChannels;
  var layout = outCodec === 'aac' ? 0x3 : inLayout;
  var sr = fr.sample_rate;
  var opts = {
    ctx: { sample_rate: sr, channels: channels, channel_layout: layout },
    time_base: [1, sr]
  };
  var name = outCodec, sfmt;
  if (name === 'flac') { sfmt = libav.AV_SAMPLE_FMT_S16; opts.options = { compression_level: '0' }; }
  else if (name === 'aac') { sfmt = libav.AV_SAMPLE_FMT_FLTP; opts.ctx.bit_rate = channels > 2 ? 384000 : 192000; }
  else if (name === 'ac3') { sfmt = libav.AV_SAMPLE_FMT_FLTP; opts.ctx.bit_rate = channels > 2 ? 640000 : 192000; }
  else if (name === 'opus') { name = 'libopus'; sfmt = libav.AV_SAMPLE_FMT_FLT; opts.ctx.bit_rate = channels > 2 ? 384000 : 160000; }
  opts.ctx.sample_fmt = sfmt;
  var r = await libav.ff_init_encoder(name, opts);
  enc = { c: r[1], frame: r[2], pkt: r[3], frameSize: r[4] || 4608, fmt: sfmt, channels: channels, layout: layout, sr: sr,
    inChannels: inChannels, mix: channels === inChannels ? null : downmixMatrix(inLayout, inChannels) };
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

function downmix(planes) {
  if (!enc.mix) return planes;
  var n = planes[0].length, out = [new Float32Array(n), new Float32Array(n)];
  for (var o = 0; o < 2; o++) {
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

function resetOut() { out = { base: 0, buf: new Uint8Array(1 << 20), len: 0 }; }

async function openMuxer(g) {
  var cfg = [];
  var vpar = await libav.avcodec_parameters_alloc();
  await libav.avcodec_parameters_copy(vpar, streams[vIdx].codecpar);
  await libav.AVCodecParameters_codec_tag_s(vpar, 0);
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
  // свои метки сохраняем как есть (иначе после перемотки всё съедет к нулю)
  await libav.av_opt_set(oc, 'avoid_negative_ts', 'disabled', 0);
  lastVDts = null;
  await libav.av_opt_set(oc, 'strict', 'experimental', 0);
  // frag_discont + use_editlist=0: tfdt первого фрагмента = DTS первого
  // пакета (как у сегментатора HLS в ffmpeg). Без этого mov сдвигает начало
  // каждой дорожки к нулю — рассинхрон и время «с нуля» после перемотки.
  await libav.av_opt_set(oc, 'movflags', 'frag_keyframe+empty_moov+default_base_moof+frag_discont', 1 /* AV_OPT_SEARCH_CHILDREN */);
  await libav.av_opt_set(oc, 'use_editlist', '0', 1);
  // фрагмент не длиннее секунды (иначе ждём ключевой кадр, а GOP бывает 5–10 с)
  await libav.av_opt_set(oc, 'frag_duration', '1000000', 1);
  resetOut();
  mux = { oc: oc, pb: pb, name: name, pkt: await libav.av_packet_alloc(), gen: g, pars: [vpar, apar] };
  var ret = await libav.avformat_write_header(oc, 0);
  if (ret < 0) throw new Error('avformat_write_header: ' + ret);
  // метки дальше переводим сами — в time_base, который выбрал мультиплексор
  mux.vTbOut = [await libav.AVStream_time_base_num(await libav.AVFormatContext_streams_a(oc, 0)), await libav.AVStream_time_base_den(await libav.AVFormatContext_streams_a(oc, 0))];
  if (cfg.length > 1) mux.aTbOut = [await libav.AVStream_time_base_num(await libav.AVFormatContext_streams_a(oc, 1)), await libav.AVStream_time_base_den(await libav.AVFormatContext_streams_a(oc, 1))];
  flushOut(g, 0);   // init-сегмент (ftyp+moov)
}

async function closeMuxer() {
  if (!mux) return;
  var m = mux; mux = null;
  try { await libav.ff_free_muxer(m.oc, m.pb); } catch (e) { }
  try { await libav.av_packet_free_js(m.pkt); } catch (e) { }
  try { await libav.unlink(m.name); } catch (e) { }
  resetOut();
}

function flushOut(g, t) {
  var n = completeBoxes();
  if (!n) return;
  var all = out.buf.slice(0, n);
  out.buf.copyWithin(0, n, out.len);
  out.len -= n;
  out.base += n;
  postMessage({ type: 'data', gen: g, bytes: all, t: t }, [all.buffer]);
}

// ---------- главный цикл ----------

async function doPending() {
  var p = pending; pending = null;
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
    if (eof || outTime - playhead > AHEAD) { await sleep(); continue; }

    var t0 = performance.now();
    var r = await libav.ff_read_frame_multi(fmt, pkt, { limit: READ_LIMIT, unify: true });
    var res = r[0], list = r[1][0] || [];
    // реплики с абсолютным временем — годятся при любом поколении
    var cues = subCues(list);
    if (cues.length) postMessage({ type: 'cues', cues: cues });
    if (pending) continue;                // перемотали, пока читали — выбросить

    var vOut = [], aIn = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (self.DEBUG_TS && p.stream_index === vIdx && DEBUG_TS-- > 0) log('v pts=' + ts(p, 'pts') + ' dts=' + ts(p, 'dts') + ' key=' + (p.flags & 1));
      if (p.stream_index === vIdx) vOut.push(p);
      else if (p.stream_index === aIdx) aIn.push(p);
    }
    var aOut = [];
    if (aIn.length && copyAudio) aOut = aIn;
    else if (aIn.length) {
      var frames = await decodePackets(aIn);
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
        aOut = fr.length ? await libav.ff_encode_multi(enc.c, enc.frame, enc.pkt, fr) : [];
      }
    }
    if (!mux && (vOut.length || aOut.length)) {
      if (!copyAudio && !enc && aIdx >= 0) {
        // звук ещё не пошёл (видео впереди звука) — подождём кодер, видео придержим
        heldVideo = heldVideo.concat(vOut);
        if (heldVideo.length < 400) continue;
      }
      await openMuxer(gen);
      vOut = heldVideo.concat(vOut); heldVideo = [];
    }
    if (!mux) continue;

    fillVideoDts(vOut);
    var packets = [];
    var lastV = outTime;
    vOut.forEach(function (p) {
      var pts = ts(p, 'pts');
      if (pts !== null) lastV = Math.max(lastV, pts * vTb[0] / vTb[1]);
      packets.push(rescale(p, vTb, mux.vTbOut, 0));
    });
    // «Разгон» AAC (1024 сэмпла) кодер сам отражает в метках (первый пакет
    // с pts −1024) — сдвигать не нужно, замер совпадает с родным AAC
    if (mux.aTbOut) aOut.forEach(function (p) {
      packets.push(rescale(p, copyAudio ? aTb : [1, enc.sr], mux.aTbOut, 1));
    });
    if (debugBatches > 0) {
      debugBatches--;
      var vk = vOut.filter(function (p) { return p.flags & 1; }).length;
      log('порция: видео ' + vOut.length + ' (ключевых ' + vk + ', pts ' + (vOut.length ? (ts(vOut[0], 'pts') * vTb[0] / vTb[1]).toFixed(2) : '-') + '), звук ' + aIn.length + ' → ' + aOut.length +
        ', mux ' + (mux ? 'есть' : 'нет') + ', куча ' + Math.round((libav.HEAPU8 ? libav.HEAPU8.length : 0) / 1048576) + ' МБ, выход ' + out.len);
    }
    if (packets.length) await libav.ff_write_multi(mux.oc, mux.pkt, packets);
    if (pending) continue;
    outTime = lastV;
    flushOut(gen, outTime);

    var dt = performance.now() - t0;
    stats.workMs += dt;
    stats.mediaSec += vOut.length ? vOut.length / 25 : 0;   // грубо, уточняет страница
    postMessage({ type: 'stats', bytes: stats.bytes, requests: stats.requests, workMs: Math.round(stats.workMs), outTime: outTime, aFrames: stats.aFrames });

    if (res === libav.AVERROR_EOF) {
      // дописать хвост: последний фрагмент мультиплексор отдаёт на трейлере
      await libav.av_write_trailer(mux.oc).catch(function () { });
      flushOut(gen, outTime);
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
