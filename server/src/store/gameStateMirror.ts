/**
 * MATIKS HACKATHON ENGINE — LIVE GAME STATE IN REDIS (gameStateMirror.ts)
 *
 * The game runs in this process's memory, which is what keeps answers fast. This keeps a durable copy of it in Redis, so a crash or a redeploy
 * in the middle of an event comes back to where it was, from one source, in a moment.
 *
 * What is kept, and how:
 *   room:<teamCode>       one JSON document per team          (plus the set `rooms` of team codes)
 *   session:<sessionId>   one JSON document per sprint session (plus the set `sessions`)
 *   rolls                 which roll number is in which team
 *   audit                 the append-only audit trail, as a list
 *   meta                  the round mode, the organizers' control state (window, banner, delay) and when it was saved
 *
 * Writing is incremental: each flush compares every document with what Redis already has and sends only what changed, in one transaction.
 * Flushes are debounced (a burst of answers becomes one write), and a failed flush is retried with a growing delay until it lands, so the copy
 * in Redis catches up by itself when Redis comes back.
 *
 * Only one server may write: a lease key held by the running process, renewed every few seconds. A second process started against the same
 * Redis cannot get it and does not start, because two servers each holding their own in-memory game and writing to one copy would corrupt it.
 */

import { randomUUID } from 'node:crypto';
import type { Redis } from '@upstash/redis';
import { roomManager, type PersistedTournamentState } from '../services/roomManager.js';
import { windowManager } from '../services/windowManager.js';
import { metrics } from '../services/metrics.js';
import { onControlStateChanged, type ControlState } from './controlState.js';
import { key, redisGuard, RedisUnavailableError } from './redis.js';

const FLUSH_DEBOUNCE_MS = 100;
const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 15_000;
const LEASE_TTL_MS = 20_000;
const LEASE_RENEW_MS = 6_000;
/** A transaction is kept to this many commands, so one request never gets large. */
const BATCH = 120;

type Tx = ReturnType<Redis['multi']>;
type Op = (tx: Tx) => void;

export interface LoadedGameState {
  snapshot: PersistedTournamentState;
  control: ControlState | null;
}

export class LeaseHeldError extends Error {
  constructor(public readonly holder: string | null) {
    super('Another server holds the game-state lease for this Redis.');
    this.name = 'LeaseHeldError';
  }
}

export class GameStateMirror {
  readonly instanceId = randomUUID();
  private lastRooms = new Map<string, string>();
  private lastSessions = new Map<string, string>();
  private lastRolls = '';
  private lastMeta = '';
  private auditCount = 0;
  private timer: NodeJS.Timeout | null = null;
  private leaseTimer: NodeJS.Timeout | null = null;
  private retryDelayMs = RETRY_MIN_MS;
  private running: Promise<void> | null = null;
  private dirtyWhileRunning = false;
  private enabled = false;
  private holdsLease = false;
  private removeHooks: Array<() => void> = [];

  /** Reported on /api/health and in telemetry. */
  status = { enabled: false, holdsLease: false, lastFlushAt: 0, lastFlushMs: 0, lastError: '' as string, flushes: 0 };

  private readonly hook = () => this.schedule();

  /* ---------------------------------------------------------------------------------------------- the lease */

