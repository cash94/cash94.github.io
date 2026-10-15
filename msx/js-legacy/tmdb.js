/* Сборка для старых браузеров (Chrome 53) из js/tmdb.js — tools/legacy-build/build.js. Руками не править. */
function asyncGeneratorStep(n, t, e, r, o, a, c) {try {var i = n[a](c),u = i.value;} catch (n) {return void e(n);}i.done ? t(u) : Promise.resolve(u).then(r, o);}function _asyncToGenerator(n) {return function () {var t = this,e = arguments;return new Promise(function (r, o) {var a = n.apply(t, e);function _next(n) {asyncGeneratorStep(a, r, o, _next, _throw, "next", n);}function _throw(n) {asyncGeneratorStep(a, r, o, _next, _throw, "throw", n);}_next(void 0);});};}
var TMDB_API_URL = '/api/tmdb/search';


function tmdbImageUrl(posterPath) {
  return getPrimaryImageBase() + 'w342' + posterPath;
}











var POSTER_CACHE_MAX = 300;
var posterCacheMap = new Map();

var posterCache = {
  has: function (key) {return posterCacheMap.has(key);},
  get: function (key) {
    if (!posterCacheMap.has(key)) return undefined;

    var v = posterCacheMap.get(key);
    posterCacheMap['delete'](key);
    posterCacheMap.set(key, v);
    return v;
  },
  set: function (key, value) {
    if (posterCacheMap.has(key)) posterCacheMap['delete'](key);
    posterCacheMap.set(key, value);
    while (posterCacheMap.size > POSTER_CACHE_MAX) {

      var oldest = posterCacheMap.keys().next();
      if (oldest.done) break;
      posterCacheMap['delete'](oldest.value);
    }
  },
  clear: function () {posterCacheMap.clear();},
  get size() {return posterCacheMap.size;}
};


function cleanTitle(title) {
  if (!title) return '';

  var cleaned = title;


  cleaned = cleaned.replace(/\[[^\]]*\]/g, ' ').trim();


  cleaned = cleaned.replace(/\([^\)]*?(1080p|720p|4K|WEB-DL|BDRip|DVDRip|HDTV|AVC|HEVC|x264|x265|H\.264|H\.265)[^\)]*\)/gi, ' ').trim();


  cleaned = cleaned.replace(/\s*\|\s*[^|]+$/, '').trim();
  cleaned = cleaned.replace(/@\s*[^\s]+$/, '').trim();


  var slashParts = cleaned.split('/');
  if (slashParts.length > 1) {
    var shortest = slashParts[0];
    for (var i = 1; i < slashParts.length; i++) {
      if (slashParts[i].length < shortest.length) {
        shortest = slashParts[i];
      }
    }
    cleaned = shortest.trim();
  }


  cleaned = cleaned.replace(/\s+/g, ' ').trim();


  cleaned = cleaned.replace(/\.+$/, '').trim();

  return cleaned;
}


function extractYear(title) {
  if (!title) return null;

  var yearMatch = title.match(/(?:\(|\[|\s)(\d{4})(?:\)|\]|\s|$)/);
  if (yearMatch && yearMatch[1]) {
    return parseInt(yearMatch[1], 10);
  }

  return null;
}


function detectMediaType(title) {
  if (!title) return 'movie';

  var lowerTitle = title.toLowerCase();


  var tvIndicators = [
  'сезон', 'season', 'серия', 'episode', 'tv-',
  's01', 's02', 's03', 's04', 's05', 's06', 's07', 's08', 's09', 's10',
  'e01', 'e02', 'e03', 'e04', 'e05',
  'complete', 'полный', 'сборник',
  'the complete', 'все серии',
  'tv series', 'телесериал', 'serial'];


  for (var i = 0; i < tvIndicators.length; i++) {
    if (lowerTitle.indexOf(tvIndicators[i]) !== -1) {
      return 'tv';
    }
  }

  return 'movie';
}function


