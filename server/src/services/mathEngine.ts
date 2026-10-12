/**
 * MATIKS HACKATHON ENGINE — MATHEMATICAL ZERO-LUCK ENGINE (mathEngine.ts)
 * 
 * Implements the 4-Bucket Carry Taxonomy, anti-chunking entropy filters,
 * O(1) contiguous-slice uniform pair sampling across calibrated sum corridors,
 * and cross-game anti-repetition memory.
 */

import { randomInt } from 'node:crypto';
import type { CarryBucket, CarryType, Question, QuestionSanitized, SprintPaper } from '../types/math.js';

interface RawPair {
  a: number;
  b: number;
  sum: number;
  key: string;
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
 * Calibrated center sums per bucket:
 * 3 * 72 (B1) + 4 * 75 (B2) + 4 * 140 (B3) + 4 * 156 (B4) = 216 + 300 + 560 + 624 = 1700.
 */
const CALIBRATED_CENTER_SUM: Record<CarryBucket, number> = {
  B1: 72,
  B2: 75,
  B3: 140,
  B4: 156
};

/**
 * Canonical key for unordered pair deduplication.
 * Ensures (37 + 58) and (58 + 37) cannot appear in the same 15-question sprint.
 */
export function getCanonicalKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/**
 * Precomputed bucket candidate pools sorted by sum with O(1) range index tables.
 * Constructed once on module initialization in O(1) constant time (~1.5ms).
 */
class MathRepository {
  public readonly pools: Record<CarryBucket, RawPair[]> = {
    B1: [],
    B2: [],
    B3: [],
    B4: []
  };

  public readonly minSum: Record<CarryBucket, number> = { B1: Infinity, B2: Infinity, B3: Infinity, B4: Infinity };
  public readonly maxSum: Record<CarryBucket, number> = { B1: -Infinity, B2: -Infinity, B3: -Infinity, B4: -Infinity };

  private readonly startIdxBySum: Record<CarryBucket, Int32Array> = {
    B1: new Int32Array(205),
    B2: new Int32Array(205),
    B3: new Int32Array(205),
    B4: new Int32Array(205)
  };

  private readonly endIdxBySum: Record<CarryBucket, Int32Array> = {
    B1: new Int32Array(205),
    B2: new Int32Array(205),
    B3: new Int32Array(205),
    B4: new Int32Array(205)
  };

  constructor() {
    this.initializePools();
  }

  private initializePools(): void {
    const buckets: CarryBucket[] = ['B1', 'B2', 'B3', 'B4'];

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
          const pair: RawPair = { a, b, sum: totalSum, key: getCanonicalKey(a, b) };
          this.pools[bucket].push(pair);

          if (totalSum < this.minSum[bucket]) this.minSum[bucket] = totalSum;
          if (totalSum > this.maxSum[bucket]) this.maxSum[bucket] = totalSum;
        }
      }
    }

    // Sort each pool by sum ascending and precompute O(1) slice boundaries for any [lo, hi] sum corridor
    for (const b of buckets) {
      const pool = this.pools[b];
      pool.sort((x, y) => x.sum - y.sum);

      const starts = this.startIdxBySum[b];
      const ends = this.endIdxBySum[b];

      for (let s = 0; s < 205; s++) {
        let st = 0;
        while (st < pool.length && pool[st].sum < s) {
          st++;
        }
        starts[s] = st;

        let en = st;
        while (en < pool.length && pool[en].sum <= s) {
          en++;
        }
        ends[s] = en;
      }
    }
  }

  public getCorridorSliceBounds(bucket: CarryBucket, minSum: number, maxSum: number): [number, number] {
    const lo = Math.max(0, Math.min(204, Math.floor(minSum)));
    const hi = Math.max(0, Math.min(204, Math.floor(maxSum)));
    if (lo > hi) return [0, 0];
    return [this.startIdxBySum[bucket][lo], this.endIdxBySum[bucket][hi]];
  }
}

