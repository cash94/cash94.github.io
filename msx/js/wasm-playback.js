// ==================== ПРЯМОЙ ФАЙЛ ЧЕРЕЗ WASM (MSE) ====================
//
// «Полностью отключить транскодирование» в обычном браузере и на VIDAA ниже
// 9.5: <video src=файл> там либо не играет MKV вовсе, либо молчит на AC3/EAC3/
// DTS/TrueHD (Chrome на ПК не умеет Dolby). Вместо этого файл с TorrServer
// читает воркер (wasm-audio-worker.js, libav.js — ffmpeg в WASM): видео идёт
// как есть, звук — в AAC 2.0, всё собирается во фрагментированный MP4 и
// уходит в MediaSource этого же <video>. Сервер TorrStream не нужен.
//
// webOS, Tizen, VIDAA 9.5+, Apple, Android и Android TV (внешние плееры)
// играют файл сами, как раньше (eligible() = false). Воркер и сборка libav.js
// (3,5 МБ) грузятся только при запуске видео, когда условие выполнено.
//
// Что умеет: перемотка (вне буфера — воркер начинает с нового места), смена
// аудиодорожки, встроенные текстовые субтитры (SRT/ASS/WebVTT) как <track>
// у <video> — их подхватывает обычный механизм прямого режима
// (refreshNativeSubtitles). MPEG-TS не поддерживается (onError('ts')).
// Прототип и замеры — tools/wasm-audio-proto.

