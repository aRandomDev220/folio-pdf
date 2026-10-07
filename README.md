# Folio

A minimalist Chromium PDF viewer built around **Poppler 26.10.0**, compiled to WebAssembly. The interface, rendering scheduler, virtualized page layout, cache, text/link overlays, and extension integration are custom implementations.

## Install the built extension

1. Open your browser’s extensions page (`chrome://extensions`, `edge://extensions`, `brave://extensions`, etc.).
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this project’s **`dist/`** folder.
4. Open a PDF link. Click the Folio extension icon to open a file picker instead.

The compiled build is generated locally in `dist/`. From a fresh clone, run `npm ci` followed by `npm run build`; the bundled Poppler engine assets are included in the repository. For legacy browsers, enable **Allow access to file URLs** on the extension details page to replace the viewer for `file://` PDFs. File selection and drag-and-drop work without that setting.

`npm run release` generates `releases/folio-0.1.0.zip`, the packaged extension. Extract it before choosing Load unpacked. The accompanying `folio-0.1.0-source.tar.gz` contains the application and corresponding native dependency sources. Release archives are generated locally and are excluded from Git.

## What works

- Automatic PDF takeover, including embedded frames and POST responses when native MIME handling is available.
- Local file picker, drag-and-drop, remote PDFs, and password-protected documents.
- Continuous scrolling, page jumps, zoom, fit width/page, and rotation.
- Compact 40px toolbar to leave more vertical space for the document.
- Lazy thumbnails and document bookmarks.
- Selectable text, incremental text search, internal links, and external links.
- Original-byte download. Printing opens the original PDF in a separate native-viewer tab; use its toolbar or Ctrl+P there.
- Neutral black theme by default, with a saved monochrome light-theme option and an automatic-opening switch in the More menu.
- The Folio home button returns to the file picker in place and releases the current document’s rendering resources.
- Clear invalid-document and unavailable-source states, with native-viewer fallback for remotely opened PDFs.

Everything is processed on the device. Documents are not uploaded, and there is no analytics service or remote executable code. Search uses the PDF’s existing text; scanned images without a text layer are not OCR’d.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl/Cmd+O | Open PDF |
| Ctrl/Cmd+F | Find text |
| Enter / Shift+Enter in search | Next / previous match |
| Ctrl/Cmd+S | Download original PDF |
| Ctrl/Cmd+P | Open native print viewer |
| + / − | Zoom |
| Ctrl+wheel | Zoom |
| R | Rotate clockwise |
| S | Toggle sidebar |
| Left / Right | Previous / next page |
| Home / End | First / last page |
| Page Up / Page Down / Space | Scroll |

## Browser compatibility

Targets desktop Chromium browsers with Manifest V3 support, version 120 or newer. The same extension package is intended for Chrome, Edge, Brave, Opera, and Vivaldi; browser-specific installation policies still apply.

**Native path:** feature-detects `chrome.mimeHandler` (documented for Chromium 151+). Registers `application/pdf`, consumes the original response exactly once, preserves its URL, and supports embedded and POST-generated PDFs. Failed documents can be handed back to the built-in viewer.

**Legacy path:** redirects top-level GET navigations to PDF paths, with PDF response-header detection on Chromium 128+. Explicit attachment responses remain downloads where header matching is available. The source is fetched again; authenticated, one-use, and POST-generated sources cannot be guaranteed in this mode. On 120–127, PDF-path interception cannot inspect attachment response headers. The native fallback bypass lasts until that tab closes or Folio is reopened in it.

### Actual verification on Linux

| Browser / path | Result |
| --- | --- |
| Chrome for Testing 151.0.7922.34, packaged extension | Passed: MV3 CSP, local loading, takeover, original URL preservation, POST streams, embedded frames, home/reset and reopening, print handoff, native fallback, attachments |
| Legacy path simulated in an isolated Chromium 151 profile | Passed: actual DNR redirects, signed queries, extensionless responses, attachments, disable switch |
| Brave Origin 154.1.96.61, viewer as a local development page | Passed: rendering, JPEG/JPEG2000, search, bookmarks, rotation, passwords, virtualization, large-image controls |
| Brave unpacked extension via automated CLI loading | Unverified: installed build did not load the extension through automation flags |
| Helium 0.18.3.1 (Chromium 154.0.8037.97), packaged extension and development viewer | Passed all four focused home/theme tests; full run passed 17/19. Signed-query takeover and simulated legacy navigation tests aborted with `net::ERR_ABORTED`; both failures also reproduced with the original green-theme package. |
| Edge, Opera, Vivaldi; Windows/macOS | Not tested in this environment |

## Performance architecture

