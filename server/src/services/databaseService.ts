/**
 * MATIKS HACKATHON ENGINE — RELATIONAL DATABASE SERVICE (databaseService.ts)
 *
 * Implements the Hybrid Persistence layer connecting the Matiks game engine
 * to PostgreSQL via Prisma ORM.
 *
 * Hot path operations continue executing in-memory in <1ms, while state mutations
 * write-through asynchronously to PostgreSQL.
 * If PostgreSQL is unavailable or DATABASE_URL is not set, gracefully falls back
 * to in-memory + file-snapshot persistence without crashing.
 */

import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type {
  TeamRoom,
  SprintSession,
  SubmissionRecord,
  LeaderboardEntry,
  AuditRecord,
  RoomStatus
} from '../types/sse.js';
import type { PersistedTournamentState, SerializedTeamRoom } from './roomManager.js';
import type { OperatorMode, Question, MathBucket } from '../types/math.js';
import { BUCKET_METADATA } from './mathEngine.js';

function toPrismaRoomStatus(
  status: string
): 'LOBBY' | 'AWAITING_READY' | 'COUNTDOWN' | 'IN_SPRINT' | 'FINISHED' | 'DISSOLVED' {
  switch (status) {
    case 'LOBBY':
      return 'LOBBY';
    case 'AWAITING_READY':
      return 'AWAITING_READY';
    case 'COUNTDOWN':
      return 'COUNTDOWN';
    case 'IN_SPRINT':
    case 'PAUSED':
      return 'IN_SPRINT';
    case 'FINISHED':
      return 'FINISHED';
    case 'DISSOLVED':
      return 'DISSOLVED';
    default:
      return 'LOBBY';
  }
}

export class DatabaseService {
  private prisma: PrismaClient | null = null;
  private isConnected = false;
  private isConnecting = false;
  private disabled = false;
  private leaderboardSyncTimer: NodeJS.Timeout | null = null;
  private pendingStandings: LeaderboardEntry[] | null = null;
  private teamQueues = new Map<string, Promise<void>>();
  private sessionQueues = new Map<string, Promise<void>>();
  private sessionSyncPromises = new Map<string, Promise<void>>();
  private inFlightWrites = new Set<Promise<unknown>>();
  private leaderboardQueue: Promise<void> = Promise.resolve();

