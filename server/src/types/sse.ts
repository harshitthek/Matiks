/**
 * MATIKS HACKATHON ENGINE — REALTIME SSE & STATE MACHINE CONTRACTS (sse.ts)
 * 
 * Formal definitions for room lifecycles, member sync, team average scoring,
 * anti-cheat audit logs, and Server-Sent Event payloads.
 */

import type { Question, QuestionSanitized, OperatorMode, MathBucket, CarryType } from './math.js';

export type RoomStatus =
  | 'LOBBY'
  | 'AWAITING_READY'
  | 'COUNTDOWN'
  | 'IN_SPRINT'
  | 'PAUSED'
  | 'FINISHED';

export interface TeamMember {
  rollNumber: string;
  name: string;
  isCaptain: boolean;
  isReady: boolean;
  isExcused: boolean;
  connected: boolean;
  activeSessionId?: string;
  individualScore: number;
  completedQuestions: number;
  lastActiveAt: number;
  token?: string;
  isClubMember?: boolean;
}

export interface TeamRoom {
  teamCode: string;
  teamName: string;
  targetSize: number;
  members: Map<string, TeamMember>;
  status: RoomStatus;
  isPaused: boolean;
  pausedAt?: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  masterPaperId?: string;
  operatorMode?: OperatorMode;
  isDisqualified?: boolean;
  disqualificationReason?: string;
  scoreAdjustment?: number;
}

export interface SubmissionRecord {
  questionIndex: number;
  submittedAnswer: number;
  actualAnswer?: number;
  a?: number;
  b?: number;
  operator?: '+' | '-';
  bucket?: MathBucket;
  carryType?: CarryType;
  targetLatencyMs?: number;
  isCorrect: boolean;
  latencyMs: number;
  serverDeltaMs?: number;
  packetJitterMs?: number;
  pointsAwarded: number;
  streakAfter?: number;
  scoreAfter?: number;
  timestamp: number;
  isAnomaly: boolean;
  anomalyReason?: string;
}

export interface SessionReplayData {
  sessionId: string;
  teamCode: string;
  teamName: string;
  rollNumber: string;
  memberName: string;
  startedAt: number;
  completedAt?: number;
  totalTimeSeconds: number;
  finalScore: number;
  consecutiveStreak: number;
  completedQuestions: number;
  isFinished: boolean;
  operatorMode?: OperatorMode;
  anomalyCount: number;
  submissions: SubmissionRecord[];
}

export interface SessionReplaySummary {
  sessionId: string;
  teamCode: string;
  rollNumber: string;
  memberName: string;
  completedQuestions: number;
  finalScore: number;
  anomalyCount: number;
  startedAt: number;
  isFinished: boolean;
}

export interface SprintSession {
  sessionId: string;
  teamCode: string;
  rollNumber: string;
  memberToken?: string;
  startedAt: number;
  expiresAt: number; // startedAt + 120,000ms
  questions: Question[];
  submissions: SubmissionRecord[];
  currentScore: number;
  consecutiveStreak: number;
  completedQuestions: number;
  isFinished: boolean;
  operatorMode?: OperatorMode;
}

export interface MemberLeaderboardSummary {
  rollNumber?: string;
  name: string;
  score: number;
  completedQuestions: number;
  isExcused: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  teamCode: string;
  teamName: string;
  teamAverageScore: number;
  membersCount: number;
  activeMembersCount: number;
  averageTimeSeconds: number;
  memberBreakdown: MemberLeaderboardSummary[];
  status: 'WAITING' | 'IN_SPRINT' | 'FINISHED';
  isDisqualified?: boolean;
  disqualificationReason?: string;
}

export interface ContestWindowConfig {
  isOpen: boolean;
  opensAt: number;
  closesAt: number;
  durationMinutes: number;
  announcementTicker?: string;
  operatorMode?: OperatorMode;
}

export type AuditAction =
  | 'EXCUSE_MEMBER'
  | 'ROOM_PAUSE'
  | 'ROOM_RESUME'
  | 'EMERGENCY_PAUSE_ALL'
  | 'EMERGENCY_RESUME_ALL'
  | 'KICK_MEMBER'
  | 'DISSOLVE_ROOM'
  | 'DISQUALIFY_TEAM'
  | 'REINSTATE_TEAM'
  | 'ADJUST_SCORE'
  | 'ROUND_MODE_CHANGE'
  | 'FLASH_ANNOUNCEMENT'
  | 'WINDOW_TOGGLE'
  | 'REATTEMPT_GRANTED'
  | 'ADMIN_SIMULATE_TEAMS'
  | 'ADMIN_CLEAR_SIMULATED_TEAMS';

export interface AuditRecord {
  id: string;
  timestamp: number;
  action: AuditAction;
  teamCode?: string;
  rollNumber?: string;
  adminId: string;
  reason?: string;
  details?: string | Record<string, unknown>;
}

// -------------------------------------------------------------------------
// SSE Event Payloads (Matching SSE_PROTOCOL.md)
// -------------------------------------------------------------------------

export interface TeamSnapshotEvent {
  teamCode: string;
  teamName: string;
  targetSize: number;
  status: RoomStatus;
  isPaused?: boolean;
  startedAt?: number;
  operatorMode?: OperatorMode;
  isDisqualified?: boolean;
  disqualificationReason?: string;
  members: {
    rollNumber: string;
    name: string;
    isCaptain: boolean;
    isReady: boolean;
    isExcused: boolean;
    connected: boolean;
    individualScore: number;
    completedQuestions: number;
    isClubMember?: boolean;
    activeSessionId?: string;
  }[];
  allReady: boolean;
  contestWindow: {
    isOpen: boolean;
    closesAt: number;
  };
}

export interface MemberReadyChangedEvent {
  rollNumber: string;
  isReady: boolean;
  readyCount: number;
  targetSize: number;
  allReady: boolean;
}

export interface CountdownTickEvent {
  secondsRemaining: number;
  message: string;
}

export interface SprintStartEvent {
  startedAt: number;
  durationSeconds: number;
  totalQuestions: number;
  operatorMode?: OperatorMode;
  sessions: Record<string, string>; // rollNumber -> sessionId
  questionsByRollNumber: Record<string, QuestionSanitized[]>;
}

export interface TeammateProgressEvent {
  rollNumber: string;
  name: string;
  questionIndex: number;
  currentScore: number;
  streak: number;
}

export interface WindowStatusEvent {
  isOpen: boolean;
  opensAt: number;
  closesAt: number;
  serverTime: number;
  announcementTicker?: string;
}

export interface AdminTelemetryEvent {
  activeRooms: number;
  activeSprinters: number;
  completedSprinters: number;
  windowOpen: boolean;
  serverCpuPercent: number;
  rssMemoryMb: number;
}

export interface AnomalyFlagEvent {
  timestamp: number;
  teamCode: string;
  rollNumber: string;
  name: string;
  sessionId: string;
  questionIndex: number;
  clientDeltaMs: number;
  flagReason: string;
}
