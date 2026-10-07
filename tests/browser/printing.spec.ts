import { chromium, expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { executablePath } from '../../playwright.config';
import { makePdf } from '../fixtures';

// A headless window.print() is a no-op. These checks inspect the real preview
// target in an isolated headed browser; they never submit a print job.
for (const trigger of ['menu', 'shortcut', 'manual'] as const) {
  test(`${trigger} printing opens the actual browser print dialog`, async () => {
    test.skip(process.platform === 'linux' && !process.env.DISPLAY, 'A display (or Xvfb) is required to verify the print dialog.');
    const path = resolve('dist');
    const context = await chromium.launchPersistentContext('', {
      executablePath, headless: false, viewport: { width: 1440, height: 1000 },
      args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`],
    });
    try {
      const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
      const id = new URL(worker.url()).host;
      if (trigger === 'manual') await worker.evaluate(async () => {
        const api = chrome as typeof chrome & { mimeHandler?: { setMimeHandlerOptions(type: string, options: { enabled: boolean }): Promise<void> } };
        if (api.mimeHandler) await api.mimeHandler.setMimeHandlerOptions('application/pdf', { enabled: false });
      });
      const page = await context.newPage();
      const pdf = makePdf(8);
      if (trigger !== 'shortcut') {
        await page.goto(`chrome-extension://${id}/viewer.html`);
        await page.locator('#file-input').setInputFiles({ name: 'print.pdf', mimeType: 'application/pdf', buffer: pdf });
      } else {
        const file = resolve('.build/print-dialog-test.pdf');
        await writeFile(file, pdf);
        await page.goto(pathToFileURL(file).href);
      }
      let viewer = page.mainFrame();
      await expect.poll(async () => {
        for (const frame of page.frames()) if (await frame.locator('.pdf-page.rendered').count()) { viewer = frame; return true; }
        return false;
      }).toBe(true);
      const created = context.waitForEvent('page');
      if (trigger !== 'shortcut') {
        await viewer.getByRole('button', { name: 'More options' }).click();
        await viewer.getByRole('button', { name: 'Print document' }).click();
      } else {
        await viewer.locator('#viewport').focus();
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+p' : 'Control+p');
      }
      const printPage = await created;
      await expect(printPage.locator('#print-status')).toHaveAttribute('data-state', 'ready');
      const diagnostics = await context.browser()!.newBrowserCDPSession();
      await expect.poll(async () => {
        const { targetInfos } = await diagnostics.send('Target.getTargets');
        return targetInfos.filter((target) => target.type === 'page' && target.url === 'chrome://print/').length;
      }).toBe(1);
      // The PDF preview target proves that the dialog acquired printable pages.
      await expect.poll(async () => {
        const { targetInfos } = await diagnostics.send('Target.getTargets');
        return targetInfos.some((target) => target.url.startsWith('chrome-untrusted://print/') && target.url.endsWith('/print.pdf'));
      }).toBe(true);
      await expect(viewer.locator('.pdf-page.rendered').first()).toBeVisible();
      if (trigger === 'menu') {
        const { targetInfos } = await diagnostics.send('Target.getTargets');
        const preview = targetInfos.find((target) => target.url === 'chrome://print/')!;
        // The print dialog ignores Target.closeTarget. Cancel through its real
        // button, then independently verify the preview target was destroyed.
        const { sessionId } = await diagnostics.send('Target.attachToTarget', { targetId: preview.targetId, flatten: false });
        await diagnostics.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({
          id: 1, method: 'Runtime.evaluate', params: { expression: `(() => {
            const cancel = (root) => {
              for (const element of root.querySelectorAll('*')) {
                if (element.matches('button, cr-button') && element.textContent.trim() === 'Cancel') { element.click(); return true; }
                if (element.shadowRoot && cancel(element.shadowRoot)) return true;
              }
              return false;
            };
            return cancel(document);
          })()` },
        }) });
        await expect.poll(async () => {
          const { targetInfos } = await diagnostics.send('Target.getTargets');
          return targetInfos.some((target) => target.url === 'chrome://print/');
        }).toBe(false);
        await printPage.getByRole('button', { name: 'Print again', exact: true }).click();
        await expect.poll(async () => {
          const { targetInfos } = await diagnostics.send('Target.getTargets');
          return targetInfos.some((target) => target.url === 'chrome://print/' && target.targetId !== preview.targetId);
        }).toBe(true);
      }
      await printPage.close();
      await expect.poll(async () => {
        const { targetInfos } = await diagnostics.send('Target.getTargets');
        return targetInfos.some((target) => target.url === 'chrome://print/');
      }).toBe(false);
      await expect(viewer.locator('.pdf-page.rendered').first()).toBeVisible();
    } finally { await context.close(); }
  });
}
