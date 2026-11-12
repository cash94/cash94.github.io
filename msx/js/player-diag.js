// player-diag.js — «Диагностика» плеера (шестерёнка → Диагностика).
//
// Зачем: на Hisense VIDAA файл играет сам <video> напрямую с TorrServer, и
// бывает, что буфер встаёт, хотя кэш TorrServer полный. Где обрыв — по HUD не
// понять. Панель показывает обе стороны сразу:
//  - <video>: readyState / networkState, запас и диапазоны буфера, растёт ли
//    он, когда браузер последний раз что-то скачал (progress), сколько было
//    waiting / stalled / suspend, пропущенные кадры;
//  - TorrServer (/cache): заполнение кэша, скорость, пиры и, главное, где
//    стоит его читатель (Readers) — ровно то место файла, которое сейчас
//    отдаётся плееру по HTTP. Сдвиг читателя за секунду = сколько браузер
//    реально забирает; сравниваем с позицией просмотра.
// Внизу — вывод «похоже» и журнал событий со временем: пользователь
// фотографирует экран, и по снимку видно, кто перестал работать.
//
// События <video> пишутся в журнал всегда (дёшево), панель и опрос /cache —
// только пока диагностика включена и открыт плеер.
var PlayerDiag = (function () {
  var KEY = 'playerDiag';
  var RENDER_MS = 1000;
  var TS_POLL_MS = 2000;
  var LOG_MAX = 12;
  var STALL_REPORT_MS = 3000;
  var HISTORY_MS = 10000;

  var on = false;
  var video = null;
  var box = null;
  var timer = null;
  var log = [];
  var counts = { waiting: 0, stalled: 0, suspend: 0, error: 0, progress: 0 };
  var lastProgressAt = 0;
  var history = [];          // { at, bufEnd, pos } — рост буфера за HISTORY_MS
  var ts = null, tsAt = 0, tsErr = '', tsInFlight = false;
  var readerPrev = null;     // { at, bytes } — для скорости читателя
  var readerSpeed = null;    // байт/с
  var stallSince = 0, stallReported = false;
  var hlsRef = null;

  var READY = ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA'];
  var NETWORK = ['EMPTY', 'IDLE', 'LOADING', 'NO_SOURCE'];

  function enabled() {
    try { return localStorage.getItem(KEY) === 'true'; } catch (e) { return false; }
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function clock(d) {
    d = d || new Date();
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function fmtTime(s) {
    if (!(s >= 0) || !isFinite(s)) return '—';
    s = Math.floor(s);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ':' + pad(m) : m) + ':' + pad(sec);
  }

  function fmtMb(bytes) {
    if (!(bytes >= 0)) return '—';
    return bytes >= 1024 * 1024 * 1024 ? (bytes / 1073741824).toFixed(2) + ' ГБ' : Math.round(bytes / 1048576) + ' МБ';
  }

  function fmtSpeed(bps) {
    if (bps === null || !isFinite(bps)) return '—';
    return (bps / 1048576).toFixed(bps < 10485760 ? 2 : 1) + ' МБ/с';
  }

  function offset() { return (window.AppState && AppState.seekOffset) || 0; }

  function position() { return video ? video.currentTime + offset() : 0; }

  // Конец того диапазона буфера, в котором сейчас позиция
  function bufferEnd() {
    if (!video || !video.buffered) return null;
    var b = video.buffered, t = video.currentTime;
    for (var i = 0; i < b.length; i++) {
      if (t >= b.start(i) - 0.5 && t <= b.end(i) + 0.5) return b.end(i);
    }
    return null;
  }

  function bufferAhead() {
    var end = bufferEnd();
    return end === null ? 0 : Math.max(0, end - video.currentTime);
  }

  function add(text) {
    log.push(clock() + ' ' + text);
    if (log.length > LOG_MAX) log.shift();
  }

  function eventLine(name) {
    if (!video) return name;
    return name + ' @' + fmtTime(position()) + ' (впереди ' + Math.floor(bufferAhead()) + ' с, rs ' + video.readyState + ', ns ' + video.networkState + ')';
  }

  function onVideoEvent(e) {
    var t = e.type;
    if (t === 'progress') { counts.progress++; lastProgressAt = Date.now(); return; }
    if (counts.hasOwnProperty(t)) counts[t]++;
    // suspend браузер шлёт каждый раз, как добрал запас, — в журнал только
    // когда видео стоит: тогда это и есть «сам перестал качать»
    if (t === 'suspend' && (video.paused || video.readyState >= 3)) return;
    if (t === 'error') {
      var err = video.error;
      add('error' + (err ? ' code ' + err.code + (err.message ? ' ' + err.message : '') : ''));
      return;
    }
    if (t === 'loadstart' || t === 'emptied') {
      history = []; readerPrev = null; readerSpeed = null; stallSince = 0; stallReported = false;
      lastProgressAt = 0;
      counts = { waiting: 0, stalled: 0, suspend: 0, error: 0, progress: 0 };
    }
    // Перемотка — новый отсчёт роста буфера и скорости читателя, иначе скачок
    // позиции выглядит как «буфер +2500 с»
    if (t === 'seeking') { history = []; readerPrev = null; readerSpeed = null; }
    add(eventLine(t));
  }

  var EVENTS = ['loadstart', 'loadedmetadata', 'canplay', 'playing', 'waiting', 'stalled', 'suspend',
    'seeking', 'seeked', 'pause', 'play', 'ended', 'error', 'emptied', 'abort', 'progress'];

  function attachVideo() {
    if (video) return;
    video = document.getElementById('video-player');
    if (!video) return;
    for (var i = 0; i < EVENTS.length; i++) video.addEventListener(EVENTS[i], onVideoEvent);
  }

  function mode() {
    if (window.AndroidJS) return 'Android: нативный плеер';
    if (window.TizenAVPlay && TizenAVPlay.active()) return 'AVPlay (Tizen), файл напрямую с TorrServer';
    if (window.AppState && AppState.hls) {
      return AppState.transcodingOnOff ? 'HLS: транскодирование TorrServer (hls.js)' : 'HLS через сервер TorrStream (hls.js)';
    }
    var src = video && (video.currentSrc || video.src) || '';
    if (/\/stream[/?]/.test(src)) return 'прямой файл с TorrServer (<video> браузера)';
    if (/\.m3u8/.test(src)) return 'HLS встроенным плеером браузера';
    return src ? 'другое' : 'нет источника';
  }

  function platform() {
    var A = window.AppState || {};
    var p = A.platform || '?';
    if (A.vidaaOsVersion) p += ' · VIDAA ' + A.vidaaOsVersion + (A.vidaaDirectPlay ? ' (прямой режим)' : '');
    if (A.tizenVersion) p += ' · Tizen ' + A.tizenVersion;
    return p;
  }

  function ranges() {
    if (!video || !video.buffered || !video.buffered.length) return 'нет';
    var b = video.buffered, out = [], off = offset();
    for (var i = 0; i < b.length && i < 4; i++) out.push(fmtTime(b.start(i) + off) + '–' + fmtTime(b.end(i) + off));
    if (b.length > 4) out.push('… всего ' + b.length);
    return out.join(', ');
  }

  function frames() {
    if (!video) return '';
    try {
      if (typeof video.getVideoPlaybackQuality === 'function') {
        var q = video.getVideoPlaybackQuality();
        return q.totalVideoFrames + ' всего, ' + q.droppedVideoFrames + ' пропущено';
      }
    } catch (e) { }
    if (typeof video.webkitDecodedFrameCount === 'number') {
      return video.webkitDecodedFrameCount + ' декодировано, ' + (video.webkitDroppedFrameCount || 0) + ' пропущено';
    }
    return '';
  }

  // ---------- TorrServer /cache ----------

  function hash() {
    return typeof currentTimecodeData !== 'undefined' && currentTimecodeData && currentTimecodeData.hash;
  }

  function pollTorrServer() {
    var h = hash();
    if (!h || tsInFlight || !window.AppState || !AppState.currentTorrserverUrl) return;
    if (Date.now() - tsAt < TS_POLL_MS) return;
    tsInFlight = true;
    var headers = { 'Content-Type': 'application/json' };
    try {
      var auth = typeof getAuthHeaders === 'function' ? getAuthHeaders() : {};
      for (var k in auth) if (auth.hasOwnProperty(k)) headers[k] = auth[k];
    } catch (e) { }
    var init = { method: 'POST', headers: headers, body: JSON.stringify({ action: 'get', hash: String(h).toLowerCase() }) };
    var url = AppState.currentTorrserverUrl + '/cache';
    var req = window.bgFetch ? window.bgFetch(url, init) : fetch(url, init);
    var asked = Date.now();
    Promise.resolve(req).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      ts = data || null; tsErr = ''; tsAt = Date.now();
      ts._ms = tsAt - asked;
      trackReader();
    }).catch(function (e) {
      tsErr = (e && e.message) || 'ошибка'; tsAt = Date.now();
    }).then(function () { tsInFlight = false; });
  }

  // Смещение и размер текущего файла внутри раздачи: Readers у TorrServer —
  // номера кусков всей раздачи, а позиция просмотра — внутри файла
  function fileSpan() {
    var t = ts && ts.Torrent, id = typeof currentTimecodeData !== 'undefined' && currentTimecodeData ? Number(currentTimecodeData.fileId) : NaN;
    var list = t && t.file_stats;
    if (!list || !list.length || !(id >= 0)) return null;
    var sorted = list.slice().sort(function (a, b) { return a.id - b.id; });
    var off = 0;
    for (var i = 0; i < sorted.length; i++) {
      if (Number(sorted[i].id) === id) return { start: off, length: sorted[i].length || 0 };
      off += sorted[i].length || 0;
    }
    return null;
  }

  // Читатель, ближе всех к позиции просмотра, — тот, что отдаёт файл плееру
  function mainReader() {
    var rs = ts && ts.Readers, pl = ts && ts.PiecesLength;
    if (!rs || !rs.length || !pl) return null;
    var target = playByte();
    var best = rs[0];
    if (target !== null) {
      for (var i = 1; i < rs.length; i++) {
        if (Math.abs(rs[i].Reader * pl - target) < Math.abs(best.Reader * pl - target)) best = rs[i];
      }
    }
    return best;
  }

  function playByte() {
    var span = fileSpan();
    var dur = (window.AppState && (AppState.originalDuration || AppState.expectedDuration)) || (video && video.duration);
    if (!span || !span.length || !(dur > 0) || !isFinite(dur)) return null;
    return span.start + Math.min(1, position() / dur) * span.length;
  }

  function trackReader() {
    var r = mainReader(), pl = ts && ts.PiecesLength;
    if (!r || !pl) { readerPrev = null; readerSpeed = null; return; }
    var now = Date.now(), bytes = r.Reader * pl;
    if (readerPrev && now > readerPrev.at) {
      var d = bytes - readerPrev.bytes;
      // Перемотка — скачок читателя, это не скорость чтения
      readerSpeed = d >= 0 && d < 200 * 1048576 ? d * 1000 / (now - readerPrev.at) : null;
    }
    readerPrev = { at: now, bytes: bytes };
  }

  function tsLines() {
    if (!hash()) return ['TorrServer: нет раздачи'];
    if (!ts) return ['TorrServer: ' + (tsErr ? 'ошибка ' + tsErr : 'запрос…')];
    var t = ts.Torrent || {};
    var lines = [];
    var fill = ts.Capacity ? Math.round(ts.Filled * 100 / ts.Capacity) : null;
    lines.push('TorrServer: кэш ' + fmtMb(ts.Filled) + ' / ' + fmtMb(ts.Capacity) + (fill !== null ? ' (' + fill + '%)' : '') +
      ' · скачивает ' + fmtSpeed(t.download_speed || 0) +
      ' · пиры ' + (t.active_peers || 0) + '/' + (t.total_peers || 0) + ', сиды ' + (t.connected_seeders || 0) +
      ' · ответ ' + ts._ms + ' мс' + (tsErr ? ' · последняя ошибка: ' + tsErr : ''));
    var rs = ts.Readers || [], pl = ts.PiecesLength;
    if (!rs.length) {
      lines.push('Читатель TorrServer: нет — плеер сейчас не держит соединение с /stream');
    } else {
      var r = mainReader(), span = fileSpan(), pb = playByte();
      var inFile = span ? r.Reader * pl - span.start : null;
      var s = 'Читатель TorrServer: кусок ' + r.Reader + (inFile !== null ? ' (' + fmtMb(inFile) + ' от начала файла)' : '') +
        ' · окно ' + r.Start + '–' + r.End + ' · браузер забирает ' + fmtSpeed(readerSpeed);
      if (pb !== null) s += ' · впереди позиции просмотра на ' + fmtMb(r.Reader * pl - pb);
      if (rs.length > 1) s += ' · читателей: ' + rs.length;
      lines.push(s);
    }
    return lines;
  }

  // ---------- вывод ----------

  function growth() {
    if (history.length < 2) return null;
    var a = history[0], b = history[history.length - 1];
    var secs = (b.at - a.at) / 1000;
    if (secs < 3 || a.bufEnd === null || b.bufEnd === null) return null;
    return { secs: secs, buf: b.bufEnd - a.bufEnd, played: b.pos - a.pos };
  }

  function verdict(g) {
    if (!video || !ts) return '';
    var waiting = !video.paused && video.readyState < 3;
    var fill = ts.Capacity ? ts.Filled / ts.Capacity : 0;
    var sinceProgress = lastProgressAt ? (Date.now() - lastProgressAt) / 1000 : null;
    var noRead = readerSpeed !== null && readerSpeed < 64 * 1024;
    var t = ts.Torrent || {};
    if (!(ts.Readers && ts.Readers.length) && mode().indexOf('прямой файл') === 0) {
      return 'Похоже: браузер закрыл соединение с TorrServer и не открывает новое';
    }
    if ((waiting || (g && g.buf < 1)) && noRead && fill > 0.9) {
      return 'Похоже: данные у TorrServer есть, но браузер их не запрашивает' +
        (video.networkState === 1 ? ' (networkState IDLE — сам остановил загрузку)' : '') +
        (sinceProgress !== null ? ', progress ' + Math.round(sinceProgress) + ' с назад' : '');
    }
    if ((waiting || (g && g.buf < 1)) && readerSpeed > 256 * 1024) {
      return 'Похоже: браузер забирает данные, но буфер не растёт — не успевает разобрать или декодировать';
    }
    if ((waiting || (g && g.buf < g.played * 0.8)) && fill < 0.9 && (t.download_speed || 0) < 1048576) {
      return 'Похоже: TorrServer не успевает скачивать — мало скорости или пиров';
    }
    return '';
  }

  function checkStall() {
    if (!video) return;
    var waiting = !video.paused && !video.seeking && video.readyState < 3 && !!(video.currentSrc || video.src);
    if (waiting) {
      if (!stallSince) { stallSince = Date.now(); stallReported = false; }
      if (!stallReported && Date.now() - stallSince >= STALL_REPORT_MS) {
        stallReported = true;
        var fill = ts && ts.Capacity ? Math.round(ts.Filled * 100 / ts.Capacity) + '%' : '?';
        add('СТОП ' + Math.round((Date.now() - stallSince) / 1000) + ' с: ' + eventLine('').trim() +
          ', кэш TS ' + fill + ', браузер забирает ' + fmtSpeed(readerSpeed));
      }
    } else if (stallSince) {
      if (stallReported) add('пошло через ' + Math.round((Date.now() - stallSince) / 1000) + ' с');
      stallSince = 0; stallReported = false;
    }
  }

  function watchHls() {
    var h = window.AppState && AppState.hls;
    if (!h || h === hlsRef || typeof Hls === 'undefined') { if (!h) hlsRef = null; return; }
    hlsRef = h;
    try {
      h.on(Hls.Events.ERROR, function (ev, d) {
        add('hls ' + (d && d.details) + (d && d.fatal ? ' (fatal)' : ''));
      });
    } catch (e) { }
  }

  function hlsLine() {
    var h = window.AppState && AppState.hls;
    if (!h) return '';
    var lvl = h.levels && h.levels[h.currentLevel];
    return 'hls.js ' + (typeof Hls !== 'undefined' ? Hls.version : '') +
      ' · оценка канала ' + fmtSpeed((h.bandwidthEstimate || 0) / 8) +
      (lvl ? ' · уровень ' + h.currentLevel + ' ' + (lvl.width || '?') + '×' + (lvl.height || '?') : '');
  }

  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) { return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'; });
  }

  function render() {
    attachVideo();
    if (!box) box = document.getElementById('player-diag');
    var inPlayer = window.AppState && AppState.currentScreen === 'player';
    if (!box || !video) return;
    if (!on || !inPlayer) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    watchHls();
    pollTorrServer();

    var now = Date.now();
    history.push({ at: now, bufEnd: bufferEnd() === null ? null : bufferEnd() + offset(), pos: position() });
    while (history.length > 2 && now - history[0].at > HISTORY_MS) history.shift();
    checkStall();

    var g = growth();
    var dur = (AppState.originalDuration || AppState.expectedDuration) || video.duration;
    var sinceProgress = lastProgressAt ? Math.round((now - lastProgressAt) / 1000) + ' с назад' : 'не было';
    var lines = [];
    lines.push('ДИАГНОСТИКА ' + clock() + ' · ' + mode() + ' · ' + platform());
    lines.push('Видео: ' + fmtTime(position()) + ' / ' + fmtTime(dur) + ' · ' + (video.paused ? 'пауза' : 'играет') +
      (video.seeking ? ' · перемотка' : '') +
      ' · readyState ' + video.readyState + ' ' + (READY[video.readyState] || '') +
      ' · сеть ' + video.networkState + ' ' + (NETWORK[video.networkState] || '') +
      (video.videoWidth ? ' · ' + video.videoWidth + '×' + video.videoHeight : ''));
    // «Подряд» — без дыр от текущей позиции; HUD считает до конца последнего
    // диапазона, и при дыре в буфере (бывает после перемотки) числа разные
    var bufLine = 'Буфер: подряд ' + Math.floor(bufferAhead()) + ' с';
    if (video.buffered && video.buffered.length) {
      bufLine += ', до конца последнего диапазона ' +
        Math.max(0, Math.floor(video.buffered.end(video.buffered.length - 1) - video.currentTime)) + ' с';
    }
    bufLine += ' · диапазоны ' + ranges();
    if (g) bufLine += ' · за ' + Math.round(g.secs) + ' с: буфер +' + g.buf.toFixed(1) + ' с, просмотрено ' + g.played.toFixed(1) + ' с';
    else if (window.TizenAVPlay && TizenAVPlay.active()) bufLine += ' · AVPlay запас не сообщает';
    lines.push(bufLine);
    lines.push('Загрузка браузером: progress ' + sinceProgress + ' · waiting ×' + counts.waiting +
      ' · stalled ×' + counts.stalled + ' · suspend ×' + counts.suspend + (counts.error ? ' · error ×' + counts.error : ''));
    var fr = frames();
    if (fr) lines.push('Кадры: ' + fr);
    var hl = hlsLine();
    if (hl) lines.push(hl);
    lines = lines.concat(tsLines());
    var v = verdict(g);

    var html = '';
    for (var i = 0; i < lines.length; i++) html += '<div>' + esc(lines[i]) + '</div>';
    if (v) html += '<div class="player-diag-verdict">' + esc(v) + '</div>';
    if (log.length) {
      html += '<div class="player-diag-log">';
      for (var j = log.length - 1; j >= 0; j--) html += '<div>' + esc(log[j]) + '</div>';
      html += '</div>';
    }
    box.innerHTML = html;
  }

  function setEnabled(value) {
    on = !!value;
    try { localStorage.setItem(KEY, on ? 'true' : 'false'); } catch (e) { }
    if (on && !timer) timer = setInterval(render, RENDER_MS);
    if (!on && timer) { clearInterval(timer); timer = null; }
    if (on) add('диагностика включена');
    render();
  }

  function init() {
    attachVideo();
    on = enabled();
    if (on && !timer) timer = setInterval(render, RENDER_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { enabled: function () { return on; }, setEnabled: setEnabled, render: render };
})();
window.PlayerDiag = PlayerDiag;
