/**
 * MATIKS HACKATHON ENGINE — ROOM STATE MACHINE & SYNCHRONIZER (roomManager.ts)
 * 
 * Orchestrates team room lifecycles, member join gates, atomic READY locks,
 * synchronized 3-2-1 countdowns, parallel sprint session distribution,
 * answer evaluations with timing anti-cheat, and [EXCUSE MEMBER] hardware recovery.
 */

import { randomBytes } from 'node:crypto';
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
  AuditRecord
} from '../types/sse.js';
import type { QuestionSanitized } from '../types/math.js';
import { mathEngine } from './mathEngine.js';
import { scoringEngine } from './scoringEngine.js';
import { sseHub } from './sseHub.js';
import { leaderboardManager } from './leaderboardManager.js';
import { windowManager } from './windowManager.js';

function hashStringToSeed(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export class RoomManager {
  private rooms = new Map<string, TeamRoom>();
  private sessions = new Map<string, SprintSession>();
  private rollToTeamMap = new Map<string, string>(); // rollNumber -> teamCode
  private auditLogs: AuditRecord[] = [];
  private countdownTimers = new Map<string, NodeJS.Timeout[]>();
  private expiryTimers = new Map<string, NodeJS.Timeout>();
  private lastQuestionTimes = new Map<string, number>(); // sessionId -> timestamp

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
    captainName: string
  ): { room: TeamRoom; teamCode: string; memberToken: string } {
    if (!Number.isInteger(targetSize) || targetSize < 2 || targetSize > 4) {
      throw new Error('Target team size must be an integer between 2 and 4 members.');
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
      token: memberToken
    };
    members.set(cleanRoll, captain);

    const room: TeamRoom = {
      teamCode,
      teamName: teamName.trim(),
      targetSize,
      members,
      status: 'LOBBY',
      isPaused: false,
      createdAt: Date.now()
    };

    this.rooms.set(teamCode, room);
    this.rollToTeamMap.set(cleanRoll, teamCode);

    this.syncLeaderboard(room);
    return { room, teamCode, memberToken };
  }

  /**
   * Adds a student member to an existing Team Room.
   */
  public joinTeam(
    teamCode: string,
    rollNumber: string,
    name: string,
    reconnectToken?: string
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
      this.broadcastSnapshot(room);
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
      token: memberToken
    };

    room.members.set(cleanRoll, newMember);
    this.rollToTeamMap.set(cleanRoll, room.teamCode);

    if (room.members.size === room.targetSize) {
      room.status = 'AWAITING_READY';
    }

    this.broadcastSnapshot(room);
    this.syncLeaderboard(room);

    return { room, member: newMember, memberToken };
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

    // 1. Generate master 15-question paper with zero-luck 4-bucket taxonomy
    const masterPaper = mathEngine.generateSprintPaper();
    const masterQuestions = masterPaper.questions;
    room.masterPaperId = masterPaper.paperId;

    const sessionIds: Record<string, string> = {};
    const questionsByRollNumber: Record<string, QuestionSanitized[]> = {};

    // 2. Setup individual sessions with PRNG player-specific shuffles
    for (const member of room.members.values()) {
      if (member.isExcused) continue;

      const playerSeed = `${room.teamCode}:${member.rollNumber}:${startedAt}`;
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
        isFinished: false
      };

      this.sessions.set(sessionId, session);
      this.lastQuestionTimes.set(sessionId, startedAt);
    }

    // 3. Broadcast sprint_start event over team SSE channel (Zero Question Leak)
    const startEvent: SprintStartEvent = {
      startedAt,
      durationSeconds: 120,
      totalQuestions: 15,
      sessions: sessionIds,
      questionsByRollNumber
    };
    sseHub.broadcast(`team:${room.teamCode}`, 'sprint_start', startEvent);

    this.broadcastSnapshot(room);
    this.syncLeaderboard(room);

    // 4. Schedule auto-close timer at 120s + 2.5s network transit grace
    const autoClose = setTimeout(() => {
      try {
        this.handleSprintTimeout(room.teamCode);
      } catch (err: unknown) {
        console.error(`Error during sprint timeout for team ${room.teamCode}:`, err);
      }
    }, 122_500);
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
      isCorrect: evalResult.isCorrect,
      latencyMs: clientDeltaMs,
      pointsAwarded: evalResult.pointsAwarded,
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
      this.checkRoomCompletion(room);
    }

    // Recalculate team average and broadcast to leaderboard
    this.syncLeaderboard(room);

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

    this.clearRoomTimers(room.teamCode);

    this.broadcastSnapshot(room);
    this.syncLeaderboard(room, true);
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
        if (session) session.isFinished = true;
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
    this.auditLogs.push(auditRecord);

    this.broadcastSnapshot(room);
    this.syncLeaderboard(room, true);

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

    this.auditLogs.push({
      id: `aud_pause_${Date.now()}`,
      timestamp: Date.now(),
      action: 'ROOM_PAUSE',
      teamCode: room.teamCode,
      adminId
    });

    sseHub.broadcast(`team:${room.teamCode}`, 'room_paused', { teamCode: room.teamCode, pausedAt: room.pausedAt });
    this.broadcastSnapshot(room);
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
        this.expiryTimers.set(room.teamCode, autoClose);
      }
    }

    this.auditLogs.push({
      id: `aud_resume_${Date.now()}`,
      timestamp: Date.now(),
      action: 'ROOM_RESUME',
      teamCode: room.teamCode,
      adminId
    });

    sseHub.broadcast(`team:${room.teamCode}`, 'room_resumed', { teamCode: room.teamCode, resumedAt: Date.now() });
    this.broadcastSnapshot(room);
  }

  /**
   * Synchronizes team average score and telemetry with the LeaderboardManager.
   */
  private syncLeaderboard(room: TeamRoom, immediate = false): void {
    if (room.status === 'LOBBY') {
      leaderboardManager.removeTeam(room.teamCode, immediate);
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
      averageTimeSeconds,
      memberBreakdown,
      status
    };

    leaderboardManager.updateTeam(entry, immediate);
  }

  /**
   * Broadcasts complete room snapshot to team members and admin over SSE.
   */
  public broadcastSnapshot(room: TeamRoom): void {
    const snapshot = this.getSnapshot(room);
    sseHub.broadcast(`team:${room.teamCode}`, 'team_snapshot', snapshot);
    sseHub.broadcast('admin', 'room_snapshot', snapshot);
    sseHub.broadcast('admin', 'admin_telemetry', this.getTelemetry());
  }

  /**
   * Prepares a sanitized TeamSnapshotEvent for a given room.
   */
  public getSnapshot(room: TeamRoom): TeamSnapshotEvent {
    const membersList = Array.from(room.members.values()).map(m => ({
      rollNumber: m.rollNumber,
      name: m.name,
      isCaptain: m.isCaptain,
      isReady: m.isReady,
      isExcused: m.isExcused,
      connected: m.connected,
      individualScore: m.individualScore,
      completedQuestions: m.completedQuestions
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

    const memoryUsage = process.memoryUsage();

    return {
      activeRooms: this.rooms.size,
      activeSprinters,
      completedSprinters,
      windowOpen: windowManager.isOpen(),
      serverCpuPercent: 0,
      rssMemoryMb: Number((memoryUsage.rss / (1024 * 1024)).toFixed(1))
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

    this.auditLogs.push({
      id: `aud_sim_${Date.now()}`,
      timestamp: Date.now(),
      action: 'ADMIN_SIMULATE_TEAMS',
      teamCode: 'SYSTEM',
      adminId: 'ORGANIZER',
      details: `Generated ${actualCount} simulated demo teams.`
    });

    sseHub.broadcast('admin', 'admin_telemetry', this.getTelemetry());
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

    leaderboardManager.broadcastLeaderboard();

    this.auditLogs.push({
      id: `aud_sim_clear_${Date.now()}`,
      timestamp: Date.now(),
      action: 'ADMIN_CLEAR_SIMULATED_TEAMS',
      teamCode: 'SYSTEM',
      adminId: 'ORGANIZER',
      details: `Cleared ${simCodes.length} simulated demo teams.`
    });

    sseHub.broadcast('admin', 'admin_telemetry', this.getTelemetry());
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
   * Clears all room state (useful for test resets).
   */
  public clear(): void {
    for (const teamCode of this.rooms.keys()) {
      this.clearRoomTimers(teamCode);
    }
    this.rooms.clear();
    this.sessions.clear();
    this.rollToTeamMap.clear();
    this.auditLogs = [];
    this.lastQuestionTimes.clear();
    leaderboardManager.clear();
  }
}

// Singleton Room Manager
export const roomManager = new RoomManager();
windowManager.onOpen(() => roomManager.onWindowOpened());
