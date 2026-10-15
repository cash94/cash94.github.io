/* Сборка для старых браузеров (Chrome 53) из js/torrents.js — tools/legacy-build/build.js. Руками не править. */
function ownKeys(e, r) {var t = Object.keys(e);if (Object.getOwnPropertySymbols) {var o = Object.getOwnPropertySymbols(e);r && (o = o.filter(function (r) {return Object.getOwnPropertyDescriptor(e, r).enumerable;})), t.push.apply(t, o);}return t;}function _objectSpread(e) {for (var r = 1; r < arguments.length; r++) {var t = null != arguments[r] ? arguments[r] : {};r % 2 ? ownKeys(Object(t), !0).forEach(function (r) {_defineProperty(e, r, t[r]);}) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) {Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));});}return e;}function _defineProperty(e, r, t) {return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e;}function _toPropertyKey(t) {var i = _toPrimitive(t, "string");return "symbol" == typeof i ? i : i + "";}function _toPrimitive(t, r) {if ("object" != typeof t || !t) return t;var e = t[Symbol.toPrimitive];if (void 0 !== e) {var i = e.call(t, r || "default");if ("object" != typeof i) return i;throw new TypeError("@@toPrimitive must return a primitive value.");}return ("string" === r ? String : Number)(t);}function asyncGeneratorStep(n, t, e, r, o, a, c) {try {var i = n[a](c),u = i.value;} catch (n) {return void e(n);}i.done ? t(u) : Promise.resolve(u).then(r, o);}function _asyncToGenerator(n) {return function () {var t = this,e = arguments;return new Promise(function (r, o) {var a = n.apply(t, e);function _next(n) {asyncGeneratorStep(a, r, o, _next, _throw, "next", n);}function _throw(n) {asyncGeneratorStep(a, r, o, _next, _throw, "throw", n);}_next(void 0);});};}


var searchResults = [];
var filteredResults = [];
var currentSearchQuery = '';
var currentSearchMode = 'globalsearch';
var globalSearchResults = [];
var tmdbSearchController = null;
var tmdbSearchSequence = 0;






var currentSort = 'date-desc';
var currentQualityFilter = 'all';
var currentTrackerFilter = 'all';
var currentYearFilter = '';
var currentSeasonFilter = 'all';
var currentVoiceFilter = 'all';
var currentvideotypeFilter = 'all';

var availableTrackers = [];
var lastAddedTorrentHash = null;
var lastPlaybackFromSearch = false;


var TORRENT_DELETE_HOLD_MS = 900;
var suppressTorrentClickUntil = 0;


function LruCache(max, ttl) {
  this.max = max > 0 ? max : 100;
  this.ttl = ttl > 0 ? ttl : 0;
  this.map = new Map();
}

LruCache.prototype._isExpired = function (entry) {
  return this.ttl > 0 && entry.expires > 0 && Date.now() > entry.expires;
};

LruCache.prototype.get = function (key) {
  var entry = this.map.get(key);

  if (!entry) return undefined;

  if (this._isExpired(entry)) {
    this.map.delete(key);
    return undefined;
  }


  this.map.delete(key);
  this.map.set(key, entry);

  return entry.value;
};

LruCache.prototype.has = function (key) {
  var entry = this.map.get(key);

  if (!entry) return false;

  if (this._isExpired(entry)) {
    this.map.delete(key);
    return false;
  }

  return true;
};

LruCache.prototype.set = function (key, value, ttl) {
  if (this.map.has(key)) {
    this.map.delete(key);
  } else if (this.map.size >= this.max) {
    var oldestKey = this.map.keys().next().value;
    if (oldestKey !== undefined) {
      this.map.delete(oldestKey);
    }
  }

  var ttlMs = ttl === undefined ? this.ttl : ttl;
  var expires = ttlMs > 0 ? Date.now() + ttlMs : 0;

  this.map.set(key, {
    value: value,
    expires: expires
  });
};

LruCache.prototype.delete = function (key) {
  return this.map.delete(key);
};

LruCache.prototype.clear = function () {
  this.map.clear();
};



var torrentFilesCache = new LruCache(80, 60 * 60 * 1000);
var torrentFilesInFlight = {};
var torrentProgressCache = new LruCache(150, 60 * 1000);
var torrentProgressInFlight = {};
var torrentCardMetaCache = new LruCache(300, 0);

var knownTorrentMeta = new LruCache(200, 24 * 60 * 60 * 1000);

window.getKnownTorrentMeta = function (hash) {
  return knownTorrentMeta.get(String(hash || '').toLowerCase());
};

function buildTmdbPosterUrl(path, size) {
  if (!path) return null;
  path = String(path);



  if (window.getTmdbImageUrl) return window.getTmdbImageUrl(path, size || 'w342');


  if (path.indexOf('http') === 0) {
    return replaceTmdbWithProxy(path);
  }

  size = size || 'w342';


  return getPrimaryImageBase() + size + (
  path.charAt(0) === '/' ? path : '/' + path);
}

function getCatalogSearchContext(searchResult) {
  var item = AppState.pendingDetailItem ||
  window.pendingCatalogItem ||
  AppState.androidBackCatalog ||
  null;

  var id = null;

  if (item) {
    id = item.id || item.tmdbId || null;
  }

  if (!id && searchResult) {
    id = searchResult.tmdbId || null;
  }

  if (!id && typeof catalogState !== 'undefined' && catalogState.lastSelectedId) {
    id = catalogState.lastSelectedId;
  }

  var mediaType = null;

  if (item && item.media_type) mediaType = item.media_type;
  if (!mediaType && AppState.pendingDetailMediaType) mediaType = AppState.pendingDetailMediaType;
  if (!mediaType && AppState.mediaType) mediaType = AppState.mediaType;

  if (!mediaType && searchResult && Array.isArray(searchResult.types)) {
    if (searchResult.types.indexOf('tv') !== -1 || searchResult.types.indexOf('serial') !== -1) {
      mediaType = 'tv';
    } else if (searchResult.types.indexOf('movie') !== -1) {
      mediaType = 'movie';
    }
  }

  if (!mediaType && searchResult && Array.isArray(searchResult.seasons) && searchResult.seasons.length > 0) {
    mediaType = 'tv';
  }

  if (!mediaType) mediaType = 'movie';

  var poster = AppState.pendingDetailPoster || window.pendingCatalogPoster || null;

  if (!poster && searchResult && searchResult.poster) {
    poster = searchResult.poster;
  }

  if (!poster && item && typeof catalogState !== 'undefined' && catalogState.posterCache) {
    poster = catalogState.posterCache.get((id || item.id || '') + '_' + (item.media_type || mediaType));
  }

  if (!poster && item && item.poster_path) {
    poster = buildTmdbPosterUrl(item.poster_path, 'w342');
  }

  if (!poster && searchResult && searchResult.poster_path) {
    poster = buildTmdbPosterUrl(searchResult.poster_path, 'w342');
  }

  return {
    id: id,
    mediaType: mediaType,
    poster: poster,
    item: item
  };
}

var SORT_OPTIONS = [
{ value: 'date-desc', label: 'Сначала новые' },
{ value: 'date-asc', label: 'Сначала старые' },
{ value: 'size-desc', label: 'Размер ↓' },
{ value: 'size-asc', label: 'Размер ↑' },
{ value: 'sid-desc', label: 'Сиды ↓' },
{ value: 'sid-asc', label: 'Сиды ↑' },
{ value: 'pir-desc', label: 'Пиры ↓' },
{ value: 'pir-asc', label: 'Пиры ↑' }];


var QUALITY_OPTIONS = [
{ value: 'all', label: 'Все' },
{ value: '2160', label: '4K (2160p)', short: '4K' },
{ value: '1080', label: 'Full HD (1080p)', short: '1080p' },
{ value: '720', label: 'HD (720p)', short: '720p' },
{ value: '480', label: 'SD (480p)', short: '480p' },
{ value: '360', label: '360p', short: '360p' }];




var VIDEOTYPE_OPTIONS = [
{ value: 'all', label: 'Все' },
{ value: 'sdr', label: 'SDR' },
{ value: 'hdr', label: 'HDR' }];






function parseQualityFilter(value) {
  if (!value || value === 'all') return [];
  var parts = String(value).split(',');
  var out = [];
  for (var i = 1; i < QUALITY_OPTIONS.length; i++) {
    var v = QUALITY_OPTIONS[i].value;
    for (var j = 0; j < parts.length; j++) {
      if (parts[j].trim() === v) {out.push(v);break;}
    }
  }
  return out;
}

function qualityFilterFromList(list) {
  var clean = parseQualityFilter((list || []).join(','));
  return clean.length ? clean.join(',') : 'all';
}



function toggleQualityFilterValue(filter, value) {
  if (value === 'all') return 'all';
  var list = parseQualityFilter(filter);
  var idx = list.indexOf(String(value));
  if (idx === -1) list.push(String(value));else list.splice(idx, 1);
  var result = qualityFilterFromList(list);
  return parseQualityFilter(result).length === QUALITY_OPTIONS.length - 1 ? 'all' : result;
}

function qualityFilterMatches(filter, quality) {
  var list = parseQualityFilter(filter);
  if (!list.length) return true;
  return list.indexOf(String(quality || 0)) !== -1;
}


function qualityFilterLabel(filter) {
  var list = parseQualityFilter(filter);
  if (!list.length) return 'Все';
  var labels = [];
  for (var i = 1; i < QUALITY_OPTIONS.length; i++) {
    if (list.indexOf(QUALITY_OPTIONS[i].value) !== -1) labels.push(QUALITY_OPTIONS[i].short);
  }
  return labels.join(', ');
}





var SEARCH_FILTER_DEFAULTS_KEY = 'searchFilterDefaults';

function hasFilterOption(options, value) {
  for (var i = 0; i < options.length; i++) if (options[i].value === value) return true;
  return false;
}

function getSearchFilterDefaults() {
  var saved = {};
  try {saved = JSON.parse(localStorage.getItem(SEARCH_FILTER_DEFAULTS_KEY) || '{}') || {};} catch (e) {saved = {};}
  return {
    sort: hasFilterOption(SORT_OPTIONS, saved.sort) ? saved.sort : 'date-desc',
    quality: qualityFilterFromList(parseQualityFilter(saved.quality)),
    videotype: hasFilterOption(VIDEOTYPE_OPTIONS, saved.videotype) ? saved.videotype : 'all'
  };
}

function saveSearchFilterDefaults(defaults) {
  try {localStorage.setItem(SEARCH_FILTER_DEFAULTS_KEY, JSON.stringify(defaults));} catch (e) {}
}


function applySearchFilterDefaults(only) {
  var d = getSearchFilterDefaults();
  if (!only || only === 'sort') currentSort = d.sort;
  if (!only || only === 'quality') currentQualityFilter = d.quality;
  if (!only || only === 'videotype') currentvideotypeFilter = d.videotype;
}

window.QUALITY_OPTIONS = QUALITY_OPTIONS;
window.SORT_OPTIONS = SORT_OPTIONS;
window.VIDEOTYPE_OPTIONS = VIDEOTYPE_OPTIONS;
window.parseQualityFilter = parseQualityFilter;
window.toggleQualityFilterValue = toggleQualityFilterValue;
window.qualityFilterLabel = qualityFilterLabel;
window.getSearchFilterDefaults = getSearchFilterDefaults;
window.saveSearchFilterDefaults = saveSearchFilterDefaults;
window.applySearchFilterDefaults = applySearchFilterDefaults;

applySearchFilterDefaults();function


torrServerFetch(_x) {return _torrServerFetch.apply(this, arguments);}function _torrServerFetch() {_torrServerFetch = _asyncToGenerator(function* (endpoint, options = {}) {
    if (!AppState.currentTorrserverUrl) throw new Error('Сервер не подключен');
    var headers = _objectSpread({ 'Content-Type': 'application/json' }, getAuthHeaders());
    return fetch(AppState.currentTorrserverUrl + endpoint, _objectSpread(_objectSpread({},
    options), {}, {
      headers: _objectSpread(_objectSpread({}, headers), options.headers || {}) })
    );
  });return _torrServerFetch.apply(this, arguments);}

function getTrackerFilterOptions() {
  var options = [{ value: 'all', label: 'Все' }];
  for (var i = 0; i < availableTrackers.length; i++) {
    var tracker = availableTrackers[i];
    options.push({ value: tracker, label: tracker.charAt(0).toUpperCase() + tracker.slice(1) });
  }
  return options;
}

function fillSelectOptions(select, options, selectedValue) {
  if (!select) return;
  var normalizedSelected = String(selectedValue !== null && selectedValue !== undefined ? selectedValue : '');
  var optionsHtml = '';
  for (var i = 0; i < options.length; i++) {
    var option = options[i];
    var selected = String(option.value) === normalizedSelected ? ' selected' : '';
    optionsHtml += `<option value="${option.value}"${selected}>${option.label}</option>`;
  }
  select.innerHTML = optionsHtml;
  select.value = normalizedSelected;
}

function syncSearchFilterButtons() {
  fillSelectOptions(getEl('sort-by'), SORT_OPTIONS, currentSort);
  fillSelectOptions(getEl('filter-quality'), QUALITY_OPTIONS, currentQualityFilter);
  fillSelectOptions(getEl('filter-tracker'), getTrackerFilterOptions(), currentTrackerFilter);

  var yearFilter = getEl('filter-year');
  if (yearFilter) yearFilter.value = currentYearFilter && currentYearFilter !== 'all' ? currentYearFilter : 'all';

  var seasonFilter = getEl('filter-season');
  if (seasonFilter) seasonFilter.value = currentSeasonFilter && currentSeasonFilter !== 'all' ? currentSeasonFilter : 'all';

  var voiceFilter = getEl('filter-voice');
  if (voiceFilter) voiceFilter.value = currentVoiceFilter && currentVoiceFilter !== 'all' ? currentVoiceFilter : 'all';

  var videotypeFilter = getEl('filter-videotype');
  if (videotypeFilter) videotypeFilter.value = currentvideotypeFilter && currentvideotypeFilter !== 'all' ? currentvideotypeFilter : 'all';

  if (typeof window.updateFilterValueDisplays === 'function') window.updateFilterValueDisplays();
}

function toggleSearchFiltersPanel(forceOpen) {
  var panel = getEl('search-filters-panel');
  var toggleBtn = getEl('filter-toggle');
  var overlay = getEl('filter-overlay');

  if (!panel) return false;

  var shouldOpen = forceOpen === undefined ? !panel.classList.contains('active') : !!forceOpen;

  if (shouldOpen) {
    if (typeof window.updateFilterValueDisplays === 'function') window.updateFilterValueDisplays();
    panel.classList.add('active');
    if (overlay) overlay.classList.add('active');
    if (toggleBtn) toggleBtn.classList.add('active');
  } else {
    panel.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
    if (toggleBtn) toggleBtn.classList.remove('active');
  }

  return shouldOpen;
}
window.toggleSearchFiltersPanel = toggleSearchFiltersPanel;

function getTorrentFiles(torrent) {
  if (!torrent) return [];
  if (torrent.file_stats && Array.isArray(torrent.file_stats) && torrent.file_stats.length > 0) return torrent.file_stats;
  if (torrent.data) {
    try {
      var data = JSON.parse(torrent.data);
      if (data.TorrServer && Array.isArray(data.TorrServer.Files)) return data.TorrServer.Files;
    } catch (e) {console.warn('Ошибка парсинга torrent.data:', e);}
  }
  return [];
}

function getVideoFilesFromTorrent(torrent) {
  var files = getTorrentFiles(torrent);
  return files.filter((f) => {
    var name = (f.path || '').toLowerCase();
    return ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'].some((ext) => name.includes(ext));
  });
}

function inferSearchResultIsSeries(searchResult, torrent) {
  if (searchResult && searchResult.types && Array.isArray(searchResult.types) && searchResult.types.includes('tv')) return true;
  if (torrent && getVideoFilesFromTorrent(torrent).length > 1) return true;
  var title = (searchResult && (searchResult.title || searchResult.name) || torrent && torrent.title || '').toLowerCase();
  return title.includes('s') && title.includes('e') || title.includes('season') || title.includes('сезон') || title.includes('серия') || title.includes('эпизод');
}

function getPreferredPlaybackFile(torrent, searchResult = null) {
  var videoFiles = getVideoFilesFromTorrent(torrent);
  if (videoFiles.length === 0) return { fileId: 1, episodeIndex: null, isSeries: inferSearchResultIsSeries(searchResult, torrent) };
  var isSeries = inferSearchResultIsSeries(searchResult, torrent) || videoFiles.length > 1;
  return { fileId: videoFiles[0].id || 1, episodeIndex: isSeries ? 0 : null, isSeries: isSeries };
}

window.setTorrentClickSuppressed = function (ms = 1200) {suppressTorrentClickUntil = Date.now() + ms;};


var torrentHoldState = {
  timer: null,
  card: null,
  hash: null,
  pointerId: null,
  startX: 0,
  startY: 0
};

function clearTorrentHoldState() {
  if (torrentHoldState.timer) {
    clearTimeout(torrentHoldState.timer);
  }

  torrentHoldState.timer = null;
  torrentHoldState.card = null;
  torrentHoldState.hash = null;
  torrentHoldState.pointerId = null;
  torrentHoldState.startX = 0;
  torrentHoldState.startY = 0;
}

function setupTorrentLongPressDelegation(grid) {
  if (!grid || grid._longPressBound) return;

  grid._longPressBound = true;


  grid.addEventListener('click', function (e) {
    var card = e.target && e.target.closest ? e.target.closest('.torrent-card') : null;
    if (!card) return;

    var shouldSuppress = card.dataset.suppressClick === '1' || Date.now() < suppressTorrentClickUntil;

    if (shouldSuppress) {
      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();
      delete card.dataset.suppressClick;
      return false;
    }
  }, true);


  grid.addEventListener('contextmenu', function (e) {
    var card = e.target && e.target.closest ? e.target.closest('.torrent-card') : null;
    if (!card || !card.dataset.hash) return;

    e.preventDefault();

    clearTorrentHoldState();

    suppressTorrentClickUntil = Date.now() + 1200;
    card.dataset.suppressClick = '1';

    removeTorrentByHash(card.dataset.hash, { skipConfirm: true }).finally(function () {
      setTimeout(function () {
        if (card) delete card.dataset.suppressClick;
      }, 1200);
    });
  });


  grid.addEventListener('pointerdown', function (e) {
    if (!e.isPrimary) return;


    if (e.button !== undefined && e.button !== 0) return;

    var target = e.target;
    if (!target || !target.closest) return;


    if (target.closest('button, input, select, textarea, a')) return;

    var card = target.closest('.torrent-card');
    if (!card || !card.dataset.hash) return;

    clearTorrentHoldState();

    torrentHoldState.card = card;
    torrentHoldState.hash = card.dataset.hash;
    torrentHoldState.pointerId = e.pointerId;
    torrentHoldState.startX = e.clientX;
    torrentHoldState.startY = e.clientY;

    torrentHoldState.timer = setTimeout(function () {
      var holdCard = torrentHoldState.card;
      var holdHash = torrentHoldState.hash;

      clearTorrentHoldState();

      if (!holdHash) return;

      suppressTorrentClickUntil = Date.now() + 1200;

      if (holdCard) {
        holdCard.dataset.suppressClick = '1';
        holdCard.classList.remove('touch-active');
      }

      removeTorrentByHash(holdHash, { skipConfirm: true }).finally(function () {
        setTimeout(function () {
          if (holdCard) delete holdCard.dataset.suppressClick;
        }, 1200);
      });
    }, TORRENT_DELETE_HOLD_MS);
  }, { passive: true });


  if (!window._torrentLongPressDocumentBound) {
    window._torrentLongPressDocumentBound = true;

    document.addEventListener('pointerup', function (e) {
      if (!torrentHoldState.timer) return;
      if (e.pointerId !== torrentHoldState.pointerId) return;
      clearTorrentHoldState();
    }, { passive: true });

    document.addEventListener('pointercancel', function (e) {
      if (!torrentHoldState.timer) return;
      if (e.pointerId !== torrentHoldState.pointerId) return;
      clearTorrentHoldState();
    }, { passive: true });

    document.addEventListener('pointermove', function (e) {
      if (!torrentHoldState.timer) return;
      if (e.pointerId !== torrentHoldState.pointerId) return;

      var dx = e.clientX - torrentHoldState.startX;
      var dy = e.clientY - torrentHoldState.startY;


      if (dx * dx + dy * dy > 144) {
        clearTorrentHoldState();
      }
    }, { passive: true });
  }
}function


removeTorrentByHash(_x2) {return _removeTorrentByHash.apply(this, arguments);}function _removeTorrentByHash() {_removeTorrentByHash = _asyncToGenerator(function* (hash, options = {}) {
    if (!hash || !AppState.currentTorrserverUrl) return false;
    var torrent = AppState.torrents.find((t) => (t.hash || '').toLowerCase() === String(hash).toLowerCase());
    var title = torrent && torrent.title || 'эту раздачу';
    if (!options.skipConfirm && !window.confirm('Удалить ' + title + '?')) return false;

    showLoading('Удаление торрента...');
    try {
      var response = yield torrServerFetch('/torrents', { method: 'POST', body: JSON.stringify({ action: 'rem', hash: hash }) });
      if (!response.ok) throw new Error('Ошибка удаления: HTTP ' + response.status);
      try {yield response.json();} catch (e) {}

      clearTorrentFilesCache(hash);
      if (AppState.currentDetailItem && (AppState.currentDetailItem.hash || '').toLowerCase() === String(hash).toLowerCase()) {


        if (typeof Animations !== 'undefined' && typeof Animations.animateDetailHide === 'function') {
          Animations.animateDetailHide();
        } else {
          getEl('detail-view').style.display = 'none';
        }
        AppState.currentDetailItem = null;
        AppState.currentScreen = 'torrents';
        var mainContainer = getEl('main-container');
        if (mainContainer) mainContainer.style.pointerEvents = 'auto';
        getEl('torrserver-section').style.display = 'block';
      }
      yield refreshTorrentsList();
      return true;
    } catch (error) {
      console.error('Ошибка удаления торрента:', error);
      alert('Ошибка удаления: ' + error.message);
      return false;
    } finally {hideLoading();}
  });return _removeTorrentByHash.apply(this, arguments);}
window.removeTorrentByHash = removeTorrentByHash;

function attachTorrentDeleteLongPress(card, torrent) {


}









var TS_LOCAL_FLAG = 'tsLocalOnly';
var TS_LOCAL_CONFIG = 'tsLocalConfig';

function isLocalTorrServer() {
  try {return localStorage.getItem(TS_LOCAL_FLAG) === '1';} catch (e) {return false;}
}

function readLocalTorrServerConfig() {
  try {return JSON.parse(localStorage.getItem(TS_LOCAL_CONFIG) || 'null');} catch (e) {return null;}
}









function normalizeTorrServerUrl(raw) {
  var v = String(raw || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) {
    var https = getEl('ts-https');
    v = (https && https.checked ? 'https://' : 'http://') + v.replace(/^\/+/, '');
  }
  return v.replace(/\/+$/, '');
}


function torrServerUrlFromField() {
  var el = getEl('torrserver-url');
  return el ? normalizeTorrServerUrl(el.value) : '';
}
window.torrServerUrlFromField = torrServerUrlFromField;


