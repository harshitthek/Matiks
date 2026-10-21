/**
 * MATIKS HACKATHON ENGINE — CHAOS & CAMPUS WI-FI RESILIENCY TESTS (chaosNetworkTest.ts)
 * 
 * Validates system stability under campus network chaos:
 * 1. Clock jitter tolerance (+/-350ms window) and packet jitter anomaly flags.
 * 2. Sub-200ms automated bot script anomaly detection and speed bonus clamping.
 * 3. Out-of-order and duplicate question submission rejection.
 * 4. Strict 120.0s deadline cutoff + 2.5s network transit grace cutoff.
 * 5. Hardware failure recovery ([EXCUSE MEMBER]) with dynamic divisor recalibration under live sprint.
 * 6. Admin room pause/resume state protection under active sprint.
 * 7. Contest window boundary gating and auto-launch on window open.
 * 8. Simulator lifecycle (simulateTeams and clearSimulatedTeams).
 * 9. SSE socket abrupt destruction and snapshot reconnection recovery.
 */

import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { roomManager } from '../src/services/roomManager.js';
import { leaderboardManager } from '../src/services/leaderboardManager.js';
import { windowManager } from '../src/services/windowManager.js';
import { createApp } from '../src/app.js';

describe('Matiks Hackathon — Phase 6: Chaos & Campus Wi-Fi Resiliency Engine', () => {
  beforeEach(() => {
    roomManager.clear();
    leaderboardManager.clear();
    windowManager.openWindow(120);
  });

  after(() => {
    roomManager.clear();
    leaderboardManager.clear();
  });

  test('1. Clock Jitter Tolerance: +/-350ms Accepted, Out-of-Bounds Flagged without Crashing', async () => {
    const { teamCode, memberToken: t1 } = roomManager.createTeam('JitterSquad', 2, 'JT001', 'Player One');
    const { memberToken: t2 } = roomManager.joinTeam(teamCode, 'JT002', 'Player Two');

    roomManager.toggleReady(teamCode, 'JT001', true, t1);
    roomManager.toggleReady(teamCode, 'JT002', true, t2);

    // Wait 3.2s for countdown to sprint
    await new Promise((r) => setTimeout(r, 3200));

    const room = roomManager.getRoom(teamCode)!;
    assert.equal(room.status, 'IN_SPRINT');

    const m1 = room.members.get('JT001')!;
    const session1 = roomManager.getSession(m1.activeSessionId!)!;
    const q0 = session1.questions[0];

    // Case A: Normal transit jitter within +/-350ms tolerance
    await new Promise((r) => setTimeout(r, 500));
    const now = Date.now();
    const actualElapsed = now - session1.startedAt;
    const normalResult = roomManager.submitAnswer(
      session1.sessionId,
      0,
      q0.answer,
      actualElapsed,
      now,
      session1.memberToken
    );
    assert.equal(normalResult.isCorrect, true);
    assert.equal(normalResult.isAnomaly, false);

    // Case B: Client claims 1000ms while only ~50ms elapsed (>350ms difference)
    const q1 = session1.questions[1];
    await new Promise((r) => setTimeout(r, 50));
    const jitterResult = roomManager.submitAnswer(
      session1.sessionId,
      1,
      q1.answer,
      1000, // artificially claimed client delta deviating from server clock
      Date.now(),
      session1.memberToken
    );
    // Submissions still processed safely with anomaly flag
    assert.equal(jitterResult.isCorrect, true);
    assert.equal(jitterResult.isAnomaly, true);
    assert.equal(typeof jitterResult.currentScore, 'number');
  });

  test('2. Anti-Cheat: Sub-200ms Bot Speed Anomaly Clamps Bonus & Broadcasts Flag', async () => {
    const { teamCode, memberToken: t1 } = roomManager.createTeam('BotSquad', 2, 'BOT001', 'Cyborg');
    const { memberToken: t2 } = roomManager.joinTeam(teamCode, 'BOT002', 'Human');

    roomManager.toggleReady(teamCode, 'BOT001', true, t1);
    roomManager.toggleReady(teamCode, 'BOT002', true, t2);

    await new Promise((r) => setTimeout(r, 3200));

    const room = roomManager.getRoom(teamCode)!;
    const botMember = room.members.get('BOT001')!;
    const session = roomManager.getSession(botMember.activeSessionId!)!;
    const q0 = session.questions[0];

    // Submit with sub-200ms latency (e.g. 50ms script injection)
    const botResult = roomManager.submitAnswer(
      session.sessionId,
      0,
      q0.answer,
      50, // 50ms - impossible human reaction
      Date.now(),
      session.memberToken
    );

    assert.equal(botResult.isCorrect, true);
    assert.equal(botResult.isAnomaly, true);
    // Speed bonus must be clamped to 0 because validated latency floors to targetLatencyMs
    assert.equal(botResult.pointsAwarded, 100); // exactly base points (100) with 0 bonus
  });

  test('3. Sequential Progression & Out-of-Order Rejection', async () => {
    const { teamCode, memberToken: t1 } = roomManager.createTeam('OrderSquad', 2, 'ORD001', 'Alice');
    const { memberToken: t2 } = roomManager.joinTeam(teamCode, 'ORD002', 'Bob');

    roomManager.toggleReady(teamCode, 'ORD001', true, t1);
    roomManager.toggleReady(teamCode, 'ORD002', true, t2);

    await new Promise((r) => setTimeout(r, 3200));

    const room = roomManager.getRoom(teamCode)!;
    const alice = room.members.get('ORD001')!;
    const session = roomManager.getSession(alice.activeSessionId!)!;

    // Attempting Question 2 when on Question 0 must fail
    assert.throws(
      () =>
        roomManager.submitAnswer(
          session.sessionId,
          2,
          session.questions[2].answer,
          800,
          Date.now(),
          session.memberToken
        ),
      /Invalid question index. Expected question 0, got 2/
    );

    // Question 0 succeeds
    const res0 = roomManager.submitAnswer(
      session.sessionId,
      0,
      session.questions[0].answer,
      800,
      Date.now(),
      session.memberToken
    );
    assert.equal(res0.completedQuestions, 1);

    // Re-submitting Question 0 (a reply lost on a weak connection) is answered from the record and counts nothing twice
    const scoreBefore = session.currentScore;
    const again = roomManager.submitAnswer(
      session.sessionId,
      0,
      session.questions[0].answer,
      800,
      Date.now(),
      session.memberToken
    ) as typeof res0 & { replayed?: boolean };
    assert.equal(again.replayed, true);
    assert.equal(again.completedQuestions, 1);
    assert.equal(again.currentScore, res0.currentScore);
    assert.equal(session.currentScore, scoreBefore);
    assert.equal(session.submissions.length, 1);
  });

  test('4. Strict 120.0s Deadline Cutoff + 2.5s Transit Grace Enforcement', async () => {
    const { teamCode, memberToken: t1 } = roomManager.createTeam('TimeSquad', 2, 'TIM001', 'Timer');
    const { memberToken: t2 } = roomManager.joinTeam(teamCode, 'TIM002', 'Partner');

    roomManager.toggleReady(teamCode, 'TIM001', true, t1);
    roomManager.toggleReady(teamCode, 'TIM002', true, t2);

    await new Promise((r) => setTimeout(r, 3200));

    const room = roomManager.getRoom(teamCode)!;
    const player = room.members.get('TIM001')!;
    const session = roomManager.getSession(player.activeSessionId!)!;

    // Submission within window succeeds
    const validRes = roomManager.submitAnswer(
      session.sessionId,
      0,
      session.questions[0].answer,
      800,
      Date.now(),
      session.memberToken
    );
    assert.equal(validRes.isCorrect, true);

    // Artificially simulate expiration: set session expiresAt to past cutoff (>2.5s ago)
    session.expiresAt = Date.now() - 3000;

    assert.throws(
      () =>
        roomManager.submitAnswer(
          session.sessionId,
          1,
          session.questions[1].answer,
          800,
          Date.now(),
          session.memberToken
        ),
      /120-second sprint deadline expired/
    );
  });

  test('5. Hardware Failure Recovery: [EXCUSE MEMBER] Dynamically Adjusts Divisor Under Live Sprint', async () => {
    const { teamCode, memberToken: t1 } = roomManager.createTeam('HardwareCrash', 3, 'HW001', 'Alice');
    const { memberToken: t2 } = roomManager.joinTeam(teamCode, 'HW002', 'Bob');
    const { memberToken: t3 } = roomManager.joinTeam(teamCode, 'HW003', 'Charlie');

    roomManager.toggleReady(teamCode, 'HW001', true, t1);
    roomManager.toggleReady(teamCode, 'HW002', true, t2);
    roomManager.toggleReady(teamCode, 'HW003', true, t3);

    await new Promise((r) => setTimeout(r, 3200));

    const room = roomManager.getRoom(teamCode)!;
    const mAlice = room.members.get('HW001')!;
    const mBob = room.members.get('HW002')!;
    const mCharlie = room.members.get('HW003')!;

    const sAlice = roomManager.getSession(mAlice.activeSessionId!)!;
    const sBob = roomManager.getSession(mBob.activeSessionId!)!;
    const _sCharlie = roomManager.getSession(mCharlie.activeSessionId!)!;

    // Alice answers 2 questions correctly (say 200 pts each approx)
    roomManager.submitAnswer(sAlice.sessionId, 0, sAlice.questions[0].answer, 600, Date.now(), sAlice.memberToken);
    roomManager.submitAnswer(sAlice.sessionId, 1, sAlice.questions[1].answer, 600, Date.now(), sAlice.memberToken);

    // Bob answers 1 question correctly
    roomManager.submitAnswer(sBob.sessionId, 0, sBob.questions[0].answer, 700, Date.now(), sBob.memberToken);

    // Charlie's device battery dies on Question 0 (score = 0)
    const scoreAlice = mAlice.individualScore;
    const scoreBob = mBob.individualScore;
    const scoreCharlie = mCharlie.individualScore; // 0

    const initialSum = scoreAlice + scoreBob + scoreCharlie;
    const expectedInitialAvg = Number((initialSum / 3).toFixed(2));

    const lbBefore = leaderboardManager.getLeaderboard();
    const entryBefore = lbBefore.find((e) => e.teamCode === teamCode)!;
    assert.equal(entryBefore.teamAverageScore, expectedInitialAvg);
    assert.equal(entryBefore.activeMembersCount, 3);

    // Admin excuses Charlie
    const excuseResult = roomManager.excuseMember(
      teamCode,
      'HW003',
      'Laptop battery died mid-sprint',
      'admin_organizer'
    );

    assert.equal(excuseResult.success, true);
    assert.equal(excuseResult.activeMembersCount, 2);

    const expectedRecalculatedAvg = Number(((scoreAlice + scoreBob) / 2).toFixed(2));
    assert.equal(excuseResult.newTeamAverageScore, expectedRecalculatedAvg);

    // Verify leaderboard reflects updated divisor immediately
    const lbAfter = leaderboardManager.getLeaderboard();
    const entryAfter = lbAfter.find((e) => e.teamCode === teamCode)!;
    assert.equal(entryAfter.teamAverageScore, expectedRecalculatedAvg);
    assert.equal(entryAfter.activeMembersCount, 2);

    // Boundary check: Attempting to excuse remaining members until 0 remain must throw
    roomManager.excuseMember(teamCode, 'HW002', 'Second excuse', 'admin_organizer');
    assert.throws(
      () => roomManager.excuseMember(teamCode, 'HW001', 'Cannot excuse last member', 'admin_organizer'),
      /Cannot excuse the last remaining active member/
    );
  });

  test('6. Admin Room Pause and Resume Under Active Sprint', async () => {
    const { teamCode, memberToken: t1 } = roomManager.createTeam('PauseSquad', 2, 'PAU001', 'P1');
    const { memberToken: t2 } = roomManager.joinTeam(teamCode, 'PAU002', 'P2');

    roomManager.toggleReady(teamCode, 'PAU001', true, t1);
    roomManager.toggleReady(teamCode, 'PAU002', true, t2);

    await new Promise((r) => setTimeout(r, 3200));

    const room = roomManager.getRoom(teamCode)!;
    const p1 = room.members.get('PAU001')!;
    const session = roomManager.getSession(p1.activeSessionId!)!;

    // Admin pauses room
    roomManager.pauseRoom(teamCode, 'admin_organizer');
    assert.equal(room.isPaused, true);

    // Answer submission during pause must be rejected
    assert.throws(
      () =>
        roomManager.submitAnswer(
          session.sessionId,
          0,
          session.questions[0].answer,
          800,
          Date.now(),
          session.memberToken
        ),
      /Session is temporarily paused by hackathon administrators/
    );

    // Admin resumes room
    roomManager.resumeRoom(teamCode, 'admin_organizer');
    assert.equal(room.isPaused, false);

    // Answer submission succeeds after resume
    const res = roomManager.submitAnswer(
      session.sessionId,
      0,
      session.questions[0].answer,
      800,
      Date.now(),
      session.memberToken
    );
    assert.equal(res.isCorrect, true);
  });

  test('7. Contest Window Boundary & Auto-Launch on Window Open', () => {
    // Close window
    windowManager.closeWindow();

    const { teamCode, memberToken: t1 } = roomManager.createTeam('WinSquad', 2, 'WIN001', 'W1');
    const { memberToken: t2 } = roomManager.joinTeam(teamCode, 'WIN002', 'W2');

    // Both ready while window closed
    roomManager.toggleReady(teamCode, 'WIN001', true, t1);
    const readyRes = roomManager.toggleReady(teamCode, 'WIN002', true, t2);

    // Room must NOT transition to countdown while window closed
    assert.equal(readyRes.room.status, 'AWAITING_READY');

    // Admin opens window -> triggers onWindowOpened and starts countdown
    windowManager.openWindow(120);

    const roomAfterOpen = roomManager.getRoom(teamCode)!;
    assert.equal(roomAfterOpen.status, 'COUNTDOWN');
  });

  test('8. Simulator Lifecycle: simulateTeams and clearSimulatedTeams', () => {
    const generatedCodes = roomManager.simulateTeams(5);
    assert.equal(generatedCodes.length, 5);

    const lb = leaderboardManager.getLeaderboard();
    assert.ok(lb.length >= 5);

    // Verify all 5 simulated teams exist in leaderboard with non-zero average scores
    for (const code of generatedCodes) {
      const entry = lb.find((e) => e.teamCode === code);
      assert.ok(entry, `Expected simulated team ${code} to exist in leaderboard`);
      assert.ok(entry.teamAverageScore > 1000, 'Expected realistic simulated score');
    }

    // Clear simulated teams
    roomManager.clearSimulatedTeams();
    const lbAfterClear = leaderboardManager.getLeaderboard();
    for (const code of generatedCodes) {
      const found = lbAfterClear.find((e) => e.teamCode === code);
      assert.equal(found, undefined, `Expected simulated team ${code} to be cleared from leaderboard`);
    }
  });

  test('9. SSE Socket Abrupt Destruction & Reconnection Snapshot Recovery', async () => {
    const app = createApp();
    const server = http.createServer(app);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 1. Create team
      const createRes = await fetch(`${baseUrl}/api/team/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamName: 'SocketDrop',
          targetSize: 2,
          rollNumber: 'SKT001',
          name: 'Socket Dropper'
        })
      });
      const createData = await createRes.json();
      const teamCode = createData.teamCode;
      const memberToken = createData.memberToken;

      // 2. Connect SSE client
      const sseController = new AbortController();
      const sseReq = fetch(`${baseUrl}/api/sse/team/${teamCode}?token=${memberToken}`, {
        signal: sseController.signal
      });

      // Allow connection to establish
      await new Promise((r) => setTimeout(r, 100));

      // 3. Forcibly abort client connection (simulating Wi-Fi drop)
      sseController.abort();
      await sseReq.catch(() => {});

      // Server must handle abort without crash
      await new Promise((r) => setTimeout(r, 50));

      // 4. Client reconnects and fetches snapshot
      const snapRes = await fetch(`${baseUrl}/api/team/${teamCode}`, {
        headers: { 'x-member-token': memberToken }
      });
      assert.equal(snapRes.status, 200);
      const snapData = await snapRes.json();
      assert.equal(snapData.teamCode, teamCode);
      assert.equal(snapData.members.length, 1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
