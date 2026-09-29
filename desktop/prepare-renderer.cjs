const fs = require('fs');
const path = require('path');

// AURA renderer sync: copy the canonical UTF-8 sources without decoding/re-encoding.
const root = path.resolve(__dirname, '..');
const renderer = path.join(__dirname, 'renderer');
fs.mkdirSync(renderer, { recursive: true });
for (const name of ['index.html', 'local-ai.js']) {
  const source = path.join(root, name);
  const target = path.join(renderer, name);
  if (!fs.existsSync(source)) throw new Error('AURA kaynak dosyası bulunamadı: ' + source);
  fs.copyFileSync(source, target);
}
console.log('AURA renderer sync OK');
