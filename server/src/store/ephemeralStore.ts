/**
 * MATIKS HACKATHON ENGINE — SHORT-LIVED STATE (ephemeralStore.ts)
 *
 * Things that must expire on their own and may be asked for by another request, another restart or (one day) another server:
 * sign-in sessions, single-use admin stream tickets, the replay guard for OIDC states, and attempt counters.
 *
 * One small interface with two implementations:
 *  - MemoryEphemeralStore: this process's memory. What the service always did, and what the tests use.
 *  - RedisEphemeralStore: Upstash Redis with a local copy in front. The local copy is the safety net: if Redis is down, sessions created
 *    here still work, a single-use ticket is still single-use (within this process), and nothing the players do stops.
 */

import { createHash } from 'node:crypto';
import { key as redisKey, redisGuard, RedisUnavailableError, redisEnabled } from './redis.js';

export interface EphemeralStore {
  set(name: string, value: string, ttlMs: number): Promise<void>;
  get(name: string): Promise<string | null>;
  /** Reads and removes in one step, so a value can be used exactly once. */
  getdel(name: string): Promise<string | null>;
  /** Stores the value only if the name is free. Resolves to whether it was. */
  setIfAbsent(name: string, value: string, ttlMs: number): Promise<boolean>;
  del(name: string): Promise<void>;
  /** Counts one more under the name; the lifetime starts with the first count. Resolves to the count so far. */
  incr(name: string, ttlMs: number): Promise<number>;
  /** Forgets everything under a name prefix in this process (tests, and resetting a provider). */
  clearLocal(prefix: string): void;
}

/** A name that does not put a secret (a session token, an OIDC state) into a Redis key. */
export const hashed = (secret: string): string => createHash('sha256').update(secret).digest('base64url');

interface Entry {
  value: string;
  expiresAt: number;
}

export class MemoryEphemeralStore implements EphemeralStore {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 100_000
  ) {}

  private live(name: string): Entry | undefined {
    const entry = this.entries.get(name);
    if (!entry) return undefined;
    if (this.now() >= entry.expiresAt) {
      this.entries.delete(name);
      return undefined;
    }
    return entry;
  }

  private prune(): void {
    const now = this.now();
    for (const [name, entry] of this.entries) {
      if (now >= entry.expiresAt) this.entries.delete(name);
    }
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  async set(name: string, value: string, ttlMs: number): Promise<void> {
    if (this.entries.size >= 1000) this.prune();
    this.entries.set(name, { value, expiresAt: this.now() + ttlMs });
  }

  async get(name: string): Promise<string | null> {
    return this.live(name)?.value ?? null;
  }

  async getdel(name: string): Promise<string | null> {
    const entry = this.live(name);
    this.entries.delete(name);
    return entry?.value ?? null;
  }

  async setIfAbsent(name: string, value: string, ttlMs: number): Promise<boolean> {
    if (this.live(name)) return false;
    await this.set(name, value, ttlMs);
    return true;
  }

  async del(name: string): Promise<void> {
    this.entries.delete(name);
  }

  async incr(name: string, ttlMs: number): Promise<number> {
    const entry = this.live(name);
    if (entry) {
      const next = Number(entry.value) + 1;
      entry.value = String(next);
      return next;
    }
    await this.set(name, '1', ttlMs);
    return 1;
  }

  clearLocal(prefix: string): void {
    for (const name of [...this.entries.keys()]) {
      if (name.startsWith(prefix)) this.entries.delete(name);
    }
  }

  size(): number {
    return this.entries.size;
  }
}

/** Redis is the shared copy; the local store is what keeps working when Redis does not. */
export class RedisEphemeralStore implements EphemeralStore {
  constructor(private readonly local: EphemeralStore = new MemoryEphemeralStore()) {}

  private k(name: string): string {
    return redisKey('e', name);
  }

  async set(name: string, value: string, ttlMs: number): Promise<void> {
    await this.local.set(name, value, ttlMs);
    try {
      await redisGuard.run('eph.set', (r) => r.set(this.k(name), value, { px: ttlMs }));
    } catch (err) {
      if (!(err instanceof RedisUnavailableError)) throw err;
    }
  }

  async get(name: string): Promise<string | null> {
    const here = await this.local.get(name);
    if (here !== null) return here;
    try {
      const shared = await redisGuard.run('eph.get', (r) => r.get<string>(this.k(name)));
      return typeof shared === 'string' ? shared : null;
    } catch (err) {
      if (!(err instanceof RedisUnavailableError)) throw err;
      return null;
    }
  }

  async getdel(name: string): Promise<string | null> {
    const here = await this.local.getdel(name);
    try {
      const shared = await redisGuard.run('eph.getdel', (r) => r.getdel<string>(this.k(name)));
      return typeof shared === 'string' ? shared : here;
    } catch (err) {
      if (!(err instanceof RedisUnavailableError)) throw err;
      return here;
    }
  }

  async setIfAbsent(name: string, value: string, ttlMs: number): Promise<boolean> {
    try {
      const done = await redisGuard.run('eph.setnx', (r) => r.set(this.k(name), value, { nx: true, px: ttlMs }));
      const won = done !== null && done !== undefined;
      // Remember it here too, so a Redis outage a moment later cannot make a used name look free
      await this.local.set(name, value, ttlMs);
      return won;
    } catch (err) {
      if (!(err instanceof RedisUnavailableError)) throw err;
      return this.local.setIfAbsent(name, value, ttlMs);
    }
  }

  async del(name: string): Promise<void> {
    await this.local.del(name);
    try {
      await redisGuard.run('eph.del', (r) => r.del(this.k(name)));
    } catch (err) {
      if (!(err instanceof RedisUnavailableError)) throw err;
    }
  }

  async incr(name: string, ttlMs: number): Promise<number> {
    try {
      const results = await redisGuard.run(
        'eph.incr',
        (r) => r.multi().incr(this.k(name)).pexpire(this.k(name), ttlMs, 'NX').exec<[number, number]>(),
        2
      );
      return Number(results[0]);
    } catch (err) {
      if (!(err instanceof RedisUnavailableError)) throw err;
      return this.local.incr(name, ttlMs);
    }
  }

  clearLocal(prefix: string): void {
    this.local.clearLocal(prefix);
  }
}

const memory = new MemoryEphemeralStore();
let redisBacked: RedisEphemeralStore | null = null;
let forced: EphemeralStore | null = null;

/** The store in use right now. Chosen on each call, so the backend can be switched (and tests can swap it) without rebuilding anything. */
export function ephemeral(): EphemeralStore {
  if (forced) return forced;
  if (redisEnabled()) {
    redisBacked ??= new RedisEphemeralStore(memory);
    return redisBacked;
  }
  return memory;
}

/** For tests. */
export function useEphemeralStoreForTests(store: EphemeralStore | null): void {
  forced = store;
  redisBacked = null;
}