- Poppler/Splash parsing and rasterization run in a dedicated worker.
- A single outstanding worker task prevents a scroll gesture from creating an unbounded render backlog.
- Visible pages take priority over text extraction, thumbnails, bookmarks, and search.
- Page canvas elements are virtualized; off-screen canvases are zero-sized and removed.
- Raster bitmaps use a **96 MiB LRU budget** with explicit `ImageBitmap.close()` on eviction.
- Text and link caches have separate 8 MiB and 1 MiB budgets.
- Raster resolution is capped at 8 million pixels per page, with a separate 12-million-pixel engine guard. Existing canvases provide a preview during zoom.
- Fonts and character maps are bundled and read lazily by the worker.
- Original file bytes and WASM heap memory are additional to the bitmap cache. The total process memory is not capped at 96 MiB. Documents are fully acquired before the initial Poppler open; progressive network rendering is not implemented in this version.

### Measured baseline

One headless run on this machine used the same **120-page, 38,134,416-byte PDF**, with distinct 1800×2400 JPEG image objects, in a fresh native-viewer profile and a fresh Folio profile at 1440×1000.

| UI scrolling metric | Chromium native | Folio |
| --- | ---: | ---: |
| p95 animation-frame interval | 17.3 ms | 16.9 ms |
| UI frame intervals over 50 ms | 0 | 0 |

Folio mounted two canvases at the end of the run; its raster cache held 95,744,000 bytes, below the 96 MiB budget. The first Folio canvas draw took about 435 ms **after acquiring the document**. Native first-pixel timing and total process/GPU memory were not instrumented. These measurements demonstrate responsive UI on this fixture, **not a proven speed advantage over PDFium**. Real image-heavy documents that exhibit native-viewer lag are the next useful workload.

Reproduce:

```sh
npm run test:codecs:prepare
npm run benchmark
```

The fixture preparation uses Pillow with JPEG2000 support (`python3 -m pip install Pillow` if needed). It is a development-only dependency. Results and screenshots are written to `artifacts/`.

## Build and develop

Requires Node.js 22.18+ (24 recommended), Python 3.12+, CMake 3.28+, a make-compatible build tool, and `patch`. The initial engine build downloads a project-local Emscripten SDK and version-pinned dependency sources. No system-wide SDK installation is performed.

```sh
npm ci
npm run engine:build
npm run build
npm run dev
```

Open the development URL’s `/viewer.html` page. `npm run build` checks TypeScript and creates the loadable extension in `dist/`; it fails if the Poppler artifacts are missing. `npm run engine:build` builds the native engine separately and caches toolchain/dependency outputs in `.build/`.

The engine uses FreeType, IJG libjpeg, OpenJPEG, zlib, and Little CMS. Qt/GTK/Cairo, network-native loading, signing backends, and command-line utilities are omitted. Brotli PDF streams are not enabled in this build. The small libc++ compatibility patch for Poppler’s inline `unique_ptr<Array>` constructor is recorded in `engine/patches/poppler-libcxx.patch`.

### Checks

```sh
npm run check               # TypeScript, unit tests, production build
npx playwright install chromium
npm run test:codecs:prepare # Optional image-codec fixtures; requires Pillow
npm run test:browser        # Real worker rendering and packaged-extension checks
```

Set `FOLIO_BROWSER=/path/to/chromium` to test with a specific executable. If this machine’s existing Chromium test binary is available, the test configuration reuses it. The legacy compatibility test deliberately removes the MIME-handler API from its isolated worker context; it does not modify a real browser profile. Codec tests explicitly skip when their generated fixtures are missing.

No lint command is configured. The implementation is checked by strict TypeScript, focused unit tests and browser integration tests.

### Release

```sh
npm run release
```

Creates the extension ZIP and corresponding source TAR.GZ in `releases/`. Keep both available when distributing the build. The source archive includes native library sources, fonts, character maps, bridge code, the recorded compatibility patch, source hashes and build scripts. Extracted vendor sources are provided for inspection; the normal rebuild script uses its pinned upstream downloads.

## Layout

- `engine/bridge.cpp` — native Poppler/Splash binding, text/link extraction, bookmarks.
- `scripts/build-engine.py` — reproducible local toolchain and native dependency build.
- `src/engine/` — worker transport and resource ownership.
- `src/viewer/` — UI, virtual page layout, render scheduler and bounded caches.
- `src/extension/` — MIME-handler capability selection, legacy interception and fallback.
- `public/` — packaged engine, manifest, fonts, maps and third-party notices.
- `tests/` — deterministic PDF fixtures and meaningful integration checks.

## Licensing and credits

Application and bridge code: **GPL-2.0-or-later**; see `LICENSE`. Poppler is GPL-licensed. Packaged URW font data uses AGPLv3 with its font exception; character maps retain their Adobe/GPL notices. Dependencies retain their own licenses under `public/licenses/` and `dist/licenses/`.

Portions of this software are copyright The FreeType Project (www.freetype.org). This software is based in part on the work of the Independent JPEG Group. Other rendering dependencies are OpenJPEG, zlib and Little CMS. Build provenance is recorded in `public/engine/build.json`.
