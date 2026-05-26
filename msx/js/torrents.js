// torrents.js - Оптимизированный модуль работы с TorrServer, поиском и плеером
// Совместим с Android TV (Chromium 70+), сохраняет сетку 6 колонок, ускоряет рендеринг и навигацию

// ==================== СОСТОЯНИЕ И КОНФИГУРАЦИЯ ====================
var searchResults = [];
var filteredResults = [];
var currentSearchQuery = '';
var currentSearchMode = 'globalsearch';
var globalSearchResults = [];
var currentSort = 'date-desc';
var currentQualityFilter = 'all';
var currentTrackerFilter = 'all';
var currentYearFilter = '';
var currentSeasonFilter = 'all';
var currentVoiceFilter = 'all';
var currentvideotypeFilter = 'all';
var availableTrackers = [];
var availableSeasons = [];
var availableVoices = [];
var availablevideotype = [];
var lastAddedTorrentHash = null;
var lastPlaybackFromSearch = false;
var torrentDeleteHoldTimers = new WeakMap();
var TORRENT_DELETE_HOLD_MS = 900;
var suppressTorrentClickUntil = 0;
var pendingRemoteHoldHash = null;

// Кэши с лимитами
var progressCache = new Map();
var torrentFilesCache = new Map();
var seasonCache = new Map();
var MAX_CACHE_SIZE = 200;

// Опции UI
var SORT_OPTIONS = [
  { value: 'date-desc', label: 'Сначала новые' }, { value: 'date-asc', label: 'Сначала старые' },
  { value: 'size-desc', label: 'Размер ↓' }, { value: 'size-asc', label: 'Размер ↑' },
  { value: 'sid-desc', label: 'Сиды ↓' }, { value: 'sid-asc', label: 'Сиды ↑' },
  { value: 'pir-desc', label: 'Пиры ↓' }, { value: 'pir-asc', label: 'Пиры ↑' }
];
var QUALITY_OPTIONS = [
  { value: 'all', label: 'Все' }, { value: '2160', label: '4K (2160p)' }, { value: '1080', label: 'Full HD (1080p)' },
  { value: '720', label: 'HD (720p)' }, { value: '480', label: 'SD (480p)' }, { value: '360', label: '360p' }
];

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function escapeHtml(s) { if (!s) return ''; return String(s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m] || m; }); }
function formatBytes(b) { if (!b) return '0 B'; var k = 1024, s = ['B', 'KB', 'MB', 'GB', 'TB'], i = Math.floor(Math.log(b) / Math.log(k)); return parseFloat((b / Math.pow(k, i)).toFixed(2)) + ' ' + s[i]; }
function formatTime(s) { if (!s) return '0:00'; var m = Math.floor(s / 60), sc = Math.floor(s % 60); return m + ':' + (sc < 10 ? '0' : '') + sc; }
function getAuthHeaders() { return (AppState.authEnabled && AppState.authLogin && AppState.authPassword) ? { 'Authorization': 'Basic ' + btoa(AppState.authLogin + ':' + AppState.authPassword) } : {}; }
function getCurrentSearchMode() { var m = document.getElementById('torrent-movie'); if (m) currentSearchMode = m.value; return currentSearchMode; }

// Управление кэшем
function cacheSet(cache, key, value, max) {
  if (cache.size >= max) { var k = cache.keys().next().value; cache.delete(k); }
  cache.set(key, value);
}
function clearCache(cache) { cache.clear(); }

// ==================== ЗАГРУЗКА И УПРАВЛЕНИЕ ТОРРЕНТАМИ ====================
async function loadClientConfig() {
  try {
    var savedClientId = localStorage.getItem('clientId');
    var url = SERVER_URL + '/api/client/config' + (savedClientId ? '?clientId=' + encodeURIComponent(savedClientId) : '');
    var resp = await fetch(url);
    if (!resp.ok) return null;
    var data = await resp.json();
    AppState.clientId = data.clientId;
    if (localStorage.getItem('clientId') !== data.clientId) localStorage.setItem('clientId', data.clientId);
    if (data.config) {
      var ui = document.getElementById('torrserver-url');
      var ac = document.getElementById('auth-checkbox');
      var al = document.getElementById('auth-login');
      var ap = document.getElementById('auth-password');
      if (ui && data.config.url) ui.value = data.config.url;
      if (ac && data.config.authEnabled) {
        ac.checked = true; AppState.authEnabled = true;
        document.getElementById('auth-fields').classList.add('visible');
        if (al && data.config.login) al.value = data.config.login;
        if (ap && data.config.hasPassword) ap.value = data.config.password;
      }
    }
    return data;
  } catch (e) { return null; }
}

