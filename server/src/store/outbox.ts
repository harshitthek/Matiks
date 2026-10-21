/**
 * MATIKS HACKATHON ENGINE — DATABASE WRITE OUTBOX (outbox.ts)
 *
 * Answers and organizer actions are written to PostgreSQL after the player has already been answered. If that write fails (the database is
 * restarting, a network blip, the connection pool is full) the record used to be lost from the archive. With Redis on, a failed write is put
 * in a list here instead, and a loop writes it again until it lands, in the order it happened.
 *
 * The write is safe to repeat: before inserting, the database service checks whether the record is already there, so a retry after a
 * write that did land but whose reply was lost does not store it twice. A record that still cannot be written after several tries is moved to a
 * dead-letter list, where it stays for an organizer to look at, and does not block the ones behind it.
 */

import { randomUUID } from 'node:crypto';
import type { AuditRecord, SubmissionRecord } from '../types/sse.js';
import { metrics } from '../services/metrics.js';
import { key, redisGuard } from './redis.js';

export type OutboxItem =
  | { kind: 'submission'; sessionId: string; rollNumber: string; sub: SubmissionRecord; teamCode?: string }
  | { kind: 'audit'; record: AuditRecord };

interface Envelope {
  id: string;
  item: OutboxItem;
  attempts: number;
  queuedAt: number;
}

/** Writes one item to the database. Must throw when it did not land, and must be safe to run twice for the same item. */
export type OutboxHandler = (item: OutboxItem) => Promise<void>;

const MAX_ATTEMPTS = 8;
/** Beyond this the oldest waiting records are dropped, so a database that is down for hours cannot fill Redis. */
const MAX_DEPTH = 20_000;
const DRAIN_EVERY_MS = 5_000;
const DRAIN_BATCH = 50;

export class DbOutbox {
  private handler: OutboxHandler | null = null;
  private timer: NodeJS.Timeout | null = null;
  private draining = false;
  private canWrite: () => boolean = () => true;

  /** Puts a failed write in the queue. Never throws. Resolves false when Redis could not take it (the write is then lost, as before). */
  async enqueue(item: OutboxItem): Promise<boolean> {
    const envelope: Envelope = { id: randomUUID(), item, attempts: 0, queuedAt: Date.now() };
    try {
      const depth = await redisGuard.run('outbox.push', (r) => r.rpush(key('outbox'), JSON.stringify(envelope)));
      metrics.outboxEventsTotal.inc({ kind: item.kind, outcome: 'queued' });
      metrics.outboxDepth.set(Math.min(depth, MAX_DEPTH), { state: 'waiting' });
      if (depth > MAX_DEPTH) {
        await redisGuard.run('outbox.trim', (r) => r.ltrim(key('outbox'), -MAX_DEPTH, -1));
        metrics.outboxEventsTotal.inc({ kind: item.kind, outcome: 'dropped' }, depth - MAX_DEPTH);
      }
      return true;
    } catch {
      return false;
    }
  }

  async depth(): Promise<number> {
    try {
      return await redisGuard.run('outbox.depth', (r) => r.llen(key('outbox')));
    } catch {
      return 0;
    }
  }

  async deadDepth(): Promise<number> {
    try {
      return await redisGuard.run('outbox.depth', (r) => r.llen(key('outbox', 'dead')));
    } catch {
      return 0;
    }
  }

  /** Starts the retry loop. `canWrite` says whether the database is reachable right now (the loop waits otherwise). */
  start(handler: OutboxHandler, canWrite: () => boolean): void {
    this.handler = handler;
    this.canWrite = canWrite;
    if (this.timer) return;
    this.timer = setInterval(() => void this.drain(), DRAIN_EVERY_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Writes what is waiting, oldest first. Stops at the first failure so order is kept, counts the try against that record, and gives up on a
   * record only after MAX_ATTEMPTS. Returns how many were written.
   */
  async drain(): Promise<number> {
    if (this.draining || !this.handler || !this.canWrite()) return 0;
    this.draining = true;
    let written = 0;
    try {
      for (;;) {
        const batch = await redisGuard.run('outbox.read', (r) => r.lrange(key('outbox'), 0, DRAIN_BATCH - 1));
        if (batch.length === 0) break;

        let done = 0;
        let blocked = false;
        for (const raw of batch) {
          let envelope: Envelope;
          try {
            envelope = JSON.parse(raw) as Envelope;
          } catch {
            done += 1; // unreadable: nothing can be done with it
            continue;
          }
          try {
            await this.handler(envelope.item);
            metrics.outboxEventsTotal.inc({ kind: envelope.item.kind, outcome: 'retried_ok' });
            written += 1;
            done += 1;
          } catch (err) {
            envelope.attempts += 1;
            if (envelope.attempts >= MAX_ATTEMPTS) {
              console.error(`[Outbox] Giving up on a ${envelope.item.kind} after ${envelope.attempts} tries; it is kept in the dead-letter list.`, err instanceof Error ? err.message : err);
              await redisGuard.run('outbox.dead', (r) => r.rpush(key('outbox', 'dead'), JSON.stringify(envelope)));
              metrics.outboxEventsTotal.inc({ kind: envelope.item.kind, outcome: 'dead' });
              done += 1;
              continue;
            }
            // Keep it at the front with the try counted, and wait for the next round
            await redisGuard.run('outbox.retry', (r) => r.lset(key('outbox'), done, JSON.stringify(envelope)));
            blocked = true;
            break;
          }
        }

        if (done > 0) await redisGuard.run('outbox.ack', (r) => r.ltrim(key('outbox'), done, -1));
        if (blocked || batch.length < DRAIN_BATCH) break;
      }
    } catch {
      // Redis unavailable: try again next round
    } finally {
      this.draining = false;
    }
    metrics.outboxDepth.set(await this.depth(), { state: 'waiting' });
    metrics.outboxDepth.set(await this.deadDepth(), { state: 'dead' });
    return written;
  }
}

export const dbOutbox = new DbOutbox();
