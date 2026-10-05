import type { DocumentInfo, EngineReply, EngineRequest, PageSize, WasmModule } from './types';

let engine: Promise<WasmModule> | undefined;
async function initialize(base: string): Promise<WasmModule> {
  const { default: create } = await import(/* @vite-ignore */ `${base}poppler.js`);
  const module: WasmModule = await create({ locateFile: (file: string) => base + file });
  const response = await fetch(`${base}assets.json`);
  if (!response.ok) throw new Error('The bundled font and character-map assets are missing. Rebuild the engine.');
  const files: { path: string; virtual: string }[] = await response.json();
  for (const file of files) {
    const split = file.virtual.lastIndexOf('/');
    const directory = file.virtual.slice(0, split);
    module.FS.mkdirTree(directory);
    module.FS.createLazyFile(directory, file.virtual.slice(split + 1), base + file.path, true, false);
  }
  return module;
}

function read<T>(module: WasmModule, ptr: number): T {
  if (!ptr) throw new Error(module.UTF8ToString(module._folio_error()) || 'Poppler operation failed.');
  return JSON.parse(module.UTF8ToString(ptr)) as T;
}

async function execute(method: string, args: unknown[]): Promise<unknown> {
  if (method === 'initialize') { engine ??= initialize(args[0] as string); await engine; return true; }
  if (!engine) throw new Error('The rendering engine has not been initialized.');
  const module = await engine;
  switch (method) {
    case 'open': {
      const bytes = new Uint8Array(args[0] as ArrayBuffer);
      const password = args[1] as string;
      const ptr = module._malloc(bytes.length);
      if (!ptr) throw new Error('Not enough memory to open this document.');
      module.HEAPU8.set(bytes, ptr);
      const length = module.lengthBytesUTF8(password) + 1;
      const pass = module._malloc(length);
      if (!pass) { module._free(ptr); throw new Error('Not enough memory to open this document.'); }
      module.stringToUTF8(password, pass, length);
      let status: number;
      try { status = module._folio_open(ptr, bytes.length, pass); }
      finally { module._free(pass); }
      if (status !== 1) {
        const error = new Error(module.UTF8ToString(module._folio_error()));
        if (status === -2) error.name = 'PasswordRequired';
        throw error;
      }
      const info = read<Omit<DocumentInfo, 'pages'>>(module, module._folio_info());
      const pages = read<PageSize[]>(module, module._folio_page_info(1, info.count));
      return { ...info, pages };
    }
    case 'render': {
      const start = performance.now();
      const dimensions = read<PageSize>(module, module._folio_render(args[0] as number, args[1] as number, args[2] as number));
      // Copy once out of growable WASM memory, then transfer the bitmap to the UI.
      const pixels = new Uint8ClampedArray(module.HEAPU8.buffer, module._folio_pixels(), module._folio_pixel_length()).slice();
      const bitmap = await createImageBitmap(new ImageData(pixels, dimensions.width, dimensions.height));
      return { bitmap, ...dimensions, milliseconds: performance.now() - start };
    }
    case 'text': return read(module, module._folio_text(args[0] as number, args[1] as number));
    case 'links': return read(module, module._folio_links(args[0] as number, args[1] as number));
    case 'outline': return read(module, module._folio_outline());
    case 'close': module._folio_close(); return true;
    default: throw new Error('Unknown engine operation.');
  }
}

// Preserve buffer/JSON lifetimes across async bitmap creation and worker messages.
let queue: Promise<void> = Promise.resolve();
self.onmessage = (event: MessageEvent<EngineRequest>) => {
  const { id, method, args } = event.data;
  queue = queue.then(async () => {
    try {
      const result = await execute(method, args);
      const transfers = result && typeof result === 'object' && 'bitmap' in result ? [(result as { bitmap: ImageBitmap }).bitmap] : [];
      self.postMessage({ id, result } satisfies EngineReply, { transfer: transfers });
    } catch (error) {
      self.postMessage({ id, error: error instanceof Error ? error.message : 'Engine error', code: error instanceof Error ? error.name : 'Error' } satisfies EngineReply);
    }
  });
};
