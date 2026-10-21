import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RoomManager } from '../src/services/roomManager.js';
import { leaderboardManager } from '../src/services/leaderboardManager.js';
import { WindowManager, windowManager } from '../src/services/windowManager.js';
import { DatabaseService } from '../src/services/databaseService.js';
import { databaseService } from '../src/services/databaseService.js';
import { roomManager } from '../src/services/roomManager.js';
import { statePersistence } from '../src/services/statePersistence.js';
import { restoreTournamentState } from '../src/bootstrap/restoreState.js';
import { sseHub } from '../src/services/sseHub.js';

let manager: RoomManager;
beforeEach(() => {
  manager = new RoomManager();
  manager.setAuditDir(mkdtempSync(join(tmpdir(), 'matiks-ranking-')));
  windowManager.closeWindow();
  windowManager.openWindow(120);
  leaderboardManager.clear();
});
afterEach(() => { manager.clear(); leaderboardManager.clear(); windowManager.closeWindow(); });

function launch(size = 1) {
  const created = manager.createTeam('Ranking regression', size, 'RANK1', 'One');
  if (size === 2) manager.joinTeam(created.teamCode, 'RANK2', 'Two');
  created.room.status = 'COUNTDOWN';
  (manager as any).launchSprint(created.room);
  return created;
}

test('a finished team cannot reset or launch a second sprint in the same window', () => {
  const { room, teamCode, memberToken } = launch();
  room.status = 'FINISHED';
  const session = manager.getSession(room.members.get('RANK1')!.activeSessionId!)!;
  session.isFinished = true;
  room.members.get('RANK1')!.individualScore = 800;
  assert.throws(() => manager.resetTeamSprint(teamCode, 'RANK1', memberToken), /already participated|once per|already used/i);
  assert.equal(room.members.get('RANK1')!.individualScore, 800);
  assert.throws(() => (manager as any).launchSprint(room), /already participated|once per|already used/i);
});

test('attempt claim survives a snapshot restore and room recreation', () => {
  const { room, teamCode, memberToken } = launch();
  room.status = 'FINISHED';
  manager.getSession(room.members.get('RANK1')!.activeSessionId!)!.isFinished = true;
  const snapshot = manager.exportStateSnapshot();
  manager.clear();
  manager.restoreStateSnapshot(snapshot);
  assert.throws(() => manager.resetTeamSprint(teamCode, 'RANK1', memberToken), /already participated|once per|already used/i);
  manager.dissolveRoom(teamCode, 'test', 'Exercise recreation guard');
  assert.throws(() => {
    const recreated = manager.createTeam('Recreated', 1, 'RANK1', 'One', false, 'add', teamCode);
    recreated.room.status = 'COUNTDOWN';
    (manager as any).launchSprint(recreated.room);
  }, /already participated|once per|already used/i);
});

test('extending an open window preserves its identity; reopening creates a new identity', () => {
  const first = windowManager.getConfig().opensAt;
  assert.equal(windowManager.openWindow(60).opensAt, first);
  windowManager.closeWindow();
  assert.ok(windowManager.openWindow(60).opensAt > first);
});

test('a new window allows another attempt and clears the previous score adjustment', () => {
  const { room, teamCode, memberToken } = launch();
  room.status = 'FINISHED'; room.scoreAdjustment = -100;
  manager.getSession(room.members.get('RANK1')!.activeSessionId!)!.isFinished = true;
  windowManager.closeWindow(); windowManager.openWindow(120);
  manager.resetTeamSprint(teamCode, 'RANK1', memberToken);
  assert.equal(room.scoreAdjustment, 0);
  room.status = 'COUNTDOWN';
  assert.doesNotThrow(() => (manager as any).launchSprint(room));
});

test('tie-break time averages member completion and excludes pauses', () => {
  const { room } = launch(2);
  const base = Date.now() - 60_000;
  room.startedAt = base; room.completedAt = base + 60_000; room.status = 'FINISHED';
  [...room.members.values()].forEach((m, index) => {
    m.individualScore = 500;
    const session = manager.getSession(m.activeSessionId!)!;
    session.startedAt = base;
    session.expiresAt = base + 120_000 + 10_000;
    session.completedQuestions = 15; session.isFinished = true;
    session.submissions = Array.from({ length: 15 }, (_, q) => ({ questionIndex: q, submittedAnswer: 0, isCorrect: true, latencyMs: 1000, pointsAwarded: 0, timestamp: base + (index === 0 ? 20_000 : 40_000), isAnomaly: false }));
  });
  (manager as any).syncLeaderboard(room, true);
  assert.equal(leaderboardManager.getLeaderboard()[0].averageTimeSeconds, 20);
});

