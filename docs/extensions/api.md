# Справочник API

Всё, что расширению доступно, лежит в глобальном объекте `TS`. Код пишите на
ES5 (`var`, `function`, без стрелок и шаблонных строк). На части телевизоров
браузер — Chrome 53–66.

## Описание расширения

```js
TS.register({ name: 'Название', version: '1.0', description: 'Что делает', settings: true });
TS.info();   // { id, appVersion, platform }
```
`settings: true` добавляет в меню расширения кнопку «Открыть», которая
присылает событие `settings`.

## События

```js
TS.on('detail', function (item) { … });   // открыта карточка фильма или сериала
TS.on('screen', function (name) { … });    // home | torrents | catalog | search | detail | player | config
TS.on('button', function (e) { … });       // нажата ваша кнопка в карточке: { id, item }
TS.on('settings', function () { … });      // «Открыть» в меню расширения
TS.on('panel', function (e) { … });        // ваше окно открыто/закрыто: { open }
TS.on('key', function (dir) { return true; });  // пульт: up | down | left | right | enter | back
TS.on('nav', function (e) { … });          // после каждой стрелки и ОК
TS.on('home', function () { … });          // ряды главной построены или пересобраны
TS.off(name, fn);
```

**item** — открытые сведения TMDB о фильме:
```js
{ tmdbId: '603', type: 'movie' | 'tv', title, originalTitle, year, poster, vote, torrent }
```
Хеша раздачи, magnet-ссылки и адресов серверов в нём нет. `torrent: true`
означает, что открыта карточка раздачи, а не фильма.

**nav**:
```js
{ key: 'left', screen: 'home', moved: false, focused: { …описание элемента… } }
```
`moved: false` на стрелке означает край: дальше идти некуда. Так открывают
своё боковое меню «влево с первой карточки».

**key** приходит, пока открыто ваше окно (`TS.panel.open`) или пока вы держите
пульт (`TS.keys.capture`). Обработчик, вернувший `true`, отменяет стандартное
поведение. В окне стандартное поведение такое: стрелки двигают фокус между
`button`, `a[href]` и `[data-focus]`, ОК нажимает.

## Хранилище

Своё у каждого расширения, лимит около 1 МБ JSON. К моменту запуска кода оно
уже загружено, поэтому `get` синхронный, а запись сохраняется сама.
```js
TS.storage.get('key', defaultValue);
TS.storage.set('key', value);    // всё, что переживает JSON
TS.storage.remove('key');
TS.storage.keys();
TS.storage.clear();
```
Когда расширение удаляют, его хранилище удаляется вместе с ним.

## Оформление и карточка

