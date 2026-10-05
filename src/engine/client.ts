import EngineWorker from './worker?worker';
import type { DocumentInfo, EngineReply, EngineRequest, OutlineItem, PdfLink, Raster, TextWord } from './types';

export class PdfEngine {
  private worker = new EngineWorker();
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private disposed = false;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<EngineReply>) => {
      const reply = event.data;
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      this.pending.delete(reply.id);
      if (reply.error) {
        const error = new Error(reply.error); error.name = reply.code || 'Error'; pending.reject(error);
      } else pending.resolve(reply.result);
    };
    this.worker.onerror = () => this.fail(new Error('The Poppler worker stopped. Try reopening the document.'));
    this.worker.onmessageerror = () => this.fail(new Error('Unable to read the rendering worker response.'));
  }

  private fail(error: Error) { for (const request of this.pending.values()) request.reject(error); this.pending.clear(); }
  private call<T>(method: string, args: unknown[] = [], transfer: Transferable[] = []): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Rendering session closed.'));
    return new Promise<T>((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve: (result) => resolve(result as T), reject });
      this.worker.postMessage({ id, method, args } satisfies EngineRequest, transfer);
    });
  }

  initialize() { return this.call<boolean>('initialize', [new URL('engine/', document.baseURI).href]); }
  open(bytes: ArrayBuffer, password = '') { return this.call<DocumentInfo>('open', [bytes, password], [bytes]); }
  render(page: number, scale: number, rotation: number) { return this.call<Raster>('render', [page, scale, rotation]); }
  text(page: number, rotation: number) { return this.call<TextWord[]>('text', [page, rotation]); }
  links(page: number, rotation: number) { return this.call<PdfLink[]>('links', [page, rotation]); }
  outline() { return this.call<OutlineItem[]>('outline'); }
  dispose() {
    this.disposed = true;
    this.worker.terminate();
    this.fail(new Error('Rendering session closed.'));
  }
}
