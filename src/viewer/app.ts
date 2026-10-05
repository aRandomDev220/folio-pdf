import './styles.css';
import { PdfEngine } from '../engine/client';
import type { DocumentInfo, OutlineItem, PdfLink, Raster, TextWord } from '../engine/types';
import { inExtension, mimeHandler } from '../extension/api';
import { BudgetCache } from './cache';
import { PageLayout, renderScale } from './layout';
import { RenderScheduler } from './scheduler';
import { icon } from './icons';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const button = (id: string, name: string, label: string, extra = '') => `<button id="${id}" class="icon-button" title="${label}" aria-label="${label}" ${extra}>${icon(name)}</button>`;
const formatSize = (bytes: number) => bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

$('#app').innerHTML = `
  <header class="toolbar">
    <div class="toolbar-left">
      <a class="brand" href="viewer.html" aria-label="Folio home"><span class="brand-mark">${icon('file', 19)}</span>folio<span class="brand-dot">.</span></a>
      <span class="toolbar-divider document-only" hidden></span>
      <span class="document-only" hidden>${button('sidebar-toggle', 'sidebar', 'Toggle sidebar (S)')}</span>
      <div class="document-title document-only" hidden><strong id="filename"></strong><span id="file-detail"></span></div>
    </div>
    <div class="toolbar-center document-only" hidden>
      <div class="page-controls">${button('previous', 'chevronLeft', 'Previous page')}<input id="page-number" aria-label="Page number" type="number" min="1" value="1" /><span class="page-divider">/</span><span id="page-count">0</span>${button('next', 'chevronRight', 'Next page')}</div>
      <span class="toolbar-divider"></span>
      <div class="zoom-controls">${button('zoom-out', 'minus', 'Zoom out (-)')}<select id="zoom" aria-label="Zoom"><option value="width">Fit width</option><option value="page">Fit page</option><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option><option value="3">300%</option><option value="4">400%</option></select>${button('zoom-in', 'plus', 'Zoom in (+)')}</div>
    </div>
    <div class="toolbar-right">
      ${button('find-toggle', 'search', 'Find in document (Ctrl+F)', 'data-needs-document disabled')}
      ${button('theme-toggle', 'moon', 'Switch theme')}
      <span class="toolbar-divider"></span>
      ${button('save-file', 'download', 'Download PDF', 'data-needs-document disabled')}
      ${button('more-toggle', 'more', 'More options', 'aria-expanded="false" aria-controls="more-menu"')}
    </div>
  </header>
  <div id="more-menu" class="menu" hidden>
    <button id="open-file">${icon('upload')}<span>Open PDF</span><kbd>Ctrl O</kbd></button>
    <button id="rotate" data-needs-document disabled>${icon('rotate')}<span>Rotate clockwise</span><kbd>R</kbd></button>
    <button id="print" data-needs-document disabled>${icon('print')}<span>Print document</span><kbd>Ctrl P</kbd></button>
    <button id="native" disabled>${icon('external')}<span>Open in browser viewer</span></button>
    <div class="menu-divider"></div>
    <label class="menu-setting"><span>Automatically open PDFs</span><input id="auto-open" type="checkbox" checked role="switch" /></label>
    <span id="handling-detail" class="menu-note">Local-first PDF viewing</span>
  </div>
  <div id="find-bar" class="find-bar" hidden>
    ${icon('search')}<input id="find-input" type="search" placeholder="Find in document" aria-label="Find in document" />
    <span id="find-count" aria-live="polite"></span>${button('find-previous', 'chevronLeft', 'Previous match')}${button('find-next', 'chevronRight', 'Next match')}${button('find-close', 'close', 'Close search')}
  </div>
  <main class="workspace">
    <aside id="sidebar" class="sidebar" aria-label="Document navigation" hidden>
      <div class="sidebar-tabs"><button id="tab-pages" class="active">Pages</button><button id="tab-outline">Contents</button></div>
      <div id="thumbnails" class="thumbnails"></div><div id="outline" class="outline" hidden></div>
    </aside>
    <section id="viewport" class="viewport" aria-label="PDF document" tabindex="0" hidden><div id="pages" class="pages"></div></section>
    <section id="welcome" class="welcome">
      <div class="welcome-content">
        <span class="eyebrow"><span class="status-dot"></span>A quieter way to read</span>
        <h1>Your documents.<br /><span>Room to breathe.</span></h1>
        <p class="welcome-description">A thoughtfully simple PDF viewer.<br />Built for the pages you want to get lost in.</p>
        <button id="choose-file" class="dropzone">
          <span class="drop-icon">${icon('file', 27)}</span>
          <strong>Open a PDF</strong><span>or drop your file here</span><span class="drop-arrow">${icon('upload', 19)}</span>
        </button>
        <div class="welcome-features"><span>${icon('check', 14)}On-device rendering</span><span>${icon('check', 14)}Poppler powered</span><span>${icon('check', 14)}No uploads</span></div>
      </div>
      <span class="welcome-bottom">Less interface. More document.</span>
    </section>
    <section id="state" class="state" aria-live="polite" hidden>
      <span id="state-icon" class="state-icon"></span><h2 id="state-title"></h2><p id="state-detail"></p>
      <div class="state-actions"><button id="state-open" class="primary-button">Choose another PDF</button><button id="state-native" class="secondary-button" hidden>Open in browser viewer</button></div>
    </section>
  </main>
  <footer id="statusbar" class="statusbar" hidden><span><span class="status-dot"></span>Poppler · on device</span><span id="render-status"></span><span id="position-status"></span></footer>
  <div id="toast" class="toast" role="status" hidden></div>
  <div id="drag-overlay" class="drag-overlay" hidden><span>${icon('upload', 30)}<strong>Drop to open</strong><span>Your PDF stays on this device.</span></span></div>
  <dialog id="password-dialog"><form id="password-form"><span class="eyebrow">Protected document</span><h2>A key to your pages.</h2><p>Enter this PDF’s password to open it.</p><input id="password" type="password" aria-label="PDF password" placeholder="Document password" autocomplete="off" required /><p id="password-error" class="error-text" role="alert"></p><div class="dialog-actions"><button id="password-cancel" type="button" class="secondary-button">Cancel</button><button type="submit" class="primary-button">Unlock PDF</button></div></form></dialog>
  <input id="file-input" type="file" accept="application/pdf,.pdf" hidden />
`;