  constructor() {
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl && !this.disabled) {
      try {
        this.prisma = new PrismaClient({
          log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']
        });
      } catch (err) {
        console.warn('[DatabaseService] Failed to initialize PrismaClient:', err);
        this.prisma = null;
      }
    }
  }

  public getPrisma(): PrismaClient | null {
    return this.prisma;
  }

  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;

  public isDbConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Schedules a background reconnect retry with exponential backoff
   * if PostgreSQL was unreachable on startup.
   */
  private scheduleReconnectRetry(): void {
    if (this.disabled || !this.prisma || this.isConnected || this.reconnectTimer) return;
    if (process.env.NODE_ENV === 'test') return;

    const delayMs = Math.min(30_000, 2000 * Math.pow(1.5, this.reconnectAttempts));
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.isConnected || this.disabled || !this.prisma) return;
      const connected = await this.connect(5000);
      if (!connected && !this.isConnected) {
        this.scheduleReconnectRetry();
      }
    }, delayMs);
    this.reconnectTimer.unref?.();
  }

  /**
   * Probes PostgreSQL database readiness on startup.
   * Resolves to true if connected, false if fallback mode is activated.
   */
  public async connect(timeoutMs = 5000): Promise<boolean> {
    if (this.disabled || !this.prisma) {
      this.isConnected = false;
      return false;
    }
    if (this.isConnected) return true;
    if (this.isConnecting) return false;

    this.isConnecting = true;
    let timerHandle: NodeJS.Timeout | null = null;
    try {
      const connectPromise = this.prisma.$connect();
      const timeoutPromise = new Promise((_, reject) => {
        timerHandle = setTimeout(() => reject(new Error('PostgreSQL connection timed out')), timeoutMs);
        timerHandle.unref?.();
      });

      await Promise.race([connectPromise, timeoutPromise]);
      this.isConnected = true;
      this.reconnectAttempts = 0;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      console.log('🐘 [DatabaseService] PostgreSQL connected via Prisma ORM');
      return true;
    } catch (err) {
      this.isConnected = false;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️ [DatabaseService] PostgreSQL connection inactive (${msg}). Falling back to disk snapshot persistence.`);
      this.scheduleReconnectRetry();
      return false;
    } finally {
      if (timerHandle) {
        clearTimeout(timerHandle);
      }
      this.isConnecting = false;
    }
  }

  /**
   * Registers an asynchronous operation to be awaited by flushPendingWrites and disconnect.
   * Guarantees safe error suppression so unawaited/void callers never trigger unhandled rejections.
   */
  private trackWrite<T>(promise: Promise<T>): Promise<T> {
    const safePromise = promise.catch((err) => {
      console.error('[DatabaseService] Async write operation failed:', err);
      return undefined as unknown as T;
    });
    this.inFlightWrites.add(safePromise);
    safePromise.finally(() => {
      this.inFlightWrites.delete(safePromise);
    });
    return safePromise;
  }

  /**
   * Enqueues an operation per teamCode to serialize mutations and avoid write races.
   */
  private enqueueTeamOp(teamCode: string, op: () => Promise<void>): Promise<void> {
    const current = this.teamQueues.get(teamCode) ?? Promise.resolve();
    const next = current.then(op).catch((err) => {
      console.error(`[DatabaseService] Error in team op for ${teamCode}:`, err);
    }).finally(() => {
      if (this.teamQueues.get(teamCode) === next) {
        this.teamQueues.delete(teamCode);
      }
    });
    this.teamQueues.set(teamCode, next);
    return this.trackWrite(next);
  }

  /**
   * Enqueues an operation per sessionId to serialize submissions and guarantee FIFO order.
   */
  private enqueueSessionOp(sessionId: string, op: () => Promise<void>): Promise<void> {
    const current = this.sessionQueues.get(sessionId) ?? Promise.resolve();
    const next = current.then(op).catch((err) => {
      console.error(`[DatabaseService] Error in session op for ${sessionId}:`, err);
    }).finally(() => {
      if (this.sessionQueues.get(sessionId) === next) {
        this.sessionQueues.delete(sessionId);
      }
    });
    this.sessionQueues.set(sessionId, next);
    return this.trackWrite(next);
  }

  /**
   * Asynchronously upserts a TeamRoom and all member records into PostgreSQL.
   * Prunes members that no longer belong to the team and serializes operations per teamCode.
   */
  public syncTeam(room: TeamRoom): Promise<void> {
    if (!this.isConnected || !this.prisma) return Promise.resolve();

    const roomSnapshot: TeamRoom = {
      ...room,
      members: new Map(Array.from(room.members.entries()).map(([k, v]) => [k, { ...v }]))
    };

    return this.enqueueTeamOp(roomSnapshot.teamCode, async () => {
      if (!this.isConnected || !this.prisma) return;

      try {
        const membersArray = Array.from(roomSnapshot.members.values());
        const captainRoll = membersArray.find((m) => m.isCaptain)?.rollNumber || '';
        const mappedStatus = toPrismaRoomStatus(roomSnapshot.status);
        const currentRolls = membersArray.map((m) => m.rollNumber);

        await this.prisma.$transaction(async (tx) => {
          await tx.team.upsert({
            where: { teamCode: room.teamCode },
            update: {
              teamName: room.teamName,
              targetSize: room.targetSize,
              operatorMode: (room.operatorMode || 'add') as 'add' | 'sub' | 'mixed',
              status: mappedStatus,
              captainRoll,
              isDisqualified: Boolean(room.isDisqualified),
              scoreAdjustment: room.scoreAdjustment || 0,
              updatedAt: new Date()
            },
            create: {
              teamCode: room.teamCode,
              teamName: room.teamName,
              targetSize: room.targetSize,
              operatorMode: (room.operatorMode || 'add') as 'add' | 'sub' | 'mixed',
              status: mappedStatus,
              captainRoll,
              isDisqualified: Boolean(room.isDisqualified),
              scoreAdjustment: room.scoreAdjustment || 0,
              createdAt: new Date(room.createdAt || Date.now())
            }
          });

          // Atomically prune prior memberships if roll numbers were claimed by other teams
          if (currentRolls.length > 0) {
            await tx.teamMember.deleteMany({
              where: {
                rollNumber: { in: currentRolls },
                teamCode: { not: room.teamCode }
              }
            });
          }

          // Delete members who have left or been removed from this squad
          await tx.teamMember.deleteMany({
            where: {
              teamCode: room.teamCode,
              rollNumber: { notIn: currentRolls }
            }
          });

          // Upsert current active roster
          for (const m of membersArray) {
            const memberToken = m.token || `tok_${randomBytes(16).toString('hex')}`;
            await tx.teamMember.upsert({
              where: { rollNumber: m.rollNumber },
              update: {
                teamCode: room.teamCode,
                name: m.name,
                ...(m.token ? { memberToken: m.token } : {}),
                isReady: Boolean(m.isReady),
                isExcused: Boolean(m.isExcused),
                isClubMember: Boolean(m.isClubMember)
              },
              create: {
                teamCode: room.teamCode,
                rollNumber: m.rollNumber,
                name: m.name,
                memberToken,
                isReady: Boolean(m.isReady),
                isExcused: Boolean(m.isExcused),
                isClubMember: Boolean(m.isClubMember),
                joinedAt: new Date()
              }
            });
          }
        }, { maxWait: 10000, timeout: 15000 });
      } catch (err) {
        console.error(`[DatabaseService] Error syncing team #${room.teamCode}:`, err);
      }
    });
  }

  /**
   * Deletes a team and cascades to its members and sprint sessions in PostgreSQL.
   */
  public deleteTeam(teamCode: string): Promise<void> {
    if (!this.isConnected || !this.prisma) return Promise.resolve();

    return this.enqueueTeamOp(teamCode, async () => {
      if (!this.isConnected || !this.prisma) return;

      try {
        await this.prisma.team.deleteMany({
          where: { teamCode }
        });
      } catch (err) {
        console.error(`[DatabaseService] Error deleting team ${teamCode}:`, err);
      }
    });
  }

  /**
   * Deletes an individual member from a team.
   */
  public deleteMember(teamCode: string, rollNumber: string): Promise<void> {
    if (!this.isConnected || !this.prisma) return Promise.resolve();

    return this.enqueueTeamOp(teamCode, async () => {
      if (!this.isConnected || !this.prisma) return;

      try {
        await this.prisma.teamMember.deleteMany({
          where: { teamCode, rollNumber }
        });
      } catch (err) {
        console.error(`[DatabaseService] Error deleting member ${rollNumber} from team ${teamCode}:`, err);
      }
    });
  }

  /**
   * Batch deletes teams by teamCodes, serializing each through enqueueTeamOp.
   */
  public async deleteTeams(teamCodes: string[]): Promise<void> {
    if (!this.isConnected || !this.prisma || teamCodes.length === 0) return;

    await Promise.allSettled(teamCodes.map((code) => this.deleteTeam(code)));
  }

  /**
   * Asynchronously upserts a SprintSession into PostgreSQL.
   * Serialized via enqueueTeamOp so team upsert cannot race with deleteTeam.
   */
  public syncSprintSession(
    session: SprintSession,
    isPaused = false,
    pausedAt?: number
  ): Promise<void> {
    if (!this.isConnected || !this.prisma) return Promise.resolve();

    const syncPromise = this.enqueueTeamOp(session.teamCode, async () => {
      if (!this.isConnected || !this.prisma) return;

      try {
        const durationSeconds = Math.round((session.expiresAt - session.startedAt) / 1000) || 120;
        const averageTimeSeconds = session.submissions.length > 0
          ? Number((session.submissions.reduce((acc, s) => acc + s.latencyMs, 0) / (session.submissions.length * 1000)).toFixed(2))
          : 0;
        const accumulatedPauseMs = Math.max(0, (session.expiresAt - session.startedAt) - 120_000);

        // Ensure parent team exists in PostgreSQL so foreign key constraint is satisfied
        const parentTeam = await this.prisma.team.findUnique({
          where: { teamCode: session.teamCode }
        });
        if (!parentTeam) {
          // Team does not exist or was deleted, skip session sync
          return;
        }

        await this.prisma.sprintSession.upsert({
          where: { sessionId: session.sessionId },
          update: {
            rollNumber: session.rollNumber || '',
            ...(session.questions ? { questions: session.questions as any } : {}),
            startedAt: BigInt(session.startedAt),
            expiresAt: BigInt(session.expiresAt),
            durationSeconds,
            isFinished: Boolean(session.isFinished),
            isPaused: Boolean(isPaused),
            pausedAt: pausedAt ? BigInt(pausedAt) : null,
            accumulatedPauseMs: BigInt(accumulatedPauseMs),
            isTimeOut: session.isFinished && session.completedQuestions < session.questions.length,
            score: session.currentScore || 0,
            averageTimeSeconds,
            updatedAt: new Date()
          },
          create: {
            sessionId: session.sessionId,
            teamCode: session.teamCode,
            rollNumber: session.rollNumber || '',
            questions: (session.questions as any) ?? [],
            startedAt: BigInt(session.startedAt),
            expiresAt: BigInt(session.expiresAt),
            durationSeconds,
            isFinished: Boolean(session.isFinished),
            isPaused: Boolean(isPaused),
            pausedAt: pausedAt ? BigInt(pausedAt) : null,
            accumulatedPauseMs: BigInt(accumulatedPauseMs),
            isTimeOut: session.isFinished && session.completedQuestions < session.questions.length,
            score: session.currentScore || 0,
            averageTimeSeconds,
            createdAt: new Date(session.startedAt || Date.now())
          }
        });
      } catch (err) {
        console.error(`[DatabaseService] Error syncing sprint session ${session.sessionId}:`, err);
      }
    }).finally(() => {
      if (this.sessionSyncPromises.get(session.sessionId) === syncPromise) {
        this.sessionSyncPromises.delete(session.sessionId);
      }
    });

    this.sessionSyncPromises.set(session.sessionId, syncPromise);
    return syncPromise;
  }

  /**
   * Records an individual question submission and anomaly telemetry.
   * Serializes submissions per team/session and awaits in-flight session sync to guarantee parent session row exists.
   */
  public syncSubmission(
    sessionId: string,
    rollNumber: string,
    sub: SubmissionRecord,
    teamCode?: string
  ): Promise<void> {
    if (!this.isConnected || !this.prisma) return Promise.resolve();

    const writeOp = async () => {
      if (!this.isConnected || !this.prisma) return;

      // Await parent session upsert if currently in-flight outside the team queue.
      // Team queue FIFO ordering already guarantees preceding session syncs have executed.
      if (!teamCode) {
        const sessionPromise = this.sessionSyncPromises.get(sessionId);
        if (sessionPromise) {
          await sessionPromise;
        }
      }

      try {
        const parentSession = await this.prisma.sprintSession.findUnique({
          where: { sessionId }
        });
        if (!parentSession) {
          console.warn(`[DatabaseService] Skipping submission for missing session ${sessionId}`);
          return;
        }

        const effectiveTeamCode = teamCode || parentSession.teamCode;
        await this.prisma.$transaction(async (tx) => {
          await tx.questionSubmission.create({
            data: {
              sessionId,
              rollNumber,
              questionIndex: sub.questionIndex,
              operandA: sub.a ?? 0,
              operandB: sub.b ?? 0,
              operator: sub.operator ?? '+',
              bucket: sub.bucket ?? 'B1',
              userAnswer: sub.submittedAnswer,
              expectedAnswer: sub.actualAnswer ?? 0,
              isCorrect: Boolean(sub.isCorrect),
              latencyMs: sub.latencyMs,
              speedBonus: sub.pointsAwarded ? Math.max(0, sub.pointsAwarded - 100) : 0,
              streak: sub.streakAfter || 0,
              pointsAwarded: sub.pointsAwarded || 0,
              isAnomaly: Boolean(sub.isAnomaly),
              submittedAt: BigInt(sub.timestamp || Date.now())
            }
          });

          await tx.sprintSession.update({
            where: { sessionId },
            data: {
              score: sub.scoreAfter ?? (sub.pointsAwarded || 0)
            }
          });
        }, { maxWait: 10000, timeout: 15000 });
      } catch (err) {
        console.error(`[DatabaseService] Error syncing submission for session ${sessionId}:`, err);
      }
    };

    return teamCode ? this.enqueueTeamOp(teamCode, writeOp) : this.enqueueSessionOp(sessionId, writeOp);
  }

  /**
   * Debounced synchronization of tournament leaderboard standings.
   * Coalesces rapid sequential submission updates into single batch writes.
   */
  public syncLeaderboard(standings: LeaderboardEntry[]): void {
    if (!this.isConnected || !this.prisma) return;
    this.pendingStandings = standings;
    if (this.leaderboardSyncTimer) return;

    this.leaderboardSyncTimer = setTimeout(() => {
      this.leaderboardSyncTimer = null;
      const data = this.pendingStandings;
      this.pendingStandings = null;
      if (data) {
        void this.flushLeaderboard(data);
      }
    }, 200);
    this.leaderboardSyncTimer.unref?.();
  }

  public flushLeaderboard(standings: LeaderboardEntry[]): Promise<void> {
    if (!this.isConnected || !this.prisma) return Promise.resolve();

    const next = this.leaderboardQueue.then(async () => {
      if (!this.isConnected || !this.prisma) return;
      try {
        const activeCodes = standings.map((e) => e.teamCode);
        await this.prisma.$transaction(async (tx) => {
          if (activeCodes.length > 0) {
            await tx.leaderboardStanding.deleteMany({
              where: {
                teamCode: { notIn: activeCodes }
              }
            });
          } else {
            await tx.leaderboardStanding.deleteMany({});
          }

          for (const entry of standings) {
            await tx.leaderboardStanding.upsert({
              where: { teamCode: entry.teamCode },
              update: {
                teamName: entry.teamName,
                rank: entry.rank,
                averageScore: Math.round(entry.teamAverageScore || 0),
                averageTimeSeconds: entry.averageTimeSeconds || 0,
                isFinished: entry.status === 'FINISHED',
                updatedAt: new Date()
              },
              create: {
                teamCode: entry.teamCode,
                teamName: entry.teamName,
                rank: entry.rank,
                averageScore: Math.round(entry.teamAverageScore || 0),
                averageTimeSeconds: entry.averageTimeSeconds || 0,
                isFinished: entry.status === 'FINISHED'
              }
            });
          }
        }, { maxWait: 10000, timeout: 15000 });
      } catch (err) {
        console.error('[DatabaseService] Error syncing leaderboard standings:', err);
      }
    });

    this.leaderboardQueue = next;
    return this.trackWrite(next);
  }

  /**
   * Persists an immutable administrative audit action.
   */
  public async recordAudit(record: AuditRecord): Promise<void> {
    if (!this.isConnected || !this.prisma) return;

    return this.trackWrite(
      (async () => {
        try {
          await this.prisma!.auditLog.create({
            data: {
              action: record.action,
              targetTeam: record.teamCode || null,
              targetRoll: record.rollNumber || null,
              performedBy: record.adminId || 'ADMIN',
              reason: record.reason || null,
              details: record.details
                ? typeof record.details === 'string'
                  ? { message: record.details }
                  : JSON.parse(JSON.stringify(record.details))
                : undefined,
              timestamp: BigInt(record.timestamp || Date.now())
            }
          });
        } catch (err) {
          console.error('[DatabaseService] Error recording audit log:', err);
        }
      })()
    );
  }

  /**
   * Persists tournament window state and optional round-mode operator override.
   */
  public syncTournamentWindow(
    isOpen: boolean,
    openedAt?: number,
    closesAt?: number,
    roundMode?: OperatorMode | null
  ): Promise<void> {
    if (!this.isConnected || !this.prisma) return Promise.resolve();

    return this.trackWrite(
      (async () => {
        try {
          await this.prisma!.tournamentWindow.upsert({
            where: { id: 'GLOBAL' },
            update: {
              isOpen,
              openedAt: openedAt ? BigInt(openedAt) : null,
              closesAt: closesAt ? BigInt(closesAt) : null,
              ...(roundMode ? { roundMode } : {}),
              updatedAt: new Date()
            },
            create: {
              id: 'GLOBAL',
              isOpen,
              openedAt: openedAt ? BigInt(openedAt) : null,
              closesAt: closesAt ? BigInt(closesAt) : null,
              roundMode: roundMode || 'add'
            }
          });
        } catch (err) {
          console.error('[DatabaseService] Error syncing tournament window:', err);
        }
      })()
    );
  }

  /**
   * Flushes all in-flight writes (leaderboard, team ops, session ops, audits, deletes) before server shutdown.
   */
  public async flushPendingWrites(): Promise<void> {
    if (this.leaderboardSyncTimer) {
      clearTimeout(this.leaderboardSyncTimer);
      this.leaderboardSyncTimer = null;
      if (this.pendingStandings) {
        const standings = this.pendingStandings;
        this.pendingStandings = null;
        await this.flushLeaderboard(standings);
      }
    }

    while (this.inFlightWrites.size > 0) {
      const writes = Array.from(this.inFlightWrites);
      await Promise.allSettled(writes);
    }
  }

  /**
   * Cold-boot hydration: restores rooms and active sessions from PostgreSQL
   * when database persistence is active and contains data.
   */
  public async hydrateFromDatabase(): Promise<PersistedTournamentState | null> {
    if (!this.isConnected || !this.prisma) return null;

    try {
      const teams = await this.prisma.team.findMany({
        include: { members: true }
      });

      if (teams.length === 0) {
        return null; // Database is empty, allow file snapshot or fresh state
      }

      const sessions = await this.prisma.sprintSession.findMany({
        include: {
          submissions: {
            orderBy: { questionIndex: 'asc' }
          }
        }
      });
      const auditLogs = await this.prisma.auditLog.findMany({
        orderBy: { timestamp: 'asc' }
      });
      const windowConfig = await this.prisma.tournamentWindow.findUnique({
        where: { id: 'GLOBAL' }
      });

      const now = Date.now();
      const serializedRooms: SerializedTeamRoom[] = teams.map((t) => {
        const teamSessions = sessions.filter((s) => s.teamCode === t.teamCode);
        const minStartedAt = teamSessions.length > 0 ? Math.min(...teamSessions.map((s) => Number(s.startedAt))) : undefined;
        const hasActiveSprint = teamSessions.some((s) => !s.isFinished && (s.isPaused || Number(s.expiresAt) > now));
        const allFinished = teamSessions.length > 0 && teamSessions.every((s) => s.isFinished || (!s.isPaused && Number(s.expiresAt) <= now));
        const isRoomPaused = teamSessions.some((s) => s.isPaused && !s.isFinished);
        const pausedAtSession = teamSessions.find((s) => s.isPaused && s.pausedAt);
        const pausedAt = pausedAtSession?.pausedAt ? Number(pausedAtSession.pausedAt) : undefined;
        const completedAt = (t.status === 'FINISHED' || allFinished) && teamSessions.length > 0
          ? Math.max(...teamSessions.map((s) => Number(s.expiresAt)))
          : undefined;

        let roomStatus: RoomStatus = t.status as any;
        if (t.status === 'IN_SPRINT' || (t.status as string) === 'COUNTDOWN') {
          roomStatus = hasActiveSprint ? 'IN_SPRINT' : 'FINISHED';
        }

        return {
          teamCode: t.teamCode,
          teamName: t.teamName,
          targetSize: t.targetSize,
          operatorMode: t.operatorMode as OperatorMode,
          status: roomStatus,
          captainRoll: t.captainRoll,
          isPaused: isRoomPaused,
          pausedAt,
          isDisqualified: t.isDisqualified,
          scoreAdjustment: t.scoreAdjustment,
          createdAt: t.createdAt.getTime(),
          startedAt: minStartedAt,
          completedAt,
          members: t.members.map((m) => {
            const memberSessions = sessions
              .filter(
                (s) =>
                  s.teamCode === t.teamCode &&
                  ((s as any).rollNumber === m.rollNumber || s.sessionId === `sess_${m.rollNumber}` || s.sessionId.startsWith(`sess_${m.rollNumber}_`))
              )
              .sort((a, b) => Number(b.startedAt) - Number(a.startedAt));
            const memberSession = memberSessions[0];
            const isMemberFinished = memberSession ? (memberSession.isFinished || (!memberSession.isPaused && Number(memberSession.expiresAt) <= now)) : false;
            const memberSubmissions = memberSession?.submissions || [];
            const calculatedMemberScore = memberSubmissions.reduce((acc, sub) => acc + (sub.pointsAwarded || 0), 0);
            const memberScore = memberSession ? Math.max(memberSession.score, calculatedMemberScore) : 0;
            const completedCount = memberSession
              ? Math.max(memberSubmissions.length, isMemberFinished ? 15 : 0)
              : 0;
            return [
              m.rollNumber,
              {
                rollNumber: m.rollNumber,
                name: m.name,
                isCaptain: m.rollNumber === t.captainRoll,
                isReady: t.status === 'AWAITING_READY' ? Boolean(m.isReady) : false,
                isExcused: m.isExcused,
                connected: false,
                individualScore: memberScore,
                completedQuestions: completedCount,
                lastActiveAt: 0,
                token: m.memberToken,
                isClubMember: m.isClubMember,
                activeSessionId: (hasActiveSprint && memberSession && !isMemberFinished) ? memberSession.sessionId : undefined
              }
            ];
          })
        };
      });

      const rollToTeamMap: Array<[string, string]> = [];
      for (const t of teams) {
        for (const m of t.members) {
          rollToTeamMap.push([m.rollNumber, t.teamCode]);
        }
      }

      const mappedSessions: Array<[string, SprintSession]> = sessions.map((s) => {
        const mappedSubmissions: SubmissionRecord[] = (s.submissions || []).map((sub) => ({
          questionIndex: sub.questionIndex,
          submittedAnswer: sub.userAnswer,
          actualAnswer: sub.expectedAnswer,
          a: sub.operandA,
          b: sub.operandB,
          operator: (sub.operator === '-' ? '-' : '+') as '+' | '-',
          bucket: sub.bucket as MathBucket,
          isCorrect: sub.isCorrect,
          latencyMs: sub.latencyMs,
          pointsAwarded: sub.pointsAwarded,
          streakAfter: sub.streak,
          timestamp: Number(sub.submittedAt),
          isAnomaly: sub.isAnomaly
        }));

        const reconstructedQuestions: Question[] = mappedSubmissions.map((sub) => {
          const bucketKey = (sub.bucket as MathBucket) || (sub.operator === '-' ? 'S1' : 'B1');
          const meta = BUCKET_METADATA[bucketKey] || BUCKET_METADATA.B1;
          return {
            id: `q_${s.sessionId}_${sub.questionIndex}`,
            bucket: bucketKey,
            carryType: meta.carryType,
            tag: meta.tag,
            a: sub.a ?? 0,
            b: sub.b ?? 0,
            operator: sub.operator ?? meta.operator,
            answer: sub.actualAnswer ?? (sub.operator === '-' ? ((sub.a ?? 0) - (sub.b ?? 0)) : ((sub.a ?? 0) + (sub.b ?? 0))),
            targetLatencyMs: meta.targetLatencyMs
          };
        });

        const storedQuestions = (s as any).questions;
        if (!Array.isArray(storedQuestions) || storedQuestions.length === 0) {
          console.warn(`[DatabaseService] Session ${s.sessionId} missing stored questions paper; falling back to reconstructed questions from submissions.`);
        }
        const restoredQuestions: Question[] = Array.isArray(storedQuestions) && storedQuestions.length > 0
          ? (storedQuestions as Question[])
          : reconstructedQuestions;

        const isFinished = s.isFinished || (!s.isPaused && Number(s.expiresAt) <= now) || restoredQuestions.length < 15;
        const lastSub = mappedSubmissions[mappedSubmissions.length - 1];
        const consecutiveStreak = lastSub?.streakAfter ?? 0;
        const completedQuestions = mappedSubmissions.length > 0 ? mappedSubmissions.length : (isFinished ? 15 : 0);
        const calculatedSessionScore = mappedSubmissions.reduce((acc, sub) => acc + (sub.pointsAwarded || 0), 0);
        const currentScore = Math.max(s.score, calculatedSessionScore);

        const matchingMember = teams
          .find((t) => t.teamCode === s.teamCode)
          ?.members.find((m) => m.rollNumber === (s as any).rollNumber || s.sessionId.includes(m.rollNumber));

        return [
          s.sessionId,
          {
            sessionId: s.sessionId,
            teamCode: s.teamCode,
            rollNumber: (s as any).rollNumber || s.sessionId.replace(/^sess_/, '').replace(/_[^_]+$/, '') || '',
            memberToken: matchingMember?.memberToken,
            startedAt: Number(s.startedAt),
            expiresAt: Number(s.expiresAt),
            questions: restoredQuestions,
            submissions: mappedSubmissions,
            currentScore,
            consecutiveStreak,
            completedQuestions,
            isFinished,
            operatorMode: (teams.find((t) => t.teamCode === s.teamCode)?.operatorMode as OperatorMode) || 'add'
          }
        ];
      });

      const mappedAuditLogs: AuditRecord[] = auditLogs.map((a) => ({
        id: a.id,
        timestamp: Number(a.timestamp),
        action: a.action as any,
        teamCode: a.targetTeam || undefined,
        rollNumber: a.targetRoll || undefined,
        adminId: a.performedBy,
        reason: a.reason || undefined,
        details: (a.details as any) || undefined
      }));

      const teamTimestamps = teams.map((t) => t.updatedAt.getTime());
      const sessionTimestamps = sessions.map((s) => s.updatedAt.getTime());
      const maxUpdated = Math.max(0, ...teamTimestamps, ...sessionTimestamps);
      const computedSavedAt = maxUpdated > 0 ? maxUpdated : Date.now();

      return {
        version: 1,
        savedAt: computedSavedAt,
        roundOperatorMode: (windowConfig?.roundMode as OperatorMode) || null,
        rooms: serializedRooms,
        sessions: mappedSessions,
        rollToTeamMap,
        auditLogs: mappedAuditLogs
      };
    } catch (err) {
      console.error('[DatabaseService] Failed to hydrate state from PostgreSQL:', err);
      return null;
    }
  }

  /**
   * Safely disconnects the Prisma client connection.
   */
  public async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;

    if (this.prisma) {
      try {
        await this.prisma.$disconnect();
      } catch (err) {
        console.warn('[DatabaseService] Error disconnecting Prisma:', err);
      } finally {
        this.isConnected = false;
      }
    }
  }
}

export const databaseService = new DatabaseService();
