import { describe, expect, it } from 'vitest';
import { BudgetCache } from '../../src/viewer/cache';
import { PageLayout, renderScale } from '../../src/viewer/layout';
import { RenderScheduler } from '../../src/viewer/scheduler';
import { legacyRules } from '../../src/extension/rules';

describe('bounded rendering', () => {
  it('releases the least-recent bitmap while retaining reused pages', () => {
    const disposed: string[] = [];
    const cache = new BudgetCache<string>(12, (value) => disposed.push(value));
    cache.set('a', 'page a', 4); cache.set('b', 'page b', 4); cache.set('c', 'page c', 4);
    cache.get('a'); cache.set('d', 'page d', 4);
    expect(disposed).toEqual(['page b']); expect(cache.bytes).toBe(12);
    cache.clear(); expect(cache.bytes).toBe(0); expect(disposed).toHaveLength(4);
  });
  it('drops obsolete queued pages while allowing an in-flight render to finish', async () => {
    const rendered: string[] = [];
    let finish!: () => void;
    const scheduler = new RenderScheduler((error) => { throw error; });
    scheduler.enqueue('page1', 0, async () => { await new Promise<void>((resolve) => finish = resolve); rendered.push('page1'); });
    scheduler.enqueue('page2', 1, async () => { rendered.push('page2'); });
    scheduler.enqueue('page90', 0, async () => { rendered.push('page90'); });
    scheduler.retain((key) => key === 'page90');
    finish(); await new Promise((resolve) => setTimeout(resolve, 10));
    expect(rendered).toEqual(['page1', 'page90']);
    scheduler.stop();
  });
  it('mounts only a small viewport window in a 1000-page document', () => {
    const layout = new PageLayout(Array.from({ length: 1000 }, () => ({ width: 612, height: 792 })), 1, 0);
    expect(layout.pageAt(layout.offsets[800] + 10)).toBe(800);
    expect(layout.window(layout.offsets[800], 900, 600)).toEqual([799, 800, 801]);
    const rotated = new PageLayout([{ width: 300, height: 500 }], 2, 90);
    expect(rotated.sizes[0]).toEqual({ width: 1000, height: 600 });
  });
  it('caps raster pixels even on a high-density display at extreme zoom', () => {
    const size = { width: 1400, height: 2000 };
    const scale = renderScale(4, 3, size);
    expect(scale * scale * size.width * size.height).toBeLessThanOrEqual(8_000_001);
  });
});

describe('legacy PDF takeover', () => {
  const url = 'chrome-extension://abcdefghijklmnop/viewer.html';
  it('matches PDF paths with signed queries without matching regular webpages', () => {
    const rules = legacyRules(url, false);
    const pattern = new RegExp(rules[0].condition.regexFilter!, 'i');
    expect(pattern.test('https://example.com/Scan.PDF?signature=a%2Fb&expires=5')).toBe(true);
    expect(pattern.test('https://example.com/?document=scan.pdf')).toBe(false);
    expect(pattern.test('https://example.com/scan.pdf.html')).toBe(false);
    expect(rules[0].condition.requestMethods).toEqual(['get']);
    expect(rules[0].condition.resourceTypes).toEqual(['main_frame']);
    expect(rules[0].action.redirect?.regexSubstitution).toBe(url + '#source=\\0');
  });
  it('supports extensionless PDF responses when response-header matching is available', () => {
    const rules = legacyRules(url, true);
    expect(rules).toHaveLength(2);
    expect(rules[1].condition.responseHeaders?.[0].header).toBe('content-type');
    expect(rules[1].condition.excludedResponseHeaders?.[0].values).toEqual(['attachment*']);
  });
});