// Singleton repository
const repo = new MathRepository();

// Rolling cross-game canonical key history to prevent back-to-back repetition across consecutive games
const MAX_RECENT_GLOBAL_KEYS = 90; // Last 6 full 15-question games
const recentGlobalQueue: string[] = [];
const recentGlobalSet = new Set<string>();

function recordRecentPairKey(key: string): void {
  if (recentGlobalSet.has(key)) return;
  recentGlobalSet.add(key);
  recentGlobalQueue.push(key);
  while (recentGlobalQueue.length > MAX_RECENT_GLOBAL_KEYS) {
    const oldest = recentGlobalQueue.shift();
    if (oldest) {
      recentGlobalSet.delete(oldest);
    }
  }
}

/**
 * Creates a fast Mulberry32 PRNG seeded from a string or a fresh cryptographic 32-bit integer.
 */
function createPrng(seedStr?: string): () => number {
  let h = seedStr ? 0x811c9dc5 : randomInt(1, 0x7fffffff);
  if (seedStr) {
    for (let i = 0; i < seedStr.length; i++) {
      h ^= seedStr.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return function mulberry32() {
    let t = (h += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleArray<T>(array: T[], prng: () => number): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Picks a pair uniformly in O(1) time from the contiguous sum-sorted slice [minSum, maxSum],
 * strictly avoiding usedKeys and prioritizing pairs not in excludeKeys or recentGlobalSet.
 */
function pickPairInCorridor(
  bucket: CarryBucket,
  usedKeys: Set<string>,
  minSum: number,
  maxSum: number,
  prng: () => number,
  excludeKeys?: ReadonlySet<string>
): RawPair {
  const pool = repo.pools[bucket];
  const lo = Math.max(minSum, repo.minSum[bucket]);
  const hi = Math.min(maxSum, repo.maxSum[bucket]);
  const [startIdx, endIdx] = repo.getCorridorSliceBounds(bucket, lo, hi);
  const count = endIdx - startIdx;

  if (count > 0) {
    // Fast O(1) random probes within [startIdx, endIdx)
    let fallbackNotExcluded: RawPair | null = null;
    let fallbackAnyUnused: RawPair | null = null;

    const probes = Math.min(32, count);
    for (let i = 0; i < probes; i++) {
      const p = pool[startIdx + Math.floor(prng() * count)];
      if (usedKeys.has(p.key)) continue;
      if (!fallbackAnyUnused) fallbackAnyUnused = p;

      const inExclude = excludeKeys ? excludeKeys.has(p.key) : false;
      if (!inExclude) {
        if (!recentGlobalSet.has(p.key)) {
          usedKeys.add(p.key);
          return p;
        }
        if (!fallbackNotExcluded) fallbackNotExcluded = p;
      }
    }

    if (fallbackNotExcluded) {
      usedKeys.add(fallbackNotExcluded.key);
      return fallbackNotExcluded;
    }

    // Linear scan from a random offset in [startIdx, endIdx) to guarantee finding an unexcluded pair if one exists
    const randomOffset = Math.floor(prng() * count);
    for (let i = 0; i < count; i++) {
      const p = pool[startIdx + ((randomOffset + i) % count)];
      if (usedKeys.has(p.key)) continue;
      if (!fallbackAnyUnused) fallbackAnyUnused = p;
      if (!excludeKeys || !excludeKeys.has(p.key)) {
        usedKeys.add(p.key);
        return p;
      }
    }

    if (fallbackAnyUnused) {
      usedKeys.add(fallbackAnyUnused.key);
      return fallbackAnyUnused;
    }
  }

  // Fallback across the full bucket pool if the narrow corridor was completely exhausted
  const fullOffset = Math.floor(prng() * pool.length);
  for (let i = 0; i < pool.length; i++) {
    const p = pool[(fullOffset + i) % pool.length];
    if (!usedKeys.has(p.key) && (!excludeKeys || !excludeKeys.has(p.key))) {
      usedKeys.add(p.key);
      return p;
    }
  }

  for (let i = 0; i < pool.length; i++) {
    const p = pool[i];
    if (!usedKeys.has(p.key)) {
      usedKeys.add(p.key);
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
    operator: '+',
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
 * 5. Gross sum constrained to [1650, 1750] via O(1) calibrated corridor sampling (<0.1ms)
 * 6. Zero commutative duplicates, zero 0-endings, zero double-5 endings, zero identical operands
 * 7. Cross-game anti-repetition via excludeKeys and rolling global pair history
 */
export function generateSprintPaper(
  paperId?: string,
  excludeKeys?: ReadonlySet<string>
): SprintPaper {
  const blueprintBuckets: CarryBucket[] = [
    'B1', 'B1', 'B1',
    'B2', 'B2', 'B2', 'B2',
    'B3', 'B3', 'B3', 'B3',
    'B4', 'B4', 'B4', 'B4'
  ];

  const prng = createPrng();

  for (let attempt = 0; attempt < 25; attempt++) {
    const usedKeys = new Set<string>();
    const rawQuestions: { pair: RawPair; bucket: CarryBucket }[] = [];

    const orderedBuckets = shuffleArray(blueprintBuckets, prng);
    let currentSum = 0;

    for (let k = 0; k < orderedBuckets.length; k++) {
      const bucket = orderedBuckets[k];

      let remMin = 0;
      let remMax = 0;
      let remCalibrated = 0;
      for (let r = k + 1; r < orderedBuckets.length; r++) {
        const rb = orderedBuckets[r];
        remMin += repo.minSum[rb];
        remMax += repo.maxSum[rb];
        remCalibrated += CALIBRATED_CENTER_SUM[rb];
      }

      // Exact mathematical feasibility bounds so [1650, 1750] remains reachable
      const hardMin = Math.max(repo.minSum[bucket], 1650 - currentSum - remMax);
      const hardMax = Math.min(repo.maxSum[bucket], 1750 - currentSum - remMin);

      // Calibrated corridor centered on 1700 trajectory with wide +/- 28 spread (600+ pairs per bucket)
      const idealForThisStep = 1700 - currentSum - remCalibrated;
      const spread = k === orderedBuckets.length - 1 ? 50 : 28;
      const softMin = Math.max(hardMin, idealForThisStep - spread);
      const softMax = Math.min(hardMax, idealForThisStep + spread);

      const corridorMin = softMin <= softMax ? softMin : hardMin;
      const corridorMax = softMin <= softMax ? softMax : hardMax;

      const pair = pickPairInCorridor(bucket, usedKeys, corridorMin, corridorMax, prng, excludeKeys);
      rawQuestions.push({ pair, bucket });
      currentSum += pair.sum;
    }

    if (currentSum < 1650 || currentSum > 1750) {
      continue;
    }

    const shuffledRaw = shuffleArray(rawQuestions, prng);
    const questions: Question[] = shuffledRaw.map((q, idx) =>
      toQuestion(q.pair, q.bucket, idx)
    );

    for (const k of usedKeys) {
      recordRecentPairKey(k);
    }

    const bucketCounts: Record<CarryBucket, number> = {
      B1: questions.filter(q => q.bucket === 'B1').length,
      B2: questions.filter(q => q.bucket === 'B2').length,
      B3: questions.filter(q => q.bucket === 'B3').length,
      B4: questions.filter(q => q.bucket === 'B4').length
    };

    const suffix = Math.floor(prng() * 900000) + 100000;
    return {
      paperId: paperId || `paper_${Date.now()}_${suffix}`,
      questions,
      totalSum: currentSum,
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
  const prng = createPrng(seed);
  return shuffleArray(questions, prng);
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
    tag: q.tag || BUCKET_METADATA[q.bucket]?.tag || '',
    a: q.a,
    b: q.b,
    operator: q.operator || '+',
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
  verifyAnswer,
  getCanonicalKey
};