function syncHttpsToggle() {
  var cb = getEl('ts-https');
  var el = getEl('torrserver-url');
  if (!cb || !el) return;
  var v = el.value.trim();
  if (/^https?:\/\//i.test(v)) cb.checked = /^https:/i.test(v);
}

function setupTorrServerUrlProtocol() {
  var cb = getEl('ts-https');
  var el = getEl('torrserver-url');
  if (!cb || !el) return;
  syncHttpsToggle();

  el.addEventListener('change', function () {
    if (el.value.trim()) el.value = normalizeTorrServerUrl(el.value);
    syncHttpsToggle();
  });
  cb.addEventListener('change', function () {
    var v = el.value.trim();
    if (!v) return;
    el.value = (cb.checked ? 'https://' : 'http://') + v.replace(/^https?:\/\//i, '');
    checkServer(true);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupTorrServerUrlProtocol);else
setupTorrServerUrlProtocol();


function torrServerFieldsConfig() {
  return {
    url: torrServerUrlFromField(),
    authEnabled: getEl('auth-checkbox').checked,
    login: getEl('auth-login').value.trim(),
    password: getEl('auth-password').value
  };
}


function applyTorrServerConfig(cfg) {
  if (!cfg) return;
  var urlInput = getEl('torrserver-url');
  var authCheckbox = getEl('auth-checkbox');
  var authLogin = getEl('auth-login');
  var authPassword = getEl('auth-password');
  var authFields = getEl('auth-fields');
  if (cfg.url) urlInput.value = cfg.url;
  syncHttpsToggle();
  authCheckbox.checked = !!cfg.authEnabled;
  AppState.authEnabled = !!cfg.authEnabled;
  if (authFields) authFields.classList.toggle('visible', !!cfg.authEnabled);
  authLogin.value = cfg.login || '';
  authPassword.value = cfg.password || '';
}

function setupLocalTorrServerToggle() {
  var box = getEl('ts-local-only');
  if (!box) return;
  box.checked = isLocalTorrServer();
  box.addEventListener('change', function () {
    if (box.checked) {


      try {
        localStorage.setItem(TS_LOCAL_CONFIG, JSON.stringify(torrServerFieldsConfig()));
        localStorage.setItem(TS_LOCAL_FLAG, '1');
      } catch (e) {}
      return;
    }

    try {localStorage.removeItem(TS_LOCAL_FLAG);localStorage.removeItem(TS_LOCAL_CONFIG);} catch (e) {}
    loadClientConfig().then(function () {
      if (typeof checkServer === 'function') checkServer(true);
    });
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupLocalTorrServerToggle);else
setupLocalTorrServerToggle();








var TS_DEVICE_FLAG = 'tsDeviceServer';
var TS_DEVICE_BACKUP = 'tsDeviceBackup';
var TS_DEVICE_URL = 'http://localhost:8090';

function isDeviceTorrServer() {
  try {return localStorage.getItem(TS_DEVICE_FLAG) === '1';} catch (e) {return false;}
}


function lockDeviceTorrServerFields(on) {
  var urlInput = getEl('torrserver-url');
  var localBox = getEl('ts-local-only');
  var httpsBox = getEl('ts-https');
  if (urlInput) urlInput.disabled = on;
  if (localBox) localBox.disabled = on;
  if (httpsBox) httpsBox.disabled = on;
  syncHttpsToggle();
}




















var WebOSTorrServer = function () {
  var DIR = '/media/developer/torrstream-torrserver';
  var INIT = '/var/lib/webosbrew/init.d/60-torrstream-torrserver';
  var ASSET = 'TorrServer-linux-arm7';
  var RELEASE_API = 'https://api.github.com/repos/YouROK/TorrServer/releases/latest';
  var HB = 'luna://org.webosbrew.hbchannel.service';






  var MATRIX_DIR = '/media/developer/apps/usr/palm/applications/torrserv.matrix.app';
  var MATRIX_INIT = '/var/lib/webosbrew/init.d/60-torrservmatrixapp';
  var MATRIX_FLAG = '/media/internal/downloads/ts_autostart_flag';

  var st = {
    supported: true, installed: false, version: '', running: false, own: false,
    runningVersion: '', downloading: false, progress: 0, error: '', latest: '',
    unsupportedText: '', note: '', matrix: false, matrixAutostart: false,
    canReplace: false,
    ask: ''
  };
  var pending = null;
  var asked = false;
  var release = null;
  var refreshing = false;
  var afterInstall = '';
  var probedAt = 0;
  var execPending = [];
  var rooted = null;
  var rootError = '';

  function enabled() {
    return AppState.platform === 'webos';
  }





  function hb(method, params, cb, timeoutMs) {
    var done = false;
    var finish = function (r) {if (!done) {done = true;cb(r);}};
    try {
      if (typeof window.PalmServiceBridge === 'undefined') {finish({ returnValue: false, errorText: 'нет PalmServiceBridge' });return;}
      var bridge = new window.PalmServiceBridge();


      execPending.push(bridge);
      var release = function () {
        var i = execPending.indexOf(bridge);
        if (i !== -1) execPending.splice(i, 1);
      };
      bridge.onservicecallback = function (msg) {
        release();
        var r = {};
        try {r = JSON.parse(msg);} catch (e) {}
        finish(r);
      };

      setTimeout(function () {release();finish({ returnValue: false, errorText: 'Homebrew Channel не отвечает' });}, timeoutMs || 5000);
      bridge.call(HB + '/' + method, JSON.stringify(params || {}));
    } catch (e) {finish({ returnValue: false, errorText: e.message });}
  }


  function exec(command, cb) {
    if (rooted !== true) {cb(rootError || 'нет root');return;}
    hb('exec', { command: command }, function (r) {
      if (r.returnValue === false) cb(r.errorText || r.stderrString || 'ошибка', r.stdoutString || '');else
      cb(null, r.stdoutString || '');
    }, 120000);
  }






  function checkRoot(done) {
    if (rooted !== null) {done();return;}
    hb('checkRoot', {}, function (r) {
      rooted = r.returnValue === true;
      if (!rooted) {
        rootError = /не отвечает|PalmServiceBridge/.test(r.errorText || '') ?
        'Встроенный TorrServer ставится только на телевизор с Homebrew Channel и root' :
        'Нужен root: Homebrew Channel работает без него';
      }
      done();
    });
  }

  function echo(done) {
    var x = new XMLHttpRequest(),fin = false;
    var finish = function (v) {if (!fin) {fin = true;done(v);}};
    try {
      x.open('GET', 'http://127.0.0.1:8090/echo?_=' + Date.now(), true);
      x.timeout = 1500;
      x.onload = function () {finish(x.status === 200 ? String(x.responseText || '').trim().slice(0, 40) : '');};
      x.onerror = x.ontimeout = function () {finish('');};
      x.send();
    } catch (e) {finish('');}
  }

  function fetchRelease(done) {
    var x = new XMLHttpRequest();
    try {
      x.open('GET', RELEASE_API, true);
      x.timeout = 15000;
      x.onload = function () {
        var rel = null;
        try {
          var d = JSON.parse(x.responseText);
          for (var i = 0; i < (d.assets || []).length; i++) {
            if (d.assets[i].name === ASSET) {
              rel = { tag: d.tag_name, url: d.assets[i].browser_download_url, size: d.assets[i].size };
            }
          }
        } catch (e) {}
        if (rel) {release = rel;st.latest = rel.tag;}
        done(rel);
      };
      x.onerror = x.ontimeout = function () {done(null);};
      x.send();
    } catch (e) {done(null);}
  }


  function refresh() {
    if (refreshing) return;
    refreshing = true;
    checkRoot(function () {
      if (rooted) {refreshRooted();return;}

      echo(function (ver) {
        refreshing = false;
        st.running = !!ver;
        st.runningVersion = ver;
        st.own = false;st.installed = false;st.downloading = false;
        st.canReplace = false;
        st.supported = !!ver;
        st.unsupportedText = rootError;
      });
    });
  }

  function refreshRooted() {


    var cmd = '[ -d ' + MATRIX_DIR + ' ] && echo M; ' +
    '[ -e ' + MATRIX_INIT + ' ] && echo MA; ' +
    'cd ' + DIR + ' 2>/dev/null || { echo NODIR; exit 0; }; ' +
    '[ -x TorrServer ] && echo I; ' +
    '[ -f version ] && sed "s/^/V:/" version | head -1; ' +
    '[ -f pid ] && kill -0 $(cat pid) 2>/dev/null && echo R; ' +
    '[ -f dl ] && echo D; ' +
    '[ -f TorrServer.part ] && echo P:$(wc -c < TorrServer.part); ' +
    '[ -f err ] && sed "s/^/E:/" err | head -1; true';
    exec(cmd, function (err, out) {
      if (err) {
        refreshing = false;
        st.supported = false;
        st.unsupportedText = 'Нужен Homebrew Channel с root (' + err + ')';
        return;
      }
      st.supported = true;
      var lines = String(out).split('\n');
      var has = function (k) {return lines.indexOf(k) !== -1;};
      var val = function (p) {
        for (var i = 0; i < lines.length; i++) if (lines[i].indexOf(p) === 0) return lines[i].slice(p.length).trim();
        return '';
      };
      var wasDownloading = st.downloading;
      st.installed = has('I');
      st.version = val('V:');
      st.own = has('R');
      st.downloading = has('D');
      var part = parseInt(val('P:'), 10) || 0;
      st.progress = st.downloading && release && release.size ? Math.min(99, Math.round(part * 100 / release.size)) : 0;
      st.error = val('E:');
      st.matrix = has('M');
      st.matrixAutostart = has('MA');
      echo(function (ver) {
        refreshing = false;
        st.running = !!ver;
        st.runningVersion = ver;
        st.canReplace = !!ver && !st.own;

        if (wasDownloading && !st.downloading && afterInstall && st.installed && !st.error) {
          afterInstall = '';
          start();
        }
      });
    });
  }

  function status() {

    if (Date.now() - probedAt > 1000) {probedAt = Date.now();refresh();}
    return st;
  }

  function install() {
    st.error = '';
    var go = function (rel) {
      if (!rel) {st.error = 'не удалось получить релиз TorrServer с GitHub';return;}
      st.downloading = true;st.progress = 0;
      afterInstall = 'start';


      var cmd = 'mkdir -p ' + DIR + ' && cd ' + DIR + ' && rm -f err && touch dl && ' +
      '( [ -f pid ] && kill $(cat pid) 2>/dev/null; ' +
      '( curl -fsSL -o TorrServer.part "' + rel.url + '" || wget -q -O TorrServer.part "' + rel.url + '" ) ' +
      '&& chmod +x TorrServer.part && mv -f TorrServer.part TorrServer && echo "' + rel.tag + '" > version ' +
      '|| { echo "не удалось скачать TorrServer" > err; rm -f TorrServer.part; }; rm -f dl ) ' +
      '> /dev/null 2>&1 < /dev/null &';
      exec(cmd, function (err) {if (err) {st.error = String(err);st.downloading = false;}refresh();});
    };
    if (release) go(release);else fetchRelease(go);
  }


  function disableMatrixAutostart(done) {


    var cmd = 'rm -f ' + MATRIX_INIT + ' ' + MATRIX_FLAG + '; ' +
    '[ -d ' + MATRIX_DIR + ' ] && { echo disabled > ' + MATRIX_DIR + '/status; echo enable > ' + MATRIX_DIR + '/action; }; true';
    exec(cmd, function () {st.matrixAutostart = false;done();});
  }





  function askAutostart(next) {
    if (asked || !st.matrix || !st.matrixAutostart) return false;
    st.ask = 'TorrServer из приложения torrserv.matrix.app запускается при включении телевизора. ' +
    'Убрать его из автозапуска? Если оставить, он может занять порт раньше встроенного';
    pending = next;
    return true;
  }

  function answer(remove) {
    asked = true;
    st.ask = '';
    var next = pending;
    pending = null;
    if (!next) return;
    if (remove) disableMatrixAutostart(next);else next();
  }


  function stopForeign(done) {

    var cmd = 'pidof torrserver > /dev/null 2>&1 && { killall torrserver 2>/dev/null || kill $(pidof torrserver); }; ' +
    'P=$(netstat -tlnp 2>/dev/null | grep ":8090 " | sed -n "s#.* \\([0-9][0-9]*\\)/.*#\\1#p" | head -1); ' +
    '[ -n "$P" ] && [ "$P" != "$(cat ' + DIR + '/pid 2>/dev/null)" ] && kill $P; true';
    exec(cmd, function () {setTimeout(done, 1500);});
  }


  function replace() {
    var go = function () {
      stopForeign(function () {if (st.installed) startNow();else install();});
    };
    if (!askAutostart(go)) go();
  }

  function start() {
    if (askAutostart(startNow)) return;
    startNow();
  }

  function startNow() {

    echo(function (ver) {
      if (ver) {refresh();return;}
      var script = [
      '#!/bin/sh',
      '# TorrStream: встроенный TorrServer (автозапуск Homebrew Channel)',
      'DIR=' + DIR,
      'curl -s -m 3 http://127.0.0.1:8090/echo > /dev/null 2>&1 && exit 0',
      'cd $DIR || exit 0',
      'GODEBUG=madvdontneed=1 nohup ./TorrServer -p 8090 -d $DIR > $DIR/ts.log 2>&1 < /dev/null &',
      'echo $! > $DIR/pid'];

      var cmd = 'cd ' + DIR + ' && printf "%s\\n" ' + script.map(function (l) {return "'" + l + "'";}).join(' ') +
      ' > autostart.sh && chmod +x autostart.sh && mkdir -p /var/lib/webosbrew/init.d && ' +
      'ln -sf ' + DIR + '/autostart.sh ' + INIT + ' && sh ' + DIR + '/autostart.sh';
      exec(cmd, function (err) {if (err) st.error = String(err);setTimeout(refresh, 1500);});
    });
  }

  function stop() {

    exec('[ -f ' + DIR + '/pid ] && kill $(cat ' + DIR + '/pid) 2>/dev/null; rm -f ' + DIR + '/pid ' + INIT + '; true',
    function () {setTimeout(refresh, 800);});
  }

  function checkUpdate() {fetchRelease(function () {});}

  return {
    enabled: enabled, status: status, install: install, start: start, stop: stop,
    checkUpdate: checkUpdate, refresh: refresh, replace: replace,
    answerRemove: function () {answer(true);}, answerKeep: function () {answer(false);}
  };
}();
window.WebOSTorrServer = WebOSTorrServer;





function deviceTorrServerBridge() {
  if (window.AndroidJS && typeof AndroidJS.tsLocalStatus === 'function') {
    return {
      status: function () {try {return JSON.parse(AndroidJS.tsLocalStatus());} catch (e) {return null;}},
      install: function () {AndroidJS.tsLocalInstall();},
      start: function () {AndroidJS.tsLocalStart();},
      stop: function () {AndroidJS.tsLocalStop();},
      checkUpdate: function () {AndroidJS.tsLocalCheckUpdate();}
    };
  }
  if (WebOSTorrServer.enabled()) return WebOSTorrServer;
  return null;
}

function setupDeviceTorrServerToggle() {
  var row = getEl('ts-device-row');
  var box = getEl('ts-device-server');
  if (!row || !box || !deviceTorrServerBridge()) return;
  row.hidden = false;
  var localBox = getEl('ts-local-only');

  box.checked = isDeviceTorrServer();
  lockDeviceTorrServerFields(box.checked);

  if (box.checked && getEl('torrserver-url').value.trim() !== TS_DEVICE_URL) {
    getEl('torrserver-url').value = TS_DEVICE_URL;
  }

  box.addEventListener('change', function () {
    var urlInput = getEl('torrserver-url');
    if (box.checked) {
      try {
        localStorage.setItem(TS_DEVICE_BACKUP, JSON.stringify({
          cfg: torrServerFieldsConfig(),
          wasLocal: isLocalTorrServer()
        }));
        localStorage.setItem(TS_DEVICE_FLAG, '1');
        localStorage.setItem(TS_LOCAL_FLAG, '1');
      } catch (e) {}
      if (localBox) localBox.checked = true;
      urlInput.value = TS_DEVICE_URL;
      syncHttpsToggle();
      lockDeviceTorrServerFields(true);
      try {localStorage.setItem(TS_LOCAL_CONFIG, JSON.stringify(torrServerFieldsConfig()));} catch (e) {}
      checkServer(true);
      deviceTorrServerPanel.onToggle(true);
      return;
    }
    deviceTorrServerPanel.onToggle(false);

    var backup = null;
    try {backup = JSON.parse(localStorage.getItem(TS_DEVICE_BACKUP) || 'null');} catch (e) {}
    try {localStorage.removeItem(TS_DEVICE_FLAG);localStorage.removeItem(TS_DEVICE_BACKUP);} catch (e) {}
    lockDeviceTorrServerFields(false);
    if (backup && backup.wasLocal) {

      applyTorrServerConfig(backup.cfg);
      if (backup.cfg && !backup.cfg.url) urlInput.value = '';
      try {localStorage.setItem(TS_LOCAL_CONFIG, JSON.stringify(torrServerFieldsConfig()));} catch (e) {}
      checkServer(true);
      return;
    }

    if (localBox) localBox.checked = false;
    try {localStorage.removeItem(TS_LOCAL_FLAG);localStorage.removeItem(TS_LOCAL_CONFIG);} catch (e) {}
    loadClientConfig().then(function () {checkServer(true);});
  });
}









var deviceTorrServerPanel = function () {
  var POLL_MS = 1500;
  var timer = null;
  var wasRunning = null;
  var lastStatus = null;

  function bridge() {
    return !!deviceTorrServerBridge();
  }

  function readStatus() {
    var b = deviceTorrServerBridge();
    return b ? b.status() : null;
  }

  function show(id, on) {
    var el = getEl(id);
    if (el) el.hidden = !on;
  }

  function render(st) {
    var text;
    if (st.ask) text = st.ask;else
    if (!st.supported) text = st.unsupportedText || 'Процессор этого устройства TorrServer не поддерживает';else
    if (st.downloading) text = 'Скачиваю TorrServer… ' + (st.progress || 0) + '%';else
    if (st.running && st.own) text = 'Работает встроенный TorrServer ' + (st.version || '');else
    if (st.running) text = 'На устройстве уже работает TorrServer ' + (st.runningVersion || '') + ' — используется он';else
    if (st.installed) text = 'TorrServer ' + (st.version || '') + ' установлен, но не запущен';else
    text = 'TorrServer на устройстве не найден. Можно скачать официальную сборку (около 65 МБ)';
    if (st.note && !st.downloading) text += '. ' + st.note;
    if (st.error && !st.downloading) text += '. Ошибка: ' + st.error;
    var status = getEl('ts-device-status');
    if (status) status.textContent = text;


    var busy = st.downloading || !!st.ask;
    var external = st.running && !st.own;
    show('ts-device-install', st.supported && !st.installed && !external && !busy);
    show('ts-device-start', st.installed && !st.running && !busy);
    show('ts-device-stop', st.own && !busy);
    show('ts-device-update', st.installed && !external && !busy && st.latest && st.latest !== st.version);
    show('ts-device-replace', external && !!st.canReplace && !busy);
    show('ts-device-autostart-off', !!st.ask);
    show('ts-device-autostart-keep', !!st.ask);
    var upd = getEl('ts-device-update');
    if (upd && st.latest) upd.textContent = 'Обновить до ' + st.latest;


    if (st.running && wasRunning === false) checkServer(true);
    wasRunning = !!st.running;



    var f = document.querySelector('#ts-device-panel .focused');
    if (f && f.hidden) focusEl(getEl('ts-device-server'));
  }

  function tick() {
    var panel = getEl('ts-device-panel');
    if (!panel || panel.hidden) {stop();return;}

    if (panel.offsetParent === null) return;
    var st = readStatus();
    if (!st) return;
    lastStatus = st;
    render(st);
  }

  function start() {
    if (timer) return;
    tick();
    timer = setInterval(tick, POLL_MS);
  }

  function stop() {
    if (timer) {clearInterval(timer);timer = null;}
  }

  function act(method) {
    try {deviceTorrServerBridge()[method]();} catch (e) {console.warn('TorrServer: ' + method, e);}
    setTimeout(tick, 300);
  }

  function setup() {
    if (!bridge()) return;
    var bind = function (id, method) {
      var b = getEl(id);
      if (b) b.addEventListener('click', function () {act(method);});
    };
    bind('ts-device-install', 'install');
    bind('ts-device-start', 'start');
    bind('ts-device-stop', 'stop');
    bind('ts-device-update', 'install');

    bind('ts-device-replace', 'replace');
    bind('ts-device-autostart-off', 'answerRemove');
    bind('ts-device-autostart-keep', 'answerKeep');
    if (isDeviceTorrServer()) onToggle(true, true);
  }


  function onToggle(on, atStartup) {
    var panel = getEl('ts-device-panel');
    if (!panel || !bridge()) return;
    panel.hidden = !on;
    if (!on) {
      stop();




      act('stop');
      return;
    }
    try {deviceTorrServerBridge().checkUpdate();} catch (e) {}
    wasRunning = null;


    var st0 = readStatus();
    if (!atStartup && st0 && st0.installed && !st0.running) act('start');



    if (atStartup && WebOSTorrServer.enabled()) {
      setTimeout(function () {
        var s = readStatus();
        if (s && s.supported && s.installed && !s.running && !s.downloading) act('start');
      }, 2500);
    }
    start();
  }

  return { setup: setup, onToggle: onToggle, status: function () {return lastStatus;} };
}();

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupDeviceTorrServerToggle);else
setupDeviceTorrServerToggle();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', deviceTorrServerPanel.setup);else
deviceTorrServerPanel.setup();








function setupTorrServerDiscovery() {
  var box = getEl('ts-discover');
  var btn = getEl('ts-discover-btn');
  var status = getEl('ts-discover-status');
  var list = getEl('ts-discover-list');
  if (!box || !btn || !window.AndroidJS || typeof AndroidJS.tsDiscoverStart !== 'function') return;
  var timer = null;


  function syncVisibility() {
    box.hidden = isDeviceTorrServer();
  }
  syncVisibility();
  var deviceBox = getEl('ts-device-server');
  if (deviceBox) deviceBox.addEventListener('change', syncVisibility);

  function setStatus(text) {
    status.textContent = text;
    status.hidden = !text;
  }

  function render(st) {
    var servers = st.servers || [];
    list.innerHTML = '';
    for (var i = 0; i < servers.length; i++) {
      var s = servers[i];
      var item = document.createElement('button');
      item.className = 'btn';
      item.dataset.url = s.url;
      var meta = s.url.replace(/^http:\/\//, '') + (s.version ? ' · ' + s.version : '') + (s.self ? ' · это устройство' : '');
      item.innerHTML = escapeHtml(s.name || 'TorrServer') + '<span class="ts-discover-meta">' + escapeHtml(meta) + '</span>';
      list.appendChild(item);
    }
    if (st.error) setStatus(st.error);else
    if (st.discovering) setStatus(servers.length ? 'Ищу… найдено: ' + servers.length : 'Ищу TorrServer в сети…');else
    setStatus(servers.length ? 'Найдено: ' + servers.length + '. Выберите сервер' :
    'TorrServer в сети не найден. Он должен быть в той же сети, с включённым Bonjour (mDNS) в его настройках');
    btn.textContent = st.discovering ? 'Поиск…' : 'Найти TorrServer в сети';
  }

  function poll() {
    var st;
    try {st = JSON.parse(AndroidJS.tsDiscoverStatus());} catch (e) {return;}
    render(st);
    if (!st.discovering && timer) {clearInterval(timer);timer = null;}
  }

  btn.addEventListener('click', function () {
    if (timer) return;
    try {AndroidJS.tsDiscoverStart();} catch (e) {setStatus('Поиск недоступен');return;}
    list.innerHTML = '';
    setStatus('Ищу TorrServer в сети…');
    btn.textContent = 'Поиск…';


    setTimeout(function () {poll();timer = setInterval(poll, 700);}, 400);
  });

  list.addEventListener('click', function (e) {
    var item = e.target.closest ? e.target.closest('button[data-url]') : null;
    if (!item) return;
    var urlInput = getEl('torrserver-url');
    if (!urlInput || urlInput.disabled) return;
    urlInput.value = item.dataset.url;
    syncHttpsToggle();
    setStatus('Выбран ' + item.dataset.url);
    checkServer(true);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupTorrServerDiscovery);else
setupTorrServerDiscovery();

window.isLocalTorrServer = isLocalTorrServer;function

loadClientConfig() {return _loadClientConfig.apply(this, arguments);}function _loadClientConfig() {_loadClientConfig = _asyncToGenerator(function* () {
    try {
      var savedClientId = localStorage.getItem('clientId');
      var url = SERVER_URL + '/api/client/config' + (savedClientId ? '?clientId=' + encodeURIComponent(savedClientId) : '');
      var response = yield fetch(url);
      if (response.ok) {
        var data = yield response.json();
        AppState.clientId = data.clientId;




        var currentClientId = localStorage.getItem('clientId');
        if (currentClientId === savedClientId && currentClientId !== data.clientId) localStorage.setItem('clientId', data.clientId);

        if (isLocalTorrServer()) {
          applyTorrServerConfig(readLocalTorrServerConfig());
        } else if (data.config) {
          applyTorrServerConfig({
            url: data.config.url,
            authEnabled: data.config.authEnabled,
            login: data.config.login,
            password: data.config.hasPassword ? data.config.password : ''
          });
        }
        return data;
      }
    } catch (error) {console.error('Ошибка загрузки конфигурации:', error);}
    return null;
  });return _loadClientConfig.apply(this, arguments);}function

saveClientConfig() {return _saveClientConfig.apply(this, arguments);}function _saveClientConfig() {_saveClientConfig = _asyncToGenerator(function* () {

    if (isLocalTorrServer()) {
      try {localStorage.setItem(TS_LOCAL_CONFIG, JSON.stringify(torrServerFieldsConfig()));} catch (e) {}
      return true;
    }
    var config = {
      url: torrServerUrlFromField(),
      authEnabled: getEl('auth-checkbox').checked,
      login: getEl('auth-login').value.trim(),
      clientId: localStorage.getItem('clientId')
    };
    var password = getEl('auth-password').value.trim();
    if (password) config.password = password;
    try {
      var response = yield fetch(SERVER_URL + '/api/client/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
      if (response.ok) return true;
    } catch (error) {console.error('Ошибка сохранения конфигурации:', error);}
    return false;
  });return _saveClientConfig.apply(this, arguments);}

















function preloadDetailFile(hash, fileId) {
  if (!hash || !fileId) return;



  if (window.AndroidJS || AppState.platform === 'webos') return;

  if (typeof preloadTorrents !== 'function') return;


  if (AppState.currentScreen !== 'detail') return;
  var openItem = AppState.currentDetailItem;
  if (!openItem || String(openItem.hash || '').toLowerCase() !== String(hash).toLowerCase()) return;
  preloadTorrents(hash, fileId);
}










var openTorrentDetailHash = '';

function isOpenTorrentDetail(torrent) {
  return !!(torrent && torrent.hash) &&
  String(torrent.hash).toLowerCase() === openTorrentDetailHash;
}
window.isOpenTorrentDetail = isOpenTorrentDetail;function

addProgressToDetail(_x3, _x4) {return _addProgressToDetail.apply(this, arguments);}function _addProgressToDetail() {_addProgressToDetail = _asyncToGenerator(function* (torrent, preloadedFiles) {
    if (!torrent || !torrent.hash) return null;
    var btn = getEl('detail-progress-btn');
    if (!btn) return null;
    var oldProgressBlocks = document.querySelectorAll('#detail-progress');
    for (var i = 0; i < oldProgressBlocks.length; i++) oldProgressBlocks[i].remove();
    if (!btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', function () {var _ref3 = _asyncToGenerator(function* (e) {
          e.stopPropagation();
          var hash = btn.dataset.hash || '';
          var fileId = parseInt(btn.dataset.fileId || '1', 10) || 1;
          var timecode = parseInt(btn.dataset.timecode || '0', 10) || 0;
          var episodeIndex = parseInt(btn.dataset.episodeIndex || '0', 10) || 0;



          if (!hash) {
            if (typeof window.showErrorBanner === 'function') window.showErrorBanner('Не удалось начать воспроизведение', 'У раздачи нет hash');
            return;
          }
          if (!(yield ensureTorrserverOnline())) return;
          var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;
          getEl('playback-overlay').classList.add('active');
          var detailView = getEl('detail-view');
          if (detailView) detailView.style.pointerEvents = 'none';
          startHLSPlayback(playUrl, timecode, false, episodeIndex).finally(function () {
            getEl('playback-overlay').classList.remove('active');
            if (detailView) detailView.style.pointerEvents = 'auto';
          });
        });return function (_x33) {return _ref3.apply(this, arguments);};}());
    }



    var showButton = function () {
      btn.classList.remove('hidden');
      btn.style.removeProperty('display');
      var extra = getEl('catalog-detail-extra');
      if (extra) {
        extra.classList.remove('hidden');
        extra.style.removeProperty('display');
      }
    };


    var progress = yield loadProgressForTorrent(torrent, preloadedFiles);

    if (!isOpenTorrentDetail(torrent)) return null;
    btn.dataset.hash = torrent.hash;
    btn.dataset.fileId = '1';
    btn.dataset.timecode = '0';
    btn.dataset.episodeIndex = '0';
    btn.classList.remove('has-progress');
    if (!progress || !(progress.timecode > 0)) {
      btn.innerHTML = '<span class="btn-label">▶ Играть</span>';
      showButton();
      return null;
    }
    var fileId = parseInt(progress.fileId, 10) || 1;
    var timecode = progress.timecode;
    var episodeIndex = progress.episodeIndex || 0;
    var percent = progress.duration > 0 ? timecode / progress.duration * 100 : 0;
    var remaining = 100 - percent;
    var isNextFile = false;
    if (remaining <= 5) {
      var videoFiles = getVideoFilesFromTorrent(torrent);
      var nextFile = videoFiles.length ? videoFiles[episodeIndex + 1] : null;
      if (nextFile) {
        fileId = nextFile.id || fileId + 1;
        timecode = 0;
        episodeIndex = episodeIndex + 1;
        isNextFile = true;
      } else if (progress.isSeries && episodeIndex + 1 < (progress.totalEpisodes || 0)) {
        fileId = fileId + 1;
        timecode = 0;
        episodeIndex = episodeIndex + 1;
        isNextFile = true;
      } else {
        timecode = 0;
      }
    }
    btn.dataset.fileId = String(fileId);
    btn.dataset.timecode = String(timecode);
    btn.dataset.episodeIndex = String(episodeIndex);
    btn.classList.add('has-progress');
    var timeStr = formatTime(progress.timecode);
    var totalStr = progress.duration ? formatTime(progress.duration) : '??:??';
    var hint = '';
    if (isNextFile) {
      hint = 'Серия ' + (episodeIndex + 1);
    } else {
      hint = timeStr + ' / ' + totalStr;
      if (progress.isSeries) hint = 'Серия ' + (episodeIndex + 1) + ' · ' + hint;
    }
    btn.innerHTML =
    '<span class="btn-label">▶ Продолжить</span>' +
    '<span class="btn-hint">' + hint + '</span>';
    showButton();
    return fileId;
  });return _addProgressToDetail.apply(this, arguments);}









var TORRSERVER_PROBE_TIMEOUT_MS = 8000;function

checkServer() {return _checkServer.apply(this, arguments);}function _checkServer() {_checkServer = _asyncToGenerator(function* (shouldLoadTorrents = true) {
    var urlInput = getEl('torrserver-url');
    var statusIndicator = getEl('status-indicator');
    var statusText = getEl('status-text');
    var authCheckbox = getEl('auth-checkbox');
    var authLogin = getEl('auth-login');
    var authPassword = getEl('auth-password');


    var url = normalizeTorrServerUrl(urlInput.value);
    if (url && document.activeElement !== urlInput && urlInput.value.trim() !== url) {
      urlInput.value = url;
      syncHttpsToggle();
    }
    if (!url) {statusIndicator.className = 'status-indicator status-offline';statusText.textContent = 'Введите адрес сервера';return false;}
    statusIndicator.className = 'status-indicator status-checking';statusText.textContent = 'Проверка...';
    try {
      var testUrl = url.endsWith('/') ? url.slice(0, -1) : url;
      var headers = getAuthHeaders();
      if (authCheckbox && authCheckbox.checked) {
        var login = authLogin ? authLogin.value.trim() : '';
        var password = authPassword ? authPassword.value : '';
        if (login && password) headers['Authorization'] = 'Basic ' + btoa(login + ':' + password);
      }
      var probe = new AbortController();
      var probeTimer = setTimeout(function () {probe.abort();}, TORRSERVER_PROBE_TIMEOUT_MS);
      var response;
      try {
        response = yield fetch(testUrl + '/echo', { method: 'GET', headers: headers, signal: probe.signal });
      } finally {
        clearTimeout(probeTimer);
      }
      if (response.ok) {


        statusIndicator.className = 'status-indicator status-online';statusText.textContent = 'Сервер доступен ✓';
        AppState.currentTorrserverUrl = testUrl;AppState.serverOnline = true;
        if (authCheckbox && authCheckbox.checked) {AppState.authEnabled = true;AppState.authLogin = authLogin ? authLogin.value.trim() : '';AppState.authPassword = authPassword ? authPassword.value : '';} else
        AppState.authEnabled = false;
        yield saveClientConfig();
        if (shouldLoadTorrents) yield loadTorrents(true);
        return true;

      }
      throw new Error('Сервер не отвечает');
    } catch (error) {
      console.error('Ошибка проверки сервера:', error);
      statusIndicator.className = 'status-indicator status-offline';statusText.textContent = 'Сервер недоступен ✗';AppState.serverOnline = false;return false;
    }
  });return _checkServer.apply(this, arguments);}function

loadTorrents() {return _loadTorrents.apply(this, arguments);}function _loadTorrents() {_loadTorrents = _asyncToGenerator(function* (silent = false) {
    if (AppState.torrentsLoading) {
      return false;
    }

    AppState.torrentsLoading = true;

    var torrentsGrid = getEl('torrents-grid');

    try {
      if (!AppState.serverOnline) {
        var checked = yield checkServer(false);

        if (!checked) {
          if (!silent) {
            alert('Сначала подключитесь к серверу');
            getEl('config-screen').style.display = 'flex';
            getEl('torrserver-section').style.display = 'none';


            if (window.Nav) Nav.push('config', { key: 'config' });
            AppState.currentScreen = 'config';
          }

          return false;
        }
      }

      if (!silent) {
        showLoading('Загрузка торрентов...');

        if (torrentsGrid) {
          torrentsGrid.innerHTML =
          '<div style="grid-column: 1 / -1; text-align: center; padding: 40px;">Загрузка...</div>';
        }
      }

      var response = yield torrServerFetch('/torrents', {
        method: 'POST',
        body: JSON.stringify({ action: 'list' })
      });

      if (!response.ok) {
        throw new Error('Ошибка загрузки: HTTP ' + response.status);
      }

      var data = yield response.json();

      AppState.torrents = Array.isArray(data) ? data : [];


      AppState.torrentsLoaded = true;




      var homeActive = !!(window.HomeScreen && window.HomeScreen.isActive());






      var configScreen = getEl('config-screen');
      var configOpen = !!(configScreen &&
      configScreen.style.display !== 'none' &&
      !configScreen.classList.contains('hidden'));

      var keepScreen = homeActive || configOpen;


      if (!keepScreen) {
        if (configScreen) configScreen.style.display = 'none';
        getEl('torrserver-section').style.display = 'block';
        AppState.currentScreen = 'torrents';
        AppState.inSearch = 'torrents';
      }

      renderTorrents();



      if (
      !keepScreen &&
      AppState.currentScreen === 'torrents' &&
      AppState.torrents.length > 0 &&
      !document.querySelector('.torrent-card.focused'))
      {
        setTimeout(function () {
          if (typeof window.focusFirstTorrentCard === 'function') {
            window.focusFirstTorrentCard();
          }
        }, 80);
      }

      return true;
    } catch (error) {
      console.error('Ошибка загрузки торрентов:', error);



      AppState.torrentsLoaded = true;

      if (!silent && torrentsGrid) {
        torrentsGrid.innerHTML =
        '<div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">' +
        '<div style="font-size: 16px; color: #ff6a6a;">Ошибка: ' + error.message + '</div>' +
        '<button class="btn" style="margin-top: 20px;" onclick="loadTorrents()">Попробовать снова</button>' +
        '</div>';
      }

      return false;
    } finally {
      AppState.torrentsLoading = false;

      if (!silent) {
        hideLoading();
      }
    }
  });return _loadTorrents.apply(this, arguments);}

var lastTorrentsRefreshAt = 0;function

refreshTorrents() {return _refreshTorrents.apply(this, arguments);}function _refreshTorrents() {_refreshTorrents = _asyncToGenerator(function* (showLoadingFlag = true) {
    var now = Date.now();


    if (now - lastTorrentsRefreshAt < 700) {
      return false;
    }

    lastTorrentsRefreshAt = now;

    if (typeof torrentProgressCache !== 'undefined') torrentProgressCache.clear();

    return yield loadTorrents(!showLoadingFlag);
  });return _refreshTorrents.apply(this, arguments);}

window.refreshTorrents = refreshTorrents;










function torrentsSignature(list) {
  var parts = [];
  for (var i = 0; i < list.length; i++) {
    parts.push((list[i].hash || '') + '|' + (list[i].title || ''));
  }
  return parts.join(',');
}function

syncTorrentsList() {return _syncTorrentsList.apply(this, arguments);}function _syncTorrentsList() {_syncTorrentsList = _asyncToGenerator(function* () {
    if (AppState.torrentsLoading || !AppState.torrentsLoaded) return false;
    try {
      var response = yield torrServerFetch('/torrents', { method: 'POST', body: JSON.stringify({ action: 'list' }) });
      if (!response.ok) return false;
      var data = yield response.json();
      var list = Array.isArray(data) ? data : [];
      if (torrentsSignature(list) === torrentsSignature(AppState.torrents || [])) return false;

      AppState.torrents = list;
      renderTorrents();
      if (typeof invalidateFocusCache === 'function') invalidateFocusCache();

      return true;
    } catch (e) {
      console.warn('⚠️ Сверка списка торрентов не удалась:', e);
      return false;
    }
  });return _syncTorrentsList.apply(this, arguments);}

window.syncTorrentsList = syncTorrentsList;


function escapeAttr(value) {
  if (!value) return '';
  return String(value).
  replace(/&/g, '&amp;').
  replace(/"/g, '&quot;').
  replace(/'/g, '&#39;').
  replace(/</g, '&lt;').
  replace(/>/g, '&gt;');
}


function renderTorrents() {
  var torrentsGrid = getEl('torrents-grid');
  if (!torrentsGrid) return;


  torrentsGrid.innerHTML = '';





  torrentProgressCache.clear();


  if (AppState.torrents.length === 0) {
    torrentsGrid.innerHTML =
    '<div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">' +
    '<div style="font-size: 18px; color: #aaa; margin-bottom: 10px;">Нет торрентов</div>' +
    '<div style="font-size: 14px; color: #666;">Используйте поиск выше, чтобы найти и добавить торренты</div>' +
    '</div>';
    return;
  }


  var currentScreenSnapshot = AppState.currentScreen;


  var CHUNK_SIZE = 8;
  var index = 0;

  function renderChunk() {

    if (AppState.currentScreen !== currentScreenSnapshot) return;

    var fragment = document.createDocumentFragment();
    var end = Math.min(index + CHUNK_SIZE, AppState.torrents.length);

    for (; index < end; index++) {
      var torrent = AppState.torrents[index];
      var card = createTorrentCard(torrent);
      if (card) fragment.appendChild(card);
    }

    torrentsGrid.appendChild(fragment);

    if (index < AppState.torrents.length) {

      requestAnimationFrame(renderChunk);
    } else {

      if (AppState.currentScreen === 'torrents' &&
      !document.querySelector('.torrent-card.focused')) {
        setTimeout(function () {
          if (typeof window.focusFirstTorrentCard === 'function') {
            window.focusFirstTorrentCard();
          }
        }, 80);
      }
    }
  }

  requestAnimationFrame(renderChunk);
}





function getTorrentCardMeta(torrent) {
  var cacheKey = String(torrent.hash || '');
  var cachedMeta = cacheKey ? torrentCardMetaCache.get(cacheKey) : null;

  if (!cachedMeta || cachedMeta.source !== torrent.data) {
    var data = JSON.parse(torrent.data);
    cachedMeta = {
      source: torrent.data,
      isTv: !!(data.TorrServer && data.TorrServer.Files && data.TorrServer.Files.length > 1),
      poster: data.movie ? data.movie.img || (data.movie.poster_path ? 'https://image.tmdb.org/t/p/w342' + data.movie.poster_path : '') : ''
    };
    if (cacheKey) torrentCardMetaCache.set(cacheKey, cachedMeta);
  }

  return cachedMeta;
}














function getTorrentMediaTypeFromCard(torrent) {
  if (!torrent) return 'movie';

  var isTv = false;

  try {
    if (torrent.file_stats && Array.isArray(torrent.file_stats) && torrent.file_stats.length > 0) {
      isTv = torrent.file_stats.length > 1;
    } else if (torrent.data) {
      isTv = getTorrentCardMeta(torrent).isTv;
    }
  } catch (e) {}

  if (isTv) return 'tv';

  var category = String(torrent.category || '').toLowerCase();
  if (category.indexOf('tv') !== -1 ||
  category.indexOf('сериал') !== -1 ||
  category.indexOf('serial') !== -1 ||
  category.indexOf('series') !== -1) {
    return 'tv';
  }

  return 'movie';
}

window.getTorrentMediaTypeFromCard = getTorrentMediaTypeFromCard;


function createTorrentCard(torrent) {
  var poster = '';
  var title = torrent.title || 'Без названия';



  try {
    var hasFileStats = torrent.file_stats && Array.isArray(torrent.file_stats) && torrent.file_stats.length > 0;
    if (!hasFileStats && torrent.data) poster = getTorrentCardMeta(torrent).poster;
  } catch (e) {}

  if (!poster && torrent.poster) poster = torrent.poster;


  var cardMediaType = getTorrentMediaTypeFromCard(torrent);




  var isPlaying = torrent.stat_string === 'Torrent working';
  var statusHtml = isPlaying ?
  '<span class="torrent-playing">Идет просмотр</span>' :
  '<span class="torrent-size">' + escapeHtml(formatBytes(torrent.torrent_size)) + '</span>';


  var posterHtml;
  if (poster) {
    var safePoster = escapeAttr(poster);
    posterHtml = '<img src="' + safePoster + '" loading="lazy" decoding="async" ' +
    'onerror="this.parentElement.innerHTML=\'<div class=no-poster>Нет постера</div>\'">';
  } else {
    posterHtml = '<div class="no-poster">Нет постера</div>';
  }


  var card = document.createElement('div');
  card.className = 'torrent-card card-modern';
  card.dataset.hash = torrent.hash;

  card.dataset.mediaType = cardMediaType;




  card.innerHTML =
  '<div class="torrent-poster">' + posterHtml +
  '<div class="poster-bar">' + statusHtml +
  '<span class="torrent-badge">' + (cardMediaType === 'tv' ? 'Сериал' : 'Фильм') + '</span></div>' +
  '</div>' +
  '<div class="torrent-info">' +
  '<div class="torrent-title marquee-text"><span>' + escapeHtml(title) + '</span></div>' +
  '</div>';

  return card;
}


function setupTorrentGridDelegation() {
  var torrentsGrid = getEl('torrents-grid');
  if (!torrentsGrid || torrentsGrid._delegationBound) return;

  torrentsGrid._delegationBound = true;


  setupTorrentLongPressDelegation(torrentsGrid);

  torrentsGrid.addEventListener('click', function (e) {
    var card = e.target.closest('.torrent-card');
    if (card && card.dataset.hash) {
      var torrent = AppState.torrents.find(function (t) {
        return t.hash === card.dataset.hash;
      });
      if (torrent) showDetail(torrent);
    }
  });
}

window.setupTorrentGridDelegation = setupTorrentGridDelegation;

function showDetailByHash(hash) {
  if (!hash) return false;
  var hashLower = hash.toLowerCase();
  var torrent = AppState.torrents.find((t) => t.hash && t.hash.toLowerCase() === hashLower);
  if (torrent) {showDetail(torrent);return true;}
  return false;
}

function hideCatalogDetailExtra() {
  var ids = [
  'catalog-detail-extra', 'detail-subtitle', 'catalog-detail-backdrop',
  'catalog-detail-meta', 'catalog-detail-overview',
  'catalog-detail-trailers-wrap', 'catalog-detail-trailers',
  'catalog-detail-screenshots-wrap', 'catalog-detail-screenshots'];


  ids.forEach(function (id) {
    var el = getEl(id);
    if (el) {
      if (id === 'catalog-detail-backdrop') {
        el.style.backgroundImage = '';
      } else if (id === 'catalog-detail-meta' || id === 'catalog-detail-trailers' || id === 'catalog-detail-screenshots') {
        el.innerHTML = '';
      } else if (id === 'detail-subtitle' || id === 'catalog-detail-overview') {
        el.textContent = '';
        el.style.display = 'none';
      }

      el.classList.add('hidden');
    }
  });
}
window.hideCatalogDetailExtra = hideCatalogDetailExtra;function

getTmdbDetailsWithCache(_x5, _x6) {return _getTmdbDetailsWithCache.apply(this, arguments);}function _getTmdbDetailsWithCache() {_getTmdbDetailsWithCache = _asyncToGenerator(function* (tmdbId, mediaType) {
    if (!tmdbId) return null;
    if (!mediaType) mediaType = 'movie';
    if (window.getFromTmdbCache && window.saveToTmdbCache) {
      var cacheParams = { id: tmdbId, type: mediaType };
      var cachedData = window.getFromTmdbCache('details', cacheParams);
      if (cachedData) return cachedData;
      try {
        var response = yield fetch('/api/tmdb/details?id=' + tmdbId + '&type=' + mediaType);
        if (response.ok) {var data = yield response.json();window.saveToTmdbCache('details', cacheParams, data);return data;}
      } catch (error) {console.error('Ошибка загрузки TMDB данных:', error);}
    } else {
      if (!window.tmdbDetailsCache) window.tmdbDetailsCache = new LruCache(200, 24 * 60 * 60 * 1000);
      var cacheKey = tmdbId + '_' + mediaType;
      if (window.tmdbDetailsCache.has(cacheKey)) {
        var cached = window.tmdbDetailsCache.get(cacheKey);
        if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) return cached.data;
      }
      try {
        var response = yield fetch('/api/tmdb/details?id=' + tmdbId + '&type=' + mediaType);
        if (response.ok) {var data = yield response.json();window.tmdbDetailsCache.set(cacheKey, { data: data, timestamp: Date.now() });return data;}
      } catch (error) {console.error('Ошибка загрузки TMDB данных:', error);}
    }
    return null;
  });return _getTmdbDetailsWithCache.apply(this, arguments);}

function resetDetailBackground() {
  var detailView = getEl('detail-view');
  if (!detailView) return;
  detailView.dataset.torrentHash = '';
  detailView.style.backgroundImage = '';detailView.style.backgroundColor = '#000000';
  detailView.style.removeProperty('--torrent-backdrop');
  var existingOverlay = getEl('detail-backdrop-overlay');if (existingOverlay) existingOverlay.remove();
  var detailSubtitle = getEl('detail-subtitle');if (detailSubtitle) {detailSubtitle.textContent = '';detailSubtitle.style.display = 'none';}
  var metaContainer = getEl('catalog-detail-meta');if (metaContainer) {metaContainer.innerHTML = '';metaContainer.classList.add('hidden');}


  var filesList = getEl('files-list');
  if (filesList) {clearFilesList();filesList.style.display = '';filesList.style.flexDirection = '';}
  var detailPoster = getEl('detail-poster');if (detailPoster) detailPoster.innerHTML = '';
  var detailTitleText = getEl('detail-title-text');if (detailTitleText) detailTitleText.textContent = '';
  var oldProgressBlocks = document.querySelectorAll('#detail-progress');
  for (var i = 0; i < oldProgressBlocks.length; i++) {
    oldProgressBlocks[i].remove();
  }


  clearDetailNetflixBlocks();
  detailView.classList.remove('torrent-detail-mode');
}
window.resetDetailBackground = resetDetailBackground;

function extractSeasonsFromTitle(title) {
  if (!title) return [];

  var seasons = [];

  var rangePatterns = [
  /\[сезон\s*(\d+)\s*[-–]\s*(\d+)\]/i,
  /\[season\s*(\d+)\s*[-–]\s*(\d+)\]/i,
  /сезон\s*(\d+)\s*[-–]\s*(\d+)/i,
  /season\s*(\d+)\s*[-–]\s*(\d+)/i,
  /\bS(\d+)\s*[-–]\s*S?(\d+)\b/i];


  for (var p = 0; p < rangePatterns.length; p++) {
    var m = title.match(rangePatterns[p]);
    if (m && m[1] && m[2]) {
      for (var s = parseInt(m[1], 10); s <= parseInt(m[2], 10); s++) {
        if (seasons.indexOf(s) === -1) seasons.push(s);
      }
      return seasons.sort(function (a, b) {return a - b;});
    }
  }

  var listPatterns = [
  /\[сезон\s*([\d,\s]+)\]/i,
  /\[season\s*([\d,\s]+)\]/i,
  /сезон\s*([\d,\s]+)/i,
  /season\s*([\d,\s]+)/i,
  /\bS([\d,\s]+)/i];


  for (var p2 = 0; p2 < listPatterns.length; p2++) {
    var m2 = title.match(listPatterns[p2]);
    if (m2 && m2[1]) {
      m2[1].split(/[,\s]+/).forEach(function (part) {
        var n = parseInt(part, 10);
        if (!isNaN(n) && seasons.indexOf(n) === -1) seasons.push(n);
      });
      if (seasons.length > 0) break;
    }
  }

  if (seasons.length === 0) {
    var singlePatterns = [
    /\[сезон\s*(\d+)\]/i,
    /\[season\s*(\d+)\]/i,
    /сезон\s*(\d+)/i,
    /season\s*(\d+)/i,
    /\bS(\d+)\b/i];


    for (var p3 = 0; p3 < singlePatterns.length; p3++) {
      var m3 = title.match(singlePatterns[p3]);
      if (m3 && m3[1]) {
        var n2 = parseInt(m3[1], 10);
        if (!isNaN(n2)) seasons.push(n2);
        break;
      }
    }
  }

  return seasons.sort(function (a, b) {return a - b;});
}

function cleanTitleFromSeasons(title, seasons) {
  if (!title) return title;

  return title.
  replace(/\[сезон[^\]]*\]/gi, '').
  replace(/\[season[^\]]*\]/gi, '').
  replace(/сезон\s*[\d\s,–-]+/gi, '').
  replace(/season\s*[\d\s,–-]+/gi, '').
  replace(/\bS\d+\b/gi, '').
  replace(/\s+/g, ' ').
  trim();
}

var seasonCache = new LruCache(200, 24 * 60 * 60 * 1000);function
loadSeasonStills(_x7, _x8) {return _loadSeasonStills.apply(this, arguments);}function _loadSeasonStills() {_loadSeasonStills = _asyncToGenerator(function* (tmdbId, seasonNumber) {
    var cacheKey = tmdbId + 'season' + seasonNumber;
    if (seasonCache.has(cacheKey)) {var cached = seasonCache.get(cacheKey);if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) return cached.data;}
    try {
      var response = yield fetch('/api/tmdb/season?id=' + tmdbId + '&seasonNumber=' + seasonNumber);
      if (response.ok) {var seasonData = yield response.json();var episodes = seasonData.episodes || [];seasonCache.set(cacheKey, { data: episodes, timestamp: Date.now() });return episodes;}
    } catch (error) {console.error('Ошибка загрузки кадров сезона:', error);}
    return [];
  });return _loadSeasonStills.apply(this, arguments);}function

loadMovieStill(_x9) {return _loadMovieStill.apply(this, arguments);}function _loadMovieStill() {_loadMovieStill = _asyncToGenerator(function* (tmdbId) {
    var cacheKey = tmdbId + '_movie_still';
    if (seasonCache.has(cacheKey)) {var cached = seasonCache.get(cacheKey);if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) return cached.data;}
    try {
      var response = yield fetch('/api/tmdb/details?id=' + tmdbId + '&type=movie');
      if (response.ok) {
        var data = yield response.json();
        if (data.poster_path) {var stillUrl = buildTmdbPosterUrl(data.poster_path, 'w300');seasonCache.set(cacheKey, { data: stillUrl, timestamp: Date.now() });return stillUrl;}
      }
    } catch (error) {console.error('Ошибка загрузки постера фильма:', error);}
    return null;
  });return _loadMovieStill.apply(this, arguments);}

function clearTorrentFilesCache(hash) {if (hash && torrentFilesCache.has(hash)) torrentFilesCache.delete(hash);}
function clearAllTorrentFilesCache() {torrentFilesCache.clear();}function


getTorrentFilesWithCache(_x0) {return _getTorrentFilesWithCache.apply(this, arguments);}function _getTorrentFilesWithCache() {_getTorrentFilesWithCache = _asyncToGenerator(function* (torrent, forceRefresh = false) {
    var hash = torrent && torrent.hash;
    if (!hash) return [];

    if (!forceRefresh && torrentFilesCache.has(hash)) {
      var cached = torrentFilesCache.get(hash);
      if (cached && Date.now() - cached.timestamp < 60 * 60 * 1000) return cached.files;
      torrentFilesCache.delete(hash);
    }
    if (!forceRefresh && torrentFilesInFlight[hash]) return torrentFilesInFlight[hash];

    var request = _asyncToGenerator(function* () {
      var files = [];
      if (torrent.file_stats && Array.isArray(torrent.file_stats) && torrent.file_stats.length) {
        files = torrent.file_stats;
      }
      if (!files.length && AppState.currentTorrserverUrl) {
        try {
          var response = yield torrServerFetch('/stream?link=' + hash + '&index=1&stat=stat', {
            method: 'GET', headers: { accept: 'application/octet-stream' }
          });
          if (response.ok) {
            var apiData = yield response.json();
            if (Array.isArray(apiData.file_stats)) files = apiData.file_stats;else
            if (apiData.data) {
              try {
                var parsedData = JSON.parse(apiData.data);
                if (parsedData.TorrServer && Array.isArray(parsedData.TorrServer.Files)) {
                  files = parsedData.TorrServer.Files;
                }
              } catch (e) {}
            }
          }
        } catch (error) {
          console.error('Torrent files request failed:', error);
        }
      }
      torrent.file_stats = files;
      torrentFilesCache.set(hash, { files: files, timestamp: Date.now() });
      return files;
    })();

    torrentFilesInFlight[hash] = request;
    try {
      return yield request;
    } finally {
      delete torrentFilesInFlight[hash];
    }
  });return _getTorrentFilesWithCache.apply(this, arguments);}







var detailMetaState = { details: null, isTvSeries: false, filesCount: 0, filesBytes: 0, torrentTitle: '' };

function isTorrentDetailMode() {
  var dv = getEl('detail-view');
  return !!(dv && dv.classList.contains('torrent-detail-mode'));
}

function pluralRu(n, one, few, many) {
  var abs = Math.abs(n) % 100;
  var last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last > 1 && last < 5) return few;
  return many;
}

function formatRuntimeMinutes(minutes) {
  var m = parseInt(minutes, 10);
  if (!m || m <= 0) return '';
  var h = Math.floor(m / 60);
  var rest = m % 60;
  if (h > 0) return rest > 0 ? h + ' ч ' + rest + ' мин' : h + ' ч';
  return rest + ' мин';
}


function extractQualityBadges(title) {
  var t = String(title || '');
  var badges = [];
  if (/2160p|\b4k\b|\buhd\b/i.test(t)) badges.push('4K');else
  if (/1080[pi]/i.test(t)) badges.push('1080p');else
  if (/720p/i.test(t)) badges.push('720p');
  if (/\bhdr10?\+?\b|dolby\s*vision|\bdovi\b/i.test(t)) badges.push('HDR');
  if (/atmos/i.test(t)) badges.push('ATMOS');else
  if (/\b(5\.1|7\.1)\b/.test(t)) badges.push('5.1');
  return badges;
}

function ensureDetailMetaRow() {
  var row = getEl('detail-meta-row');
  if (row) return row;
  var titleBlock = document.querySelector('#detail-view .detail-title');
  if (!titleBlock) return null;
  row = document.createElement('div');
  row.id = 'detail-meta-row';
  row.className = 'detail-meta-row hidden';
  var subtitle = getEl('detail-subtitle');

  if (subtitle && subtitle.parentElement === titleBlock) titleBlock.insertBefore(row, subtitle);else
  titleBlock.appendChild(row);
  return row;
}

function ensureFilesListTitle() {
  var title = getEl('files-list-title');
  if (title) return title;
  var filesList = getEl('files-list');
  if (!filesList || !filesList.parentElement) return null;
  title = document.createElement('div');
  title.id = 'files-list-title';
  title.className = 'catalog-detail-section-title hidden';
  title.textContent = 'Серии';
  filesList.parentElement.insertBefore(title, filesList);
  return title;
}



function ensureDetailActorsWrap() {
  var wrap = getEl('catalog-detail-actors-wrap');
  if (wrap) return wrap;
  var panel = document.querySelector('#detail-view .catalog-detail-panel');
  if (!panel || !panel.parentElement) return null;
  wrap = document.createElement('div');
  wrap.id = 'catalog-detail-actors-wrap';
  wrap.className = 'catalog-detail-actors-wrap hidden';
  wrap.innerHTML = '<div class="catalog-detail-section-title">В главных ролях</div>' +
  '<div id="catalog-detail-actors" class="catalog-detail-actors-grid"></div>';
  panel.parentElement.insertBefore(wrap, panel.nextSibling);
  return wrap;
}

function clearDetailNetflixBlocks() {
  var row = getEl('detail-meta-row');
  if (row) {row.innerHTML = '';row.classList.add('hidden');}
  var actors = getEl('catalog-detail-actors');


  if (actors) {
    if (typeof window.clearDetailActorCards === 'function') window.clearDetailActorCards(actors);else
    actors.innerHTML = '';
  }
  var wrap = getEl('catalog-detail-actors-wrap');
  if (wrap) wrap.classList.add('hidden');
  var filesTitle = getEl('files-list-title');
  if (filesTitle) filesTitle.classList.add('hidden');
}




function renderDetailMetaRow() {
  if (!isTorrentDetailMode()) return;
  var row = ensureDetailMetaRow();
  if (!row) return;

  var d = detailMetaState.details;
  var parts = [];

  if (d) {
    var date = d.release_date || d.first_air_date || '';
    if (date) parts.push(escapeHtml(String(date).substring(0, 4)));

    if (d.vote_average > 0) {
      parts.push('<span class="detail-meta-rating">' + Math.round(d.vote_average * 10) / 10 + '</span>');
    }

    var seasons = parseInt(d.number_of_seasons, 10);
    if (seasons > 0) parts.push(seasons + ' ' + pluralRu(seasons, 'сезон', 'сезона', 'сезонов'));else
    parts.push(detailMetaState.isTvSeries ? 'Сериал' : 'Фильм');

    var runtime = formatRuntimeMinutes(d.runtime || (
    Array.isArray(d.episode_run_time) ? d.episode_run_time[0] : 0));
    if (runtime) parts.push(runtime);

    if (d.genres && d.genres.length) {
      var names = [];
      for (var g = 0; g < d.genres.length && names.length < 2; g++) {
        if (d.genres[g] && d.genres[g].name) names.push(d.genres[g].name);
      }
      if (names.length) parts.push(escapeHtml(names.join(', ')));
    }

    var countries = typeof window.getCatalogCountries === 'function' ? window.getCatalogCountries(d, 2) : [];
    if (countries.length) parts.push(escapeHtml(countries.join(', ')));
  }

  var count = detailMetaState.filesCount;
  if (count > 1) {
    parts.push(count + ' ' + (detailMetaState.isTvSeries ?
    pluralRu(count, 'серия', 'серии', 'серий') :
    pluralRu(count, 'файл', 'файла', 'файлов')));
  }
  if (detailMetaState.filesBytes > 0 && typeof formatBytes === 'function') {
    parts.push(escapeHtml(formatBytes(detailMetaState.filesBytes)));
  }

  var badges = extractQualityBadges(detailMetaState.torrentTitle);

  if (!parts.length && !badges.length) {
    row.innerHTML = '';
    row.classList.add('hidden');
    return;
  }

  var html = '';
  for (var p = 0; p < parts.length; p++) html += '<span class="detail-meta-item">' + parts[p] + '</span>';
  for (var b = 0; b < badges.length; b++) html += '<span class="detail-meta-badge">' + escapeHtml(badges[b]) + '</span>';
  row.innerHTML = html;
  row.classList.remove('hidden');
}



function renderDetailActorsFromDetails(details) {
  if (!isTorrentDetailMode()) return;
  var wrap = ensureDetailActorsWrap();
  if (!wrap) return;
  var grid = getEl('catalog-detail-actors');
  if (!grid) return;

  var cast = details && details.cast;
  if (!cast || !cast.length) {
    if (typeof window.clearDetailActorCards === 'function') window.clearDetailActorCards(grid);
    wrap.classList.add('hidden');
    return;
  }

  var max = 12;
  try {
    if (typeof CATALOG_CONSTANTS !== 'undefined' && CATALOG_CONSTANTS.MAX_ACTORS) max = CATALOG_CONSTANTS.MAX_ACTORS;
  } catch (e) {}






  var actors = [];
  for (var i = 0; i < cast.length && actors.length < max; i++) {
    var a = cast[i];
    if (!a || !a.name) continue;
    actors.push({
      id: a.id || a.personId || '',
      name: a.name,
      character: a.character || '',
      profilePath: a.profile_path || a.profilePath || ''
    });
  }

  var shown = typeof window.renderDetailActorCards === 'function' ?
  window.renderDetailActorCards(grid, actors, '👤') :
  0;

  if (!shown) {
    wrap.classList.add('hidden');
    return;
  }

  wrap.classList.remove('hidden');





  if (typeof resetDetailRowScroll === 'function') resetDetailRowScroll(grid);else
  grid.scrollLeft = 0;






  if (!grid._actorClickHandler) {
    grid._actorClickHandler = function (e) {





      if (typeof isTorrentDetailMode === 'function' && !isTorrentDetailMode()) return;
      var card = e.target.closest ? e.target.closest('.catalog-actor-card') : null;
      if (!card || !card.dataset.personId) return;
      if (typeof window.openPersonCatalog !== 'function') return;
      window.openPersonCatalog(card.dataset.personId, card.dataset.personName);
    };
    grid.addEventListener('click', grid._actorClickHandler);
  }




  if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
  if (typeof updateFocusableElements === 'function') updateFocusableElements();
}


















function revealTorrentDetailExtras(torrent, details) {


  if (!isOpenTorrentDetail(torrent)) return;

  var overviewText = details && details.overview || '';
  var ov = getEl('catalog-detail-overview');
  var togBtn = getEl('catalog-toggle-overview-btn');

  if (overviewText && togBtn) {




    if (ov) {
      ov.classList.add('hidden');
      ov.classList.remove('expanded');
      ov.style.display = 'none';
    }
    var sub = getEl('detail-subtitle');
    if (sub) sub.classList.remove('expanded');

    togBtn.textContent = 'Подробнее';
    togBtn.classList.remove('hidden');
    togBtn.style.removeProperty('display');



    if (typeof window.initCatalogDetailButtons === 'function') window.initCatalogDetailButtons();
  }


  var openBtn = getEl('detail-open-card-btn');
  if (!openBtn) return;

  var tmdbId = torrent && (torrent.tmdbId || torrent.id) || details && details.id || null;
  if (!tmdbId) {
    openBtn.classList.add('hidden');
    return;
  }

  var mediaType = torrent && torrent.media_type ||
  details && details.media_type || (
  detailMetaState && detailMetaState.isTvSeries ? 'tv' : 'movie');

  var cardTitle = details && (details.title || details.name) ||
  torrent && torrent.title || '';

  openBtn.classList.remove('hidden');
  openBtn.style.removeProperty('display');



  openBtn.onclick = function () {
    if (typeof window.showCatalogDetail !== 'function') return;
    var item = {
      id: tmdbId,
      tmdbId: tmdbId,
      media_type: mediaType,
      title: cardTitle,
      name: cardTitle,
      poster_path: torrent && torrent.poster || details && details.poster_path || null
    };


    AppState.androidBackCatalog = item;
    if (window.Nav) Nav.push('detail', Nav.detailData(item));
    window.showCatalogDetail(item, AppState.catalogIndex || 0, item.poster_path);
  };
}
window.revealTorrentDetailExtras = revealTorrentDetailExtras;

function visibleItemsforDetail(change) {
  var detailView = getEl('detail-view');

  if (change === 'showDetail') {







    var massHidden = ['catalog-detail-actors-wrap', 'catalog-detail-backdrop', 'catalog-detail-recommendations-wrap', 'catalog-detail-overview',
    'catalog-detail-meta', 'catalog-watch-btn', 'catalog-toggle-overview-btn', 'catalog-trailer-btn', 'detail-poster', 'files-list-title',
    'detail-open-card-btn', 'catalog-favorite-btn'];

    massHidden.forEach(function (id) {
      var el = getEl(id);
      if (el) el.classList.add('hidden');
    });
    var progressBtn = getEl('detail-progress-btn');
    if (progressBtn) {
      progressBtn.classList.add('hidden');
      progressBtn.dataset.hash = '';
    }



    var massVisible = ['catalog-detail-extra'];
    massVisible.forEach(function (id) {
      var el = getEl(id);
      if (el) {
        el.classList.remove('hidden');
        el.style.removeProperty('display');
      }
    });

    if (detailView) {
      detailView.classList.add('torrent-detail-mode');
      detailView.classList.remove('catalog-detail-mode');
    }
  } else if (change === 'showCatalogDetail') {
    var massVisible2 = ['catalog-detail-actors-wrap', 'catalog-detail-backdrop', 'catalog-detail-recommendations-wrap', 'catalog-detail-overview',
    'catalog-detail-meta', 'catalog-watch-btn', 'catalog-toggle-overview-btn', 'catalog-trailer-btn', 'catalog-detail-extra'];

    massVisible2.forEach(function (id) {
      var el = getEl(id);
      if (el) {
        el.classList.remove('hidden');
        el.style.removeProperty('display');
      }
    });

    var massHidden2 = ['detail-progress-btn', 'detail-meta-row', 'files-list-title', 'detail-open-card-btn'];
    massHidden2.forEach(function (id) {
      var el = getEl(id);
      if (el) el.classList.add('hidden');
    });

    if (detailView) {
      detailView.classList.remove('torrent-detail-mode');
      detailView.classList.add('catalog-detail-mode');
    }
  }
}

window.visibleItemsforDetail = visibleItemsforDetail;












var UI_CUSTOMIZER_STORAGE_KEY = 'uiCustomizer';

function readUiFocusColor() {
  try {
    if (window.UICustomizer && typeof UICustomizer.getFocusColor === 'function') {
      var fromApi = UICustomizer.getFocusColor();
      if (fromApi) return fromApi;
    }
  } catch (e) {}
  try {
    var raw = localStorage.getItem(UI_CUSTOMIZER_STORAGE_KEY);
    if (raw) {
      var saved = JSON.parse(raw);
      if (saved && saved.focusColor) return saved.focusColor;
    }
  } catch (e) {}
  return null;
}


function focusColorToRgba(color, alpha) {
  var s = String(color || '').trim();
  if (s.charAt(0) !== '#') return null;
  s = s.slice(1);
  if (s.length === 3) {
    s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
  }
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  var n = parseInt(s, 16);
  return 'rgba(' + (n >> 16 & 255) + ', ' + (n >> 8 & 255) + ', ' + (n & 255) + ', ' + alpha + ')';
}

function applyFocusColorVars() {
  var color = readUiFocusColor();
  if (!color || !focusColorToRgba(color, 1)) return;
  var root = document.documentElement;
  if (!root || !root.style || !root.style.setProperty) return;


  root.style.setProperty('--focus-color', color);
  var soft = focusColorToRgba(color, 0.35);
  if (soft) root.style.setProperty('--focus-color-soft', soft);
}
window.applyFocusColorVars = applyFocusColorVars;



function hookUiCustomizerFocusColor() {
  if (!window.UICustomizer || typeof UICustomizer.apply !== 'function') return false;
  if (!UICustomizer.__focusVarsHooked) {
    var origApply = UICustomizer.apply;
    UICustomizer.apply = function () {
      var result = origApply.apply(this, arguments);
      applyFocusColorVars();
      return result;
    };
    UICustomizer.__focusVarsHooked = true;
  }
  applyFocusColorVars();
  return true;
}




applyFocusColorVars();
(function waitForUiCustomizer(triesLeft) {
  if (hookUiCustomizerFocusColor() || triesLeft <= 0) return;
  setTimeout(function () {waitForUiCustomizer(triesLeft - 1);}, 300);
})(20);











function isTorrentDetailReusable(torrent) {
  var dv = getEl('detail-view');
  var hash = torrent && torrent.hash ? String(torrent.hash) : '';
  if (!dv || !hash || dv.dataset.torrentHash !== hash) return false;
  if (!dv.classList.contains('torrent-detail-mode') || dv.style.display !== 'none') return false;
  var title = getEl('detail-title-text');
  if (!title || !String(title.textContent || '').trim()) return false;
  var item = document.querySelector('#files-list .file-item:not(.hidden)');
  return !!(item && item.dataset.hash === hash);
}


function focusTorrentDetailStart() {
  if (typeof updateFocusableElements !== 'function' || typeof setFocus !== 'function') return;
  if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
  updateFocusableElements();




  detailAutoFocusEl = null;
  var progressBtn = getEl('detail-progress-btn');
  if (progressBtn && progressBtn.offsetParent !== null) {
    for (var i = 0; i < focusableElements.length; i++) {
      if (focusableElements[i] === progressBtn) {setFocus(i);return;}
    }
  }
  if (document.querySelectorAll('#files-list .file-item:not(.hidden)').length > 0) {
    for (var j = 0; j < focusableElements.length; j++) {
      if (focusableElements[j].classList && focusableElements[j].classList.contains('file-item')) {
        setFocus(j);


        detailAutoFocusEl = focusableElements[j];
        return;
      }
    }
  }
  setFocus(0);
}


var detailAutoFocusEl = null;function

showDetail(_x1) {return _showDetail.apply(this, arguments);}function _showDetail() {_showDetail = _asyncToGenerator(function* (torrent) {
    if (torrent && torrent.hash) window.lastSelectedTorrentHash = torrent.hash;
    openTorrentDetailHash = torrent && torrent.hash ? String(torrent.hash).toLowerCase() : '';
    var reuse = isTorrentDetailReusable(torrent);
    if (window.Nav && torrent) Nav.push('torrent-detail', { key: 't:' + String(torrent.hash || '').toLowerCase(), label: torrent.title || torrent.hash, torrent: torrent });
    if (typeof currentFocusIndex !== 'undefined') window.lastSelectedTorrentIndex = currentFocusIndex;


    applyFocusColorVars();




    if (!reuse && typeof Animations !== 'undefined' && typeof Animations.beginDetailSwap === 'function') {
      yield Animations.beginDetailSwap();
    }
    if (!reuse) resetDetailBackground();
    var known = knownTorrentMeta.get(String(torrent.hash || '').toLowerCase());

    if (known) {
      if (!torrent.poster && known.poster) torrent.poster = known.poster;
      if (!torrent.tmdbId && known.id) torrent.tmdbId = known.id;
      if (!torrent.media_type && known.mediaType) torrent.media_type = known.mediaType;
    }

    if (torrent.poster && torrent.poster.indexOf('http') !== 0) {
      torrent.poster = buildTmdbPosterUrl(torrent.poster, 'w342');
    }
    var mainContainer = getEl('main-container');
    if (mainContainer) mainContainer.style.pointerEvents = 'none';





    if (mainContainer && AppState.currentScreen === 'torrents') {
      AppState.contentScroll = AppState.contentScroll || {};
      AppState.contentScroll.torrents = mainContainer.scrollTop;
    }
    AppState.currentScreen = 'detail';
    if (!window.AndroidJS || !AppState.transcodingFullOnOff) {
      AppState.currentDetailItem = torrent;
    } else {
      AppState.currentDetailItem = AppState.playFromHash ? AppState.androidBackCatalog : torrent;
    }

    if (reuse) {



      var dvReuse = getEl('detail-view');
      if (typeof Animations !== 'undefined') Animations.animateDetailShow();
      getTorrentFilesWithCache(torrent, false).then(function (files) {
        var items = [].slice.call(document.querySelectorAll('#files-list .file-item:not(.hidden)'));
        if (items.length) loadProgressForFileItems(items, torrent.hash);
        return addProgressToDetail(torrent, files);
      }).then(function (lastField) {
        if (lastField > 0 && typeof updateFocusableElements === 'function') updateFocusableElements();
        var playBtn = getEl('detail-progress-btn');
        if (playBtn && playBtn.dataset.hash) preloadDetailFile(playBtn.dataset.hash, playBtn.dataset.fileId);
      }).catch(function () {});
      setTimeout(function () {
        focusTorrentDetailStart();
        if (typeof Animations !== 'undefined' && typeof Animations.detailContentReady === 'function') {
          Animations.detailContentReady();
        }
      }, 0);
      AppState.mediaType = '';
      return;
    }

    hideCatalogDetailExtra();
    visibleItemsforDetail('showDetail');


    detailMetaState = {
      details: null,
      isTvSeries: false,
      filesCount: 0,
      filesBytes: 0,
      torrentTitle: torrent.title || ''
    };
    ensureDetailMetaRow();
    ensureDetailActorsWrap();
    ensureFilesListTitle();
    clearDetailNetflixBlocks();

    var posterImg = getEl('detail-poster');
    var titleEl = getEl('detail-title-text');
    var filesList = getEl('files-list');
    setupFilePlayButtonDelegation();
    var detailSubtitle = getEl('detail-subtitle');
    var detailViewDiv = getEl('detail-view');
    var dh = document.querySelector('.detail-header');
    if (dh) dh.style.background = 'rgba(0, 0, 0, 0.3)';
    if (filesList) {filesList.style.display = 'flex';filesList.style.flexDirection = 'row';}
    showFilesListMessage('<div class="spinner"></div><div>Загрузка файлов...</div>');
    if (typeof Animations !== 'undefined') Animations.animateDetailShow();
    titleEl.textContent = (torrent.title || 'Без названия').
    replace(/\[\d+\]/g, '').
    replace(/\[сезон[^\]]*\]/gi, '').
    trim();
    var oldProgressBlocks = document.querySelectorAll('#detail-progress');
    for (var i = 0; i < oldProgressBlocks.length; i++) oldProgressBlocks[i].remove();


    var filesPromise = getTorrentFilesWithCache(torrent, false);
    var tmdbPromise = loadAllTmdbDataForTorrent(torrent, { titleEl: titleEl, detailViewDiv: detailViewDiv, detailSubtitle: detailSubtitle });



    tmdbPromise.then(function (tmdbData) {
      if (!tmdbData || !isOpenTorrentDetail(torrent)) return;
      detailMetaState.isTvSeries = !!tmdbData.isTvSeries;
      renderDetailMetaRow();
      renderDetailActorsFromDetails(tmdbData.details);
    }).catch(function () {});

    try {
      var files = yield filesPromise;


      if (!isOpenTorrentDetail(torrent)) return;
      var poster = torrent.poster || '';
      if (!poster && torrent.data) {
        try {
          var data = JSON.parse(torrent.data);
          if (data.movie) poster = data.movie.img || (data.movie.poster_path ? 'https://image.tmdb.org/t/p/w342' + data.movie.poster_path : '');
        } catch (e) {}
      }
      posterImg.innerHTML = poster ? '<img src="' + poster + '" alt="poster">' : '<div class="no-poster">Нет постера</div>';

      if (files.length === 0) {
        showFilesListMessage('📁 Нет файлов', 'files-list-msg-compact');
      } else {

        var videoFiles = files.filter((f) => {
          var n = f.path.split('/').pop().toLowerCase();
          return ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'].some((ext) => n.includes(ext));
        });
        var addedItems = renderFileItems(videoFiles, torrent.hash, torrent.title);


        if (detailViewDiv) detailViewDiv.dataset.torrentHash = String(torrent.hash || '');



        if (filesList) {
          if (typeof resetDetailRowScroll === 'function') resetDetailRowScroll(filesList);else
          filesList.scrollLeft = 0;
        }


        var totalBytes = 0;
        for (var fb = 0; fb < videoFiles.length; fb++) totalBytes += videoFiles[fb].length || 0;
        detailMetaState.filesCount = videoFiles.length;
        detailMetaState.filesBytes = totalBytes;
        renderDetailMetaRow();



        var filesTitle = ensureFilesListTitle();
        if (filesTitle) {
          if (videoFiles.length > 1) {
            filesTitle.textContent = 'Серии';
            filesTitle.classList.remove('hidden');
          } else {
            filesTitle.classList.add('hidden');
          }
        }


        if (addedItems.length > 0) {
          loadProgressForFileItems(addedItems, torrent.hash);
        }


        addProgressToDetail(torrent, files).then(function (lastField) {
          if (!isOpenTorrentDetail(torrent)) return;
          if (typeof updateFocusableElements === 'function') updateFocusableElements();


          if (detailAutoFocusEl && document.querySelector('.focused') === detailAutoFocusEl) {
            focusTorrentDetailStart();
          }


          var playBtn = getEl('detail-progress-btn');
          if (playBtn && playBtn.dataset.hash) {
            preloadDetailFile(playBtn.dataset.hash, playBtn.dataset.fileId);
          }
        });


        tmdbPromise.then(function (tmdbData) {
          if (!tmdbData || !isOpenTorrentDetail(torrent)) return;
          if (tmdbData.cleanTitle && tmdbData.cleanTitle !== 'Без названия') titleEl.textContent = tmdbData.cleanTitle;
          if (tmdbData.seasonNumbers && tmdbData.seasonNumbers.length > 1) {
            var seasonsText = titleEl.textContent;
            if (!seasonsText.includes('сезон')) titleEl.textContent = seasonsText + ' [сезон ' + tmdbData.seasonNumbers.join(', ') + ']';
          }
          loadStillsAndUpdateFiles(tmdbData.seasonNumbers || [], tmdbData.allSeasonEpisodes || {}, tmdbData.movieStill, videoFiles.length);
        }).catch(function (error) {console.error('Ошибка загрузки TMDB данных:', error);});
      }
    } catch (e) {
      console.error('Ошибка:', e);
      showFilesListMessage('❌ Ошибка загрузки файлов: ' + escapeHtml(e.message), 'files-list-msg-compact files-list-msg-error');
    }
    setTimeout(function () {
      focusTorrentDetailStart();

      if (typeof Animations !== 'undefined' && typeof Animations.detailContentReady === 'function') {
        Animations.detailContentReady();
      }
    }, 200);
    AppState.mediaType = '';
  });return _showDetail.apply(this, arguments);}function

