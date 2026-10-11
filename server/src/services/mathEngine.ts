/**
 * MATIKS HACKATHON ENGINE — MATHEMATICAL ZERO-LUCK ENGINE (mathEngine.ts)
 * 
 * Implements the 4-Bucket Carry Taxonomy, anti-chunking entropy filters,
 * and deterministic O(1) residual-targeted question generation.
 */

import type { CarryBucket, CarryType, Question, QuestionSanitized, SprintPaper } from '../types/math.js';

interface RawPair {
  a: number;
  b: number;
  sum: number;
}

const BUCKET_METADATA: Record<CarryBucket, {
  carryType: CarryType;
  tag: string;
  targetLatencyMs: number;
}> = {
  B1: {
    carryType: 'NONE',
    tag: 'DIRECT HIT // CLEAN',
    targetLatencyMs: 3500
  },
  B2: {
    carryType: 'ONES',
    tag: 'ONES OVERLOAD // CARRY 1',
    targetLatencyMs: 5500
  },
  B3: {
    carryType: 'CENTURY',
    tag: 'CENTURY BREAKER // 100+',
    targetLatencyMs: 6000
  },
  B4: {
    carryType: 'DOUBLE',
    tag: 'DOUBLE TROUBLE // MAX HEAT',
    targetLatencyMs: 8000
  }
};

/**
 * Precomputed bucket candidate pools and sum-indexed lookup tables.
 * Constructed once on module initialization in O(1) constant time (~1.5ms).
 */
class MathRepository {
  public readonly pools: Record<CarryBucket, RawPair[]> = {
    B1: [],
    B2: [],
    B3: [],
    B4: []
  };

  public readonly sumBins: Record<CarryBucket, Map<number, RawPair[]>> = {
    B1: new Map(),
    B2: new Map(),
    B3: new Map(),
    B4: new Map()
  };

  public readonly minSum: Record<CarryBucket, number> = { B1: Infinity, B2: Infinity, B3: Infinity, B4: Infinity };
  public readonly maxSum: Record<CarryBucket, number> = { B1: -Infinity, B2: -Infinity, B3: -Infinity, B4: -Infinity };

  constructor() {
    this.initializePools();
  }

  private initializePools(): void {
    for (let a = 10; a <= 99; a++) {
      for (let b = 10; b <= 99; b++) {
        // Filter 1: Disallow operands ending in 0
        if (a % 10 === 0 || b % 10 === 0) continue;

        // Filter 2: Disallow questions where BOTH operands end in 5
        if (a % 10 === 5 && b % 10 === 5) continue;

        // Filter 3: Disallow identical operands (A === B)
        if (a === b) continue;

        const onesSum = (a % 10) + (b % 10);
        const totalSum = a + b;
        const onesCarry = onesSum >= 10;
        const centuryCarry = totalSum >= 100;

        let bucket: CarryBucket | null = null;

        if (!onesCarry && !centuryCarry) {
          bucket = 'B1'; // No carry (<10 ones, <100 total)
        } else if (onesCarry && !centuryCarry) {
          bucket = 'B2'; // Ones carry only (>=10 ones, <100 total)
        } else if (!onesCarry && centuryCarry) {
          bucket = 'B3'; // Century carry only (<10 ones, >=100 total)
        } else if (onesCarry && centuryCarry) {
          bucket = 'B4'; // Double carry (>=10 ones, >=100 total)
        }

        if (bucket) {
          const pair: RawPair = { a, b, sum: totalSum };
          this.pools[bucket].push(pair);

          if (!this.sumBins[bucket].has(totalSum)) {
            this.sumBins[bucket].set(totalSum, []);
          }
          this.sumBins[bucket].get(totalSum)!.push(pair);

          if (totalSum < this.minSum[bucket]) this.minSum[bucket] = totalSum;
          if (totalSum > this.maxSum[bucket]) this.maxSum[bucket] = totalSum;
        }
      }
    }
  }

  public getAvailableSums(bucket: CarryBucket): number[] {
    return Array.from(this.sumBins[bucket].keys());
  }
}

// Singleton repository
const repo = new MathRepository();

/**
 * Canonical key for unordered pair deduplication.
 * Ensures (37 + 58) and (58 + 37) cannot appear in the same 15-question sprint.
 */
function getCanonicalKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/**
 * Creates a deterministic 32-bit PRNG (Mulberry32) from an arbitrary string seed.
 * Falls back to Math.random if no seed is provided.
 */
