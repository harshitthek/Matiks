/**
 * MATIKS HACKATHON ENGINE — TEAM REST CONTROLLER (teamController.ts)
 * 
 * Handles team creation, student roster joins, atomic ready toggles, and room snapshots.
 */

import type { Request, Response } from 'express';
import type { OperatorMode } from '../types/math.js';
import { roomManager } from '../services/roomManager.js';
import { verifyAnySession } from '../services/auth/authProviderFactory.js';

function isValidStringField(val: unknown, maxLength = 64): val is string {
  return typeof val === 'string' && val.trim().length > 0 && val.trim().length <= maxLength;
}

function extractSessionToken(req: Request): string | undefined {
  const customHeader = req.headers['x-session-token'];
  if (typeof customHeader === 'string' && customHeader.trim()) {
    return customHeader.trim();
  }
  const bodyToken = req.body?.sessionToken;
  if (typeof bodyToken === 'string' && bodyToken.trim()) {
    return bodyToken.trim();
  }
  const authHeader = req.headers['authorization'];
  if (authHeader && typeof authHeader === 'string') {
    return authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
  }
  return undefined;
}

async function resolveOptionalSession(req: Request) {
  const sessionToken = extractSessionToken(req);
  if (!sessionToken) return null;
  try {
    return await verifyAnySession(sessionToken);
  } catch {
    return null;
  }
}

export async function createTeamHandler(req: Request, res: Response): Promise<void> {
  try {
    const { teamName, targetSize } = req.body;
    const captainRoll = req.body.captainRoll ?? req.body.rollNumber;
    const captainName = req.body.captainName ?? req.body.name;

    if (!isValidStringField(teamName) || !isValidStringField(captainRoll) || !isValidStringField(captainName)) {
      res.status(400).json({ error: 'teamName, captainRoll, and captainName must be non-empty strings up to 64 characters.' });
      return;
    }

    const cleanCaptainRoll = captainRoll.trim().toUpperCase();
    const sessionUser = await resolveOptionalSession(req);
    const isClubMember = (
      sessionUser &&
      sessionUser.role === 'participant' &&
      sessionUser.rollNumber === cleanCaptainRoll
    )
      ? sessionUser.isClubMember
      : undefined;

    const rawMode = req.body.operatorMode;
    const operatorMode: OperatorMode | undefined =
      rawMode === 'add' || rawMode === 'sub' || rawMode === 'mixed' ? rawMode : undefined;

    const size = typeof targetSize === 'number' ? targetSize : 3;
    const { room, teamCode, memberToken } = roomManager.createTeam(
      teamName,
      size,
      cleanCaptainRoll,
      captainName,
      isClubMember,
      operatorMode
    );

    res.status(201).json({
      success: true,
      teamCode,
      memberToken,
      snapshot: roomManager.getSnapshot(room)
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create team';
    res.status(400).json({ error: message });
  }
}

export async function joinTeamHandler(req: Request, res: Response): Promise<void> {
  try {
    const { teamCode, rollNumber, name } = req.body;

    if (!isValidStringField(teamCode) || !isValidStringField(rollNumber) || !isValidStringField(name)) {
      res.status(400).json({ error: 'teamCode, rollNumber, and name must be non-empty strings up to 64 characters.' });
      return;
    }

    const cleanRoll = rollNumber.trim().toUpperCase();
    const sessionUser = await resolveOptionalSession(req);
    const isClubMember = (
      sessionUser &&
      sessionUser.role === 'participant' &&
      sessionUser.rollNumber === cleanRoll
    )
      ? sessionUser.isClubMember
      : undefined;

    const token = (req.headers['x-member-token'] as string) || (req.body.token as string) || (req.body.memberToken as string);
    const { room, member, memberToken } = roomManager.joinTeam(
      teamCode,
      cleanRoll,
      name,
      token,
      isClubMember
    );

    res.status(200).json({
      success: true,
      member,
      memberToken,
      snapshot: roomManager.getSnapshot(room)
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to join team';
    res.status(400).json({ error: message });
  }
}

export function readyToggleHandler(req: Request, res: Response): void {
  try {
    const { teamCode, rollNumber, isReady } = req.body;

    if (!isValidStringField(teamCode) || !isValidStringField(rollNumber) || typeof isReady !== 'boolean') {
      res.status(400).json({ error: 'teamCode and rollNumber must be non-empty strings up to 64 characters, and isReady must be a boolean.' });
      return;
    }

    const token = (req.headers['x-member-token'] as string) || (req.body.token as string) || (req.body.memberToken as string);
    const { room, allReady } = roomManager.toggleReady(teamCode, rollNumber, isReady, token);

    res.status(200).json({
      success: true,
      allReady,
      snapshot: roomManager.getSnapshot(room)
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to toggle ready status';
    res.status(400).json({ error: message });
  }
}

export function getTeamSnapshotHandler(req: Request, res: Response): void {
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

  const memberTokenHeader = req.headers['x-member-token'] as string | undefined;
  const queryToken = req.query['token'] as string | undefined;
  const authHeader = req.headers['authorization'];
  let token = memberTokenHeader || queryToken;
  if (!token && authHeader) {
    token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
  }

  if (!token) {
    res.status(401).json({
      error: 'UNAUTHORIZED_MEMBER_TOKEN',
      message: 'Token is required to access team snapshot.'
    });
    return;
  }

  const connectedMember = Array.from(room.members.values()).find(m => m.token === token);
  if (!connectedMember) {
    res.status(401).json({
      error: 'UNAUTHORIZED_MEMBER_TOKEN',
      message: 'Invalid member token for team room.'
    });
    return;
  }

  res.status(200).json(roomManager.getSnapshot(room));
}

export function leaveTeamHandler(req: Request, res: Response): void {
  try {
    const { teamCode, rollNumber } = req.body;

    if (!isValidStringField(teamCode) || !isValidStringField(rollNumber)) {
      res.status(400).json({ error: 'teamCode and rollNumber must be non-empty strings up to 64 characters.' });
      return;
    }

    const token = (req.headers['x-member-token'] as string) || (req.body.token as string) || (req.body.memberToken as string);
    const { dissolved, room } = roomManager.leaveTeam(teamCode, rollNumber, token);

    res.status(200).json({
      success: true,
      dissolved,
      snapshot: room ? roomManager.getSnapshot(room) : null
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to leave team';
    res.status(400).json({ error: message });
  }
}

export function resetTeamSprintHandler(req: Request, res: Response): void {
  try {
    const { teamCode, rollNumber } = req.body;

    if (!isValidStringField(teamCode) || !isValidStringField(rollNumber)) {
      res.status(400).json({ error: 'teamCode and rollNumber must be non-empty strings up to 64 characters.' });
      return;
    }

    const token = (req.headers['x-member-token'] as string) || (req.body.token as string) || (req.body.memberToken as string);
    const room = roomManager.resetTeamSprint(teamCode, rollNumber, token);

    res.status(200).json({
      success: true,
      snapshot: roomManager.getSnapshot(room)
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to reset squad sprint';
    res.status(400).json({ error: message });
  }
}
