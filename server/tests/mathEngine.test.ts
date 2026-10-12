/**
 * MATIKS HACKATHON ENGINE — MATHEMATICAL ENGINE VERIFICATION SUITE
 * 
 * Tests the 4-Bucket Carry Taxonomy, anti-chunking entropy filters,
 * gross sum normalization across 1,000 generated sets, and scoring formulas.
 */

process.env.NODE_ENV = 'test';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSprintPaper,
  shuffleQuestionsForPlayer,
  sanitizeQuestions
} from '../src/services/mathEngine.js';
import {
  evaluateSubmission,
  computeSpeedBonus,
  getStreakMultiplier
} from '../src/services/scoringEngine.js';

describe('Math Engine — 4-Bucket Carry Taxonomy & Zero-Luck Invariants', () => {
  it('generates a sprint paper with exactly 15 questions adhering to carry distribution', () => {
    const paper = generateSprintPaper('test_paper_1');

    assert.equal(paper.questions.length, 15, 'Paper must contain exactly 15 questions');
    assert.equal(paper.bucketCounts.B1, 3, 'Must contain exactly 3 No-Carry questions (B1)');
    assert.equal(paper.bucketCounts.B2, 4, 'Must contain exactly 4 Ones-Carry questions (B2)');
    assert.equal(paper.bucketCounts.B3, 4, 'Must contain exactly 4 Century-Carry questions (B3)');
    assert.equal(paper.bucketCounts.B4, 4, 'Must contain exactly 4 Double-Carry questions (B4)');
  });

  it('enforces mathematical carry definitions strictly on every question', () => {
    const paper = generateSprintPaper();

    for (const q of paper.questions) {
      assert.ok(q.a >= 10 && q.a <= 99, `Operand a (${q.a}) must be in [10, 99]`);
      assert.ok(q.b >= 10 && q.b <= 99, `Operand b (${q.b}) must be in [10, 99]`);
      assert.equal(q.answer, q.a + q.b, `Answer must equal a + b`);

      const onesSum = (q.a % 10) + (q.b % 10);
      const totalSum = q.a + q.b;
      const onesCarry = onesSum >= 10;
      const centuryCarry = totalSum >= 100;

      if (q.bucket === 'B1') {
        assert.ok(!onesCarry && !centuryCarry, `B1 question ${q.a}+${q.b}=${totalSum} cannot carry`);
        assert.equal(q.targetLatencyMs, 3500);
      } else if (q.bucket === 'B2') {
        assert.ok(onesCarry && !centuryCarry, `B2 question ${q.a}+${q.b}=${totalSum} must only carry ones`);
        assert.equal(q.targetLatencyMs, 5500);
      } else if (q.bucket === 'B3') {
        assert.ok(!onesCarry && centuryCarry, `B3 question ${q.a}+${q.b}=${totalSum} must only carry century`);
        assert.equal(q.targetLatencyMs, 6000);
      } else if (q.bucket === 'B4') {
        assert.ok(onesCarry && centuryCarry, `B4 question ${q.a}+${q.b}=${totalSum} must double carry`);
        assert.equal(q.targetLatencyMs, 8000);
      }
    }
  });

  it('enforces anti-chunking entropy filters (no 0-endings, no double-5, no A=B, no commutative dupes)', () => {
    const paper = generateSprintPaper();
    const seenUnorderedKeys = new Set<string>();

    for (const q of paper.questions) {
      assert.notEqual(q.a % 10, 0, `Operand a (${q.a}) cannot end in 0`);
      assert.notEqual(q.b % 10, 0, `Operand b (${q.b}) cannot end in 0`);
      assert.ok(!(q.a % 10 === 5 && q.b % 10 === 5), `Pair (${q.a}, ${q.b}) cannot both end in 5`);
      assert.notEqual(q.a, q.b, `Operands cannot be identical: ${q.a} == ${q.b}`);

      const key = q.a < q.b ? `${q.a}_${q.b}` : `${q.b}_${q.a}`;
      assert.ok(!seenUnorderedKeys.has(key), `Commutative duplicate detected for pair: ${key}`);
      seenUnorderedKeys.add(key);
    }
  });

  it('sanitizes questions for client broadcast without leaking answer keys', () => {
    const paper = generateSprintPaper();
    const sanitized = sanitizeQuestions(paper.questions);

    assert.equal(sanitized.length, 15);
    for (let i = 0; i < sanitized.length; i++) {
      const sq = sanitized[i];
      assert.equal(sq.questionIndex, i);
      assert.equal(sq.a, paper.questions[i].a);
      assert.equal(sq.b, paper.questions[i].b);
      // Ensure 'answer' field is completely absent from sanitized object
      assert.equal((sq as any).answer, undefined, 'Sanitized question must NOT contain answer key');
    }
  });

  it('permutes questions for player shuffle without altering bucket distribution', () => {
    const paper = generateSprintPaper();
    const shuffled = shuffleQuestionsForPlayer(paper.questions);

    assert.equal(shuffled.length, 15);
    const b1Count = shuffled.filter(q => q.bucket === 'B1').length;
    const b2Count = shuffled.filter(q => q.bucket === 'B2').length;
    const b3Count = shuffled.filter(q => q.bucket === 'B3').length;
    const b4Count = shuffled.filter(q => q.bucket === 'B4').length;

    assert.equal(b1Count, 3);
    assert.equal(b2Count, 4);
    assert.equal(b3Count, 4);
    assert.equal(b4Count, 4);
  });

  it('prevents question repetition across consecutive games and randomizes bucket positions', () => {
    const squadUsedKeys = new Set<string>();
    const firstQuestionBuckets = new Set<string>();

    // Simulate 8 consecutive games for the same squad (120 questions total)
    for (let game = 0; game < 8; game++) {
      const paper = generateSprintPaper(undefined, squadUsedKeys);
      firstQuestionBuckets.add(paper.questions[0].bucket);

      for (const q of paper.questions) {
        const key = q.a < q.b ? `${q.a}_${q.b}` : `${q.b}_${q.a}`;
        assert.ok(
          !squadUsedKeys.has(key),
          `Question pair ${q.a}+${q.b} (${key}) repeated in game ${game + 1}`
        );
        squadUsedKeys.add(key);
      }
    }

    assert.equal(squadUsedKeys.size, 120, 'All 120 questions across 8 consecutive games must be distinct pairs');
    assert.ok(firstQuestionBuckets.size > 1, 'First question bucket must be randomized across games');
  });

  it('generates a subtraction sprint paper with exactly 15 questions adhering to borrow distribution', () => {
    const paper = generateSprintPaper('sub_paper_1', undefined, 'sub');

    assert.equal(paper.questions.length, 15, 'Paper must contain exactly 15 questions');
    assert.equal(paper.bucketCounts.S1, 7, 'Must contain exactly 7 Clean Subtraction questions (S1)');
    assert.equal(paper.bucketCounts.S2, 8, 'Must contain exactly 8 Regroup Borrow questions (S2)');
    assert.equal(paper.operatorMode, 'sub');

    for (const q of paper.questions) {
      assert.ok(q.a >= 20 && q.a <= 99, `Operand a (${q.a}) must be in [20, 99]`);
      assert.ok(q.b >= 10 && q.b <= 89, `Operand b (${q.b}) must be in [10, 89]`);
      assert.equal(q.operator, '-', 'Operator must be -');
      assert.equal(q.answer, q.a - q.b, 'Answer must equal a - b');

      // Zero-Enter Auto-Submit Invariant: Answer must strictly be 2 digits
      assert.ok(
        q.answer >= 10 && q.answer <= 89,
        `Difference ${q.answer} must be strictly 2 digits in [10, 89]`
      );

      assert.notEqual(q.a % 10, 0, `Operand a (${q.a}) cannot end in 0`);
      assert.notEqual(q.b % 10, 0, `Operand b (${q.b}) cannot end in 0`);
      assert.notEqual((q.a - q.b) % 10, 0, `Difference (${q.a - q.b}) cannot end in 0`);

      if (q.bucket === 'S1') {
        assert.ok((q.a % 10) > (q.b % 10), `S1 question ${q.a}-${q.b} must not borrow ones`);
        assert.equal(q.targetLatencyMs, 3800);
      } else if (q.bucket === 'S2') {
        assert.ok((q.a % 10) < (q.b % 10), `S2 question ${q.a}-${q.b} must borrow ones`);
        assert.equal(q.targetLatencyMs, 6500);
      }
    }
  });

  it('generates a mixed sprint paper with exactly 8 addition and 7 subtraction questions', () => {
    const paper = generateSprintPaper('mixed_paper_1', undefined, 'mixed');

    assert.equal(paper.questions.length, 15, 'Paper must contain exactly 15 questions');
    assert.equal(paper.bucketCounts.B1, 2, 'Must contain exactly 2 B1');
    assert.equal(paper.bucketCounts.B2, 2, 'Must contain exactly 2 B2');
    assert.equal(paper.bucketCounts.B3, 2, 'Must contain exactly 2 B3');
    assert.equal(paper.bucketCounts.B4, 2, 'Must contain exactly 2 B4');
    assert.equal(paper.bucketCounts.S1, 3, 'Must contain exactly 3 S1');
    assert.equal(paper.bucketCounts.S2, 4, 'Must contain exactly 4 S2');
    assert.equal(paper.operatorMode, 'mixed');

    const addQuestions = paper.questions.filter(q => q.operator === '+');
    const subQuestions = paper.questions.filter(q => q.operator === '-');

    assert.equal(addQuestions.length, 8, 'Must have exactly 8 addition questions');
    assert.equal(subQuestions.length, 7, 'Must have exactly 7 subtraction questions');

    for (const q of addQuestions) {
      assert.equal(q.answer, q.a + q.b);
    }
    for (const q of subQuestions) {
      assert.equal(q.answer, q.a - q.b);
      assert.ok(q.answer >= 10 && q.answer <= 89, 'Subtraction answers must be 2 digits');
    }
  });
});

