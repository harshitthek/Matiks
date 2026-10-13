/**
 * MATIKS HACKATHON ENGINE — DATABASE SERVICE UNIT TEST SUITE (databaseService.test.ts)
 *
 * Validates the hybrid relational persistence layer:
 * 1. Safe connection probing and fallback handling when PostgreSQL is offline.
 * 2. Non-blocking async write-through operations (syncTeam, syncSprintSession, syncSubmission, syncLeaderboard, recordAudit).
 * 3. Safe cold-boot hydration fallback.
 * 4. Multi-hook persistence event registration in RoomManager.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseService } from '../src/services/databaseService.js';
import { roomManager } from '../src/services/roomManager.js';
import type { TeamRoom, SprintSession, SubmissionRecord, LeaderboardEntry, AuditRecord } from '../src/types/sse.js';

describe('DatabaseService — Hybrid Relational Persistence', () => {
  let db: DatabaseService;
  let originalDbUrl: string | undefined;

  beforeEach(() => {
    originalDbUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    db = new DatabaseService();
  });

  afterEach(async () => {
    await db.disconnect();
    if (originalDbUrl !== undefined) {
      process.env.DATABASE_URL = originalDbUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  test('initializes cleanly in disconnected state without active database', () => {
    assert.strictEqual(db.isDbConnected(), false);
  });

  test('connect() safely returns false without throwing when PostgreSQL is unreachable', async () => {
    // Attempt connecting with a very short timeout
    const connected = await db.connect(50);
    assert.strictEqual(connected, false);
    assert.strictEqual(db.isDbConnected(), false);
  });

  test('syncTeam() gracefully handles disconnected state as a no-op', async () => {
    const mockRoom: TeamRoom = {
      teamCode: 'ZZ-99',
      teamName: 'Offline Squad',
      targetSize: 3,
      members: new Map([
        [
          'TEST001',
          {
            rollNumber: 'TEST001',
            name: 'Alice',
            isCaptain: true,
            isReady: true,
            isExcused: false,
            connected: true,
            individualScore: 100,
            completedQuestions: 1,
            lastActiveAt: Date.now(),
            token: 'tok_test001'
          }
        ]
      ]),
      status: 'LOBBY',
      isPaused: false,
      createdAt: Date.now(),
      operatorMode: 'add'
    };

    // Must not throw or reject
    await assert.doesNotReject(async () => {
      await db.syncTeam(mockRoom);
    });
  });

  test('syncSprintSession() gracefully handles disconnected state as a no-op', async () => {
    const mockSession: SprintSession = {
      sessionId: 'sess_test_123',
      teamCode: 'ZZ-99',
      rollNumber: 'TEST001',
      startedAt: Date.now(),
      expiresAt: Date.now() + 120_000,
      questions: [],
      submissions: [],
      currentScore: 250,
      consecutiveStreak: 2,
      completedQuestions: 2,
      isFinished: false,
      operatorMode: 'add'
    };

    await assert.doesNotReject(async () => {
      await db.syncSprintSession(mockSession);
    });
  });

  test('syncSubmission() gracefully handles disconnected state as a no-op', async () => {
    const mockSubmission: SubmissionRecord = {
      questionIndex: 0,
      submittedAnswer: 42,
      actualAnswer: 42,
      a: 20,
      b: 22,
      operator: '+',
      bucket: 'B1',
      isCorrect: true,
      latencyMs: 1200,
      pointsAwarded: 100,
      timestamp: Date.now(),
      isAnomaly: false
    };

    await assert.doesNotReject(async () => {
      await db.syncSubmission('sess_test_123', 'TEST001', mockSubmission);
    });
  });

  test('syncLeaderboard() gracefully handles disconnected state as a no-op', async () => {
    const mockStandings: LeaderboardEntry[] = [
      {
        rank: 1,
        teamCode: 'ZZ-99',
        teamName: 'Offline Squad',
        teamAverageScore: 100,
        membersCount: 3,
        activeMembersCount: 3,
        averageTimeSeconds: 45.2,
        memberBreakdown: [],
        status: 'IN_SPRINT'
      }
    ];

    await assert.doesNotReject(async () => {
      await db.syncLeaderboard(mockStandings);
    });
  });

  test('recordAudit() gracefully handles disconnected state as a no-op', async () => {
    const mockAudit: AuditRecord = {
      id: `aud_test_${Date.now()}`,
      timestamp: Date.now(),
      action: 'ROOM_PAUSE',
      teamCode: 'ZZ-99',
      adminId: 'ADMIN_TEST',
      reason: 'Network check'
    };

    await assert.doesNotReject(async () => {
      await db.recordAudit(mockAudit);
    });
  });

  test('hydrateFromDatabase() returns null in disconnected state without error', async () => {
    const hydrated = await db.hydrateFromDatabase();
    assert.strictEqual(hydrated, null);
  });

  test('disconnect() executes safely when disconnected or multiple times', async () => {
    await assert.doesNotReject(async () => {
      await db.disconnect();
      await db.disconnect();
    });
  });

  test('deletion methods (deleteTeam, deleteMember, deleteTeams) execute safely in disconnected state', async () => {
    await assert.doesNotReject(async () => {
      await db.deleteTeam('ZZ-99');
      await db.deleteMember('ZZ-99', 'TEST001');
      await db.deleteTeams(['ZZ-99', 'ZZ-98']);
    });
  });
});

describe('RoomManager — Multi-Hook Persistence Integration', () => {
  test('invokes multiple registered persistence hooks when state mutates', () => {
    let hook1Called = 0;
    let hook2Called = 0;

    const hook1 = () => { hook1Called++; };
    const hook2 = () => { hook2Called++; };

    roomManager.addPersistenceHook(hook1);
    roomManager.addPersistenceHook(hook2);

    try {
      // Trigger state mutation by creating team
      const { teamCode } = roomManager.createTeam('Hook Squad', 2, 'HK001', 'Hook Leader');
      assert.ok(hook1Called >= 1);
      assert.ok(hook2Called >= 1);

      // Remove hook1 and verify only hook2 fires
      roomManager.removePersistenceHook(hook1);
      const prevHook1 = hook1Called;
      const prevHook2 = hook2Called;

      roomManager.dissolveRoom(teamCode, 'ADMIN', 'Test teardown');
      assert.strictEqual(hook1Called, prevHook1);
      assert.ok(hook2Called > prevHook2);
    } finally {
      roomManager.removePersistenceHook(hook1);
      roomManager.removePersistenceHook(hook2);
      roomManager.clear();
    }
  });
});
