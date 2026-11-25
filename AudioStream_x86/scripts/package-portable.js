/**
 * Package AudioStream Sender as portable Windows directory.
 * No asar — raw files in resources/app/ for maximum compatibility.
 * Run: node scripts/package-portable.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist-electron', 'AudioStream-Sender-Portable');

// Runtime-only npm deps to include (everything minus dev tools)
const DEV_SKIP = new Set([
  'electron', 'typescript', 'electron-builder', '7zip-bin',
  'app-builder-bin', 'app-builder-lib', 'builder-util', 'builder-util-runtime',
  'dmg-builder', 'read-config-file', 'lazy-val', 'temp-file',
  '@electron', 'config-file-ts', 'dotenv', 'dotenv-expand',
]);

function mkdir(d) { fs.mkdirSync(d, { recursive: true }); }

function copy(src, dst) {
  if (!fs.existsSync(src)) return;
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    mkdir(dst);
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      copy(path.join(src, entry.name), path.join(dst, entry.name));
    }
  } else {
    mkdir(path.dirname(dst));
    fs.copyFileSync(src, dst);
    process.stdout.write('.');
  }
}

function size(dir) {
  let s = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    s += e.isDirectory() ? size(p) : fs.statSync(p).size;
  }
  return s;
}

// ── Main ──
console.log('=== AudioStream Sender — Package Portable ===\n');

// Clean
if (fs.existsSync(DIST)) {
  console.log('[1/4] Cleaning old build...');
  fs.rmSync(DIST, { recursive: true, force: true });
}

const APP = path.join(DIST, 'resources', 'app');

// 1. Copy Electron runtime
console.log('[1/4] Copy Electron runtime...');
const ES = path.join(ROOT, 'node_modules', 'electron', 'dist');
const RUNTIME = [
  'icudtl.dat', 'resources.pak', 'snapshot_blob.bin', 'v8_context_snapshot.bin',
  'vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll',
  'ffmpeg.dll', 'd3dcompiler_47.dll', 'libEGL.dll', 'libGLESv2.dll',
  'chrome_100_percent.pak', 'chrome_200_percent.pak', 'locales',
];
for (const f of RUNTIME) copy(path.join(ES, f), path.join(DIST, f));
copy(path.join(ES, 'electron.exe'), path.join(DIST, 'AudioStream Sender.exe'));
copy(path.join(ES, 'LICENSE'), path.join(DIST, 'LICENSE.electron.txt'));
copy(path.join(ES, 'LICENSES.chromium.html'), path.join(DIST, 'LICENSES.chromium.html'));
console.log(' done');

// 2. Copy app source
console.log('[2/4] Copy app source (resources/app/)...');
copy(path.join(ROOT, 'build'), path.join(APP, 'build'));
copy(path.join(ROOT, 'assets'), path.join(APP, 'assets'));
copy(path.join(ROOT, 'public'), path.join(APP, 'public'));
copy(path.join(ROOT, 'package.json'), path.join(APP, 'package.json'));
console.log(' done');

// 3. Copy node_modules (runtime only)
console.log('[3/4] Copy node_modules (runtime only)...');
const NMSRC = path.join(ROOT, 'node_modules');
const NMDST = path.join(APP, 'node_modules');
let nmCount = 0;
for (const entry of fs.readdirSync(NMSRC, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    copy(path.join(NMSRC, entry.name), path.join(NMDST, entry.name));
    continue;
  }
  if (DEV_SKIP.has(entry.name)) continue;
  if (entry.name.startsWith('@')) {
    if (entry.name === '@electron') continue;
    // Copy scoped dir but skip dev packages within
    mkdir(path.join(NMDST, entry.name));
    for (const sub of fs.readdirSync(path.join(NMSRC, entry.name), { withFileTypes: true })) {
      if (DEV_SKIP.has(entry.name + '/' + sub.name)) continue;
      copy(path.join(NMSRC, entry.name, sub.name), path.join(NMDST, entry.name, sub.name));
    }
    nmCount++;
  } else {
    copy(path.join(NMSRC, entry.name), path.join(NMDST, entry.name));
    nmCount++;
  }
  process.stdout.write(' ' + entry.name);
}
console.log('\n  ' + nmCount + ' packages copied');

// 4. Done
console.log('[4/4] Done!\n');
const totalMB = (size(DIST) / 1024 / 1024).toFixed(0);
console.log('  Output: ' + DIST);
console.log('  Total size: ' + totalMB + ' MB');
console.log('');
console.log('  Copy "AudioStream-Sender-Portable" folder to any Windows PC.');
console.log('  Double-click "AudioStream Sender.exe" to run.');
console.log('');
