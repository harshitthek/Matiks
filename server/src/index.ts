/**
 * MATIKS HACKATHON ENGINE — ENTRYPOINT (index.ts)
 * 
 * Boots the Express server and binds to designated HTTP port.
 */

import { createApp } from './app.js';
import { sseHub } from './services/sseHub.js';
import { statePersistence } from './services/statePersistence.js';
import { databaseService } from './services/databaseService.js';
import { roomManager } from './services/roomManager.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

if (process.env.NODE_ENV !== 'test') {
  const diskState = statePersistence.readDiskSnapshot();
  const isDbConnected = await databaseService.connect();

  const syncRestoredStateToDb = () => {
    if (!isDbConnected) return;
    for (const room of roomManager.getRoomEntities()) {
      void databaseService.syncTeam(room);
    }
    for (const session of roomManager.getSessionEntities()) {
      const room = roomManager.getRoom(session.teamCode);
      void databaseService.syncSprintSession(session, room?.isPaused, room?.pausedAt);
    }
  };

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
        const filteredDiskState = {
          ...diskState,
          rooms: diskState.rooms.filter((r) => !dissolvedTeamCodes.has(r.teamCode)),
          sessions: diskState.sessions.filter(([, s]) => !dissolvedTeamCodes.has(s.teamCode)),
          rollToTeamMap: diskState.rollToTeamMap.filter(([, code]) => !dissolvedTeamCodes.has(code))
        };
        roomManager.restoreStateSnapshot(filteredDiskState);
        syncRestoredStateToDb();
        console.log(`💾 Restored tournament state from disk snapshot (${filteredDiskState.rooms.length} teams)`);
      } else {
        if (diskState) {
          const diskRoomMap = new Map(diskState.rooms.map((r) => [r.teamCode, r]));

          // Merge sessions: keep newer DB session submissions while preserving full question papers from disk
          for (const [sessId, diskSess] of diskState.sessions) {
            const idx = dbState.sessions.findIndex(([id]) => id === sessId);
            if (idx >= 0) {
              const [, dbSess] = dbState.sessions[idx];
              const preferred = (dbSess.submissions.length >= diskSess.submissions.length)
                ? {
                    ...dbSess,
                    questions: (diskSess.questions && diskSess.questions.length >= dbSess.questions.length)
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
                  const hasValidDbSession = Boolean(
                    dbMember.activeSessionId && mergedSessionSet.has(dbMember.activeSessionId)
                  );
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
        syncRestoredStateToDb();
        console.log(`🐘 Restored tournament state from PostgreSQL (${dbState.rooms.length} teams)`);
      }
    } else if (diskState) {
      const filteredDiskState = {
        ...diskState,
        rooms: diskState.rooms.filter((r) => !dissolvedTeamCodes.has(r.teamCode)),
        sessions: diskState.sessions.filter(([, s]) => !dissolvedTeamCodes.has(s.teamCode)),
        rollToTeamMap: diskState.rollToTeamMap.filter(([, code]) => !dissolvedTeamCodes.has(code))
      };
      roomManager.restoreStateSnapshot(filteredDiskState);
      syncRestoredStateToDb();
      console.log(`💾 Restored tournament state snapshot from ${statePersistence.getFilePath()}`);
    }
  } else if (diskState) {
    roomManager.restoreStateSnapshot(diskState);
    console.log(`💾 Restored tournament state snapshot from ${statePersistence.getFilePath()}`);
  }

  statePersistence.enableAutoSave();
}

const app = createApp();

const server = app.listen(PORT, (err?: Error) => {
  if (err) {
    console.error(`Failed to start Matiks Hackathon Server:`, err);
    process.exit(1);
  }
  console.log(`⚡ Matiks Hackathon Server listening on http://localhost:${PORT}`);
});

server.on('error', (err: Error) => {
  console.error(`Server error encountered:`, err);
  process.exit(1);
});

async function handleShutdown(): Promise<void> {
  console.log('Shutting down Matiks Hackathon Server...');
  if (process.env.NODE_ENV !== 'test') {
    statePersistence.saveNow();
  }
  const flushTimeout = new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 3000);
    t.unref?.();
  });
  await Promise.race([databaseService.flushPendingWrites(), flushTimeout]);
  await databaseService.disconnect();
  sseHub.destroy();
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);