async function saveClientConfig() {
  var url = document.getElementById('torrserver-url').value.trim();
  var auth = document.getElementById('auth-checkbox').checked;
  var login = document.getElementById('auth-login').value.trim();
  var pass = document.getElementById('auth-password').value.trim();
  var conf = { url: url, authEnabled: auth, login: login, clientId: localStorage.getItem('clientId') };
  if (pass) conf.password = pass;
  try {
    var r = await fetch(SERVER_URL + '/api/client/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(conf) });
    return r.ok;
  } catch (e) { return false; }
}

async function checkServer(loadTorrentsFlag) {
  if (loadTorrentsFlag === undefined) loadTorrentsFlag = true;
  var ui = document.getElementById('torrserver-url');
  var si = document.getElementById('status-indicator');
  var st = document.getElementById('status-text');
  var ac = document.getElementById('auth-checkbox');
  var al = document.getElementById('auth-login');
  var ap = document.getElementById('auth-password');
  var url = ui.value.trim();
  if (!url) { si.className = 'status-indicator status-offline'; st.textContent = 'Введите адрес сервера'; return false; }
  si.className = 'status-indicator status-checking'; st.textContent = 'Проверка...';
  try {
    var testUrl = url.endsWith('/') ? url.slice(0, -1) : url;
    var h = Object.assign({}, getAuthHeaders());
    if (ac && ac.checked && al && ap && al.value.trim() && ap.value) {
      h['Authorization'] = 'Basic ' + btoa(al.value.trim() + ':' + ap.value);
      AppState.authEnabled = true; AppState.authLogin = al.value.trim(); AppState.authPassword = ap.value;
    } else { AppState.authEnabled = false; }
    var resp = await fetch(testUrl + '/echo', { method: 'GET', headers: h });
    if (resp.ok) {
      var txt = await resp.text();
      if (txt.indexOf('MatriX.') !== -1) {
        si.className = 'status-indicator status-online'; st.textContent = 'Сервер доступен ✓';
        AppState.currentTorrserverUrl = testUrl; AppState.serverOnline = true;
        await saveClientConfig();
        if (loadTorrentsFlag) await loadTorrents();
        return true;
      }
    }
    throw new Error('Недоступен');
  } catch (e) {
    si.className = 'status-indicator status-offline'; st.textContent = 'Сервер недоступен ✗'; AppState.serverOnline = false; return false;
  }
}

async function loadTorrents(silent) {
  if (silent === undefined) silent = false;
  var grid = document.getElementById('torrents-grid');
  if (!AppState.serverOnline && !(await checkServer(false))) {
    if (!silent) { alert('Подключитесь к серверу'); document.getElementById('config-screen').style.display = 'flex'; document.getElementById('torrserver-section').style.display = 'none'; AppState.currentScreen = 'config'; }
    return false;
  }
  if (!silent) { showLoading('Загрузка...'); if (grid) grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px">Загрузка...</div>'; }
  try {
    var h = Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders());
    var resp = await fetch(AppState.currentTorrserverUrl + '/torrents', { method: 'POST', headers: h, body: JSON.stringify({ action: 'list' }) });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var data = await resp.json();
    AppState.torrents = Array.isArray(data) ? data : [];
    document.getElementById('config-screen').style.display = 'none';
    document.getElementById('torrserver-section').style.display = 'block';
    AppState.currentScreen = 'torrents';
    renderTorrents();
    return true;
  } catch (e) {
    if (!silent && grid) grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px"><div style="font-size:48px;margin-bottom:20px">⚠️</div><div style="color:#ff6a6a">' + e.message + '</div><button class="btn" style="margin-top:20px" onclick="loadTorrents()">Повторить</button></div>';
    return false;
  } finally { if (!silent) hideLoading(); }
}

async function refreshTorrents(showL) {
  if (showL === undefined) showL = true;
  progressCache.clear();
  return await loadTorrents(!showL);
}

function renderTorrents() {
  var grid = document.getElementById('torrents-grid'); if (!grid) return;
  if (AppState.torrents.length === 0) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px"><div style="font-size:48px;margin-bottom:20px">📂</div><div style="color:#aaa">Нет торрентов. Используйте поиск.</div></div>'; return; }
  progressCache.clear();
  var frag = document.createDocumentFragment();
  for (var i = 0; i < AppState.torrents.length; i++) {
    var t = AppState.torrents[i];
    var poster = ''; var isTv = false;
    try {
      if (t.file_stats && t.file_stats.length > 0) isTv = t.file_stats.length > 1;
      else if (t.data) { var d = JSON.parse(t.data); if (d.TorrServer && d.TorrServer.Files) isTv = d.TorrServer.Files.length > 1; if (d.movie) poster = d.movie.img || ('https://image.tmdb.org/t/p/w342' + (d.movie.poster_path || '')); }
    } catch (e) { }
    if (!poster && t.poster) poster = t.poster;
    var card = document.createElement('div');
    card.className = 'torrent-card'; card.dataset.hash = (t.hash || '').toLowerCase();
    var statusHtml = (t.stat_string == 'Torrent working ') ? '<span style="color:#4caf50;font-weight:bold">▶ Идет просмотр</span>' : formatBytes(t.torrent_size);
    card.innerHTML = '<div class="torrent-poster">' + (poster ? '<img src="' + poster + '" loading="lazy" onerror="this.parentElement.innerHTML=\'<div class=\\\'no-poster\\\'>Нет постера</div>\'">' : '<div class="no-poster">Нет постера</div>') + '</div><div class="torrent-info"><div class="torrent-title">' + escapeHtml(t.title || 'Без названия') + '</div><div class="torrent-meta"><span>' + statusHtml + '</span><span class="torrent-badge">' + (isTv || ((t.types || []).indexOf('tv') !== -1) ? 'Сериал' : 'Фильм') + '</span></div></div>';
    frag.appendChild(card);
  }
  grid.innerHTML = ''; grid.appendChild(frag);
  requestAnimationFrame(function () {
    if (AppState.currentScreen === 'torrents' && !grid.querySelector('.focused')) setTimeout(window.focusFirstTorrentCard || function () { }, 80);
  });
}

// Event Delegation для торрентов
document.addEventListener('DOMContentLoaded', function () {
  var grid = document.getElementById('torrents-grid');
  if (!grid) return;
  grid.addEventListener('click', function (e) {
    var card = e.target.closest('.torrent-card');
    if (card && card.dataset.hash && Date.now() > suppressTorrentClickUntil) {
      showDetailByHash(card.dataset.hash);
    }
  });
  grid.addEventListener('contextmenu', function (e) {
    var card = e.target.closest('.torrent-card');
    if (card && card.dataset.hash) {
      e.preventDefault(); suppressTorrentClickUntil = Date.now() + 1200;
      removeTorrentByHash(card.dataset.hash, { skipConfirm: true });
    }
  });
});

async function removeTorrentByHash(hash, opts) {
  if (!hash || !AppState.currentTorrserverUrl) return false;
  opts = opts || {};
  var t = null; for (var i = 0; i < AppState.torrents.length; i++) if ((AppState.torrents[i].hash || '').toLowerCase() === hash) { t = AppState.torrents[i]; break; }
  if (!opts.skipConfirm && !window.confirm('Удалить ' + (t && t.title || 'торрент') + '?')) return false;
  showLoading('Удаление...');
  try {
    var r = await fetch(AppState.currentTorrserverUrl + '/torrents', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()), body: JSON.stringify({ action: 'rem', hash: hash }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    torrentFilesCache.delete(hash);
    if (AppState.currentDetailItem && (AppState.currentDetailItem.hash || '').toLowerCase() === hash) { document.getElementById('detail-view').style.display = 'none'; AppState.currentDetailItem = null; AppState.currentScreen = 'torrents'; document.getElementById('torrserver-section').style.display = 'block'; }
    await refreshTorrentsList(); return true;
  } catch (e) { alert(e.message); return false; } finally { hideLoading(); }
}

async function showDetailByHash(hash) {
  for (var i = 0; i < AppState.torrents.length; i++) if ((AppState.torrents[i].hash || '').toLowerCase() === hash.toLowerCase()) { showDetail(AppState.torrents[i]); return; }
}

// ==================== ДЕТАЛИ И TMDB ====================
function hideCatalogDetailExtra() {
  var ids = ['catalog-detail-extra', 'files-list', 'detail-subtitle', 'catalog-detail-backdrop', 'catalog-detail-meta', 'catalog-detail-overview', 'catalog-detail-trailers-wrap', 'catalog-detail-trailers', 'catalog-detail-screenshots-wrap', 'catalog-detail-screenshots'];
  ids.forEach(function (id) { var el = document.getElementById(id); if (el) { el.classList.add('hidden'); el.innerHTML = ''; if (id === 'detail-subtitle') el.textContent = ''; if (id === 'catalog-detail-backdrop') el.style.backgroundImage = ''; } });
}

async function showDetail(torrent) {
  if (typeof window.initHorizontalScroll === 'function') window.initHorizontalScroll();
  var dv = document.getElementById('detail-view');
  resetDetailBackground();
  if (typeof Animations !== 'undefined') Animations.animateDetailShow();
  dv.style.pointerEvents = 'auto';
  var mc = document.getElementById('main-container'); if (mc) mc.style.pointerEvents = 'none';
  AppState.currentDetailItem = torrent; AppState.currentScreen = 'detail'; AppState.detailReturnTo = 'torrents';
  hideCatalogDetailExtra();
  var posterEl = document.getElementById('detail-poster'), titleEl = document.getElementById('detail-title-text'), filesEl = document.getElementById('files-list');
  var oldP = document.getElementById('detail-progress'); if (oldP) oldP.remove();
  filesEl.style.display = 'flex'; filesEl.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;gap:15px"><div class="spinner"></div><div style="color:#aaa">Загрузка файлов...</div></div>';
  var displayTitle = (torrent.title || 'Без названия').replace(/[\d+]/, '').trim();
  titleEl.textContent = displayTitle;
  await addProgressToDetail(torrent);
  try {
    var files = await getTorrentFilesWithCache(torrent);
    var poster = torrent.poster || '';
    if (!poster && torrent.data) try { var d = JSON.parse(torrent.data); if (d.movie) poster = d.movie.img || ('https://image.tmdb.org/t/p/w342' + (d.movie.poster_path || '')); } catch (e) { }
    posterEl.innerHTML = poster ? '<img src="' + poster + '" alt="poster">' : '<div class="no-poster">Нет постера</div>';
    if (!files.length) { filesEl.innerHTML = '<div style="text-align:center;padding:20px;color:#aaa">📁 Нет файлов</div>'; }
    else {
      var vids = [], frag = document.createDocumentFragment();
      for (var i = 0; i < files.length; i++) { var p = files[i].path.split('/').pop().toLowerCase(); if (/\.mp4|\.mkv|\.avi|\.mov|\.webm|\.m4v$/.test(p)) vids.push(files[i]); }
      filesEl.innerHTML = '';
      for (var j = 0; j < vids.length; j++) {
        var item = addFileItem(vids[j], torrent.hash, vids.length === 1 ? (torrent.title || 'Фильм') : ('Серия ' + (j + 1)), vids.length === 1 ? null : j, null, true);
        if (item) frag.appendChild(item);
      }
      filesEl.appendChild(frag);
      loadAllTmdbDataForTorrent(torrent, { titleEl: titleEl, detailViewDiv: dv, detailSubtitle: document.getElementById('detail-subtitle') }).then(function (d) {
        if (d.cleanTitle && d.cleanTitle !== 'Без названия') titleEl.textContent = d.cleanTitle;
        if (d.seasonNumbers && d.seasonNumbers.length > 1 && titleEl.textContent.indexOf('сезон') === -1) titleEl.textContent += ' [сезон ' + d.seasonNumbers.join(', ') + ']';
        loadStillsAndUpdateFiles(d.seasonNumbers || [], d.allSeasonEpisodes || {}, d.movieStill, vids.length);
      });
    }
  } catch (e) { filesEl.innerHTML = '<div style="text-align:center;padding:20px;color:#ff6a6a">❌ ' + e.message + '</div>'; }
  requestAnimationFrame(function () {
    if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
      updateFocusableElements(); var items = document.querySelectorAll('.file-item');
      if (items.length) for (var i = 0; i < (window.focusableElements || []).length; i++) if (window.focusableElements[i].classList && window.focusableElements[i].classList.contains('file-item')) { setFocus(i); break; }
      else setFocus(0);
    }
  });
  AppState.mediaType = "";
}

async function loadAllTmdbDataForTorrent(torrent, els) {
  var tmdbId = null, cleanTitle = torrent.title || 'Без названия', seasons = [], isTv = false;
  var m = cleanTitle.match(/\[(\d+)\]/); if (m) { tmdbId = m[1]; cleanTitle = cleanTitle.replace(/\[\d+\]/, '').trim(); }
  seasons = extractSeasonsFromTitle(cleanTitle); if (seasons.length) cleanTitle = cleanTitleFromSeasons(cleanTitle, seasons);
  if (els.titleEl) els.titleEl.textContent = cleanTitle;
  try {
    if (torrent.file_stats && torrent.file_stats.length > 1) isTv = true; else if (torrent.data) { var d = JSON.parse(torrent.data); if (d.TorrServer && d.TorrServer.Files && d.TorrServer.Files.length > 1) isTv = true; }
  } catch (e) { }
  var epCache = {}, movieStill = null;
  if (tmdbId && isTv && seasons.length) seasons.forEach(function (s) { loadSeasonStills(tmdbId, s).then(function (ep) { if (ep && ep.length) { epCache[s] = ep; loadStillsAndUpdateFiles(seasons, epCache, movieStill, (getTorrentFiles(torrent) || []).length); } }); });
  if (tmdbId && !isTv) loadMovieStill(tmdbId).then(function (st) { if (st) { movieStill = st; var fi = document.querySelector('.file-item'); if (fi) updateFileItemStill(fi, st); } });
  if (tmdbId) { (function () { var mt = isTv ? 'tv' : 'movie'; getTmdbDetailsWithCache(tmdbId, mt).then(function (det) { if (det) { if (det.backdrop_path && els.detailViewDiv) els.detailViewDiv.style.backgroundImage = 'url(' + (AppState.protocol + '//tsimg.hnar.online/t/p/original' + det.backdrop_path) + ')'; if (det.overview && els.detailSubtitle) { els.detailSubtitle.textContent = det.overview; els.detailSubtitle.style.display = 'block'; } if (typeof updateDetailMetaInfo === 'function') updateDetailMetaInfo(det); } }); })(); }
  return { tmdbId: tmdbId, cleanTitle: cleanTitle, seasonNumbers: seasons, isTvSeries: isTv, allSeasonEpisodes: epCache, movieStill: movieStill };
}

// ==================== ПОИСК И ФИЛЬТРЫ ====================
function syncSearchFilterButtons() {
  ['sort-by', 'filter-quality', 'filter-tracker'].forEach(function (id) { var s = document.getElementById(id); if (s) s.value = (id === 'sort-by' ? currentSort : id === 'filter-quality' ? currentQualityFilter : currentTrackerFilter); });
  var y = document.getElementById('filter-year'); if (y) y.value = (currentYearFilter || 'all');
  var se = document.getElementById('filter-season'); if (se) se.value = (currentSeasonFilter || 'all');
  var v = document.getElementById('filter-voice'); if (v) v.value = (currentVoiceFilter || 'all');
  var vi = document.getElementById('filter-videotype'); if (vi) vi.value = (currentvideotypeFilter || 'all');
}
function applyFiltersAndSort() {
  filteredResults = searchResults.filter(function (item) {
    if (currentQualityFilter !== 'all' && (item.quality || 0) !== parseInt(currentQualityFilter, 10)) return false;
    if (currentTrackerFilter !== 'all' && (item.tracker || '').toLowerCase() !== currentTrackerFilter) return false;
    if (currentYearFilter && currentYearFilter !== 'all' && item.released !== parseInt(currentYearFilter, 10)) return false;
    if (currentSeasonFilter !== 'all' && !(item.seasons && item.seasons.indexOf(parseInt(currentSeasonFilter, 10)) !== -1)) return false;
    if (currentVoiceFilter !== 'all' && !(item.voices && item.voices.indexOf(currentVoiceFilter) !== -1)) return false;
    if (currentvideotypeFilter !== 'all' && item.videotype != currentvideotypeFilter) return false;
    return true;
  });
  filteredResults.sort(function (a, b) { var va, vb; switch (currentSort) { case 'date-desc': return new Date(b.createTime || 0) - new Date(a.createTime || 0); case 'date-asc': return new Date(a.createTime || 0) - new Date(b.createTime || 0); case 'size-desc': return (b.size || 0) - (a.size || 0); case 'size-asc': return (a.size || 0) - (b.size || 0); case 'sid-desc': return (b.sid || 0) - (a.sid || 0); case 'sid-asc': return (a.sid || 0) - (b.sid || 0); case 'pir-desc': return (b.pir || 0) - (a.pir || 0); case 'pir-asc': return (a.pir || 0) - (b.pir || 0); default: return 0; } });
  renderSearchResults();
}
function updateAvailableTrackers() {
  var s = {}; searchResults.forEach(function (r) { if (r.tracker) s[r.tracker] = true; });
  availableTrackers = Object.keys(s).sort();
  if (availableTrackers.indexOf(currentTrackerFilter) === -1) currentTrackerFilter = 'all';
  syncSearchFilterButtons(); updateAvailableSeasons(); updateAvailableVoices(); updateAvailableVideotype();
}
function updateAvailableYears() {
  var s = {}, yf = document.getElementById('filter-year'); if (!yf) return;
  searchResults.forEach(function (r) { if (r.released && !isNaN(r.released)) s[r.released] = true; });
  var years = Object.keys(s).map(Number).sort(function (a, b) { return b - a; });
  yf.innerHTML = '<option value="all">Все</option>'; years.forEach(function (y) { yf.innerHTML += '<option value="' + y + '"' + (currentYearFilter == String(y) ? ' selected' : '') + '>' + y + '</option>'; });
  if (currentYearFilter !== 'all' && !s[currentYearFilter]) { yf.value = 'all'; currentYearFilter = ''; }
}
function updateAvailableSeasons() {
  var s = {}, sf = document.getElementById('filter-season'); if (!sf) return;
  searchResults.forEach(function (r) { if (r.seasons) r.seasons.forEach(function (x) { s[x] = true; }); });
  availableSeasons = Object.keys(s).map(Number).sort(function (a, b) { return a - b; });
  sf.innerHTML = '<option value="all">Все</option>'; availableSeasons.forEach(function (x) { sf.innerHTML += '<option value="' + x + '"' + (currentSeasonFilter == String(x) ? ' selected' : '') + '>' + x + '</option>'; });
  if (currentSeasonFilter !== 'all' && !s[parseInt(currentSeasonFilter)]) { sf.value = 'all'; currentSeasonFilter = 'all'; }
}
function updateAvailableVoices() {
  var s = {}, vf = document.getElementById('filter-voice'); if (!vf) return;
  searchResults.forEach(function (r) { if (r.voices) r.voices.forEach(function (v) { if (v && v.trim()) s[v.trim()] = true; }); });
  availableVoices = Object.keys(s).sort();
  vf.innerHTML = '<option value="all">Все</option>'; availableVoices.forEach(function (v) { vf.innerHTML += '<option value="' + escapeHtml(v) + '"' + (currentVoiceFilter === v ? ' selected' : '') + '>' + escapeHtml(v) + '</option>'; });
  if (currentVoiceFilter !== 'all' && !s[currentVoiceFilter]) { vf.value = 'all'; currentVoiceFilter = 'all'; }
}
function updateAvailableVideotype() {
  var s = {}, vf = document.getElementById('filter-videotype'); if (!vf) return;
  searchResults.forEach(function (r) { if (r.videotype) s[r.videotype] = true; });
  availablevideotype = Object.keys(s).sort();
  vf.innerHTML = '<option value="all">Все</option>'; availablevideotype.forEach(function (v) { vf.innerHTML += '<option value="' + escapeHtml(v) + '"' + (currentvideotypeFilter === v ? ' selected' : '') + '>' + escapeHtml(v) + '</option>'; });
  if (currentvideotypeFilter !== 'all' && !s[currentvideotypeFilter]) { vf.value = 'all'; currentvideotypeFilter = 'all'; }
}
async function searchTorrents(query) {
  if (!query || !query.trim()) { alert('Введите запрос'); return; }
  if (currentSearchMode === 'globalsearch') await searchTMDB(query); else await searchTorrentsLegacy(query);
}
async function searchTorrentsLegacy(query) {
  showLoading('Поиск...');
  try {
    var r = await fetch(AppState.protocol + '//jac.red/api/v1.0/torrents?search=' + encodeURIComponent(query.trim()) + '&apikey=null&exact=true');
    if (!r.ok) throw new Error('Ошибка'); searchResults = (await r.json() || []).map(function (x) { x.tracker = (x.tracker || '').toLowerCase().trim(); return x; });
    currentSearchQuery = query; var si = document.getElementById('search-query'); if (si) si.value = '';
    updateAvailableTrackers(); updateAvailableYears(); applyFiltersAndSort(); showSearchResults();
  } catch (e) { alert(e.message); } finally { hideLoading(); }
}
async function searchTMDB(query) {
  showLoading('Поиск в TMDB...');
  try {
    var [mr, tr] = await Promise.all([fetch('/api/tmdb/search?query=' + encodeURIComponent(query) + '&type=movie&year='), fetch('/api/tmdb/search?query=' + encodeURIComponent(query) + '&type=tv&year=')]);
    var all = [];
    if (mr && mr.ok) { var d = await mr.json(); if (d.results) d.results.forEach(function (x) { all.push({ id: x.id, media_type: 'movie', title: x.title, name: x.title, release_date: x.release_date, vote_average: x.vote_average, vote_count: x.vote_count, overview: x.overview, poster_path: x.poster_path, backdrop_path: x.backdrop_path }); }); }
    if (tr && tr.ok) { var d = await tr.json(); if (d.results) d.results.forEach(function (x) { all.push({ id: x.id, media_type: 'tv', title: x.name, name: x.name, first_air_date: x.first_air_date, vote_average: x.vote_average, vote_count: x.vote_count, overview: x.overview, poster_path: x.poster_path, backdrop_path: x.backdrop_path }); }); }
    all.sort(function (a, b) { return (b.vote_average || 0) - (a.vote_average || 0) || (b.vote_count || 0) - (a.vote_count || 0); });
    globalSearchResults = all; currentSearchQuery = query; if (currentSearchMode === 'globalsearch') showContentTypeFilter(); showGlobalSearchResults();
  } catch (e) { alert(e.message); } finally { hideLoading(); }
}
function showSearchResults() {
  var ov = document.getElementById('search-overlay'), st = document.getElementById('tab-search'), tt = document.getElementById('tab-torrents');
  if (!ov || !st || !tt) return; document.getElementById('torrserver-section').style.display = 'none'; ov.classList.remove('hidden'); st.classList.add('active'); tt.classList.remove('active'); document.getElementById('tab-catalog').classList.remove('active'); AppState.currentScreen = 'search'; syncSearchFilterButtons(); toggleSearchFiltersPanel(false);
  requestAnimationFrame(function () { if (typeof window.focusSearchHome === 'function') window.focusSearchHome(true); else if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') { updateFocusableElements(); setFocus(0); } });
}
function hideSearchResults() {
  var ret = AppState.searchReturnTo || 'torrents';
  AppState.searchReturnTo = null;

  var searchOverlay = document.getElementById('search-overlay');
  var searchTab = document.getElementById('tab-search');
  var torrentsTab = document.getElementById('tab-torrents');
  var catalogTab = document.getElementById('tab-catalog');
  var torrserverSection = document.getElementById('torrserver-section');
  var detailView = document.getElementById('detail-view');
  var mainContainer = document.getElementById('main-container');
  var searchInput = document.getElementById('search-query');

  if (searchOverlay) searchOverlay.classList.add('hidden');
  if (searchTab) searchTab.classList.remove('active');
  toggleSearchFiltersPanel(false);
  if (torrserverSection) torrserverSection.style.display = 'block';

  if (ret === 'detail') {
    AppState.currentScreen = 'detail';
    if (mainContainer && AppState.backupScroll > 0) {
      mainContainer.scrollTop = AppState.backupScroll;
    }
    if (detailView) {
      detailView.style.display = 'block';
      detailView.style.pointerEvents = 'auto';
    }
    requestAnimationFrame(function () {
      if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
        updateFocusableElements();
        var wb = document.getElementById('catalog-watch-btn');
        if (wb) {
          var i = -1;
          var focusable = window.focusableElements || [];
          for (var j = 0; j < focusable.length; j++) {
            if (focusable[j].id === 'catalog-watch-btn') {
              i = j;
              break;
            }
          }
          if (i !== -1) setFocus(i);
        }
      }
    });
  }
  else if (ret === 'catalog') {
    if (catalogTab) catalogTab.classList.add('active');
    if (torrentsTab) torrentsTab.classList.remove('active');
    AppState.currentScreen = 'catalog';
    setTimeout(function () {
      if (typeof window.focusCatalogCardByIndex === 'function') {
        var savedIdx = localStorage.getItem('lastCatalogCardIndex');
        window.focusCatalogCardByIndex(parseInt(savedIdx || '0', 10));
      }
      else if (typeof window.focusFirstCatalogCard === 'function') {
        window.focusFirstCatalogCard();
      }
    }, 80);
  }
  else {
    if (torrentsTab) torrentsTab.classList.add('active');
    if (catalogTab) catalogTab.classList.remove('active');
    AppState.currentScreen = 'torrents';
    setTimeout(function () {
      if (typeof window.focusFirstTorrentCard === 'function' && !window.focusFirstTorrentCard()) {
        if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
          updateFocusableElements();
          var c = -1;
          var focusable = window.focusableElements || [];
          for (var j = 0; j < focusable.length; j++) {
            if (focusable[j].classList && focusable[j].classList.contains('torrent-card')) {
              c = j;
              break;
            }
          }
          if (c !== -1) setFocus(c);
        }
      }
    }, 80);
  }

  if (searchInput && document.activeElement === searchInput) {
    searchInput.blur();
  }
}
function resetFilters() { currentSort = 'date-desc'; currentQualityFilter = 'all'; currentTrackerFilter = 'all'; currentYearFilter = ''; currentSeasonFilter = 'all'; currentVoiceFilter = 'all'; currentvideotypeFilter = 'all'; syncSearchFilterButtons(); applyFiltersAndSort(); }
function showContentTypeFilter() { var fg = document.querySelector('.filter-group'); if (!fg) return; if (!document.getElementById('filter-content-type')) { var nf = document.createElement('div'); nf.className = 'filter-group'; nf.innerHTML = '<label class="filter-label" for="filter-content-type">Тип контента</label><select id="filter-content-type" class="filter-select"><option value="all">Все</option><option value="movie">Фильмы</option><option value="tv">Сериалы</option></select>'; var qf = document.getElementById('filter-quality'); if (qf && qf.parentNode) qf.parentNode.parentNode.insertBefore(nf, qf.parentNode.nextSibling); else fg.parentNode.appendChild(nf); document.getElementById('filter-content-type').addEventListener('change', function (e) { filterGlobalSearchByType(e.target.value); }); } }
function filterGlobalSearchByType(type) { if (!globalSearchResults.length) return; renderFilteredGlobalResults(type === 'all' ? globalSearchResults : globalSearchResults.filter(function (x) { return x.media_type === type; })); }

// Рендеринг поиска (Event Delegation + Fragment)
document.addEventListener('DOMContentLoaded', function () {
  var sr = document.getElementById('search-results');
  if (!sr) return;
  sr.addEventListener('click', function (e) {
    var btn = e.target.closest('.search-result-play');
    if (btn && btn.dataset.hash) {
      var h = btn.dataset.hash, m = btn.dataset.magnet, rj = btn.dataset.result, res = null;
      if (rj) try { res = JSON.parse(decodeURIComponent(rj)); if (window.pendingCatalogPoster) res.poster = window.pendingCatalogPoster; } catch (x) { }
      playFromHash(h, m, res);
    }
    var g = e.target.closest('.global-search-card');
    if (g && g.dataset.tmdbId) {
      AppState.isSearch = true; showGlobalSearchDetail(globalSearchResults.find(function (x) { return String(x.id) === g.dataset.tmdbId; }));
    }
  });
});

function renderSearchResults() {
  var div = document.getElementById('search-results'); if (!div) return;
  if (filteredResults.length === 0) { div.innerHTML = '<div class="filter-stats">Найдено: <span>' + searchResults.length + '</span></div><div class="search-result-empty">' + (currentSearchQuery ? 'Нет результатов по фильтрам для "' + escapeHtml(currentSearchQuery) + '"' : 'Введите запрос') + '</div>'; return; }
  var frag = document.createDocumentFragment(), stat = document.createElement('div'); stat.className = 'filter-stats'; stat.innerHTML = 'Показано: <span>' + filteredResults.length + '</span> из <span>' + searchResults.length + '</span>'; frag.appendChild(stat);
  for (var i = 0; i < filteredResults.length; i++) {
    var r = filteredResults[i], h = extractHashFromMagnet(r.magnet);
    var item = document.createElement('div'); item.className = 'search-result-item'; item.dataset.index = i;
    item.innerHTML = '<div class="search-result-info"><div class="search-result-title">' + escapeHtml(r.title || r.name || 'Без названия') + '</div><div class="search-result-meta"><div class="search-result-meta-item">' + escapeHtml((r.tracker || 'Unknown').charAt(0).toUpperCase() + (r.tracker || 'Unknown').slice(1)) + '</div><div class="search-result-meta-item">' + escapeHtml(r.sizeName || formatBytes(r.size)) + '</div><div class="search-result-meta-item">' + (r.released || 'N/A') + ' (' + (r.createTime ? new Date(r.createTime).toLocaleDateString() : 'N/A') + ')</div><div class="search-result-meta-item">' + ((r.types && r.types.indexOf('tv') !== -1) ? 'Сериал' : 'Фильм') + ' / ' + ((r.quality || 'N/A') + 'p') + '</div><div class="search-result-meta-item">сиды: ' + (r.sid || 0) + '</div><div class="search-result-meta-item">пиры: ' + (r.pir || 0) + '</div></div>' + ((r.voices && r.voices.length) ? '<div class="search-result-voices">' + r.voices.map(function (v) { return '<span class="search-result-voice">' + escapeHtml(v) + '</span>'; }).join('') + '</div>' : '') + '</div><button class="search-result-play" data-hash="' + (h || '') + '" data-magnet="' + escapeHtml(r.magnet) + '" data-result="' + encodeURIComponent(JSON.stringify(r)) + '"' + (h ? '' : ' disabled') + '>▶</button>';
    frag.appendChild(item);
  }
  div.innerHTML = ''; div.appendChild(frag);
}
function showGlobalSearchResults() { renderFilteredGlobalResults(globalSearchResults); }
function renderFilteredGlobalResults(results) {
  var div = document.getElementById('search-results'); if (!div) return;
  if (!results.length) { div.innerHTML = '<div class="filter-stats">Найдено: <span>0</span></div><div class="search-result-empty">Нет результатов</div>'; return; }
  var frag = document.createDocumentFragment(), stat = document.createElement('div'); stat.className = 'filter-stats'; stat.innerHTML = 'Найдено в TMDB: <span>' + results.length + '</span>'; frag.appendChild(stat);
  var grid = document.createElement('div'); grid.className = 'global-search-grid'; grid.style.cssText = 'display:grid;grid-template-columns:repeat(6,1fr);gap:20px;padding:20px 0;';
  results.forEach(function (r, i) {
    var title = r.title || r.name || 'Без названия', year = r.release_date || r.first_air_date, mt = r.media_type === 'tv' ? 'Сериал' : 'Фильм';
    var rat = r.vote_average ? r.vote_average.toFixed(1) : null, pu = r.poster_path ? (AppState.protocol + '//tsimg.hnar.online/t/p/w342' + r.poster_path) : null;
    var card = document.createElement('div'); card.className = 'global-search-card'; card.dataset.index = i; card.dataset.tmdbId = r.id; card.dataset.mediaType = r.media_type;
    card.style.cssText = 'background:rgba(30,30,40,0.9);border-radius:12px;overflow:hidden;cursor:pointer;border:1px solid rgba(74,158,255,0.3);';
    card.innerHTML = '<div class="global-search-poster" style="position:relative;aspect-ratio:2/3;overflow:hidden;background:linear-gradient(135deg,#1a1a2e,#16213e)">' + (pu ? '<img src="' + pu + '" alt="' + escapeHtml(title) + '" loading="lazy" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.innerHTML=\'<div style=\'display:flex;align-items:center;justify-content:center;height:100%;font-size:48px\'>🎬</div>\'">' : '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:48px">' + mt + '</div>') + (rat ? '<div style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.8);color:' + getRatingColor(rat) + ';font-weight:bold;font-size:12px;padding:4px 8px;border-radius:12px;border:1px solid ' + getRatingColor(rat) + '">' + rat + '</div>' : '') + '</div><div class="global-search-info" style="padding:12px"><div class="global-search-title" style="font-weight:600;font-size:14px;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(title) + '</div><div style="display:flex;justify-content:space-between;font-size:12px;color:#aaa"><span>' + mt + '</span><span>' + (year ? new Date(year).getFullYear() : 'N/A') + '</span></div></div>';
    grid.appendChild(card);
  });
  frag.appendChild(grid); div.innerHTML = ''; div.appendChild(frag);
}
async function showGlobalSearchDetail(item) {
  if (!item) return; var ci = { id: item.id, media_type: item.media_type, title: item.title || item.name, name: item.name || item.title, overview: item.overview, poster_path: item.poster_path, backdrop_path: item.backdrop_path, vote_average: item.vote_average, release_date: item.release_date, first_air_date: item.first_air_date, torrent: [{ name: item.title || item.name }] };
  AppState.mediaType = item.media_type; AppState.searchReturnTo = 'search'; AppState.currentScreen = 'detail';
  var pu = item.poster_path ? (AppState.protocol + '//tsimg.hnar.online/t/p/w342' + item.poster_path) : null;
  if (typeof window.showCatalogDetail === 'function') { document.getElementById('search-overlay').classList.add('hidden'); await window.showCatalogDetail(ci, 0, pu); }
}

// ==================== ПЛЕЕР И ВОСПРОИЗВЕДЕНИЕ ====================
async function playFromHash(hash, magnet, searchResult) {
  if (!hash || !AppState.currentTorrserverUrl) { alert(hash ? 'Подключитесь к серверу' : 'Hash не найден'); return; }
  if (window.addToWatchHistory && AppState.pendingDetailItem && AppState.pendingDetailItem.id) window.addToWatchHistory(String(AppState.pendingDetailItem.id), currentSearchQuery, AppState.pendingDetailItem.media_type, AppState.pendingDetailPoster || null);
  document.getElementById('playback-overlay').classList.add('active'); document.querySelector('.playback-text').textContent = 'Добавление...';
  try {
    var isSerial = AppState.mediaType === 'tv' || (searchResult && searchResult.types && searchResult.types.indexOf('tv') !== -1);
    var added = await addTorrentToServer(magnet, hash, searchResult); hideSearchResults();
    if (!added) { await refreshTorrentsList(); for (var i = 0; i < AppState.torrents.length; i++) if ((AppState.torrents[i].hash || '').toLowerCase() === hash.toLowerCase()) { added = AppState.torrents[i]; break; } }
    if (added) AppState.currentDetailItem = added;
    if (!isSerial) { var pf = getPreferredPlaybackFile(added, searchResult); document.querySelector('.playback-text').textContent = 'Воспроизведение...'; await startHLSPlayback(AppState.currentTorrserverUrl + '/play/' + hash + '/' + (pf.fileId || 1), null, true, pf.episodeIndex); }
    else { await new Promise(function (r) { setTimeout(r, 3000) }); AppState.inSearch = "torrents"; showDetail(added); }
  } catch (e) { alert('Ошибка: ' + e.message); } finally { document.getElementById('playback-overlay').classList.remove('active'); document.querySelector('.playback-text').textContent = 'Воспроизведение...'; }
}

function getPreferredPlaybackFile(torrent, sr) {
  var vf = getVideoFilesFromTorrent(torrent); if (!vf.length) return { fileId: 1, episodeIndex: null, isSeries: inferSearchResultIsSeries(sr, torrent) };
  var isS = inferSearchResultIsSeries(sr, torrent) || vf.length > 1;
  return { fileId: (vf[0] && vf[0].id) || 1, episodeIndex: isS ? 0 : null, isSeries: isS };
}
function getTorrentFiles(t) { if (!t) return []; if (t.file_stats && t.file_stats.length) return t.file_stats; if (t.data) try { var d = JSON.parse(t.data); if (d.TorrServer && d.TorrServer.Files) return d.TorrServer.Files; } catch (e) { } return []; }
function getVideoFilesFromTorrent(t) { return (getTorrentFiles(t) || []).filter(function (f) { return /\.(mp4|mkv|avi|mov|webm|m4v)$/i.test(f.path); }); }
function inferSearchResultIsSeries(sr, t) { if (sr && sr.types && sr.types.indexOf('tv') !== -1) return true; if (t && getVideoFilesFromTorrent(t).length > 1) return true; var n = ((sr && (sr.title || sr.name)) || (t && t.title) || '').toLowerCase(); return (n.indexOf('s') !== -1 && n.indexOf('e') !== -1) || n.indexOf('season') !== -1 || n.indexOf('сезон') !== -1 || n.indexOf('серия') !== -1; }
function extractHashFromMagnet(m) { if (!m) return null; var x = m.match(/xt=urn:btih:([a-fA-F0-9]{40})/i); return x ? x[1].toLowerCase() : (m.match(/[a-fA-F0-9]{40}/) ? m.match(/[a-fA-F0-9]{40}/)[0].toLowerCase() : null); }

async function addTorrentToServer(magnet, hash, sr) {
  if (!AppState.currentTorrserverUrl) return null;
  var poster = window.pendingCatalogPoster || null;
  if (!poster && sr && typeof tmdb !== 'undefined' && tmdb.findPosterFromSearchResult) poster = await tmdb.findPosterFromSearchResult(sr);
  try {
    var tn = '[' + (catalogState && catalogState.lastSelectedId || '') + '] ' + (sr && (sr.name || sr.title) || '');
    var body = { action: 'add', link: magnet, title: tn, save_to_db: AppState.addToDbEnabled };
    if (poster) body.poster = poster;
    var r = await fetch(AppState.currentTorrserverUrl + '/torrents', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()), body: JSON.stringify(body) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    window.pendingCatalogPoster = null; window.pendingCatalogItem = null; lastAddedTorrentHash = (hash || '').toLowerCase(); await new Promise(function (r) { setTimeout(r, 1000) }); await refreshTorrentsList();
    for (var i = 0; i < AppState.torrents.length; i++) if ((AppState.torrents[i].hash || '').toLowerCase() === lastAddedTorrentHash) return AppState.torrents[i];
    return null;
  } catch (e) { window.pendingCatalogPoster = null; window.pendingCatalogItem = null; throw e; }
}

// ==================== UI ФАЙЛОВ И ПРОГРЕСС ====================
function addFileItem(file, hash, name, epIdx, still, ret) {
  var p = file.path.split('/').pop() || '', ext = p.split('.').pop().toLowerCase();
  if (['mkv', 'mp4', 'avi', 'mov', 'webm', 'm4v'].indexOf(ext) === -1) return null;
  var item = document.createElement('div'); item.className = 'file-item'; item.dataset.hash = hash; item.dataset.fileId = file.id; if (epIdx != null) item.dataset.episodeIndex = epIdx;
  item.innerHTML = '<div class="file-content"><button class="play-btn" data-hash="' + hash + '" data-file-id="' + file.id + '" data-episode-index="' + (epIdx != null ? epIdx : '') + '">▶</button></div><div class="file-info"><div class="file-name" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</div><div class="file-size">' + formatBytes(file.length) + '</div></div><div class="file-progress-container"><div class="file-progress-fill"></div></div>';
  item.querySelector('.play-btn').onclick = function (e) {
    e.stopPropagation(); var b = e.currentTarget; var idx = b.dataset.episodeIndex ? parseInt(b.dataset.episodeIndex, 10) : null;
    document.getElementById('playback-overlay').classList.add('active'); document.getElementById('detail-view').style.pointerEvents = 'none';
    startHLSPlayback(AppState.currentTorrserverUrl + '/play/' + hash + '/' + file.id, 0, false, idx).finally(function () { document.getElementById('playback-overlay').classList.remove('active'); document.getElementById('detail-view').style.pointerEvents = 'auto'; });
  };
  if (still) item.dataset.pendingStill = still;
  loadProgressForFileItem(item, hash, file.id, epIdx);
  if (ret) return item; var fl = document.getElementById('files-list'); if (fl) fl.appendChild(item);
}
async function loadProgressForFileItem(item, hash, fid, ep) {
  if (!item || !hash) return; var ck = hash;
  if (progressCache.has(ck)) { var c = progressCache.get(ck); if (Date.now() - c.timestamp < 60000 && c.data && (c.data.isSeries ? c.data.fileId == fid : fid == '1') && c.data.timecode > 0) { updateProgressBar(item, c.data); return; } }
  try {
    var r = await fetch(SERVER_URL + '/api/timecode/get?hash=' + hash + '&fileId=' + fid + '&clientId=' + encodeURIComponent(localStorage.getItem('clientId') || ''));
    if (r.ok) { var d = await r.json(); if (d.success && d.timecode > 0 && d.duration > 0) { updateProgressBar(item, d); progressCache.set(ck, { data: d, timestamp: Date.now() }); } }
  } catch (e) { }
}
function updateProgressBar(item, d) {
  var pct = Math.min((d.timecode / d.duration) * 100, 98); var f = item.querySelector('.file-progress-fill');
  if (f) { f.style.width = pct + '%'; if (pct > 5) { f.style.opacity = '1'; item.classList.add('has-progress'); } }
  item.dataset.progressTimecode = d.timecode; item.dataset.progressDuration = d.duration;
}
async function getTorrentFilesWithCache(t, force) {
  var h = t.hash; if (!h) return [];
  if (!force && torrentFilesCache.has(h)) { var c = torrentFilesCache.get(h); if (Date.now() - c.timestamp < 3600000) return c.files; torrentFilesCache.delete(h); }
  var files = []; if (t.file_stats && t.file_stats.length) files = t.file_stats;
  else if (AppState.currentTorrserverUrl) try { var r = await fetch(AppState.currentTorrserverUrl + '/stream?link=' + h + '&index=1&stat=stat', { method: 'GET', headers: { accept: 'application/octet-stream' } }); if (r.ok) { var d = await r.json(); if (d.file_stats) files = d.file_stats; else if (d.data) try { var p = JSON.parse(d.data); if (p.TorrServer && p.TorrServer.Files) files = p.TorrServer.Files; } catch (e) { } t.file_stats = files; } } catch (e) { }
  cacheSet(torrentFilesCache, h, { files: files, timestamp: Date.now() }, MAX_CACHE_SIZE); return files;
}
function loadStillsAndUpdateFiles(seasons, epCache, movieStill, total) {
  if (seasons.length && Object.keys(epCache).length) {
    var all = [], ss = seasons.slice().sort(function (a, b) { return a - b; });
    ss.forEach(function (s) { (epCache[s] || []).sort(function (a, b) { return (a.episodeNumber || 0) - (b.episodeNumber || 0); }).forEach(function (e) { if (e.stillPath) all.push({ season: s, ep: e.episodeNumber, path: e.stillPath }); }); });
    var items = document.querySelectorAll('.file-item');
    for (var i = 0; i < items.length && i < all.length; i++) (function (it, url, idx) { setTimeout(function () { updateFileItemStill(it, url); }, idx * 30); })(items[i], AppState.protocol + '//tsimg.hnar.online/t/p/w300' + all[i].path, i);
  } else if (total === 1 && movieStill) { var it = document.querySelector('.file-item'); if (it) setTimeout(function () { updateFileItemStill(it, movieStill); }, 100); }
}
function updateFileItemStill(item, url) {
  if (!item || !url) return;
  var c = item.querySelector('.file-still-container'), o = item.querySelector('.file-overlay');
  if (c) { var i = c.querySelector('img'); if (i) i.src = url; } else {
    var t = document.createElement('div'); t.className = 'file-still-container'; t.innerHTML = '<img src="' + url + '" onerror="this.parentElement.style.display=\'none\'">';
    var ov = document.createElement('div'); ov.className = 'file-overlay';
    var ph = item.querySelector('.file-still-placeholder'); if (ph) ph.remove();
    item.insertBefore(t, item.firstChild); item.insertBefore(ov, item.firstChild.nextSibling);
  }
}
function resetDetailBackground() {
  var dv = document.getElementById('detail-view'); if (!dv) return; dv.style.backgroundImage = ''; dv.style.backgroundColor = '#000';
  var ov = document.getElementById('detail-backdrop-overlay'); if (ov) ov.remove();
  ['detail-subtitle', 'catalog-detail-meta', 'files-list', 'detail-poster', 'detail-title-text'].forEach(function (id) { var el = document.getElementById(id); if (el) { el.innerHTML = ''; el.textContent = ''; el.style.display = ''; } });
}
async function addProgressToDetail(t) {
  if (!t || !t.hash) return; var p = await loadProgressForTorrent(t); if (!p) return;
  var dh = document.querySelector('.detail-header'); if (!dh) return; var pd = document.createElement('div'); pd.id = 'detail-progress'; pd.className = 'detail-progress'; pd.dataset.hash = t.hash;
  var ts = formatTime(p.timecode), td = p.duration ? formatTime(p.duration) : '??:??', ep = p.episodeIndex + 1;
  pd.innerHTML = '<div class="detail-progress-content"><div class="detail-progress-info"><span class="detail-progress-label">Продолжить просмотр:</span><span class="' + (ep > 1 ? 'detail-progress-episode' : '') + '">' + (ep > 1 ? 'Серия ' + ep + ' ' : '') + '</span><span class="detail-progress-time">' + ts + ' / ' + td + '</span></div><button class="detail-progress-btn" data-hash="' + p.hash + '" data-file-id="' + p.fileId + '" data-timecode="' + p.timecode + '" data-episode-index="' + (p.episodeIndex || 0) + '">▶ Продолжить с ' + ts + '</button></div>';
  pd.querySelector('.detail-progress-btn').onclick = function (e) {
    e.stopPropagation(); document.getElementById('playback-overlay').classList.add('active'); document.getElementById('detail-view').style.pointerEvents = 'none';
    startHLSPlayback(AppState.currentTorrserverUrl + '/play/' + this.dataset.hash + '/' + this.dataset.fileId, parseInt(this.dataset.timecode), false, parseInt(this.dataset.episodeIndex)).finally(function () { document.getElementById('playback-overlay').classList.remove('active'); document.getElementById('detail-view').style.pointerEvents = 'auto'; });
  };
  dh.parentNode.insertBefore(pd, dh.nextSibling);
}
async function loadProgressForTorrent(t) {
  if (!t || !t.hash) return null; var ck = t.hash; if (progressCache.has(ck)) { var c = progressCache.get(ck); if (Date.now() - c.timestamp < 60000) return c.data; }
  try {
    var files = (t.file_stats && t.file_stats.length) ? t.file_stats : [];
    if (!files.length && AppState.currentTorrserverUrl) { var r = await fetch(AppState.currentTorrserverUrl + '/stream?link=' + t.hash + '&stat=stat', { headers: { accept: 'application/octet-stream' } }); if (r.ok) { var d = await r.json(); if (d.file_stats) files = d.file_stats; else if (d.data) try { var p = JSON.parse(d.data); if (p.TorrServer && p.TorrServer.Files) files = p.TorrServer.Files; } catch (e) { } t.file_stats = files; } }
    if (!files.length) return null; var vf = files.filter(function (f) { return /\.(mp4|mkv|avi|mov|webm|m4v)$/i.test(f.path); }); if (!vf.length) return null;
    var proms = [], cid = localStorage.getItem('clientId') || '';
    vf.forEach(function (f, i) { proms.push((function (f, idx) { return async function () { try { var r = await fetch(SERVER_URL + '/api/timecode/get?hash=' + t.hash + '&fileId=' + f.id + '&clientId=' + encodeURIComponent(cid)); if (r.ok) { var d = await r.json(); if (d.success && d.timecode > 0) return { hash: t.hash, fileId: f.id, timecode: d.timecode, duration: d.duration, index: idx, fileName: f.path.split('/').pop() }; } } catch (e) { } return null; }; })(f, i)); });
    var res = [], lp = null; for (var i = 0; i < proms.length; i++) { var r = await proms[i](); if (r) res.push(r); }
    if (res.length) { res.sort(function (a, b) { return b.index - a.index; }); lp = res[0]; var prog = { hash: lp.hash, fileId: lp.fileId, timecode: lp.timecode, duration: lp.duration, episodeIndex: lp.index, totalEpisodes: vf.length, episodeName: lp.fileName, isSeries: true }; cacheSet(progressCache, ck, { data: prog, timestamp: Date.now() }, MAX_CACHE_SIZE); return prog; }
    return null;
  } catch (e) { return null; }
}
function formatTime(s) { if (!s) return '0:00'; var m = Math.floor(s / 60), sc = Math.floor(s % 60); return m + ':' + (sc < 10 ? '0' : '') + sc; }

// ==================== TMDB УТИЛИТЫ ====================
function extractSeasonsFromTitle(t) { if (!t) return []; var s = [], pats = [/сезон\s*([\d,\s-]+)|season\s*([\d,\s-]+)|S([\d-,\s]+)/i, /[сезон\s*(\d+)\s*[-–]\s*(\d+)]/i, /S(\d+)\s*[-–]\s*S?(\d+)/i]; for (var i = 0; i < pats.length; i++) { var m = t.match(pats[i]); if (m) { if (m[2]) { var st = parseInt(m[1]), en = parseInt(m[2]); for (var x = st; x <= en; x++) if (s.indexOf(x) === -1) s.push(x); } else if (m[1]) m[1].split(/[,\s-]+/).forEach(function (n) { var x = parseInt(n); if (!isNaN(x) && s.indexOf(x) === -1) s.push(x); }); if (s.length) break; } } return s.sort(function (a, b) { return a - b; }); }
function cleanTitleFromSeasons(t, s) { if (!t) return t; var c = t.replace(/сезон\s*[\d,\s-]+|season\s*[\d,\s-]+|S\d+/ig, '').trim(); return c.replace(/\s+/g, ' ').trim(); }
async function loadSeasonStills(id, sn) { var k = id + 's' + sn; if (seasonCache.has(k)) { var c = seasonCache.get(k); if (Date.now() - c.timestamp < 86400000) return c.data; } try { var r = await fetch('/api/tmdb/season?id=' + id + '&seasonNumber=' + sn); if (r.ok) { var d = await r.json(); cacheSet(seasonCache, k, { data: d.episodes || [], timestamp: Date.now() }, MAX_CACHE_SIZE); return d.episodes || []; } } catch (e) { } return []; }
async function loadMovieStill(id) { var k = id + '_ms'; if (seasonCache.has(k)) { var c = seasonCache.get(k); if (Date.now() - c.timestamp < 86400000) return c.data; } try { var r = await fetch('/api/tmdb/details?id=' + id + '&type=movie'); if (r.ok) { var d = await r.json(); if (d.poster_path) { var u = AppState.protocol + '//tsimg.hnar.online/t/p/w300' + d.poster_path; cacheSet(seasonCache, k, { data: u, timestamp: Date.now() }, MAX_CACHE_SIZE); return u; } } } catch (e) { } return null; }
async function getTmdbDetailsWithCache(id, mt) {
  if (!id) return null; if (window.getFromTmdbCache && window.saveToTmdbCache) { var p = { id: id, type: mt || 'movie' }, c = window.getFromTmdbCache('details', p); if (c) return c; try { var r = await fetch('/api/tmdb/details?id=' + id + '&type=' + mt); if (r.ok) { var d = await r.json(); window.saveToTmdbCache('details', p, d); return d; } } catch (e) { } } return null;
}
function updateDetailMetaInfo(d) {
  var m = document.getElementById('catalog-detail-meta'); if (!m) return; m.innerHTML = ''; m.classList.remove('hidden');
  if (d.release_date || d.first_air_date) { var c = document.createElement('div'); c.className = 'catalog-meta-chip'; c.textContent = (d.release_date || d.first_air_date).substring(0, 4); m.appendChild(c); }
  if (d.vote_average) { var c = document.createElement('div'); c.className = 'catalog-meta-chip'; c.textContent = '⭐ ' + d.vote_average.toFixed(1); m.appendChild(c); }
  var c = document.createElement('div'); c.className = 'catalog-meta-chip'; c.textContent = (d.media_type === 'tv' || d.number_of_seasons !== undefined) ? 'Сериал' : 'Фильм'; m.appendChild(c);
  if (d.genres) d.genres.slice(0, 3).forEach(function (g) { var c = document.createElement('div'); c.className = 'catalog-meta-chip'; c.textContent = g.name; m.appendChild(c); });
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
function initTorrents() { console.log('Torrents module init'); syncSearchFilterButtons(); initYearFilter(); }
function initYearFilter() { var f = document.getElementById('filter-year'); if (f) f.addEventListener('change', function (e) { currentYearFilter = (e.target.value === 'all' ? '' : e.target.value); applyFiltersAndSort(); }); }
function toggleSearchFiltersPanel(force) { var p = document.getElementById('search-filters-panel'), t = document.getElementById('filter-toggle'); if (!p) return false; var open = (force === undefined) ? p.classList.contains('collapsed') : (!!force); if (open) { p.classList.remove('collapsed'); if (t) t.classList.add('active'); } else { p.classList.add('collapsed'); if (t) t.classList.remove('active'); } return open; } window.toggleSearchFiltersPanel = toggleSearchFiltersPanel;

// Public API
window.loadTorrents = loadTorrents; window.refreshTorrents = refreshTorrents; window.loadClientConfig = loadClientConfig;
window.saveClientConfig = saveClientConfig; window.checkServer = checkServer; window.showDetail = showDetail;
window.searchTorrents = searchTorrents; window.applyFiltersAndSort = applyFiltersAndSort; window.resetFilters = resetFilters;
window.hideSearchResults = hideSearchResults; window.showSearchResults = showSearchResults;
window.playFromHash = playFromHash; window.refreshTorrentsList = refreshTorrents; window.removeTorrentByHash = removeTorrentByHash;
window.extractHashFromMagnet = extractHashFromMagnet; window.addTorrentToServer = addTorrentToServer;
window.initTorrentsModule = initTorrents;

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTorrents); else initTorrents();
