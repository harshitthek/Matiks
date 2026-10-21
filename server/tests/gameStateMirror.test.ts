/**
 * MATIKS HACKATHON ENGINE — GAME STATE IN REDIS TESTS (gameStateMirror.test.ts)
 *
 * With STATE_BACKEND=upstash the running game is copied into Redis and comes back from there after a restart. Checked against a fake Redis:
 * 1. Teams, sessions, the roll map, the audit trail and the organizers' control state survive a "restart" (memory emptied, Redis kept).
 * 2. A flush sends only what changed, and a dissolved team or finished clean-up is removed from Redis too.
 * 3. A Redis outage never reaches the game; the copy catches up by itself when Redis returns.
 * 4. A second server against the same Redis cannot take over while the first holds the lease, and can once it is released.
 * 5. Booting with Redis on and nothing saved falls back to the older path, then seeds Redis.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { FakeRedis } from './helpers/fakeRedis.js';
import { installRedisForTests, redisGuard, key } from '../src/store/redis.js';
import { GameStateMirror, LeaseHeldError } from '../src/store/gameStateMirror.js';
import { restoreTournamentState } from '../src/bootstrap/restoreState.js';
import { roomManager } from '../src/services/roomManager.js';
import { leaderboardManager } from '../src/services/leaderboardManager.js';
import { windowManager } from '../src/services/windowManager.js';
import { statePersistence } from '../src/services/statePersistence.js';

let redis: FakeRedis;
let mirror: GameStateMirror;

const forgetGame = () => {
  roomManager.clear();
  leaderboardManager.clear();
};

describe('Matiks Hackathon — Game state in Redis', () => {
  beforeEach(() => {
    process.env.STATE_BACKEND = 'upstash';
    redis = new FakeRedis();
    installRedisForTests(redis);
    forgetGame();
    windowManager.openWindow(120);
    mirror = new GameStateMirror();
  });

  afterEach(async () => {
    mirror.disable();
    await mirror.releaseLease();
    delete process.env.STATE_BACKEND;
    installRedisForTests(null);
    redisGuard.reset();
    forgetGame();
  });

  test('1. A restart comes back from Redis: teams, roll map, audit trail and the organizers\' window', async () => {
    const { teamCode, memberToken } = roomManager.createTeam('Survivors', 2, 'MR31001', 'Asha');
    roomManager.joinTeam(teamCode, 'MR31002', 'Bilal');
    roomManager.logSystemAudit({ action: 'TEST_ENTRY', adminId: 'tester', teamCode, details: { n: 1 } });
    windowManager.setTicker('Doors close at five');

    await mirror.acquireLease(0);
    mirror.enable();
    assert.equal(await mirror.flushNow(), true);

    // The process dies: everything in memory is gone, Redis is not
    forgetGame();
    windowManager.closeWindow();
    assert.equal(roomManager.getRoom(teamCode), undefined);

    const next = new GameStateMirror();
    const saved = await next.load();
    assert.ok(saved, 'Redis must hold a saved game');
    roomManager.restoreStateSnapshot(saved.snapshot);
    if (saved.control) windowManager.restoreControlState(saved.control);

    const room = roomManager.getRoom(teamCode)!;
    assert.equal(room.members.size, 2);
    assert.equal(room.members.get('MR31002')?.name, 'Bilal');
    assert.equal(roomManager.getAuditLogs().some((a) => a.action === 'TEST_ENTRY'), true);
    assert.equal(windowManager.getConfig().isOpen, true, 'a window that was open must still be open');
    assert.equal(windowManager.getConfig().announcementTicker, 'Doors close at five');
    assert.ok(memberToken.length > 0);
  });

  test('2. A flush sends only what changed, and removed teams leave Redis', async () => {
    const a = roomManager.createTeam('Alpha', 2, 'MR32001', 'A');
    const b = roomManager.createTeam('Beta', 1, 'MR32002', 'B');

    await mirror.acquireLease(0);
    mirror.enable();
    await mirror.flushNow();
    assert.deepEqual((await redis.smembers(key('rooms'))).sort(), [a.teamCode, b.teamCode].sort());

    // Nothing changed: the flush must not write a team again
    const setsBefore = redis.count('set');
    await mirror.flushNow();
    assert.equal(redis.count('set'), setsBefore, 'an unchanged game must send nothing');

    // One team changes: only that one is written
    roomManager.joinTeam(a.teamCode, 'MR32003', 'C');
    const before = redis.count('set');
    await mirror.flushNow();
    const writtenKeys = redis.count('set') - before;
    assert.ok(writtenKeys >= 1 && writtenKeys <= 3, `expected a team document and the meta, saw ${writtenKeys} writes`);

    // A team is gone: it must leave Redis
    roomManager.dissolveRoom(b.teamCode, 'tester');
    await mirror.flushNow();
    assert.equal(roomManager.getRoom(b.teamCode), undefined);
    assert.equal((await redis.smembers(key('rooms'))).includes(b.teamCode), false);
    assert.equal(await redis.get(key('room', b.teamCode)), null);
    assert.ok(await redis.get(key('room', a.teamCode)), 'the other team must stay');
  });

  test('3. A Redis outage never reaches the game, and the copy catches up when Redis returns', async () => {
    const a = roomManager.createTeam('Steady', 1, 'MR33001', 'S');
    await mirror.acquireLease(0);
    mirror.enable();
    await mirror.flushNow();

    redis.failWith = new Error('connection reset');
    // The game keeps working in memory
    const b = roomManager.createTeam('During Outage', 1, 'MR33002', 'D');
    assert.ok(roomManager.getRoom(b.teamCode));
    const ok = await mirror.flushNow();
    assert.equal(ok, false);
    assert.match(mirror.status.lastError, /connection reset|circuit/);
    assert.equal((await redis.smembers(key('rooms')).catch(() => [])).includes(b.teamCode), false);

    // Redis comes back; the circuit closes after its pause
    redis.failWith = null;
    redisGuard.reset();
    assert.equal(await mirror.flushNow(), true);
    assert.deepEqual((await redis.smembers(key('rooms'))).sort(), [a.teamCode, b.teamCode].sort());
    assert.equal(mirror.status.lastError, '');
  });

  test('4. A second server cannot take over while the first holds the lease', async () => {
    await mirror.acquireLease(0);
    const intruder = new GameStateMirror();
    await assert.rejects(() => intruder.acquireLease(0), LeaseHeldError);

    await mirror.releaseLease();
    await intruder.acquireLease(0);
    assert.equal(intruder.status.holdsLease, true);
    await intruder.releaseLease();
  });

  test('5. Booting with Redis on and nothing saved restores the old way, then seeds Redis', async () => {
    statePersistence.setFilePath(`${process.cwd()}/.data/test-mirror-seed-${process.pid}.json`);
    const { teamCode } = roomManager.createTeam('From Disk', 1, 'MR35001', 'D');
    assert.equal(statePersistence.saveNow(), true);
    forgetGame();

    try {
      const report = await restoreTournamentState();
      assert.equal(report.backend, 'upstash');
      assert.equal(report.source, 'disk');
      assert.ok(roomManager.getRoom(teamCode), 'the team on disk must be restored');

      const { gameStateMirror } = await import('../src/store/gameStateMirror.js');
      await gameStateMirror.flushNow();
      assert.ok((await redis.smembers(key('rooms'))).includes(teamCode), 'Redis must now hold the seeded team');
      await gameStateMirror.shutdown();
    } finally {
      statePersistence.disableAutoSave();
      statePersistence.clearDiskSnapshot();
      statePersistence.setFilePath(`${process.cwd()}/.data/tournament-snapshot.json`);
    }
  });
});
