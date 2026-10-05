import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { makePdf } from '../tests/fixtures.ts';

const cached = `${homedir()}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const executablePath = process.env.FOLIO_BROWSER || (existsSync(cached) ? cached : chromium.executablePath());
const scan = await readFile('.build/test-images/scan.jpg');
const pdf = makePdf(120, { uniqueImages: true, image: { bytes: scan, filter: 'DCTDecode', width: 1800, height: 2400 } });
const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'application/pdf', 'content-length': pdf.length, 'cache-control': 'no-store' }); response.end(pdf);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/scan.pdf`;
const results = [];
try {
  for (const folio of [false, true]) {
    const extension = resolve('dist');
    const context = await chromium.launchPersistentContext('', { executablePath, headless: true, viewport: { width: 1440, height: 1000 }, args: folio ? [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] : [] });
    try {
      if (folio && !context.serviceWorkers().length) await context.waitForEvent('serviceworker');
      const page = await context.newPage();
      const start = performance.now();
      await page.goto(url);
      let reader;
      for (let attempt = 0; attempt < 200 && !reader; attempt++) {
        for (const frame of page.frames()) {
          if (await frame.locator(folio ? '.pdf-page.rendered' : 'pdf-viewer').count()) { reader = frame; break; }
        }
        if (!reader) await new Promise((done) => setTimeout(done, 50));
      }
      if (!reader) throw new Error(`${folio ? 'Folio' : 'Native'} PDF frame was not accessible to the benchmark.`);
      const domReadyMs = performance.now() - start;
      if (!folio) {
        console.log('Native viewer diagnostics:', await reader.evaluate(() => {
          const element = document.querySelector('pdf-viewer');
          return { state: element?.loadState, loaded: element?.documentLoaded, roots: element?.shadowRoot ? [...element.shadowRoot.querySelectorAll('[id]')].map((el) => el.id) : [] };
        }));
      }
      // Scroll the reader's actual scroll container while observing animation
      // frames on the UI thread. Both readers use the same file and viewport.
      const timing = await reader.evaluate(async (folio) => {
        const viewer = document.querySelector('pdf-viewer');
        const scroller = folio ? document.querySelector('#viewport') : viewer?.shadowRoot?.querySelector('#scroller');
        if (!scroller) return { error: 'Reader scroll container unavailable' };
        const intervals = []; let previous = performance.now(), frames = 0;
        const end = previous + 3500;
        while (performance.now() < end) {
          await new Promise((done) => requestAnimationFrame(done));
          const now = performance.now(); intervals.push(now - previous); previous = now; frames++;
          scroller.scrollTop += 120;
        }
        intervals.sort((a, b) => a - b);
        return { frames, p95FrameMs: intervals[Math.floor(intervals.length * .95)], maxFrameMs: Math.max(...intervals), framesOver50ms: intervals.filter((value) => value > 50).length };
      }, folio);
      const stats = folio ? await reader.evaluate(() => window.__folioStats) : null;
      results.push({ viewer: folio ? 'Folio' : 'Chromium native', domReadyMs: Math.round(domReadyMs), ...timing, stats });
      await page.screenshot({ path: `artifacts/benchmark-${folio ? 'folio' : 'native'}.png` });
    } finally { await context.close(); }
  }
} finally { await new Promise((done) => server.close(done)); }
await mkdir('artifacts', { recursive: true });
const report = { date: new Date().toISOString(), browser: executablePath, pdfBytes: pdf.length, pages: 120, sourceImage: '1800x2400 JPEG per page, distinct PDF image objects', notes: 'Single local headless run. DOM readiness is not comparable first-pixel timing; native rendering completion is not instrumented. UI frame intervals measure responsiveness, not document painting latency. GPU memory and native process RSS are not measured.', results };
await writeFile('artifacts/benchmark.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
