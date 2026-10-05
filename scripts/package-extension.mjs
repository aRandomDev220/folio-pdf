import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

await access('dist/engine/poppler.wasm').catch(() => { throw new Error('Poppler engine is missing. Run npm run engine:build before packaging.'); });
await access('dist/engine/assets.json');
// Generate dependency-free PNG icons for Chromium's extension manifest.
const crc32 = (data) => {
  let crc = 0xffffffff;
  for (const value of data) { crc ^= value; for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const payload = Buffer.concat([Buffer.from(type), data]); const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(payload)); return Buffer.concat([size, payload, crc]);
};
function png(size) {
  const pixels = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = x / size * 128, ny = y / size * 128;
    let color = [103, 121, 101, 255];
    const cornerX = Math.max(0, 26 - nx, nx - 102), cornerY = Math.max(0, 26 - ny, ny - 102);
    if (cornerX * cornerX + cornerY * cornerY > 26 * 26) color = [0, 0, 0, 0];
    if (nx >= 39 && nx <= 91 && ny >= 25 && ny <= 98 && (ny >= 46 || nx <= 70 + ny - 25)) color = [250, 250, 245, 255];
    if (nx >= 70 && nx <= 91 && ny >= 25 && ny <= 46 && nx <= 70 + ny - 25) color = [201, 212, 196, 255];
    if (nx >= 50 && nx <= (ny > 82 ? 67 : 78) && [61, 73, 85].some((line) => Math.abs(ny - line) < 2.5)) color = [103, 121, 101, 255];
    const offset = y * (size * 4 + 1) + 1 + x * 4; pixels.set(color, offset);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
await mkdir('dist/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) await writeFile(`dist/icons/${size}.png`, png(size));
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
await access(`dist/${manifest.background.service_worker}`);
console.log('Extension ready: dist/ — load this folder unpacked in your Chromium browser.');
