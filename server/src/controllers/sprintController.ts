/**
 * MATIKS HACKATHON ENGINE — SPRINT REST CONTROLLER (sprintController.ts)
 * 
 * Handles answer submissions during the 2-minute sprint and client clock synchronization.
 */

import type { Request, Response } from 'express';
import { roomManager } from '../services/roomManager.js';
import { windowManager } from '../services/windowManager.js';

export function submitAnswerHandler(req: Request, res: Response): void {
  try {
    const { sessionId, questionIndex, submittedAnswer, clientDeltaMs, clientTimestamp } = req.body;

    if (
      typeof sessionId !== 'string' ||
      typeof questionIndex !== 'number' ||
      typeof submittedAnswer !== 'number' ||
      typeof clientDeltaMs !== 'number'
    ) {
      res.status(400).json({ error: 'Missing or invalid submission parameters' });
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
    const message = err instanceof Error ? err.message : 'Submission failed';
    res.status(400).json({ error: message });
  }
}

export function syncClientClockHandler(req: Request, res: Response): void {
  res.status(200).json({
    serverTime: Date.now(),
    windowOpen: windowManager.isOpen()
  });
}