interface PageView { element: HTMLElement; canvas: HTMLCanvasElement; text: HTMLElement; links: HTMLElement; key: string }
interface Match { page: number; first: number; last: number }
class Viewer {
  private engine?: PdfEngine;
  private scheduler?: RenderScheduler;
  private info?: DocumentInfo;
  private blob?: Blob;
  private title = '';
  private sourceUrl = '';
  private streamContext = false;
  private epoch = 0;
  private rotation = 0;
  private scale = 1;
  private zoomMode = 'width';
  private currentPage = 1;
  private layout?: PageLayout;
  private views = new Map<number, PageView>();
  private cache = new BudgetCache<Raster>(96 * 1024 * 1024, (value) => value.bitmap.close());
  private words = new BudgetCache<TextWord[]>(8 * 1024 * 1024, () => {});
  private links = new BudgetCache<PdfLink[]>(1024 * 1024, () => {});
  private frame = 0;
  private zoomTimer = 0;
  private searchTimer = 0;
  private searchEpoch = 0;
  private query = '';
  private matches: Match[] = [];
  private matchIndex = -1;
  private searchPage = 1;
  private searchComplete = false;
  private thumbnailViews = new Map<number, HTMLButtonElement>();
  private toastTimer = 0;
  private downloadAbort?: AbortController;
  private openedAt = 0;
  private firstPaint = false;
  private sessionErrors = new Set<number>();

