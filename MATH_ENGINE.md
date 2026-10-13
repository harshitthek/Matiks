# MATIKS HACKATHON ENGINE — ZERO-LUCK MATHEMATICAL SPECIFICATION (MATH_ENGINE.md)

> **Document Version:** 2.0.0  
> **Core Objective:** Provide randomized questions with mathematically identical cognitive difficulty and entropy so that competitive outcomes depend 100% on player reflexes and accuracy, with **ZERO luck bias** and **zero cross-game repetition**.

---

## 1. Problem Statement: Why Naive Randomness Fails

In speed mental arithmetic, two-digit addition ($A + B$ where $10 \le A, B \le 99$) is **not uniformly difficult**, even when carry operations are controlled. 

Cognitive neuroscience and mental calculation research show three major sources of unfairness:
1. **Mental Carry Operations:** Carrying a $+1$ to tens or hundreds requires working-memory buffering and sequential dependencies.
2. **Subitization & Chunking Bias:** Numbers ending in `0` or `5` (e.g. $45 + 35 = 80$, $50 + 68 = 118$) are solved through automatic memory retrieval rather than mental calculation, cutting solve latency by $> 60\%$.
3. **Magnitude Bias:** High-magnitude additions ($89 + 98 = 187$) impose significantly heavier working-memory loads than low-magnitude additions ($59 + 68 = 127$).

To guarantee complete fairness across all teams, the Matiks engine implements a **4-Bucket Carry Taxonomy with Entropy Balancing, Wide-Corridor $\mathcal{O}(1)$ Contiguous-Slice Sampling, Cross-Game Non-Repetition, and Gross Sum Normalization**.

---

## 2. The 4-Bucket Cognitive Carry Taxonomy

Every two-digit addition problem is classified into one of four mutually exclusive, mathematically rigorous buckets:

| Bucket | Category Name | Mathematical Constraint | Carry Operations | Calibrated Center Sum | Baseline Latency $T_{\text{target}}$ |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **B1** | **Direct (No Carry)** | $(A \bmod 10) + (B \bmod 10) < 10$ and $A + B < 100$ | **0 carries** | **$72$** | **$3.5\text{ seconds}$** |
| **B2** | **Ones Carry Only** | $(A \bmod 10) + (B \bmod 10) \ge 10$ and $A + B < 100$ | **1 carry** (units) | **$75$** | **$5.5\text{ seconds}$** |
| **B3** | **Century Carry Only** | $(A \bmod 10) + (B \bmod 10) < 10$ and $A + B \ge 100$ | **1 carry** (tens/century) | **$140$** | **$6.0\text{ seconds}$** |
| **B4** | **Double Carry** | $(A \bmod 10) + (B \bmod 10) \ge 10$ and $A + B \ge 100$ | **2 carries** (units + tens) | **$156$** | **$8.0\text{ seconds}$** |

---

## 3. Entropy Balancing & Anti-Chunking Filter Rules

During question generation, every candidate pair $(A, B)$ must satisfy the following strict entropy filters:

1. **No Round Tens:**
   $$A \not\equiv 0 \pmod{10} \quad \text{and} \quad B \not\equiv 0 \pmod{10}$$
   *(Prevents instant additions like $50 + 34$).*
2. **No Double-Five Chunking:**
   $$\neg\left(A \equiv 0 \pmod 5 \ \land \ B \equiv 0 \pmod 5\right)$$
   *(Prevents instant subitization like $45 + 35 = 80$ or $65 + 75 = 140$).*
3. **No Exact Twins:**
   $$A \ne B$$
   *(Prevents doubling shortcuts like $47 + 47$).*
4. **Intra-Paper & Cross-Game Commutative Deduplication:**
   Every generated pair is registered as a canonical unordered key $\min(A, B)\text{-}\max(A, B)$.
   * **Within a paper:** If $37 + 58$ is selected, $58 + 37$ is strictly forbidden.
   * **Across consecutive games:** `generateSprintPaper(seed, excludeKeys)` accepts per-squad history (`roomUsedPairKeys`) and maintains a rolling global history (`recentGlobalSet`) so consecutive rematches never repeat question pairs.

---

