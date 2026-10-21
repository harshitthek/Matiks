/**
 * MATIKS HACKATHON ENGINE — SSE STREAMING CONTROLLER (sseController.ts)
 * 
 * Establishes unidirectional HTTP event streams for:
 * 1. Team Lobby & Teammate HUD (/api/sse/team/:teamCode)
 * 2. Auditorium Big-Screen Leaderboard (/api/sse/leaderboard)
 * 3. Organizer Command Center Telemetry (/api/sse/admin)
 */

import type { Request, Response } from 'express';
import { sseHub } from '../services/sseHub.js';
import { roomManager } from '../services/roomManager.js';
import { leaderboardManager } from '../services/leaderboardManager.js';
import { windowManager } from '../services/windowManager.js';
import { mathEngine } from '../services/mathEngine.js';
import { isValidAdminToken } from '../config/env.js';
import { isValidAdminStreamTicket } from './adminController.js';

const memberStreamCounts = new Map<string, number>();

export function clearMemberStreamCounts(): void {
  memberStreamCounts.clear();
}

import type { SseCursor } from '../services/sseHub.js';

export function parseEventCursor(val: unknown): SseCursor | undefined {
  if (val === undefined || val === null) return undefined;
  let str: string;
  if (typeof val === 'string') {
    str = val.trim();
  } else if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'string') {
    str = val[0].trim();
  } else {
    return undefined;
  }
  if (!str) return undefined;

  // Support "<epoch>:<seq>" or plain "<seq>"
  if (str.includes(':')) {
    const parts = str.split(':');
    if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) {
      return undefined;
    }
    const epoch = Number(parts[0]);
    const seq = Number(parts[1]);
    if (!Number.isSafeInteger(epoch) || !Number.isSafeInteger(seq) || seq < 0) {
      return undefined;
    }
    return { epoch, seq };
  }

  // Pure numeric seq
  if (!/^\d+$/.test(str)) return undefined;
  const seq = Number(str);
  return Number.isSafeInteger(seq) && seq >= 0 ? { seq } : undefined;
}

function extractLastEventId(req: Request): SseCursor | undefined {
  const fromHeader = parseEventCursor(req.headers['last-event-id']);
  if (fromHeader !== undefined) {
    return fromHeader;
  }
  return parseEventCursor(req.query['lastEventId']);
}

