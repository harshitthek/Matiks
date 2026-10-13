# MATIKS HACKATHON ENGINE — PROJECT MEMORY & DECISION LOG

> **Document Version:** 2.0.0  
> **Target Event:** College Hackathon Mini-Game (Speed Math Sprint)  
> **Last Updated:** 2026-10-13  
> **Status:** Production-Ready — Full Stack Implemented, Verified (101/101 Tests), & Hardened

---

## 1. Executive Context & Objectives

* **Project Name:** Matiks Hackathon Edition (Speed Math Sprint)
* **Goal:** A high-octane 2-minute competitive mental math mini-game designed for a college hackathon.
* **Core Philosophy:** 
  1. **Zero Luck Factor:** Strict 4-bucket carry taxonomy, 0/double-5 chunking exclusions, wide-corridor uniform sampling, cross-game non-repetition, and gross sum normalization so every team faces mathematically equivalent cognitive loads.
  2. **Synchronized Team Hive Play (Average Scoring):** All team members must join and signal "READY" before the 2-minute timer triggers. Once started, **all members play individually at the exact same time on their own devices**, and the final team score is the **AVERAGE of all team members' scores**.
  3. **Low-Latency Campus-Resilient Realtime:** Powered by Server-Sent Events (SSE) + REST, bypassing campus Wi-Fi WebSocket throttling/drops with visibility-change resync watchdogs and `sprint_resume` state recovery.
  4. **UFC Cyber-Editorial Aesthetic with Two-Mode Rendering:** Directly modeled after the USAR-FOSS UFC design system (`ufc_website`) — rich tactile showcase in Lobby and Leaderboard, transitioning to an ultra-clean 60fps reflex mode in the 2-Minute Arena.

---

## 2. Immutable Requirement Specifications

| ID | Requirement | Formal Specification | Implementation Decision |
| :--- | :--- | :--- | :--- |
| **REQ-01** | **Math Scope** | 2-digit addition where operands $A, B \in [10, 99]$. Sums can cross 100 up to 198. | Strict 4-Bucket Carry Taxonomy + 0/double-5 exclusions + Gross sum constraint $\sum \in [1650, 1750]$. |
| **REQ-02** | **Difficulty Normalization** | Random questions with zero luck variance and zero cross-game repetition. | Structured Blueprint: 3 No-Carry, 4 Ones-Carry, 4 Tens-Carry, 4 Double-Carry questions sampled across wide $\pm 28$ sum corridors with per-squad & global history deduplication. |
| **REQ-03** | **Format & Duration** | Exactly 15 questions per sprint; total time limit of 120.0 seconds (2 minutes). | Global server-enforced countdown; per-question latency calibrated to carry complexity. |
| **REQ-04** | **Multiplayer Team Model** | Synchronized start; parallel individual play; Team Score = Average of members. | Team members must all toggle "READY" to trigger the 3-2-1 countdown. All members play simultaneously; Team Score = $\frac{1}{N} \sum \text{Score}_i$. |
| **REQ-05** | **Scoring Engine** | Points awarded according to fastest response time with difficulty calibration. | Base $100\text{ pts}$ + Difficulty-Calibrated Speed Bonus ($T_{\text{target}}$: 3.5s to 8.0s) + Streak Multipliers. Incorrect: $-20\text{ pts}$. |
| **REQ-06** | **Real-Time Tech** | **Server-Sent Events (SSE)** strictly instead of WebSockets. | Unidirectional HTTP streaming (`text/event-stream`) for leaderboard, room readiness, timer sync, and live announcements. REST POST for user actions. |
| **REQ-07** | **Panel Architecture** | Three dedicated panels: Admin Panel, Student/Team Panel, and Live Projector Leaderboard. | Role-based authentication/passcodes with clean separate dashboards, granular team pause/recovery, and CSV/JSON exports. |
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
  6. Tie-breaker: Combined average completion time in seconds, followed by alphabetical team name.

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

