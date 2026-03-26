// TMDB API через свой прокси
const TMDB_API_URL = '/api/tmdb/search';
const TMDB_IMAGE_URL = 'https://nmtmdb.duckdns.org/t/p/w342';

// Кэш для постеров
let posterCache = new Map();

// Функция для очистки названия
function cleanTitle(title) {
  if (!title) return '';

  let cleaned = title;

  // Убираем информацию о качестве/формате в квадратных скобках
  cleaned = cleaned.replace(/\[[^\]]*\]/g, ' ').trim();

  // Убираем информацию о качестве/формате в круглых скобках (кроме года)
  cleaned = cleaned.replace(/\([^\)]*?(1080p|720p|4K|WEB-DL|BDRip|DVDRip|HDTV|AVC|HEVC|x264|x265|H\.264|H\.265)[^\)]*\)/gi, ' ').trim();

  // Убираем информацию о релизерах и группах
  cleaned = cleaned.replace(/\s*\|\s*[^|]+$/, '').trim();
  cleaned = cleaned.replace(/@\s*[^\s]+$/, '').trim();

  // Убираем дублирование названий (через слеш)
  const slashParts = cleaned.split('/');
  if (slashParts.length > 1) {
    const shortest = slashParts.reduce((a, b) => a.length < b.length ? a : b);
    cleaned = shortest.trim();
  }

  // Убираем множественные пробелы
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Убираем точки в конце
  cleaned = cleaned.replace(/\.+$/, '').trim();

  return cleaned;
}

// Функция для извлечения года из названия
function extractYear(title) {
  if (!title) return null;

  const yearMatch = title.match(/(?:\(|\[|\s)(\d{4})(?:\)|\]|\s|$)/);
  if (yearMatch && yearMatch[1]) {
    return parseInt(yearMatch[1]);
  }

  return null;
}

// Функция для определения типа (фильм или сериал) - УЛУЧШЕННАЯ
function detectMediaType(title) {
  if (!title) return 'movie';

  const lowerTitle = title.toLowerCase();

  // Признаки сериала (расширенный список)
  const tvIndicators = [
    'сезон', 'season', 'серия', 'episode', 'tv-',
    's01', 's02', 's03', 's04', 's05', 's06', 's07', 's08', 's09', 's10',
    'e01', 'e02', 'e03', 'e04', 'e05',
    'complete', 'полный', 'сборник',
    'the complete', 'все серии',
    'tv series', 'телесериал', 'serial'
  ];

  for (const indicator of tvIndicators) {
    if (lowerTitle.includes(indicator)) {
      return 'tv';
    }
  }

  return 'movie';
}

// Функция для поиска постера через TMDB (с защитой от зацикливания)
async function searchPoster(title, year = null, mediaType = null, retry = true) {
  if (!title) return null;

  // Очищаем название от лишней информации
  const cleanTitleStr = cleanTitle(title);

  // Создаем ключ для кэша
  const cacheKey = `${cleanTitleStr}_${year || 'any'}_${mediaType || 'any'}`;

  // Проверяем кэш
  if (posterCache.has(cacheKey)) {
    console.log('📦 Используем кэшированный постер для:', cleanTitleStr);
    return posterCache.get(cacheKey);
  }

  // Определяем тип, если не передан
  const type = mediaType || detectMediaType(title);

  console.log(`🔍 Поиск постера для: "${cleanTitleStr}" (${year ? 'год: ' + year : 'год не указан'}, тип: ${type})`);

  try {
    // Формируем поисковый запрос к своему прокси
    let url = `${TMDB_API_URL}?query=${encodeURIComponent(cleanTitleStr)}&type=${type}`;
    if (year) {
      url += `&year=${year}`;
    }

    console.log('📡 Запрос к своему прокси:', url);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      console.log('❌ Ничего не найдено в TMDB');

      // Пробуем поиск с другим типом, но только если retry = true
      if (retry) {
        if (type === 'tv') {
          console.log('🔄 Пробуем поиск как фильм...');
          return await searchPoster(title, year, 'movie', false); // false - запрещаем дальнейшие попытки
        } else if (type === 'movie') {
          console.log('🔄 Пробуем поиск как сериал...');
          return await searchPoster(title, year, 'tv', false); // false - запрещаем дальнейшие попытки
        }
      } else {
        console.log('⏹️ Достигнут лимит попыток, прекращаем поиск');
      }

      // Сохраняем в кэш null, чтобы не пытаться снова
      posterCache.set(cacheKey, null);
      return null;
    }

    let firstResult = data.results[0];

    // Проверяем, что год совпадает (если указан)
    if (year) {
      const resultYear = type === 'tv'
        ? (firstResult.first_air_date ? new Date(firstResult.first_air_date).getFullYear() : null)
        : (firstResult.release_date ? new Date(firstResult.release_date).getFullYear() : null);

      if (resultYear && Math.abs(resultYear - year) > 1) {
        console.log(`⚠️ Год не совпадает: ожидался ${year}, получен ${resultYear}`);

        // Пробуем найти другой результат с подходящим годом
        const betterMatch = data.results.find(r => {
          const rYear = type === 'tv'
            ? (r.first_air_date ? new Date(r.first_air_date).getFullYear() : null)
            : (r.release_date ? new Date(r.release_date).getFullYear() : null);
          return rYear === year;
        });

        if (betterMatch) {
          console.log('✅ Найдено лучшее совпадение по году');
          firstResult = betterMatch;
        }
      }
    }

    // Получаем путь к постеру
    const posterPath = firstResult.poster_path;
    if (!posterPath) {
      console.log('❌ Нет постера в результате');

      // Пробуем поиск с другим типом, но только если retry = true
      if (retry) {
        if (type === 'tv') {
          console.log('🔄 Пробуем поиск как фильм (нет постера)...');
          return await searchPoster(title, year, 'movie', false);
        } else if (type === 'movie') {
          console.log('🔄 Пробуем поиск как сериал (нет постера)...');
          return await searchPoster(title, year, 'tv', false);
        }
      }

      posterCache.set(cacheKey, null);
      return null;
    }

    // Формируем прямой URL к изображению
    const posterUrl = `${TMDB_IMAGE_URL}${posterPath}`;
    console.log('✅ Найден прямой URL постера:', posterUrl);

    // Сохраняем в кэш
    posterCache.set(cacheKey, posterUrl);

    return posterUrl;

  } catch (error) {
    console.error('❌ Ошибка при поиске постера:', error);

    // Сохраняем ошибку в кэш, чтобы не пытаться снова
    const cacheKey = `${cleanTitleStr}_${year || 'any'}_${mediaType || 'any'}`;
    posterCache.set(cacheKey, null);

    return null;
  }
}

// Функция для поиска постера по названию из результата поиска
async function findPosterFromSearchResult(result) {
  if (!result) return null;

  // Используем поля из выбранного результата
  const displayTitle = result.name || result.title || '';

  // Важно: берем год именно из выбранного элемента!
  const year = result.relased || null;

  // Определяем тип из выбранного элемента
  const mediaType = result.types && result.types.includes('tv') ? 'tv' : 'movie';

  console.log('🎬 Поиск постера для выбранного:');
  console.log('   Название:', displayTitle);
  console.log('   Год из результата:', year);
  console.log('   Тип:', mediaType);
  console.log('   Полный результат:', result);

  // Начинаем с переданного типа, разрешаем одну повторную попытку
  return await searchPoster(displayTitle, year, mediaType, true);
}


// Делаем функции доступными глобально
window.tmdb = {
  searchPoster,
  findPosterFromSearchResult,
  cleanTitle,
  extractYear,
  detectMediaType
};