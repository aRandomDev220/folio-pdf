interface Job { key: string; priority: number; run: () => Promise<void> }
/** One outstanding worker operation: scrolling replaces the queue, not the worker. */
export class RenderScheduler {
  private jobs = new Map<string, Job>();
  private active?: string;
  private stopped = false;
  constructor(private onError: (error: unknown) => void) {}
  enqueue(key: string, priority: number, run: () => Promise<void>) {
    if (this.stopped || this.active === key) return;
    this.jobs.set(key, { key, priority, run });
    void this.pump();
  }
  retain(predicate: (key: string) => boolean) {
    for (const key of this.jobs.keys()) if (!predicate(key)) this.jobs.delete(key);
  }
  stop() { this.stopped = true; this.jobs.clear(); }
  get queued() { return this.jobs.size; }
  private async pump() {
    if (this.active || this.stopped || this.jobs.size === 0) return;
    const job = [...this.jobs.values()].sort((a, b) => a.priority - b.priority)[0];
    this.jobs.delete(job.key); this.active = job.key;
    try { await job.run(); } catch (error) { if (!this.stopped) this.onError(error); }
    finally { this.active = undefined; if (!this.stopped) void this.pump(); }
  }
}