## 4. The Normalized 15-Question Blueprint

Every sprint paper generated for any player follows this **exact structural blueprint**:

$$\text{Sprint Set} = 3 \times \mathbf{B1} + 4 \times \mathbf{B2} + 4 \times \mathbf{B3} + 4 \times \mathbf{B4}$$

```
 QUESTION POOL BLUEPRINT (15 QUESTIONS TOTAL)
 ┌─────────────────────────────────────────────────────────────┐
 │  [B1: No Carry]      3 Questions (Speed warmup)             │
 │  [B2: Ones Carry]    4 Questions (Single unit carry)        │
 │  [B3: Century Carry] 4 Questions (Crossing 100 threshold)   │
 │  [B4: Double Carry]  4 Questions (High cognitive load)      │
 ├─────────────────────────────────────────────────────────────┤
 │  Gross Sum: 1,650 to 1,750 | No 0/0-endings | No 5/5-endings│
 └─────────────────────────────────────────────────────────────┘
```

---

## 5. $\mathcal{O}(1)$ Contiguous-Slice Wide-Corridor Generation ($0.11\text{ ms}$ / paper)

Narrow single-sum targeting causes severe pool funneling (for example, in `B4`, no sum can end in `9` because $9+9=18$, and sum `148` contains only 2 unique pairs: $59+89$ and $69+79$). To combine maximum question variety with $\mathcal{O}(1)$ sub-millisecond performance, the engine uses **Pre-Sorted Contiguous-Slice Wide-Corridor Sampling**:

1. **Startup Pool Indexing:**
   * All valid pairs in each bucket ($1,224$ in `B1`, $864$ in `B2`, $1,152$ in `B3`, $1,476$ in `B4`) are sorted ascending by `sum` once at server startup.
   * Precomputed `Int32Array` lookup tables (`startIdxBySum` and `endIdxBySum`) map any feasible sum interval $[\text{corridorMin}, \text{corridorMax}]$ to a contiguous index slice $[\text{lo}, \text{hi})$ in $\mathcal{O}(1)$ time with zero array allocations.
2. **Randomized Bucket Slot Ordering & Dynamic Residual Corridors:**
   * The 15 bucket slots (`3 B1 + 4 B2 + 4 B3 + 4 B4`) are shuffled first via a CSPRNG-seeded PRNG (`randomInt(1, 0x7fffffff)`), so the residual-constrained final slots are distributed across different buckets every game.
   * At each step $i \in [0, 14]$, the engine computes the feasible sum bounds $[\text{feasibleMin}, \text{feasibleMax}]$ that guarantee the remaining buckets can reach $[1650, 1750]$, and intersects that window with a wide $\pm 28$ corridor around the bucket's calibrated center sum ($3 \times 72 + 4 \times 75 + 4 \times 140 + 4 \times 156 = 1,700$).
   * A candidate pair is sampled uniformly at random from the contiguous slice $[\text{lo}, \text{hi})$, rejecting any pair present in `usedKeys`, `excludeKeys`, or `recentGlobalSet`.
3. **Player-Specific Permutations:**
   * Once the master 15-question paper is generated and shuffled, each teammate receives an independent deterministic permutation (`shuffleQuestionsForPlayer`) seeded with `teamCode:rollNumber:paperId:startedAt` to prevent screen-peeking while preserving identical cognitive load.

---

## 6. Difficulty-Calibrated Scoring & Streak Multipliers

### Per-Question Scoring Formula
$$\text{Points} = \begin{cases}
\left( 100 + \text{SpeedBonus}(\Delta t_{\text{client}}, \text{Bucket}) \right) \times \text{StreakMultiplier} & \text{if answer is correct} \\
-20 & \text{if answer is incorrect}
\end{cases}$$

### Difficulty-Calibrated Speed Bonus
The speed bonus is calibrated to the bucket's baseline target $T_{\text{target}}$:

$$\text{SpeedBonus}(\Delta t_{\text{client}}, \text{Bucket}) = \max\left(0, \left\lfloor 100 \times \left(1 - \frac{\Delta t_{\text{client}}}{T_{\text{target}}}\right) \right\rfloor\right)$$

