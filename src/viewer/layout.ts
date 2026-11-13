import type { PageSize } from '../engine/types';
export const PAGE_GAP = 24;

export class PageLayout {
  /** Top offset per page (both pages of a spread share it). */
  offsets: number[] = [];
  sizes: PageSize[] = [];
  /** Horizontal position per page inside the pages box; used in spread mode. */
  left: number[] = [];
  rows: Array<{ offset: number; height: number; width: number; first: number }> = [];
  totalHeight = 0;
  maxWidth = 0;
  private perRow: 1 | 2;

  constructor(pages: PageSize[], scale: number, rotation: number, spread = false, readonly gap = PAGE_GAP, readonly padding = 32) {
    this.perRow = spread ? 2 : 1;
    const scaled = (page: PageSize): PageSize =>
      rotation % 180 ? { width: page.height * scale, height: page.width * scale } : { width: page.width * scale, height: page.height * scale };
    type Row = { first: number; second?: number; width: number; height: number };
    const rowList: Row[] = [];
    for (let index = 0; index < pages.length; index += this.perRow) {
      const first = scaled(pages[index]);
      const second = spread && index + 1 < pages.length ? scaled(pages[index + 1]) : undefined;
      rowList.push({
        first: index, second: second ? index + 1 : undefined,
        width: first.width + (second ? second.width + this.gap : 0),
        height: Math.max(first.height, second?.height ?? first.height),
      });
    }
    this.maxWidth = rowList.reduce((width, row) => Math.max(width, row.width), 0);
    let offset = this.padding;
    for (const row of rowList) {
      this.rows.push({ offset, height: row.height, width: row.width, first: row.first });
      // Horizontal offsets are relative to the row's own left edge; position()
      // centers the row inside the actual pages-box width.
      this.offsets[row.first] = offset; this.sizes[row.first] = scaled(pages[row.first]); this.left[row.first] = 0;
      if (row.second !== undefined) {
        this.offsets[row.second] = offset;
        this.sizes[row.second] = scaled(pages[row.second]);
        this.left[row.second] = this.sizes[row.first].width + this.gap;
      }
      offset += row.height + this.gap;
    }
    this.totalHeight = offset - this.gap + this.padding;
  }
  private rowIndexAt(y: number) {
    let low = 0, high = this.rows.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.rows[mid].offset <= y) low = mid; else high = mid - 1;
    }
    return low;
  }
  pageAt(y: number) {
    return this.rows[this.rowIndexAt(y)]?.first ?? 0;
  }
  rowHeight(index: number) {
    return this.rows[Math.floor(index / this.perRow)]?.height ?? 0;
  }
  rowWidth(index: number) {
    return this.rows[Math.floor(index / this.perRow)]?.width ?? 0;
  }
  window(top: number, height: number, overscan = 600) {
    const first = this.rowIndexAt(Math.max(0, top - overscan));
    const last = this.rowIndexAt(top + height + overscan);
    const indices: number[] = [];
    for (let row = first; row <= last; row++) {
      indices.push(this.rows[row].first);
      if (this.perRow === 2 && this.rows[row].first + 1 < this.offsets.length) indices.push(this.rows[row].first + 1);
    }
    return indices;
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
