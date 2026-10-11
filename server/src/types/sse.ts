/**
 * MATIKS HACKATHON ENGINE — REALTIME SSE & STATE MACHINE CONTRACTS (sse.ts)
 * 
 * Formal definitions for room lifecycles, member sync, team average scoring,
 * anti-cheat audit logs, and Server-Sent Event payloads.
 */

import type { Question, QuestionSanitized } from './math.js';

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
}

export interface SubmissionRecord {
  questionIndex: number;
  submittedAnswer: number;
  isCorrect: boolean;
  latencyMs: number;
  pointsAwarded: number;
  timestamp: number;
  isAnomaly: boolean;
  anomalyReason?: string;
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
}

export interface ContestWindowConfig {
  isOpen: boolean;
  opensAt: number;
  closesAt: number;
  durationMinutes: number;
  announcementTicker?: string;
}

export type AuditAction =
  | 'EXCUSE_MEMBER'
  | 'ROOM_PAUSE'
  | 'ROOM_RESUME'
  | 'WINDOW_TOGGLE'
  | 'REATTEMPT_GRANTED';

export interface AuditRecord {
  id: string;
  timestamp: number;
  action: AuditAction;
  teamCode?: string;
  rollNumber?: string;
  adminId: string;
  reason?: string;
  details?: Record<string, unknown>;
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
  members: {
    rollNumber: string;
    name: string;
    isCaptain: boolean;
    isReady: boolean;
    isExcused: boolean;
    connected: boolean;
    individualScore: number;
    completedQuestions: number;
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
