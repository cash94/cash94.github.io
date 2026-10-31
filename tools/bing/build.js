// Список картинок дня Bing для заставки интерфейса (msx/js/screensaver.js).
//
//   node tools/bing/build.js <файл.json>
//
// Bing отдаёт список (HPImageArchive) без CORS, и страница на телевизоре его
// прочитать не может. Поэтому список раз в день собирает GitHub Actions
// (.github/workflows/bing.yml) и коммитит в main как msx/cache/bing.json —
// страницы GitHub отдаются с Access-Control-Allow-Origin: *. Сами картинки
// клиент грузит прямо с www.bing.com: <img> и CSS-фону CORS не нужен.
//
// Пустой ответ Bing — код выхода 1 и файл не трогаем: в main остаётся
// прежний список.

'use strict';

const fs = require('fs');

const ARCHIVE_URL = 'https://www.bing.com/HPImageArchive.aspx?format=js&mkt=ru-RU';
const IMAGE_HOST = 'https://www.bing.com';
const IMAGE_SUFFIX = '_1920x1080.jpg';
// Не больше 8 картинок за запрос и не глубже 15 дней назад: две страницы
// (idx 0 и 8) — это две недели картинок
const PAGES = [0, 8];
const TIMEOUT_MS = 15000;

/** «Мост … (© Автор)» → место отдельно, копирайт отдельно */
function splitCopyright(text) {
  const s = String(text || '');
  const m = s.match(/^(.*?)\s*\((©[^)]*)\)\s*$/);
  return m ? { title: m[1], copyright: m[2] } : { title: s, copyright: '' };
}

async function fetchPage(idx) {
  const res = await fetch(ARCHIVE_URL + '&idx=' + idx + '&n=8', {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' для idx=' + idx);
  const data = await res.json();
  return (data && data.images) || [];
}

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error('не указан файл для списка');

  const seen = new Set();
  const images = [];
  for (const idx of PAGES) {
    let list;
    try {
      list = await fetchPage(idx);
    } catch (e) {
      console.warn('Bing: страница idx=' + idx + ' не получена: ' + e.message);
      continue;
    }
    for (const it of list) {
      // Страницы перекрываются на день — повтор отсекаем по urlbase
      if (!it || !it.urlbase || seen.has(it.urlbase)) continue;
      seen.add(it.urlbase);
      const parts = splitCopyright(it.copyright);
      images.push({
        url: IMAGE_HOST + it.urlbase + IMAGE_SUFFIX,
        title: parts.title,
        copyright: parts.copyright,
        date: it.startdate || ''
      });
    }
  }

  if (!images.length) {
    console.error('Bing не отдал ни одной картинки — список не обновлён');
    process.exit(1);
  }

  // Без отметки времени: тот же список даёт тот же файл, и сборка gh-pages,
  // не найдя изменений, не делает лишний коммит
  fs.writeFileSync(out, JSON.stringify({ images: images }, null, 1) + '\n');
  console.log('Bing: ' + images.length + ' картинок → ' + out);
}

main().catch(function (e) {
  console.error(e.message);
  process.exit(1);
});
