/**
 * MATIKS HACKATHON ENGINE — MATHEMATICAL ZERO-LUCK ENGINE (mathEngine.ts)
 * 
 * Implements the 4-Bucket Carry Taxonomy and 2-Bucket Regroup Borrow Taxonomy,
 * anti-chunking entropy filters, O(1) contiguous-slice uniform pair sampling
 * across calibrated sum/diff corridors, and cross-game anti-repetition memory.
 */

import { randomInt } from 'node:crypto';
import type {
  MathBucket,
  CarryType,
  OperatorMode,
  Question,
  QuestionSanitized,
  SprintPaper
} from '../types/math.js';

interface RawPair {
  a: number;
  b: number;
  result: number;
  key: string;
}

export const BUCKET_METADATA: Record<MathBucket, {
  carryType: CarryType;
  tag: string;
  targetLatencyMs: number;
  operator: '+' | '-';
}> = {
  B1: {
    carryType: 'NONE',
    tag: 'DIRECT HIT // CLEAN',
    targetLatencyMs: 3500,
    operator: '+'
  },
  B2: {
    carryType: 'ONES',
    tag: 'ONES OVERLOAD // CARRY 1',
    targetLatencyMs: 5500,
    operator: '+'
  },
  B3: {
    carryType: 'CENTURY',
    tag: 'CENTURY BREAKER // 100+',
    targetLatencyMs: 6000,
    operator: '+'
  },
  B4: {
    carryType: 'DOUBLE',
    tag: 'DOUBLE TROUBLE // MAX HEAT',
    targetLatencyMs: 8000,
    operator: '+'
  },
  S1: {
    carryType: 'BORROW_NONE',
    tag: 'DIRECT SUB // CLEAN',
    targetLatencyMs: 3800,
    operator: '-'
  },
  S2: {
    carryType: 'BORROW_ONES',
    tag: 'ONES BORROW // REGROUP',
    targetLatencyMs: 6500,
    operator: '-'
  }
};

/**
 * Calibrated center values per bucket:
 * Addition: 3 * 72 (B1) + 4 * 75 (B2) + 4 * 140 (B3) + 4 * 156 (B4) = 1700 (Window [1650, 1750]).
 * Subtraction: 7 * 37 (S1) + 8 * 37 (S2) = 555 (Window [520, 580]).
 * Mixed: 2 * 72 (B1) + 2 * 75 (B2) + 2 * 140 (B3) + 2 * 156 (B4) + 3 * 37 (S1) + 4 * 37 (S2) = 1145 (Window [1100, 1185]).
 */
const CALIBRATED_CENTER_VALUE: Record<MathBucket, number> = {
  B1: 72,
  B2: 75,
  B3: 140,
  B4: 156,
  S1: 37,
  S2: 37
};

/**
 * Canonical key for pair deduplication.
 * Addition pairs are unordered: (37 + 58) and (58 + 37) share '37_58'.
 * Subtraction pairs are directed: (58 - 37) is 'sub_58_37'.
 */
export function getCanonicalKey(a: number, b: number, operator: '+' | '-' = '+'): string {
  return operator === '-' ? `sub_${a}_${b}` : (a < b ? `${a}_${b}` : `${b}_${a}`);
}

/**
 * Precomputed bucket candidate pools sorted by numerical result with O(1) range index tables.
 * Constructed once on module initialization in O(1) constant time (~2ms).
 */
class MathRepository {
  public readonly pools: Record<MathBucket, RawPair[]> = {
    B1: [],
    B2: [],
    B3: [],
    B4: [],
    S1: [],
    S2: []
  };

  public readonly minVal: Record<MathBucket, number> = {
    B1: Infinity,
    B2: Infinity,
    B3: Infinity,
    B4: Infinity,
    S1: Infinity,
    S2: Infinity
  };

  public readonly maxVal: Record<MathBucket, number> = {
    B1: -Infinity,
    B2: -Infinity,
    B3: -Infinity,
    B4: -Infinity,
    S1: -Infinity,
    S2: -Infinity
  };

  private readonly startIdxByVal: Record<MathBucket, Int32Array> = {
    B1: new Int32Array(205),
    B2: new Int32Array(205),
    B3: new Int32Array(205),
    B4: new Int32Array(205),
    S1: new Int32Array(205),
    S2: new Int32Array(205)
  };

  private readonly endIdxByVal: Record<MathBucket, Int32Array> = {
    B1: new Int32Array(205),
    B2: new Int32Array(205),
    B3: new Int32Array(205),
    B4: new Int32Array(205),
    S1: new Int32Array(205),
    S2: new Int32Array(205)
  };

  constructor() {
    this.initializePools();
  }

