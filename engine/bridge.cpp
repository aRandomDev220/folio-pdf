// SPDX-License-Identifier: GPL-2.0-or-later
// Folio's deliberately small C ABI. Poppler never runs on the UI thread.
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
#include "poppler/Annot.h"
#include "poppler/GlobalParams.h"
#include "poppler/Link.h"
#include "poppler/Outline.h"
#include "poppler/PDFDoc.h"
#include "poppler/SplashOutputDev.h"
#include "poppler/TextOutputDev.h"
#include "splash/SplashBitmap.h"
#include "goo/GooString.h"

namespace {
struct Document {
    std::unique_ptr<char, decltype(&std::free)> bytes { nullptr, std::free };
    std::unique_ptr<PDFDoc> pdf;
    std::unique_ptr<SplashOutputDev> renderer;
    std::vector<unsigned char> pixels;
};
std::unique_ptr<Document> document;
std::string output;
std::string lastError;

std::string quote(const std::string &text) {
    std::ostringstream s;
    s << '"';
    for (const unsigned char c : text) {
        switch (c) {
            case '"': s << "\\\""; break;
            case '\\': s << "\\\\"; break;
            case '\n': s << "\\n"; break;
            case '\r': s << "\\r"; break;
            case '\t': s << "\\t"; break;
            default:
                if (c < 32) {
                    const char hex[] = "0123456789abcdef";
                    s << "\\u00" << hex[c >> 4] << hex[c & 15];
                } else s << c;
        }
    }
    s << '"';
    return s.str();
}
std::string utf8(const std::vector<Unicode> &chars) {
    std::string s;
    for (auto c : chars) {
        if (c < 0x80) s += char(c);
        else if (c < 0x800) { s += char(0xc0 | (c >> 6)); s += char(0x80 | (c & 63)); }
        else if (c < 0x10000) { s += char(0xe0 | (c >> 12)); s += char(0x80 | ((c >> 6) & 63)); s += char(0x80 | (c & 63)); }
        else { s += char(0xf0 | (c >> 18)); s += char(0x80 | ((c >> 12) & 63)); s += char(0x80 | ((c >> 6) & 63)); s += char(0x80 | (c & 63)); }
    }
    return s;
}
PDFDoc &pdf() {
    if (!document) throw std::runtime_error("No document is open.");
    return *document->pdf;
}
void checkPage(int page) {
    if (page < 1 || page > pdf().getNumPages()) throw std::runtime_error("Page is out of range.");
}
int destination(const LinkAction *action) {
    if (!action || action->getKind() != actionGoTo) return 0;
    const auto go = static_cast<const LinkGoTo *>(action);
    auto named = go->getNamedDest() ? pdf().findDest(go->getNamedDest()) : nullptr;
    const auto dest = go->getDest() ? go->getDest() : named.get();
    if (!dest || !dest->isOk()) return 0;
    return dest->isPageRef() ? pdf().findPage(dest->getPageRef()) : dest->getPageNum();
}
template <typename F> const char *json(F function) {
    try { output = function(); return output.c_str(); }
    catch (const std::exception &e) { lastError = e.what(); return nullptr; }
    catch (...) { lastError = "Poppler could not process this document."; return nullptr; }
}
void outlineItems(std::ostringstream &s, const std::vector<OutlineItem *> *items, int depth, int &remaining) {
    s << '[';
    bool comma = false;
    if (items && depth < 32) for (auto item : *items) {
        if (--remaining < 0) break;
        if (comma) s << ',';
        comma = true;
        s << "{\"title\":" << quote(utf8(item->getTitle())) << ",\"page\":" << destination(item->getAction()) << ",\"children\":";
        item->open();
        outlineItems(s, item->getKids(), depth + 1, remaining);
        s << '}';
    }
    s << ']';
}
}

