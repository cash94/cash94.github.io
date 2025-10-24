(function () {
  'use strict';

  Lampa.Lang.add({
    jellyfin_add: {
      ru: 'Добавить в Jellyfin',
      en: 'Add to Jellyfin',
      uk: 'Додати до Jellyfin'
    }
  });

  // Сохраняем оригинальный Select.show
  const originalSelectShow = Lampa.Select.show;

  Lampa.Select.show = function (params) {
    // Проверяем, что это меню "Действие" для торрента
    if (
      params.title === Lampa.Lang.translate('title_action') &&
      Array.isArray(params.items) &&
      params.items.some(item => item.tomy !== undefined) // признак меню торрента
    ) {
      // Добавляем наш пункт
      params.items.push({
        title: Lampa.Lang.translate('jellyfin_add'),
        jellyfin: true
      });

      // Сохраняем оригинальный onSelect
      const originalOnSelect = params.onSelect;

      // Подменяем onSelect
      params.onSelect = function (selected) {
        if (selected.jellyfin) {
          // В оригинале `element` и `item` доступны через замыкание,
          // но у нас их нет. Однако в Lampac они передаются в `menu` через `Lampa.Listener.send('torrent', ...)`
          // и сохраняются в глобальный контекст (мы его сохраним отдельно)

          if (window.__lampac_torrent_element) {
            addToJellyfin(window.__lampac_torrent_element);
          } else {
            Lampa.Noty.show('Не удалось получить данные торрента');
          }
        } else {
          // Вызываем оригинальный обработчик
          if (originalOnSelect) originalOnSelect(selected);
        }
      };
    }

    return originalSelectShow.call(this, params);
  };

  // Сохраняем element при вызове контекстного меню (hover:long)
  Lampa.Listener.follow('torrent', function (e) {
    if (e.type === 'onlong') {
      window.__lampac_torrent_element = e.element;
    }
  });

  function addToJellyfin(element) {
    const torrentUrl = element.MagnetUri || element.Link;

    if (!torrentUrl) {
      Lampa.Noty.show(Lampa.Lang.translate('Нет ссылки на торрент'));
      return;
    }
    
    let torrserverUrl = null;
    if (Lampa.Torserver.ip()) {
       torrserverUrl = Lampa.Torserver.url();
    }

    if (!torrserverUrl) {
      Lampa.Noty.show('TorrServer URL не настроен');
      return;
    }

    const payload = {
      action: 'addJlfn',
      link: torrentUrl
    };

    const headers = {
      'accept': 'application/json',
      'Content-Type': 'application/json'
    };

    if (Lampa.Storage.field('torrserver_auth')) {
      const login = Lampa.Storage.get('torrserver_login') || '';
      const password = Lampa.Storage.value('torrserver_password') || '';
      if (login && password) {
        const credentials = btoa(login + ':' + password);
        headers['Authorization'] = 'Basic ' + credentials;
      }
    }

    // Используем fetch
  fetch(torrserverUrl + '/torrents', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(payload)
  })
    .then(function (response) {
      if (response.ok) {
        Lampa.Noty.show('Торрент добавлен в TorrServer (Jellyfin)');
      } else {
        throw new Error('HTTP ' + response.status);
      }
    })
    .catch(function (error) {
      Lampa.Noty.show('Ошибка добавления: ' + (error.message || 'неизвестно'));
    });
  }
})();
