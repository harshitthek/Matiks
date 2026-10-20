/**
 * MATIKS HACKATHON ENGINE — ADMIN REST CONTROLLER (adminController.ts)
 * 
 * Provides organizer controls for contest window toggling, hardware failure recovery
 * ([EXCUSE MEMBER]), team pause/resume, audit logs, and real-time telemetry.
 */

import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { roomManager } from '../services/roomManager.js';
import { windowManager } from '../services/windowManager.js';
import { leaderboardManager } from '../services/leaderboardManager.js';
import { adminAuthService } from '../services/adminAuthService.js';
import { sseHub } from '../services/sseHub.js';
import { rosterService } from '../services/rosterService.js';

const adminStreamTickets = new Map<string, number>();

export function issueAdminStreamTicketHandler(req: Request, res: Response): void {
  const now = Date.now();
  for (const [t, exp] of adminStreamTickets) {
    if (now > exp) {
      adminStreamTickets.delete(t);
    }
  }

  const ticket = randomUUID();
  adminStreamTickets.set(ticket, now + 60_000);
  const cleanupTimer = setTimeout(() => {
    adminStreamTickets.delete(ticket);
  }, 60_000);
  cleanupTimer.unref?.();

  res.status(200).json({ success: true, ticket });
}

export function isValidAdminStreamTicket(ticket?: string): boolean {
  if (!ticket || typeof ticket !== 'string') return false;
  const expiresAt = adminStreamTickets.get(ticket);
  if (!expiresAt) return false;
  adminStreamTickets.delete(ticket); // Single-use consumption
  return Date.now() <= expiresAt;
}

