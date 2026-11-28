/*
 * Пример расширения TorrStream: кнопка в карточке, хранилище и своё окно,
 * которым управляют пультом (button / a / [data-focus] — фокусируемые).
 */
TS.register({
  name: 'Посмотреть позже',
  version: '1.0',
  description: 'Кнопка в карточке фильма: отложить на потом. Список — в окне расширения.',
  settings: true          // в «Расширениях» появится кнопка «Открыть»
});

var item = null;

function list() { return TS.storage.get('list', []); }
function key(it) { return it.type + ':' + (it.tmdbId || it.title); }
function has(it) {
  var l = list();
  for (var i = 0; i < l.length; i++) if (key(l[i]) === key(it)) return true;
  return false;
}

function updateButton() {
  if (!item || item.torrent) { TS.ui.removeButton('later'); return; }
  TS.ui.addButton({ id: 'later', label: has(item) ? 'Отложено' : 'Позже', icon: has(item) ? 'bookmark' : 'clock' });
}

TS.on('detail', function (it) { item = it; updateButton(); });

TS.on('button', function (e) {
  if (e.id !== 'later' || !item) return;
  var l = list();
  if (has(item)) {
    l = l.filter(function (x) { return key(x) !== key(item); });
    TS.toast('Убрано из «Посмотреть позже»');
  } else {
    l.unshift({ tmdbId: item.tmdbId, type: item.type, title: item.title, year: item.year, poster: item.poster });
    TS.toast('Добавлено в «Посмотреть позже»');
  }
  TS.storage.set('list', l.slice(0, 200));
  updateButton();
});

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function render() {
  var l = list();
  var html = '<style>.row{display:flex;align-items:center;margin-bottom:12px}' +
    '.row img{width:60px;height:90px;object-fit:cover;border-radius:6px;margin-right:16px;background:#333}' +
    '.row .t{flex:1}</style>';
  if (!l.length) html += '<p>Список пуст. Откройте карточку фильма и нажмите «Позже».</p>';
  l.forEach(function (x, i) {
    html += '<div class="row">' + (x.poster ? '<img src="' + esc(x.poster) + '">' : '<img>') +
      '<div class="t">' + esc(x.title) + (x.year ? ' (' + x.year + ')' : '') + '</div>' +
      '<button data-del="' + i + '">Убрать</button></div>';
  });
  document.body.innerHTML = html;
  Array.prototype.forEach.call(document.querySelectorAll('[data-del]'), function (b) {
    b.onclick = function () {
      var l2 = list();
      l2.splice(+b.getAttribute('data-del'), 1);
      TS.storage.set('list', l2);
      render();
      var first = document.querySelector('button');
      if (first) TS.panel.focus(first);
      updateButton();
    };
  });
}

TS.on('settings', function () { render(); TS.panel.open('список'); });