loadAllTmdbDataForTorrent(_x10, _x11) {return _loadAllTmdbDataForTorrent.apply(this, arguments);}function _loadAllTmdbDataForTorrent() {_loadAllTmdbDataForTorrent = _asyncToGenerator(function* (torrent, elements) {
    elements = elements || {};

    var protocolBase = 'https:';
    try {
      protocolBase = String(window.AppState && AppState.protocol || 'https:').replace(/:+$/, '');
      if (protocolBase.indexOf(':') === -1) protocolBase += ':';
    } catch (e) {}

    function normalizePosterUrl(path, size) {
      if (!path) return null;
      path = String(path);

      if (path.indexOf('http') === 0) return path;

      size = size || 'w342';

      return protocolBase + '//' + getPrimaryImageHost() + '/t/p/' + size + (
      path.charAt(0) === '/' ? path : '/' + path);
    }

    function extractSeasonsFromTitleLocal(title) {
      var seasons = [];

      if (!title) return seasons;

      function addSeason(num) {
        var n = parseInt(num, 10);
        if (!isNaN(n) && n > 0 && n < 1000 && seasons.indexOf(n) === -1) {
          seasons.push(n);
        }
      }

      var rangePatterns = [
      /\[сезон\s*(\d+)\s*[-–]\s*(\d+)\]/i,
      /\[season\s*(\d+)\s*[-–]\s*(\d+)\]/i,
      /сезон\s*(\d+)\s*[-–]\s*(\d+)/i,
      /season\s*(\d+)\s*[-–]\s*(\d+)/i,
      /\bS(\d+)\s*[-–]\s*S?(\d+)\b/i];


      for (var r = 0; r < rangePatterns.length; r++) {
        var rm = title.match(rangePatterns[r]);
        if (rm && rm[1] && rm[2]) {
          var from = parseInt(rm[1], 10);
          var to = parseInt(rm[2], 10);

          if (!isNaN(from) && !isNaN(to)) {
            if (from > to) {
              var tmp = from;
              from = to;
              to = tmp;
            }

            for (var s = from; s <= to; s++) {
              addSeason(s);
            }

            return seasons.sort(function (a, b) {return a - b;});
          }
        }
      }

      var listPatterns = [
      /\[сезон\s*([\d,\s]+)\]/i,
      /\[season\s*([\d,\s]+)\]/i,
      /сезон\s*([\d,\s]+)/i,
      /season\s*([\d,\s]+)/i,
      /\bS([\d,\s]+)/i];


      for (var l = 0; l < listPatterns.length; l++) {
        var lm = title.match(listPatterns[l]);
        if (lm && lm[1]) {
          var parts = String(lm[1]).split(/[,\s]+/);
          for (var p = 0; p < parts.length; p++) {
            addSeason(parts[p]);
          }

          if (seasons.length > 0) break;
        }
      }

      if (seasons.length === 0) {
        var singlePatterns = [
        /\[сезон\s*(\d+)\]/i,
        /\[season\s*(\d+)\]/i,
        /сезон\s*(\d+)/i,
        /season\s*(\d+)/i,
        /\bS(\d+)\b/i];


        for (var sng = 0; sng < singlePatterns.length; sng++) {
          var sm = title.match(singlePatterns[sng]);
          if (sm && sm[1]) {
            addSeason(sm[1]);
            break;
          }
        }
      }

      return seasons.sort(function (a, b) {return a - b;});
    }

    function cleanTitleFromSeasonsLocal(title) {
      if (!title) return title;

      return String(title).
      replace(/\[сезон[^\]]*\]/gi, '').
      replace(/\[season[^\]]*\]/gi, '').
      replace(/сезон\s*[\d\s,–-]+/gi, '').
      replace(/season\s*[\d\s,–-]+/gi, '').
      replace(/\bS\d+\b/gi, '').
      replace(/\s+/g, ' ').
      trim();
    }

    function extractSeasonsFromFilesLocal() {
      var seasons = [];

      var files = [];
      try {
        if (typeof getTorrentFiles === 'function') {
          files = getTorrentFiles(torrent) || [];
        }
      } catch (e) {}

      if (!files.length) return seasons;

      function addSeason(num) {
        var n = parseInt(num, 10);
        if (!isNaN(n) && n > 0 && n < 1000 && seasons.indexOf(n) === -1) {
          seasons.push(n);
        }
      }

      var patterns = [
      /S(\d{1,2})/i,
      /(\d{1,2})x\d{2}/i,
      /Season\s*(\d{1,2})/i,
      /сезон\s*(\d{1,2})/i];


      for (var i = 0; i < files.length; i++) {
        var path = String(files[i].path || '');

        for (var p = 0; p < patterns.length; p++) {
          var m = path.match(patterns[p]);
          if (m && m[1]) {
            addSeason(m[1]);
            break;
          }
        }
      }

      return seasons.sort(function (a, b) {return a - b;});
    }

    var initialTitle = torrent && torrent.title ? String(torrent.title) : 'Без названия';

    var result = {
      tmdbId: null,
      cleanTitle: initialTitle,
      seasonNumbers: [],
      isTvSeries: false,
      mediaType: 'movie',
      videoFilesCount: 0,
      allSeasonEpisodes: {},
      movieStill: null,
      details: null
    };

    if (!torrent) return result;

    var hashLower = torrent.hash ? String(torrent.hash).toLowerCase() : '';
    var known = null;

    try {
      if (hashLower) {
        if (typeof knownTorrentMeta !== 'undefined' && knownTorrentMeta && knownTorrentMeta.get) {
          known = knownTorrentMeta.get(hashLower) || null;
        }

        if (!known && typeof window.getKnownTorrentMeta === 'function') {
          known = window.getKnownTorrentMeta(hashLower) || null;
        }

        if (!known &&
        typeof lastAddedTorrentHash !== 'undefined' &&
        lastAddedTorrentHash &&
        hashLower === String(lastAddedTorrentHash).toLowerCase()) {

          var pendingItem =
          window.AppState && AppState.pendingDetailItem ||
          window.pendingCatalogItem ||
          null;

          known = {
            id: window.AppState && AppState.pendingDetailTmdbId ||
            pendingItem && (pendingItem.id || pendingItem.tmdbId) ||
            null,
            mediaType: window.AppState && AppState.pendingDetailMediaType ||
            pendingItem && pendingItem.media_type ||
            null,
            poster: window.AppState && AppState.pendingDetailPoster ||
            window.pendingCatalogPoster ||
            null
          };
        }
      }
    } catch (e) {}

    if (known) {
      if (!torrent.tmdbId && known.id) torrent.tmdbId = known.id;
      if (!torrent.media_type && known.mediaType) torrent.media_type = known.mediaType;
      if (!torrent.poster && known.poster) torrent.poster = normalizePosterUrl(known.poster, 'w342');
    }

    if (torrent.poster) {
      torrent.poster = normalizePosterUrl(torrent.poster, 'w342');
    }

    var cleanTitle = initialTitle;

    var tmdbId = torrent.tmdbId || torrent.knownTmdbId || null;

    if (!tmdbId) {
      var bracketMatch = cleanTitle.match(/\[(\d+)\]/);
      if (bracketMatch && bracketMatch[1]) {
        tmdbId = bracketMatch[1];
      }
    }

    cleanTitle = cleanTitle.
    replace(/\[\d+\]/g, '').
    replace(/\[(tv|movie|сериал|фильм)\]/gi, '').
    replace(/\[сезон[^\]]*\]/gi, '').
    trim();

    var seasonNumbers = extractSeasonsFromTitleLocal(cleanTitle);

    if (seasonNumbers.length > 0) {
      cleanTitle = cleanTitleFromSeasonsLocal(cleanTitle);
    }

    if (seasonNumbers.length === 0) {
      seasonNumbers = extractSeasonsFromFilesLocal();
    }




    var cardMediaType = getTorrentMediaTypeFromCard(torrent);

    var forcedTv = false;

    if (cardMediaType === 'tv') forcedTv = true;
    if (torrent.media_type === 'tv') forcedTv = true;
    if (known && known.mediaType === 'tv') forcedTv = true;





    if (seasonNumbers.length === 0 && forcedTv) {
      seasonNumbers = [1];
    }

    result.tmdbId = tmdbId;
    result.cleanTitle = cleanTitle;
    result.seasonNumbers = seasonNumbers;

    if (elements.titleEl) {
      elements.titleEl.textContent = cleanTitle;
    }





    var knownMediaType = cardMediaType === 'tv' ? 'tv' :
    torrent.media_type ||
    torrent.knownMediaType ||
    known && known.mediaType ||
    null;




    var titleLooksLikeSeries = /(^|[^a-z0-9а-яё])(сезон|season|серия|эпизод|s\d+)([^a-z0-9а-яё]|$)/i.
    test(String(torrent.title || '').toLowerCase());





    if (!knownMediaType && cardMediaType === 'movie' &&
    seasonNumbers.length === 0 && !titleLooksLikeSeries) {
      knownMediaType = 'movie';
    }









    if (!knownMediaType && torrent.category) {
      var categoryLower = String(torrent.category).toLowerCase();

      if (categoryLower.indexOf('tv') !== -1 || categoryLower.indexOf('сериал') !== -1) {
        knownMediaType = 'tv';
      } else if (categoryLower.indexOf('movie') !== -1 || categoryLower.indexOf('фильм') !== -1) {
        knownMediaType = 'movie';
      }
    }

    var isTvSeries = false;

    if (knownMediaType === 'tv') {
      isTvSeries = true;
    } else if (knownMediaType === 'movie') {
      isTvSeries = false;
    } else if (seasonNumbers.length > 0) {
      isTvSeries = true;
    } else {
      try {
        if (torrent.file_stats && Array.isArray(torrent.file_stats) && torrent.file_stats.length > 1) {
          isTvSeries = true;
        } else if (torrent.data) {
          var parsedData = JSON.parse(torrent.data);
          if (
          parsedData &&
          parsedData.TorrServer &&
          parsedData.TorrServer.Files &&
          parsedData.TorrServer.Files.length > 1)
          {
            isTvSeries = true;
          }
        }
      } catch (e) {}

      if (!isTvSeries) {
        isTvSeries = titleLooksLikeSeries;
      }
    }

    var mediaType = isTvSeries ? 'tv' : 'movie';





    torrent.media_type = mediaType;

    var videoFilesCount = 0;
    try {
      if (typeof getVideoFilesFromTorrent === 'function') {
        videoFilesCount = getVideoFilesFromTorrent(torrent).length;
      }
    } catch (e) {}

    var details = null;

    if (tmdbId && typeof getTmdbDetailsWithCache === 'function') {
      try {
        details = yield getTmdbDetailsWithCache(tmdbId, mediaType);
      } catch (e) {
        console.warn('Ошибка загрузки TMDB details:', e);
      }
    }


    if (details && elements.detailViewDiv && !isOpenTorrentDetail(torrent)) details = null;

    if (details) {
      if (details.backdrop_path && elements.detailViewDiv) {
        var backdropUrl = normalizePosterUrl(details.backdrop_path, 'w1280');

        elements.detailViewDiv.style.backgroundImage =
        'linear-gradient(to top, rgba(0, 0, 0, 0.97) 0%, rgba(0, 0, 0, 0.82) 32%, rgba(0, 0, 0, 0.38) 64%, rgba(0, 0, 0, 0.25) 100%), ' +
        'linear-gradient(to right, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.5) 45%, rgba(0, 0, 0, 0.1) 100%), ' +
        'url("' + backdropUrl + '")';
        elements.detailViewDiv.style.backgroundSize = 'cover';
        elements.detailViewDiv.style.backgroundPosition = 'center';
        elements.detailViewDiv.style.backgroundRepeat = 'no-repeat';



        elements.detailViewDiv.style.setProperty('--torrent-backdrop', 'url("' + backdropUrl + '")');
      }

      if (details.overview) {
        if (elements.detailSubtitle) {
          elements.detailSubtitle.textContent = details.overview;
          elements.detailSubtitle.style.display = 'block';
          elements.detailSubtitle.classList.remove('hidden');
        }
      }


      revealTorrentDetailExtras(torrent, details);

      if (typeof updateDetailMetaInfo === 'function') {
        try {
          updateDetailMetaInfo(details);
        } catch (e) {}
      }

      if (!torrent.poster && details.poster_path) {
        torrent.poster = normalizePosterUrl(details.poster_path, 'w342');
      }

      var posterEl = elements.posterImg || (typeof getEl === 'function' ? getEl('detail-poster') : null);

      if (posterEl && torrent.poster && !posterEl.querySelector('img')) {
        posterEl.innerHTML = '<img src="' + torrent.poster + '" alt="poster">';
      }

      if (details.media_type && !torrent.media_type) {
        torrent.media_type = details.media_type;
      }
    }

    var allSeasonEpisodes = {};

    if (tmdbId && isTvSeries && seasonNumbers.length > 0 && typeof loadSeasonStills === 'function') {
      var seasonPromises = seasonNumbers.map(function (seasonNumber) {
        return loadSeasonStills(tmdbId, seasonNumber).
        then(function (episodes) {
          return {
            season: seasonNumber,
            episodes: episodes || []
          };
        }).
        catch(function () {
          return {
            season: seasonNumber,
            episodes: []
          };
        });
      });

      try {
        var seasonResults = yield Promise.all(seasonPromises);

        for (var i = 0; i < seasonResults.length; i++) {
          var seasonResult = seasonResults[i];

          if (seasonResult && seasonResult.episodes && seasonResult.episodes.length > 0) {
            allSeasonEpisodes[seasonResult.season] = seasonResult.episodes;
          }
        }
      } catch (e) {
        console.warn('Ошибка загрузки кадров сезонов:', e);
      }
    }

    var movieStill = null;

    if (tmdbId && !isTvSeries && seasonNumbers.length === 0 && typeof loadMovieStill === 'function') {
      try {
        movieStill = yield loadMovieStill(tmdbId);
      } catch (e) {
        console.warn('Ошибка загрузки постера/кадра фильма:', e);
      }
    }

    if (window.AppState) {
      AppState.isSerials = isTvSeries;

      if (isTvSeries && seasonNumbers.length === 1) {
        AppState.currentTMDB = tmdbId;
        AppState.currentSeason = seasonNumbers[0];
      }
    }

    if (
    hashLower &&
    tmdbId &&
    typeof knownTorrentMeta !== 'undefined' &&
    knownTorrentMeta &&
    knownTorrentMeta.set)
    {
      try {
        knownTorrentMeta.set(hashLower, {
          id: tmdbId,
          mediaType: mediaType,
          poster: torrent.poster || null
        });
      } catch (e) {}
    }

    result.isTvSeries = isTvSeries;
    result.mediaType = mediaType;
    result.videoFilesCount = videoFilesCount;
    result.allSeasonEpisodes = allSeasonEpisodes;
    result.movieStill = movieStill;
    result.details = details;

    return result;
  });return _loadAllTmdbDataForTorrent.apply(this, arguments);}