describe('Math Engine — High-Concurrency O(1) Monte Carlo Validation (1,000 Sprints / Mode)', () => {
  it('generates 1,000 consecutive addition sprint sets strictly within sum window [1650, 1750]', () => {
    const iterations = 1000;
    const startTime = performance.now();

    let minObservedSum = Infinity;
    let maxObservedSum = -Infinity;

    for (let i = 0; i < iterations; i++) {
      const paper = generateSprintPaper(undefined, undefined, 'add');

      assert.equal(paper.questions.length, 15);
      assert.equal(paper.bucketCounts.B1, 3);
      assert.equal(paper.bucketCounts.B2, 4);
      assert.equal(paper.bucketCounts.B3, 4);
      assert.equal(paper.bucketCounts.B4, 4);

      if (paper.totalSum < minObservedSum) minObservedSum = paper.totalSum;
      if (paper.totalSum > maxObservedSum) maxObservedSum = paper.totalSum;

      assert.ok(
        paper.totalSum >= 1650 && paper.totalSum <= 1750,
        `Iteration ${i}: Total sum ${paper.totalSum} outside normalized window [1650, 1750]`
      );
    }

    const elapsedMs = performance.now() - startTime;
    const perGenerationMs = elapsedMs / iterations;

    console.log(`\n  ⚡ 1,000 Addition Sprint Benchmark:`);
    console.log(`     Total Duration: ${elapsedMs.toFixed(1)} ms`);
    console.log(`     Average Latency: ${perGenerationMs.toFixed(3)} ms / set`);
    console.log(`     Observed Sum Range: [${minObservedSum}, ${maxObservedSum}] (Target: [1650, 1750])\n`);
  });

  it('generates 1,000 consecutive subtraction sprint sets strictly within diff window [520, 580]', () => {
    const iterations = 1000;
    const startTime = performance.now();

    let minObservedSum = Infinity;
    let maxObservedSum = -Infinity;

    for (let i = 0; i < iterations; i++) {
      const paper = generateSprintPaper(undefined, undefined, 'sub');

      assert.equal(paper.questions.length, 15);
      assert.equal(paper.bucketCounts.S1, 7);
      assert.equal(paper.bucketCounts.S2, 8);

      if (paper.totalSum < minObservedSum) minObservedSum = paper.totalSum;
      if (paper.totalSum > maxObservedSum) maxObservedSum = paper.totalSum;

      assert.ok(
        paper.totalSum >= 520 && paper.totalSum <= 580,
        `Iteration ${i}: Total diff sum ${paper.totalSum} outside normalized window [520, 580]`
      );
    }

    const elapsedMs = performance.now() - startTime;
    const perGenerationMs = elapsedMs / iterations;

    console.log(`\n  ⚡ 1,000 Subtraction Sprint Benchmark:`);
    console.log(`     Total Duration: ${elapsedMs.toFixed(1)} ms`);
    console.log(`     Average Latency: ${perGenerationMs.toFixed(3)} ms / set`);
    console.log(`     Observed Sum Range: [${minObservedSum}, ${maxObservedSum}] (Target: [520, 580])\n`);
  });

  it('generates 1,000 consecutive mixed sprint sets strictly within sum window [1100, 1185]', () => {
    const iterations = 1000;
    const startTime = performance.now();

    let minObservedSum = Infinity;
    let maxObservedSum = -Infinity;

    for (let i = 0; i < iterations; i++) {
      const paper = generateSprintPaper(undefined, undefined, 'mixed');

      assert.equal(paper.questions.length, 15);
      assert.equal(paper.bucketCounts.B1, 2);
      assert.equal(paper.bucketCounts.B2, 2);
      assert.equal(paper.bucketCounts.B3, 2);
      assert.equal(paper.bucketCounts.B4, 2);
      assert.equal(paper.bucketCounts.S1, 3);
      assert.equal(paper.bucketCounts.S2, 4);

      if (paper.totalSum < minObservedSum) minObservedSum = paper.totalSum;
      if (paper.totalSum > maxObservedSum) maxObservedSum = paper.totalSum;

      assert.ok(
        paper.totalSum >= 1100 && paper.totalSum <= 1185,
        `Iteration ${i}: Total sum ${paper.totalSum} outside normalized window [1100, 1185]`
      );
    }

    const elapsedMs = performance.now() - startTime;
    const perGenerationMs = elapsedMs / iterations;

    console.log(`\n  ⚡ 1,000 Mixed Sprint Benchmark:`);
    console.log(`     Total Duration: ${elapsedMs.toFixed(1)} ms`);
    console.log(`     Average Latency: ${perGenerationMs.toFixed(3)} ms / set`);
    console.log(`     Observed Sum Range: [${minObservedSum}, ${maxObservedSum}] (Target: [1100, 1185])\n`);
  });
});

