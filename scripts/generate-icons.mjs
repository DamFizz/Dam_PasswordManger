// Rasterises public/favicon.svg into the PNG icons required by Android/iOS PWA installs.
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url));
const out = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));
const bg = { r: 11, g: 13, b: 18, alpha: 1 };

for (const size of [64, 192, 512]) {
  await sharp(svg, { density: 512 }).resize(size, size).png().toFile(out(`pwa-${size}x${size}.png`));
}
// Maskable: icon inside the 80% safe zone on a solid background.
const inner = await sharp(svg, { density: 512 }).resize(380, 380).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: bg } })
  .composite([{ input: inner, gravity: 'center' }])
  .png()
  .toFile(out('maskable-icon-512x512.png'));
// Apple touch icon: opaque background (iOS ignores transparency).
const apple = await sharp(svg, { density: 512 }).resize(150, 150).png().toBuffer();
await sharp({ create: { width: 180, height: 180, channels: 4, background: bg } })
  .composite([{ input: apple, gravity: 'center' }])
  .png()
  .toFile(out('apple-touch-icon-180x180.png'));
console.log('Icons generated in public/');