function updateFileItemStill(fileItem, stillImage) {
  if (!fileItem || !stillImage) return;
  if (fileItem._still) {
    fileItem._still.src = stillImage;
    fileItem._stillBox.classList.remove('hidden');
    fileItem._overlay.classList.remove('hidden');
    return;
  }

  var existingContainer = fileItem.querySelector('.file-still-container');
  if (existingContainer) {var img = existingContainer.querySelector('img');if (img) img.src = stillImage;}
}

function updateDetailMetaInfo(tmdbData) {
  var metaContainer = getEl('catalog-detail-meta');
  if (!metaContainer) return;

  metaContainer.innerHTML = '';


  if (tmdbData.release_date || tmdbData.first_air_date) {
    var year = (tmdbData.release_date || tmdbData.first_air_date).substring(0, 4);
    var yearChip = document.createElement('div');
    yearChip.className = 'catalog-meta-chip';
    yearChip.textContent = year;
    metaContainer.appendChild(yearChip);
  }

  if (tmdbData.vote_average) {
    var ratingChip = document.createElement('div');
    ratingChip.className = 'catalog-meta-chip';
    ratingChip.textContent = '⭐ ' + tmdbData.vote_average.toFixed(1);
    metaContainer.appendChild(ratingChip);
  }

  var typeChip = document.createElement('div');
  typeChip.className = 'catalog-meta-chip';
  typeChip.textContent = tmdbData.media_type === 'tv' || tmdbData.number_of_seasons !== undefined ? 'Сериал' : 'Фильм';
  metaContainer.appendChild(typeChip);

  if (tmdbData.genres && Array.isArray(tmdbData.genres)) {
    var genresLen = Math.min(tmdbData.genres.length, 3);
    for (var i = 0; i < genresLen; i++) {
      var genreChip = document.createElement('div');
      genreChip.className = 'catalog-meta-chip';
      genreChip.textContent = tmdbData.genres[i].name;
      metaContainer.appendChild(genreChip);
    }
  }


  if (metaContainer.children.length > 0) {
    metaContainer.classList.add('hidden');
    metaContainer.style.display = 'none';
  }



  detailMetaState.details = tmdbData;
  if (tmdbData) {

    detailMetaState.isTvSeries = detailMetaState.isTvSeries ||
    tmdbData.type === 'tv' || tmdbData.media_type === 'tv' ||
    tmdbData.number_of_seasons !== undefined;
  }
  renderDetailMetaRow();
}


