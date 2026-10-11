/**
 * MATIKS HACKATHON ENGINE — SCORING & LATENCY ENGINE (scoringEngine.ts)
 * 
 * Implements difficulty-calibrated speed scoring with cognitive latency targets,
 * consecutive streak multipliers, and tactical callouts.
 */

import type { Question, EvaluationResult } from '../types/math.js';

export function getStreakMultiplier(streakCount: number): number {
  if (streakCount >= 10) return 1.5;
  if (streakCount >= 5) return 1.25;
  if (streakCount >= 3) return 1.1;
  return 1.0;
}

export function computeSpeedBonus(latencyMs: number, targetLatencyMs: number): number {
  if (!Number.isFinite(latencyMs) || !Number.isFinite(targetLatencyMs)) return 0;
  if (latencyMs <= 0 || targetLatencyMs <= 0) return 0;
  if (latencyMs >= targetLatencyMs) return 0;
  
  // Linear decay from 100 to 0
  const ratio = 1 - (latencyMs / targetLatencyMs);
  return Math.max(0, Math.floor(100 * ratio));
}

function getSpeedCallout(latencyMs: number, targetLatencyMs: number, isCorrect: boolean): string {
  if (!isCorrect) return 'MISS! -20 PTS';
  if (latencyMs < 1200) return 'GODSPEED // SUB-1.2s ⚡';
  if (latencyMs < 2200) return 'LIGHTNING FAST 🚀';
  if (latencyMs <= targetLatencyMs) return 'TARGET HIT 🎯';
  return 'STEADY SOLVE ⏱️';
}

/**
 * Evaluates an individual answer submission against a question.
 */
export function evaluateSubmission(
  question: Question,
  submittedAnswer: number,
  latencyMs: number,
  currentStreak: number
): EvaluationResult {
  const isCorrect = question.answer === submittedAnswer;

  const isAnomaly = !Number.isFinite(latencyMs) || latencyMs < 200;
  const anomalyReason = !Number.isFinite(latencyMs)
    ? 'INVALID_LATENCY_ANOMALY'
    : latencyMs < 200
    ? 'SUB_200MS_SPEED_ANOMALY'
    : undefined;

  if (!isCorrect) {
    return {
      isCorrect: false,
      submittedAnswer,
      actualAnswer: question.answer,
      latencyMs,
      basePoints: 0,
      speedBonus: 0,
      streakMultiplier: 1.0,
      pointsAwarded: -20,
      newStreak: 0,
      speedCallout: getSpeedCallout(latencyMs, question.targetLatencyMs, false),
      isAnomaly,
      anomalyReason
    };
  }

  const basePoints = 100;
  const speedBonus = computeSpeedBonus(latencyMs, question.targetLatencyMs);
  const newStreak = currentStreak + 1;
  const streakMultiplier = getStreakMultiplier(newStreak);
  
  const rawPoints = (basePoints + speedBonus) * streakMultiplier;
  const pointsAwarded = Math.floor(rawPoints);

  return {
    isCorrect: true,
    submittedAnswer,
    actualAnswer: question.answer,
    latencyMs,
    basePoints,
    speedBonus,
    streakMultiplier,
    pointsAwarded,
    newStreak,
    speedCallout: getSpeedCallout(latencyMs, question.targetLatencyMs, true),
    isAnomaly,
    anomalyReason
  };
}

export const scoringEngine = {
  evaluateSubmission,
  computeSpeedBonus,
  getStreakMultiplier
};
