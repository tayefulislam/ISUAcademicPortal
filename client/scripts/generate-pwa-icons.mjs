import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../public/icons');
mkdirSync(outDir, { recursive: true });

const source = path.join(__dirname, 'icon-source.svg');
const maskableSource = path.join(__dirname, 'icon-maskable-source.svg');

const targets = [
  { file: source, size: 192, name: 'icon-192.png' },
  { file: source, size: 512, name: 'icon-512.png' },
  { file: source, size: 180, name: 'apple-touch-icon.png' },
  { file: maskableSource, size: 192, name: 'maskable-192.png' },
  { file: maskableSource, size: 512, name: 'maskable-512.png' },
];

for (const t of targets) {
  await sharp(t.file, { density: 384 })
    .resize(t.size, t.size)
    .png()
    .toFile(path.join(outDir, t.name));
  console.log(`generated ${t.name} (${t.size}x${t.size})`);
}

// Favicon-sized PNG for the browser tab / bookmark bar.
await sharp(source, { density: 384 }).resize(32, 32).png().toFile(path.resolve(__dirname, '../public/favicon.png'));
console.log('generated favicon.png (32x32)');
