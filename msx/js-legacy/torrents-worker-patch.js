/* Сборка для старых браузеров (Chrome 53) из js/torrents-worker-patch.js — tools/legacy-build/build.js. Руками не править. */
function asyncGeneratorStep(n, t, e, r, o, a, c) {try {var i = n[a](c),u = i.value;} catch (n) {return void e(n);}i.done ? t(u) : Promise.resolve(u).then(r, o);}function _asyncToGenerator(n) {return function () {var t = this,e = arguments;return new Promise(function (r, o) {var a = n.apply(t, e);function _next(n) {asyncGeneratorStep(a, r, o, _next, _throw, "next", n);}function _throw(n) {asyncGeneratorStep(a, r, o, _next, _throw, "throw", n);}_next(void 0);});};}

(function () {
  'use strict';


  var _origSearchLegacy = window.searchTorrentsLegacy || searchTorrentsLegacy;
  var _origApplyFilters = window.applyFiltersAndSort || applyFiltersAndSort;
  var _origUpdateTrackers = window.updateAvailableTrackers || updateAvailableTrackers;
  var _origUpdateYears = window.updateAvailableYears || updateAvailableYears;
  var _origUpdateSeasons = window.updateAvailableSeasons || updateAvailableSeasons;
  var _origUpdateVoices = window.updateAvailableVoices || updateAvailableVoices;
  var _origUpdateVideotype = window.updateAvailableVideotype || updateAvailableVideotype;
  var _origLoadAllTmdbData = window.loadAllTmdbDataForTorrent || loadAllTmdbDataForTorrent;
  var _searchController = null;
  var _searchSequence = 0;
  var _filterSequence = 0;







  function makeJacredError(host, reason, timedOut) {
    var e = new Error('Jacred (' + host + ') недоступен: ' + reason);
    e.jacredHost = host;
    e.jacredTimeout = !!timedOut;
    return e;
  }





  function jacredTimeoutMs() {
    return window.JACRED_TIMEOUT_MS || 15000;
  }


  window.searchTorrentsLegacy = searchTorrentsLegacy = function () {var _ref = _asyncToGenerator(function* (query) {
      if (!query || !query.trim()) {alert('Введите поисковый запрос');return 0;}

      if (_searchController) _searchController.abort();
      _searchController = new AbortController();
      var controller = _searchController;
      var searchSequence = ++_searchSequence;




      var searchUrl, jacDefault;
      if (typeof window.buildJacredSearchUrl === 'function') {
        var target = window.buildJacredSearchUrl(query);
        searchUrl = target.url;
        jacDefault = target.host;
      } else {
        var jacred = getEl('jacred-url');
        jacDefault = jacred && jacred.value !== '' ? jacred.value : 'jac.red';
        searchUrl = AppState.protocol + '//' + jacDefault +
        '/api/v2.0/indexers/all/results?Query=' + encodeURIComponent(query.trim()) + '&exact=true';
      }

      showLoading('Поиск...');
      if (typeof window.setJacredSearchFailure === 'function') window.setJacredSearchFailure(null);






      var timedOut = false;
      var timeoutId = setTimeout(function () {
        if (searchSequence !== _searchSequence) return;
        timedOut = true;
        controller.abort();
      }, jacredTimeoutMs());

      try {




        var response;
        try {
          response = yield fetch(searchUrl, { signal: controller.signal });
        } catch (netError) {
          if (timedOut) throw makeJacredError(jacDefault, 'нет ответа за ' + jacredTimeoutMs() + ' мс', true);
          if (netError && netError.name === 'AbortError') throw netError;
          throw makeJacredError(jacDefault, netError.message);
        }
        if (!response.ok) throw makeJacredError(jacDefault, 'HTTP ' + response.status);
        var data = yield response.json();
        if (searchSequence !== _searchSequence) return 0;

        var rawResults = [];
        if (data && Array.isArray(data.Results)) rawResults = data.Results;else
        if (Array.isArray(data)) rawResults = data;


        try {
          searchResults = yield TorrentsWorker.normalizeBatch(rawResults);
        } catch (e) {
          console.warn('⚠️ Worker normalize failed, fallback:', e.message);
          searchResults = rawResults.map(normalizeSearchResult);
        }
        if (searchSequence !== _searchSequence) return 0;

        currentSearchQuery = query;
        var searchInput = getEl('search-query');


        if (searchInput && !(window.AppState && AppState.searchLocked)) searchInput.value = '';


        try {
          var filterData = yield TorrentsWorker.computeFilters(searchResults);
          availableTrackers = filterData.trackers;
          if (availableTrackers.indexOf(currentTrackerFilter) === -1) currentTrackerFilter = 'all';
          syncSearchFilterButtons();
          _updateFilterSelectsFromData(filterData);
        } catch (e) {
          console.warn('⚠️ Worker computeFilters failed, fallback:', e.message);
          _origUpdateTrackers.call(window);
        }
        if (searchSequence !== _searchSequence) return;

        applyFiltersAndSort();
        showSearchResults();



        return searchResults.length;
      } catch (error) {




        if (error && error.name === 'AbortError' && !error.jacredHost) {
          if (!timedOut) return 0;
          error = makeJacredError(jacDefault, 'нет ответа за ' + jacredTimeoutMs() + ' мс', true);
        }
        console.error('Ошибка поиска:', error);
        if (typeof window.setJacredSearchFailure === 'function') window.setJacredSearchFailure(error);
        var shown = typeof window.showJacredUnavailableBanner === 'function' &&
        window.showJacredUnavailableBanner(error);
        if (!shown) {
          if (typeof window.showErrorBanner === 'function') {
            if (error && error.jacredHost) {
              window.showErrorBanner('Jacred недоступен',
              'Не отвечает ' + error.jacredHost + '. Адрес меняется в настройках.');
            } else {
              window.showErrorBanner('Ошибка поиска', error.message);
            }
          } else alert('Ошибка при поиске: ' + error.message);
        }
        return 0;
      } finally {
        clearTimeout(timeoutId);
        if (searchSequence === _searchSequence) hideLoading();
      }
    });return function searchTorrentsLegacy(_x) {return _ref.apply(this, arguments);};}();


  window.applyFiltersAndSort = applyFiltersAndSort = function () {var _ref2 = _asyncToGenerator(function* () {
      var filterSequence = ++_filterSequence;
      var filters = {
        quality: currentQualityFilter,
        tracker: currentTrackerFilter,
        year: currentYearFilter,
        season: currentSeasonFilter,
        voice: currentVoiceFilter,
        videotype: currentvideotypeFilter,
        sort: currentSort
      };

      try {
        filteredResults = yield TorrentsWorker.applyFiltersAndSort(searchResults, filters);
        if (filterSequence !== _filterSequence) return;
        renderSearchResults();
      } catch (e) {
        console.warn('⚠️ Worker filter failed, fallback:', e.message);
        _origApplyFilters.call(window);
      }
    });return function applyFiltersAndSort() {return _ref2.apply(this, arguments);};}();


  function _updateFilterSelectsFromData(fd) {

    var yearFilter = getEl('filter-year');
    if (yearFilter) {
      var currentYear = yearFilter.value;
      yearFilter.innerHTML = '<option value="all">Все</option>' +
      fd.years.map(function (y) {
        return '<option value="' + y + '"' + (currentYear !== 'all' && String(y) === currentYear ? ' selected' : '') + '>' + y + '</option>';
      }).join('');
      if (currentYear !== 'all' && fd.years.indexOf(parseInt(currentYear)) === -1) {
        yearFilter.value = 'all';
        currentYearFilter = '';
      }
    }


    var seasonFilter = getEl('filter-season');
    if (seasonFilter) {
      var currentSeason = seasonFilter.value;
      seasonFilter.innerHTML = '<option value="all">Все</option>' +
      fd.seasons.map(function (s) {
        return '<option value="' + s + '"' + (currentSeason !== 'all' && String(s) === currentSeason ? ' selected' : '') + '>' + s + ' сезон</option>';
      }).join('');
      if (currentSeason !== 'all' && fd.seasons.indexOf(parseInt(currentSeason)) === -1) {
        seasonFilter.value = 'all';
        currentSeasonFilter = 'all';
      }
    }


    var voiceFilter = getEl('filter-voice');
    if (voiceFilter) {
      var currentVoice = voiceFilter.value;
      voiceFilter.innerHTML = '<option value="all">Все</option>' +
      fd.voices.map(function (v) {
        return '<option value="' + escapeHtml(v) + '"' + (currentVoice !== 'all' && v === currentVoice ? ' selected' : '') + '>' + escapeHtml(v) + '</option>';
      }).join('');
      if (currentVoice !== 'all' && fd.voices.indexOf(currentVoice) === -1) {
        voiceFilter.value = 'all';
        currentVoiceFilter = 'all';
      }
    }


    var videotypeFilter = getEl('filter-videotype');
    if (videotypeFilter) {

      var currentVt = currentvideotypeFilter || 'all';
      videotypeFilter.innerHTML = '<option value="all">Все</option>' +
      fd.videotypes.map(function (v) {
        return '<option value="' + escapeHtml(v) + '"' + (currentVt !== 'all' && v === currentVt ? ' selected' : '') + '>' + escapeHtml(v.toUpperCase()) + '</option>';
      }).join('');
      if (currentVt !== 'all' && fd.videotypes.indexOf(currentVt) === -1) {
        videotypeFilter.value = 'all';
        currentvideotypeFilter = 'all';
      }
    }
  }


  window.loadAllTmdbDataForTorrent = loadAllTmdbDataForTorrent = function () {var _ref3 = _asyncToGenerator(function* (torrent, elements) {
      elements = elements || {};

      function cleanQuickTitle(t) {
        return String(t || 'Без названия').
        replace(/\[\d+\]/g, '').
        replace(/\[(tv|movie|сериал|фильм)\]/gi, '').
        replace(/\[сезон[^\]]*\]/gi, '').
        trim();
      }

      function normalizePosterUrl(path) {
        if (!path) return null;
        path = String(path);

        if (window.getTmdbImageUrl) return window.getTmdbImageUrl(path, 'w342');


        if (path.indexOf('http') === 0) {

          if (window.replaceTmdbWithProxy) {
            return window.replaceTmdbWithProxy(path);
          }

          if (path.indexOf('image.tmdb.org') !== -1) {
            return path.replace(/image\.tmdb\.org/g, getPrimaryImageHost());
          }
          return path;
        }


        return getPrimaryImageBase() + 'w342' + (
        path.charAt(0) === '/' ? path : '/' + path);
      }

      var quickTitle = cleanQuickTitle(torrent.title);
      if (elements.titleEl) elements.titleEl.textContent = quickTitle;

      var hashLower = torrent.hash ? String(torrent.hash).toLowerCase() : '';
      var known = null;
      if (hashLower && window.getKnownTorrentMeta) {
        known = window.getKnownTorrentMeta(hashLower) || null;
      }
      if (!known &&
      hashLower &&
      typeof lastAddedTorrentHash !== 'undefined' &&
      lastAddedTorrentHash &&
      hashLower === String(lastAddedTorrentHash).toLowerCase()) {
        var pendingItem =
        window.AppState && AppState.pendingDetailItem ||
        window.pendingCatalogItem || null;
        known = {
          id: window.AppState && AppState.pendingDetailTmdbId ||
          pendingItem && (pendingItem.id || pendingItem.tmdbId) || null,
          mediaType: window.AppState && AppState.pendingDetailMediaType ||
          pendingItem && pendingItem.media_type || null,
          poster: window.AppState && AppState.pendingDetailPoster ||
          window.pendingCatalogPoster || null
        };
      }

      if (known) {
        if (!torrent.tmdbId && known.id) torrent.tmdbId = known.id;
        if (!torrent.media_type && known.mediaType) torrent.media_type = known.mediaType;
        if (!torrent.poster && known.poster) torrent.poster = normalizePosterUrl(known.poster);
      }


      try {
        if (typeof getTorrentFilesWithCache === 'function') {
          var files = yield getTorrentFilesWithCache(torrent, false);
          if (files && files.length) {
            torrent.file_stats = files;
          }
        }
      } catch (e) {}









      if (!torrent.media_type && torrent.category) {




        var catLower = String(torrent.category).toLowerCase();
        if (catLower.indexOf('tv') !== -1 ||
        catLower.indexOf('сериал') !== -1 ||
        catLower.indexOf('serial') !== -1 ||
        catLower.indexOf('series') !== -1) {
          torrent.media_type = 'tv';
        }
      }



      try {
        var r = yield TorrentsWorker.loadAllTmdbData(torrent);
        if (!r) throw new Error('Empty worker result');



        if (elements.detailViewDiv && typeof window.isOpenTorrentDetail === 'function' &&
        !window.isOpenTorrentDetail(torrent)) return r;

        if (elements.titleEl && r.cleanTitle) {
          elements.titleEl.textContent = r.cleanTitle;
        }

        AppState.isSerials = r.isTvSeries;






        torrent.media_type = r.mediaType || torrent.media_type;
        if (r.seasonNumbers && r.seasonNumbers.length === 1 && r.isTvSeries) {
          AppState.currentTMDB = r.tmdbId;
          AppState.currentSeason = r.seasonNumbers[0];
        }


        if (r.isTvSeries && r.seasonNumbers && r.seasonNumbers.length > 0 &&
        Object.keys(r.allSeasonEpisodes || {}).length > 0) {
          loadStillsAndUpdateFiles(r.seasonNumbers, r.allSeasonEpisodes, null, r.videoFilesCount);
        }


        if (r.movieStillPosterPath) {
          var stillUrl = window.getTmdbImageUrl ?
          window.getTmdbImageUrl(r.movieStillPosterPath, 'w300') :
          normalizePosterUrl(r.movieStillPosterPath);


          var fileItem = document.querySelector('#files-list .file-item:not(.hidden)');
          if (fileItem) updateFileItemStill(fileItem, stillUrl);
        }


        if (r.details) {
          _applyTmdbDetailsToDOM(r.details, elements);






          if (typeof window.revealTorrentDetailExtras === 'function') {
            window.revealTorrentDetailExtras(torrent, r.details);
          }
        }


        if (hashLower && r.tmdbId && typeof knownTorrentMeta !== 'undefined' && knownTorrentMeta.set) {
          knownTorrentMeta.set(hashLower, {
            id: r.tmdbId,
            mediaType: r.mediaType,
            poster: torrent.poster || null
          });
        }

        return r;
      } catch (e) {
        console.warn('⚠️ Worker loadAllTmdbData failed, fallback:', e.message);
        return _origLoadAllTmdbData.call(window, torrent, elements);
      }
    });return function loadAllTmdbDataForTorrent(_x2, _x3) {return _ref3.apply(this, arguments);};}();


  function _applyTmdbDetailsToDOM(details, elements) {

    if (details.backdrop_path && elements.detailViewDiv) {
      var bp = window.getTmdbImageUrl ?
      window.getTmdbImageUrl(details.backdrop_path, 'w1280') :
      getPrimaryImageBase() + 'w1280' + details.backdrop_path;




      elements.detailViewDiv.style.backgroundImage =
      'linear-gradient(to top, rgba(0, 0, 0, 0.97) 0%, rgba(0, 0, 0, 0.82) 32%, rgba(0, 0, 0, 0.38) 64%, rgba(0, 0, 0, 0.25) 100%), ' +
      'linear-gradient(to right, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.5) 45%, rgba(0, 0, 0, 0.1) 100%), ' +
      'url(' + bp + ')';
      elements.detailViewDiv.style.backgroundSize = 'cover';
      elements.detailViewDiv.style.backgroundPosition = 'center';
      elements.detailViewDiv.style.backgroundRepeat = 'no-repeat';


      elements.detailViewDiv.style.setProperty('--torrent-backdrop', 'url(' + bp + ')');








    }


    if (details.overview) {
      if (elements.detailSubtitle) {
        elements.detailSubtitle.textContent = details.overview;
        elements.detailSubtitle.style.display = 'block';
        elements.detailSubtitle.classList.remove('hidden');
      }
    }



    if (typeof updateDetailMetaInfo === 'function') {
      updateDetailMetaInfo(details);
    }
  }
})();
