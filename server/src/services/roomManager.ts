/**
 * MATIKS HACKATHON ENGINE — ROOM STATE MACHINE & SYNCHRONIZER (roomManager.ts)
 * 
 * Orchestrates team room lifecycles, member join gates, atomic READY locks,
 * synchronized 3-2-1 countdowns, parallel sprint session distribution,
 * answer evaluations with timing anti-cheat, and [EXCUSE MEMBER] hardware recovery.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type {
  TeamRoom,
  TeamMember,
  SprintSession,
  SubmissionRecord,
  LeaderboardEntry,
  MemberLeaderboardSummary,
  TeamSnapshotEvent,
  MemberReadyChangedEvent,
  CountdownTickEvent,
  SprintStartEvent,
  TeammateProgressEvent,
  AdminTelemetryEvent,
  AnomalyFlagEvent,
  AuditRecord,
  SessionReplayData,
  SessionReplaySummary,
  RoomStatus
} from '../types/sse.js';
import type { QuestionSanitized, OperatorMode } from '../types/math.js';
import { mathEngine } from './mathEngine.js';
import { scoringEngine } from './scoringEngine.js';
import { sseHub } from './sseHub.js';
import { leaderboardManager } from './leaderboardManager.js';
import { windowManager } from './windowManager.js';
import { metrics } from './metrics.js';
import { databaseService } from './databaseService.js';

export interface SerializedTeamRoom extends Omit<TeamRoom, 'members'> {
  members: Array<[string, TeamMember]>;
}

export interface PersistedTournamentState {
  version: 1;
  savedAt: number;
  roundOperatorMode?: OperatorMode | null;
  rooms: SerializedTeamRoom[];
  sessions: Array<[string, SprintSession]>;
  rollToTeamMap: Array<[string, string]>;
  auditLogs: AuditRecord[];
}

export class RoomManager {
  private rooms = new Map<string, TeamRoom>();
  private sessions = new Map<string, SprintSession>();
  private rollToTeamMap = new Map<string, string>(); // rollNumber -> teamCode
  private roomUsedPairKeys = new Map<string, Set<string>>(); // teamCode -> previously used question canonical keys
  private auditLogs: AuditRecord[] = [];
  private countdownTimers = new Map<string, NodeJS.Timeout[]>();
  private expiryTimers = new Map<string, NodeJS.Timeout>();
  private lastQuestionTimes = new Map<string, number>(); // sessionId -> timestamp
  private auditDir = process.env.AUDIT_LOG_DIR || path.join(process.cwd(), '.data', 'audits');
  private roundOperatorMode: OperatorMode | null = null;
  private onStateMutated?: () => void;

  public setAuditDir(dir: string): void {
    this.auditDir = dir;
  }

  public getAuditDir(): string {
    return this.auditDir;
  }

  private persistenceHooks: Array<() => void> = [];

  public setPersistenceHook(hook?: () => void): void {
    if (hook) {
      this.persistenceHooks = [hook];
    } else {
      this.persistenceHooks = [];
    }
  }

  public addPersistenceHook(hook: () => void): void {
    this.persistenceHooks.push(hook);
  }

  public removePersistenceHook(hook: () => void): void {
    this.persistenceHooks = this.persistenceHooks.filter((h) => h !== hook);
  }

  private notifyStateMutated(): void {
    for (const hook of this.persistenceHooks) {
      try {
        hook();
      } catch (err: unknown) {
        console.error('State persistence hook failed:', err);
      }
    }
  }

  private logAudit(auditRecord: AuditRecord): void {
    this.auditLogs.push(auditRecord);
    void databaseService.recordAudit(auditRecord);
  }

  public logSystemAudit(record: Omit<AuditRecord, 'id' | 'timestamp'>): AuditRecord {
    const auditRecord: AuditRecord = {
      id: randomUUID(),
      timestamp: Date.now(),
      ...record
    };
    this.logAudit(auditRecord);
    return auditRecord;
  }

  /**
   * Generates a concise, memorable team code (e.g. "ZG-99").
   */
  private generateTeamCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    for (let attempts = 0; attempts < 200; attempts++) {
      const p1 = chars[Math.floor(Math.random() * chars.length)];
      const p2 = chars[Math.floor(Math.random() * chars.length)];
      const num = Math.floor(10 + Math.random() * 90);
      const code = `${p1}${p2}-${num}`;
      if (!this.rooms.has(code)) return code;
    }

    // Secondary collision-safe fallback using cryptographically random hex suffix
    for (let attempts = 0; attempts < 50; attempts++) {
      const fallbackCode = `MK-${randomBytes(2).toString('hex').toUpperCase()}`;
      if (!this.rooms.has(fallbackCode)) return fallbackCode;
    }

    throw new Error('Unable to allocate a unique team code. Room capacity exhausted.');
  }

  /**
   * Creates a new Team Room with the creator registered as Captain.
   */
  public createTeam(
    teamName: string,
    targetSize: number,
    captainRoll: string,
    captainName: string,
    isClubMember?: boolean,
    operatorMode?: OperatorMode
  ): { room: TeamRoom; teamCode: string; memberToken: string } {
    if (!Number.isInteger(targetSize) || targetSize < 1 || targetSize > 4) {
      throw new Error('Target team size must be an integer between 1 and 4 members.');
    }

    const cleanRoll = captainRoll.trim().toUpperCase();
    if (this.rollToTeamMap.has(cleanRoll)) {
      throw new Error(`Roll number ${cleanRoll} is already registered in team ${this.rollToTeamMap.get(cleanRoll)}.`);
    }

    const teamCode = this.generateTeamCode();
    const members = new Map<string, TeamMember>();

    const memberToken = `tok_${cleanRoll.toLowerCase()}_${randomBytes(16).toString('hex')}`;
    const captain: TeamMember = {
      rollNumber: cleanRoll,
      name: captainName.trim(),
      isCaptain: true,
      isReady: false,
      isExcused: false,
      connected: true,
      individualScore: 0,
      completedQuestions: 0,
      lastActiveAt: Date.now(),
      token: memberToken,
      isClubMember: isClubMember ?? false
    };
    members.set(cleanRoll, captain);

    const room: TeamRoom = {
      teamCode,
      teamName: teamName.trim(),
      targetSize,
      members,
      status: targetSize === 1 ? 'AWAITING_READY' : 'LOBBY',
      isPaused: false,
      createdAt: Date.now(),
      operatorMode: this.roundOperatorMode ?? operatorMode ?? 'add'
    };

    this.rooms.set(teamCode, room);
    this.rollToTeamMap.set(cleanRoll, teamCode);

    this.syncLeaderboard(room);
    void databaseService.syncTeam(room);
    return { room, teamCode, memberToken };
  }

  /**
   * Adds a student member to an existing Team Room.
   */
  public joinTeam(
    teamCode: string,
    rollNumber: string,
    name: string,
    reconnectToken?: string,
    isClubMember?: boolean
  ): { room: TeamRoom; member: TeamMember; memberToken: string } {
    const room = this.rooms.get(teamCode.trim().toUpperCase());
    if (!room) {
      throw new Error(`Team with code ${teamCode} does not exist.`);
    }

    const cleanRoll = rollNumber.trim().toUpperCase();

    // Reconnection handling: if student already in this room
    if (room.members.has(cleanRoll)) {
      const existing = room.members.get(cleanRoll)!;
      if (existing.token && (!reconnectToken || reconnectToken !== existing.token)) {
        throw new Error(`Roll number ${cleanRoll} is already registered in this team. Valid member token required to reconnect.`);
      }
      existing.connected = true;
      existing.lastActiveAt = Date.now();
      if (typeof isClubMember === 'boolean') {
        existing.isClubMember = isClubMember;
      }
      this.broadcastSnapshot(room);
      void databaseService.syncTeam(room);
      return { room, member: existing, memberToken: existing.token || '' };
    }

    // Check if enrolled elsewhere
    if (this.rollToTeamMap.has(cleanRoll)) {
      throw new Error(`Roll number ${cleanRoll} is already registered in team ${this.rollToTeamMap.get(cleanRoll)}.`);
    }

    // Check capacity
    if (room.members.size >= room.targetSize) {
      throw new Error(`Team ${teamCode} has already reached capacity (${room.targetSize} members).`);
    }

    // Check status
    if (room.status !== 'LOBBY' && room.status !== 'AWAITING_READY') {
      throw new Error(`Cannot join team ${teamCode}: Room is currently in ${room.status} status.`);
    }

    const memberToken = `tok_${cleanRoll.toLowerCase()}_${randomBytes(16).toString('hex')}`;
    const newMember: TeamMember = {
      rollNumber: cleanRoll,
      name: name.trim(),
      isCaptain: false,
      isReady: false,
      isExcused: false,
      connected: true,
      individualScore: 0,
      completedQuestions: 0,
      lastActiveAt: Date.now(),
      token: memberToken,
      isClubMember: isClubMember ?? false
    };

    room.members.set(cleanRoll, newMember);
    this.rollToTeamMap.set(cleanRoll, room.teamCode);

    if (room.members.size === room.targetSize) {
      room.status = 'AWAITING_READY';
    }

    this.broadcastSnapshot(room);
    this.syncLeaderboard(room);
    void databaseService.syncTeam(room);

    return { room, member: newMember, memberToken };
  }

  /**
   * Removes a member from a Team Room (or dissolves the room if empty),
   * freeing their roll number to join or create another team.
   */
  public leaveTeam(
    teamCode: string,
    rollNumber: string,
    memberToken?: string
  ): { dissolved: boolean; room?: TeamRoom } {
    const cleanCode = teamCode.trim().toUpperCase();
    const cleanRoll = rollNumber.trim().toUpperCase();
    const room = this.rooms.get(cleanCode);
    if (!room) {
      if (this.rollToTeamMap.get(cleanRoll) === cleanCode) {
        this.rollToTeamMap.delete(cleanRoll);
      }
      return { dissolved: true };
    }

    const member = room.members.get(cleanRoll);
    if (!member) {
      if (this.rollToTeamMap.get(cleanRoll) === cleanCode) {
        this.rollToTeamMap.delete(cleanRoll);
      }
      return { dissolved: false, room };
    }

    if (member.token && (!memberToken || member.token !== memberToken)) {
      throw new Error('Unauthorized: Valid member token is required to leave team.');
    }

    if (member.activeSessionId) {
      const sess = this.sessions.get(member.activeSessionId);
      if (sess) {
        sess.isFinished = true;
        this.persistSessionAudit(sess);
      }
      this.lastQuestionTimes.delete(member.activeSessionId);
    }

    const wasCaptain = member.isCaptain;
    room.members.delete(cleanRoll);
    void databaseService.deleteMember(cleanCode, cleanRoll);
    if (this.rollToTeamMap.get(cleanRoll) === cleanCode) {
      this.rollToTeamMap.delete(cleanRoll);
    }

    if (room.members.size === 0) {
      this.clearRoomTimers(cleanCode);
      this.rooms.delete(cleanCode);
      this.roomUsedPairKeys.delete(cleanCode);
      leaderboardManager.removeTeam(cleanCode, true);
      sseHub.clearChannelBuffer(`team:${cleanCode}`);
      void databaseService.deleteTeam(cleanCode);
      this.notifyStateMutated();
      return { dissolved: true };
    }

    if (wasCaptain) {
      const nextCaptain = room.members.values().next().value;
      if (nextCaptain) {
        nextCaptain.isCaptain = true;
      }
    }

    if (room.status === 'COUNTDOWN' || room.status === 'AWAITING_READY') {
      if (room.members.size < room.targetSize) {
        this.clearRoomTimers(cleanCode);
        room.status = 'LOBBY';
      }
    } else if (room.status === 'IN_SPRINT') {
      this.checkRoomCompletion(room);
    }

    this.broadcastSnapshot(room);
    this.syncLeaderboard(room);
    void databaseService.syncTeam(room);
    return { dissolved: false, room };
  }

  /**
   * Resets a completed team room back to the ready lobby
   * so the same squad can run another sprint together.
   */
  public resetTeamSprint(
    teamCode: string,
    rollNumber: string,
    memberToken?: string
  ): TeamRoom {
    const cleanCode = teamCode.trim().toUpperCase();
    const room = this.rooms.get(cleanCode);
    if (!room) {
      throw new Error(`Team ${cleanCode} not found.`);
    }

    const cleanRoll = rollNumber.trim().toUpperCase();
    const member = room.members.get(cleanRoll);
    if (!member) {
      throw new Error(`Member ${cleanRoll} not found in team ${cleanCode}.`);
    }

    if (member.token && (!memberToken || member.token !== memberToken)) {
      throw new Error('Unauthorized: Valid member token is required to reset squad.');
    }

    // If the requesting member's own 120s timer has expired, finalize their session immediately
    // while still respecting the +2.5s transit grace window for any other active teammates
    if (member.activeSessionId) {
      const ownSession = this.sessions.get(member.activeSessionId);
      if (ownSession && !ownSession.isFinished && Date.now() >= ownSession.expiresAt) {
        ownSession.isFinished = true;
      }
    }
    this.checkAndFinalizeIfExpired(room);

    if (room.status !== 'FINISHED') {
      throw new Error(`Cannot reset squad while room is in ${room.status} status. Wait for the sprint to finish.`);
    }

    this.clearRoomTimers(cleanCode);
    sseHub.clearChannelBuffer(`team:${cleanCode}`);

    for (const m of room.members.values()) {
      if (m.activeSessionId) {
        const sess = this.sessions.get(m.activeSessionId);
        if (sess) {
          this.persistSessionAudit(sess);
        }
        this.sessions.delete(m.activeSessionId);
        this.lastQuestionTimes.delete(m.activeSessionId);
      }
      m.activeSessionId = undefined;
      m.isReady = false;
      m.isExcused = false;
      m.individualScore = 0;
      m.completedQuestions = 0;
      m.lastActiveAt = Date.now();
    }

    room.status = room.members.size >= room.targetSize ? 'AWAITING_READY' : 'LOBBY';
    room.startedAt = undefined;
    room.completedAt = undefined;
    room.isPaused = false;
    room.pausedAt = undefined;
    room.operatorMode = this.roundOperatorMode ?? room.operatorMode ?? 'add';

    this.broadcastSnapshot(room);
    this.syncLeaderboard(room);
    void databaseService.syncTeam(room);
    return room;
  }

  /**
   * Adjusts the target squad size down to the currently joined member count,
   * transitioning an underfilled lobby into AWAITING_READY so the squad can start.
   */
  public lockRosterAtCurrentCount(
    teamCode: string,
    rollNumber: string,
    memberToken?: string
  ): TeamRoom {
    const cleanCode = teamCode.trim().toUpperCase();
    const room = this.rooms.get(cleanCode);
    if (!room) {
      throw new Error(`Team ${cleanCode} not found.`);
    }

    const cleanRoll = rollNumber.trim().toUpperCase();
    const member = room.members.get(cleanRoll);
    if (!member) {
      throw new Error(`Member ${cleanRoll} not found in team ${cleanCode}.`);
    }

    if (!member.isCaptain) {
      throw new Error('Only the squad captain can lock the roster size.');
    }

    if (member.token && (!memberToken || member.token !== memberToken)) {
      throw new Error('Unauthorized: Valid member token is required to lock roster.');
    }

    if (room.status !== 'LOBBY') {
      throw new Error(`Cannot adjust roster size while room is in ${room.status} status.`);
    }

    const currentSize = room.members.size;
    if (currentSize < 1 || currentSize >= room.targetSize) {
      throw new Error(`Roster already has ${currentSize} members which matches or exceeds target size (${room.targetSize}).`);
    }

    room.targetSize = currentSize;
    room.status = 'AWAITING_READY';

    const activeMembers = Array.from(room.members.values()).filter(m => !m.isExcused);
    const readyCount = activeMembers.filter(m => m.isReady).length;
    const allReady = activeMembers.length > 0 && readyCount === activeMembers.length;

    if (allReady && windowManager.isOpen()) {
      this.startCountdown(room);
    } else {
      this.broadcastSnapshot(room);
    }

    this.syncLeaderboard(room);
    void databaseService.syncTeam(room);
    return room;
  }

  /**
   * Toggles a member's READY status and triggers the atomic ready gate check.
   */
  public toggleReady(
    teamCode: string,
    rollNumber: string,
    isReady: boolean,
    memberToken?: string
  ): { room: TeamRoom; allReady: boolean } {
    const room = this.rooms.get(teamCode.trim().toUpperCase());
    if (!room) {
      throw new Error(`Team ${teamCode} not found.`);
    }

    if (room.status !== 'LOBBY' && room.status !== 'AWAITING_READY') {
      throw new Error(`Cannot change ready status while room is in ${room.status}.`);
    }

    const cleanRoll = rollNumber.trim().toUpperCase();
    const member = room.members.get(cleanRoll);
    if (!member) {
      throw new Error(`Member ${cleanRoll} not found in team ${teamCode}.`);
    }

    if (member.token && (!memberToken || member.token !== memberToken)) {
      throw new Error(`Unauthorized: Valid member token is required to toggle ready.`);
    }

    if (member.isExcused) {
      throw new Error(`Excused member cannot toggle ready state.`);
    }

    member.isReady = isReady;
    member.lastActiveAt = Date.now();

    // Calculate ready count & check if all required members are ready
    const activeMembers = Array.from(room.members.values()).filter(m => !m.isExcused);
    const readyCount = activeMembers.filter(m => m.isReady).length;
    const isFull = room.members.size === room.targetSize;
    const allReady = isFull && activeMembers.length > 0 && readyCount === activeMembers.length;

    // Broadcast member_ready_changed event
    const readyEvent: MemberReadyChangedEvent = {
      rollNumber: cleanRoll,
      isReady,
      readyCount,
      targetSize: room.targetSize,
      allReady
    };
    sseHub.broadcast(`team:${room.teamCode}`, 'member_ready_changed', readyEvent);

    // Atomic trigger: If all members are ready and contest window is open -> Start Countdown
    if (allReady && windowManager.isOpen()) {
      this.startCountdown(room);
    }

    this.syncLeaderboard(room);
    void databaseService.syncTeam(room);
    return { room, allReady };
  }

  /**
   * Initiates the synchronized 3-second countdown across all team members' screens.
   */
  private startCountdown(room: TeamRoom): void {
    room.status = 'COUNTDOWN';
    this.broadcastSnapshot(room);

    // Clear any previous timers if any
    this.clearRoomTimers(room.teamCode);

    const timers: NodeJS.Timeout[] = [];

    // T = 0ms: 3
    const tick3 = setTimeout(() => {
      const event: CountdownTickEvent = { secondsRemaining: 3, message: 'GET READY!' };
      sseHub.broadcast(`team:${room.teamCode}`, 'countdown_tick', event);
    }, 0);
    timers.push(tick3);

    // T = 1000ms: 2
    const tick2 = setTimeout(() => {
      const event: CountdownTickEvent = { secondsRemaining: 2, message: 'STEADY!' };
      sseHub.broadcast(`team:${room.teamCode}`, 'countdown_tick', event);
    }, 1000);
    timers.push(tick2);

    // T = 2000ms: 1
    const tick1 = setTimeout(() => {
      const event: CountdownTickEvent = { secondsRemaining: 1, message: 'FOCUS!' };
      sseHub.broadcast(`team:${room.teamCode}`, 'countdown_tick', event);
    }, 2000);
    timers.push(tick1);

    // T = 3000ms: SPRINT START
    const launch = setTimeout(() => {
      this.countdownTimers.delete(room.teamCode);

      if (!windowManager.isOpen()) {
        room.status = 'AWAITING_READY';
        this.broadcastSnapshot(room);
        this.syncLeaderboard(room);
        void databaseService.syncTeam(room);
        return;
      }

      try {
        this.launchSprint(room);
      } catch (err: unknown) {
        console.error(`Failed to launch sprint for team ${room.teamCode}:`, err);
        room.status = 'AWAITING_READY';
        room.startedAt = undefined;
        room.masterPaperId = undefined;
        for (const member of room.members.values()) {
          member.isReady = false;
        }
        this.broadcastSnapshot(room);
        void databaseService.syncTeam(room);
        sseHub.broadcast(`team:${room.teamCode}`, 'sprint_error', {
          error: 'SPRINT_LAUNCH_FAILED',
          message: 'An error occurred while launching the sprint. Please toggle ready to retry.'
        });
      }
    }, 3000);
    timers.push(launch);

    this.countdownTimers.set(room.teamCode, timers);
  }

  /**
   * Generates identical-difficulty math papers and parallel individual sessions at T=0.
   */
  private launchSprint(room: TeamRoom): void {
    room.status = 'IN_SPRINT';
    const startedAt = Date.now();
    room.startedAt = startedAt;

    let roomUsedKeys = this.roomUsedPairKeys.get(room.teamCode);
    if (!roomUsedKeys) {
      roomUsedKeys = new Set<string>();
      this.roomUsedPairKeys.set(room.teamCode, roomUsedKeys);
    } else if (roomUsedKeys.size > 450) {
      roomUsedKeys.clear();
    }

    // 1. Generate master 15-question paper with zero-luck taxonomy,
    // excluding all pairs previously played by this squad
    const masterPaper = mathEngine.generateSprintPaper(undefined, roomUsedKeys, room.operatorMode || this.roundOperatorMode || 'add');
    const masterQuestions = masterPaper.questions;
    room.masterPaperId = masterPaper.paperId;
    for (const q of masterQuestions) {
      roomUsedKeys.add(mathEngine.getCanonicalKey(q.a, q.b, q.operator));
    }

    const sessionIds: Record<string, string> = {};
    const questionsByRollNumber: Record<string, QuestionSanitized[]> = {};

    // 2. Setup individual sessions with PRNG player-specific shuffles
    for (const member of room.members.values()) {
      if (member.isExcused) continue;

      const playerSeed = `${room.teamCode}:${member.rollNumber}:${masterPaper.paperId}:${startedAt}`;
      const shuffledQuestions = mathEngine.shuffleQuestionsForPlayer(masterQuestions, playerSeed);
      const sanitized = mathEngine.sanitizeQuestions(shuffledQuestions);

      const sessionId = `sess_${member.rollNumber}_${Math.random().toString(36).slice(2, 8)}`;
      member.activeSessionId = sessionId;
      sessionIds[member.rollNumber] = sessionId;
      questionsByRollNumber[member.rollNumber] = sanitized;

      const session: SprintSession = {
        sessionId,
        teamCode: room.teamCode,
        rollNumber: member.rollNumber,
        memberToken: member.token,
        startedAt,
        expiresAt: startedAt + 120_000, // Exactly 120 seconds
        questions: shuffledQuestions,
        submissions: [],
        currentScore: 0,
        consecutiveStreak: 0,
        completedQuestions: 0,
        isFinished: false,
        operatorMode: room.operatorMode || 'add'
      };

      this.sessions.set(sessionId, session);
      this.lastQuestionTimes.set(sessionId, startedAt);
    }

    // 3. Broadcast sprint_start event over team SSE channel (Zero Question Leak)
    const startEvent: SprintStartEvent = {
      startedAt,
      durationSeconds: 120,
      totalQuestions: 15,
      operatorMode: room.operatorMode || 'add',
      sessions: sessionIds,
      questionsByRollNumber
    };
    sseHub.broadcast(`team:${room.teamCode}`, 'sprint_start', startEvent);

    this.broadcastSnapshot(room);
    this.syncLeaderboard(room);
    void databaseService.syncTeam(room);
    for (const sid of Object.values(sessionIds)) {
      const sess = this.sessions.get(sid);
      if (sess) {
        void databaseService.syncSprintSession(sess, room.isPaused, room.pausedAt);
      }
    }

    // 4. Schedule auto-close timer at 120s + 2.5s network transit grace
    const autoClose = setTimeout(() => {
      try {
        this.handleSprintTimeout(room.teamCode);
      } catch (err: unknown) {
        console.error(`Error during sprint timeout for team ${room.teamCode}:`, err);
      }
    }, 122_500);
    autoClose.unref?.();
    this.expiryTimers.set(room.teamCode, autoClose);
  }

  /**
   * Evaluates an individual question submission and updates team average standing.
   */
  public submitAnswer(
    sessionId: string,
    questionIndex: number,
    submittedAnswer: number,
    clientDeltaMs: number,
    clientTimestamp: number,
    memberToken?: string
  ) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Active sprint session ${sessionId} not found.`);
    }

    if (session.memberToken) {
      if (!memberToken || session.memberToken !== memberToken) {
        throw new Error('Unauthorized: Valid member token is required for answer submission.');
      }
    }

    const room = this.rooms.get(session.teamCode);
    if (!room) {
      throw new Error(`Team room ${session.teamCode} not found.`);
    }

    if (room.isPaused) {
      throw new Error(`Session is temporarily paused by hackathon administrators.`);
    }

    if (session.isFinished) {
      throw new Error(`Session has already finished.`);
    }

    const now = Date.now();

    // Transit grace cutoff check: authoritative server clock with 2.5s network transit grace
    if (now > session.expiresAt + 2500) {
      throw new Error(`120-second sprint deadline expired.`);
    }

    // Sequential progression check: player must answer in order
    if (questionIndex !== session.completedQuestions) {
      throw new Error(
        `Invalid question index. Expected question ${session.completedQuestions}, got ${questionIndex}.`
      );
    }

    if (session.questions.length < 15) {
      throw new Error(`Session contains incomplete question set (${session.questions.length}/15) and cannot accept further submissions.`);
    }

    if (questionIndex >= session.questions.length) {
      throw new Error(`All ${session.questions.length} questions already completed.`);
    }

    // Timing anomaly detection
    const lastTime = this.lastQuestionTimes.get(sessionId) ?? session.startedAt;
    const serverDeltaMs = now - lastTime;
    this.lastQuestionTimes.set(sessionId, now);

    let isAnomaly = false;
    let anomalyReason: string | undefined;

    if (clientDeltaMs < 200 || serverDeltaMs < 200) {
      isAnomaly = true;
      anomalyReason = 'SUB_200MS_SPEED_ANOMALY';
    } else if (Math.abs(serverDeltaMs - clientDeltaMs) > 350) {
      // Packet jitter anomaly (tolerating up to 350ms)
      isAnomaly = true;
      anomalyReason = 'PACKET_JITTER_EXCEEDED';
    }

    if (isAnomaly) {
      const member = room.members.get(session.rollNumber);
      const flagEvent: AnomalyFlagEvent = {
        timestamp: now,
        teamCode: room.teamCode,
        rollNumber: session.rollNumber,
        name: member?.name ?? session.rollNumber,
        sessionId,
        questionIndex,
        clientDeltaMs,
        flagReason: anomalyReason!
      };
      sseHub.broadcast('admin', 'anomaly_flag', flagEvent);
    }

    const question = session.questions[questionIndex];

    // Server-validated latency: client cannot claim faster than server - 350ms jitter window.
    // If a sub-200ms speed anomaly is detected, enforce targetLatencyMs so bot submissions receive 0 speed bonus.
    const serverFloorLatency = Math.max(0, serverDeltaMs - 350);
    const rawValidated = Math.max(clientDeltaMs, serverFloorLatency);
    const validatedLatency = isAnomaly && anomalyReason === 'SUB_200MS_SPEED_ANOMALY'
      ? question.targetLatencyMs
      : Math.max(200, rawValidated);

    // Evaluate answer with difficulty-calibrated scoring engine
    const evalResult = scoringEngine.evaluateSubmission(
      question,
      submittedAnswer,
      validatedLatency,
      session.consecutiveStreak
    );

    const finalIsAnomaly = isAnomaly || evalResult.isAnomaly;
    const finalAnomalyReason = anomalyReason || evalResult.anomalyReason;

    // Update session state
    session.currentScore += evalResult.pointsAwarded;
    session.consecutiveStreak = evalResult.newStreak;
    session.completedQuestions += 1;

    const submission: SubmissionRecord = {
      questionIndex,
      submittedAnswer,
      actualAnswer: question.answer,
      a: question.a,
      b: question.b,
      operator: question.operator,
      bucket: question.bucket,
      carryType: question.carryType,
      targetLatencyMs: question.targetLatencyMs,
      isCorrect: evalResult.isCorrect,
      latencyMs: clientDeltaMs,
      serverDeltaMs,
      packetJitterMs: Math.abs(serverDeltaMs - clientDeltaMs),
      pointsAwarded: evalResult.pointsAwarded,
      streakAfter: session.consecutiveStreak,
      scoreAfter: session.currentScore,
      timestamp: now,
      isAnomaly: finalIsAnomaly,
      anomalyReason: finalAnomalyReason
    };
    session.submissions.push(submission);

    // Update room member state
    const member = room.members.get(session.rollNumber);
    if (member) {
      member.individualScore = session.currentScore;
      member.completedQuestions = session.completedQuestions;
      member.lastActiveAt = now;
    }

    void databaseService.syncSubmission(sessionId, session.rollNumber, submission, session.teamCode);
    metrics.recordSubmission({
      operator: question.operator,
      bucket: question.bucket,
      isCorrect: evalResult.isCorrect,
      isAnomaly: finalIsAnomaly,
      latencySeconds: validatedLatency / 1000
    });

    // Broadcast teammate_progress to team SSE channel
    const progressEvent: TeammateProgressEvent = {
      rollNumber: session.rollNumber,
      name: member?.name ?? session.rollNumber,
      questionIndex: session.completedQuestions,
      currentScore: session.currentScore,
      streak: session.consecutiveStreak
    };
    sseHub.broadcast(`team:${room.teamCode}`, 'teammate_progress', progressEvent);

    // Check if player finished all 15 questions
    if (session.completedQuestions >= session.questions.length) {
      session.isFinished = true;
      this.persistSessionAudit(session);
      void databaseService.syncSprintSession(session, room.isPaused, room.pausedAt);
      this.checkRoomCompletion(room);
    }

    // Recalculate team average and broadcast to leaderboard (if not already finalized)
    if ((room.status as string) !== 'FINISHED') {
      this.syncLeaderboard(room);
    }

    return {
      isCorrect: evalResult.isCorrect,
      pointsAwarded: evalResult.pointsAwarded,
      currentScore: session.currentScore,
      consecutiveStreak: session.consecutiveStreak,
      completedQuestions: session.completedQuestions,
      isFinished: session.isFinished,
      isAnomaly: finalIsAnomaly
    };
  }

  /**
   * Checks whether all active members have finished their sprints.
   */
  private checkRoomCompletion(room: TeamRoom): void {
    const activeMembers = Array.from(room.members.values()).filter(m => !m.isExcused);
    const allFinished = activeMembers.every(m => {
      const session = m.activeSessionId ? this.sessions.get(m.activeSessionId) : null;
      return session?.isFinished;
    });

    if (allFinished) {
      this.finalizeRoom(room);
    }
  }

  /**
   * Finalizes room upon sprint completion or timeout.
   */
  private finalizeRoom(room: TeamRoom): void {
    if (room.status === 'FINISHED') return;
    room.status = 'FINISHED';
    room.completedAt = Date.now();

    for (const member of room.members.values()) {
      if (member.activeSessionId) {
        const session = this.sessions.get(member.activeSessionId);
        if (session) {
          session.isFinished = true;
          this.persistSessionAudit(session);
        }
      }
    }

    this.clearRoomTimers(room.teamCode);

    this.broadcastSnapshot(room);
    this.syncLeaderboard(room);
    void databaseService.syncTeam(room);
    for (const member of room.members.values()) {
      if (member.activeSessionId) {
        const session = this.sessions.get(member.activeSessionId);
        if (session) void databaseService.syncSprintSession(session, room.isPaused, room.pausedAt);
      }
    }
  }

  /**
   * Handles sprint auto-expiry at 120s + 2.5s transit grace.
   */
  private handleSprintTimeout(teamCode: string): void {
    const room = this.rooms.get(teamCode);
    if (!room || room.status === 'FINISHED') return;

    for (const member of room.members.values()) {
      if (member.activeSessionId) {
        const session = this.sessions.get(member.activeSessionId);
        if (session) {
          session.isFinished = true;
          this.persistSessionAudit(session);
        }
      }
    }

    this.finalizeRoom(room);
  }

  /**
   * Hardware Failure Recovery: Excuses a member whose device crashed or battery died.
   * Adjusts the scoring divisor dynamically and records an immutable audit trail.
   */
  public excuseMember(
    teamCode: string,
    rollNumber: string,
    reason: string,
    adminId: string
  ): {
    success: boolean;
    teamCode: string;
    excusedMember: string;
    activeMembersCount: number;
    newTeamAverageScore: number;
    auditRecordId: string;
  } {
    const room = this.rooms.get(teamCode.trim().toUpperCase());
    if (!room) {
      throw new Error(`Team ${teamCode} not found.`);
    }

    const cleanRoll = rollNumber.trim().toUpperCase();
    const member = room.members.get(cleanRoll);
    if (!member) {
      throw new Error(`Member ${cleanRoll} not found in team ${teamCode}.`);
    }

    const activeMembers = Array.from(room.members.values()).filter(m => !m.isExcused);
    if (activeMembers.length <= 1 && activeMembers.some(m => m.rollNumber === cleanRoll)) {
      throw new Error(`Cannot excuse the last remaining active member in team ${teamCode}.`);
    }

    member.isExcused = true;
    member.isReady = false;

    // Terminate any ongoing sprint session for the excused member
    if (member.activeSessionId) {
      const activeSession = this.sessions.get(member.activeSessionId);
      if (activeSession) {
        activeSession.isFinished = true;
        this.persistSessionAudit(activeSession);
      }
    }

    // Recalculate active members and team average
    const remainingActive = Array.from(room.members.values()).filter(m => !m.isExcused);
    const activeCount = remainingActive.length;
    const totalScore = remainingActive.reduce((sum, m) => sum + m.individualScore, 0);
    const newAverage = activeCount > 0 ? Number((totalScore / activeCount).toFixed(2)) : 0;

    const auditId = `aud_excuse_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const auditRecord: AuditRecord = {
      id: auditId,
      timestamp: Date.now(),
      action: 'EXCUSE_MEMBER',
      teamCode: room.teamCode,
      rollNumber: cleanRoll,
      adminId,
      reason,
      details: {
        activeMembersCount: activeCount,
        newTeamAverageScore: newAverage
      }
    };
    this.logAudit(auditRecord);

    this.broadcastSnapshot(room);
    this.syncLeaderboard(room, true);
    void databaseService.syncTeam(room);
    if (member.activeSessionId) {
      const activeSession = this.sessions.get(member.activeSessionId);
      if (activeSession) {
        void databaseService.syncSprintSession(activeSession, room.isPaused, room.pausedAt);
      }
    }

    // If room is in sprint, recheck if remaining active members are all finished
    if (room.status === 'IN_SPRINT') {
      this.checkRoomCompletion(room);
    } else if (room.status === 'AWAITING_READY' && windowManager.isOpen()) {
      const remainingActive = Array.from(room.members.values()).filter(m => !m.isExcused);
      const readyCount = remainingActive.filter(m => m.isReady).length;
      const isFull = room.members.size === room.targetSize;
      const allReady = isFull && remainingActive.length > 0 && readyCount === remainingActive.length;
      if (allReady) {
        this.startCountdown(room);
      }
    }

    return {
      success: true,
      teamCode: room.teamCode,
      excusedMember: cleanRoll,
      activeMembersCount: activeCount,
      newTeamAverageScore: newAverage,
      auditRecordId: auditId
    };
  }

  /**
   * Pauses an active team room (admin control).
   */
  public pauseRoom(teamCode: string, adminId: string): void {
    const room = this.rooms.get(teamCode.trim().toUpperCase());
    if (!room) throw new Error(`Team ${teamCode} not found.`);

    if (room.status !== 'IN_SPRINT') {
      throw new Error(`Cannot pause team ${teamCode}: Room is in ${room.status} status, not IN_SPRINT.`);
    }

    if (room.isPaused) {
      throw new Error(`Team ${teamCode} is already paused.`);
    }

    room.isPaused = true;
    room.pausedAt = Date.now();

    // Pause the active expiry timer while room is paused
    const activeExpiry = this.expiryTimers.get(room.teamCode);
    if (activeExpiry) {
      clearTimeout(activeExpiry);
      this.expiryTimers.delete(room.teamCode);
    }

    for (const member of room.members.values()) {
      if (member.activeSessionId) {
        const session = this.sessions.get(member.activeSessionId);
        if (session) {
          void databaseService.syncSprintSession(session, true, room.pausedAt);
        }
      }
    }

    this.logAudit({
      id: `aud_pause_${Date.now()}`,
      timestamp: Date.now(),
      action: 'ROOM_PAUSE',
      teamCode: room.teamCode,
      adminId
    });

    sseHub.broadcast(`team:${room.teamCode}`, 'room_paused', { teamCode: room.teamCode, pausedAt: room.pausedAt });
    this.broadcastSnapshot(room);
    void databaseService.syncTeam(room);
    this.notifyStateMutated();
  }

  /**
   * Resumes a paused team room (admin control).
   */
  public resumeRoom(teamCode: string, adminId: string): void {
    const room = this.rooms.get(teamCode.trim().toUpperCase());
    if (!room) throw new Error(`Team ${teamCode} not found.`);

    if (!room.isPaused) {
      throw new Error(`Team ${teamCode} is not currently paused.`);
    }

    if (room.isPaused && room.pausedAt) {
      const pausedDuration = Date.now() - room.pausedAt;
      let maxRemaining = 0;

      // Extend expiration for all active sessions & shift lastQuestionTimes forward
      for (const member of room.members.values()) {
        if (member.activeSessionId) {
          const session = this.sessions.get(member.activeSessionId);
          if (session) {
            session.expiresAt += pausedDuration;
            void databaseService.syncSprintSession(session, false);
            const remaining = session.expiresAt + 2500 - Date.now();
            if (remaining > maxRemaining) {
              maxRemaining = remaining;
            }
          }
          if (this.lastQuestionTimes.has(member.activeSessionId)) {
            const prevTime = this.lastQuestionTimes.get(member.activeSessionId)!;
            this.lastQuestionTimes.set(member.activeSessionId, prevTime + pausedDuration);
          }
        }
      }
      room.isPaused = false;
      room.pausedAt = undefined;

      // Reschedule auto-expiry timer with the updated remaining duration
      if (room.status === 'IN_SPRINT' && maxRemaining > 0) {
        const autoClose = setTimeout(() => {
          try {
            this.handleSprintTimeout(room.teamCode);
          } catch (err: unknown) {
            console.error(`Error during resumed sprint timeout for team ${room.teamCode}:`, err);
          }
        }, maxRemaining);
        autoClose.unref?.();
        this.expiryTimers.set(room.teamCode, autoClose);
      }
    }

    this.logAudit({
      id: `aud_resume_${Date.now()}`,
      timestamp: Date.now(),
      action: 'ROOM_RESUME',
      teamCode: room.teamCode,
      adminId
    });

    sseHub.broadcast(`team:${room.teamCode}`, 'room_resumed', { teamCode: room.teamCode, resumedAt: Date.now() });
    this.broadcastSnapshot(room);
    void databaseService.syncTeam(room);
    this.notifyStateMutated();
  }

  /**
   * Pauses all active sprint rooms simultaneously (Emergency Organizer Control).
   */
  public emergencyPauseAllSprints(adminId: string): { success: boolean; pausedCount: number; pausedTeamCodes: string[] } {
    const pausedTeamCodes: string[] = [];
    const now = Date.now();

    for (const room of this.rooms.values()) {
      if (room.status === 'IN_SPRINT' && !room.isPaused) {
        room.isPaused = true;
        room.pausedAt = now;

        const activeExpiry = this.expiryTimers.get(room.teamCode);
        if (activeExpiry) {
          clearTimeout(activeExpiry);
          this.expiryTimers.delete(room.teamCode);
        }

        for (const member of room.members.values()) {
          if (member.activeSessionId) {
            const session = this.sessions.get(member.activeSessionId);
            if (session) {
              void databaseService.syncSprintSession(session, true, now);
            }
          }
        }

        sseHub.broadcast(`team:${room.teamCode}`, 'room_paused', { teamCode: room.teamCode, pausedAt: now });
        this.broadcastSnapshot(room);
        void databaseService.syncTeam(room);
        pausedTeamCodes.push(room.teamCode);
      }
    }

    const auditRecord: AuditRecord = {
      id: `aud_em_pause_${now}`,
      timestamp: now,
      action: 'EMERGENCY_PAUSE_ALL',
      adminId,
      details: { pausedCount: pausedTeamCodes.length, pausedTeamCodes }
    };
    this.logAudit(auditRecord);

    sseHub.broadcastAdminAction({
      action: 'EMERGENCY_PAUSE_ALL',
      details: { pausedCount: pausedTeamCodes.length, pausedTeamCodes },
      executedBy: adminId,
      timestamp: now
    });

    sseHub.broadcastFlashAnnouncement('🚨 EMERGENCY: ALL ACTIVE SPRINTS HAVE BEEN PAUSED BY ORGANIZERS', 'emergency');
    this.notifyStateMutated();

    return { success: true, pausedCount: pausedTeamCodes.length, pausedTeamCodes };
  }

  /**
   * Resumes all paused sprint rooms with synchronized unfreeze buffer (Emergency Organizer Control).
   */
  public emergencyResumeAllSprints(adminId: string): { success: boolean; resumedCount: number; resumedTeamCodes: string[] } {
    const resumedTeamCodes: string[] = [];
    const now = Date.now();

    sseHub.broadcastFlashAnnouncement('▶ ATTENTION: ALL PAUSED SPRINTS HAVE RESUMED', 'normal');

    for (const room of this.rooms.values()) {
      if (room.isPaused && room.pausedAt) {
        const pausedDuration = now - room.pausedAt;
        let maxRemaining = 0;

        for (const member of room.members.values()) {
          if (member.activeSessionId) {
            const session = this.sessions.get(member.activeSessionId);
            if (session) {
              session.expiresAt += pausedDuration;
              void databaseService.syncSprintSession(session, false);
              const remaining = session.expiresAt + 2500 - now;
              if (remaining > maxRemaining) {
                maxRemaining = remaining;
              }
            }
            if (this.lastQuestionTimes.has(member.activeSessionId)) {
              const prevTime = this.lastQuestionTimes.get(member.activeSessionId)!;
              this.lastQuestionTimes.set(member.activeSessionId, prevTime + pausedDuration);
            }
          }
        }

        room.isPaused = false;
        room.pausedAt = undefined;

        if (room.status === 'IN_SPRINT' && maxRemaining > 0) {
          const autoClose = setTimeout(() => {
            try {
              this.handleSprintTimeout(room.teamCode);
            } catch (err: unknown) {
              console.error(`Error during resumed sprint timeout for team ${room.teamCode}:`, err);
            }
          }, maxRemaining);
          autoClose.unref?.();
          this.expiryTimers.set(room.teamCode, autoClose);
        }

        sseHub.broadcast(`team:${room.teamCode}`, 'room_resumed', { teamCode: room.teamCode, resumedAt: now, unfreezeBufferMs: 3000 });
        this.broadcastSnapshot(room);
        void databaseService.syncTeam(room);
        resumedTeamCodes.push(room.teamCode);
      }
    }

    const auditRecord: AuditRecord = {
      id: `aud_em_resume_${now}`,
      timestamp: now,
      action: 'EMERGENCY_RESUME_ALL',
      adminId,
      details: { resumedCount: resumedTeamCodes.length, resumedTeamCodes }
    };
    this.logAudit(auditRecord);

    sseHub.broadcastAdminAction({
      action: 'EMERGENCY_RESUME_ALL',
      details: { resumedCount: resumedTeamCodes.length, resumedTeamCodes },
      executedBy: adminId,
      timestamp: now
    });

    this.notifyStateMutated();
    return { success: true, resumedCount: resumedTeamCodes.length, resumedTeamCodes };
  }

  /**
   * Kicks an unresponsive or invalid member from a pre-sprint room (LOBBY or AWAITING_READY).
   * Strict invariant: Forbidden during IN_SPRINT or FINISHED (use excuseMember instead).
   */
  public kickMemberFromRoom(
    teamCode: string,
    rollNumber: string,
    adminId: string
  ): {
    success: boolean;
    teamCode: string;
    kickedRollNumber: string;
    remainingMembersCount: number;
    dissolved: boolean;
  } {
    const cleanCode = teamCode.trim().toUpperCase();
    const cleanRoll = rollNumber.trim().toUpperCase();
    const room = this.rooms.get(cleanCode);

    if (!room) {
      throw new Error(`Team ${teamCode} does not exist.`);
    }

    if (room.status !== 'LOBBY' && room.status !== 'AWAITING_READY') {
      throw new Error(`Cannot kick member while team is in ${room.status} status. Use [EXCUSE MEMBER] during active or finished sprints to preserve score integrity.`);
    }

    const member = room.members.get(cleanRoll);
    if (!member) {
      throw new Error(`Member with roll number ${rollNumber} is not in team ${teamCode}.`);
    }

    const wasCaptain = member.isCaptain;
    room.members.delete(cleanRoll);
    void databaseService.deleteMember(cleanCode, cleanRoll);
    if (this.rollToTeamMap.get(cleanRoll) === cleanCode) {
      this.rollToTeamMap.delete(cleanRoll);
    }

    const now = Date.now();
    let dissolved = false;

    if (room.members.size === 0) {
      this.clearRoomTimers(cleanCode);
      this.rooms.delete(cleanCode);
      this.roomUsedPairKeys.delete(cleanCode);
      leaderboardManager.removeTeam(cleanCode, true);
      sseHub.clearChannelBuffer(`team:${cleanCode}`);
      void databaseService.deleteTeam(cleanCode);
      dissolved = true;
    } else {
      if (wasCaptain) {
        const nextCaptain = room.members.values().next().value;
        if (nextCaptain) {
          nextCaptain.isCaptain = true;
        }
      }
      if (room.status === 'AWAITING_READY' && room.members.size < room.targetSize) {
        room.status = 'LOBBY';
      }
      this.broadcastSnapshot(room);
      this.syncLeaderboard(room);
      void databaseService.syncTeam(room);
    }

    const auditRecord: AuditRecord = {
      id: `aud_kick_${now}`,
      timestamp: now,
      action: 'KICK_MEMBER',
      teamCode: cleanCode,
      rollNumber: cleanRoll,
      adminId,
      details: { wasCaptain, dissolved, remainingMembersCount: room.members.size }
    };
    this.logAudit(auditRecord);

    sseHub.broadcastAdminAction({
      action: 'KICK_MEMBER',
      teamCode: cleanCode,
      details: { rollNumber: cleanRoll, wasCaptain, dissolved },
      executedBy: adminId,
      timestamp: now
    });

    this.notifyStateMutated();

    return {
      success: true,
      teamCode: cleanCode,
      kickedRollNumber: cleanRoll,
      remainingMembersCount: room.members.size,
      dissolved
    };
  }

  /**
   * Dissolves an abandoned or troll team room before sprint execution.
   */
  public dissolveRoom(
    teamCode: string,
    adminId: string,
    reason = 'Administrative dissolution'
  ): { success: boolean; teamCode: string; message: string } {
    const cleanCode = teamCode.trim().toUpperCase();
    const room = this.rooms.get(cleanCode);
    if (!room) {
      throw new Error(`Team ${teamCode} does not exist.`);
    }

    if (room.status === 'IN_SPRINT' && !room.isPaused) {
      throw new Error(`Cannot dissolve team ${teamCode} while an active sprint is running. Pause the sprint first or wait for completion.`);
    }

    this.clearRoomTimers(cleanCode);
    for (const [roll, member] of room.members.entries()) {
      if (this.rollToTeamMap.get(roll) === cleanCode) {
        this.rollToTeamMap.delete(roll);
      }
      if (member.activeSessionId) {
        const sess = this.sessions.get(member.activeSessionId);
        if (sess) {
          sess.isFinished = true;
          this.persistSessionAudit(sess);
          this.sessions.delete(member.activeSessionId);
        }
        this.lastQuestionTimes.delete(member.activeSessionId);
      }
    }

    this.rooms.delete(cleanCode);
    this.roomUsedPairKeys.delete(cleanCode);
    leaderboardManager.removeTeam(cleanCode, true);
    void databaseService.deleteTeam(cleanCode);
    sseHub.broadcast(`team:${cleanCode}`, 'sprint_error', {
      error: 'ROOM_DISSOLVED',
      message: `This team room has been dissolved by an organizer: ${reason}`
    });
    sseHub.clearChannelBuffer(`team:${cleanCode}`);

    const now = Date.now();
    const auditRecord: AuditRecord = {
      id: `aud_dissolve_${now}`,
      timestamp: now,
      action: 'DISSOLVE_ROOM',
      teamCode: cleanCode,
      adminId,
      reason
    };
    this.logAudit(auditRecord);

    sseHub.broadcastAdminAction({
      action: 'DISSOLVE_ROOM',
      teamCode: cleanCode,
      details: { reason },
      executedBy: adminId,
      timestamp: now
    });

    this.notifyStateMutated();
    return { success: true, teamCode: cleanCode, message: `Team room ${cleanCode} successfully dissolved.` };
  }

  /**
   * Disqualifies a team from tournament podium rankings while preserving audit trail.
   */
  public disqualifyTeam(
    teamCode: string,
    adminId: string,
    reason: string
  ): { success: boolean; teamCode: string; isDisqualified: boolean; reason: string } {
    const cleanCode = teamCode.trim().toUpperCase();
    const room = this.rooms.get(cleanCode);
    if (!room) {
      throw new Error(`Team ${teamCode} does not exist.`);
    }

    room.isDisqualified = true;
    room.disqualificationReason = reason.trim() || 'Rule violation';

    const now = Date.now();
    const auditRecord: AuditRecord = {
      id: `aud_disq_${now}`,
      timestamp: now,
      action: 'DISQUALIFY_TEAM',
      teamCode: cleanCode,
      adminId,
      reason: room.disqualificationReason
    };
    this.logAudit(auditRecord);

    sseHub.broadcastAdminAction({
      action: 'DISQUALIFY_TEAM',
      teamCode: cleanCode,
      details: { reason: room.disqualificationReason },
      executedBy: adminId,
      timestamp: now
    });

    this.broadcastSnapshot(room);
    this.syncLeaderboard(room, true);
    void databaseService.syncTeam(room);
    this.notifyStateMutated();

    return { success: true, teamCode: cleanCode, isDisqualified: true, reason: room.disqualificationReason };
  }

  /**
   * Reinstates a previously disqualified team.
   */
  public reinstateTeam(
    teamCode: string,
    adminId: string
  ): { success: boolean; teamCode: string; isDisqualified: boolean } {
    const cleanCode = teamCode.trim().toUpperCase();
    const room = this.rooms.get(cleanCode);
    if (!room) {
      throw new Error(`Team ${teamCode} does not exist.`);
    }

    room.isDisqualified = false;
    room.disqualificationReason = undefined;

    const now = Date.now();
    const auditRecord: AuditRecord = {
      id: `aud_reinstate_${now}`,
      timestamp: now,
      action: 'REINSTATE_TEAM',
      teamCode: cleanCode,
      adminId
    };
    this.logAudit(auditRecord);

    sseHub.broadcastAdminAction({
      action: 'REINSTATE_TEAM',
      teamCode: cleanCode,
      executedBy: adminId,
      timestamp: now
    });

    this.broadcastSnapshot(room);
    this.syncLeaderboard(room, true);
    void databaseService.syncTeam(room);
    this.notifyStateMutated();

    return { success: true, teamCode: cleanCode, isDisqualified: false };
  }

  /**
   * Applies a structured score adjustment/penalty to a team with mandatory logged justification.
   */
  public adjustTeamScore(
    teamCode: string,
    deltaPoints: number,
    reason: string,
    adminId: string
  ): { success: boolean; teamCode: string; newTeamAverageScore: number; deltaPoints: number } {
    const cleanCode = teamCode.trim().toUpperCase();
    const room = this.rooms.get(cleanCode);
    if (!room) {
      throw new Error(`Team ${teamCode} does not exist.`);
    }

    if (!Number.isFinite(deltaPoints)) {
      throw new Error('deltaPoints must be a finite number.');
    }

    if (room.status !== 'IN_SPRINT' && room.status !== 'FINISHED') {
      throw new Error(`Score adjustments require an active or finished sprint (room is in ${room.status} status).`);
    }

    const activeMembers = Array.from(room.members.values()).filter(m => !m.isExcused);
    if (activeMembers.length === 0) {
      throw new Error(`Team ${teamCode} has no active unexcused members to apply score adjustments.`);
    }

    room.scoreAdjustment = (room.scoreAdjustment || 0) + deltaPoints;

    for (const member of activeMembers) {
      member.individualScore = Math.max(0, member.individualScore + deltaPoints);
      if (member.activeSessionId) {
        const sess = this.sessions.get(member.activeSessionId);
        if (sess) {
          sess.currentScore = member.individualScore;
          void databaseService.syncSprintSession(sess, room.isPaused, room.pausedAt);
        }
      }
    }

    this.syncLeaderboard(room, true);
    this.broadcastSnapshot(room);
    void databaseService.syncTeam(room);

    const activeCount = activeMembers.length;
    const totalScore = activeMembers.reduce((sum, m) => sum + m.individualScore, 0);
    const newAverage = activeCount > 0 ? Number((totalScore / activeCount).toFixed(2)) : 0;

    const now = Date.now();
    const auditRecord: AuditRecord = {
      id: `aud_score_adj_${now}`,
      timestamp: now,
      action: 'ADJUST_SCORE',
      teamCode: cleanCode,
      adminId,
      reason,
      details: { deltaPoints, newTeamAverageScore: newAverage }
    };
    this.logAudit(auditRecord);

    sseHub.broadcastAdminAction({
      action: 'ADJUST_SCORE',
      teamCode: cleanCode,
      details: { deltaPoints, newTeamAverageScore: newAverage, reason },
      executedBy: adminId,
      timestamp: now
    });

    this.notifyStateMutated();
    return { success: true, teamCode: cleanCode, newTeamAverageScore: newAverage, deltaPoints };
  }

  /**
   * Returns active tournament round operator mode.
   */
  public getRoundOperatorMode(): OperatorMode {
    return this.roundOperatorMode ?? 'add';
  }

  /**
   * Returns explicitly configured round operator mode override, or null when squads choose freely.
   */
  public getRoundOperatorModeOverride(): OperatorMode | null {
    return this.roundOperatorMode;
  }

  /**
   * Sets active tournament round operator mode (add, sub, mixed, or null to allow squad choice).
   */
  public setRoundOperatorMode(mode: OperatorMode | null, adminId: string): OperatorMode | null {
    if (mode !== null && mode !== 'add' && mode !== 'sub' && mode !== 'mixed') {
      throw new Error(`Invalid operator mode: ${mode}. Allowed: add, sub, mixed, or null.`);
    }
    this.roundOperatorMode = mode;
    if (mode !== null) {
      for (const room of this.rooms.values()) {
        if (room.status === 'LOBBY' || room.status === 'AWAITING_READY') {
          room.operatorMode = mode;
          this.broadcastSnapshot(room);
          void databaseService.syncTeam(room);
        }
      }
    }
    const now = Date.now();

    const auditRecord: AuditRecord = {
      id: `aud_mode_${now}`,
      timestamp: now,
      action: 'ROUND_MODE_CHANGE',
      adminId,
      details: { newMode: mode ?? 'squad_choice' }
    };
    this.logAudit(auditRecord);

    sseHub.broadcastAdminAction({
      action: 'ROUND_MODE_CHANGE',
      details: { newMode: mode ?? 'squad_choice', overrideMode: mode },
      executedBy: adminId,
      timestamp: now
    });

    this.notifyStateMutated();
    void databaseService.syncTournamentWindow(
      windowManager.isOpen(),
      windowManager.getConfig().opensAt,
      windowManager.getConfig().closesAt,
      mode
    );
    return this.roundOperatorMode;
  }

  /**
   * Synchronizes team average score and telemetry with the LeaderboardManager.
   */
  private syncLeaderboard(room: TeamRoom, immediate = false): void {
    if (room.status === 'LOBBY') {
      leaderboardManager.removeTeam(room.teamCode, immediate);
      void databaseService.syncLeaderboard(leaderboardManager.getLeaderboard());
      this.notifyStateMutated();
      return;
    }

    const activeMembers = Array.from(room.members.values()).filter(m => !m.isExcused);
    const totalScore = activeMembers.reduce((sum, m) => sum + m.individualScore, 0);
    const activeCount = activeMembers.length;
    const averageScore = activeCount > 0 ? Number((totalScore / activeCount).toFixed(2)) : 0;

    // Calculate average completion time
    let averageTimeSeconds = 0;
    if (room.startedAt) {
      const referenceEnd = room.completedAt ?? Date.now();
      averageTimeSeconds = Number(((referenceEnd - room.startedAt) / 1000).toFixed(1));
    }

    const memberBreakdown: MemberLeaderboardSummary[] = Array.from(room.members.values()).map(m => ({
      name: m.name,
      score: m.individualScore,
      completedQuestions: m.completedQuestions,
      isExcused: m.isExcused
    }));

    let status: 'WAITING' | 'IN_SPRINT' | 'FINISHED' = 'WAITING';
    if (room.status === 'IN_SPRINT') status = 'IN_SPRINT';
    else if (room.status === 'FINISHED') status = 'FINISHED';

    const entry: Omit<LeaderboardEntry, 'rank'> = {
      teamCode: room.teamCode,
      teamName: room.teamName,
      teamAverageScore: averageScore,
      membersCount: room.members.size,
      activeMembersCount: activeCount,
      targetSize: room.targetSize,
      averageTimeSeconds,
      memberBreakdown,
      status,
      isDisqualified: room.isDisqualified,
      disqualificationReason: room.disqualificationReason
    };

    leaderboardManager.updateTeam(entry, immediate);
    void databaseService.syncLeaderboard(leaderboardManager.getLeaderboard());
    this.notifyStateMutated();
  }

  private telemetryTimer: NodeJS.Timeout | null = null;
  private cachedRssMb = 0;
  private lastRssAt = 0;

  private scheduleTelemetryBroadcast(): void {
    if (this.telemetryTimer || sseHub.getClientCount('admin') === 0) return;
    this.telemetryTimer = setTimeout(() => {
      this.telemetryTimer = null;
      if (sseHub.getClientCount('admin') > 0) {
        sseHub.broadcast('admin', 'admin_telemetry', this.getTelemetry());
      }
    }, 50);
    this.telemetryTimer.unref?.();
  }

  /**
   * Broadcasts complete room snapshot to team members and admin over SSE.
   */
  public broadcastSnapshot(room: TeamRoom): void {
    const snapshot = this.getSnapshot(room);
    sseHub.broadcast(`team:${room.teamCode}`, 'team_snapshot', snapshot);
    sseHub.broadcast('admin', 'room_snapshot', snapshot);
    this.scheduleTelemetryBroadcast();
  }

  /**
   * Finalizes an IN_SPRINT room if all active members have either completed their sessions
   * or passed the authoritative 120s + 2.5s network transit grace submission cutoff.
   */
  public checkAndFinalizeIfExpired(room: TeamRoom, graceMs = 2500): void {
    if (room.status !== 'IN_SPRINT' || room.isPaused) return;
    const now = Date.now();
    const activeMembers = Array.from(room.members.values()).filter(m => !m.isExcused);
    if (activeMembers.length === 0) return;

    const allExpiredOrFinished = activeMembers.every(m => {
      if (!m.activeSessionId) return true;
      const sess = this.sessions.get(m.activeSessionId);
      if (!sess || sess.isFinished) return true;
      return now > sess.expiresAt + graceMs;
    });

    if (allExpiredOrFinished) {
      this.handleSprintTimeout(room.teamCode);
    }
  }

  /**
   * Prepares a sanitized TeamSnapshotEvent for a given room.
   */
  public getSnapshot(room: TeamRoom): TeamSnapshotEvent {
    this.checkAndFinalizeIfExpired(room);

    const membersList = Array.from(room.members.values()).map(m => ({
      rollNumber: m.rollNumber,
      name: m.name,
      isCaptain: m.isCaptain,
      isReady: m.isReady,
      isExcused: m.isExcused,
      connected: m.connected,
      individualScore: m.individualScore,
      completedQuestions: m.completedQuestions,
      isClubMember: m.isClubMember ?? false,
      activeSessionId: m.activeSessionId
    }));

    const activeMembers = membersList.filter(m => !m.isExcused);
    const allReady =
      room.members.size === room.targetSize &&
      activeMembers.length > 0 &&
      activeMembers.every(m => m.isReady);

    const windowConfig = windowManager.getConfig();

    return {
      teamCode: room.teamCode,
      teamName: room.teamName,
      targetSize: room.targetSize,
      status: room.status,
      isPaused: room.isPaused,
      startedAt: room.startedAt,
      operatorMode: room.operatorMode || 'add',
      isDisqualified: room.isDisqualified,
      disqualificationReason: room.disqualificationReason,
      members: membersList,
      allReady,
      contestWindow: {
        isOpen: windowManager.isOpen(),
        closesAt: windowConfig.closesAt
      }
    };
  }

  /**
   * Returns sanitized snapshots for all active rooms.
   */
  public getAllRooms(): TeamSnapshotEvent[] {
    return Array.from(this.rooms.values()).map(r => this.getSnapshot(r));
  }

  /**
   * Returns all active internal TeamRoom entity references.
   */
  public getRoomEntities(): TeamRoom[] {
    return Array.from(this.rooms.values());
  }

  /**
   * Returns all active internal SprintSession entity references.
   */
  public getSessionEntities(): SprintSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Returns room by team code.
   */
  public getRoom(teamCode: string): TeamRoom | undefined {
    return this.rooms.get(teamCode.trim().toUpperCase());
  }

  /**
   * Returns session by session ID.
   */
  public getSession(sessionId: string): SprintSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Returns all audit log entries.
   */
  public getAuditLogs(): AuditRecord[] {
    return [...this.auditLogs];
  }

  /**
   * Computes telemetry snapshot for the admin control panel.
   */
  public getTelemetry(): AdminTelemetryEvent {
    let activeSprinters = 0;
    let completedSprinters = 0;

    for (const session of this.sessions.values()) {
      if (session.isFinished) {
        completedSprinters++;
      } else {
        activeSprinters++;
      }
    }

    const now = Date.now();
    if (now - this.lastRssAt > 250 || this.cachedRssMb === 0) {
      this.cachedRssMb = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1));
      this.lastRssAt = now;
    }

    return {
      activeRooms: this.rooms.size,
      activeSprinters,
      completedSprinters,
      windowOpen: windowManager.isOpen(),
      serverCpuPercent: 0,
      rssMemoryMb: this.cachedRssMb
    };
  }

  /**
   * Generates simulated demo teams with realistic scores to verify projector
   * animations and leaderboard rank swaps prior to hackathon launch.
   */
  public simulateTeams(count = 5): string[] {
    const demoPresets = [
      { name: 'Cyber Phantoms', code: 'SIM-01', scores: [2840, 2690, 2720], time: 74.2 },
      { name: 'Binary Blitz', code: 'SIM-02', scores: [2510, 2480, 2550], time: 82.5 },
      { name: 'Quantum Vectors', code: 'SIM-03', scores: [2380, 2290, 2340], time: 89.1 },
      { name: 'Logic Overlords', code: 'SIM-04', scores: [2190, 2080, 2120], time: 94.6 },
      { name: 'Hexadecimal Hounds', code: 'SIM-05', scores: [1950, 1890, 1920], time: 101.4 },
      { name: 'Null Pointers', code: 'SIM-06', scores: [1780, 1720, 1750], time: 108.0 },
      { name: 'Kernel Panic', code: 'SIM-07', scores: [1590, 1620, 1550], time: 112.3 }
    ];

    const actualCount = Math.min(count, demoPresets.length);
    const generatedCodes: string[] = [];

    for (let i = 0; i < actualCount; i++) {
      const preset = demoPresets[i];
      // Clean up previous if existed
      const existingRoom = this.rooms.get(preset.code);
      if (existingRoom) {
        for (const prevRoll of existingRoom.members.keys()) {
          this.rollToTeamMap.delete(prevRoll);
        }
      }
      this.rooms.delete(preset.code);
      leaderboardManager.removeTeam(preset.code, false);

      const members = new Map<string, TeamMember>();
      const memberNames = ['Dev', 'Alex', 'Sam'];
      preset.scores.forEach((score, mIdx) => {
        const roll = `SIM_${preset.code.replace('-', '_')}_${mIdx + 1}`;
        this.rollToTeamMap.set(roll, preset.code);
        members.set(roll, {
          rollNumber: roll,
          name: `${memberNames[mIdx]} (${preset.name.split(' ')[0]})`,
          isCaptain: mIdx === 0,
          isReady: true,
          isExcused: false,
          connected: true,
          token: `sim_token_${roll}`,
          individualScore: score,
          completedQuestions: 15,
          lastActiveAt: Date.now()
        });
      });

      const avgScore = Number((preset.scores.reduce((a, b) => a + b, 0) / preset.scores.length).toFixed(2));

      const room: TeamRoom = {
        teamCode: preset.code,
        teamName: preset.name,
        targetSize: 3,
        status: 'FINISHED',
        members,
        isPaused: false,
        createdAt: Date.now() - 120_000,
        startedAt: Date.now() - 120_000,
        completedAt: Date.now() - (120_000 - preset.time * 1000)
      };

      this.rooms.set(preset.code, room);
      generatedCodes.push(preset.code);
      void databaseService.syncTeam(room);

      leaderboardManager.updateTeam({
        teamCode: preset.code,
        teamName: preset.name,
        teamAverageScore: avgScore,
        membersCount: 3,
        activeMembersCount: 3,
        averageTimeSeconds: preset.time,
        memberBreakdown: Array.from(members.values()).map(m => ({
          name: m.name,
          score: m.individualScore,
          completedQuestions: 15,
          isExcused: false
        })),
        status: 'FINISHED'
      }, false);
    }

    leaderboardManager.broadcastLeaderboard();
    void databaseService.syncLeaderboard(leaderboardManager.getLeaderboard());

    this.logAudit({
      id: `aud_sim_${Date.now()}`,
      timestamp: Date.now(),
      action: 'ADMIN_SIMULATE_TEAMS',
      teamCode: 'SYSTEM',
      adminId: 'ORGANIZER',
      details: `Generated ${actualCount} simulated demo teams.`
    });

    sseHub.broadcast('admin', 'admin_telemetry', this.getTelemetry());
    this.notifyStateMutated();
    return generatedCodes;
  }

  /**
   * Clears simulated demo teams from memory and leaderboard.
   */
  public clearSimulatedTeams(): void {
    const simCodes = Array.from(this.rooms.keys()).filter(code => code.startsWith('SIM-'));
    for (const code of simCodes) {
      const room = this.rooms.get(code);
      if (room) {
        for (const roll of room.members.keys()) {
          this.rollToTeamMap.delete(roll);
        }
      }
      this.rooms.delete(code);
      leaderboardManager.removeTeam(code, false);
    }

    void databaseService.deleteTeams(simCodes);
    leaderboardManager.broadcastLeaderboard();
    void databaseService.syncLeaderboard(leaderboardManager.getLeaderboard());

    this.logAudit({
      id: `aud_sim_clear_${Date.now()}`,
      timestamp: Date.now(),
      action: 'ADMIN_CLEAR_SIMULATED_TEAMS',
      teamCode: 'SYSTEM',
      adminId: 'ORGANIZER',
      details: `Cleared ${simCodes.length} simulated demo teams.`
    });

    sseHub.broadcast('admin', 'admin_telemetry', this.getTelemetry());
    this.notifyStateMutated();
  }

  /**
   * Cleans up pending room timers.
   */
  private clearRoomTimers(teamCode: string): void {
    const countdowns = this.countdownTimers.get(teamCode);
    if (countdowns) {
      countdowns.forEach(t => clearTimeout(t));
      this.countdownTimers.delete(teamCode);
    }
    const expiry = this.expiryTimers.get(teamCode);
    if (expiry) {
      clearTimeout(expiry);
      this.expiryTimers.delete(teamCode);
    }
  }

  /**
   * Scans for rooms in AWAITING_READY with all members ready and starts countdown
   * when contest window is opened by administrator.
   */
  public onWindowOpened(): void {
    for (const room of this.rooms.values()) {
      if (room.status === 'AWAITING_READY') {
        const activeMembers = Array.from(room.members.values()).filter(m => !m.isExcused);
        const readyCount = activeMembers.filter(m => m.isReady).length;
        const isFull = room.members.size === room.targetSize;
        const allReady = isFull && activeMembers.length > 0 && readyCount === activeMembers.length;
        if (allReady) {
          this.startCountdown(room);
        }
      }
    }
  }

  /**
   * Exports a serializable snapshot of all active rooms, sprint sessions,
   * roll-number mappings, and audit logs for crash-safe disk persistence.
   */
  public exportStateSnapshot(): PersistedTournamentState {
    const serializedRooms: SerializedTeamRoom[] = Array.from(this.rooms.values()).map(room => ({
      ...room,
      members: Array.from(room.members.entries())
    }));

    return {
      version: 1,
      savedAt: Date.now(),
      roundOperatorMode: this.roundOperatorMode,
      rooms: serializedRooms,
      sessions: Array.from(this.sessions.entries()),
      rollToTeamMap: Array.from(this.rollToTeamMap.entries()),
      auditLogs: [...this.auditLogs]
    };
  }

  /**
   * Restores rooms, sprint sessions, roll-number mappings, audit logs,
   * and leaderboard entries from a persisted snapshot on server boot.
   */
  public restoreStateSnapshot(snapshot: PersistedTournamentState): void {
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.rooms) || !Array.isArray(snapshot.sessions)) return;

    const prevHooks = this.persistenceHooks;
    this.persistenceHooks = [];

    try {
      for (const teamCode of this.rooms.keys()) {
        this.clearRoomTimers(teamCode);
      }
      this.rooms.clear();
      this.sessions.clear();
      this.rollToTeamMap.clear();
      this.lastQuestionTimes.clear();
      leaderboardManager.clear();

      this.roundOperatorMode =
        snapshot.roundOperatorMode === 'add' ||
        snapshot.roundOperatorMode === 'sub' ||
        snapshot.roundOperatorMode === 'mixed'
          ? snapshot.roundOperatorMode
          : null;
      this.auditLogs = Array.isArray(snapshot.auditLogs) ? [...snapshot.auditLogs] : [];
      this.rollToTeamMap = new Map(Array.isArray(snapshot.rollToTeamMap) ? snapshot.rollToTeamMap : []);
      this.sessions = new Map(Array.isArray(snapshot.sessions) ? snapshot.sessions : []);

      const now = Date.now();
      for (const [sessionId, sess] of this.sessions.entries()) {
        const lastSub = sess.submissions.length > 0
          ? sess.submissions[sess.submissions.length - 1]
          : undefined;
        this.lastQuestionTimes.set(sessionId, lastSub ? lastSub.timestamp : sess.startedAt);
      }

      if (Array.isArray(snapshot.rooms)) {
        for (const rawRoom of snapshot.rooms) {
          const membersMap = new Map<string, TeamMember>(
            Array.isArray(rawRoom.members) ? rawRoom.members : []
          );
          const room: TeamRoom = {
            ...rawRoom,
            members: membersMap
          };

          if (room.status === 'COUNTDOWN') {
            room.status = room.members.size >= room.targetSize ? 'AWAITING_READY' : 'LOBBY';
            for (const m of room.members.values()) {
              m.isReady = false;
            }
          }

          this.rooms.set(room.teamCode, room);

          if (room.status === 'IN_SPRINT' && !room.isPaused) {
            let maxRemaining = 0;
            for (const m of room.members.values()) {
              if (m.activeSessionId) {
                const sess = this.sessions.get(m.activeSessionId);
                if (sess && !sess.isFinished) {
                  const rem = sess.expiresAt + 2500 - now;
                  if (rem > maxRemaining) {
                    maxRemaining = rem;
                  }
                }
              }
            }

            if (maxRemaining <= 0) {
              this.handleSprintTimeout(room.teamCode);
            } else {
              const autoClose = setTimeout(() => {
                try {
                  this.handleSprintTimeout(room.teamCode);
                } catch (err: unknown) {
                  console.error(`Error during restored sprint timeout for team ${room.teamCode}:`, err);
                }
              }, maxRemaining);
              autoClose.unref?.();
              this.expiryTimers.set(room.teamCode, autoClose);
            }
          }

          this.syncLeaderboard(room, false);
        }
      }

      leaderboardManager.broadcastLeaderboard();
    } finally {
      this.persistenceHooks = prevHooks;
    }
  }

  /**
   * Serializes a finished or timed-out sprint session to an atomic disk audit log.
   * Ensures zero memory heap exhaustion during multi-round tournaments.
   */
  public persistSessionAudit(session: SprintSession): void {
    try {
      const room = this.rooms.get(session.teamCode);
      const member = room?.members.get(session.rollNumber);
      if (!fs.existsSync(this.auditDir)) {
        fs.mkdirSync(this.auditDir, { recursive: true });
      }

      const lastSub = session.submissions[session.submissions.length - 1];
      const fallbackEnd = Math.min(Date.now(), session.expiresAt || Date.now());
      const completedAt = session.isFinished ? (lastSub?.timestamp || fallbackEnd) : undefined;
      const totalTimeSeconds = Math.round(((completedAt || Date.now()) - session.startedAt) / 1000);

      const replayData: SessionReplayData = {
        sessionId: session.sessionId,
        teamCode: session.teamCode,
        teamName: room?.teamName || session.teamCode,
        rollNumber: session.rollNumber,
        memberName: member?.name || session.rollNumber,
        startedAt: session.startedAt,
        completedAt,
        totalTimeSeconds: Math.max(0, totalTimeSeconds),
        finalScore: session.currentScore,
        consecutiveStreak: session.consecutiveStreak,
        completedQuestions: session.completedQuestions,
        isFinished: session.isFinished,
        operatorMode: session.operatorMode || room?.operatorMode || 'add',
        anomalyCount: session.submissions.filter(s => s.isAnomaly).length,
        submissions: [...session.submissions]
      };

      const targetPath = path.join(this.auditDir, `${session.sessionId}.json`);
      const tmpPath = `${targetPath}.tmp.${randomBytes(4).toString('hex')}`;
      fs.writeFileSync(tmpPath, JSON.stringify(replayData), 'utf-8');
      fs.renameSync(tmpPath, targetPath);
    } catch (err: unknown) {
      console.error(`[RoomManager] Failed to persist session audit for ${session.sessionId}:`, err);
    }
  }

  /**
   * Retrieves complete dispute replay data for a sprint session from memory or disk.
   */
  public getSessionReplay(sessionId: string): SessionReplayData | null {
    if (!sessionId || typeof sessionId !== 'string') return null;
    const cleanId = path.basename(sessionId.trim());

    // 1. Check in-memory active session
    const session = this.sessions.get(cleanId);
    if (session) {
      const room = this.rooms.get(session.teamCode);
      const member = room?.members.get(session.rollNumber);
      const lastSub = session.submissions[session.submissions.length - 1];
      const fallbackEnd = Math.min(Date.now(), session.expiresAt || Date.now());
      const completedAt = session.isFinished ? (lastSub?.timestamp || fallbackEnd) : undefined;
      const totalTimeSeconds = Math.round(((completedAt || Date.now()) - session.startedAt) / 1000);

      return {
        sessionId: session.sessionId,
        teamCode: session.teamCode,
        teamName: room?.teamName || session.teamCode,
        rollNumber: session.rollNumber,
        memberName: member?.name || session.rollNumber,
        startedAt: session.startedAt,
        completedAt,
        totalTimeSeconds: Math.max(0, totalTimeSeconds),
        finalScore: session.currentScore,
        consecutiveStreak: session.consecutiveStreak,
        completedQuestions: session.completedQuestions,
        isFinished: session.isFinished,
        operatorMode: session.operatorMode || room?.operatorMode || 'add',
        anomalyCount: session.submissions.filter(s => s.isAnomaly).length,
        submissions: [...session.submissions]
      };
    }

    // 2. Check disk-persisted audit
    try {
      const targetPath = path.join(this.auditDir, `${cleanId}.json`);
      if (fs.existsSync(targetPath)) {
        const raw = fs.readFileSync(targetPath, 'utf-8');
        return JSON.parse(raw) as SessionReplayData;
      }
    } catch (err: unknown) {
      console.warn(`[RoomManager] Failed to read session audit file for ${cleanId}:`, err);
    }

    return null;
  }

  /**
   * Lists all available session replays from both memory and disk archives.
   */
  public listSessionReplays(): SessionReplaySummary[] {
    const replayMap = new Map<string, SessionReplaySummary>();

    // In-memory sessions
    for (const s of this.sessions.values()) {
      const room = this.rooms.get(s.teamCode);
      const member = room?.members.get(s.rollNumber);
      replayMap.set(s.sessionId, {
        sessionId: s.sessionId,
        teamCode: s.teamCode,
        rollNumber: s.rollNumber,
        memberName: member?.name || s.rollNumber,
        completedQuestions: s.completedQuestions,
        finalScore: s.currentScore,
        anomalyCount: s.submissions.filter(sub => sub.isAnomaly).length,
        startedAt: s.startedAt,
        isFinished: s.isFinished
      });
    }

    // Disk archive
    try {
      if (fs.existsSync(this.auditDir)) {
        const files = fs.readdirSync(this.auditDir).filter(f => f.endsWith('.json'));
        for (const f of files) {
          const sessionId = f.slice(0, -5);
          if (!replayMap.has(sessionId)) {
            try {
              const raw = fs.readFileSync(path.join(this.auditDir, f), 'utf-8');
              const data = JSON.parse(raw) as SessionReplayData;
              replayMap.set(sessionId, {
                sessionId: data.sessionId,
                teamCode: data.teamCode,
                rollNumber: data.rollNumber,
                memberName: data.memberName,
                completedQuestions: data.completedQuestions,
                finalScore: data.finalScore,
                anomalyCount: data.anomalyCount,
                startedAt: data.startedAt,
                isFinished: data.isFinished
              });
            } catch {
              // Ignore corrupt or unreadable audit files
            }
          }
        }
      }
    } catch (err: unknown) {
      console.warn('[RoomManager] Failed to read audit logs directory:', err);
    }

    return Array.from(replayMap.values()).sort((a, b) => b.startedAt - a.startedAt);
  }

  /**
   * Returns counts of active rooms grouped by lifecycle status.
   */
  public getRoomsCountByStatus(): Record<RoomStatus, number> {
    const counts: Record<RoomStatus, number> = {
      LOBBY: 0,
      AWAITING_READY: 0,
      COUNTDOWN: 0,
      IN_SPRINT: 0,
      PAUSED: 0,
      FINISHED: 0
    };
    for (const room of this.rooms.values()) {
      const status: RoomStatus = room.isPaused ? 'PAUSED' : room.status;
      if (counts[status] !== undefined) {
        counts[status]++;
      }
    }
    return counts;
  }

  /**
   * Clears all room state (useful for test resets).
   */
  public clear(): void {
    if (this.telemetryTimer) {
      clearTimeout(this.telemetryTimer);
      this.telemetryTimer = null;
    }
    for (const teamCode of this.rooms.keys()) {
      this.clearRoomTimers(teamCode);
      sseHub.clearChannelBuffer(`team:${teamCode}`);
    }
    this.rooms.clear();
    this.sessions.clear();
    this.rollToTeamMap.clear();
    this.roomUsedPairKeys.clear();
    this.auditLogs = [];
    this.lastQuestionTimes.clear();
    this.roundOperatorMode = null;
    leaderboardManager.clear();
    this.notifyStateMutated();
  }
}

// Singleton Room Manager
export const roomManager = new RoomManager();
windowManager.onOpen(() => roomManager.onWindowOpened());
