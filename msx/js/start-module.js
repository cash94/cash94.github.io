var VERSION = Date.now();

document.write('<script src="https://raw.githubusercontent.com/cash94/cash94.github.io/refs/heads/main/msx/js/config.js?v=' + VERSION + '"><\/script>');
document.write('<script src="https://raw.githubusercontent.com/cash94/cash94.github.io/refs/heads/main/msx/js/tmdb.js?v=' + VERSION + '"><\/script>');
document.write('<script src="https://raw.githubusercontent.com/cash94/cash94.github.io/refs/heads/main/msx/js/torrents.js?v=' + VERSION + '"><\/script>');
document.write('<script src="https://raw.githubusercontent.com/cash94/cash94.github.io/refs/heads/main/msx/js/torrents-worker-bridge.js?v=' + VERSION + '"><\/script>');
document.write('<script src="https://raw.githubusercontent.com/cash94/cash94.github.io/refs/heads/main/msx/js/torrents-worker-patch.js?v=' + VERSION + '"><\/script>');
document.write('<script src="https://raw.githubusercontent.com/cash94/cash94.github.io/refs/heads/main/msx/js/poster-db.js?v=' + VERSION + '"><\/script>');
document.write('<script src="https://raw.githubusercontent.com/cash94/cash94.github.io/refs/heads/main/msx/js/catalog.js?v=' + VERSION + '"><\/script>');
document.write('<script src="https://raw.githubusercontent.com/cash94/cash94.github.io/refs/heads/main/msx/js/catalog-worker-bridge.js?v=' + VERSION + '"><\/script>');
document.write('<script src="https://raw.githubusercontent.com/cash94/cash94.github.io/refs/heads/main/msx/js/catalog-worker-patch.js?v=' + VERSION + '"><\/script>');
document.write('<script src="https://raw.githubusercontent.com/cash94/cash94.github.io/refs/heads/main/msx/js/catalog-worker-posters-patch.js?v=' + VERSION + '"><\/script>');
document.write('<script src="https://raw.githubusercontent.com/cash94/cash94.github.io/refs/heads/main/msx/js/catalog-worker-posters-batch-patch.js?v=' + VERSION + '"><\/script>');
document.write('<script src="https://raw.githubusercontent.com/cash94/cash94.github.io/refs/heads/main/msx/js/player.js?v=' + VERSION + '"><\/script>');
document.write('<script src="https://raw.githubusercontent.com/cash94/cash94.github.io/refs/heads/main/msx/js/control.js?v=' + VERSION + '"><\/script>');
document.write('<script src="https://raw.githubusercontent.com/cash94/cash94.github.io/refs/heads/main/msx/js/donate.js?v=' + VERSION + '"><\/script>');
document.write('<script src="https://raw.githubusercontent.com/cash94/cash94.github.io/refs/heads/main/msx/js/torrserverstats.js?v=' + VERSION + '"><\/script>');
document.write('<script src="https://raw.githubusercontent.com/cash94/cash94.github.io/refs/heads/main/msx/js/speedtest.js?v=' + VERSION + '"><\/script>');
document.write('<script src="https://raw.githubusercontent.com/cash94/cash94.github.io/refs/heads/main/msx/js/sync.js?v=' + VERSION + '"><\/script>');
document.write('<script src="https://raw.githubusercontent.com/cash94/cash94.github.io/refs/heads/main/msx/js/animations.js?v=' + VERSION + '"><\/script>');
document.write('<script src="https://raw.githubusercontent.com/cash94/cash94.github.io/refs/heads/main/msx/js/app.js?v=' + VERSION + '"><\/script>');

// Скрываем загрузчик после инициализации
document.write('<script>');
document.write('  window.addEventListener("load", function() {');
document.write('    setTimeout(function() {');
document.write('      var loader = document.getElementById("module-loader");');
document.write('      if (loader) {');
document.write('        loader.style.opacity = "0";');
document.write('        setTimeout(function() {');
document.write('          if (loader) loader.style.display = "none";');
document.write('        }, 500);');
document.write('      }');
document.write('    }, 1000);');
document.write('  });');
document.write('<\/script>');