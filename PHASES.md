# MATIKS HACKATHON ENGINE — IMPLEMENTATION ROADMAP (PHASES.md)

> **Document Version:** 1.2.0  
> **Purpose:** Sequential, phase-by-phase engineering execution plan for developing, testing, and deploying the Matiks Hackathon Mini-Game.  
> **Status:** Roadmap Approved (Pre-Implementation)

---

## 1. Overview of Execution Phases

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 PHASE EXECUTION TIMELINE                               │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ PHASE 0 │ Scaffolding, Monorepo Setup & UFC Design Tokens                              │
│ PHASE 1 │ Math Engine (4-Bucket Taxonomy & O(1) Residual-Targeted Generator)           │
│ PHASE 2 │ Realtime SSE Hub, Team State Machine & Average Scoring Engine                │
│ PHASE 3 │ Frontend UFC Primitives & Team Lobby Panel (Showcase Mode)                   │
│ PHASE 4 │ 2-Minute Sprint Combat Arena (60fps Reflex Mode & Universal Explicit Submit) │
│ PHASE 5 │ 4K Auditorium Projector Leaderboard & Admin Command Center                   │
│ PHASE 6 │ Multi-Client Chaos Load Testing & Campus Wi-Fi Verification                  │
│ PHASE 7 │ Pluggable Club OIDC Adapter Integration (Final Drop-in)                      │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Detailed Phase Specifications

### Phase 0: Workspace Scaffolding & Core Foundations
* **Objectives:** Establish project structure, dependencies, TypeScript configurations, and design primitives.
* **Deliverables:**
  * Node.js Express backend (`server/`) with TypeScript, CORS, and Express router.
  * React + Vite frontend (`client/`) configured with Tailwind CSS.
  * Color tokens (`--ink: #090c0a`, `--signal: #2ee58f`, `--amber`, `--ember`, `--butter`) and fonts (`Bricolage Grotesque`, `DM Sans`, `Space Mono`) imported from `USAR-FOSS/ufc_website`.
* **Exit Criteria:** Both client and server run locally on `localhost:5173` and `localhost:3001` with zero build errors.

---

### Phase 1: Math Engine & Zero-Luck Normalization
* **Objectives:** Implement the mathematical core that guarantees identical cognitive difficulty across all teams.
* **Deliverables:**
  * `mathEngine.ts`: 4-Bucket Carry Taxonomy generator:
    * 3 Questions: Bucket 1 (Direct / No Carry, $T_{\text{target}} = 3.5\text{s}$)
    * 4 Questions: Bucket 2 (Ones Carry Only, $T_{\text{target}} = 5.5\text{s}$)
    * 4 Questions: Bucket 3 (Century Carry Only, $T_{\text{target}} = 6.0\text{s}$)
    * 4 Questions: Bucket 4 (Double Carry, $T_{\text{target}} = 8.0\text{s}$)
  * Anti-chunking entropy filters (disallow multiples of 10, disallow double-5 endings, disallow identical operands, commutative deduplication).
  * $\mathcal{O}(1)$ Residual-Targeted Question Blueprint Generator: Generates 12 questions, computes residual $R = 1700 - S_{12}$, and selects final 3 questions analytically within $\pm 50$ in $\mathcal{O}(1)$ time ($<1\text{ ms}$).
  * Automated test suite (`carryTaxonomy.test.ts`) validating 1,000 generated sets for 0% variance in bucket distribution.
* **Exit Criteria:** Math generator passes 100% of test assertions.

---

### Phase 2: Realtime SSE Hub & Team State Machine
* **Objectives:** Build the real-time networking engine and synchronized team room controller.
* **Deliverables:**
  * `sseHub.ts`: Unidirectional Server-Sent Events router with `:keepalive\n\n` 15-second heartbeats and `X-Accel-Buffering: no`.
  * `roomManager.ts`: Team room state machine:
    * Team registration & member join handling.
    * Atomic **"READY"** lock: Sprint remains locked until all $N$ team members toggle ready.
    * Synchronized countdown broadcaster ($3 \to 2 \to 1 \to \text{START}$).
  * `scoringEngine.ts`: Difficulty-calibrated speed score calculator and streak multipliers ($1.1\times, 1.25\times, 1.5\times$).
  * Team Average score aggregator and sorted leaderboard priority queue.
* **Exit Criteria:** Multi-client test confirms all members in a room receive the `sprint_start` event on the exact same millisecond.

---

### Phase 3: Frontend UFC UI Primitives & Team Lobby (Showcase Mode)
* **Objectives:** Construct the visual identity and team lobby panel.
* **Deliverables:**
  * UI Primitives:
    * Chunky tactile sticker buttons (`.btn`) with $2.5\text{px}$ solid border, $4\text{px}$ drop shadow, and rotating arrow disc (`.disc`).
    * Slanted washi tape strips (`.tape`).
    * Procedural SVG film grain overlay (`.grain`).
    * Live pulsing radar dot (`.ping-dot`).
    * Scissor-cut Ransom Note lettering component (`Ransom.tsx`).
  * Team & Student Lobby (`/team/:teamCode`):
    * Team Code chip and live connected member roster.
    * Tactile "READY" toggle button transitioning from ghost to neon signal green.
    * Synchronized countdown overlay displaying $\mathbf{3 \to 2 \to 1 \to START!}$ in animated Ransom paper tiles.