test('timeout tie-break excludes network grace and scores never go below zero', () => {
  const { room } = launch();
  const member = room.members.get('RANK1')!, session = manager.getSession(member.activeSessionId!)!;
  const answer = session.questions[0].answer;
  manager.submitAnswer(session.sessionId, 0, answer + 1, 1000, Date.now(), member.token);
  assert.equal(session.currentScore, 0);
  manager.adjustTeamScore(room.teamCode, -100, 'Penalty', 'test');
  assert.equal(member.individualScore, 0);
  room.status = 'FINISHED'; room.completedAt = session.expiresAt + 2500; session.isFinished = true;
  (manager as any).syncLeaderboard(room, true);
  assert.equal(leaderboardManager.getLeaderboard()[0].averageTimeSeconds, 120);
});

test('disk snapshot includes window identity and organizer controls', () => {
  const opening = windowManager.getConfig().opensAt;
  const snapshot = manager.exportStateSnapshot();
  windowManager.closeWindow();
  manager.restoreStateSnapshot(snapshot);
  assert.equal(windowManager.isOpen(), true);
  assert.equal(windowManager.getConfig().opensAt, opening);
});

test('window closes and notifies listeners at its deadline without an API request', async () => {
  const window = new WindowManager();
  let closed = false;
  window.onClose(() => { closed = true; });
  window.openWindow(0.0001);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(closed, true);
});

test('SQL restore preserves penalties, real progress, and the latest sprint', async () => {
  const db = new DatabaseService(), now = Date.now();
  const question = { id: 'q', a: 11, b: 22, operator: '+', answer: 33, bucket: 'B1', carryType: 'NONE', targetLatencyMs: 1000 };
  const latest = { sessionId: 'sess_RANK1_latest', teamCode: 'AA-01', rollNumber: 'RANK1', startedAt: BigInt(now - 30_000), expiresAt: BigInt(now + 90_000), isFinished: true, isPaused: false, score: 800, questions: Array(15).fill(question), updatedAt: new Date(now), submissions: [{ questionIndex: 0, userAnswer: 33, expectedAnswer: 33, operandA: 11, operandB: 22, operator: '+', bucket: 'B1', isCorrect: true, latencyMs: 1000, pointsAwarded: 1000, streak: 1, submittedAt: BigInt(now - 10_000), isAnomaly: false }] };
  (db as any).isConnected = true;
  (db as any).prisma = {
    team: { findMany: async () => [{ teamCode: 'AA-01', teamName: 'Penalty', targetSize: 1, operatorMode: 'add', status: 'FINISHED', captainRoll: 'RANK1', isDisqualified: false, scoreAdjustment: -200, createdAt: new Date(now), updatedAt: new Date(now), members: [{ rollNumber: 'RANK1', name: 'One', isExcused: false, memberToken: 'probe' }] }] },
    sprintSession: { findMany: async () => [{ ...latest, sessionId: 'sess_RANK1_old', startedAt: BigInt(now - 300_000), expiresAt: BigInt(now - 180_000), score: 2000 }, latest] },
    auditLog: { findMany: async () => [] },
    tournamentWindow: { findUnique: async () => ({ isOpen: true, openedAt: BigInt(now - 60_000), closesAt: BigInt(now + 60_000), roundMode: 'add', updatedAt: new Date(now) }) }
  };
  const snapshot = (await db.hydrateFromDatabase())!;
  const member = snapshot.rooms[0].members[0][1];
  assert.equal(member.individualScore, 800);
  assert.equal(member.completedQuestions, 1);
  assert.equal(member.activeSessionId, latest.sessionId);
  assert.equal(snapshot.sessions.find(([id]) => id === latest.sessionId)![1].currentScore, 800);
  assert.equal(snapshot.rooms[0].startedAt, Number(latest.startedAt));
});

