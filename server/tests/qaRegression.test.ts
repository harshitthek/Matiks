/**
 * MATIKS HACKATHON ENGINE — QA & EDGE-CASE REGRESSION SUITE (qaRegression.test.ts)
 *
 * Comprehensive QA and edge-case verification covering:
 * 1. Team Leave & Captain Succession across LOBBY, AWAITING_READY, COUNTDOWN, and IN_SPRINT states
 * 2. Rematch Reset (resetTeamSprint) guards: blocks premature reset while teammates are still solving,
 *    auto-finalizes expired sprints past the +2.5s cutoff, and resets scores/sessions cleanly
 * 3. SSE sprint_resume payload completeness (submissions history, maxStreak, startedAt, remainingMs)
 *    so returning from Leaderboard/Admin or refreshing never zeroes out SprintSummary stats
 * 4. SSE sprint_resume suppression after completion or expiration & pause-state preservation
 * 5. Multi-tab SSE presence reference counting & single-use Admin SSE ticket consumption
 * 6. Exhaustive input validation & adversarial payload rejection across all REST controllers
 */

import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createApp } from '../src/app.js';
import { roomManager } from '../src/services/roomManager.js';
import { leaderboardManager } from '../src/services/leaderboardManager.js';
import { windowManager } from '../src/services/windowManager.js';

async function startTestServer() {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  return { server, baseUrl, close };
}

function readSseEventsUntil(
  url: string,
  predicate: (buffer: string) => boolean,
  timeoutMs = 2000
): Promise<{ status: number; buffer: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;
    let statusCode = 0;

    const close = () => {
      try {
        req.destroy();
      } catch {
        // Ignore
      }
    };

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({
          status: statusCode,
          buffer,
          close
        });
      }
    }, timeoutMs);

    const req = http.get(url, (res) => {
      statusCode = res.statusCode ?? 0;
      if (statusCode !== 200) {
        res.on('data', (chunk) => {
          buffer += chunk.toString();
        });
        res.on('end', () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve({ status: statusCode, buffer, close });
          }
        });
        return;
      }

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        if (!settled && predicate(buffer)) {
          settled = true;
          clearTimeout(timer);
          resolve({ status: statusCode, buffer, close });
        }
      });
    });

    req.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

