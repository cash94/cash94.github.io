/* Сборка для старых браузеров (Chrome 53) из js/wasm-playback.js — tools/legacy-build/build.js. Руками не править. */
var WasmPlayback = function () {
  var MIRROR_BASE = 'https://cash94.github.io/msx/js/';
  var TICK_MS = 500;
  var BEHIND_BYTES = 30e6;
  var s = null;
  function eligible() {
    if (!AppState.transcodingFullOnOff || window.AndroidJS) return false;
    var p = AppState.platform;
    if (p === 'webos' || p === 'tizen' || p === 'ios' || p === 'android' || p === 'androidtv' || AppState.tizenApp) return false;
    if (AppState.applePlatform === 'apple_tv' || AppState.applePlatform === 'apple') return false;
    if (p === 'vidaa' && AppState.vidaaDirectPlay) return false;
    return typeof WebAssembly === 'object' && typeof Worker === 'function' && typeof window.MediaSource === 'function' && typeof MediaSource.isTypeSupported === 'function';
  }
  function isLocal() {
    return location.search.indexOf('local=1') !== -1;
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
      listeners: []
    };
    startWorker(false);
    on(video, 'seeking', onSeeking);
    on(video, 'loadedmetadata', onLoadedMetadata);
    s.startPending = s.startTime > 0;
    s.tickTimer = setInterval(function () {
      if (!s || !s.worker) return;
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
    var gotMessage = false;
    st.worker.onmessage = function (ev) {
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
    st.worker.postMessage({
      type: 'open',
      url: st.url,
      base: assetBase(),
      audio: st.opts.audio >= 0 ? st.opts.audio : 0,
      time: st.startTime,
      mvp: location.search.indexOf('wasm=mvp') !== -1
    });
  }
  function detach() {
    if (!s) return;
    var st = s;
    s = null;
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
  }
  function on(el, type, fn) {
    el.addEventListener(type, fn);
    s.listeners.push([el, type, fn]);
  }
  function fail(code, msg) {
    var st = s;
    if (!st) return;
    console.warn('🧩 WASM: ' + (code ? code + ': ' : '') + msg);
    detach();
    if (st.opts.onError) st.opts.onError(code, msg);
  }
  function onWorker(m) {
    if (m.type === 'info') onInfo(m);else if (m.type === 'data') {
      if (m.gen === s.gen) {
        s.queue.push(m.bytes);
        pump();
      }
    } else if (m.type === 'eof') {
      if (m.gen === s.gen) {
        s.ended = true;
        pump();
      }
    } else if (m.type === 'cues') addCues(m.cues);else if (m.type === 'error') fail(m.code || '', m.msg);else if (m.type === 'net') {
      if (!m.ok) console.warn('🧩 WASM: TorrServer — ' + m.error + ', повтор ' + m.attempt + ' через ' + m.delay / 1000 + ' с');
    } else if (m.type === 'log') console.log('🧩 WASM: ' + m.msg);
  }
  function onInfo(m) {
    s.info = m;
    var mime = 'video/mp4; codecs="' + m.vCodec + (m.aCodec ? ',' + m.aCodec : '') + '"';
    console.log('🧩 WASM: ' + m.streams.map(function (x) {
      return x.codec + (x.channels ? ' ' + x.channels + 'ch' : '');
    }).join(', ') + ' → ' + mime);
    if (!MediaSource.isTypeSupported(mime)) {
      fail('video', 'Браузер не поддерживает видео ' + m.vCodec);
      return;
    }
    createSubTracks(m.streams);
    if (s.opts.onInfo) s.opts.onInfo(m);
    var ms = new MediaSource(),
      st = s;
    s.ms = ms;
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
      st.sb.mode = 'segments';
      st.sb.timestampOffset = -(m.offset || 0);
      st.sb.addEventListener('updateend', function () {
        if (s === st) {
          pump();
          jumpStartGap();
        }
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
    var keep = Math.max(3, Math.min(20, BEHIND_BYTES / bps));
    if (b.length && t - b.start(0) > keep * 2) {
      sb.remove(0, t - keep);
      return;
    }
    if (s.queue.length) {
      var chunk = s.queue.shift();
      try {
        sb.appendBuffer(chunk);
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
    attach: attach,
    detach: detach,
    switchAudio: switchAudio,
    active: function () {
      return !!s;
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
