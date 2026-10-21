/**
 * MATIKS HACKATHON ENGINE — DATABASE WRITE OUTBOX TESTS (outbox.test.ts)
 *
 * A write to PostgreSQL that fails is queued in Redis and written again later. Checked with a fake database and a fake Redis:
 * 1. A failed answer write is queued, and lands once the database works, exactly once even when the first try had in fact been stored.
 * 2. Records are written in the order they happened, and a record that keeps failing goes to the dead-letter list without blocking the rest.
 * 3. While the database is away, writes are queued and delivered when it is back.
 * 4. With Redis off, nothing is queued and nothing changes from before.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { FakeRedis } from './helpers/fakeRedis.js';
import { installRedisForTests, redisGuard, key } from '../src/store/redis.js';
import { dbOutbox } from '../src/store/outbox.js';
import { DatabaseService } from '../src/services/databaseService.js';
import { metrics } from '../src/services/metrics.js';
import type { AuditRecord, SubmissionRecord } from '../src/types/sse.js';

/** Just enough of Prisma for the two writes under test. Stored rows are kept so duplicates can be counted. */
function fakePrisma() {
  const submissions: Array<Record<string, any>> = [];
  const audits: Array<Record<string, any>> = [];
  const state = { failNext: 0, failAfterStoring: 0, missing: new Set<string>() };

  const tx = {
    questionSubmission: {
      create: async ({ data }: any) => {
        submissions.push(data);
      }
    },
    sprintSession: { update: async () => undefined }
  };

  const prisma = {
    sprintSession: {
      findUnique: async ({ where }: any) => (state.missing.has(where.sessionId) ? null : { sessionId: where.sessionId, teamCode: 'T-1' })
    },
    questionSubmission: {
      findFirst: async ({ where }: any) =>
        submissions.find((s) => s.sessionId === where.sessionId && s.rollNumber === where.rollNumber && s.questionIndex === where.questionIndex) ?? null
    },
    auditLog: {
      findFirst: async ({ where }: any) =>
        audits.find((a) => a.action === where.action && a.timestamp === where.timestamp && a.performedBy === where.performedBy) ?? null,
      create: async ({ data }: any) => {
        if (state.failNext > 0) {
          state.failNext -= 1;
          throw new Error('db down');
        }
        audits.push(data);
      }
    },
    $transaction: async (fn: (t: typeof tx) => Promise<void>) => {
      if (state.failNext > 0) {
        state.failNext -= 1;
        throw new Error('db down');
      }
      await fn(tx);
      if (state.failAfterStoring > 0) {
        state.failAfterStoring -= 1;
        throw new Error('reply lost');
      }
    }
  };
  return { prisma, submissions, audits, state };
}

const sub = (questionIndex: number): SubmissionRecord =>
  ({
    questionIndex,
    a: 3,
    b: 4,
    operator: '+',
    bucket: 'B1',
    submittedAnswer: 7,
    actualAnswer: 7,
    isCorrect: true,
    latencyMs: 900,
    pointsAwarded: 110,
    streakAfter: 1,
    scoreAfter: 110 * (questionIndex + 1),
    timestamp: 1_700_000_000_000 + questionIndex
  }) as SubmissionRecord;

describe('Matiks Hackathon — Database write outbox', () => {
  let redis: FakeRedis;
  let db: DatabaseService;
  let fake: ReturnType<typeof fakePrisma>;

  beforeEach(() => {
    process.env.STATE_BACKEND = 'upstash';
    redis = new FakeRedis();
    installRedisForTests(redis);
    metrics.outboxEventsTotal.reset();
    fake = fakePrisma();
    db = new DatabaseService();
    (db as any).prisma = fake.prisma;
    (db as any).isConnected = true;
    db.startOutboxRetries();
  });

  afterEach(() => {
    db.stopOutboxRetries();
    delete process.env.STATE_BACKEND;
    installRedisForTests(null);
    redisGuard.reset();
  });

  test('1. A failed write is queued and lands once, even if the first try had actually been stored', async () => {
    fake.state.failAfterStoring = 1; // stored, but the caller sees an error
    await db.syncSubmission('s1', 'R1', sub(0), 'T-1');
    assert.equal(fake.submissions.length, 1);
    assert.equal(await dbOutbox.depth(), 1, 'the write that looked failed must be queued');

    assert.equal(await dbOutbox.drain(), 1);
    assert.equal(fake.submissions.length, 1, 'the retry must not store the answer twice');
    assert.equal(await dbOutbox.depth(), 0);
  });

  test('2. Records keep their order, and a record that keeps failing goes to the dead-letter list', async () => {
    fake.state.failNext = 2;
    await db.syncSubmission('s1', 'R1', sub(0), 'T-1');
    await db.syncSubmission('s1', 'R1', sub(1), 'T-1');
    assert.equal(await dbOutbox.depth(), 2);

    await dbOutbox.drain();
    assert.deepEqual(fake.submissions.map((s) => s.questionIndex), [0, 1], 'oldest first');
    assert.equal(await dbOutbox.depth(), 0);

    // A record whose session never reached the database, followed by one that can be written
    fake.state.missing.add('ghost');
    await dbOutbox.enqueue({ kind: 'submission', sessionId: 'ghost', rollNumber: 'R9', sub: sub(0), teamCode: 'T-9' });
    await dbOutbox.enqueue({ kind: 'submission', sessionId: 's1', rollNumber: 'R1', sub: sub(3), teamCode: 'T-1' });

    // The failing head is kept and counted each round, then given up on; the one behind it then lands
    for (let round = 0; round < 8; round++) await dbOutbox.drain();

    assert.equal(await dbOutbox.deadDepth(), 1, 'the unwritable record must sit in the dead-letter list');
    assert.ok(fake.submissions.some((s) => s.questionIndex === 3), 'the record behind it must still be written');
    assert.equal(fake.submissions.some((s) => s.sessionId === 'ghost'), false);
    assert.equal(await dbOutbox.depth(), 0);
  });

  test('3. While the database is away, writes are queued and delivered when it is back', async () => {
    (db as any).isConnected = false;
    const audit: AuditRecord = { id: 'a1', timestamp: 1_700_000_001_000, action: 'PAUSE_ROOM', adminId: 'org1', teamCode: 'T-1' } as AuditRecord;
    await db.syncSubmission('s1', 'R1', sub(5), 'T-1');
    await db.recordAudit(audit);
    assert.equal(fake.submissions.length, 0);
    assert.equal(await dbOutbox.depth(), 2);
    assert.equal(await dbOutbox.drain(), 0, 'nothing is attempted while the database is away');

    (db as any).isConnected = true;
    assert.equal(await dbOutbox.drain(), 2);
    assert.equal(fake.submissions.length, 1);
    assert.equal(fake.audits.length, 1);

    // The same audit entry delivered again is not stored twice
    await dbOutbox.enqueue({ kind: 'audit', record: audit });
    await dbOutbox.drain();
    assert.equal(fake.audits.length, 1);
  });

  test('4. With Redis off nothing is queued and a failed write is just logged, as before', async () => {
    installRedisForTests(null);
    delete process.env.STATE_BACKEND;
    fake.state.failNext = 1;
    await db.syncSubmission('s1', 'R1', sub(0), 'T-1');
    assert.equal(fake.submissions.length, 0);
    assert.equal(redis.count('rpush'), 0);
  });
});
