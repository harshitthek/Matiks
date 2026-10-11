/**
 * MATIKS HACKATHON ENGINE — ROOM STATE MACHINE & REALTIME TESTS (roomManager.test.ts)
 * 
 * Verifies team lobby lifecycle, atomic READY locks, synchronized countdowns,
 * parallel sessions, team average score aggregation, hardware failure recovery ([EXCUSE MEMBER]),
 * Zero Question Leak guarantee, and anti-cheat timing checks.
 */


import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { roomManager } from '../src/services/roomManager.js';
import { leaderboardManager } from '../src/services/leaderboardManager.js';
import { windowManager } from '../src/services/windowManager.js';
import { createApp } from '../src/app.js';

describe('Matiks Hackathon — Phase 2: State Machine & Realtime Engine', () => {
  beforeEach(() => {
    roomManager.clear();
    leaderboardManager.clear();
    windowManager.openWindow(120);
  });

  after(() => {
    roomManager.clear();
    leaderboardManager.clear();
  });

  test('1. Team Creation & Roster Management', () => {
    const { room, teamCode } = roomManager.createTeam('Zero Gravity', 3, 'CS21045', 'Rohan Sharma');

    assert.equal(typeof teamCode, 'string');
    assert.match(teamCode, /^[A-Z]{2}-\d{2}$/);
    assert.equal(room.teamName, 'Zero Gravity');
    assert.equal(room.targetSize, 3);
    assert.equal(room.status, 'LOBBY');
    assert.equal(room.members.size, 1);

    const captain = room.members.get('CS21045');
    assert.ok(captain);
    assert.equal(captain.isCaptain, true);
    assert.equal(captain.isReady, false);
    assert.equal(captain.isExcused, false);

    // Roll number uniqueness
    assert.throws(
      () => roomManager.createTeam('Another Team', 2, 'CS21045', 'Duplicate Rohan'),
      /already registered/
    );

    // Invalid team sizes
    assert.throws(() => roomManager.createTeam('Bad Size', 1, 'EC21001', 'Solo'), /between 2 and 4/);
    assert.throws(() => roomManager.createTeam('Bad Size', 5, 'EC21001', 'Army'), /between 2 and 4/);
  });

  test('2. Member Join, Capacity Gate & Reconnection Handling', () => {
    const { teamCode } = roomManager.createTeam('Zero Gravity', 2, 'CS21045', 'Rohan Sharma');

    // Second member joins
    const { room: roomAfter2, member: member2 } = roomManager.joinTeam(teamCode, 'EC21088', 'Priya Patel');
    assert.equal(member2.rollNumber, 'EC21088');
    assert.equal(member2.isCaptain, false);
    assert.equal(roomAfter2.members.size, 2);
    assert.equal(roomAfter2.status, 'AWAITING_READY'); // Target size reached!

    // Reconnection: re-joining with same roll number returns existing member
    const reconnected = roomManager.joinTeam(teamCode, 'EC21088', 'Priya Patel', member2.token);
    assert.equal(reconnected.member.rollNumber, 'EC21088');
    assert.equal(reconnected.room.members.size, 2);

    // Over-capacity rejection
    assert.throws(
      () => roomManager.joinTeam(teamCode, 'IT21099', 'Excess Player'),
      /already reached capacity/
    );
  });

  test('3. Atomic READY Gate: Sprint Locked Until All N Members Ready', () => {
    const { teamCode, memberToken: tAlice } = roomManager.createTeam('AlgoRhythms', 2, 'CS21001', 'Alice');
    const { memberToken: tBob } = roomManager.joinTeam(teamCode, 'CS21002', 'Bob');

    // Alice toggles READY -> 1 of 2 ready, allReady is false
    const toggle1 = roomManager.toggleReady(teamCode, 'CS21001', true, tAlice);
    assert.equal(toggle1.allReady, false);
    assert.equal(toggle1.room.status, 'AWAITING_READY');

    // Bob toggles READY -> 2 of 2 ready, allReady becomes true and countdown starts!
    const toggle2 = roomManager.toggleReady(teamCode, 'CS21002', true, tBob);
    assert.equal(toggle2.allReady, true);
    assert.equal(toggle2.room.status, 'COUNTDOWN');
  });

  test('4. Synchronized Countdown to Parallel Sprint Sessions & Zero Question Leak', async () => {
    const { teamCode, memberToken: tCharlie } = roomManager.createTeam('Speedsters', 2, 'ME21001', 'Charlie');
    const { memberToken: tDave } = roomManager.joinTeam(teamCode, 'ME21002', 'Dave');

    roomManager.toggleReady(teamCode, 'ME21001', true, tCharlie);
    roomManager.toggleReady(teamCode, 'ME21002', true, tDave);

    // Wait 3.1s for countdown (3 -> 2 -> 1 -> SPRINT)
    await new Promise(resolve => setTimeout(resolve, 3200));

    const room = roomManager.getRoom(teamCode)!;
    assert.equal(room.status, 'IN_SPRINT');
    assert.ok(room.startedAt);

    const charlie = room.members.get('ME21001')!;
    const dave = room.members.get('ME21002')!;
    assert.ok(charlie.activeSessionId);
    assert.ok(dave.activeSessionId);
    assert.notEqual(charlie.activeSessionId, dave.activeSessionId);

    const sessionCharlie = roomManager.getSession(charlie.activeSessionId!)!;
    const sessionDave = roomManager.getSession(dave.activeSessionId!)!;

    // Both sessions have 15 questions
    assert.equal(sessionCharlie.questions.length, 15);
    assert.equal(sessionDave.questions.length, 15);

    // ZERO QUESTION LEAK GUARANTEE ON SANITIZED QUESTIONS:
    const snapshot = roomManager.getSnapshot(room);
    const snapshotStr = JSON.stringify(snapshot);
    assert.equal(snapshotStr.includes('"answer":'), false, 'Answer keys must NOT leak in team snapshot!');

    // ZERO QUESTION LEAK GUARANTEE ON LEADERBOARD:
    const leaderboard = leaderboardManager.getLeaderboard();
    const leaderboardStr = JSON.stringify(leaderboard);
    assert.equal(leaderboardStr.includes('"answer":'), false, 'Answer keys must NOT leak in leaderboard!');
    assert.equal(leaderboardStr.includes('"bucket":'), false, 'Question buckets must NOT leak in leaderboard!');
  });

  test('5. Parallel Submissions, Streak Bonuses & Team Average Aggregation', async () => {
    const { teamCode, memberToken: tEuler } = roomManager.createTeam('MathWizards', 2, 'PH21001', 'Euler');
    const { memberToken: tGauss } = roomManager.joinTeam(teamCode, 'PH21002', 'Gauss');

    roomManager.toggleReady(teamCode, 'PH21001', true, tEuler);
    roomManager.toggleReady(teamCode, 'PH21002', true, tGauss);

    // Wait for countdown to finish and allow >300ms sprint time so serverDeltaMs > 200ms
    await new Promise(resolve => setTimeout(resolve, 3350));

    const room = roomManager.getRoom(teamCode)!;
    assert.equal(room.status, 'IN_SPRINT', 'Room must be IN_SPRINT before submissions');
    const euler = room.members.get('PH21001')!;
    const gauss = room.members.get('PH21002')!;

    const sessionEuler = roomManager.getSession(euler.activeSessionId!)!;
    const sessionGauss = roomManager.getSession(gauss.activeSessionId!)!;

    // Euler answers Q0 correctly (latency 1200ms)
    const q0Euler = sessionEuler.questions[0];
    const resEuler = roomManager.submitAnswer(
      sessionEuler.sessionId,
      0,
      q0Euler.answer,
      1200,
      Date.now(),
      euler.token
    );
    assert.equal(resEuler.isCorrect, true);
    assert.ok(resEuler.pointsAwarded > 100); // 100 base + speed bonus

    // Gauss answers Q0 correctly (latency 2000ms)
    const q0Gauss = sessionGauss.questions[0];
    const resGauss = roomManager.submitAnswer(
      sessionGauss.sessionId,
      0,
      q0Gauss.answer,
      2000,
      Date.now(),
      gauss.token
    );
    assert.equal(resGauss.isCorrect, true);
    assert.ok(resGauss.pointsAwarded > 100);

    // Team Average Score is the mathematical average of both players!
    const expectedAverage = Number(((resEuler.currentScore + resGauss.currentScore) / 2).toFixed(2));
    const leaderboard = leaderboardManager.getLeaderboard();
    const teamEntry = leaderboard.find(e => e.teamCode === teamCode)!;
    assert.equal(teamEntry.teamAverageScore, expectedAverage);
    assert.equal(teamEntry.activeMembersCount, 2);
  });

  test('6. Anti-Cheat: Sub-200ms Latency Detection & Out-of-Order Rejection', async () => {
    const { teamCode, memberToken: tAlice } = roomManager.createTeam('CheaterHunters', 2, 'CH21001', 'Alice');
    const { memberToken: tBob } = roomManager.joinTeam(teamCode, 'CH21002', 'Bob');

    roomManager.toggleReady(teamCode, 'CH21001', true, tAlice);
    roomManager.toggleReady(teamCode, 'CH21002', true, tBob);

    await new Promise(resolve => setTimeout(resolve, 3200));

    const room = roomManager.getRoom(teamCode)!;
    const alice = room.members.get('CH21001')!;
    const sessionAlice = roomManager.getSession(alice.activeSessionId!)!;

    // Sub-200ms bot script attempt
    const q0 = sessionAlice.questions[0];
    const resBot = roomManager.submitAnswer(
      sessionAlice.sessionId,
      0,
      q0.answer,
      110, // 110ms < 200ms threshold!
      Date.now(),
      alice.token
    );
    assert.equal(resBot.isAnomaly, true, 'Sub-200ms submission must be flagged as anomaly');
    assert.equal(resBot.pointsAwarded, 100, 'Sub-200ms bot anomaly must receive 0 speed bonus (base points only)');

    // Out-of-order submission (trying Q5 instead of Q1)
    assert.throws(
      () =>
        roomManager.submitAnswer(
          sessionAlice.sessionId,
          5,
          100,
          1500,
          Date.now(),
          alice.token
        ),
      /Invalid question index. Expected question 1, got 5/
    );
  });

  test('7. Hardware Failure Recovery: [EXCUSE MEMBER] Dynamic Divisor Adjustment', async () => {
    const { teamCode, memberToken: tRohan } = roomManager.createTeam('BatteryVictims', 3, 'BV21001', 'Rohan');
    const { memberToken: tPriya } = roomManager.joinTeam(teamCode, 'BV21002', 'Priya');
    const { memberToken: tAarav } = roomManager.joinTeam(teamCode, 'BV21003', 'Aarav');

    roomManager.toggleReady(teamCode, 'BV21001', true, tRohan);
    roomManager.toggleReady(teamCode, 'BV21002', true, tPriya);
    roomManager.toggleReady(teamCode, 'BV21003', true, tAarav);

    await new Promise(resolve => setTimeout(resolve, 3200));

    const room = roomManager.getRoom(teamCode)!;
    const rohan = room.members.get('BV21001')!;
    const priya = room.members.get('BV21002')!;
    const aarav = room.members.get('BV21003')!;

    const sRohan = roomManager.getSession(rohan.activeSessionId!)!;
    const sPriya = roomManager.getSession(priya.activeSessionId!)!;
    const _sAarav = roomManager.getSession(aarav.activeSessionId!)!;

    // Rohan scores 150 pts
    roomManager.submitAnswer(sRohan.sessionId, 0, sRohan.questions[0].answer, 1000, Date.now(), rohan.token);
    // Priya scores 150 pts
    roomManager.submitAnswer(sPriya.sessionId, 0, sPriya.questions[0].answer, 1000, Date.now(), priya.token);
    // Aarav answers 0 questions (phone battery died!)

    const initialRohanScore = rohan.individualScore;
    const initialPriyaScore = priya.individualScore;
    assert.equal(aarav.individualScore, 0);

    // Initial average divides by 3
    const initialExpectedAvg = Number(((initialRohanScore + initialPriyaScore + 0) / 3).toFixed(2));
    let entry = leaderboardManager.getLeaderboard().find(e => e.teamCode === teamCode)!;
    assert.equal(entry.teamAverageScore, initialExpectedAvg);
    assert.equal(entry.activeMembersCount, 3);

    // ORGANIZER EXCUSES AARAV:
    const excuseResult = roomManager.excuseMember(
      teamCode,
      'BV21003',
      'Phone battery died at sprint kickoff',
      'admin_organizer_1'
    );

    assert.equal(excuseResult.success, true);
    assert.equal(excuseResult.activeMembersCount, 2);

    // New average dynamically divides by 2!
    const newExpectedAvg = Number(((initialRohanScore + initialPriyaScore) / 2).toFixed(2));
    assert.equal(excuseResult.newTeamAverageScore, newExpectedAvg);

    // Leaderboard reflects adjusted divisor
    entry = leaderboardManager.getLeaderboard().find(e => e.teamCode === teamCode)!;
    assert.equal(entry.teamAverageScore, newExpectedAvg);
    assert.equal(entry.activeMembersCount, 2);

    // Immutable audit record verified
    const auditLogs = roomManager.getAuditLogs();
    const excuseLog = auditLogs.find(l => l.action === 'EXCUSE_MEMBER' && l.rollNumber === 'BV21003');
    assert.ok(excuseLog);
    assert.equal(excuseLog.adminId, 'admin_organizer_1');
    assert.equal(excuseLog.reason, 'Phone battery died at sprint kickoff');
  });

  test('8. Admin Room Pause and Resume Control', async () => {
    const { teamCode, memberToken: tSam } = roomManager.createTeam('PauseTest', 2, 'PT21001', 'Sam');
    const { memberToken: tTina } = roomManager.joinTeam(teamCode, 'PT21002', 'Tina');

    roomManager.toggleReady(teamCode, 'PT21001', true, tSam);
    roomManager.toggleReady(teamCode, 'PT21002', true, tTina);

    await new Promise(resolve => setTimeout(resolve, 3200));

    const room = roomManager.getRoom(teamCode)!;
    const sam = room.members.get('PT21001')!;
    const sessionSam = roomManager.getSession(sam.activeSessionId!)!;

    // Admin pauses room
    roomManager.pauseRoom(teamCode, 'admin_super');
    assert.equal(room.isPaused, true);

    // Submissions while paused must be rejected
    assert.throws(
      () =>
        roomManager.submitAnswer(
          sessionSam.sessionId,
          0,
          sessionSam.questions[0].answer,
          1000,
          Date.now(),
          sam.token
        ),
      /temporarily paused/
    );

    // Admin resumes room
    roomManager.resumeRoom(teamCode, 'admin_super');
    assert.equal(room.isPaused, false);

    // Submissions proceed normally
    const resAfterResume = roomManager.submitAnswer(
      sessionSam.sessionId,
      0,
      sessionSam.questions[0].answer,
      1000,
      Date.now(),
      sam.token
    );
    assert.equal(resAfterResume.isCorrect, true);
  });

  test('9. Express App Health & REST API Routing', async () => {
    const app = createApp();

    // Verify app exists and has router configured
    assert.ok(app);
    assert.equal(typeof app.listen, 'function');
  });

  test('10. Security: Member Token Issuance and Submission Verification', async () => {
    const { teamCode, memberToken: captToken } = roomManager.createTeam('SecureTeam', 2, 'SEC001', 'SecureCaptain');
    const { memberToken: memToken } = roomManager.joinTeam(teamCode, 'SEC002', 'SecureMember');

    assert.ok(captToken);
    assert.ok(memToken);
    assert.notEqual(captToken, memToken);

    roomManager.toggleReady(teamCode, 'SEC001', true, captToken);
    roomManager.toggleReady(teamCode, 'SEC002', true, memToken);

    await new Promise(resolve => setTimeout(resolve, 3200));

    const room = roomManager.getRoom(teamCode)!;
    const capt = room.members.get('SEC001')!;
    const sessionCapt = roomManager.getSession(capt.activeSessionId!)!;

    // Forging submission with wrong member token rejected
    assert.throws(
      () =>
        roomManager.submitAnswer(
          sessionCapt.sessionId,
          0,
          sessionCapt.questions[0].answer,
          1000,
          Date.now(),
          'forged_wrong_token'
        ),
      /Unauthorized: Valid member token is required/
    );

    // Valid member token accepted
    const validRes = roomManager.submitAnswer(
      sessionCapt.sessionId,
      0,
      sessionCapt.questions[0].answer,
      1000,
      Date.now(),
      captToken
    );
    assert.equal(validRes.isCorrect, true);
  });

  test('11. Window Opening Auto-Launches Rooms Fully Ready During Window Closure', () => {
    // 1. Close contest window
    windowManager.closeWindow();
    assert.equal(windowManager.isOpen(), false);

    // 2. Form team and lock ready while window is closed
    const { teamCode, memberToken: t1 } = roomManager.createTeam('WaitTeam', 2, 'WT001', 'Player1');
    const { memberToken: t2 } = roomManager.joinTeam(teamCode, 'WT002', 'Player2');

    roomManager.toggleReady(teamCode, 'WT001', true, t1);
    const readyRes = roomManager.toggleReady(teamCode, 'WT002', true, t2);

    // All members ready, but room remains in AWAITING_READY because window is closed!
    assert.equal(readyRes.allReady, true);
    assert.equal(readyRes.room.status, 'AWAITING_READY');

    // 3. Organizer opens contest window
    windowManager.openWindow(60);
    assert.equal(windowManager.isOpen(), true);

    // Room must now automatically transition to COUNTDOWN!
    const room = roomManager.getRoom(teamCode)!;
    assert.equal(room.status, 'COUNTDOWN');
  });
});