describe('Scoring Engine — Difficulty-Calibrated Speed & Streak Evaluation', () => {
  it('computes calibrated speed bonuses accurately and rejects non-positive/non-finite latencies', () => {
    // Non-positive or non-finite inputs must return 0 bonus
    assert.equal(computeSpeedBonus(0, 3500), 0, 'Zero latency should yield 0 speed bonus');
    assert.equal(computeSpeedBonus(-500, 3500), 0, 'Negative latency should yield 0 speed bonus');
    assert.equal(computeSpeedBonus(NaN, 3500), 0, 'NaN latency should yield 0 speed bonus');
    assert.equal(computeSpeedBonus(1000, 0), 0, 'Zero target latency should yield 0 speed bonus');

    // Valid positive latencies: Bucket 1 (3.5s target)
    assert.equal(computeSpeedBonus(1750, 3500), 50, 'Half target latency should yield 50 speed bonus');
    assert.equal(computeSpeedBonus(3500, 3500), 0, 'Target latency or above should yield 0 speed bonus');
    assert.equal(computeSpeedBonus(4000, 3500), 0, 'Exceeded latency should yield 0 speed bonus');

    // Bucket 4: 8.0s target
    assert.equal(computeSpeedBonus(2000, 8000), 75, '2.0s on 8.0s target yields 75 speed bonus');
    assert.equal(computeSpeedBonus(4000, 8000), 50, '4.0s on 8.0s target yields 50 speed bonus');
  });

  it('applies consecutive streak multipliers accurately', () => {
    assert.equal(getStreakMultiplier(0), 1.0);
    assert.equal(getStreakMultiplier(1), 1.0);
    assert.equal(getStreakMultiplier(2), 1.0);
    assert.equal(getStreakMultiplier(3), 1.1);
    assert.equal(getStreakMultiplier(4), 1.1);
    assert.equal(getStreakMultiplier(5), 1.25);
    assert.equal(getStreakMultiplier(9), 1.25);
    assert.equal(getStreakMultiplier(10), 1.5);
    assert.equal(getStreakMultiplier(15), 1.5);
  });

  it('evaluates correct answers with bonus points and streaks', () => {
    const question = {
      id: 'q_1',
      bucket: 'B4' as const,
      carryType: 'DOUBLE' as const,
      tag: 'DOUBLE TROUBLE',
      a: 58,
      b: 76,
      operator: '+' as const,
      answer: 134,
      targetLatencyMs: 8000
    };

    // Correct answer in 2.0s with existing streak 2 (now streak 3 -> 1.1x)
    const result = evaluateSubmission(question, 134, 2000, 2);

    assert.equal(result.isCorrect, true);
    assert.equal(result.newStreak, 3);
    assert.equal(result.streakMultiplier, 1.1);
    assert.equal(result.basePoints, 100);
    assert.equal(result.speedBonus, 75); // (1 - 2000/8000) * 100 = 75
    // (100 + 75) * 1.1 = 192.5 -> floor = 192
    assert.equal(result.pointsAwarded, 192);
  });

  it('evaluates incorrect answers with penalty and streak reset', () => {
    const question = {
      id: 'q_1',
      bucket: 'B2' as const,
      carryType: 'ONES' as const,
      tag: 'ONES OVERLOAD',
      a: 37,
      b: 28,
      operator: '+' as const,
      answer: 65,
      targetLatencyMs: 5500
    };

    // Wrong answer submitted
    const result = evaluateSubmission(question, 75, 1200, 5);

    assert.equal(result.isCorrect, false);
    assert.equal(result.newStreak, 0, 'Streak must reset to 0');
    assert.equal(result.pointsAwarded, -20, 'Penalty must be -20 points');
    assert.equal(result.streakMultiplier, 1.0);
    assert.equal(result.isAnomaly, false);
  });

  it('flags sub-200ms bot script submissions as speed anomalies', () => {
    const question = {
      id: 'q_1',
      bucket: 'B1' as const,
      carryType: 'NONE' as const,
      tag: 'DIRECT HIT',
      a: 23,
      b: 34,
      operator: '+' as const,
      answer: 57,
      targetLatencyMs: 3500
    };

    // Anomaly: 85ms submission (bot script)
    const anomalyResult = evaluateSubmission(question, 57, 85, 0);
    assert.equal(anomalyResult.isAnomaly, true);
    assert.equal(anomalyResult.anomalyReason, 'SUB_200MS_SPEED_ANOMALY');

    // Anomaly: NaN latency submission (malformed / injected)
    const nanResult = evaluateSubmission(question, 57, NaN, 0);
    assert.equal(nanResult.isAnomaly, true);
    assert.equal(nanResult.anomalyReason, 'INVALID_LATENCY_ANOMALY');

    // Normal: 1400ms submission (human solve)
    const normalResult = evaluateSubmission(question, 57, 1400, 0);
    assert.equal(normalResult.isAnomaly, false);
    assert.equal(normalResult.anomalyReason, undefined);
  });

  it('guarantees deterministic PRNG player shuffle reproducibility given identical seeds', () => {
    const paper = generateSprintPaper();
    const seed = 'roll_CS21045_paper_99a';

    const shuffle1 = shuffleQuestionsForPlayer(paper.questions, seed);
    const shuffle2 = shuffleQuestionsForPlayer(paper.questions, seed);

    assert.equal(shuffle1.length, 15);
    for (let i = 0; i < 15; i++) {
      assert.equal(shuffle1[i].id, shuffle2[i].id, `Index ${i} must match between identical seeds`);
    }

    // Different seed produces different permutation
    const shuffle3 = shuffleQuestionsForPlayer(paper.questions, 'different_seed_EC21088');
    const hasDifference = shuffle1.some((q, i) => q.id !== shuffle3[i].id);
    assert.ok(hasDifference, 'Different seeds must produce different question permutations');
  });
});