  /** Takes the lease, waiting up to `waitMs` for a crashed previous process's lease to run out. Throws LeaseHeldError if it never frees. */
  async acquireLease(waitMs = LEASE_TTL_MS + 2_000): Promise<void> {
    const deadline = Date.now() + waitMs;
    let holder: string | null = null;
    for (;;) {
      const won = await redisGuard.run('lease.acquire', (r) => r.set(key('lease'), this.instanceId, { nx: true, px: LEASE_TTL_MS }));
      if (won !== null && won !== undefined) {
        this.holdsLease = true;
        this.status.holdsLease = true;
        this.startLeaseRenewal();
        return;
      }
      holder = (await redisGuard.run('lease.peek', (r) => r.get<string>(key('lease')))) ?? null;
      if (holder === this.instanceId) {
        this.holdsLease = true;
        this.status.holdsLease = true;
        this.startLeaseRenewal();
        return;
      }
      if (Date.now() >= deadline) throw new LeaseHeldError(holder);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  private startLeaseRenewal(): void {
    if (this.leaseTimer) return;
    this.leaseTimer = setInterval(() => {
      void this.renewLease();
    }, LEASE_RENEW_MS);
    this.leaseTimer.unref?.();
  }

  private async renewLease(): Promise<void> {
    try {
      const holder = await redisGuard.run('lease.renew', (r) => r.get<string>(key('lease')));
      if (holder === null || holder === undefined) {
        // It ran out (Redis was unreachable for a while): take it back if nobody else has
        const won = await redisGuard.run('lease.renew', (r) => r.set(key('lease'), this.instanceId, { nx: true, px: LEASE_TTL_MS }));
        this.holdsLease = won !== null && won !== undefined;
      } else if (holder === this.instanceId) {
        await redisGuard.run('lease.renew', (r) => r.pexpire(key('lease'), LEASE_TTL_MS));
        this.holdsLease = true;
      } else {
        this.holdsLease = false;
        console.error(`[GameState] Another server (${holder}) now holds the Redis lease. This one stops saving to Redis.`);
      }
      this.status.holdsLease = this.holdsLease;
    } catch (err) {
      if (!(err instanceof RedisUnavailableError)) throw err;
      // Redis is unreachable: keep believing we hold it, and check again next time
    }
  }

  async releaseLease(): Promise<void> {
    if (this.leaseTimer) {
      clearInterval(this.leaseTimer);
      this.leaseTimer = null;
    }
    if (!this.holdsLease) return;
    try {
      const holder = await redisGuard.run('lease.release', (r) => r.get<string>(key('lease')));
      if (holder === this.instanceId) await redisGuard.run('lease.release', (r) => r.del(key('lease')));
    } catch {
      // It will run out by itself
    }
    this.holdsLease = false;
    this.status.holdsLease = false;
  }

  /* ---------------------------------------------------------------------------------------------- saving */

  /** Starts saving: from now on every change to the game or the control state is written to Redis, and everything is written once now. */
  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.status.enabled = true;
    roomManager.addPersistenceHook(this.hook);
    const off = onControlStateChanged(this.hook);
    this.removeHooks = [() => roomManager.removePersistenceHook(this.hook), off];
    this.forgetWhatRedisHas();
    this.schedule(0);
  }

  disable(): void {
    this.enabled = false;
    this.status.enabled = false;
    for (const off of this.removeHooks) off();
    this.removeHooks = [];
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** The next flush will write everything. */
  private forgetWhatRedisHas(): void {
    this.lastRooms.clear();
    this.lastSessions.clear();
    this.lastRolls = '';
    this.lastMeta = '';
    this.auditCount = 0;
  }

  schedule(delayMs = FLUSH_DEBOUNCE_MS): void {
    if (!this.enabled || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flushNow();
    }, delayMs);
    this.timer.unref?.();
  }

  /** Writes what changed. Resolves true when Redis has everything. Never throws. */
  async flushNow(): Promise<boolean> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.running) {
      this.dirtyWhileRunning = true;
      await this.running;
      return this.flushNow();
    }
    const run = this.flushOnce().finally(() => {
      this.running = null;
    });
    this.running = run;
    await run;
    if (this.dirtyWhileRunning) {
      this.dirtyWhileRunning = false;
      this.schedule();
    }
    return this.status.lastError === '';
  }

  private async flushOnce(): Promise<void> {
    if (!this.enabled) return;
    const started = performance.now();
    try {
      if (!this.holdsLease) {
        await this.acquireLease(0);
      }

      const snapshot = roomManager.exportStateSnapshot();
      const control = windowManager.exportControlState();
      const ops: Op[] = [];
      let changed = false;

      const nextRooms = new Map<string, string>();
      for (const room of snapshot.rooms) {
        const json = JSON.stringify(room);
        nextRooms.set(room.teamCode, json);
        if (this.lastRooms.get(room.teamCode) !== json) {
          changed = true;
          ops.push((m) => m.set(key('room', room.teamCode), json));
          if (!this.lastRooms.has(room.teamCode)) ops.push((m) => m.sadd(key('rooms'), room.teamCode));
        }
      }
      for (const code of this.lastRooms.keys()) {
        if (!nextRooms.has(code)) {
          changed = true;
          ops.push((m) => m.del(key('room', code)));
          ops.push((m) => m.srem(key('rooms'), code));
        }
      }

      const nextSessions = new Map<string, string>();
      for (const [sessionId, session] of snapshot.sessions) {
        const json = JSON.stringify(session);
        nextSessions.set(sessionId, json);
        if (this.lastSessions.get(sessionId) !== json) {
          changed = true;
          ops.push((m) => m.set(key('session', sessionId), json));
          if (!this.lastSessions.has(sessionId)) ops.push((m) => m.sadd(key('sessions'), sessionId));
        }
      }
      for (const id of this.lastSessions.keys()) {
        if (!nextSessions.has(id)) {
          changed = true;
          ops.push((m) => m.del(key('session', id)));
          ops.push((m) => m.srem(key('sessions'), id));
        }
      }

      const rollsJson = JSON.stringify(snapshot.rollToTeamMap);
      if (rollsJson !== this.lastRolls) {
        changed = true;
        ops.push((m) => m.set(key('rolls'), rollsJson));
      }

      let nextAuditCount = this.auditCount;
      if (snapshot.auditLogs.length < this.auditCount) {
        // The trail was cleared or shortened: write it again from the start
        changed = true;
        ops.push((m) => m.del(key('audit')));
        nextAuditCount = 0;
      }
      for (let i = nextAuditCount; i < snapshot.auditLogs.length; i++) {
        changed = true;
        const line = JSON.stringify(snapshot.auditLogs[i]);
        ops.push((m) => m.rpush(key('audit'), line));
      }
      nextAuditCount = snapshot.auditLogs.length;

      const metaBody = JSON.stringify({ version: 1, roundOperatorMode: snapshot.roundOperatorMode, control });
      if (changed || metaBody !== this.lastMeta) {
        const meta = JSON.stringify({ ...JSON.parse(metaBody), savedAt: Date.now() });
        ops.push((m) => m.set(key('meta'), meta));
        changed = true;
      }

      if (changed) {
        for (let i = 0; i < ops.length; i += BATCH) {
          const slice = ops.slice(i, i + BATCH);
          await redisGuard.run(
            'state.flush',
            (r) => {
              const tx = r.multi();
              for (const op of slice) op(tx);
              return tx.exec();
            },
            slice.length
          );
        }
      }

      this.lastRooms = nextRooms;
      this.lastSessions = nextSessions;
      this.lastRolls = rollsJson;
      this.lastMeta = metaBody;
      this.auditCount = nextAuditCount;
      this.retryDelayMs = RETRY_MIN_MS;
      this.status.lastError = '';
      if (changed) this.status.flushes += 1;
    } catch (err) {
      this.status.lastError = err instanceof Error ? err.message : String(err);
      if (err instanceof LeaseHeldError) {
        console.error('[GameState] Not saving to Redis: another server holds the lease.');
      }
      this.retryLater();
    } finally {
      const elapsed = performance.now() - started;
      this.status.lastFlushMs = Math.round(elapsed);
      if (this.status.lastError === '') this.status.lastFlushAt = Date.now();
      metrics.stateFlushDurationSeconds.observe(elapsed / 1000);
    }
  }

  private retryLater(): void {
    if (!this.enabled) return;
    const delay = this.retryDelayMs;
    this.retryDelayMs = Math.min(RETRY_MAX_MS, this.retryDelayMs * 2);
    this.schedule(delay);
  }

  /* ---------------------------------------------------------------------------------------------- loading */

  /** What Redis holds, or null if it has never been saved to. Throws RedisUnavailableError if Redis cannot be reached. */
  async load(): Promise<LoadedGameState | null> {
    const metaRaw = await redisGuard.run('state.load', (r) => r.get<string>(key('meta')));
    if (!metaRaw) return null;

    const meta = JSON.parse(metaRaw) as { version: number; savedAt: number; roundOperatorMode: PersistedTournamentState['roundOperatorMode']; control?: ControlState };
    const codes = await redisGuard.run('state.load', (r) => r.smembers(key('rooms')));
    const ids = await redisGuard.run('state.load', (r) => r.smembers(key('sessions')));

    const readAll = async <T>(prefix: string, names: string[]): Promise<Array<[string, T]>> => {
      const out: Array<[string, T]> = [];
      for (let i = 0; i < names.length; i += 100) {
        const chunk = names.slice(i, i + 100);
        const raws = await redisGuard.run('state.load', (r) => r.mget<(string | null)[]>(...chunk.map((n) => key(prefix, n))), chunk.length);
        raws.forEach((raw, j) => {
          if (typeof raw !== 'string') return;
          try {
            out.push([chunk[j]!, JSON.parse(raw) as T]);
          } catch {
            console.warn(`[GameState] Skipping unreadable ${prefix} ${chunk[j]} in Redis.`);
          }
        });
      }
      return out;
    };

    const rooms = (await readAll<PersistedTournamentState['rooms'][number]>('room', codes)).map(([, room]) => room);
    const sessions = await readAll<PersistedTournamentState['sessions'][number][1]>('session', ids);
    const rollsRaw = await redisGuard.run('state.load', (r) => r.get<string>(key('rolls')));
    const auditRaw = await redisGuard.run('state.load', (r) => r.lrange(key('audit'), 0, -1));

    let rolls: PersistedTournamentState['rollToTeamMap'] = [];
    try {
      rolls = rollsRaw ? (JSON.parse(rollsRaw) as PersistedTournamentState['rollToTeamMap']) : [];
    } catch {
      console.warn('[GameState] Roll-number map in Redis was unreadable; rebuilding it from the teams.');
    }
    if (rolls.length === 0) {
      for (const room of rooms) for (const [roll] of room.members) rolls.push([roll, room.teamCode]);
    }

    const auditLogs: PersistedTournamentState['auditLogs'] = [];
    for (const line of auditRaw) {
      try {
        auditLogs.push(JSON.parse(line));
      } catch {
        // skip an unreadable line
      }
    }

    return {
      snapshot: {
        version: 1,
        savedAt: meta.savedAt,
        roundOperatorMode: meta.roundOperatorMode ?? null,
        rooms,
        sessions,
        rollToTeamMap: rolls,
        auditLogs
      },
      control: meta.control ?? null
    };
  }

  /** Deletes everything this service has saved in Redis (not the lease). */
  async clear(): Promise<number> {
    const codes = await redisGuard.run('state.clear', (r) => r.smembers(key('rooms')));
    const ids = await redisGuard.run('state.clear', (r) => r.smembers(key('sessions')));
    const names = [
      ...codes.map((c) => key('room', c)),
      ...ids.map((i) => key('session', i)),
      key('rooms'),
      key('sessions'),
      key('rolls'),
      key('audit'),
      key('meta')
    ];
    for (let i = 0; i < names.length; i += 100) {
      const chunk = names.slice(i, i + 100);
      await redisGuard.run('state.clear', (r) => r.del(...chunk), chunk.length);
    }
    this.forgetWhatRedisHas();
    return names.length;
  }

  /** Saves everything now and gives the lease up. For a clean shutdown. */
  async shutdown(timeoutMs = 3_000): Promise<void> {
    // A recent blip may have paused Redis. This is the last chance to save, so make one real attempt regardless.
    redisGuard.reset();
    if (this.enabled) {
      await Promise.race([this.flushNow(), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
    }
    this.disable();
    await this.releaseLease();
  }
}

export const gameStateMirror = new GameStateMirror();
