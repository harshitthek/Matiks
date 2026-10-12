/**
 * MATIKS HACKATHON ENGINE — MATHEMATICAL ENGINE TYPES
 * Defines the data contracts for the 4-Bucket Carry Taxonomy,
 * question representations, sanitization, and speed scoring.
 */

export type AdditionBucket = 'B1' | 'B2' | 'B3' | 'B4';
export type SubtractionBucket = 'S1' | 'S2';
export type MathBucket = AdditionBucket | SubtractionBucket;
export type CarryBucket = MathBucket; // Backwards-compatible alias

export type CarryType =
  | 'NONE'
  | 'ONES'
  | 'CENTURY'
  | 'DOUBLE'
  | 'BORROW_NONE'
  | 'BORROW_ONES';

export type OperatorMode = 'add' | 'sub' | 'mixed';

export interface Question {
  id: string;
  bucket: MathBucket;
  carryType: CarryType;
  tag: string;
  a: number;
  b: number;
  operator: '+' | '-';
  answer: number;
  targetLatencyMs: number;
}

/**
 * Sanitized Question model sent to the client browser.
 * Withholds the answer key to preserve complete anti-cheat integrity.
 */
export interface QuestionSanitized {
  id: string;
  questionIndex: number;
  bucket: MathBucket;
  carryType: CarryType;
  tag: string;
  a: number;
  b: number;
  operator: '+' | '-';
  targetLatencyMs: number;
}

export interface SprintPaper {
  paperId: string;
  questions: Question[];
  totalSum: number;
  bucketCounts: Record<string, number>;
  generatedAt: number;
  operatorMode?: OperatorMode;
}

export interface LatencyCalibration {
  targetLatencyMs: number;
  maxSpeedBonus: number;
  basePoints: number;
  penaltyPoints: number;
}

export interface EvaluationResult {
  isCorrect: boolean;
  submittedAnswer: number;
  actualAnswer: number;
  latencyMs: number;
  basePoints: number;
  speedBonus: number;
  streakMultiplier: number;
  pointsAwarded: number;
  newStreak: number;
  speedCallout: string;
  isAnomaly: boolean;
  anomalyReason?: string;
}