function setupFilePlayButtonDelegation() {
  var filesList = getEl('files-list');
  if (!filesList || filesList._playDelegationBound) return;

  filesList._playDelegationBound = true;

  filesList.addEventListener('click', function () {var _ref = _asyncToGenerator(function* (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.play-btn') : null;
      if (!btn) return;

      e.stopPropagation();

      var item = btn.closest('.file-item');

      var hash = btn.dataset.hash || item && item.dataset.hash || '';

      var fileId = parseInt(btn.dataset.fileId || item && item.dataset.fileId || '1', 10);
      if (!fileId) fileId = 1;

      var episodeIndex = null;
      var rawEpisode = btn.dataset.episodeIndex;

      if ((!rawEpisode || rawEpisode === 'null') && item && item.dataset.episodeIndex !== undefined) {
        rawEpisode = item.dataset.episodeIndex;
      }

      if (rawEpisode !== undefined && rawEpisode !== '' && rawEpisode !== 'null') {
        var parsedEpisode = parseInt(rawEpisode, 10);
        if (!isNaN(parsedEpisode)) episodeIndex = parsedEpisode;
      }




      if (!hash) {
        if (typeof window.showErrorBanner === 'function') window.showErrorBanner('Не удалось начать воспроизведение', 'У файла нет hash раздачи');
        return;
      }
      if (!(yield ensureTorrserverOnline())) return;

      var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;

      var overlay = getEl('playback-overlay');
      if (overlay) overlay.classList.add('active');

      var detailView = getEl('detail-view');
      if (detailView) detailView.style.pointerEvents = 'none';

      startHLSPlayback(playUrl, 0, false, episodeIndex).finally(function () {
        if (overlay) overlay.classList.remove('active');
        if (detailView) detailView.style.pointerEvents = 'auto';
      });
    });return function (_x12) {return _ref.apply(this, arguments);};}());
}





















function ensureFilesListShell() {
  var list = getEl('files-list');
  if (!list) return null;
  if (!list._msg || list._msg.parentNode !== list) {
    list.innerHTML = '';
    var msg = document.createElement('div');
    msg.className = 'files-list-msg hidden';
    list.appendChild(msg);
    list._msg = msg;
    list._pool = [];
  }
  return list;
}

function buildFileItem() {
  var item = document.createElement('div');
  item.className = 'file-item hidden';

  var stillBox = document.createElement('div');
  stillBox.className = 'file-still-container hidden';
  var still = document.createElement('img');
  still.decoding = 'async';
  still.alt = '';
  stillBox.appendChild(still);

  var overlay = document.createElement('div');
  overlay.className = 'file-overlay hidden';



  still.onerror = function () {
    stillBox.classList.add('hidden');
    overlay.classList.add('hidden');
  };

  var content = document.createElement('div');
  content.className = 'file-content';
  var play = document.createElement('button');
  play.className = 'play-btn';
  play.textContent = '▶';
  content.appendChild(play);

  var info = document.createElement('div');
  info.className = 'file-info';
  var name = document.createElement('div');
  name.className = 'file-name';
  var size = document.createElement('div');
  size.className = 'file-size';
  info.appendChild(name);
  info.appendChild(size);

  var progressBox = document.createElement('div');
  progressBox.className = 'file-progress-container';
  var fill = document.createElement('div');
  fill.className = 'file-progress-fill';
  progressBox.appendChild(fill);

  item.appendChild(stillBox);
  item.appendChild(overlay);
  item.appendChild(content);
  item.appendChild(info);
  item.appendChild(progressBox);

  item._stillBox = stillBox;
  item._still = still;
  item._overlay = overlay;
  item._play = play;
  item._name = name;
  item._size = size;
  item._fill = fill;
  return item;
}








function resetFileItem(item) {
  if (!item) return;
  item.classList.add('hidden');
  item.classList.remove('has-progress');
  item.classList.remove('focused');
  item._stillBox.classList.add('hidden');
  item._overlay.classList.add('hidden');
  if (item._still.getAttribute('src')) item._still.removeAttribute('src');
  item._fill.style.width = '';
  item._fill.style.opacity = '';
  delete item.dataset.hash;
  delete item.dataset.fileId;
  delete item.dataset.fileName;
  delete item.dataset.episodeIndex;
  delete item.dataset.progressTimecode;
  delete item.dataset.progressDuration;
}

function clearFilesList() {
  var list = ensureFilesListShell();
  if (!list) return;
  for (var i = 0; i < list._pool.length; i++) resetFileItem(list._pool[i]);
  hideFilesListMessage(list);
}

function showFilesListMessage(html, modifier) {
  var list = ensureFilesListShell();
  if (!list) return;
  for (var i = 0; i < list._pool.length; i++) resetFileItem(list._pool[i]);
  list._msg.className = 'files-list-msg' + (modifier ? ' ' + modifier : '');
  list._msg.innerHTML = html;
}

function hideFilesListMessage(list) {
  list = list || ensureFilesListShell();
  if (!list || !list._msg) return;
  if (list._msg.innerHTML) list._msg.innerHTML = '';
  list._msg.className = 'files-list-msg hidden';
}

function acquireFileItem(list, index) {
  while (list._pool.length <= index) {
    var el = buildFileItem();
    list.appendChild(el);
    list._pool.push(el);
  }
  return list._pool[index];
}

function fillFileItem(item, file, hash, name, episodeIndex) {
  var fileName = String(file.path || '').split('/').pop() || 'Файл ' + file.id;
  resetFileItem(item);
  item.dataset.hash = hash;
  item.dataset.fileId = file.id;
  item.dataset.fileName = fileName;
  var hasEpisode = episodeIndex !== undefined && episodeIndex !== null;
  if (hasEpisode) item.dataset.episodeIndex = episodeIndex;
  item._play.dataset.hash = hash;
  item._play.dataset.fileId = file.id;
  item._play.dataset.episodeIndex = hasEpisode ? episodeIndex : '';
  item._name.textContent = name;
  item._name.title = name;
  item._size.textContent = formatBytes(file.length);
  item.classList.remove('hidden');
  return item;
}

var FILE_ITEM_EXTENSIONS = ['mkv', 'mp4', 'avi', 'mov', 'webm', 'm4v'];





