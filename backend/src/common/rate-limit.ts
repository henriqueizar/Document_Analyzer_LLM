/**
 * Counts events per key in a time window (in memory: one application
 * instance). Used to slow down password guessing and abuse of the LLM.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; since: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** True while the key is still within its limit. */
  allowed(key: string): boolean {
    const entry = this.hits.get(key);
    if (!entry) return true;
    if (Date.now() - entry.since > this.windowMs) {
      this.hits.delete(key);
      return true;
    }
    return entry.count < this.limit;
  }

  hit(key: string): void {
    const entry = this.hits.get(key);
    if (!entry || Date.now() - entry.since > this.windowMs) {
      this.hits.set(key, { count: 1, since: Date.now() });
    } else {
      entry.count += 1;
    }
    // keep the map small: forget expired keys now and then
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits)
        if (Date.now() - v.since > this.windowMs) this.hits.delete(k);
    }
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}
