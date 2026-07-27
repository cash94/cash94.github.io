// Модуль: RuTube Proxy
// version: '1.2.0'

var COOKIE = 'spid=1766485521715_a77f23010cdb2d595b1554114fb6f689_lpeubwr8l73rbj7b; uuid=0cab4513-d084-416d-8089-9b792761c06e; uxs_uid=fd74f680-f2c7-11f0-9a79-41744765d973; canary1={"tags_predicto":{"active":"A","term":[{"id":44,"label":"A","percent":100},{"id":45,"label":"B","percent":100}]},"new_player":{"active":"A","term":[{"id":50,"label":"A","percent":100},{"id":51,"label":"B","percent":100}]},"ds_player":{"active":"A","term":[{"id":87,"label":"A","percent":100},{"id":88,"label":"B","percent":100}]},"current_stage_ds":{"active":"A","term":[{"id":120,"label":"A","percent":100},{"id":121,"label":"B","percent":100}]}}; _ym_uid=1776148732703051562; _ym_d=1776148732; spsc=1780471971036_1b41a6459433b1f447b9b16f43105aaa_ixPogLLQJLgcsdfdWhT4SmL3kLAYYYZ.rEh5YDrdsM8Z; csrftoken=3f0a7800e9fa4e25841271c8d831019c; session_id=56394752411768560119_1785129481972; _ym_isad=1; eg=bd9935fc; cid=56394752411768560119; ea=d26cbd9a; qrator_msid2=v2.0.1785133427.827.53efb7baWQaS0gGR|u8D0UAjJB1ZSn0PV|JQKRXAcgWlZb5s2gvzKrVWgyJtl+eLKMaCE6UHhwqjtDTpSB0tNTUwUZwwvRFWLHZSpg4/m4FdT0JSL0/CRhbA==-B1r8pT0cR1AzsGSzQeg3OmOuK3o='

module.exports = {
  name: 'rutube-proxy',
  version: '1.2.0',

  init: function (app, ctx) {
    ctx.log.log('Инициализация RuTube proxy...');

    // Персональная директория модуля
    var dataDir = ctx.dirs.own;

    app.get('/api/rutube/proxy', function (req, res) {
      var targetUrl = req.query.url;
      if (!targetUrl || targetUrl.indexOf('rutube.ru') === -1) {
        return res.status(400).json({ error: 'Invalid URL' });
      }

      ctx.httpGet(targetUrl).then(function (data) {
        res.json(JSON.parse(data));
      }).catch(function (e) {
        res.status(502).json({ error: e.message });
      });
    });

    // Пример: модуль может хранить свои данные
    app.get('/api/rutube/stats', function (req, res) {
      res.json({ module: 'rutube-proxy', version: '1.2.0', uptime: process.uptime() });
    });

    ctx.log.log('RuTube proxy зарегистрирован');

    // Возвращаем экземпляр (опционально)
    return { ready: true };
  },

  destroy: function () {
    // Очистка при выгрузке
    console.log('[rutube-proxy] Уничтожение...');
  }
};