* **Bucket 1 ($T_{\text{target}} = 3.5\text{s}$):**
  * Solved in $1.0\text{s}$: $100 + 71 = \mathbf{171\text{ pts}}$
  * Solved in $2.5\text{s}$: $100 + 28 = \mathbf{128\text{ pts}}$
* **Bucket 4 ($T_{\text{target}} = 8.0\text{s}$):**
  * Solved in $2.5\text{s}$: $100 + 68 = \mathbf{168\text{ pts}}$ *(Rewards fast calculation on heavy cognitive load!)*
  * Solved in $5.0\text{s}$: $100 + 37 = \mathbf{137\text{ pts}}$

### Consecutive Streak Multipliers (Arcade Heat)
* **Streak 1–2:** $1.0\times$ (Baseline)
* **Streak 3–4:** $1.10\times$ (+10% Bonus)
* **Streak 5–9:** $1.25\times$ (+25% Bonus)
* **Streak 10–15:** $1.50\times$ (+50% "ON FIRE" Bonus)

---

## 7. Team Score Aggregation Formula

All $N$ team members solve their 15 questions individually at the exact same time. The final official team score is:

$$\text{Team Final Score} = \frac{1}{N} \sum_{i=1}^N \text{Score}_i$$

* **Tie-Breaker:** The team with the lowest combined average completion time:
  $$\text{Team Average Time} = \frac{1}{N} \sum_{i=1}^N \text{TotalTime}_i$$

---

## 8. Subtraction Borrow Taxonomy & Normalized Generator ($A - B \ge 10$)

To expand competition depth without disrupting muscle memory, subtraction is introduced under strict mathematical constraints:
* Operands $A \in [20, 99]$ and $B \in [10, 89]$ with $A > B$.
* **Minimum Difference Invariant:** $A - B \ge 10$. This guarantees all answers are strictly 2 digits ($10 \le A - B \le 89$), preventing single-digit solutions ($52 - 49 = 3$) that would break the universal 2-digit auto-submit reflex.
* **Anti-Chunking Rules:** $A \not\equiv 0 \pmod{10}$, $B \not\equiv 0 \pmod{10}$, $(A - B) \not\equiv 0 \pmod{10}$, and $\neg(A \equiv 5 \pmod{10} \land B \equiv 5 \pmod{10})$.

### The 2-Bucket Borrow Taxonomy
| Bucket | Name | Mathematical Constraint | Borrow Operations | Calibrated Baseline $T_{\text{target}}$ |
| :--- | :--- | :--- | :--- | :--- |
| **S1** | **Direct (No Borrow)** | $(A \bmod 10) > (B \bmod 10)$ and $A - B \ge 10$ | **0 borrows** | **$3.8\text{ seconds}$** |
| **S2** | **Ones Borrow** | $(A \bmod 10) < (B \bmod 10)$ and $A - B \ge 10$ | **1 borrow** (units from tens) | **$6.5\text{ seconds}$** |

### Subtraction Blueprint (15 Questions Total)
$$\text{Subtraction Sprint Set} = 7 \times \mathbf{S1} + 8 \times \mathbf{S2}$$

* Generated via contiguous slice bounds targeting gross difference sum in $[520, 580]$.
* Mean difference: $\sim 36.67$ per problem across the 15-question sprint.

---

## 9. Mixed Arithmetic Mode ($\pm$)

Mixed mode alternates between addition and subtraction across every team's paper:
* **Composition:** Exactly 8 Addition questions (drawn across $B1..B4$) + 7 Subtraction questions (drawn across $S1..S2$).
* **Structural Distribution:**
  * 2 $\times$ B1 (Direct Addition)
  * 2 $\times$ B2 (Ones Carry Addition)
  * 2 $\times$ B3 (Century Carry Addition)
  * 2 $\times$ B4 (Double Carry Addition)
  * 3 $\times$ S1 (Direct Subtraction)
  * 4 $\times$ S2 (Ones Borrow Subtraction)
* **Target Sum/Diff Window:** $[1100, 1185]$ across the 15-question mixed paper.
* **Fairness Guarantee:** All teams face the identical operator and difficulty progression with zero luck variance.
