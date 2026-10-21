/**
 * MATIKS HACKATHON ENGINE — LIVE REDIS CHECK (upstashLive.test.ts)
 *
 * Runs the Redis-backed pieces against the real Redis named by UPSTASH_REDIS_REST_URL / _TOKEN, under a key prefix of its own that is removed
 * at the end. Skipped unless UPSTASH_LIVE_TEST=1, so the normal test run never touches the network.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

const live = process.env.UPSTASH_LIVE_TEST === '1' && !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;

describe('Matiks Hackathon — Live Redis', { skip: live ? false : 'set UPSTASH_LIVE_TEST=1 with Redis credentials to run' }, async () => {
  if (!live) return;
  process.env.STATE_BACKEND = 'upstash';
  process.env.REDIS_KEY_PREFIX = `matiks:livetest:${Date.now()}:`;

  const { getRedis, key, KEY_PREFIX, pingRedis, redisGuard } = await import('../src/store/redis.js');
  const { GameStateMirror, LeaseHeldError } = await import('../src/store/gameStateMirror.js');
  const { roomManager } = await import('../src/services/roomManager.js');
  const { leaderboardManager } = await import('../src/services/leaderboardManager.js');
  const { windowManager } = await import('../src/services/windowManager.js');
  const { ephemeral } = await import('../src/store/ephemeralStore.js');
  const { dbOutbox } = await import('../src/store/outbox.js');
  const { AdaptiveRateLimitStore } = await import('../src/store/rateLimitStore.js');

  const mirror = new GameStateMirror();

  after(async () => {
    mirror.disable();
    await mirror.releaseLease();
    const redis = getRedis()!;
    const keys = await redis.keys(`${KEY_PREFIX}*`);
    if (keys.length) await redis.del(...keys);
    roomManager.clear();
    leaderboardManager.clear();
  });

  test('1. Reaches Redis, and the key prefix is the isolated one', async () => {
    assert.equal(await pingRedis(), true);
    assert.ok(KEY_PREFIX.startsWith('matiks:livetest:'));
  });

  test('2. A game written to Redis comes back after the process "forgets" it', async () => {
    roomManager.clear();
    leaderboardManager.clear();
    windowManager.openWindow(120);
    const a = roomManager.createTeam('Live Alpha', 2, 'LV41001', 'Asha');
    roomManager.joinTeam(a.teamCode, 'LV41002', 'Bilal');
    roomManager.createTeam('Live Beta', 1, 'LV41003', 'Chen');

    await mirror.acquireLease(0);
    mirror.enable();
    const t0 = performance.now();
    assert.equal(await mirror.flushNow(), true, mirror.status.lastError);
    console.log(`  first full flush (2 teams): ${Math.round(performance.now() - t0)} ms`);

    const t1 = performance.now();
    roomManager.toggleReady(a.teamCode, "LV41001", true, a.memberToken);
    await mirror.flushNow();
    console.log(`  incremental flush (one team changed): ${Math.round(performance.now() - t1)} ms`);

    roomManager.clear();
    leaderboardManager.clear();
    const saved = await new GameStateMirror().load();
    assert.ok(saved);
    roomManager.restoreStateSnapshot(saved.snapshot);
    assert.equal(roomManager.getRoomEntities().length, 2);
    assert.equal(roomManager.getRoom(a.teamCode)?.members.get('LV41002')?.name, 'Bilal');
  });

  test('3. A second server is refused while the lease is held', async () => {
    await assert.rejects(() => new GameStateMirror().acquireLease(0), LeaseHeldError);
  });

  test('4. Short-lived state: set, get, use once, and counters', async () => {
    const store = ephemeral();
    await store.set('live:token', 'value', 30_000);
    assert.equal(await store.get('live:token'), 'value');
    assert.equal(await store.getdel('live:token'), 'value');
    assert.equal(await store.getdel('live:token'), null, 'single use');
    assert.equal(await store.setIfAbsent('live:once', '1', 30_000), true);
    assert.equal(await store.setIfAbsent('live:once', '2', 30_000), false);
    assert.equal(await store.incr('live:count', 30_000), 1);
    assert.equal(await store.incr('live:count', 30_000), 2);
  });

  test('5. Rate limit counts accumulate in Redis', async () => {
    const limiter = new AdaptiveRateLimitStore();
    const first = await limiter.hit('live:ip:1.2.3.4', 30_000);
    const second = await limiter.hit('live:ip:1.2.3.4', 30_000);
    assert.equal(second.count, first.count + 1);
  });

  test('6. The write queue holds and releases records in order', async () => {
    await dbOutbox.enqueue({ kind: 'audit', record: { id: 'x', timestamp: 1, action: 'LIVE_A', adminId: 'live' } as never });
    await dbOutbox.enqueue({ kind: 'audit', record: { id: 'y', timestamp: 2, action: 'LIVE_B', adminId: 'live' } as never });
    assert.equal(await dbOutbox.depth(), 2);
    const seen: string[] = [];
    dbOutbox.start(async (item) => {
      if (item.kind === 'audit') seen.push(item.record.action);
    }, () => true);
    assert.equal(await dbOutbox.drain(), 2);
    dbOutbox.stop();
    assert.deepEqual(seen, ['LIVE_A', 'LIVE_B']);
    assert.equal(await dbOutbox.depth(), 0);
    void key; void redisGuard;
  });
});
