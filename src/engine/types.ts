export interface PageSize { width: number; height: number }
export interface DocumentInfo { count: number; canCopy: boolean; canPrint: boolean; pages: PageSize[] }
export interface TextWord { text: string; x: number; y: number; width: number; height: number; rotation: number }
export interface PdfLink { x: number; y: number; width: number; height: number; page: number; url: string }
export interface OutlineItem { title: string; page: number; children: OutlineItem[] }
export interface Raster { bitmap: ImageBitmap; width: number; height: number; milliseconds: number }
export interface EngineRequest { id: number; method: string; args: unknown[] }
export interface EngineReply { id: number; result?: unknown; error?: string; code?: string }
export interface WasmModule {
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  UTF8ToString(ptr: number): string;
  stringToUTF8(text: string, ptr: number, max: number): void;
  lengthBytesUTF8(text: string): number;
  _folio_open(ptr: number, length: number, password: number): number;
  _folio_close(): void;
  _folio_error(): number;
  _folio_info(): number;
  _folio_page_info(first: number, count: number): number;
  _folio_render(page: number, scale: number, rotation: number): number;
  _folio_pixels(): number;
  _folio_pixel_length(): number;
  _folio_text(page: number, rotation: number): number;
  _folio_links(page: number, rotation: number): number;
  _folio_outline(): number;
  FS: {
    mkdirTree(path: string): void;
    createLazyFile(parent: string, name: string, url: string, read: boolean, write: boolean): void;
  };
}
