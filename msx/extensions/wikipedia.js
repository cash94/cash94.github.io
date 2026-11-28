/*
 * Пример расширения TorrStream: сеть (TS.fetch) и блок в карточке
 * (TS.ui.setDetailBlock). Википедия отдаёт CORS-заголовки, поэтому её API
 * доступен напрямую.
 */
TS.register({
  name: 'Из Википедии',
  version: '1.0',
  description: 'Краткая справка о фильме из русской Википедии под кнопками карточки.'
});

var API = 'https://ru.wikipedia.org/w/api.php?format=json&origin=*';
var current = 0;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

TS.on('detail', function (item) {
  var seq = ++current;
  TS.ui.setDetailBlock('');
  if (!item || !item.title || item.torrent) return;
  var query = item.title + (item.year ? ' ' + item.year : '') + (item.type === 'tv' ? ' сериал' : ' фильм');
  var cacheKey = 'w:' + (item.tmdbId || query);
  var cached = TS.storage.get(cacheKey);
  if (cached) { show(cached); return; }
  TS.fetch(API + '&action=query&list=search&srlimit=1&srsearch=' + encodeURIComponent(query))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var hit = data && data.query && data.query.search && data.query.search[0];
      if (!hit) return null;
      return TS.fetch(API + '&action=query&prop=extracts&exintro=1&explaintext=1&exsentences=3&titles=' +
        encodeURIComponent(hit.title)).then(function (r) { return r.json(); });
    })
    .then(function (data) {
      if (!data || seq !== current) return;
      var pages = data.query && data.query.pages, text = '';
      for (var k in pages) { if (pages[k].extract) { text = pages[k].extract; break; } }
      if (!text) return;
      text = text.slice(0, 600);
      TS.storage.set(cacheKey, text);
      show(text);
    })
    .catch(function () { });

  function show(text) {
    if (seq !== current) return;
    TS.ui.setDetailBlock('<div style="font-size:0.9em;opacity:0.85"><b>Википедия:</b> ' + esc(text) + '</div>');
  }
});
