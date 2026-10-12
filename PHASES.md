# MATIKS HACKATHON ENGINE — IMPLEMENTATION ROADMAP (PHASES.md)

> **Document Version:** 1.3.0  
> **Purpose:** Sequential, phase-by-phase engineering execution plan for developing, testing, and deploying the Matiks Hackathon Mini-Game.  
> **Status:** All Phases Completed & Verified (72 Server Tests + 7 Client Tests Passing)

---

## 1. Overview of Execution Phases

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 PHASE EXECUTION TIMELINE                               │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ PHASE 0 │ ✅ Scaffolding, Monorepo Setup, UFC Design Tokens & GitHub Actions CI        │
│ PHASE 1 │ ✅ Math Engine (4-Bucket Taxonomy & Wide-Corridor O(1) Non-Repeating Engine) │
│ PHASE 2 │ ✅ Realtime SSE Hub, Team State Machine, Rematch Reset & Persistence         │
│ PHASE 3 │ ✅ Frontend UFC Primitives & Team Lobby Panel (Showcase Mode)                │
│ PHASE 4 │ ✅ 2-Minute Sprint Combat Arena (60fps Reflex Mode & Universal Explicit)     │
│ PHASE 5 │ ✅ 4K Auditorium Projector Leaderboard, Admin Center & CSV/JSON Exports      │
│ PHASE 6 │ ✅ Multi-Client Chaos, Load, QA Regression & Smoke Verification Suites       │
│ PHASE 7 │ ✅ Pluggable Club OIDC Adapter Integration (`Local` + `ClubOidc`)            │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Detailed Phase Specifications

### Phase 0: Workspace Scaffolding & Core Foundations
* **Objectives:** Establish project structure, dependencies, TypeScript configurations, and design primitives.
* **Deliverables:**
  * Node.js Express backend (`server/`) with TypeScript, CORS, rate limiters, and Express router.
  * React 19 + Vite frontend (`client/`) configured with Tailwind CSS v4 and Oxlint.
  * Color tokens (`--ink: #090c0a`, `--signal: #2ee58f`, `--amber`, `--ember`, `--butter`) and fonts (`Bricolage Grotesque`, `DM Sans`, `Space Mono`) imported from `USAR-FOSS/ufc_website`.
  * Automated GitHub Actions workflow (`.github/workflows/ci.yml`).
* **Exit Criteria:** Both client and server run locally on `localhost:5173` and `localhost:3001` with zero lint or build errors.

---

### Phase 1: Math Engine & Zero-Luck Normalization
* **Objectives:** Implement the mathematical core that guarantees identical cognitive difficulty across all teams with zero cross-game question repetition.
* **Deliverables:**
  * `mathEngine.ts`: 4-Bucket Carry Taxonomy generator:
    * 3 Questions: Bucket 1 (Direct / No Carry, $T_{\text{target}} = 3.5\text{s}$, center sum $72$)
    * 4 Questions: Bucket 2 (Ones Carry Only, $T_{\text{target}} = 5.5\text{s}$, center sum $75$)
    * 4 Questions: Bucket 3 (Century Carry Only, $T_{\text{target}} = 6.0\text{s}$, center sum $140$)
    * 4 Questions: Bucket 4 (Double Carry, $T_{\text{target}} = 8.0\text{s}$, center sum $156$)
  * Anti-chunking entropy filters (disallow multiples of 10, disallow double-5 endings, disallow identical operands, intra-paper and cross-game commutative deduplication).
  * Pre-sorted `Int32Array` Wide-Corridor $\mathcal{O}(1)$ Contiguous-Slice Generator: Shuffles the 15 bucket slots and samples uniformly across $\pm 28$ sum corridors to hit $[1650, 1750]$ in $0.11\text{ ms}$/paper while excluding per-squad (`roomUsedPairKeys`) and rolling global question history.
  * Automated test suite (`mathEngine.test.ts`) validating 1,000 generated sets and 8-game consecutive non-repetition.
* **Exit Criteria:** Math generator passes 100% of test assertions.

---

### Phase 2: Realtime SSE Hub, Team State Machine & Crash Persistence
* **Objectives:** Build the real-time networking engine, synchronized team room controller, and crash-safe persistence layer.
* **Deliverables:**
  * `sseHub.ts`: Unidirectional Server-Sent Events router with `:keepalive` 15-second heartbeats and `X-Accel-Buffering: no`.
  * `roomManager.ts`: Team room state machine:
    * Team registration, member join, leave with automatic Captain succession, and post-sprint rematch reset (`resetTeamSprint`).
    * Atomic **"READY"** lock and synchronized countdown broadcaster ($3 \to 2 \to 1 \to \text{START}$).
    * Multi-tab SSE presence reference counting and `sprint_resume` full session restoration.
  * `scoringEngine.ts`: Difficulty-calibrated speed score calculator and streak multipliers ($1.1\times, 1.25\times, 1.5\times$).
  * `statePersistence.ts`: Debounced atomic `.tmp` + rename disk snapshots (`server/data/tournament-state.json`) restoring rooms, sessions, timers, leaderboard, and audit logs on startup.
