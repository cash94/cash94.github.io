/* Сборка для старых браузеров (Chrome 53) из js/tizen-avplay.js — tools/legacy-build/build.js. Руками не править. */
var TizenAVPlay = function () {
  var video = null;
  var holder = null;
  var subsBox = null;
  var subsTimer = null;
  var styleObserver = null;
  var url = '';
  var prepared = false;
  var ended = false;
  var seekingTo = null;
  var error = null;
  var tracksCache = null;
  var pendingAudio = -1;
  var pendingText = null;
  var textIndex = -1;
  var wantAudio = -1;
  var wantText = -1;
  var trackChecks = 0;
  var trackCheckAt = 0;
  var trackChecksTotal = 0;
  var suspended = false;
  var wantPlay = false;
  var pendingSeek = null;
  var lastRect = '';
  var rectOnPlay = false;
  var rectRedo = 0;
  var rectRedoAt = 0;
  var OVERRIDES = ['src', 'load', 'play', 'pause', 'currentTime', 'duration', 'paused', 'ended', 'readyState', 'seeking', 'buffered', 'error', 'videoWidth', 'videoHeight', 'audioTracks', 'textTracks', 'removeAttribute'];
  function av() {
    return window.webapis && webapis.avplay;
  }
  function enabled() {
    if (!window.AppState || !AppState.tizenApp || !av()) return false;
    try {
      if (localStorage.getItem('tizenAvplay') === '0') return false;
    } catch (e) {}
    return true;
  }
  function state() {
    try {
      return av().getState();
    } catch (e) {
      return 'NONE';
    }
  }
  function fire(name) {
    if (!video) return;
    var ev;
    try {
      ev = new Event(name);
    } catch (e) {
      ev = document.createEvent('Event');
      ev.initEvent(name, false, false);
    }
    video.dispatchEvent(ev);
  }
  function parseExtra(t) {
    try {
      return JSON.parse(t.extra_info || '{}') || {};
    } catch (e) {
      return {};
    }
  }
  function trackInfo() {
    if (tracksCache) return tracksCache;
    var list = [];
    try {
      list = av().getTotalTrackInfo() || [];
    } catch (e) {
      return [];
    }
    if (prepared) tracksCache = list;
    return list;
  }
  function tracksOf(type) {
    var out = [],
      list = trackInfo();
    for (var i = 0; i < list.length; i++) {
      if (list[i].type === type) out.push({
        index: parseInt(list[i].index, 10),
        extra: parseExtra(list[i])
      });
    }
    out.sort(function (a, b) {
      return a.index - b.index;
    });
    return out;
  }
  function currentIndex(type) {
    try {
      var info = av().getCurrentStreamInfo() || [];
      for (var i = 0; i < info.length; i++) if (info[i].type === type) return parseInt(info[i].index, 10);
    } catch (e) {}
    return -1;
  }
  function trimLang(code) {
    return String(code || '').replace(/^\s+|\s+$/g, '');
  }
  function langName(code) {
    code = String(code || '').replace(/^\s+|\s+$/g, '');
    var key = code.toLowerCase();
    if (!key || key === 'und' || key === 'unknown' || key === '(null)') return '';
    var names = window.LANG_NAMES || {};
    return names[key] || (code.length <= 3 ? code.toUpperCase() : code);
  }
  function audioLabel(x) {
    var tech = [];
    if (x.fourCC) tech.push(String(x.fourCC).toUpperCase());
    var ch = parseInt(x.channels, 10);
    if (ch) tech.push(ch === 6 ? '5.1' : ch === 8 ? '7.1' : ch === 2 ? 'стерео' : ch === 1 ? 'моно' : ch + ' кан.');
    var name = langName(x.language);
    return [name, tech.join(' ')].filter(function (p) {
      return p;
    }).join(' · ');
  }
  function textLabel(x) {
    return langName(x.track_lang || x.language);
  }
  function selectTrack(type, index) {
    av().setSelectTrack(type, index);
    var s = state();
    if (s === 'PLAYING' || s === 'PAUSED') {
      rectRedo = 3;
      rectRedoAt = Date.now() + 300;
    }
  }
  function redoRect() {
    if (rectRedo <= 0) return;
    var now = Date.now();
    if (now < rectRedoAt) return;
    rectRedo--;
    rectRedoAt = now + 1000;
    lastRect = '';
    syncRect();
  }
  function selectAudio(i) {
    var list = tracksOf('AUDIO');
    if (!prepared) {
      pendingAudio = i;
      return;
    }
    if (!list[i]) return;
    wantAudio = list[i].index;
    try {
      selectTrack('AUDIO', wantAudio);
    } catch (e) {
      console.warn('AVPlay: звук не переключился', e && e.message);
    }
    checkTracksLater();
  }
  function selectText(i) {
    if (!prepared) {
      pendingText = i;
      return;
    }
    textIndex = i;
    showSubtitle('', 0);
    if (i < 0) {
      wantText = -1;
      try {
        av().setSilentSubtitle(true);
      } catch (e) {}
      return;
    }
    var list = tracksOf('TEXT');
    if (!list[i]) return;
    wantText = list[i].index;
    try {
      selectTrack('TEXT', wantText);
      av().setSilentSubtitle(false);
    } catch (e) {
      console.warn('AVPlay: субтитры не включились', e && e.message);
    }
    checkTracksLater();
  }
  var TRACK_CHECKS = 4;
  var TRACK_CHECK_MS = 1000;
  function checkTracksLater() {
    if (wantAudio < 0 && wantText < 0) return;
    trackChecks = TRACK_CHECKS;
    trackCheckAt = Date.now() + TRACK_CHECK_MS;
  }
  function enforceTracks() {
    if (trackChecks <= 0 || seekingTo !== null) return;
    var s = state();
    if (s !== 'PLAYING' && s !== 'PAUSED') return;
    var now = Date.now();
    if (now < trackCheckAt) return;
    trackCheckAt = now + TRACK_CHECK_MS;
    var first = trackChecks === TRACK_CHECKS;
    trackChecks--;
    trackChecksTotal++;
    var settled = true,
      diag = [];
    if (wantAudio >= 0) {
      var a = currentIndex('AUDIO');
      diag.push('звук ' + wantAudio + '/' + (a >= 0 ? a : '?'));
      if (a !== wantAudio && (a >= 0 || first)) {
        try {
          selectTrack('AUDIO', wantAudio);
        } catch (e) {}
      }
      if (a >= 0 && a !== wantAudio) settled = false;
    }
    if (wantText >= 0) {
      var t = currentIndex('TEXT');
      diag.push('субтитры ' + wantText + '/' + (t >= 0 ? t : '?'));
      if (t !== wantText && (t >= 0 || first)) {
        try {
          selectTrack('TEXT', wantText);
          av().setSilentSubtitle(false);
        } catch (e) {}
      }
      if (t >= 0 && t !== wantText) settled = false;
    }
    window.tizenAvplayTrackDiag = 'сверка ' + trackChecksTotal + ': ' + diag.join(', ') + (settled ? '' : ' → включаем заново');
    if (settled) trackChecks = 0;
  }
  function trackListObject() {
    var listeners = {};
    var obj = {
      length: 0
    };
    obj.addEventListener = function (type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    };
    obj.removeEventListener = function (type, fn) {
      var l = listeners[type] || [];
      for (var i = l.length - 1; i >= 0; i--) if (l[i] === fn) l.splice(i, 1);
    };
    obj._fire = function (type) {
      var l = (listeners[type] || []).slice();
      for (var i = 0; i < l.length; i++) {
        try {
          l[i]({
            type: type
          });
        } catch (e) {}
      }
    };
    obj._set = function (items) {
      for (var k = 0; k < obj.length; k++) delete obj[k];
      for (var j = 0; j < items.length; j++) obj[j] = items[j];
      obj.length = items.length;
    };
    return obj;
  }
  var audioList = trackListObject();
  var textList = trackListObject();
  function buildAudioList() {
    var tracks = tracksOf('AUDIO'),
      cur = currentIndex('AUDIO'),
      items = [];
    for (var i = 0; i < tracks.length; i++) {
      (function (i, t) {
        var item = {
          id: String(t.index),
          kind: 'main',
          label: audioLabel(t.extra),
          language: trimLang(t.extra.language)
        };
        Object.defineProperty(item, 'enabled', {
          get: function () {
            var c = currentIndex('AUDIO');
            return c >= 0 ? c === t.index : i === 0;
          },
          set: function (v) {
            if (v) selectAudio(i);
          }
        });
        items.push(item);
      })(i, tracks[i]);
    }
    audioList._set(items);
    return cur;
  }
  function buildTextList() {
    var tracks = tracksOf('TEXT'),
      items = [];
    for (var i = 0; i < tracks.length; i++) {
      (function (i, t) {
        var item = {
          id: String(t.index),
          kind: 'subtitles',
          label: textLabel(t.extra),
          language: trimLang(t.extra.track_lang || t.extra.language),
          cues: null,
          activeCues: null
        };
        Object.defineProperty(item, 'mode', {
          get: function () {
            return textIndex === i ? 'showing' : 'disabled';
          },
          set: function (v) {
            if (v === 'showing') selectText(i);else if (textIndex === i || !prepared && pendingText === i) selectText(-1);
          }
        });
        items.push(item);
      })(i, tracks[i]);
    }
    textList._set(items);
    var raw = trackInfo(),
      parts = [];
    for (var k = 0; k < raw.length; k++) {
      if (raw[k].type === 'AUDIO' || raw[k].type === 'TEXT') parts.push(raw[k].type.charAt(0) + raw[k].index + ' ' + (raw[k].extra_info || ''));
    }
    window.tizenAvplayDiag = parts.join(' | ');
  }
  function showSubtitle(text, durationMs) {
    if (!subsBox) return;
    clearTimeout(subsTimer);
    var clean = String(text || '').replace(/\{\\[^}]*\}/g, '').replace(/<[^>]+>/g, '').replace(/\\N/g, '\n');
    subsBox.textContent = clean;
    subsBox.style.display = clean ? 'block' : 'none';
    if (clean && durationMs > 0) subsTimer = setTimeout(function () {
      showSubtitle('', 0);
    }, durationMs);
  }
  function syncRect() {
    if (!video || !prepared) return;
    var r = video.getBoundingClientRect();
    var sw = window.innerWidth || 1920,
      sh = window.innerHeight || 1080;
    var k = 1920 / sw,
      ky = 1080 / sh;
    var over = r.left < -1 || r.top < -1 || r.right > sw + 1 || r.bottom > sh + 1;
    var x = over ? 0 : Math.round(r.left * k),
      y = over ? 0 : Math.round(r.top * ky);
    var w = over ? 1920 : Math.round(r.width * k),
      h = over ? 1080 : Math.round(r.height * ky);
    var laidOut = !!(w && h);
    if (!laidOut) {
      x = 0;
      y = 0;
      w = 1920;
      h = 1080;
    }
    var method = over ? 'PLAYER_DISPLAY_MODE_CROPPED_FULL' : laidOut && stretched(r.width / r.height) ? 'PLAYER_DISPLAY_MODE_FULL_SCREEN' : 'PLAYER_DISPLAY_MODE_LETTER_BOX';
    var key = x + ',' + y + ',' + w + ',' + h + method;
    if (key === lastRect) return;
    lastRect = laidOut ? key : '';
    try {
      av().setDisplayRect(x, y, w, h);
    } catch (e) {}
    try {
      av().setDisplayMethod(method);
    } catch (e) {
      try {
        av().setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
      } catch (e2) {}
    }
  }
  function stretched(boxRatio) {
    var info = videoInfo();
    var vw = parseInt(info.Width, 10),
      vh = parseInt(info.Height, 10);
    if (!vw || !vh || !boxRatio) return false;
    return Math.abs(boxRatio / (vw / vh) - 1) > 0.02;
  }
  function rectAfterStart() {
    if (rectOnPlay || !video || !prepared) return;
    rectOnPlay = true;
    fire('resize');
    lastRect = '';
    syncRect();
  }
  function videoInfo() {
    try {
      var info = av().getCurrentStreamInfo() || [];
      for (var i = 0; i < info.length; i++) if (info[i].type === 'VIDEO') return parseExtra(info[i]);
    } catch (e) {}
    return {};
  }
  function listener() {
    return {
      onbufferingstart: function () {
        fire('waiting');
      },
      onbufferingprogress: function () {},
      onbufferingcomplete: function () {
        if (state() === 'PLAYING') fire('playing');
      },
      oncurrentplaytime: function () {
        rectAfterStart();
        enforceTracks();
        redoRect();
        if (seekingTo === null) fire('timeupdate');
      },
      onstreamcompleted: function () {
        ended = true;
        try {
          av().pause();
        } catch (e) {}
        fire('pause');
        fire('ended');
      },
      onerror: function (type) {
        error = {
          code: 4,
          message: 'AVPlay: ' + type
        };
        fire('error');
      },
      onevent: function () {},
      onsubtitlechange: function (duration, text) {
        showSubtitle(text, parseInt(duration, 10) || 0);
      },
      ondrmevent: function () {}
    };
  }
  function open(newUrl) {
    closePlayer();
    url = newUrl || '';
    prepared = false;
    ended = false;
    seekingTo = null;
    error = null;
    tracksCache = null;
    pendingAudio = -1;
    pendingText = null;
    textIndex = -1;
    lastRect = '';
    rectOnPlay = false;
    wantAudio = -1;
    wantText = -1;
    trackChecks = 0;
    trackCheckAt = 0;
    trackChecksTotal = 0;
    rectRedo = 0;
    rectRedoAt = 0;
    window.tizenAvplayTrackDiag = '';
    wantPlay = false;
    pendingSeek = null;
    audioList._set([]);
    textList._set([]);
    if (!url) return true;
    try {
      av().open(url);
      av().setListener(listener());
      av().setDisplayRect(0, 0, 1920, 1080);
      av().setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
    } catch (e) {
      console.warn('AVPlay: файл не открылся — играет обычный <video>', e && e.message);
      return false;
    }
    return true;
  }
  function prepare() {
    if (!url || prepared) return;
    var forUrl = url;
    try {
      av().prepareAsync(function () {
        if (!video || url !== forUrl) return;
        prepared = true;
        tracksCache = null;
        var cur = buildAudioList();
        buildTextList();
        if (pendingAudio >= 0) selectAudio(pendingAudio);else if (cur >= 0) {}
        if (pendingText !== null) selectText(pendingText);else {
          try {
            av().setSilentSubtitle(true);
          } catch (e) {}
        }
        syncRect();
        fire('durationchange');
        fire('loadedmetadata');
        fire('resize');
        textList._fire('addtrack');
        fire('loadeddata');
        if (pendingSeek !== null) {
          var t = pendingSeek;
          pendingSeek = null;
          video.currentTime = t;
        }
        if (wantPlay) {
          wantPlay = false;
          video.play();
        }
        fire('canplay');
      }, function (e) {
        prepareFailed(forUrl, e && (e.message || e.name));
      });
    } catch (e) {
      prepareFailed(forUrl, e && e.message);
    }
  }
  function prepareFailed(forUrl, why) {
    if (!video || url !== forUrl) return;
    console.warn('AVPlay: prepare не удался (' + why + ') — играет обычный <video>');
    var v = video;
    fallbackToVideo(forUrl);
    try {
      v.load();
    } catch (e) {}
  }
  function closePlayer() {
    clearTimeout(subsTimer);
    showSubtitle('', 0);
    if (state() !== 'NONE') {
      try {
        av().stop();
      } catch (e) {}
      try {
        av().close();
      } catch (e) {}
    }
    prepared = false;
  }
  function fallbackToVideo(u) {
    var v = video;
    detach();
    if (!v) return;
    v.src = u;
  }
  function onVisibility() {
    if (!video || !prepared) return;
    try {
      if (document.hidden) {
        if (!suspended) {
          av().suspend();
          suspended = true;
        }
      } else if (suspended) {
        suspended = false;
        av().restore();
        lastRect = '';
        syncRect();
      }
    } catch (e) {}
  }
  function define(name, desc) {
    desc.configurable = true;
    Object.defineProperty(video, name, desc);
  }
  function attach(v) {
    if (!enabled() || !v) return false;
    if (video === v) return true;
    if (video) detach();
    video = v;
    var ps = v.parentNode;
    holder = document.createElement('object');
    holder.id = 'tizen-avplay';
    holder.setAttribute('type', 'application/avplayer');
    holder.className = 'tizen-avplay-object';
    if (ps) ps.insertBefore(holder, v);
    subsBox = document.createElement('div');
    subsBox.id = 'tizen-avplay-subs';
    subsBox.style.display = 'none';
    if (ps) ps.insertBefore(subsBox, v.nextSibling);
    document.documentElement.classList.add('tizen-avplay');
    define('src', {
      get: function () {
        return url;
      },
      set: function (u) {
        if (!open(u)) fallbackToVideo(u);
      }
    });
    define('load', {
      value: function () {
        prepare();
      }
    });
    define('play', {
      value: function () {
        if (!prepared) {
          if (url) wantPlay = true;
          return Promise.resolve();
        }
        try {
          if (ended) {
            ended = false;
            av().seekTo(0);
          }
          av().play();
        } catch (e) {}
        fire('play');
        fire('playing');
        return Promise.resolve();
      }
    });
    define('pause', {
      value: function () {
        wantPlay = false;
        if (prepared) {
          try {
            av().pause();
          } catch (e) {}
          fire('pause');
        }
      }
    });
    define('currentTime', {
      get: function () {
        if (seekingTo !== null) return seekingTo;
        if (!prepared) return pendingSeek || 0;
        try {
          return (av().getCurrentTime() || 0) / 1000;
        } catch (e) {
          return 0;
        }
      },
      set: function (t) {
        t = Math.max(0, Number(t) || 0);
        if (!prepared) {
          if (url) pendingSeek = t;
          return;
        }
        seekingTo = t;
        ended = false;
        fire('seeking');
        var done = function () {
          seekingTo = null;
          checkTracksLater();
          fire('seeked');
          fire('timeupdate');
        };
        try {
          av().seekTo(Math.round(t * 1000), done, done);
        } catch (e) {
          done();
        }
      }
    });
    define('duration', {
      get: function () {
        try {
          return (av().getDuration() || 0) / 1000;
        } catch (e) {
          return 0;
        }
      }
    });
    define('paused', {
      get: function () {
        var s = state();
        return s !== 'PLAYING';
      }
    });
    define('ended', {
      get: function () {
        return ended;
      }
    });
    define('readyState', {
      get: function () {
        return prepared ? 4 : 0;
      }
    });
    define('seeking', {
      get: function () {
        return seekingTo !== null;
      }
    });
    define('buffered', {
      get: function () {
        return {
          length: 0,
          start: function () {
            return 0;
          },
          end: function () {
            return 0;
          }
        };
      }
    });
    define('error', {
      get: function () {
        return error;
      }
    });
    define('videoWidth', {
      get: function () {
        return parseInt(videoInfo().Width, 10) || 0;
      }
    });
    define('videoHeight', {
      get: function () {
        return parseInt(videoInfo().Height, 10) || 0;
      }
    });
    define('audioTracks', {
      get: function () {
        return audioList;
      }
    });
    define('textTracks', {
      get: function () {
        return textList;
      }
    });
    define('removeAttribute', {
      value: function (name) {
        if (String(name).toLowerCase() === 'src') {
          closePlayer();
          url = '';
          return;
        }
        return HTMLElement.prototype.removeAttribute.call(video, name);
      }
    });
    if (typeof MutationObserver === 'function') {
      styleObserver = new MutationObserver(syncRect);
      styleObserver.observe(v, {
        attributes: true,
        attributeFilter: ['style', 'class']
      });
    }
    window.addEventListener('resize', syncRect);
    document.addEventListener('visibilitychange', onVisibility);
    if (window.AppState) AppState.tizenAvplayActive = true;
    return true;
  }
  function detach() {
    if (!video) return;
    closePlayer();
    url = '';
    for (var i = 0; i < OVERRIDES.length; i++) {
      try {
        delete video[OVERRIDES[i]];
      } catch (e) {}
    }
    if (styleObserver) {
      styleObserver.disconnect();
      styleObserver = null;
    }
    window.removeEventListener('resize', syncRect);
    document.removeEventListener('visibilitychange', onVisibility);
    if (holder && holder.parentNode) holder.parentNode.removeChild(holder);
    if (subsBox && subsBox.parentNode) subsBox.parentNode.removeChild(subsBox);
    holder = null;
    subsBox = null;
    video = null;
    suspended = false;
    audioList._set([]);
    textList._set([]);
    document.documentElement.classList.remove('tizen-avplay');
    if (window.AppState) AppState.tizenAvplayActive = false;
  }
  return {
    enabled: enabled,
    attach: attach,
    detach: detach,
    active: function () {
      return !!video;
    }
  };
}();
window.TizenAVPlay = TizenAVPlay;