  private initializePools(): void {
    const buckets: MathBucket[] = ['B1', 'B2', 'B3', 'B4', 'S1', 'S2'];

    // 1. Populate Addition Pools (B1, B2, B3, B4)
    for (let a = 10; a <= 99; a++) {
      for (let b = 10; b <= 99; b++) {
        // Disallow operands ending in 0
        if (a % 10 === 0 || b % 10 === 0) continue;

        // Disallow questions where BOTH operands end in 5
        if (a % 10 === 5 && b % 10 === 5) continue;

        // Disallow identical operands (A === B)
        if (a === b) continue;

        const onesSum = (a % 10) + (b % 10);
        const totalSum = a + b;
        const onesCarry = onesSum >= 10;
        const centuryCarry = totalSum >= 100;

        let bucket: MathBucket | null = null;

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
          const pair: RawPair = { a, b, result: totalSum, key: getCanonicalKey(a, b, '+') };
          this.pools[bucket].push(pair);

          if (totalSum < this.minVal[bucket]) this.minVal[bucket] = totalSum;
          if (totalSum > this.maxVal[bucket]) this.maxVal[bucket] = totalSum;
        }
      }
    }

    // 2. Populate Subtraction Pools (S1, S2)
    // Range: A in [20, 99], B in [10, 89] with A - B >= 10
    // Guarantees all differences are strictly 2-digit numbers [10, 89] for zero-Enter auto-submit.
    for (let a = 20; a <= 99; a++) {
      for (let b = 10; b <= 89; b++) {
        // Disallow operands ending in 0
        if (a % 10 === 0 || b % 10 === 0) continue;

        // Disallow both ending in 5
        if (a % 10 === 5 && b % 10 === 5) continue;

        // Enforce strictly 2-digit difference invariant (A - B >= 10)
        if (a - b < 10) continue;

        // Disallow result ending in 0 (anti-chunking)
        if ((a - b) % 10 === 0) continue;

        const diff = a - b;
        const bucket: MathBucket = (a % 10) > (b % 10) ? 'S1' : 'S2';

        const pair: RawPair = { a, b, result: diff, key: getCanonicalKey(a, b, '-') };
        this.pools[bucket].push(pair);

        if (diff < this.minVal[bucket]) this.minVal[bucket] = diff;
        if (diff > this.maxVal[bucket]) this.maxVal[bucket] = diff;
      }
    }

