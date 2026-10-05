/** Byte-budgeted LRU: GPU resources are explicitly disposed on eviction. */
export class BudgetCache<T> {
  private entries = new Map<string, { value: T; bytes: number }>();
  private used = 0;
  constructor(readonly budget: number, private dispose: (value: T) => void) {}
  get bytes() { return this.used; }
  get size() { return this.entries.size; }
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.value;
  }
  has(key: string) { return this.entries.has(key); }
  set(key: string, value: T, bytes: number) {
    this.delete(key);
    if (bytes > this.budget) { this.dispose(value); return false; }
    this.entries.set(key, { value, bytes }); this.used += bytes;
    while (this.used > this.budget) this.delete(this.entries.keys().next().value!);
    return true;
  }
  delete(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key); this.used -= entry.bytes; this.dispose(entry.value);
  }
  clear() { for (const key of this.entries.keys()) this.delete(key); }
}
