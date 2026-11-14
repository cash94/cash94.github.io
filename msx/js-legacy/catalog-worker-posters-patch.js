/* Сборка для старых браузеров (Chrome 53) из js/catalog-worker-posters-patch.js — tools/legacy-build/build.js. Руками не править. */
function asyncGeneratorStep(n, t, e, r, o, a, c) { try { var i = n[a](c), u = i.value; } catch (n) { return void e(n); } i.done ? t(u) : Promise.resolve(u).then(r, o); }
function _asyncToGenerator(n) { return function () { var t = this, e = arguments; return new Promise(function (r, o) { var a = n.apply(t, e); function _next(n) { asyncGeneratorStep(a, r, o, _next, _throw, "next", n); } function _throw(n) { asyncGeneratorStep(a, r, o, _next, _throw, "throw", n); } _next(void 0); }); }; }
(function () {
  'use strict';

  if (!window.CatalogWorker) {
    console.warn('❌ CatalogWorker недоступен, poster-patch пропущен');
    return;
  }
  if (!window.CATALOG_CONSTANTS || !CATALOG_CONSTANTS.IMG_SIZES) {
    console.warn('❌ CATALOG_CONSTANTS недоступны, poster-patch пропущен');
    return;
  }
  if (!CATALOG_CONSTANTS.IMG_SIZES.POSTER_CARD) {
    CATALOG_CONSTANTS.IMG_SIZES.POSTER_CARD = CATALOG_CONSTANTS.IMG_SIZES.POSTER_SMALL || 'w185';
  }
  var _origLoadCatalogPoster = window.loadCatalogPoster;
  var _origLoadRowPoster = window.loadRowPoster;
  if (typeof _origLoadCatalogPoster !== 'function') {
    console.warn('❌ loadCatalogPoster не найден, poster-patch пропущен');
    return;
  }
  if (typeof _origLoadRowPoster !== 'function') {
    console.warn('❌ loadRowPoster не найден, poster-patch пропущен');
    return;
  }
  function getPosterCardSize() {
    return CATALOG_CONSTANTS.IMG_SIZES.POSTER_CARD || CATALOG_CONSTANTS.IMG_SIZES.POSTER_SMALL || 'w185';
  }
  function getProtocolBase() {
    var p = window.AppState && AppState.protocol || 'https:';
    p = String(p).replace(/\/+$/, '');
    if (p.indexOf(':') === -1) {
      p += ':';
    }
    return p;
  }
  function buildLocalPosterUrl(path, size) {
    if (!path) return '';
    if (window.getTmdbImageUrl) {
      return window.getTmdbImageUrl(path, size);
    }
    if (path.indexOf('http') === 0) {
      return path;
    }
    var finalPath = path.charAt(0) === '/' ? path : '/' + path;
    return getProtocolBase() + '//tsimg.hnar.online/t/p/' + size + finalPath;
  }
  function normalizePosterUrl(url) {
    if (!url) return '';
    if (window.getTmdbImageUrl) {
      return window.getTmdbImageUrl(url, getPosterCardSize());
    }
    if (url.indexOf('http') !== 0) return url;
    var size = getPosterCardSize();
    var protocol = getProtocolBase();
    if (url.indexOf('tsimg.hnar.online/t/p/') !== -1) {
      url = url.replace(/^https?:/, protocol);
      url = url.replace(/\/t\/p\/[^/]+\//, '/t/p/' + size + '/');
    }
    return url;
  }
  function fetchPosterUrlViaWorker(_x, _x2, _x3) {
    return _fetchPosterUrlViaWorker.apply(this, arguments);
  }
  function _fetchPosterUrlViaWorker() {
    _fetchPosterUrlViaWorker = _asyncToGenerator(function* (id, mt, title) {
      var validId = !!(id && id !== 'undefined' && id !== 'null');
      if (!window.CatalogWorker) {
        return {
          ok: false,
          url: null
        };
      }
      if (!validId && !title) {
        return {
          ok: false,
          url: null
        };
      }
      try {
        var res = yield CatalogWorker.fetchPosterUrl(validId ? id : null, mt || 'movie', title || '', getProtocolBase(), getPosterCardSize());
        var url = null;
        if (res && res.posterUrl) {
          url = normalizePosterUrl(res.posterUrl);
        }
        return {
          ok: true,
          url: url
        };
      } catch (e) {
        console.warn('⚠️ Ошибка Worker-загрузки постера, fallback:', e);
        return {
          ok: false,
          url: null
        };
      }
    });
    return _fetchPosterUrlViaWorker.apply(this, arguments);
  }
  var patchedLoadCatalogPoster = function () {
    var _ref = _asyncToGenerator(function* (card, title, mt, id, index) {
      var div = card && card.querySelector('.torrent-poster');
      if (!div) return;
      if (!catalogState.currentCatalog) {
        div.innerHTML = '<div class="no-poster">Каталог закрыт</div>';
        return;
      }
      var key = id + '_' + mt;
      if (window.PosterDB) {
        var cached = yield PosterDB.get(key);
        if (cached) {
          updatePosterDOM(div, card.dataset.rating, cached);
          return;
        }
      }
      var cached = catalogState.posterCache.get(key);
      if (cached) {
        updatePosterDOM(div, card.dataset.rating, cached);
        return;
      }
      var item = catalogState.items[index];
      var directPath = item && item.poster_path || null;
      if (directPath) {
        var directUrl = normalizePosterUrl(buildLocalPosterUrl(directPath, getPosterCardSize()));
        catalogState.posterCache.set(key, directUrl);
        updatePosterDOM(div, card.dataset.rating, directUrl);
        return;
      }
      var tmdbParams = {
        id: id,
        type: mt
      };
      var localTmdbCached = getFromTmdbCache('poster', tmdbParams);
      if (localTmdbCached && localTmdbCached.posterUrl) {
        var localUrl = normalizePosterUrl(localTmdbCached.posterUrl);
        catalogState.posterCache.set(key, localUrl);
        updatePosterDOM(div, card.dataset.rating, localUrl);
        return;
      }
      var resolved = false;
      function applyUrl(url) {
        if (resolved || !url) return;
        if (!div.isConnected) return;
        resolved = true;
        catalogState.posterCache.set(key, url);
        saveToTmdbCache('poster', tmdbParams, {
          posterUrl: url
        });
        updatePosterDOM(div, card.dataset.rating, url);
      }
      if (window.PosterDB) {
        PosterDB.get(key).then(function (dbUrl) {
          if (dbUrl) applyUrl(dbUrl);
        });
      }
      fetchPosterUrlViaWorker(id, mt, title).then(function (workerResult) {
        if (workerResult.ok && workerResult.url) {
          applyUrl(workerResult.url);
          if (window.PosterDB) {
            PosterDB.set(key, workerResult.url);
          }
        } else if (!resolved) {
          resolved = true;
          updatePosterDOM(div, card.dataset.rating, '');
        }
      });
    });
    return function patchedLoadCatalogPoster(_x4, _x5, _x6, _x7, _x8) {
      return _ref.apply(this, arguments);
    };
  }();
  window.loadCatalogPoster = patchedLoadCatalogPoster;
  try {
    if (typeof loadCatalogPoster !== 'undefined') {
      loadCatalogPoster = patchedLoadCatalogPoster;
    }
  } catch (e) {}
  var patchedLoadRowPoster = function () {
    var _ref2 = _asyncToGenerator(function* (card, item) {
      var imgBox = card && card.querySelector('.row-poster-img');
      if (!imgBox || !item) return;
      var id = item.id;
      var mt = item.media_type || 'movie';
      var key = id + '_' + mt;
      if (window.PosterDB) {
        var cached = yield PosterDB.get(key);
        if (cached) {
          yield setRowPosterImg(imgBox, cached);
          return;
        }
      }
      var cached = catalogState.posterCache.get(key);
      if (cached) {
        yield setRowPosterImg(imgBox, cached);
        return;
      }
      if (item.poster_path) {
        var directUrl = normalizePosterUrl(buildLocalPosterUrl(item.poster_path, getPosterCardSize()));
        catalogState.posterCache.set(key, directUrl);
        if (card.isConnected) {
          yield setRowPosterImg(imgBox, directUrl);
        }
        return;
      }
      var tmdbParams = {
        id: id,
        type: mt
      };
      var localTmdbCached = getFromTmdbCache('poster', tmdbParams);
      if (localTmdbCached && localTmdbCached.posterUrl) {
        var localUrl = normalizePosterUrl(localTmdbCached.posterUrl);
        catalogState.posterCache.set(key, localUrl);
        if (card.isConnected) {
          yield setRowPosterImg(imgBox, localUrl);
        }
        return;
      }
      if (window.PosterDB) {
        try {
          var dbUrl = yield PosterDB.get(key);
          if (dbUrl) {
            var normalizedDbUrl = normalizePosterUrl(dbUrl);
            catalogState.posterCache.set(key, normalizedDbUrl);
            if (card.isConnected) {
              yield setRowPosterImg(imgBox, normalizedDbUrl);
            }
            return;
          }
        } catch (e) {}
      }
      var workerResult = yield fetchPosterUrlViaWorker(id, mt, getCatalogItemTitle(item));
      if (workerResult.ok) {
        if (workerResult.url) {
          var finalUrl = normalizePosterUrl(workerResult.url);
          saveToTmdbCache('poster', tmdbParams, {
            posterUrl: finalUrl
          });
          catalogState.posterCache.set(key, finalUrl);
          if (window.PosterDB) {
            PosterDB.set(key, finalUrl).catch(function () {});
          }
          if (card.isConnected) {
            yield setRowPosterImg(imgBox, finalUrl);
          }
        } else {
          if (card.isConnected) {
            imgBox.innerHTML = '<div class="no-poster">Нет постера</div>';
          }
        }
        return;
      }
      return _origLoadRowPoster.call(window, card, item);
    });
    return function patchedLoadRowPoster(_x9, _x0) {
      return _ref2.apply(this, arguments);
    };
  }();
  window.loadRowPoster = patchedLoadRowPoster;
  try {
    if (typeof loadRowPoster !== 'undefined') {
      loadRowPoster = patchedLoadRowPoster;
    }
  } catch (e) {}
  window.loadRowPoster = patchedLoadRowPoster;
  try {
    if (typeof loadRowPoster !== 'undefined') {
      loadRowPoster = patchedLoadRowPoster;
    }
  } catch (e) {}
  console.log('✅ Poster fetching patched through CatalogWorker');
})();
