import { chromium, expect, test, type BrowserContext, type Frame, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { makePdf } from '../fixtures';
import { executablePath } from '../../playwright.config';

let context: BrowserContext;
let extensionId: string;
let server: Server;
let origin: string;
let hasMimeHandler = false;
const requests: { url: string; method: string }[] = [];
const pdf = makePdf(8);
test.beforeAll(async () => {
  server = createServer((request, response) => {
    requests.push({ url: request.url || '', method: request.method || '' });
    if (request.url === '/form') { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<form action="/generated" method="POST"><button>Generate PDF</button></form>'); return; }
    if (request.url === '/embedded') { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<iframe src="/embedded.pdf" width="1000" height="800"></iframe>'); return; }
    if (request.url?.startsWith('/download.pdf')) { response.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="download.pdf"' }); response.end(pdf); return; }
    response.writeHead(200, { 'content-type': 'application/pdf', 'content-length': pdf.length, 'cache-control': 'no-store' }); response.end(pdf);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://localhost:${(server.address() as { port: number }).port}`;
  const path = resolve('dist');
  context = await chromium.launchPersistentContext('', {
    executablePath, headless: true, viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  hasMimeHandler = await worker.evaluate(() => !!(chrome as typeof chrome & { mimeHandler?: unknown }).mimeHandler);
});
test.afterAll(async () => { await context?.close(); await new Promise<void>((done) => server?.close(() => done())); });

async function viewerFrame(page: Page): Promise<Frame> {
  let found: Frame | undefined;
  await expect.poll(async () => {
    for (const frame of page.frames()) if (await frameCount(frame, '#page-count')) { found = frame; return true; }
    return false;
  }, { timeout: 10000 }).toBe(true);
  return found!;
}

async function frameCount(frame: Frame, selector: string) {
  try { return await frame.locator(selector).count(); }
  catch (error) {
    // Native handoff intentionally destroys the Folio MIME frame. A poll can
    // sample it just before that happens; inspect the replacement on the next poll.
    if (frame.isDetached()) return 0;
    throw error;
  }
}

test('packaged extension opens local PDFs under MV3 CSP', async () => {
  const page = await context.newPage();
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/viewer.html`);
  await page.locator('#file-input').setInputFiles({ name: 'packaged.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(page.locator('.pdf-page.rendered').first()).toBeVisible();
  await expect(page.locator('#page-count')).toHaveText('8');
  expect(errors).toEqual([]); await page.close();
});

test('automatic takeover opens PDFs with signed URL queries and extensionless endpoints', async () => {
  const page = await context.newPage();
  for (const path of ['/reading.pdf?signature=a%2Fb&expires=5', '/generated']) {
    await page.goto(origin + path);
    const frame = await viewerFrame(page);
    await expect(frame.locator('.pdf-page.rendered').first()).toBeVisible();
    await expect(frame.locator('#page-count')).toHaveText('8');
    if (hasMimeHandler) await expect(page).toHaveURL(origin + path);
  }
  await page.close();
});

test('native stream handler opens a POST-generated PDF without a second request', async () => {
  test.skip(!hasMimeHandler, 'Legacy interception cannot replay POST-generated PDFs.');
  const page = await context.newPage();
  await page.goto(origin + '/form');
  const start = requests.length;
  await page.getByRole('button', { name: 'Generate PDF' }).click();
  const frame = await viewerFrame(page);
  await expect(frame.locator('.pdf-page.rendered').first()).toBeVisible();
  expect(requests.slice(start).filter((request) => request.url === '/generated')).toEqual([{ url: '/generated', method: 'POST' }]);
  await page.close();
});

test('native stream handler takes over local file URLs without manual file permission', async () => {
  test.skip(!hasMimeHandler, 'Legacy file takeover needs the browser file-access setting.');
  const path = resolve('.build/local-test.pdf'); await writeFile(path, pdf);
  const page = await context.newPage(); const url = pathToFileURL(path).href;
  await page.goto(url);
  const frame = await viewerFrame(page);
  await expect(frame.locator('.pdf-page.rendered').first()).toBeVisible();
  await expect(page).toHaveURL(url); await page.close();
});

test('Folio home returns a streamed PDF to welcome without navigating and can open another file', async () => {
  const page = await context.newPage();
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin + '/reading.pdf');
  const frame = await viewerFrame(page);
  await expect(frame.locator('.pdf-page.rendered').first()).toBeVisible();
  const url = page.url(), frameUrl = frame.url();
  const navigations: string[] = [];
  page.on('framenavigated', (navigated) => navigations.push(navigated.url()));
  await frame.getByLabel('Folio home', { exact: true }).click();
  await expect(frame.getByRole('heading', { name: /Your documents/ })).toBeVisible();
  await expect(frame.locator('#viewport')).toBeHidden();
  await expect(frame.locator('.pdf-page')).toHaveCount(0);
  await expect(page).toHaveURL(url); expect(frame.url()).toBe(frameUrl);
  const chooser = page.waitForEvent('filechooser');
  await frame.getByRole('button', { name: /Open a PDF/ }).click();
  await (await chooser).setFiles({ name: 'reopened.pdf', mimeType: 'application/pdf', buffer: makePdf(2) });
  await expect(frame.locator('.pdf-page.rendered').first()).toBeVisible();
  await expect(frame.locator('#page-count')).toHaveText('2');
  await frame.getByLabel('Folio home', { exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(frame.getByRole('heading', { name: /Your documents/ })).toBeVisible();
  expect(navigations).toEqual([]); expect(errors).toEqual([]);
  await page.close();
});

test('native stream handler also renders embedded PDF frames', async () => {
  test.skip(!hasMimeHandler, 'Embedded takeover requires MIME-handler support.');
  const page = await context.newPage(); await page.goto(origin + '/embedded');
  const frame = await viewerFrame(page);
  await expect(frame.locator('.pdf-page.rendered').first()).toBeVisible();
  await expect(frame.locator('body')).toHaveClass('embedded');
  await page.close();
});

test('print prepares original PDF bytes and requests printing without a MIME-handler loop', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/viewer.html`);
  await page.locator('#file-input').setInputFiles({ name: 'print.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(page.locator('.pdf-page.rendered').first()).toBeVisible();
  await page.getByRole('button', { name: 'More options' }).click();
  const created = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Print document' }).click();
  const printPage = await created;
  await expect(printPage).toHaveURL(new RegExp(`^chrome-extension://${extensionId}/print\\.html#`));
  await expect(printPage.locator('#print-status')).toHaveAttribute('data-state', 'ready');
  await expect(printPage.locator('#print-again')).toBeEnabled();
  await expect.poll(async () => {
    for (const frame of printPage.frames()) if (await frameCount(frame, 'pdf-viewer')) return true;
    return false;
  }).toBe(true);
  const bytes = await printPage.locator('iframe').evaluate(async (frame: HTMLIFrameElement) => Array.from(new Uint8Array(await (await fetch(frame.src)).arrayBuffer())));
  expect(Buffer.from(bytes)).toEqual(pdf);
  await expect(page.locator('.pdf-page.rendered').first()).toBeVisible();
  await printPage.close(); await page.close();
});

test('native-viewer fallback does not redirect back into Folio', async () => {
  const page = await context.newPage();
  await page.goto(origin + '/reading.pdf');
  const frame = await viewerFrame(page);
  await expect(frame.locator('.pdf-page.rendered').first()).toBeVisible();
  await frame.getByRole('button', { name: 'More options' }).click();
  await frame.getByRole('button', { name: 'Open in browser viewer' }).click();
  await expect.poll(async () => {
    for (const frame of page.frames()) if (await frameCount(frame, '#filename')) return false;
    return true;
  }).toBe(true);
  await expect(page).toHaveURL(origin + '/reading.pdf');
  await page.close();
});

test('explicit attachment PDFs remain downloads', async () => {
  const page = await context.newPage();
  const downloaded = page.waitForEvent('download');
  await page.goto(origin + '/download.pdf').catch(() => {}); // Navigations that download report ERR_ABORTED.
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('download.pdf');
  await page.close();
});