describe('Matiks Hackathon — QA & Edge-Case Regression Suite', () => {
  beforeEach(() => {
    roomManager.clear();
    leaderboardManager.clear();
    windowManager.openWindow(120);
  });

  after(() => {
    roomManager.clear();
    leaderboardManager.clear();
  });

  test('1. Leave Squad Edge Cases: Captain Succession, Countdown Cancellation, Mid-Sprint Completion & Roll Reuse', async () => {
    // 1A: Captain leaves during COUNTDOWN -> countdown cancelled, status reverts to LOBBY, next member becomes captain
    const { teamCode, memberToken: tCap } = roomManager.createTeam('LeaveCases', 2, 'LV001', 'Cap');
    const { memberToken: tMem } = roomManager.joinTeam(teamCode, 'LV002', 'Mem');

    roomManager.toggleReady(teamCode, 'LV001', true, tCap);
    roomManager.toggleReady(teamCode, 'LV002', true, tMem);
    assert.equal(roomManager.getRoom(teamCode)!.status, 'COUNTDOWN');

    // Unauthorized leave with wrong token must fail
    assert.throws(
      () => roomManager.leaveTeam(teamCode, 'LV001', 'wrong_token'),
      /Unauthorized: Valid member token is required/
    );

    // Valid leave during COUNTDOWN cancels countdown and transfers captaincy
    const leaveRes = roomManager.leaveTeam(teamCode, 'LV001', tCap);
    assert.equal(leaveRes.dissolved, false);
    assert.equal(leaveRes.room!.status, 'LOBBY');
    assert.equal(leaveRes.room!.members.get('LV002')!.isCaptain, true);

    // Wait 3.2s to verify cancelled countdown does NOT launch a sprint
    await new Promise((r) => setTimeout(r, 3200));
    assert.equal(roomManager.getRoom(teamCode)!.status, 'LOBBY');

    // LV001's roll number is freed and can now create a new team!
    const { teamCode: newTeamCode, memberToken: tNewCap } = roomManager.createTeam(
      'RebornSquad',
      2,
      'LV001',
      'Cap Reborn'
    );
    assert.ok(newTeamCode);

    // 1B: Leaving during IN_SPRINT when the remaining member has already finished -> room finalizes to FINISHED
    const { memberToken: tNewMem } = roomManager.joinTeam(newTeamCode, 'LV003', 'FastFinisher');
    roomManager.toggleReady(newTeamCode, 'LV001', true, tNewCap);
    roomManager.toggleReady(newTeamCode, 'LV003', true, tNewMem);

    await new Promise((r) => setTimeout(r, 3200));
    const sprintRoom = roomManager.getRoom(newTeamCode)!;
    assert.equal(sprintRoom.status, 'IN_SPRINT');

    // LV003 finishes all 15 questions while LV001 is still on Q0
    const mFast = sprintRoom.members.get('LV003')!;
    const sFast = roomManager.getSession(mFast.activeSessionId!)!;
    for (let i = 0; i < 15; i++) {
      roomManager.submitAnswer(
        sFast.sessionId,
        i,
        sFast.questions[i].answer,
        600,
        Date.now(),
        tNewMem
      );
    }
    assert.equal(sFast.isFinished, true);
    assert.equal(sprintRoom.status, 'IN_SPRINT', 'Room stays IN_SPRINT while LV001 is still active');

    // Now LV001 leaves the team mid-sprint -> remaining active member (LV003) is finished, so room finalizes!
    roomManager.leaveTeam(newTeamCode, 'LV001', tNewCap);
    assert.equal(sprintRoom.status, 'FINISHED');
  });

  test('2. Rematch Reset (resetTeamSprint) Guards: Protects Active Teammates & Auto-Finalizes Past Grace Cutoff', async () => {
    const { teamCode, memberToken: t1 } = roomManager.createTeam('RematchSquad', 2, 'RM001', 'Player1');
    const { memberToken: t2 } = roomManager.joinTeam(teamCode, 'RM002', 'Player2');

    // Cannot reset while in AWAITING_READY
    assert.throws(
      () => roomManager.resetTeamSprint(teamCode, 'RM001', t1),
      /Cannot reset squad while room is in AWAITING_READY status/
    );

    roomManager.toggleReady(teamCode, 'RM001', true, t1);
    roomManager.toggleReady(teamCode, 'RM002', true, t2);

    await new Promise((r) => setTimeout(r, 3200));
    const room = roomManager.getRoom(teamCode)!;
    assert.equal(room.status, 'IN_SPRINT');

    // Player 1 finishes all 15 questions early, while Player 2 is still solving Q0
    const m1 = room.members.get('RM001')!;
    const m2 = room.members.get('RM002')!;
    const s1 = roomManager.getSession(m1.activeSessionId!)!;
    const s2 = roomManager.getSession(m2.activeSessionId!)!;

    for (let i = 0; i < 15; i++) {
      roomManager.submitAnswer(s1.sessionId, i, s1.questions[i].answer, 500, Date.now(), t1);
    }
    assert.equal(s1.isFinished, true);
    assert.equal(s2.isFinished, false);
    assert.equal(room.status, 'IN_SPRINT');

    // Player 1 clicking Play Again while Player 2 is still active MUST be blocked!
    assert.throws(
      () => roomManager.resetTeamSprint(teamCode, 'RM001', t1),
      /Cannot reset squad while room is in IN_SPRINT status/
    );

    // Even 100ms before expiresAt + 2500ms grace cutoff, Player 2's session must NOT be prematurely killed
    s2.expiresAt = Date.now() - 2000; // within the +2500ms transit grace window!
    assert.throws(
      () => roomManager.resetTeamSprint(teamCode, 'RM001', t1),
      /Cannot reset squad while room is in IN_SPRINT status/
    );

    // Once past the authoritative expiresAt + 2500ms cutoff, resetTeamSprint auto-finalizes and resets cleanly!
    s2.expiresAt = Date.now() - 2600;
    const resetRoom = roomManager.resetTeamSprint(teamCode, 'RM001', t1);
    assert.equal(resetRoom.status, 'AWAITING_READY');
    assert.equal(resetRoom.members.get('RM001')!.individualScore, 0);
    assert.equal(resetRoom.members.get('RM001')!.completedQuestions, 0);
    assert.equal(resetRoom.members.get('RM001')!.isReady, false);
  });

  test('3. SSE sprint_resume Preserves Submissions, MaxStreak & RemainingMs (Anti-Zero-Stats Regression)', async () => {
    const { baseUrl, close } = await startTestServer();
    try {
      const { teamCode, memberToken: t1 } = roomManager.createTeam('ResumeStats', 2, 'RS001', 'Solver1');
      const { memberToken: t2 } = roomManager.joinTeam(teamCode, 'RS002', 'Solver2');

      roomManager.toggleReady(teamCode, 'RS001', true, t1);
      roomManager.toggleReady(teamCode, 'RS002', true, t2);

      await new Promise((r) => setTimeout(r, 3250));

      const room = roomManager.getRoom(teamCode)!;
      const m1 = room.members.get('RS001')!;
      const s1 = roomManager.getSession(m1.activeSessionId!)!;

      // Solver1 answers Q0 (correct), Q1 (correct), Q2 (wrong -> streak resets to 0, maxStreak stays 2), Q3 (correct -> streak 1)
      roomManager.submitAnswer(s1.sessionId, 0, s1.questions[0].answer, 800, Date.now(), t1);
      roomManager.submitAnswer(s1.sessionId, 1, s1.questions[1].answer, 750, Date.now(), t1);
      roomManager.submitAnswer(s1.sessionId, 2, s1.questions[2].answer + 9, 900, Date.now(), t1);
      roomManager.submitAnswer(s1.sessionId, 3, s1.questions[3].answer, 700, Date.now(), t1);

      // Connect to SSE team stream and verify sprint_resume contains full submissions history & maxStreak = 2
      const sseResult = await readSseEventsUntil(
        `${baseUrl}/api/sse/team/${teamCode}?token=${t1}`,
        (buf) => buf.includes('event: sprint_resume')
      );
      sseResult.close();

      assert.ok(sseResult.buffer.includes('event: sprint_resume'), 'Expected sprint_resume SSE event');
      const lines = sseResult.buffer.split('\n');
      const resumeIdx = lines.findIndex((l) => l.trim() === 'event: sprint_resume');
      const dataLine = lines[resumeIdx + 1];
      const payload = JSON.parse(dataLine.replace(/^data:\s*/, ''));

      assert.equal(payload.sessionId, s1.sessionId);
      assert.equal(payload.questionIndex, 4);
      assert.equal(payload.streak, 1);
      assert.equal(payload.maxStreak, 2, 'Peak streak must be preserved across sprint_resume');
      assert.equal(Array.isArray(payload.submissions), true);
      assert.equal(payload.submissions.length, 4, 'All 4 prior submissions must be included in sprint_resume');
      assert.equal(payload.submissions[0].isCorrect, true);
      assert.equal(payload.submissions[1].isCorrect, true);
      assert.equal(payload.submissions[2].isCorrect, false);
      assert.equal(payload.submissions[3].isCorrect, true);
      assert.equal(typeof payload.submissions[0].latencyMs, 'number');
      assert.equal(typeof payload.startedAt, 'number');
      assert.ok(payload.remainingMs > 0 && payload.remainingMs <= 120_000);

      // Now simulate session expiration (now >= expiresAt) -> reconnecting must NOT emit a phantom sprint_resume
      s1.expiresAt = Date.now() - 10;
      const expiredSse = await readSseEventsUntil(
        `${baseUrl}/api/sse/team/${teamCode}?token=${t1}`,
        (buf) => buf.includes('event: team_snapshot'),
        400
      );
      expiredSse.close();
      assert.ok(expiredSse.buffer.includes('event: team_snapshot'));
      assert.equal(
        expiredSse.buffer.includes('event: sprint_resume'),
        false,
        'Expired session must NOT emit phantom sprint_resume'
      );
    } finally {
      await close();
    }
  });

  test('4. Multi-Tab SSE Presence Ref-Counting & Single-Use Admin Stream Ticket Security', async () => {
    const { baseUrl, close } = await startTestServer();
    try {
      const { teamCode, memberToken: t1 } = roomManager.createTeam('MultiTab', 2, 'MT001', 'TabUser');

      // Open Tab 1 and Tab 2 for MT001
      const tab1 = await readSseEventsUntil(
        `${baseUrl}/api/sse/team/${teamCode}?token=${t1}`,
        (buf) => buf.includes('event: team_snapshot')
      );
      const tab2 = await readSseEventsUntil(
        `${baseUrl}/api/sse/team/${teamCode}?token=${t1}`,
        (buf) => buf.includes('event: team_snapshot')
      );

      const room = roomManager.getRoom(teamCode)!;
      assert.equal(room.members.get('MT001')!.connected, true);

      // Closing Tab 1 while Tab 2 is still open must keep MT001 connected === true
      tab1.close();
      await new Promise((r) => setTimeout(r, 80));
      assert.equal(room.members.get('MT001')!.connected, true);

      // Closing Tab 2 drops ref-count to 0 and marks MT001 connected === false
      tab2.close();
      await new Promise((r) => setTimeout(r, 80));
      assert.equal(room.members.get('MT001')!.connected, false);

      // Single-use Admin SSE Ticket: 1st connection succeeds, 2nd connection with same ticket returns 401
      const adminToken = process.env.ADMIN_SECRET || 'hackathon_admin_secret';
      const ticketRes = await fetch(`${baseUrl}/api/admin/stream-ticket`, {
        method: 'POST',
        headers: { 'x-admin-token': adminToken }
      });
      const { ticket } = await ticketRes.json();
      assert.ok(ticket);

      const adminStream1 = await readSseEventsUntil(
        `${baseUrl}/api/sse/admin?ticket=${ticket}`,
        (buf) => buf.includes('event: admin_telemetry')
      );
      assert.equal(adminStream1.status, 200);
      adminStream1.close();

      // Reusing the consumed ticket must fail with 401
      const reuseRes = await fetch(`${baseUrl}/api/sse/admin?ticket=${ticket}`);
      assert.equal(reuseRes.status, 401);
    } finally {
      await close();
    }
  });

  test('5. Controller Input Validation & Adversarial Payload Fuzzing Across All Endpoints', async () => {
    const { baseUrl, close } = await startTestServer();
    try {
      // 5A: /api/team/create invalid payloads
      const longStr = 'A'.repeat(65);
      for (const badBody of [
        {},
        { teamName: '', captainRoll: 'R1', captainName: 'N1' },
        { teamName: longStr, captainRoll: 'R1', captainName: 'N1' },
        { teamName: 'Valid', targetSize: 99, captainRoll: 'R1', captainName: 'N1' }
      ]) {
        const res = await fetch(`${baseUrl}/api/team/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(badBody)
        });
        assert.equal(res.status, 400);
      }

      // 5B: /api/team/join invalid payloads & nonexistent team
      for (const badJoin of [
        { teamCode: '', rollNumber: 'R1', name: 'N1' },
        { teamCode: 'NO-99', rollNumber: 'R1', name: 'N1' }
      ]) {
        const res = await fetch(`${baseUrl}/api/team/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(badJoin)
        });
        assert.equal(res.status, 400);
      }

      // 5C: /api/team/:teamCode snapshot auth modes (404, 401 missing, 401 wrong, 200 query token, 200 Bearer)
      const notFoundRes = await fetch(`${baseUrl}/api/team/ZZ-99`);
      assert.equal(notFoundRes.status, 404);

      const { teamCode, memberToken } = roomManager.createTeam('ValTeam', 2, 'VL001', 'Validator');
      const noTokenSnap = await fetch(`${baseUrl}/api/team/${teamCode}`);
      assert.equal(noTokenSnap.status, 401);

      const badTokenSnap = await fetch(`${baseUrl}/api/team/${teamCode}`, {
        headers: { 'x-member-token': 'forged_token' }
      });
      assert.equal(badTokenSnap.status, 401);

      const queryTokenSnap = await fetch(`${baseUrl}/api/team/${teamCode}?token=${memberToken}`);
      assert.equal(queryTokenSnap.status, 200);

      const bearerTokenSnap = await fetch(`${baseUrl}/api/team/${teamCode}`, {
        headers: { Authorization: `Bearer ${memberToken}` }
      });
      assert.equal(bearerTokenSnap.status, 200);

      // 5D: /api/sprint/submit malformed answers (float, non-numeric string, missing fields)
      for (const badSubmit of [
        { sessionId: 'sess_1', questionIndex: 0, submittedAnswer: '42.5', clientDeltaMs: 500 },
        { sessionId: 'sess_1', questionIndex: 0, submittedAnswer: 'abc', clientDeltaMs: 500 },
        { sessionId: 'sess_1', questionIndex: '0', submittedAnswer: 42, clientDeltaMs: 500 }
      ]) {
        const res = await fetch(`${baseUrl}/api/sprint/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(badSubmit)
        });
        assert.equal(res.status, 400);
        const data = await res.json();
        assert.equal(data.errorCode, 'INVALID_PARAMETERS');
      }

      // 5E: Admin endpoints input validation
      const adminToken = process.env.ADMIN_SECRET || 'hackathon_admin_secret';
      const adminHeaders = { 'Content-Type': 'application/json', 'x-admin-token': adminToken };

      const badWinToggle = await fetch(`${baseUrl}/api/admin/window/toggle`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ open: 'yes' })
      });
      assert.equal(badWinToggle.status, 400);

      const badWinDuration = await fetch(`${baseUrl}/api/admin/window/toggle`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ open: true, durationMinutes: -10 })
      });
      assert.equal(badWinDuration.status, 400);

      // Pausing a LOBBY room must return 400
      const pauseLobbyRes = await fetch(`${baseUrl}/api/admin/teams/${teamCode}/pause`, {
        method: 'POST',
        headers: adminHeaders
      });
      assert.equal(pauseLobbyRes.status, 400);

      // Resuming an unpaused room must return 400
      const resumeUnpausedRes = await fetch(`${baseUrl}/api/admin/teams/${teamCode}/resume`, {
        method: 'POST',
        headers: adminHeaders
      });
      assert.equal(resumeUnpausedRes.status, 400);

      // Excusing with missing rollNumber must return 400
      const badExcuseRes = await fetch(`${baseUrl}/api/admin/teams/${teamCode}/excuse-member`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({})
      });
      assert.equal(badExcuseRes.status, 400);
    } finally {
      await close();
    }
  });

  test('6. Paused Sprint SSE Reconnection & Deadline Extension on Resume', async () => {
    const { baseUrl, close } = await startTestServer();
    try {
      const { teamCode, memberToken: t1 } = roomManager.createTeam('PauseResumeQA', 2, 'PR001', 'PlayerA');
      const { memberToken: t2 } = roomManager.joinTeam(teamCode, 'PR002', 'PlayerB');

      roomManager.toggleReady(teamCode, 'PR001', true, t1);
      roomManager.toggleReady(teamCode, 'PR002', true, t2);
      await new Promise((r) => setTimeout(r, 3250));

      const room = roomManager.getRoom(teamCode)!;
      const m1 = room.members.get('PR001')!;
      const s1 = roomManager.getSession(m1.activeSessionId!)!;
      const initialExpiresAt = s1.expiresAt;

      // Pause room and wait 250ms
      roomManager.pauseRoom(teamCode, 'admin_qa');
      assert.equal(room.isPaused, true);
      await new Promise((r) => setTimeout(r, 250));

      // Reconnecting while paused must still emit sprint_resume with isPaused: true
      const pausedSse = await readSseEventsUntil(
        `${baseUrl}/api/sse/team/${teamCode}?token=${t1}`,
        (buf) => buf.includes('event: sprint_resume')
      );
      pausedSse.close();
      assert.ok(pausedSse.buffer.includes('"isPaused":true'));

      // Resume room and verify expiresAt was extended by >= 200ms
      roomManager.resumeRoom(teamCode, 'admin_qa');
      assert.equal(room.isPaused, false);
      assert.ok(
        s1.expiresAt >= initialExpiresAt + 200,
        `Expected expiresAt to shift forward by pause duration (${s1.expiresAt} vs ${initialExpiresAt})`
      );
    } finally {
      await close();
    }
  });

  test('7. Excusing Unready Member in AWAITING_READY Auto-Launches Countdown When Remaining Members Are Ready', () => {
    const { teamCode, memberToken: t1 } = roomManager.createTeam('ExcuseReadyQA', 3, 'ER001', 'Ready1');
    const { memberToken: t2 } = roomManager.joinTeam(teamCode, 'ER002', 'Ready2');
    roomManager.joinTeam(teamCode, 'ER003', 'CrashedBeforeReady');

    // ER001 and ER002 lock ready; ER003 is unready
    roomManager.toggleReady(teamCode, 'ER001', true, t1);
    const res2 = roomManager.toggleReady(teamCode, 'ER002', true, t2);
    assert.equal(res2.allReady, false);
    assert.equal(res2.room.status, 'AWAITING_READY');

    // Organizer excuses ER003 -> remaining active members (ER001, ER002) are 100% ready -> auto-transitions to COUNTDOWN!
    const excuseRes = roomManager.excuseMember(teamCode, 'ER003', 'Device failed in lobby', 'admin_qa');
    assert.equal(excuseRes.success, true);
    assert.equal(excuseRes.activeMembersCount, 2);
    assert.equal(roomManager.getRoom(teamCode)!.status, 'COUNTDOWN');
  });

  test('8. SSE Channel Auth Guards & Public Leaderboard Stream Initial Handshake', async () => {
    const { baseUrl, close } = await startTestServer();
    try {
      const { teamCode } = roomManager.createTeam('SseAuthQA', 2, 'SA001', 'Capt');

      // Non-existent team SSE returns 404
      const res404 = await fetch(`${baseUrl}/api/sse/team/NO-00?token=abc`);
      assert.equal(res404.status, 404);

      // Missing token on team SSE returns 401
      const resNoTok = await fetch(`${baseUrl}/api/sse/team/${teamCode}`);
      assert.equal(resNoTok.status, 401);

      // Wrong token on team SSE returns 401
      const resBadTok = await fetch(`${baseUrl}/api/sse/team/${teamCode}?token=wrong_token`);
      assert.equal(resBadTok.status, 401);

      // Missing credentials on admin SSE returns 401
      const resAdminUnauth = await fetch(`${baseUrl}/api/sse/admin`);
      assert.equal(resAdminUnauth.status, 401);

      // Public leaderboard SSE stream immediately emits leaderboard_update and window_status
      const lbSse = await readSseEventsUntil(
        `${baseUrl}/api/sse/leaderboard`,
        (buf) => buf.includes('event: leaderboard_update') && buf.includes('event: window_status')
      );
      lbSse.close();
      assert.equal(lbSse.status, 200);
      assert.ok(lbSse.buffer.includes('event: leaderboard_update'));
      assert.ok(lbSse.buffer.includes('event: window_status'));
    } finally {
      await close();
    }
  });
});
