# Примеры

Все примеры есть в каталоге («Настройки → Расширения → Каталог»), их исходники
лежат в [msx/extensions](https://github.com/cash94/cash94.github.io/tree/main/msx/extensions).

## Крупные часы — только оформление

[big-clock.js](https://cash94.github.io/msx/extensions/big-clock.js) — одна
строка CSS через `TS.ui.addStyle`.

```js
TS.register({ name: 'Крупные часы', version: '1.0' });
TS.ui.addStyle('#clock-display{font-size:2.2em!important;font-weight:700!important;' +
  'background:rgba(0,0,0,.55);padding:.15em .5em;border-radius:.4em}');
```

## Из Википедии — сеть и блок в карточке

[wikipedia.js](https://cash94.github.io/msx/extensions/wikipedia.js)
показывает справку о фильме под описанием карточки:
- на событие `detail` ищет статью через `TS.fetch`;
- показывает справку через `TS.ui.setDetailBlock`;
- кладёт найденное в `TS.storage`, чтобы второй раз не ходить в сеть.

## Посмотреть позже — кнопка, хранилище, своё окно

[watch-later.js](https://cash94.github.io/msx/extensions/watch-later.js)
добавляет в карточку кнопку «Позже» (`TS.ui.addButton`) и хранит список в
`TS.storage`. Кнопка «Открыть» в меню расширения показывает список в окне
расширения (`TS.panel.open`): пульт ходит по кнопкам «Убрать» сам.

## Боковое меню главной — мост к интерфейсу

[home-sidebar.js](https://cash94.github.io/msx/extensions/home-sidebar.js)
показывает, как расширение строит свой интерфейс прямо на главной:
- «влево» с края главной открывает меню всех подборок: событие `nav` с
  `moved: false`;
- подборки с общей приставкой («Кинопоиск · …») собраны группами;
- в меню есть категории и разделы шапки;
- ОК переходит: `TS.dom.focus` к ряду, `TS.dom.click` по плитке или пункту шапки;
- пока меню открыто, пульт у расширения (`TS.keys.capture`);
- в углу постеров стоит ★ с оценкой (`TS.app.home()` + `TS.dom.create`).

Главное из него:

```js
TS.on('nav', function (e) {
  if (e.screen === 'home' && e.key === 'left' && !e.moved) openMenu();
});

TS.on('key', function (dir) {
  if (!menu) return false;
  if (dir === 'up') move(-1);
  else if (dir === 'down') move(1);
  else if (dir === 'enter') close(true);
  else close(false);            // вправо и «Назад»
  return true;
});

function close(go) {
  TS.keys.capture(false);
  TS.dom.remove(menu.root);
  var it = menu.items[menu.sel];
  if (go) { if (it.click) TS.dom.click(it.h); else TS.dom.focus(it.h); }
}
```
