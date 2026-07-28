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

    // ==================== searchTorrentsLegacy ====================
    window.searchTorrentsLegacy = searchTorrentsLegacy = async function (query) {
        if (!query || !query.trim()) { alert('Введите поисковый запрос'); return; }

        var encodedQuery = encodeURIComponent(query.trim());
        var jacred = getEl('jacred-url');
        var jacDefault = (jacred && jacred.value !== '') ? jacred.value : 'jac.red';
        var searchUrl = AppState.protocol + '//' + jacDefault + '/api/v2.0/indexers/all/results?Query=' + encodedQuery + '&exact=true';

        showLoading('Поиск...');

        try {
            var response = await fetch(searchUrl);
            if (!response.ok) throw new Error('Ошибка поиска: HTTP ' + response.status);
            var data = await response.json();

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

            applyFiltersAndSort();
            showSearchResults();
        } catch (error) {
            console.error('Ошибка поиска:', error);
            alert('Ошибка при поиске: ' + error.message);
        } finally {
            hideLoading();
        }
    };

    // ==================== applyFiltersAndSort ====================
    window.applyFiltersAndSort = applyFiltersAndSort = async function () {
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
        // Быстрое обновление заголовка на main thread (без ожидания Worker)
        var quickTitle = torrent.title || 'Без названия';
        var qb = quickTitle.match(/\[(\d+)\]/);
        if (qb) quickTitle = quickTitle.replace(/\[\d+\]/, '').trim();
        if (elements.titleEl) elements.titleEl.textContent = quickTitle;

        try {
            var r = await TorrentsWorker.loadAllTmdbData(torrent);

            // Заголовок (Worker мог очистить сезоны)
            if (elements.titleEl && r.cleanTitle) elements.titleEl.textContent = r.cleanTitle;

            // AppState
            AppState.isSerials = r.isTvSeries;
            if (r.seasonNumbers.length === 1 && r.isTvSeries) {
                AppState.currentTMDB = r.tmdbId;
                AppState.currentSeason = r.seasonNumbers[0];
            }

            // Season stills → DOM
            if (r.tmdbId && r.isTvSeries && r.seasonNumbers.length > 0 && Object.keys(r.allSeasonEpisodes).length > 0) {
                loadStillsAndUpdateFiles(r.seasonNumbers, r.allSeasonEpisodes, null, r.videoFilesCount);
            }

            // Movie still → DOM (формируем URL на main thread)
            if (r.movieStillPosterPath) {
                var stillUrl = AppState.protocol + '//tsimg.hnar.online/t/p/w300' + r.movieStillPosterPath;
                var fileItem = document.querySelector('.file-item');
                if (fileItem) updateFileItemStill(fileItem, stillUrl);
            }

            // TMDB Details → DOM
            if (r.details) {
                _applyTmdbDetailsToDOM(r.details, elements);
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
            var bp = AppState.protocol + '//tsimg.hnar.online/t/p/original' + details.backdrop_path;

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
