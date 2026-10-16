/**
 * MATIKS HACKATHON ENGINE — ADMIN SECURITY & GOVERNANCE TEST SUITE (adminGovernance.test.ts)
 */

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { adminAuthService } from '../src/services/adminAuthService.js';
import { roomManager } from '../src/services/roomManager.js';
import { leaderboardManager } from '../src/services/leaderboardManager.js';
import { windowManager } from '../src/services/windowManager.js';

describe('Admin Security & Governance Engine Suite', () => {
  beforeEach(() => {
    adminAuthService.resetTarpitForTesting();
    roomManager.clear();
  });

  describe('1. Stateless HMAC-SHA256 Admin Authentication & Progressive Tarpit', () => {
    test('issues valid signed session tokens with sanitized organizer name', () => {
      const token = adminAuthService.issueSessionToken('Harshit @ UFC', 'superadmin');
      assert.ok(token.startsWith('adm.'));
      assert.equal(token.split('.').length, 3);

      const verified = adminAuthService.verifySessionToken(token);
      assert.ok(verified !== null);
      assert.equal(verified?.organizerName, 'Harshit  UFC');
      assert.equal(verified?.role, 'superadmin');
      assert.ok(typeof verified?.expiresAt === 'number');
      assert.ok(verified?.expiresAt! > Date.now());
    });

    test('rejects tampered session tokens and signatures', () => {
      const token = adminAuthService.issueSessionToken('Judge Alpha');
      const parts = token.split('.');
      // Tamper signature
      const badSigToken = `${parts[0]}.${parts[1]}.tampered_signature_xyz`;
      assert.equal(adminAuthService.verifySessionToken(badSigToken), null);

      // Tamper payload
      const badPayloadToken = `${parts[0]}.eyJhZG1pbiI6dHJ1ZX0.${parts[2]}`;
      assert.equal(adminAuthService.verifySessionToken(badPayloadToken), null);
    });

    test('rejects expired session tokens', () => {
      // Issue token that expires immediately (-1000ms)
      const token = adminAuthService.issueSessionToken('Expired Organizer', 'organizer', -1000);
      assert.equal(adminAuthService.verifySessionToken(token), null);
    });

    test('enforces progressive tarpit delays on consecutive failed login attempts', async () => {
      const testIp = '192.168.1.100';

      // 0 failures -> 0 delay
      assert.equal(adminAuthService.getTarpitDelayMs(testIp), 0);

      // 1st failure
      const res1 = await adminAuthService.loginOrganizer('wrong_secret_1', 'Hacker', testIp);
      assert.equal(res1.success, false);
      assert.equal(adminAuthService.getTarpitDelayMs(testIp), 200);

      // 2nd failure
      const res2 = await adminAuthService.loginOrganizer('wrong_secret_2', 'Hacker', testIp);
      assert.equal(res2.success, false);
      assert.equal(adminAuthService.getTarpitDelayMs(testIp), 500);

      // 3rd failure
      const res3 = await adminAuthService.loginOrganizer('wrong_secret_3', 'Hacker', testIp);
      assert.equal(res3.success, false);
      assert.equal(adminAuthService.getTarpitDelayMs(testIp), 1500);

      // Successful login resets tarpit delay
      const resSuccess = await adminAuthService.loginOrganizer('hackathon_admin_secret', 'Harshit', testIp);
      assert.equal(resSuccess.success, true);
      assert.ok(resSuccess.token);
      assert.equal(adminAuthService.getTarpitDelayMs(testIp), 0);
    });
  });

  describe('2. Squad Moderation & Pre-Sprint Lifecycle Guards', () => {
    test('kicks member from LOBBY and reassigns captaincy if captain is kicked', () => {
      const created = roomManager.createTeam('Test Team', 3, 'ROLL_01', 'Captain John');
      const teamCode = created.teamCode;

      roomManager.joinTeam(teamCode, 'ROLL_02', 'Member Priya');
      roomManager.joinTeam(teamCode, 'ROLL_03', 'Member Rohan');

      let room = roomManager.getRoom(teamCode)!;
      assert.equal(room.members.size, 3);
      assert.equal(room.members.get('ROLL_01')?.isCaptain, true);

      // Kick captain
      const kickRes = roomManager.kickMemberFromRoom(teamCode, 'ROLL_01', 'admin_harshit');
      assert.equal(kickRes.success, true);
      assert.equal(kickRes.kickedRollNumber, 'ROLL_01');
      assert.equal(kickRes.remainingMembersCount, 2);

      room = roomManager.getRoom(teamCode)!;
      assert.equal(room.members.size, 2);
      assert.equal(room.members.has('ROLL_01'), false);
      // Next member should be captain
      const remainingCaptain = Array.from(room.members.values()).find(m => m.isCaptain);
      assert.ok(remainingCaptain !== undefined);
      assert.equal(remainingCaptain?.rollNumber, 'ROLL_02');
    });

    test('dissolves room when last member is kicked from LOBBY', () => {
      const created = roomManager.createTeam('Solo Team', 2, 'ROLL_SOLO', 'Solo Alex');
      const teamCode = created.teamCode;

      const kickRes = roomManager.kickMemberFromRoom(teamCode, 'ROLL_SOLO', 'admin_harshit');
      assert.equal(kickRes.success, true);
      assert.equal(kickRes.dissolved, true);
      assert.equal(roomManager.getRoom(teamCode), undefined);
    });

    test('strictly forbids kicking a member during active sprint (IN_SPRINT)', () => {
      const created = roomManager.createTeam('Sprint Team', 2, 'RUN_01', 'Runner');
      const teamCode = created.teamCode;
      roomManager.toggleReady(teamCode, 'RUN_01', true, created.memberToken);

      // Force room status to IN_SPRINT
      const room = roomManager.getRoom(teamCode)!;
      room.status = 'IN_SPRINT';

      assert.throws(
        () => {
          roomManager.kickMemberFromRoom(teamCode, 'RUN_01', 'admin_harshit');
        },
        /Cannot kick member while team is in IN_SPRINT status/
      );
    });

    test('dissolves abandoned pre-sprint room', () => {
      const created = roomManager.createTeam('Abandoned Team', 2, 'AB_01', 'Abandoner');
      const teamCode = created.teamCode;

      const res = roomManager.dissolveRoom(teamCode, 'admin_harshit', 'Abandoned room');
      assert.equal(res.success, true);
      assert.equal(roomManager.getRoom(teamCode), undefined);
    });
  });

  describe('3. Team Disqualification & Score Adjustments', () => {
    test('disqualifies team, sinks them to bottom of leaderboard, and reinstates cleanly', () => {
      const team1 = roomManager.createTeam('Alpha Squad', 2, 'ALICE_01', 'Alice');
      const team2 = roomManager.createTeam('Beta Squad', 2, 'BOB_01', 'Bob');

      // Set scores
      const room1 = roomManager.getRoom(team1.teamCode)!;
      room1.status = 'FINISHED';
      room1.members.get('ALICE_01')!.individualScore = 1500;

      const room2 = roomManager.getRoom(team2.teamCode)!;
      room2.status = 'FINISHED';
      room2.members.get('BOB_01')!.individualScore = 1000;

      // Update leaderboard
      leaderboardManager.updateTeam({
        teamCode: room1.teamCode,
        teamName: room1.teamName,
        teamAverageScore: 1500,
        membersCount: 2,
        activeMembersCount: 2,
        averageTimeSeconds: 40,
        memberBreakdown: [{ name: 'Alice', score: 1500, completedQuestions: 15, isExcused: false }],
        status: 'FINISHED'
      }, true);

      leaderboardManager.updateTeam({
        teamCode: room2.teamCode,
        teamName: room2.teamName,
        teamAverageScore: 1000,
        membersCount: 2,
        activeMembersCount: 2,
        averageTimeSeconds: 50,
        memberBreakdown: [{ name: 'Bob', score: 1000, completedQuestions: 15, isExcused: false }],
        status: 'FINISHED'
      }, true);

      let board = leaderboardManager.getLeaderboard();
      assert.equal(board[0].teamCode, room1.teamCode); // Alice is #1

      // Disqualify Alpha Squad
      roomManager.disqualifyTeam(room1.teamCode, 'admin_harshit', 'Automated script injection');
      assert.equal(room1.isDisqualified, true);

      board = leaderboardManager.getLeaderboard();
      // Alice is disqualified, so Bob becomes #1 and Alice sinks to bottom (#2)
      assert.equal(board[0].teamCode, room2.teamCode);
      assert.equal(board[1].teamCode, room1.teamCode);
      assert.equal(board[1].isDisqualified, true);

      // Reinstate Alpha Squad
      roomManager.reinstateTeam(room1.teamCode, 'admin_harshit');
      assert.equal(room1.isDisqualified, false);

      board = leaderboardManager.getLeaderboard();
      assert.equal(board[0].teamCode, room1.teamCode); // Alice restored to #1
    });

    test('adjusts team score with audit log tracking', () => {
      const created = roomManager.createTeam('Penalty Squad', 2, 'PL_01', 'Player');
      const room = roomManager.getRoom(created.teamCode)!;
      room.status = 'FINISHED';
      room.members.get('PL_01')!.individualScore = 1000;

      const res = roomManager.adjustTeamScore(created.teamCode, -200, 'Late start penalty', 'admin_harshit');
      assert.equal(res.success, true);
      assert.equal(res.newTeamAverageScore, 800);
      assert.equal(room.members.get('PL_01')?.individualScore, 800);
    });
  });

  describe('4. Emergency Global Pause & Resume Controls', () => {
    test('emergency pause halts only IN_SPRINT rooms and emergency resume unfreezes them', () => {
      const sprintRoom = roomManager.createTeam('Sprint Team', 2, 'SP_01', 'Sprinter').teamCode;
      const lobbyRoom = roomManager.createTeam('Lobby Team', 2, 'LB_01', 'Lobbyist').teamCode;

      const r1 = roomManager.getRoom(sprintRoom)!;
      r1.status = 'IN_SPRINT';

      const r2 = roomManager.getRoom(lobbyRoom)!;
      r2.status = 'LOBBY';

      // 1. Emergency Pause All
      const pauseRes = roomManager.emergencyPauseAllSprints('admin_harshit');
      assert.equal(pauseRes.success, true);
      assert.equal(pauseRes.pausedCount, 1);
      assert.deepEqual(pauseRes.pausedTeamCodes, [sprintRoom]);
      assert.equal(r1.isPaused, true);
      assert.equal(r2.isPaused, false); // Lobby unaffected

      // 2. Emergency Resume All
      const resumeRes = roomManager.emergencyResumeAllSprints('admin_harshit');
      assert.equal(resumeRes.success, true);
      assert.equal(resumeRes.resumedCount, 1);
      assert.deepEqual(resumeRes.resumedTeamCodes, [sprintRoom]);
      assert.equal(r1.isPaused, false);
    });
  });

  describe('5. Tournament Round Operator Mode Configuration', () => {
    test('sets and retrieves active round operator mode and stamps new rooms', () => {
      assert.equal(roomManager.getRoundOperatorMode(), 'add');

      roomManager.setRoundOperatorMode('mixed', 'admin_harshit');
      assert.equal(roomManager.getRoundOperatorMode(), 'mixed');

      // Newly created rooms should adopt 'mixed'
      const created = roomManager.createTeam('Mixed Round Team', 2, 'PR_99', 'Priya');
      const room = roomManager.getRoom(created.teamCode)!;
      assert.equal(room.operatorMode, 'mixed');

      // Reset round mode back to 'add'
      roomManager.setRoundOperatorMode('add', 'admin_harshit');
      assert.equal(roomManager.getRoundOperatorMode(), 'add');
    });
  });

  describe('6. Emergency Walk-In Entry Bypass Configuration', () => {
    test('toggles emergency walk-in bypass and appends audit log record', () => {
      windowManager.setEmergencyWalkIn(false);
      assert.equal(windowManager.isEmergencyWalkInEnabled(), false);

      const enabled = windowManager.setEmergencyWalkIn(true);
      assert.equal(enabled, true);
      assert.equal(windowManager.isEmergencyWalkInEnabled(), true);

      roomManager.logSystemAudit({
        action: 'EMERGENCY_WALK_IN_TOGGLE',
        teamCode: 'SYSTEM',
        adminId: 'admin_organizer',
        reason: 'Organizer enabled emergency walk-in entry bypass',
        details: { enabled: true }
      });

      const auditLogs = roomManager.getAuditLogs();
      const lastAudit = auditLogs[auditLogs.length - 1];
      assert.equal(lastAudit?.action, 'EMERGENCY_WALK_IN_TOGGLE');
      assert.equal(lastAudit?.teamCode, 'SYSTEM');

      // Reset back
      windowManager.setEmergencyWalkIn(false);
      assert.equal(windowManager.isEmergencyWalkInEnabled(), false);
    });
  });
});

