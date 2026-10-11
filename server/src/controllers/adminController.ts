/**
 * MATIKS HACKATHON ENGINE — ADMIN REST CONTROLLER (adminController.ts)
 * 
 * Provides organizer controls for contest window toggling, hardware failure recovery
 * ([EXCUSE MEMBER]), team pause/resume, audit logs, and real-time telemetry.
 */

import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { roomManager } from '../services/roomManager.js';
import { windowManager } from '../services/windowManager.js';

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
  setTimeout(() => {
    adminStreamTickets.delete(ticket);
  }, 60_000);

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
