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

import { LeaderboardManager } from '../src/services/leaderboardManager.js';
import { WindowManager } from '../src/services/windowManager.js';
import { SseHub } from '../src/services/sseHub.js';

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
    test('registers clients with anti-buffering headers, broadcasts events, evicts dead sockets, and destroys cleanly', () => {
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

      // Broadcast to channel: healthyRes receives event, brokenRes throws and is evicted
      hub.broadcast('team:TEST-01', 'countdown_tick', { secondsRemaining: 3 });
      assert.equal(hub.getClientCount('team:TEST-01'), 1, 'Broken socket must be evicted on write error');
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
  });
});