    // Sort each pool by result ascending and precompute O(1) slice boundaries for any [lo, hi] corridor
    for (const b of buckets) {
      const pool = this.pools[b];
      pool.sort((x, y) => x.result - y.result);

      const starts = this.startIdxByVal[b];
      const ends = this.endIdxByVal[b];

      for (let s = 0; s < 205; s++) {
        let st = 0;
        while (st < pool.length && pool[st].result < s) {
          st++;
        }
        starts[s] = st;

        let en = st;
        while (en < pool.length && pool[en].result <= s) {
          en++;
        }
        ends[s] = en;
      }
    }
  }

  public getCorridorSliceBounds(bucket: MathBucket, minVal: number, maxVal: number): [number, number] {
    const lo = Math.max(0, Math.min(204, Math.floor(minVal)));
    const hi = Math.max(0, Math.min(204, Math.floor(maxVal)));
    if (lo > hi) return [0, 0];
    return [this.startIdxByVal[bucket][lo], this.endIdxByVal[bucket][hi]];
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
 * Picks a pair uniformly in O(1) time from the contiguous result-sorted slice [minVal, maxVal],
 * strictly avoiding usedKeys and prioritizing pairs not in excludeKeys or recentGlobalSet.
 */
function pickPairInCorridor(
  bucket: MathBucket,
  usedKeys: Set<string>,
  minVal: number,
  maxVal: number,
  prng: () => number,
  excludeKeys?: ReadonlySet<string>
): RawPair {
  const pool = repo.pools[bucket];
  const lo = Math.max(minVal, repo.minVal[bucket]);
  const hi = Math.min(maxVal, repo.maxVal[bucket]);
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
function toQuestion(pair: RawPair, bucket: MathBucket, index: number): Question {
  const meta = BUCKET_METADATA[bucket];
  return {
    id: `q_${index + 1}_${pair.a}_${pair.b}`,
    bucket,
    carryType: meta.carryType,
    tag: meta.tag,
    a: pair.a,
    b: pair.b,
    operator: meta.operator,
    answer: pair.result,
    targetLatencyMs: meta.targetLatencyMs
  };
}

/**
 * Generates an immutable 15-question SprintPaper satisfying all requirements:
 * 1. Add mode: Exactly 3 B1, 4 B2, 4 B3, 4 B4, gross answer sum in [1650, 1750] (<0.1ms).
 * 2. Sub mode: Exactly 7 S1, 8 S2, gross difference sum in [520, 580] (<0.1ms).
 * 3. Mixed mode: Exactly 2 B1, 2 B2, 2 B3, 2 B4, 3 S1, 4 S2, gross answer sum in [1100, 1185] (<0.1ms).
 * 4. Zero duplicate pairs, zero 0-endings, zero double-5 endings, zero identical operands.
 * 5. All subtraction results strictly >= 10 (guaranteed 2 digits) for zero-Enter auto-submit.
 * 6. Cross-game anti-repetition via excludeKeys and rolling global pair history.
 */
export function generateSprintPaper(
  paperId?: string,
  excludeKeys?: ReadonlySet<string>,
  operatorMode: OperatorMode = 'add'
): SprintPaper {
  let blueprintBuckets: MathBucket[];
  let targetTotal: number;
  let minCorridor: number;
  let maxCorridor: number;

  if (operatorMode === 'sub') {
    blueprintBuckets = [
      'S1', 'S1', 'S1', 'S1', 'S1', 'S1', 'S1',
      'S2', 'S2', 'S2', 'S2', 'S2', 'S2', 'S2', 'S2'
    ];
    targetTotal = 550;
    minCorridor = 520;
    maxCorridor = 580;
  } else if (operatorMode === 'mixed') {
    blueprintBuckets = [
      'B1', 'B1',
      'B2', 'B2',
      'B3', 'B3',
      'B4', 'B4',
      'S1', 'S1', 'S1',
      'S2', 'S2', 'S2', 'S2'
    ];
    targetTotal = 1145;
    minCorridor = 1100;
    maxCorridor = 1185;
  } else {
    blueprintBuckets = [
      'B1', 'B1', 'B1',
      'B2', 'B2', 'B2', 'B2',
      'B3', 'B3', 'B3', 'B3',
      'B4', 'B4', 'B4', 'B4'
    ];
    targetTotal = 1700;
    minCorridor = 1650;
    maxCorridor = 1750;
  }

  const prng = createPrng();

  for (let attempt = 0; attempt < 25; attempt++) {
    const usedKeys = new Set<string>();
    const rawQuestions: { pair: RawPair; bucket: MathBucket }[] = [];

    const orderedBuckets = shuffleArray(blueprintBuckets, prng);
    let currentSum = 0;

    for (let k = 0; k < orderedBuckets.length; k++) {
      const bucket = orderedBuckets[k];

      let remMin = 0;
      let remMax = 0;
      let remCalibrated = 0;
      for (let r = k + 1; r < orderedBuckets.length; r++) {
        const rb = orderedBuckets[r];
        remMin += repo.minVal[rb];
        remMax += repo.maxVal[rb];
        remCalibrated += CALIBRATED_CENTER_VALUE[rb];
      }

      // Exact mathematical feasibility bounds so corridor window remains reachable
      const hardMin = Math.max(repo.minVal[bucket], minCorridor - currentSum - remMax);
      const hardMax = Math.min(repo.maxVal[bucket], maxCorridor - currentSum - remMin);

      // Calibrated corridor centered on target trajectory with wide spread
      const idealForThisStep = targetTotal - currentSum - remCalibrated;
      const spread = k === orderedBuckets.length - 1 ? 50 : 28;
      const softMin = Math.max(hardMin, idealForThisStep - spread);
      const softMax = Math.min(hardMax, idealForThisStep + spread);

      const corridorMin = softMin <= softMax ? softMin : hardMin;
      const corridorMax = softMin <= softMax ? softMax : hardMax;

      const pair = pickPairInCorridor(bucket, usedKeys, corridorMin, corridorMax, prng, excludeKeys);
      rawQuestions.push({ pair, bucket });
      currentSum += pair.result;
    }

    if (currentSum < minCorridor || currentSum > maxCorridor) {
      continue;
    }

    const shuffledRaw = shuffleArray(rawQuestions, prng);
    const questions: Question[] = shuffledRaw.map((q, idx) =>
      toQuestion(q.pair, q.bucket, idx)
    );

    for (const k of usedKeys) {
      recordRecentPairKey(k);
    }

    const bucketCounts: Record<string, number> = {};
    for (const q of questions) {
      bucketCounts[q.bucket] = (bucketCounts[q.bucket] || 0) + 1;
    }

    const suffix = Math.floor(prng() * 900000) + 100000;
    return {
      paperId: paperId || `paper_${Date.now()}_${suffix}`,
      questions,
      totalSum: currentSum,
      bucketCounts,
      generatedAt: Date.now(),
      operatorMode
    };
  }

  throw new Error(`Failed to generate sprint paper within sum constraints [${minCorridor}, ${maxCorridor}] for mode ${operatorMode}`);
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
    operator: q.operator || (BUCKET_METADATA[q.bucket]?.operator ?? '+'),
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
