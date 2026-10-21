/**
 * MATIKS HACKATHON ENGINE — REDIS ACCESS (redis.ts)
 *
 * The one place the Upstash client is created, and the one door every Redis call goes through.
 *
 * STATE_BACKEND decides whether Redis is used at all:
 *   memory   (the default) everything lives in this process, exactly as before
 *   upstash  short-lived auth state, rate limits, the live game state and the event log are kept in Upstash Redis
 *
 * Redis is a place the game keeps things, never something the game waits on. Every call goes through `redisGuard`, which
 *  - gives each call a short timeout,
 *  - opens a circuit for a few seconds after a failure, so a slow or unreachable Redis does not slow the game while it is down, and
 *  - counts commands and errors, so a command budget can be watched.
 * Callers decide what "Redis is unavailable" means for them (most fall back to in-memory, a few queue and retry).
 */

import { Redis } from '@upstash/redis';
import { metrics } from '../services/metrics.js';

export class RedisUnavailableError extends Error {
  constructor(reason: string) {
    super(`Redis unavailable: ${reason}`);
    this.name = 'RedisUnavailableError';
  }
}

let singleton: Redis | null | undefined;
let override: Redis | null = null;

/** The configured client, or null when STATE_BACKEND is not "upstash" or the credentials are missing. */
export function getRedis(): Redis | null {
  if (process.env.STATE_BACKEND !== 'upstash') return null;
  if (override) return override;
  if (singleton !== undefined) return singleton;

  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) {
    console.error('[Redis] STATE_BACKEND=upstash but UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not both set. Staying in memory.');
    singleton = null;
    return singleton;
  }

  singleton = new Redis({
    url,
    token,
    // Everything is stored as, and read back as, the exact string that was written.
    automaticDeserialization: false,
    retry: { retries: 1, backoff: (attempt) => 100 * 2 ** attempt },
    signal: () => AbortSignal.timeout(2_500)
  });
  return singleton;
}

/** True when Redis is switched on and configured (it may still be unreachable: see redisGuard.isHealthy). */
export const redisEnabled = (): boolean => getRedis() !== null;

/** For tests: use this client instead of building one from the environment. Pass null to go back. */
export function installRedisForTests(client: unknown): void {
  override = (client as Redis | null) ?? null;
  singleton = undefined;
  redisGuard.reset();
}

const CIRCUIT_OPEN_MS = 5_000;

class RedisGuard {
  private openUntil = 0;
  private lastLoggedAt = 0;

  /** Redis is configured and the circuit is closed. */
  isHealthy(): boolean {
    return getRedis() !== null && Date.now() >= this.openUntil;
  }

  reset(): void {
    this.openUntil = 0;
    this.lastLoggedAt = 0;
  }

  /**
   * Runs one logical Redis operation. `op` is a short fixed label for metrics, and `commands` is how many Redis commands it is (a pipeline
   * of 20 is 20). Throws RedisUnavailableError without touching the network when Redis is off or the circuit is open.
   */
  async run<T>(op: string, fn: (redis: Redis) => Promise<T>, commands = 1): Promise<T> {
    const redis = getRedis();
    if (!redis) {
      throw new RedisUnavailableError('not configured');
    }
    if (Date.now() < this.openUntil) {
      metrics.redisErrorsTotal.inc({ op });
      throw new RedisUnavailableError('circuit open');
    }

    metrics.redisCommandsTotal.inc({ op }, commands);
    try {
      const result = await fn(redis);
      metrics.redisHealthy.set(1);
      return result;
    } catch (err) {
      this.openUntil = Date.now() + CIRCUIT_OPEN_MS;
      metrics.redisErrorsTotal.inc({ op });
      metrics.redisHealthy.set(0);
      const now = Date.now();
      if (now - this.lastLoggedAt > 10_000) {
        this.lastLoggedAt = now;
        console.error(`[Redis] ${op} failed, pausing Redis for ${CIRCUIT_OPEN_MS / 1000}s and carrying on in memory:`, err instanceof Error ? err.message : err);
      }
      throw new RedisUnavailableError(err instanceof Error ? err.message : String(err));
    }
  }
}

export const redisGuard = new RedisGuard();

/** Checks Redis is reachable (used at boot). */
export async function pingRedis(): Promise<boolean> {
  try {
    await redisGuard.run('ping', (r) => r.ping());
    return true;
  } catch {
    return false;
  }
}

/** Every key this service writes starts with this, so it can share a database with something else and be found, counted or cleared. */
export const KEY_PREFIX = process.env.REDIS_KEY_PREFIX?.trim() || 'matiks:v1:';
export const key = (...parts: string[]): string => KEY_PREFIX + parts.join(':');
