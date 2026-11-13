import type { PageSize } from '../engine/types';
export class PageLayout {
  offsets: number[] = [];
  sizes: PageSize[] = [];
  totalHeight = 0;
  maxWidth = 0;
  constructor(pages: PageSize[], scale: number, rotation: number, readonly gap = 24, readonly padding = 32) {
    let offset = padding;
    for (const page of pages) {
      const size = rotation % 180 ? { width: page.height * scale, height: page.width * scale } : { width: page.width * scale, height: page.height * scale };
      this.offsets.push(offset); this.sizes.push(size);
      this.maxWidth = Math.max(this.maxWidth, size.width);
      offset += size.height + gap;
    }
    this.totalHeight = offset - gap + padding;
  }
  pageAt(y: number) {
    let low = 0, high = this.offsets.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.offsets[mid] <= y) low = mid; else high = mid - 1;
    }
    return low;
  }
  window(top: number, height: number, overscan = 600) {
    const first = this.pageAt(Math.max(0, top - overscan));
    const last = this.pageAt(top + height + overscan);
    return Array.from({ length: last - first + 1 }, (_, i) => first + i);
  }
}

export function renderScale(cssScale: number, dpr: number, size: PageSize, maxPixels = 8_000_000) {
  const raw = Math.min(cssScale * Math.min(dpr, 2), Math.sqrt(maxPixels / (size.width * size.height)), 16);
  // Quantize to a 1/32 grid so transient zoom steps reuse cached rasters
  // instead of rendering a new bitmap for every continuous wheel notch.
  const snapped = Math.round(raw * 32) / 32;
  const pixels = (scale: number) => scale * scale * size.width * size.height;
  if (snapped > 0 && pixels(snapped) <= maxPixels) return snapped;
  const floored = Math.floor(raw * 32) / 32;
  return floored > 0 ? floored : raw;
}