### ADR-05: SSE Resiliency, Multi-Tab Presence & Background Tab Recovery
* **Context:** College Wi-Fi disconnects, multi-tab usage, and background mobile browser tab suspension.
* **Decision:**
  * Team SSE tokens passed via query parameter (`/api/sse/team/:teamCode?token=xxx`); admin SSE streams use short-lived (60s), single-use tickets (`POST /api/admin/stream-ticket`).
  * Member SSE connections are reference-counted (`memberConnections`) so closing a duplicate tab never marks an active student disconnected.
  * Reconnecting during an active sprint emits `sprint_resume` with full `submissions`, `maxStreak`, `currentScore`, `questionIndex`, and `remainingMs`.
  * `document.visibilityState` listener automatically fetches authoritative clock sync upon tab return.

### ADR-06: Two-Mode Rendering Engine
* **Context:** Running heavy 2D physics during a 120-second speed math sprint can drop frames on budget devices.
* **Decision:**
  * **Showcase Mode (Lobby, Leaderboard, Admin):** Full UFC aesthetic — washi tape, tactile stickers, Ransom lettering, and film grain.
  * **Reflex Mode (Arena):** 60fps locked, zero physics libraries, GPU-accelerated transforms, high-contrast equation cards, instant green perimeter flash.

### ADR-07: Pluggable Club OIDC Adapter Strategy
* **Context:** The USAR FOSS Club website (`fossclub.tech`) is developing an OpenID Connect (OIDC / OAuth) provider.
* **Decision:**
  * Implemented `IAuthProvider` (`server/src/services/authProvider.ts`) with both `LocalHackathonAuthProvider` (`AUTH_MODE=local`) and `ClubOidcAuthProvider` (`AUTH_MODE=club_oidc`) ready for environment-variable switching without core game engine changes.

### ADR-08: Macro-Telemetry Projector & Zero Question Leak Guarantee
* **Context:** 4K stage projectors and spectators continuously consume the `/api/sse/leaderboard` stream.
* **Decision:**
  * The `/api/sse/leaderboard` stream transmits macro-telemetry only: Team Name, Rank, Average Score, Question Progress ($Q/15$), and Member Breakdown. Operands ($A, B$) and answers are never broadcast over public channels.

### ADR-09: Pre-Sorted $\mathcal{O}(1)$ Wide-Corridor Sampling & Cross-Game Non-Repetition
* **Context:** Narrow target-sum binning caused severe pool funneling (e.g., sum `148` in `B4` has only 2 unique pairs: $59+89$ and $69+79$) and repeated questions across rematches.
* **Decision:**
  * Pre-sort each bucket pool by `sum` at startup with `Int32Array` contiguous slice bounds (`startIdxBySum` / `endIdxBySum`).
  * Randomize the 15 bucket slot positions (`orderedBuckets`) and sample uniformly across wide $\pm 28$ sum corridors centered on calibrated bucket means (`B1: 72, B2: 75, B3: 140, B4: 156`, summing to $1,700$) in $0.11\text{ ms}$/paper.
  * Track per-squad canonical pair history (`roomUsedPairKeys`) and rolling global history (`recentGlobalSet`) so consecutive games never repeat questions.

### ADR-10: Wi-Fi Latency Compensation & Hardware Failure Recovery (`[EXCUSE MEMBER]`)
* **Decision:**
  * **Timing Verification Window:** Server tolerates $\pm 350\text{ ms}$ packet jitter against server clock and provides a $+2.5\text{ s}$ transit grace cutoff (`expiresAt + 2500ms`).
  * **Sub-200ms Anomaly Detection:** Submissions under $200\text{ ms}$ trigger an automated anti-cheat flag in the admin feed.
  * **Admin Excuse Control:** `POST /api/admin/teams/:teamCode/excuse-member` dynamically adjusts the score divisor and auto-launches the countdown if all remaining unexcused members in a full `AWAITING_READY` room are already ready.