* **Exit Criteria:** Teammates can create a room, join on mobile/desktop, see live radar dots update over SSE, and trigger the countdown.

---

### Phase 4: 2-Minute Sprint Arena (60fps Reflex Mode)
* **Objectives:** Build the high-performance math combat interface with zero input lag.
* **Deliverables:**
  * Two-Mode Rendering: Arena runs in **Reflex Mode** (zero physics libraries, GPU-accelerated transforms, 60fps locked).
  * Device-Adaptive Input (Universal Explicit Submit):
    * Mobile: Virtual OS keyboard suppressed (`inputMode="none"`). Custom tactile on-screen numpad with oversized neon green Thumb-Enter (`ENTER ↵`). Auto-submit is strictly disabled to preserve muscle memory across 2-digit and 3-digit answers.
    * Desktop: Global `keydown` physical numerical key and `Enter` or `Spacebar` listener (Zetamac esport standard).
  * Question Display: Large, high-contrast equation card in Bricolage Grotesque (800 weight).
  * Realtime Clock: Millisecond-precision timer in Space Mono tabular figures.
  * Instant Visual Feedback: Screen perimeter flashes signal green (`+184 PTS`), shakes horizontally on wrong answers (`-20 PTS`).
  * Live Teammate HUD: Top pills displaying partners' live progress (`Rohan 🟢 Q8 | Priya 🟢 Q9`).
* **Exit Criteria:** Player can complete 15 questions with smooth transitions and sub-16ms frame times on mobile.

---

### Phase 5: Projector Leaderboard & Admin Command Center
* **Objectives:** Build the big-screen auditorium view and organizer control panel.
* **Deliverables:**
  * 4K Auditorium Projector View (`/leaderboard`):
    * Slanted crossing marquee ribbon displaying live tournament status.
    * Top 3 podium cards with Gold, Silver, and Bronze headers.
    * Team Average Scores displayed prominently with member breakdown chips.
    * Framer Motion layout animations for smooth rank swaps upon receiving SSE updates.
    * Zero Question Leak Guarantee: Stream strictly withholds equation operands and solutions.
  * Admin Command Center (`/admin`):
    * Global contest window controls: Open, Close, Emergency Reset.
    * Granular team session recovery: Individual `[PAUSE]` and `[RESUME]` controls per team.
    * Hardware Failure Recovery: `[EXCUSE MEMBER]` control and endpoint (`POST /api/admin/teams/:teamCode/excuse-member`) to adjust divisor with audit trail.
    * Audit log with `REATTEMPT_GRANTED` and `EXCUSE_MEMBER` tagging.
    * Sub-200ms anti-cheat anomaly watchdog feed.
    * Test mode button: `[SIMULATE 5 TEAMS]` to verify projector rank animations before the hackathon opens.
* **Exit Criteria:** Admin can pause an individual team, excuse a disconnected member, broadcast messages, and watch the projector swap ranks live.

---

### Phase 6: Chaos & Campus Wi-Fi Load Testing
* **Objectives:** Stress-test the system under simulated college hackathon conditions.
* **Deliverables:**
  * Concurrent simulation script: 30 simulated teams (90 simulated students) joining, toggling ready, and answering questions simultaneously.
  * Network chaos simulation: Injecting packet loss, jitter, and temporary disconnections to verify SSE auto-reconnection and visibility resync.
  * Verifying that server-enforced 120s timer cutoff rejects late submissions.
* **Exit Criteria:** Server maintains $< 50\text{ms}$ response latency under 100 concurrent SSE connections with zero crashes.

---

### Phase 7: Pluggable Club OIDC Adapter Integration (Final Drop-in)
* **Objectives:** Connect Matiks to the central USAR FOSS Club website (`fossclub.tech`) once their OIDC endpoints are ready.
* **Deliverables:**
  * Implement `ClubOidcAuthProvider` satisfying the `IAuthProvider` contract.
  * OAuth2 / OIDC code exchange with `https://www.fossclub.tech/api/auth/*`.
  * Validate verified club membership via `GET /api/dashboard/members`.
  * Environment variable switch: `AUTH_MODE=club_oidc`.
* **Exit Criteria:** Students can log in using their official club account, verify membership, and automatically associate with their hackathon team.

---

## 3. Phase Dependency Graph

```
Phase 0 (Scaffolding)
   │
   ├──► Phase 1 (Math & Scoring Engine)
   │       │
   │       └──► Phase 2 (SSE Hub & Team State Machine)
   │               │
   ├──► Phase 3 (UFC UI Primitives & Team Lobby)
   │       │
   │       └──► Phase 4 (2-Minute Sprint Arena)
   │               │
   └───────────────┴──► Phase 5 (Projector Leaderboard & Admin Panel)
                           │
                           └──► Phase 6 (Chaos & Wi-Fi Load Testing)
                                   │
                                   └──► Phase 7 (Club OIDC Drop-in)
```