extern "C" {
// Takes ownership of the malloc'd buffer on both success and failure.
int folio_open(char *bytes, int length, const char *password) {
    document.reset();
    auto next = std::make_unique<Document>();
    next->bytes.reset(bytes);
    try {
        if (!bytes || length < 8) throw std::runtime_error("This file is empty or is not a PDF.");
        if (!globalParams) {
            globalParams = std::make_unique<GlobalParams>("/poppler-data");
            globalParams->setErrQuiet(true);
            const char *names[] = {"Courier", "Courier-Bold", "Courier-BoldOblique", "Courier-Oblique", "Helvetica", "Helvetica-Bold", "Helvetica-BoldOblique", "Helvetica-Oblique", "Symbol", "Times-Bold", "Times-BoldItalic", "Times-Italic", "Times-Roman", "ZapfDingbats"};
            const char *files[] = {"NimbusMonoPS-Regular", "NimbusMonoPS-Bold", "NimbusMonoPS-BoldItalic", "NimbusMonoPS-Italic", "NimbusSans-Regular", "NimbusSans-Bold", "NimbusSans-BoldItalic", "NimbusSans-Italic", "StandardSymbolsPS", "NimbusRoman-Bold", "NimbusRoman-BoldItalic", "NimbusRoman-Italic", "NimbusRoman-Regular", "D050000L"};
            for (int i = 0; i < 14; ++i) globalParams->addFontFile(names[i], std::string("/fonts/") + files[i] + ".otf");
        }
        std::optional<GooString> pass;
        if (password && *password) pass.emplace(password);
        next->pdf = std::make_unique<PDFDoc>(std::make_unique<MemStream>(bytes, 0, length, Object::null()), pass, pass);
        if (!next->pdf->isOk()) {
            if (next->pdf->getErrorCode() == errEncrypted) { lastError = "PASSWORD_REQUIRED"; return -2; }
            throw std::runtime_error("This PDF is damaged or uses an unsupported format.");
        }
        if (next->pdf->getNumPages() < 1) throw std::runtime_error("This PDF has no pages.");
        SplashColor paper;
        std::fill(std::begin(paper), std::end(paper), 255);
        next->renderer = std::make_unique<SplashOutputDev>(splashModeRGB8, 1, paper, true);
        next->renderer->startDoc(next->pdf.get());
        document = std::move(next);
        lastError.clear();
        return 1;
    } catch (const std::exception &e) { lastError = e.what(); return -1; }
    catch (...) { lastError = "Unable to open this PDF."; return -1; }
}
void folio_close() { document.reset(); output.clear(); }
const char *folio_error() { return lastError.c_str(); }
const char *folio_info() { return json([] {
    std::ostringstream s;
    s << "{\"count\":" << pdf().getNumPages() << ",\"canCopy\":" << (pdf().okToCopy() ? "true" : "false")
      << ",\"canPrint\":" << (pdf().okToPrint() ? "true" : "false") << '}';
    return s.str();
}); }
const char *folio_page_info(int first, int count) { return json([&] {
    std::ostringstream s; s << '[';
    checkPage(first);
    for (int page = first; page < std::min(first + std::max(0, count), pdf().getNumPages() + 1); ++page) {
        if (page != first) s << ',';
        double width = pdf().getPageCropWidth(page), height = pdf().getPageCropHeight(page);
        const int rotation = pdf().getPageRotate(page);
        if (rotation % 180 != 0) std::swap(width, height);
        if (!std::isfinite(width) || !std::isfinite(height) || width <= 0 || height <= 0) { width = 612; height = 792; }
        s << "{\"width\":" << width << ",\"height\":" << height << '}';
    }
    s << ']'; return s.str();
}); }
const char *folio_render(int page, double scale, int rotation) { return json([&] {
    checkPage(page);
    if (!std::isfinite(scale) || scale <= 0 || scale > 16 || rotation % 90 != 0) throw std::runtime_error("Invalid render scale or rotation.");
    double w = pdf().getPageCropWidth(page), h = pdf().getPageCropHeight(page);
    if ((rotation + pdf().getPageRotate(page)) % 180 != 0) std::swap(w, h);
    // Hard cap engine allocations independently of any UI settings.
    if (std::ceil(w * scale) * std::ceil(h * scale) > 12000000) scale = std::sqrt(11900000 / (w * h));
    pdf().displayPage(document->renderer.get(), page, scale * 72, scale * 72, rotation, false, true, false);
    auto bitmap = document->renderer->getBitmap();
    const int width = bitmap->getWidth(), height = bitmap->getHeight();
    if (width <= 0 || height <= 0 || double(width) * height > 12000000) throw std::runtime_error("This page is too large to render.");
    auto &pixels = document->pixels;
    pixels.resize(size_t(width) * height * 4);
    const auto rgb = bitmap->getDataPtr();
    for (int y = 0; y < height; ++y) {
        const auto row = rgb + y * bitmap->getRowSize();
        auto dst = pixels.data() + size_t(y) * width * 4;
        for (int x = 0; x < width; ++x) {
            dst[x * 4] = row[x * 3]; dst[x * 4 + 1] = row[x * 3 + 1];
            dst[x * 4 + 2] = row[x * 3 + 2]; dst[x * 4 + 3] = 255;
        }
    }
    return "{\"width\":" + std::to_string(width) + ",\"height\":" + std::to_string(height) + '}';
}); }
const unsigned char *folio_pixels() { return document ? document->pixels.data() : nullptr; }
int folio_pixel_length() { return document ? int(document->pixels.size()) : 0; }
const char *folio_text(int page, int rotation) { return json([&] {
    checkPage(page);
    if (!pdf().okToCopy()) return std::string("[]");
    TextOutputDev device(nullptr, false, 0, false, false);
    pdf().displayPage(&device, page, 72, 72, rotation, false, true, false);
    auto words = device.makeWordList();
    std::ostringstream s; s << '['; bool comma = false;
    for (auto word : words->getWords()) {
        if (comma) s << ','; comma = true;
        const auto bounds = word->getBBox();
        auto text = word->getText();
        s << "{\"text\":" << quote(text ? *text : std::string()) << ",\"x\":" << bounds.x1
          << ",\"y\":" << bounds.y1 << ",\"width\":" << bounds.x2 - bounds.x1
          << ",\"height\":" << bounds.y2 - bounds.y1 << ",\"rotation\":" << word->getRotation() * 90 << '}';
    }
    s << ']'; return s.str();
}); }
const char *folio_links(int page, int rotation) { return json([&] {
    checkPage(page);
    double transform[6];
    pdf().getPage(page)->getDefaultCTM(transform, 72, 72, rotation, false, true);
    auto links = pdf().getLinks(page);
    std::ostringstream s; s << '['; bool comma = false;
    for (auto &link : links->getLinks()) {
        const auto action = link->getAction();
        const int target = destination(action);
        const std::string uri = action && action->getKind() == actionURI ? static_cast<const LinkURI *>(action)->getURI() : std::string();
        if (!target && uri.empty()) continue;
        const auto &rect = link->getRect();
        double xs[4], ys[4];
        const double x[4] = {rect.x1, rect.x1, rect.x2, rect.x2};
        const double y[4] = {rect.y1, rect.y2, rect.y1, rect.y2};
        for (int i = 0; i < 4; ++i) { xs[i] = transform[0] * x[i] + transform[2] * y[i] + transform[4]; ys[i] = transform[1] * x[i] + transform[3] * y[i] + transform[5]; }
        const double left = *std::min_element(xs, xs + 4), top = *std::min_element(ys, ys + 4);
        if (comma) s << ','; comma = true;
        s << "{\"x\":" << left << ",\"y\":" << top << ",\"width\":" << *std::max_element(xs, xs + 4) - left
          << ",\"height\":" << *std::max_element(ys, ys + 4) - top << ",\"page\":" << target << ",\"url\":" << quote(uri) << '}';
    }
    s << ']'; return s.str();
}); }
const char *folio_outline() { return json([] {
    std::ostringstream s; int remaining = 10000;
    const auto outline = pdf().getOutline();
    outlineItems(s, outline ? outline->getItems() : nullptr, 0, remaining);
    return s.str();
}); }
}
