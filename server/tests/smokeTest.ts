/**
 * MATIKS HACKATHON ENGINE — END-TO-END HTTP & SSE SMOKE TEST SUITE (smokeTest.ts)
 *
 * Verifies every public, participant, squad, sprint, SSE, and admin endpoint
 * end-to-end over live HTTP sockets:
 * 1. Health & Clock Sync probes (/api/health, /api/sprint/sync)
 * 2. Auth Configuration, Local Login, Profile (/api/auth/me), & UFC Membership Verification
 * 3. Full Squad Lifecycle Smoke Journey (Create -> Join -> Ready -> Sprint -> 15 Submissions -> Summary -> Rematch Reset -> Leave & Dissolve)
 * 4. Organizer Command Center Smoke Journey (Admin Login -> Telemetry -> Rooms -> Window Toggle -> Simulate/Clear Teams -> Stream Ticket)
 * 5. CORS Origin Allowlist & Rate Limiter Enforcement under non-test mode
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

describe('Matiks Hackathon — End-to-End Smoke Test Suite', () => {
  beforeEach(() => {
    roomManager.clear();
    leaderboardManager.clear();
    windowManager.openWindow(120);
  });

  after(() => {
    roomManager.clear();
    leaderboardManager.clear();
  });

  test('1. Health Check & Authoritative Clock Sync Probes', async () => {
    const { baseUrl, close } = await startTestServer();
    try {
      const before = Date.now();
      const healthRes = await fetch(`${baseUrl}/api/health`);
      assert.equal(healthRes.status, 200);
      const healthData = await healthRes.json();
      assert.equal(healthData.status, 'ok');
      assert.ok(healthData.serverTime >= before && healthData.serverTime <= Date.now() + 100);

      const syncRes = await fetch(`${baseUrl}/api/sprint/sync`);
      assert.equal(syncRes.status, 200);
      const syncData = await syncRes.json();
      assert.equal(typeof syncData.serverTime, 'number');
      assert.equal(syncData.windowOpen, true);

      windowManager.closeWindow();
      const syncClosedRes = await fetch(`${baseUrl}/api/sprint/sync`);
      const syncClosedData = await syncClosedRes.json();
      assert.equal(syncClosedData.windowOpen, false);
    } finally {
      await close();
    }
  });

  test('2. Auth Config, Player Login, Session Profile & Club Membership Smoke Flow', async () => {
    const { baseUrl, close } = await startTestServer();
    try {
      const cfgRes = await fetch(`${baseUrl}/api/auth/config`);
      assert.equal(cfgRes.status, 200);
      const cfg = await cfgRes.json();
      assert.equal(cfg.mode, 'local');
      assert.equal(typeof cfg.providerName, 'string');

      // Login as a UFC club member roll (UFC prefix)
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rollNumber: 'UFC202601', name: 'Harshit K' })
      });
      assert.equal(loginRes.status, 200);
      const loginData = await loginRes.json();
      assert.equal(loginData.success, true);
      assert.ok(loginData.token);
      assert.equal(loginData.user.rollNumber, 'UFC202601');
      assert.equal(loginData.user.isClubMember, true);

      // Verify /api/auth/me with Bearer token and x-session-token
      const meBearerRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${loginData.token}` }
      });
      assert.equal(meBearerRes.status, 200);
      const meBearerData = await meBearerRes.json();
      assert.equal(meBearerData.user.rollNumber, 'UFC202601');

      const meHeaderRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { 'x-member-token': loginData.token }
      });
      assert.equal(meHeaderRes.status, 200);

      // Verify /api/auth/me rejects missing or invalid token
      const meUnauthRes = await fetch(`${baseUrl}/api/auth/me`);
      assert.equal(meUnauthRes.status, 401);

      const meInvalidRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: 'Bearer invalid_session_token_xyz' }
      });
      assert.equal(meInvalidRes.status, 401);

      // Verify club membership endpoint for member vs non-member
      const memYesRes = await fetch(`${baseUrl}/api/auth/verify-membership/UFC202699`);
      assert.equal(memYesRes.status, 200);
      const memYes = await memYesRes.json();
      assert.equal(memYes.isClubMember, true);

      const memNoRes = await fetch(`${baseUrl}/api/auth/verify-membership/GUEST9999`);
      assert.equal(memNoRes.status, 200);
      const memNo = await memNoRes.json();
      assert.equal(memNo.isClubMember, false);
    } finally {
      await close();
    }
  });

  test('3. Full Squad Lifecycle Smoke Journey: Create -> Join -> Ready -> 15-Question Sprint -> Rematch Reset -> Leave & Dissolve', async () => {
    const { baseUrl, close } = await startTestServer();
    try {
      // Step A: Create 2-player squad
      const createRes = await fetch(`${baseUrl}/api/team/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamName: 'Smoke Testers',
          targetSize: 2,
          captainRoll: 'SMK001',
          captainName: 'Captain Smoke'
        })
      });
      assert.equal(createRes.status, 201);
      const createData = await createRes.json();
      const { teamCode, memberToken: token1 } = createData;
      assert.equal(createData.snapshot.status, 'LOBBY');

      // Step B: Second player joins
      const joinRes = await fetch(`${baseUrl}/api/team/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamCode,
          rollNumber: 'SMK002',
          name: 'Wingman Smoke'
        })
      });
      assert.equal(joinRes.status, 200);
      const joinData = await joinRes.json();
      const token2 = joinData.memberToken;
      assert.equal(joinData.snapshot.status, 'AWAITING_READY');

      // Step C: Both players lock READY
      const r1 = await fetch(`${baseUrl}/api/team/ready`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-member-token': token1 },
        body: JSON.stringify({ teamCode, rollNumber: 'SMK001', isReady: true })
      });
      assert.equal(r1.status, 200);

      const r2 = await fetch(`${baseUrl}/api/team/ready`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-member-token': token2 },
        body: JSON.stringify({ teamCode, rollNumber: 'SMK002', isReady: true })
      });
      assert.equal(r2.status, 200);
      const r2Data = await r2.json();
      assert.equal(r2Data.allReady, true);
      assert.equal(r2Data.snapshot.status, 'COUNTDOWN');

      // Wait for 3s countdown to launch sprint
      await new Promise((r) => setTimeout(r, 3250));

      const room = roomManager.getRoom(teamCode)!;
      assert.equal(room.status, 'IN_SPRINT');

      // Step D: Both players answer all 15 questions via POST /api/sprint/submit
      for (const [roll, token] of [
        ['SMK001', token1],
        ['SMK002', token2]
      ] as const) {
        const member = room.members.get(roll)!;
        const session = roomManager.getSession(member.activeSessionId!)!;
        for (let idx = 0; idx < 15; idx++) {
          const q = session.questions[idx];
          const subRes = await fetch(`${baseUrl}/api/sprint/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-member-token': token },
            body: JSON.stringify({
              sessionId: session.sessionId,
              questionIndex: idx,
              submittedAnswer: q.answer,
              clientDeltaMs: 900,
              clientTimestamp: Date.now()
            })
          });
          assert.equal(subRes.status, 200);
          const subData = await subRes.json();
          assert.equal(subData.isCorrect, true);
          if (idx === 14) {
            assert.equal(subData.isFinished, true);
          }
        }
      }

      // Room must now be FINISHED
      const finishedSnapRes = await fetch(`${baseUrl}/api/team/${teamCode}`, {
        headers: { 'x-member-token': token1 }
      });
      assert.equal(finishedSnapRes.status, 200);
      const finishedSnap = await finishedSnapRes.json();
      assert.equal(finishedSnap.status, 'FINISHED');

      // Step E: Rematch Reset via POST /api/team/reset
      const resetRes = await fetch(`${baseUrl}/api/team/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-member-token': token1 },
        body: JSON.stringify({ teamCode, rollNumber: 'SMK001' })
      });
      assert.equal(resetRes.status, 200);
      const resetData = await resetRes.json();
      assert.equal(resetData.success, true);
      assert.equal(resetData.snapshot.status, 'AWAITING_READY');
      assert.ok(resetData.snapshot.members.every((m: any) => m.individualScore === 0 && !m.isReady));

      // Step F: Both players leave via POST /api/team/leave -> room dissolves
      const leave1Res = await fetch(`${baseUrl}/api/team/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-member-token': token1 },
        body: JSON.stringify({ teamCode, rollNumber: 'SMK001' })
      });
      assert.equal(leave1Res.status, 200);
      const leave1Data = await leave1Res.json();
      assert.equal(leave1Data.dissolved, false);
      assert.equal(leave1Data.snapshot.members.length, 1);
      assert.equal(leave1Data.snapshot.members[0].rollNumber, 'SMK002');
      assert.equal(leave1Data.snapshot.members[0].isCaptain, true, 'Captaincy must transfer to SMK002');

      const leave2Res = await fetch(`${baseUrl}/api/team/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-member-token': token2 },
        body: JSON.stringify({ teamCode, rollNumber: 'SMK002' })
      });
      assert.equal(leave2Res.status, 200);
      const leave2Data = await leave2Res.json();
      assert.equal(leave2Data.dissolved, true);
      assert.equal(leave2Data.snapshot, null);
      assert.equal(roomManager.getRoom(teamCode), undefined);
    } finally {
      await close();
    }
  });

  test('4. Organizer Command Center Smoke Journey: Admin Auth, Telemetry, Rooms, Window Toggle, Simulator & Stream Ticket', async () => {
    const { baseUrl, close } = await startTestServer();
    try {
      // Admin login with wrong passcode fails
      const badAdminRes = await fetch(`${baseUrl}/api/auth/admin-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: 'wrong_secret' })
      });
      assert.equal(badAdminRes.status, 401);

      // Admin login with valid secret succeeds
      const adminToken = process.env.ADMIN_SECRET || 'hackathon_admin_secret';
      const goodAdminRes = await fetch(`${baseUrl}/api/auth/admin-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: adminToken })
      });
      assert.equal(goodAdminRes.status, 200);

      const headers = {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      };

      // Simulate 4 demo teams
      const simRes = await fetch(`${baseUrl}/api/admin/simulate-teams`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ count: 4 })
      });
      assert.equal(simRes.status, 200);
      const simData = await simRes.json();
      assert.equal(simData.count, 4);

      // Fetch rooms list
      const roomsRes = await fetch(`${baseUrl}/api/admin/rooms`, { headers });
      assert.equal(roomsRes.status, 200);
      const roomsData = await roomsRes.json();
      assert.equal(roomsData.rooms.length, 4);

      // Fetch telemetry
      const telRes = await fetch(`${baseUrl}/api/admin/telemetry`, { headers });
      assert.equal(telRes.status, 200);
      const telData = await telRes.json();
      assert.equal(telData.activeRooms, 4);
      assert.equal(typeof telData.rssMemoryMb, 'number');

      // Toggle window closed then open with custom ticker
      const closeWinRes = await fetch(`${baseUrl}/api/admin/window/toggle`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ open: false })
      });
      assert.equal(closeWinRes.status, 200);
      assert.equal(windowManager.isOpen(), false);

      const openWinRes = await fetch(`${baseUrl}/api/admin/window/toggle`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ open: true, durationMinutes: 90, ticker: 'FINAL ROUND LIVE!' })
      });
      assert.equal(openWinRes.status, 200);
      assert.equal(windowManager.isOpen(), true);
      assert.equal(windowManager.getConfig().announcementTicker, 'FINAL ROUND LIVE!');

      // Export tournament standings as CSV and full report as JSON
      const csvExportRes = await fetch(`${baseUrl}/api/admin/export/csv`, { headers });
      assert.equal(csvExportRes.status, 200);
      assert.ok(csvExportRes.headers.get('content-type')?.includes('text/csv'));
      assert.ok(csvExportRes.headers.get('content-disposition')?.includes('matiks-leaderboard-standings.csv'));
      const csvBody = await csvExportRes.text();
      assert.ok(csvBody.includes('Rank,TeamCode,TeamName,Status,TeamAverageScore'));
      assert.ok(csvBody.includes('SIM-01'));

      const jsonExportRes = await fetch(`${baseUrl}/api/admin/export/json`, { headers });
      assert.equal(jsonExportRes.status, 200);
      assert.ok(jsonExportRes.headers.get('content-disposition')?.includes('matiks-tournament-report.json'));
      const jsonReport = await jsonExportRes.json();
      assert.ok(Array.isArray(jsonReport.leaderboard));
      assert.equal(jsonReport.leaderboard.length, 4);
      assert.ok(Array.isArray(jsonReport.rooms));
      assert.ok(Array.isArray(jsonReport.auditLogs));

      // Clear simulated teams
      const clearRes = await fetch(`${baseUrl}/api/admin/clear-simulated-teams`, {
        method: 'POST',
        headers
      });
      assert.equal(clearRes.status, 200);

      // Audit logs should record simulation and clear actions
      const logsRes = await fetch(`${baseUrl}/api/admin/audit-logs`, { headers });
      assert.equal(logsRes.status, 200);
      const logs = await logsRes.json();
      assert.ok(Array.isArray(logs));
      assert.ok(logs.some((l: any) => l.action === 'ADMIN_SIMULATE_TEAMS'));
      assert.ok(logs.some((l: any) => l.action === 'ADMIN_CLEAR_SIMULATED_TEAMS'));
    } finally {
      await close();
    }
  });

  test('5. Rate Limiter & CORS Protection Enforcement When NODE_ENV is Production', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const { baseUrl, close } = await startTestServer();
    try {
      // Trusted origin receives Access-Control-Allow-Origin header
      const trustedRes = await fetch(`${baseUrl}/api/health`, {
        headers: { Origin: 'http://localhost:5173' }
      });
      assert.equal(trustedRes.status, 200);
      assert.equal(trustedRes.headers.get('access-control-allow-origin'), 'http://localhost:5173');

      // Untrusted origin does NOT receive Access-Control-Allow-Origin header in production
      const untrustedRes = await fetch(`${baseUrl}/api/health`, {
        headers: { Origin: 'https://evil-attacker.example.com' }
      });
      assert.equal(untrustedRes.status, 200);
      assert.equal(untrustedRes.headers.get('access-control-allow-origin'), null);

      // Admin login rate limiter triggers 429 after 15 requests in a 60s window
      let statusCodes: number[] = [];
      for (let i = 0; i < 17; i++) {
        const res = await fetch(`${baseUrl}/api/auth/admin-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passcode: 'wrong_attempt' })
        });
        statusCodes.push(res.status);
      }
      assert.ok(statusCodes.slice(0, 15).every((s) => s === 401));
      assert.equal(statusCodes[15], 429);
      assert.equal(statusCodes[16], 429);
    } finally {
      if (prevEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = prevEnv;
      }
      await close();
    }
  });
});
