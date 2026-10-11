# MATIKS HACKATHON ENGINE — PROJECT MEMORY & DECISION LOG

> **Document Version:** 1.2.0  
> **Target Event:** College Hackathon Mini-Game (Speed Math Sprint)  
> **Last Updated:** 2026-10-11  
> **Status:** Upgraded Architecture & Requirements Freeze (Pre-Implementation)

---

## 1. Executive Context & Objectives

* **Project Name:** Matiks Hackathon Edition (Speed Math Sprint)
* **Goal:** A high-octane 2-minute competitive mental math mini-game designed for a college hackathon.
* **Core Philosophy:** 
  1. **Zero Luck Factor:** Strict 4-bucket carry taxonomy, 0/double-5 chunking exclusions, and gross sum normalization so every team faces mathematically equivalent cognitive loads.
  2. **Synchronized Team Hive Play (Average Scoring):** All team members must join and signal "READY" before the 2-minute timer triggers. Once started, **all members play individually at the exact same time on their own devices**, and the final team score is the **AVERAGE of all team members' scores**.
  3. **Low-Latency Campus-Resilient Realtime:** Powered by Server-Sent Events (SSE) + REST, bypassing campus Wi-Fi WebSocket throttling/drops with visibility-change resync watchdogs.
  4. **UFC Cyber-Editorial Aesthetic with Two-Mode Rendering:** Directly modeled after the USAR-FOSS UFC design system (`ufc_website`) — rich tactile showcase in Lobby and Leaderboard, transitioning to an ultra-clean 60fps reflex mode in the 2-Minute Arena.

---

## 2. Immutable Requirement Specifications

| ID | Requirement | Formal Specification | Implementation Decision |
| :--- | :--- | :--- | :--- |
| **REQ-01** | **Math Scope** | 2-digit addition where operands $A, B \in [10, 99]$. Sums can cross 100 up to 198. | Strict 4-Bucket Carry Taxonomy + 0/double-5 exclusions + Gross sum constraint $\sum \in [1650, 1750]$. |
| **REQ-02** | **Difficulty Normalization** | Random questions with zero luck variance. | Structured Blueprint: exactly 3 No-Carry, 4 Ones-Carry, 4 Tens-Carry, 4 Double-Carry questions per set. |
| **REQ-03** | **Format & Duration** | Exactly 15 questions per sprint; total time limit of 120.0 seconds (2 minutes). | Global server-enforced countdown; per-question latency calibrated to carry complexity. |
| **REQ-04** | **Multiplayer Team Model** | Synchronized start; parallel individual play; Team Score = Average of members. | Team members must all toggle "READY" to trigger the 3-2-1 countdown. All members play simultaneously; Team Score = $\frac{1}{N} \sum \text{Score}_i$. |
| **REQ-05** | **Scoring Engine** | Points awarded according to fastest response time with difficulty calibration. | Base $100\text{ pts}$ + Difficulty-Calibrated Speed Bonus ($T_{\text{target}}$: 3.5s to 8.0s) + Streak Multipliers. Incorrect: $-20\text{ pts}$. |
| **REQ-06** | **Real-Time Tech** | **Server-Sent Events (SSE)** strictly instead of WebSockets. | Unidirectional HTTP streaming (`text/event-stream`) for leaderboard, room readiness, timer sync, and live announcements. REST POST for user actions. |
| **REQ-07** | **Panel Architecture** | Three dedicated panels: Admin Panel, Student/Team Panel, and Live Projector Leaderboard. | Role-based authentication/passcodes with clean separate dashboards and granular team pause/recovery. |
| **REQ-08** | **Design Language** | USAR-FOSS Club Website (`USAR-FOSS/ufc_website`). | Neo-brutalist tactile stickers, `--ink` (`#090c0a`), `--signal` (`#2ee58f`), `--amber`, `--ember`, `--butter`, Bricolage Grotesque + Space Mono. |

---

## 3. Key Architectural Decisions (ADRs)

