/*
 * Сборка msx/js-legacy/ для старых браузеров (webOS 4 — Chrome 53).
 *
 * Chrome 53 не разбирает async/await, ?., ??, { ...obj }, catch без
 * параметра и прочий синтаксис новее ES2016 — модуль с ним не грузится
 * целиком. index.html таким браузерам (LEGACY_JS) подменяет msx/js/ на
 * msx/js-legacy/, куда эта сборка кладёт те же модули, пропущенные через
 * Babel (preset-env, chrome 53), и legacy-polyfills.js из polyfills.js.
 *
 *   npm install && npm run build   — пересобрать js-legacy/
 *   npm run check                  — js-legacy/ совпадает с js/ и всё
 *                                    разбирается как ES2016 (код выхода 1, если нет)
 *
 * После любых правок в msx/js/ — пересобрать, иначе на webOS 4 будет старый код.
 *
 * Заодно сборка пишет в index.html карту ASSET_V — хеши css/ и js/ для ?v=
 * (см. assetV там же). Поэтому пересобирать и после правок в msx/css/:
 * иначе телевизоры до 10 минут (max-age у GitHub Pages) берут старый файл
 * из кэша. --check проверяет и карту, и то, что каждый assetV('…') в
 * index.html назван тем же путём, что стоит в адресе рядом.
 *
 * Воркеры (*-worker.js) не собираются: их запускают из js/ (bridge-модули),
 * они и так на ES5 и сами подтягивают legacy-polyfills.js через importScripts.
 * --check проверяет, что так и осталось.
 */
'use strict';

var fs = require('fs');
var crypto = require('crypto');
var path = require('path');
var babel = require('@babel/core');
var acorn = require('acorn');

var ROOT = path.resolve(__dirname, '../..');
var SRC = path.join(ROOT, 'msx/js');
var OUT = path.join(ROOT, 'msx/js-legacy');
var INDEX = path.join(ROOT, 'msx/index.html');
var POLYFILLS = path.join(__dirname, 'polyfills.js');
var MSX = path.join(ROOT, 'msx');

var CHECK = process.argv.indexOf('--check') !== -1;

function isWorker(name) {
  return /-worker\.js$/.test(name);
}

function header(from) {
  return '/* Сборка для старых браузеров (Chrome 53) из ' + from +
    ' — tools/legacy-build/build.js. Руками не править. */\n';
}

function transpile(file) {
  var code = fs.readFileSync(file, 'utf8');
  var out = babel.transformSync(code, {
    filename: file,
    babelrc: false,
    configFile: false,
    sourceType: 'script',
    comments: false,
    presets: [[require.resolve('@babel/preset-env'), {
      targets: { chrome: '53' },
      modules: false,
      bugfixes: true
    }]]
  });
  return out.code + '\n';
}

// Chrome 53 — это ES2016 без async. Ошибка разбора = модуль не загрузится
function parseError(code, ecmaVersion) {
  try {
    acorn.parse(code, { ecmaVersion: ecmaVersion, sourceType: 'script' });
    return null;
  } catch (e) {
    return e.message;
  }
}

