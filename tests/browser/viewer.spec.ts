import { expect, test } from '@playwright/test';
import { makePdf } from '../fixtures';

test('opens a real Poppler document, searches, navigates bookmarks and rotates', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/viewer.html');
  await expect(page.getByRole('heading', { name: /Your documents/ })).toBeVisible();
  await page.screenshot({ path: 'artifacts/welcome.png' });
  await page.locator('#file-input').setInputFiles({ name: 'reading.pdf', mimeType: 'application/pdf', buffer: makePdf(6) });
  await expect(page.locator('.pdf-page[data-page="1"].rendered')).toBeVisible();
  await expect(page.locator('#page-count')).toHaveText('6');
  await expect(page.locator('.text-layer').first()).toContainText('Folio');
  // A real pixel assertion catches WASM/font/bitmap transfer failures that a loaded UI misses.
  const pixel = await page.locator('.pdf-page canvas').first().evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(Math.round(canvas.width * 0.2), Math.round(canvas.height * 0.25), 1, 1).data;
    return Array.from(data);
  });
  expect(pixel[1]).toBeGreaterThan(pixel[2]); expect(pixel[3]).toBe(255);
  await page.getByRole('button', { name: 'Find in document (Ctrl+F)' }).click();
  await page.getByRole('searchbox', { name: 'Find in document' }).fill('chapter 4');
  await expect(page.locator('#find-count')).toHaveText('1 / 1');
  await expect(page.locator('#page-number')).toHaveValue('4');
  await page.getByRole('button', { name: 'Close search' }).click();
  await page.getByRole('button', { name: 'Toggle sidebar (S)' }).click();
  await page.getByRole('button', { name: 'Contents', exact: true }).click();
  await page.getByRole('button', { name: 'Chapter one', exact: true }).click();
  await expect(page.locator('#page-number')).toHaveValue('2');
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'Rotate clockwise' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __folioStats: { rotation: number } }).__folioStats.rotation)).toBe(90);
  await page.getByRole('button', { name: 'Switch theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'artifacts/reader-dark.png' });
  expect(errors).toEqual([]);
});

test('keeps mounted pages and raster cache bounded after jumping through 250 pages', async ({ page }) => {
  await page.goto('/viewer.html');
  await page.locator('#file-input').setInputFiles({ name: 'long.pdf', mimeType: 'application/pdf', buffer: makePdf(250) });
  await expect(page.locator('.pdf-page.rendered').first()).toBeVisible();
  for (const number of [80, 190, 250, 12]) {
    await page.locator('#page-number').fill(String(number)); await page.locator('#page-number').press('Enter'); await page.locator('#page-number').blur();
    await expect(page.locator(`.pdf-page[data-page="${number}"].rendered`)).toBeVisible();
  }
  const stats = await page.evaluate(() => (window as unknown as { __folioStats: { mountedPages: number; rasterBytes: number; queuedJobs: number } }).__folioStats);
  expect(stats.mountedPages).toBeLessThanOrEqual(7); expect(stats.rasterBytes).toBeLessThanOrEqual(96 * 1024 * 1024); expect(stats.queuedJobs).toBeLessThan(25);
});

test('recovers from invalid files and wrong passwords', async ({ page }) => {
  await page.goto('/viewer.html');
  await page.locator('#file-input').setInputFiles({ name: 'invalid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
  await expect(page.getByRole('heading', { name: 'This document couldn’t be opened.' })).toBeVisible();
  await page.locator('#file-input').setInputFiles({ name: 'protected.pdf', mimeType: 'application/pdf', buffer: makePdf(3, { password: 'secret' }) });
  await expect(page.locator('#password-dialog')).toBeVisible();
  await page.getByRole('textbox', { name: 'PDF password' }).fill('wrong');
  await page.getByRole('button', { name: 'Unlock PDF' }).click();
  await expect(page.locator('#password-error')).toContainText('didn’t unlock');
  await page.getByRole('textbox', { name: 'PDF password' }).fill('secret');
  await page.getByRole('button', { name: 'Unlock PDF' }).click();
  await expect(page.locator('.pdf-page.rendered').first()).toBeVisible();
  await expect(page.locator('#password-dialog')).not.toBeVisible();
});

test('renders a large image-heavy document without blocking reader controls', async ({ page }) => {
  await page.goto('/viewer.html');
  await page.locator('#file-input').setInputFiles({ name: 'image-heavy.pdf', mimeType: 'application/pdf', buffer: makePdf(30, { heavy: true }) });
  await expect(page.locator('.pdf-page.rendered').first()).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Switch theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#zoom').selectOption('2');
  await page.locator('#page-number').fill('20');
  // A real scroll/animation update while the user edits must not reset the input.
  await page.locator('#viewport').evaluate(async (element) => {
    element.scrollTop += 20;
    await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
  });
  await expect(page.locator('#page-number')).toHaveValue('20');
  await page.locator('#page-number').press('Enter');
  await expect(page.locator('.pdf-page[data-page="20"].rendered')).toBeVisible();
  await page.screenshot({ path: 'artifacts/image-heavy.png' });
});
