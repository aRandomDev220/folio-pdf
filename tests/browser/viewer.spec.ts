import { expect, test } from '@playwright/test';
import { makePdf } from '../fixtures';

test('opens a real Poppler document, searches, navigates bookmarks and rotates', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/viewer.html');
  await expect(page.getByRole('heading', { name: /Your documents/ })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
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
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
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
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
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

test('starts with the black theme and retains an explicitly selected light theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/viewer.html');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Switch theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch theme' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('Folio home clears the document and supports reopening with keyboard navigation', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/viewer.html');
  await page.locator('#file-input').setInputFiles({ name: 'first.pdf', mimeType: 'application/pdf', buffer: makePdf(6) });
  await expect(page.locator('.pdf-page.rendered').first()).toBeVisible();
  await page.getByRole('button', { name: 'Toggle sidebar (S)' }).click();
  await page.getByRole('button', { name: 'Find in document (Ctrl+F)' }).click();
  await page.getByRole('searchbox', { name: 'Find in document' }).fill('chapter');
  const url = page.url();
  await page.getByRole('button', { name: 'Folio home', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Your documents/ })).toBeVisible();
  await expect(page.locator('#find-bar')).toBeHidden();
  await expect(page.locator('#sidebar')).toBeHidden();
  await expect(page.locator('#filename')).toBeEmpty();
  await expect(page.locator('#save-file')).toBeDisabled();
  const stats = await page.evaluate(() => (window as unknown as { __folioStats: { mountedPages: number; rasterBytes: number; cachedRasters: number; queuedJobs: number } }).__folioStats);
  expect(stats).toMatchObject({ mountedPages: 0, rasterBytes: 0, cachedRasters: 0, queuedJobs: 0 });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open a PDF/ }).click();
  await (await chooser).setFiles({ name: 'second.pdf', mimeType: 'application/pdf', buffer: makePdf(2) });
  await expect(page.locator('.pdf-page.rendered').first()).toBeVisible();
  await expect(page.locator('#page-count')).toHaveText('2');
  await page.getByRole('button', { name: 'Folio home', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { name: /Your documents/ })).toBeVisible();
  await expect(page).toHaveURL(url); expect(errors).toEqual([]);
});

test('Folio home cancels a PDF download without letting its response replace welcome', async ({ page }) => {
  const source = 'http://127.0.0.1:4173/slow.pdf';
  let release!: () => void;
  const pending = new Promise<void>((done) => release = done);
  await page.route(source, async (route) => {
    await pending;
    await route.fulfill({ contentType: 'application/pdf', body: makePdf(3) });
  });
  await page.goto('/viewer.html#source=' + source);
  await expect(page.getByRole('heading', { name: 'Bringing your pages in…' })).toBeVisible();
  const cancelled = page.waitForEvent('requestfailed', (request) => request.url() === source);
  await page.getByRole('button', { name: 'Folio home', exact: true }).click();
  release(); await cancelled;
  await expect(page.getByRole('heading', { name: /Your documents/ })).toBeVisible();
  await expect(page.locator('#state')).toBeHidden();
  await expect(page.locator('.pdf-page')).toHaveCount(0);
});