function createPrng(seedStr?: string): () => number {
  if (!seedStr) return Math.random;
  let h = 0x811c9dc5;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return function mulberry32() {
    let t = (h += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleArray<T>(array: T[], prng: () => number = Math.random): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Picks a pair from a specific bucket matching a target sum or from general pool,
 * ensuring canonical uniqueness.
 */
function pickPair(
  bucket: CarryBucket,
  usedKeys: Set<string>,
  targetSum?: number
): RawPair {
  const bins = repo.sumBins[bucket];

  if (targetSum !== undefined) {
    const availableSums = repo.getAvailableSums(bucket);
    const sortedSums = [...availableSums].sort((a, b) => Math.abs(a - targetSum) - Math.abs(b - targetSum));

    for (const s of sortedSums) {
      const candidateList = bins.get(s) || [];
      const shuffled = shuffleArray(candidateList);
      for (const p of shuffled) {
        const key = getCanonicalKey(p.a, p.b);
        if (!usedKeys.has(key)) {
          usedKeys.add(key);
          return p;
        }
      }
    }
  }

  // Fallback to random pick from the full pool
  const pool = repo.pools[bucket];
  const maxAttempts = 50;
  for (let i = 0; i < maxAttempts; i++) {
    const p = pool[Math.floor(Math.random() * pool.length)];
    const key = getCanonicalKey(p.a, p.b);
    if (!usedKeys.has(key)) {
      usedKeys.add(key);
      return p;
    }
  }

  // Exhaustive search if collisions occur
  for (const p of pool) {
    const key = getCanonicalKey(p.a, p.b);
    if (!usedKeys.has(key)) {
      usedKeys.add(key);
      return p;
    }
  }

  throw new Error(`Exhausted candidates for bucket ${bucket}`);
}

/**
 * Creates a fully initialized Question instance from a raw pair.
 */
function toQuestion(pair: RawPair, bucket: CarryBucket, index: number): Question {
  const meta = BUCKET_METADATA[bucket];
  return {
    id: `q_${index + 1}_${pair.a}_${pair.b}`,
    bucket,
    carryType: meta.carryType,
    tag: meta.tag,
    a: pair.a,
    b: pair.b,
    answer: pair.sum,
    targetLatencyMs: meta.targetLatencyMs
  };
}

/**
 * Generates an immutable 15-question SprintPaper satisfying all requirements:
 * 1. Exactly 3 No-Carry (B1)
 * 2. Exactly 4 Ones-Carry (B2)
 * 3. Exactly 4 Century-Carry (B3)
 * 4. Exactly 4 Double-Carry (B4)
 * 5. Gross sum constrained to [1650, 1750] (centered on 1700) via O(1) residual targeting
 * 6. Zero commutative duplicates, zero 0-endings, zero double-5 endings, zero identical operands
 */
export function generateSprintPaper(paperId?: string): SprintPaper {
  for (let attempt = 0; attempt < 20; attempt++) {
    const usedKeys = new Set<string>();
    const rawQuestions: { pair: RawPair; bucket: CarryBucket }[] = [];

    // Step 1: Calibrated selection of B1 (3 Qs, target sum ~75 each)
    for (let i = 0; i < 3; i++) {
      const jitter = Math.floor(Math.random() * 21) - 10;
      rawQuestions.push({
        pair: pickPair('B1', usedKeys, 75 + jitter),
        bucket: 'B1'
      });
    }

    // Step 2: Calibrated selection of B2 (4 Qs, target sum ~80 each)
    for (let i = 0; i < 4; i++) {
      const jitter = Math.floor(Math.random() * 21) - 10;
      rawQuestions.push({
        pair: pickPair('B2', usedKeys, 80 + jitter),
        bucket: 'B2'
      });
    }

    // Step 3: Calibrated selection of B3 (4 Qs, target sum ~140 each)
    for (let i = 0; i < 4; i++) {
      const jitter = Math.floor(Math.random() * 21) - 10;
      rawQuestions.push({
        pair: pickPair('B3', usedKeys, 140 + jitter),
        bucket: 'B3'
      });
    }

    // Step 4: Analytical Residual Partitioning across B4 (4 Qs)
    // Calculate sum of first 11 questions
    const currentSum11 = rawQuestions.reduce((sum, q) => sum + q.pair.sum, 0);
    const remainingTotalTarget = 1700 - currentSum11;
    const targetEachB4 = Math.round(remainingTotalTarget / 4);

    // Pick first 3 questions of B4 around targetEachB4
    for (let i = 0; i < 3; i++) {
      const jitter = Math.floor(Math.random() * 11) - 5;
      rawQuestions.push({
        pair: pickPair('B4', usedKeys, targetEachB4 + jitter),
        bucket: 'B4'
      });
    }

    // Pick final B4 question targeting the exact mathematical residual
    const currentSum14 = rawQuestions.reduce((sum, q) => sum + q.pair.sum, 0);
    const finalResidualB4 = 1700 - currentSum14;
    rawQuestions.push({
      pair: pickPair('B4', usedKeys, finalResidualB4),
      bucket: 'B4'
    });

    // Step 5: Construct Question objects
    const questions: Question[] = rawQuestions.map((q, idx) =>
      toQuestion(q.pair, q.bucket, idx)
    );

    const totalSum = questions.reduce((sum, q) => sum + q.answer, 0);

    if (totalSum < 1650 || totalSum > 1750) {
      continue;
    }

    const bucketCounts: Record<CarryBucket, number> = {
      B1: questions.filter(q => q.bucket === 'B1').length,
      B2: questions.filter(q => q.bucket === 'B2').length,
      B3: questions.filter(q => q.bucket === 'B3').length,
      B4: questions.filter(q => q.bucket === 'B4').length,
    };

    return {
      paperId: paperId || `paper_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      questions,
      totalSum,
      bucketCounts,
      generatedAt: Date.now()
    };
  }

  throw new Error('Failed to generate sprint paper within sum constraints [1650, 1750]');
}

/**
 * Shuffles questions uniquely per player using Fisher-Yates algorithm
 * with an optional PRNG seed (e.g. rollNumber + paperId) to ensure deterministic
 * session recovery and offline auditability.
 */
export function shuffleQuestionsForPlayer(questions: Question[], seed?: string): Question[] {
  return shuffleArray(questions, createPrng(seed));
}

/**
 * Sanitizes questions for client transmission (removes the answer key).
 */
export function sanitizeQuestions(questions: Question[]): QuestionSanitized[] {
  return questions.map((q, index) => ({
    id: q.id,
    questionIndex: index,
    bucket: q.bucket,
    carryType: q.carryType,
    tag: q.tag,
    a: q.a,
    b: q.b,
    targetLatencyMs: q.targetLatencyMs
  }));
}

/**
 * Validates a single answer submission against the authoritative question record.
 */
export function verifyAnswer(question: Question, submittedAnswer: number): boolean {
  return question.answer === submittedAnswer;
}

export const mathEngine = {
  generateSprintPaper,
  shuffleQuestionsForPlayer,
  sanitizeQuestions,
  verifyAnswer
};