function renderFileItems(videoFiles, hash, singleTitle) {
  var list = ensureFilesListShell();
  if (!list) return [];
  hideFilesListMessage(list);

  var single = videoFiles.length === 1;
  var used = [];
  for (var i = 0; i < videoFiles.length; i++) {
    var file = videoFiles[i];
    var ext = String(file.path || '').split('.').pop().toLowerCase();
    if (FILE_ITEM_EXTENSIONS.indexOf(ext) === -1) continue;
    var item = acquireFileItem(list, used.length);
    fillFileItem(item, file, hash, single ? singleTitle : 'Серия ' + (i + 1), single ? null : i);
    used.push(item);
  }
  for (var j = used.length; j < list._pool.length; j++) resetFileItem(list._pool[j]);
  return used;
}



function addFileItem(file, hash, name, episodeIndex) {
  var ext = String(file.path || '').split('.').pop().toLowerCase();
  if (FILE_ITEM_EXTENSIONS.indexOf(ext) === -1) return null;
  var list = ensureFilesListShell();
  if (!list) return null;
  var used = 0;
  while (used < list._pool.length && !list._pool[used].classList.contains('hidden')) used++;
  return fillFileItem(acquireFileItem(list, used), file, hash, name, episodeIndex);
}function

loadStillsAndUpdateFiles(_x13, _x14, _x15, _x16) {return _loadStillsAndUpdateFiles.apply(this, arguments);}function _loadStillsAndUpdateFiles() {_loadStillsAndUpdateFiles = _asyncToGenerator(function* (seasonNumbers, allSeasonEpisodes, movieStill, totalVideoFiles) {
    if (seasonNumbers.length > 0 && Object.keys(allSeasonEpisodes).length > 0) {
      var sortedSeasons = seasonNumbers.slice().sort((a, b) => a - b);
      var allStillsInOrder = [];
      sortedSeasons.forEach((seasonNum) => {
        var episodes = (allSeasonEpisodes[seasonNum] || []).slice().sort((a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0));
        episodes.forEach((ep) => {if (ep.stillPath) allStillsInOrder.push({ season: seasonNum, episode: ep.episodeNumber, stillPath: ep.stillPath });});
      });
      var fileItems = document.querySelectorAll('#files-list .file-item:not(.hidden)');
      for (var i = 0; i < Math.min(fileItems.length, allStillsInOrder.length); i++) {
        (function (item, url, index) {setTimeout(function () {updateFileItemStill(item, buildTmdbPosterUrl(url, 'w300'));}, index * 30);})(fileItems[i], allStillsInOrder[i].stillPath, i);
      }
    } else if (totalVideoFiles === 1 && movieStill) {
      var fileItem = document.querySelector('#files-list .file-item:not(.hidden)');if (fileItem) setTimeout(function () {updateFileItemStill(fileItem, movieStill);}, 100);
    }
  });return _loadStillsAndUpdateFiles.apply(this, arguments);}


function applyProgressToItem(item, timecode, duration) {
  var progressPercent = Math.min(timecode / duration * 100, 98);
  var progressFill = item.querySelector('.file-progress-fill');
  if (progressFill) {
    progressFill.style.width = progressPercent + '%';
    if (progressPercent > 5) {
      progressFill.style.opacity = '1';
      item.classList.add('has-progress');
    }
  }
  item.dataset.progressTimecode = timecode;
  item.dataset.progressDuration = duration;
}

function getVideoFilesForProgress(files) {
  var videoFiles = [];
  for (var i = 0; i < (files || []).length; i++) {
    var file = files[i];
    var name = String(file.path || file.name || '').toLowerCase();
    if (['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'].some(function (ext) {
      return name.indexOf(ext) !== -1;
    })) {
      file._progressIndex = i;
      videoFiles.push(file);
    }
  }
  return videoFiles;
}













function isNewerWatchEntry(entry, current) {
  if (entry.timestamp && current.timestamp && entry.timestamp !== current.timestamp) {
    return entry.timestamp > current.timestamp;
  }
  return entry.index > current.index;
}

function getTorrentProgressBatch(hash, files) {
  if (!hash) return Promise.resolve({ byFileId: {}, lastWatched: null });
  var cached = torrentProgressCache.get(hash);
  if (cached) return Promise.resolve(cached);
  if (torrentProgressInFlight[hash]) return torrentProgressInFlight[hash];

  var request = _asyncToGenerator(function* () {
    var videoFiles = getVideoFilesForProgress(files);
    var result = { byFileId: {}, lastWatched: null };
    if (!videoFiles.length) return result;

    try {
      var response = yield fetch(SERVER_URL + '/api/timecode/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hash: hash,
          fileIds: videoFiles.map(function (file) {return parseInt(file.id, 10);}),
          clientId: localStorage.getItem('clientId')
        })
      });
      if (!response.ok) return result;
      var data = yield response.json();
      if (!data.success || !data.timecodes) return result;

      for (var i = 0; i < videoFiles.length; i++) {
        var file = videoFiles[i];
        var timecode = data.timecodes[file.id];
        if (!timecode || !(timecode.timecode > 0)) continue;
        var entry = {
          hash: hash,
          fileId: file.id,
          timecode: timecode.timecode,
          duration: timecode.duration || 0,
          index: file._progressIndex,
          timestamp: timecode.timestamp || 0,
          fileName: String(file.path || file.name || '').split('/').pop()
        };
        result.byFileId[String(file.id)] = entry;
        if (!result.lastWatched || isNewerWatchEntry(entry, result.lastWatched)) {
          result.lastWatched = entry;
        }
      }
    } catch (error) {
      console.error('Progress batch request failed:', error);
    }
    return result;
  })();

  torrentProgressInFlight[hash] = request;
  return request.then(function (result) {
    delete torrentProgressInFlight[hash];
    torrentProgressCache.set(hash, result);
    return result;
  }, function (error) {
    delete torrentProgressInFlight[hash];
    throw error;
  });
}function

loadProgressForTorrent(_x17, _x18) {return _loadProgressForTorrent.apply(this, arguments);}function _loadProgressForTorrent() {_loadProgressForTorrent = _asyncToGenerator(function* (torrent, preloadedFiles) {
    if (!torrent || !torrent.hash) return null;
    var files = Array.isArray(preloadedFiles) && preloadedFiles.length ?
    preloadedFiles : yield (
      getTorrentFilesWithCache(torrent, false));
    var progress = yield getTorrentProgressBatch(torrent.hash, files);
    if (!progress.lastWatched) return null;

    var last = progress.lastWatched;
    return {
      hash: torrent.hash,
      fileId: last.fileId,
      timecode: last.timecode,
      duration: last.duration,
      episodeIndex: last.index,
      totalEpisodes: getVideoFilesForProgress(files).length,
      episodeName: last.fileName,
      isSeries: getVideoFilesForProgress(files).length > 1
    };
  });return _loadProgressForTorrent.apply(this, arguments);}function

loadProgressForFileItems(_x19, _x20) {return _loadProgressForFileItems.apply(this, arguments);}function _loadProgressForFileItems() {_loadProgressForFileItems = _asyncToGenerator(function* (items, hash) {
    if (!items || !items.length || !hash) return;
    var files = [];
    for (var i = 0; i < items.length; i++) {
      files.push({
        id: items[i].dataset.fileId,
        path: items[i].dataset.fileName || String(items[i].dataset.fileId) + '.mkv'
      });
    }
    var progress = yield getTorrentProgressBatch(hash, files);
    for (var j = 0; j < items.length; j++) {
      var itemProgress = progress.byFileId[String(items[j].dataset.fileId)];
      if (itemProgress && itemProgress.duration > 0) {
        applyProgressToItem(items[j], itemProgress.timecode, itemProgress.duration);
      }
    }
  });return _loadProgressForFileItems.apply(this, arguments);}























var FFPROBE_COVER_CODECS = ['mjpeg', 'png', 'bmp', 'gif', 'jpeg', 'webp'];

var FFPROBE_VIDEO_NAMES = {
  h264: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9',
  mpeg4: 'MPEG-4', mpeg2video: 'MPEG-2', vc1: 'VC-1', xvid: 'XviD'
};


var FFPROBE_MAX_AUDIO = 4;
var FFPROBE_MAX_SUBS = 5;
var FFPROBE_TRACK_TITLE_MAX = 26;


function pickFfprobeVideoStream(ffprobe) {
  if (!ffprobe || !ffprobe.length) return null;

  var best = null;
  for (var i = 0; i < ffprobe.length; i++) {
    var s = ffprobe[i];
    if (!s || s.codec_type !== 'video') continue;
    if (FFPROBE_COVER_CODECS.indexOf(String(s.codec_name || '').toLowerCase()) !== -1) continue;

    var w = s.width || 0,h = s.height || 0;
    if (!w || !h) continue;
    if (!best || w * h > best.width * best.height) best = s;
  }
  return best;
}






















function qualityFromFrame(width, height) {
  var w = width || 0,h = height || 0;
  if (!w || !h) return 0;

  if (h > w * 0.9) h = h / 2;
  if (w > h * 3) w = w / 2;

  var eff = Math.max(h, w * 9 / 16);

  if (eff >= 1700) return 2160;
  if (eff >= 900) return 1080;
  if (eff >= 650) return 720;
  if (eff >= 380) return 480;
  return 360;
}








function qualityFromTitle(title) {
  var t = String(title || '');
  var re = /(\d{3,4})\s*[pi\u0440](?![\da-z\u0430-\u044f])/gi;
  var best = 0,m;

  while ((m = re.exec(t)) !== null) {
    var v = parseInt(m[1], 10);
    if (v > best) best = v;
  }

  if (best >= 2000) return 2160;
  if (best >= 1000) return 1080;
  if (best >= 700) return 720;
  if (best >= 400) return 480;
  if (best >= 300) return 360;


  if (/4\s*[k\u043a]|\buhd\b/i.test(t)) return 2160;
  return 0;
}




var HDR_TITLE_RE = /HDR(?![a-z\u0430-\u044f])|HDR10|Dolby\s*Vision|\bDV\s*[\d.]|\bHLG\b|PQ10/i;













function resolveVideotype(item, info) {
  var vt = String(info && info.videotype || item && item.videotype || '').toLowerCase();
  if (vt === 'hdr') return vt;

  var title = String(item && (item.Title || item.title) || '');
  if (HDR_TITLE_RE.test(title)) return 'hdr';

  return vt;
}








function resolveTorrentQuality(item, info) {
  var v = pickFfprobeVideoStream(item && item.ffprobe);
  if (v) {
    var byFrame = qualityFromFrame(v.width, v.height);
    if (byFrame) return byFrame;
  }

  var byTitle = qualityFromTitle(item && (item.Title || item.title));
  if (byTitle) return byTitle;

  return info && info.quality || item && item.quality || 0;
}


function normalizeChannelLayout(stream) {
  var layout = String(stream && stream.channel_layout || '').toLowerCase();

  if (layout) {
    if (layout.indexOf('mono') !== -1) return '1.0';
    if (layout.indexOf('stereo') !== -1) return '2.0';

    var m = layout.match(/^(\d+\.\d+)/);
    if (m) return m[1];
  }


  var ch = stream && stream.channels;
  if (ch === 1) return '1.0';
  if (ch === 2) return '2.0';
  if (ch === 6) return '5.1';
  if (ch === 8) return '7.1';
  return '';
}



function streamBitrate(stream) {
  if (!stream) return 0;
  var bps = parseInt(stream.tags && stream.tags.BPS || 0, 10) || 0;
  if (!bps) bps = parseInt(stream.bit_rate || 0, 10) || 0;
  return bps > 0 ? bps : 0;
}

















function ffprobeBitrate(ffprobe, videoStream) {
  var videoBps = streamBitrate(videoStream);
  if (!videoBps) return 0;

  var total = videoBps;
  for (var i = 0; i < ffprobe.length; i++) {
    var s = ffprobe[i];
    if (!s || s === videoStream) continue;
    if (s.codec_type !== 'audio' && s.codec_type !== 'subtitle') continue;
    total += streamBitrate(s);
  }

  return total;
}









function shortTrackTitle(title) {
  var t = String(title || '').replace(/\s+/g, ' ').trim();
  if (t.length <= FFPROBE_TRACK_TITLE_MAX) return t;

  var bracket = t.match(/[\[(]([^\])]+)[\])]/);
  if (bracket && bracket[1].length <= FFPROBE_TRACK_TITLE_MAX) return bracket[1].trim();

  return t.slice(0, FFPROBE_TRACK_TITLE_MAX - 1) + '…';
}











function summarizeFfprobe(ffprobe) {
  if (!ffprobe || !ffprobe.length) return null;

  var v = pickFfprobeVideoStream(ffprobe);
  var audio = [],subs = [],layout = '',bestChannels = 0;
  var audioSeen = {},audioTotal = 0,subsTotal = 0;

  for (var i = 0; i < ffprobe.length; i++) {
    var s = ffprobe[i];
    if (!s) continue;
    var tags = s.tags || {};
    var lang = String(tags.language || '').toLowerCase();

    if (s.codec_type === 'audio') {
      audioTotal++;



      if ((s.channels || 0) > bestChannels) {
        bestChannels = s.channels || 0;
        layout = normalizeChannelLayout(s);
      }

      var title = shortTrackTitle(tags.title);




      if (lang || title) {
        var key = lang + '\u0000' + title;
        if (!audioSeen[key]) {
          audioSeen[key] = 1;
          if (audio.length < FFPROBE_MAX_AUDIO) audio.push({ lang: lang, title: title });
        }
      }
    } else if (s.codec_type === 'subtitle') {
      subsTotal++;
      if (lang && subs.indexOf(lang) === -1 && subs.length < FFPROBE_MAX_SUBS) subs.push(lang);
    }
  }

  if (!v && !audioTotal && !subsTotal) return null;

  return {
    w: v ? v.width : 0,
    h: v ? v.height : 0,
    vcodec: v ? String(v.codec_name || '').toLowerCase() : '',
    bitrate: ffprobeBitrate(ffprobe, v),
    layout: layout,
    audio: audio,
    subs: subs,


    moreAudio: Math.max(0, Object.keys(audioSeen).length - audio.length),
    moreSubs: 0
  };
}

function normalizeSearchResult(item) {

  var info = item.info || {};

  var rawTracker = item.Tracker || item.tracker || '';
  var tracker = String(rawTracker).trim();

  var title = item.Title || item.title || info.name || info.originalname || item.name || 'Без названия';


  var cleanName = info.name || item.name || title;


  var releasedRaw = info.relased || info.released || item.PublishDate || null;
  var releasedYear = null;
  if (typeof releasedRaw === 'number') {
    releasedYear = releasedRaw;
  } else if (typeof releasedRaw === 'string') {
    var match = releasedRaw.match(/(19|20)\d{2}/);
    releasedYear = match ? parseInt(match[0], 10) : null;
  }


  var types = Array.isArray(info.types) ? info.types.slice() : [];
  var categoryDesc = (item.CategoryDesc || '').toLowerCase();
  if (categoryDesc.includes('tv') || categoryDesc.includes('сериал') || categoryDesc.includes('series')) {
    if (types.indexOf('tv') === -1) types.push('tv');
  }
  if (categoryDesc.includes('movie') || categoryDesc.includes('фильм') || categoryDesc.includes('film')) {
    if (types.indexOf('movie') === -1) types.push('movie');
  }


  var magnet = item.MagnetUri || item.magnet || null;


  var size = item.Size || item.size || 0;
  var sizeName = info.sizeName || item.sizeName;
  if (!sizeName && size > 0) {
    sizeName = formatBytes(size);
  }


  var createTime = item.createTime || 0;
  if (!createTime && item.PublishDate) {
    try {
      createTime = new Date(item.PublishDate).getTime() || 0;
    } catch (e) {
      createTime = 0;
    }
  }

  var normalized = {
    title: title,
    name: cleanName,
    originalname: info.originalname || '',
    magnet: magnet,
    size: size,
    sizeName: sizeName || '0 B',
    tracker: tracker,
    sid: item.Seeders !== undefined ? parseInt(item.Seeders, 10) : item.sid || 0,
    pir: item.Peers !== undefined ? parseInt(item.Peers, 10) : item.pir || 0,
    quality: resolveTorrentQuality(item, info),
    media: summarizeFfprobe(item.ffprobe),
    videotype: resolveVideotype(item, info),
    voices: Array.isArray(info.voices) ? info.voices : Array.isArray(item.voices) ? item.voices : [],
    types: types,
    released: releasedYear,
    relased: releasedYear,
    year: releasedYear,
    languages: Array.isArray(info.languages) ? info.languages : Array.isArray(item.languages) ? item.languages : [],
    createTime: createTime,
    details: item.Details || item.details || null,
    seasons: Array.isArray(info.seasons) ? info.seasons : Array.isArray(item.seasons) ? item.seasons : []
  };

  return normalized;
}






function JacredUnavailableError(host, reason, timedOut) {
  this.name = 'JacredUnavailableError';
  this.jacredHost = host;
  this.jacredTimeout = !!timedOut;
  this.message = 'Jacred (' + host + ') недоступен: ' + reason;
}
JacredUnavailableError.prototype = Object.create(Error.prototype);
JacredUnavailableError.prototype.constructor = JacredUnavailableError;













var JACRED_TIMEOUT_MS = 15000;
window.JACRED_TIMEOUT_MS = JACRED_TIMEOUT_MS;










function setJacredSearchFailure(error) {
  AppState.lastSearchFailure = error && error.jacredHost ?
  { host: error.jacredHost, timedOut: !!error.jacredTimeout } :
  null;
}
window.setJacredSearchFailure = setJacredSearchFailure;








function showJacredUnavailableBanner(error) {
  if (typeof window.showErrorBanner !== 'function') return false;
  if (!error || !error.jacredHost) return false;
  var seconds = Math.round((window.JACRED_TIMEOUT_MS || JACRED_TIMEOUT_MS) / 1000);
  window.showErrorBanner('Jacred недоступен', error.jacredTimeout ?
  'Не отвечает ' + error.jacredHost + ': нет ответа за ' + seconds +
  ' секунд. Адрес меняется в настройках.' :
  'Не отвечает ' + error.jacredHost + '. Адрес меняется в настройках.');
  return true;
}
window.showJacredUnavailableBanner = showJacredUnavailableBanner;function

searchTorrents(_x21) {return _searchTorrents.apply(this, arguments);}function _searchTorrents() {_searchTorrents = _asyncToGenerator(function* (query) {
    if (!query || !query.trim()) {alert('Введите поисковый запрос');return;}












    var navTop = window.Nav ? Nav.top() : null;
    var navUnder = window.Nav ? Nav.prev() : null;
    var overCard = !!(navTop && navTop.screen === 'search' && navUnder && (
    navUnder.screen === 'detail' || navUnder.screen === 'torrent-detail'));
    if (overCard && !AppState.searchLocked) {



      if (typeof window.dropDetailUnderOverlay === 'function') window.dropDetailUnderOverlay();
      Nav.dropDetailsUnderTop('свой запрос из поиска над карточкой');
    }

    if (getCurrentSearchMode() === 'globalsearch') return yield searchTMDB(query);
    return yield searchTorrentsLegacy(query);
  });return _searchTorrents.apply(this, arguments);}








function getJacredSearchHints() {
  if (!AppState.searchLocked) return null;
  return AppState.jacredSearchHints || null;
}
window.getJacredSearchHints = getJacredSearchHints;














function buildJacredSearchUrl(query, hints) {
  var jacred = getEl('jacred-url');
  var host = jacred && jacred.value !== "" ? jacred.value : "jac.red";


  var url = AppState.protocol + '//' + host + '/api/v2.0/indexers/all/results' +
  '?Query=' + encodeURIComponent(query.trim()) + '&exact=true';

  if (hints === undefined) hints = getJacredSearchHints();
  if (hints) {
    if (hints.isSerial) url += '&is_serial=' + hints.isSerial;
    if (hints.year) url += '&year=' + hints.year;
  }

  return { url: url, host: host };
}
window.buildJacredSearchUrl = buildJacredSearchUrl;function

searchTorrentsLegacy(_x22) {return _searchTorrentsLegacy.apply(this, arguments);}function _searchTorrentsLegacy() {_searchTorrentsLegacy = _asyncToGenerator(function* (query) {
    if (!query || !query.trim()) {alert('Введите поисковый запрос');return;}
    var target = buildJacredSearchUrl(query);
    var searchUrl = target.url,jacDefault = target.host;

    showLoading('Поиск...');
    setJacredSearchFailure(null);

    var timeoutController = new AbortController();
    var timedOut = false;
    var timeoutId = setTimeout(function () {timedOut = true;timeoutController.abort();}, JACRED_TIMEOUT_MS);
    try {





      var response;
      try {
        response = yield fetch(searchUrl, { signal: timeoutController.signal });
      } catch (netError) {
        if (timedOut) throw new JacredUnavailableError(jacDefault, 'нет ответа за ' + JACRED_TIMEOUT_MS + ' мс', true);
        throw new JacredUnavailableError(jacDefault, netError.message);
      }
      if (!response.ok) throw new JacredUnavailableError(jacDefault, 'HTTP ' + response.status);
      var data = yield response.json();


      var rawResults = [];
      if (data && Array.isArray(data.Results)) {
        rawResults = data.Results;
      } else if (Array.isArray(data)) {

        rawResults = data;
      }

      searchResults = rawResults.map(normalizeSearchResult);
      currentSearchQuery = query;

      var searchInput = getEl('search-query');
      if (searchInput && !AppState.searchLocked) searchInput.value = '';

      updateAvailableTrackers();
      updateAvailableYears();
      applyFiltersAndSort();
      showSearchResults();



      return searchResults.length;
    } catch (error) {



      if (timedOut && error && error.name === 'AbortError') {
        error = new JacredUnavailableError(jacDefault, 'нет ответа за ' + JACRED_TIMEOUT_MS + ' мс', true);
      }
      console.error('Ошибка поиска:', error);
      setJacredSearchFailure(error);
      if (!showJacredUnavailableBanner(error)) {
        if (typeof window.showErrorBanner === 'function') {
          window.showErrorBanner('Ошибка поиска', error.message);
        } else alert('Ошибка при поиске: ' + error.message);
      }
      return 0;
    } finally {
      clearTimeout(timeoutId);
      hideLoading();
    }
  });return _searchTorrentsLegacy.apply(this, arguments);}

function updateAvailableYears() {
  var yearSet = {};var yearFilter = getEl('filter-year');
  searchResults.forEach((r) => {if (r.released && !isNaN(r.released)) yearSet[r.released] = true;});
  var availableYears = Object.keys(yearSet).map(Number).sort((a, b) => b - a);
  if (yearFilter) {
    var currentYear = yearFilter.value;
    yearFilter.innerHTML = '<option value="all">Все</option>' + availableYears.map((y) => `<option value="${y}" ${currentYear !== 'all' && String(y) === currentYear ? 'selected' : ''}>${y}</option>`).join('');
    if (currentYear !== 'all' && !yearSet[currentYear]) {yearFilter.value = 'all';currentYearFilter = '';}
  }
}

function initSearchModeToggle() {
  var modeSelect = getEl('search-mode');
  if (modeSelect) {
    modeSelect.addEventListener('change', function (e) {
      currentSearchMode = e.target.value;
      var trackerFilter = getEl('filter-tracker');var qualityFilter = getEl('filter-quality');var contentTypeFilter = getEl('filter-content-type');
      if (currentSearchMode === 'globalsearch') {
        if (trackerFilter) trackerFilter.disabled = true;if (qualityFilter) qualityFilter.disabled = true;if (!contentTypeFilter) showContentTypeFilter();
      } else {
        if (trackerFilter) trackerFilter.disabled = false;if (qualityFilter) qualityFilter.disabled = false;if (contentTypeFilter && contentTypeFilter.remove) contentTypeFilter.remove();
      }
      if (currentSearchQuery) searchTorrents(currentSearchQuery);
    });
  }
}

function updateAvailableTrackers() {
  var trackerSet = {};

  searchResults.forEach(function (r) {
    if (r.tracker) {
      var trackers = String(r.tracker).split(',');
      for (var i = 0; i < trackers.length; i++) {
        var t = trackers[i].trim().toLowerCase();
        if (t) trackerSet[t] = true;
      }
    }
  });

  availableTrackers = Object.keys(trackerSet).sort();
  if (!availableTrackers.includes(currentTrackerFilter)) currentTrackerFilter = 'all';
  syncSearchFilterButtons();
  updateAvailableSeasons();
  updateAvailableVoices();
  updateAvailableVideotype();
}

function applyFiltersAndSort() {
  filteredResults = searchResults.filter((item) => {
    if (!qualityFilterMatches(currentQualityFilter, item.quality)) return false;
    if (currentTrackerFilter !== 'all') {
      var trackerField = (item.tracker || '').toLowerCase();
      if (trackerField.indexOf(currentTrackerFilter.toLowerCase()) === -1) return false;
    }
    if (currentYearFilter && currentYearFilter !== 'all' && item.released !== parseInt(currentYearFilter, 10)) return false;
    if (currentSeasonFilter && currentSeasonFilter !== 'all' && (!item.seasons || !item.seasons.includes(parseInt(currentSeasonFilter, 10)))) return false;
    if (currentVoiceFilter && currentVoiceFilter !== 'all' && (!item.voices || !item.voices.includes(currentVoiceFilter))) return false;
    if (currentvideotypeFilter && currentvideotypeFilter !== 'all' && item.videotype != currentvideotypeFilter) return false;
    return true;
  });
  filteredResults.sort((a, b) => {
    switch (currentSort) {
      case 'date-desc':return new Date(b.createTime || 0) - new Date(a.createTime || 0);
      case 'date-asc':return new Date(a.createTime || 0) - new Date(b.createTime || 0);
      case 'size-desc':return (b.size || 0) - (a.size || 0);
      case 'size-asc':return (a.size || 0) - (b.size || 0);
      case 'sid-desc':return (b.sid || 0) - (a.sid || 0);
      case 'sid-asc':return (a.sid || 0) - (b.sid || 0);
      case 'pir-desc':return (b.pir || 0) - (a.pir || 0);
      case 'pir-asc':return (a.pir || 0) - (b.pir || 0);
      default:return 0;
    }
  });
  renderSearchResults();
}

