import { chromium, expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { executablePath } from '../../playwright.config';
import { makePdf } from '../fixtures';

test('legacy network rules work when the MIME-handler API is unavailable', async () => {
  const pdf = makePdf(3);
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/scan.PDF') && request.url !== '/scan.PDF?signature=a%2Fb&expires=5') {
      response.writeHead(403); response.end('Signature encoding changed'); return;
    }
    response.writeHead(200, { 'content-type': 'application/pdf', 'content-length': pdf.length,
      ...(request.url === '/download.pdf' ? { 'content-disposition': 'attachment; filename="original.pdf"' } : {}) });
    response.end(pdf);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://localhost:${(server.address() as { port: number }).port}`;
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext('', { executablePath, headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    // Simulate a pre-151 API surface in this isolated test profile. The network
    // rules and URL/byte transport are exercised by the real browser backend.
    await worker.evaluate(async () => {
      const api = chrome as typeof chrome & { mimeHandler?: { setMimeHandlerOptions(type: string, options: { enabled: boolean }): Promise<void> } };
      if (api.mimeHandler) await api.mimeHandler.setMimeHandlerOptions('application/pdf', { enabled: false });
      Object.defineProperty(chrome, 'mimeHandler', { value: undefined, configurable: true });
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/viewer.html`);
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'set-auto-open', enabled: true }));
    for (const path of ['/scan.PDF?signature=a%2Fb&expires=5', '/extensionless']) {
      await page.goto(origin + path);
      await expect(page).toHaveURL(`chrome-extension://${id}/viewer.html#source=${origin}${path}`);
      await expect(page.locator('.pdf-page.rendered').first()).toBeVisible();
      await expect(page.locator('#page-count')).toHaveText('3');
    }
    const url = page.url();
    await page.getByLabel('Folio home', { exact: true }).click();
    await expect(page.getByRole('heading', { name: /Your documents/ })).toBeVisible();
    await expect(page).toHaveURL(url);
    await page.locator('#file-input').setInputFiles({ name: 'after-home.pdf', mimeType: 'application/pdf', buffer: makePdf(2) });
    await expect(page.locator('.pdf-page.rendered').first()).toBeVisible();
    await expect(page.locator('#page-count')).toHaveText('2');
    const download = page.waitForEvent('download');
    await page.goto(origin + '/download.pdf').catch(() => {});
    expect((await download).suggestedFilename()).toBe('original.pdf');
    await page.goto(`chrome-extension://${id}/viewer.html`);
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'set-auto-open', enabled: false }));
    await page.goto(origin + '/disabled.pdf');
    await expect(page).toHaveURL(origin + '/disabled.pdf');
  } finally { await context.close(); await new Promise<void>((done) => server.close(() => done())); }
});