### ADR-11: Crash-Safe Disk Persistence & Formula-Safe Tournament Exports
* **Decision:**
  * `StatePersistenceService` (`server/src/services/statePersistence.ts`) performs debounced (200ms) atomic `.tmp` + rename writes to `server/data/tournament-state.json` and synchronous flushes on `SIGINT`/`SIGTERM`, restoring active rooms, sprint sessions, timers, leaderboard standings, and audit logs across restarts.
  * Organizers can export standings via `GET /api/admin/export/csv` (with RFC-4180 escaping and spreadsheet formula-injection neutralization) and `GET /api/admin/export/json`.

### ADR-12: Subtraction Operator Expansion ($A - B \ge 10$) & Mixed Mode
* **Context:** Adding subtraction without allowing single-digit answers ($52 - 49 = 3$), which would create cognitive asymmetry with 2-digit addition and break the 2-digit auto-submit reflex.
* **Decision:**
  * Strictly enforce $A - B \ge 10$ with operands $A \in [20, 99]$ and $B \in [10, 89]$ and $A > B$, guaranteeing strictly positive, 2-digit answers ($10 \le A - B \le 89$).
  * Enforce 2-bucket borrow taxonomy: S1 (No Borrow, $A \pmod{10} > B \pmod{10}$) and S2 (Ones Borrow, $A \pmod{10} < B \pmod{10}$).
  * Anti-chunking filters: no 0-endings (operands or differences), no double-5 endings, no duplicates.
  * Mixed mode balances 8 addition ($B_1..B_4$) and 7 subtraction ($S_1..S_2$) questions with uniform cross-team slot distributions.

### ADR-13: 100dvh Zero-Scroll Reflex Arena & User-Gesture Fullscreen Activation
* **Context:** In active sprints on mobile devices, viewport scrolling and address bars distract players and displace the tactile numpad below the fold.
* **Decision:**
  * Hide global header and marquee ticker during active sprints, reclaiming $\sim 60\text{px}$ of vertical height.
  * Root container locked to `100dvh max-h-[100dvh] overflow-hidden overscroll-none` with responsive numpad button padding.
  * Automatic `requestFullscreen()` triggered on user interaction (READY toggle / sprint launch) with prominent manual `[⛶ FULLSCREEN]` fallback in the arena telemetry header.

### ADR-14: Auditorium Ceremony Reveal & Delayed Anti-Screen-Peeking Stream Queue
* **Context:** In a live auditorium, teams near the projector screen could monitor opponents' real-time streaks. Closing the window abruptly left no climax for the audience.
* **Decision:**
  * Public `/api/sse/leaderboard` streams through a configurable sliding FIFO delay queue (`LEADERBOARD_STREAM_DELAY_MS`, default 5s).
  * Admin and Team streams remain zero-latency ($0\text{ ms}$).
  * When tournament window closes, the queue flushes instantly, entering a 3-second score settling freeze followed by an automated 3-2-1 podium reveal (3rd $\to$ 2nd $\to$ 1st), confetti cannon, and synthesized Web Audio fanfare.

### ADR-15: Disk-Backed Dispute Replay Inspector & Memory-Efficient Audit Streaming
* **Context:** High-concurrency tournaments generate deep telemetry per question that can exhaust server heap memory if held in RAM.
* **Decision:**
  * Detailed question telemetry is serialized directly to disk (configured by `AUDIT_LOG_DIR`, defaulting to `server/.data/audits/{sessionId}.json`) upon session completion and retained in memory until squad rematch reset.
  * Admin Dispute Replay Inspector (`GET /api/admin/replay/:sessionId`) streams audit chronologies on-demand into an interactive modal in `/admin`.
  * CSV export includes full per-member latency quantiles, anomaly counts, and cheat reason tags.

### ADR-16: SSE Monotonic 64-bit Circular Buffer Replay & Epoch Desynchronization Recovery
* **Context:** Wi-Fi jitter causes brief socket disconnects, while server restarts invalidate client-side sequence counters.
* **Decision:**
  * Server tags all SSE events with epoch-prefixed monotonic IDs (`id: <epoch>:<seq>\n`) and maintains a 100-event circular buffer per channel.
  * Clients pass `Last-Event-ID` on reconnection to replay missed events without full state re-fetch.
  * Process boots with a numeric Unix-second startup epoch; if the client's epoch mismatches or the sequence number falls outside the retained window, the server emits a clean `stream_resync` event to trigger snapshot synchronization.
  * Turnkey Caddy and Nginx HTTP/2 configs provided in `server/deploy/` with `X-Accel-Buffering: no`.

