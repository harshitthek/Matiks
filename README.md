# MATIKS HACKATHON MINI-GAME ⚡
### High-Octane Speed Math Sprint for College Hackathons (v2.0)

[![Design: USAR-FOSS UFC](https://img.shields.io/badge/Design-USAR--FOSS%20UFC%20Style-2ee58f?style=for-the-badge&logo=github)](https://github.com/USAR-FOSS/ufc_website.git)
[![Protocol: Server-Sent Events](https://img.shields.io/badge/Realtime-Server--Sent%20Events%20(SSE)-ffe36e?style=for-the-badge)](SSE_PROTOCOL.md)
[![Math: Zero-Luck Normalized](https://img.shields.io/badge/Math%20Engine-Addition%20%7C%20Subtraction%20%7C%20Mixed-ff6b5e?style=for-the-badge)](MATH_ENGINE.md)
[![Team: Parallel Average Scoring](https://img.shields.io/badge/Team%20Model-Synchronized%20Average-9bd7ff?style=for-the-badge)](ARCHITECTURE.md)
[![Tests: 101/101 Passing](https://img.shields.io/badge/Tests-101%2F101%20Passing-c7b3ff?style=for-the-badge)](MEMORY.md)

---

## 1. Project Overview

**Matiks Hackathon Edition (v2.0)** is a real-time, team-synchronized mental math combat platform designed as a high-energy mini-game for college hackathons. Inspired by the speed arithmetic duel mechanics of the popular **Matiks** mobile app, this web platform adapts competitive arithmetic into an asynchronous team tournament.

Teams gather in an interactive lobby, sync up their roster, select an operator mode (**Addition**, **Subtraction**, or **Mixed Arithmetic**), and toggle their **"READY"** state. The moment all teammates are locked in and the hackathon contest window is open, a synchronized $3 \to 2 \to 1$ countdown launches them into an intense **2-minute (120-second), 15-question speed arithmetic sprint** in a **zero-scroll, 100dvh auto-fullscreen reflex arena**.

**The Team Dynamic:** All team members play the game **individually on their own devices at the exact same time**. At the end of the sprint, the official team score is the **mathematical average of all team members' scores**.

---

## 2. Core Rules & Game Specifications

| Parameter | Specification | Detailed Rule |
| :--- | :--- | :--- |
| **Math Scope** | **Addition, Subtraction & Mixed Mode** | Operands $A, B \in [10, 99]$. Addition sums can cross $100$ up to $198$. Subtraction strictly enforces $A - B \ge 10$ ($10 \le A - B \le 89$) so answers are always non-negative and 2 digits. Mixed mode balances 8 addition + 7 subtraction questions. |
| **Question Count** | **15 Questions** | Standardized set per sprint; latency calibrated per problem complexity. |
| **Total Duration** | **2 Minutes (120s)** | Strict server-side timestamp countdown. $+2.5\text{s}$ transit grace for valid submissions. |
| **Difficulty Engine** | **Zero-Luck Normalized** | Addition: **3 No-Carry (B1), 4 Ones-Carry (B2), 4 Century-Carry (B3), 4 Double-Carry (B4)** targeting $[1650, 1750]$. Subtraction: **7 No-Borrow (S1), 8 Ones-Borrow (S2)** targeting $[520, 580]$. Sampled in $\mathcal{O}(1)$ time ($0.11\text{ms}$/paper) with commutative deduplication, 0/double-5 exclusions, and cross-game non-repetition. |
| **Multiplayer Team Model** | **Synchronized Parallel (Average Score)** | All members must be in **READY** state to start. All members solve individually at the exact same time. **Team Score = Average of all members' scores**. |
| **Input Engine** | **100dvh Zero-Scroll Reflex Arena** | Locked viewport fitting $100\text{dvh}$ with zero vertical scroll, automatic user-gesture fullscreen, and responsive tactile numpad. Zetamac-style explicit submit (`Spacebar`/`Enter` on desktop; oversized green `ENTER ↵` on mobile). |
| **Scoring Formula** | **Difficulty-Calibrated Speed Scoring** | Base $100\text{ pts}$ + Calibrated Speed Bonus ($T_{\text{target}}$: 3.5s to 8.0s) + Consecutive Streak Multipliers ($1.1\times$ to $1.5\times$). Incorrect: $-20\text{ pts}$. |
| **Real-Time Tech** | **Resilient SSE with Circular Buffer Replay** | `text/event-stream` with monotonic 64-bit event IDs, in-memory 100-event circular buffer (`Last-Event-ID` automatic replay), epoch resync, and `:keepalive` pings. Turnkey HTTP/2 reverse-proxy configs for Caddy & Nginx. |
| **Auditorium Ceremony** | **Stage Reveal & Anti-Screen-Peeking** | Automated 3-2-1 podium reveal (3rd $\to$ 2nd $\to$ 1st), canvas confetti cannons, and Web Audio fanfare. Configurable 5s delayed queue on public leaderboard stream prevents screen-peeking during live auditorium play. |
| **Persistence & Auditing** | **Disk Snapshots, Dispute Replay & CSV** | Debounced atomic `.tmp` + rename disk snapshots (`tournament-state.json`), millisecond-by-millisecond disk-backed dispute replay inspector (`GET /api/admin/replay/:sessionId`), and RFC-4180 formula-safe CSV exports with latency quantiles. |
| **Observability** | **Prometheus Metrics & Structured Logging** | Built-in `/metrics` endpoint with low-cardinality counters, gauges, and latency histograms. Structured monotonic request ID tracking and NDJSON request logging. |
| **Design Language** | **USAR-FOSS UFC Style (Two-Mode)** | Showcase Mode for Lobby/Board (tactile stickers, washi tape, Ransom letters) vs. Reflex Mode for Arena (60fps locked, custom tactile numpad with Thumb-Enter, drag-strip teammate HUD). |

---

## 3. Four Core System Panels

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      PANEL ECOSYSTEM OVERVIEW                          │
 ├───────────────────────────────────┬────────────────────────────────────┤
 │ 1. ADMIN PANEL (`/admin`)         │ 2. TEAM & STUDENT LOBBY (`/team`)  │
 │ • Open/Close Hackathon Window     │ • Enter Team Code & Roll Number    │
 │ • Operator Mode Selection         │ • Select Math Mode (+, -, ±)       │
 │ • Granular Team Pause/Resume      │ • Live Connected Member Roster     │
 │ • Emergency [EXCUSE MEMBER] Action│ • Atomic "READY" Toggle Gate       │
 │ • Dispute Replay Inspector        │ • Synchronized 3-2-1 Countdown     │
 │ • CSV & JSON Tournament Exports   │ • Post-Sprint Rematch & Leave      │
 │ • Live Anomaly Watchdog (<200ms)  │ • Zero-Scroll Auto-Fullscreen      │
 ├───────────────────────────────────┼────────────────────────────────────┤
 │ 3. SPRINT COMBAT ARENA (`/arena`) │ 4. PROJECTOR LEADERBOARD (`/live`) │
 │ • 100dvh Zero-Scroll Reflex Arena │ • 4K Auditorium Projector View     │
 │ • User-Gesture Auto-Fullscreen    │ • Live Team Average Scores via SSE │
 │ • High-Contrast Math Equations    │ • Anti-Screen-Peeking Delay Queue  │
 │ • Mobile Touch Numpad + Thumb-Enter│ • 3-2-1 Podium Reveal Ceremony    │
 │ • Universal Explicit Submit       │ • Canvas Confetti & Audio Fanfare  │
 │ • Drag-Strip Teammate Progress HUD│ • Zero Question Leak Guarantee     │
 │ • Post-Sprint Reflex Diagnostics  │ • Real-time Rank Swaps via SSE     │
 └───────────────────────────────────┴────────────────────────────────────┘
```

---

## 4. Design Linchpin: The USAR-FOSS UFC Aesthetic

The UI directly incorporates the design system from the **USAR FOSS Club (UFC)** website (`USAR-FOSS/ufc_website`):

* **Color Palette:**
  * Backgrounds: Ink Dark (`#090c0a`), Card Ink (`#0f1411`), Elevated Surface (`#161d18`).
  * Signals: Signal Neon Green (`#2ee58f`), Butter Gold (`#ffe36e`), Ember Red (`#ff6b5e`), Lilac (`#c7b3ff`), Cream (`#f7f2e4`).
* **Tactile Sticker Buttons (`.btn`):**
  * Neo-brutalist pill buttons with $2.5\text{px}$ solid borders and hard $4\text{px}$ offset shadows.
  * Physics-based hover tilt (`translate(-3px, -3px) rotate(-1.2deg)`) and active press-in mechanics (`translate(3px, 3px)`).
  * Internal rotating disc arrows (`.disc`).
* **Ransom Note Lettering:** Scissor-cut multi-font tiles dropping in for the 3-2-1 countdown.
* **Procedural Film Grain Overlay:** SVG turbulence texture giving dark surfaces an authentic hacker aesthetic.
* **Space Mono Telemetry:** High-contrast monospaced labels (`§ 01 // TEAM LOBBY`, `01:58.42`, `+184 PTS`).

---

## 5. Mathematical Zero-Luck Engine

To guarantee complete fairness across teams, the math engine groups all additions into **4 Cognitive Carry Buckets**:

1. **Bucket 1 (Direct / No Carry):** 3 Questions (e.g. $24 + 43 = 67$). $T_{\text{target}} = 3.5\text{s}$.
2. **Bucket 2 (Ones Carry Only):** 4 Questions (e.g. $37 + 28 = 65$). $T_{\text{target}} = 5.5\text{s}$.
3. **Bucket 3 (Century Carry Only):** 4 Questions (e.g. $62 + 74 = 136$). $T_{\text{target}} = 6.0\text{s}$.
4. **Bucket 4 (Double Carry):** 4 Questions (e.g. $58 + 76 = 134$). $T_{\text{target}} = 8.0\text{s}$.

Every team's 15 questions contain the exact same count from each bucket in randomized slot order. Numbers ending in `0` and double-`5` endings are eliminated to remove chunking bias, unordered pairs are deduplicated within each paper and across consecutive games (`roomUsedPairKeys` + rolling global history), and sets are generated in $\mathcal{O}(1)$ time ($0.11\text{ms}$/paper) via pre-sorted `Int32Array` sum slice bounds targeting a gross sum in $[1650, 1750]$. *(Full mathematical proof and algorithms in [MATH_ENGINE.md](MATH_ENGINE.md)).*

---

## 6. Server-Sent Events (SSE) Protocol

Instead of fragile WebSockets, this platform uses unidirectional SSE + REST:

* **Inbound REST Calls:**
  * `POST /api/team/create` & `POST /api/team/join` — Create a squad or join an existing team room.
  * `POST /api/team/ready` — Toggle member ready state.
  * `POST /api/team/leave` & `POST /api/team/reset` — Leave a squad (with automatic captain succession) or reset a finished room for a rematch.
  * `POST /api/sprint/submit` — Submit answer with `clientDeltaMs` and timestamp.
  * `POST /api/admin/teams/:teamCode/excuse-member` — Organizer recovery for hardware failure.
  * `POST /api/admin/stream-ticket` — Exchange admin credentials for a single-use 60s SSE stream ticket.
  * `GET /api/admin/export/csv` & `GET /api/admin/export/json` — Download formula-safe CSV standings and full JSON tournament reports.
* **Outbound Realtime Streams:**
  * `GET /api/sse/team/:teamCode?token=x` — Broadcasts roster joins, ready toggles, countdown, `sprint_start`, `sprint_resume` state recovery, `room_paused`/`room_resumed`, and teammate progress.
  * `GET /api/sse/leaderboard` — Broadcasts live **Team Average Scores** and podium updates to the auditorium projector (**Zero Question Leak Guarantee**).
  * `GET /api/sse/admin?ticket=x` — Broadcasts telemetry, active rooms, and anti-cheat alerts to organizers.

*(Full event schemas, headers, and payload structures in [SSE_PROTOCOL.md](SSE_PROTOCOL.md)).*

---

## 7. Pluggable Auth & Club OIDC Integration

The system implements the `IAuthProvider` adapter pattern (`server/src/services/authProvider.ts`):
* **Local Hackathon Mode (`AUTH_MODE=local`, default):** Frictionless local hackathon authentication via College Roll Number + Display Name + Team Code, with `ADMIN_SECRET` protecting the admin dashboard and optional `CLUB_MEMBER_ROLLS` allowlist.
* **Club OIDC Mode (`AUTH_MODE=club_oidc`):** Connects to the USAR FOSS Club OIDC/member endpoints (`CLUB_OIDC_ISSUER_URL`), validating club membership and session tokens without changing core game logic.

---

## 8. Quick Start & Verification Commands

```bash
# 1. Start Backend Server (http://localhost:3001)
npm --prefix server install
npm --prefix server run dev

# 2. Start Frontend Vite Server (http://localhost:5173)
npm --prefix client install
npm --prefix client run dev

# 3. Run Full Verification Suite (94 Server Tests + 7 Client Tests = 101 Tests)
npm --prefix server test
npm --prefix client test
npm --prefix client run lint

# 4. View Production Prometheus Metrics
curl -H "Authorization: Bearer hackathon_admin_secret" http://localhost:3001/metrics
```

---

## 9. Project Documentation Index

* **[PHASES.md](PHASES.md)** — Step-by-step engineering roadmap, phase deliverables, exit criteria, and dependency graph.
* **[ARCHITECTURE.md](ARCHITECTURE.md)** — Complete system topology, modular component structure, Mermaid sequence flows, state machines, and TypeScript data models.
* **[MEMORY.md](MEMORY.md)** — Architectural decision log, immutable rules, and technical context.
* **[DESIGN.md](DESIGN.md)** — Complete UFC design system specifications, color tokens, CSS primitives, two-mode rendering, and wireframes.
* **[AGENTS.md](AGENTS.md)** — Multi-agent roles, task division, and operational protocols.
* **[MATH_ENGINE.md](MATH_ENGINE.md)** — Mathematical taxonomy, carry-operation proofs, wide-corridor $\mathcal{O}(1)$ sampling, and test vectors.
* **[SSE_PROTOCOL.md](SSE_PROTOCOL.md)** — Server-Sent Events architecture, event names, single-use admin tickets, and transport headers.
