/**
 * MATIKS HACKATHON ENGINE — RESTORING THE GAME ON BOOT (restoreState.ts)
 *
 * Where the game comes back from after a restart:
 *
 *   STATE_BACKEND=upstash and Redis has a saved game  ->  Redis. One source, no merging.
 *   anything else                                      ->  the older path: the disk snapshot and PostgreSQL, reconciled
 *                                                          (also how the very first boot after switching Redis on seeds it).
 *
 * The older path is unchanged from when it lived in index.ts, and stays as the fallback so that turning Redis on can never lose a game
 * that only exists on disk or in the database.
 */

import { roomManager, type PersistedTournamentState } from '../services/roomManager.js';
import { databaseService } from '../services/databaseService.js';
import { statePersistence } from '../services/statePersistence.js';
import { windowManager } from '../services/windowManager.js';
import { metrics } from '../services/metrics.js';
import { gameStateMirror, LeaseHeldError } from '../store/gameStateMirror.js';
import { pingRedis, redisEnabled, RedisUnavailableError } from '../store/redis.js';
import { reconcileControlState } from '../store/controlState.js';

export type RestoreSource = 'redis' | 'database' | 'disk' | 'none';

export interface RestoreReport {
  backend: 'upstash' | 'memory';
  source: RestoreSource;
  teams: number;
}

/** Pushes restored rooms and sessions to PostgreSQL, so a restore also heals the archive. */
function syncRestoredStateToDb(isDbConnected: boolean): void {
  if (!isDbConnected) return;
  for (const room of roomManager.getRoomEntities()) {
    void databaseService.syncTeam(room);
  }
  for (const session of roomManager.getSessionEntities()) {
    const room = roomManager.getRoom(session.teamCode);
    void databaseService.syncSprintSession(session, room?.isPaused, room?.pausedAt);
  }
}

const withoutDissolved = (state: PersistedTournamentState, dissolved: Set<string>): PersistedTournamentState => ({
  ...state,
  rooms: state.rooms.filter((r) => !dissolved.has(r.teamCode)),
  sessions: state.sessions.filter(([, s]) => !dissolved.has(s.teamCode)),
  rollToTeamMap: state.rollToTeamMap.filter(([, code]) => !dissolved.has(code))
});

/** The disk snapshot and PostgreSQL, reconciled. Moved here unchanged from index.ts. */
async function restoreFromDiskAndDatabase(): Promise<RestoreSource> {
  const diskState = statePersistence.readDiskSnapshot();
  const isDbConnected = await databaseService.connect();

  if (isDbConnected) {
    const dbState = await databaseService.hydrateFromDatabase();
    const dissolvedTeamCodes = new Set(
      [...(dbState?.auditLogs || []), ...(diskState?.auditLogs || [])]
        .filter((a) => a.action === 'DISSOLVE_ROOM' || (a.details as any)?.dissolved)
        .map((a) => (a.details as any)?.teamCode || a.teamCode)
        .filter((code): code is string => typeof code === 'string' && code.length > 0)
    );

    if (dbState && (dbState.rooms.length > 0 || dbState.auditLogs.length > 0 || dbState.control)) {
      const control = reconcileControlState(diskState?.control, dbState.control);
      const audits = new Map([...(diskState?.auditLogs ?? []), ...dbState.auditLogs].map(record => [record.id, record]));
      dbState.auditLogs = [...audits.values()].sort((a, b) => a.timestamp - b.timestamp);
      dbState.control = control;
      if (diskState) {
        const sessions = new Map(dbState.sessions);
        for (const [id, diskSession] of diskState.sessions) {
          const databaseSession = sessions.get(id);
          if (!databaseSession) { sessions.set(id, diskSession); continue; }
          const revision = (s: typeof diskSession) => s.updatedAt ?? s.submissions.at(-1)?.timestamp ?? s.startedAt;
          const diskIsNewer = diskSession.submissions.length > databaseSession.submissions.length ||
            (diskSession.submissions.length === databaseSession.submissions.length && revision(diskSession) > revision(databaseSession));
          const preferred = diskIsNewer ? diskSession : databaseSession;
          sessions.set(id, { ...preferred, questions: diskSession.questions.length > preferred.questions.length ? diskSession.questions : preferred.questions });
        }
        dbState.sessions = [...sessions];
        diskState.sessions = dbState.sessions;
        const rooms = new Map(dbState.rooms.map(room => [room.teamCode, room]));
        for (const diskRoom of diskState.rooms) {
          const databaseRoom = rooms.get(diskRoom.teamCode);
          if (!databaseRoom && dissolvedTeamCodes.has(diskRoom.teamCode)) continue;
          if (!databaseRoom || (diskRoom.updatedAt ?? diskState.savedAt) > (databaseRoom.updatedAt ?? dbState.savedAt)) {
            rooms.set(diskRoom.teamCode, diskRoom);
          }
        }
        dbState.rooms = [...rooms.values()];
        diskState.rooms = dbState.rooms;
        dbState.rollToTeamMap = dbState.rooms.flatMap(room => room.members.map(([roll]) => [roll, room.teamCode] as [string, string]));
        diskState.rollToTeamMap = dbState.rollToTeamMap;
      }
      if (diskState && diskState.savedAt >= dbState.savedAt) {
        const filteredDiskState = withoutDissolved(diskState, dissolvedTeamCodes);
        filteredDiskState.auditLogs = dbState.auditLogs;
        filteredDiskState.control = control;
        roomManager.restoreStateSnapshot(filteredDiskState);
        syncRestoredStateToDb(isDbConnected);
        console.log(`💾 Restored tournament state from disk snapshot (${filteredDiskState.rooms.length} teams)`);
        return 'disk';
      }

      roomManager.restoreStateSnapshot(dbState);
      syncRestoredStateToDb(isDbConnected);
      console.log(`🐘 Restored tournament state from PostgreSQL (${dbState.rooms.length} teams)`);
      return 'database';
    }

    if (diskState) {
      const filteredDiskState = withoutDissolved(diskState, dissolvedTeamCodes);
      roomManager.restoreStateSnapshot(filteredDiskState);
      syncRestoredStateToDb(isDbConnected);
      console.log(`💾 Restored tournament state snapshot from ${statePersistence.getFilePath()}`);
      return 'disk';
    }
    return 'none';
  }

  if (diskState) {
    roomManager.restoreStateSnapshot(diskState);
    console.log(`💾 Restored tournament state snapshot from ${statePersistence.getFilePath()}`);
    return 'disk';
  }
  return 'none';
}

