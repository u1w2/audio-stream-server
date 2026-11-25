const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcRenderer = path.join(root, 'src', 'renderer');
const srcPublic = path.join(root, 'public');
const destDir = path.join(root, 'build');
const destRenderer = path.join(destDir, 'renderer');
const destPublic = path.join(destDir, 'public');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyFiles(srcDir, destDir, filter = null) {
  ensureDir(destDir);
  const files = fs.readdirSync(srcDir).filter((file) => {
    if (filter == null) return true;
    return filter.test(file);
  });
  files.forEach((file) => {
    const src = path.join(srcDir, file);
    const dest = path.join(destDir, file);
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      copyFiles(src, dest, filter);
    } else {
      fs.copyFileSync(src, dest);
      console.log(`Copied ${src} -> ${dest}`);
    }
  });
}

ensureDir(destDir);
copyFiles(srcRenderer, destRenderer, /\.html$/);
if (fs.existsSync(srcPublic)) {
  copyFiles(srcPublic, destPublic);
}

console.log('Assets copied.');