```js
TS.ui.addStyle('.home-card { border-radius: 0 }');
TS.ui.hide('#home-hero .home-hero-actions');
TS.ui.setText('.some-label', 'Текст');            // только элементы без вложенных
TS.ui.addButton({ id: 'x', label: 'Подпись', icon: 'star' });  // в карточке, до 3
TS.ui.removeButton('x');
TS.ui.setDetailBlock('<b>HTML</b>');              // блок под описанием карточки; '' — убрать
TS.toast('Сообщение');
```
- `icon` — имя значка [uicons](https://www.flaticon.com/uicons) без приставки:
  `star` → `fi-rr-star`.
- В CSS нельзя `url()`, `image-set()`, `@import`, `@font-face` и обратную
  косую черту: ими можно было бы вынести значения полей на чужой сервер.
- HTML блока чистится по белому списку тегов (`div span p b i u s strong em
  small br hr ul ol li h3–h5 img table…`) и атрибутов (`class`, `style`,
  `title`, у `img` — `src` по https или `data:image`). Скрипты и обработчики
  удаляются.

## Своё окно

```js
TS.panel.open('подзаголовок');   // документ расширения во весь экран
TS.panel.close();
TS.panel.focus(element);         // фокус пульта на элемент вашего окна
```
Окно рисует документ самого расширения (`document.body`). Ему доступны обычный
DOM и стили. Фокус пульта обозначается классом `.focused`, а цвет фокуса из
«Внешнего вида» лежит в `var(--focus-color)`. Заголовок с именем расширения
рисует приложение. «Назад» всегда закрывает окно.

## Мост к интерфейсу приложения

Через мост расширение меняет сам интерфейс: вставляет свои элементы, двигает
фокус, строит меню. Элементы приходят описаниями:
```js
{ h, tag, id, cls, text, attrs, own, focused, visible, rect }
```
`h` — номер элемента для следующих вызовов. Вместо него можно передать само
описание. Все методы возвращают Promise.

```js
TS.dom.query('.catalog-row-card', { root, limit, rect: true, text: false });  // до 500
TS.dom.closest(node, '.catalog-row');
TS.dom.children(node);
TS.dom.focused();                          // элемент под фокусом пульта
TS.dom.create('<aside id="ext-menu">…</aside>', { parent: node | 'селектор', where: 'append' | 'prepend' | 'before' | 'after' });
TS.dom.update(node, {
  text: '…', html: '…',                    // html — только у своих элементов
  addClass: 'a b', removeClass: 'c',
  style: { opacity: '.5', display: 'none !important' },
  attrs: { 'data-x': '1', title: null }    // null — убрать
});
TS.dom.remove(node);                       // только свои
TS.dom.click(node);
TS.dom.focus(node);                        // фокус пульта, как стрелкой
TS.dom.on('#ext-menu .item', 'click', function (node) { … });   // мышь и палец
```

Пульт и главная:
```js
TS.keys.capture(true);    // пульт целиком вам: стрелки и ОК приходят событием key
TS.keys.capture(false);   // вернуть пульт приложению
TS.app.home();            // ряды главной
TS.app.item(node);        // сведения о фильме за карточкой
TS.app.screen();          // текущий экран
```
`TS.app.home()` возвращает:
```js
{ ready: true, activeRow: 2, rows: [
  { index, key, title, col, h, cards: [ { h, title, tile, item } ] }
] }
```
`col` — на какой карточке стояли в ряду, `tile: true` — плитка категории,
`item` — сведения о фильме (как в `detail`).

Правила моста:
- **Свои элементы** помечаются `data-ext`. Расширение может наполнять их
  разметкой и удалять. Их `id` должен начинаться с `ext-`.
- **Элементы приложения** можно менять ограниченно: классы, стили, атрибуты
  `data-*`, `aria-*`, `title`, `role`, `hidden`, текст элементов без вложенных.
  Когда расширение выключают, все такие правки откатываются.
- **Нажимать** можно свои элементы и навигацию: пункты шапки, карточки,
  плитки категорий, кнопки карточки (кроме «Избранного»), карточки актёров,
  серий и похожих.
- **Закрыто полностью**: экран настроек, поля паролей, встроенная клавиатура,
  окна расширений. Значения полей ввода не отдаются нигде.
- `TS.keys.capture` возвращается приложению само по «Назад» и при смене
  экрана: в этот момент приходит `key` со значением `back`.

## Сеть

```js
TS.fetch(url, { method: 'GET', headers: {}, body: null }).then(function (r) {
  return r.json();     // r: { ok, status, url, text(), json() }
});
```
- Запрос выполняет приложение: без cookie и без Referer.
- Ответ — до 2 МБ, ожидание — до 15 секунд.
- Сервер должен отдавать заголовок CORS (`Access-Control-Allow-Origin`).
- Закрыты адреса сервера TorrStream, TorrServer, самой страницы и домашней
  сети (10.x, 192.168.x, 127.x, `.local` и т. п.).
- Перенаправления разрешены только у GET и HEAD, и конечный адрес проходит ту
  же проверку.
- Обычные `fetch`, `XMLHttpRequest` и `WebSocket` в песочнице закрыты.
- Картинки в своём окне и в блоках грузятся только по https.
