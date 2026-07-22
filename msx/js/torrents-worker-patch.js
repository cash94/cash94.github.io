// torrents-worker-patch.js — перехватывает 2 функции
(function () {
    'use strict';

    var _origSearchLegacy = window.searchTorrentsLegacy || searchTorrentsLegacy;
    var _origApplyFilters = window.applyFiltersAndSort || applyFiltersAndSort;
    var _origUpdateTrackers = window.updateAvailableTrackers || updateAvailableTrackers;
    var _origUpdateYears = window.updateAvailableYears || updateAvailableYears;
    var _origUpdateSeasons = window.updateAvailableSeasons || updateAvailableSeasons;
    var _origUpdateVoices = window.updateAvailableVoices || updateAvailableVoices;
    var _origUpdateVideotype = window.updateAvailableVideotype || updateAvailableVideotype;

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

    console.log('✅ Torrents Worker patches applied (compute-only)');
})();