var WasmPlayback = (function () {
  var MIRROR_BASE = 'https://cash94.github.io/msx/js/';
  var TICK_MS = 500;
  // Позади держим до ~30 МБ: лимит MSE в Chrome около 150 МБ на видео
  var BEHIND_BYTES = 30e6;

  var s = null;   // текущее воспроизведение (attach … detach)

  /** Нужен ли WASM на этом устройстве при текущих настройках */
  function eligible() {
    if (!AppState.transcodingFullOnOff || window.AndroidJS) return false;
    var p = AppState.platform;
    // Android и Android TV — внешние плееры (и в браузере там WASM не нужен)
    if (p === 'webos' || p === 'tizen' || p === 'ios' || p === 'android' || p === 'androidtv' || AppState.tizenApp) return false;
    if (AppState.applePlatform === 'apple_tv' || AppState.applePlatform === 'apple') return false;
    if (p === 'vidaa' && AppState.vidaaDirectPlay) return false;
    return typeof WebAssembly === 'object' && typeof Worker === 'function' &&
      typeof window.MediaSource === 'function' && typeof MediaSource.isTypeSupported === 'function';
  }

  function isLocal() { return location.search.indexOf('local=1') !== -1; }

  /** Папка со сборкой libav.js: зеркало или локальный public/ при ?local=1 */
  function assetBase() {
    return (isLocal() ? location.origin + '/js/' : MIRROR_BASE) + 'wasm-audio';
  }

  /**
   * Воркер — как остальные, через маршрут сервера (routes/proxy.js:
   * /wasm-audio-worker.js). Сервер старше этого маршрута ответит 404 —
   * тогда Blob с importScripts с зеркала: классическому воркеру чужой адрес
   * скрипта можно, а сам Blob считается своим адресом страницы
   */
  function createWorker(useBlob) {
    if (!useBlob) return new Worker(tsWorkerUrl('wasm-audio-worker.js'));
    var src = (isLocal() ? location.origin + '/js/' : MIRROR_BASE) + 'wasm-audio-worker.js';
    var blob = new Blob(['importScripts(' + JSON.stringify(src) + ');'], { type: 'application/javascript' });
    return new Worker(URL.createObjectURL(blob));
  }

  // ---------- запуск ----------

  /**
   * Открыть файл в <video>. opts: time — с какой секунды, audio — номер
   * аудиодорожки (по порядку в файле) или -1, onInfo(info) — дорожки файла,
   * onError(code, msg) — 'ts' | 'video' | 'codec' | 'net' | ''
   */
  function attach(video, url, opts) {
    detach();
    s = {
      video: video, url: url, opts: opts || {}, worker: null, usedBlob: false, ms: null, sb: null,
      queue: [], gen: 0, info: null, ended: false, needClear: false, selfSeek: false,
      startTime: (opts && opts.time > 0) ? opts.time : 0, tickTimer: null, objectUrl: null,
      subs: {}, listeners: []
    };
    startWorker(false);
    on(video, 'seeking', onSeeking);
    on(video, 'loadedmetadata', onLoadedMetadata);
    s.startPending = s.startTime > 0;
    s.tickTimer = setInterval(function () {
      if (!s || !s.worker) return;
      // Старт с таймкода: пока <video> не встал на стартовую позицию (это
      // случится только после первого сегмента), он стоит на 0 — и воркер,
      // решив, что собрал далеко вперёд, засыпал, не отдав даже заголовок
      var t = s.startPending ? s.startTime : s.video.currentTime;
      s.worker.postMessage({ type: 'tick', time: t });
    }, TICK_MS);
  }

  function startWorker(useBlob) {
    var st = s;
    try { st.worker = createWorker(useBlob); }
    catch (e) { fail('', 'Не удалось запустить воркер: ' + e.message); return; }
    st.usedBlob = useBlob;
    var gotMessage = false;
    st.worker.onmessage = function (ev) { gotMessage = true; if (s === st) onWorker(ev.data); };
    st.worker.onerror = function (e) {
      if (s !== st) return;
      // Маршрута на сервере ещё нет (старый сервер) — пробуем через Blob
      if (!gotMessage && !st.usedBlob) {
        try { st.worker.terminate(); } catch (x) { }
        startWorker(true);
        return;
      }
      fail('', 'Ошибка воркера: ' + (e && e.message || ''));
    };
    st.worker.postMessage({ type: 'open', url: st.url, base: assetBase(), audio: st.opts.audio >= 0 ? st.opts.audio : 0, time: st.startTime });
  }

  /** Снять всё: воркер, MediaSource, дорожки субтитров, слушатели */
  function detach() {
    if (!s) return;
    var st = s; s = null;
    clearInterval(st.tickTimer);
    try { if (st.worker) st.worker.terminate(); } catch (e) { }
    for (var i = 0; i < st.listeners.length; i++) {
      var l = st.listeners[i];
      l[0].removeEventListener(l[1], l[2]);
    }
    for (var k in st.subs) {
      if (st.subs[k].el && st.subs[k].el.parentNode) st.subs[k].el.parentNode.removeChild(st.subs[k].el);
    }
    if (st.ms && st.ms.readyState === 'open') { try { st.ms.endOfStream(); } catch (e) { } }
    if (st.objectUrl) {
      // <video> ещё смотрит на MediaSource — отвязываем, иначе он держит буфер
      if (st.video.src === st.objectUrl) { st.video.removeAttribute('src'); try { st.video.load(); } catch (e) { } }
      try { URL.revokeObjectURL(st.objectUrl); } catch (e) { }
    }
  }

  function on(el, type, fn) { el.addEventListener(type, fn); s.listeners.push([el, type, fn]); }

  function fail(code, msg) {
    var st = s;
    if (!st) return;
    console.warn('🧩 WASM: ' + (code ? code + ': ' : '') + msg);
    detach();
    if (st.opts.onError) st.opts.onError(code, msg);
  }

  // ---------- сообщения воркера ----------

  function onWorker(m) {
    if (m.type === 'info') onInfo(m);
    else if (m.type === 'data') { if (m.gen === s.gen) { s.queue.push(m.bytes); pump(); } }
    else if (m.type === 'eof') { if (m.gen === s.gen) { s.ended = true; pump(); } }
    else if (m.type === 'cues') addCues(m.cues);
    else if (m.type === 'error') fail(m.code || '', m.msg);
    else if (m.type === 'net') {
      if (!m.ok) console.warn('🧩 WASM: TorrServer — ' + m.error + ', повтор ' + m.attempt + ' через ' + (m.delay / 1000) + ' с');
    } else if (m.type === 'log') console.log('🧩 WASM: ' + m.msg);
  }

  function onInfo(m) {
    s.info = m;
    var mime = 'video/mp4; codecs="' + m.vCodec + (m.aCodec ? ',' + m.aCodec : '') + '"';
    console.log('🧩 WASM: ' + m.streams.map(function (x) { return x.codec + (x.channels ? ' ' + x.channels + 'ch' : ''); }).join(', ') + ' → ' + mime);
    if (!MediaSource.isTypeSupported(mime)) { fail('video', 'Браузер не поддерживает видео ' + m.vCodec); return; }
    createSubTracks(m.streams);
    if (s.opts.onInfo) s.opts.onInfo(m);
    var ms = new MediaSource(), st = s;
    s.ms = ms;
    s.objectUrl = URL.createObjectURL(ms);
    ms.addEventListener('sourceopen', function () {
      if (s !== st) return;
      if (m.duration > 0) ms.duration = m.duration;
      try { st.sb = ms.addSourceBuffer(mime); }
      catch (e) { fail('video', 'MediaSource: ' + e.message); return; }
      st.sb.mode = 'segments';
      // воркер сдвигает все метки на +offset (fMP4 не любит отрицательные DTS)
      st.sb.timestampOffset = -(m.offset || 0);
      st.sb.addEventListener('updateend', function () { if (s === st) { pump(); jumpStartGap(); } });
      pump();
    });
    s.video.src = s.objectUrl;
  }

  // ---------- MediaSource ----------

  function pump() {
    var sb = s && s.sb;
    if (!sb || sb.updating) return;
    if (s.needClear) {
      // после перемотки: сначала убрать старое, потом добавлять новое
      s.needClear = false;
      try { sb.abort(); } catch (e) { }
      sb.timestampOffset = -(s.info.offset || 0);
      if (sb.buffered.length) { sb.remove(0, Infinity); return; }
    }
    var b = sb.buffered, t = s.video.currentTime;
    var bps = s.info.duration ? s.info.size / s.info.duration : 1e6;
    var keep = Math.max(3, Math.min(20, BEHIND_BYTES / bps));
    if (b.length && t - b.start(0) > keep * 2) { sb.remove(0, t - keep); return; }
    if (s.queue.length) {
      var chunk = s.queue.shift();
      try { sb.appendBuffer(chunk); }
      catch (e) {
        if (e.name === 'QuotaExceededError') { s.queue.unshift(chunk); sb.remove(0, Math.max(0.1, t - 3)); }
        else fail('video', 'appendBuffer: ' + e.message);
      }
      return;
    }
    if (s.ended && s.ms.readyState === 'open') { try { s.ms.endOfStream(); } catch (e) { } }
  }

  function inBuffer(t) {
    var b = s.video.buffered;
    for (var i = 0; i < b.length; i++) if (t >= b.start(i) && t < b.end(i) - 0.3) return true;
    return false;
  }

  // Время в файле может начинаться не с нуля — небольшую дыру перед буфером
  // перепрыгиваем, иначе <video> ждёт данных, которых не будет
  function jumpStartGap() {
    var v = s.video, b = v.buffered;
    if (!b.length || v.seeking) return;
    var t = v.currentTime;
    for (var i = 0; i < b.length; i++) {
      if (t >= b.start(i) && t < b.end(i)) return;
      if (b.start(i) > t && b.start(i) - t < 10) { s.selfSeek = true; v.currentTime = b.start(i) + 0.01; return; }
    }
  }

  // Старт с таймкода: воркер начал с нужного места, ставим туда и <video>
  function onLoadedMetadata() {
    if (s.startTime > 0 && s.video.currentTime < s.startTime - 1) {
      s.selfSeek = true;
      s.video.currentTime = s.startTime;
    }
    s.startPending = false;
  }

  // Перемотка за пределы собранного — воркер начинает с нового места
  function onSeeking() {
    if (s.selfSeek) { s.selfSeek = false; return; }
    if (!s.info || inBuffer(s.video.currentTime)) return;
    restart({ type: 'seek' }, s.video.currentTime);
  }

  function restart(msg, time) {
    s.gen++;
    s.queue = []; s.ended = false;
    msg.time = time; msg.gen = s.gen;
    s.worker.postMessage(msg);
    s.needClear = true;
    pump();
  }

  /**
   * Сменить аудиодорожку (номер по порядку в файле). Через перемотку на то же
   * место: если стереть буфер под играющим видео без seek, звуковой рендерер
   * Chrome не сбрасывается, и звук с каждой сменой отстаёт ещё на 15–25 мс
   */
  function switchAudio(index) {
    if (!s || !s.worker) return false;
    var t = s.video.currentTime;
    restart({ type: 'audio', index: index }, t);
    s.selfSeek = true;
    s.video.currentTime = t;
    return true;
  }

  // ---------- субтитры ----------
  //
  // На каждую дорожку субтитров файла — <track> в порядке потоков: тогда
  // список совпадает с ffprobe/CUB по номеру, и подписи, сохранённый выбор и
  // включение работают как у прямого файла (refreshNativeSubtitles).
  // <track>, а не addTextTrack: его можно убрать при смене серии.
  // Реплики браузер стирает, когда дорожку впервые включают (она «грузится»),
  // поэтому храним их у себя и переносим в дорожку по событию load.
  // Картинки (PGS, VobSub) — пустые дорожки: их воркер не разбирает.

  function createSubTracks(list) {
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      if (x.type !== 'subtitle') continue;
      var el = document.createElement('track');
      el.kind = 'subtitles';
      el.label = 'Субтитры ' + (Object.keys(s.subs).length + 1) + (x.text ? '' : ' (' + x.codec + ')');
      el.src = 'data:text/vtt,WEBVTT%0A';
      var sub = { el: el, cues: [], seen: {}, loaded: false };
      el.addEventListener('load', flushCues.bind(null, sub));
      s.subs[x.index] = sub;
      s.video.appendChild(el);
    }
  }

  function flushCues(sub) {
    sub.loaded = true;
    for (var i = 0; i < sub.cues.length; i++) {
      try { sub.el.track.addCue(sub.cues[i]); } catch (e) { }
    }
  }

  function addCues(cues) {
    for (var i = 0; i < cues.length; i++) {
      var c = cues[i], sub = s.subs[c.s];
      if (!sub) continue;
      // после перемоток воркер читает те же места ещё раз
      var key = c.a.toFixed(3) + '|' + c.t;
      if (sub.seen[key]) continue;
      sub.seen[key] = 1;
      var cue;
      try { cue = new VTTCue(c.a, c.b, c.t); } catch (e) { continue; }
      sub.cues.push(cue);
      if (sub.loaded) { try { sub.el.track.addCue(cue); } catch (e) { } }
    }
  }

  return {
    eligible: eligible,
    attach: attach,
    detach: detach,
    switchAudio: switchAudio,
    active: function () { return !!s; },
    // Отладка из консоли: WasmPlayback.report().then(console.log) — что
    // держит воркер (кучи WASM, кэш Range), запросы к TorrServer, позиция
    report: function () {
      return new Promise(function (resolve) {
        if (!s || !s.worker) { resolve(null); return; }
        var w = s.worker;
        var t = setTimeout(function () { resolve(null); }, 3000);
        w.addEventListener('message', function once(ev) {
          if (ev.data && ev.data.type === 'mem') { clearTimeout(t); w.removeEventListener('message', once); resolve(ev.data.mem); }
        });
        w.postMessage({ type: 'mem' });
      });
    }
  };
})();