export function toggleWindowHandler(req: Request, res: Response): void {
  try {
    const { open, durationMinutes, ticker } = req.body;

    if (typeof open !== 'boolean') {
      res.status(400).json({ error: 'Property "open" must be a boolean (true or false).' });
      return;
    }

    if (open) {
      if (durationMinutes !== undefined && (!Number.isFinite(durationMinutes) || durationMinutes <= 0)) {
        res.status(400).json({ error: 'durationMinutes must be a positive finite number' });
        return;
      }
      const config = windowManager.openWindow(durationMinutes, ticker);
      res.status(200).json({ success: true, config });
    } else {
      const config = windowManager.closeWindow();
      res.status(200).json({ success: true, config });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Window toggle failed';
    res.status(400).json({ error: message });
  }
}

export function excuseMemberHandler(req: Request, res: Response): void {
  try {
    const rawCode = req.params['teamCode'];
    const teamCode = Array.isArray(rawCode) ? rawCode[0] : rawCode;
    const { rollNumber, reason } = req.body;

    if (!teamCode || !rollNumber) {
      res.status(400).json({ error: 'teamCode and rollNumber are required' });
      return;
    }

    const adminId = (req.headers['x-admin-id'] as string) || 'admin_organizer';
    const excuseReason = typeof reason === 'string' ? reason : 'Unspecified hardware failure';

    const result = roomManager.excuseMember(teamCode, rollNumber, excuseReason, adminId);
    res.status(200).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to excuse member';
    res.status(400).json({ error: message });
  }
}

export function pauseTeamHandler(req: Request, res: Response): void {
  try {
    const rawCode = req.params['teamCode'];
    const teamCode = Array.isArray(rawCode) ? rawCode[0] : rawCode;
    if (!teamCode) {
      res.status(400).json({ error: 'teamCode is required' });
      return;
    }

    const adminId = (req.headers['x-admin-id'] as string) || 'admin_organizer';
    roomManager.pauseRoom(teamCode, adminId);
    res.status(200).json({ success: true, teamCode, status: 'PAUSED' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to pause team';
    res.status(400).json({ error: message });
  }
}

export function resumeTeamHandler(req: Request, res: Response): void {
  try {
    const rawCode = req.params['teamCode'];
    const teamCode = Array.isArray(rawCode) ? rawCode[0] : rawCode;
    if (!teamCode) {
      res.status(400).json({ error: 'teamCode is required' });
      return;
    }

    const adminId = (req.headers['x-admin-id'] as string) || 'admin_organizer';
    roomManager.resumeRoom(teamCode, adminId);
    res.status(200).json({ success: true, teamCode, status: 'RESUMED' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to resume team';
    res.status(400).json({ error: message });
  }
}

export function getAuditLogsHandler(req: Request, res: Response): void {
  res.status(200).json(roomManager.getAuditLogs());
}

export function getTelemetryHandler(req: Request, res: Response): void {
  res.status(200).json(roomManager.getTelemetry());
}

export function getAllRoomsHandler(req: Request, res: Response): void {
  res.status(200).json({ success: true, rooms: roomManager.getAllRooms() });
}

export function simulateTeamsHandler(req: Request, res: Response): void {
  try {
    const rawCount = req.body?.count;
    const count = typeof rawCount === 'number' && Number.isInteger(rawCount) && rawCount > 0 ? rawCount : 5;
    const generatedCodes = roomManager.simulateTeams(count);
    res.status(200).json({ success: true, count: generatedCodes.length, generatedCodes });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to simulate teams';
    res.status(400).json({ error: message });
  }
}

export function clearSimulatedTeamsHandler(_req: Request, res: Response): void {
  try {
    roomManager.clearSimulatedTeams();
    res.status(200).json({ success: true, message: 'Simulated demo teams cleared.' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to clear simulated teams';
    res.status(400).json({ error: message });
  }
}

export function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const formulaSafe =
    /^[=+\-@\t\r]/.test(raw) && !/^-\d+(\.\d+)?$/.test(raw) ? `'${raw}` : raw;
  if (/[",\r\n]/.test(formulaSafe)) {
    return `"${formulaSafe.replace(/"/g, '""')}"`;
  }
  return formulaSafe;
}

export function exportTournamentCsvHandler(_req: Request, res: Response): void {
  const entries = leaderboardManager.getLeaderboard();
  const headers = [
    'Rank',
    'TeamCode',
    'TeamName',
    'Status',
    'TeamAverageScore',
    'AverageTimeSeconds',
    'ActiveMembersCount',
    'TotalMembersCount',
    'MemberBreakdowns'
  ];

  const rows = entries.map(entry => {
    const breakdownText = entry.memberBreakdown
      .map(
        m =>
          `${m.name} (${m.score} pts, ${m.completedQuestions}/15${m.isExcused ? ', EXCUSED' : ''})`
      )
      .join(' | ');

    return [
      entry.rank,
      entry.teamCode,
      entry.teamName,
      entry.status,
      entry.teamAverageScore,
      entry.averageTimeSeconds,
      entry.activeMembersCount,
      entry.membersCount,
      breakdownText
    ]
      .map(escapeCsvCell)
      .join(',');
  });

  const csvContent = [headers.join(','), ...rows].join('\r\n') + '\r\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="matiks-leaderboard-standings.csv"'
  );
  res.status(200).send(csvContent);
}

export function exportTournamentJsonHandler(_req: Request, res: Response): void {
  const report = {
    exportedAt: new Date().toISOString(),
    exportedTimestamp: Date.now(),
    contestWindow: windowManager.getConfig(),
    telemetry: roomManager.getTelemetry(),
    leaderboard: leaderboardManager.getLeaderboard(),
    rooms: roomManager.getAllRooms(),
    auditLogs: roomManager.getAuditLogs()
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="matiks-tournament-report.json"'
  );
  res.status(200).send(JSON.stringify(report, null, 2));
}

export function setStreamDelayHandler(req: Request, res: Response): void {
  try {
    const { delayMs } = req.body;
    if (
      typeof delayMs !== 'number' ||
      !Number.isFinite(delayMs) ||
      delayMs < 0 ||
      delayMs > 60_000
    ) {
      res.status(400).json({ error: 'delayMs must be a finite number between 0 and 60000' });
      return;
    }

    leaderboardManager.setStreamDelayMs(delayMs);
    res.status(200).json({ success: true, delayMs: leaderboardManager.getStreamDelayMs() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to set stream delay';
    res.status(400).json({ error: message });
  }
}

export function getStreamDelayHandler(_req: Request, res: Response): void {
  res.status(200).json({ delayMs: leaderboardManager.getStreamDelayMs() });
}

export function flushLeaderboardHandler(_req: Request, res: Response): void {
  leaderboardManager.flush();
  res.status(200).json({ success: true, flushedAt: Date.now() });
}

export function getSessionReplayHandler(req: Request, res: Response): void {
  try {
    const rawId = req.params['sessionId'];
    const sessionId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }

    const replay = roomManager.getSessionReplay(sessionId);
    if (!replay) {
      res.status(404).json({ error: `Replay for session ${sessionId} not found.` });
      return;
    }

    res.status(200).json({ success: true, replay });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve session replay';
    res.status(500).json({ error: message });
  }
}

export function listSessionReplaysHandler(_req: Request, res: Response): void {
  try {
    const replays = roomManager.listSessionReplays();
    res.status(200).json({ success: true, replays });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to list session replays';
    res.status(500).json({ error: message });
  }
}

export function exportPlayerAuditsCsvHandler(_req: Request, res: Response): void {
  try {
    const replays = roomManager.listSessionReplays();
    const headers = [
      'SessionId',
      'TeamCode',
      'RollNumber',
      'PlayerName',
      'CompletedQuestions',
      'FinalScore',
      'AnomalyCount',
      'StartedAt',
      'IsFinished'
    ];

    const rows = replays.map((r) => {
      let startedAtFormatted = '';
      if (typeof r.startedAt === 'number' && Number.isFinite(r.startedAt) && r.startedAt > 0) {
        try {
          startedAtFormatted = new Date(r.startedAt).toISOString();
        } catch {
          startedAtFormatted = String(r.startedAt);
        }
      } else if (r.startedAt) {
        startedAtFormatted = String(r.startedAt);
      }

      return [
        r.sessionId,
        r.teamCode,
        r.rollNumber,
        r.memberName,
        r.completedQuestions,
        r.finalScore,
        r.anomalyCount,
        startedAtFormatted,
        r.isFinished ? 'FINISHED' : 'IN_PROGRESS'
      ]
        .map(escapeCsvCell)
        .join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\r\n') + '\r\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="matiks-player-audits.csv"'
    );
    res.status(200).send(csvContent);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to export player audits';
    res.status(500).json({ error: message });
  }
}

export async function adminLoginHandler(req: Request, res: Response): Promise<void> {
  try {
    const { secret, organizerName } = req.body || {};
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

    const result = await adminAuthService.loginOrganizer(secret, organizerName, clientIp);

    if (!result.success) {
      res.status(401).json({
        error: 'INVALID_ADMIN_CREDENTIALS',
        message: 'Invalid administrator secret key.',
        tarpitMs: result.tarpitMs
      });
      return;
    }

    res.status(200).json({
      success: true,
      token: result.token,
      organizerName: result.payload?.organizerName,
      role: result.payload?.role,
      expiresAt: result.payload?.expiresAt
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Admin authentication failed';
    res.status(500).json({ error: message });
  }
}

export function emergencyPauseAllHandler(req: Request, res: Response): void {
  try {
    const adminId = req.adminUser?.organizerName || (req.headers['x-admin-id'] as string) || 'admin_organizer';
    const result = roomManager.emergencyPauseAllSprints(adminId);
    res.status(200).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to pause all sprints';
    res.status(500).json({ error: message });
  }
}

export function emergencyResumeAllHandler(req: Request, res: Response): void {
  try {
    const adminId = req.adminUser?.organizerName || (req.headers['x-admin-id'] as string) || 'admin_organizer';
    const result = roomManager.emergencyResumeAllSprints(adminId);
    res.status(200).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to resume all sprints';
    res.status(500).json({ error: message });
  }
}

export function flashBroadcastHandler(req: Request, res: Response): void {
  try {
    const { message, priority } = req.body || {};
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({ error: 'Announcement message is required.' });
      return;
    }

    const cleanMsg = message.trim().slice(0, 200);
    const cleanPriority = priority === 'emergency' || priority === 'urgent' ? 'emergency' : 'normal';
    sseHub.broadcastFlashAnnouncement(cleanMsg, cleanPriority);

    const adminId = req.adminUser?.organizerName || (req.headers['x-admin-id'] as string) || 'admin_organizer';
    sseHub.broadcastAdminAction({
      action: 'FLASH_ANNOUNCEMENT',
      details: { message: cleanMsg, priority: cleanPriority },
      executedBy: adminId,
      timestamp: Date.now()
    });

    res.status(200).json({
      success: true,
      message: cleanMsg,
      priority: cleanPriority,
      broadcastAt: Date.now()
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to broadcast flash announcement';
    res.status(500).json({ error: message });
  }
}

export function kickMemberHandler(req: Request, res: Response): void {
  try {
    const rawCode = req.params['teamCode'];
    const teamCode = Array.isArray(rawCode) ? rawCode[0] : rawCode;
    const { rollNumber } = req.body || {};

    if (!teamCode || !rollNumber) {
      res.status(400).json({ error: 'teamCode and rollNumber are required' });
      return;
    }

    const adminId = req.adminUser?.organizerName || (req.headers['x-admin-id'] as string) || 'admin_organizer';
    const result = roomManager.kickMemberFromRoom(teamCode, rollNumber, adminId);
    res.status(200).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to kick member';
    res.status(400).json({ error: message });
  }
}

export function dissolveRoomHandler(req: Request, res: Response): void {
  try {
    const rawCode = req.params['teamCode'];
    const teamCode = Array.isArray(rawCode) ? rawCode[0] : rawCode;
    const { reason } = req.body || {};

    if (!teamCode) {
      res.status(400).json({ error: 'teamCode is required' });
      return;
    }

    const adminId = req.adminUser?.organizerName || (req.headers['x-admin-id'] as string) || 'admin_organizer';
    const result = roomManager.dissolveRoom(teamCode, adminId, reason);
    res.status(200).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to dissolve room';
    res.status(400).json({ error: message });
  }
}

export function disqualifyTeamHandler(req: Request, res: Response): void {
  try {
    const rawCode = req.params['teamCode'];
    const teamCode = Array.isArray(rawCode) ? rawCode[0] : rawCode;
    const { reason } = req.body || {};

    if (!teamCode) {
      res.status(400).json({ error: 'teamCode is required' });
      return;
    }

    const adminId = req.adminUser?.organizerName || (req.headers['x-admin-id'] as string) || 'admin_organizer';
    const result = roomManager.disqualifyTeam(teamCode, adminId, reason || 'Disqualified by tournament organizer');
    res.status(200).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to disqualify team';
    res.status(400).json({ error: message });
  }
}

export function reinstateTeamHandler(req: Request, res: Response): void {
  try {
    const rawCode = req.params['teamCode'];
    const teamCode = Array.isArray(rawCode) ? rawCode[0] : rawCode;

    if (!teamCode) {
      res.status(400).json({ error: 'teamCode is required' });
      return;
    }

    const adminId = req.adminUser?.organizerName || (req.headers['x-admin-id'] as string) || 'admin_organizer';
    const result = roomManager.reinstateTeam(teamCode, adminId);
    res.status(200).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to reinstate team';
    res.status(400).json({ error: message });
  }
}

export function adjustScoreHandler(req: Request, res: Response): void {
  try {
    const rawCode = req.params['teamCode'];
    const teamCode = Array.isArray(rawCode) ? rawCode[0] : rawCode;
    const { deltaPoints, reason } = req.body || {};

    if (!teamCode || deltaPoints === undefined) {
      res.status(400).json({ error: 'teamCode and deltaPoints are required' });
      return;
    }

    const delta = Number(deltaPoints);
    if (!Number.isFinite(delta)) {
      res.status(400).json({ error: 'deltaPoints must be a finite number' });
      return;
    }

    const adminId = req.adminUser?.organizerName || (req.headers['x-admin-id'] as string) || 'admin_organizer';
    const result = roomManager.adjustTeamScore(teamCode, delta, reason || 'Administrative score adjustment', adminId);
    res.status(200).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to adjust score';
    res.status(400).json({ error: message });
  }
}

export function getRoundModeHandler(_req: Request, res: Response): void {
  res.status(200).json({
    operatorMode: roomManager.getRoundOperatorMode(),
    overrideMode: roomManager.getRoundOperatorModeOverride()
  });
}

export function setRoundModeHandler(req: Request, res: Response): void {
  try {
    const { operatorMode } = req.body || {};
    const normalized = operatorMode === null || operatorMode === 'none' ? null : operatorMode;
    if (normalized !== null && normalized !== 'add' && normalized !== 'sub' && normalized !== 'mixed') {
      res.status(400).json({ error: 'operatorMode must be "add", "sub", "mixed", or null' });
      return;
    }

    const adminId = req.adminUser?.organizerName || (req.headers['x-admin-id'] as string) || 'admin_organizer';
    const mode = roomManager.setRoundOperatorMode(normalized, adminId);
    res.status(200).json({
      success: true,
      operatorMode: mode ?? 'add',
      overrideMode: mode
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to set round operator mode';
    res.status(400).json({ error: message });
  }
}

export function setEmergencyWalkInHandler(req: Request, res: Response): void {
  try {
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'Property "enabled" must be a boolean (true or false).' });
      return;
    }

    const adminId = req.adminUser?.organizerName || (req.headers['x-admin-id'] as string) || 'admin_organizer';
    const status = windowManager.setEmergencyWalkIn(enabled);

    roomManager.logSystemAudit({
      action: 'EMERGENCY_WALK_IN_TOGGLE',
      teamCode: 'SYSTEM',
      adminId,
      reason: enabled
        ? 'Organizer enabled emergency walk-in entry bypass'
        : 'Organizer disabled emergency walk-in entry bypass (enforcing OIDC)',
      details: { enabled }
    });

    res.status(200).json({
      success: true,
      emergencyWalkIn: status
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update emergency walk-in status';
    res.status(400).json({ error: message });
  }
}

export function uploadRosterCsvHandler(req: Request, res: Response): void {
  try {
    const csvContent = typeof req.body === 'string' ? req.body : req.body?.csv;
    if (!csvContent || typeof csvContent !== 'string') {
      res.status(400).json({ error: 'CSV content is required in request body.' });
      return;
    }

    const result = rosterService.loadRosterFromCsv(csvContent);
    const adminId = req.adminUser?.organizerName || (req.headers['x-admin-id'] as string) || 'admin_organizer';

    roomManager.logSystemAudit({
      action: 'ADMIN_UPLOAD_ROSTER_CSV',
      teamCode: 'SYSTEM',
      adminId,
      reason: `Organizer uploaded event roster CSV with ${result.teamsCount} teams and ${result.membersCount} participants`,
      details: result
    });

    res.status(200).json({
      success: true,
      ...result,
      roster: rosterService.getRoster()
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to parse and load CSV';
    res.status(400).json({ error: message });
  }
}

export function getAdminRosterHandler(_req: Request, res: Response): void {
  const roster = rosterService.getRoster();
  const publicList = rosterService.getPublicRoster();
  res.status(200).json({
    active: rosterService.isRosterActive(),
    totalTeams: roster.length,
    teams: roster,
    publicSummary: publicList
  });
}

export function loadRosterPresetHandler(req: Request, res: Response): void {
  try {
    const { preset } = req.body || {};
    if (preset !== 'competition-roster' && preset !== 'final-selected-teams' && preset !== 'final_selected_teams') {
      res.status(400).json({
        error: 'INVALID_PRESET',
        message: 'Valid presets are "competition-roster" or "final-selected-teams".'
      });
      return;
    }
    const filename = preset === 'competition-roster' ? 'competition-roster.csv' : 'final_selected_teams.csv';
    const candidatePaths = [
      path.join(process.cwd(), 'server', 'data', 'rosters', filename),
      path.join(process.cwd(), 'data', 'rosters', filename),
      path.join(process.cwd(), filename)
    ];

    let foundPath: string | null = null;
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        foundPath = p;
        break;
      }
    }

    if (!foundPath) {
      res.status(404).json({ error: `Preset file ${filename} not found on server.` });
      return;
    }

    const content = fs.readFileSync(foundPath, 'utf8');
    const result = rosterService.loadRosterFromCsv(content);
    const adminId = req.adminUser?.organizerName || (req.headers['x-admin-id'] as string) || 'admin_organizer';

    roomManager.logSystemAudit({
      action: 'ADMIN_LOAD_ROSTER_PRESET',
      teamCode: 'SYSTEM',
      adminId,
      reason: `Organizer loaded preset ${filename} with ${result.teamsCount} teams`,
      details: { preset, path: foundPath, ...result }
    });

    res.status(200).json({
      success: true,
      preset,
      ...result,
      roster: rosterService.getRoster()
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load preset';
    res.status(400).json({ error: message });
  }
}

export function resetRosterMemberHandler(req: Request, res: Response): void {
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: 'Email is required to reset roster member.' });
      return;
    }
    const success = rosterService.resetMember(email);
    if (!success) {
      res.status(404).json({ error: `Member with email "${email}" not found in roster.` });
      return;
    }
    res.status(200).json({ success: true, email });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to reset member';
    res.status(400).json({ error: message });
  }
}

export function clearRosterHandler(req: Request, res: Response): void {
  try {
    rosterService.clearRoster();
    const adminId = req.adminUser?.organizerName || (req.headers['x-admin-id'] as string) || 'admin_organizer';

    roomManager.logSystemAudit({
      action: 'ADMIN_CLEAR_ROSTER',
      teamCode: 'SYSTEM',
      adminId,
      reason: 'Organizer cleared all event teams from roster',
      details: {}
    });

    res.status(200).json({ success: true, message: 'Event roster cleared.' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to clear roster';
    res.status(400).json({ error: message });
  }
}


