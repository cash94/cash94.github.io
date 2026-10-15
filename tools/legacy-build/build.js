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
 * Воркеры (*-worker.js) не собираются: их запускают из js/ (bridge-модули),
 * они и так на ES5 и сами подтягивают legacy-polyfills.js через importScripts.
 * --check проверяет, что так и осталось.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var babel = require('@babel/core');
var acorn = require('acorn');

var ROOT = path.resolve(__dirname, '../..');
var SRC = path.join(ROOT, 'msx/js');
var OUT = path.join(ROOT, 'msx/js-legacy');
var INDEX = path.join(ROOT, 'msx/index.html');
var POLYFILLS = path.join(__dirname, 'polyfills.js');

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
  console.log('js-legacy/: ' + Object.keys(expected).length + ' файлов');
}

if (problems.length) {
  console.error(problems.join('\n'));
  if (!CHECK) console.error('Без пересборки не обойтись: поправьте источник (см. выше)');
  process.exit(1);
}
if (CHECK) console.log('js-legacy/ в порядке');