/**
 * Brings the game back and turns saving on. Returns what it did.
 * Throws LeaseHeldError if another server is already running this game against the same Redis (so two cannot both believe they own it).
 */
export async function restoreTournamentState(): Promise<RestoreReport> {
  const wantsRedis = process.env.STATE_BACKEND === 'upstash';

  if (wantsRedis && redisEnabled() && (await pingRedis())) {
    try {
      await gameStateMirror.acquireLease();
      const saved = await gameStateMirror.load();

      let source: RestoreSource;
      if (saved) {
        roomManager.restoreStateSnapshot(saved.snapshot);
        if (saved.control) windowManager.restoreControlState(saved.control);
        syncRestoredStateToDb(await databaseService.connect());
        source = 'redis';
        console.log(`⚡ Restored tournament state from Redis (${saved.snapshot.rooms.length} teams, ${saved.snapshot.sessions.length} sessions)`);
      } else {
        console.log('⚡ Redis holds no saved game yet: restoring from disk and PostgreSQL once to seed it.');
        source = await restoreFromDiskAndDatabase();
      }

      gameStateMirror.enable();
      metrics.stateBackendInfo.set(1, { backend: 'upstash' });
      return { backend: 'upstash', source, teams: roomManager.getRoomEntities().length };
    } catch (err) {
      if (err instanceof LeaseHeldError) throw err;
      if (!(err instanceof RedisUnavailableError)) throw err;
      console.error('[State] Redis became unreachable while restoring. Using disk and PostgreSQL.');
    }
  } else if (wantsRedis) {
    console.error('[State] STATE_BACKEND=upstash but Redis is not reachable. Using disk and PostgreSQL; saving to Redis will start by itself if it comes back.');
  }

  const source = await restoreFromDiskAndDatabase();
  statePersistence.enableAutoSave();
  if (wantsRedis && redisEnabled()) {
    // Redis was unreachable at boot: keep trying in the background (the mirror acquires the lease and catches up when it can)
    gameStateMirror.enable();
  }
  metrics.stateBackendInfo.set(1, { backend: wantsRedis && redisEnabled() ? 'upstash' : 'memory' });
  return { backend: wantsRedis && redisEnabled() ? 'upstash' : 'memory', source, teams: roomManager.getRoomEntities().length };
}