searchPoster(_x, _x2, _x3, _x4) {return _searchPoster.apply(this, arguments);}function _searchPoster() {_searchPoster = _asyncToGenerator(function* (title, year, mediaType, retry) {
    if (year === undefined) year = null;
    if (mediaType === undefined) mediaType = null;
    if (retry === undefined) retry = true;

    if (!title) return null;


    var cleanTitleStr = cleanTitle(title);


    var cacheKey = cleanTitleStr + '_' + (year || 'any') + '_' + (mediaType || 'any');


    if (posterCache.has(cacheKey)) {
      console.log('📦 Используем кэшированный постер для:', cleanTitleStr);
      return posterCache.get(cacheKey);
    }


    var type = mediaType || detectMediaType(title);

    console.log('🔍 Поиск постера для: "' + cleanTitleStr + '" (' + (year ? 'год: ' + year : 'год не указан') + ', тип: ' + type + ')');

    try {

      var url = TMDB_API_URL + '?query=' + encodeURIComponent(cleanTitleStr) + '&type=' + type;
      if (year) {
        url += '&year=' + year;
      }

      console.log('📡 Запрос к своему прокси:', url);

      var response = yield fetch(url);
      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }

      var data = yield response.json();

      if (!data.results || data.results.length === 0) {
        console.log('❌ Ничего не найдено в TMDB');


        if (retry) {
          if (type === 'tv') {
            console.log('🔄 Пробуем поиск как фильм...');
            return yield searchPoster(title, year, 'movie', false);
          } else if (type === 'movie') {
            console.log('🔄 Пробуем поиск как сериал...');
            return yield searchPoster(title, year, 'tv', false);
          }
        } else {
          console.log('⏹️ Достигнут лимит попыток, прекращаем поиск');
        }


        posterCache.set(cacheKey, null);
        return null;
      }

      var firstResult = data.results[0];


      if (year) {
        var resultYear = null;
        if (type === 'tv') {
          resultYear = firstResult.first_air_date ? new Date(firstResult.first_air_date).getFullYear() : null;
        } else {
          resultYear = firstResult.release_date ? new Date(firstResult.release_date).getFullYear() : null;
        }

        if (resultYear && Math.abs(resultYear - year) > 1) {
          console.log('⚠️ Год не совпадает: ожидался ' + year + ', получен ' + resultYear);


          var betterMatch = null;
          for (var i = 0; i < data.results.length; i++) {
            var r = data.results[i];
            var rYear = null;
            if (type === 'tv') {
              rYear = r.first_air_date ? new Date(r.first_air_date).getFullYear() : null;
            } else {
              rYear = r.release_date ? new Date(r.release_date).getFullYear() : null;
            }
            if (rYear === year) {
              betterMatch = r;
              break;
            }
          }

          if (betterMatch) {
            console.log('✅ Найдено лучшее совпадение по году');
            firstResult = betterMatch;
          }
        }
      }


      var posterPath = firstResult.poster_path;
      if (!posterPath) {
        console.log('❌ Нет постера в результате');


        if (retry) {
          if (type === 'tv') {
            console.log('🔄 Пробуем поиск как фильм (нет постера)...');
            return yield searchPoster(title, year, 'movie', false);
          } else if (type === 'movie') {
            console.log('🔄 Пробуем поиск как сериал (нет постера)...');
            return yield searchPoster(title, year, 'tv', false);
          }
        }

        posterCache.set(cacheKey, null);
        return null;
      }


      var posterUrl = window.getTmdbImageUrl ?
      window.getTmdbImageUrl(posterPath, 'w342') :
      tmdbImageUrl(posterPath);
      console.log('✅ Найден прямой URL постера:', posterUrl);


      posterCache.set(cacheKey, posterUrl);

      return posterUrl;

    } catch (error) {
      console.error('❌ Ошибка при поиске постера:', error);


      var errorCacheKey = cleanTitleStr + '_' + (year || 'any') + '_' + (mediaType || 'any');
      posterCache.set(errorCacheKey, null);

      return null;
    }
  });return _searchPoster.apply(this, arguments);}function


findPosterFromSearchResult(_x5) {return _findPosterFromSearchResult.apply(this, arguments);}function _findPosterFromSearchResult() {_findPosterFromSearchResult = _asyncToGenerator(function* (result) {
    if (!result) return null;


    var displayTitle = result.name || result.title || '';


    var year = result.relased || null;


    var mediaType = result.types && result.types.indexOf('tv') !== -1 ? 'tv' : 'movie';

    console.log('Поиск постера для выбранного:');
    console.log('   Название:', displayTitle);
    console.log('   Год из результата:', year);
    console.log('   Тип:', mediaType);
    console.log('   Полный результат:', result);


    return yield searchPoster(displayTitle, year, mediaType, true);
  });return _findPosterFromSearchResult.apply(this, arguments);}


window.tmdb = {
  searchPoster: searchPoster,
  findPosterFromSearchResult: findPosterFromSearchResult,
  cleanTitle: cleanTitle,
  extractYear: extractYear,
  detectMediaType: detectMediaType
};
