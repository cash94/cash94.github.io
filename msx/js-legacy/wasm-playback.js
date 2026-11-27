/* Сборка для старых браузеров (Chrome 53) из js/wasm-playback.js — tools/legacy-build/build.js. Руками не править. */
var WasmPlayback = function () {
  var MIRROR_BASE = 'https://cash94.github.io/msx/js/';
  var TICK_MS = 500;
  var BEHIND_BYTES = 30e6;
  var s = null;
  function eligible(opts) {
    if (!AppState.transcodingFullOnOff) return false;
    try {
      if (localStorage.getItem('wasmPlaybackOff') === 'true') return false;
    } catch (e) {}
    return available(opts);
  }
  function mediaSourceCtor() {
    if (typeof window.MediaSource === 'function' && typeof MediaSource.isTypeSupported === 'function') return window.MediaSource;
    if (typeof window.ManagedMediaSource === 'function' && typeof ManagedMediaSource.isTypeSupported === 'function') return window.ManagedMediaSource;
    return null;
  }
  function appleBuiltIn() {
    var ap = typeof getApplePlayer === 'function' ? getApplePlayer() : null;
    return !ap || !ap.template;
  }
  function available(opts) {
    return !unavailableWhy(opts);
  }
  function unavailableWhy(opts) {
    if (window.AndroidJS) return 'приложение Android — файл играет свой плеер';
    if (typeof WebAssembly !== 'object') return 'браузер без WebAssembly';
    if (typeof Worker !== 'function') return 'браузер без Web Worker';
    if (!mediaSourceCtor()) return 'браузер без MediaSource (MSE)';
    var p = AppState.platform,
      apple = AppState.applePlatform;
    if (apple === 'apple_tv') return 'Apple TV — внешний плеер';
    if (apple === 'apple') return appleBuiltIn() ? '' : 'выбран внешний плеер';
    if (p === 'tizen' || AppState.tizenApp) return opts && opts.audioUnsupported ? '' : 'Tizen — только для звука DTS/TrueHD, остальное играет AVPlay';
    if (p === 'webos') return 'webOS играет файл сам';
    if (p === 'ios' || p === 'android' || p === 'androidtv') return 'внешний плеер';
    if (p === 'vidaa' && AppState.vidaaDirectPlay) return 'VIDAA 9.5+ играет файл сам';
    return '';
  }
  function whyNot(opts) {
    if (!AppState.transcodingFullOnOff) return 'включено перекодирование — WASM работает только в прямом режиме';
    try {
      if (localStorage.getItem('wasmPlaybackOff') === 'true') return 'выключен в настройках плеера';
    } catch (e) {}
    return unavailableWhy(opts);
  }
  function managed() {
    return mediaSourceCtor() !== window.MediaSource;
  }
  function isLocal() {
    return location.search.indexOf('local=1') !== -1;
  }
  var nativeLogged = false;
  function nativeAudio() {
    var force = location.search.indexOf('wasm=native') !== -1;
    if (!force) return {};
    var cand = {
        ac3: 'ac-3',
        eac3: 'ec-3',
        aac: 'mp4a.40.2'
      },
      out = {},
      seen = [];
    for (var k in cand) {
      var ok = force;
      ok = ok || typeOk('video/mp4; codecs="avc1.640028,' + cand[k] + '"');
      if (ok) out[k] = cand[k];
      seen.push(cand[k] + (ok ? ' да' : ' нет'));
    }
    if (!nativeLogged) {
      nativeLogged = true;
      console.log('🧩 WASM: звук как есть (MSE, связка с H.264): ' + seen.join(', '));
    }
    return out;
  }
  function ac3Available() {
    return AppState.platform === 'tizen' || !!AppState.tizenApp;
  }
  function ac3Wanted() {
    return !ac3Why();
  }
  function ac3Why() {
    if (location.search.indexOf('wasm=ac3') !== -1) return '';
    if (!ac3Available()) return 'не Tizen';
    try {
      if (localStorage.getItem('dtsToAc3Off') === 'true') return 'выключено в настройках плеера';
    } catch (e) {}
    return typeOk('audio/mp4; codecs="ac-3"') ? '' : 'MSE не берёт ac-3';
  }
  var AUDIO_NAMES = {
    dts: 'DTS',
    dca: 'DTS',
    truehd: 'TrueHD',
    mlp: 'MLP',
    eac3: 'E-AC3',
    ac3: 'AC3',
    aac: 'AAC',
    flac: 'FLAC',
    opus: 'Opus',
    mp3: 'MP3',
    mp2: 'MP2',
    vorbis: 'Vorbis',
    alac: 'ALAC'
  };
  var CH_NAMES = {
    1: '1.0',
    2: '2.0',
    3: '2.1',
    5: '5.0',
    6: '5.1',
    7: '6.1',
    8: '7.1'
  };
  function audioName(c) {
    return AUDIO_NAMES[c] || (/^pcm/.test(c || '') ? 'PCM' : String(c || '?').toUpperCase());
  }
  function chName(n) {
    return n > 0 ? CH_NAMES[n] || n + ' кан.' : '';
  }
  function audioLine(st) {
    var a = st.audio;
    if (!a) return '';
    var from = audioName(a.from) + (a.inCh ? ' ' + chName(a.inCh) : '');
    var line;
    if (a.to === 'copy') line = from + ' как есть';else line = from + ' → ' + (a.to === 'ac3' ? 'AC3 (Dolby Digital)' : audioName(a.to)) + (a.outCh ? ' ' + chName(a.outCh) : '');
    if (a.coreOnly) line += ', только ядро DTS';
    if (st.encode === 'ac3' && a.to !== 'ac3' && a.to !== 'copy') line += ' (AC3 просили — воркер старый, ' + (st.info && st.info.rev ? st.info.rev : 'без версии') + ')';else if (a.to === 'aac' && ac3Available()) line += ' (не AC3: ' + (st.nativeOff ? 'связку видео + ac-3 MSE не взял' : st.encodeWhy || '?') + ')';
    return line;
  }
  function assetBase() {
    return (isLocal() ? location.origin + '/js/' : MIRROR_BASE) + 'wasm-audio';
  }
  function createWorker(useBlob) {
    if (!useBlob) return new Worker(tsWorkerUrl('wasm-audio-worker.js'));
    var src = (isLocal() ? location.origin + '/js/' : MIRROR_BASE) + 'wasm-audio-worker.js';
    var blob = new Blob(['importScripts(' + JSON.stringify(src) + ');'], {
      type: 'application/javascript'
    });
    return new Worker(URL.createObjectURL(blob));
  }
  var LAST_KEY = 'wasmLastRun';
  var last = null;
  try {
    last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null');
  } catch (e) {
    last = null;
  }
  function saveLast() {
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify(last));
    } catch (e) {}
  }
  function note(fields, save) {
    if (!last) last = {};
    for (var k in fields) last[k] = fields[k];
    if (save !== false) saveLast();
  }
  function nowText() {
    var d = new Date();
    function two(n) {
      return (n < 10 ? '0' : '') + n;
    }
    return two(d.getDate()) + '.' + two(d.getMonth() + 1) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
  }
  function fileFromUrl(url) {
    var m = /\/stream\/([^?]+)/.exec(url || '');
    if (!m) return 'без имени';
    try {
      return decodeURIComponent(m[1]);
    } catch (e) {
      return m[1];
    }
  }
  function noteSkip(reason, fileName) {
    last = {
      at: nowText(),
      file: fileName || 'без имени',
      used: false,
      why: reason || whyNot() || '?'
    };
    saveLast();
  }
  function bulkMemory() {
    var bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 3, 1, 0, 1, 10, 14, 1, 12, 0, 65, 0, 65, 0, 65, 0, 252, 10, 0, 0, 11]);
    try {
      return WebAssembly.validate(bytes);
    } catch (e) {
      return false;
    }
  }
  function mediaQuery(q) {
    if (!window.matchMedia) return null;
    try {
      var mq = window.matchMedia(q);
      if (!mq || mq.media === 'not all') return null;
      return mq.matches;
    } catch (e) {
      return null;
    }
  }
  function support() {
    if (typeof WebAssembly !== 'object') return 'WebAssembly нет';
    var parts = ['сборка ' + (bulkMemory() ? 'быстрая' : 'совместимая (без bulk memory)')];
    var MS = mediaSourceCtor();
    if (!MS) {
      parts.push('MediaSource нет');
      return parts.join(' · ');
    }
    if (MS !== window.MediaSource) parts.push('ManagedMediaSource');
    var list = [['H.264', 'video/mp4; codecs="avc1.640028"'], ['HEVC', 'video/mp4; codecs="hvc1.1.6.L150.B0"'], ['HEVC 10 бит', 'video/mp4; codecs="hvc1.2.4.L153.B0"'], ['DV P5', 'video/mp4; codecs="dvh1.05.06"'], ['DV P8', 'video/mp4; codecs="dvh1.08.06"'], ['AAC', 'audio/mp4; codecs="mp4a.40.2"'], ['AC3', 'audio/mp4; codecs="ac-3"'], ['E-AC3', 'audio/mp4; codecs="ec-3"']];
    var mse = [];
    for (var i = 0; i < list.length; i++) mse.push(list[i][0] + ' ' + (typeOk(list[i][1]) ? 'да' : 'нет'));
    parts.push('MSE: ' + mse.join(', '));
    var hdr = mediaQuery('(dynamic-range: high)'),
      p3 = mediaQuery('(color-gamut: p3)');
    parts.push('экран: HDR ' + (hdr === null ? 'не сообщает' : hdr ? 'да' : 'нет') + ', P3 ' + (p3 === null ? 'не сообщает' : p3 ? 'да' : 'нет'));
    return parts.join(' · ');
  }
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
  function snapshot(st) {
    var v = st.video,
      ms = st.ms;
    var b = v.buffered,
      buf = [];
    for (var i = 0; i < b.length; i++) buf.push(b.start(i).toFixed(1) + '–' + b.end(i).toFixed(1));
    return 'передано ' + Math.round(st.appended / 104857.6) / 10 + ' МБ, буфер ' + (buf.join(', ') || 'пуст') + ', позиция ' + (v.currentTime || 0).toFixed(1) + ' с, readyState ' + v.readyState + ', networkState ' + v.networkState + (ms ? ', MediaSource ' + ms.readyState : '') + (v.videoWidth ? ', кадр ' + v.videoWidth + '×' + v.videoHeight : ', кадров нет');
  }
  function attach(video, url, opts) {
    detach();
    s = {
      video: video,
      url: url,
      opts: opts || {},
      worker: null,
      usedBlob: false,
      ms: null,
      sb: null,
      queue: [],
      gen: 0,
      info: null,
      ended: false,
      needClear: false,
      selfSeek: false,
      startTime: opts && opts.time > 0 ? opts.time : 0,
      tickTimer: null,
      objectUrl: null,
      subs: {},
      listeners: [],
      appended: 0,
      firstAppendAt: 0,
      played: false,
      mse: {
        ms: 0,
        n: 0,
        t0: 0
      },
      msePrev: {
        ms: 0,
        n: 0
      },
      perfLine: '',
      perfVerdict: '',
      perfLogAt: 0
    };
    last = {
      at: nowText(),
      file: fileFromUrl(url),
      used: true,
      stage: 'запуск воркера'
    };
    saveLast();
    startWorker(false);
    on(video, 'seeking', onSeeking);
    on(video, 'loadedmetadata', onLoadedMetadata);
    on(video, 'playing', function () {
      if (!s) return;
      if (!s.played) note({
        stage: 'показ пошёл'
      });
      s.played = true;
    });
    on(video, 'error', onVideoError);
    s.startPending = s.startTime > 0;
    s.tickTimer = setInterval(function () {
      if (!s || !s.worker) return;
      checkStall();
      if (!s) return;
      recoverGap();
      var t = s.startPending ? s.startTime : s.video.currentTime;
      s.worker.postMessage({
        type: 'tick',
        time: t
      });
    }, TICK_MS);
  }
  function startWorker(useBlob) {
    var st = s;
    try {
      st.worker = createWorker(useBlob);
    } catch (e) {
      fail('', 'Не удалось запустить воркер: ' + e.message);
      return;
    }
    st.usedBlob = useBlob;
    note({
      worker: useBlob ? 'с зеркала (Blob)' : 'с сервера'
    });
    var gotMessage = false;
    st.worker.onmessage = function (ev) {
      if (!gotMessage && s === st && !st.info) note({
        stage: 'воркер ответил'
      });
      gotMessage = true;
      if (s === st) onWorker(ev.data);
    };
    st.worker.onerror = function (e) {
      if (s !== st) return;
      if (!gotMessage && !st.usedBlob) {
        try {
          st.worker.terminate();
        } catch (x) {}
        startWorker(true);
        return;
      }
      fail('', 'Ошибка воркера: ' + (e && e.message || ''));
    };
    st.encodeWhy = st.nativeOff ? '' : ac3Why();
    st.encode = !st.nativeOff && !st.encodeWhy ? 'ac3' : 'aac';
    st.worker.postMessage({
      type: 'open',
      url: st.url,
      base: assetBase(),
      audio: st.opts.audio >= 0 ? st.opts.audio : 0,
      time: st.startTime,
      mvp: location.search.indexOf('wasm=mvp') !== -1,
      native: st.nativeOff ? {} : nativeAudio(),
      encode: st.encode,
      auth: torrServerAuth(),
      dv: !!AppState.dvPreferred,
      size: st.opts.size > 0 ? st.opts.size : 0,
      maxAhead: managed() ? 40e6 : 0,
      libavMux: location.search.indexOf('wasm=libavmux') !== -1
    });
  }
  function torrServerAuth() {
    try {
      return typeof getAuthHeaders === 'function' && getAuthHeaders().Authorization || '';
    } catch (e) {
      return '';
    }
  }
  function detach() {
    if (!s) return;
    var st = s;
    s = null;
    if (last && last.used) {
      try {
        last.end = snapshot(st);
      } catch (e) {}
      if (st.perfLine) last.perf = st.perfLine + ' → ' + st.perfVerdict;
      saveLast();
    }
    clearInterval(st.tickTimer);
    try {
      if (st.worker) st.worker.terminate();
    } catch (e) {}
    for (var i = 0; i < st.listeners.length; i++) {
      var l = st.listeners[i];
      l[0].removeEventListener(l[1], l[2]);
    }
    for (var k in st.subs) {
      if (st.subs[k].el && st.subs[k].el.parentNode) st.subs[k].el.parentNode.removeChild(st.subs[k].el);
    }
    if (st.ms && st.ms.readyState === 'open') {
      try {
        st.ms.endOfStream();
      } catch (e) {}
    }
    if (st.objectUrl) {
      if (st.video.src === st.objectUrl) {
        st.video.removeAttribute('src');
        try {
          st.video.load();
        } catch (e) {}
      }
      try {
        URL.revokeObjectURL(st.objectUrl);
      } catch (e) {}
    }
    if (st.remoteOff) st.video.disableRemotePlayback = false;
  }
  function on(el, type, fn) {
    el.addEventListener(type, fn);
    s.listeners.push([el, type, fn]);
  }
  function fail(code, msg) {
    var st = s;
    if (!st) return;
    note({
      error: (code ? code + ': ' : '') + msg
    }, false);
    console.warn('🧩 WASM: ' + (code ? code + ': ' : '') + msg);
    detach();
    if (st.opts.onError) st.opts.onError(code, msg);
  }
  function onWorker(m) {
    if (m.type === 'info') onInfo(m);else if (m.type === 'data') {
      if (m.gen !== s.gen) return;
      if (m.t) s.outT = m.t;
      if (s.dump) {
        s.dump.push(m.bytes);
        return;
      }
      s.queue.push(m.bytes);
      pump();
    } else if (m.type === 'eof') {
      if (m.gen === s.gen) {
        s.ended = true;
        pump();
      }
    } else if (m.type === 'cues') addCues(m.cues);else if (m.type === 'audio') {
      s.audio = m;
      var al = audioLine(s);
      console.log('🧩 WASM: звук ' + al);
      note({
        audio: al
      });
    } else if (m.type === 'perf') {
      if (last && !last.build) note({
        build: m.fast ? 'быстрая' : 'совместимая'
      }, false);
      onPerf(m.w, m.fast);
    } else if (m.type === 'error') fail(m.code || '', m.msg);else if (m.type === 'net') {
      if (!m.ok) note({
        net: m.error + ' (попытка ' + m.attempt + ')'
      });
      if (!m.ok) console.warn('🧩 WASM: TorrServer — ' + m.error + ', повтор ' + m.attempt + ' через ' + m.delay / 1000 + ' с');
    } else if (m.type === 'log') console.log('🧩 WASM: ' + m.msg);
  }
  function typeOk(t) {
    try {
      return mediaSourceCtor().isTypeSupported(t);
    } catch (e) {
      return false;
    }
  }
  function pad2(n) {
    return ('0' + n).slice(-2);
  }
  function onInfo(m) {
    s.info = m;
    if (!m.rev && m.audioTracks && m.audio >= 0 && m.audioTracks[m.audio]) {
      var t = m.audioTracks[m.audio],
        aac = m.aCodec === 'mp4a.40.2';
      s.audio = {
        from: t.codec,
        inCh: t.channels,
        to: aac ? 'aac' : 'copy',
        outCh: aac ? 2 : t.channels
      };
      note({
        audio: audioLine(s)
      }, false);
    }
    if (m.dv && m.dv.kept && /^hvc1\./.test(m.vCodec || '')) {
      var dvCodec = 'dvh1.' + pad2(m.dv.profile) + '.' + pad2(m.dv.level || 6);
      if (typeOk('video/mp4; codecs="' + dvCodec + (m.aCodec ? ',' + m.aCodec : '') + '"')) {
        console.log('🧩 WASM: Dolby Vision P' + m.dv.profile + '.' + m.dv.compat + ' — браузер его знает, MSE как ' + dvCodec + ' (а не ' + m.vCodec + ')');
        m.vCodec = dvCodec;
      }
    }
    var mime = 'video/mp4; codecs="' + m.vCodec + (m.aCodec ? ',' + m.aCodec : '') + '"';
    note({
      stage: 'файл разобран',
      rev: m.rev || 'старый (без версии)',
      stream: describe() + ' → ' + m.vCodec + (m.aCodec ? ',' + m.aCodec : '') + ' (MSE ' + (typeOk(mime) ? 'берёт' : 'не берёт') + ')'
    });
    console.log('🧩 WASM: ' + m.streams.map(function (x) {
      return x.codec + (x.channels ? ' ' + x.channels + 'ch' : '');
    }).join(', ') + ' → ' + mime + (m.dv || m.hdr && m.hdr !== 'SDR' ? ' · ' + describe() : '') + ' · запрос до ' + Math.round((m.chunkMax || 0) / 1048576) + ' МБ');
    if (!typeOk(mime) && location.search.indexOf('wasm=dump') === -1) {
      var vOnly = typeOk('video/mp4; codecs="' + m.vCodec + '"');
      var aOnly = m.aCodec ? typeOk('audio/mp4; codecs="' + m.aCodec + '"') : true;
      console.warn('🧩 WASM: MSE не берёт ' + mime + ' — видео отдельно: ' + (vOnly ? 'да' : 'нет') + (m.aCodec ? ', звук отдельно: ' + (aOnly ? 'да' : 'нет') : ''));
      if (vOnly && /^(ac-3|ec-3)$/.test(m.aCodec || '') && !s.nativeOff) {
        console.warn('🧩 WASM: звук ' + m.aCodec + ' не в связке с видео — перевожу в AAC');
        s.nativeOff = true;
        s.info = null;
        try {
          s.worker.terminate();
        } catch (e) {}
        startWorker(s.usedBlob);
        return;
      }
      fail('video', vOnly ? 'Браузер не поддерживает связку видео и звука ' + m.vCodec + ' + ' + m.aCodec : 'Браузер не поддерживает видео ' + m.vCodec + (m.dv ? ' (Dolby Vision P' + m.dv.profile + ')' : m.hdr && m.hdr !== 'SDR' ? ' (HDR ' + m.hdr + ')' : ''));
      return;
    }
    createSubTracks(m.streams);
    if (s.opts.onInfo) s.opts.onInfo(m);
    if (location.search.indexOf('wasm=dump') !== -1) {
      s.dump = [];
      console.log('🧩 WASM: дамп вместо MSE, ' + mime);
      return;
    }
    var MS = mediaSourceCtor(),
      st = s;
    var ms = new MS();
    s.ms = ms;
    if (managed() && !s.video.disableRemotePlayback) {
      s.video.disableRemotePlayback = true;
      s.remoteOff = true;
    }
    s.objectUrl = URL.createObjectURL(ms);
    ms.addEventListener('sourceopen', function () {
      if (s !== st) return;
      if (m.duration > 0) ms.duration = m.duration;
      try {
        st.sb = ms.addSourceBuffer(mime);
      } catch (e) {
        fail('video', 'MediaSource: ' + e.message);
        return;
      }
      note({
        stage: 'MediaSource открыт'
      });
      st.sb.mode = 'segments';
      st.sb.timestampOffset = -(m.offset || 0);
      st.sb.addEventListener('updateend', function () {
        if (s !== st) return;
        if (st.mse.t0) {
          st.mse.ms += performance.now() - st.mse.t0;
          st.mse.n++;
          st.mse.t0 = 0;
        }
        pump();
        jumpStartGap();
      });
      pump();
    });
    s.video.src = s.objectUrl;
  }
  function pump() {
    var sb = s && s.sb;
    if (!sb || sb.updating) return;
    if (s.needClear) {
      s.needClear = false;
      try {
        sb.abort();
      } catch (e) {}
      sb.timestampOffset = -(s.info.offset || 0);
      if (sb.buffered.length) {
        sb.remove(0, Infinity);
        return;
      }
    }
    var b = sb.buffered,
      t = s.video.currentTime;
    var bps = s.info.duration ? s.info.size / s.info.duration : 1e6;
    var keep = Math.max(3, Math.min(20, (managed() ? BEHIND_BYTES / 2 : BEHIND_BYTES) / bps));
    if (b.length && t - b.start(0) > keep * 2) {
      sb.remove(0, t - keep);
      return;
    }
    if (s.queue.length) {
      var chunk = s.queue.shift();
      try {
        s.mse.t0 = performance.now();
        sb.appendBuffer(chunk);
        s.appended += chunk.byteLength;
        if (!s.firstAppendAt) {
          s.firstAppendAt = Date.now();
          note({
            stage: 'фрагменты идут в <video>'
          });
        }
      } catch (e) {
        if (e.name === 'QuotaExceededError') {
          s.queue.unshift(chunk);
          sb.remove(0, Math.max(0.1, t - 3));
        } else fail('video', 'appendBuffer: ' + e.message);
      }
      return;
    }
    if (s.ended && s.ms.readyState === 'open') {
      try {
        s.ms.endOfStream();
      } catch (e) {}
    }
  }
  var STALL_MS = 25000;
  function describe() {
    var i = s.info || {};
    var d = (i.vCodec || '?') + (i.aCodec ? ' + ' + i.aCodec : '');
    if (i.dv) d += ', Dolby Vision P' + i.dv.profile + '.' + i.dv.compat + (i.dv.kept ? '' : ' как HDR10');else if (i.hdr && i.hdr !== 'SDR') d += ', HDR ' + i.hdr;
    return d;
  }
  function checkStall() {
    if (!s.info || s.played || !s.firstAppendAt || s.video.readyState >= 3) return;
    if (Date.now() - s.firstAppendAt < STALL_MS) return;
    if (aheadSeconds() < 2 && s.appended < 20e6) return;
    var v = s.video;
    console.warn('🧩 WASM: показ не начался за ' + STALL_MS / 1000 + ' с: readyState ' + v.readyState + ', networkState ' + v.networkState + ', буфер ' + bufferedText() + ', передано ' + Math.round(s.appended / 1048576) + ' МБ, ' + describe());
    var hdr = s.info.dv || s.info.hdr && s.info.hdr !== 'SDR';
    fail('stall', 'Устройство приняло поток, но не показывает его (' + describe() + ')' + (hdr ? '. Похоже, HDR через браузер этот телевизор не воспроизводит' : ''));
  }
  var GAP_MS = 3000;
  function recoverGap() {
    var v = s.video;
    if (!s.info || !s.played || v.paused || v.seeking || v.ended || v.readyState >= 3 || inBuffer(v.currentTime) || s.queue.length || !(s.outT > v.currentTime + 2)) {
      s.gapSince = 0;
      return;
    }
    if (!s.gapSince) {
      s.gapSince = Date.now();
      return;
    }
    if (Date.now() - s.gapSince < GAP_MS) return;
    s.gapSince = 0;
    console.warn('🧩 WASM: под плеером нет данных (' + v.currentTime.toFixed(1) + ' c, буфер ' + bufferedText() + ') — собираю заново');
    restart({
      type: 'seek'
    }, v.currentTime);
  }
  function bufferedText() {
    var b = s.video.buffered,
      out = [];
    for (var i = 0; i < b.length; i++) out.push(b.start(i).toFixed(1) + '–' + b.end(i).toFixed(1));
    return out.join(', ') || 'пуст';
  }
  function onVideoError() {
    var e = s.video.error;
    note({
      videoError: e ? 'код ' + e.code + (e.message ? ' — ' + e.message : '') : '?',
      end: snapshot(s)
    });
    console.warn('🧩 WASM: ошибка <video>: ' + (e ? 'код ' + e.code + (e.message ? ' — ' + e.message : '') : '?') + ', буфер ' + bufferedText() + ', ' + describe());
  }
  function inBuffer(t) {
    var b = s.video.buffered;
    for (var i = 0; i < b.length; i++) if (t >= b.start(i) && t < b.end(i) - 0.3) return true;
    return false;
  }
  function jumpStartGap() {
    var v = s.video,
      b = v.buffered;
    if (!b.length || v.seeking) return;
    var t = v.currentTime;
    for (var i = 0; i < b.length; i++) {
      if (t >= b.start(i) && t < b.end(i)) return;
      if (b.start(i) > t && b.start(i) - t < 10) {
        s.selfSeek = true;
        v.currentTime = b.start(i) + 0.01;
        return;
      }
    }
  }
  function onLoadedMetadata() {
    if (s.startTime > 0 && s.video.currentTime < s.startTime - 1) {
      s.selfSeek = true;
      s.video.currentTime = s.startTime;
    }
    s.startPending = false;
  }
  function onSeeking() {
    if (s.selfSeek) {
      s.selfSeek = false;
      return;
    }
    if (!s.info || inBuffer(s.video.currentTime)) return;
    restart({
      type: 'seek'
    }, s.video.currentTime);
  }
  function restart(msg, time) {
    s.gen++;
    s.queue = [];
    s.ended = false;
    s.outT = 0;
    msg.time = time;
    msg.gen = s.gen;
    s.worker.postMessage(msg);
    s.needClear = true;
    pump();
  }
  function switchAudio(index) {
    if (!s || !s.worker) return false;
    var t = s.video.currentTime;
    restart({
      type: 'audio',
      index: index
    }, t);
    s.selfSeek = true;
    s.video.currentTime = t;
    return true;
  }
  var PERF_LOG_MS = 5000;
  function pct(x) {
    return Math.round(Math.max(0, Math.min(1, x || 0)) * 100) + ' %';
  }
  function aheadSeconds() {
    var v = s.video,
      b = v.buffered,
      t = v.currentTime;
    for (var i = 0; i < b.length; i++) if (t >= b.start(i) - 0.3 && t < b.end(i)) return b.end(i) - t;
    return 0;
  }
  function onPerf(w, fast) {
    var active = w.wallMs - w.sleepMs;
    var cpu = w.readMs + w.decMs + w.encMs + w.muxMs;
    var net = w.netBusyMs > 50 ? w.netBytes * 8 / w.netBusyMs / 1000 : null;
    var need = s.info && s.info.duration ? s.info.size * 8 / s.info.duration / 1e6 : null;
    var mseN = s.mse.n - s.msePrev.n,
      mseMs = s.mse.ms - s.msePrev.ms;
    s.msePrev = {
      ms: s.mse.ms,
      n: s.mse.n
    };
    var parts = [];
    parts.push((w.netBytes < 65536 ? 'сеть простаивает' : 'сеть ' + (net !== null ? net.toFixed(1) + ' Мбит/с' : '—')) + (need ? ' (файлу нужно ' + need.toFixed(1) + ')' : '') + ', разбор ждал данных ' + pct(active > 0 ? w.waitMs / active : 0));
    if (cpu > 50 && w.mediaSec > 0) {
      parts.push('обработка ×' + (w.mediaSec / (cpu / 1000)).toFixed(1) + ' (разбор ' + pct(w.readMs / cpu) + ', декодер звука ' + pct(w.decMs / cpu) + ', кодер ' + (s.info && s.info.aCodec === 'ac-3' ? 'AC3' : 'AAC') + ' ' + pct(w.encMs / cpu) + ', MP4 ' + pct(w.muxMs / cpu) + ')');
    }
    if (active > 200 && w.mediaSec > 0) parts.push('итого ×' + (w.mediaSec / (active / 1000)).toFixed(1));
    if (mseN) parts.push('MSE ' + Math.round(mseMs / mseN) + ' мс/фрагмент');
    parts.push('впереди ' + Math.round(aheadSeconds()) + ' с');
    if (w.sleepMs > 0) parts.push('воркер спал ' + pct(w.sleepMs / w.wallMs));
    if (!fast) parts.push('совместимая сборка');
    s.perfLine = parts.join(' · ');
    var v;
    if (w.sleepMs / w.wallMs > 0.5) v = 'запас набран — воркер ждёт, пока плеер его проиграет';else if (active > 0 && w.waitMs / active > 0.4) v = 'узкое место — сеть / TorrServer: данные приходят медленнее, чем разбираются';else if (cpu > 50 && w.mediaSec > 0 && w.mediaSec / (cpu / 1000) < 1.5) v = 'узкое место — процессор: WASM едва успевает за видео';else if (mseN && mseMs / mseN > 300) v = 'узкое место — плеер: MSE долго принимает фрагменты';else v = 'поток собирается быстрее, чем играет';
    s.perfVerdict = v;
    var now = Date.now();
    if (now - s.perfLogAt >= PERF_LOG_MS) {
      s.perfLogAt = now;
      console.log('🧩 WASM: ' + s.perfLine + ' → ' + v);
    }
  }
  function createSubTracks(list) {
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      if (x.type !== 'subtitle') continue;
      var el = document.createElement('track');
      el.kind = 'subtitles';
      el.label = 'Субтитры ' + (Object.keys(s.subs).length + 1) + (x.text ? '' : ' (' + x.codec + ')');
      el.src = 'data:text/vtt,WEBVTT%0A';
      var sub = {
        el: el,
        cues: [],
        seen: {},
        loaded: false
      };
      el.addEventListener('load', flushCues.bind(null, sub));
      s.subs[x.index] = sub;
      s.video.appendChild(el);
    }
  }
  function flushCues(sub) {
    sub.loaded = true;
    for (var i = 0; i < sub.cues.length; i++) {
      try {
        sub.el.track.addCue(sub.cues[i]);
      } catch (e) {}
    }
  }
  function addCues(cues) {
    for (var i = 0; i < cues.length; i++) {
      var c = cues[i],
        sub = s.subs[c.s];
      if (!sub) continue;
      var key = c.a.toFixed(3) + '|' + c.t;
      if (sub.seen[key]) continue;
      sub.seen[key] = 1;
      var cue;
      try {
        cue = new VTTCue(c.a, c.b, c.t);
      } catch (e) {
        continue;
      }
      sub.cues.push(cue);
      if (sub.loaded) {
        try {
          sub.el.track.addCue(cue);
        } catch (e) {}
      }
    }
  }
  return {
    eligible: eligible,
    ac3Available: ac3Available,
    ac3Wanted: ac3Wanted,
    available: available,
    whyNot: whyNot,
    support: support,
    lastRunText: lastRunText,
    noteSkip: noteSkip,
    attach: attach,
    detach: detach,
    switchAudio: switchAudio,
    active: function () {
      return !!s;
    },
    dump: function () {
      if (!s || !s.dump) return null;
      var n = 0,
        i;
      for (i = 0; i < s.dump.length; i++) n += s.dump[i].length;
      var all = new Uint8Array(n),
        off = 0;
      for (i = 0; i < s.dump.length; i++) {
        all.set(s.dump[i], off);
        off += s.dump[i].length;
      }
      return all;
    },
    statsLine: function () {
      if (!s || !s.perfLine) return null;
      var extra = s.info && (s.info.dv || s.info.hdr !== 'SDR') ? ' · ' + describe() : '';
      var al = audioLine(s);
      return {
        line: (al ? 'звук ' + al + ' · ' : '') + s.perfLine + extra,
        verdict: s.perfVerdict
      };
    },
    report: function () {
      return new Promise(function (resolve) {
        if (!s || !s.worker) {
          resolve(null);
          return;
        }
        var w = s.worker;
        var t = setTimeout(function () {
          resolve(null);
        }, 3000);
        w.addEventListener('message', function once(ev) {
          if (ev.data && ev.data.type === 'mem') {
            clearTimeout(t);
            w.removeEventListener('message', once);
            resolve(ev.data.mem);
          }
        });
        w.postMessage({
          type: 'mem'
        });
      });
    }
  };
}();
