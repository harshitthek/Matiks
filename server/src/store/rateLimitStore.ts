/**
 * MATIKS HACKATHON ENGINE — SHARED RATE LIMIT COUNTING (rateLimitStore.ts)
 *
 * Counts hits for the rate limiters. When Redis is on, counts are kept there (so they survive a restart and are shared if there is ever
 * more than one server); when it is off, or down, they are counted in this process, which is the behaviour the limiters always had.
 */

import { key as redisKey, redisGuard, redisEnabled, RedisUnavailableError } from './redis.js';

export interface RateLimitHit {
  /** Hits in the current window, including this one. */
  count: number;
  /** When the current window ends (ms since the epoch). */
  resetAt: number;
}

export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<RateLimitHit> | RateLimitHit;
}

/** Counts in this process's memory. Expired windows are dropped as the table grows, and the table has a hard size cap. */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, RateLimitHit>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 50_000
  ) {}

  hit(key: string, windowMs: number): RateLimitHit {
    const now = this.now();
    const existing = this.entries.get(key);
    if (existing && now < existing.resetAt) {
      existing.count += 1;
      return { ...existing };
    }

    if (this.entries.size >= 1000) this.prune(now);
    if (this.entries.size >= this.maxKeys) {
      // Under a flood of distinct keys, forget the oldest rather than grow without bound.
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }

    const fresh: RateLimitHit = { count: 1, resetAt: now + windowMs };
    this.entries.set(key, fresh);
    return { ...fresh };
  }

  size(): number {
    return this.entries.size;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now >= entry.resetAt) this.entries.delete(key);
    }
  }
}

/** One command round trip: add one, start the window on the first hit, and read how long is left. */
export class RedisRateLimitStore implements RateLimitStore {
  async hit(name: string, windowMs: number): Promise<RateLimitHit> {
    const k = redisKey('rl', name);
    const results = await redisGuard.run(
      'ratelimit',
      (r) => r.multi().incr(k).pexpire(k, windowMs, 'NX').pttl(k).exec<[number, number, number]>(),
      3
    );
    const count = Number(results[0]);
    const remaining = Number(results[2]);
    return { count, resetAt: Date.now() + (remaining > 0 ? remaining : windowMs) };
  }
}

/** Redis when it is on and healthy, otherwise this process's own memory. Chosen on every hit. */
export class AdaptiveRateLimitStore implements RateLimitStore {
  private readonly shared = new RedisRateLimitStore();

  constructor(private readonly local: RateLimitStore = new MemoryRateLimitStore()) {}

  async hit(name: string, windowMs: number): Promise<RateLimitHit> {
    if (redisEnabled() && redisGuard.isHealthy()) {
      try {
        return await this.shared.hit(name, windowMs);
      } catch (err) {
        if (!(err instanceof RedisUnavailableError)) throw err;
      }
    }
    return this.local.hit(name, windowMs);
  }
}