* **Exit Criteria:** Multi-client integration tests confirm synchronized countdowns, crash recovery, and accurate team average aggregation.

---

### Phase 3: Frontend UFC UI Primitives & Team Lobby (Showcase Mode)
* **Objectives:** Construct the visual identity and team lobby panel.
* **Deliverables:**
  * UI Primitives (`client/src/components/common/`):
    * Chunky tactile sticker buttons (`TactileButton.jsx`), slanted washi tape (`WashiTape.jsx`), procedural SVG film grain (`FilmGrain.jsx`), pulsing radar dot (`RadarDot.jsx`), scissor-cut Ransom Note tiles (`RansomTile.jsx`), and custom confirmation modals (`ConfirmModal.jsx`).
  * Team & Student Lobby (`TeamLobby.jsx` & `TeamOnboarding.jsx`):
    * Team Code chip, shareable invite link, and live connected member roster.
    * Tactile "READY" toggle button, post-sprint "PLAY AGAIN" rematch reset, and "LEAVE SQUAD" controls.
    * Synchronized countdown overlay (`CountdownOverlay.jsx`).
* **Exit Criteria:** Teammates can create/join a squad, toggle ready, play rematches, and navigate cleanly via browser history (`popstate`).

---

### Phase 4: 2-Minute Sprint Arena (60fps Reflex Mode)
* **Objectives:** Build the high-performance math combat interface with zero input lag.
* **Deliverables:**
  * Two-Mode Rendering: Arena (`ArenaView.jsx`) runs in **Reflex Mode** (zero physics libraries, GPU-accelerated transforms, 60fps locked).
  * Device-Adaptive Input (Universal Explicit Submit):
    * Mobile: Virtual OS keyboard suppressed (`inputMode="none"`). Custom tactile on-screen numpad (`Numpad.jsx`) with oversized neon green Thumb-Enter (`ENTER ↵`).
    * Desktop: Global `keydown` physical numerical key and `Enter` or `Spacebar` listener.
  * Procedural Web Audio SFX (`soundFx.js`): Tactile key clicks, correct chime, error buzz, and completion fanfare with mute toggle.
  * Live Teammate HUD (`TeammateHud.jsx`): Top pills displaying partners' live progress.
* **Exit Criteria:** Player can complete 15 questions with smooth transitions, survive mid-sprint refreshes/back-navigation without losing stats, and transition cleanly back to the lobby.

---

### Phase 5: Projector Leaderboard & Admin Command Center
* **Objectives:** Build the big-screen auditorium view and organizer control panel.
* **Deliverables:**
  * 4K Auditorium Projector View (`LeaderboardView.jsx`):
    * Top 3 podium cards (Gold, Silver, Bronze), live Team Average Scores, member breakdowns, and Zero Question Leak Guarantee.
  * Admin Command Center (`AdminView.jsx`):
    * Single-use 60s SSE stream ticket handshake (`POST /api/admin/stream-ticket`).
    * Contest window open/close/reset, per-team `[PAUSE]`/`[RESUME]`, and `[EXCUSE MEMBER]` hardware recovery.
    * Sub-200ms anti-cheat anomaly watchdog feed and `[SIMULATE 5 TEAMS]` projector test mode.
    * One-click RFC-4180 formula-safe **EXPORT CSV** and **EXPORT JSON** tournament reports.
* **Exit Criteria:** Admin can pause/resume teams, excuse disconnected members, export reports, and monitor live telemetry.

---

### Phase 6: Chaos, QA Regression, Smoke & Campus Wi-Fi Load Testing
* **Objectives:** Stress-test the system under simulated college hackathon conditions.
* **Deliverables:**
  * `loadTest.ts`: 30 simulated teams (90 students), 100 concurrent SSE streams, and 1,350 parallel answer submissions.
  * `chaosNetworkTest.ts`: Network jitter, $+2.5\text{s}$ deadline transit grace, SSE disconnect/reconnect, and visibility clock resync.
  * `qaRegression.test.ts`, `servicesUnit.test.ts`, `smoke.test.ts`, and `clientSuite.test.mjs`.
* **Exit Criteria:** All 72 server tests and 7 client tests pass with zero warnings or errors.

---

### Phase 7: Pluggable Club OIDC Adapter Integration
* **Objectives:** Support both frictionless local hackathon onboarding and USAR FOSS Club (`fossclub.tech`) OIDC authentication.
* **Deliverables:**
  * `authProvider.ts` (`LocalHackathonAuthProvider` and `ClubOidcAuthProvider`) + `authController.ts` + `authOidc.test.ts`.
* **Exit Criteria:** Seamless switching via `AUTH_MODE=local` or `AUTH_MODE=club_oidc`.

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