// Встроенные <script> в index.html выполняются и в Chrome 53 — без сборки
function inlineScripts(html) {
  var re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi, m, list = [];
  while ((m = re.exec(html))) {
    if (/\bsrc\s*=/.test(m[1]) || /type\s*=\s*["'](?!text\/javascript)/i.test(m[1])) continue;
    list.push({ line: html.slice(0, m.index).split('\n').length, code: m[2] });
  }
  return list;
}

var expected = {};
fs.readdirSync(SRC).filter(function (n) { return /\.js$/.test(n) && !isWorker(n); }).sort()
  .forEach(function (name) {
    expected[name] = header('js/' + name) + transpile(path.join(SRC, name));
  });
expected['legacy-polyfills.js'] = header('tools/legacy-build/polyfills.js') + fs.readFileSync(POLYFILLS, 'utf8');

var problems = [];

// ── Карта ASSET_V для index.html ─────────────────────────────────────────
// Хеш js/X.js — по нему и по собранному js-legacy/X.js вместе: старые
// браузеры грузят js-legacy/X.js с тем же ?v=, и ему тоже нужен новый адрес,
// когда меняется только сборка (версия Babel, polyfills.js).
function hash(text) {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 8);
}

var assetMap = {};
fs.readdirSync(path.join(MSX, 'css')).filter(function (n) { return /\.css$/.test(n); })
  .forEach(function (name) {
    assetMap['css/' + name] = hash(fs.readFileSync(path.join(MSX, 'css', name)));
  });
fs.readdirSync(SRC).filter(function (n) { return /\.js$/.test(n); }).forEach(function (name) {
  assetMap['js/' + name] = hash(fs.readFileSync(path.join(SRC, name), 'utf8') + (expected[name] || ''));
});
assetMap['js-legacy/legacy-polyfills.js'] = hash(expected['legacy-polyfills.js']);

var ASSET_RE = /([ \t]*)\/\/ ASSET_V:begin\r?\n[\s\S]*?([ \t]*)\/\/ ASSET_V:end/;
var html = fs.readFileSync(INDEX, 'utf8');
var block = ASSET_RE.exec(html);
if (!block) {
  problems.push('index.html: нет маркеров // ASSET_V:begin … // ASSET_V:end');
} else {
  var keys = Object.keys(assetMap).sort();
  var eol = /\r\n/.test(html) ? '\r\n' : '\n'; // index.html — в CRLF, не перекрашивать
  var newHtml = html.replace(ASSET_RE, function (m, indent, endIndent) {
    return indent + '// ASSET_V:begin' + eol + keys.map(function (k, i) {
      return indent + JSON.stringify(k) + ': ' + JSON.stringify(assetMap[k]) + (i < keys.length - 1 ? ',' : '') + eol;
    }).join('') + endIndent + '// ASSET_V:end';
  });
  if (newHtml !== html) {
    if (CHECK) problems.push('index.html: карта ASSET_V устарела');
    else fs.writeFileSync(INDEX, html = newHtml);
  }
}

// assetV('путь') должен совпадать с адресом в той же строке: опечатка не
// ломает загрузку (assetV вернёт Date.now()), но молча возвращает старое
// поведение для этого файла
html.split('\n').forEach(function (line, i) {
  var re = /assetV\('([^']+)'\)/g, m;
  while ((m = re.exec(line))) {
    if (!assetMap[m[1]]) problems.push('index.html:' + (i + 1) + ': assetV(\'' + m[1] + '\') — нет такого файла');
    else if (line.indexOf('/msx/' + m[1] + '?v=') === -1) problems.push('index.html:' + (i + 1) + ': assetV(\'' + m[1] + '\') не совпадает с адресом в строке');
  }
});

Object.keys(expected).forEach(function (name) {
  var err = parseError(expected[name], name === 'legacy-polyfills.js' ? 5 : 2016);
  if (err) problems.push('js-legacy/' + name + ': ' + err);
});
fs.readdirSync(SRC).filter(isWorker).forEach(function (name) {
  var err = parseError(fs.readFileSync(path.join(SRC, name), 'utf8'), 2016);
  if (err) problems.push('js/' + name + ' (воркер, не собирается): ' + err);
});
inlineScripts(fs.readFileSync(INDEX, 'utf8')).forEach(function (s) {
  var err = parseError(s.code, 2016);
  if (err) problems.push('index.html, <script> на строке ' + s.line + ': ' + err);
});

if (CHECK) {
  var existing = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter(function (n) { return /\.js$/.test(n); }) : [];
  Object.keys(expected).forEach(function (name) {
    var file = path.join(OUT, name);
    if (!fs.existsSync(file)) problems.push('js-legacy/' + name + ': нет файла');
    else if (fs.readFileSync(file, 'utf8') !== expected[name]) problems.push('js-legacy/' + name + ': устарел');
  });
  existing.forEach(function (name) {
    if (!expected[name]) problems.push('js-legacy/' + name + ': лишний (нет в js/)');
  });
} else {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);
  fs.readdirSync(OUT).forEach(function (name) {
    if (/\.js$/.test(name) && !expected[name]) fs.unlinkSync(path.join(OUT, name));
  });
  Object.keys(expected).forEach(function (name) {
    fs.writeFileSync(path.join(OUT, name), expected[name]);
  });
  console.log('js-legacy/: ' + Object.keys(expected).length + ' файлов, index.html: ASSET_V — ' +
    Object.keys(assetMap).length + ' хешей');
}

if (problems.length) {
  console.error(problems.join('\n'));
  if (!CHECK) console.error('Без пересборки не обойтись: поправьте источник (см. выше)');
  process.exit(1);
}
if (CHECK) console.log('js-legacy/ и ASSET_V в порядке');
