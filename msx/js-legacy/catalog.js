/* Сборка для старых браузеров (Chrome 53) из js/catalog.js — tools/legacy-build/build.js. Руками не править. */
function asyncGeneratorStep(n, t, e, r, o, a, c) { try { var i = n[a](c), u = i.value; } catch (n) { return void e(n); } i.done ? t(u) : Promise.resolve(u).then(r, o); }
function _asyncToGenerator(n) { return function () { var t = this, e = arguments; return new Promise(function (r, o) { var a = n.apply(t, e); function _next(n) { asyncGeneratorStep(a, r, o, _next, _throw, "next", n); } function _throw(n) { asyncGeneratorStep(a, r, o, _next, _throw, "throw", n); } _next(void 0); }); }; }
var CATALOG_CONSTANTS = {
  CACHE_TTL_MS: 3600000,
  FETCH_TIMEOUT_MS: 5000,
  CATALOG_CACHE_TTL_MS: 3600000,
  ITEMS_PER_PAGE: 50,
  MAX_POSTER_CACHE: 400,
  MAX_DETAIL_HISTORY: 50,
  POSTER_BATCH_SIZE: 15,
  POSTER_DEFERRED_PER_FRAME: 3,
  TMDB_MAX_CACHE_SIZE: 10,
  TMDB_CLEANUP_INTERVAL_MS: 300000,
  MAX_ACTORS: 12,
  MAX_CREW: 3,
  MAX_RECOMMENDATIONS: 12,
  MAX_TRAILERS: 6,
  LOAD_MORE_MARGIN_PX: 300,
  PREFETCH_ROWS: 2,
  POSTER_OBSERVER_MARGIN_PX: 1200,
  ROW_POSTER_MARGIN_X_PX: 400,
  DETAIL_POSTER_MARGIN_PX: 300,
  DETAIL_POSTER_WARM_DELAY_MS: 600,
  DETAIL_POSTER_WARM_BATCH: 3,
  ROW_POSTER_PRELOAD_ROWS: 2,
  PRELOAD_ALL_ROW_POSTERS_ON_START: false,
  GRID_POSTER_PRELOAD_ROWS: 2,
  GRID_PREFETCH_ROWS_AHEAD: 6,
  GRID_PREFETCH_ROWS_AHEAD_HOLD: 12,
  GRID_PREFETCH_ROWS_BEHIND: 2,
  CATALOG_UPDATE_THRESHOLD_HOURS: 6,
  MAX_POSTER_DECODES: 8,
  FOCUS_DELAY_MS: 100,
  ROW_POSTER_CONCURRENCY: 10,
  ROW_POSTER_RETRY_MS: 120,
  POSTER_INSERT_GAP_MS: 16,
  POSTER_MOVING_PER_FRAME: 2,
  POSTER_MOVING_GAP_MS: 0,
  POSTER_LOAD_TIMEOUT_MS: 12000,
  POSTER_DECODE_GRACE_MS: 1500,
  POSTER_FADE_MS: 380,
  POSTER_FADE_QUIET_MS: 1200,
  VISIBILITY_WINDOW_ROWS: 2,
  VISIBILITY_FALLBACK_MARGIN_PX: 800,
  DETAIL_BACKDROP_TRIES: 5,
  DETAIL_BACKDROP_GRACE_MS: 1200,
  IMG_SIZES: {
    POSTER_CARD: 'w342',
    POSTER_SMALL: 'w185',
    POSTER_MEDIUM: 'w342',
    BACKDROP: 'w1280'
  }
};
var mirrors = AppState.imageMirrors;
function pickMirror(path) {
  var h = 0;
  for (var i = 0; i < path.length; i++) {
    h = (h << 5) - h + path.charCodeAt(i) | 0;
  }
  return mirrors[Math.abs(h) % mirrors.length];
}
function getTmdbNextMirrorUrl(url) {
  if (!url || typeof url !== 'string') return null;
  var m = url.match(/^(https?:)\/\/(.+?)(\/t\/p\/.+)$/i);
  if (!m) return null;
  var i = mirrors.indexOf(m[2]);
  if (i === -1) return null;
  return m[1] + '//' + mirrors[(i + 1) % mirrors.length] + m[3];
}
function getTmdbImageUrl(pathOrUrl, size) {
  if (!pathOrUrl || typeof pathOrUrl !== 'string') return pathOrUrl || '';
  var path = null;
  var value = pathOrUrl.trim();
  if (/^https?:\/\//i.test(value)) {
    var match = value.match(/\/t\/p\/[^/]+(\/[^?#]+)(?:[?#].*)?$/i);
    if (!match) return value;
    path = match[1];
  } else {
    path = value.charAt(0) === '/' ? value : '/' + value;
  }
  var mirror = pickMirror(path);
  return getProtocolBase() + '//' + mirror + '/t/p/' + (size || CATALOG_CONSTANTS.IMG_SIZES.POSTER_MEDIUM) + path;
}
function replaceTmdbWithProxy(url) {
  if (!url || typeof url !== 'string' || url.indexOf('image.tmdb.org') === -1) return url;
  return getTmdbImageUrl(url);
}
window.replaceTmdbWithProxy = replaceTmdbWithProxy;
window.getTmdbImageUrl = getTmdbImageUrl;
var CATALOG_CONFIG = {
  movie: {
    name: 'Фильмы',
    url: SERVER_URL + '/api/catalog/movie',
    mediaType: 'movie'
  },
  tv: {
    name: 'Сериалы',
    url: SERVER_URL + '/api/catalog/tv',
    mediaType: 'tv'
  },
  cartoons: {
    name: 'Мультфильмы',
    url: SERVER_URL + '/api/catalog/cartoons',
    mediaType: 'movie'
  },
  cartoons_tv: {
    name: 'Мультсериалы',
    url: SERVER_URL + '/api/catalog/cartoons_tv',
    mediaType: 'tv'
  },
  anime: {
    name: 'Аниме',
    url: SERVER_URL + '/api/catalog/anime',
    mediaType: 'tv'
  },
  rus: {
    name: 'Русские',
    url: SERVER_URL + '/api/rus',
    mediaType: 'movie'
  },
  kp_popular: {
    name: 'Кинопоиск · Популярное',
    url: SERVER_URL + '/api/catalog/kp_popular',
    mediaType: 'movie'
  },
  kp_pop_movies: {
    name: 'Кинопоиск · Популярные фильмы',
    url: SERVER_URL + '/api/catalog/kp_pop_movies',
    mediaType: 'movie'
  },
  kp_pop_series: {
    name: 'Кинопоиск · Популярные сериалы',
    url: SERVER_URL + '/api/catalog/kp_pop_series',
    mediaType: 'tv'
  },
  kp_top250: {
    name: 'Кинопоиск · Топ 250 фильмов',
    url: SERVER_URL + '/api/catalog/kp_top250',
    mediaType: 'movie'
  },
  kp_top250_tv: {
    name: 'Кинопоиск · Топ 250 сериалов',
    url: SERVER_URL + '/api/catalog/kp_top250_tv',
    mediaType: 'tv'
  },
  kp_family: {
    name: 'Кинопоиск · Семейное',
    url: SERVER_URL + '/api/catalog/kp_family',
    mediaType: 'movie'
  },
  kp_comics: {
    name: 'Кинопоиск · Комиксы',
    url: SERVER_URL + '/api/catalog/kp_comics',
    mediaType: 'movie'
  },
  kp_love: {
    name: 'Кинопоиск · Про любовь',
    url: SERVER_URL + '/api/catalog/kp_love',
    mediaType: 'movie'
  },
  quadhd: {
    name: 'Фильмы в 4K',
    url: SERVER_URL + '/api/catalog/quadhd',
    mediaType: 'movie'
  },
  legends: {
    name: 'Лучшие фильмы',
    url: SERVER_URL + '/api/catalog/legends',
    mediaType: 'movie'
  },
  history: {
    name: 'История',
    url: null,
    mediaType: 'history',
    isHistory: true
  },
  favorites: {
    name: 'Избранное',
    url: null,
    mediaType: 'favorites',
    isFavorites: true
  }
};
if (isSeasonActive('halloween')) {
  CATALOG_CONFIG = function (base) {
    var cfg = {
      halloween: {
        name: 'Хэллоуин',
        url: SERVER_URL + '/api/halloween',
        mediaType: 'movie'
      }
    };
    for (var k in base) if (base.hasOwnProperty(k)) cfg[k] = base[k];
    return cfg;
  }(CATALOG_CONFIG);
}
window.catalogRowTotals = window.catalogRowTotals || {};
var TMDB_GENRES = {
  movie: {
    28: 'Боевик',
    12: 'Приключения',
    16: 'Анимация',
    35: 'Комедия',
    80: 'Криминал',
    99: 'Документальный',
    18: 'Драма',
    10751: 'Семейный',
    14: 'Фэнтези',
    36: 'История',
    27: 'Ужасы',
    10402: 'Музыка',
    9648: 'Детектив',
    10749: 'Мелодрама',
    878: 'Фантастика',
    10770: 'ТВ фильм',
    53: 'Триллер',
    10752: 'Военный',
    37: 'Вестерн'
  },
  tv: {
    10759: 'Боевик',
    16: 'Анимация',
    35: 'Комедия',
    80: 'Криминал',
    99: 'Документальный',
    18: 'Драма',
    10751: 'Семейный',
    10762: 'Детский',
    9648: 'Детектив',
    10763: 'Новости',
    10764: 'Реалити',
    10765: 'Фантастика',
    10766: 'Мыльная опера',
    10767: 'Ток-шоу',
    10768: 'Война и политика',
    37: 'Вестерн'
  }
};
var POSTER_URLS = {
  history: 'https://cash94.github.io/msx/img/History.jpg',
  quadhd: 'https://cash94.github.io/msx/img/Films4k.jpg',
  legends: 'https://cash94.github.io/msx/img/BestFilms.jpg',
  cartoons_tv: 'https://cash94.github.io/msx/img/multserials.jpg',
  tv: 'https://cash94.github.io/msx/img/Serials.jpg',
  cartoons: 'https://cash94.github.io/msx/img/multfilms.jpg',
  anime: 'https://cash94.github.io/msx/img/Anime.jpg',
  movie: 'https://cash94.github.io/msx/img/Films.jpg'
};
function LRUCache(maxSize) {
  this.maxSize = maxSize || 100;
  this.cache = new Map();
}
LRUCache.prototype.get = function (key) {
  if (!this.cache.has(key)) return undefined;
  var value = this.cache.get(key);
  this.cache.delete(key);
  this.cache.set(key, value);
  return value;
};
LRUCache.prototype.set = function (key, value) {
  if (this.cache.has(key)) {
    this.cache.delete(key);
  } else if (this.cache.size >= this.maxSize) {
    var firstKey = this.cache.keys().next().value;
    this.cache.delete(firstKey);
  }
  this.cache.set(key, value);
};
LRUCache.prototype.has = function (key) {
  return this.cache.has(key);
};
LRUCache.prototype.delete = function (key) {
  return this.cache.delete(key);
};
LRUCache.prototype.clear = function () {
  this.cache.clear();
};
LRUCache.prototype.size = function () {
  return this.cache.size;
};
function LRUTTLCache(maxSize, ttl) {
  this.maxSize = maxSize > 0 ? maxSize : 100;
  this.ttl = ttl > 0 ? ttl : 0;
  this.cache = new Map();
}
LRUTTLCache.prototype._isExpired = function (entry) {
  if (!entry) return true;
  if (this.ttl <= 0) return false;
  var ts = entry.value && entry.value.timestamp ? entry.value.timestamp : entry.timestamp;
  return Date.now() - ts > this.ttl;
};
LRUTTLCache.prototype.get = function (key) {
  var entry = this.cache.get(key);
  if (!entry) return undefined;
  if (this._isExpired(entry)) {
    this.cache.delete(key);
    return undefined;
  }
  this.cache.delete(key);
  this.cache.set(key, entry);
  return entry.value;
};
LRUTTLCache.prototype.has = function (key) {
  var entry = this.cache.get(key);
  if (!entry) return false;
  if (this._isExpired(entry)) {
    this.cache.delete(key);
    return false;
  }
  return true;
};
LRUTTLCache.prototype.set = function (key, value) {
  if (this.cache.has(key)) {
    this.cache.delete(key);
  } else if (this.cache.size >= this.maxSize) {
    var firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) {
      this.cache.delete(firstKey);
    }
  }
  var now = Date.now();
  var ts = value && value.timestamp ? value.timestamp : now;
  this.cache.set(key, {
    value: value,
    timestamp: ts
  });
};
LRUTTLCache.prototype.delete = function (key) {
  return this.cache.delete(key);
};
LRUTTLCache.prototype.clear = function () {
  this.cache.clear();
};
LRUTTLCache.prototype.size = function () {
  return this.cache.size;
};
LRUTTLCache.prototype.forEach = function (callback, includeExpired) {
  var self = this;
  this.cache.forEach(function (entry, key) {
    if (includeExpired || !self._isExpired(entry)) {
      callback(entry.value, key, entry);
    }
  });
};
LRUTTLCache.prototype.cleanExpired = function () {
  var self = this;
  this.cache.forEach(function (entry, key) {
    if (self._isExpired(entry)) {
      self.cache.delete(key);
    }
  });
};
LRUTTLCache.prototype.trimToMax = function () {
  while (this.cache.size > this.maxSize) {
    var firstKey = this.cache.keys().next().value;
    if (firstKey === undefined) break;
    this.cache.delete(firstKey);
  }
};
function getPosterCardSize() {
  return CATALOG_CONSTANTS.IMG_SIZES.POSTER_CARD || CATALOG_CONSTANTS.IMG_SIZES.POSTER_SMALL || 'w185';
}
function getProtocolBase() {
  var p = window.AppState && AppState.protocol || 'https:';
  p = String(p).replace(/\/+$/, '');
  if (p.indexOf(':') === -1) p += ':';
  return p;
}
function normalizePosterUrl(url) {
  if (!url) return '';
  var size = getPosterCardSize();
  return getTmdbImageUrl(url, size);
}
var rutubeTrailerState = {
  currentUrl: null,
  currentTitle: null,
  bgVideo: null
};
var rutubeTrailerCache = {};
var RUTUBE_TRAILER_CACHE_TTL_MS = 30 * 60 * 1000;
var RUTUBE_TRAILER_CACHE_MAX = 50;
function getCachedRutubeTrailer(key) {
  var e = rutubeTrailerCache[key];
  if (!e || !e.url) return null;
  if (!(Date.now() - e.at <= RUTUBE_TRAILER_CACHE_TTL_MS)) {
    delete rutubeTrailerCache[key];
    return null;
  }
  return e;
}
function putCachedRutubeTrailer(key, url, title) {
  if (!rutubeTrailerCache[key]) {
    var keys = Object.keys(rutubeTrailerCache);
    if (keys.length >= RUTUBE_TRAILER_CACHE_MAX) delete rutubeTrailerCache[keys[0]];
  }
  rutubeTrailerCache[key] = {
    url: url,
    title: title,
    at: Date.now()
  };
}
window.getCachedRutubeTrailer = getCachedRutubeTrailer;
window.putCachedRutubeTrailer = putCachedRutubeTrailer;
function initCatalogDetailButtons() {
  var togBtn = getEl('catalog-toggle-overview-btn');
  if (togBtn && !togBtn._initialized) {
    togBtn._initialized = true;
    togBtn.onclick = function () {
      var dv = getEl('detail-view');
      if (isCinemaCatalogDetail(dv)) {
        openDetailOverviewPopup();
        return;
      }
      var torrentMode = !!(dv && dv.classList.contains('torrent-detail-mode'));
      var target = torrentMode ? getEl('detail-subtitle') : getEl('catalog-detail-overview');
      if (!target) return;
      var exp = target.classList.toggle('expanded');
      togBtn.textContent = exp ? 'Свернуть' : 'Подробнее';
      togBtn.setAttribute('data-label', togBtn.textContent);
    };
  }
  var trailerBtn = getEl('catalog-trailer-btn');
  if (trailerBtn && !trailerBtn._initialized) {
    trailerBtn._initialized = true;
    trailerBtn.onclick = function () {
      if (typeof window.focusEl === 'function') window.focusEl(trailerBtn);
    };
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].attributeName !== 'class') continue;
        var hasFocus = trailerBtn.classList.contains('focused');
        if (hasFocus && rutubeTrailerState.currentUrl) {
          startTrailerBackground(rutubeTrailerState.currentUrl);
        } else if (!hasFocus) {
          stopTrailerBackground();
        }
      }
    });
    observer.observe(trailerBtn, {
      attributes: true,
      attributeFilter: ['class']
    });
    trailerBtn.addEventListener('focus', function () {
      if (rutubeTrailerState.currentUrl) startTrailerBackground(rutubeTrailerState.currentUrl);
    });
    trailerBtn.addEventListener('blur', function () {
      stopTrailerBackground();
    });
  }
}
function isCinemaCatalogDetail(dv) {
  dv = dv || getEl('detail-view');
  return !!(dv && dv.classList.contains('detail-cinema') && dv.classList.contains('catalog-detail-mode') && !dv.classList.contains('torrent-detail-mode'));
}
var detailOverviewPopup = {
  el: null,
  text: null,
  open: false,
  openedAt: 0,
  returnFocus: null
};
function ensureDetailOverviewPopup() {
  if (detailOverviewPopup.el) return detailOverviewPopup.el;
  var el = document.createElement('div');
  el.id = 'detail-overview-popup';
  el.className = 'detail-overview-popup hidden';
  el.innerHTML = '<div class="detail-overview-popup-box">' + '<div class="detail-overview-popup-title"></div>' + '<div class="detail-overview-popup-text"></div>' + '<div class="detail-overview-popup-hint">▲▼ — листать · OK или «Назад» — закрыть</div>' + '</div>';
  el.addEventListener('click', function (e) {
    if (e.target === el) closeDetailOverviewPopup();
  });
  document.body.appendChild(el);
  detailOverviewPopup.el = el;
  detailOverviewPopup.text = el.querySelector('.detail-overview-popup-text');
  window.addEventListener('keydown', onDetailOverviewPopupKey, true);
  return el;
}
function openDetailOverviewPopup() {
  var ov = getEl('catalog-detail-overview');
  var text = ov ? (ov.textContent || '').trim() : '';
  if (!text) return;
  var el = ensureDetailOverviewPopup();
  var item = AppState.currentDetailItem;
  var titleEl = el.querySelector('.detail-overview-popup-title');
  titleEl.textContent = item ? getCatalogItemTitle(item) : '';
  detailOverviewPopup.text.textContent = text;
  detailOverviewPopup.returnFocus = document.querySelector('.focused');
  detailOverviewPopup.open = true;
  detailOverviewPopup.openedAt = Date.now();
  el.classList.remove('hidden');
  detailOverviewPopup.text.scrollTop = 0;
}
function closeDetailOverviewPopup() {
  if (!detailOverviewPopup.open) return false;
  detailOverviewPopup.open = false;
  detailOverviewPopup.el.classList.add('hidden');
  var rf = detailOverviewPopup.returnFocus;
  detailOverviewPopup.returnFocus = null;
  if (rf && rf.isConnected !== false && typeof window.focusEl === 'function') window.focusEl(rf);
  return true;
}
function onDetailOverviewPopupKey(e) {
  if (!detailOverviewPopup.open) return;
  var kc = e.keyCode;
  var back = typeof isBackKey === 'function' && isBackKey(kc);
  var ok = !back && typeof isOkKey === 'function' && isOkKey(kc);
  var dir = !back && !ok && typeof arrowDir === 'function' ? arrowDir(kc) : null;
  if (!back && !ok && !dir) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (back) {
    closeDetailOverviewPopup();
    return;
  }
  if (ok) {
    if (e.repeat || Date.now() - detailOverviewPopup.openedAt < 400) return;
    closeDetailOverviewPopup();
    return;
  }
  if (dir === 'up' || dir === 'down') {
    var t = detailOverviewPopup.text;
    var step = Math.max(40, Math.round(t.clientHeight / 3));
    t.scrollTop += dir === 'down' ? step : -step;
  }
}
window.isDetailOverviewPopupOpen = function () {
  return detailOverviewPopup.open;
};
window.closeDetailOverviewPopup = closeDetailOverviewPopup;
function resetDetailButtons() {
  if (typeof syncFavoriteButton === 'function') syncFavoriteButton(AppState.currentDetailItem);
  var togBtn = getEl('catalog-toggle-overview-btn');
  if (togBtn) {
    togBtn.textContent = 'Подробнее';
    togBtn.setAttribute('data-label', 'Подробнее');
  }
  var ov = getEl('catalog-detail-overview');
  if (ov) ov.classList.remove('expanded');
  var sub = getEl('detail-subtitle');
  if (sub) sub.classList.remove('expanded');
  var trailerBtn = getEl('catalog-trailer-btn');
  if (trailerBtn) {
    trailerBtn.classList.add('hidden');
    trailerBtn.style.display = 'none';
  }
}
function showTrailerButton() {
  var btn = getEl('catalog-trailer-btn');
  if (!btn) return;
  btn.classList.remove('hidden');
  btn.style.display = 'inline-block';
  if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
  if (typeof updateFocusableElements === 'function') updateFocusableElements();
}
function parseMaxQualityFromM3u8Url(url) {
  if (!url) return null;
  try {
    var matches = url.match(/(\d{2,4})x(\d{2,4})/g);
    if (!matches || matches.length === 0) return null;
    var max = {
      width: 0,
      height: 0,
      pixels: 0
    };
    for (var i = 0; i < matches.length; i++) {
      var parts = matches[i].split('x');
      var w = parseInt(parts[0], 10);
      var h = parseInt(parts[1], 10);
      var pixels = w * h;
      if (pixels > max.pixels) {
        max.width = w;
        max.height = h;
        max.pixels = pixels;
      }
    }
    return max.pixels > 0 ? max : null;
  } catch (e) {
    return null;
  }
}
function extractBalancerUrl(playData) {
  if (!playData || !playData.video_balancer) return null;
  var vb = playData.video_balancer;
  return vb.default || vb.m3u8 || null;
}
var RUTUBE_TRAILER_WORDS = [' трейлер ', ' трейлеры ', ' тизер ', ' trailer ', ' teaser '];
var RUTUBE_NOT_TRAILER = [' обзор ', ' разбор ', ' реакция ', ' рецензия ', ' review ', ' reaction ', ' пересказ ', ' мнение ', ' смотреть онлайн ', ' все серии ', ' премьера ', ' как снимали ', ' фильм о фильме ', ' интервью ', ' пародия ', ' фанатский ', ' fan made ', ' концепт ', ' нейросеть '];
var RUTUBE_OFFICIAL_AUTHORS = [' okko ', ' кинопоиск ', ' start ', ' wink ', ' иви ', ' ivi ', ' kion ', ' premier ', ' амедиатека ', ' more tv ', ' смотрим '];
var RUTUBE_NAME_BEFORE = {
  'сериал': 1,
  'сериала': 1,
  'фильм': 1,
  'фильма': 1,
  'мультфильм': 1,
  'мультфильма': 1,
  'аниме': 1,
  'к': 1,
  'трейлер': 1,
  'тизер': 1,
  'русский': 1,
  'официальный': 1,
  'новый': 1
};
var RUTUBE_NAME_AFTER = {
  'трейлер': 1,
  'трейлеры': 1,
  'тизер': 1,
  'trailer': 1,
  'teaser': 1,
  'русский': 1,
  'русская': 1,
  'официальный': 1,
  'официальная': 1,
  'дублированный': 1,
  'дубляж': 1,
  'сезон': 1,
  'сериал': 1,
  'фильм': 1,
  'мультфильм': 1,
  'hd': 1,
  '4k': 1,
  '4к': 1,
  'на': 1,
  'с': 1,
  'season': 1,
  'official': 1
};
function rutubeNorm(s) {
  return ' ' + String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^0-9a-zа-я]+/g, ' ').trim() + ' ';
}
function rutubeHasAny(text, list) {
  for (var i = 0; i < list.length; i++) if (text.indexOf(list[i]) !== -1) return true;
  return false;
}
function rutubeNameFits(text, name, otherName) {
  var at = name.length > 3 ? text.indexOf(name) : -1;
  if (at === -1) return false;
  var before = text.slice(0, at + 1).trim();
  var after = text.slice(at + name.length - 1).trim();
  var other = otherName && otherName.length > 3 ? otherName.trim() : '';
  if (other) {
    before = before.replace(other, '').trim();
    if (after.indexOf(other + ' ') === 0 || after === other) after = after.slice(other.length).trim();
  }
  if (before && !rutubeHasAny(' ' + before + ' ', RUTUBE_TRAILER_WORDS)) {
    var words = before.split(' ');
    for (var i = 0; i < words.length; i++) if (!RUTUBE_NAME_BEFORE[words[i]]) return false;
  }
  if (!after) return true;
  var next = after.split(' ');
  if (RUTUBE_NAME_AFTER[next[0]] || /^(19|20)\d{2}$/.test(next[0])) return true;
  return /^\d{1,2}$/.test(next[0]) && (next[1] === 'сезон' || next[1] === 'season');
}
function rutubeTrailerScore(video, title, originalTitle, year) {
  var text = rutubeNorm(video.title);
  var ru = rutubeNorm(title);
  var orig = originalTitle && originalTitle !== title ? rutubeNorm(originalTitle) : '';
  var byRu = rutubeNameFits(text, ru, orig);
  if (!byRu && !(orig && rutubeNameFits(text, orig, ru))) return -1;
  if (!rutubeHasAny(text, RUTUBE_TRAILER_WORDS) || rutubeHasAny(text, RUTUBE_NOT_TRAILER)) return -1;
  if (video.is_adult || video.is_hidden) return -1;
  if (video.duration && (video.duration < 20 || video.duration > 420)) return -1;
  var score = byRu ? 20 : 10;
  if (text.indexOf(' официальн') !== -1) score += 15;
  if (text.indexOf(' русск') !== -1 || text.indexOf(' дублир') !== -1) score += 10;
  if (text.indexOf(' трейлер ') === -1 && text.indexOf(' trailer ') === -1) score -= 5;
  if (video.author && rutubeHasAny(rutubeNorm(video.author.name), RUTUBE_OFFICIAL_AUTHORS)) score += 15;
  var years = String(video.title || '').match(/(19|20)\d{2}/g);
  if (year && years) {
    var near = false;
    for (var i = 0; i < years.length; i++) if (Math.abs(+years[i] - +year) <= 1) near = true;
    score += near ? 15 : -40;
  }
  return score;
}
function rutubeTrailerCandidates(results, title, originalTitle, year) {
  var picked = [];
  for (var i = 0; i < (results || []).length; i++) {
    var score = rutubeTrailerScore(results[i], title, originalTitle, year);
    if (score >= 0 && results[i].id) picked.push({
      id: results[i].id,
      score: score,
      order: i
    });
  }
  picked.sort(function (a, b) {
    return b.score - a.score || a.order - b.order;
  });
  return picked;
}
function rutubeSearchUrl(name) {
  return 'https://rutube.ru/api/search/combined/video_playlist?query=' + encodeURIComponent(name + ' трейлер') + '&duration=short&client=wdp&page=1';
}
var rutubeDirectMode = null;
function isRutubeDirect() {
  if (rutubeDirectMode === null) {
    try {
      rutubeDirectMode = !!(window.AndroidJS && typeof AndroidJS.trailerDirect === 'function' && AndroidJS.trailerDirect());
    } catch (e) {
      rutubeDirectMode = false;
    }
  }
  return rutubeDirectMode;
}
window.isRutubeDirect = isRutubeDirect;
function rutubeApiJson(_x) {
  return _rutubeApiJson.apply(this, arguments);
}
function _rutubeApiJson() {
  _rutubeApiJson = _asyncToGenerator(function* (apiUrl) {
    if (isRutubeDirect()) {
      var controller = new AbortController();
      var timer = setTimeout(function () {
        controller.abort();
      }, 10000);
      try {
        var resp = yield fetch(apiUrl, {
          signal: controller.signal
        });
        if (resp.ok) return yield resp.json();
      } catch (e) {
        console.warn('RuTube напрямую не ответил:', e.message);
      } finally {
        clearTimeout(timer);
      }
    }
    return safeFetch('/api/rutube/proxy?url=' + encodeURIComponent(apiUrl), {
      timeout: 10000
    });
  });
  return _rutubeApiJson.apply(this, arguments);
}
function rutubeYear(releaseDate) {
  var m = String(releaseDate || '').match(/(19|20)\d{2}/);
  return m ? m[0] : '';
}
function fetchRutubeTrailer(_x2, _x3, _x4) {
  return _fetchRutubeTrailer.apply(this, arguments);
}
function _fetchRutubeTrailer() {
  _fetchRutubeTrailer = _asyncToGenerator(function* (title, originalTitle, releaseDate) {
    if (!title) return null;
    var year = rutubeYear(releaseDate);
    try {
      var searchData = yield rutubeApiJson(rutubeSearchUrl(title));
      var picked = rutubeTrailerCandidates(searchData && searchData.results, title, originalTitle, year);
      if (!picked.length && originalTitle && originalTitle !== title) {
        searchData = yield rutubeApiJson(rutubeSearchUrl(originalTitle));
        picked = rutubeTrailerCandidates(searchData && searchData.results, title, originalTitle, year);
      }
      if (!picked.length) return null;
      var bestUrl = null;
      var bestQuality = null;
      var bestTitle = '';
      for (var j = 0; j < picked.length && j < 3; j++) {
        var playData = yield rutubeApiJson('https://rutube.ru/api/play/options/' + picked[j].id);
        var balancerUrl = extractBalancerUrl(playData);
        if (!balancerUrl) continue;
        var quality = parseMaxQualityFromM3u8Url(balancerUrl);
        if (!quality) continue;
        if (!bestQuality || quality.pixels > bestQuality.pixels) {
          bestUrl = balancerUrl;
          bestQuality = quality;
          bestTitle = playData.title || title;
        }
        if (quality.height >= 720) {
          bestUrl = balancerUrl;
          bestQuality = quality;
          bestTitle = playData.title || title;
          break;
        }
      }
      if (!bestUrl) return null;
      return {
        url: bestUrl,
        quality: bestQuality,
        title: bestTitle
      };
    } catch (e) {
      console.warn('❌ RuTube trailer error:', e.message);
      return null;
    }
  });
  return _fetchRutubeTrailer.apply(this, arguments);
}
var TRAILER_CACHE_URL = '/api/trailer/cache';
function rutubeVideoIdFromUrl(url) {
  var m = /\/route\/([0-9a-f]{32})\b/.exec(String(url || ''));
  return m ? m[1] : null;
}
function rutubeTrailerById(_x5, _x6) {
  return _rutubeTrailerById.apply(this, arguments);
}
function _rutubeTrailerById() {
  _rutubeTrailerById = _asyncToGenerator(function* (videoId, title) {
    var playData = yield rutubeApiJson('https://rutube.ru/api/play/options/' + videoId);
    var balancerUrl = extractBalancerUrl(playData);
    if (!balancerUrl) return null;
    return {
      url: balancerUrl,
      quality: parseMaxQualityFromM3u8Url(balancerUrl),
      title: playData && playData.title || title
    };
  });
  return _rutubeTrailerById.apply(this, arguments);
}
function fetchRutubeTrailerCached(_x7, _x8, _x9, _x0) {
  return _fetchRutubeTrailerCached.apply(this, arguments);
}
function _fetchRutubeTrailerCached() {
  _fetchRutubeTrailerCached = _asyncToGenerator(function* (ref, title, originalTitle, releaseDate) {
    var search = window.fetchRutubeTrailer || fetchRutubeTrailer;
    var id = ref && ref.id !== undefined && ref.id !== null ? String(ref.id) : '';
    if (!/^\d+$/.test(id)) return search(title, originalTitle, releaseDate);
    var type = ref.type === 'tv' ? 'tv' : 'movie';
    var query = '?id=' + id + '&type=' + type;
    var cached = yield safeFetch(TRAILER_CACHE_URL + query, {
      timeout: 4000
    });
    if (cached && cached.cached) {
      if (!cached.videoId) return null;
      if (rutubeTrailerScore({
        title: cached.title
      }, title, originalTitle, rutubeYear(releaseDate)) >= 0) {
        var hit = yield rutubeTrailerById(cached.videoId, cached.title || title);
        if (hit) return hit;
        (window.bgFetch || fetch)(TRAILER_CACHE_URL + query, {
          method: 'DELETE'
        })['catch'](function () {});
      }
    }
    var found = yield search(title, originalTitle, releaseDate);
    if (cached) {
      var videoId = found && found.url ? rutubeVideoIdFromUrl(found.url) : null;
      if (!found || videoId) {
        (window.bgFetch || fetch)(TRAILER_CACHE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            id: id,
            type: type,
            videoId: videoId,
            title: found ? found.title || title : null
          })
        })['catch'](function () {});
      }
    }
    return found;
  });
  return _fetchRutubeTrailerCached.apply(this, arguments);
}
window.fetchRutubeTrailerCached = fetchRutubeTrailerCached;
function wrapRutubeHls(url) {
  if (!url) return url;
  if (url.indexOf('/api/rutube/hls/proxy') === 0) return url;
  if (isRutubeDirect()) return url;
  return '/api/rutube/hls/proxy?u=' + encodeURIComponent(url);
}
function trailerUsesHlsJs() {
  if (!(window.Hls && Hls.isSupported())) return false;
  if (window.LEGACY_JS && (window.PalmSystem || window.webOSSystem)) return false;
  if (AppState.tizenLegacy) return false;
  return true;
}
window.trailerUsesHlsJs = trailerUsesHlsJs;
var TMDB_CACHE_CONFIG = {
  ttl: CATALOG_CONSTANTS.CACHE_TTL_MS,
  maxSize: CATALOG_CONSTANTS.TMDB_MAX_CACHE_SIZE,
  cleanupInterval: CATALOG_CONSTANTS.TMDB_CLEANUP_INTERVAL_MS,
  enabled: true
};
var tmdbCache = new LRUTTLCache(TMDB_CACHE_CONFIG.maxSize, TMDB_CACHE_CONFIG.ttl);
function getTmdbCacheKey(endpoint, params) {
  var keys = Object.keys(params).sort();
  var sorted = {};
  for (var i = 0; i < keys.length; i++) sorted[keys[i]] = params[keys[i]];
  return endpoint + ':' + JSON.stringify(sorted);
}
function getFromTmdbCache(endpoint, params) {
  if (!TMDB_CACHE_CONFIG.enabled || !tmdbCache) return null;
  var key = getTmdbCacheKey(endpoint, params);
  var cached = tmdbCache.get(key);
  if (!cached) return null;
  return cached.data !== undefined ? cached.data : null;
}
function saveToTmdbCache(endpoint, params, data) {
  if (!TMDB_CACHE_CONFIG.enabled || !tmdbCache) return;
  var key = getTmdbCacheKey(endpoint, params);
  tmdbCache.set(key, {
    data: data,
    timestamp: Date.now()
  });
}
function cleanOldTmdbCache() {
  if (!tmdbCache) return;
  tmdbCache.cleanExpired();
  tmdbCache.trimToMax();
}
function clearTmdbCache() {
  if (tmdbCache) tmdbCache.clear();
}
function getTmdbCacheStats() {
  var now = Date.now();
  var valid = 0;
  var expired = 0;
  var size = 0;
  if (!tmdbCache) {
    return {
      totalEntries: 0,
      validEntries: 0,
      expiredEntries: 0,
      totalSizeMB: '0.00',
      maxSize: TMDB_CACHE_CONFIG.maxSize,
      ttlHours: TMDB_CACHE_CONFIG.ttl / 3600000,
      enabled: TMDB_CACHE_CONFIG.enabled
    };
  }
  tmdbCache.forEach(function (cached, key, entry) {
    try {
      size += JSON.stringify(cached.data).length;
    } catch (e) {}
    var ts = cached && cached.timestamp ? cached.timestamp : entry.timestamp;
    if (now - ts < TMDB_CACHE_CONFIG.ttl) {
      valid++;
    } else {
      expired++;
    }
  }, true);
  return {
    totalEntries: valid + expired,
    validEntries: valid,
    expiredEntries: expired,
    totalSizeMB: (size / 1048576).toFixed(2),
    maxSize: TMDB_CACHE_CONFIG.maxSize,
    ttlHours: TMDB_CACHE_CONFIG.ttl / 3600000,
    enabled: TMDB_CACHE_CONFIG.enabled
  };
}
var catalogState = {
  currentCatalog: null,
  items: [],
  totalItems: 0,
  loading: false,
  loadingMore: false,
  selectedCatalog: null,
  lastSelectedIndex: 0,
  lastSelectedId: null,
  abortController: null,
  currentPage: 0,
  itemsPerPage: CATALOG_CONSTANTS.ITEMS_PER_PAGE,
  hasMore: true,
  isLoadingMore: false,
  loadedItemIds: {},
  loadedPostersCount: 0,
  postersPerBatch: CATALOG_CONSTANTS.POSTER_BATCH_SIZE,
  isPosterLoading: false,
  posterLoadQueue: [],
  posterObserver: null,
  loadMoreObserver: null,
  posterDeferred: [],
  posterDeferredRaf: 0,
  posterBatchTimer: null,
  cardElements: {},
  posterCache: new LRUCache(CATALOG_CONSTANTS.MAX_POSTER_CACHE),
  maxPosterCacheSize: CATALOG_CONSTANTS.MAX_POSTER_CACHE,
  rowPosterObserver: null,
  rowPosterQueue: [],
  rowPosterQueueTimer: null,
  activeRowPosterLoads: 0,
  focusPosterCard: null,
  focusPosterTimer: null,
  rowPostersQueuedFor: null,
  rowVisibilityObserver: null,
  gridVisibilityObserver: null,
  chunks: [],
  chunkSize: 0,
  chunkCols: 0,
  chunkObserver: null,
  chunkTrimTimer: null,
  rowBoxH: 0
};
function abortCatalogRequests() {
  if (catalogState.abortController) {
    catalogState.abortController.abort();
    catalogState.abortController = null;
  }
  if (catalogState.posterObserver) {
    catalogState.posterObserver.disconnect();
    catalogState.posterObserver = null;
  }
  if (catalogState.loadMoreObserver) {
    catalogState.loadMoreObserver.disconnect();
    catalogState.loadMoreObserver = null;
  }
  if (catalogState.rowPosterObserver) {
    catalogState.rowPosterObserver.disconnect();
    catalogState.rowPosterObserver = null;
  }
  if (catalogState.chunkObserver) {
    catalogState.chunkObserver.disconnect();
    catalogState.chunkObserver = null;
  }
  unwatchCatalogCardHeight();
  resetDeferredPosters();
}
function getRatingColor(r) {
  return r >= 8 ? '#4caf50' : r >= 6 ? '#ffc107' : r >= 4 ? '#ff9800' : '#f44336';
}
function escapeHtml(s) {
  return s ? String(s).replace(/[&<>]/g, function (m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;'
    }[m];
  }) : '';
}
function formatDuration(sec) {
  if (!sec) return '';
  var m = Math.floor(sec / 60),
    s = Math.floor(sec % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}
function safeFetch(_x1, _x10, _x11) {
  return _safeFetch.apply(this, arguments);
}
function _safeFetch() {
  _safeFetch = _asyncToGenerator(function* (url, options, fallback) {
    options = options || {};
    var timeout = options.timeout || CATALOG_CONSTANTS.FETCH_TIMEOUT_MS;
    var controller = new AbortController();
    var timeoutId = setTimeout(function () {
      controller.abort();
    }, timeout);
    try {
      var init = Object.assign({
        signal: controller.signal
      }, options);
      delete init.timeout;
      var resp = yield window.bgFetch ? window.bgFetch(url, init) : fetch(url, init);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return yield resp.json();
    } catch (e) {
      if (e.name === 'AbortError') {
        console.warn('⏱️ Fetch timeout:', url);
      } else {
        console.warn('❌ Fetch error:', url, e.message);
      }
      return fallback !== undefined ? fallback : null;
    } finally {
      clearTimeout(timeoutId);
    }
  });
  return _safeFetch.apply(this, arguments);
}
function fetchJsonWithTimeout(_x12, _x13, _x14) {
  return _fetchJsonWithTimeout.apply(this, arguments);
}
function _fetchJsonWithTimeout() {
  _fetchJsonWithTimeout = _asyncToGenerator(function* (url, timeout, options) {
    options = options || {};
    options.timeout = timeout || CATALOG_CONSTANTS.FETCH_TIMEOUT_MS;
    return safeFetch(url, options, null);
  });
  return _fetchJsonWithTimeout.apply(this, arguments);
}
function fetchCatalogActors(_x15) {
  return _fetchCatalogActors.apply(this, arguments);
}
function _fetchCatalogActors() {
  _fetchCatalogActors = _asyncToGenerator(function* (item) {
    var id = item && item.id,
      type = item && item.media_type || 'movie';
    if (!id) return [];
    var p = {
      id: id,
      type: type
    };
    var cached = getFromTmdbCache('actors', p);
    if (cached !== null) return cached;
    try {
      var data = yield fetchTmdbDetails({
        id: id,
        media_type: type
      });
      var actors = [];
      if (data && data.cast && Array.isArray(data.cast)) {
        var limit = Math.min(CATALOG_CONSTANTS.MAX_ACTORS, data.cast.length);
        for (var i = 0; i < limit; i++) {
          var a = data.cast[i];
          actors.push({
            id: a.id,
            name: a.name,
            character: a.character,
            profilePath: a.profile_path,
            order: a.order
          });
        }
      }
      saveToTmdbCache('actors', p, actors);
      return actors;
    } catch (e) {
      console.warn('Actors fetch error:', e);
      return [];
    }
  });
  return _fetchCatalogActors.apply(this, arguments);
}
var tmdbDetailsInFlight = {};
function fetchTmdbDetails(_x16) {
  return _fetchTmdbDetails.apply(this, arguments);
}
function _fetchTmdbDetails() {
  _fetchTmdbDetails = _asyncToGenerator(function* (item) {
    var id = item && item.id,
      type = item && item.media_type || 'movie';
    if (!id) return null;
    var p = {
      id: id,
      type: type
    };
    var cached = getFromTmdbCache('details', p);
    if (cached !== null) return cached;
    var flightKey = id + '_' + type;
    if (tmdbDetailsInFlight[flightKey]) return tmdbDetailsInFlight[flightKey];
    var pending = _fetchTmdbDetailsNow(id, type, p);
    tmdbDetailsInFlight[flightKey] = pending;
    try {
      return yield pending;
    } finally {
      delete tmdbDetailsInFlight[flightKey];
    }
  });
  return _fetchTmdbDetails.apply(this, arguments);
}
function _fetchTmdbDetailsNow(_x17, _x18, _x19) {
  return _fetchTmdbDetailsNow2.apply(this, arguments);
}
function _fetchTmdbDetailsNow2() {
  _fetchTmdbDetailsNow2 = _asyncToGenerator(function* (id, type, p) {
    var urls = ['/api/tmdb/details?id=' + encodeURIComponent(id) + '&type=' + encodeURIComponent(type), '/api/tmdb/item?id=' + encodeURIComponent(id) + '&type=' + encodeURIComponent(type)];
    for (var i = 0; i < urls.length; i++) {
      var d = yield safeFetch(urls[i]);
      if (d && (d.id || d.overview || d.videos || d.backdrops)) {
        saveToTmdbCache('details', p, d);
        return d;
      }
    }
    return null;
  });
  return _fetchTmdbDetailsNow2.apply(this, arguments);
}
function mergeCatalogDetails(base) {
  var m = {};
  for (var k in base) if (base.hasOwnProperty(k)) m[k] = base[k];
  for (var i = 1; i < arguments.length; i++) {
    var src = arguments[i];
    if (!src || typeof src !== 'object') continue;
    for (var k in src) {
      if (!src.hasOwnProperty(k)) continue;
      var v = src[k];
      if (v === null || v === undefined) continue;
      if (Array.isArray(v)) {
        if (!Array.isArray(m[k]) || m[k].length === 0) m[k] = v.slice();
        continue;
      }
      if (typeof v === 'string') {
        if (!m[k] || !String(m[k]).trim()) m[k] = v;
        continue;
      }
      if (typeof v === 'number') {
        if (!m[k]) m[k] = v;
        continue;
      }
      if (typeof v === 'object') {
        if (!m[k]) m[k] = {};
        for (var sk in v) if (v.hasOwnProperty(sk)) m[k][sk] = v[sk];
      }
    }
  }
  return m;
}
function fetchCatalogItemDetails(_x20) {
  return _fetchCatalogItemDetails.apply(this, arguments);
}
function _fetchCatalogItemDetails() {
  _fetchCatalogItemDetails = _asyncToGenerator(function* (item) {
    var p = {
      id: item && item.id,
      media_type: item && item.media_type || 'movie',
      title: getCatalogItemTitle(item)
    };
    var c = getFromTmdbCache('itemDetails', p);
    if (c !== null) return c;
    var tmdb = yield fetchTmdbDetails(item);
    var merged = mergeCatalogDetails(item, tmdb);
    saveToTmdbCache('itemDetails', p, merged);
    return merged;
  });
  return _fetchCatalogItemDetails.apply(this, arguments);
}
function getCatalogItemTitle(item) {
  return (item && item.torrent && item.torrent[0] ? item.torrent[0].name : null) || item && (item.title || item.name) || 'Без названия';
}
function getCatalogItemYear(item) {
  var r = item && (item.release_date || item.first_air_date || item.year || item.released) || '';
  var m = String(r).match(/(19|20)\d{2}/);
  return m ? m[0] : null;
}
function getGenreNames(item, type) {
  type = type || 'movie';
  var names = [];
  if (item && Array.isArray(item.genres)) {
    for (var i = 0; i < item.genres.length; i++) {
      if (item.genres[i]) names.push(typeof item.genres[i] === 'string' ? item.genres[i] : item.genres[i].name);
    }
  }
  if (!names.length && item && Array.isArray(item.genre_ids)) {
    var map = TMDB_GENRES[type] || TMDB_GENRES.movie;
    for (var j = 0; j < item.genre_ids.length; j++) {
      if (map[item.genre_ids[j]]) names.push(map[item.genre_ids[j]]);
    }
  }
  var res = [];
  for (var k = 0; k < names.length; k++) if (names[k]) res.push(names[k]);
  return res;
}
function getCatalogRating(item) {
  var v = Number(item && item.vote_average);
  return Number.isFinite(v) && v > 0 ? (Math.round(v * 10) / 10).toFixed(1) : '';
}
function getNormalizedCatalogGenres(src) {
  if (!src) return [];
  var list = [],
    mt = (src.media_type || (src.types && src.types.indexOf('tv') !== -1 ? 'tv' : 'movie')) === 'tv' ? 'tv' : 'movie';
  var map = TMDB_GENRES[mt] || TMDB_GENRES.movie;
  if (Array.isArray(src.genres)) for (var i = 0; i < src.genres.length; i++) {
    var g = src.genres[i];
    if (g) list.push(String(g.name || g).trim());
  }
  if (Array.isArray(src.genre_ids)) for (var j = 0; j < src.genre_ids.length; j++) {
    var id = src.genre_ids[j];
    if (map[id] || map[String(id)]) list.push(String(map[id] || map[String(id)]).trim());
  }
  if (src.genre) list.push(String(src.genre).trim());
  if (src.genre_name) list.push(String(src.genre_name).trim());
  var u = [];
  for (var k = 0; k < list.length; k++) if (list[k] && u.indexOf(list[k]) === -1) u.push(list[k]);
  return u;
}
var COUNTRY_NAMES_RU = {
  US: 'США',
  GB: 'Великобритания',
  RU: 'Россия',
  SU: 'СССР',
  UA: 'Украина',
  BY: 'Беларусь',
  KZ: 'Казахстан',
  FR: 'Франция',
  DE: 'Германия',
  IT: 'Италия',
  ES: 'Испания',
  PT: 'Португалия',
  NL: 'Нидерланды',
  BE: 'Бельгия',
  CH: 'Швейцария',
  AT: 'Австрия',
  SE: 'Швеция',
  NO: 'Норвегия',
  DK: 'Дания',
  FI: 'Финляндия',
  IS: 'Исландия',
  IE: 'Ирландия',
  PL: 'Польша',
  CZ: 'Чехия',
  SK: 'Словакия',
  HU: 'Венгрия',
  RO: 'Румыния',
  BG: 'Болгария',
  GR: 'Греция',
  TR: 'Турция',
  IL: 'Израиль',
  IN: 'Индия',
  CN: 'Китай',
  HK: 'Гонконг',
  TW: 'Тайвань',
  JP: 'Япония',
  KR: 'Южная Корея',
  TH: 'Таиланд',
  ID: 'Индонезия',
  PH: 'Филиппины',
  VN: 'Вьетнам',
  MY: 'Малайзия',
  SG: 'Сингапур',
  AU: 'Австралия',
  NZ: 'Новая Зеландия',
  CA: 'Канада',
  MX: 'Мексика',
  BR: 'Бразилия',
  AR: 'Аргентина',
  CL: 'Чили',
  CO: 'Колумбия',
  PE: 'Перу',
  ZA: 'ЮАР',
  EG: 'Египет',
  NG: 'Нигерия',
  MA: 'Марокко',
  IR: 'Иран',
  AE: 'ОАЭ',
  SA: 'Саудовская Аравия',
  LT: 'Литва',
  LV: 'Латвия',
  EE: 'Эстония',
  GE: 'Грузия',
  AM: 'Армения',
  AZ: 'Азербайджан',
  UZ: 'Узбекистан',
  RS: 'Сербия',
  HR: 'Хорватия',
  SI: 'Словения',
  BA: 'Босния и Герцеговина',
  LU: 'Люксембург',
  MT: 'Мальта',
  CY: 'Кипр',
  XC: 'Чехословакия',
  YU: 'Югославия',
  DD: 'ГДР',
  XG: 'ГДР'
};
function getCatalogCountries(src, limit) {
  if (!src) return [];
  var codes = [],
    names = {};
  var oc = src.origin_country;
  if (Array.isArray(oc)) for (var i = 0; i < oc.length; i++) if (oc[i]) codes.push(String(oc[i]).toUpperCase());
  var pc = src.production_countries;
  if (Array.isArray(pc)) for (var j = 0; j < pc.length; j++) {
    var c = pc[j];
    if (!c || !c.iso_3166_1) continue;
    var code = String(c.iso_3166_1).toUpperCase();
    codes.push(code);
    if (c.name) names[code] = c.name;
  }
  var out = [],
    seen = {};
  for (var k = 0; k < codes.length && out.length < (limit || 2); k++) {
    if (seen[codes[k]]) continue;
    seen[codes[k]] = 1;
    var name = COUNTRY_NAMES_RU[codes[k]] || names[codes[k]];
    if (name) out.push(name);
  }
  return out;
}
window.getCatalogCountries = getCatalogCountries;
function getSafeCatalogRating(s) {
  var r = Number(s && s.vote_average || s && s.rating || s && s.tmdb_rating);
  return Number.isFinite(r) && r > 0 && r <= 10 ? Math.round(r * 10) / 10 : null;
}
function getCatalogItemSubtitle(item, details) {
  var s = details || item || {};
  var year = getCatalogItemYear(s),
    type = (item && item.media_type || 'movie') === 'tv' ? 'Сериал' : 'Фильм';
  var genres = getNormalizedCatalogGenres(s),
    safe = getSafeCatalogRating(s);
  var parts = [];
  if (type) parts.push(type);
  if (year) parts.push(year);
  if (safe) parts.push(safe);
  if (genres[0]) parts.push(genres[0]);
  var countries = getCatalogCountries(s, 2);
  if (countries.length) parts.push(countries.join(', '));
  var txt = parts.join(' • ');
  var el = getEl('detail-subtitle');
  if (el) {
    el.textContent = txt;
    el.style.display = 'block';
  }
  return txt;
}
function fetchCatalogItemMeta(_x21, _x22) {
  return _fetchCatalogItemMeta.apply(this, arguments);
}
function _fetchCatalogItemMeta() {
  _fetchCatalogItemMeta = _asyncToGenerator(function* (item, mediaType) {
    mediaType = mediaType || 'movie';
    var title = getCatalogItemTitle(item),
      year = getCatalogItemYear(item);
    var p = {
      title: title,
      year: year,
      mediaType: mediaType,
      tmdbId: item && item.id
    };
    var c = getFromTmdbCache('itemMeta', p);
    if (c !== null) return c;
    var best = {};
    for (var k in item) if (item.hasOwnProperty(k)) best[k] = item[k];
    var url = '/api/tmdb/search?query=' + encodeURIComponent(title) + '&type=' + mediaType + (year ? '&year=' + year : '');
    var d = yield safeFetch(url);
    if (d && Array.isArray(d.results) && d.results.length) {
      for (var i = 0; i < d.results.length; i++) {
        if (String(d.results[i].id) === String(item && item.id)) {
          best = d.results[i];
          break;
        }
      }
      if (!best.id) best = d.results[0];
    }
    var meta = {
      raw: best,
      overview: best && best.overview || item && item.overview || '',
      posterPath: best && best.poster_path || item && item.poster_path || null,
      backdropPath: best && best.backdrop_path || item && item.backdrop_path || null,
      rating: getCatalogRating(best || item),
      genres: getGenreNames(best || item, mediaType),
      year: getCatalogItemYear(best || item) || year
    };
    saveToTmdbCache('itemMeta', p, meta);
    return meta;
  });
  return _fetchCatalogItemMeta.apply(this, arguments);
}
function loadCatalog(_x23) {
  return _loadCatalog.apply(this, arguments);
}
function _loadCatalog() {
  _loadCatalog = _asyncToGenerator(function* (key) {
    if (key === 'person') {
      if (!catalogState.person) return;
      return loadPersonCatalog(catalogState.person.id, catalogState.person.name);
    }
    if (!CATALOG_CONFIG[key]) return;
    AppState.openInRow = false;
    if (catalogState.currentCatalog === key && catalogState.items.length > 0 && getCatalogGridEl() && getCatalogGridEl().querySelector('.torrent-card.catalog-card')) {
      showCatalogGridView();
      return;
    }
    AppState.backCurrentCatalog = key;
    abortCatalogRequests();
    catalogState.abortController = new AbortController();
    var config = CATALOG_CONFIG[key];
    catalogState.currentCatalog = key;
    catalogState.cardElements = {};
    catalogState.items = [];
    catalogState.totalItems = 0;
    catalogState.currentPage = 0;
    catalogState.hasMore = true;
    catalogState.isLoadingMore = false;
    catalogState.loadedItemIds = {};
    catalogState.loadedPostersCount = 0;
    catalogState.posterLoadQueue = [];
    AppState.mediaType = config.mediaType;
    showCatalogLoading('Загрузка ' + config.name + '...');
    yield loadMoreCatalogItems(true);
    catalogState.abortController = null;
  });
  return _loadCatalog.apply(this, arguments);
}
function loadHistoryCatalog() {
  return _loadHistoryCatalog.apply(this, arguments);
}
function _loadHistoryCatalog() {
  _loadHistoryCatalog = _asyncToGenerator(function* () {
    abortCatalogRequests();
    AppState.openInRow = false;
    catalogState.currentCatalog = 'history';
    catalogState.cardElements = {};
    catalogState.items = [];
    catalogState.totalItems = 0;
    catalogState.currentPage = 0;
    catalogState.hasMore = false;
    catalogState.isLoadingMore = false;
    catalogState.loadedItemIds = {};
    catalogState.loadedPostersCount = 0;
    catalogState.posterLoadQueue = [];
    AppState.mediaType = 'history';
    showCatalogLoading('Загрузка истории просмотра...');
    try {
      var data = yield safeFetch(withClientId(SERVER_URL + '/api/history'));
      if (data && data.success && data.history && data.history.length > 0) {
        catalogState.items = data.history.map(function (item, idx) {
          var pp = item.posterPath;
          if (pp && pp.indexOf('http') !== 0) pp = pp.indexOf('/') === 0 ? pp : '/' + pp;
          return {
            id: item.tmdbId,
            title: item.title,
            name: item.title,
            media_type: item.mediaType,
            poster_path: pp,
            vote_average: null,
            overview: null,
            release_date: item.watchedAt ? item.watchedAt.split('T')[0] : null,
            watchedAt: item.watchedAt,
            timestamp: item.timestamp,
            isHistoryItem: true,
            historyIndex: idx,
            resume: item.resume || null
          };
        }).sort(function (a, b) {
          return b.timestamp - a.timestamp;
        });
        catalogState.totalItems = catalogState.items.length;
        renderCatalogGrid();
      } else {
        showEmptyHistory();
      }
    } catch (e) {
      console.error('History load error:', e);
      showCatalogError('Не удалось загрузить историю просмотра');
    }
    hideCatalogLoading();
    catalogState.abortController = null;
  });
  return _loadHistoryCatalog.apply(this, arguments);
}
function syncFavoriteButton(item) {
  var btn = getEl('catalog-favorite-btn');
  if (!btn) return;
  if (!item || item.id === undefined || item.id === null || !window.FavoritesDB) {
    btn.classList.add('hidden');
    return;
  }
  var active = FavoritesDB.has(item.id, item.media_type || 'movie');
  var icon = btn.querySelector('.favorite-btn-icon');
  if (icon) icon.textContent = active ? '★' : '☆';
  btn.classList.toggle('is-favorite', active);
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  btn.classList.remove('hidden');
  btn.style.removeProperty('display');
}
function setupFavoriteButton(item) {
  var btn = getEl('catalog-favorite-btn');
  if (!btn) return;
  if (!item || item.id === undefined || item.id === null || !window.FavoritesDB) {
    btn.classList.add('hidden');
    return;
  }
  FavoritesDB.ready().then(function () {
    syncFavoriteButton(item);
  });
  syncFavoriteButton(item);
  btn.onclick = function () {
    FavoritesDB.toggle(buildFavoriteRecord(item)).then(function () {
      syncFavoriteButton(item);
      invalidateFavoritesRow();
    });
  };
}
function invalidateFavoritesRow() {
  if (window.catalogRowsData) delete window.catalogRowsData.favorites;
  catalogState.favoritesRowStale = true;
  if (catalogState.currentCatalog === 'favorites') catalogState.favoritesGridStale = true;
}
function reloadFavoritesGrid() {
  var idx = catalogState.lastSelectedIndex || 0;
  return loadFavoritesCatalog().then(function () {
    if (!catalogState.items.length) {
      backToCatalogList();
      return;
    }
    var target = Math.min(idx, catalogState.items.length - 1);
    catalogState.lastSelectedIndex = target;
    setTimeout(function () {
      var g = getCatalogGridEl();
      var card = g && g.querySelector('[data-catalog-index="' + target + '"]');
      if (card) focusEl(card);else if (typeof window.ensureCatalogFocus === 'function') window.ensureCatalogFocus(true);
    }, 120);
  });
}
window.reloadFavoritesGrid = reloadFavoritesGrid;
function buildFavoriteRecord(item) {
  var title = getCatalogItemTitle(item);
  if (title === 'Без названия') {
    var cur = AppState.currentDetailItem;
    if (cur && cur.id === item.id) title = cur.title || cur.name || title;
  }
  return {
    id: item.id,
    media_type: item.media_type || 'movie',
    title: title,
    name: title,
    poster_path: getCatalogKnownPosterUrl(item, item.poster_path) || item.poster_path || null,
    vote_average: typeof item.vote_average === 'number' ? item.vote_average : null,
    release_date: item.release_date || item.first_air_date || null
  };
}
function syncCatalogRowsFromDom() {
  var rows = document.querySelectorAll('#catalog-rows .catalog-row');
  window.catalogRows = [];
  for (var i = 0; i < rows.length; i++) {
    var cards = rows[i].querySelectorAll('.catalog-row-card');
    var arr = [];
    for (var j = 0; j < cards.length; j++) arr.push(cards[j]);
    if (arr.length) window.catalogRows.push(arr);
  }
}
function refreshFavoritesRow() {
  if (!catalogState.favoritesRowStale) return Promise.resolve(false);
  catalogState.favoritesRowStale = false;
  var container = getCatalogRowsEl();
  if (!container) return Promise.resolve(false);
  return loadFavoritesItems(0).then(function (all) {
    if (window.catalogRowTotals) window.catalogRowTotals.favorites = all.length;
    var items = all.slice(0, 10);
    var existing = container.querySelector('.catalog-row[data-catalog-key="favorites"]');
    if (!items.length) {
      if (existing) {
        if (catalogState.rowVisibilityObserver) catalogState.rowVisibilityObserver.unobserve(existing);
        container.removeChild(existing);
      }
      if (window.catalogRowsData) delete window.catalogRowsData.favorites;
      syncCatalogRowsFromDom();
      if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
      return true;
    }
    var fresh = createCatalogRow('favorites', items);
    if (!fresh) return false;
    if (existing) {
      if (catalogState.rowVisibilityObserver) catalogState.rowVisibilityObserver.unobserve(existing);
      container.replaceChild(fresh, existing);
    } else {
      container.appendChild(fresh);
    }
    if (catalogState.rowPosterObserver) {
      var cards = fresh.querySelectorAll('.catalog-row-card');
      for (var i = 0; i < cards.length; i++) {
        if (cards[i].dataset.itemIndex !== undefined) {
          cards[i].dataset.posterStarted = '0';
          catalogState.rowPosterObserver.observe(cards[i]);
        }
      }
    }
    observeRowVisibility(fresh);
    syncCatalogRowsFromDom();
    if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
    return true;
  }).catch(function (e) {
    console.warn('⚠️ Ряд «Избранное» не обновился:', e);
    return false;
  });
}
window.refreshFavoritesRow = refreshFavoritesRow;
function loadFavoritesItems(limit) {
  if (!window.FavoritesDB) return Promise.resolve([]);
  return FavoritesDB.list().then(function (items) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      out.push({
        id: it.id,
        title: it.title,
        name: it.name || it.title,
        media_type: it.media_type,
        poster_path: it.poster_path,
        vote_average: it.vote_average,
        release_date: it.release_date,
        isFavoriteItem: true
      });
    }
    return limit && out.length > limit ? out.slice(0, limit) : out;
  });
}
function showEmptyFavorites() {
  var g = getCatalogGridEl();
  if (!g) return;
  showCatalogGridView();
  g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px;">' + '<div style="font-size:64px;margin-bottom:20px">★</div>' + '<div style="font-size:18px;color:#aaa;margin-bottom:10px">В избранном пусто</div>' + '<div style="font-size:14px;color:#666">Открой карточку фильма и нажми «Избранное»</div></div>';
}
function loadFavoritesCatalog() {
  abortCatalogRequests();
  catalogState.currentCatalog = 'favorites';
  catalogState.favoritesGridStale = false;
  catalogState.cardElements = {};
  catalogState.items = [];
  catalogState.totalItems = 0;
  catalogState.currentPage = 0;
  catalogState.hasMore = false;
  catalogState.isLoadingMore = false;
  catalogState.loadedItemIds = {};
  catalogState.loadedPostersCount = 0;
  catalogState.posterLoadQueue = [];
  catalogState.fullItems = null;
  catalogState.fullItemsTruncated = false;
  AppState.mediaType = 'favorites';
  AppState.openInRow = false;
  AppState.backCurrentCatalog = 'favorites';
  showCatalogLoading('Загрузка избранного...');
  return loadFavoritesItems(0).then(function (items) {
    if (!items.length) {
      showEmptyFavorites();
      return;
    }
    catalogState.items = items;
    catalogState.totalItems = items.length;
    for (var i = 0; i < items.length; i++) {
      if (items[i].id) catalogState.loadedItemIds[items[i].id] = true;
    }
    renderCatalogGrid();
  }).catch(function (e) {
    console.error('Ошибка загрузки избранного:', e);
    showCatalogError('Не удалось загрузить избранное');
  }).finally(function () {
    hideCatalogLoading();
  });
}
window.loadFavoritesCatalog = loadFavoritesCatalog;
window.loadFavoritesItems = loadFavoritesItems;
window.syncFavoriteButton = syncFavoriteButton;
function openPersonCatalog(personId, personName) {
  if (!personId) return Promise.resolve();
  var now = Date.now();
  var last = catalogState.lastPersonOpen;
  if (last && String(last.id) === String(personId) && now - last.at < 1000) return Promise.resolve();
  catalogState.lastPersonOpen = {
    id: personId,
    at: now
  };
  if (window.Nav) Nav.push('grid', {
    key: 'person:' + personId,
    label: personName || personId
  });
  return showPersonCatalog(personId, personName);
}
function loadPersonCatalog(personId, personName) {
  if (!personId) return Promise.resolve();
  return showPersonCatalog(personId, personName);
}
function showPersonCatalog(personId, personName) {
  abortCatalogRequests();
  if (typeof hideCatalogDetailView === 'function') hideCatalogDetailView();
  var dvEl = getEl('detail-view');
  if (dvEl) dvEl.classList.remove('torrent-detail-mode');
  var mcEl = getEl('main-container');
  if (mcEl) mcEl.style.pointerEvents = 'auto';
  if (typeof Animations !== 'undefined' && typeof Animations.animateDetailHide === 'function') {
    Animations.animateDetailHide();
  } else {
    var dv = getEl('detail-view');
    if (dv) dv.style.display = 'none';
  }
  var samePerson = catalogState.person && String(catalogState.person.id) === String(personId);
  if (!samePerson) {
    catalogState.person = {
      id: String(personId),
      name: personName || '',
      lastIndex: 0,
      lastId: null
    };
  } else if (personName) {
    catalogState.person.name = personName;
  }
  catalogState.lastSelectedIndex = catalogState.person.lastIndex || 0;
  catalogState.lastSelectedId = catalogState.person.lastId || null;
  try {
    if (catalogState.lastSelectedIndex) {
      localStorage.setItem('lastCatalogCardIndex', String(catalogState.lastSelectedIndex));
    } else {
      localStorage.removeItem('lastCatalogCardIndex');
    }
  } catch (e) {}
  catalogState.currentCatalog = 'person';
  catalogState.cardElements = {};
  catalogState.items = [];
  catalogState.totalItems = 0;
  catalogState.currentPage = 0;
  catalogState.hasMore = false;
  catalogState.isLoadingMore = false;
  catalogState.loadedItemIds = {};
  catalogState.loadedPostersCount = 0;
  catalogState.posterLoadQueue = [];
  catalogState.fullItems = null;
  catalogState.fullItemsTruncated = false;
  AppState.mediaType = 'movie';
  AppState.openInRow = false;
  AppState.backCurrentCatalog = 'person';
  var searchOverlay = getEl('search-overlay');
  if (searchOverlay && !searchOverlay.hidden && searchOverlay.style.display !== 'none' && typeof hideSearchResults === 'function') {
    hideSearchResults({
      returnTo: 'catalog'
    });
  }
  if (typeof showContentScreen === 'function') showContentScreen('catalog');else AppState.currentScreen = 'catalog';
  if (window.HomeScreen && typeof HomeScreen.stopTrailer === 'function') HomeScreen.stopTrailer();
  AppState.inSearch = 'catalog';
  showCatalogLoading('Загрузка фильмографии...');
  var ref = parsePersonRef(personId);
  return safeFetch(SERVER_URL + '/api/tmdb/person/credits?id=' + encodeURIComponent(ref.id) + (ref.crew ? '&role=crew' : ''), {
    timeout: 15000
  }).then(function (d) {
    if (d && ref.crew && d.role !== 'crew') d = null;
    if (!d || !d.success || !d.items || !d.items.length) {
      showEmptyPerson(personName);
      return;
    }
    catalogState.items = d.items;
    catalogState.totalItems = d.items.length;
    for (var i = 0; i < d.items.length; i++) {
      if (d.items[i].id) catalogState.loadedItemIds[d.items[i].id] = true;
    }
    renderCatalogGrid();
    if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
    if (typeof updateFocusableElements === 'function') updateFocusableElements();
    if (typeof window.ensureCatalogFocus === 'function') window.ensureCatalogFocus(true);
  }).catch(function (e) {
    console.error('Ошибка загрузки фильмографии:', e);
    showCatalogError('Не удалось загрузить фильмографию');
  }).finally(function () {
    hideCatalogLoading();
  });
}
function parsePersonRef(personId) {
  var m = /^crew:(\d+)$/.exec(String(personId || ''));
  return m ? {
    id: m[1],
    crew: true
  } : {
    id: String(personId || ''),
    crew: false
  };
}
function showEmptyPerson(personName) {
  var g = getCatalogGridEl();
  if (!g) return;
  showCatalogGridView();
  g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px;">' + '<div style="font-size:64px;margin-bottom:20px">🎭</div>' + '<div style="font-size:18px;color:#aaa;margin-bottom:10px">Ничего не нашлось</div>' + '<div style="font-size:14px;color:#666">' + escapeHtml(personName || 'У этого актёра') + ' — фильмов и сериалов нет</div></div>';
}
window.openPersonCatalog = openPersonCatalog;
window.loadPersonCatalog = loadPersonCatalog;
function showEmptyHistory() {
  var g = getCatalogGridEl();
  if (!g) return;
  showCatalogGridView();
  g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px;"><div style="font-size:64px;margin-bottom:20px">📜</div><div style="font-size:18px;color:#aaa;margin-bottom:10px">История просмотра пуста</div><div style="font-size:14px;color:#666">Фильмы и сериалы, которые вы посмотрите, появятся здесь</div></div>';
}
function clearHistory() {
  return _clearHistory.apply(this, arguments);
}
function _clearHistory() {
  _clearHistory = _asyncToGenerator(function* () {
    if (!confirm('Очистить историю просмотра?')) return;
    try {
      var d = yield safeFetch(withClientId(SERVER_URL + '/api/history/clear'), {
        method: 'DELETE'
      });
      if (d && d.success) yield loadHistoryCatalog();else alert('Ошибка очистки');
    } catch (e) {
      console.error(e);
      alert('Ошибка очистки: ' + e.message);
    }
  });
  return _clearHistory.apply(this, arguments);
}
function getHistoryCardEntry(card) {
  if (!card || !card.dataset) return null;
  var d = card.dataset;
  if ((d.homeKey === 'history' || d.catalogKey === 'history') && d.itemId) {
    return {
      tmdbId: d.itemId,
      mediaType: d.mediaType === 'tv' ? 'tv' : 'movie',
      title: d.title || ''
    };
  }
  if (catalogState.currentCatalog === 'history' && d.catalogIndex !== undefined && !d.catalogKey && !d.homeKey) {
    var it = catalogState.items[parseInt(d.catalogIndex, 10)];
    if (it && it.isHistoryItem) {
      return {
        tmdbId: String(it.id),
        mediaType: it.media_type === 'tv' ? 'tv' : 'movie',
        title: getCatalogItemTitle(it)
      };
    }
  }
  return null;
}
function removeCatalogRowItem(key, id, mediaType, focusNext) {
  var row = document.querySelector('.catalog-row[data-catalog-key="' + key + '"]');
  if (!row) return false;
  var target = null;
  var cards = row.querySelectorAll('.catalog-row-card[data-item-id]');
  for (var i = 0; i < cards.length; i++) {
    if (String(cards[i].dataset.itemId) === String(id) && cards[i].dataset.mediaType === mediaType) {
      target = cards[i];
      break;
    }
  }
  if (!target) return false;
  var idx = parseInt(target.dataset.itemIndex, 10);
  var next = target.nextElementSibling || target.previousElementSibling;
  var data = window.catalogRowsData && window.catalogRowsData[key];
  if (data && !isNaN(idx)) data.splice(idx, 1);
  for (var k = 0; k < cards.length; k++) {
    var ki = parseInt(cards[k].dataset.itemIndex, 10);
    if (!isNaN(ki) && ki > idx) cards[k].dataset.itemIndex = ki - 1;
  }
  var rows = window.catalogRows || [];
  for (var r = 0; r < rows.length; r++) {
    var pos = rows[r].indexOf(target);
    if (pos === -1) continue;
    rows[r].splice(pos, 1);
    if (!data || !data.length) {
      rows.splice(r, 1);
      row.parentNode.removeChild(row);
      next = null;
    }
    break;
  }
  if (target.parentNode) target.parentNode.removeChild(target);
  if (window.catalogRowTotals && window.catalogRowTotals[key]) {
    window.catalogRowTotals[key]--;
    var cnt = row.querySelector('.show-all-count');
    if (cnt) cnt.textContent = window.catalogRowTotals[key] ? 'Всего: ' + window.catalogRowTotals[key] : '';
  }
  if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
  if (focusNext) {
    if (next && document.body.contains(next)) focusEl(next);else if (window.ScreenStrategies && ScreenStrategies.catalog) ScreenStrategies.catalog.ensureFocus(true);
  }
  return true;
}
function removeHistoryRowItem(id, mediaType, focusNext) {
  return removeCatalogRowItem('history', id, mediaType, focusNext);
}
function removeHistoryCard(_x24) {
  return _removeHistoryCard.apply(this, arguments);
}
function _removeHistoryCard() {
  _removeHistoryCard = _asyncToGenerator(function* (card) {
    var entry = getHistoryCardEntry(card);
    if (!entry) return false;
    var wasFocused = card.classList.contains('focused');
    try {
      var d = yield safeFetch(withClientId(SERVER_URL + '/api/history/remove'), {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tmdbId: entry.tmdbId,
          mediaType: entry.mediaType
        })
      });
      if (!d || !d.success) throw new Error('нет ответа');
    } catch (e) {
      console.warn('История: не удалено', e);
      if (typeof showToast === 'function') showToast('Не удалось удалить из истории');
      return false;
    }
    console.log('🗑️ Из истории: ' + entry.title + ' (' + entry.mediaType + ' ' + entry.tmdbId + ')');
    var onHome = !!card.dataset.homeKey;
    var inRow = card.dataset.catalogKey === 'history';
    if (window.HomeScreen && typeof HomeScreen.removeHistoryItem === 'function') {
      HomeScreen.removeHistoryItem(entry.tmdbId, entry.mediaType, onHome && wasFocused);
    }
    removeHistoryRowItem(entry.tmdbId, entry.mediaType, inRow && wasFocused);
    if (!onHome && !inRow) {
      var gi = parseInt(card.dataset.catalogIndex, 10) || 0;
      yield loadHistoryCatalog();
      if (wasFocused && catalogState.currentCatalog === 'history') {
        setTimeout(function () {
          var g = getCatalogGridEl();
          var list = g ? g.querySelectorAll('[data-catalog-index]') : [];
          if (list.length) focusEl(list[Math.min(gi, list.length - 1)]);
        }, 120);
      }
    }
    if (typeof showToast === 'function') showToast('Удалено из истории: ' + entry.title);
    return true;
  });
  return _removeHistoryCard.apply(this, arguments);
}
window.getHistoryCardEntry = getHistoryCardEntry;
window.removeHistoryCard = removeHistoryCard;
function getCardCatalogItem(card) {
  if (!card || !card.dataset) return null;
  var d = card.dataset,
    list = null,
    idx = NaN;
  if (d.homeCat !== undefined) return null;
  if (d.homeKey) {
    var hs = window.HomeScreen && HomeScreen.state;
    list = hs && hs.data ? hs.data[d.homeKey] : null;
    idx = parseInt(d.itemIndex, 10);
  } else if (d.catalogKey) {
    list = window.catalogRowsData ? window.catalogRowsData[d.catalogKey] : null;
    idx = parseInt(d.itemIndex, 10);
  } else if (d.catalogIndex !== undefined) {
    var g = getCatalogGridEl();
    if (!g || !g.contains(card)) return null;
    list = catalogState.items;
    idx = parseInt(d.catalogIndex, 10);
  }
  var it = list && !isNaN(idx) ? list[idx] : null;
  if (!it || it.catKey || it.id === undefined || it.id === null || it.id === '') return null;
  return it;
}
function toggleFavoriteCard(card) {
  var item = getCardCatalogItem(card);
  if (!item || !window.FavoritesDB) return Promise.resolve(false);
  var rec = buildFavoriteRecord(item);
  var wasFocused = card.classList.contains('focused');
  var inFavGrid = catalogState.currentCatalog === 'favorites' && card.dataset.catalogIndex !== undefined && !card.dataset.catalogKey && !card.dataset.homeKey;
  var inFavRow = card.dataset.catalogKey === 'favorites';
  return FavoritesDB.ready().then(function () {
    return FavoritesDB.toggle(rec);
  }).then(function (nowFav) {
    invalidateFavoritesRow();
    var cur = AppState.currentDetailItem;
    if (cur && String(cur.id) === String(rec.id)) syncFavoriteButton(cur);
    if (typeof showToast === 'function') {
      showToast((nowFav ? 'Добавлено в избранное: ' : 'Убрано из избранного: ') + rec.title);
    }
    if (!nowFav && inFavRow) removeCatalogRowItem('favorites', rec.id, rec.media_type, wasFocused);
    if (!nowFav && inFavGrid) {
      catalogState.lastSelectedIndex = parseInt(card.dataset.catalogIndex, 10) || 0;
      reloadFavoritesGrid();
    }
    return true;
  }, function (e) {
    console.warn('Избранное: не переключено', e);
    if (typeof showToast === 'function') showToast('Не удалось изменить избранное');
    return false;
  });
}
window.getCardCatalogItem = getCardCatalogItem;
window.toggleFavoriteCard = toggleFavoriteCard;
function clearAllHistory() {
  return _clearAllHistory.apply(this, arguments);
}
function _clearAllHistory() {
  _clearAllHistory = _asyncToGenerator(function* () {
    var d = yield safeFetch(withClientId(SERVER_URL + '/api/history/clear'), {
      method: 'DELETE'
    });
    if (!d || !d.success) throw new Error('сервер не ответил');
    if (window.HomeScreen && typeof HomeScreen.removeHistoryItem === 'function') {
      var hs = HomeScreen.state;
      var hItems = hs && hs.data && hs.data.history ? hs.data.history.slice() : [];
      for (var i = 0; i < hItems.length; i++) {
        HomeScreen.removeHistoryItem(hItems[i].id, hItems[i].media_type === 'tv' ? 'tv' : 'movie', false);
      }
    }
    var rItems = window.catalogRowsData && window.catalogRowsData.history ? window.catalogRowsData.history.slice() : [];
    for (var j = 0; j < rItems.length; j++) {
      removeHistoryRowItem(rItems[j].id, rItems[j].media_type === 'tv' ? 'tv' : 'movie', false);
    }
    if (catalogState.currentCatalog === 'history') showEmptyHistory();
    console.log('🧹 История просмотра очищена');
    return true;
  });
  return _clearAllHistory.apply(this, arguments);
}
function setupClearHistoryButton() {
  var btn = getEl('clear-history-settings-btn');
  var status = getEl('clear-history-status');
  if (!btn) return;
  var CLEAR_ARM_MS = 4000;
  var LABEL = btn.textContent;
  var armTimer = null;
  var busy = false;
  function disarm() {
    if (armTimer) {
      clearTimeout(armTimer);
      armTimer = null;
    }
    btn.classList.remove('btn-armed');
    btn.textContent = LABEL;
  }
  function showStatus(text) {
    if (!status) return;
    status.textContent = text;
    status.hidden = !text;
  }
  btn.addEventListener('click', function () {
    if (busy) return;
    if (!armTimer) {
      btn.classList.add('btn-armed');
      btn.textContent = 'Нажмите ещё раз, чтобы очистить';
      showStatus('');
      armTimer = setTimeout(disarm, CLEAR_ARM_MS);
      return;
    }
    disarm();
    busy = true;
    btn.textContent = 'Очищаю…';
    clearAllHistory().then(function () {
      showStatus('История очищена');
      if (typeof showToast === 'function') showToast('История просмотра очищена');
    }, function (e) {
      console.warn('История не очищена', e);
      showStatus('Не удалось очистить историю — сервер не ответил');
    }).then(function () {
      busy = false;
      btn.textContent = LABEL;
    });
  });
}
window.clearAllHistory = clearAllHistory;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupClearHistoryButton);else setupClearHistoryButton();
document.addEventListener('contextmenu', function (e) {
  var card = e.target && e.target.closest ? e.target.closest('.torrent-card') : null;
  if (!card) return;
  if (getHistoryCardEntry(card)) {
    e.preventDefault();
    removeHistoryCard(card);
    return;
  }
  if (!getCardCatalogItem(card)) return;
  e.preventDefault();
  toggleFavoriteCard(card);
});
function loadMoreCatalogItems(_x25) {
  return _loadMoreCatalogItems.apply(this, arguments);
}
function _loadMoreCatalogItems() {
  _loadMoreCatalogItems = _asyncToGenerator(function* (reset) {
    reset = reset || false;
    if (!catalogState.currentCatalog || catalogState.isLoadingMore) return Promise.resolve(false);
    if (reset) {
      catalogState.currentPage = 0;
      catalogState.items = [];
      catalogState.loadedItemIds = {};
      catalogState.hasMore = true;
      catalogState.totalItems = 0;
    }
    if (!catalogState.hasMore) return Promise.resolve(false);
    catalogState.isLoadingMore = true;
    var cfg = CATALOG_CONFIG[catalogState.currentCatalog];
    var from = catalogState.currentPage * catalogState.itemsPerPage;
    try {
      var url = cfg.url + '/items?from=' + from + '&limit=' + catalogState.itemsPerPage;
      var opts = {};
      if (catalogState.abortController) opts.signal = catalogState.abortController.signal;
      var d = yield safeFetch(url, opts);
      if (!d || !d.success) throw new Error('Server error');
      var newItems = d.items || [],
        pag = d.pagination || {};
      if (pag.total) catalogState.totalItems = pag.total;
      catalogState.hasMore = pag.hasMore !== undefined ? pag.hasMore : newItems.length === catalogState.itemsPerPage;
      var unique = [];
      for (var i = 0; i < newItems.length; i++) {
        if (!newItems[i].id || !catalogState.loadedItemIds[newItems[i].id]) {
          if (newItems[i].id) catalogState.loadedItemIds[newItems[i].id] = true;
          unique.push(newItems[i]);
        }
      }
      for (var j = 0; j < unique.length; j++) catalogState.items.push(unique[j]);
      catalogState.currentPage++;
      if (reset) renderCatalogGrid();else appendCatalogItems(unique);
      return Promise.resolve(true);
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error('Catalog load error:', e);
        yield fallbackLoadAllCatalogItems();
      }
      return Promise.resolve(false);
    } finally {
      catalogState.isLoadingMore = false;
    }
  });
  return _loadMoreCatalogItems.apply(this, arguments);
}
function fallbackLoadAllCatalogItems() {
  return _fallbackLoadAllCatalogItems.apply(this, arguments);
}
function _fallbackLoadAllCatalogItems() {
  _fallbackLoadAllCatalogItems = _asyncToGenerator(function* () {
    if (!catalogState.currentCatalog) return;
    var cfg = CATALOG_CONFIG[catalogState.currentCatalog];
    try {
      var opts = {};
      if (catalogState.abortController) opts.signal = catalogState.abortController.signal;
      var d = yield safeFetch(cfg.url + '/items', opts);
      if (!d || !d.success) throw new Error('Server error');
      catalogState.items = d.items || [];
      catalogState.totalItems = catalogState.items.length;
      catalogState.hasMore = false;
      catalogState.currentPage = 1;
      catalogState.loadedItemIds = {};
      for (var i = 0; i < catalogState.items.length; i++) {
        if (catalogState.items[i].id) catalogState.loadedItemIds[catalogState.items[i].id] = true;
      }
      renderCatalogGrid();
    } catch (e) {
      console.error('Fallback error:', e);
      showCatalogError('Ошибка загрузки каталога');
    }
  });
  return _fallbackLoadAllCatalogItems.apply(this, arguments);
}
var _cardTemplate = null;
function getCardTemplate() {
  if (_cardTemplate) return _cardTemplate;
  var card = document.createElement('div');
  card.innerHTML = '<div class="torrent-poster">' + '<div class="no-poster catalog-poster-loading"></div>' + '<div class="poster-year"></div>' + '<div class="poster-bar"><span class="rating-badge"></span>' + '<span class="torrent-badge"></span></div>' + '</div>' + '<div class="torrent-info">' + '<div class="torrent-title marquee-text"><span></span></div>' + '</div>';
  _cardTemplate = card;
  return card;
}
function createCardElement(config) {
  var card = getCardTemplate().cloneNode(true);
  card.className = 'torrent-card card-modern ' + (config.className || '');
  for (var key in config.dataset) {
    if (config.dataset.hasOwnProperty(key)) {
      card.dataset[key] = config.dataset[key];
    }
  }
  var poster = card.firstChild;
  var info = card.lastChild;
  var yearEl = poster.childNodes[1];
  var bar = poster.childNodes[2];
  if (config.ratingText) {
    var badge = bar.firstChild;
    badge.style.color = config.ratingColor || '';
    badge.textContent = config.ratingText;
  }
  if (config.posterUrl) {
    var img = document.createElement('img');
    img.className = 'catalog-poster-img';
    img.decoding = 'async';
    img.alt = '';
    img.src = config.posterUrl;
    poster.appendChild(img);
    var showPoster = function () {
      queuePosterReveal(function () {
        if (!img.isConnected) return;
        showPosterImg(img);
        var ph = poster.querySelector('.no-poster');
        if (ph) dropPosterPlaceholder(ph);
      });
    };
    if (typeof img.decode === 'function') img.decode().then(showPoster).catch(showPoster);else img.onload = showPoster;
  }
  info.firstChild.firstChild.textContent = config.title || '';
  bar.lastChild.textContent = config.metaType || '';
  yearEl.textContent = /^\d{4}$/.test(config.metaBadge || '') ? config.metaBadge : '';
  return card;
}
var catalogFadedEl = null;
function getCatalogRowsEl() {
  return getEl('catalog-rows');
}
function getCatalogGridEl() {
  return getEl('catalog-grid');
}
function fadeOutCatalogGrid(onDone, el) {
  var target = el || getCatalogGridEl();
  if (!target || typeof Animations === 'undefined' || typeof Animations.fadeOut !== 'function') {
    if (onDone) onDone();
    return;
  }
  Animations.fadeOut(target, {
    duration: Animations.UI_FADE && Animations.UI_FADE.contentOut || 0.3,
    keepFaded: true,
    onDone: function () {
      catalogFadedEl = target;
      if (onDone) onDone();
    }
  });
}
function revealCatalogGrid(display, el) {
  var target = el || getCatalogGridEl();
  if (!target) return;
  if (catalogFadedEl !== target || typeof Animations === 'undefined' || typeof Animations.fadeIn !== 'function') {
    if (typeof display === 'string') target.style.display = display;
    return;
  }
  catalogFadedEl = null;
  var options = {
    duration: Animations.UI_FADE.content
  };
  if (typeof display === 'string') options.display = display;
  Animations.fadeIn(target, options);
}
function ensureCatalogGridVisible(el) {
  var target = el || getCatalogGridEl();
  if (catalogFadedEl === target) catalogFadedEl = null;
  if (target && typeof Animations !== 'undefined' && typeof Animations.resetFade === 'function') {
    Animations.resetFade(target);
  } else if (target) {
    target.style.opacity = '';
  }
}
function showCatalogGridView() {
  var rows = getCatalogRowsEl(),
    grid = getCatalogGridEl();
  if (rows && rows.style.display !== 'none') {
    if (typeof Animations !== 'undefined' && typeof Animations.resetFade === 'function') {
      Animations.resetFade(rows);
    }
    if (catalogFadedEl === rows) catalogFadedEl = null;
    rows.style.display = 'none';
  }
  if (grid) grid.style.display = '';
  if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
}
var catalogRowsRevealPending = false;
function showCatalogRowsView(opts) {
  var deferReveal = !!(opts && opts.deferReveal);
  catalogRowsRevealPending = false;
  var rows = getCatalogRowsEl(),
    grid = getCatalogGridEl();
  if (grid) {
    if (typeof Animations !== 'undefined' && typeof Animations.resetFade === 'function') {
      Animations.resetFade(grid);
    }
    if (catalogFadedEl === grid) catalogFadedEl = null;
    grid.style.display = 'none';
    grid.innerHTML = '';
    resetGridVisibilityWindow();
    resetGridChunks();
  }
  if (!rows) return;
  var mc = getEl('main-container');
  if (mc && !deferReveal) mc.scrollTop = 0;
  revealAllCatalogRows();
  var wasHidden = rows.style.display === 'none';
  if (deferReveal) {
    ensureCatalogGridVisible(rows);
    rows.style.display = '';
    if (wasHidden) {
      rows.style.opacity = '0';
      catalogRowsRevealPending = true;
    }
    if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
    return;
  }
  if (wasHidden && typeof Animations !== 'undefined' && typeof Animations.fadeIn === 'function') {
    Animations.fadeIn(rows, {
      duration: Animations.UI_FADE.content,
      display: '',
      startAfterLayout: true
    });
  } else {
    ensureCatalogGridVisible(rows);
    rows.style.display = '';
  }
  if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
}
function revealCatalogRowsView() {
  var rows = getCatalogRowsEl();
  if (!rows) return;
  if (!catalogRowsRevealPending) return;
  catalogRowsRevealPending = false;
  if (typeof Animations !== 'undefined' && typeof Animations.fadeIn === 'function') {
    Animations.fadeIn(rows, {
      duration: Animations.UI_FADE.content,
      startAfterLayout: true
    });
  } else {
    rows.style.opacity = '';
  }
}
var CHUNK_ROWS = 5;
var CHUNK_HYDRATED_MAX = 4;
var CHUNK_HYDRATED_KEEP = 3;
var CHUNK_FOCUS_GUARD = 1;
var CHUNK_OBSERVER_MARGIN_PX = 600;
var CHUNK_SCROLL_QUIET_MS = 250;
function readGridRowGap() {
  var grid = getCatalogGridEl();
  if (!grid || !window.getComputedStyle) return 0;
  var cs = window.getComputedStyle(grid);
  var gap = parseFloat(cs.rowGap || cs.gridRowGap || cs.gap || '');
  if (isNaN(gap) && document.documentElement.className.indexOf('legacy-browser') !== -1) {
    var card = grid.querySelector('.torrent-card');
    if (card) gap = parseFloat(window.getComputedStyle(card).marginBottom);
  }
  return !isNaN(gap) && gap >= 0 ? gap : 0;
}
var _gridScrollAt = 0;
function initChunkScrollWatch() {
  var mc = getEl('main-container');
  if (!mc || mc._chunkScrollWatch) return;
  mc._chunkScrollWatch = true;
  mc.addEventListener('scroll', function () {
    _gridScrollAt = Date.now();
  }, false);
}
function isGridScrolling() {
  return Date.now() - _gridScrollAt < CHUNK_SCROLL_QUIET_MS;
}
function getChunkSize() {
  var cols = typeof getColumns === 'function' && getColumns() || 5;
  return cols * CHUNK_ROWS;
}
function resetGridChunks() {
  if (catalogState.chunkObserver) {
    catalogState.chunkObserver.disconnect();
    catalogState.chunkObserver = null;
  }
  if (catalogState.chunkTrimTimer) {
    clearTimeout(catalogState.chunkTrimTimer);
    catalogState.chunkTrimTimer = null;
  }
  for (var i = 0; i < catalogState.chunks.length; i++) cancelHydration(catalogState.chunks[i]);
  catalogState.chunks = [];
  catalogState.chunkSize = 0;
  catalogState.chunkCols = 0;
}
function rebuildChunkRanges() {
  var size = catalogState.chunkSize || getChunkSize();
  var total = catalogState.items.length;
  var chunks = catalogState.chunks;
  for (var start = chunks.length * size; start < total; start += size) {
    chunks.push({
      index: chunks.length,
      start: start,
      end: Math.min(start + size, total),
      spacer: null
    });
  }
  if (chunks.length) {
    var last = chunks[chunks.length - 1];
    last.end = Math.min(last.start + size, total);
  }
}
function initChunkObserver() {
  if (catalogState.chunkObserver) catalogState.chunkObserver.disconnect();
  catalogState.chunkObserver = new IntersectionObserver(function (entries) {
    var grew = false;
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i].isIntersecting) continue;
      var ch = entries[i].target._chunk;
      if (ch && ch.spacer) {
        hydrateChunk(ch);
        grew = true;
      }
    }
    if (grew) scheduleChunkTrim();
  }, {
    root: getEl('main-container'),
    rootMargin: CHUNK_OBSERVER_MARGIN_PX + 'px 0px',
    threshold: 0
  });
}
function chunkAlignedToRows(ch, cols) {
  if (!cols || cols < 1) return false;
  if (ch.start % cols !== 0) return false;
  if (ch.end < catalogState.items.length && (ch.end - ch.start) % cols !== 0) return false;
  return true;
}
function realignChunksToColumns() {
  var cols = typeof getColumns === 'function' && getColumns() || 0;
  if (!cols || !catalogState.chunks || !catalogState.chunks.length) return false;
  if (cols === catalogState.chunkCols) return false;
  var chunks = catalogState.chunks;
  for (var i = 0; i < chunks.length; i++) {
    if (chunks[i].spacer) hydrateChunk(chunks[i], true);
  }
  catalogState.chunks = [];
  catalogState.chunkCols = cols;
  catalogState.chunkSize = cols * CHUNK_ROWS;
  rebuildChunkRanges();
  if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
  updatePosterObservers();
  updateGridVisibilityWindow();
  return true;
}
function releaseCardPoster(card) {
  if (!card) return;
  var img = card.querySelector('img.catalog-poster-img');
  if (!img) return;
  img.onload = null;
  img.onerror = null;
  if (img.getAttribute('src')) img.removeAttribute('src');
  if (img.parentNode) img.parentNode.removeChild(img);
}
function dehydrateChunk(ch, gapHint) {
  if (!ch || ch.spacer || ch.hydrating) return false;
  var cols = typeof getColumns === 'function' && getColumns() || 0;
  if (!chunkAlignedToRows(ch, cols)) return false;
  var first = catalogState.cardElements[ch.start];
  var last = catalogState.cardElements[ch.end - 1];
  if (!first || !last || !first.isConnected || !last.isConnected) return false;
  var rows = Math.ceil((ch.end - ch.start) / cols);
  var gap = typeof gapHint === 'number' && gapHint >= 0 ? gapHint : readGridRowGap();
  var boxH = catalogState.rowBoxH || 0;
  var height = boxH > 0 && rows > 0 ? rows * boxH + (rows - 1) * gap : last.getBoundingClientRect().bottom - first.getBoundingClientRect().top;
  if (!(height > 0)) return false;
  ch.rowStride = boxH > 0 ? boxH + gap : 0;
  ch.gapH = gap;
  var spacer = document.createElement('div');
  spacer.className = 'catalog-chunk-spacer';
  spacer.style.cssText = 'grid-column:1/-1;height:' + height + 'px;';
  spacer._chunk = ch;
  ch.spacerH = height;
  var grid = getCatalogGridEl();
  if (!grid) return false;
  grid.insertBefore(spacer, first);
  for (var i = ch.start; i < ch.end; i++) {
    var card = catalogState.cardElements[i];
    if (card) {
      releaseCardPoster(card);
      if (card.parentNode === grid) grid.removeChild(card);
    }
    delete catalogState.cardElements[i];
  }
  ch.spacer = spacer;
  ch.filled = ch.start;
  if (catalogState.chunkObserver) catalogState.chunkObserver.observe(spacer);
  return true;
}
function hydrateChunk(ch, immediate) {
  if (!ch) return false;
  if (ch.hydrating) {
    if (immediate) finishHydrationNow(ch);
    return true;
  }
  if (!ch.spacer) return false;
  var grid = getCatalogGridEl();
  var spacer = ch.spacer;
  if (!grid || spacer.parentNode !== grid) {
    ch.spacer = null;
    return false;
  }
  var cols = typeof getColumns === 'function' && getColumns() || 5;
  var total = ch.end - ch.start;
  if (typeof ch.filled !== 'number' || ch.filled < ch.start) ch.filled = ch.start;
  if (immediate || total <= cols || typeof requestAnimationFrame !== 'function') {
    insertChunkCards(ch, ch.filled, ch.end);
    finishHydration(ch);
    return true;
  }
  if (typeof ch.filled !== 'number' || ch.filled < ch.start) ch.filled = ch.start;
  var h = typeof ch.spacerH === 'number' && ch.spacerH > 0 ? ch.spacerH : spacer.offsetHeight;
  var rowsTotal = Math.ceil(total / cols);
  var stride = ch.rowStride;
  if (!(stride > 0)) {
    var gapFallback = typeof ch.gapH === 'number' && ch.gapH >= 0 ? ch.gapH : readGridRowGap();
    stride = rowsTotal > 0 ? (h + gapFallback) / rowsTotal : h;
  }
  ch.hydrating = {
    cols: cols,
    h: h,
    rowH: stride,
    raf: 0
  };
  hydrationStep(ch);
  return true;
}
function insertChunkCards(ch, from, to) {
  var grid = getCatalogGridEl();
  if (!grid || !ch.spacer || ch.spacer.parentNode !== grid) return;
  var frag = document.createDocumentFragment();
  var added = [];
  for (var i = from; i < to; i++) {
    var item = catalogState.items[i];
    if (!item) continue;
    var card = createCatalogCard(item, i);
    frag.appendChild(card);
    added.push(card);
  }
  grid.insertBefore(frag, ch.spacer);
  observeNewGridCards(added);
}
function observeNewGridCards(cards) {
  if (!cards || !cards.length) return;
  if (!catalogState.gridVisibilityObserver) updateGridVisibilityWindow();
  var po = catalogState.posterObserver;
  var vo = catalogState.gridVisibilityObserver;
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    if (po && card.dataset.posterRequested !== '1' && !card.querySelector('img.catalog-poster-img')) {
      try {
        po.observe(card);
      } catch (e) {}
    }
    if (vo) {
      card.classList.remove(OFFSCREEN_CLASS);
      try {
        vo.observe(card);
      } catch (e) {}
    }
  }
}
function hydrationStep(ch) {
  var st = ch.hydrating;
  if (!st) return;
  st.raf = 0;
  var grid = getCatalogGridEl();
  if (!grid || !ch.spacer || ch.spacer.parentNode !== grid) {
    ch.hydrating = null;
    ch.spacer = null;
    return;
  }
  var to = Math.min(ch.filled + st.cols, ch.end);
  insertChunkCards(ch, ch.filled, to);
  ch.filled = to;
  if (ch.filled >= ch.end) {
    finishHydration(ch);
    return;
  }
  st.h -= st.rowH;
  ch.spacer.style.height = Math.max(0, st.h) + 'px';
  st.raf = requestAnimationFrame(function () {
    hydrationStep(ch);
  });
}
function finishHydrationNow(ch) {
  var st = ch.hydrating;
  if (!st) return;
  if (st.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(st.raf);
  insertChunkCards(ch, ch.filled, ch.end);
  finishHydration(ch);
}
function finishHydration(ch) {
  var grid = getCatalogGridEl();
  var spacer = ch.spacer;
  if (spacer && spacer.parentNode === grid) {
    if (catalogState.chunkObserver) catalogState.chunkObserver.unobserve(spacer);
    grid.removeChild(spacer);
  }
  ch.spacer = null;
  ch.hydrating = null;
  ch.filled = ch.end;
  if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
}
function cancelHydration(ch) {
  if (!ch || !ch.hydrating) return;
  if (ch.hydrating.raf && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(ch.hydrating.raf);
  }
  ch.hydrating = null;
}
function viewportChunkIndex() {
  var mc = getEl('main-container');
  var chunks = catalogState.chunks;
  if (!mc || !chunks || !chunks.length) return -1;
  var viewTop = mc.getBoundingClientRect().top;
  var best = -1,
    bestDist = Infinity;
  for (var i = 0; i < chunks.length; i++) {
    if (chunks[i].spacer) continue;
    var card = catalogState.cardElements[chunks[i].start];
    if (!card || !card.isConnected) continue;
    var d = Math.abs(card.getBoundingClientRect().top - viewTop);
    if (d < bestDist) {
      bestDist = d;
      best = chunks[i].index;
    }
  }
  return best;
}
function anchorChunkIndexes() {
  var out = [];
  var size = catalogState.chunkSize || getChunkSize();
  var f = document.querySelector('#catalog-grid .torrent-card.catalog-card.focused');
  if (f && f.dataset.catalogIndex) {
    var idx = parseInt(f.dataset.catalogIndex, 10);
    if (!isNaN(idx)) out.push(Math.floor(idx / size));
  }
  var vp = viewportChunkIndex();
  if (vp !== -1 && out.indexOf(vp) === -1) out.push(vp);
  return out;
}
function chunkDistanceToAnchors(index, anchors) {
  var best = Infinity;
  for (var i = 0; i < anchors.length; i++) {
    var d = Math.abs(index - anchors[i]);
    if (d < best) best = d;
  }
  return best;
}
function scheduleChunkTrim() {
  if (catalogState.chunkTrimTimer) return;
  catalogState.chunkTrimTimer = setTimeout(function () {
    catalogState.chunkTrimTimer = null;
    trimGridChunks();
  }, CATALOG_CONSTANTS.ROW_POSTER_RETRY_MS);
}
function trimGridChunks() {
  realignChunksToColumns();
  var chunks = catalogState.chunks;
  if (!chunks || chunks.length <= CHUNK_HYDRATED_MAX) return;
  var live = [];
  for (var i = 0; i < chunks.length; i++) if (!chunks[i].spacer) live.push(chunks[i]);
  if (live.length <= CHUNK_HYDRATED_MAX) return;
  if (window.navHold || isCatalogScrollAnimating() || isGridScrolling()) {
    scheduleChunkTrim();
    return;
  }
  var anchors = anchorChunkIndexes();
  if (!anchors.length) return;
  live.sort(function (a, b) {
    return chunkDistanceToAnchors(b.index, anchors) - chunkDistanceToAnchors(a.index, anchors);
  });
  var focusedEl = document.querySelector('#catalog-grid .torrent-card.catalog-card.focused');
  var focusedIdx = focusedEl && focusedEl.dataset ? parseInt(focusedEl.dataset.catalogIndex, 10) : NaN;
  var rowGap = readGridRowGap();
  var removed = 0;
  for (var j = 0; j < live.length && live.length - removed > CHUNK_HYDRATED_KEEP; j++) {
    if (chunkDistanceToAnchors(live[j].index, anchors) <= CHUNK_FOCUS_GUARD) continue;
    if (dehydrateChunk(live[j], rowGap)) {
      removed++;
      break;
    }
  }
  if (!removed) return;
  if (live.length - removed > CHUNK_HYDRATED_KEEP) scheduleChunkTrim();
  if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
  updateGridVisibilityWindow();
  var still = document.querySelector('#catalog-grid .torrent-card.catalog-card.focused');
  if (still && still.isConnected) return;
  var target = !isNaN(focusedIdx) ? catalogState.cardElements[focusedIdx] : null;
  if (!target || !target.isConnected) {
    var cards = document.querySelectorAll('#catalog-grid .torrent-card.catalog-card');
    var best = null,
      bestD = Infinity;
    for (var k = 0; k < cards.length; k++) {
      var n = parseInt(cards[k].dataset.catalogIndex, 10);
      if (isNaN(n)) continue;
      var d = isNaN(focusedIdx) ? k : Math.abs(n - focusedIdx);
      if (d < bestD) {
        bestD = d;
        best = cards[k];
      }
    }
    target = best;
  }
  if (target && typeof focusEl === 'function') focusEl(target);
}
function ensureChunksAroundFocus(card) {
  realignChunksToColumns();
  var chunks = catalogState.chunks;
  if (!chunks || !chunks.length || !card.dataset) return;
  var idx = parseInt(card.dataset.catalogIndex, 10);
  if (isNaN(idx)) return;
  var size = catalogState.chunkSize || getChunkSize();
  var here = Math.floor(idx / size);
  var grew = false;
  for (var i = here - 1; i <= here + 1; i++) {
    if (i < 0 || i >= chunks.length) continue;
    var now = i === here;
    if (chunks[i].spacer || chunks[i].hydrating) {
      if (hydrateChunk(chunks[i], now)) grew = true;
    }
  }
  if (grew) {
    scheduleChunkTrim();
  }
}
window.trimGridChunks = trimGridChunks;
window.realignCatalogChunks = realignChunksToColumns;
function renderCatalogGrid() {
  var grid = getCatalogGridEl();
  if (!grid) return;
  ensureCatalogGridVisible();
  showCatalogGridView();
  grid.innerHTML = '';
  if (catalogState.items.length === 0) {
    showEmptyCatalog();
    return;
  }
  addCatalogHeader(grid);
  var frag = document.createDocumentFragment();
  for (var i = 0; i < catalogState.items.length; i++) {
    frag.appendChild(createCatalogCard(catalogState.items[i], i));
  }
  grid.appendChild(frag);
  if (catalogState.hasMore) addLoadMoreTrigger(grid);
  catalogState.loadedPostersCount = 0;
  if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
  resetDeferredPosters();
  resetGridChunks();
  catalogState.chunkCols = typeof getColumns === 'function' && getColumns() || 5;
  catalogState.chunkSize = catalogState.chunkCols * CHUNK_ROWS;
  rebuildChunkRanges();
  initChunkObserver();
  initChunkScrollWatch();
  initPosterLazyLoading();
  initGridVisibilityWindow();
  initLoadMoreObserver();
  loadInitialPosters();
  requestAnimationFrame(function () {
    measureCatalogCardHeight();
    watchCatalogCardHeight();
    if (AppState.currentScreen === 'catalog' && catalogState.currentCatalog) {
      if (typeof updateFocusableElements === 'function') updateFocusableElements();
      setTimeout(function () {
        if (typeof window.focusFirstCatalogCard === 'function') window.focusFirstCatalogCard();
      }, CATALOG_CONSTANTS.FOCUS_DELAY_MS);
    }
  });
}
function appendCatalogItems(newItems) {
  var grid = getCatalogGridEl();
  if (!grid) return;
  showCatalogGridView();
  var old = getEl('load-more-trigger');
  if (old) old.remove();
  var start = catalogState.items.length - newItems.length;
  var currentCatalogKey = catalogState.currentCatalog;
  if (catalogState.currentCatalog !== currentCatalogKey) return;
  var lastChunk = catalogState.chunks.length ? catalogState.chunks[catalogState.chunks.length - 1] : null;
  if (lastChunk && (lastChunk.spacer || lastChunk.hydrating)) hydrateChunk(lastChunk, true);
  var frag = document.createDocumentFragment();
  for (var i = 0; i < newItems.length; i++) {
    frag.appendChild(createCatalogCard(newItems[i], start + i));
  }
  grid.appendChild(frag);
  if (catalogState.hasMore) addLoadMoreTrigger(grid);
  if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
  updatePosterObservers();
  updateGridVisibilityWindow();
  initLoadMoreObserver();
  rebuildChunkRanges();
  scheduleChunkTrim();
  if (AppState.currentScreen === 'catalog' && catalogState.currentCatalog) {
    if (typeof updateFocusableElements === 'function') updateFocusableElements();
  }
}
function catalogItemsMixed() {
  var items = catalogState.items || [];
  if (catalogState._mixedOf === items && catalogState._mixedLen === items.length) return catalogState._mixed;
  var tv = false,
    movie = false;
  for (var i = 0; i < items.length && !(tv && movie); i++) {
    if ((items[i] && items[i].media_type) === 'tv') tv = true;else movie = true;
  }
  catalogState._mixedOf = items;
  catalogState._mixedLen = items.length;
  catalogState._mixed = tv && movie;
  return catalogState._mixed;
}
function appendCatalogCardSub(card, year, rating, mt) {
  var info = card.querySelector('.torrent-info');
  if (!info) return;
  var poster = card.firstChild;
  var py = poster && poster.querySelector('.poster-year');
  var pb = poster && poster.querySelector('.poster-bar');
  if (py) poster.removeChild(py);
  if (pb) poster.removeChild(pb);
  var sub = document.createElement('div');
  sub.className = 'catalog-card-sub';
  var add = function (cls, text) {
    var s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    sub.appendChild(s);
  };
  var mixed = catalogItemsMixed();
  if (year) add('catalog-sub-year', year);
  if (year && rating) add('catalog-sub-dot catalog-sub-dot-y catalog-sub-dot-r', '·');
  if (rating) add('rating-badge', rating);
  if (mixed) {
    if (rating) add('catalog-sub-dot catalog-sub-dot-r', '·');else if (year) add('catalog-sub-dot catalog-sub-dot-y', '·');
    add('catalog-sub-type', mt === 'tv' ? 'Сериал' : 'Фильм');
  }
  if (sub.firstChild) info.appendChild(sub);
}
function createCatalogCard(item, index) {
  var title = getCatalogItemTitle(item);
  var mt = item.media_type || 'movie';
  var id = item.id;
  var rating = item.vote_average ? Math.round(item.vote_average * 10) / 10 : null;
  var cacheKey = id + '_' + mt;
  var cached = catalogState.posterCache.get(cacheKey);
  var ratingColor = rating ? getRatingColor(rating) : '';
  var year = getCatalogItemYear(item);
  var card = createCardElement({
    className: 'catalog-card',
    dataset: {
      catalogIndex: index,
      title: title,
      mediaType: mt,
      tmdbId: id,
      itemId: item.id,
      rating: rating || '',
      numIndex: item.num_index !== undefined ? item.num_index : index
    },
    title: title.substring(0, 60) + (title.length > 60 ? '...' : ''),
    ratingText: rating || '',
    ratingColor: ratingColor,
    posterUrl: cached || '',
    metaType: mt === 'tv' ? 'Сериал' : 'Фильм',
    metaBadge: year || 'Каталог'
  });
  appendCatalogCardSub(card, year, rating, mt);
  var readyImg = cached ? card.querySelector('img.catalog-poster-img') : null;
  if (readyImg) {
    card.dataset.posterRequested = '1';
    var dropSkeleton = function () {
      var ph = card.querySelector('.no-poster');
      if (ph && ph.parentNode) ph.parentNode.removeChild(ph);
    };
    if (readyImg.complete && readyImg.naturalWidth > 0) dropSkeleton();
    var revealOnload = readyImg.onload;
    readyImg.onload = function (e) {
      if (revealOnload) revealOnload.call(this, e);
      dropSkeleton();
    };
    readyImg.onerror = function () {
      if (readyImg.parentNode) readyImg.parentNode.removeChild(readyImg);
      card.dataset.posterRequested = '0';
      if (catalogState.posterObserver) {
        try {
          catalogState.posterObserver.observe(card);
        } catch (e) {}
      }
    };
  }
  catalogState.cardElements[index] = card;
  return card;
}
function onCatalogViewClick(e) {
  var folder = e.target.closest('.catalog-folder-card');
  if (folder) {
    var fkey = folder.dataset.catalogKey;
    rememberRowEntry(fkey, folder);
    if (fkey === 'history') loadHistoryCatalog();else if (fkey === 'favorites') loadFavoritesCatalog();else loadCatalog(fkey);
    return;
  }
  var card = e.target.closest('.torrent-card.catalog-card');
  if (!card) return;
  if (catalogState.currentCatalog) {
    var idx = parseInt(card.dataset.catalogIndex, 10);
    if (!isNaN(idx) && catalogState.items[idx]) onCatalogItemClick(catalogState.items[idx], idx);
    return;
  }
  var rkey = card.dataset.catalogKey;
  var itemIdx = parseInt(card.dataset.itemIndex, 10);
  if (rkey && !isNaN(itemIdx) && window.catalogRowsData && window.catalogRowsData[rkey] && window.catalogRowsData[rkey][itemIdx]) {
    onRowItemClick(window.catalogRowsData[rkey][itemIdx], rkey, itemIdx);
  }
}
document.addEventListener('DOMContentLoaded', function () {
  var grid = getCatalogGridEl();
  if (grid) grid.addEventListener('click', onCatalogViewClick);
  var rows = getCatalogRowsEl();
  if (rows) rows.addEventListener('click', onCatalogViewClick);
});
function formatLastModifiedDate(iso) {
  if (!iso) return 'Дата неизвестна';
  var d = new Date(iso),
    now = new Date(),
    h = (now - d) / 3600000;
  var dd = ('0' + d.getDate()).slice(-2),
    mm = ('0' + (d.getMonth() + 1)).slice(-2),
    yy = d.getFullYear();
  var hh = ('0' + d.getHours()).slice(-2),
    min = ('0' + d.getMinutes()).slice(-2);
  var ago = h < 1 ? Math.floor(h * 60) + ' мин. назад' : h < 24 ? Math.floor(h) + ' ч. назад' : Math.floor(h / 24) + ' дн. назад';
  return dd + '.' + mm + '.' + yy + ' ' + hh + ':' + min + ' (' + ago + ')';
}
function checkAndUpdateCatalogIfNeeded(_x26, _x27) {
  return _checkAndUpdateCatalogIfNeeded.apply(this, arguments);
}
function _checkAndUpdateCatalogIfNeeded() {
  _checkAndUpdateCatalogIfNeeded = _asyncToGenerator(function* (id, iso) {
    if (!iso) return false;
    var h = (new Date() - new Date(iso)) / 3600000;
    if (h > CATALOG_CONSTANTS.CATALOG_UPDATE_THRESHOLD_HOURS) {
      try {
        var d = yield safeFetch(SERVER_URL + '/api/catalog/' + id + '/update', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        });
        if (d && d.success) {
          if (catalogState.currentCatalog === id) {
            setTimeout(function () {
              loadCatalog(id);
            }, 500);
          }
          return true;
        }
      } catch (e) {
        console.error('Catalog update error:', e);
      }
    }
    return false;
  });
  return _checkAndUpdateCatalogIfNeeded.apply(this, arguments);
}
function addCatalogHeader(grid) {
  var header = document.createElement('div');
  header.className = 'catalog-header';
  header.style.cssText = 'grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding:1px 20px;background:rgba(74,158,255,0.1);border-radius:16px;border:1px solid rgba(74,158,255,0.3);flex-wrap:wrap;gap:10px;';
  var name = CATALOG_CONFIG[catalogState.currentCatalog] && CATALOG_CONFIG[catalogState.currentCatalog].name || 'Каталог';
  if (catalogState.currentCatalog === 'person') {
    var pname = catalogState.person && catalogState.person.name || 'Фильмография';
    header.innerHTML = '<div class="fg-col-5" style="display:flex;flex-direction:column;gap:5px">' + '<span style="font-size:20px;font-weight:600;color:#4a9eff">' + escapeHtml(pname) + '</span>' + '<div class="fg-row-15" style="display:flex;gap:15px;font-size:12px;color:#aaa"><span>фильмы и сериалы с этим актёром</span></div>' + '</div>' + '<span style="font-size:14px;color:#aaa;background:rgba(0,0,0,0.3);padding:5px 12px;border-radius:20px">' + catalogState.items.length + '</span>';
    grid.appendChild(header);
    return;
  }
  if (catalogState.currentCatalog === 'history') {
    header.innerHTML = '<div class="fg-col-5" style="display:flex;flex-direction:column;gap:5px"><span style="font-size:20px;font-weight:600;color:#4a9eff">' + name + '</span><div class="fg-row-15" style="display:flex;gap:15px;font-size:12px;color:#aaa"><span>' + catalogState.items.length + ' записей</span></div></div>';
    var btn = getEl('clear-history-btn');
    if (btn) btn.onclick = clearHistory;
    grid.appendChild(header);
    return;
  }
  header.innerHTML = '<span style="font-size:20px;font-weight:600;color:#4a9eff">' + name + '</span><span style="font-size:14px;color:#aaa;background:rgba(0,0,0,0.3);padding:5px 12px;border-radius:20px">' + catalogState.items.length + ' / ' + (catalogState.totalItems || catalogState.items.length) + '</span>';
  grid.appendChild(header);
  safeFetch(SERVER_URL + '/api/catalogs').then(function (d) {
    if (d && d.success && d.catalogs) {
      var info = null;
      for (var i = 0; i < d.catalogs.length; i++) {
        if (d.catalogs[i].id === catalogState.currentCatalog) {
          info = d.catalogs[i];
          break;
        }
      }
      if (info && info.lastModifiedISO) {
        checkAndUpdateCatalogIfNeeded(info.id, info.lastModifiedISO);
        header.innerHTML += '<div class="fg-row-15" style="display:flex;gap:15px;font-size:12px;color:#aaa;margin-top:4px"><span>' + formatLastModifiedDate(info.lastModifiedISO) + '</span></div>';
      }
    }
  });
}
function addLoadMoreTrigger(grid) {
  var t = document.createElement('div');
  t.id = 'load-more-trigger';
  t.className = 'load-more-trigger';
  t.style.cssText = 'grid-column:1/-1;height:50px;margin:20px 0;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:14px;';
  t.innerHTML = '<div class="loading-spinner-small" style="width:20px;height:20px;border:2px solid rgba(74,158,255,0.2);border-top-color:#4a9eff;border-radius:50%;animation:spinner-rotate 1s infinite;margin-right:10px;display:none"></div><span>Загрузка дополнительных элементов...</span>';
  grid.appendChild(t);
}
function showEmptyCatalog() {
  var g = getCatalogGridEl();
  if (!g) return;
  showCatalogGridView();
  g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px"><div style="font-size:48px;margin-bottom:20px">🎬</div><div style="font-size:18px;color:#aaa">Каталог пуст</div></div>';
}
function initLoadMoreObserver() {
  if (catalogState.loadMoreObserver) catalogState.loadMoreObserver.disconnect();
  var t = getEl('load-more-trigger');
  if (!t) return;
  var rowH = catalogState.rowBoxH || 0;
  var margin = rowH > 0 ? Math.round(rowH * CATALOG_CONSTANTS.PREFETCH_ROWS) : CATALOG_CONSTANTS.LOAD_MORE_MARGIN_PX;
  catalogState.loadMoreObserver = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].isIntersecting && catalogState.hasMore && !catalogState.isLoadingMore) {
        var sp = t.querySelector('.loading-spinner-small');
        if (sp) sp.style.display = 'inline-block';
        loadMoreCatalogItems().then(function () {
          if (sp) sp.style.display = 'none';
        });
      }
    }
  }, {
    rootMargin: margin + 'px',
    threshold: 0.1
  });
  catalogState.loadMoreObserver.observe(t);
}
function loadInitialPosters() {
  var idxs = [];
  var limit = Math.min(CATALOG_CONSTANTS.POSTER_BATCH_SIZE, catalogState.items.length);
  for (var i = 0; i < limit; i++) {
    var it = catalogState.items[i];
    if (!it) continue;
    var card = catalogState.cardElements[i];
    if (!card) continue;
    if (card.querySelector('img.catalog-poster-img') || card.dataset.posterRequested === '1') continue;
    card.dataset.posterRequested = '1';
    if (!loadPosterDirect(i, card)) idxs.push(i);
  }
  if (idxs.length > 0) {
    loadPosterBatch(idxs);
  }
}
function isCatalogScrollAnimating() {
  if (typeof Animations === 'undefined' || typeof Animations.isScrollTweening !== 'function') return false;
  var main = getEl('main-container');
  return !!main && Animations.isScrollTweening(main);
}
function isGridNavBusy() {
  return !!window.navHold || isCatalogScrollAnimating();
}
function deferPosterUntilScrollEnds(idx) {
  if (catalogState.posterDeferred.indexOf(idx) === -1) catalogState.posterDeferred.push(idx);
  scheduleDeferredPosters();
}
function scheduleDeferredPosters() {
  if (catalogState.posterDeferredRaf) return;
  if (typeof requestAnimationFrame !== 'function') {
    flushDeferredPosters();
    return;
  }
  catalogState.posterDeferredRaf = requestAnimationFrame(deferredPostersStep);
}
function deferredPostersStep() {
  catalogState.posterDeferredRaf = 0;
  if (isGridNavBusy()) {
    if (gridPostersOnTheMove()) {
      flushDeferredPosters(CATALOG_CONSTANTS.POSTER_MOVING_PER_FRAME);
      return;
    }
    scheduleDeferredPosters();
    return;
  }
  flushDeferredPosters();
}
function gridPostersOnTheMove() {
  if (!window.AppState || !AppState.gridScrollTransform) return false;
  if (AppState.currentScreen === 'catalog') return !!catalogState.currentCatalog;
  if (AppState.currentScreen === 'search') {
    return typeof window.isFlipScroller === 'function' && window.isFlipScroller(getEl('search-results'));
  }
  return false;
}
function flushDeferredPosters(perFrame) {
  var pending = catalogState.posterDeferred;
  if (!pending.length) return;
  var focused = document.querySelector('#catalog-grid .torrent-card.focused');
  var center = focused ? parseInt(focused.dataset.catalogIndex, 10) : NaN;
  if (isNaN(center)) pending.sort(function (a, b) {
    return a - b;
  });else pending.sort(function (a, b) {
    return Math.abs(a - center) - Math.abs(b - center);
  });
  var chunk = pending.splice(0, perFrame || CATALOG_CONSTANTS.POSTER_DEFERRED_PER_FRAME);
  var slow = [];
  for (var i = 0; i < chunk.length; i++) {
    if (!catalogState.items[chunk[i]]) continue;
    if (!loadPosterDirect(chunk[i])) slow.push(chunk[i]);
  }
  for (var j = 0; j < slow.length; j++) addToPosterQueue(slow[j]);
  if (pending.length) scheduleDeferredPosters();
}
function resetDeferredPosters() {
  if (catalogState.posterDeferredRaf && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(catalogState.posterDeferredRaf);
  }
  catalogState.posterDeferredRaf = 0;
  catalogState.posterDeferred.length = 0;
  dropGridPosterAhead();
  if (catalogState.posterBatchTimer) {
    clearTimeout(catalogState.posterBatchTimer);
    catalogState.posterBatchTimer = null;
  }
  dropPosterReveals();
}
function requestGridPoster(idx, card) {
  if (!card) card = catalogState.cardElements[idx];
  if (!card || !card.dataset) return;
  if (card.dataset.posterRequested === '1') return;
  if (card.querySelector('img.catalog-poster-img')) return;
  if (isNaN(idx)) idx = parseInt(card.dataset.catalogIndex, 10);
  if (isNaN(idx) || !catalogState.items[idx]) return;
  card.dataset.posterRequested = '1';
  if (catalogState.posterObserver) {
    try {
      catalogState.posterObserver.unobserve(card);
    } catch (e) {}
  }
  deferPosterUntilScrollEnds(idx);
}
function preloadGridPostersAhead(card) {
  if (!card || !card.dataset || !catalogState.items.length) return;
  var idx = parseInt(card.dataset.catalogIndex, 10);
  if (isNaN(idx)) return;
  var cols = typeof getColumns === 'function' && getColumns() || 5;
  if (cols < 1) cols = 5;
  var start = Math.floor(idx / cols) * cols;
  var end = Math.min(start + cols * (CATALOG_CONSTANTS.GRID_POSTER_PRELOAD_ROWS + 1), catalogState.items.length);
  for (var i = start; i < end; i++) requestGridPoster(i, catalogState.cardElements[i]);
}
var gridPosterAheadTimer = null;
var gridPosterAheadCard = null;
function scheduleGridPosterAhead(card) {
  gridPosterAheadCard = card;
  if (gridPosterAheadTimer) return;
  gridPosterAheadTimer = setTimeout(runGridPosterAhead, CATALOG_CONSTANTS.ROW_POSTER_RETRY_MS);
}
function runGridPosterAhead() {
  gridPosterAheadTimer = null;
  var card = gridPosterAheadCard;
  if (!card || !card.isConnected) {
    gridPosterAheadCard = null;
    return;
  }
  if (isGridNavBusy() || isGridScrolling()) {
    gridPosterAheadTimer = setTimeout(runGridPosterAhead, CATALOG_CONSTANTS.ROW_POSTER_RETRY_MS);
    return;
  }
  gridPosterAheadCard = null;
  preloadGridPostersAhead(card);
}
function prefetchGridPosters(card) {
  if (!window.PosterPrefetch || !card || !card.dataset || !catalogState.items.length) return;
  var idx = parseInt(card.dataset.catalogIndex, 10);
  if (isNaN(idx)) return;
  var cols = typeof getColumns === 'function' && getColumns() || 5;
  if (cols < 1) cols = 5;
  var up = window.lastNavDirection === 'up';
  var ahead = (window.navHold ? CATALOG_CONSTANTS.GRID_PREFETCH_ROWS_AHEAD_HOLD : CATALOG_CONSTANTS.GRID_PREFETCH_ROWS_AHEAD) * cols;
  var behind = CATALOG_CONSTANTS.GRID_PREFETCH_ROWS_BEHIND * cols;
  var rowStart = Math.floor(idx / cols) * cols;
  var from = Math.max(0, up ? rowStart - ahead : rowStart - behind);
  var to = Math.min(catalogState.items.length, up ? rowStart + cols + behind : rowStart + cols + ahead);
  var size = getPosterCardSize();
  var urls = [];
  var order = [];
  for (var i = from; i < to; i++) order.push(i);
  order.sort(function (a, b) {
    return Math.abs(a - idx) - Math.abs(b - idx);
  });
  for (var k = 0; k < order.length; k++) {
    var item = catalogState.items[order[k]];
    if (item && item.poster_path) urls.push(getTmdbImageUrl(item.poster_path, size));
  }
  window.PosterPrefetch.want(urls);
}
var DETAIL_ART_DWELL_MS = 450;
var DETAIL_ART_DONE_MAX = 300;
var detailArtTimer = null;
var detailArtDone = {};
var detailArtDoneOrder = [];
function scheduleDetailArtPrefetch(card) {
  if (!window.PosterPrefetch || !card || !card.dataset) return;
  if (detailArtTimer) clearTimeout(detailArtTimer);
  detailArtTimer = setTimeout(function run() {
    detailArtTimer = null;
    if (!card.isConnected || !card.classList.contains('focused')) return;
    if (isGridNavBusy()) {
      detailArtTimer = setTimeout(run, DETAIL_ART_DWELL_MS);
      return;
    }
    var idx = parseInt(card.dataset.catalogIndex, 10);
    if (!isNaN(idx)) prefetchDetailArt(catalogState.items[idx]);
  }, DETAIL_ART_DWELL_MS);
}
function prefetchDetailArt(item) {
  if (!item || !item.id || !window.PosterPrefetch) return;
  var key = (item.media_type || 'movie') + ':' + item.id;
  if (detailArtDone[key]) return;
  detailArtDone[key] = true;
  detailArtDoneOrder.push(key);
  if (detailArtDoneOrder.length > DETAIL_ART_DONE_MAX) delete detailArtDone[detailArtDoneOrder.shift()];
  var send = function (src) {
    var urls = [];
    var bp = src && src.backdrop_path || item.backdrop_path;
    if (bp) urls.push(getTmdbImageUrl(bp, CATALOG_CONSTANTS.IMG_SIZES.BACKDROP));
    var logo = cinemaLogoUrl(item, src);
    if (logo) urls.push(logo);
    if (urls.length) window.PosterPrefetch.want(urls);
  };
  if (item.backdrop_path) {
    send(item);
    return;
  }
  Promise.resolve(fetchCatalogItemDetails(item)).then(send, function () {
    delete detailArtDone[key];
  });
}
function dropGridPosterAhead() {
  if (gridPosterAheadTimer) {
    clearTimeout(gridPosterAheadTimer);
    gridPosterAheadTimer = null;
  }
  gridPosterAheadCard = null;
}
function initPosterLazyLoading() {
  if (catalogState.posterObserver) catalogState.posterObserver.disconnect();
  catalogState.posterObserver = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i].isIntersecting) continue;
      var target = entries[i].target;
      requestGridPoster(parseInt(target.dataset.catalogIndex, 10), target);
    }
  }, {
    rootMargin: CATALOG_CONSTANTS.POSTER_OBSERVER_MARGIN_PX + 'px',
    threshold: 0.1
  });
  var cards = document.querySelectorAll('#catalog-grid .torrent-card.catalog-card');
  for (var i = 0; i < cards.length; i++) {
    var it = catalogState.items[i];
    if (!it) continue;
    if (!cards[i].querySelector('img.catalog-poster-img') && cards[i].dataset.posterRequested !== '1') {
      catalogState.posterObserver.observe(cards[i]);
    }
  }
}
function updatePosterObservers() {
  if (!catalogState.posterObserver) return;
  var cards = document.querySelectorAll('#catalog-grid .torrent-card.catalog-card');
  for (var i = 0; i < cards.length; i++) {
    var it = catalogState.items[i];
    if (!it) continue;
    if (!cards[i].querySelector('img.catalog-poster-img') && cards[i].dataset.posterRequested !== '1') {
      try {
        catalogState.posterObserver.observe(cards[i]);
      } catch (e) {}
    }
  }
}
function loadPosterDirect(idx, card) {
  if (!catalogState.currentCatalog) return false;
  var item = catalogState.items[idx];
  if (!item || !item.poster_path) return false;
  if (!card) card = catalogState.cardElements[idx];
  if (!card) return false;
  var div = card.querySelector('.torrent-poster');
  if (!div) return false;
  var url = getTmdbImageUrl(item.poster_path, getPosterCardSize());
  if (!url) return false;
  catalogState.posterCache.set(item.id + '_' + (item.media_type || 'movie'), url);
  card.dataset.posterRequested = '1';
  updatePosterDOM(div, card.dataset.rating, url);
  return true;
}
function addToPosterQueue(idx) {
  var card = catalogState.cardElements[idx];
  if (card) card.dataset.posterRequested = '1';
  if (catalogState.posterLoadQueue.indexOf(idx) !== -1) return;
  catalogState.posterLoadQueue.push(idx);
  if (!catalogState.isPosterLoading) loadNextPosterBatch();
}
function schedulePosterBatchRetry() {
  if (catalogState.posterBatchTimer) return;
  catalogState.posterBatchTimer = setTimeout(function () {
    catalogState.posterBatchTimer = null;
    loadNextPosterBatch();
  }, CATALOG_CONSTANTS.ROW_POSTER_RETRY_MS);
}
function loadNextPosterBatch() {
  if (catalogState.isPosterLoading || catalogState.posterLoadQueue.length === 0) return;
  if (isGridNavBusy()) {
    schedulePosterBatchRetry();
    return;
  }
  catalogState.posterLoadQueue.sort(function (a, b) {
    return a - b;
  });
  var next = catalogState.posterLoadQueue.splice(0, catalogState.postersPerBatch);
  loadPosterBatch(next);
}
function loadPosterBatch(indices) {
  if (!indices || indices.length === 0) return;
  catalogState.isPosterLoading = true;
  var active = 0;
  var ptr = 0;
  var maxActive = CATALOG_CONSTANTS.MAX_POSTER_DECODES || 3;
  function scheduleIdle(cb, timeout) {
    if (window.requestIdleCallback) window.requestIdleCallback(cb, {
      timeout: timeout
    });else setTimeout(cb, 16);
  }
  function next() {
    if (ptr >= indices.length && active === 0) {
      catalogState.isPosterLoading = false;
      if (catalogState.posterLoadQueue.length > 0) {
        scheduleIdle(loadNextPosterBatch, 200);
      }
      return;
    }
    if (ptr < indices.length && isGridNavBusy()) {
      if (active === 0) setTimeout(next, CATALOG_CONSTANTS.ROW_POSTER_RETRY_MS);
      return;
    }
    while (active < maxActive && ptr < indices.length) {
      active++;
      var index = indices[ptr];
      ptr++;
      loadPosterForIndex(index).catch(function () {}).then(function () {
        active--;
        scheduleIdle(next, 100);
      });
    }
  }
  next();
}
function loadPosterForIndex(_x28) {
  return _loadPosterForIndex.apply(this, arguments);
}
function _loadPosterForIndex() {
  _loadPosterForIndex = _asyncToGenerator(function* (index) {
    var item = catalogState.items[index];
    if (!item) return;
    var card = catalogState.cardElements[index];
    if (!card) return;
    yield loadCatalogPoster(card, getCatalogItemTitle(item), item.media_type || 'movie', item.id, index);
  });
  return _loadPosterForIndex.apply(this, arguments);
}
function loadCatalogPoster(_x29, _x30, _x31, _x32, _x33) {
  return _loadCatalogPoster.apply(this, arguments);
}
function _loadCatalogPoster() {
  _loadCatalogPoster = _asyncToGenerator(function* (card, title, mt, id, index) {
    var div = card.querySelector('.torrent-poster');
    if (!div) return;
    var key = id + '_' + mt;
    if (!catalogState.currentCatalog) return;
    var item = catalogState.items[index];
    if (item && item.poster_path) {
      var quickUrl = getTmdbImageUrl(item.poster_path, getPosterCardSize());
      if (quickUrl) {
        updatePosterDOM(div, card.dataset.rating, quickUrl);
        catalogState.posterCache.set(key, quickUrl);
        return;
      }
    }
    var cached = catalogState.posterCache.get(key);
    if (cached) {
      updatePosterDOM(div, card.dataset.rating, cached);
      return;
    }
    var p = {
      id: id,
      type: mt
    };
    var cachedTmdb = getFromTmdbCache('poster', p);
    if (cachedTmdb && cachedTmdb.posterUrl) {
      var url = normalizePosterUrl(cachedTmdb.posterUrl);
      updatePosterDOM(div, card.dataset.rating, url);
      catalogState.posterCache.set(key, url);
      return;
    }
    try {
      var url = null;
      if (id && id !== 'undefined' && id !== 'null' && window.CatalogWorker) {
        try {
          var posterResult = yield CatalogWorker.fetchPosterUrl(id, mt, title, getProtocolBase(), getPosterCardSize());
          if (posterResult && posterResult.posterUrl) {
            url = normalizePosterUrl(posterResult.posterUrl);
            saveToTmdbCache('poster', p, {
              posterUrl: url
            });
          }
        } catch (e) {
          console.warn('fetchPosterUrl worker error:', e);
        }
      }
      if (!url && window.tmdb && window.tmdb.searchPoster) {
        try {
          url = yield window.tmdb.searchPoster(title, null, mt, true);
          if (url) saveToTmdbCache('poster', p, {
            posterUrl: url
          });
        } catch (e) {
          console.warn('searchPoster failed:', e);
        }
      }
      if (url) {
        catalogState.posterCache.set(key, url);
        updatePosterDOM(div, card.dataset.rating, url);
      } else {
        div.innerHTML = '<div class="no-poster">Нет постера</div>';
      }
    } catch (e) {
      console.warn('❌ Ошибка загрузки постера:', e.message);
      if (catalogState.currentCatalog) div.innerHTML = '<div class="no-poster">Нет постера</div>';
    }
  });
  return _loadCatalogPoster.apply(this, arguments);
}
function updatePosterDOM(div, rating, url) {
  if (!div || !url) {
    if (div) div.innerHTML = '<div class="no-poster">Нет постера</div>';
    return;
  }
  var size = getPosterCardSize();
  if (url.indexOf('/t/p/' + size + '/') === -1) {
    url = getTmdbImageUrl(url, size);
  }
  var img = new Image();
  img.className = 'catalog-poster-img';
  img.decoding = 'async';
  img.alt = '';
  img.src = url;
  var oldImg = div.querySelector('img.catalog-poster-img');
  if (oldImg) oldImg.remove();
  var placeholder = div.querySelector('.no-poster');
  div.appendChild(img);
  function reveal() {
    queuePosterReveal(function () {
      if (!img.isConnected) return;
      showPosterImg(img);
      if (placeholder) dropPosterPlaceholder(placeholder);
    });
  }
  img.onload = function () {
    if (typeof img.decode === 'function') img.decode().then(reveal).catch(reveal);else reveal();
  };
  var mirrorRetried = false;
  img.onerror = function () {
    if (!mirrorRetried) {
      var alt = getTmdbNextMirrorUrl(img.src);
      if (alt && alt !== img.src) {
        mirrorRetried = true;
        img.src = alt;
        return;
      }
    }
    if (div.isConnected && !div.querySelector('.no-poster')) {
      div.innerHTML = '<div class="no-poster">Нет постера</div>';
    }
  };
}
function showPosterImg(img) {
  var quiet = Date.now() - (window.navStreakAt || 0);
  if (window.navHold || quiet < CATALOG_CONSTANTS.POSTER_FADE_QUIET_MS) {
    img.classList.add('poster-instant');
  }
  img.classList.add('loaded');
}
function dropPosterPlaceholder(placeholder) {
  setTimeout(function () {
    if (placeholder && placeholder.parentNode) placeholder.remove();
  }, CATALOG_CONSTANTS.POSTER_FADE_MS + 60);
}
function ensureCinemaBlocks(panel) {
  if (!panel || !panel.parentElement) return null;
  if (!getEl('detail-cinema-head')) {
    var head = document.createElement('div');
    head.id = 'detail-cinema-head';
    head.className = 'detail-cinema-head';
    head.innerHTML = '<div class="detail-cinema-title">' + '<img id="detail-cinema-logo" class="detail-cinema-logo hidden" alt="">' + '<div id="detail-cinema-name" class="detail-cinema-name"></div>' + '</div>' + '<div id="detail-cinema-meta" class="detail-cinema-meta"></div>' + '<div id="detail-cinema-chips" class="detail-cinema-chips"></div>';
    panel.insertBefore(head, panel.firstChild);
  }
  if (!getEl('detail-cinema-score')) {
    var score = document.createElement('div');
    score.id = 'detail-cinema-score';
    score.className = 'detail-cinema-score';
    score.innerHTML = '<div id="detail-cinema-vote" class="detail-cinema-vote">' + '<div class="detail-cinema-ring">' + '<svg viewBox="0 0 36 36"><circle class="detail-cinema-ring-track" cx="18" cy="18" r="15.9155"></circle>' + '<circle id="detail-cinema-ring-bar" class="detail-cinema-ring-bar" cx="18" cy="18" r="15.9155"></circle></svg>' + '<span id="detail-cinema-ring-value" class="detail-cinema-ring-value"></span>' + '</div>' + '<div class="detail-cinema-vote-text">' + '<div class="detail-cinema-vote-label">Рейтинг<br>TMDB</div>' + '<div id="detail-cinema-vote-count" class="detail-cinema-vote-count"></div>' + '</div>' + '</div>' + '<div id="detail-cinema-ratings" class="detail-cinema-ratings"></div>' + '<div id="detail-cinema-badges" class="detail-cinema-badges"></div>';
    panel.parentElement.insertBefore(score, panel.nextSibling);
    watchCinemaScorePlace();
  }
  var below = getEl('detail-cinema-below');
  if (!below) {
    below = document.createElement('div');
    below.id = 'detail-cinema-below';
    below.className = 'detail-cinema-below';
    below.innerHTML = '<div id="catalog-detail-episodes-wrap" class="catalog-detail-episodes-wrap hidden">' + '<div class="catalog-detail-section-title">Серии</div>' + '<div id="catalog-detail-episodes" class="catalog-detail-episodes-grid"></div>' + '</div>' + '<div id="catalog-detail-crew-wrap" class="catalog-detail-crew-wrap hidden">' + '<div class="catalog-detail-section-title">Режиссёр</div>' + '<div id="catalog-detail-crew" class="catalog-detail-crew-grid"></div>' + '</div>' + '<div id="catalog-detail-collection-wrap" class="catalog-detail-collection-wrap hidden">' + '<div class="catalog-detail-section-title"></div>' + '<div id="catalog-detail-collection" class="catalog-detail-recommendations-grid"></div>' + '</div>';
    panel.parentElement.insertBefore(below, panel.nextSibling);
  }
  return below;
}
function formatCinemaRuntime(min) {
  min = Math.round(Number(min) || 0);
  if (min <= 0) return '';
  var h = Math.floor(min / 60),
    m = min % 60;
  if (!h) return m + ' мин';
  return h + ' ч' + (m ? ' ' + m + ' мин' : '');
}
function pluralRu(n, one, few, many) {
  var a = Math.abs(n) % 100,
    b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
var cinemaLogoGen = 0;
var CINEMA_LOGO_WAIT_MS = 1500;
function cinemaLogoUrl(item, src) {
  var url = null;
  if (window.HomeScreen && typeof window.HomeScreen.logoUrl === 'function') {
    try {
      url = window.HomeScreen.logoUrl(item);
    } catch (e) {
      url = null;
    }
  }
  if (url) return url;
  var path = src && src.logo && src.logo.file_path || item && item.logo && item.logo.file_path;
  return path ? getTmdbImageUrl(path, 'w500') : null;
}
function renderCinemaLogo(item, src) {
  var img = getEl('detail-cinema-logo'),
    name = getEl('detail-cinema-name');
  if (!img || !name) return;
  var mine = ++cinemaLogoGen;
  var url = cinemaLogoUrl(item, src);
  img.onload = img.onerror = null;
  img.classList.add('hidden');
  if (img.getAttribute('src')) img.removeAttribute('src');
  name.classList.remove('hidden');
  name.style.visibility = '';
  if (!url) return;
  var queue = _detailBackdropQueue(url);
  var at = 0;
  name.style.visibility = 'hidden';
  var timer = setTimeout(function () {
    if (mine === cinemaLogoGen) name.style.visibility = '';
  }, CINEMA_LOGO_WAIT_MS);
  function next() {
    if (mine !== cinemaLogoGen) return;
    if (at >= queue.length) {
      clearTimeout(timer);
      name.style.visibility = '';
      return;
    }
    img.src = queue[at++];
  }
  img.onload = function () {
    if (mine !== cinemaLogoGen) return;
    if (!img.naturalWidth) {
      next();
      return;
    }
    clearTimeout(timer);
    img.classList.remove('hidden');
    name.classList.add('hidden');
  };
  img.onerror = next;
  next();
}
var CINEMA_STATUS = {
  tv: {
    'Returning Series': 'Выходит',
    'Ended': 'Завершён',
    'Canceled': 'Отменён',
    'In Production': 'В производстве',
    'Planned': 'Анонсирован',
    'Pilot': 'Пилот'
  },
  movie: {
    'Post Production': 'Скоро выйдет',
    'In Production': 'В производстве',
    'Planned': 'Анонсирован',
    'Rumored': 'Анонсирован',
    'Canceled': 'Отменён'
  }
};
function placeCinemaScore() {
  var box = getEl('detail-cinema-score'),
    meta = getEl('detail-cinema-meta');
  if (!box || !meta) return;
  if (box.previousSibling !== meta) meta.parentNode.insertBefore(box, meta.nextSibling);
}
function watchCinemaScorePlace() {
  placeCinemaScore();
}
function formatCinemaVotes(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + ' ' + pluralRu(n, 'голос', 'голоса', 'голосов');
}
var cinemaKpRatings = {};
var cinemaKpUnavailable = false;
function cinemaRatingsHtml(r) {
  if (!r) return '';
  var html = '';
  if (r.kp) html += '<span class="detail-cinema-rating is-kp"><b>КП</b>' + r.kp.toFixed(1) + '</span>';
  if (r.imdb) html += '<span class="detail-cinema-rating is-imdb"><b>IMDb</b>' + r.imdb.toFixed(1) + '</span>';
  return html;
}
function updateCinemaScoreVisibility() {
  var box = getEl('detail-cinema-score');
  if (!box) return;
  var vote = getEl('detail-cinema-vote'),
    ratings = getEl('detail-cinema-ratings'),
    badges = getEl('detail-cinema-badges');
  var any = vote && vote.style.display !== 'none' || ratings && ratings.innerHTML || badges && badges.innerHTML;
  box.style.display = any ? '' : 'none';
}
function loadCinemaKpRating(key, type, id, imdb) {
  if (cinemaKpUnavailable) return;
  var url = '/api/kinopoisk/rating?type=' + encodeURIComponent(type) + '&id=' + encodeURIComponent(id) + (imdb ? '&imdb=' + encodeURIComponent(imdb) : '');
  (window.bgFetch ? window.bgFetch(url) : fetch(url)).then(function (resp) {
    if (resp.status === 404) {
      cinemaKpUnavailable = true;
      return null;
    }
    return resp.ok ? resp.json() : null;
  }).then(function (data) {
    if (!data || !data.success) return;
    var r = data.kp || data.imdb ? {
      kp: data.kp,
      imdb: data.imdb
    } : null;
    cinemaKpRatings[key] = r;
    var box = getEl('detail-cinema-score'),
      el = getEl('detail-cinema-ratings');
    if (!box || !el || box.getAttribute('data-key') !== key) return;
    el.innerHTML = cinemaRatingsHtml(r);
    updateCinemaScoreVisibility();
  })['catch'](function () {});
}
function renderCinemaScore(item, src) {
  var box = getEl('detail-cinema-score');
  if (!box) return;
  var type = (item.media_type || 'movie') === 'tv' ? 'tv' : 'movie';
  var id = src.id || item.id;
  var key = type + '_' + id;
  var ratingsEl = getEl('detail-cinema-ratings');
  if (box.getAttribute('data-key') !== key) {
    box.setAttribute('data-key', key);
    if (ratingsEl) ratingsEl.innerHTML = '';
    if (cinemaKpRatings.hasOwnProperty(key)) {
      if (ratingsEl) ratingsEl.innerHTML = cinemaRatingsHtml(cinemaKpRatings[key]);
    } else if (id) {
      loadCinemaKpRating(key, type, id, src.imdb_id || '');
    }
  }
  var vote = Number(src.vote_average) || Number(item.vote_average) || 0;
  var count = Number(src.vote_count) || Number(item.vote_count) || 0;
  var pct = vote > 0 && vote <= 10 ? Math.round(vote * 10) : 0;
  var voteEl = getEl('detail-cinema-vote');
  if (voteEl) voteEl.style.display = pct ? '' : 'none';
  if (pct) {
    var bar = getEl('detail-cinema-ring-bar');
    if (bar) bar.setAttribute('stroke-dasharray', pct + ' 100');
    voteEl.className = 'detail-cinema-vote ' + (pct >= 70 ? 'is-high' : pct >= 40 ? 'is-mid' : 'is-low');
    var val = getEl('detail-cinema-ring-value');
    if (val) val.innerHTML = pct + '<sup>%</sup>';
    var cnt = getEl('detail-cinema-vote-count');
    if (cnt) cnt.textContent = count > 0 ? formatCinemaVotes(count) : '';
  }
  var badges = [];
  var cert = src.certification;
  if (cert && cert.value) badges.push('<span class="detail-cinema-badge is-cert">' + escapeHtml(String(cert.value)) + '</span>');
  var statuses = CINEMA_STATUS[(item.media_type || 'movie') === 'tv' ? 'tv' : 'movie'];
  var status = src.status && statuses[src.status];
  if (status) badges.push('<span class="detail-cinema-badge">' + escapeHtml(status) + '</span>');
  var badgesEl = getEl('detail-cinema-badges');
  if (badgesEl) badgesEl.innerHTML = badges.join('');
  updateCinemaScoreVisibility();
}
function renderCinemaHead(item, src) {
  if (!getEl('detail-cinema-head')) return;
  var name = getEl('detail-cinema-name');
  if (name) name.textContent = getCatalogItemTitle(item);
  renderCinemaLogo(item, src);
  var parts = [];
  var year = getCatalogItemYear(src) || getCatalogItemYear(item);
  if (year) parts.push(escapeHtml(String(year)));
  if ((item.media_type || 'movie') === 'tv') {
    var ns = Number(src.number_of_seasons) || 0;
    if (ns) parts.push(ns + ' ' + pluralRu(ns, 'сезон', 'сезона', 'сезонов'));
  } else {
    var rt = formatCinemaRuntime(src.runtime);
    if (rt) parts.push(rt);
  }
  var rating = getSafeCatalogRating(src) || getSafeCatalogRating(item);
  var meta = getEl('detail-cinema-meta');
  if (meta) {
    meta.innerHTML = parts.join('<span class="detail-cinema-dot">·</span>') + (rating ? '<span class="detail-cinema-meta-star">' + (parts.length ? '<span class="detail-cinema-dot">·</span>' : '') + '<span class="detail-cinema-star">★</span> ' + rating.toFixed(1) + '</span>' : '');
  }
  var chips = [];
  var genres = getNormalizedCatalogGenres(src);
  for (var i = 0; i < genres.length && i < 3; i++) {
    chips.push(genres[i].charAt(0).toUpperCase() + genres[i].slice(1));
  }
  var countries = getCatalogCountries(src, 2);
  for (var j = 0; j < countries.length; j++) chips.push(countries[j]);
  var box = getEl('detail-cinema-chips');
  if (box) {
    var html = '';
    for (var k = 0; k < chips.length; k++) html += '<span class="detail-cinema-chip">' + escapeHtml(chips[k]) + '</span>';
    box.innerHTML = html;
  }
  renderCinemaScore(item, src);
}
function detailCrewPeople(item, src) {
  var tv = (item.media_type || 'movie') === 'tv';
  var people = [],
    seen = {};
  var list = tv ? src.created_by || [] : src.credits && src.credits.crew || src.crew || [];
  for (var i = 0; i < list.length && people.length < CATALOG_CONSTANTS.MAX_CREW; i++) {
    var p = list[i];
    if (!p || !p.name || !tv && p.job !== 'Director') continue;
    if (seen[p.id || p.name]) continue;
    seen[p.id || p.name] = 1;
    people.push(p);
  }
  return people;
}
function cinemaPeopleMerged() {
  return isCinemaCatalogDetail();
}
function cinemaCrewAsActors(item, src) {
  var role = (item.media_type || 'movie') === 'tv' ? 'Создатель' : 'Режиссёр';
  var people = detailCrewPeople(item, src),
    out = [];
  for (var i = 0; i < people.length; i++) {
    out.push({
      id: people[i].id ? 'crew:' + people[i].id : '',
      name: people[i].name,
      character: role,
      profilePath: people[i].profile_path || '',
      crew: true
    });
  }
  return out;
}
function renderDetailCrew(item, src, merged) {
  var wrap = getEl('catalog-detail-crew-wrap'),
    grid = getEl('catalog-detail-crew');
  if (!wrap || !grid) return;
  if (merged) {
    if (grid._pool) for (var h = 0; h < grid._pool.length; h++) hideDetailCard(grid._pool[h]);
    wrap.classList.add('hidden');
    return;
  }
  var tv = (item.media_type || 'movie') === 'tv';
  var people = detailCrewPeople(item, src);
  var title = wrap.firstChild;
  if (title) title.textContent = tv ? people.length > 1 ? 'Создатели' : 'Создатель' : people.length > 1 ? 'Режиссёры' : 'Режиссёр';
  var role = tv ? 'Создатель' : 'Режиссёр';
  var pool = ensureDetailRowPool(grid, CATALOG_CONSTANTS.MAX_CREW, buildCrewCard);
  for (var j = 0; j < pool.length; j++) {
    var c = pool[j],
      pp = people[j];
    if (!pp) {
      hideDetailCard(c);
      continue;
    }
    if (pp.id) c.dataset.personId = 'crew:' + pp.id;
    c.dataset.personName = pp.name;
    c._name.textContent = pp.name;
    c._character.textContent = role;
    c._placeholder.textContent = 'Нет фото';
    setDetailCardPoster(c, pp.profile_path ? getTmdbImageUrl(pp.profile_path, CATALOG_CONSTANTS.IMG_SIZES.POSTER_SMALL) : '');
    c.classList.remove('hidden');
  }
  hideDetailRowMessage(grid);
  resetDetailRowScroll(grid);
  wrap.classList.toggle('hidden', !people.length);
}
function buildCrewCard() {
  var card = buildActorCard();
  card.className = 'catalog-actor-card catalog-crew-card';
  return card;
}
function setupDetailLayout(item, index, posterUrl) {
  catalogState.lastSelectedIndex = index;
  catalogState.lastSelectedId = item.id;
  var dv = getEl('detail-view'),
    mc = getEl('main-container');
  var savedScroll = mc ? mc.scrollTop : 0;
  AppState.backupScroll = savedScroll;
  if (AppState.currentScreen === 'catalog') {
    AppState.contentScroll = AppState.contentScroll || {};
    AppState.contentScroll.catalog = savedScroll;
  }
  var oldP = document.querySelector('.detail-progress');
  if (oldP) oldP.remove();
  var dh = document.querySelector('.detail-header');
  if (dh) dh.style.background = "rgba(255, 255, 255, 0.08)";
  var aw = getEl('catalog-detail-actors-wrap');
  var rw = getEl('catalog-detail-recommendations-wrap');
  if (!aw && getEl('catalog-detail-overview')) {
    var c = document.createElement('div');
    c.id = 'catalog-detail-actors-wrap';
    c.className = 'catalog-detail-actors-wrap';
    c.innerHTML = '<div class="catalog-detail-section-title">В главных ролях</div><div id="catalog-detail-actors" class="catalog-detail-actors-grid"></div>';
    getEl('catalog-detail-overview').parentElement.insertAdjacentElement('afterend', c);
    aw = c;
  }
  if (!rw && aw) {
    var c = document.createElement('div');
    c.id = 'catalog-detail-recommendations-wrap';
    c.className = 'catalog-detail-recommendations-wrap';
    c.innerHTML = '<div class="catalog-detail-section-title">Похожие фильмы</div><div id="catalog-detail-recommendations" class="catalog-detail-recommendations-grid"></div>';
    aw.insertAdjacentElement('afterend', c);
    rw = c;
  }
  var below = ensureCinemaBlocks(getEl('catalog-detail-overview') && getEl('catalog-detail-overview').parentElement);
  if (below) {
    if (aw && aw.parentNode !== below) below.appendChild(aw);
    if (rw && rw.parentNode !== below) below.appendChild(rw);
    var cw = getEl('catalog-detail-collection-wrap');
    if (cw && rw && cw.nextSibling !== rw) below.insertBefore(cw, rw);
  }
  var eps = getEl('catalog-detail-episodes-wrap');
  if (eps) eps.classList.add('hidden');
  var crew = getEl('catalog-detail-crew-wrap');
  if (crew) crew.classList.add('hidden');
  var coll = getEl('catalog-detail-collection-wrap');
  if (coll) coll.classList.add('hidden');
  enableDetailRowTransform(getEl('catalog-detail-episodes'));
  enableDetailRowTransform(getEl('catalog-detail-crew'));
  enableDetailRowTransform(getEl('catalog-detail-collection'));
  enableDetailRowTransform(getEl('catalog-detail-actors'));
  enableDetailRowTransform(getEl('catalog-detail-recommendations'));
  return {
    dv: dv,
    mc: mc,
    aw: aw,
    rw: rw,
    savedScroll: savedScroll
  };
}
function enableDetailRowTransform(grid) {
  if (!grid || grid._txTrack || !(window.AppState && AppState.homeRowTransform)) return;
  grid._txTrack = grid;
  grid.classList.add('row-tx-self');
  if (grid.parentNode && grid.parentNode.classList) grid.parentNode.classList.add('row-tx-clip');
}
function renderDetailHeader(item, posterUrl, details) {
  var pe = getEl('detail-poster');
  var te = getEl('detail-title-text');
  var se = getEl('detail-subtitle');
  var oe = getEl('catalog-detail-overview');
  var be = getEl('catalog-detail-backdrop');
  var title = getCatalogItemTitle(item);
  var mt = item.media_type || 'movie';
  te.textContent = title;
  if (se) {
    se.textContent = getCatalogItemSubtitle(item);
    se.classList.remove('hidden');
    se.style.display = 'block';
  }
  getEl('files-list').style.display = 'none';
  getEl('catalog-detail-extra').classList.remove('hidden');
  if (oe) {
    oe.textContent = 'Загрузка...';
    oe.classList.remove('hidden');
    oe.style.display = 'block';
  }
  var twInit = getEl('catalog-detail-trailers-wrap');
  var te2Init = getEl('catalog-detail-trailers');
  if (twInit) {
    twInit.classList.add('hidden');
    twInit.style.display = 'none';
  }
  if (te2Init) {
    te2Init.classList.add('hidden');
    te2Init.style.display = 'none';
  }
  var temp = posterUrl || catalogState.posterCache.get(item.id + '_' + mt) || '';
  pe.innerHTML = temp ? '<div class="catalog-poster-loading" style="width:100%;height:100%"></div>' : '<div class="no-poster">Нет постера</div>';
  updateCatalogWatchButton(title);
  var src = details || item || {};
  var posterSrc = null;
  if (src.poster_path) {
    posterSrc = getTmdbImageUrl(src.poster_path, CATALOG_CONSTANTS.IMG_SIZES.POSTER_MEDIUM);
    catalogState.posterCache.set(item.id + '_' + mt, posterSrc);
  } else if (src.image && (src.image.original || src.image.medium)) {
    posterSrc = src.image.original || src.image.medium;
  } else if (temp) {
    posterSrc = temp;
  }
  if (posterSrc) {
    _loadImageDecoded(pe, posterSrc, 'poster');
  }
  if (se) {
    se.textContent = getCatalogItemSubtitle(item, src);
    se.classList.remove('hidden');
    se.style.display = 'block';
  }
  renderCinemaHead(item, src);
  if (oe) {
    oe.textContent = src.overview || item.overview || 'Описание пока недоступно';
    oe.classList.remove('hidden');
    oe.style.display = 'block';
  }
  var bp = src.backdrop_path || item && item.backdrop_path || Array.isArray(src.backdrops) && src.backdrops[0] && src.backdrops[0].file_path;
  if (bp) {
    var bpUrl = getTmdbImageUrl(bp, CATALOG_CONSTANTS.IMG_SIZES.BACKDROP);
    _loadBackdropDecoded(be, bpUrl);
  } else {
    resetDetailBackdrop(be);
  }
  resetDetailButtons();
}
function startTrailerBackground(url) {
  if (!url) return;
  stopTrailerBackground();
  var dv = getEl('detail-view');
  if (!dv) return;
  var video = document.createElement('video');
  video.id = 'trailer-bg-video';
  video.muted = true;
  video.volume = 0;
  video.loop = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.controls = false;
  video.removeAttribute('controls');
  video.setAttribute('disableremoteplayback', '');
  video.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;opacity:0;visibility:hidden;pointer-events:none;transition:opacity 10s ease;';
  var backdrop = getEl('catalog-detail-backdrop');
  var cde = getEl('catalog-detail-extra');
  var sub = getEl('detail-subtitle');
  var bb = getEl('back-from-detail');
  if (AppState) {
    AppState.trailerPlay = true;
  }
  if (backdrop && backdrop.parentNode === dv) {
    dv.insertBefore(video, backdrop);
  } else {
    dv.insertBefore(video, dv.firstChild);
  }
  if (backdrop) backdrop.classList.add('hidden');
  dv.classList.add('hide-before');
  var fadeOutEls = [cde, sub, bb];
  for (var i = 0; i < fadeOutEls.length; i++) {
    (function (el) {
      if (!el) return;
      el.style.transition = 'opacity 10s ease';
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          el.style.opacity = '0';
        });
      });
    })(fadeOutEls[i]);
  }
  rutubeTrailerState.bgVideo = video;
  var volumeStarted = false;
  function startVolumeFade() {
    if (volumeStarted) return;
    volumeStarted = true;
    video.muted = false;
    video.volume = 0;
    var vol = 0;
    video._volumeTimer = setInterval(function () {
      vol = Math.min(1, vol + 0.1);
      try {
        video.volume = vol;
      } catch (e) {}
      if (vol >= 1 && video._volumeTimer) {
        clearInterval(video._volumeTimer);
        video._volumeTimer = null;
      }
    }, 1000);
  }
  if (trailerUsesHlsJs()) {
    var hls = new Hls({
      maxBufferSize: 30 * 1024 * 1024,
      maxBufferLength: 10,
      startLevel: 2,
      enableWorker: true
    });
    hls.loadSource(wrapRutubeHls(url));
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, function () {
      video.play().catch(function () {});
    });
    video._hls = hls;
  } else {
    video.src = wrapRutubeHls(url);
    video.play().catch(function () {});
  }
  function revealVideo() {
    if (rutubeTrailerState.bgVideo !== video) return;
    video.style.visibility = 'visible';
    video.style.opacity = '1';
  }
  video.addEventListener('playing', function () {
    revealVideo();
    startVolumeFade();
  });
  video.addEventListener('timeupdate', function () {
    if (video.currentTime > 0) revealVideo();
    startVolumeFade();
  });
}
function stopTrailerBackground() {
  var video = rutubeTrailerState.bgVideo || getEl('trailer-bg-video');
  if (AppState) {
    AppState.trailerPlay = false;
  }
  if (video) {
    if (video._volumeTimer) {
      clearInterval(video._volumeTimer);
      video._volumeTimer = null;
    }
    if (video._hls) {
      video._hls.destroy();
      video._hls = null;
    }
    try {
      video.pause();
    } catch (e) {}
    video.removeAttribute('src');
    try {
      video.load();
    } catch (e) {}
    if (video.parentNode) video.parentNode.removeChild(video);
  }
  rutubeTrailerState.bgVideo = null;
  var backdrop = getEl('catalog-detail-backdrop');
  var cde = getEl('catalog-detail-extra');
  var sub = getEl('detail-subtitle');
  var bb = getEl('back-from-detail');
  var fadeInEls = [cde, sub, bb];
  for (var i = 0; i < fadeInEls.length; i++) {
    (function (el) {
      if (!el) return;
      el.style.transition = 'opacity 1.5s ease';
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          el.style.opacity = '1';
        });
      });
    })(fadeInEls[i]);
  }
  if (backdrop) backdrop.classList.remove('hidden');
  var dv = getEl('detail-view');
  if (dv) dv.classList.remove('hide-before');
}
window.stopTrailerBackground = stopTrailerBackground;
function openRutubeTrailerInPlayer(_x34, _x35) {
  return _openRutubeTrailerInPlayer.apply(this, arguments);
}
function _openRutubeTrailerInPlayer() {
  _openRutubeTrailerInPlayer = _asyncToGenerator(function* (m3u8Url, title) {
    stopTrailerBackground();
    if (window.AndroidJS) {
      var playerData = {
        url: m3u8Url,
        title: title || 'Видео',
        iptv: false
      };
      AndroidJS.openPlayer(m3u8Url, JSON.stringify(playerData));
    } else {
      var po = getEl('playback-overlay');
      if (po) {
        po.classList.add('active');
        var pt = po.querySelector('.playback-text');
        if (pt) pt.textContent = 'Загрузка трейлера: ' + title + '...';
      }
      try {
        var cd = AppState.currentDetailItem;
        var cn = catalogState.currentCatalog;
        var ci = catalogState.lastSelectedIndex;
        var dv = getEl('detail-view');
        var mc = getEl('main-container');
        if (dv) {
          dv.style.display = 'none';
          dv.style.pointerEvents = 'none';
        }
        if (mc) mc.style.pointerEvents = 'none';
        var old = AppState.currentStreamId;
        if (old) fetch(SERVER_URL + '/hls/stop/' + old, {
          method: 'POST'
        }).catch(function () {});
        if (window.destroyHls) window.destroyHls();
        AppState.videoUrl = m3u8Url;
        AppState.isYoutubePlayback = true;
        AppState.youtubeContext = {
          currentDetailItem: cd,
          catalogName: cn,
          itemIndex: ci
        };
        AppState.currentDetailItem = {
          title: title,
          hash: null,
          isYoutube: true,
          youtubeUrl: m3u8Url
        };
        var vp = getEl('video-player');
        if (trailerUsesHlsJs()) {
          AppState.hls = new Hls({
            maxBufferSize: 80 * 1024 * 1024,
            maxBufferLength: 30,
            backBufferLength: 20,
            startLevel: -1,
            abrEwmaDefaultEstimate: 500000,
            fragLoadingTimeOut: 10000,
            manifestLoadingTimeOut: 10000,
            enableWorker: true,
            progressive: true
          });
          AppState.hls.loadSource(wrapRutubeHls(m3u8Url));
          AppState.hls.attachMedia(vp);
          var started = false;
          AppState.hls.on(Hls.Events.MANIFEST_PARSED, function () {
            if (typeof window.updatePlayerTitle === 'function') window.updatePlayerTitle('Трейлер: ' + title);
            vp.currentTime = 0;
            vp.pause();
            var iv = setInterval(function () {
              if (started) return clearInterval(iv);
              if (vp.buffered && vp.buffered.length > 0 && vp.buffered.end(vp.buffered.length - 1) - vp.currentTime >= 3) {
                clearInterval(iv);
                if (po) po.classList.remove('active');
                vp.play().catch(function () {
                  vp.muted = true;
                  vp.play().catch(function () {});
                  if (typeof window.updateMuteButton === 'function') window.updateMuteButton();
                });
                started = true;
                getEl('player-screen').style.display = 'block';
                getEl('config-screen').style.display = 'none';
                getEl('torrserver-section').style.display = 'none';
                var focused = document.querySelectorAll('.focused');
                for (var i = 0; i < focused.length; i++) focused[i].classList.remove('focused');
                if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();
              }
            }, 500);
          });
          AppState.hls.on(Hls.Events.ERROR, function (ev, d) {
            if (d.fatal) {
              if (po) po.classList.remove('active');
              alert('Ошибка воспроизведения трейлера');
            }
          });
        } else if (vp.canPlayType('application/vnd.apple.mpegurl')) {
          vp.src = wrapRutubeHls(m3u8Url);
          vp.addEventListener('loadedmetadata', function () {
            if (typeof window.updatePlayerTitle === 'function') window.updatePlayerTitle('Трейлер: ' + title);
            if (po) po.classList.remove('active');
            vp.play().catch(function () {});
            getEl('player-screen').style.display = 'block';
          });
        } else {
          throw new Error('Браузер не поддерживает HLS');
        }
        AppState.currentScreen = 'player';
        if (typeof window.startBufferUpdates === 'function') window.startBufferUpdates();
      } catch (e) {
        console.error('RuTube trailer player error:', e);
        if (po) po.classList.remove('active');
        alert('Ошибка: ' + e.message);
        var dv = getEl('detail-view'),
          mc = getEl('main-container');
        if (dv) {
          dv.style.display = 'block';
          dv.style.pointerEvents = 'auto';
        }
        if (mc) mc.style.pointerEvents = 'auto';
      }
    }
  });
  return _openRutubeTrailerInPlayer.apply(this, arguments);
}
var imageLoadToken = 0;
function _loadImageDecoded(container, src, alt) {
  if (!container || !container.isConnected) return;
  var token = String(++imageLoadToken);
  container.dataset.imgToken = token;
  var img = new Image();
  img.alt = alt || '';
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s ease';
  function stale() {
    return container.dataset.imgToken !== token;
  }
  function release() {
    img.onload = null;
    img.onerror = null;
    img.src = '';
  }
  var insert = function () {
    if (stale() || !container.isConnected) {
      release();
      return;
    }
    if (!img.naturalWidth) {
      release();
      container.innerHTML = '<div class="no-poster">Нет постера</div>';
      return;
    }
    container.innerHTML = '';
    img.style.opacity = '1';
    container.appendChild(img);
  };
  img.onerror = function () {
    var wasStale = stale();
    release();
    if (!wasStale && container.isConnected) container.innerHTML = '<div class="no-poster">Нет постера</div>';
  };
  img.src = src;
  if (typeof img.decode === 'function') {
    img.decode().then(insert).catch(insert);
  } else {
    img.onload = insert;
  }
}
var detailBackdropLoad = 0;
var detailBackdropTimer = null;
function _clearDetailBackdropTimer() {
  if (detailBackdropTimer) {
    clearTimeout(detailBackdropTimer);
    detailBackdropTimer = null;
  }
}
function resetDetailBackdrop(container) {
  var box = container || getEl('catalog-detail-backdrop');
  detailBackdropLoad++;
  _clearDetailBackdropTimer();
  if (!box) return;
  box.classList.add('hidden');
  box.style.backgroundImage = '';
}
window.resetDetailBackdrop = resetDetailBackdrop;
function _detailBackdropQueue(url) {
  var out = [];
  if (!url) return out;
  out.push(url);
  var next = url;
  for (var i = 0; i < CATALOG_CONSTANTS.DETAIL_BACKDROP_TRIES - 1; i++) {
    next = getTmdbNextMirrorUrl(next);
    if (!next || out.indexOf(next) !== -1) break;
    out.push(next);
  }
  return out;
}
function _loadBackdropDecoded(container, url) {
  var queue = _detailBackdropQueue(url);
  resetDetailBackdrop(container);
  if (!queue.length || !container || !container.isConnected) return;
  var mine = detailBackdropLoad;
  var at = 0;
  var shown = false;
  function tryNext() {
    _clearDetailBackdropTimer();
    if (shown || mine !== detailBackdropLoad) return;
    if (at >= queue.length) return;
    var candidate = queue[at++];
    var img = new Image();
    function release() {
      img.onload = null;
      img.onerror = null;
      img.src = '';
    }
    function finish() {
      if (shown || mine !== detailBackdropLoad) {
        release();
        return;
      }
      if (!img.naturalWidth) {
        release();
        tryNext();
        return;
      }
      if (!container.isConnected) {
        release();
        return;
      }
      shown = true;
      _clearDetailBackdropTimer();
      container.style.backgroundImage = 'url(' + candidate + ')';
      if (!rutubeTrailerState.bgVideo) container.classList.remove('hidden');
    }
    img.onerror = function () {
      release();
      tryNext();
    };
    img.onload = function () {
      if (typeof img.decode === 'function') img.decode().then(finish).catch(finish);else finish();
    };
    img.src = candidate;
    detailBackdropTimer = setTimeout(tryNext, CATALOG_CONSTANTS.DETAIL_BACKDROP_GRACE_MS);
  }
  tryNext();
}
var detailPosterObserver = null;
function getDetailPosterObserver() {
  if (detailPosterObserver) return detailPosterObserver;
  if (!('IntersectionObserver' in window)) return null;
  if (document.documentElement.className.indexOf('legacy-browser') !== -1) return null;
  detailPosterObserver = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i].isIntersecting) continue;
      var card = entries[i].target;
      detailPosterObserver.unobserve(card);
      applyDetailCardPoster(card);
    }
  }, {
    rootMargin: CATALOG_CONSTANTS.DETAIL_POSTER_MARGIN_PX + 'px',
    threshold: 0.01
  });
  return detailPosterObserver;
}
function applyDetailCardPoster(card) {
  if (!card || !card._img || !card._posterUrl) return;
  card._img.src = card._posterUrl;
}
function setDetailCardPoster(card, url) {
  if (!card || !card._img) return;
  var img = card._img;
  card._posterUrl = url || '';
  var obs = getDetailPosterObserver();
  if (obs) {
    try {
      obs.unobserve(card);
    } catch (e) {}
  }
  img.classList.add('hidden');
  if (img.getAttribute('src')) img.removeAttribute('src');
  card._placeholder.classList.add('hidden');
  if (!url) {
    card._placeholder.classList.remove('hidden');
    return;
  }
  if (obs) {
    obs.observe(card);
    queueDetailPosterWarm(card);
  } else applyDetailCardPoster(card);
}
var DETAIL_LANE_GRID_IDS = ['catalog-detail-episodes', 'catalog-detail-crew', 'catalog-detail-actors', 'catalog-detail-collection', 'catalog-detail-recommendations'];
var detailPosterWarm = {
  cards: [],
  timer: null,
  prefetchTimer: null
};
function queueDetailPosterWarm(card) {
  if (detailPosterWarm.cards.indexOf(card) === -1) detailPosterWarm.cards.push(card);
  if (!detailPosterWarm.prefetchTimer) detailPosterWarm.prefetchTimer = setTimeout(prefetchDetailPosters, 0);
  if (detailPosterWarm.timer) clearTimeout(detailPosterWarm.timer);
  detailPosterWarm.timer = setTimeout(warmDetailPosters, CATALOG_CONSTANTS.DETAIL_POSTER_WARM_DELAY_MS);
}
function pendingDetailPosterCards() {
  var out = [],
    list = detailPosterWarm.cards;
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    if (c._posterUrl && c._img && !c._img.getAttribute('src') && c.isConnected) out.push(c);
  }
  out.sort(function (a, b) {
    return (a._poolIdx || 0) - (b._poolIdx || 0);
  });
  detailPosterWarm.cards = out;
  return out;
}
function prefetchDetailPosters() {
  detailPosterWarm.prefetchTimer = null;
  if (!window.PosterPrefetch) return;
  var cards = pendingDetailPosterCards(),
    urls = [];
  for (var i = 0; i < cards.length; i++) urls.push(cards[i]._posterUrl);
  window.PosterPrefetch.want(urls);
}
function isDetailNavBusy(dv) {
  if (window.navHold) return true;
  if (typeof Animations === 'undefined' || typeof Animations.isScrollTweening !== 'function') return false;
  if (Animations.isScrollTweening(dv)) return true;
  for (var i = 0; i < DETAIL_LANE_GRID_IDS.length; i++) {
    var g = getEl(DETAIL_LANE_GRID_IDS[i]);
    if (g && Animations.isScrollTweening(g)) return true;
  }
  return false;
}
function warmDetailPosters() {
  detailPosterWarm.timer = null;
  var dv = getEl('detail-view');
  if (!dv || dv.style.display === 'none' || dv.dataset.hiding === '1' || AppState.currentScreen !== 'detail') {
    detailPosterWarm.cards = [];
    return;
  }
  if (isDetailNavBusy(dv)) {
    detailPosterWarm.timer = setTimeout(warmDetailPosters, CATALOG_CONSTANTS.ROW_POSTER_RETRY_MS);
    return;
  }
  var cards = pendingDetailPosterCards();
  var n = Math.min(cards.length, CATALOG_CONSTANTS.DETAIL_POSTER_WARM_BATCH);
  for (var i = 0; i < n; i++) {
    if (detailPosterObserver) {
      try {
        detailPosterObserver.unobserve(cards[i]);
      } catch (e) {}
    }
    applyDetailCardPoster(cards[i]);
  }
  cards.splice(0, n);
  if (cards.length) detailPosterWarm.timer = setTimeout(warmDetailPosters, CATALOG_CONSTANTS.ROW_POSTER_RETRY_MS);
}
function hideDetailCard(card) {
  if (!card) return;
  card.classList.add('hidden');
  card._posterUrl = '';
  if (detailPosterObserver) {
    try {
      detailPosterObserver.unobserve(card);
    } catch (e) {}
  }
  if (card._img && card._img.getAttribute('src')) card._img.removeAttribute('src');
  delete card.dataset.personId;
  delete card.dataset.personName;
  delete card.dataset.tmdbId;
  delete card.dataset.mediaType;
  delete card.dataset.title;
}
function ensureDetailRowPool(grid, max, build) {
  if (grid._pool && grid._pool.length === max && grid._msg && grid._msg.parentNode === grid) {
    return grid._pool;
  }
  grid.innerHTML = '';
  var msg = document.createElement('div');
  msg.className = 'catalog-detail-row-msg hidden';
  grid.appendChild(msg);
  var pool = [];
  for (var i = 0; i < max; i++) {
    var card = build();
    card._poolIdx = i;
    card.classList.add('hidden');
    grid.appendChild(card);
    pool.push(card);
  }
  grid._pool = pool;
  grid._msg = msg;
  return pool;
}
function showDetailRowMessage(grid, html) {
  if (!grid || !grid._msg) return;
  grid._msg.innerHTML = html;
  grid._msg.classList.remove('hidden');
}
function hideDetailRowMessage(grid) {
  if (!grid || !grid._msg) return;
  if (grid._msg.innerHTML) grid._msg.innerHTML = '';
  grid._msg.classList.add('hidden');
}
function buildActorCard() {
  var card = document.createElement('div');
  card.className = 'catalog-actor-card';
  var photo = document.createElement('div');
  photo.className = 'catalog-actor-photo';
  var img = document.createElement('img');
  img.decoding = 'async';
  img.alt = '';
  img.className = 'hidden';
  var noPhoto = document.createElement('div');
  noPhoto.className = 'catalog-actor-no-photo hidden';
  img.onload = function () {
    img.classList.remove('hidden');
    noPhoto.classList.add('hidden');
  };
  img.onerror = function () {
    img.classList.add('hidden');
    noPhoto.classList.remove('hidden');
  };
  photo.appendChild(img);
  photo.appendChild(noPhoto);
  var info = document.createElement('div');
  info.className = 'catalog-actor-info';
  var name = document.createElement('div');
  name.className = 'catalog-actor-name marquee-text';
  var nameText = document.createElement('span');
  name.appendChild(nameText);
  var character = document.createElement('div');
  character.className = 'catalog-actor-character';
  info.appendChild(name);
  info.appendChild(character);
  card.appendChild(photo);
  card.appendChild(info);
  card._img = img;
  card._placeholder = noPhoto;
  card._name = nameText;
  card._character = character;
  return card;
}
function buildRecommendationCard() {
  var card = document.createElement('div');
  card.className = 'catalog-recommendation-card card-modern';
  var posterBox = document.createElement('div');
  posterBox.className = 'torrent-poster catalog-recommendation-poster';
  var img = document.createElement('img');
  img.decoding = 'async';
  img.alt = '';
  img.className = 'hidden';
  var noPoster = document.createElement('div');
  noPoster.className = 'no-poster hidden';
  noPoster.textContent = 'Нет постера';
  var year = document.createElement('div');
  year.className = 'poster-year';
  var bar = document.createElement('div');
  bar.className = 'poster-bar';
  var rating = document.createElement('span');
  rating.className = 'rating-badge';
  bar.appendChild(rating);
  img.onload = function () {
    img.classList.remove('hidden');
    noPoster.classList.add('hidden');
  };
  img.onerror = function () {
    img.classList.add('hidden');
    noPoster.classList.remove('hidden');
  };
  posterBox.appendChild(img);
  posterBox.appendChild(noPoster);
  posterBox.appendChild(year);
  posterBox.appendChild(bar);
  var info = document.createElement('div');
  info.className = 'torrent-info';
  var title = document.createElement('div');
  title.className = 'torrent-title catalog-recommendation-title marquee-text';
  var titleText = document.createElement('span');
  title.appendChild(titleText);
  info.appendChild(title);
  var sub = document.createElement('div');
  sub.className = 'catalog-rec-sub';
  info.appendChild(sub);
  card.appendChild(posterBox);
  card.appendChild(info);
  card._img = img;
  card._placeholder = noPoster;
  card._rating = rating;
  card._bar = bar;
  card._title = titleText;
  card._year = year;
  card._sub = sub;
  return card;
}
function renderDetailActorCards(grid, actors, noPhotoText) {
  if (!grid) return 0;
  var pool = ensureDetailRowPool(grid, CATALOG_CONSTANTS.MAX_ACTORS, buildActorCard);
  var list = actors || [];
  var shown = 0;
  for (var i = 0; i < pool.length; i++) {
    var a = list[shown];
    if (!a || !a.name) {
      hideDetailCard(pool[i]);
      continue;
    }
    var card = pool[i];
    if (a.id !== undefined && a.id !== null && a.id !== '') card.dataset.personId = String(a.id);else delete card.dataset.personId;
    card.dataset.personName = a.name;
    card._name.textContent = a.name;
    card._character.textContent = a.character || '';
    card.classList.toggle('is-crew', !!a.crew);
    card._placeholder.textContent = noPhotoText || 'Нет фото';
    setDetailCardPoster(card, a.profilePath ? getTmdbImageUrl(a.profilePath, CATALOG_CONSTANTS.IMG_SIZES.POSTER_SMALL) : '');
    card.classList.remove('hidden');
    shown++;
  }
  if (shown) hideDetailRowMessage(grid);else showDetailRowMessage(grid, '<div class="catalog-empty">Актеры не найдены</div>');
  var head = grid.parentNode && grid.parentNode.querySelector('.catalog-detail-section-title');
  if (head) head.textContent = list.length && list[0] && list[0].crew ? list[0].character + ' и актёры' : 'В главных ролях';
  return shown;
}
function clearDetailActorCards(grid) {
  if (!grid || !grid._pool) return;
  for (var i = 0; i < grid._pool.length; i++) hideDetailCard(grid._pool[i]);
  hideDetailRowMessage(grid);
}
window.renderDetailActorCards = renderDetailActorCards;
window.clearDetailActorCards = clearDetailActorCards;
function renderDetailActors(_x36, _x37, _x38) {
  return _renderDetailActors.apply(this, arguments);
}
function _renderDetailActors() {
  _renderDetailActors = _asyncToGenerator(function* (item, aw, preloadedActors) {
    if (!aw) return;
    var ae = getEl('catalog-detail-actors');
    if (!ae) return;
    var actors = preloadedActors;
    if (!actors) {
      ensureDetailRowPool(ae, CATALOG_CONSTANTS.MAX_ACTORS, buildActorCard);
      clearDetailActorCards(ae);
      showDetailRowMessage(ae, '<div class="catalog-loading"><div class="loading-spinner-small"></div><span>Загрузка актеров...</span></div>');
      aw.classList.remove('hidden');
      actors = yield fetchCatalogActors(item);
    }
    renderDetailActorCards(ae, actors, 'Нет фото');
    aw.classList.remove('hidden');
    resetDetailRowScroll(ae);
  });
  return _renderDetailActors.apply(this, arguments);
}
function resetDetailRowScroll(el) {
  if (!el) return;
  if (typeof setScrollXImmediate === 'function') setScrollXImmediate(el, 0);else el.scrollLeft = 0;
}
function renderDetailRecommendations(src, rw, mt) {
  if (!rw) return;
  var re = getEl('catalog-detail-recommendations');
  if (!re) return;
  var recs = src.recommendations && src.recommendations.length ? src.recommendations.slice(0, CATALOG_CONSTANTS.MAX_RECOMMENDATIONS) : [];
  var pool = ensureDetailRowPool(re, CATALOG_CONSTANTS.MAX_RECOMMENDATIONS, buildRecommendationCard);
  hideDetailRowMessage(re);
  if (!recs.length) {
    for (var h = 0; h < pool.length; h++) hideDetailCard(pool[h]);
    rw.classList.add('hidden');
    return;
  }
  for (var i = 0; i < pool.length; i++) {
    if (!recs[i]) {
      hideDetailCard(pool[i]);
      continue;
    }
    fillRecommendationCard(pool[i], recs[i], mt);
  }
  rw.classList.remove('hidden');
  resetDetailRowScroll(re);
}
function fillRecommendationCard(card, r, mt) {
  var title = r.title || r.name || 'Без названия';
  card.dataset.tmdbId = r.id;
  card.dataset.mediaType = r.media_type || mt;
  card.dataset.title = title;
  card._title.textContent = title;
  var rating = r.vote_average ? Math.round(r.vote_average * 10) / 10 : 0;
  card._rating.textContent = rating ? rating : '';
  card._rating.style.color = rating ? getRatingColor(rating) : '';
  card._bar.classList.toggle('hidden', !rating);
  var date = r.release_date || r.first_air_date;
  var yearText = date ? String(date).substring(0, 4) : '';
  card._year.textContent = yearText;
  if (card._sub) {
    card._sub.innerHTML = escapeHtml(yearText) + (rating ? (yearText ? '<span class="catalog-rec-dot">·</span>' : '') + '<span class="catalog-rec-star">★ ' + escapeHtml(String(rating)) + '</span>' : '');
  }
  setDetailCardPoster(card, r.poster_path ? getTmdbImageUrl(r.poster_path, CATALOG_CONSTANTS.IMG_SIZES.POSTER_MEDIUM) : '');
  card.classList.remove('hidden');
}
var detailCollectionCache = {};
var CINEMA_LANE_WRAP_IDS = ['catalog-detail-episodes-wrap', 'catalog-detail-crew-wrap', 'catalog-detail-actors-wrap', 'catalog-detail-collection-wrap', 'catalog-detail-recommendations-wrap'];
function updateCinemaLaneDensity(pending) {
  var dv = getEl('detail-view');
  if (!dv) return;
  var n = pending || 0;
  for (var i = 0; i < CINEMA_LANE_WRAP_IDS.length; i++) {
    var w = getEl(CINEMA_LANE_WRAP_IDS[i]);
    if (w && !w.classList.contains('hidden') && w.style.display !== 'none') n++;
  }
  dv.classList.toggle('cinema-roomy', n > 0 && n <= 2);
}
function collectionKnownEmpty(item, bc) {
  var d = detailCollectionCache[String(bc.id)];
  if (!d || !Array.isArray(d.items)) return false;
  for (var i = 0; i < d.items.length; i++) {
    if (String(d.items[i].id) !== String(item.id)) return false;
  }
  return true;
}
function renderDetailCollection(item, src) {
  var wrap = getEl('catalog-detail-collection-wrap'),
    grid = getEl('catalog-detail-collection');
  if (!wrap || !grid) return;
  wrap.classList.add('hidden');
  var bc = src && src.belongs_to_collection;
  if ((item.media_type || 'movie') !== 'movie' || !bc || !bc.id) return;
  var key = String(bc.id);
  var cached = detailCollectionCache[key];
  var p = cached ? Promise.resolve(cached) : safeFetch(SERVER_URL + '/api/tmdb/collection/parts?id=' + encodeURIComponent(key), {
    timeout: 15000
  });
  p.then(function (d) {
    if (!d || !d.success || !Array.isArray(d.items)) return;
    detailCollectionCache[key] = d;
    if (!isDetailStillCurrent(item)) return;
    var parts = [];
    for (var i = 0; i < d.items.length; i++) {
      if (String(d.items[i].id) !== String(item.id)) parts.push(d.items[i]);
    }
    if (!parts.length) {
      updateCinemaLaneDensity();
      return;
    }
    var name = String(d.name || bc.name || '').replace(/\s*\((?:коллекция|collection)\)\s*$/i, '');
    wrap.firstChild.textContent = name ? 'Коллекция: ' + name : 'Коллекция';
    var pool = ensureDetailRowPool(grid, CATALOG_CONSTANTS.MAX_RECOMMENDATIONS, buildRecommendationCard);
    hideDetailRowMessage(grid);
    for (var j = 0; j < pool.length; j++) {
      if (!parts[j]) {
        hideDetailCard(pool[j]);
        continue;
      }
      fillRecommendationCard(pool[j], parts[j], 'movie');
    }
    resetDetailRowScroll(grid);
    wrap.classList.remove('hidden');
    updateCinemaLaneDensity();
    if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
  });
}
function setupDetailDelegation(dv) {
  if (dv._detailClickHandler) {
    dv.removeEventListener('click', dv._detailClickHandler);
  }
  dv._detailClickHandler = function (e) {
    var episodeCard = e.target.closest('.catalog-episode-card');
    if (episodeCard) {
      playCardEpisode(episodeCard);
      return;
    }
    var actorCard = e.target.closest('.catalog-actor-card');
    if (actorCard && actorCard.dataset.personId) {
      openPersonCatalog(actorCard.dataset.personId, actorCard.dataset.personName);
      return;
    }
    var recCard = e.target.closest('.catalog-recommendation-card');
    if (recCard) {
      if (window.Nav) Nav.push('detail', Nav.detailData({
        id: recCard.dataset.tmdbId,
        media_type: recCard.dataset.mediaType,
        title: recCard.dataset.title
      }));
      showCatalogDetail({
        id: recCard.dataset.tmdbId,
        media_type: recCard.dataset.mediaType,
        torrent: [{
          name: recCard.dataset.title
        }],
        title: recCard.dataset.title,
        name: recCard.dataset.title
      }, 0, null);
      return;
    }
  };
  dv.addEventListener('click', dv._detailClickHandler);
}
var detailResume = {
  item: null,
  resume: null,
  hash: '',
  tiles: []
};
function setupDetailResume(item) {
  var btn = getEl('catalog-resume-btn');
  var r = window.HomeScreen && typeof HomeScreen.resumeFor === 'function' ? HomeScreen.resumeFor(item) : null;
  detailResume.item = item;
  detailResume.resume = r;
  if (!btn) return null;
  btn.classList.toggle('hidden', !r);
  if (!r) return null;
  btn.textContent = HomeScreen.resumeLabel(item, r);
  btn.onclick = function () {
    playFromCard(item, r, btn);
  };
  if (item.media_type !== 'tv' || typeof window.loadResumeEpisodes !== 'function') return null;
  return window.loadResumeEpisodes(item, r)['catch'](function () {
    return null;
  });
}
function playFromCard(item, resume, from) {
  if (typeof window.resumeWatching !== 'function') return;
  var fail = function (text) {
    if (typeof window.showToast === 'function') window.showToast(text);
    focusDetailMain();
  };
  window.resumeWatching(item, resume, {
    card: from
  }).then(function (res) {
    if (res === 'started' || res === 'offline') return;
    fail(res === 'last' ? 'Это последняя серия раздачи' : 'Раздачи больше нет в TorrServer — выберите её заново');
  }, function () {
    fail('Не удалось начать воспроизведение');
  });
}
function playCardEpisode(card) {
  var d = card.dataset;
  if (!d.hash || !detailResume.item) return;
  var at = Number(d.timecode) || 0,
    duration = Number(d.duration) || 0;
  var finished = typeof window.isResumeFinished === 'function' && window.isResumeFinished({
    timecode: at,
    duration: duration
  });
  playFromCard(detailResume.item, {
    hash: d.hash,
    fileId: d.fileId,
    timecode: finished ? 0 : at,
    duration: duration
  }, card);
}
function focusDetailMain() {
  var rb = getEl('catalog-resume-btn'),
    wb = getEl('catalog-watch-btn');
  var target = rb && !rb.classList.contains('hidden') ? rb : wb;
  if (target && typeof window.focusEl === 'function') window.focusEl(target);
}
function buildEpisodeCard() {
  var card = document.createElement('div');
  card.className = 'catalog-episode-card hidden';
  var still = document.createElement('div');
  still.className = 'catalog-episode-still';
  var img = document.createElement('img');
  img.decoding = 'async';
  img.alt = '';
  img.className = 'hidden';
  var noStill = document.createElement('div');
  noStill.className = 'catalog-episode-no-still hidden';
  img.onload = function () {
    img.classList.remove('hidden');
  };
  img.onerror = function () {
    img.classList.add('hidden');
    noStill.classList.remove('hidden');
  };
  still.appendChild(img);
  still.appendChild(noStill);
  var play = document.createElement('div');
  play.className = 'catalog-episode-play';
  play.textContent = '▶';
  var info = document.createElement('div');
  info.className = 'catalog-episode-info';
  var name = document.createElement('div');
  name.className = 'catalog-episode-name marquee-text';
  var nameText = document.createElement('span');
  name.appendChild(nameText);
  var size = document.createElement('div');
  size.className = 'catalog-episode-size';
  info.appendChild(name);
  info.appendChild(size);
  var bar = document.createElement('div');
  bar.className = 'catalog-episode-progress hidden';
  var fill = document.createElement('div');
  bar.appendChild(fill);
  card.appendChild(still);
  card.appendChild(play);
  card.appendChild(info);
  card.appendChild(bar);
  card._img = img;
  card._placeholder = noStill;
  card._nameBox = name;
  card._name = nameText;
  card._size = size;
  card._bar = bar;
  card._fill = fill;
  return card;
}
function renderDetailEpisodes(data, keepScroll) {
  var wrap = getEl('catalog-detail-episodes-wrap'),
    grid = getEl('catalog-detail-episodes');
  if (!wrap || !grid) return;
  var tiles = detailResume.tiles,
    files = data && data.files || [];
  while (tiles.length < files.length) {
    var fresh = buildEpisodeCard();
    fresh._poolIdx = tiles.length;
    grid.appendChild(fresh);
    tiles.push(fresh);
  }
  var currentIdx = 0;
  for (var i = 0; i < tiles.length; i++) {
    var card = tiles[i],
      file = files[i];
    if (!file) {
      hideDetailCard(card);
      delete card.dataset.hash;
      delete card.dataset.fileId;
      continue;
    }
    var meta = typeof getTorrentEpisodeMeta === 'function' ? getTorrentEpisodeMeta(data.hash, file.id) : null;
    var label = typeof formatEpisodeLabel === 'function' ? formatEpisodeLabel(meta, i + 1) : 'Серия ' + (i + 1);
    var watched = data.progress && data.progress[String(file.id)];
    var current = String(file.id) === String(data.current);
    if (current) currentIdx = i;
    card.dataset.hash = data.hash;
    card.dataset.fileId = file.id;
    card.dataset.timecode = watched ? watched.timecode : 0;
    card.dataset.duration = watched ? watched.duration : 0;
    card._name.textContent = label;
    card._nameBox.classList.remove('marquee');
    card._size.textContent = typeof formatBytes === 'function' ? formatBytes(file.length) : '';
    var share = watched && watched.duration > 0 ? Math.min(watched.timecode / watched.duration, 1) : 0;
    card._bar.classList.toggle('hidden', !(share > 0));
    card._fill.style.width = share * 100 + '%';
    card.classList.toggle('is-current', current);
    var still = meta && meta.stillPath ? buildTmdbPosterUrl(meta.stillPath, 'w300') : '';
    if (still !== card._posterUrl || !still) setDetailCardPoster(card, still);
    card.classList.remove('hidden');
  }
  wrap.classList.toggle('hidden', !files.length);
  updateCinemaLaneDensity();
  if (files.length && !keepScroll) {
    var step = files.length > 1 ? tiles[1].getBoundingClientRect().left - tiles[0].getBoundingClientRect().left : 0;
    if (typeof setScrollXImmediate === 'function') setScrollXImmediate(grid, step * currentIdx);
  }
  if (typeof window.invalidateFocusCache === 'function') window.invalidateFocusCache();
}
function refreshDetailResume() {
  var item = detailResume.item;
  var update = window.HomeScreen && typeof HomeScreen.updateResume === 'function' ? HomeScreen.updateResume() : Promise.resolve();
  var stillHere = function () {
    return item && detailResume.item === item && isCinemaCatalogDetail();
  };
  return update.then(function () {
    if (!stillHere()) return null;
    var episodes = setupDetailResume(item);
    var f = document.querySelector('.focused');
    if (AppState.currentScreen === 'detail' && (!f || f.offsetParent === null)) focusDetailMain();
    return episodes;
  }).then(function (data) {
    if (stillHere()) renderDetailEpisodes(data, true);
  });
}
window.refreshDetailResume = refreshDetailResume;
function isDetailStillCurrent(item) {
  var cur = AppState.currentDetailItem;
  if (!cur || !item) return false;
  if (cur === item) return true;
  return item.id != null && String(cur.id) === String(item.id);
}
function showCatalogDetail(_x39, _x40, _x41) {
  return _showCatalogDetail.apply(this, arguments);
}
function _showCatalogDetail() {
  _showCatalogDetail = _asyncToGenerator(function* (item, index, posterUrl) {
    if (typeof Animations !== 'undefined' && typeof Animations.beginDetailSwap === 'function') {
      yield Animations.beginDetailSwap();
    }
    if (typeof window.resetDetailBackground === 'function') {
      try {
        window.resetDetailBackground();
      } catch (e) {}
    }
    var layout = setupDetailLayout(item, index, posterUrl);
    var dv = layout.dv,
      mc = layout.mc,
      aw = layout.aw,
      rw = layout.rw,
      savedScroll = layout.savedScroll;
    var title = getCatalogItemTitle(item),
      mt = item.media_type || 'movie';
    dv.classList.add('catalog-detail-mode');
    dv.classList.remove('torrent-detail-mode');
    resetDetailBackdrop();
    AppState.currentDetailItem = item;
    AppState.currentScreen = 'detail';
    if (typeof Animations !== 'undefined') Animations.animateDetailShow();
    dv.style.pointerEvents = 'auto';
    if (mc) mc.style.pointerEvents = 'none';
    if (typeof window.hideCatalogDetailExtra === 'function') window.hideCatalogDetailExtra();
    if (typeof window.visibleItemsforDetail === 'function') window.visibleItemsforDetail('showCatalogDetail');
    var wb = getEl('catalog-watch-btn');
    setupFavoriteButton(item);
    var episodesPromise = setupDetailResume(item);
    if (window.BestTorrents) BestTorrents.beginCard(item);
    if (aw) aw.classList.add('hidden');
    if (rw) rw.classList.add('hidden');
    if (wb) {
      var knownPoster = getCatalogKnownPosterUrl(item, posterUrl);
      wb.onclick = function () {
        AppState.currentScreen = 'search';
        showCatalogSearch(wb.dataset.searchTitle || title, knownPoster, item).then(function (found) {
          if (found > 0) {
            dv.style.display = 'none';
            dv.style.pointerEvents = 'none';
            if (mc) mc.style.pointerEvents = 'auto';
            return;
          }
          AppState.currentScreen = 'detail';
          if (window.Nav) Nav.pop('search');
          dv.style.display = 'block';
          dv.style.pointerEvents = 'auto';
          if (mc) mc.style.pointerEvents = 'none';
          var so = getEl('search-overlay');
          if (so) {
            if (typeof Animations !== 'undefined' && typeof Animations.fadeOut === 'function') {
              Animations.fadeOut(so, {
                duration: Animations.UI_FADE.overlay,
                display: 'none',
                addHidden: true
              });
            } else {
              so.classList.add('hidden');
            }
          }
          if (!AppState.lastSearchFailure && typeof window.showErrorBanner === 'function') {
            window.showErrorBanner('Торренты не найдены', 'По запросу «' + (wb.dataset.searchTitle || title) + '» ничего нет');
          }
          setTimeout(function () {
            if (window.ScreenStrategies && ScreenStrategies.detail && typeof ScreenStrategies.detail.ensureFocus === 'function') {
              ScreenStrategies.detail.ensureFocus(true);
            }
          }, 80);
        });
      };
    }
    var restore = function () {
      if (mc && savedScroll > 0) setTimeout(function () {
        mc.scrollTop = savedScroll;
      }, 50);
    };
    var detailsPromise = fetchCatalogItemDetails(item);
    var actorsPromise = fetchCatalogActors(item);
    var details = yield detailsPromise;
    if (!isDetailStillCurrent(item)) return;
    restore();
    renderDetailHeader(item, posterUrl, details);
    var actors = yield actorsPromise;
    if (!isDetailStillCurrent(item)) return;
    var src = details || item || {};
    var peopleMerged = cinemaPeopleMerged();
    if (peopleMerged) {
      var crewFirst = cinemaCrewAsActors(item, src);
      if (crewFirst.length) actors = crewFirst.concat(actors || []);
    }
    renderDetailActors(item, aw, actors);
    renderDetailCrew(item, src, peopleMerged);
    renderDetailCollection(item, src);
    renderDetailRecommendations(src, rw, mt);
    var bc = src.belongs_to_collection;
    updateCinemaLaneDensity((mt === 'movie' && bc && bc.id && !collectionKnownEmpty(item, bc) ? 1 : 0) + (episodesPromise ? 1 : 0));
    if (episodesPromise) episodesPromise.then(function (data) {
      if (isDetailStillCurrent(item)) renderDetailEpisodes(data, false);
    });
    stopTrailerBackground();
    var trailerTitle = src.title || src.name || title;
    var trailerOriginal = src.original_title || src.original_name || '';
    var trailerDate = src.release_date || src.first_air_date || '';
    var trailerCacheKey = String(item.id || '') + '_' + mt;
    var cachedTrailer = getCachedRutubeTrailer(trailerCacheKey);
    if (cachedTrailer) {
      rutubeTrailerState.currentUrl = cachedTrailer.url;
      rutubeTrailerState.currentTitle = cachedTrailer.title;
      showTrailerButton();
    } else {
      rutubeTrailerState.currentUrl = null;
      rutubeTrailerState.currentTitle = null;
      fetchRutubeTrailerCached({
        id: item.id,
        type: mt
      }, trailerTitle, trailerOriginal, trailerDate).then(function (result) {
        if (!result || !result.url) return;
        putCachedRutubeTrailer(trailerCacheKey, result.url, result.title || trailerTitle);
        if (AppState.currentScreen === 'detail' && AppState.currentDetailItem && String(AppState.currentDetailItem.id) === String(item.id)) {
          rutubeTrailerState.currentUrl = result.url;
          rutubeTrailerState.currentTitle = result.title || trailerTitle;
          showTrailerButton();
        }
      }).catch(function (e) {
        console.warn('RuTube trailer search failed:', e);
      });
    }
    setupDetailDelegation(dv);
    requestAnimationFrame(function () {
      if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
        updateFocusableElements();
        var idx = -1;
        var mainBtn = detailResume.resume ? 'catalog-resume-btn' : 'catalog-watch-btn';
        if (typeof focusableElements !== 'undefined') {
          for (var i = 0; i < focusableElements.length; i++) {
            if (focusableElements[i].id === mainBtn) {
              idx = i;
              break;
            }
          }
        }
        setFocus(idx !== -1 ? idx : 0);
      }
      if (typeof Animations !== 'undefined' && typeof Animations.detailContentReady === 'function') {
        Animations.detailContentReady();
      }
      if (window.BestTorrents) BestTorrents.cardReady(item, wb && wb.dataset.searchTitle || title, details);
    });
  });
  return _showCatalogDetail.apply(this, arguments);
}
var DETAIL_NAV_SCREENS = {
  'home-nav-home': 'home',
  'tab-catalog': 'catalog',
  'tab-favorites': 'catalog',
  'tab-torrents': 'torrents'
};
function detailTopbarNavigate(btnId) {
  if (DETAIL_NAV_SCREENS[btnId]) exitDetailForSectionNav(btnId);else prepareOverlayOverDetail(btnId);
}
function prepareOverlayOverDetail(btnId) {
  if (window.DetailTopbar && typeof DetailTopbar.ensureHome === 'function') {
    DetailTopbar.ensureHome();
  }
  if (btnId === 'settings-btn') {
    var dv = getEl('detail-view');
    if (dv && dv.style.display && dv.style.display !== 'none') {
      stopTrailerBackground();
      dv.style.visibility = 'hidden';
      dv.style.pointerEvents = 'none';
      var mc = getEl('main-container');
      if (mc) mc.style.pointerEvents = 'auto';
    }
  }
}
function restoreDetailAfterOverlay() {
  var dv = getEl('detail-view');
  if (!dv || !dv.style.display || dv.style.display === 'none') return false;
  if (!AppState.currentDetailItem) return false;
  AppState.currentScreen = 'detail';
  dv.style.pointerEvents = 'auto';
  var mc = getEl('main-container');
  if (mc) mc.style.pointerEvents = 'none';
  if (typeof Animations !== 'undefined' && typeof Animations.ensureDetailVisible === 'function') {
    Animations.ensureDetailVisible();
  }
  if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
  setTimeout(function () {
    if (window.ScreenStrategies && ScreenStrategies.detail && typeof ScreenStrategies.detail.ensureFocus === 'function') {
      ScreenStrategies.detail.ensureFocus(true);
    }
  }, CATALOG_CONSTANTS.FOCUS_DELAY_MS);
  return true;
}
function clearDetailReturnPath() {
  catalogState.person = null;
  AppState.currentDetailItem = null;
  AppState.androidBackCatalog = '';
}
function exitDetailForSectionNav(btnId) {
  if (window.Nav && DETAIL_NAV_SCREENS[btnId]) Nav.reset(DETAIL_NAV_SCREENS[btnId]);
  var dv = getEl('detail-view');
  var mc = getEl('main-container');
  if (window.DetailTopbar && typeof DetailTopbar.ensureHome === 'function') {
    DetailTopbar.ensureHome();
  }
  clearDetailReturnPath();
  stopTrailerBackground();
  hideCatalogDetailView();
  if (typeof Animations !== 'undefined' && typeof Animations.animateDetailHide === 'function') {
    Animations.animateDetailHide();
  } else if (dv) {
    dv.style.display = 'none';
  }
  if (dv) dv.style.pointerEvents = 'none';
  if (mc) mc.style.pointerEvents = 'auto';
  var screen = DETAIL_NAV_SCREENS[btnId];
  if (!screen || screen === 'home') return;
  AppState.currentScreen = screen;
  var btn = getEl(btnId);
  if (!btn || !btn.classList.contains('active')) return;
  if (typeof showContentScreen === 'function') {
    var scroll = AppState.contentScroll && AppState.contentScroll[screen] || 0;
    showContentScreen(screen, scroll);
  }
  setTimeout(function () {
    if (window.ScreenStrategies && ScreenStrategies[screen] && typeof ScreenStrategies[screen].ensureFocus === 'function') {
      ScreenStrategies[screen].ensureFocus(true);
    }
  }, CATALOG_CONSTANTS.FOCUS_DELAY_MS);
}
function dropDetailUnderOverlay() {
  var dv = getEl('detail-view');
  if (!dv) return false;
  clearDetailReturnPath();
  stopTrailerBackground();
  hideCatalogDetailView();
  dv.style.display = 'none';
  dv.style.pointerEvents = 'none';
  if (typeof Animations !== 'undefined' && typeof Animations.dropDetailShade === 'function') {
    Animations.dropDetailShade();
  }
  var mc = getEl('main-container');
  if (mc) mc.style.pointerEvents = 'auto';
  if (typeof window.resetDetailBackground === 'function') {
    try {
      window.resetDetailBackground();
    } catch (e) {}
  }
  return true;
}
window.clearDetailReturnPath = clearDetailReturnPath;
window.exitDetailForSectionNav = exitDetailForSectionNav;
window.dropDetailUnderOverlay = dropDetailUnderOverlay;
window.detailTopbarNavigate = detailTopbarNavigate;
window.restoreDetailAfterOverlay = restoreDetailAfterOverlay;
function hideCatalogDetailView() {
  var dv = getEl('detail-view');
  if (!dv) return;
  stopTrailerBackground();
  if (window.BestTorrents) BestTorrents.leave();
  dv.classList.remove('catalog-detail-mode');
  dv.style.backgroundImage = '';
  var se = getEl('detail-title-subtitle');
  if (se) se.textContent = '';
  AppState.detailMode = null;
}
function updateCatalogWatchButton(t) {
  var b = getEl('catalog-watch-btn');
  if (b) b.textContent = 'Торренты';
}
function onCatalogItemClick(item, index) {
  catalogState.lastSelectedIndex = index;
  catalogState.lastSelectedId = item.id;
  localStorage.setItem('lastCatalogCardIndex', item.num_index !== undefined ? item.num_index : index);
  if (catalogState.currentCatalog === 'person' && catalogState.person) {
    catalogState.person.lastIndex = index;
    catalogState.person.lastId = item.id;
  }
  var card = document.querySelector('#catalog-grid .torrent-card.catalog-card[data-catalog-index="' + index + '"]');
  var pu = null;
  if (card) {
    var img = card.querySelector('.torrent-poster img');
    if (img && img.src) pu = img.src;
  }
  AppState.catalogIndex = index;
  AppState.catalogPu = pu;
  AppState.androidBackCatalog = item;
  if (window.Nav) Nav.push('detail', Nav.detailData(item, index));
  showCatalogDetail(item, index, pu);
}
function buildJacredSearchHints(item, details) {
  if (!item) return null;
  var d = details || {};
  var mt = item.media_type || AppState.mediaType || 'movie';
  var serial = mt === 'tv';
  var title = String(item.title || item.name || d.title || d.name || '').trim();
  var original = String(d.original_title || d.original_name || item.original_title || item.original_name || '').trim();
  var year = getCatalogItemYear(d) || (item.isHistoryItem ? null : getCatalogItemYear(item));
  return {
    isSerial: serial ? 2 : 1,
    year: serial && !title ? null : year,
    title: title || null,
    titleOriginal: title && original ? original : null
  };
}
function showCatalogSearch(q, pu, item) {
  var st = getEl('tab-search'),
    tt = getEl('tab-torrents'),
    ct = getEl('tab-catalog'),
    so = getEl('search-overlay'),
    si = getEl('search-query');
  if (st && tt && ct && so) {
    st.classList.add('active');
    tt.classList.remove('active');
    ct.classList.remove('active');
    var overlayShown = null;
    if (typeof Animations !== 'undefined' && typeof Animations.fadeIn === 'function') {
      overlayShown = new Promise(function (resolve) {
        Animations.fadeIn(so, {
          duration: Animations.UI_FADE.overlay,
          display: 'flex',
          onDone: resolve
        });
      });
    } else {
      so.classList.remove('hidden');
    }
    if (si) {
      si.value = q;
      if (document.activeElement === si) si.blur();
    }
    if (typeof window.setSearchLocked === 'function') window.setSearchLocked(true, q);
    window.pendingCatalogPoster = pu;
    window.pendingCatalogItem = item;
    if (window.Nav) Nav.push('search', {
      key: 'search',
      label: q
    });
    if (item) {
      pu = getCatalogKnownPosterUrl(item, pu);
      window.pendingCatalogPoster = pu;
      window.pendingCatalogItem = item;
      AppState.pendingDetailItem = item;
      AppState.pendingDetailPoster = pu;
      AppState.pendingDetailTmdbId = item && (item.id || item.tmdbId) || null;
      AppState.pendingDetailMediaType = item && item.media_type || null;
      if (item && item.media_type) {
        AppState.mediaType = item.media_type;
      }
      AppState.pendingDetailIndex = catalogState.lastSelectedIndex;
    }
    AppState.currentScreen = 'search';
    var cardHints = buildJacredSearchHints(item);
    AppState.jacredSearchHints = cardHints;
    var detailsReady = item && item.id ? Promise.resolve(fetchTmdbDetails(item)).catch(function () {
      return null;
    }) : Promise.resolve(null);
    if (typeof window.resetFiltersForCardSearch === 'function') {
      window.resetFiltersForCardSearch(item && (item.id || item.tmdbId) ? (item.media_type || '') + ':' + (item.id || item.tmdbId) : q);
    }
    var searching = Promise.resolve(0);
    if (typeof window.searchTorrentsLegacy === 'function') {
      var tm = getEl('torrent-movie');
      if (tm) tm.value = 'torrentsearch';
      searching = detailsReady.then(function (details) {
        if (details && AppState.jacredSearchHints === cardHints) {
          AppState.jacredSearchHints = buildJacredSearchHints(item, details);
        }
        return window.searchTorrentsLegacy(q);
      }).then(function (n) {
        return typeof n === 'number' ? n : 0;
      }).catch(function () {
        return 0;
      });
    }
    return searching;
  }
  return Promise.resolve(0);
}
function exitYoutubePlayer() {
  if (AppState.currentStreamId) {
    fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, {
      method: 'POST'
    }).catch(function () {});
    AppState.currentStreamId = null;
  }
  if (AppState.hls) {
    AppState.hls.destroy();
    AppState.hls = null;
  }
  AppState.isYoutubePlayback = false;
  var ctx = AppState.youtubeContext;
  if (ctx && ctx.currentDetailItem && ctx.currentDetailItem.id) {
    AppState.currentScreen = 'detail';
    getEl('player-screen').style.display = 'none';
    var dv = getEl('detail-view'),
      mc = getEl('main-container');
    if (dv) {
      dv.style.display = 'block';
      dv.style.pointerEvents = 'auto';
    }
    if (mc) mc.style.pointerEvents = 'auto';
    setTimeout(function () {
      showCatalogDetail(ctx.currentDetailItem, ctx.itemIndex || 0, null);
    }, 100);
    AppState.youtubeContext = null;
  } else if (catalogState && catalogState.currentCatalog) {
    if (typeof window.showCatalogList === 'function') window.showCatalogList();
  } else {
    var ts = getEl('torrserver-section');
    if (ts) ts.style.display = 'block';
    getEl('config-screen').style.display = 'none';
    if (typeof loadTorrents === 'function') loadTorrents(true);
  }
  setTimeout(function () {
    if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
      updateFocusableElements();
      var b = getEl('catalog-watch-btn'),
        i = -1;
      if (typeof focusableElements !== 'undefined') {
        for (var k = 0; k < focusableElements.length; k++) {
          if (focusableElements[k].id === 'catalog-watch-btn') {
            i = k;
            break;
          }
        }
      }
      if (i !== -1) setFocus(i);else if (typeof window.focusFirstCatalogCard === 'function') window.focusFirstCatalogCard();else setFocus(0);
    }
  }, 200);
}
function fetchAvailableCatalogs() {
  return _fetchAvailableCatalogs.apply(this, arguments);
}
function _fetchAvailableCatalogs() {
  _fetchAvailableCatalogs = _asyncToGenerator(function* () {
    var d = yield safeFetch(SERVER_URL + '/api/catalogs');
    return d && d.success && d.catalogs ? d.catalogs : [];
  });
  return _fetchAvailableCatalogs.apply(this, arguments);
}
function releaseCatalogGrid() {
  abortCatalogRequests();
  if (typeof window.resetGridScrollTransform === 'function') window.resetGridScrollTransform();
  catalogState.currentCatalog = null;
  catalogState.items = [];
  catalogState.cardElements = {};
  catalogState.person = null;
  AppState.backCurrentCatalog = '';
  var oldGrid = getCatalogGridEl();
  if (oldGrid && (oldGrid.hasChildNodes() || oldGrid.style.display !== 'none')) {
    if (catalogFadedEl === oldGrid) catalogFadedEl = null;
    oldGrid.style.display = 'none';
    oldGrid.innerHTML = '';
    resetGridVisibilityWindow();
    resetGridChunks();
  }
}
window.releaseCatalogGrid = releaseCatalogGrid;
function showCatalogList(_x42) {
  return _showCatalogList.apply(this, arguments);
}
function _showCatalogList() {
  _showCatalogList = _asyncToGenerator(function* (force) {
    if (window.HomeScreen && typeof HomeScreen.show === 'function') {
      releaseCatalogGrid();
      if (window.Nav) Nav.reset('home');
      HomeScreen.show({
        restoreFocus: true
      });
      return true;
    }
    var rows = getCatalogRowsEl();
    if (!rows) return;
    abortCatalogRequests();
    catalogState.currentCatalog = null;
    catalogState.items = [];
    catalogState.cardElements = {};
    catalogState.loading = false;
    catalogState.loadedPostersCount = 0;
    catalogState.posterLoadQueue = [];
    catalogState.lastSelectedIndex = 0;
    catalogState.lastSelectedId = null;
    var catalogTab = getEl('tab-catalog');
    if (catalogTab) catalogTab.classList.add('active');
    catalogState.favoritesFromTopbar = false;
    var favoritesTab = getEl('tab-favorites');
    if (favoritesTab) favoritesTab.classList.remove('active');
    var torrentsTab = getEl('tab-torrents');
    if (torrentsTab) torrentsTab.classList.remove('active');
    var searchTab = getEl('tab-search');
    if (searchTab) searchTab.classList.remove('active');
    if (!force && rows.querySelector('.catalog-row') && window.catalogRows && window.catalogRows.length) {
      showCatalogRowsView({
        deferReveal: true
      });
      resetStrandedRowPosters();
      initRowPosterLazyLoading();
      yield refreshFavoritesRow();
      var finishRowsReturn = function () {
        if (AppState.currentScreen !== 'catalog' || catalogState.currentCatalog) {
          revealCatalogRowsView();
          return;
        }
        if (typeof updateFocusableElements === 'function') updateFocusableElements();
        if (typeof window.withInstantScroll === 'function') {
          window.withInstantScroll(restoreRowFocus);
        } else {
          restoreRowFocus();
        }
        revealCatalogRowsView();
      };
      requestAnimationFrame(finishRowsReturn);
      return true;
    }
    window.catalogRows = [];
    window.catalogRowsData = {};
    showCatalogRowsView();
    rows.innerHTML = '<div class="catalog-rows-loading"><div class="loading-spinner" style="margin:0 auto 20px"></div><div style="font-size:16px;color:#aaa">Загрузка каталогов...</div></div>';
    if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
    var keys = [];
    for (var k in CATALOG_CONFIG) {
      if (CATALOG_CONFIG.hasOwnProperty(k)) keys.push(k);
    }
    return loadCatalogRowsProgressively(rows, keys);
  });
  return _showCatalogList.apply(this, arguments);
}
function loadCatalogRowsProgressively(container, keys) {
  var MAX_PARALLEL_ROW_LOADS = 3;
  var results = new Array(keys.length);
  var nextToLoad = 0;
  var nextToRender = 0;
  var activeLoads = 0;
  var completedLoads = 0;
  var renderedRows = 0;
  var rowsActivated = false;
  var finished = false;
  function isCurrentCatalogList() {
    return AppState.currentScreen === 'catalog' && !catalogState.currentCatalog;
  }
  function finish(value, resolve) {
    if (finished) return;
    finished = true;
    resolve(value);
  }
  function observeRowPosters(row) {
    var fresh = false;
    if (!catalogState.rowPosterObserver) {
      initRowPosterLazyLoading();
      fresh = true;
    }
    if (CATALOG_CONSTANTS.PRELOAD_ALL_ROW_POSTERS_ON_START) {
      if (queueRowPosters(row, 0)) processRowPosterQueue();
      return;
    }
    if (fresh) return;
    var cards = row.querySelectorAll('.catalog-row-card');
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].dataset.itemIndex !== undefined && cards[i].dataset.posterLoaded !== '1') {
        catalogState.rowPosterObserver.observe(cards[i]);
      }
    }
  }
  function activateRows() {
    if (rowsActivated) return;
    rowsActivated = true;
    requestAnimationFrame(function () {
      if (!isCurrentCatalogList()) return;
      if (typeof updateFocusableElements === 'function') updateFocusableElements();
      setTimeout(function () {
        if (!isCurrentCatalogList()) return;
        container.style.display = '';
        restoreRowFocus();
      }, CATALOG_CONSTANTS.FOCUS_DELAY_MS);
    });
  }
  return new Promise(function (resolve) {
    function renderReadyRows() {
      if (!isCurrentCatalogList()) {
        finish(false, resolve);
        return;
      }
      var appended = 0;
      while (nextToRender < keys.length && results[nextToRender] !== undefined) {
        var result = results[nextToRender++];
        if (!result.items || result.items.length === 0) continue;
        var row = createCatalogRow(result.key, result.items);
        if (!row) continue;
        if (renderedRows === 0) {
          container.innerHTML = '';
          resetRowVisibilityWindow();
        }
        container.appendChild(row);
        renderedRows++;
        appended++;
        observeRowPosters(row);
        observeRowVisibility(row);
        activateRows();
      }
      if (appended && typeof invalidateFocusCache === 'function') invalidateFocusCache();
    }
    function scheduleLoads() {
      if (finished) return;
      if (!isCurrentCatalogList()) {
        finish(false, resolve);
        return;
      }
      if (completedLoads === keys.length) {
        if (renderedRows === 0) {
          container.innerHTML = '<div class="catalog-rows-loading"><div style="font-size:48px;margin-bottom:20px">🎬</div><div style="font-size:18px;color:#aaa">Каталоги пусты</div></div>';
          resetRowVisibilityWindow();
          if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
        }
        revealCatalogGrid('', container);
        finish(true, resolve);
        return;
      }
      while (activeLoads < MAX_PARALLEL_ROW_LOADS && nextToLoad < keys.length) {
        (function (index, key) {
          activeLoads++;
          loadRowItems(key).then(function (items) {
            results[index] = {
              key: key,
              items: items || []
            };
          }).catch(function () {
            results[index] = {
              key: key,
              items: []
            };
          }).then(function () {
            activeLoads--;
            completedLoads++;
            renderReadyRows();
            scheduleLoads();
          });
        })(nextToLoad, keys[nextToLoad]);
        nextToLoad++;
      }
    }
    scheduleLoads();
  });
}
function loadRowItems(_x43) {
  return _loadRowItems.apply(this, arguments);
}
function _loadRowItems() {
  _loadRowItems = _asyncToGenerator(function* (key) {
    var LIMIT = 10;
    if (key === 'favorites') return yield loadFavoritesItems(LIMIT);
    if (key === 'history') {
      var data = yield safeFetch(withClientId(SERVER_URL + '/api/history'), {
        timeout: 10000
      });
      if (data && data.success && data.history && data.history.length) {
        window.catalogRowTotals[key] = data.history.length;
        return data.history.slice(0, LIMIT).map(function (item) {
          var pp = item.posterPath;
          if (pp && pp.indexOf('http') !== 0) pp = pp.indexOf('/') === 0 ? pp : '/' + pp;
          return {
            id: item.tmdbId,
            title: item.title,
            name: item.title,
            media_type: item.mediaType,
            poster_path: pp,
            vote_average: null,
            isHistoryItem: true,
            resume: item.resume || null
          };
        });
      }
      return [];
    }
    var cfg = CATALOG_CONFIG[key];
    if (!cfg || !cfg.url) return [];
    var d = yield safeFetch(cfg.url + '/items?from=0&limit=' + LIMIT, {
      timeout: 10000
    });
    if (d && d.success && d.items) return d.items.slice(0, LIMIT);
    return [];
  });
  return _loadRowItems.apply(this, arguments);
}
function createCatalogRow(key, items) {
  var cfg = CATALOG_CONFIG[key];
  if (!cfg) return null;
  var row = document.createElement('section');
  row.className = 'catalog-row';
  row.dataset.catalogKey = key;
  var header = document.createElement('div');
  header.className = 'catalog-row-header';
  header.innerHTML = '<h2 class="catalog-row-title">' + escapeHtml(cfg.name) + '</h2>' + '<div class="catalog-row-showall-hint">Показать все →</div>';
  header.addEventListener('click', function () {
    rememberRowEntry(key, null);
    if (key === 'history') loadHistoryCatalog();else if (key === 'favorites') loadFavoritesCatalog();else loadCatalog(key);
  });
  row.appendChild(header);
  var carousel = document.createElement('div');
  carousel.className = 'catalog-row-carousel';
  var viewport = document.createElement('div');
  viewport.className = 'catalog-row-viewport';
  var track = document.createElement('div');
  track.className = 'catalog-row-track';
  var rowCards = [];
  window.catalogRowsData[key] = items;
  for (var i = 0; i < items.length; i++) {
    var card = createRowCard(items[i], key, i);
    track.appendChild(card);
    rowCards.push(card);
  }
  var showAll = createShowAllCard(key);
  track.appendChild(showAll);
  rowCards.push(showAll);
  viewport.appendChild(track);
  carousel.appendChild(viewport);
  row.appendChild(carousel);
  window.catalogRows.push(rowCards);
  return row;
}
function createRowCard(item, key, index) {
  var title = getCatalogItemTitle(item);
  var mt = item.media_type || 'movie';
  var id = item.id;
  var year = getCatalogItemYear(item);
  var card = document.createElement('div');
  card.className = 'torrent-card catalog-card catalog-row-card';
  card.dataset.catalogKey = key;
  card.dataset.itemIndex = index;
  card.dataset.itemId = id;
  card.dataset.mediaType = mt;
  card.dataset.title = title;
  card.innerHTML = '<div class="torrent-poster">' + '<div class="row-poster-img"><div class="no-poster catalog-poster-loading"></div></div>' + '</div>' + '<div class="torrent-info">' + '<div class="torrent-title">' + escapeHtml(title.length > 40 ? title.substring(0, 40) + '...' : title) + '</div>' + '<div class="torrent-meta"><span>' + (mt === 'tv' ? 'Сериал' : 'Фильм') + '</span>' + (year ? '<span>' + year + '</span>' : '') + '</div>' + '</div>';
  return card;
}
function createShowAllCard(key) {
  var card = document.createElement('div');
  card.className = 'torrent-card catalog-folder-card catalog-row-card catalog-show-all';
  card.dataset.catalogKey = key;
  var total = window.catalogRowTotals && window.catalogRowTotals[key];
  card.innerHTML = '<div class="show-all-inner">' + '<div class="show-all-icon">→</div>' + '<div class="show-all-text">Показать<br>все</div>' + '<div class="show-all-meta">' + '<div class="show-all-count">' + (total ? 'Всего: ' + total : '') + '</div>' + '<div class="show-all-date"></div>' + '</div>' + '</div>';
  return card;
}
function loadRowPoster(_x44, _x45) {
  return _loadRowPoster.apply(this, arguments);
}
function _loadRowPoster() {
  _loadRowPoster = _asyncToGenerator(function* (card, item) {
    var imgBox = card.querySelector('.row-poster-img');
    if (!imgBox) return;
    var id = item.id;
    var mt = item.media_type || 'movie';
    var cacheKey = id + '_' + mt;
    var cached = catalogState.posterCache.get(cacheKey);
    if (cached) {
      yield setRowPosterImg(imgBox, cached, true);
      return;
    }
    if (item.poster_path) {
      var url = getTmdbImageUrl(item.poster_path, getPosterCardSize());
      catalogState.posterCache.set(cacheKey, url);
      yield setRowPosterImg(imgBox, url, true);
      return;
    }
    if (id && id !== 'undefined' && id !== 'null' && window.CatalogWorker) {
      try {
        var posterResult = yield CatalogWorker.fetchPosterUrl(id, mt, getCatalogItemTitle(item), getProtocolBase(), getPosterCardSize());
        if (posterResult && posterResult.posterUrl) {
          var url2 = normalizePosterUrl(posterResult.posterUrl);
          catalogState.posterCache.set(cacheKey, url2);
          if (card.isConnected) yield setRowPosterImg(imgBox, url2, true);
          return;
        }
      } catch (e) {}
    }
    if (card.isConnected) imgBox.innerHTML = '<div class="no-poster">Нет постера</div>';
  });
  return _loadRowPoster.apply(this, arguments);
}
function ensureRowPosterNow(card) {
  if (!card || !card.classList || !card.classList.contains('catalog-row-card')) return;
  if (!card.dataset.catalogKey) return;
  if (card.dataset.posterStarted === '1') return;
  catalogState.focusPosterCard = card;
  scheduleFocusRowPoster(0);
}
function queueFocusedRowPosters(card) {
  if (!card.dataset.catalogKey) return;
  var row = card.closest ? card.closest('.catalog-row') : null;
  if (!row || catalogState.rowPostersQueuedFor === row) return;
  catalogState.rowPostersQueuedFor = row;
  var queued = queueRowPosters(row, parseInt(card.dataset.itemIndex, 10));
  var next = row;
  for (var i = 0; i < CATALOG_CONSTANTS.ROW_POSTER_PRELOAD_ROWS; i++) {
    next = nextCatalogRow(next);
    if (!next) break;
    queued += queueRowPosters(next, 0);
  }
  if (queued) processRowPosterQueue();
}
function nextCatalogRow(row) {
  var el = row.nextElementSibling;
  while (el && !el.classList.contains('catalog-row')) el = el.nextElementSibling;
  return el;
}
function queueRowPosters(row, from) {
  var key = row.dataset.catalogKey;
  var items = key && window.catalogRowsData && window.catalogRowsData[key];
  if (!items) return 0;
  if (!catalogState.rowPosterQueue) catalogState.rowPosterQueue = [];
  var cards = row.querySelectorAll('.catalog-row-card');
  if (isNaN(from) || from < 0 || from > cards.length) from = 0;
  var order = [];
  for (var i = from; i < cards.length; i++) order.push(cards[i]);
  for (var j = 0; j < from; j++) order.push(cards[j]);
  var queued = 0;
  for (var k = 0; k < order.length; k++) {
    var c = order[k];
    if (c.dataset.posterLoaded === '1') continue;
    var idx = parseInt(c.dataset.itemIndex, 10);
    if (isNaN(idx) || !items[idx]) continue;
    c.dataset.posterLoaded = '1';
    if (catalogState.rowPosterObserver) catalogState.rowPosterObserver.unobserve(c);
    catalogState.rowPosterQueue.push({
      card: c,
      item: items[idx]
    });
    queued++;
  }
  return queued;
}
function scheduleFocusRowPoster(delay) {
  if (catalogState.focusPosterTimer) clearTimeout(catalogState.focusPosterTimer);
  catalogState.focusPosterTimer = setTimeout(function () {
    catalogState.focusPosterTimer = null;
    var card = catalogState.focusPosterCard;
    if (!card) return;
    if (!card.isConnected) {
      catalogState.focusPosterCard = null;
      return;
    }
    if (isRowScrollAnimating() || window.navHold) {
      scheduleFocusRowPoster(CATALOG_CONSTANTS.ROW_POSTER_RETRY_MS);
      return;
    }
    catalogState.focusPosterCard = null;
    loadFocusRowPoster(card);
  }, delay);
}
function loadFocusRowPoster(card) {
  if (card.dataset.posterStarted === '1') return;
  var key = card.dataset.catalogKey;
  if (!key) return;
  var box = card.querySelector('.row-poster-img');
  if (!box || box.querySelector('img')) return;
  var idx = parseInt(card.dataset.itemIndex, 10);
  if (isNaN(idx)) return;
  var items = window.catalogRowsData && window.catalogRowsData[key];
  if (!items || !items[idx]) return;
  var q = catalogState.rowPosterQueue;
  if (q) {
    for (var i = 0; i < q.length; i++) {
      if (q[i].card === card) {
        q.splice(i, 1);
        break;
      }
    }
  }
  if (card.dataset.posterLoaded !== '1') {
    card.dataset.posterLoaded = '1';
    if (catalogState.rowPosterObserver) catalogState.rowPosterObserver.unobserve(card);
  }
  card.dataset.posterStarted = '1';
  loadRowPoster(card, items[idx]).catch(function () {});
}
function resetStrandedRowPosters() {
  var cards = document.querySelectorAll('#catalog-rows .catalog-row-card');
  for (var i = 0; i < cards.length; i++) {
    if (cards[i].dataset.posterLoaded !== '1') continue;
    var box = cards[i].querySelector('.row-poster-img');
    if (box && !box.querySelector('img')) {
      cards[i].dataset.posterLoaded = '0';
      cards[i].dataset.posterStarted = '0';
    }
  }
}
function initRowPosterLazyLoading() {
  if (catalogState.rowPosterObserver) catalogState.rowPosterObserver.disconnect();
  catalogState.rowPosterQueue = [];
  catalogState.activeRowPosterLoads = 0;
  dropPosterReveals();
  if (catalogState.rowPosterQueueTimer) {
    clearTimeout(catalogState.rowPosterQueueTimer);
    catalogState.rowPosterQueueTimer = null;
  }
  if (catalogState.focusPosterTimer) {
    clearTimeout(catalogState.focusPosterTimer);
    catalogState.focusPosterTimer = null;
  }
  catalogState.focusPosterCard = null;
  catalogState.rowPostersQueuedFor = null;
  catalogState.rowPosterObserver = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i].isIntersecting) continue;
      var card = entries[i].target;
      if (card.dataset.posterLoaded === '1') continue;
      var key = card.dataset.catalogKey;
      var idx = parseInt(card.dataset.itemIndex, 10);
      if (isNaN(idx)) continue;
      var items = window.catalogRowsData && window.catalogRowsData[key];
      if (!items || !items[idx]) continue;
      card.dataset.posterLoaded = '1';
      catalogState.rowPosterObserver.unobserve(card);
      catalogState.rowPosterQueue.push({
        card: card,
        item: items[idx]
      });
    }
    processRowPosterQueue();
  }, {
    rootMargin: CATALOG_CONSTANTS.POSTER_OBSERVER_MARGIN_PX + 'px ' + CATALOG_CONSTANTS.ROW_POSTER_MARGIN_X_PX + 'px',
    threshold: 0.1
  });
  var cards = document.querySelectorAll('#catalog-rows .catalog-row-card');
  for (var i = 0; i < cards.length; i++) {
    if (cards[i].dataset.itemIndex !== undefined && cards[i].dataset.posterLoaded !== '1') {
      cards[i].dataset.posterStarted = '0';
      catalogState.rowPosterObserver.observe(cards[i]);
    }
  }
}
var OFFSCREEN_CLASS = 'catalog-offscreen';
function measureVisibilityMargin(sample) {
  var h = sample ? sample.offsetHeight : 0;
  if (!h) return CATALOG_CONSTANTS.VISIBILITY_FALLBACK_MARGIN_PX;
  return Math.round(h * CATALOG_CONSTANTS.VISIBILITY_WINDOW_ROWS);
}
function measureCatalogCardHeight() {
  var grid = getCatalogGridEl();
  if (!grid) return;
  var cols = typeof getColumns === 'function' && getColumns() || 5;
  var tpl = window.getComputedStyle(grid).gridTemplateColumns;
  if (tpl && tpl !== 'none') cols = tpl.split(/\s+/).length;
  var cards = grid.querySelectorAll('.torrent-card.catalog-card');
  var h = 0;
  var boxH = 0;
  for (var i = 0; i < cards.length && i < cols; i++) {
    var poster = cards[i].querySelector('.torrent-poster');
    if (!poster || !poster.offsetHeight) continue;
    if (cards[i].clientHeight > h) h = cards[i].clientHeight;
    var boxRect = cards[i].getBoundingClientRect().height;
    if (boxRect > boxH) boxH = boxRect;
  }
  if (!(h > 0)) return;
  if (boxH > 0) catalogState.rowBoxH = boxH;
  var prev = parseFloat(document.documentElement.style.getPropertyValue('--catalog-card-h'));
  if (!isNaN(prev) && Math.abs(prev - h) <= 1) return;
  document.documentElement.style.setProperty('--catalog-card-h', h + 'px');
}
var _cardHeightObserver = null;
var _lastGridWidth = -1;
function watchCatalogCardHeight() {
  var grid = getCatalogGridEl();
  var card = grid && grid.querySelector('.torrent-card.catalog-card');
  if (!card) return;
  if (typeof ResizeObserver === 'undefined') {
    try {
      if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
        document.fonts.ready.then(function () {
          measureCatalogCardHeight();
        });
      }
    } catch (e) {}
    setTimeout(measureCatalogCardHeight, 700);
    setTimeout(measureCatalogCardHeight, 2000);
    return;
  }
  if (_cardHeightObserver) _cardHeightObserver.disconnect();
  _cardHeightObserver = new ResizeObserver(function (entries) {
    var rect = entries && entries[0] && entries[0].contentRect;
    var w = rect ? Math.round(rect.width) : -1;
    if (w === _lastGridWidth) return;
    _lastGridWidth = w;
    measureCatalogCardHeight();
  });
  _cardHeightObserver.observe(grid);
}
function unwatchCatalogCardHeight() {
  if (!_cardHeightObserver) return;
  _cardHeightObserver.disconnect();
  _cardHeightObserver = null;
  _lastGridWidth = -1;
}
var visibilityPending = [];
var visibilityFlushTimer = null;
function queueVisibilityToggle(el, show) {
  for (var i = 0; i < visibilityPending.length; i++) {
    if (visibilityPending[i].el === el) {
      visibilityPending[i].show = show;
      return;
    }
  }
  visibilityPending.push({
    el: el,
    show: show
  });
}
function flushVisibilityToggles() {
  if (!visibilityPending.length) return;
  if (window.navHold || isRowScrollAnimating()) {
    if (visibilityFlushTimer) return;
    visibilityFlushTimer = setTimeout(function () {
      visibilityFlushTimer = null;
      flushVisibilityToggles();
    }, CATALOG_CONSTANTS.ROW_POSTER_RETRY_MS);
    return;
  }
  var list = visibilityPending;
  visibilityPending = [];
  for (var i = 0; i < list.length; i++) {
    if (!list[i].el.isConnected) continue;
    if (list[i].show) list[i].el.classList.remove(OFFSCREEN_CLASS);else list[i].el.classList.add(OFFSCREEN_CLASS);
  }
}
function dropPendingVisibilityToggles() {
  if (visibilityFlushTimer) {
    clearTimeout(visibilityFlushTimer);
    visibilityFlushTimer = null;
  }
  visibilityPending.length = 0;
}
function createVisibilityObserver(marginPx) {
  return new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      var el = entries[i].target;
      if (!entries[i].boundingClientRect.height) continue;
      queueVisibilityToggle(el, entries[i].isIntersecting);
    }
    flushVisibilityToggles();
  }, {
    root: getEl('main-container'),
    rootMargin: marginPx + 'px 0px',
    threshold: 0
  });
}
function revealCatalogElement(el) {
  if (!el || !el.classList) return;
  el.classList.remove(OFFSCREEN_CLASS);
  if (!el.classList.contains('catalog-row-card')) {
    ensureChunksAroundFocus(el);
    prefetchGridPosters(el);
    scheduleGridPosterAhead(el);
    scheduleDetailArtPrefetch(el);
    return;
  }
  var row = el.closest ? el.closest('.catalog-row') : null;
  if (row) row.classList.remove(OFFSCREEN_CLASS);
  ensureRowPosterNow(el);
  queueFocusedRowPosters(el);
}
function initRowVisibilityWindow() {
  if (catalogState.rowVisibilityObserver) catalogState.rowVisibilityObserver.disconnect();
  var rows = document.querySelectorAll('#catalog-rows .catalog-row');
  if (!rows.length) {
    catalogState.rowVisibilityObserver = null;
    return;
  }
  catalogState.rowVisibilityObserver = createVisibilityObserver(measureVisibilityMargin(rows[0]));
  for (var i = 0; i < rows.length; i++) {
    rows[i].classList.remove(OFFSCREEN_CLASS);
    catalogState.rowVisibilityObserver.observe(rows[i]);
  }
}
function observeRowVisibility(row) {
  if (!catalogState.rowVisibilityObserver) {
    initRowVisibilityWindow();
    return;
  }
  catalogState.rowVisibilityObserver.observe(row);
}
function resetRowVisibilityWindow() {
  if (!catalogState.rowVisibilityObserver) return;
  catalogState.rowVisibilityObserver.disconnect();
  catalogState.rowVisibilityObserver = null;
  dropPendingVisibilityToggles();
}
function initGridVisibilityWindow() {
  if (catalogState.gridVisibilityObserver) catalogState.gridVisibilityObserver.disconnect();
  var cards = document.querySelectorAll('#catalog-grid .torrent-card.catalog-card');
  if (!cards.length) {
    catalogState.gridVisibilityObserver = null;
    return;
  }
  catalogState.gridVisibilityObserver = createVisibilityObserver(measureVisibilityMargin(cards[0]));
  for (var i = 0; i < cards.length; i++) {
    cards[i].classList.remove(OFFSCREEN_CLASS);
    catalogState.gridVisibilityObserver.observe(cards[i]);
  }
}
function updateGridVisibilityWindow() {
  if (!catalogState.gridVisibilityObserver) {
    initGridVisibilityWindow();
    return;
  }
  var cards = document.querySelectorAll('#catalog-grid .torrent-card.catalog-card');
  for (var i = 0; i < cards.length; i++) {
    try {
      catalogState.gridVisibilityObserver.observe(cards[i]);
    } catch (e) {}
  }
}
function resetGridVisibilityWindow() {
  if (!catalogState.gridVisibilityObserver) return;
  catalogState.gridVisibilityObserver.disconnect();
  catalogState.gridVisibilityObserver = null;
}
function revealAllCatalogRows() {
  dropPendingVisibilityToggles();
  var rows = document.querySelectorAll('#catalog-rows .catalog-row');
  for (var i = 0; i < rows.length; i++) rows[i].classList.remove(OFFSCREEN_CLASS);
}
window.revealCatalogElement = revealCatalogElement;
window.initRowVisibilityWindow = initRowVisibilityWindow;
window.initGridVisibilityWindow = initGridVisibilityWindow;
window.measureCatalogCardHeight = measureCatalogCardHeight;
function isRowScrollAnimating() {
  if (isCatalogScrollAnimating()) return true;
  if (typeof Animations === 'undefined' || typeof Animations.isScrollTweening !== 'function') return false;
  var f = document.querySelector('#catalog-rows .catalog-row-card.focused');
  var vp = f && f.closest ? f.closest('.catalog-row-viewport') : null;
  return !!vp && Animations.isScrollTweening(vp);
}
function processRowPosterQueue() {
  if (!catalogState.rowPosterQueue || !catalogState.rowPosterQueue.length) return;
  if (window.navHold || isRowScrollAnimating()) {
    if (catalogState.rowPosterQueueTimer) return;
    catalogState.rowPosterQueueTimer = setTimeout(function () {
      catalogState.rowPosterQueueTimer = null;
      processRowPosterQueue();
    }, CATALOG_CONSTANTS.ROW_POSTER_RETRY_MS);
    return;
  }
  while (catalogState.activeRowPosterLoads < CATALOG_CONSTANTS.ROW_POSTER_CONCURRENCY && catalogState.rowPosterQueue.length > 0) {
    var task = catalogState.rowPosterQueue.shift();
    if (!task.card.isConnected) continue;
    if (task.card.dataset.posterStarted === '1') continue;
    task.card.dataset.posterStarted = '1';
    catalogState.activeRowPosterLoads++;
    loadRowPoster(task.card, task.item).catch(function () {}).then(function () {
      catalogState.activeRowPosterLoads--;
      setTimeout(processRowPosterQueue, 5);
    });
  }
}
var posterReveals = [];
var posterRevealTimer = null;
function queuePosterReveal(insert) {
  posterReveals.push(insert);
  if (!posterRevealTimer) pumpPosterReveals();
}
function pumpPosterReveals() {
  posterRevealTimer = null;
  if (!posterReveals.length) return;
  var moving = window.navHold || isRowScrollAnimating();
  if (moving && !gridPostersOnTheMove()) {
    posterRevealTimer = setTimeout(pumpPosterReveals, CATALOG_CONSTANTS.ROW_POSTER_RETRY_MS);
    return;
  }
  var run = posterReveals.shift();
  try {
    run();
  } catch (e) {}
  if (posterReveals.length) {
    posterRevealTimer = setTimeout(pumpPosterReveals, moving ? CATALOG_CONSTANTS.POSTER_MOVING_GAP_MS : CATALOG_CONSTANTS.POSTER_INSERT_GAP_MS);
  }
}
function dropPosterReveals() {
  if (posterRevealTimer) {
    clearTimeout(posterRevealTimer);
    posterRevealTimer = null;
  }
  posterReveals.length = 0;
  dropPosterRevealBatch();
}
var posterRevealBatch = [];
var posterRevealBatchTimer = null;
function flushPosterRevealBatch() {
  posterRevealBatchTimer = null;
  var items = posterRevealBatch;
  if (!items.length) return;
  posterRevealBatch = [];
  requestAnimationFrame(function () {
    for (var i = 0; i < items.length; i++) {
      if (!items[i].img.isConnected) continue;
      showPosterImg(items[i].img);
      if (items[i].ph) dropPosterPlaceholder(items[i].ph);
    }
  });
}
function queuePosterRevealFlash(img, placeholder) {
  posterRevealBatch.push({
    img: img,
    ph: placeholder
  });
  if (posterRevealBatchTimer) return;
  posterRevealBatchTimer = setTimeout(flushPosterRevealBatch, 0);
}
function dropPosterRevealBatch() {
  if (posterRevealBatchTimer) {
    clearTimeout(posterRevealBatchTimer);
    posterRevealBatchTimer = null;
  }
  posterRevealBatch.length = 0;
}
function setRowPosterImg(box, url, deferDuringNav) {
  return new Promise(function (resolve) {
    var size = getPosterCardSize();
    if (url && url.indexOf('/t/p/' + size + '/') === -1) {
      url = getTmdbImageUrl(url, size);
    }
    var img = new Image();
    img.decoding = 'async';
    var settled = false;
    var settle = function () {
      if (settled) return;
      settled = true;
      stopPosterWatchdog();
      resolve();
    };
    var posterWatchdog = null;
    function stopPosterWatchdog() {
      if (posterWatchdog) {
        clearTimeout(posterWatchdog);
        posterWatchdog = null;
      }
    }
    function armPosterWatchdog(ms) {
      stopPosterWatchdog();
      posterWatchdog = setTimeout(function () {
        posterWatchdog = null;
        if (settled) return;
        if (img.complete && img.naturalWidth > 0) {
          insert();
          return;
        }
        var alt = mirrorRetried ? null : getTmdbNextMirrorUrl(img.src);
        if (alt && alt !== img.src) {
          mirrorRetried = true;
          armPosterWatchdog();
          img.src = alt;
          return;
        }
        img.onload = null;
        img.onerror = null;
        img.src = '';
        fail();
      }, ms || CATALOG_CONSTANTS.POSTER_LOAD_TIMEOUT_MS);
    }
    var whenIdle = deferDuringNav ? queuePosterReveal : function (fn) {
      fn();
    };
    var insert = function () {
      whenIdle(function () {
        if (settled) return;
        if (box.isConnected && img.naturalWidth > 0) {
          var placeholder = box.querySelector('.no-poster');
          var stale = box.querySelectorAll('img');
          for (var q = 0; q < stale.length; q++) {
            stale[q].onload = null;
            stale[q].onerror = null;
            if (stale[q].getAttribute('src')) stale[q].removeAttribute('src');
            if (stale[q].parentNode) stale[q].parentNode.removeChild(stale[q]);
          }
          box.appendChild(img);
          queuePosterRevealFlash(img, placeholder);
        }
        settle();
      });
    };
    var fail = function () {
      whenIdle(function () {
        if (settled) return;
        if (box.isConnected) box.innerHTML = '<div class="no-poster">Нет постера</div>';
        settle();
      });
    };
    var mirrorRetried = false;
    img.onerror = function () {
      stopPosterWatchdog();
      if (!mirrorRetried) {
        var alt = getTmdbNextMirrorUrl(img.src);
        if (alt && alt !== img.src) {
          mirrorRetried = true;
          armPosterWatchdog();
          img.src = alt;
          return;
        }
      }
      fail();
    };
    img.onload = function () {
      if (typeof img.decode === 'function') {
        armPosterWatchdog(CATALOG_CONSTANTS.POSTER_DECODE_GRACE_MS);
        img.decode().then(insert).catch(insert);
      } else {
        stopPosterWatchdog();
        insert();
      }
    };
    armPosterWatchdog();
    img.src = url;
  });
}
function onRowItemClick(item, key, index) {
  catalogState.lastSelectedIndex = index;
  catalogState.lastSelectedId = item.id;
  catalogState.lastSelectedRowKey = key;
  catalogState.lastSelectedColIndex = index;
  AppState.catalogIndex = index;
  AppState.androidBackCatalog = item;
  AppState.openInRow = true;
  if (window.Nav) Nav.push('detail', Nav.detailData(item, index));
  showCatalogDetail(item, index, null);
}
function focusRowCardByElement(card) {
  if (!card) return;
  if (typeof updateFocusableElements === 'function') updateFocusableElements();
  var idx = typeof focusableElements !== 'undefined' ? focusableElements.indexOf(card) : -1;
  if (idx !== -1 && typeof setFocus === 'function') {
    setFocus(idx);
  } else if (typeof focusEl === 'function') {
    focusEl(card);
  }
  if (typeof scrollRowToCard === 'function') scrollRowToCard(card);
}
function rememberRowEntry(key, card) {
  if (!key) return;
  if (window.Nav) Nav.push('grid', {
    key: 'cat:' + key,
    label: key
  });
  catalogState.lastSelectedRowKey = key;
  catalogState.lastSelectedColIndex = card && card.classList && card.classList.contains('catalog-show-all') ? 'showall' : null;
}
function restoreRowFocus() {
  var savedKey = catalogState.lastSelectedRowKey;
  var savedCol = catalogState.lastSelectedColIndex;
  catalogState.lastSelectedRowKey = 0;
  catalogState.lastSelectedColIndex = 0;
  if (savedKey != null) {
    if (savedCol === 'showall') {
      var sa = document.querySelector('.catalog-show-all[data-catalog-key="' + savedKey + '"]');
      if (sa && sa.offsetParent !== null) {
        focusRowCardByElement(sa);
        return;
      }
    }
    var card = document.querySelector('.catalog-row-card[data-catalog-key="' + savedKey + '"][data-item-index="' + savedCol + '"]');
    if (card && card.offsetParent !== null) {
      focusRowCardByElement(card);
      return;
    }
    var firstInRow = document.querySelector('.catalog-row-card[data-catalog-key="' + savedKey + '"]');
    if (firstInRow && firstInRow.offsetParent !== null) {
      focusRowCardByElement(firstInRow);
      return;
    }
    var order = Object.keys(CATALOG_CONFIG);
    for (var k = order.indexOf(savedKey) - 1; k >= 0; k--) {
      var prev = document.querySelector('.catalog-row-card[data-catalog-key="' + order[k] + '"]');
      if (prev && prev.offsetParent !== null) {
        focusRowCardByElement(prev);
        return;
      }
    }
  }
  if (typeof getCatalogRows === 'function' && typeof focusRowCard === 'function') {
    var rows = getCatalogRows();
    if (rows.length) focusRowCard(0, 0, rows);
  }
}
function createCatalogFolderCard(key, cfg) {
  var c = document.createElement('div');
  c.className = 'torrent-card catalog-folder-card';
  c.dataset.catalogKey = key;
  var src = POSTER_URLS[key] || '';
  var posterHtml = src ? '<div class="catalog-folder-poster-placeholder"></div>' : '<div class="no-poster" style="display:flex;align-items:center;justify-content:center;height:100%;font-size:64px">🎬</div>';
  c.innerHTML = '<div class="torrent-poster catalog-folder-poster">' + posterHtml + '</div><div class="torrent-info"><div class="torrent-title">' + cfg.name + '</div><div class="torrent-meta"><span></span><span class="torrent-badge catalog-badge"></span></div></div>';
  if (src) {
    var posterDiv = c.querySelector('.torrent-poster');
    var img = new Image();
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s ease';
    var insertImage = function () {
      if (!posterDiv.isConnected) return;
      var ph = posterDiv.querySelector('.catalog-folder-poster-placeholder');
      if (ph) ph.remove();
      img.style.opacity = '1';
      posterDiv.appendChild(img);
    };
    img.onerror = function () {
      if (!posterDiv.isConnected) return;
      posterDiv.innerHTML = '<div class="no-poster">Нет постера</div>';
    };
    img.src = src;
    if (typeof img.decode === 'function') {
      img.decode().then(insertImage).catch(insertImage);
    } else {
      img.onload = insertImage;
    }
  }
  return c;
}
function showCatalogLoading(msg) {
  var g = getCatalogGridEl();
  ensureCatalogGridVisible();
  showCatalogGridView();
  if (g) g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px"><div class="loading-spinner" style="margin:0 auto 20px"></div><div style="font-size:16px;color:#aaa">' + (msg || 'Загрузка...') + '</div></div>';
}
function showCatalogError(msg) {
  var g = getCatalogGridEl();
  ensureCatalogGridVisible();
  showCatalogGridView();
  if (g) g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px"><div style="font-size:48px;margin-bottom:20px">⚠️</div><div style="font-size:16px;color:#ff6a6a">' + msg + '</div><button class="btn" style="margin-top:20px" onclick="window.loadCatalogList()">Попробовать снова</button></div>';
}
function hideCatalogLoading() {}
function prepareGridUnderDetail(under) {
  var r = under && under.screen === 'grid' && under.restore || null;
  catalogState.items = [];
  catalogState.cardElements = {};
  if (r && r.person) {
    catalogState.person = r.person;
    catalogState.currentCatalog = 'person';
    AppState.backCurrentCatalog = 'person';
  } else {
    catalogState.person = null;
    catalogState.currentCatalog = null;
    AppState.backCurrentCatalog = r && r.catalogKey || '';
  }
  if (r) {
    catalogState.lastSelectedIndex = r.lastIndex || 0;
    catalogState.lastSelectedId = r.lastId || null;
    try {
      if (r.storedIndex === null || r.storedIndex === undefined) localStorage.removeItem('lastCatalogCardIndex');else localStorage.setItem('lastCatalogCardIndex', r.storedIndex);
    } catch (e) {}
  }
  if (!AppState.backCurrentCatalog && typeof showCatalogRowsView === 'function') showCatalogRowsView();
}
if (window.Nav) Nav.register('grid', {
  snapshot: function () {
    var stored = null;
    try {
      stored = localStorage.getItem('lastCatalogCardIndex');
    } catch (e) {}
    var isPerson = catalogState.currentCatalog === 'person';
    return {
      person: isPerson ? catalogState.person : null,
      catalogKey: isPerson ? null : catalogState.currentCatalog,
      lastIndex: catalogState.lastSelectedIndex,
      lastId: catalogState.lastSelectedId,
      storedIndex: stored,
      scrollTop: (getEl('main-container') || {}).scrollTop || 0
    };
  }
});
function extendCatalogToSelected() {
  var key = catalogState.currentCatalog;
  var target = catalogState.lastSelectedIndex || 0;
  function step() {
    if (catalogState.currentCatalog !== key) return false;
    if (catalogState.items.length > target || !catalogState.hasMore) return true;
    return Promise.resolve(window.loadMoreCatalogItems()).then(function (more) {
      return more ? step() : true;
    });
  }
  return Promise.resolve(step());
}
window.extendCatalogToSelected = extendCatalogToSelected;
function backToCatalogList() {
  var navTo = window.Nav ? Nav.pop('grid') : null;
  if (navTo && navTo.screen === 'detail' && navTo.data && navTo.data.item && typeof showCatalogDetail === 'function') {
    abortCatalogRequests();
    prepareGridUnderDetail(Nav.find('grid'));
    showCatalogDetail(navTo.data.item, navTo.data.index || 0, null);
    return;
  }
  abortCatalogRequests();
  catalogState.person = null;
  AppState.backCurrentCatalog = '';
  catalogState.currentCatalog = null;
  catalogState.items = [];
  catalogState.cardElements = {};
  catalogState.totalItems = 0;
  catalogState.currentPage = 0;
  catalogState.hasMore = true;
  catalogState.isLoadingMore = false;
  catalogState.loadedItemIds = {};
  catalogState.loadedPostersCount = 0;
  catalogState.posterLoadQueue = [];
  catalogState.lastSelectedIndex = 0;
  catalogState.lastSelectedId = null;
  localStorage.removeItem('lastCatalogCardIndex');
  fadeOutCatalogGrid(function () {
    showCatalogList();
  });
}
window.prefetchCatalogIfNearEnd = function (card, cols) {
  if (!catalogState.currentCatalog || !catalogState.hasMore) return false;
  if (!card || !card.dataset) return false;
  var index = parseInt(card.dataset.catalogIndex, 10);
  var total = catalogState.items ? catalogState.items.length : 0;
  if (isNaN(index) || total <= 0) return false;
  if (!cols || cols < 1) cols = 1;
  var rowsLeft = Math.floor((total - 1 - index) / cols);
  if (rowsLeft > CATALOG_CONSTANTS.PREFETCH_ROWS) return false;
  if (catalogState.isLoadingMore) return true;
  window.checkAndLoadMoreOnNavigation();
  return true;
};
var _chunkAheadTimer = null;
window.prefetchChunkAhead = function (card, cols) {
  if (!card || !card.dataset || window.navHold) return false;
  var chunks = catalogState.chunks;
  if (!chunks || !chunks.length) return false;
  var idx = parseInt(card.dataset.catalogIndex, 10);
  if (isNaN(idx)) return false;
  if (!cols || cols < 1) cols = getColumns() || 5;
  var size = catalogState.chunkSize || getChunkSize();
  if (!size) return false;
  var lookahead = CATALOG_CONSTANTS.PREFETCH_ROWS * cols;
  var here = Math.floor(idx / size);
  var wanted = [];
  var ahead = Math.floor((idx + lookahead) / size);
  var behind = Math.floor((idx - lookahead) / size);
  if (ahead !== here) wanted.push(ahead);
  if (behind !== here && behind >= 0) wanted.push(behind);
  var pending = null;
  for (var i = 0; i < wanted.length; i++) {
    var ch = chunks[wanted[i]];
    if (ch && (ch.spacer || ch.hydrating)) {
      pending = ch;
      break;
    }
  }
  if (!pending) return false;
  if (_chunkAheadTimer) return true;
  _chunkAheadTimer = setTimeout(function () {
    _chunkAheadTimer = null;
    if (!pending || window.navHold) return;
    if (!pending.spacer && !pending.hydrating) return;
    hydrateChunk(pending, true);
  }, 0);
  return true;
};
window.checkAndLoadMoreOnNavigation = function () {
  if (catalogState.currentCatalog && catalogState.hasMore && !catalogState.isLoadingMore) {
    loadMoreCatalogItems().then(function () {
      var t = getEl('load-more-trigger');
      if (t) {
        var s = t.querySelector('.loading-spinner-small');
        if (s) s.style.display = 'none';
      }
    });
  }
};
window.focusCatalogCardByIndex = function (target) {
  if (AppState.currentScreen !== 'catalog') return false;
  var cards = document.querySelectorAll('#catalog-grid .torrent-card.catalog-card');
  if (!cards.length) return false;
  var idx = -1;
  if (!isNaN(target)) {
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].dataset.numIndex && parseInt(cards[i].dataset.numIndex, 10) === target) {
        idx = i;
        break;
      }
    }
    if (idx === -1 && target >= 0 && target < cards.length) idx = target;
  }
  if (idx === -1) idx = 0;
  var card = cards[idx];
  if (!card || card.offsetParent === null) return false;
  if (typeof updateFocusableElements === 'function') updateFocusableElements();
  var gi = typeof focusableElements !== 'undefined' ? focusableElements.indexOf(card) : -1;
  if (gi !== -1 && typeof setFocus === 'function') {
    setFocus(gi);
    return true;
  }
  if (typeof focusEl === 'function') {
    focusEl(card);
    return true;
  }
  return false;
};
window.addToWatchHistory = function () {
  var _ref = _asyncToGenerator(function* (id, title, mt, pp) {
    try {
      var save = pp || null;
      if (save) {
        var tmdbPath = save.match(/\/t\/p\/[^/]+(\/[^?#]+)(?:[?#].*)?$/i);
        if (tmdbPath) save = tmdbPath[1];
      }
      var d = yield safeFetch(withClientId('/api/history/add'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tmdbId: String(id),
          title: title,
          mediaType: mt,
          posterPath: save
        })
      });
      return d;
    } catch (e) {
      console.error('History save error:', e);
    }
  });
  return function (_x46, _x47, _x48, _x49) {
    return _ref.apply(this, arguments);
  };
}();
function getCatalogKnownPosterUrl(item, posterUrl) {
  if (!item) return posterUrl || null;
  var mt = item.media_type || 'movie';
  var url = posterUrl || null;
  if (!url && catalogState && catalogState.posterCache) {
    url = catalogState.posterCache.get((item.id || '') + '_' + mt);
  }
  if (!url && item.poster_path) {
    url = getTmdbImageUrl(item.poster_path, CATALOG_CONSTANTS.IMG_SIZES.POSTER_MEDIUM);
  }
  return url;
}
var tmdbCleanupIv = null;
function startTmdbCleanup() {
  if (tmdbCleanupIv) clearInterval(tmdbCleanupIv);
  tmdbCleanupIv = setInterval(cleanOldTmdbCache, TMDB_CACHE_CONFIG.cleanupInterval);
}
function stopTmdbCleanup() {
  if (tmdbCleanupIv) {
    clearInterval(tmdbCleanupIv);
    tmdbCleanupIv = null;
  }
}
function preloadPosterCacheFromDB() {
  if (!window.PosterDB || !window.PosterDB.getAll) return Promise.resolve();
  return PosterDB.getAll().then(function (all) {
    if (!all) return;
    var keys = Object.keys(all);
    for (var i = 0; i < keys.length; i++) {
      if (!catalogState.posterCache.has(keys[i])) {
        catalogState.posterCache.set(keys[i], all[keys[i]]);
      }
    }
    console.log('✅ PosterDB: загружено ' + keys.length + ' постеров в память');
  }).catch(function (e) {
    console.warn('PosterDB preload error:', e);
  });
}
var catalogInited = false;
function initCatalog() {
  if (catalogInited) return;
  catalogInited = true;
  startTmdbCleanup();
  initCatalogDetailButtons();
  preloadPosterCacheFromDB();
  window.tmdbCacheAPI = {
    clear: clearTmdbCache,
    stats: getTmdbCacheStats,
    setEnabled: function (v) {
      TMDB_CACHE_CONFIG.enabled = v;
    },
    isEnabled: function () {
      return TMDB_CACHE_CONFIG.enabled;
    },
    setTtl: function (v) {
      TMDB_CACHE_CONFIG.ttl = v;
      if (tmdbCache) tmdbCache.ttl = v;
    }
  };
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initCatalog);else initCatalog();
window.loadCatalogList = showCatalogList;
window.backToCatalogList = backToCatalogList;
window.refreshCatalogRows = function () {
  return showCatalogList(true);
};
window.exitYoutubePlayer = exitYoutubePlayer;
window.loadMoreCatalogItems = loadMoreCatalogItems;
window.catalog = {
  loadCatalog: function (key) {
    return window.loadCatalog(key);
  },
  showCatalogList: function (force) {
    return window.showCatalogList(force);
  },
  backToCatalogList: function () {
    return window.backToCatalogList();
  },
  tmdbCache: {
    clear: clearTmdbCache,
    stats: getTmdbCacheStats
  }
};
window.showCatalogDetail = showCatalogDetail;
