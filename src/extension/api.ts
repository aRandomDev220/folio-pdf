export interface StreamInfo {
  originalUrl: string;
  streamUrl: string;
  embedded: boolean;
  responseHeaders: Record<string, string>;
}
export interface MimeHandler {
  getStreamInfo(): Promise<StreamInfo>;
  abortAndFallbackToNativeHandler(): Promise<void>;
  getMimeHandlerOptions(type: string): Promise<{ enabled: boolean }>;
  setMimeHandlerOptions(type: string, options: { enabled: boolean }): Promise<void>;
}
export function mimeHandler(): MimeHandler | undefined {
  return (globalThis.chrome as typeof chrome & { mimeHandler?: MimeHandler } | undefined)?.mimeHandler;
}
export function inExtension() { return !!globalThis.chrome?.runtime?.id; }