export function sseTeamHandler(req: Request, res: Response): void {
  const rawCode = req.params['teamCode'];
  const teamCode = (Array.isArray(rawCode) ? rawCode[0] : rawCode || '').trim().toUpperCase();
  if (!teamCode) {
    res.status(400).json({ error: 'teamCode parameter is required' });
    return;
  }

  const room = roomManager.getRoom(teamCode);
  if (!room) {
    res.status(404).json({ error: `Team ${teamCode} not found` });
    return;
  }

  const queryToken = req.query['token'] as string | undefined;
  if (!queryToken) {
    res.status(401).json({
      error: 'UNAUTHORIZED_MEMBER_TOKEN',
      message: 'Token query parameter is required to connect to team stream.'
    });
    return;
  }

  const connectedMember = Array.from(room.members.values()).find(m => m.token === queryToken);
  if (!connectedMember) {
    res.status(401).json({
      error: 'UNAUTHORIZED_MEMBER_TOKEN',
      message: 'Invalid member token for team room.'
    });
    return;
  }

  const channel = `team:${teamCode}`;
  const lastEventId = extractLastEventId(req);
  sseHub.registerClient(channel, res, lastEventId);

  const memberKey = `${teamCode}:${connectedMember.rollNumber}`;
  const prevCount = memberStreamCounts.get(memberKey) || 0;
  memberStreamCounts.set(memberKey, prevCount + 1);
  connectedMember.connected = true;
  connectedMember.lastActiveAt = Date.now();

  res.on('close', () => {
    const current = (memberStreamCounts.get(memberKey) || 1) - 1;
    if (current <= 0) {
      memberStreamCounts.delete(memberKey);
      connectedMember.connected = false;
      connectedMember.lastActiveAt = Date.now();
      roomManager.broadcastSnapshot(room);
    } else {
      memberStreamCounts.set(memberKey, current);
    }
  });

  // If newly connected, broadcast updated presence snapshot
  if (prevCount === 0) {
    roomManager.broadcastSnapshot(room);
  }

  // Ensure expired sprints are finalized before emitting snapshot or sprint_resume
  roomManager.checkAndFinalizeIfExpired(room);

  // Send immediate initial snapshot
  sseHub.sendDirect(res, 'team_snapshot', roomManager.getSnapshot(room));

  // Reconnection support: if room is in sprint and member has an active unfinished session with remaining time
  if (room.status === 'IN_SPRINT' && connectedMember.activeSessionId) {
    const session = roomManager.getSession(connectedMember.activeSessionId);
    const now = Date.now();
    if (session && !session.isFinished && (room.isPaused || now < session.expiresAt)) {
      let maxStreak = 0;
      let runningStreak = 0;
      const clientSubmissions = session.submissions.map((sub) => {
        if (sub.isCorrect) {
          runningStreak += 1;
          if (runningStreak > maxStreak) maxStreak = runningStreak;
        } else {
          runningStreak = 0;
        }
        const q = session.questions[sub.questionIndex];
        return {
          questionIndex: sub.questionIndex,
          a: q?.a,
          b: q?.b,
          operator: q?.operator,
          bucket: q?.bucket,
          answer: sub.submittedAnswer,
          isCorrect: sub.isCorrect,
          pointsAwarded: sub.pointsAwarded,
          latencyMs: sub.latencyMs
        };
      });

      sseHub.sendDirect(res, 'sprint_resume', {
        sessionId: session.sessionId,
        rollNumber: connectedMember.rollNumber,
        questionIndex: session.completedQuestions,
        questions: mathEngine.sanitizeQuestions(session.questions),
        currentScore: session.currentScore,
        streak: session.consecutiveStreak,
        maxStreak,
        submissions: clientSubmissions,
        startedAt: session.startedAt,
        expiresAt: session.expiresAt,
        remainingMs: Math.max(0, session.expiresAt - now),
        isPaused: room.isPaused
      });
    }
  }
}

export function sseLeaderboardHandler(req: Request, res: Response): void {
  const channel = 'leaderboard';
  const lastEventId = extractLastEventId(req);
  sseHub.registerClient(channel, res, lastEventId);

  // Send immediate initial standings (respecting anti-screen-peeking delay) and window status
  sseHub.sendDirect(res, 'leaderboard_update', leaderboardManager.getPublicLeaderboard());

  const windowConfig = windowManager.getConfig();
  sseHub.sendDirect(res, 'window_status', {
    isOpen: windowManager.isOpen(),
    opensAt: windowConfig.opensAt,
    closesAt: windowConfig.closesAt,
    serverTime: Date.now(),
    announcementTicker: windowConfig.announcementTicker
  });
}

export async function sseAdminHandler(req: Request, res: Response): Promise<void> {
  const queryTicket = req.query['ticket'] as string | undefined;
  const authHeader = req.headers['authorization'];
  let providedToken: string | undefined;

  if (authHeader) {
    providedToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
  }

  const isAuthorized = (await isValidAdminStreamTicket(queryTicket)) || isValidAdminToken(providedToken);
  if (!isAuthorized) {
    res.status(401).json({ error: 'UNAUTHORIZED_ADMIN_ACCESS' });
    return;
  }

  const channel = 'admin';
  const lastEventId = extractLastEventId(req);
  sseHub.registerClient(channel, res, lastEventId);

  // Send immediate telemetry, leaderboard, and window status
  sseHub.sendDirect(res, 'admin_telemetry', roomManager.getTelemetry());
  sseHub.sendDirect(res, 'leaderboard_update', leaderboardManager.getLeaderboard());

  const windowConfig = windowManager.getConfig();
  sseHub.sendDirect(res, 'window_status', {
    isOpen: windowManager.isOpen(),
    opensAt: windowConfig.opensAt,
    closesAt: windowConfig.closesAt,
    serverTime: Date.now(),
    announcementTicker: windowConfig.announcementTicker
  });
}
