import { describe, expect, it } from 'vitest';
import { BudgetCache } from '../../src/viewer/cache';
import { renderScale } from '../../src/viewer/layout';
import { RenderScheduler } from '../../src/viewer/scheduler';

describe('renderScale quantization', () => {
  const letter = { width: 612, height: 792 };
  it('snaps to a 1/32 grid so near-identical zoom levels share a cache key', () => {
    const a = renderScale(1.234, 2, letter);
    const b = renderScale(1.239, 2, letter); // Same 1/32 cell, ~0.4% apart.
    expect(a).toBe(b);
    expect((a * 32) % 1).toBe(0);
  });
  it('stays within the pixel budget after rounding', () => {
    for (const scale of [0.5, 1, 2, 4]) {
      for (const dpr of [1, 2, 3]) {
        const result = renderScale(scale, dpr, { width: 1400, height: 2000 });
        expect(result * result * 1400 * 2000).toBeLessThanOrEqual(8_000_001);
      }
    }
  });
  it('never returns zero or a negative scale on extremely large pages', () => {
    const result = renderScale(0.25, 1, { width: 9000, height: 12000 });
    expect(result).toBeGreaterThan(0);
    expect(result * result * 9000 * 12000).toBeLessThanOrEqual(8_000_001);
  });
  it('preserves exact values that already sit on the grid', () => {
    expect(renderScale(1, 1, letter)).toBe(1);
    expect(renderScale(2, 2, letter)).toBe(4);
  });
});

describe('BudgetCache rejection and ordering', () => {
  it('refuses to store an entry larger than the whole budget', () => {
    const disposed: string[] = [];
    const cache = new BudgetCache<string>(8, (value) => disposed.push(value));
    expect(cache.set('huge', 'huge page', 100)).toBe(false);
    expect(cache.has('huge')).toBe(false);
    expect(cache.bytes).toBe(0);
    expect(disposed).toEqual(['huge page']);
  });
  it('disposes the evicted value exactly once', () => {
    const disposed: string[] = [];
    const cache = new BudgetCache<string>(8, (value) => disposed.push(value));
    cache.set('a', 'one', 4);
    cache.set('b', 'two', 4);
    expect(cache.bytes).toBe(8);
    cache.set('b', 'two', 4); // Re-setting the same key replaces the entry.
    expect(cache.bytes).toBe(8);
    expect(disposed).toEqual(['two']);
    cache.delete('missing'); // Deleting an absent key is a no-op.
    expect(disposed).toEqual(['two']);
  });
});

describe('RenderScheduler discipline', () => {
  it('runs lower priority numbers first and never runs one key twice', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => release = resolve);
    const scheduler = new RenderScheduler(() => {});
    // A busy first job pins the pump so the queue below is orderable.
    scheduler.enqueue('gate', 0, async () => { await gate; order.push('gate'); });
    scheduler.enqueue('a', 5, async () => { order.push('a'); });
    scheduler.enqueue('b', 1, async () => { order.push('b'); });
    scheduler.enqueue('a', 5, async () => { order.push('a-again'); });
    scheduler.enqueue('c', 3, async () => { order.push('c'); });
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The duplicate 'a' enqueue replaces the pending entry: one run, newest callback.
    expect(order).toEqual(['gate', 'b', 'c', 'a-again']);
    scheduler.stop();
  });
  it('drops everything on stop and stops pumping', async () => {
    const order: string[] = [];
    const scheduler = new RenderScheduler(() => {});
    scheduler.enqueue('a', 0, async () => { order.push('a'); });
    scheduler.stop();
    scheduler.enqueue('b', 0, async () => { order.push('b'); });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(['a']);
  });
});
