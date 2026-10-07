import './styles.css';
import { inExtension, mimeHandler } from '../extension/api';

const status = document.querySelector<HTMLElement>('#print-status')!;
const again = document.querySelector<HTMLButtonElement>('#print-again')!;
const frame = document.createElement('iframe');
frame.title = 'Document to print';
let url = '';
let nativeKey = '';
let ready = false;
let disposed = false;

function fail(message: string) {
  status.textContent = message;
  status.dataset.state = 'error';
  again.disabled = true;
}
function print() {
  if (!ready || !frame.contentWindow) return;
  try {
    status.textContent = 'Use the print dialog to finish printing.';
    frame.contentWindow.focus();
    frame.contentWindow.print();
  } catch { fail('The print dialog could not be opened. Download the PDF from Folio to print it.'); }
}
again.onclick = print;
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
    event.preventDefault(); print();
  }
});
window.addEventListener('pagehide', () => {
  disposed = true;
  if (url) URL.revokeObjectURL(url);
  if (nativeKey) void chrome.storage.session.remove(nativeKey).catch(() => {});
});

async function prepare() {
  const params = new URLSearchParams(location.hash.slice(1));
  const source = params.get('source') || '';
  const title = params.get('title') || 'Document.pdf';
  document.querySelector<HTMLElement>('#filename')!.textContent = title;
  document.title = `${title} — Print`;
  // Only accept an on-device copy created by this viewer's origin.
  if (!source.startsWith(`blob:${location.origin}/`)) { fail('Open a PDF in Folio and choose Print document.'); return; }
  try {
    const response = await fetch(source);
    if (!response.ok) throw new Error();
    const blob = await response.blob();
    if (disposed) return;
    // Own the print copy so closing the reader does not invalidate the PDF.
    url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    let expectedLoads = 1;
    const handler = inExtension() ? mimeHandler() : undefined;
    if (handler && (await handler.getMimeHandlerOptions('application/pdf')).enabled !== false) {
      if (disposed) return;
      nativeKey = 'native-copy:' + url;
      await chrome.storage.session.set({ [nativeKey]: Date.now() });
      // The first load is Folio's MIME guest. Its one-use fallback reloads the
      // frame with the native PDF handler; printing before that prints a blank.
      expectedLoads = 2;
    }
    if (disposed) { if (nativeKey) await chrome.storage.session.remove(nativeKey); return; }
    let loads = 0;
    frame.onload = () => {
      if (++loads < expectedLoads || ready || disposed) return;
      ready = true;
      again.disabled = false;
      status.dataset.state = 'ready';
      print();
    };
    frame.src = url;
    document.querySelector('#document')!.append(frame);
  } catch { fail('This print copy is unavailable. Return to Folio and choose Print document again.'); }
}
void prepare();
