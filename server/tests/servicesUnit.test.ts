/**
 * MATIKS HACKATHON ENGINE — CORE SERVICES UNIT TEST SUITE (servicesUnit.test.ts)
 *
 * Dedicated unit tests for:
 * 1. LeaderboardManager: status priority ordering, score descending sort, completion-time tie-breakers,
 *    alphabetical stability, 50ms coalesced broadcast batching, removeTeam, and clear().
 * 2. WindowManager: openWindow, closeWindow, auto-closing on closesAt expiration, setTicker,
 *    and onOpen callback fault isolation.
 * 3. SseHub: SSE header setup, :connected handshake, channel client counting, broadcast payload formatting,
 *    dead-client eviction on write error, sendDirect, and destroy().
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { LeaderboardManager, leaderboardManager } from '../src/services/leaderboardManager.js';
import { WindowManager } from '../src/services/windowManager.js';
import { SseHub } from '../src/services/sseHub.js';
import { roomManager } from '../src/services/roomManager.js';
import { StatePersistenceService } from '../src/services/statePersistence.js';
import { escapeCsvCell } from '../src/controllers/adminController.js';
import { parseEventCursor } from '../src/controllers/sseController.js';

function createMockSseResponse(shouldThrowOnWrite = false) {
  const emitter = new EventEmitter();
  let statusCode = 0;
  let headers: Record<string, string> = {};
  const chunks: string[] = [];
  let ended = false;

  const res: any = Object.assign(emitter, {
    writeHead(code: number, hdrs: Record<string, string>) {
      statusCode = code;
      headers = hdrs;
    },
    write(chunk: string) {
      if (shouldThrowOnWrite && chunks.length > 0) {
        throw new Error('Simulated broken pipe');
      }
      chunks.push(chunk);
      return true;
    },
    end() {
      ended = true;
    },
    getStatus: () => statusCode,
    getHeaders: () => headers,
    getChunks: () => chunks,
    isEnded: () => ended
  });

  return res;
}

describe('Matiks Hackathon — Core Services Unit Test Suite', () => {
  describe('1. LeaderboardManager Priority Queue & Tie-Breaker Rules', () => {
    let lb: LeaderboardManager;

    beforeEach(() => {
      lb = new LeaderboardManager();
    });

    test('orders IN_SPRINT and FINISHED teams above WAITING teams regardless of score', () => {
      lb.updateTeam({
        teamCode: 'WT-01',
        teamName: 'Waiting Squad',
        teamAverageScore: 0,
        membersCount: 3,
        activeMembersCount: 3,
        averageTimeSeconds: 0,
        memberBreakdown: [],
        status: 'WAITING'
      }, true);

      lb.updateTeam({
        teamCode: 'SP-01',
        teamName: 'Racing Squad',
        teamAverageScore: 0,
        membersCount: 3,
        activeMembersCount: 3,
        averageTimeSeconds: 12.5,
        memberBreakdown: [],
        status: 'IN_SPRINT'
      }, true);

      const standings = lb.getLeaderboard();
      assert.equal(standings.length, 2);
      assert.equal(standings[0].teamCode, 'SP-01');
      assert.equal(standings[0].rank, 1);
      assert.equal(standings[1].teamCode, 'WT-01');
      assert.equal(standings[1].rank, 2);
    });

    test('breaks score ties using faster averageTimeSeconds (ascending) then alphabetical teamName', () => {
      lb.updateTeam({
        teamCode: 'TM-01',
        teamName: 'Zeta Squad',
        teamAverageScore: 2200,
        membersCount: 3,
        activeMembersCount: 3,
        averageTimeSeconds: 85.4,
        memberBreakdown: [],
        status: 'FINISHED'
      }, true);

      lb.updateTeam({
        teamCode: 'TM-02',
        teamName: 'Beta Squad',
        teamAverageScore: 2200,
        membersCount: 3,
        activeMembersCount: 3,
        averageTimeSeconds: 79.1, // Faster time with identical score!
        memberBreakdown: [],
        status: 'FINISHED'
      }, true);

      lb.updateTeam({
        teamCode: 'TM-03',
        teamName: 'Alpha Squad',
        teamAverageScore: 2200,
        membersCount: 3,
        activeMembersCount: 3,
        averageTimeSeconds: 85.4, // Tied score AND tied time with Zeta Squad, but Alpha < Zeta!
        memberBreakdown: [],
        status: 'FINISHED'
      }, true);

      const standings = lb.getLeaderboard();
      assert.deepEqual(
        standings.map((s) => s.teamCode),
        ['TM-02', 'TM-03', 'TM-01']
      );
      assert.deepEqual(
        standings.map((s) => s.rank),
        [1, 2, 3]
      );
    });

    test('coalesces non-immediate updates within 50ms window and supports removeTeam and clear', async () => {
      lb.updateTeam({
        teamCode: 'CL-01',
        teamName: 'Coalesce One',
        teamAverageScore: 1500,
        membersCount: 2,
        activeMembersCount: 2,
        averageTimeSeconds: 60,
        memberBreakdown: [],
        status: 'IN_SPRINT'
      }, false);

      lb.updateTeam({
        teamCode: 'CL-02',
        teamName: 'Coalesce Two',
        teamAverageScore: 1800,
        membersCount: 2,
        activeMembersCount: 2,
        averageTimeSeconds: 55,
        memberBreakdown: [],
        status: 'IN_SPRINT'
      }, false);

      await new Promise((r) => setTimeout(r, 70));
      assert.equal(lb.getLeaderboard().length, 2);

      lb.removeTeam('CL-01', true);
      assert.equal(lb.getLeaderboard().length, 1);
      assert.equal(lb.getLeaderboard()[0].teamCode, 'CL-02');

      lb.clear();
      assert.equal(lb.getLeaderboard().length, 0);
    });

    test('enforces anti-screen-peeking delay buffer on public channel while keeping admin immediate, and flushes instantly', async () => {
      assert.equal(lb.getStreamDelayMs(), 0);
      lb.setStreamDelayMs(NaN);
      assert.equal(lb.getStreamDelayMs(), 0);

      // Clamps to max 300_000ms
      lb.setStreamDelayMs(500_000);
      assert.equal(lb.getStreamDelayMs(), 300_000);

      lb.setStreamDelayMs(100);
      assert.equal(lb.getStreamDelayMs(), 100);

      lb.updateTeam({
        teamCode: 'DELAY-01',
        teamName: 'Delayed Squad',
        teamAverageScore: 2500,
        membersCount: 3,
        activeMembersCount: 3,
        averageTimeSeconds: 45,
        memberBreakdown: [],
        status: 'FINISHED'
      }, true);

      // Prior to flush or delay maturity, public snapshot must be empty to prevent leaking un-delayed standings
      assert.equal(lb.getPublicLeaderboard().length, 0);
      assert.equal(lb.getLeaderboard().length, 1);

      // Verify flush immediately flushes any pending delay timer
      lb.flush();
      assert.equal(lb.getLeaderboard().length, 1);
      assert.equal(lb.getPublicLeaderboard().length, 1);
      assert.equal(lb.getLeaderboard()[0].teamCode, 'DELAY-01');

      // Test delay reconciliation when delay is adjusted down
      lb.setStreamDelayMs(500);
      lb.updateTeam({
        teamCode: 'DELAY-02',
        teamName: 'Second Squad',
        teamAverageScore: 2400,
        membersCount: 2,
        activeMembersCount: 2,
        averageTimeSeconds: 50,
        memberBreakdown: [],
        status: 'FINISHED'
      }, true);
      assert.equal(lb.getPublicLeaderboard().length, 1, 'New team not visible yet');

      // Reconcile by lowering delay to 20ms and waiting for release
      lb.setStreamDelayMs(20);
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(lb.getPublicLeaderboard().length, 2, 'Delayed queue drained following delay reconciliation');

      // Test tournament wipe clears immediately without queue delay
      lb.setStreamDelayMs(100);
      lb.clear();
      assert.equal(lb.getLeaderboard().length, 0);
      assert.equal(lb.getPublicLeaderboard().length, 0);

      lb.setStreamDelayMs(0);
      assert.equal(lb.getStreamDelayMs(), 0);
    });
  });

  describe('2. WindowManager Lifecycle, Expiration & Callback Isolation', () => {
    test('manages window open/close state, auto-expires past closesAt, and isolates throwing onOpen callbacks', () => {
      const wm = new WindowManager(60);
      assert.equal(wm.isOpen(), true);

      wm.setTicker('Custom Hackathon Announcement');
      assert.equal(wm.getConfig().announcementTicker, 'Custom Hackathon Announcement');

      wm.closeWindow();
      assert.equal(wm.isOpen(), false);

      let secondCallbackCalled = false;
      wm.onOpen(() => {
        throw new Error('Simulated listener error');
      });
      wm.onOpen(() => {
        secondCallbackCalled = true;
      });

      const reopened = wm.openWindow(30, 'Window Reopened!');
      assert.equal(reopened.isOpen, true);
      assert.equal(reopened.durationMinutes, 30);
      assert.equal(reopened.announcementTicker, 'Window Reopened!');
      assert.equal(secondCallbackCalled, true, 'Subsequent onOpen callbacks must execute even if a prior callback throws');

      // Simulate closesAt in the past -> isOpen() must auto-transition to false
      (wm as any).config.closesAt = Date.now() - 1000;
      assert.equal(wm.isOpen(), false);
      assert.equal(wm.getConfig().isOpen, false);
    });
  });

  describe('3. SseHub Channel Management, Headers & Fault Tolerance', () => {
    test('registers clients with anti-buffering headers, broadcasts events with monotonic IDs, evicts dead sockets, and destroys cleanly', () => {
      const hub = new SseHub();
      const healthyRes = createMockSseResponse(false);
      const brokenRes = createMockSseResponse(true);

      const detachHealthy = hub.registerClient('team:TEST-01', healthyRes);
      hub.registerClient('team:TEST-01', brokenRes);

      assert.equal(healthyRes.getStatus(), 200);
      assert.equal(healthyRes.getHeaders()['Content-Type'], 'text/event-stream; charset=utf-8');
      assert.equal(healthyRes.getHeaders()['X-Accel-Buffering'], 'no');
      assert.equal(healthyRes.getChunks()[0], ':connected\n\n');
      assert.equal(hub.getClientCount('team:TEST-01'), 2);
      assert.equal(hub.getClientCount(), 2);

      // Broadcast to channel: healthyRes receives event with monotonic id: 1, brokenRes throws and is evicted
      const id = hub.broadcast('team:TEST-01', 'countdown_tick', { secondsRemaining: 3 });
      assert.equal(id, 1);
      assert.equal(hub.getClientCount('team:TEST-01'), 1, 'Broken socket must be evicted on write error');
      assert.ok(healthyRes.getChunks()[1].includes(`id: ${hub.epoch}:1`));
      assert.ok(healthyRes.getChunks()[1].includes('event: countdown_tick'));
      assert.ok(healthyRes.getChunks()[1].includes('"secondsRemaining":3'));

      // Direct message
      hub.sendDirect(healthyRes, 'sprint_error', { message: 'Test notice' });
      assert.ok(healthyRes.getChunks()[2].includes('event: sprint_error'));

      // Detach remaining client removes empty channel
      detachHealthy();
      assert.equal(hub.getClientCount('team:TEST-01'), 0);
      assert.equal(hub.getClientCount(), 0);

      // Re-register and test destroy()
      const finalRes = createMockSseResponse(false);
      hub.registerClient('leaderboard', finalRes);
      assert.equal(hub.getClientCount('leaderboard'), 1);

      hub.destroy();
      assert.equal(hub.getClientCount(), 0);
      assert.equal(finalRes.isEnded(), true);
    });

    test('replays missed events from circular replay buffer upon reconnection with lastEventId', () => {
      const hub = new SseHub();

      // Broadcast 5 events before client connects
      const id1 = hub.broadcast('team:RECONNECT-01', 'e1', { val: 1 });
      const id2 = hub.broadcast('team:RECONNECT-01', 'e2', { val: 2 });
      const id3 = hub.broadcast('team:RECONNECT-01', 'e3', { val: 3 });
      const id4 = hub.broadcast('team:RECONNECT-01', 'e4', { val: 4 });
      const id5 = hub.broadcast('team:RECONNECT-01', 'e5', { val: 5 });

      assert.equal(id1, 1);
      assert.equal(id2, 2);
      assert.equal(id3, 3);
      assert.equal(id4, 4);
      assert.equal(id5, 5);
      assert.equal(hub.getLastEventId('team:RECONNECT-01'), 5);

      // Client reconnects claiming lastEventId = 2 -> should receive e3, e4, e5
      const reconnectRes = createMockSseResponse(false);
      hub.registerClient('team:RECONNECT-01', reconnectRes, 2);

      const chunks = reconnectRes.getChunks();
      assert.equal(chunks[0], ':connected\n\n');
      assert.equal(chunks.length, 4); // handshake + 3 replayed events
      assert.ok(chunks[1].includes(`id: ${hub.epoch}:3\nevent: e3`));
      assert.ok(chunks[2].includes(`id: ${hub.epoch}:4\nevent: e4`));
      assert.ok(chunks[3].includes(`id: ${hub.epoch}:5\nevent: e5`));

      hub.destroy();
    });

    test('enforces circular buffer max size limit and supports clearing buffers', () => {
      const hub = new SseHub();
      for (let i = 1; i <= 120; i++) {
        hub.broadcast('buffer-test', 'event', { i });
      }

      const buffer = hub.getEventBuffer('buffer-test');
      assert.equal(buffer.length, SseHub.MAX_BUFFER_SIZE);
      assert.equal(buffer[0].id, 21); // First 20 dropped
      assert.equal(buffer[buffer.length - 1].id, 120);

      hub.clearChannelBuffer('buffer-test');
      assert.equal(hub.getEventBuffer('buffer-test').length, 0);

      hub.destroy();
    });

    test('emits stream_resync without partial suffix when lastEventId predates oldest retained event', () => {
      const hub = new SseHub();
      // Broadcast 120 events so 1..20 are pruned and oldest retained is 21, currentId is 120
      for (let i = 1; i <= 120; i++) {
        hub.broadcast('overflow-channel', 'msg', { i });
      }

      const overflowRes = createMockSseResponse(false);
      // Client connects asking for lastEventId = 5 (which was pruned)
      hub.registerClient('overflow-channel', overflowRes, 5);

      const chunks = overflowRes.getChunks();
      assert.equal(chunks[0], ':connected\n\n');
      assert.ok(chunks[1].includes(`id: ${hub.epoch}:120\nevent: stream_resync`));
      assert.ok(chunks[1].includes('"reason":"BUFFER_OVERFLOW"'));
      assert.ok(chunks[1].includes('"oldestAvailableId":21'));
      assert.ok(chunks[1].includes('"latestAvailableId":120'));
      assert.equal(chunks.length, 2, 'Must not replay incomplete suffix on buffer gap');

      hub.destroy();
    });

    test('emits stream_resync when lastEventId is ahead of current channel event sequence', () => {
      const hub = new SseHub();
      hub.broadcast('ahead-channel', 'msg', { ok: true }); // currentId is 1

      const aheadRes = createMockSseResponse(false);
      // Client connects with lastEventId = 99 (future cursor)
      hub.registerClient('ahead-channel', aheadRes, 99);

      const chunks = aheadRes.getChunks();
      assert.equal(chunks[0], ':connected\n\n');
      assert.ok(chunks[1].includes(`id: ${hub.epoch}:1\nevent: stream_resync`));
      assert.ok(chunks[1].includes('"reason":"CURSOR_AHEAD"'));
      assert.ok(chunks[1].includes('"latestAvailableId":1'));
      assert.ok(chunks[1].includes('"requestedLastEventId":99'));

      hub.destroy();
    });

    test('emits stream_resync when client epoch mismatches current process epoch or buffer is cleared', () => {
      const hub = new SseHub();
      hub.broadcast('epoch-channel', 'msg', { n: 1 });
      hub.broadcast('epoch-channel', 'msg', { n: 2 });

      // 1. Epoch mismatch
      const mismatchRes = createMockSseResponse(false);
      hub.registerClient('epoch-channel', mismatchRes, { epoch: 1000000000, seq: 1 });
      const chunksMismatch = mismatchRes.getChunks();
      assert.ok(chunksMismatch[1].includes('reason":"EPOCH_MISMATCH'));
      assert.ok(chunksMismatch[1].includes(`"serverEpoch":${hub.epoch}`));

      // 2. Buffer cleared but client cursor behind currentId
      hub.clearChannelBuffer('epoch-channel');
      const clearedRes = createMockSseResponse(false);
      hub.registerClient('epoch-channel', clearedRes, { epoch: hub.epoch, seq: 1 });
      const chunksCleared = clearedRes.getChunks();
      assert.ok(chunksCleared[1].includes('reason":"BUFFER_OVERFLOW'));

      // 3. parseEventCursor validation
      assert.deepEqual(parseEventCursor('1700000000:42'), { epoch: 1700000000, seq: 42 });
      assert.deepEqual(parseEventCursor('42'), { seq: 42 });
      assert.equal(parseEventCursor('1e3'), undefined);
      assert.equal(parseEventCursor('invalid'), undefined);
      assert.equal(parseEventCursor(''), undefined);

      hub.destroy();
    });
  });

  describe('4. StatePersistenceService Crash-Safe Disk Snapshot & Recovery', () => {
    test('atomically saves and restores rooms, sprint sessions, leaderboard standings, and audit logs across restarts', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matiks-persist-'));
      const snapshotPath = path.join(tmpDir, 'snapshot.json');
      const persistence = new StatePersistenceService(snapshotPath);

      try {
        roomManager.clear();
        persistence.enableAutoSave(20);

        // Create a team, join a second member, and simulate demo teams
        const { teamCode, memberToken: capTok } = roomManager.createTeam('Persist Squad', 2, 'PER01', 'Captain Persist');
        const { memberToken: memTok } = roomManager.joinTeam(teamCode, 'PER02', 'Partner Persist');
        roomManager.simulateTeams(2);

        // Wait for debounced auto-save
        await new Promise((r) => setTimeout(r, 60));
        assert.equal(fs.existsSync(snapshotPath), true, 'Auto-save must write snapshot file to disk');

        // Also test interrupting a COUNTDOWN state (should revert to AWAITING_READY on restore)
        const room = roomManager.getRoom(teamCode)!;
        room.status = 'COUNTDOWN';
        room.members.get('PER01')!.isReady = true;
        room.members.get('PER02')!.isReady = true;
        assert.equal(persistence.saveNow(), true);

        // Wipe in-memory state completely to simulate a server crash/restart
        persistence.disableAutoSave();
        roomManager.clear();
        assert.equal(roomManager.getAllRooms().length, 0);
        assert.equal(leaderboardManager.getLeaderboard().length, 0);

        // Restore from disk
        const loaded = persistence.loadFromDisk();
        assert.equal(loaded, true);

        const restoredRoom = roomManager.getRoom(teamCode);
        assert.ok(restoredRoom, 'Squad room must be restored from disk');
        assert.equal(restoredRoom.status, 'AWAITING_READY', 'Interrupted COUNTDOWN room must safely revert to AWAITING_READY');
        assert.equal(restoredRoom.members.get('PER01')?.isReady, false);
        assert.equal(restoredRoom.members.get('PER01')?.token, capTok);
        assert.equal(restoredRoom.members.get('PER02')?.token, memTok);

        // Leaderboard and audit logs must also be restored
        const board = leaderboardManager.getLeaderboard();
        assert.ok(board.some((e) => e.teamCode === 'SIM-01'));
        assert.ok(roomManager.getAuditLogs().some((a) => a.action === 'ADMIN_SIMULATE_TEAMS'));
      } finally {
        persistence.disableAutoSave();
        persistence.clearDiskSnapshot();
        roomManager.clear();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('handles missing or malformed snapshot files gracefully', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matiks-corrupt-'));
      const snapshotPath = path.join(tmpDir, 'corrupt.json');
      const persistence = new StatePersistenceService(snapshotPath);

      try {
        assert.equal(persistence.loadFromDisk(), false, 'Missing file must return false');

        fs.writeFileSync(snapshotPath, '{ invalid json ', 'utf-8');
        assert.equal(persistence.loadFromDisk(), false, 'Corrupt JSON must return false without throwing');

        fs.writeFileSync(snapshotPath, JSON.stringify({ version: 999 }), 'utf-8');
        assert.equal(persistence.loadFromDisk(), false, 'Unsupported version must return false');
      } finally {
        persistence.clearDiskSnapshot();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('5. CSV Formula Injection Defense & RFC-4180 Cell Escaping', () => {
    test('neutralizes spreadsheet formula prefixes while preserving negative numbers and quoting delimiters', () => {
      assert.equal(escapeCsvCell('=cmd|\'/C calc\'!A0'), "'=cmd|'/C calc'!A0");
      assert.equal(escapeCsvCell('+SUM(A1:A2)'), "'+SUM(A1:A2)");
      assert.equal(escapeCsvCell('@IMPORTXML()'), "'@IMPORTXML()");
      assert.equal(escapeCsvCell('-20'), '-20', 'Negative integer score must not be prefixed');
      assert.equal(escapeCsvCell('-12.5'), '-12.5', 'Negative decimal must not be prefixed');
      assert.equal(escapeCsvCell('-malicious'), "'-malicious");
      assert.equal(escapeCsvCell('Squad "Alpha", Jr.'), '"Squad ""Alpha"", Jr."');
      assert.equal(escapeCsvCell(null), '');
      assert.equal(escapeCsvCell(undefined), '');
    });
  });

  describe('6. Disk-Backed Admin Dispute Replay & Audit Chronology', () => {
    test('atomically writes replay chronology to disk and retrieves full question telemetry', async () => {
      const tmpAuditDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matiks-audit-'));
      const originalAuditDir = roomManager.getAuditDir();
      roomManager.setAuditDir(tmpAuditDir);

      try {
        roomManager.clear();
        const { teamCode, memberToken } = roomManager.createTeam(
          'Replay Squad',
          2,
          'REP01',
          'Audit Player'
        );
        const { memberToken: partnerToken } = roomManager.joinTeam(teamCode, 'REP02', 'Partner');

        // Toggle ready for both to start countdown & sprint
        roomManager.toggleReady(teamCode, 'REP01', true, memberToken);
        roomManager.toggleReady(teamCode, 'REP02', true, partnerToken);

        const room = roomManager.getRoom(teamCode)!;
        assert.equal(room.status, 'COUNTDOWN');

        // Fast-forward countdown
        (roomManager as any).launchSprint(room);
        assert.equal(room.status, 'IN_SPRINT');

        const repMember = room.members.get('REP01')!;
        const sessionId = repMember.activeSessionId!;
        assert.ok(sessionId, 'Active session ID must be generated');

        // Submit first 3 questions
        const s1 = roomManager.submitAnswer(sessionId, 0, 99, 1200, Date.now(), memberToken);
        assert.ok(s1);

        const session = roomManager.getSession(sessionId)!;
        assert.equal(session.submissions.length, 1);
        const firstSub = session.submissions[0];
        assert.equal(firstSub.questionIndex, 0);
        assert.ok(firstSub.a !== undefined);
        assert.ok(firstSub.b !== undefined);
        assert.ok(firstSub.operator !== undefined);
        assert.ok(firstSub.actualAnswer !== undefined);
        assert.equal(firstSub.latencyMs, 1200);
        assert.ok(firstSub.serverDeltaMs !== undefined);

        // Explicitly trigger session audit persistence
        session.isFinished = true;
        roomManager.persistSessionAudit(session);

        // Verify audit file written to disk
        const targetAuditFile = path.join(tmpAuditDir, `${sessionId}.json`);
        assert.equal(fs.existsSync(targetAuditFile), true, 'Session replay JSON must exist on disk');

        // Read through getSessionReplay
        const replay = roomManager.getSessionReplay(sessionId);
        assert.ok(replay, 'Replay must be returned');
        assert.equal(replay.sessionId, sessionId);
        assert.equal(replay.teamCode, teamCode);
        assert.equal(replay.rollNumber, 'REP01');
        assert.equal(replay.submissions.length, 1);
        assert.equal(replay.submissions[0].latencyMs, 1200);

        // List session replays includes this session
        const replayList = roomManager.listSessionReplays();
        assert.ok(replayList.some(r => r.sessionId === sessionId));

        // Test non-existent session
        assert.equal(roomManager.getSessionReplay('non-existent-session-id'), null);
      } finally {
        roomManager.setAuditDir(originalAuditDir);
        roomManager.clear();
        fs.rmSync(tmpAuditDir, { recursive: true, force: true });
      }
    });
  });
});
