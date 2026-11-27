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

  /**
   * Нужен ли WASM сейчас: прямой режим, устройство подходит и не выключен в
   * настройках. opts.audioUnsupported — у выбранной дорожки звук, который
   * телевизор сам не играет (Tizen: DTS, TrueHD)
   */
  function eligible(opts) {
    if (!AppState.transcodingFullOnOff) return false;
    // «Обработка файла в браузере (WASM)» в настройках плеера (app.js: setupWasmSetting)
    try { if (localStorage.getItem('wasmPlaybackOff') === 'true') return false; } catch (e) { }
    return available(opts);
  }

  /**
   * MediaSource этого браузера. iPhone (iOS 17.1+) знает только
   * ManagedMediaSource: тот же API, но система сама решает, когда ему качать, и
   * может выбросить буфер (это ловит recoverGap)
   */
  function mediaSourceCtor() {
    if (typeof window.MediaSource === 'function' && typeof MediaSource.isTypeSupported === 'function') return window.MediaSource;
    if (typeof window.ManagedMediaSource === 'function' && typeof ManagedMediaSource.isTypeSupported === 'function') return window.ManagedMediaSource;
    return null;
  }

  /** iPhone/iPad: в «Плеер для видео» выбран «Встроенный TorrStream», а не внешнее приложение */
  function appleBuiltIn() {
    var ap = typeof getApplePlayer === 'function' ? getApplePlayer() : null;
    return !ap || !ap.template;
  }

  /**
   * Возможен ли WASM-путь на этом устройстве вообще (без учёта настроек).
   *  - iPhone/iPad — со встроенным плеером: Safari сам MKV не открывает;
   *  - Tizen — только для звука, которого Samsung не декодирует (DTS, TrueHD):
   *    остальное AVPlay играет сам, со всеми каналами;
   *  - webOS, VIDAA 9.5+, Apple TV, Android — файл играет сам телевизор или
   *    внешний плеер.
   */
  function available(opts) {
    return !unavailableWhy(opts);
  }

  /** Почему WASM-путь на этом устройстве невозможен ('' — возможен) */
  function unavailableWhy(opts) {
    if (window.AndroidJS) return 'приложение Android — файл играет свой плеер';
    if (typeof WebAssembly !== 'object') return 'браузер без WebAssembly';
    if (typeof Worker !== 'function') return 'браузер без Web Worker';
    if (!mediaSourceCtor()) return 'браузер без MediaSource (MSE)';
    var p = AppState.platform, apple = AppState.applePlatform;
    if (apple === 'apple_tv') return 'Apple TV — внешний плеер';
    if (apple === 'apple') return appleBuiltIn() ? '' : 'выбран внешний плеер';
    if (p === 'tizen' || AppState.tizenApp) return opts && opts.audioUnsupported ? '' : 'Tizen — только для звука DTS/TrueHD, остальное играет AVPlay';
    if (p === 'webos') return 'webOS играет файл сам';
    if (p === 'ios' || p === 'android' || p === 'androidtv') return 'внешний плеер';
    if (p === 'vidaa' && AppState.vidaaDirectPlay) return 'VIDAA 9.5+ играет файл сам';
    return '';
  }

  /** Почему WASM сейчас не включится ('' — включится) */
  function whyNot(opts) {
    if (!AppState.transcodingFullOnOff) return 'включено перекодирование — WASM работает только в прямом режиме';
    try { if (localStorage.getItem('wasmPlaybackOff') === 'true') return 'выключен в настройках плеера'; } catch (e) { }
    return unavailableWhy(opts);
  }

  function managed() { return mediaSourceCtor() !== window.MediaSource; }

  function isLocal() { return location.search.indexOf('local=1') !== -1; }

  /**
   * Звук, который браузер принимает в MSE сам: { кодек ffmpeg: строка MSE }.
   * Только VIDAA — телевизор декодирует Dolby сам, кодировать в AAC незачем
   * (кодер AAC — почти вся работа воркера, на ТВ он не успевал за 4K), и
   * многоканальный звук остаётся многоканальным. Чего ТВ не берёт (DTS,
   * TrueHD…) — по-прежнему в AAC 2.0. В браузерах на ПК — всегда AAC 2.0.
   * Отладка на ПК: ?wasm=native — как на VIDAA, без проверки поддержки
   */
  var nativeLogged = false;
  function nativeAudio() {
    var force = location.search.indexOf('wasm=native') !== -1;
    //if (AppState.platform !== 'vidaa' && !force) return {};
    if (!force) return {};
    // Проверяем связку с H.264, а не один звук: VIDAA U06 (Opera 46) на
    // «audio/mp4; ac-3» отвечает «да», а на «video/mp4; avc1…,ac-3» — «нет», и
    // плеер падал «Браузер не поддерживает видео avc1.640028». С другим видео
    // (HEVC…) связку ещё раз проверит onInfo и при отказе откатит на AAC
    var cand = { ac3: 'ac-3', eac3: 'ec-3', aac: 'mp4a.40.2' }, out = {}, seen = [];
    for (var k in cand) {
      var ok = force;
      ok = ok || typeOk('video/mp4; codecs="avc1.640028,' + cand[k] + '"');
      if (ok) out[k] = cand[k];
      seen.push(cand[k] + (ok ? ' да' : ' нет'));
    }
    if (!nativeLogged) { nativeLogged = true; console.log('🧩 WASM: звук как есть (MSE, связка с H.264): ' + seen.join(', ')); }
    return out;
  }

  /**
   * Перекодировать звук в AC3 (Dolby Digital), сохраняя каналы (до 5.1), а
   * не в AAC 2.0. Только Tizen: WASM там включается ради DTS/TrueHD, а AC3
   * телевизор декодирует сам или отдаёт саундбару битстримом. Настройка
   * «Преобразовать DTS в Dolby Digital…» (app.js: setupDtsAc3Setting),
   * включена по умолчанию — хранится как «выключена». Связку видео + ac-3
   * проверит onInfo и при отказе перезапустит с AAC.
   * Отладка на ПК: ?wasm=ac3 — без проверки поддержки (вместе с ?wasm=dump)
   */
  function ac3Available() { return AppState.platform === 'tizen' || !!AppState.tizenApp; }

  function ac3Wanted() { return !ac3Why(); }

  /** Почему звук пойдёт не в AC3 ('' — пойдёт в AC3) — для диагностики */
  function ac3Why() {
    if (location.search.indexOf('wasm=ac3') !== -1) return '';
    if (!ac3Available()) return 'не Tizen';
    try { if (localStorage.getItem('dtsToAc3Off') === 'true') return 'выключено в настройках плеера'; } catch (e) { }
    return typeOk('audio/mp4; codecs="ac-3"') ? '' : 'MSE не берёт ac-3';
  }

  var AUDIO_NAMES = { dts: 'DTS', dca: 'DTS', truehd: 'TrueHD', mlp: 'MLP', eac3: 'E-AC3', ac3: 'AC3', aac: 'AAC',
    flac: 'FLAC', opus: 'Opus', mp3: 'MP3', mp2: 'MP2', vorbis: 'Vorbis', alac: 'ALAC' };
  var CH_NAMES = { 1: '1.0', 2: '2.0', 3: '2.1', 5: '5.0', 6: '5.1', 7: '6.1', 8: '7.1' };

  function audioName(c) { return AUDIO_NAMES[c] || (/^pcm/.test(c || '') ? 'PCM' : String(c || '?').toUpperCase()); }
  function chName(n) { return n > 0 ? (CH_NAMES[n] || n + ' кан.') : ''; }

  /**
   * Строка «звук» для диагностики: что в файле → что идёт в плеер, и почему
   * не AC3, если на Tizen ждали его. Воркер без версии (rev) — старый, его
   * отдал сервер из кэша или из своей установки: про AC3 он не знает
   */
  function audioLine(st) {
    var a = st.audio;
    if (!a) return '';
    var from = audioName(a.from) + (a.inCh ? ' ' + chName(a.inCh) : '');
    var line;
    if (a.to === 'copy') line = from + ' как есть';
    else line = from + ' → ' + (a.to === 'ac3' ? 'AC3 (Dolby Digital)' : audioName(a.to)) + (a.outCh ? ' ' + chName(a.outCh) : '');
    if (a.coreOnly) line += ', только ядро DTS';
    if (st.encode === 'ac3' && a.to !== 'ac3' && a.to !== 'copy') line += ' (AC3 просили — воркер старый, ' + (st.info && st.info.rev ? st.info.rev : 'без версии') + ')';
    else if (a.to === 'aac' && ac3Available()) line += ' (не AC3: ' + (st.nativeOff ? 'связку видео + ac-3 MSE не взял' : st.encodeWhy || '?') + ')';
    return line;
  }

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

  // ---------- диагностика для «Об устройстве» ----------
  //
  // Что было при последнем запуске: взялся ли WASM (и если нет — почему), до
  // какого этапа дошёл, что за поток, ошибки воркера, сети и <video>. Хранится
  // в localStorage: после ошибки на телевизоре приложение часто закрывают, а
  // «Об устройстве» открывают уже потом (app.js: renderDeviceInfo)
  var LAST_KEY = 'wasmLastRun';
  var last = null;
  try { last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch (e) { last = null; }

  function saveLast() {
    try { localStorage.setItem(LAST_KEY, JSON.stringify(last)); } catch (e) { }
  }

  function note(fields, save) {
    if (!last) last = {};
    for (var k in fields) last[k] = fields[k];
    if (save !== false) saveLast();
  }

  function nowText() {
    var d = new Date();
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return two(d.getDate()) + '.' + two(d.getMonth() + 1) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
  }

  function fileFromUrl(url) {
    var m = /\/stream\/([^?]+)/.exec(url || '');
    if (!m) return 'без имени';
    try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
  }

  /** Плеер решил не брать WASM (или файл ему не подходит) — запоминаем почему */
  function noteSkip(reason, fileName) {
    last = { at: nowText(), file: fileName || 'без имени', used: false, why: reason || whyNot() || '?' };
    saveLast();
  }

  /** Понимает ли WebAssembly браузера memory.copy (как wasmBulkMemory в воркере) */
  function bulkMemory() {
    var bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 3, 1, 0, 1,
      10, 14, 1, 12, 0, 65, 0, 65, 0, 65, 0, 252, 10, 0, 0, 11]);
    try { return WebAssembly.validate(bytes); } catch (e) { return false; }
  }

  function mediaQuery(q) {
    if (!window.matchMedia) return null;
    try {
      var mq = window.matchMedia(q);
      // Запрос, которого браузер не знает, превращается в «not all»
      if (!mq || mq.media === 'not all') return null;
      return mq.matches;
    } catch (e) { return null; }
  }

  /** Что умеет этот браузер для WASM-пути: сборка, MSE по кодекам, экран */
  function support() {
    if (typeof WebAssembly !== 'object') return 'WebAssembly нет';
    var parts = ['сборка ' + (bulkMemory() ? 'быстрая' : 'совместимая (без bulk memory)')];
    var MS = mediaSourceCtor();
    if (!MS) { parts.push('MediaSource нет'); return parts.join(' · '); }
    if (MS !== window.MediaSource) parts.push('ManagedMediaSource');
    var list = [
      ['H.264', 'video/mp4; codecs="avc1.640028"'],
      ['HEVC', 'video/mp4; codecs="hvc1.1.6.L150.B0"'],
      ['HEVC 10 бит', 'video/mp4; codecs="hvc1.2.4.L153.B0"'],
      ['DV P5', 'video/mp4; codecs="dvh1.05.06"'],
      ['DV P8', 'video/mp4; codecs="dvh1.08.06"'],
      ['AAC', 'audio/mp4; codecs="mp4a.40.2"'],
      ['AC3', 'audio/mp4; codecs="ac-3"'],
      ['E-AC3', 'audio/mp4; codecs="ec-3"']
    ];
    var mse = [];
    for (var i = 0; i < list.length; i++) mse.push(list[i][0] + ' ' + (typeOk(list[i][1]) ? 'да' : 'нет'));
    parts.push('MSE: ' + mse.join(', '));
    var hdr = mediaQuery('(dynamic-range: high)'), p3 = mediaQuery('(color-gamut: p3)');
    parts.push('экран: HDR ' + (hdr === null ? 'не сообщает' : hdr ? 'да' : 'нет') + ', P3 ' + (p3 === null ? 'не сообщает' : p3 ? 'да' : 'нет'));
    return parts.join(' · ');
  }

  /** Строка «последний запуск» для «Об устройстве» */
  function lastRunText() {
    var r = last;
    if (!r || !r.at) return 'ещё не запускали';
    var parts = [r.at, r.file || 'без имени'];
    if (!r.used) {
      parts.push('без WASM: ' + (r.why || '?'));
      return parts.join(' · ');
    }
    if (r.stream) parts.push(r.stream);
    if (r.worker) parts.push('воркер ' + r.worker + (r.rev ? ' ' + r.rev : ''));
    if (r.audio) parts.push('звук ' + r.audio);
    if (r.build) parts.push('сборка ' + r.build);
    parts.push('дошёл до: ' + (r.stage || 'запуск воркера'));
    if (r.error) parts.push('ошибка: ' + r.error);
    if (r.videoError) parts.push('ошибка <video>: ' + r.videoError);
    if (r.net) parts.push('сеть: ' + r.net);
    if (r.end) parts.push(r.end);
    if (r.perf) parts.push(r.perf);
    return parts.join(' · ');
  }

  /** Снимок состояния <video> и MSE на конец воспроизведения или ошибку */
  function snapshot(st) {
    var v = st.video, ms = st.ms;
    var b = v.buffered, buf = [];
    for (var i = 0; i < b.length; i++) buf.push(b.start(i).toFixed(1) + '–' + b.end(i).toFixed(1));
    return 'передано ' + (Math.round(st.appended / 104857.6) / 10) + ' МБ, буфер ' + (buf.join(', ') || 'пуст') +
      ', позиция ' + (v.currentTime || 0).toFixed(1) + ' с, readyState ' + v.readyState + ', networkState ' + v.networkState +
      (ms ? ', MediaSource ' + ms.readyState : '') + (v.videoWidth ? ', кадр ' + v.videoWidth + '×' + v.videoHeight : ', кадров нет');
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
      subs: {}, listeners: [], appended: 0, firstAppendAt: 0, played: false,
      mse: { ms: 0, n: 0, t0: 0 }, msePrev: { ms: 0, n: 0 }, perfLine: '', perfVerdict: '', perfLogAt: 0
    };
    last = { at: nowText(), file: fileFromUrl(url), used: true, stage: 'запуск воркера' };
    saveLast();
    startWorker(false);
    on(video, 'seeking', onSeeking);
    on(video, 'loadedmetadata', onLoadedMetadata);
    on(video, 'playing', function () {
      if (!s) return;
      if (!s.played) note({ stage: 'показ пошёл' });
      s.played = true;
    });
    on(video, 'error', onVideoError);
    s.startPending = s.startTime > 0;
    s.tickTimer = setInterval(function () {
      if (!s || !s.worker) return;
      checkStall();
      if (!s) return;
      recoverGap();
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
    note({ worker: useBlob ? 'с зеркала (Blob)' : 'с сервера' });
    var gotMessage = false;
    st.worker.onmessage = function (ev) {
      if (!gotMessage && s === st && !st.info) note({ stage: 'воркер ответил' });
      gotMessage = true;
      if (s === st) onWorker(ev.data);
    };
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
    st.encodeWhy = st.nativeOff ? '' : ac3Why();
    st.encode = !st.nativeOff && !st.encodeWhy ? 'ac3' : 'aac';
    // ?wasm=mvp — отладка: совместимая сборка libav.js, как у браузеров до Chrome 75
    // Файл воркер читает только напрямую с TorrServer/MonoServer — не через сервер TorrStream
    st.worker.postMessage({ type: 'open', url: st.url, base: assetBase(), audio: st.opts.audio >= 0 ? st.opts.audio : 0, time: st.startTime,
      mvp: location.search.indexOf('wasm=mvp') !== -1, native: st.nativeOff ? {} : nativeAudio(),
      // AC3 со всеми каналами вместо AAC 2.0 (Tizen); связку не взял — откат nativeOff
      encode: st.encode,
      auth: torrServerAuth(), dv: !!AppState.dvPreferred,
      // размер файла из списка раздачи: старый Chrome не читает Content-Range
      size: st.opts.size > 0 ? st.opts.size : 0,
      // iPhone: памяти под MediaSource меньше — запас впереди скромнее
      maxAhead: managed() ? 40e6 : 0,
      // ?wasm=libavmux — отладка: фрагменты fMP4 собирает libav, как до 1.0.68
      libavMux: location.search.indexOf('wasm=libavmux') !== -1 });
  }

  /** Вход TorrServer (Basic) из настроек — воркер шлёт его сам */
  function torrServerAuth() {
    try { return (typeof getAuthHeaders === 'function' && getAuthHeaders().Authorization) || ''; } catch (e) { return ''; }
  }

  /** Снять всё: воркер, MediaSource, дорожки субтитров, слушатели */
  function detach() {
    if (!s) return;
    var st = s; s = null;
    if (last && last.used) {
      try { last.end = snapshot(st); } catch (e) { }
      if (st.perfLine) last.perf = st.perfLine + ' → ' + st.perfVerdict;
      saveLast();
    }
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
    if (st.remoteOff) st.video.disableRemotePlayback = false;
  }

  function on(el, type, fn) { el.addEventListener(type, fn); s.listeners.push([el, type, fn]); }

  function fail(code, msg) {
    var st = s;
    if (!st) return;
    note({ error: (code ? code + ': ' : '') + msg }, false);
    console.warn('🧩 WASM: ' + (code ? code + ': ' : '') + msg);
    detach();
    if (st.opts.onError) st.opts.onError(code, msg);
  }

  // ---------- сообщения воркера ----------

  function onWorker(m) {
    if (m.type === 'info') onInfo(m);
    else if (m.type === 'data') {
      if (m.gen !== s.gen) return;
      if (m.t) s.outT = m.t;
      if (s.dump) { s.dump.push(m.bytes); return; }
      s.queue.push(m.bytes); pump();
    }
    else if (m.type === 'eof') { if (m.gen === s.gen) { s.ended = true; pump(); } }
    else if (m.type === 'cues') addCues(m.cues);
    else if (m.type === 'audio') {
      s.audio = m;
      var al = audioLine(s);
      console.log('🧩 WASM: звук ' + al);
      note({ audio: al });
    }
    else if (m.type === 'perf') { if (last && !last.build) note({ build: m.fast ? 'быстрая' : 'совместимая' }, false); onPerf(m.w, m.fast); }
    else if (m.type === 'error') fail(m.code || '', m.msg);
    else if (m.type === 'net') {
      if (!m.ok) note({ net: m.error + ' (попытка ' + m.attempt + ')' });
      if (!m.ok) console.warn('🧩 WASM: TorrServer — ' + m.error + ', повтор ' + m.attempt + ' через ' + (m.delay / 1000) + ' с');
    } else if (m.type === 'log') console.log('🧩 WASM: ' + m.msg);
  }

  function typeOk(t) { try { return mediaSourceCtor().isTypeSupported(t); } catch (e) { return false; } }

  function pad2(n) { return ('0' + n).slice(-2); }

  function onInfo(m) {
    s.info = m;
    // Старый воркер (без rev) сообщения 'audio' не шлёт — строку «звук»
    // собираем из info, чтобы было видно, что AC3 он не умеет
    if (!m.rev && m.audioTracks && m.audio >= 0 && m.audioTracks[m.audio]) {
      var t = m.audioTracks[m.audio], aac = m.aCodec === 'mp4a.40.2';
      s.audio = { from: t.codec, inCh: t.channels, to: aac ? 'aac' : 'copy', outCh: aac ? 2 : t.channels };
      note({ audio: audioLine(s) }, false);
    }
    // Dolby Vision P8 (с базовым HDR10), если в настройках выбран DV: воркер
    // оставляет тег hvc1, но кладёт рядом dvvC. Браузер с поддержкой DV (VIDAA
    // U6: в MSE «dvh1.08 да») по dvvC считает дорожку Dolby Vision, а
    // SourceBuffer заведён под HEVC — и отвергает уже заголовок: «Append:
    // stream parsing failed. Data size=1372». Такому браузеру отдаём строку
    // dvh1.PP.LL; браузер без DV (Chrome на ПК) dvvC пропускает — ему hvc1
    if (m.dv && m.dv.kept && /^hvc1\./.test(m.vCodec || '')) {
      var dvCodec = 'dvh1.' + pad2(m.dv.profile) + '.' + pad2(m.dv.level || 6);
      if (typeOk('video/mp4; codecs="' + dvCodec + (m.aCodec ? ',' + m.aCodec : '') + '"')) {
        console.log('🧩 WASM: Dolby Vision P' + m.dv.profile + '.' + m.dv.compat + ' — браузер его знает, MSE как ' + dvCodec + ' (а не ' + m.vCodec + ')');
        m.vCodec = dvCodec;
      }
    }
    var mime ='video/mp4; codecs="' + m.vCodec + (m.aCodec ? ',' + m.aCodec : '') + '"';
    note({ stage: 'файл разобран', rev: m.rev || 'старый (без версии)', stream: describe() + ' → ' + m.vCodec + (m.aCodec ? ',' + m.aCodec : '') +
      ' (MSE ' + (typeOk(mime) ? 'берёт' : 'не берёт') + ')' });
    console.log('🧩 WASM: ' + m.streams.map(function (x) { return x.codec + (x.channels ? ' ' + x.channels + 'ch' : ''); }).join(', ') + ' → ' + mime +
      (m.dv || (m.hdr && m.hdr !== 'SDR') ? ' · ' + describe() : '') +
      ' · запрос до ' + Math.round((m.chunkMax || 0) / 1048576) + ' МБ');
    if (!typeOk(mime) && location.search.indexOf('wasm=dump') === -1) {
      var vOnly = typeOk('video/mp4; codecs="' + m.vCodec + '"');
      var aOnly = m.aCodec ? typeOk('audio/mp4; codecs="' + m.aCodec + '"') : true;
      console.warn('🧩 WASM: MSE не берёт ' + mime + ' — видео отдельно: ' + (vOnly ? 'да' : 'нет') + (m.aCodec ? ', звук отдельно: ' + (aOnly ? 'да' : 'нет') : ''));
      // Звук шёл как есть (VIDAA) или в AC3 (Tizen), а связку ТВ не берёт —
      // тот же файл с переводом звука в AAC 2.0, без ошибки и с того же места
      if (vOnly && /^(ac-3|ec-3)$/.test(m.aCodec || '') && !s.nativeOff) {
        console.warn('🧩 WASM: звук ' + m.aCodec + ' не в связке с видео — перевожу в AAC');
        s.nativeOff = true;
        s.info = null;
        try { s.worker.terminate(); } catch (e) { }
        startWorker(s.usedBlob);
        return;
      }
      fail('video', vOnly ? 'Браузер не поддерживает связку видео и звука ' + m.vCodec + ' + ' + m.aCodec
        : 'Браузер не поддерживает видео ' + m.vCodec + (m.dv ? ' (Dolby Vision P' + m.dv.profile + ')' : m.hdr && m.hdr !== 'SDR' ? ' (HDR ' + m.hdr + ')' : ''));
      return;
    }
    createSubTracks(m.streams);
    if (s.opts.onInfo) s.opts.onInfo(m);
    // ?wasm=dump — отладка: fMP4 не в MSE, а в WasmPlayback.dump() (ffprobe на ПК)
    if (location.search.indexOf('wasm=dump') !== -1) { s.dump = []; console.log('🧩 WASM: дамп вместо MSE, ' + mime); return; }
    var MS = mediaSourceCtor(), st = s;
    var ms = new MS();
    s.ms = ms;
    // ManagedMediaSource (iPhone) не откроется, пока у <video> разрешён
    // AirPlay, — второго источника для AirPlay у нас нет
    if (managed() && !s.video.disableRemotePlayback) { s.video.disableRemotePlayback = true; s.remoteOff = true; }
    s.objectUrl = URL.createObjectURL(ms);
    ms.addEventListener('sourceopen', function () {
      if (s !== st) return;
      if (m.duration > 0) ms.duration = m.duration;
      try { st.sb = ms.addSourceBuffer(mime); }
      catch (e) { fail('video', 'MediaSource: ' + e.message); return; }
      note({ stage: 'MediaSource открыт' });
      st.sb.mode = 'segments';
      // воркер сдвигает все метки на +offset (fMP4 не любит отрицательные DTS)
      st.sb.timestampOffset = -(m.offset || 0);
      st.sb.addEventListener('updateend', function () {
        if (s !== st) return;
        if (st.mse.t0) { st.mse.ms += performance.now() - st.mse.t0; st.mse.n++; st.mse.t0 = 0; }
        pump(); jumpStartGap();
      });
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
    var keep = Math.max(3, Math.min(20, (managed() ? BEHIND_BYTES / 2 : BEHIND_BYTES) / bps));
    if (b.length && t - b.start(0) > keep * 2) { sb.remove(0, t - keep); return; }
    if (s.queue.length) {
      var chunk = s.queue.shift();
      try {
        s.mse.t0 = performance.now(); sb.appendBuffer(chunk);
        s.appended += chunk.byteLength;
        if (!s.firstAppendAt) { s.firstAppendAt = Date.now(); note({ stage: 'фрагменты идут в <video>' }); }
      }
      catch (e) {
        if (e.name === 'QuotaExceededError') { s.queue.unshift(chunk); sb.remove(0, Math.max(0.1, t - 3)); }
        else fail('video', 'appendBuffer: ' + e.message);
      }
      return;
    }
    if (s.ended && s.ms.readyState === 'open') { try { s.ms.endOfStream(); } catch (e) { } }
  }

  // ---------- поток собран, а показа нет ----------
  //
  // На VIDAA HDR/Dolby Vision через MSE висел на «Буферизации», а потом
  // выпадал с общим «выберите другую раздачу» — по нему не понять, где стоит.
  // Если фрагменты в <video> ушли (впереди больше 2 с или 20+ МБ), а кадров
  // нет STALL_MS — говорим прямо: декодер устройства этот поток не показывает
  var STALL_MS = 25000;

  function describe() {
    var i = s.info || {};
    var d = (i.vCodec || '?') + (i.aCodec ? ' + ' + i.aCodec : '');
    if (i.dv) d += ', Dolby Vision P' + i.dv.profile + '.' + i.dv.compat + (i.dv.kept ? '' : ' как HDR10');
    else if (i.hdr && i.hdr !== 'SDR') d += ', HDR ' + i.hdr;
    return d;
  }

  function checkStall() {
    if (!s.info || s.played || !s.firstAppendAt || s.video.readyState >= 3) return;
    if (Date.now() - s.firstAppendAt < STALL_MS) return;
    if (aheadSeconds() < 2 && s.appended < 20e6) return;   // данных ещё нет — это сеть, не декодер
    var v = s.video;
    console.warn('🧩 WASM: показ не начался за ' + (STALL_MS / 1000) + ' с: readyState ' + v.readyState + ', networkState ' + v.networkState +
      ', буфер ' + bufferedText() + ', передано ' + Math.round(s.appended / 1048576) + ' МБ, ' + describe());
    var hdr = s.info.dv || (s.info.hdr && s.info.hdr !== 'SDR');
    fail('stall', 'Устройство приняло поток, но не показывает его (' + describe() + ')' +
      (hdr ? '. Похоже, HDR через браузер этот телевизор не воспроизводит' : ''));
  }

  // ---------- дыра в буфере под плеером ----------
  //
  // ManagedMediaSource (iPhone) может сам выбросить собранное впереди, когда
  // системе не хватает памяти, а воркер думает, что запас набран, и спит —
  // видео встало бы навсегда. Плеер стоит GAP_MS там, где буфера нет, хотя не
  // перематывается и не на паузе, — собираем заново с этого места
  var GAP_MS = 3000;

  function recoverGap() {
    var v = s.video;
    // Воркер уже отдал данные дальше этого места, а в буфере их нет — их
    // выбросили. Просто медленная сеть (воркер ещё не дошёл) — не дыра
    if (!s.info || !s.played || v.paused || v.seeking || v.ended || v.readyState >= 3 || inBuffer(v.currentTime) ||
      s.queue.length || !(s.outT > v.currentTime + 2)) { s.gapSince = 0; return; }
    if (!s.gapSince) { s.gapSince = Date.now(); return; }
    if (Date.now() - s.gapSince < GAP_MS) return;
    s.gapSince = 0;
    console.warn('🧩 WASM: под плеером нет данных (' + v.currentTime.toFixed(1) + ' c, буфер ' + bufferedText() + ') — собираю заново');
    restart({ type: 'seek' }, v.currentTime);
  }

  function bufferedText() {
    var b = s.video.buffered, out = [];
    for (var i = 0; i < b.length; i++) out.push(b.start(i).toFixed(1) + '–' + b.end(i).toFixed(1));
    return out.join(', ') || 'пуст';
  }

  // Ошибка самого <video> (декодер, MSE) — баннер покажет player.js, а сюда в
  // консоль — подробности: код, текст браузера и что за поток
  function onVideoError() {
    var e = s.video.error;
    note({ videoError: e ? 'код ' + e.code + (e.message ? ' — ' + e.message : '') : '?', end: snapshot(s) });
    console.warn('🧩 WASM: ошибка <video>: ' + (e ? 'код ' + e.code + (e.message ? ' — ' + e.message : '') : '?') +
      ', буфер ' + bufferedText() + ', ' + describe());
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
    s.queue = []; s.ended = false; s.outT = 0;
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

  // ---------- замеры: где теряется время ----------
  //
  // Окно замеров от воркера (за ~2 с) + время appendBuffer в MSE. Сводка —
  // в консоль раз в 5 с и строкой в «Диагностику» плеера (player-diag.js):
  // сеть (скорость TorrServer → браузер и доля простоя разбора в ожидании
  // данных), обработка (во сколько раз быстрее реального времени собирается
  // поток и что ест процессор), плеер (MSE, запас впереди).
  var PERF_LOG_MS = 5000;

  function pct(x) { return Math.round(Math.max(0, Math.min(1, x || 0)) * 100) + ' %'; }

  function aheadSeconds() {
    var v = s.video, b = v.buffered, t = v.currentTime;
    for (var i = 0; i < b.length; i++) if (t >= b.start(i) - 0.3 && t < b.end(i)) return b.end(i) - t;
    return 0;
  }

  function onPerf(w, fast) {
    var active = w.wallMs - w.sleepMs;
    var cpu = w.readMs + w.decMs + w.encMs + w.muxMs;
    var net = w.netBusyMs > 50 ? w.netBytes * 8 / w.netBusyMs / 1000 : null;   // Мбит/с
    var need = s.info && s.info.duration ? s.info.size * 8 / s.info.duration / 1e6 : null;
    var mseN = s.mse.n - s.msePrev.n, mseMs = s.mse.ms - s.msePrev.ms;
    s.msePrev = { ms: s.mse.ms, n: s.mse.n };
    var parts = [];
    parts.push((w.netBytes < 65536 ? 'сеть простаивает' : 'сеть ' + (net !== null ? net.toFixed(1) + ' Мбит/с' : '—')) + (need ? ' (файлу нужно ' + need.toFixed(1) + ')' : '') +
      ', разбор ждал данных ' + pct(active > 0 ? w.waitMs / active : 0));
    if (cpu > 50 && w.mediaSec > 0) {
      parts.push('обработка ×' + (w.mediaSec / (cpu / 1000)).toFixed(1) + ' (разбор ' + pct(w.readMs / cpu) +
        ', декодер звука ' + pct(w.decMs / cpu) + ', кодер ' + (s.info && s.info.aCodec === 'ac-3' ? 'AC3' : 'AAC') + ' ' + pct(w.encMs / cpu) + ', MP4 ' + pct(w.muxMs / cpu) + ')');
    }
    if (active > 200 && w.mediaSec > 0) parts.push('итого ×' + (w.mediaSec / (active / 1000)).toFixed(1));
    if (mseN) parts.push('MSE ' + Math.round(mseMs / mseN) + ' мс/фрагмент');
    parts.push('впереди ' + Math.round(aheadSeconds()) + ' с');
    if (w.sleepMs > 0) parts.push('воркер спал ' + pct(w.sleepMs / w.wallMs));
    if (!fast) parts.push('совместимая сборка');
    s.perfLine = parts.join(' · ');

    // Вывод: кто тормозит
    var v;
    if (w.sleepMs / w.wallMs > 0.5) v = 'запас набран — воркер ждёт, пока плеер его проиграет';
    else if (active > 0 && w.waitMs / active > 0.4) v = 'узкое место — сеть / TorrServer: данные приходят медленнее, чем разбираются';
    else if (cpu > 50 && w.mediaSec > 0 && w.mediaSec / (cpu / 1000) < 1.5) v = 'узкое место — процессор: WASM едва успевает за видео';
    else if (mseN && mseMs / mseN > 300) v = 'узкое место — плеер: MSE долго принимает фрагменты';
    else v = 'поток собирается быстрее, чем играет';
    s.perfVerdict = v;

    var now = Date.now();
    if (now - s.perfLogAt >= PERF_LOG_MS) {
      s.perfLogAt = now;
      console.log('🧩 WASM: ' + s.perfLine + ' → ' + v);
    }
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
    ac3Available: ac3Available,
    ac3Wanted: ac3Wanted,
    available: available,
    // «Об устройстве» (app.js: renderDeviceInfo): почему не включится, что
    // умеет браузер и чем кончился последний запуск
    whyNot: whyNot,
    support: support,
    lastRunText: lastRunText,
    noteSkip: noteSkip,
    attach: attach,
    detach: detach,
    switchAudio: switchAudio,
    active: function () { return !!s; },
    // ?wasm=dump: собранный fMP4 одним массивом
    dump: function () {
      if (!s || !s.dump) return null;
      var n = 0, i; for (i = 0; i < s.dump.length; i++) n += s.dump[i].length;
      var all = new Uint8Array(n), off = 0;
      for (i = 0; i < s.dump.length; i++) { all.set(s.dump[i], off); off += s.dump[i].length; }
      return all;
    },
    // Строка для «Диагностики» плеера: замеры за последние ~2 с и вывод
    statsLine: function () {
      if (!s || !s.perfLine) return null;
      var extra = s.info && (s.info.dv || s.info.hdr !== 'SDR') ? ' · ' + describe() : '';
      var al = audioLine(s);
      return { line: (al ? 'звук ' + al + ' · ' : '') + s.perfLine + extra, verdict: s.perfVerdict };
    },
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
