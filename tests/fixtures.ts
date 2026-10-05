import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

function rc4(key: Buffer, input: Buffer) {
  const state = Array.from({ length: 256 }, (_, i) => i); let j = 0;
  for (let i = 0; i < 256; i++) { j = (j + state[i] + key[i % key.length]) % 256; [state[i], state[j]] = [state[j], state[i]]; }
  const out = Buffer.alloc(input.length); let i = 0; j = 0;
  for (let n = 0; n < input.length; n++) { i = (i + 1) % 256; j = (j + state[i]) % 256; [state[i], state[j]] = [state[j], state[i]]; out[n] = input[n] ^ state[(state[i] + state[j]) % 256]; }
  return out;
}
const md5 = (data: Buffer) => createHash('md5').update(data).digest();
const padding = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
const padded = (pass: string) => Buffer.concat([Buffer.from(pass, 'latin1'), padding]).subarray(0, 32);

/** Real, deterministic PDF fixtures: no mock renderer or network dependency. */
export function makePdf(count = 4, options: { password?: string; heavy?: boolean; uniqueImages?: boolean; image?: { bytes: Buffer; filter: string; width: number; height: number } } = {}) {
  const objects: Buffer[] = [];
  const add = (data: string | Buffer) => { objects.push(typeof data === 'string' ? Buffer.from(data, 'latin1') : data); return objects.length; };
  const set = (id: number, data: string | Buffer) => objects[id - 1] = typeof data === 'string' ? Buffer.from(data, 'latin1') : data;
  const catalog = add(''), pages = add(''), font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const id = md5(Buffer.from('Folio deterministic test document'));
  let key: Buffer | undefined, owner: Buffer | undefined;
  if (options.password) {
    owner = rc4(md5(padded('folio-owner')).subarray(0, 5), padded(options.password));
    const permissions = Buffer.alloc(4); permissions.writeInt32LE(-4);
    key = md5(Buffer.concat([padded(options.password), owner, permissions, id])).subarray(0, 5);
  }
  const encrypt = (bytes: Buffer, objectId: number) => {
    if (!key) return bytes;
    const suffix = Buffer.from([objectId & 255, objectId >> 8 & 255, objectId >> 16 & 255, 0, 0]);
    return rc4(md5(Buffer.concat([key, suffix])).subarray(0, Math.min(key.length + 5, 16)), bytes);
  };
  const stream = (bytes: Buffer, dictionary = '') => {
    const objectId = objects.length + 1; bytes = encrypt(bytes, objectId);
    return add(Buffer.concat([Buffer.from(`<< /Length ${bytes.length} ${dictionary} >>\nstream\n`), bytes, Buffer.from('\nendstream')]));
  };
  let image: number | undefined;
  if (options.image) {
    const input = options.image;
    image = stream(input.bytes, `/Type /XObject /Subtype /Image /Width ${input.width} /Height ${input.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${input.filter}`);
  } else if (options.heavy) {
    const width = 1800, height = 2400, rgb = Buffer.alloc(width * height * 3);
    let seed = 42;
    for (let n = 0; n < rgb.length; n++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; rgb[n] = seed >>> 24; }
    image = stream(deflateSync(rgb), `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`);
  }
  const pageIds: number[] = [];
  for (let page = 1; page <= count; page++) {
    if (options.uniqueImages && options.image) {
      const input = options.image;
      image = stream(input.bytes, `/Type /XObject /Subtype /Image /Width ${input.width} /Height ${input.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${input.filter}`);
    }
    const content = stream(Buffer.from(`${image ? 'q 500 0 0 600 50 100 cm /Im0 Do Q\n' : '0.86 0.91 0.83 rg 50 520 500 160 re f\n'}0.15 0.23 0.14 rg BT /F1 24 Tf 50 740 Td (Folio test page ${page}) Tj 0 -42 Td (Searchable chapter ${page}) Tj ET`, 'latin1'));
    pageIds.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> ${image ? `/XObject << /Im0 ${image} 0 R >>` : ''} >> /Contents ${content} 0 R >>`));
  }
  let outline = '';
  if (!key) {
    const outlines = add(''), item = add(`<< /Title (Chapter one) /Parent ${outlines} 0 R /Dest [${pageIds[Math.min(1, count - 1)]} 0 R /Fit] >>`);
    set(outlines, `<< /Type /Outlines /First ${item} 0 R /Last ${item} 0 R /Count 1 >>`); outline = `/Outlines ${outlines} 0 R`;
  }
  set(catalog, `<< /Type /Catalog /Pages ${pages} 0 R ${outline} >>`);
  set(pages, `<< /Type /Pages /Count ${count} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`);
  let encryption = '';
  if (key && owner) {
    const user = rc4(key, padding);
    const encryptionId = add(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${owner.toString('hex')}> /U <${user.toString('hex')}> /P -4 >>`);
    encryption = `/Encrypt ${encryptionId} 0 R`;
  }
  const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')]; const offsets = [0]; let length = chunks[0].length;
  objects.forEach((data, index) => { offsets.push(length); const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), data, Buffer.from('\nendobj\n')]); chunks.push(chunk); length += chunk.length; });
  const xref = length;
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /ID [<${id.toString('hex')}> <${id.toString('hex')}>] ${encryption} >>\nstartxref\n${xref}\n%%EOF\n`));
  return Buffer.concat(chunks);
}