test('a later team pause does not alter a member who already finished', () => {
  const { room } = launch(2);
  const session = manager.getSession(room.members.get('RANK1')!.activeSessionId!)!;
  session.isFinished = true; session.completedQuestions = 15;
  const expiry = session.expiresAt;
  manager.pauseRoom(room.teamCode, 'test');
  room.pausedAt = Date.now() - 10_000;
  manager.resumeRoom(room.teamCode, 'test');
  assert.equal(session.expiresAt, expiry);
});

test('cancelled countdown consumes no attempt and legacy sessions still prevent replay', () => {
  const { room, teamCode, memberToken } = manager.createTeam('Countdown', 1, 'RANK1', 'One');
  manager.toggleReady(teamCode, 'RANK1', true, memberToken);
  assert.equal(manager.getSnapshot(room).contestWindow.hasParticipated, false);
  manager.onWindowClosed();
  assert.equal(manager.getSnapshot(room).contestWindow.hasParticipated, false);
  room.status = 'COUNTDOWN'; (manager as any).launchSprint(room);
  const snapshot = manager.exportStateSnapshot();
  snapshot.auditLogs = []; // Upgrade from an older snapshot without attempt events.
  snapshot.rooms[0].startedAt = undefined;
  snapshot.rooms[0].status = 'AWAITING_READY';
  manager.restoreStateSnapshot(snapshot);
  assert.equal(manager.getSnapshot(manager.getRoom(teamCode)!).contestWindow.hasParticipated, true);
});

test('equal scores, time, and names have deterministic team-code order', () => {
  const row = { teamName: 'Same', teamAverageScore: 100, averageTimeSeconds: 20, membersCount: 1, activeMembersCount: 1, memberBreakdown: [], status: 'FINISHED' as const };
  leaderboardManager.updateTeam({ ...row, teamCode: 'ZZ-99' }, true);
  leaderboardManager.updateTeam({ ...row, teamCode: 'AA-01' }, true);
  assert.deepEqual(leaderboardManager.getLeaderboard().map(e => e.teamCode), ['AA-01', 'ZZ-99']);
});

test('voluntary departure cannot remove a low score or erase a completed result', () => {
  const { room } = launch(2);
  room.status = 'FINISHED';
  room.members.get('RANK1')!.individualScore = 500;
  room.members.get('RANK2')!.individualScore = 0;
  (manager as any).syncLeaderboard(room, true);
  manager.leaveTeam(room.teamCode, 'RANK2', room.members.get('RANK2')!.token);
  assert.equal(room.members.size, 2);
  assert.equal(room.members.get('RANK2')!.connected, false);
  assert.equal(leaderboardManager.getLeaderboard()[0].teamAverageScore, 250);
});

test('SQL-only recovery retains an empty window and attempt claims after all rooms dissolve', async () => {
  const db = new DatabaseService(), opening = windowManager.getConfig().opensAt;
  (db as any).isConnected = true;
  (db as any).prisma = {
    team: { findMany: async () => [] }, sprintSession: { findMany: async () => [] },
    auditLog: { findMany: async () => [{ id: 'claim', timestamp: BigInt(opening), action: 'SPRINT_STARTED', targetTeam: 'AA-01', performedBy: 'SYSTEM', details: { windowOpenedAt: opening, rollNumbers: ['RANK1'] } }] },
    tournamentWindow: { findUnique: async () => ({ isOpen: true, openedAt: BigInt(opening), closesAt: BigInt(Date.now() + 60_000), roundMode: 'add', updatedAt: new Date() }) }
  };
  const snapshot = await db.hydrateFromDatabase();
  assert.ok(snapshot);
  manager.restoreStateSnapshot(snapshot);
  const { room } = manager.createTeam('Recreated after restart', 1, 'RANK1', 'One', false, 'add', 'AA-01');
  assert.equal(manager.getSnapshot(room).contestWindow.hasParticipated, true);
});