### ADR-17: Low-Cardinality Prometheus Metrics & Structured Monotonic Request Logging
* **Context:** Production monitoring without third-party agent bloat or metric cardinality explosion.
* **Decision:**
  * Zero-dependency Prometheus exposition renderer at `/metrics` (timing-safe bearer token authentication).
  * Strict route normalization (`:teamCode`, `:sessionId`, `:identifier` templates) and HTTP method normalization preventing label cardinality explosion.
  * SSE streams excluded from request duration histogram to keep latency quantiles accurate.
  * Monotonic request ID generator (`req_${timestamp}_${counter}`) binding correlation IDs with query-stripped URL paths.

---

## 4. Phase Execution Roadmap & Lifecycle State

| Phase | Description | Status | Notes |
| :--- | :--- | :--- | :--- |
| **Phase 0** | Scaffolding, Monorepo Setup & UFC Design Tokens | **Completed** | Express + TypeScript backend, React 19 + Vite + Tailwind v4 frontend, GitHub Actions CI. |
| **Phase 1** | Math Generation & Difficulty Normalization | **Completed** | Pre-sorted `Int32Array` wide-corridor $\mathcal{O}(1)$ generator ($0.11\text{ms}$/paper), cross-game non-repetition, 13/13 tests. |
| **Phase 2** | Real-time SSE Hub & State Machine | **Completed** | Room lifecycle, atomic ready gate, rematch reset, captain succession on leave, `sprint_resume` recovery. |
| **Phase 3** | Frontend UFC UI Primitives & Team Lobby | **Completed** | Tactile sticker UI, Ransom tiles, washi tape, custom `ConfirmModal`, browser history navigation. |
| **Phase 4** | 2-Minute Sprint Arena (Reflex Mode) | **Completed** | 60fps locked, tactile numpad with Thumb-Enter, Zetamac keyboard listeners, Web Audio SFX, teammate HUD. |
| **Phase 5** | Projector Leaderboard & Admin Command Center | **Completed** | 4K projector podium, room pause/resume/excuse, single-use admin SSE tickets, CSV & JSON exports. |
| **Phase 6** | Chaos, QA Regression & Campus Wi-Fi Load Testing | **Completed** | 100 SSE streams, 1,350 submissions, chaos jitter, QA regression, smoke testing. |
| **Phase 7** | Pluggable Club OIDC Adapter | **Completed** | `LocalHackathonAuthProvider` & `ClubOidcAuthProvider` implemented and verified (`authProvider.test.ts`). |
| **Phase 8** | Subtraction Borrow Taxonomy ($A - B \ge 10$) & Mixed Mode | **Completed** | S1 (No Borrow), S2 (Ones Borrow), deterministic sum variance, dynamic operand badges. |
| **Phase 9** | 100dvh Zero-Scroll Arena Lock & Drag-Strip Racer HUD | **Completed** | Header collapsing, responsive numpad, teammate progress racers, post-sprint cognitive diagnostics. |
| **Phase 10** | Auditorium Ceremony & Anti-Peeking Stream Queue | **Completed** | 3s settling freeze, automated 3-2-1 podium reveal, confetti barrage, delayed public SSE queue. |
| **Phase 11** | Disk-Backed Dispute Replay & Full Audit Telemetry | **Completed** | Admin dispute replay modal, disk streaming, RFC-4180 CSV export with latency quantiles. |
| **Phase 12** | SSE Monotonic Replay Buffer & HTTP/2 Reverse Proxy | **Completed** | `Last-Event-ID` circular replay, epoch desync recovery, turnkey Caddy & Nginx configs. |
| **Phase 13** | Prometheus Metrics & Structured Request Logging | **Completed** | Low-cardinality `/metrics`, timing-safe auth, monotonic request IDs, NDJSON logging. 101/101 total tests passing. |

