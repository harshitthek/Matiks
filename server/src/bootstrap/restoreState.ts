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

    if (dbState && dbState.rooms.length > 0) {
      if (diskState && diskState.savedAt >= dbState.savedAt) {
        const filteredDiskState = withoutDissolved(diskState, dissolvedTeamCodes);
        roomManager.restoreStateSnapshot(filteredDiskState);
        syncRestoredStateToDb(isDbConnected);
        console.log(`💾 Restored tournament state from disk snapshot (${filteredDiskState.rooms.length} teams)`);
        return 'disk';
      }

      if (diskState) {
        const diskRoomMap = new Map(diskState.rooms.map((r) => [r.teamCode, r]));

        // Merge sessions: keep newer DB session submissions while preserving full question papers from disk
        for (const [sessId, diskSess] of diskState.sessions) {
          const idx = dbState.sessions.findIndex(([id]) => id === sessId);
          if (idx >= 0) {
            const [, dbSess] = dbState.sessions[idx]!;
            const preferred =
              dbSess.submissions.length >= diskSess.submissions.length
                ? {
                    ...dbSess,
                    questions:
                      diskSess.questions && diskSess.questions.length >= dbSess.questions.length
                        ? diskSess.questions
                        : dbSess.questions
                  }
                : diskSess;
            dbState.sessions[idx] = [sessId, preferred];
          } else {
            dbState.sessions.push([sessId, diskSess]);
          }
        }
        const mergedSessionSet = new Set(dbState.sessions.map(([id]) => id));

        // Reconcile disk-only rooms: avoid dropping rooms whose DB write failed, but exclude deliberately dissolved rooms
        const existingCodes = new Set(dbState.rooms.map((r) => r.teamCode));

        for (const diskRoom of diskState.rooms) {
          if (!existingCodes.has(diskRoom.teamCode) && !dissolvedTeamCodes.has(diskRoom.teamCode)) {
            dbState.rooms.push(diskRoom);
            existingCodes.add(diskRoom.teamCode);
          }
        }

        // Preserve newer DB room state while filling in-flight activeSessionId from disk
        dbState.rooms = dbState.rooms.map((dbRoom) => {
          const diskRoom = diskRoomMap.get(dbRoom.teamCode);
          if (diskRoom) {
            const diskMembers = new Map(diskRoom.members);
            if (dbRoom.status === 'IN_SPRINT' || diskRoom.status === 'IN_SPRINT') {
              for (const [roll, dbMember] of dbRoom.members) {
                const diskMember = diskMembers.get(roll);
                const hasValidDbSession = Boolean(dbMember.activeSessionId && mergedSessionSet.has(dbMember.activeSessionId));
                if (!hasValidDbSession && diskMember?.activeSessionId && mergedSessionSet.has(diskMember.activeSessionId)) {
                  dbMember.activeSessionId = diskMember.activeSessionId;
                }
              }
            }
          }
          return dbRoom;
        });
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
