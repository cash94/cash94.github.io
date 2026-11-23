/* Пример расширения TorrStream: только оформление (TS.ui.addStyle) */
TS.register({
  name: 'Крупные часы',
  version: '1.0',
  description: 'Часы в углу экрана заметнее: крупнее и с подложкой.'
});
TS.ui.addStyle(
  '#clock-display{font-size:2.2em!important;font-weight:700!important;' +
  'background:rgba(0,0,0,.55);padding:.15em .5em;border-radius:.4em}'
);