### ADR-01: Advanced 4-Bucket Carry Taxonomy with Entropy Normalization
* **Context:** Initial 4-bucket grouping was vulnerable to operand magnitude skew (e.g. $89+98$ vs $59+68$) and instant chunking on multiples of 5 ($45+35=80$ solved in $<0.8\text{s}$).
* **Decision:**
  1. Enforce exact distribution: 3 No-Carry (B1), 4 Ones-Carry (B2), 4 Century-Carry (B3), 4 Double-Carry (B4).
  2. Disallow operands ending in `0` ($A \pmod{10} \ne 0 \land B \pmod{10} \ne 0$).
  3. Disallow questions where both operands end in `5` ($A \pmod 5 = 0 \land B \pmod 5 = 0$).
  4. Constrain the total gross sum across all 15 questions to $\sum_{i=1}^{15} \text{Sum}_i \in [1650, 1750]$.

### ADR-02: Parallel Team Play with Average Score Aggregation
* **Context:** A shared team input on a single screen leads to race conditions, input locking, and passive teammates.
* **Decision:**
  1. All team members must join the lobby and lock their "READY" toggle.
  2. The server fires a synchronized 3-second countdown to all members' devices simultaneously.
  3. **Each team member plays the 15-question sprint individually on their own device** at the exact same time.
  4. Live teammate status is displayed in a non-intrusive header HUD (`Rohan 🟢 Q7 | Priya 🟢 Q9 | Aarav 🟡 Q6`).
  5. The final official team score on the leaderboard is the **mathematical average of all team members' scores**:
     $$\text{Team Score} = \frac{\sum_{i=1}^N \text{Score}_i}{N}$$
  6. Tie-breaker: Combined average completion time in milliseconds.

### ADR-03: Difficulty-Calibrated Speed Scoring ($T_{\text{target}}$) & Streak Multipliers
* **Context:** A flat $8.0\text{ s}$ baseline penalizes players for solving inherently harder double-carry questions.
* **Decision:**
  * Base points: $100\text{ pts}$ per correct answer ($-20\text{ pts}$ for incorrect).
  * Speed bonus uses category-calibrated latency targets:
    * **Bucket 1 (No Carry):** $T_{\text{target}} = 3.5\text{ s}$
    * **Bucket 2 (Ones Carry):** $T_{\text{target}} = 5.5\text{ s}$
    * **Bucket 3 (Century Carry):** $T_{\text{target}} = 6.0\text{ s}$
    * **Bucket 4 (Double Carry):** $T_{\text{target}} = 8.0\text{ s}$
  * Formula:
    $$\text{Speed Bonus} = \max\left(0, \left\lfloor 100 \times \left(1 - \frac{\Delta t}{T_{\text{target}}}\right) \right\rfloor\right)$$
  * **Consecutive Streak Multipliers:** 3-in-a-row ($1.1\times$), 5-in-a-row ($1.25\times$), 10-in-a-row ($1.5\times$).

### ADR-04: Device-Adaptive Input Architecture & Universal Explicit Submit
* **Context:**
  1. Focusing input elements on mobile devices triggers OS keyboards, covering 50% of the screen.
  2. Auto-submitting on 3 digits while requiring Enter on 2 digits (since sums range from 20 to 198) disrupts muscle memory and leads to accidental submissions of subsequent questions.
* **Decision:**
  * **Touch screens:** Input elements use `inputMode="none"`. Mobile OS keyboards are completely suppressed. Players interact strictly via the custom UFC on-screen tactile numpad with an oversized neon green Thumb-Enter (`ENTER ↵`).
  * **Desktop/Laptops:** Global `keydown` listeners capture physical numerical keys and `Enter` / `Spacebar`.
  * **Universal Explicit Submit:** In line with esports math competition standards (Zetamac), every answer requires an explicit submit action (`Spacebar`/`Enter` on desktop, oversized green `ENTER ↵` on mobile). Auto-submit on 3 digits is strictly disallowed.

### ADR-05: SSE Resiliency & Background Tab Recovery
* **Context:** College Wi-Fi disconnects and background mobile browser tab suspension.
* **Decision:**
  * Tokens passed via query parameter: `/api/sse/team/:teamCode?token=xxx`.
  * Client monitors `:keepalive` heartbeat comments. If missing for $>20\text{ s}$, it closes and reconnects.
  * `document.visibilityState` listener automatically fetches authoritative clock sync upon tab return.

