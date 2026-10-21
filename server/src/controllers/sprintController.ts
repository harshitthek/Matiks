/**
 * MATIKS HACKATHON ENGINE — SPRINT REST CONTROLLER (sprintController.ts)
 * 
 * Handles answer submissions during the 2-minute sprint and client clock synchronization.
 */

import type { Request, Response } from 'express';
import { roomManager, OutOfSyncError } from '../services/roomManager.js';
import { windowManager } from '../services/windowManager.js';

function parseSubmittedAnswer(val: unknown): number | null {
  if (typeof val === 'number' && Number.isInteger(val)) {
    return val;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (/^-?\d+$/.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isSafeInteger(parsed)) return parsed;
    }
  }
  return null;
}

export function submitAnswerHandler(req: Request, res: Response): void {
  try {
    const { sessionId, questionIndex, clientDeltaMs, clientTimestamp } = req.body;
    const rawAnswer = req.body.submittedAnswer ?? req.body.answer;
    const submittedAnswer = parseSubmittedAnswer(rawAnswer);

    if (
      typeof sessionId !== 'string' ||
      typeof questionIndex !== 'number' ||
      submittedAnswer === null ||
      typeof clientDeltaMs !== 'number'
    ) {
      res.status(400).json({ error: 'Missing or invalid submission parameters', errorCode: 'INVALID_PARAMETERS' });
      return;
    }

    const timestamp = typeof clientTimestamp === 'number' ? clientTimestamp : Date.now();
    const memberToken = (req.headers['x-member-token'] as string) || (req.body.memberToken as string);

    const result = roomManager.submitAnswer(
      sessionId,
      questionIndex,
      submittedAnswer,
      clientDeltaMs,
      timestamp,
      memberToken
    );

    res.status(200).json({
      success: true,
      ...result
    });
  } catch (err: unknown) {
    if (err instanceof OutOfSyncError) {
      // The player is ahead of where the server has them: say where the server is, so the client can step back to that question
      res.status(409).json({
        error: err.message,
        errorCode: 'OUT_OF_SYNC',
        expectedIndex: err.expectedIndex,
        isFinished: false
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Submission failed';
    const isFinished = /already finished|deadline expired|already completed/i.test(message);
    const errorCode = isFinished ? 'SPRINT_FINISHED' : 'SUBMISSION_ERROR';
    res.status(400).json({ error: message, errorCode, isFinished });
  }
}

export function syncClientClockHandler(req: Request, res: Response): void {
  res.status(200).json({
    serverTime: Date.now(),
    windowOpen: windowManager.isOpen()
  });
}