  constructor() {
    let theme = '';
    try { theme = localStorage.getItem('folio-theme') || ''; } catch { /* Restricted storage uses OS theme. */ }
    this.setTheme(theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    this.events();
    void this.settings();
    void this.initialSource();
    // Local development diagnostics contain numbers only, never document contents.
    Object.defineProperty(window, '__folioStats', { get: () => ({ mountedPages: this.views.size, cachedRasters: this.cache.size, rasterBytes: this.cache.bytes, queuedJobs: this.scheduler?.queued || 0, page: this.currentPage, scale: this.scale, rotation: this.rotation, firstPageMs: this.firstPaint ? this.firstPageMilliseconds : null }) });
  }
  private firstPageMilliseconds = 0;

  private events() {
    const pick = () => $('#file-input').click();
    ['choose-file', 'open-file', 'state-open'].forEach((id) => $('#' + id).addEventListener('click', pick));
    $('#file-input').addEventListener('change', (event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (file) { this.sourceUrl = ''; this.streamContext = false; void this.open(file, file.name); }
      input.value = '';
    });
    $('#theme-toggle').onclick = () => this.setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    $('#more-toggle').onclick = () => {
      const menu = $('#more-menu'); menu.hidden = !menu.hidden;
      $('#more-toggle').setAttribute('aria-expanded', String(!menu.hidden));
    };
    document.addEventListener('click', (event) => {
      if (!(event.target as Element).closest('#more-menu, #more-toggle')) { $('#more-menu').hidden = true; $('#more-toggle').setAttribute('aria-expanded', 'false'); }
    });
    $('#sidebar-toggle').onclick = () => this.toggleSidebar();
    $('#previous').onclick = () => this.go(this.currentPage - 1);
    $('#next').onclick = () => this.go(this.currentPage + 1);
    $('#page-number').onchange = () => this.go(Number($<HTMLInputElement>('#page-number').value));
    $('#page-number').onkeydown = (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const input = $<HTMLInputElement>('#page-number');
      const page = Number(input.value); input.blur(); this.go(page);
    };
    $('#zoom').onchange = () => this.zoom($<HTMLSelectElement>('#zoom').value);
    $('#zoom-in').onclick = () => this.zoom(String(Math.min(4, this.scale * 1.2)));
    $('#zoom-out').onclick = () => this.zoom(String(Math.max(0.25, this.scale / 1.2)));
    $('#rotate').onclick = () => this.rotate();
    $('#save-file').onclick = () => this.download();
    $('#print').onclick = () => { void this.print(); };
    $('#native').onclick = $('#state-native').onclick = () => { void this.native(); };
    $('#find-toggle').onclick = () => this.toggleFind();
    $('#find-close').onclick = () => this.toggleFind(false);
    $('#find-input').oninput = () => {
      clearTimeout(this.searchTimer);
      // Invalidate the running scan immediately, even during input debounce.
      this.searchEpoch++;
      this.searchTimer = window.setTimeout(() => this.startSearch(), 180);
    };
    $('#find-input').onkeydown = (event) => { if (event.key === 'Enter') this.nextMatch(event.shiftKey ? -1 : 1); };
    $('#find-next').onclick = () => this.nextMatch(1);
    $('#find-previous').onclick = () => this.nextMatch(-1);
    $('#viewport').addEventListener('scroll', () => this.updateSoon(), { passive: true });
    $('#viewport').addEventListener('wheel', (event) => {
      if (!event.ctrlKey || !this.info) return;
      event.preventDefault(); this.zoom(String(Math.min(4, Math.max(0.25, this.scale * (event.deltaY < 0 ? 1.08 : 0.925)))));
    }, { passive: false });
    new ResizeObserver(() => { if (this.info) this.relayout(true); }).observe($('#viewport'));
    $('#thumbnails').addEventListener('scroll', () => this.updateThumbnails(), { passive: true });
    $('#tab-pages').onclick = () => this.sidebarTab('pages');
    $('#tab-outline').onclick = () => this.sidebarTab('outline');
    $('#password-form').onsubmit = (event) => {
      event.preventDefault();
      if (this.blob) void this.open(this.blob, this.title, $<HTMLInputElement>('#password').value);
    };
    $('#password-cancel').onclick = () => { $<HTMLDialogElement>('#password-dialog').close(); this.showState('This PDF is locked.', 'Open it again when you have the document password.', false); };
    document.addEventListener('keydown', (event) => this.keyboard(event));
    let dragDepth = 0;
    document.addEventListener('dragenter', (event) => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); dragDepth++; $('#drag-overlay').hidden = false; } });
    document.addEventListener('dragover', (event) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
    document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drag-overlay').hidden = true; } });
    document.addEventListener('drop', (event) => {
      event.preventDefault(); dragDepth = 0; $('#drag-overlay').hidden = true;
      const file = event.dataTransfer?.files[0];
      if (file) { this.sourceUrl = ''; this.streamContext = false; void this.open(file, file.name); }
    });
    window.addEventListener('pagehide', () => this.endSession());
  }

  private setTheme(theme: string) {
    document.documentElement.dataset.theme = theme;
    $('#theme-toggle').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
    try { localStorage.setItem('folio-theme', theme); } catch { /* Theme still works without storage. */ }
  }
  private async settings() {
    const handler = mimeHandler();
    try {
      if (handler) {
        $<HTMLInputElement>('#auto-open').checked = (await handler.getMimeHandlerOptions('application/pdf')).enabled !== false;
        $('#handling-detail').textContent = 'Native PDF stream handling';
      } else if (inExtension()) {
        const { autoOpen = true } = await chrome.storage.local.get('autoOpen');
        $<HTMLInputElement>('#auto-open').checked = autoOpen !== false;
        $('#handling-detail').textContent = 'GET-based compatibility mode';
      } else { $<HTMLInputElement>('#auto-open').disabled = true; $('#handling-detail').textContent = 'Automatic opening is available in the extension.'; }
      $('#auto-open').onchange = async () => {
        try {
          const enabled = $<HTMLInputElement>('#auto-open').checked;
          if (handler) await handler.setMimeHandlerOptions('application/pdf', { enabled });
          if (inExtension()) await chrome.runtime.sendMessage({ type: 'set-auto-open', enabled });
        } catch { this.toast('Could not update automatic opening.'); await this.settings(); }
      };
    } catch { this.toast('Browser settings could not be read.'); }
  }
  private async initialSource() {
    const hash = location.hash;
    const legacyUrl = hash.startsWith('#source=') ? hash.slice(8) : '';
    if (legacyUrl) { await this.fetchSource(legacyUrl); return; }
    const handler = mimeHandler();
    if (!handler) return;
    let stream;
    try { stream = await handler.getStreamInfo(); } catch { return; } // Directly opened viewer has no stream.
    this.sourceUrl = stream.originalUrl; this.streamContext = true;
    // Copies opened for printing must reach the built-in handler even while
    // Folio is the registered MIME handler. Consume once before falling back.
    const nativeKey = 'native-copy:' + stream.originalUrl.split('#')[0];
    let nativeCopy = false;
    try {
      const marker = (await chrome.storage.session.get(nativeKey))[nativeKey];
      nativeCopy = typeof marker === 'number' && Date.now() - marker < 120000;
    } catch { /* Session storage is not needed to open ordinary documents. */ }
    if (nativeCopy) {
      try {
        await fetch(stream.streamUrl).then((response) => response.arrayBuffer());
        await chrome.storage.session.remove(nativeKey);
        await handler.abortAndFallbackToNativeHandler();
      } catch { this.showState('The print viewer couldn’t be opened.', 'Download the original PDF to print it.', false); }
      return; // A one-use MIME stream must never be fetched again on failure.
    }
    document.body.classList.toggle('embedded', stream.embedded);
    await this.fetchSource(stream.streamUrl, this.filename(stream.originalUrl));
  }
  private filename(url: string) {
    try { const path = new URL(url).pathname; return decodeURIComponent(path.split('/').pop() || 'Document.pdf'); }
    catch { return 'Document.pdf'; }
  }
  private async fetchSource(url: string, title = this.filename(url)) {
    if (!this.streamContext) {
      try { if (!['https:', 'http:', 'file:'].includes(new URL(url).protocol)) throw new Error(); }
      catch { this.showState('Unable to open this link.', 'Choose a PDF from your device instead.', false); return; }
      this.sourceUrl = url;
    }
    this.downloadAbort?.abort();
    const controller = new AbortController(); this.downloadAbort = controller;
    this.showState('Bringing your pages in…', 'Downloading the document. Rendering happens on your device.', true);
    try {
      const response = await fetch(url, { credentials: 'include', signal: controller.signal });
      if (!response.ok) throw new Error(`The PDF could not be downloaded (${response.status}).`);
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      await this.open(blob, title);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.showState('This document couldn’t be opened.', error instanceof Error ? error.message : 'The source is unavailable.', false);
    }
  }
  private endSession() {
    this.epoch++; this.searchEpoch++;
    this.scheduler?.stop(); this.engine?.dispose(); this.engine = undefined; this.info = undefined;
    this.cache.clear(); this.words.clear(); this.links.clear();
    for (const view of this.views.values()) { view.canvas.width = 0; view.canvas.height = 0; view.element.remove(); }
    this.views.clear(); this.thumbnailViews.clear(); $('#thumbnails').replaceChildren();
    clearTimeout(this.zoomTimer); clearTimeout(this.searchTimer); cancelAnimationFrame(this.frame); this.frame = 0;
    this.sessionErrors.clear(); this.firstPaint = false;
  }
  private async open(blob: Blob, title: string, password = '') {
    this.downloadAbort?.abort(); this.downloadAbort = undefined;
    this.endSession();
    const epoch = this.epoch;
    this.blob = blob; this.title = title; this.rotation = 0; this.currentPage = 1;
    this.matches = []; this.query = ''; $('#find-bar').hidden = true; $<HTMLInputElement>('#find-input').value = '';
    $('#more-menu').hidden = true;
    this.showState('Opening your document…', 'Starting the Poppler rendering engine.', true);
    this.openedAt = performance.now();
    const engine = new PdfEngine(); this.engine = engine;
    try {
      await engine.initialize();
      if (epoch !== this.epoch) return;
      const info = await engine.open(await blob.arrayBuffer(), password);
      if (epoch !== this.epoch) return;
      this.info = info;
      this.scheduler = new RenderScheduler((error) => { if (epoch === this.epoch) this.toast(error instanceof Error ? error.message : 'Unable to render a page.'); });
      $<HTMLDialogElement>('#password-dialog').close(); $<HTMLInputElement>('#password').value = '';
      $('#filename').textContent = title; $('#filename').title = title;
      $('#file-detail').textContent = `${this.info.count} pages · ${formatSize(blob.size)}`;
      $('#page-count').textContent = String(this.info.count);
      $<HTMLInputElement>('#page-number').max = String(this.info.count);
      document.title = `${title} — Folio`;
      document.querySelectorAll<HTMLElement>('.document-only').forEach((el) => el.hidden = false);
      document.querySelectorAll<HTMLButtonElement>('[data-needs-document]').forEach((el) => el.disabled = false);
      $<HTMLButtonElement>('#find-toggle').disabled = !this.info.canCopy;
      $<HTMLButtonElement>('#print').disabled = !this.info.canPrint;
      $<HTMLButtonElement>('#native').disabled = !this.sourceUrl;
      $('#welcome').hidden = true; $('#state').hidden = true; $('#viewport').hidden = false; $('#statusbar').hidden = false;
      $('#viewport').scrollTop = 0;
      this.zoom(this.zoomMode, false);
      this.update();
      if (!$('#sidebar').hidden) this.updateThumbnails();
      // Outline extraction goes behind visible rendering.
      this.scheduler.enqueue('outline', 500, async () => {
        const outline = await engine.outline(); if (epoch === this.epoch) this.showOutline(outline);
      });
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (error instanceof Error && error.name === 'PasswordRequired') {
        $('#password-error').textContent = password ? 'That password didn’t unlock this document.' : '';
        const dialog = $<HTMLDialogElement>('#password-dialog');
        if (!dialog.open) dialog.showModal();
        $<HTMLInputElement>('#password').value = ''; $('#password').focus();
        this.showState('This PDF is password protected.', 'Unlock it to start reading.', false);
      } else this.showState('This document couldn’t be opened.', error instanceof Error ? error.message : 'Please try another PDF.', false);
    }
  }
  private showState(title: string, detail: string, loading: boolean) {
    $('#welcome').hidden = true; $('#viewport').hidden = true; $('#sidebar').hidden = true; $('#state').hidden = false; $('#statusbar').hidden = true;
    $('#state-title').textContent = title; $('#state-detail').textContent = detail;
    $('#state-icon').innerHTML = loading ? '<span class="spinner"></span>' : icon('file', 26);
    $('.state-actions').hidden = loading;
    $('#state-native').hidden = !this.sourceUrl;
    document.querySelectorAll<HTMLElement>('.document-only').forEach((el) => el.hidden = true);
    document.querySelectorAll<HTMLButtonElement>('[data-needs-document]').forEach((el) => el.disabled = true);
  }
  private zoom(mode: string, delayed = true) {
    if (!this.info) return;
    this.zoomMode = mode;
    const select = $<HTMLSelectElement>('#zoom');
    if (mode !== 'width' && mode !== 'page' && ![...select.options].some((option) => option.value === mode)) {
      select.querySelector('[data-custom]')?.remove();
      const option = new Option(`${Math.round(Number(mode) * 100)}%`, mode); option.dataset.custom = ''; select.add(option);
    }
    select.value = mode;
    this.relayout(true);
    clearTimeout(this.zoomTimer);
    this.zoomTimer = window.setTimeout(() => this.update(), delayed ? 120 : 0);
  }
  private relayout(preserve: boolean) {
    if (!this.info) return;
    const viewport = $('#viewport');
    const anchor = this.layout ? this.layout.pageAt(viewport.scrollTop + 1) : 0;
    const fraction = this.layout ? (viewport.scrollTop - this.layout.offsets[anchor]) / this.layout.sizes[anchor].height : 0;
    const page = this.info.pages[Math.min(this.currentPage - 1, this.info.count - 1)];
    const width = this.rotation % 180 ? page.height : page.width;
    const height = this.rotation % 180 ? page.width : page.height;
    if (this.zoomMode === 'width') this.scale = Math.min(4, Math.max(0.1, (viewport.clientWidth - 80) / width));
    else if (this.zoomMode === 'page') this.scale = Math.min((viewport.clientWidth - 80) / width, (viewport.clientHeight - 64) / height, 4);
    else this.scale = Math.min(4, Math.max(0.25, Number(this.zoomMode) || 1));
    this.layout = new PageLayout(this.info.pages, this.scale, this.rotation);
    const pages = $('#pages'); pages.style.height = `${this.layout.totalHeight}px`; pages.style.minWidth = `${this.layout.maxWidth + 80}px`;
    if (preserve) viewport.scrollTop = this.layout.offsets[anchor] + fraction * this.layout.sizes[anchor].height;
    for (const [index, view] of this.views) this.position(index, view);
    this.updateSoon();
  }
  private rotate() {
    if (!this.info) return;
    this.rotation = (this.rotation + 90) % 360;
    this.words.clear(); this.links.clear(); this.cache.clear();
    for (const view of this.views.values()) { view.text.replaceChildren(); view.links.replaceChildren(); }
    this.relayout(true); this.update();
    if (this.query) this.startSearch();
    this.thumbnailViews.clear(); $('#thumbnails').replaceChildren(); this.updateThumbnails();
  }
  private position(index: number, view: PageView) {
    const size = this.layout!.sizes[index];
    view.element.style.width = `${size.width}px`; view.element.style.height = `${size.height}px`;
    view.element.style.transform = `translateY(${this.layout!.offsets[index]}px)`;
    // Existing raster remains a cheap preview while a new zoom render is queued.
  }
  private updateSoon() { if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.update(); }); }
  private update() {
    if (!this.info || !this.layout || !this.engine || !this.scheduler || $('#viewport').hidden) return;
    const viewport = $('#viewport');
    const indices = this.layout.window(viewport.scrollTop, viewport.clientHeight, Math.min(700, viewport.clientHeight));
    const wanted = new Set(indices);
    this.currentPage = this.layout.pageAt(viewport.scrollTop + Math.min(200, viewport.clientHeight * 0.25)) + 1;
    const pageInput = $<HTMLInputElement>('#page-number');
    if (document.activeElement !== pageInput) pageInput.value = String(this.currentPage);
    $<HTMLButtonElement>('#previous').disabled = this.currentPage === 1;
    $<HTMLButtonElement>('#next').disabled = this.currentPage === this.info.count;
    $('#position-status').textContent = `Page ${this.currentPage} of ${this.info.count}`;
    for (const [index, view] of this.views) if (!wanted.has(index)) {
      view.canvas.width = 0; view.canvas.height = 0; view.element.remove(); this.views.delete(index);
    }
    const wantedKeys = new Set(['outline']);
    const epoch = this.epoch;
    for (const index of indices.sort((a, b) => Math.abs(a + 1 - this.currentPage) - Math.abs(b + 1 - this.currentPage))) {
      let view = this.views.get(index);
      if (!view) {
        const element = document.createElement('article'); element.className = 'pdf-page'; element.dataset.page = String(index + 1); element.setAttribute('aria-label', `Page ${index + 1}`);
        element.innerHTML = `<span class="page-placeholder">${index + 1}</span><canvas aria-label="PDF page ${index + 1}"></canvas><div class="text-layer"></div><div class="link-layer"></div>`;
        view = { element, canvas: element.querySelector('canvas')!, text: element.querySelector('.text-layer')!, links: element.querySelector('.link-layer')!, key: '' };
        $('#pages').append(element); this.views.set(index, view);
      }
      this.position(index, view);
      const rasterScale = renderScale(this.scale, devicePixelRatio, this.info.pages[index]);
      const key = `page:${index}:${rasterScale.toFixed(4)}:${this.rotation}`;
      wantedKeys.add(key);
      const cached = this.cache.get(key);
      if (cached && view.key !== key) this.paint(view, key, cached);
      if (!cached && view.key !== key && !this.sessionErrors.has(index)) {
        const target = view, rotation = this.rotation;
        this.scheduler.enqueue(key, Math.abs(index + 1 - this.currentPage) * 10, async () => {
          try {
            const raster = await this.engine!.render(index + 1, rasterScale, rotation);
            if (epoch !== this.epoch) { raster.bitmap.close(); return; }
            const live = this.views.get(index);
            const stillWanted = this.rotation === rotation && renderScale(this.scale, devicePixelRatio, this.info!.pages[index]).toFixed(4) === rasterScale.toFixed(4);
            if (live === target && stillWanted) this.paint(target, key, raster);
            this.cache.set(key, raster, raster.width * raster.height * 4);
            $('#render-status').textContent = `Cache ${(this.cache.bytes / 1_048_576).toFixed(0)} / 96 MB`;
          } catch (error) {
            if (epoch === this.epoch) { this.sessionErrors.add(index); target.element.querySelector('.page-placeholder')!.textContent = `Page ${index + 1} could not be rendered`; }
            throw error;
          }
        });
      }
      const textKey = `text:${index}:${this.rotation}`;
      const linkKey = `links:${index}:${this.rotation}`;
      wantedKeys.add(textKey); wantedKeys.add(linkKey);
      const words = this.words.get(textKey);
      if (words) this.paintText(index, view, words);
      else if (this.info.canCopy) {
        const rotation = this.rotation;
        this.scheduler.enqueue(textKey, 100 + Math.abs(index + 1 - this.currentPage), async () => {
          const words = await this.engine!.text(index + 1, rotation);
          if (epoch !== this.epoch) return;
          this.words.set(textKey, words, JSON.stringify(words).length * 2);
          const live = this.views.get(index); if (live && this.rotation === rotation) this.paintText(index, live, words);
        });
      }
      const links = this.links.get(linkKey);
      if (links) this.paintLinks(view, links);
      else {
        const rotation = this.rotation;
        this.scheduler.enqueue(linkKey, 200, async () => {
          const links = await this.engine!.links(index + 1, rotation);
          if (epoch !== this.epoch) return;
          this.links.set(linkKey, links, JSON.stringify(links).length * 2);
          const live = this.views.get(index); if (live && this.rotation === rotation) this.paintLinks(live, links);
        });
      }
    }
    this.scheduler.retain((key) => wantedKeys.has(key) || key.startsWith('search:') && key === `search:${this.searchEpoch}:${this.searchPage}` || key.startsWith('thumb:') && !$('#sidebar').hidden);
    this.updateThumbnails();
  }
  private paint(view: PageView, key: string, raster: Raster) {
    view.canvas.width = raster.width; view.canvas.height = raster.height;
    view.canvas.getContext('2d', { alpha: false })!.drawImage(raster.bitmap, 0, 0);
    view.key = key; view.element.classList.add('rendered');
    if (!this.firstPaint) { this.firstPaint = true; this.firstPageMilliseconds = performance.now() - this.openedAt; }
  }
  private paintText(index: number, view: PageView, words: TextWord[]) {
    const key = `${this.rotation}:${this.scale}:${this.query}:${this.matchIndex}`;
    if (view.text.dataset.key === key) return;
    view.text.dataset.key = key;
    const fragment = document.createDocumentFragment();
    const active = this.matches[this.matchIndex];
    words.forEach((word, wordIndex) => {
      if (!word.text || word.width <= 0 || word.height <= 0) return;
      const span = document.createElement('span'); span.textContent = word.text + ' '; span.dataset.word = String(wordIndex);
      const width = word.width * this.scale, height = word.height * this.scale;
      span.style.left = `${word.x * this.scale}px`; span.style.top = `${word.y * this.scale}px`;
      span.style.width = `${width}px`; span.style.height = `${height}px`; span.style.fontSize = `${height * 0.85}px`;
      if (word.rotation === 90 || word.rotation === 270) span.style.writingMode = word.rotation === 90 ? 'vertical-rl' : 'vertical-lr';
      if (this.query && this.matches.some((match) => match.page === index + 1 && wordIndex >= match.first && wordIndex <= match.last)) span.classList.add('found-word');
      if (active && active.page === index + 1 && wordIndex >= active.first && wordIndex <= active.last) span.classList.add('active-match');
      fragment.append(span);
    });
    view.text.replaceChildren(fragment);
  }
  private paintLinks(view: PageView, links: PdfLink[]) {
    const key = `${this.rotation}:${this.scale}`;
    if (view.links.dataset.key === key) return;
    view.links.dataset.key = key;
    const fragment = document.createDocumentFragment();
    for (const link of links) {
      const a = document.createElement('a');
      if (link.page) { a.href = '#'; a.setAttribute('aria-label', `Go to page ${link.page}`); a.onclick = (event) => { event.preventDefault(); this.go(link.page); }; }
      else {
        try {
          const url = new URL(link.url, this.sourceUrl || undefined);
          if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) continue;
          a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.setAttribute('aria-label', url.protocol === 'mailto:' ? 'Send email' : 'Open document link');
        } catch { continue; }
      }
      a.style.left = `${link.x * this.scale}px`; a.style.top = `${link.y * this.scale}px`;
      a.style.width = `${link.width * this.scale}px`; a.style.height = `${link.height * this.scale}px`;
      fragment.append(a);
    }
    view.links.replaceChildren(fragment);
  }
  private go(page: number) {
    if (!this.layout || !this.info) return;
    page = Math.max(1, Math.min(this.info.count, Math.round(page || 1)));
    this.currentPage = page; $<HTMLInputElement>('#page-number').value = String(page);
    $('#viewport').scrollTop = this.layout.offsets[page - 1]; this.update();
  }
  private toggleSidebar() {
    if (!this.info) return;
    $('#sidebar').hidden = !$('#sidebar').hidden;
    $('#sidebar-toggle').setAttribute('aria-pressed', String(!$('#sidebar').hidden));
    this.relayout(true); this.updateThumbnails();
  }
  private sidebarTab(tab: 'pages' | 'outline') {
    $('#thumbnails').hidden = tab !== 'pages'; $('#outline').hidden = tab !== 'outline';
    $('#tab-pages').classList.toggle('active', tab === 'pages'); $('#tab-outline').classList.toggle('active', tab === 'outline');
    if (tab === 'pages') this.updateThumbnails();
  }
  private updateThumbnails() {
    if (!this.info || !this.engine || !this.scheduler || $('#sidebar').hidden || $('#thumbnails').hidden) return;
    const container = $('#thumbnails'); const rowHeight = 190;
    container.style.setProperty('--thumbnail-height', `${this.info.count * rowHeight}px`);
    const first = Math.max(0, Math.floor(container.scrollTop / rowHeight) - 1);
    const last = Math.min(this.info.count - 1, Math.ceil((container.scrollTop + container.clientHeight) / rowHeight) + 1);
    const wanted = new Set<string>(); const epoch = this.epoch;
    for (const [index, button] of this.thumbnailViews) if (index < first || index > last) { const canvas = button.querySelector('canvas'); if (canvas) { canvas.width = 0; canvas.height = 0; } button.remove(); this.thumbnailViews.delete(index); }
    for (let index = first; index <= last; index++) {
      const key = `thumb:${index}:${this.rotation}`; wanted.add(key);
      let thumbnail = this.thumbnailViews.get(index);
      if (!thumbnail) {
        thumbnail = document.createElement('button'); thumbnail.className = 'thumbnail'; thumbnail.setAttribute('aria-label', `Go to page ${index + 1}`);
        thumbnail.style.top = `${index * rowHeight}px`; thumbnail.innerHTML = `<span class="thumbnail-paper"><canvas></canvas></span><span>${index + 1}</span>`;
        thumbnail.onclick = () => this.go(index + 1); container.append(thumbnail); this.thumbnailViews.set(index, thumbnail);
      }
      thumbnail.classList.toggle('active', index + 1 === this.currentPage);
      if (thumbnail.dataset.rendered) continue;
      const target = thumbnail, rotation = this.rotation;
      this.scheduler.enqueue(key, 300 + index - first, async () => {
        const size = this.info!.pages[index];
        const raster = await this.engine!.render(index + 1, Math.min(130 / size.width, 148 / size.height), rotation);
        try {
          if (epoch !== this.epoch || this.thumbnailViews.get(index) !== target || this.rotation !== rotation) return;
          const canvas = target.querySelector('canvas')!; canvas.width = raster.width; canvas.height = raster.height;
          canvas.getContext('2d', { alpha: false })!.drawImage(raster.bitmap, 0, 0); target.dataset.rendered = 'true';
        } finally { raster.bitmap.close(); }
      });
    }
    this.scheduler.retain((key) => !key.startsWith('thumb:') || wanted.has(key));
  }
  private showOutline(items: OutlineItem[]) {
    const container = $('#outline'); container.replaceChildren();
    if (!items.length) { const empty = document.createElement('p'); empty.className = 'sidebar-empty'; empty.textContent = 'This document has no bookmarks.'; container.append(empty); return; }
    const append = (items: OutlineItem[], depth = 0) => {
      for (const item of items) {
        const entry = document.createElement('button'); entry.textContent = item.title; entry.title = item.title; entry.style.paddingLeft = `${18 + depth * 12}px`; entry.disabled = !item.page; entry.onclick = () => this.go(item.page); container.append(entry);
        append(item.children, depth + 1);
      }
    };
    append(items);
  }
  private toggleFind(show = $('#find-bar').hidden) {
    if (!this.info?.canCopy) return;
    $('#find-bar').hidden = !show;
    if (show) { $('#find-input').focus(); $<HTMLInputElement>('#find-input').select(); }
    else { this.query = ''; this.matches = []; this.searchEpoch++; this.update(); $('#viewport').focus(); }
  }
  private startSearch() {
    if (!this.info) return;
    this.searchEpoch++; this.query = $<HTMLInputElement>('#find-input').value.trim().toLocaleLowerCase();
    this.matches = []; this.matchIndex = -1; this.searchPage = 1; this.searchComplete = false;
    $('#find-count').textContent = this.query ? 'Searching…' : '';
    this.update(); if (this.query) this.scanNext();
  }
  private scanNext() {
    if (!this.query || !this.info || !this.scheduler || !this.engine) return;
    const generation = this.searchEpoch, epoch = this.epoch, page = this.searchPage, rotation = this.rotation;
    if (page > this.info.count) { this.searchComplete = true; this.searchCount(); return; }
    this.scheduler.enqueue(`search:${generation}:${page}`, 400, async () => {
      const words = this.words.get(`text:${page - 1}:${rotation}`) || await this.engine!.text(page, rotation);
      if (generation !== this.searchEpoch || epoch !== this.epoch) return;
      const text = words.map((word) => word.text.toLocaleLowerCase()).join(' ');
      const offsets: number[] = []; let offset = 0;
      for (const word of words) { offsets.push(offset); offset += word.text.toLocaleLowerCase().length + 1; }
      let at = 0;
      while ((at = text.indexOf(this.query, at)) !== -1) {
        let first = 0, last = 0;
        for (let i = 0; i < offsets.length; i++) { if (offsets[i] <= at) first = i; if (offsets[i] < at + this.query.length) last = i; }
        this.matches.push({ page, first, last }); at += Math.max(1, this.query.length);
        if (this.matches.length >= 10000) break;
      }
      if (this.matchIndex < 0 && this.matches.length) { this.matchIndex = 0; this.go(this.matches[0].page); }
      this.searchPage++; this.searchCount(); this.update();
      if (this.matches.length >= 10000) { this.searchComplete = true; this.searchCount(); return; }
      this.scanNext();
    });
  }
  private searchCount() {
    $('#find-count').textContent = this.matches.length ? `${this.matchIndex + 1} / ${this.matches.length}${this.searchComplete ? '' : '+'}` : this.searchComplete ? 'No matches' : 'Searching…';
  }
  private nextMatch(direction: number) {
    if (!this.matches.length) return;
    this.matchIndex = (this.matchIndex + direction + this.matches.length) % this.matches.length;
    const match = this.matches[this.matchIndex]; this.go(match.page); this.searchCount(); this.update();
    const view = this.views.get(match.page - 1); const word = view?.text.querySelector<HTMLElement>(`[data-word="${match.first}"]`);
    if (word && this.layout) { const y = this.layout.offsets[match.page - 1] + parseFloat(word.style.top); $('#viewport').scrollTop = Math.max(0, y - $('#viewport').clientHeight / 3); this.update(); }
  }
  private download() {
    if (!this.blob) return;
    const url = URL.createObjectURL(this.blob); const a = document.createElement('a');
    a.href = url; a.download = this.title || 'Document.pdf'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  private async print() {
    if (!this.blob || !this.info?.canPrint) return;
    // Printing uses the original PDF in the browser's print engine. Preparing
    // canvases for every page would defeat our bounded-memory rendering policy.
    const url = URL.createObjectURL(new Blob([this.blob], { type: 'application/pdf' }));
    try {
      if (inExtension()) {
        if (mimeHandler()) await chrome.storage.session.set({ ['native-copy:' + url]: Date.now() });
        await chrome.tabs.create({ url });
      } else window.open(url, '_blank', 'noopener');
      this.toast('Print from the browser viewer’s toolbar, or press Ctrl+P there.');
    } catch { this.toast('The print viewer could not be opened. Download the PDF to print it.'); }
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }
  private async native() {
    if (this.streamContext && mimeHandler()) {
      try { await mimeHandler()!.abortAndFallbackToNativeHandler(); } catch { this.toast('The browser viewer could not be opened.'); }
    } else if (this.sourceUrl && inExtension()) {
      try { await chrome.runtime.sendMessage({ type: 'open-native', url: this.sourceUrl }); }
      catch { this.toast('The browser viewer could not be opened.'); }
    } else if (this.sourceUrl) location.href = this.sourceUrl;
  }
  private toast(message: string) {
    $('#toast').textContent = message; $('#toast').hidden = false;
    clearTimeout(this.toastTimer); this.toastTimer = window.setTimeout(() => $('#toast').hidden = true, 5000);
  }
  private keyboard(event: KeyboardEvent) {
    const input = (event.target as Element).closest('input, textarea, select, [contenteditable]');
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'o') { event.preventDefault(); $('#file-input').click(); return; }
    if (event.key === 'Escape') { $('#more-menu').hidden = true; if (!$('#find-bar').hidden) this.toggleFind(false); return; }
    if (!this.info || $<HTMLDialogElement>('#password-dialog').open) return;
    if (modifier && event.key.toLowerCase() === 'f') { event.preventDefault(); this.toggleFind(true); return; }
    if (modifier && event.key.toLowerCase() === 'p') { event.preventDefault(); void this.print(); return; }
    if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); this.download(); return; }
    if (input) return;
    if (event.key === '+' || event.key === '=') { event.preventDefault(); $('#zoom-in').click(); }
    else if (event.key === '-') { event.preventDefault(); $('#zoom-out').click(); }
    else if (event.key.toLowerCase() === 'r') this.rotate();
    else if (event.key.toLowerCase() === 's' && !modifier) this.toggleSidebar();
    else if (event.key === 'ArrowLeft') this.go(this.currentPage - 1);
    else if (event.key === 'ArrowRight') this.go(this.currentPage + 1);
    else if (event.key === 'Home') { event.preventDefault(); this.go(1); }
    else if (event.key === 'End') { event.preventDefault(); this.go(this.info.count); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'PageDown' || event.key === 'PageUp' || event.key === ' ') {
      event.preventDefault(); const amount = event.key.startsWith('Arrow') ? 60 : $('#viewport').clientHeight * 0.85;
      $('#viewport').scrollTop += (event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === ' ' && event.shiftKey ? -1 : 1) * amount;
    }
  }
}

new Viewer();