### ADR-06: Two-Mode Rendering Engine
* **Context:** Running heavy 2D physics during a 120-second speed math sprint can drop frames on budget devices.
* **Decision:**
  * **Showcase Mode (Lobby, Leaderboard, Admin):** Full UFC aesthetic — washi tape, Matter.js falling stickers, Ransom lettering, and film grain.
  * **Reflex Mode (Arena):** 60fps locked, zero physics libraries, GPU-accelerated transforms, high-contrast equation cards, instant green perimeter flash.

### ADR-07: Pluggable Club OIDC Adapter Strategy
* **Context:** The USAR FOSS Club website (`fossclub.tech`) is developing an OpenID Connect (OIDC / OAuth) provider. In the final stage, Matiks must authenticate against the club's OIDC endpoints to verify if the player is an official club member or registered hackathon team participant, and grant permissions accordingly. However, the club OIDC server is currently incomplete.
* **Decision:**
  * Build an abstract `IAuthProvider` interface with pluggable implementations:
    1. **Phase 1 (Current Standalone Adapter):** Fast, frictionless local hackathon auth (Roll Number + Name + Team Code + Admin Secret), providing mockable membership flags and instant onboarding.
    2. **Phase 2 (Club OIDC Adapter):** Ready for drop-in activation when the club team finalizes the OIDC service. Communicates with `https://www.fossclub.tech/api/auth/*` to exchange tokens, fetch profile claims (`isClubMember`, `teamRoster`, `githubId`), and enforce role permissions without changing the core game logic.

### ADR-08: Macro-Telemetry Projector & Zero Question Leak Guarantee
* **Context:** 4K stage projectors and spectators continuously consume the `/api/sse/leaderboard` stream. If problem operands or answer keys were transmitted in public SSE channels, students in the auditorium could pre-solve questions or screen-peek.
* **Decision:**
  * The `/api/sse/leaderboard` stream transmits macro-telemetry only: Team Name, Rank, Average Score, Question Progress ($Q/15$), and Streak Flame.
  * Operands ($A, B$) and answers are strictly isolated to the authenticated individual sprint session and are never broadcast over public or team-wide channels.

### ADR-09: $\mathcal{O}(1)$ Residual-Targeted Question Blueprint Generation
* **Context:** Blind rejection sampling for gross sum normalization ($\sum_{i=1}^{15} S_i \in [1650, 1750]$) can cause random CPU spikes and high loop counts under concurrent multi-team load.
* **Decision:**
  * Deterministic $\mathcal{O}(1)$ residual-targeted algorithm:
    1. Generate 12 questions analytically across the 4 buckets (3 in B1, 3 in B2, 3 in B3, 3 in B4).
    2. Calculate sum of first 12: $S_{12} = \sum_{i=1}^{12} (A_i + B_i)$.
    3. Compute residual required: $R = 1700 - S_{12}$.
    4. Select the final 3 questions (1 in B2, 1 in B3, 1 in B4) targeting partition of $R$ within $\pm 50$ in $\mathcal{O}(1)$ time ($<1\text{ ms}$).
  * Commutative uniqueness check: pairs $(A, B)$ and $(B, A)$ are deduplicated via canonical unordered tuple keys `[min(A,B), max(A,B)]`.

### ADR-10: Wi-Fi Latency Compensation & Hardware Failure Recovery (`[EXCUSE MEMBER]`)
* **Context:** 
  1. Campus Wi-Fi packet transit jitter can unfairly penalize last-second submissions.
  2. A teammate's device crash or dead battery would artificially depress the team average score if divided by full roster count.
* **Decision:**
  * **Timing Verification Window:** Client submits measured `clientDeltaMs` and `clientTimestamp`. Server tolerates $\pm 350\text{ ms}$ packet jitter against server clock and provides a $+2.5\text{ s}$ transit grace cutoff for submissions made before the $120.0\text{ s}$ deadline.
  * **Sub-200ms Anomaly Detection:** Submissions under $200\text{ ms}$ trigger an automated anti-cheat flag in the admin feed.
  * **Admin Excuse Control:** Admin dashboard features an `[EXCUSE MEMBER]` control (`POST /api/admin/teams/:teamCode/excuse-member`). Excusing a member removes them from the average divisor (e.g. dividing by 2 instead of 3) while logging an immutable audit record with justification.
