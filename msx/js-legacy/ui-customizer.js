/* Сборка для старых браузеров (Chrome 53) из js/ui-customizer.js — tools/legacy-build/build.js. Руками не править. */












(function () {
  'use strict';

  console.log('🎨 Загрузка UI Customizer...');



  var STORAGE_KEY = 'uiCustomizer';

  var defaultSettings = {
    cardSize: 210,
    detailScale: 100,
    detailTextScale: 100,
    topbarScale: 100,
    topbarStyle: 'text',
    settingsScale: 100,
    catalogColumns: 'auto',



    titleSize: 15,
    ratingSize: 13,
    typeSize: 13,
    yearSize: 12,
    heroTextScale: 100,
    borderRadius: 'medium',
    density: 'comfortable',
    animations: 'normal',
    scrollAnim: 'smooth',




    posterBrightness: 'normal',
    focusColor: '#ff8c00',
    showRatings: true,
    showYear: true,


    heroTrailers: true
  };




  var CARD_MAX_W = 260;
  var CARD_MAX_H = 460;

  function posterHeight(w) {
    return Math.round(w * CARD_MAX_H / CARD_MAX_W);
  }

  function pxLabel(v) {return v + ' px';}


  var SLIDERS = {
    cardSize: {
      min: 120, max: CARD_MAX_W, step: 1, def: 210,
      fmt: function (v) {return v + ' × ' + posterHeight(v);}
    },
    detailScale: {
      min: 60, max: 160, step: 1, def: 100,
      fmt: function (v) {return v + '%';}
    },
    titleSize: { min: 10, max: 26, step: 1, def: 15, fmt: pxLabel },


    ratingSize: { min: 9, max: 35, step: 1, def: 13, fmt: pxLabel },
    typeSize: { min: 9, max: 35, step: 1, def: 13, fmt: pxLabel },
    yearSize: { min: 8, max: 35, step: 1, def: 12, fmt: pxLabel },




    heroTextScale: {
      min: 80, max: 220, step: 5, def: 100,
      fmt: function (v) {return v + '%';}
    },




    detailTextScale: {
      min: 80, max: 200, step: 5, def: 100,
      fmt: function (v) {return v + '%';}
    },




    topbarScale: {
      min: 80, max: 200, step: 5, def: 100,
      fmt: function (v) {return v + '%';}
    },


    settingsScale: {
      min: 80, max: 160, step: 5, def: 100,
      fmt: function (v) {return v + '%';}
    }
  };



  var FONT_SIZES = {
    small: { title: '12px', meta: '11px' },
    medium: { title: '15px', meta: '13px' },
    large: { title: '17px', meta: '15px' }
  };

  var RADII = { none: '0px', small: '6px', medium: '12px', large: '20px' };

  var DENSITIES = {
    compact: { gap: '6px', info: '5px' },
    comfortable: { gap: '12px', info: '8px' },
    spacious: { gap: '20px', info: '12px' }
  };

  var BRIGHTNESS = { dim: '0.8', normal: '1', bright: '1.15' };


  var SCROLL_ANIMS = { none: 1, fast: 1, smooth: 1 };


  var FOCUS_COLORS = [
  ['#ff8c00', 'Оранжевый'],
  ['#ffd60a', 'Жёлтый'],
  ['#ff3b30', 'Красный'],
  ['#ff2d92', 'Розовый'],
  ['#af52de', 'Фиолетовый'],
  ['#4a9eff', 'Синий'],
  ['#00d1ff', 'Голубой'],
  ['#00e0a4', 'Бирюзовый'],
  ['#4caf50', 'Зелёный'],
  ['#ffffff', 'Белый']];



  function normalizeColor(v) {
    var s = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(s)) {
      s = '#' + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2) + s.charAt(3) + s.charAt(3);
    }
    if (/^#[0-9a-f]{6}$/.test(s)) return s;
    return defaultSettings.focusColor;
  }


  function rgba(hex, alpha) {
    var n = parseInt(normalizeColor(hex).slice(1), 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }




  function tint(hex, amount) {
    var n = parseInt(normalizeColor(hex).slice(1), 16);
    var ch = [n >> 16 & 255, n >> 8 & 255, n & 255];
    for (var i = 0; i < 3; i++) ch[i] = Math.round(ch[i] + (255 - ch[i]) * amount);
    return 'rgb(' + ch[0] + ',' + ch[1] + ',' + ch[2] + ')';
  }


  var LEGACY_ROW_TO_W = { small: 170, medium: 210, large: 260 };
  var LEGACY_CARD_TO_W = { small: 150, medium: 190, large: 220, xlarge: 260 };



  function clampStep(value, cfg) {
    var v = parseFloat(value);
    if (isNaN(v)) v = cfg.def;
    v = Math.round(v / cfg.step) * cfg.step;
    if (v < cfg.min) v = cfg.min;
    if (v > cfg.max) v = cfg.max;
    return v;
  }




  function migrateLegacy(raw) {
    if (!raw || typeof raw !== 'object') return raw;
    if (raw.cardSize === undefined || raw.cardSize === null || isNaN(parseFloat(raw.cardSize))) {
      var legacy = LEGACY_ROW_TO_W[raw.rowPosterSize];
      if (!legacy) legacy = LEGACY_CARD_TO_W[raw.catalogCardSize];
      if (legacy) raw.cardSize = legacy;
    }



    if (raw.titleSize === undefined && FONT_SIZES[raw.fontSize]) {
      var preset = FONT_SIZES[raw.fontSize];
      raw.titleSize = parseFloat(preset.title);
      raw.ratingSize = parseFloat(preset.meta);
      raw.typeSize = parseFloat(preset.meta);
      raw.yearSize = Math.max(8, parseFloat(preset.meta) - 1);
    }

    delete raw.rowPosterSize;
    delete raw.catalogCardSize;
    return raw;
  }







  var FIT_VERSION = 1;



  function shortLandscape() {
    var h = window.innerHeight || 0;
    var w = window.innerWidth || 0;
    return h > 0 && h <= 620 && w >= 700;
  }




  function viewportDefaults() {
    if (!shortLandscape()) return null;
    return {
      cardSize: clampStep(Math.round((window.innerHeight || 540) * 0.266), SLIDERS.cardSize),
      density: 'compact'
    };
  }


  function resolvedDefaults() {
    return Object.assign({}, defaultSettings, viewportDefaults());
  }


  function normalizeSettings(s) {
    if (!s || typeof s !== 'object') s = {};
    delete s.rowPosterSize;
    delete s.catalogCardSize;

    s.cardSize = clampStep(s.cardSize, SLIDERS.cardSize);
    s.detailScale = clampStep(s.detailScale, SLIDERS.detailScale);

    delete s.fontSize;

    s.titleSize = clampStep(s.titleSize, SLIDERS.titleSize);
    s.ratingSize = clampStep(s.ratingSize, SLIDERS.ratingSize);
    s.typeSize = clampStep(s.typeSize, SLIDERS.typeSize);
    s.yearSize = clampStep(s.yearSize, SLIDERS.yearSize);

    if (s.heroTextScale === undefined && s.heroOverviewScale !== undefined) {
      s.heroTextScale = s.heroOverviewScale;
    }
    delete s.heroOverviewScale;
    s.heroTextScale = clampStep(s.heroTextScale, SLIDERS.heroTextScale);
    s.detailTextScale = clampStep(s.detailTextScale, SLIDERS.detailTextScale);
    s.topbarScale = clampStep(s.topbarScale, SLIDERS.topbarScale);
    s.topbarStyle = s.topbarStyle === 'icons' ? 'icons' : 'text';
    s.settingsScale = clampStep(s.settingsScale, SLIDERS.settingsScale);
    s.focusColor = normalizeColor(s.focusColor);

    s.showRatings = !!s.showRatings;
    s.showYear = !!s.showYear;


    s.heroTrailers = s.heroTrailers !== false;
    return s;
  }

  var currentSettings;
  try {
    var saved = localStorage.getItem(STORAGE_KEY);
    var raw = migrateLegacy(saved ? JSON.parse(saved) : null);
    var fit = viewportDefaults();


    var needFit = !!fit && !!raw && raw.fitVersion !== FIT_VERSION;
    currentSettings = normalizeSettings(needFit ?
    Object.assign({}, defaultSettings, raw, fit) :
    Object.assign({}, defaultSettings, fit, raw));
    currentSettings.fitVersion = FIT_VERSION;


    if (saved) saveSettings();
  } catch (e) {
    currentSettings = resolvedDefaults();
  }



  function cardWidth() {return clampStep(currentSettings.cardSize, SLIDERS.cardSize);}
  function detailScale() {return clampStep(currentSettings.detailScale, SLIDERS.detailScale);}
  function focusColor() {return normalizeColor(currentSettings.focusColor);}


  function scrollAnim() {
    return SCROLL_ANIMS[currentSettings.scrollAnim] ? currentSettings.scrollAnim : 'smooth';
  }


  function explicitColumns() {
    if (currentSettings.catalogColumns && currentSettings.catalogColumns !== 'auto') {
      var n = parseInt(currentSettings.catalogColumns, 10);
      if (!isNaN(n) && n > 0) return n;
    }
    return 0;
  }

  function densityGap() {
    var d = DENSITIES[currentSettings.density] || DENSITIES.comfortable;
    return parseFloat(d.gap) || 12;
  }



  function gridAvailWidth() {
    var avail = 0;
    var grid = document.getElementById('catalog-grid') || document.getElementById('torrents-grid');
    if (grid) {
      avail = grid.clientWidth;
      if (!avail && grid.parentElement) avail = grid.parentElement.clientWidth;
      if (avail) avail -= 16;
    }
    if (!(avail > 0)) avail = (window.innerWidth || 1280) - 16;
    return avail;
  }







  function legacyGridCss(cols, gap) {
    var grids = ['#catalog-grid', '#torrents-grid', '.global-search-grid'];
    var sel = function (suffix) {
      return grids.map(function (g) {return 'html.legacy-browser ' + g + suffix;}).join(',');
    };
    return sel('') + '{margin-right:-' + gap + '!important;}' +
    sel('>*') + '{width:calc(100% / ' + cols + ' - ' + gap + ' - 0.05px)!important;' +
    'margin:0 ' + gap + ' ' + gap + ' 0!important;}' +
    sel('>[style*="grid-column"]') + ',' +
    ['.catalog-chunk-spacer', '.catalog-header', '.load-more-trigger'].map(function (c) {
      return 'html.legacy-browser #catalog-grid>' + c;
    }).join(',') +
    '{width:calc(100% - ' + gap + ')!important;}';
  }

  function gridColumnWidth() {
    var cols = getColumns();
    return Math.floor((gridAvailWidth() - (cols - 1) * densityGap()) / cols);
  }



  function cardInfoHeight() {
    var density = DENSITIES[currentSettings.density] || DENSITIES.comfortable;
    var title = clampStep(currentSettings.titleSize, SLIDERS.titleSize);
    var meta = clampStep(currentSettings.typeSize, SLIDERS.typeSize);
    return 2 * (parseFloat(density.info) || 8) +
    2 * Math.round(title * 1.3) +
    4 +
    Math.round(meta * 1.35);
  }




  function getColumns() {




    if (window.matchMedia &&
    window.matchMedia('(max-width: 600px) and (orientation: portrait)').matches) return 2;

    var explicit = explicitColumns();
    if (explicit) return explicit;

    var w = cardWidth();
    var gap = densityGap();


    var n = Math.floor((gridAvailWidth() + gap) / (w + gap));
    if (n < 1) n = 1;
    if (n > 12) n = 12;
    return n;
  }







  function buildFocusCss(c) {
    var css = [];






    css.push(':root{--focus-color:' + c + ';--focus-color-soft:' + rgba(c, 0.35) +
    ';--focus-color-bg:' + rgba(c, 0.14) + ';--focus-color-text:' + tint(c, 0.35) + ';}');


    css.push('.focused{box-shadow:0 0 0 3px ' + c + '!important;}');
    css.push('#detail-view .focused{box-shadow:0 0 0 3px ' + c + '!important;}');


    css.push('#catalog-watch-btn.focused,.catalog-watch-btn.focused,' +
    '.catalog-trailer-btn.focused,#catalog-trailer-btn.focused,' +
    '.detail-progress-btn.focused,#detail-progress-btn.focused,' +
    '#catalog-toggle-overview-btn.focused,.catalog-toggle-overview-btn.focused{' +
    'box-shadow:0 0 0 3px ' + c + '!important;}');


    css.push('#back-from-detail.focused,.detail-header .back-btn.focused{' +
    'box-shadow:0 0 0 3px ' + c + '!important;background:' + rgba(c, 0.2) + '!important;}');


    css.push('.catalog-actor-card.focused,.catalog-recommendation-card.focused{' +
    'box-shadow:0 0 0 3px ' + c + '!important;}');




    css.push('.card-modern.focused{box-shadow:none!important;}');
    css.push('.card-modern.focused .torrent-poster::after{' +
    'box-shadow:inset 0 0 0 3px ' + c + '!important;}');






    css.push('.catalog-row-card.focused{box-shadow:none!important;}');
    css.push('.catalog-row-card.focused .torrent-poster::after{' +
    'box-shadow:inset 0 0 0 3px ' + c + '!important;}');


    css.push('.catalog-show-all.focused .show-all-inner{' +
    'border-color:' + c + '!important;background:#26262d!important;' +
    'box-shadow:0 0 0 3px ' + c + '!important;}');


    css.push('.catalog-row-header.focused{background:' + rgba(c, 0.08) + '!important;}');
    css.push('.catalog-row-header.focused .catalog-row-title{' +
    'color:' + c + '!important;text-shadow:0 0 20px ' + rgba(c, 0.4) + '!important;}');


    css.push('.control-btn.focused{background:' + rgba(c, 0.2) + '!important;' +
    'box-shadow:0 0 0 3px ' + c + '!important;}');



    css.push('.filter-back-btn:hover,.filter-close-btn:hover,' +
    '.filter-back-btn:focus-visible,.filter-close-btn:focus-visible,' +
    '.filter-back-btn.focused,.filter-close-btn.focused{' +
    'background:' + rgba(c, 0.2) + '!important;box-shadow:0 0 0 2px ' + c + '!important;}');
    css.push('.filter-item:hover,.filter-item.focused{background:' + rgba(c, 0.1) + '!important;' +
    'box-shadow:0 0 0 2px ' + c + '!important;}');
    css.push('.filter-value-item:hover,.filter-value-item.focused{background:' + rgba(c, 0.15) + '!important;' +
    'box-shadow:0 0 0 2px ' + c + '!important;}');


    css.push('.skip-button.focused{border-color:' + c + '!important;' +
    'box-shadow:0 0 10px ' + c + ',0 2px 8px rgba(0,0,0,0.2)!important;}');
    css.push('.skip-button.focused.filled{' +
    'box-shadow:0 0 15px ' + c + ',0 4px 15px rgba(0,0,0,0.3)!important;}');




    css.push('.ui-customizer-overlay .ui-customizer-panel .ui-focused{' +
    'box-shadow:0 0 0 3px ' + c + '!important;outline:none!important;}');

    return css;
  }

  function buildSettingsCss() {
    var w = cardWidth();
    var h = posterHeight(w);
    var cols = getColumns();
    var titleSize = clampStep(currentSettings.titleSize, SLIDERS.titleSize);
    var ratingSize = clampStep(currentSettings.ratingSize, SLIDERS.ratingSize);
    var typeSize = clampStep(currentSettings.typeSize, SLIDERS.typeSize);
    var yearSize = clampStep(currentSettings.yearSize, SLIDERS.yearSize);
    var heroTextScale = clampStep(currentSettings.heroTextScale, SLIDERS.heroTextScale);
    var detailTextScale = clampStep(currentSettings.detailTextScale, SLIDERS.detailTextScale);
    var topbarScale = clampStep(currentSettings.topbarScale, SLIDERS.topbarScale);
    var settingsScale = clampStep(currentSettings.settingsScale, SLIDERS.settingsScale);
    var radius = RADII[currentSettings.borderRadius] || RADII.medium;
    var density = DENSITIES[currentSettings.density] || DENSITIES.comfortable;
    var bright = BRIGHTNESS[currentSettings.posterBrightness] || BRIGHTNESS.normal;
    var scale = detailScale();

    var css = [];






    css.push('#catalog-grid,#catalog-rows,#torrents-grid,.global-search-grid{' +
    'grid-template-columns:repeat(' + cols + ',1fr)!important;' +
    'grid-gap:' + density.gap + '!important;' +
    'gap:' + density.gap + '!important;}');


    if (document.documentElement.className.indexOf('legacy-browser') !== -1) {
      css.push(legacyGridCss(cols, density.gap));
    }














    css.push('.catalog-row-card,.catalog-row-viewport .catalog-row-card{' +
    'flex:0 0 ' + w + 'px!important;width:' + w + 'px!important;}');
    css.push('.catalog-row-viewport .catalog-row-card{height:' + h + 'px!important;}');
    css.push('.catalog-row-card .torrent-poster,.catalog-row-viewport .catalog-row-card .torrent-poster,.row-poster-img{' +
    'width:' + w + 'px!important;height:' + h + 'px!important;}');

    css.push('.catalog-show-all,.catalog-row-viewport .catalog-show-all{' +
    'flex:0 0 ' + w + 'px!important;width:' + w + 'px!important;}');
    css.push('.catalog-show-all .show-all-inner,.catalog-row-viewport .catalog-show-all .show-all-inner{' +
    'width:' + w + 'px!important;height:' + h + 'px!important;}');


    css.push('.torrent-card{border-radius:' + radius + '!important;}');


    css.push('.torrent-info{padding:' + density.info + '!important;}');




    css.push('.torrent-title{font-size:' + titleSize + 'px!important;' +
    'height:auto!important;max-height:none!important;}');
    css.push('.rating-badge,.card-modern .torrent-playing,.card-modern .torrent-size{' +
    'font-size:' + ratingSize + 'px!important;}');
    css.push('.torrent-meta,.torrent-badge{font-size:' + typeSize + 'px!important;}');
    css.push('.card-modern .poster-year{font-size:' + yearSize + 'px!important;}');




    css.push(':root{--hero-text-scale:' + heroTextScale / 100 + ';}');



    css.push(':root{--detail-text-scale:' + detailTextScale / 100 + ';}');



    css.push(':root{--topbar-scale:' + topbarScale / 100 + ';}');


    css.push(':root{--settings-zoom:' + (1.2 * settingsScale / 100).toFixed(3) + ';}');


    css.push('.card-modern .poster-bar{height:' + (
    Math.max(ratingSize, typeSize) + 14) + 'px!important;}');


    if (!currentSettings.showRatings) css.push('.rating-badge{display:none!important;}');

    if (!currentSettings.showYear) css.push('.catalog-badge,.card-modern .poster-year{display:none!important;}');









    if (bright !== BRIGHTNESS.normal) {
      css.push('.torrent-poster img,.row-poster-img>img,img.catalog-poster-img{filter:brightness(' + bright + ')!important;}');
    }





    if (scale !== 100) {
      css.push('#detail-view>*:not(#catalog-detail-extra),' +
      '#detail-view>#catalog-detail-extra>*:not(#catalog-detail-backdrop){' +
      'zoom:' + scale / 100 + '!important;}');
    }


    css = css.concat(buildFocusCss(focusColor()));


    if (currentSettings.animations === 'none') {
      css.push('*,*::before,*::after{transition:none!important;animation:none!important;}');


      css.push('.filter-back-btn.focused,.filter-close-btn.focused,.filter-item.focused,' +
      '.filter-value-item.focused,.filter-reset-btn-new.focused,' +
      '.control-btn.focused,.audio-item.focused,.episode-item.focused,.subtitle-item.focused,' +
      '#exit-player-btn.focused,.close-panel-btn.focused{transition:none!important;}');
    } else if (currentSettings.animations === 'reduced') {
      css.push('*,*::before,*::after{transition-duration:.1s!important;animation-duration:.1s!important;}');
    }

    return css.join('\n');
  }








  var topbarMetrics = null;


  var topbarFitWidth = null;

  function measureTopbar(tb, scale) {




    var kids = [],textW = 0,fixed = 0;
    for (var k = 0; k < tb.children.length; k++) {
      var child = tb.children[k];
      if (child.id === 'home-nav-drawer' && getComputedStyle(child).position !== 'fixed') {
        for (var d = 0; d < child.children.length; d++) kids.push(child.children[d]);
      } else {
        kids.push(child);
      }
    }
    for (var i = 0; i < kids.length; i++) {
      var cs = getComputedStyle(kids[i]);
      if (cs.position === 'absolute' || cs.position === 'fixed' || cs.display === 'none') continue;
      textW += kids[i].getBoundingClientRect().width;

      if (kids[i].id !== 'tab-search') fixed += parseFloat(cs.marginLeft) || 0;
      fixed += parseFloat(cs.marginRight) || 0;
    }
    var tcs = getComputedStyle(tb);
    fixed += (parseFloat(tcs.paddingLeft) || 0) + (parseFloat(tcs.paddingRight) || 0);
    topbarMetrics = { w: window.innerWidth, avail: tb.clientWidth, fixed: fixed, unit: textW / scale };
  }





  function fitTopbarScale() {
    var root = document.documentElement;
    var want = clampStep(currentSettings.topbarScale, SLIDERS.topbarScale) / 100;
    root.style.removeProperty('--topbar-scale');
    topbarFitWidth = null;
    var tb = document.getElementById('home-topbar');
    if (!tb) return;
    if (tb.clientWidth > 0) {
      measureTopbar(tb, want);
      topbarFitWidth = window.innerWidth;
    }
    var m = topbarMetrics;
    if (!m || m.w !== window.innerWidth || !(m.unit > 0)) return;
    if (m.fixed + m.unit * want <= m.avail) return;
    var fit = Math.floor((m.avail - m.fixed) / m.unit * 20) / 20;
    if (fit < SLIDERS.topbarScale.min / 100) fit = SLIDERS.topbarScale.min / 100;
    if (fit < want) root.style.setProperty('--topbar-scale', String(fit));
  }







  function ensureTopbarFit() {
    if (topbarFitWidth === window.innerWidth) return;
    var tb = document.getElementById('home-topbar');
    if (!tb || !tb.clientWidth) return;
    fitTopbarScale();
    try {if (typeof window.invalidateHomeLayoutCache === 'function') window.invalidateHomeLayoutCache();} catch (e) {}
  }
  window.ensureTopbarFit = ensureTopbarFit;

  function applySettings() {
    var style = document.getElementById('ui-customizer-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'ui-customizer-style';
      document.head.appendChild(style);
    }
    style.textContent = buildSettingsCss();





    try {
      var fc = focusColor();
      document.documentElement.style.setProperty('--focus-color', fc);
      document.documentElement.style.setProperty('--focus-color-soft', rgba(fc, 0.35));
    } catch (e) {}



    try {
      document.documentElement.classList.toggle('topbar-icons', currentSettings.topbarStyle === 'icons');
      topbarFitWidth = null;
    } catch (e) {}
    try {fitTopbarScale();} catch (e) {}



    document.documentElement.style.removeProperty('--catalog-card-h');
    try {
      if (typeof window.measureCatalogCardHeight === 'function') {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(window.measureCatalogCardHeight);else
        setTimeout(window.measureCatalogCardHeight, 16);
      }
    } catch (e) {}

    try {if (typeof window.invalidateColumnsCache === 'function') window.invalidateColumnsCache();} catch (e) {}



    try {if (typeof window.invalidateHomeLayoutCache === 'function') window.invalidateHomeLayoutCache();} catch (e) {}




    try {if (window.HomeScreen && typeof HomeScreen.layout === 'function') HomeScreen.layout();} catch (e) {}



    try {if (typeof window.realignCatalogChunks === 'function') window.realignCatalogChunks();} catch (e) {}
    syncHeroTrailers();
    console.log('🎨 Настройки внешнего вида применены:', JSON.stringify(currentSettings));
  }






  var lastHeroTrailers = null;
  function syncHeroTrailers() {
    var on = currentSettings.heroTrailers !== false;
    if (on === lastHeroTrailers) return;
    lastHeroTrailers = on;
    try {
      if (!window.HomeScreen) return;



      var fn = on ? HomeScreen.rearmTrailer : HomeScreen.stopTrailer;
      if (typeof fn === 'function') fn();
    } catch (e) {}
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSettings));
    } catch (e) {
      console.error('UI Customizer: ошибка сохранения', e);
    }
  }



  function injectPanelStyles() {
    if (document.getElementById('ui-customizer-panel-style')) return;
    var s = document.createElement('style');
    s.id = 'ui-customizer-panel-style';
    s.textContent = [





    '.ui-customizer-overlay{position:fixed;top:0;left:0;right:0;bottom:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.8);}',
    '.ui-customizer-overlay.hidden{display:none;}',





    '.ui-customizer-panel{zoom:var(--settings-zoom,1.2);width:calc(92vw / var(--settings-zoom,1.2));max-width:760px;max-height:calc(88vh / var(--settings-zoom,1.2));display:flex;flex-direction:column;background:#0e0e12;border:1px solid rgba(255,255,255,0.08);border-radius:16px;box-shadow:0 24px 80px rgba(0,0,0,0.7);overflow:hidden;color:#e0e0e0;}',
    '.ui-customizer-header{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;padding:20px 24px 16px;border-bottom:1px solid rgba(255,255,255,0.06);}',
    '.ui-customizer-header h2{margin:0;font-size:24px;font-weight:700;color:#fff;}',
    '.ui-customizer-close{display:flex;align-items:center;justify-content:center;flex:0 0 auto;width:40px;height:40px;padding:0;background:rgba(255,255,255,0.12);color:#fff;border:0;border-radius:50%;font-size:15px;line-height:1;cursor:pointer;}',
    '.ui-customizer-close i{display:block;line-height:1;}',
    '.ui-customizer-close:hover{background:rgba(255,255,255,0.2);}',

    '.ui-customizer-content{flex:1 1 auto;min-height:0;padding:0 24px 12px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;}',
    '.ui-customizer-group{padding:0 0 16px;border-bottom:1px solid rgba(255,255,255,0.06);}',
    '.ui-customizer-group:last-child{border-bottom:none;}',

    '.ui-customizer-group h3{position:sticky;top:0;z-index:3;display:flex;align-items:baseline;justify-content:space-between;' +
    'margin:0 -24px 8px;padding:16px 24px 8px;font-size:17px;font-weight:700;color:#fff;background:#0e0e12;}',
    '.ui-customizer-hint{margin:0 0 10px;font-size:13px;line-height:1.4;color:#8a8a96;}',





    '.ui-customizer-options{display:flex;flex-wrap:wrap;margin:-4px;}',

    '.ui-option{background:rgba(255,255,255,0.06);color:#cfd4dc;border:1px solid rgba(255,255,255,0.1);border-radius:10px;margin:4px;padding:9px 18px;font-family:inherit;font-size:15px;cursor:pointer;transition:background .15s,color .15s;}',
    '.ui-option:hover{background:rgba(255,255,255,0.12);}',
    '.ui-option.active,.ui-option.active:hover{background:#fff;border-color:#fff;color:#000;font-weight:600;}',



    '.ui-customizer-options.ui-swatches{display:grid;grid-template-columns:repeat(5,auto);justify-content:start;}',
    '.ui-swatch{display:inline-flex;align-items:center;justify-content:center;padding:8px;}',

    '.ui-swatch-dot{flex:0 0 auto;width:24px;height:24px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.35);}',

    '.ui-slider{display:flex;align-items:center;padding:10px 8px;border-radius:10px;user-select:none;-webkit-user-select:none;touch-action:pan-y;}',
    '.ui-slider>*+*{margin-left:18px;}',
    '.ui-slider-track{position:relative;flex:1 1 auto;height:6px;background:rgba(255,255,255,0.14);border-radius:3px;cursor:pointer;}',
    '.ui-slider-fill{position:absolute;left:0;top:0;bottom:0;width:0;background:var(--focus-color,#ff8c00);border-radius:3px;}',
    '.ui-slider-thumb{position:absolute;top:50%;left:0;width:20px;height:20px;margin:-10px 0 0 -10px;background:#fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.5);}',
    '.ui-slider-val{flex:0 0 auto;min-width:104px;text-align:right;font-size:16px;font-weight:600;color:#fff;}',
    '.ui-slider.ui-focused .ui-slider-thumb{width:24px;height:24px;margin:-12px 0 0 -12px;}',




    '.ui-slider-ends{display:flex;justify-content:space-between;margin:0 130px 4px 8px;font-size:12px;color:#6c6c78;}',



    '.ui-checkbox{position:relative;display:flex;align-items:center;min-height:52px;margin:0;padding:10px 84px 10px 12px;box-sizing:border-box;color:#fff;font-size:16px;cursor:pointer;border-radius:10px;}',
    '.ui-checkbox:hover{background:rgba(255,255,255,0.03);}',
    '.ui-checkbox input{position:absolute;width:1px;height:1px;margin:0;opacity:0;pointer-events:none;}',
    '.ui-checkbox>span::before,.ui-checkbox>span::after{content:"";position:absolute;top:50%;}',
    '.ui-checkbox>span::before{right:12px;width:46px;height:26px;margin-top:-13px;border-radius:13px;background:#3a3a44;transition:background .2s ease;}',
    '.ui-checkbox>span::after{right:35px;width:20px;height:20px;margin-top:-10px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.4);transition:-webkit-transform .2s ease,transform .2s ease;}',
    '.ui-checkbox input:checked+span::before{background:var(--focus-color,#ff8c00);}',
    '.ui-checkbox input:checked+span::after{-webkit-transform:translateX(20px);transform:translateX(20px);}',
    '.ui-customizer-footer{flex:0 0 auto;display:flex;justify-content:space-between;padding:16px 24px 20px;border-top:1px solid rgba(255,255,255,0.06);}',
    '.ui-customizer-footer>*+*{margin-left:12px;}',

    '.ui-cust-btn{flex:1;padding:12px 26px;border-radius:8px;font-family:inherit;font-size:16px;font-weight:600;cursor:pointer;border:0;background:rgba(255,255,255,0.12);color:#fff;transition:background .15s;}',
    '.ui-cust-btn:hover{background:rgba(255,255,255,0.2);}',
    '.ui-cust-btn.primary{background:#fff;color:#000;}',
    '.ui-cust-btn.primary:hover{background:rgba(255,255,255,0.85);}',


    '.ui-customizer-panel .ui-focused{box-shadow:0 0 0 3px var(--focus-color,#ff8c00)!important;outline:none!important;}',

    '.ui-customizer-overlay .ui-customizer-panel .ui-checkbox.ui-focused,.ui-customizer-overlay .ui-customizer-panel .ui-slider.ui-focused,' +
    '#appearance-tab-content .ui-customizer-panel .ui-checkbox.ui-focused,#appearance-tab-content .ui-customizer-panel .ui-slider.ui-focused{background:rgba(255,255,255,0.06);box-shadow:inset 0 0 0 2px var(--focus-color,#ff8c00)!important;}',










    '#appearance-tab-content .ui-customizer-panel{zoom:1;width:auto;max-width:none;max-height:none;overflow:visible;box-shadow:none;}',
    '#appearance-tab-content .ui-customizer-content{overflow:visible;}',

    '#appearance-tab-content .ui-customizer-group h3{position:static;}',
    '#appearance-tab-content .ui-customizer-close,#appearance-tab-content #ui-apply-settings{display:none;}',
    '.ui-embed-hint{display:none;margin:4px 0 0;font-size:13px;color:#8a8a96;}',
    '#appearance-tab-content .ui-embed-hint{display:block;}'].

    join('\n');
    document.head.appendChild(s);
  }



  function optionRow(setting, options) {
    var html = '';
    for (var i = 0; i < options.length; i++) {
      html += '<button class="ui-option" data-setting="' + setting + '" data-value="' + options[i][0] + '">' + options[i][1] + '</button>';
    }
    return html;
  }


  function swatchRow() {
    var html = '';
    for (var i = 0; i < FOCUS_COLORS.length; i++) {
      var c = FOCUS_COLORS[i][0];

      html += '<button class="ui-option ui-swatch" data-setting="focusColor" data-value="' + c + '"' +
      ' title="' + FOCUS_COLORS[i][1] + '" aria-label="' + FOCUS_COLORS[i][1] + '">' +
      '<span class="ui-swatch-dot" style="background:' + c + '"></span>' +
      '</button>';
    }
    return html;
  }

  function sliderRow(setting, minLabel, maxLabel) {
    var cfg = SLIDERS[setting];
    return '<div class="ui-slider" data-setting="' + setting + '">' +
    '<div class="ui-slider-track">' +
    '<div class="ui-slider-fill"></div>' +
    '<div class="ui-slider-thumb"></div>' +
    '</div>' +
    '<div class="ui-slider-val">' + cfg.fmt(cfg.def) + '</div>' +
    '</div>' +
    '<div class="ui-slider-ends"><span>' + minLabel + '</span><span>' + maxLabel + '</span></div>';
  }

  function createCustomizerPanel() {
    if (document.getElementById('ui-customizer-overlay')) return;

    var overlay = document.createElement('div');
    overlay.id = 'ui-customizer-overlay';
    overlay.className = 'ui-customizer-overlay hidden';

    overlay.innerHTML =
    '<div class="ui-customizer-panel" id="ui-customizer-panel" role="dialog" aria-label="Настройка интерфейса">' +
    '<div class="ui-customizer-header">' +
    '<div><h2>Внешний вид</h2>' +
    '<div class="ui-embed-hint">Всплывающим окном — в любом разделе: жёлтая кнопка пульта или клавиша «C».</div></div>' +
    '<button class="ui-customizer-close" id="ui-close-customizer" title="Закрыть"><i class="fi fi-rr-cross"></i></button>' +
    '</div>' +
    '<div class="ui-customizer-content">' +
    '<div class="ui-customizer-group"><h3>Размер карточек и постеров</h3>' +
    '<div class="ui-customizer-hint">Один размер для сетки и для рядов-карусели. Максимум — 260 × 460.</div>' +
    sliderRow('cardSize', '120 × ' + posterHeight(SLIDERS.cardSize.min), CARD_MAX_W + ' × ' + CARD_MAX_H) +
    '</div>' +

    '<div class="ui-customizer-group"><h3>Масштаб детального просмотра</h3>' +
    '<div class="ui-customizer-hint">Шапка, описание, кнопки, актёры и список файлов на экране фильма.</div>' +
    sliderRow('detailScale', SLIDERS.detailScale.min + '%', SLIDERS.detailScale.max + '%') +
    '</div>' +

    '<div class="ui-customizer-group"><h3>Шапка</h3>' +
    '<div class="ui-customizer-hint">Размер шрифта верхней строки: TorrStream, разделы, лупа, «Настройки», часы и дата. Не влезет в экран — шапка уменьшится до того, что влезает.</div>' +
    sliderRow('topbarScale', SLIDERS.topbarScale.min + '%', SLIDERS.topbarScale.max + '%') +
    '</div>' +

    '<div class="ui-customizer-group"><h3>Вид шапки</h3>' +
    '<div class="ui-customizer-hint">Разделы подписями или иконками: главная — домик, настройки — шестерёнка. Иконки занимают меньше места.</div>' +
    '<div class="ui-customizer-options">' +
    optionRow('topbarStyle', [['text', 'Текст'], ['icons', 'Иконки']]) +
    '</div></div>' +

    '<div class="ui-customizer-group"><h3>Экран «Настройки»</h3>' +
    '<div class="ui-customizer-hint">Размер всего экрана настроек — разделы, подписи, поля, переключатели, кнопки — и этой панели.</div>' +
    sliderRow('settingsScale', SLIDERS.settingsScale.min + '%', SLIDERS.settingsScale.max + '%') +
    '</div>' +

    '<div class="ui-customizer-group"><h3>Текст описания</h3>' +
    '<div class="ui-customizer-hint">Размер шрифта описания на экране фильма. Кнопки, постеры и остальное не меняются.</div>' +
    sliderRow('detailTextScale', SLIDERS.detailTextScale.min + '%', SLIDERS.detailTextScale.max + '%') +
    '</div>' +

    '<div class="ui-customizer-group"><h3>Количество колонок</h3>' +
    '<div class="ui-customizer-hint">«Авто» — колонки считаются из размера карточки.</div>' +
    '<div class="ui-customizer-options">' +
    optionRow('catalogColumns', [['auto', 'Авто'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['7', '7'], ['8', '8']]) +
    '</div>' +
    '</div>' +

    '<div class="ui-customizer-group"><h3>Размер подписей карточки</h3>' +
    '<div class="ui-customizer-hint">Название под постером.</div>' +
    sliderRow('titleSize', SLIDERS.titleSize.min + ' px', SLIDERS.titleSize.max + ' px') +
    '<div class="ui-customizer-hint">Оценка на постере.</div>' +
    sliderRow('ratingSize', SLIDERS.ratingSize.min + ' px', SLIDERS.ratingSize.max + ' px') +
    '<div class="ui-customizer-hint">Тип: фильм или сериал.</div>' +
    sliderRow('typeSize', SLIDERS.typeSize.min + ' px', SLIDERS.typeSize.max + ' px') +
    '<div class="ui-customizer-hint">Год на постере.</div>' +
    sliderRow('yearSize', SLIDERS.yearSize.min + ' px', SLIDERS.yearSize.max + ' px') +
    '</div>' +

    '<div class="ui-customizer-group"><h3>Текст на баннере главной</h3>' +
    '<div class="ui-customizer-hint">Название, рейтинг с жанрами и описание. Кнопки и сам баннер не меняются.</div>' +
    sliderRow('heroTextScale', SLIDERS.heroTextScale.min + '%', SLIDERS.heroTextScale.max + '%') +
    '</div>' +

    '<div class="ui-customizer-group"><h3>Скругление углов</h3><div class="ui-customizer-options">' +
    optionRow('borderRadius', [['none', 'Без'], ['small', 'Малое'], ['medium', 'Среднее'], ['large', 'Большое']]) +
    '</div></div>' +

    '<div class="ui-customizer-group"><h3>Плотность интерфейса</h3><div class="ui-customizer-options">' +
    optionRow('density', [['compact', 'Компактный'], ['comfortable', 'Комфортный'], ['spacious', 'Просторный']]) +
    '</div></div>' +

    '<div class="ui-customizer-group"><h3>Анимации</h3><div class="ui-customizer-options">' +
    optionRow('animations', [['none', 'Отключить'], ['reduced', 'Быстрые'], ['normal', 'Обычные']]) +
    '</div></div>' +

    '<div class="ui-customizer-group"><h3>Анимация прокрутки рядов</h3>' +
    '<div class="ui-customizer-hint">Горизонтальное движение каруселей каталога и списков в карточке фильма. На слабых устройствах плавное движение может подтормаживать — выберите «Без анимации».</div>' +
    '<div class="ui-customizer-options">' +
    optionRow('scrollAnim', [['none', 'Без анимации'], ['fast', 'Быстрая'], ['smooth', 'Плавная']]) +
    '</div></div>' +

    '<div class="ui-customizer-group"><h3>Яркость постеров</h3><div class="ui-customizer-options">' +
    optionRow('posterBrightness', [['dim', 'Приглушённая'], ['normal', 'Обычная'], ['bright', 'Яркая']]) +
    '</div></div>' +

    '<div class="ui-customizer-group"><h3>Цвет фокуса</h3>' +
    '<div class="ui-customizer-hint">Цвет рамки вокруг выбранного элемента: карточки, кнопки, ряды, фильтры, плеер.</div>' +
    '<div class="ui-customizer-options ui-swatches">' + swatchRow() + '</div>' +
    '</div>' +

    '<div class="ui-customizer-group"><h3>Отображение элементов</h3>' +
    '<label class="ui-checkbox" data-check="showRatings"><input type="checkbox" id="ui-show-ratings"' + (currentSettings.showRatings ? ' checked' : '') + '><span>Показывать рейтинги</span></label>' +
    '<label class="ui-checkbox" data-check="showYear"><input type="checkbox" id="ui-show-year"' + (currentSettings.showYear ? ' checked' : '') + '><span>Показывать год</span></label>' +
    '</div>' +

    '<div class="ui-customizer-group"><h3>Трейлеры на главной</h3>' +
    '<div class="ui-customizer-hint">Постояв на карточке 5 секунд, баннер главной сам включает её трейлер вместо картинки. Выключите, если это мешает или тормозит на слабом устройстве.</div>' +
    '<label class="ui-checkbox" data-check="heroTrailers"><input type="checkbox" id="ui-hero-trailers"' + (currentSettings.heroTrailers ? ' checked' : '') + '><span>Автовоспроизведение трейлеров</span></label>' +
    '</div>' +
    '</div>' +
    '<div class="ui-customizer-footer">' +
    '<button class="ui-cust-btn" id="ui-reset-defaults">Сбросить</button>' +
    '<button class="ui-cust-btn primary" id="ui-apply-settings">Сохранить</button>' +
    '</div>' +
    '</div>';

    document.body.appendChild(overlay);

    updateActiveButtons();
    setupPanelListeners();
  }



  function sliderConfig(el) {
    return el && el.dataset ? SLIDERS[el.dataset.setting] : null;
  }

  function updateSliders() {
    var list = document.querySelectorAll('#ui-customizer-panel .ui-slider');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      var cfg = sliderConfig(el);
      if (!cfg) continue;

      var v = clampStep(currentSettings[el.dataset.setting], cfg);
      var pct = (v - cfg.min) / (cfg.max - cfg.min) * 100;

      var fill = el.querySelector('.ui-slider-fill');
      var thumb = el.querySelector('.ui-slider-thumb');
      var val = el.querySelector('.ui-slider-val');
      if (fill) fill.style.width = pct + '%';
      if (thumb) thumb.style.left = pct + '%';
      if (val) val.textContent = cfg.fmt(v);
    }
  }

  function setSliderValue(el, value) {
    var cfg = sliderConfig(el);
    if (!cfg) return;
    var v = clampStep(value, cfg);
    if (currentSettings[el.dataset.setting] === v) return;
    currentSettings[el.dataset.setting] = v;
    updateSliders();
    applySettings();
    autoSave();
  }






  function autoSave() {
    if (!isOpen()) saveSettings();
  }

  function nudgeSlider(el, direction) {
    var cfg = sliderConfig(el);
    if (!cfg) return;
    setSliderValue(el, clampStep(currentSettings[el.dataset.setting], cfg) + direction * cfg.step);
  }

  function valueFromPointer(el, clientX) {
    var cfg = sliderConfig(el);
    var track = el.querySelector('.ui-slider-track');
    if (!cfg || !track) return 0;
    var r = track.getBoundingClientRect();
    var t = r.width ? (clientX - r.left) / r.width : 0;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return cfg.min + t * (cfg.max - cfg.min);
  }

  function bindSlider(el) {
    el.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var self = this;
      setFocus(self, true);
      setSliderValue(self, valueFromPointer(self, e.clientX));

      var onMove = function (ev) {setSliderValue(self, valueFromPointer(self, ev.clientX));};
      var onUp = function () {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onUp, true);
      };
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onUp, true);
    });






    var touch = null;
    el.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) {touch = null;return;}
      touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, drag: false };
    }, { passive: true });

    el.addEventListener('touchmove', function (e) {
      if (!touch || e.touches.length !== 1) return;
      var p = e.touches[0];
      if (!touch.drag) {
        var dx = Math.abs(p.clientX - touch.x),dy = Math.abs(p.clientY - touch.y);
        if (dx < 6 && dy < 6) return;
        if (dy >= dx) {touch = null;return;}
        touch.drag = true;
        setFocus(el, true);
      }
      e.preventDefault();
      setSliderValue(el, valueFromPointer(el, p.clientX));
    }, { passive: false });

    el.addEventListener('touchend', function (e) {



      if (touch && touch.drag && e.cancelable) e.preventDefault();
      touch = null;
    });
    el.addEventListener('touchcancel', function () {touch = null;});
  }



  function updateActiveButtons() {
    var buttons = document.querySelectorAll('#ui-customizer-panel .ui-option');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      btn.classList.toggle('active', String(currentSettings[btn.dataset.setting]) === String(btn.dataset.value));
    }
    var r = document.getElementById('ui-show-ratings');
    var y = document.getElementById('ui-show-year');
    var t = document.getElementById('ui-hero-trailers');
    if (r) r.checked = !!currentSettings.showRatings;
    if (y) y.checked = !!currentSettings.showYear;
    if (t) t.checked = currentSettings.heroTrailers !== false;
    updateSliders();
  }

  function setupPanelListeners() {
    var overlay = document.getElementById('ui-customizer-overlay');
    var panel = document.getElementById('ui-customizer-panel');
    if (!overlay || !panel) return;


    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeCustomizer();
    });


    panel.addEventListener('click', function (e) {
      var opt = e.target.closest ? e.target.closest('.ui-option') : null;
      if (opt) {
        currentSettings[opt.dataset.setting] = opt.dataset.value;
        updateActiveButtons();
        applySettings();
        autoSave();
        setFocus(opt);
        return;
      }
    });


    var sliders = panel.querySelectorAll('.ui-slider');
    for (var i = 0; i < sliders.length; i++) bindSlider(sliders[i]);


    var ratings = document.getElementById('ui-show-ratings');
    if (ratings) ratings.addEventListener('change', function () {
      currentSettings.showRatings = this.checked;
      applySettings();
      autoSave();
    });
    var year = document.getElementById('ui-show-year');
    if (year) year.addEventListener('change', function () {
      currentSettings.showYear = this.checked;
      applySettings();
      autoSave();
    });
    var trailers = document.getElementById('ui-hero-trailers');
    if (trailers) trailers.addEventListener('change', function () {
      currentSettings.heroTrailers = this.checked;
      applySettings();
      autoSave();
    });


    var apply = document.getElementById('ui-apply-settings');
    if (apply) apply.addEventListener('click', function () {
      applySettings();
      saveSettings();
      closeCustomizer();
    });


    var reset = document.getElementById('ui-reset-defaults');
    if (reset) reset.addEventListener('click', function () {
      currentSettings = resolvedDefaults();
      updateActiveButtons();
      updateSliders();
      applySettings();
      autoSave();
    });


    var close = document.getElementById('ui-close-customizer');
    if (close) close.addEventListener('click', closeCustomizer);


    var focusables = panel.querySelectorAll('.ui-option,.ui-checkbox,.ui-slider,.ui-cust-btn,.ui-customizer-close');
    for (var j = 0; j < focusables.length; j++) {
      focusables[j].addEventListener('mouseenter', function () {setFocus(this, true);});
    }
  }



  var previousBodyOverflow = '';

  function isOpen() {
    var overlay = document.getElementById('ui-customizer-overlay');
    return !!(overlay && !overlay.classList.contains('hidden'));
  }









  var embeddedEngaged = false;

  function embedPanel() {
    var tab = document.getElementById('appearance-tab-content');
    var panel = document.getElementById('ui-customizer-panel');
    if (!tab || !panel || panel.parentNode === tab) return;
    tab.appendChild(panel);
    updateActiveButtons();
    updateSliders();
  }

  function tabVisible() {
    var tab = document.getElementById('appearance-tab-content');
    var cs = document.getElementById('config-screen');
    return !!(tab && cs && tab.style.display !== 'none' && cs.style.display !== 'none' && tab.offsetParent !== null);
  }


  function enterEmbedded() {
    embedPanel();
    if (!tabVisible()) return false;
    embeddedEngaged = true;


    var f = document.querySelector('.focused');
    if (f) f.classList.remove('focused');
    updateActiveButtons();
    updateSliders();
    var first = getFocusables('content')[0] || getFocusables()[0];
    setFocus(first, true);
    return true;
  }


  function exitEmbedded() {
    embeddedEngaged = false;
    if (focusedEl) focusedEl.classList.remove('ui-focused');
    focusedEl = null;
    var item = document.getElementById('appearance-tab');
    if (item && typeof window.focusEl === 'function') window.focusEl(item);
  }



  function isEmbeddedEngaged() {
    if (embeddedEngaged && !tabVisible()) {
      embeddedEngaged = false;
      if (focusedEl) focusedEl.classList.remove('ui-focused');
    }
    return embeddedEngaged;
  }

  function openCustomizer() {
    createCustomizerPanel();
    var overlay = document.getElementById('ui-customizer-overlay');
    if (!overlay) return;

    var panelEl = document.getElementById('ui-customizer-panel');
    if (panelEl && panelEl.parentNode !== overlay) overlay.appendChild(panelEl);
    if (embeddedEngaged) {
      embeddedEngaged = false;
      if (focusedEl) focusedEl.classList.remove('ui-focused');
    }
    updateActiveButtons();
    overlay.classList.remove('hidden');
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';


    updateSliders();


    var content = overlay.querySelector('.ui-customizer-content');
    if (content) content.scrollTop = 0;
    var first = overlay.querySelector('.ui-slider,.ui-option');
    setFocus(first || document.getElementById('ui-close-customizer'), true);
  }

  function closeCustomizer() {
    var overlay = document.getElementById('ui-customizer-overlay');
    if (overlay) overlay.classList.add('hidden');
    document.body.style.overflow = previousBodyOverflow;

    if (focusedEl) focusedEl.classList.remove('ui-focused');
    focusedEl = null;
    embedPanel();










    try {
      var keep = document.querySelector('.focused');
      if (keep && keep.offsetParent !== null) return;

      var scr = window.AppState && AppState.currentScreen || null;
      if (scr && window.ScreenStrategies && ScreenStrategies[scr] &&
      typeof ScreenStrategies[scr].ensureFocus === 'function') {
        ScreenStrategies[scr].ensureFocus(true);
      } else if (typeof window.ensureCatalogFocus === 'function' && scr === 'catalog') {
        window.ensureCatalogFocus(true);
      }
    } catch (e) {}
  }



  var focusedEl = null;
  var FOCUS_SELECTOR = '.ui-option,.ui-checkbox,.ui-slider,.ui-cust-btn,.ui-customizer-close';



  var AREA_SELECTOR = {
    header: '.ui-customizer-header',
    content: '.ui-customizer-content',
    footer: '.ui-customizer-footer'
  };
  var AREAS = ['header', 'content', 'footer'];


  function getFocusables(area) {
    var panel = document.getElementById('ui-customizer-panel');
    if (!panel) return [];
    var root = area ? panel.querySelector(AREA_SELECTOR[area]) : panel;
    if (!root) return [];
    var list = root.querySelectorAll(FOCUS_SELECTOR);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].offsetParent !== null) out.push(list[i]);
    }
    return out;
  }

  function areaOf(el) {
    if (!el || !el.closest) return null;
    for (var i = 0; i < AREAS.length; i++) {
      if (el.closest(AREA_SELECTOR[AREAS[i]])) return AREAS[i];
    }
    return null;
  }


  function focusEdgeOf(area, last) {
    var items = getFocusables(area);
    if (!items.length) return false;
    setFocus(items[last ? items.length - 1 : 0]);
    return true;
  }



  function scrollFocusIntoView(el) {
    if (!el) return;











    if (el.closest && el.closest('#appearance-tab-content')) {

      var screen = typeof window.getConfigScroller === 'function' ?
      window.getConfigScroller() :
      document.getElementById('config-screen');
      if (!screen) return;
      var grp = el.closest('.ui-customizer-group');
      var target = el;
      if (grp) {
        var items = grp.querySelectorAll(FOCUS_SELECTOR);
        var eTop = el.getBoundingClientRect().top;
        var first = true;
        for (var k = 0; k < items.length; k++) {
          if (items[k] !== el && items[k].getBoundingClientRect().bottom <= eTop + 1) {first = false;break;}
        }
        if (first) target = grp;
      }
      var sRect = screen.getBoundingClientRect();
      var scale = screen.clientHeight ? sRect.height / screen.clientHeight : 1;
      if (!(scale > 0)) scale = 1;
      var pad = 12 * scale;
      var viewTop = sRect.top + pad,viewBottom = sRect.top + sRect.height - pad;
      var tRect = target.getBoundingClientRect();
      var d = 0;
      if (tRect.top < viewTop || tRect.height > viewBottom - viewTop) d = tRect.top - viewTop;else
      if (tRect.bottom > viewBottom) d = tRect.bottom - viewBottom;
      if (!d) return;
      var maxTop = Math.max(0, screen.scrollHeight - screen.clientHeight);
      var to = Math.max(0, Math.min(maxTop, screen.scrollTop + d / scale));
      if (window.Animations && typeof Animations.tweenScroll === 'function') {
        Animations.tweenScroll(screen, { scrollTop: to }, { duration: 0.2 });
      } else {
        screen.scrollTop = to;
      }
      return;
    }

    var content = document.querySelector('#ui-customizer-panel .ui-customizer-content');
    if (!content || !content.contains(el)) return;

    var PAD = 10;
    var eRect = el.getBoundingClientRect();
    var cRect = content.getBoundingClientRect();
    var group = el.closest ? el.closest('.ui-customizer-group') : null;


    var head = group ? group.querySelector('h3') : null;
    var headH = head ? head.offsetHeight : 0;

    var desiredTop = eRect.top;
    var topInset = headH;

    if (group) {

      var sibs = group.querySelectorAll(FOCUS_SELECTOR);
      var firstRow = true;
      for (var i = 0; i < sibs.length; i++) {
        if (sibs[i] === el) continue;
        if (sibs[i].getBoundingClientRect().bottom <= eRect.top + 1) {firstRow = false;break;}
      }
      if (firstRow) {

        desiredTop = group.getBoundingClientRect().top;
        topInset = 0;
      }
    }

    var above = cRect.top + topInset + PAD - desiredTop;
    if (above > 0) {content.scrollTop -= above;return;}

    var below = eRect.bottom + PAD - cRect.bottom;
    if (below > 0) content.scrollTop += below;
  }

  function setFocus(el, skipScroll) {
    if (!el) return;
    if (focusedEl && focusedEl !== el) focusedEl.classList.remove('ui-focused');
    focusedEl = el;
    el.classList.add('ui-focused');
    if (!skipScroll) scrollFocusIntoView(el);
  }


  function gapBetween(aStart, aEnd, bStart, bEnd) {
    if (bEnd <= aStart) return aStart - bEnd;
    if (bStart >= aEnd) return bStart - aEnd;
    return 0;
  }





  function moveWithin(items, dir) {
    var a = focusedEl.getBoundingClientRect();
    var aCx = a.left + a.width / 2,aCy = a.top + a.height / 2;
    var best = null,bestScore = Infinity;

    for (var i = 0; i < items.length; i++) {
      if (items[i] === focusedEl) continue;
      var b = items[i].getBoundingClientRect();
      var bCx = b.left + b.width / 2,bCy = b.top + b.height / 2;
      var primary, cross, weight;

      if (dir === 'left') {
        if (bCx >= aCx - 1) continue;
        primary = Math.max(0, a.left - b.right);
        cross = gapBetween(a.top, a.bottom, b.top, b.bottom);
        weight = 3;
      } else if (dir === 'right') {
        if (bCx <= aCx + 1) continue;
        primary = Math.max(0, b.left - a.right);
        cross = gapBetween(a.top, a.bottom, b.top, b.bottom);
        weight = 3;
      } else if (dir === 'up') {
        if (bCy >= aCy - 1) continue;
        primary = Math.max(0, a.top - b.bottom);
        cross = gapBetween(a.left, a.right, b.left, b.right);
        weight = 2;
      } else if (dir === 'down') {
        if (bCy <= aCy + 1) continue;
        primary = Math.max(0, b.top - a.bottom);
        cross = gapBetween(a.left, a.right, b.left, b.right);
        weight = 2;
      } else continue;

      var score = primary + cross * weight;
      if (score < bestScore) {bestScore = score;best = items[i];}
    }

    if (!best) return false;
    setFocus(best);
    return true;
  }








  function moveFocus(dir) {
    var all = getFocusables();
    if (!all.length) return false;
    if (!focusedEl || all.indexOf(focusedEl) === -1) {setFocus(all[0]);return true;}

    var area = areaOf(focusedEl) || 'content';

    if (area === 'header') {
      if (dir === 'up') return false;
      if (dir === 'down') {
        return focusEdgeOf('content', false) || focusEdgeOf('footer', false);
      }
      return moveWithin(getFocusables('header'), dir);
    }

    if (area === 'footer') {
      if (dir === 'down') return false;
      if (dir === 'up') {
        return focusEdgeOf('content', true) || focusEdgeOf('header', false);
      }
      return moveWithin(getFocusables('footer'), dir);
    }





    if (dir === 'left' || dir === 'right') {
      var row = focusedEl.closest('.ui-customizer-options');
      if (!row) return false;
      var opts = [];
      var list = row.querySelectorAll(FOCUS_SELECTOR);
      for (var i = 0; i < list.length; i++) {
        if (list[i].offsetParent !== null) opts.push(list[i]);
      }
      var next = opts[opts.indexOf(focusedEl) + (dir === 'right' ? 1 : -1)];
      if (!next) return false;
      setFocus(next);
      return true;
    }
    if (moveWithin(getFocusables('content'), dir)) return true;
    if (dir === 'up') return focusEdgeOf('header', false);
    if (dir === 'down') return focusEdgeOf('footer', false);
    return false;
  }

  function activateFocused() {
    if (!focusedEl) return;
    if (focusedEl.classList.contains('ui-slider')) return;
    if (focusedEl.classList.contains('ui-checkbox')) {
      var input = focusedEl.querySelector('input[type="checkbox"]');
      if (input) {
        input.checked = !input.checked;
        var ev;
        try {ev = new Event('change', { bubbles: true });}
        catch (e) {ev = document.createEvent('Event');ev.initEvent('change', true, true);}
        input.dispatchEvent(ev);
      }
      return;
    }
    focusedEl.click();
  }




















  var ARROW = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
  var BACK_KEYS = [4, 8, 27, 461, 111, 10009, 10014];
  var OK_KEYS = [13, 23, 10013, 10020];
  var OPEN_KEYS = [405, 67];
  var OPEN_SCREENS = ['home', 'catalog', 'torrents', 'search', 'detail', 'config'];

  function keyIs(name, kc, fallback) {
    if (typeof isKeyPressed === 'function' && isKeyPressed(name, kc)) return true;
    return fallback.indexOf(kc) !== -1;
  }

  function isBackKeyCode(kc) {return keyIs('BACK', kc, BACK_KEYS);}
  function isOkKeyCode(kc) {return keyIs('OK', kc, OK_KEYS);}









  function arrowDirCode(kc) {
    if (ARROW[kc]) return ARROW[kc];
    if (typeof isKeyPressed !== 'function') return null;
    if (isKeyPressed('UP', kc)) return 'up';
    if (isKeyPressed('DOWN', kc)) return 'down';
    if (isKeyPressed('LEFT', kc)) return 'left';
    if (isKeyPressed('RIGHT', kc)) return 'right';
    return null;
  }

  function isEditing() {
    var a = document.activeElement;
    return !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') && !a.closest('#ui-customizer-panel'));
  }

  function currentAppScreen() {
    return window.AppState && AppState.currentScreen ? AppState.currentScreen : null;
  }

  window.addEventListener('keydown', function (e) {
    var kc = e.keyCode;


    if (isOpen()) {

      if (isBackKeyCode(kc)) {
        e.preventDefault();e.stopImmediatePropagation();
        closeCustomizer();
        return;
      }
      if (isOkKeyCode(kc)) {
        e.preventDefault();e.stopImmediatePropagation();
        activateFocused();
        return;
      }
      var dir = arrowDirCode(kc);
      if (dir) {
        e.preventDefault();e.stopImmediatePropagation();

        if (focusedEl && focusedEl.classList.contains('ui-slider') && (dir === 'left' || dir === 'right')) {
          nudgeSlider(focusedEl, dir === 'right' ? 1 : -1);
        } else {
          moveFocus(dir);
        }
        return;
      }
      return;
    }


    if (isEmbeddedEngaged() && OPEN_KEYS.indexOf(kc) === -1) {
      if (isBackKeyCode(kc)) {
        e.preventDefault();e.stopImmediatePropagation();
        exitEmbedded();
        return;
      }
      if (isOkKeyCode(kc)) {
        e.preventDefault();e.stopImmediatePropagation();
        activateFocused();
        return;
      }
      var edir = arrowDirCode(kc);
      if (edir) {
        e.preventDefault();e.stopImmediatePropagation();
        if (focusedEl && focusedEl.classList.contains('ui-slider') && (edir === 'left' || edir === 'right')) {
          nudgeSlider(focusedEl, edir === 'right' ? 1 : -1);
        } else {


          moveFocus(edir);
        }
        return;
      }
      return;
    }


    if (OPEN_KEYS.indexOf(kc) !== -1 && !isEditing()) {
      var scr = currentAppScreen();
      if (scr === null || OPEN_SCREENS.indexOf(scr) !== -1) {
        e.preventDefault();e.stopImmediatePropagation();
        openCustomizer();
      }
    }
  }, true);



  function init() {
    applySettings();
    injectPanelStyles();
    createCustomizerPanel();
    embedPanel();
    console.log('✅ UI Customizer инициализирован');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }


  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resizeTimer = null;
      applySettings();
      if (isOpen() || tabVisible()) updateSliders();
    }, 150);
  });



  window.UICustomizer = {
    open: openCustomizer,
    close: closeCustomizer,
    apply: applySettings,
    isOpen: isOpen,
    getColumns: getColumns,
    getCardSize: function () {var w = cardWidth();return { width: w, height: posterHeight(w) };},
    getFocusColor: focusColor,
    getScrollAnim: scrollAnim,
    getHeroTrailers: function () {return currentSettings.heroTrailers !== false;},
    enterEmbedded: enterEmbedded,
    get: function () {return Object.assign({}, currentSettings);},
    set: function (partial) {
      if (partial && typeof partial === 'object') {
        currentSettings = normalizeSettings(Object.assign({}, currentSettings, partial));
        applySettings();
        saveSettings();
        updateActiveButtons();
      }
    },
    reset: function () {
      currentSettings = resolvedDefaults();
      applySettings();
      saveSettings();
      updateActiveButtons();
    }
  };

})();