test('a newer unrelated SQL write cannot replace a newer disk window with an older window', async t => {
  const { room } = launch();
  const disk = manager.exportStateSnapshot();
  const opening = windowManager.getConfig().opensAt;
  const database = structuredClone(disk);
  database.savedAt = disk.savedAt + 1000;
  database.control!.window.opensAt = opening - 60_000;
  database.auditLogs = [];
  t.mock.method(statePersistence, 'readDiskSnapshot', () => disk);
  t.mock.method(databaseService, 'connect', async () => true);
  t.mock.method(databaseService, 'hydrateFromDatabase', async () => database);
  try {
    await restoreTournamentState();
    assert.equal(windowManager.getConfig().opensAt, opening);
    assert.equal(roomManager.getSnapshot(roomManager.getRoom(room.teamCode)!).contestWindow.hasParticipated, true);
  } finally { statePersistence.disableAutoSave(); roomManager.clear(); }
});

test('window close releases current standings before triggering the public ceremony', t => {
  const events: string[] = [];
  t.mock.method(sseHub, 'broadcast', (channel: string, event: string) => { if (channel === 'leaderboard') events.push(event); });
  windowManager.closeWindow();
  assert.ok(events.indexOf('leaderboard_update') < events.indexOf('window_status'));
});

test('a penalty saved to disk survives newer unrelated SQL activity', async t => {
  const { room } = launch();
  const member = room.members.get('RANK1')!, session = manager.getSession(member.activeSessionId!)!;
  session.currentScore = member.individualScore = 1000;
  manager.adjustTeamScore(room.teamCode, -200, 'Penalty', 'test');
  const disk = manager.exportStateSnapshot();
  const database = structuredClone(disk);
  database.savedAt = disk.savedAt + 1000;
  database.auditLogs = [];
  database.sessions[0][1].currentScore = 1000;
  database.sessions[0][1].updatedAt = session.startedAt;
  database.rooms[0].members[0][1].individualScore = 1000;
  t.mock.method(statePersistence, 'readDiskSnapshot', () => disk);
  t.mock.method(databaseService, 'connect', async () => true);
  t.mock.method(databaseService, 'hydrateFromDatabase', async () => database);
  try {
    await restoreTournamentState();
    assert.equal(roomManager.getSession(session.sessionId)!.currentScore, 800);
    assert.equal(roomManager.getRoom(room.teamCode)!.members.get('RANK1')!.individualScore, 800);
  } finally { statePersistence.disableAutoSave(); roomManager.clear(); }
});

test('a delayed submission retry cannot overwrite a newer admin penalty in SQL', async () => {
  const db = new DatabaseService(), timestamp = Date.now();
  let score = 800, storedAnswers = 0;
  const revision = timestamp + 100;
  const tx = {
    questionSubmission: { create: async () => { storedAnswers++; } },
    sprintSession: {
      update: async ({ data }: any) => { score = data.score; },
      updateMany: async ({ where, data }: any) => {
        if (revision <= where.updatedAt.lte.getTime()) { score = data.score; return { count: 1 }; }
        return { count: 0 };
      }
    }
  };
  (db as any).prisma = {
    sprintSession: { findUnique: async () => ({ sessionId: 'old-answer', updatedAt: new Date(revision), score }) },
    $transaction: async (fn: (value: typeof tx) => Promise<void>) => fn(tx)
  };
  await (db as any).writeSubmission({ kind: 'submission', sessionId: 'old-answer', rollNumber: 'RANK1', sub: {
    questionIndex: 0, submittedAnswer: 1, isCorrect: true, latencyMs: 1000, pointsAwarded: 1000, scoreAfter: 1000, timestamp
  } }, false);
  assert.equal(storedAnswers, 1);
  assert.equal(score, 800);
});

test('a pause saved to disk survives newer unrelated SQL activity', async t => {
  const { room } = launch();
  manager.pauseRoom(room.teamCode, 'test');
  const disk = manager.exportStateSnapshot(), database = structuredClone(disk);
  database.savedAt = disk.savedAt + 1000;
  database.rooms[0].isPaused = false;
  database.rooms[0].pausedAt = undefined;
  database.rooms[0].updatedAt = room.createdAt;
  t.mock.method(statePersistence, 'readDiskSnapshot', () => disk);
  t.mock.method(databaseService, 'connect', async () => true);
  t.mock.method(databaseService, 'hydrateFromDatabase', async () => database);
  try {
    await restoreTournamentState();
    assert.equal(roomManager.getRoom(room.teamCode)!.isPaused, true);
  } finally { statePersistence.disableAutoSave(); roomManager.clear(); }
});
