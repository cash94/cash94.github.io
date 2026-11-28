/*
 * «Онлайн: пример» — заготовка источника онлайн-просмотра для авторов
 * расширений. Ничего не ищет: на любую карточку предлагает два открытых
 * тестовых ролика (HLS и mp4), а у сериалов — «серии» плейлистом.
 *
 * Показывает:
 *   • TS.online.register — общая кнопка «Онлайн» в карточке и событие 'online';
 *   • своё окно со списком (TS.panel) и навигацию пультом в нём (класс .on —
 *     куда встать при входе в ряд);
 *   • TS.player.play: качество, субтитры, плейлист, событие 'player';
 *   • TS.ui.addButton с местом: своя кнопка сразу после «Трейлера».
 */
TS.register({
  name: 'Онлайн: пример',
  version: '1.0',
  description: 'Пример источника онлайн-просмотра: тестовые ролики вместо фильма.'
});

var HLS = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
var MP4 = 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_5MB.mp4';
var MP4_360 = 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4';

var item = null;

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

TS.online.register({ name: 'Пример (тестовые ролики)' });

TS.on('online', function (e) {
  item = e.item;
  var html = '<h2>' + esc(item.title) + (item.year ? ' (' + item.year + ')' : '') + '</h2>' +
    '<p style="opacity:.7">IMDb: ' + esc(item.imdbId || '—') + ' · Кинопоиск: ' + esc(item.kinopoiskId || '—') + '</p>';
  if (item.type === 'tv') {
    html += '<div>';
    for (var i = 1; i <= 4; i++) html += '<button data-ep="' + i + '"' + (i === 1 ? ' class="on"' : '') + '>Серия ' + i + '</button>';
    html += '</div>';
  } else {
    html += '<div><button data-play="hls" class="on">HLS (m3u8)</button><button data-play="mp4">mp4, два качества</button></div>';
  }
  document.body.innerHTML = html;
  TS.panel.open('пример');
});

document.addEventListener('click', function (e) {
  var b = e.target.closest('button');
  if (!b || !item) return;
  var p;
  if (b.hasAttribute('data-ep')) {
    // Плейлист: плеер сам перейдёт к следующей (по настройке «Переключать серии автоматически»)
    var list = [];
    for (var i = 1; i <= 4; i++) list.push({ url: i % 2 ? HLS : MP4, title: item.title + ' · S1E' + i, season: 1, episode: i });
    p = TS.player.play({ playlist: list, index: +b.getAttribute('data-ep') - 1 });
  } else if (b.getAttribute('data-play') === 'mp4') {
    p = TS.player.play({ title: item.title, quality: { '720p': MP4, '360p': MP4_360 } });
  } else {
    p = TS.player.play({ url: HLS, title: item.title, startAt: TS.storage.get('pos:' + item.tmdbId, 0) });
  }
  p['catch'](function (err) { TS.toast(err.message); });
});

// Где остановились — чтобы в следующий раз продолжить
TS.on('player', function (e) {
  if (e.state === 'exit' && item && e.position > 10) TS.storage.set('pos:' + item.tmdbId, Math.floor(e.position));
});

// Своя кнопка в том же ряду — сразу за «Трейлером», с текстом
TS.on('detail', function (it) {
  if (it.tmdbId && !it.torrent) TS.ui.addButton({ id: 'about', label: 'О примере', icon: 'info', after: 'trailer', style: 'wide' });
  else TS.ui.removeButton('about');
});

TS.on('button', function (e) {
  if (e.id === 'about') TS.toast('Кнопка расширения: after: \'trailer\', style: \'wide\'');
});