function updateAvailableSeasons() {
  var seasonSet = {};var seasonFilter = getEl('filter-season');if (!seasonFilter) return;
  searchResults.forEach((r) => {if (r.seasons && Array.isArray(r.seasons)) r.seasons.forEach((s) => seasonSet[s] = true);});
  var availableSeasons = Object.keys(seasonSet).map(Number).sort((a, b) => a - b);
  var currentSeason = seasonFilter.value;
  seasonFilter.innerHTML = '<option value="all">Все</option>' + availableSeasons.map((s) => `<option value="${s}" ${currentSeason !== 'all' && String(s) === currentSeason ? 'selected' : ''}>${s} сезон</option>`).join('');
  if (currentSeason !== 'all' && !seasonSet[parseInt(currentSeason)]) {seasonFilter.value = 'all';currentSeasonFilter = 'all';}
}

function updateAvailableVoices() {
  var voiceSet = {};var voiceFilter = getEl('filter-voice');if (!voiceFilter) return;
  searchResults.forEach((r) => {if (r.voices && Array.isArray(r.voices)) r.voices.forEach((v) => {if (v && v.trim()) voiceSet[v.trim()] = true;});});
  var availableVoices = Object.keys(voiceSet).sort();
  var currentVoice = voiceFilter.value;
  voiceFilter.innerHTML = '<option value="all">Все</option>' + availableVoices.map((v) => `<option value="${escapeHtml(v)}" ${currentVoice !== 'all' && v === currentVoice ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
  if (currentVoice !== 'all' && !voiceSet[currentVoice]) {voiceFilter.value = 'all';currentVoiceFilter = 'all';}
}

function updateAvailableVideotype() {
  var videotypeSet = {};var videotypeFilter = getEl('filter-videotype');if (!videotypeFilter) return;
  searchResults.forEach((r) => {if (r.videotype && r.videotype.trim()) videotypeSet[r.videotype.trim()] = true;});
  var availablevideotype = Object.keys(videotypeSet).sort();



  var currentvideotype = currentvideotypeFilter || 'all';
  videotypeFilter.innerHTML = '<option value="all">Все</option>' + availablevideotype.map((v) => `<option value="${escapeHtml(v)}" ${currentvideotype !== 'all' && v === currentvideotype ? 'selected' : ''}>${escapeHtml(v.toUpperCase())}</option>`).join('');
  if (currentvideotype !== 'all' && !videotypeSet[currentvideotype]) {videotypeFilter.value = 'all';currentvideotypeFilter = 'all';}
}

















function setSearchLocked(locked, query) {
  AppState.searchLocked = !!locked;



  var modeItem = document.querySelector('.filter-item[data-filter="torrent-movie"]');
  if (modeItem) modeItem.classList.toggle('hidden', !!locked);

  var input = getEl('search-query');
  if (!input) return;

  if (locked) {
    input.readOnly = true;
    input.classList.add('search-input-locked');

    if (query) input.value = query;
    input.setAttribute('title', 'Запрос задан карточкой фильма и не редактируется');
  } else {
    input.readOnly = false;
    input.classList.remove('search-input-locked');
    input.removeAttribute('title');
  }



  if (typeof window.invalidateFocusCache === 'function') window.invalidateFocusCache();
}
window.setSearchLocked = setSearchLocked;












function clearCatalogSearchContext() {


  AppState.jacredSearchHints = null;
  AppState.pendingDetailItem = null;
  AppState.pendingDetailTmdbId = null;
  AppState.pendingDetailPoster = null;
  AppState.pendingDetailMediaType = null;
  window.pendingCatalogItem = null;
  window.pendingCatalogPoster = null;
}
window.clearCatalogSearchContext = clearCatalogSearchContext;










function focusLastSearchCard() {
  var key = AppState.lastSearchCardKey;
  if (!key || typeof focusEl !== 'function') return false;
  var cards = document.querySelectorAll('#search-results .global-search-card');
  for (var i = 0; i < cards.length; i++) {
    if (cards[i].dataset.tmdbId + ':' + cards[i].dataset.mediaType === key) {
      if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
      focusEl(cards[i]);
      return true;
    }
  }
  return false;
}






function focusLastSearchResult() {
  if (typeof focusEl !== 'function') return false;
  var items = document.querySelectorAll('#search-results .search-result-item');
  if (!items.length) return false;
  var hash = String(AppState.lastSearchResultHash || '').toLowerCase();
  var target = items[0];
  if (hash) {
    for (var i = 0; i < items.length; i++) {
      var btn = items[i].querySelector('.search-result-play');
      if (btn && String(btn.dataset.hash || '').toLowerCase() === hash) {target = items[i];break;}
    }
  }
  if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
  focusEl(target);
  return true;
}
window.focusLastSearchResult = focusLastSearchResult;

function showSearchResults(options = {}) {
  if (window.Nav) Nav.push('search', { key: 'search' });
  var searchOverlay = getEl('search-overlay');var searchTab = getEl('tab-search');var torrentsTab = getEl('tab-torrents');var catalogTab = getEl('tab-catalog');var searchInput = getEl('search-query');
  if (!searchOverlay || !searchTab || !torrentsTab) return;
  if (searchInput && document.activeElement === searchInput) searchInput.blur();
  var torrserverSection = getEl('torrserver-section');
  searchTab.classList.add('active');torrentsTab.classList.remove('active');if (catalogTab) catalogTab.classList.remove('active');
  var favoritesTab = getEl('tab-favorites');if (favoritesTab) favoritesTab.classList.remove('active');
  AppState.currentScreen = 'search';syncSearchFilterButtons();toggleSearchFiltersPanel(false);
  if (typeof Animations !== 'undefined' && typeof Animations.fadeIn === 'function') {


    Animations.fadeIn(searchOverlay, {
      duration: Animations.UI_FADE.overlay,
      display: 'flex',
      onDone: function () {
        if (torrserverSection && AppState.currentScreen === 'search') torrserverSection.style.display = 'none';


        if (typeof options.onShown === 'function') options.onShown();
      }
    });
  } else {
    if (torrserverSection) torrserverSection.style.display = 'none';
    searchOverlay.classList.remove('hidden');searchOverlay.style.display = 'flex';
    if (typeof options.onShown === 'function') options.onShown();
  }
  if (options.runSearch && searchInput && searchInput.value.trim()) setTimeout(function () {searchTorrents(searchInput.value.trim());}, 0);
  setTimeout(function () {

    if (options.restoreCard && focusLastSearchCard()) return;

    if (options.restoreCard && focusLastSearchResult()) return;
    if (typeof window.focusSearchHome === 'function') {window.focusSearchHome(options.focusQuery !== false);return;}
    if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
      updateFocusableElements();
      var searchInputIndex = -1,searchBtnIndex = -1,filterToggleIndex = -1,firstFilterIndex = -1;
      for (var i = 0; i < focusableElements.length; i++) {
        var el = focusableElements[i];
        if (el.id === 'search-query') searchInputIndex = i;if (el.id === 'search-btn') searchBtnIndex = i;if (el.id === 'filter-toggle') filterToggleIndex = i;
        if (['sort-by', 'filter-quality', 'filter-tracker', 'filter-year', 'reset-filters', 'close-search'].indexOf(el.id) !== -1 && firstFilterIndex === -1) firstFilterIndex = i;
      }
      var targetIndex = options.focusQuery !== false ? searchInputIndex !== -1 ? searchInputIndex : searchBtnIndex !== -1 ? searchBtnIndex : filterToggleIndex : firstFilterIndex !== -1 ? firstFilterIndex : filterToggleIndex !== -1 ? filterToggleIndex : 0;
      setFocus(targetIndex !== -1 ? targetIndex : 0);
    }
  }, 80);
}








function hideSearchResults(opts) {
  opts = opts || {};

  setSearchLocked(false);


  if (AppState.detailUnderSearch) {
    AppState.detailUnderSearch = false;
    if (typeof window.hideDetailView === 'function') window.hideDetailView();
  }
  var searchOverlay = getEl('search-overlay');var searchTab = getEl('tab-search');var torrentsTab = getEl('tab-torrents');var catalogTab = getEl('tab-catalog');var searchInput = getEl('search-query');var modeSelect = getEl('torrent-movie');
  if (modeSelect) modeSelect.value = 'globalsearch';
  if (!searchOverlay || !searchTab || !torrentsTab) return;
  var navEntry = window.Nav ? Nav.pop('search') : null;
  var navBack = window.Nav ? Nav.returnTarget(navEntry) : null;
  var returnTo = opts.returnTo || navBack || AppState.inSearch;
  var torrserverSection = getEl('torrserver-section');

  if (torrserverSection) torrserverSection.style.display = 'block';
  searchTab.classList.remove('active');toggleSearchFiltersPanel(false);
  if (typeof Animations !== 'undefined' && typeof Animations.fadeOut === 'function') {


    Animations.fadeOut(searchOverlay, {
      duration: Animations.UI_FADE.overlay,
      display: 'none',
      addHidden: true,
      onDone: function () {resetSearchVisibilityWindow();releaseGlobalPosters();var sr = getEl('search-results');if (sr) sr.innerHTML = '';}
    });
  } else {
    searchOverlay.classList.add('hidden');searchOverlay.style.display = 'none';
    resetSearchVisibilityWindow();
    releaseGlobalPosters();
    var searchResultsEl = getEl('search-results');if (searchResultsEl) searchResultsEl.innerHTML = '';
  }
  if (returnTo === 'detail') {
    AppState.currentScreen = 'detail';var mainContainer = getEl('main-container');if (mainContainer && AppState.backupScroll > 0) mainContainer.scrollTop = AppState.backupScroll;
    if (catalogTab) catalogTab.classList.remove('active');torrentsTab.classList.remove('active');
    var detailView = getEl('detail-view');
    if (typeof Animations !== 'undefined' && typeof Animations.ensureDetailVisible === 'function') {


      Animations.ensureDetailVisible();
    } else if (detailView && detailView.style.display !== 'block') {detailView.style.display = 'block';detailView.style.zIndex = '100';detailView.style.pointerEvents = 'auto';}










    var detailTitleEl = getEl('detail-title-text');
    var navItem = navEntry && navEntry.screen === 'detail' && navEntry.data && navEntry.data.item;
    var underTorrent = navEntry && navEntry.screen === 'torrent-detail';
    var restoreItem = navItem || AppState.pendingDetailItem || AppState.androidBackCatalog || AppState.currentDetailItem;
    var shownItem = AppState.currentDetailItem;
    var detailGutted = !!(!underTorrent && restoreItem && restoreItem.id &&
    typeof window.showCatalogDetail === 'function' && (
    isTorrentDetailMode() ||
    detailTitleEl && !String(detailTitleEl.textContent || '').trim() ||
    navItem && (!shownItem || String(shownItem.id) !== String(navItem.id))));

    var focusDetailWatch = function () {
      if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
        updateFocusableElements();var watchBtn = getEl('catalog-watch-btn');if (watchBtn) {for (var i = 0; i < focusableElements.length; i++) {if (focusableElements[i].id === 'catalog-watch-btn') {setFocus(i);return;}}}
      }
      if (typeof window.ensureCatalogDetailFocus === 'function') window.ensureCatalogDetailFocus(true);
    };
    if (detailGutted) {


      var redraw = navItem ?
      window.showCatalogDetail(navItem, navEntry.data.index || 0, null) :
      window.showCatalogDetail(restoreItem, AppState.catalogIndex || 0, AppState.catalogPu || null);
      Promise.resolve(redraw).then(function () {
        if (AppState.currentScreen === 'detail') setTimeout(focusDetailWatch, 100);
      });
    } else {
      setTimeout(focusDetailWatch, 100);
    }
  } else if (returnTo === 'catalog') {

    var favTab = getEl('tab-favorites');
    var favFromTopbar = !!(favTab && typeof catalogState !== 'undefined' && catalogState.favoritesFromTopbar);
    if (favFromTopbar) favTab.classList.add('active');else
    if (catalogTab) catalogTab.classList.add('active');
    torrentsTab.classList.remove('active');AppState.currentScreen = 'catalog';
    setTimeout(function () {



      var done = false;
      if (typeof window.focusCatalogCardByIndex === 'function') {
        var savedIndex = localStorage.getItem('lastCatalogCardIndex');
        done = window.focusCatalogCardByIndex(parseInt(savedIndex || 0, 10));
      }
      if (!done && typeof window.focusFirstCatalogCard === 'function') window.focusFirstCatalogCard();
    }, 80);
  } else if (returnTo === 'home' && window.HomeScreen) {



    if (catalogTab) catalogTab.classList.remove('active');torrentsTab.classList.remove('active');
    window.HomeScreen.show({ restoreFocus: true });
  } else {
    torrentsTab.classList.add('active');if (catalogTab) catalogTab.classList.remove('active');AppState.currentScreen = 'torrents';
    setTimeout(function () {
      if (typeof window.focusFirstTorrentCard === 'function' && window.focusFirstTorrentCard()) return;
      if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
        updateFocusableElements();for (var i = 0; i < focusableElements.length; i++) {if (focusableElements[i].classList && focusableElements[i].classList.contains('torrent-card')) {setFocus(i);return;}}setFocus(0);
      }
    }, 80);
  }
  if (searchInput && document.activeElement === searchInput) searchInput.blur();
}








var lastCardSearchKey = null;
function resetFiltersForCardSearch(key) {
  if (key && key === lastCardSearchKey) return;
  lastCardSearchKey = key || null;
  currentTrackerFilter = 'all';currentYearFilter = '';currentSeasonFilter = 'all';currentVoiceFilter = 'all';
  applySearchFilterDefaults();
  syncSearchFilterButtons();
  ['filter-year', 'filter-season', 'filter-voice'].forEach(function (id) {var el = getEl(id);if (el) el.value = 'all';});
}
window.resetFiltersForCardSearch = resetFiltersForCardSearch;


function resetFilters() {
  currentTrackerFilter = 'all';currentYearFilter = '';currentSeasonFilter = 'all';currentVoiceFilter = 'all';
  applySearchFilterDefaults();
  syncSearchFilterButtons();
  ['filter-year', 'filter-season', 'filter-voice'].forEach((id) => {var el = getEl(id);if (el) el.value = 'all';});
  applyFiltersAndSort();
}function

dropTorrentToServer(_x23) {return _dropTorrentToServer.apply(this, arguments);}function _dropTorrentToServer() {_dropTorrentToServer = _asyncToGenerator(function* (hash) {
    if (!(yield ensureTorrserverOnline())) return null;
    try {
      var response = yield torrServerFetch('/torrents', { method: 'POST', body: JSON.stringify({ action: 'drop', hash: hash }) });
      if (!response.ok) throw new Error('Ошибка остановки: ' + response.status);
      return true;
    } catch (error) {console.error('Ошибка остановки торрента:', error);throw error;}
  });return _dropTorrentToServer.apply(this, arguments);}
window.dropTorrentToServer = dropTorrentToServer;













function dropOpenTorrentDetail() {
  var it = AppState.currentDetailItem;
  var dv = getEl('detail-view');

  if (!it || !it.hash || dv && dv.classList.contains('catalog-detail-mode')) return;
  var hash = it.hash;
  if (typeof abortPendingPreload === 'function') abortPendingPreload();


  torrServerFetch('/torrents', { method: 'POST', body: JSON.stringify({ action: 'drop', hash: hash }) }).
  then(function (r) {if (r && r.ok) markTorrentStopped(hash);})['catch'](function () {});
}
window.dropOpenTorrentDetail = dropOpenTorrentDetail;





function markTorrentStopped(hash) {
  var h = String(hash).toLowerCase();
  var list = AppState.torrents || [];
  var torrent = null;
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].hash || '').toLowerCase() === h) {torrent = list[i];break;}
  }
  if (!torrent) return;
  torrent.stat_string = 'Torrent in db';
  var cards = document.querySelectorAll('.torrent-card[data-hash]');
  for (var j = 0; j < cards.length; j++) {
    if (String(cards[j].dataset.hash).toLowerCase() !== h) continue;
    var playing = cards[j].querySelector('.torrent-playing');
    if (!playing) continue;
    var size = document.createElement('span');
    size.className = 'torrent-size';
    size.textContent = formatBytes(torrent.torrent_size);
    playing.parentNode.replaceChild(size, playing);
  }
}function

addTorrentToServer(_x24, _x25, _x26) {return _addTorrentToServer.apply(this, arguments);}function _addTorrentToServer() {_addTorrentToServer = _asyncToGenerator(function* (magnet, hash, searchResult, options = {}) {
    var refreshList = options.refreshList !== false;
    if (!(yield ensureTorrserverOnline())) return null;
    var ctx = getCatalogSearchContext(searchResult);
    var poster = options.poster || ctx.poster || null;
    var tmdbId = options.tmdbId || ctx.id || null;
    var mediaType = options.mediaType || ctx.mediaType || AppState.mediaType || 'movie';
    var seasons = [];

    if (searchResult && Array.isArray(searchResult.seasons)) {
      seasons = searchResult.seasons.slice();
    }
    if (!seasons.length && searchResult && searchResult.title) {
      seasons = extractSeasonsFromTitle(searchResult.title);
    }
    if (!seasons.length && ctx.item && (ctx.item.title || ctx.item.name)) {
      seasons = extractSeasonsFromTitle(ctx.item.title || ctx.item.name);
    }

    var baseName =
    ctx.item && (ctx.item.title || ctx.item.name) ||
    searchResult && (searchResult.name || searchResult.title) ||
    'Без названия';
    AppState.mediaType = mediaType;
    var torrname = (tmdbId ? '[' + tmdbId + '] ' : '') + baseName;

    if (mediaType === 'tv' && seasons.length > 0) {
      torrname += ' [сезон ' + (
      seasons.length > 1 ? seasons[0] + '-' + seasons[seasons.length - 1] : seasons[0]) +
      ']';
    }

    var requestBody = {
      action: 'add',
      link: magnet,
      title: torrname,
      category: mediaType,



      save_to_db: options.saveToDb === true ? true : AppState.addToDbEnabled
    };

    if (poster) {

      requestBody.poster = replaceTmdbWithProxy(poster);
    }

    try {
      var response = yield torrServerFetch('/torrents', {
        method: 'POST',
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error('Ошибка добавления: ' + response.status);
      }

      var hashLower = hash ? String(hash).toLowerCase() : null;
      if (hashLower) {
        knownTorrentMeta.set(hashLower, {
          id: tmdbId,
          mediaType: mediaType,
          poster: requestBody.poster,
          title: torrname
        });
      }

      if (
      window.AndroidJS && !AppState.isCatalogSerials ||
      AppState.transcodingFullOnOff && !AppState.isCatalogSerials)
      {
        return true;
      }

      yield response.json();
      window.pendingCatalogPoster = null;
      window.pendingCatalogItem = null;
      lastAddedTorrentHash = hashLower;

      if (refreshList) {
        yield refreshTorrentsList();
        var found = AppState.torrents.find(function (t) {
          return t.hash && t.hash.toLowerCase() === hashLower;
        });
        if (found) {
          found.poster = found.poster || requestBody.poster;
          found.tmdbId = found.tmdbId || tmdbId;
          found.media_type = found.media_type || mediaType;
          knownTorrentMeta.set(found.hash.toLowerCase(), {
            id: tmdbId,
            mediaType: mediaType,
            poster: requestBody.poster,
            title: found.title
          });
        }
        return found || true;
      }
      return true;
    } catch (error) {
      console.error('❌ Ошибка добавления торрента:', error);
      alert('Ошибка при добавлении торрента: ' + error.message);
      window.pendingCatalogPoster = null;
      window.pendingCatalogItem = null;
      return null;
    }
  });return _addTorrentToServer.apply(this, arguments);}

window.addTorrentSearchToServer = function (magnet, hash, searchResult) {return addTorrentToServer(magnet, hash, searchResult, { refreshList: false, saveToDb: true });};function

refreshTorrentsList() {return _refreshTorrentsList.apply(this, arguments);}function _refreshTorrentsList() {_refreshTorrentsList = _asyncToGenerator(function* () {
    var focusedCard = document.querySelector('.torrent-card.focused');
    var preserveHash = focusedCard && focusedCard.dataset.hash || window.lastSelectedTorrentHash || null;
    var preserveIndex = typeof window.lastSelectedTorrentIndex === 'number' ? window.lastSelectedTorrentIndex : 0;
    try {
      var response = yield torrServerFetch('/torrents', { method: 'POST', body: JSON.stringify({ action: 'list' }) });
      if (response.ok) {
        var data = yield response.json();
        AppState.torrents = Array.isArray(data) ? data : [];
        if (!window.AndroidJS || !AppState.transcodingFullOnOff || !AppState.isCatalogSearch || AppState.isCatalogSerials) renderTorrents();
        if (!window.AndroidJS && !AppState.transcodingFullOnOff && !AppState.playFromHash && AppState.currentScreen === 'torrents') {
          setTimeout(function () {
            if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
              updateFocusableElements();
              var targetIndex = -1;
              for (var i = 0; i < focusableElements.length; i++) {if (focusableElements[i].classList && focusableElements[i].classList.contains('torrent-card') && preserveHash && focusableElements[i].dataset.hash === preserveHash) {targetIndex = i;break;}}
              if (targetIndex === -1) {var cards = focusableElements.filter((el) => el.classList && el.classList.contains('torrent-card'));if (cards[preserveIndex]) targetIndex = focusableElements.indexOf(cards[preserveIndex]);}
              if (targetIndex === -1) {for (var l = 0; l < focusableElements.length; l++) {if (focusableElements[l].classList && focusableElements[l].classList.contains('torrent-card')) {targetIndex = l;break;}}}
              if (targetIndex !== -1) setFocus(targetIndex);
            }
          }, 80);
        }
        return true;
      }
    } catch (error) {console.error('Ошибка обновления списка:', error);}
    return false;
  });return _refreshTorrentsList.apply(this, arguments);}
window.refreshTorrentsList = refreshTorrentsList;function















ensureTorrserverOnline() {return _ensureTorrserverOnline.apply(this, arguments);}function _ensureTorrserverOnline() {_ensureTorrserverOnline = _asyncToGenerator(function* () {
    var banner = typeof window.showErrorBanner === 'function' ? window.showErrorBanner : null;

    if (!AppState.currentTorrserverUrl) {
      if (banner) banner('TorrServer не подключён', 'Укажите адрес сервера в настройках');else
      alert('Сначала подключитесь к TorrServer');
      return false;
    }

    if (AppState.serverOnline) return true;

    var ok = false;
    try {ok = yield checkServer(false);} catch (e) {ok = false;}

    if (!ok) {
      if (banner) banner('TorrServer недоступен',
      'Не отвечает ' + AppState.currentTorrserverUrl + '. Проверьте, запущен ли сервер.');else
      alert('TorrServer недоступен');
      return false;
    }
    return true;
  });return _ensureTorrserverOnline.apply(this, arguments);}
window.ensureTorrserverOnline = ensureTorrserverOnline;function

playFromHash(_x27, _x28) {return _playFromHash.apply(this, arguments);}function _playFromHash() {_playFromHash = _asyncToGenerator(function* (hash, magnet, searchResult = null) {
    if (!hash) {
      if (typeof window.showErrorBanner === 'function') window.showErrorBanner('Не удалось открыть раздачу', 'В результате поиска нет hash');else
      alert('Ошибка: hash не найден');
      return;
    }
    if (!(yield ensureTorrserverOnline())) return;
    AppState.androidBackCatalog = AppState.currentDetailItem;
    if (window.addToWatchHistory && AppState.pendingDetailItem && AppState.pendingDetailItem.id) {
      yield window.addToWatchHistory(String(AppState.pendingDetailItem.id), currentSearchQuery, AppState.pendingDetailItem.media_type, AppState.pendingDetailPoster || null);
    }
    getEl('playback-overlay').classList.add('active');document.querySelector('.playback-text').textContent = 'Поиск постера и добавление...';
    try {
      var ctx = getCatalogSearchContext(searchResult);

      AppState.pendingDetailPoster = ctx.poster;
      window.pendingCatalogPoster = ctx.poster;
      AppState.pendingDetailTmdbId = ctx.id;
      AppState.pendingDetailMediaType = ctx.mediaType;

      var isSerial =
      ctx.mediaType === 'tv' ||
      AppState.mediaType === 'tv' ||
      searchResult && searchResult.types && Array.isArray(searchResult.types) && (
      searchResult.types.indexOf('tv') !== -1 || searchResult.types.indexOf('serial') !== -1) ||
      searchResult && Array.isArray(searchResult.seasons) && searchResult.seasons.length > 0;

      if (isSerial) AppState.isCatalogSerials = true;
      AppState.isCatalogSearch = true;

      var addedTorrent = yield addTorrentToServer(magnet, hash, searchResult, {
        poster: ctx.poster,
        tmdbId: ctx.id,
        mediaType: ctx.mediaType
      });

      if (!addedTorrent || addedTorrent === true) {
        yield refreshTorrentsList();
        addedTorrent = AppState.torrents.find(function (t) {
          return (t.hash || '').toLowerCase() === hash.toLowerCase();
        });
      }

      if (addedTorrent && typeof addedTorrent === 'object') {
        addedTorrent.poster = addedTorrent.poster || ctx.poster;
        addedTorrent.tmdbId = addedTorrent.tmdbId || ctx.id;
        addedTorrent.media_type = addedTorrent.media_type || ctx.mediaType;

        knownTorrentMeta.set(hash.toLowerCase(), {
          id: ctx.id,
          mediaType: ctx.mediaType,
          poster: ctx.poster,
          title: addedTorrent.title
        });
      }
      if (!window.AndroidJS || !AppState.transcodingFullOnOff) {AppState.currentDetailItem = addedTorrent;}
      if (!isSerial) {
        var fileId = 1;


        var restoreSearchAfterFailedStart = function (searchOverlay) {
          if (AppState.currentScreen === 'player') return;
          AppState.playFromHash = false;
          AppState.currentScreen = 'search';
          if (searchOverlay) searchOverlay.classList.remove('hidden');
          setTimeout(function () {if (typeof window.focusSearchHome === 'function') window.focusSearchHome();}, 80);
        };
        if (window.AndroidJS) {
          getEl('playback-overlay').classList.remove('active');



          if (AppState.preloadBeforePlay && typeof runPlaybackPreload === 'function' &&
          !(yield runPlaybackPreload(hash, fileId, addedTorrent.title))) return false;
          var playURL = AppState.currentTorrserverUrl + "/stream?link=" + hash + "&index=" + fileId + "&play=play";



          window.openAndroidPlayer(playURL, {
            url: playURL, title: addedTorrent.title || 'Видео', iptv: false, timecode: 0,
            timeline: { hash: hash + '_' + fileId, time: 0, duration: 0, percent: 0 },
            poster: addedTorrent.poster || null,
            id: addedTorrent.tmdbId || null,
            type: addedTorrent.media_type || (isSerial ? 'tv' : 'movie')
          });
          return true;
        }
        if (AppState.transcodingFullOnOff) {
          getEl('playback-overlay').classList.remove('active');
          var playURL = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;
          var searchOverlay = getEl('search-overlay');
          if (searchOverlay) searchOverlay.classList.add('hidden');
          if (!(yield startHLSPlayback(playURL, null, true, fileId))) restoreSearchAfterFailedStart(searchOverlay);
          return true;
        }
        var playbackTarget = getPreferredPlaybackFile(addedTorrent, searchResult);
        fileId = playbackTarget.fileId || 1;
        document.querySelector('.playback-text').textContent = 'Воспроизведение...';
        var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;





        var searchOverlay = getEl('search-overlay');
        if (searchOverlay) searchOverlay.classList.add('hidden');
        var started = yield startHLSPlayback(playUrl, null, true, playbackTarget.episodeIndex);

        if (!started) restoreSearchAfterFailedStart(searchOverlay);
      } else {
        AppState.currentDetailItem = addedTorrent;AppState.isCatalogSerials = true;





        var searchOverlay = getEl('search-overlay');
        if (searchOverlay) searchOverlay.classList.add('hidden');



        if (AppState.androidBackCatalog && AppState.androidBackCatalog.id) AppState.inSearch = "catalog";
        showDetail(addedTorrent);
      }
    } catch (error) {
      console.error('❌ Ошибка воспроизведения:', error);

      if (typeof window.showErrorBanner === 'function') {
        window.showErrorBanner('Не удалось начать воспроизведение', error.message);
      } else alert('Ошибка воспроизведения: ' + error.message);
    } finally
    {getEl('playback-overlay').classList.remove('active');document.querySelector('.playback-text').textContent = 'Воспроизведение...';}
  });return _playFromHash.apply(this, arguments);}
window.playFromHash = playFromHash;

function clearSearchResults() {
  searchResults = [];filteredResults = [];currentSearchQuery = '';availableTrackers = [];
  currentTrackerFilter = 'all';currentSeasonFilter = 'all';currentVoiceFilter = 'all';


  applySearchFilterDefaults('videotype');
  syncSearchFilterButtons();
}
window.clearSearchResults = clearSearchResults;

var QUALITY_LABELS = [
{ min: 2160, label: '4K' },
{ min: 1080, label: 'FHD' },
{ min: 720, label: 'HD' },
{ min: 0, label: 'SD' }];



function qualityLabel(quality) {
  for (var i = 0; i < QUALITY_LABELS.length; i++) {
    if (quality >= QUALITY_LABELS[i].min) return QUALITY_LABELS[i].label;
  }
  return '';
}

function formatBitrate(bps) {
  if (!bps || bps <= 0) return '';
  return (bps / 1000000).toFixed(2).replace('.', ',') + ' Мбит/с';
}

function mediaChip(text, extraClass) {
  return '<div class="search-result-media' + (extraClass ? ' ' + extraClass : '') + '">' +
  escapeHtml(text) + '</div>';
}












function buildMediaRow(result) {
  var media = result.media;
  var chips = '';

  var label = qualityLabel(result.quality || 0);
  if (label) chips += mediaChip(label, 'search-result-media-tag');
  if (result.videotype === 'hdr') chips += mediaChip('HDR', 'search-result-media-tag');

  if (media) {
    if (media.w && media.h) chips += mediaChip(media.w + '×' + media.h);
    if (media.vcodec) chips += mediaChip(FFPROBE_VIDEO_NAMES[media.vcodec] || media.vcodec.toUpperCase());

    var bitrate = formatBitrate(media.bitrate);
    if (bitrate) chips += mediaChip(bitrate);
    if (media.layout) chips += mediaChip(media.layout);

    for (var i = 0; i < media.audio.length; i++) {
      var track = media.audio[i];
      var name = track.lang ? track.lang.toUpperCase() : '';
      if (track.title) name += (name ? ' · ' : '') + track.title;
      if (name) chips += mediaChip('♪ ' + name);
    }
    if (media.moreAudio > 0) chips += mediaChip('♪ +' + media.moreAudio);

    if (media.subs.length) {
      chips += mediaChip('СТ ' + media.subs.join(', ').toUpperCase());
    }
  }

  if (!chips) return '';
  return '<div class="search-result-media-row">' + chips + '</div>';
}

function buildSearchResultMarkup(result, index) {
  var voices = Array.isArray(result.voices) ? result.voices : [];
  var hash = extractHashFromMagnet(result.magnet);
  var trackerDisplay = result.tracker || 'Unknown';


  var hasAudioTracks = !!(result.media && result.media.audio && result.media.audio.length);

  return '<div class="search-result-item" data-index="' + index + '">' +
  '<div class="search-result-info">' +
  '<div class="search-result-title">' + escapeHtml(result.title || 'Без названия') + '</div>' +
  buildMediaRow(result) +
  '<div class="search-result-meta">' +
  '<div class="search-result-meta-item">' + escapeHtml(trackerDisplay) + '</div>' +
  '<div class="search-result-meta-item">' + escapeHtml(result.sizeName || formatBytes(result.size)) + '</div>' +
  '<div class="search-result-meta-item">' + (result.released || 'N/A') + ' (' + (result.createTime ? new Date(result.createTime).toLocaleDateString() : 'N/A') + ')</div>' +
  '<div class="search-result-meta-item">' + (result.types && result.types.indexOf('tv') !== -1 ? 'Сериал' : 'Фильм') + ' / ' + (result.quality || 'N/A') + 'p</div>' +
  '<div class="search-result-meta-item">сиды: ' + (result.sid !== undefined ? result.sid : 0) + '</div>' +
  '<div class="search-result-meta-item">пиры: ' + (result.pir !== undefined ? result.pir : 0) + '</div>' +
  '</div>' + (
  voices.length > 0 && !hasAudioTracks ? '<div class="search-result-voices">' + voices.map(function (voice) {return '<span class="search-result-voice">' + escapeHtml(voice) + '</span>';}).join('') + '</div>' : '') +
  '</div>' +
  '<button class="search-result-play" data-hash="' + hash + '" data-magnet="' + escapeAttr(result.magnet) + '" data-index="' + index + '" ' + (!hash ? 'disabled' : '') + '>' + (hash ? '▶' : '❌ Нет hash') + '</button>' +
  '</div>';
}





















var SEARCH_OFFSCREEN_CLASS = 'search-offscreen';
var SEARCH_VISIBILITY_WINDOW_ROWS = 5;
var SEARCH_VISIBILITY_FALLBACK_MARGIN_PX = 700;
var searchVisibilityObserver = null;

function createSearchVisibilityObserver(container, marginPx) {
  return new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {




      if (!entries[i].boundingClientRect.height) continue;
      if (entries[i].isIntersecting) entries[i].target.classList.remove(SEARCH_OFFSCREEN_CLASS);else
      entries[i].target.classList.add(SEARCH_OFFSCREEN_CLASS);
    }
  }, {
    root: container,
    rootMargin: marginPx + 'px 0px',
    threshold: 0
  });
}


function observeSearchResultItems(container) {
  if (!container || !('IntersectionObserver' in window)) return;
  var items = container.querySelectorAll('.search-result-item');
  if (!items.length) return;

  if (!searchVisibilityObserver) {


    var h = items[0].offsetHeight;
    var margin = h ? Math.round(h * SEARCH_VISIBILITY_WINDOW_ROWS) :
    SEARCH_VISIBILITY_FALLBACK_MARGIN_PX;
    searchVisibilityObserver = createSearchVisibilityObserver(container, margin);
  }

  for (var i = 0; i < items.length; i++) {
    if (items[i].dataset.visObserved === '1') continue;
    items[i].dataset.visObserved = '1';
    searchVisibilityObserver.observe(items[i]);
  }
}





function resetSearchVisibilityWindow() {
  if (!searchVisibilityObserver) return;
  searchVisibilityObserver.disconnect();
  searchVisibilityObserver = null;
}







function revealSearchResultItem(el) {
  if (!el || !el.classList) return;
  el.classList.remove(SEARCH_OFFSCREEN_CLASS);
}
window.revealSearchResultItem = revealSearchResultItem;


function renderSearchResults() {
  var searchResultsDiv = getEl('search-results');
  if (!searchResultsDiv) return;
  var renderId = (searchResultsDiv._renderId || 0) + 1;
  searchResultsDiv._renderId = renderId;

  resetSearchVisibilityWindow();


  releaseGlobalPosters();

  if (filteredResults.length === 0) {
    searchResultsDiv.innerHTML = '<div class="filter-stats">Всего найдено: <span>' + searchResults.length + '</span></div><div class="search-result-empty">' + (currentSearchQuery ? 'Нет результатов по фильтрам для "' + escapeHtml(currentSearchQuery) + '"' : 'Введите запрос для поиска') + '</div>';
    return;
  }

  searchResultsDiv.innerHTML = '<div class="filter-stats">Показано: <span>' + filteredResults.length + '</span> из <span>' + searchResults.length + '</span></div>';
  searchResultsDiv.onclick = function (event) {
    var playBtn = event.target.closest('.search-result-play');
    if (playBtn && !playBtn.disabled) {
      event.stopPropagation();
      var hash = playBtn.dataset.hash;
      var index = parseInt(playBtn.dataset.index, 10);
      var sourceResult = !isNaN(index) ? filteredResults[index] : null;
      var searchResult = sourceResult;
      if (sourceResult && window.pendingCatalogPoster) {
        searchResult = {};
        for (var key in sourceResult) {
          if (sourceResult.hasOwnProperty(key)) searchResult[key] = sourceResult[key];
        }
        searchResult.poster = window.pendingCatalogPoster;
      }
      if (hash) {



        AppState.playFromHash = true;
        AppState.lastSearchResultHash = hash;
        playFromHash(hash, playBtn.dataset.magnet, searchResult);
      }
      return;
    }
    var item = event.target.closest('.search-result-item');
    if (item) {
      var button = item.querySelector('.search-result-play');
      if (button && !button.disabled) button.click();
    }
  };

  var index = 0;







  var FIRST_CHUNK_SIZE = 15;
  var CHUNK_SIZE = 15;

  function scheduleNextChunk() {
    if (typeof window.requestIdleCallback === 'function') {

      window.requestIdleCallback(function () {renderChunk();}, { timeout: 400 });
    } else {
      setTimeout(renderChunk, 16);
    }
  }

  function renderChunk() {
    if (searchResultsDiv._renderId !== renderId) return;















    if (window.navHold) {setTimeout(renderChunk, 120);return;}

    var html = '';
    var end = Math.min(index + (index === 0 ? FIRST_CHUNK_SIZE : CHUNK_SIZE), filteredResults.length);
    for (; index < end; index++) html += buildSearchResultMarkup(filteredResults[index], index);
    searchResultsDiv.insertAdjacentHTML('beforeend', html);

    observeSearchResultItems(searchResultsDiv);



    if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
    if (index < filteredResults.length) scheduleNextChunk();
  }
  requestAnimationFrame(renderChunk);
}

function extractHashFromMagnet(magnet) {
  if (!magnet) return null;
  var match = magnet.match(/xt=urn:btih:([a-fA-F0-9]{40})/i);
  if (match && match[1]) return match[1].toLowerCase();
  var altMatch = magnet.match(/[a-fA-F0-9]{40}/);
  if (altMatch) return altMatch[0].toLowerCase();
  return null;
}

function getCurrentSearchMode() {
  var modeSelect = getEl('torrent-movie');if (modeSelect) currentSearchMode = modeSelect.value;return currentSearchMode;
}function

searchTMDB(_x29) {return _searchTMDB.apply(this, arguments);}function _searchTMDB() {_searchTMDB = _asyncToGenerator(function* (query) {
    if (!query || !query.trim()) {alert('Введите поисковый запрос');return;}
    if (tmdbSearchController) tmdbSearchController.abort();
    tmdbSearchController = new AbortController();
    var controller = tmdbSearchController;
    var searchSequence = ++tmdbSearchSequence;
    showLoading('Поиск в TMDB...');
    try {
      var encodedQuery = encodeURIComponent(query.trim());


      var allResults = null;
      var combined = yield fetch('/api/tmdb/search/all?query=' + encodedQuery, { signal: controller.signal });
      if (searchSequence !== tmdbSearchSequence) return;
      if (combined.ok) {
        var combinedData = yield combined.json();
        if (combinedData && Array.isArray(combinedData.results)) allResults = combinedData.results;
      }


      if (allResults === null && combined.status === 404) {
        allResults = yield searchTMDBLegacy(encodedQuery, controller.signal);
        if (searchSequence !== tmdbSearchSequence) return;
      }
      if (allResults === null) throw new Error('TMDB: HTTP ' + combined.status);
      for (var ri = 0; ri < allResults.length; ri++) allResults[ri].searchQuery = query;
      globalSearchResults = allResults;currentSearchQuery = query;


      if (window.Nav) {var navSearch = Nav.top();if (navSearch && navSearch.screen === 'search') {navSearch.data.tmdb = true;navSearch.data.query = query;navSearch.data.label = query;}}
      if (currentSearchMode === 'globalsearch') showContentTypeFilter();
      showGlobalSearchResults();
    } catch (error) {
      if (!error || error.name !== 'AbortError') {
        console.error('Ошибка поиска в TMDB:', error);
        alert('Ошибка при поиске: ' + error.message);
      }
    } finally {
      if (searchSequence === tmdbSearchSequence) hideLoading();
    }
  });return _searchTMDB.apply(this, arguments);}function





searchTMDBLegacy(_x30, _x31) {return _searchTMDBLegacy.apply(this, arguments);}function _searchTMDBLegacy() {_searchTMDBLegacy = _asyncToGenerator(function* (encodedQuery, signal) {
    var responses = yield Promise.all([
    fetch('/api/tmdb/search?query=' + encodedQuery + '&type=movie&year=', { signal: signal }),
    fetch('/api/tmdb/search?query=' + encodedQuery + '&type=tv&year=', { signal: signal })]
    );
    var all = [];
    if (responses[0] && responses[0].ok) {
      var moviesData = yield responses[0].json();
      if (moviesData.results) moviesData.results.forEach(function (item) {all.push({ id: item.id, media_type: 'movie', title: item.title, name: item.title, release_date: item.release_date, vote_average: item.vote_average, vote_count: item.vote_count, overview: item.overview, poster_path: item.poster_path, backdrop_path: item.backdrop_path });});
    }
    if (responses[1] && responses[1].ok) {
      var tvData = yield responses[1].json();
      if (tvData.results) tvData.results.forEach(function (item) {all.push({ id: item.id, media_type: 'tv', title: item.name, name: item.name, first_air_date: item.first_air_date, vote_average: item.vote_average, vote_count: item.vote_count, overview: item.overview, poster_path: item.poster_path, backdrop_path: item.backdrop_path });});
    }
    all.sort(function (a, b) {return (b.vote_average || 0) - (a.vote_average || 0) || (b.vote_count || 0) - (a.vote_count || 0);});
    return all;
  });return _searchTMDBLegacy.apply(this, arguments);}

function getRatingColor(rating) {if (rating >= 8) return '#4caf50';if (rating >= 6) return '#ffc107';if (rating >= 4) return '#ff9800';return '#f44336';}

function showGlobalSearchResults() {renderFilteredGlobalResults(globalSearchResults);}









function restoreSearchEntry(entry) {
  var d = entry && entry.data;
  if (!d || !d.tmdb || !globalSearchResults.length) return false;
  if (document.querySelector('#search-results .global-search-card')) return false;
  setSearchLocked(false);
  if (typeof window.clearCatalogSearchContext === 'function') window.clearCatalogSearchContext();
  var modeSelect = getEl('torrent-movie');if (modeSelect) modeSelect.value = 'globalsearch';
  currentSearchMode = 'globalsearch';
  var searchInput = getEl('search-query');if (searchInput && d.query) searchInput.value = d.query;
  if (d.query) currentSearchQuery = d.query;
  showGlobalSearchResults();
  return true;
}
window.restoreSearchEntry = restoreSearchEntry;











var globalPosterObserver = null;

function releaseGlobalPosters() {
  if (!globalPosterObserver) return;
  try {globalPosterObserver.disconnect();} catch (e) {}
  globalPosterObserver = null;
}
window.releaseGlobalPosters = releaseGlobalPosters;

function renderFilteredGlobalResults(results) {
  var searchResultsDiv = getEl('search-results');
  var searchOverlay = getEl('search-overlay');
  if (!searchResultsDiv) return;
  if (searchOverlay) searchOverlay.classList.remove('hidden');

  releaseGlobalPosters();

  if (results.length === 0) {
    searchResultsDiv.innerHTML = '<div class="filter-stats">Всего найдено: <span>0</span></div><div class="search-result-empty">' + (currentSearchQuery ? 'Ничего не найдено для "' + escapeHtml(currentSearchQuery) + '" в TMDB' : 'Введите запрос для поиска') + '</div>';
    return;
  }


  var limit = Math.min(results.length, 40);
  resetSearchVisibilityWindow();
  searchResultsDiv.innerHTML = '';

  var statsDiv = document.createElement('div');
  statsDiv.className = 'filter-stats';
  statsDiv.innerHTML = 'Найдено в TMDB: <span>' + results.length + '</span>' + (results.length > limit ? ' (показано ' + limit + ')' : '');
  searchResultsDiv.appendChild(statsDiv);


















  var grid = document.createElement('div');
  grid.className = 'global-search-grid';

  var fragment = document.createDocumentFragment();

  for (var idx = 0; idx < limit; idx++) {
    var result = results[idx];
    var title = result.title || result.name || 'Без названия';
    var date = String(result.release_date || result.first_air_date || '');
    var year = /^\d{4}/.test(date) ? date.substring(0, 4) : '';
    var mt = result.media_type === 'tv' ? 'tv' : 'movie';

    var rating = result.vote_average ? Math.round(result.vote_average * 10) / 10 : null;

    var card = createCardElement({
      className: 'global-search-card',
      dataset: {
        tmdbId: result.id,
        mediaType: mt,
        title: title,
        rating: rating || '',
        posterPath: result.poster_path || ''
      },
      title: title.substring(0, 60) + (title.length > 60 ? '...' : ''),
      ratingText: rating || '',
      ratingColor: rating ? getRatingColor(rating) : '',
      metaType: mt === 'tv' ? 'Сериал' : 'Фильм',
      metaBadge: year
    });

    if (!result.poster_path) {



      var ph = card.querySelector('.no-poster');
      if (ph) {
        ph.classList.remove('catalog-poster-loading');
        ph.textContent = 'Нет постера';
      }
    }
    fragment.appendChild(card);
  }

  grid.appendChild(fragment);
  searchResultsDiv.appendChild(grid);



  if (typeof invalidateFocusCache === 'function') invalidateFocusCache();


  if (typeof invalidateColumnsCache === 'function') invalidateColumnsCache();


  var loadPoster = function (card) {
    var path = card.dataset.posterPath;
    if (!path || card.dataset.posterRequested === '1') return;
    card.dataset.posterRequested = '1';
    updatePosterDOM(card.querySelector('.torrent-poster'), null, path);
  };
  var postered = grid.querySelectorAll('.global-search-card[data-poster-path]:not([data-poster-path=""])');
  if ('IntersectionObserver' in window) {
    var imageObserver = new IntersectionObserver(function (entries, observer) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        loadPoster(entry.target);
        observer.unobserve(entry.target);
      });
    }, {
      rootMargin: '300px 0px'
    });
    for (var pi = 0; pi < postered.length; pi++) imageObserver.observe(postered[pi]);
    globalPosterObserver = imageObserver;
  } else {

    for (var pj = 0; pj < postered.length; pj++) loadPoster(postered[pj]);
  }


  grid.onclick = function (e) {
    var card = e.target.closest('.global-search-card');
    if (card) {
      var tmdbId = card.dataset.tmdbId;
      var result = results.find(function (r) {return String(r.id) === tmdbId;});
      if (result) showGlobalSearchDetail(result);
    }
  };
}function

showGlobalSearchDetail(_x32) {return _showGlobalSearchDetail.apply(this, arguments);}function _showGlobalSearchDetail() {_showGlobalSearchDetail = _asyncToGenerator(function* (item) {
    var catalogItem = { id: item.id, media_type: item.media_type, title: item.title || item.name, name: item.name || item.title, overview: item.overview, poster_path: item.poster_path, backdrop_path: item.backdrop_path, vote_average: item.vote_average, release_date: item.release_date, first_air_date: item.first_air_date, torrent: [{ name: item.title || item.name }] };
    AppState.mediaType = item.media_type;
    var posterUrl = item.poster_path ? buildTmdbPosterUrl(item.poster_path, 'w342') : null;
    if (typeof window.showCatalogDetail === 'function') {


      AppState.currentScreen = 'detail';


      AppState.detailUnderSearch = false;


      AppState.lastSearchCardKey = item.id + ':' + (item.media_type === 'tv' ? 'tv' : 'movie');






      var hasShade = typeof Animations !== 'undefined' && typeof Animations.raiseDetailShade === 'function';
      if (hasShade) Animations.raiseDetailShade();
      if (window.Nav) Nav.push('detail', Nav.detailData(catalogItem));
      var detailPromise = window.showCatalogDetail(catalogItem, 0, posterUrl);
      var searchOverlay = getEl('search-overlay');if (searchOverlay) searchOverlay.classList.add('hidden');
      try {
        yield detailPromise;
      } catch (e) {
        if (hasShade && typeof Animations.dropDetailShade === 'function') Animations.dropDetailShade();
        throw e;
      }
    }
  });return _showGlobalSearchDetail.apply(this, arguments);}

function showContentTypeFilter() {
  var filterGroup = document.querySelector('.filter-group');if (!filterGroup) return;
  var contentTypeFilter = getEl('filter-content-type');
  if (!contentTypeFilter) {
    var newFilter = document.createElement('div');newFilter.className = 'filter-group';
    newFilter.innerHTML = `<label class="filter-label" for="filter-content-type">Тип контента</label><select id="filter-content-type" class="filter-select"><option value="all">Все</option><option value="movie">Фильмы</option><option value="tv">Сериалы</option></select>`;
    var qualityFilter = getEl('filter-quality');
    if (qualityFilter && qualityFilter.parentNode) qualityFilter.parentNode.parentNode.insertBefore(newFilter, qualityFilter.parentNode.nextSibling);else
    filterGroup.parentNode.appendChild(newFilter);
    getEl('filter-content-type').addEventListener('change', function (e) {filterGlobalSearchByType(e.target.value);});
  }
}

function filterGlobalSearchByType(type) {
  if (!globalSearchResults.length) return;
  var filtered = type === 'all' ? globalSearchResults : globalSearchResults.filter((r) => r.media_type === type);
  renderFilteredGlobalResults(filtered);
}

function clearSearchResultsContainer() {resetSearchVisibilityWindow();var searchResultsDiv = getEl('search-results');if (searchResultsDiv) searchResultsDiv.innerHTML = '';}
window.clearSearchResultsContainer = clearSearchResultsContainer;

function initTorrentDelegations() {
  setupTorrentGridDelegation();
  setupFilePlayButtonDelegation();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTorrentDelegations);
} else {
  initTorrentDelegations();
}
