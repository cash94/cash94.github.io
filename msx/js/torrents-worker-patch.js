// torrents-worker-patch.js — перехват функций torrents.js → делегирование в Worker
// Подключается ПОСЛЕ torrents.js и torrents-worker-bridge.js
(function () {
    'use strict';

    // ==================== СОХРАНЕНИЕ ОРИГИНАЛОВ ====================
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

    // ==================== searchTorrentsLegacy ====================
    window.searchTorrentsLegacy = searchTorrentsLegacy = async function (query) {
        if (!query || !query.trim()) { alert('Введите поисковый запрос'); return; }

        if (_searchController) _searchController.abort();
        _searchController = new AbortController();
        var controller = _searchController;
        var searchSequence = ++_searchSequence;

        var encodedQuery = encodeURIComponent(query.trim());
        var jacred = getEl('jacred-url');
        var jacDefault = (jacred && jacred.value !== '') ? jacred.value : 'jac.red';
        var searchUrl = AppState.protocol + '//' + jacDefault + '/api/v2.0/indexers/all/results?Query=' + encodedQuery + '&exact=true';

        showLoading('Поиск...');

        try {
            var response = await fetch(searchUrl, { signal: controller.signal });
            if (!response.ok) throw new Error('Ошибка поиска: HTTP ' + response.status);
            var data = await response.json();
            if (searchSequence !== _searchSequence) return;

            var rawResults = [];
            if (data && Array.isArray(data.Results)) rawResults = data.Results;
            else if (Array.isArray(data)) rawResults = data;

            // ★ Нормализация через Worker (батч)
            try {
                searchResults = await TorrentsWorker.normalizeBatch(rawResults);
            } catch (e) {
                console.warn('⚠️ Worker normalize failed, fallback:', e.message);
                searchResults = rawResults.map(normalizeSearchResult);
            }
            if (searchSequence !== _searchSequence) return;

            currentSearchQuery = query;
            var searchInput = getEl('search-query');
            if (searchInput) searchInput.value = '';

            // ★ Вычисление фильтров через Worker
            try {
                var filterData = await TorrentsWorker.computeFilters(searchResults);
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
        } catch (error) {
            if (error && error.name === 'AbortError') return;
            console.error('Ошибка поиска:', error);
            alert('Ошибка при поиске: ' + error.message);
        } finally {
            if (searchSequence === _searchSequence) hideLoading();
        }
    };

    // ==================== applyFiltersAndSort ====================
    window.applyFiltersAndSort = applyFiltersAndSort = async function () {
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
            filteredResults = await TorrentsWorker.applyFiltersAndSort(searchResults, filters);
            if (filterSequence !== _filterSequence) return;
            renderSearchResults();
        } catch (e) {
            console.warn('⚠️ Worker filter failed, fallback:', e.message);
            _origApplyFilters.call(window);
        }
    };

    // ==================== Вспомогательная: обновление select'ов ====================
    function _updateFilterSelectsFromData(fd) {
        // Years
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

        // Seasons
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

        // Voices
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

        // Videotype
        var videotypeFilter = getEl('filter-videotype');
        if (videotypeFilter) {
            var currentVt = videotypeFilter.value;
            videotypeFilter.innerHTML = '<option value="all">Все</option>' +
                fd.videotypes.map(function (v) {
                    return '<option value="' + escapeHtml(v) + '"' + (currentVt !== 'all' && v === currentVt ? ' selected' : '') + '>' + escapeHtml(v) + '</option>';
                }).join('');
            if (currentVt !== 'all' && fd.videotypes.indexOf(currentVt) === -1) {
                videotypeFilter.value = 'all';
                currentvideotypeFilter = 'all';
            }
        }
    }

    // ==================== loadAllTmdbDataForTorrent ====================
    window.loadAllTmdbDataForTorrent = loadAllTmdbDataForTorrent = async function (torrent, elements) {
        elements = elements || {};

        function cleanQuickTitle(t) {
            return String(t || 'Без названия')
                .replace(/\[\d+\]/g, '')
                .replace(/\[(tv|movie|сериал|фильм)\]/gi, '')
                .replace(/\[сезон[^\]]*\]/gi, '')
                .trim();
        }

        function normalizePosterUrl(path) {
            if (!path) return null;
            path = String(path);

            if (window.getTmdbImageUrl) return window.getTmdbImageUrl(path, 'w342');

            // Если это уже полный URL, заменяем image.tmdb.org на прокси
            if (path.indexOf('http') === 0) {
                // Используем функцию из main thread если доступна
                if (window.replaceTmdbWithProxy) {
                    return window.replaceTmdbWithProxy(path);
                }
                // Fallback: заменяем вручную
                if (path.indexOf('image.tmdb.org') !== -1) {
                    var mirrors = [
                        'tsimg.hnar.online',
                        'nl.imagetmdb.com',
                        'mocha.stull.xyz',
                        'proxy.vokino.pro/image',
                        'nmtmdb.duckdns.org'
                    ];
                    var randomProxy = mirrors[Math.floor(Math.random() * mirrors.length)];
                    return path.replace(/image\.tmdb\.org/g, randomProxy);
                }
                return path;
            }

            var protocol = 'https:';
            if (window.AppState && AppState.protocol) {
                protocol = String(AppState.protocol).replace(/:+$/, '');
                if (protocol.indexOf(':') === -1) protocol += ':';
            }

            return protocol + '//tsimg.hnar.online/t/p/w342' +
                (path.charAt(0) === '/' ? path : '/' + path);
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
                (window.AppState && AppState.pendingDetailItem) ||
                window.pendingCatalogItem || null;
            known = {
                id: (window.AppState && AppState.pendingDetailTmdbId) ||
                    (pendingItem && (pendingItem.id || pendingItem.tmdbId)) || null,
                mediaType: (window.AppState && AppState.pendingDetailMediaType) ||
                    (pendingItem && pendingItem.media_type) || null,
                poster: (window.AppState && AppState.pendingDetailPoster) ||
                    window.pendingCatalogPoster || null
            };
        }

        if (known) {
            if (!torrent.tmdbId && known.id) torrent.tmdbId = known.id;
            if (!torrent.media_type && known.mediaType) torrent.media_type = known.mediaType;
            if (!torrent.poster && known.poster) torrent.poster = normalizePosterUrl(known.poster);
        }
        if (!torrent.media_type && window.AppState && AppState.mediaType) {
            torrent.media_type = AppState.mediaType;
        }

        // Подтягиваем файлы заранее
        try {
            if (typeof getTorrentFilesWithCache === 'function') {
                var files = await getTorrentFilesWithCache(torrent, false);
                if (files && files.length) {
                    torrent.file_stats = files;
                }
            }
        } catch (e) { }

        // ★ FIX: Убираем bail-out для tv — Worker теперь корректно обрабатывает сериалы.
        // Оставляем fallback только если Worker недоступен.
        try {
            var r = await TorrentsWorker.loadAllTmdbData(torrent);
            if (!r) throw new Error('Empty worker result');

            if (elements.titleEl && r.cleanTitle) {
                elements.titleEl.textContent = r.cleanTitle;
            }

            AppState.isSerials = r.isTvSeries;
            if (r.mediaType) {
                AppState.mediaType = r.mediaType;
            }
            if (r.seasonNumbers && r.seasonNumbers.length === 1 && r.isTvSeries) {
                AppState.currentTMDB = r.tmdbId;
                AppState.currentSeason = r.seasonNumbers[0];
            }

            // Применяем кадры сезонов
            if (r.isTvSeries && r.seasonNumbers && r.seasonNumbers.length > 0 &&
                Object.keys(r.allSeasonEpisodes || {}).length > 0) {
                loadStillsAndUpdateFiles(r.seasonNumbers, r.allSeasonEpisodes, null, r.videoFilesCount);
            }

            // Постер фильма
            if (r.movieStillPosterPath) {
                var stillUrl = window.getTmdbImageUrl
                    ? window.getTmdbImageUrl(r.movieStillPosterPath, 'w300')
                    : normalizePosterUrl(r.movieStillPosterPath);
                var fileItem = document.querySelector('.file-item');
                if (fileItem) updateFileItemStill(fileItem, stillUrl);
            }

            // TMDB details → DOM
            if (r.details) {
                _applyTmdbDetailsToDOM(r.details, elements);
            }

            // Сохраняем в knownTorrentMeta для будущих визитов
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
    };

    // ==================== DOM-обновления из TMDB details ====================
    function _applyTmdbDetailsToDOM(details, elements) {
        // Backdrop
        if (details.backdrop_path && elements.detailViewDiv) {
            var bp = window.getTmdbImageUrl
                ? window.getTmdbImageUrl(details.backdrop_path, 'w1280')
                : AppState.protocol + '//tsimg.hnar.online/t/p/original' + details.backdrop_path;

            // Добавляем linear-gradient поверх картинки для 50% затемнения
            elements.detailViewDiv.style.backgroundImage = 'linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5)), url(' + bp + ')';
            elements.detailViewDiv.style.backgroundSize = 'cover';
            elements.detailViewDiv.style.backgroundPosition = 'center';
            elements.detailViewDiv.style.backgroundRepeat = 'no-repeat';

            // Блок с созданием оверлея больше не нужен, его можно смело удалить:
            /*
            if (!getEl('detail-backdrop-overlay')) {
                var ov = document.createElement('div');
                ...
            }
            */
        }

        // Overview
        if (details.overview) {
            if (elements.detailSubtitle) {
                elements.detailSubtitle.textContent = details.overview;
                elements.detailSubtitle.style.display = 'block';
                elements.detailSubtitle.classList.remove('hidden');
            }
            var ovEl = getEl('catalog-detail-overview');
            if (ovEl) {
                ovEl.textContent = details.overview;
                ovEl.style.display = 'none';
                ovEl.classList.add('hidden');
            }
        }

        // Meta (жанры, год, рейтинг)
        if (typeof updateDetailMetaInfo === 'function') {
            updateDetailMetaInfo(details);
        }
    }

    console.log('✅ Torrents Worker patches applied (v2 — compute + TMDB data)');
})();
