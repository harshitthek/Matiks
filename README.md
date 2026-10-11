# MATIKS HACKATHON MINI-GAME ⚡
### High-Octane Speed Math Sprint for College Hackathons

[![Design: USAR-FOSS UFC](https://img.shields.io/badge/Design-USAR--FOSS%20UFC%20Style-2ee58f?style=for-the-badge&logo=github)](https://github.com/USAR-FOSS/ufc_website.git)
[![Protocol: Server-Sent Events](https://img.shields.io/badge/Realtime-Server--Sent%20Events%20(SSE)-ffe36e?style=for-the-badge)](SSE_PROTOCOL.md)
[![Math: Zero-Luck Normalized](https://img.shields.io/badge/Math%20Engine-Zero--Luck%20Normalized-ff6b5e?style=for-the-badge)](MATH_ENGINE.md)
[![Team: Parallel Average Scoring](https://img.shields.io/badge/Team%20Model-Synchronized%20Average-9bd7ff?style=for-the-badge)](ARCHITECTURE.md)
[![Time: 2 Min / 15 Qs](https://img.shields.io/badge/Sprint-120s%20%7C%2015%20Questions-c7b3ff?style=for-the-badge)](MEMORY.md)

---

## 1. Project Overview

**Matiks Hackathon Edition** is a real-time, team-synchronized mental math combat platform designed as a high-energy mini-game for college hackathons. Inspired by the speed arithmetic duel mechanics of the popular **Matiks** mobile app, this web platform adapts competitive arithmetic into an asynchronous team tournament.

Teams gather in an interactive lobby, sync up their roster, and toggle their **"READY"** state. The moment all teammates are locked in and the hackathon contest window is open, a synchronized $3 \to 2 \to 1$ countdown launches them into an intense **2-minute (120-second), 15-question speed addition sprint**.

**The Team Dynamic:** All team members play the game **individually on their own devices at the exact same time**. At the end of the sprint, the official team score is the **mathematical average of all team members' scores**.

---

## 2. Core Rules & Game Specifications

| Parameter | Specification | Detailed Rule |
| :--- | :--- | :--- |
| **Math Scope** | **2-Digit Addition** | Operands $A, B \in [10, 99]$. Sums can cross $100$ up to $198$ (e.g. $58 + 76 = 134$). |
| **Question Count** | **15 Questions** | Standardized set per sprint; latency calibrated per problem complexity. |
| **Total Duration** | **2 Minutes (120s)** | Strict server-side timestamp countdown. $+2.5\text{s}$ transit grace for valid submissions. |
| **Difficulty Engine** | **Zero-Luck Normalized** | Every sprint contains **exactly 3 No-Carry, 4 Ones-Carry, 4 Century-Carry, and 4 Double-Carry questions**, generated in $\mathcal{O}(1)$ time with residual targeting, commutative deduplication, and 0/double-5 exclusions. |
| **Multiplayer Team Model** | **Synchronized Parallel (Average Score)** | All members must be in **READY** state to start. All members solve individually at the exact same time. **Team Score = Average of all members' scores**. |
| **Input Engine** | **Universal Explicit Submit** | `Spacebar` / `Enter` on desktop; oversized green `ENTER ↵` on mobile touch numpad. Auto-submit on 3 digits disabled to preserve rhythm across 2-digit & 3-digit sums. |
| **Scoring Formula** | **Difficulty-Calibrated Speed Scoring** | Base $100\text{ pts}$ + Calibrated Speed Bonus ($T_{\text{target}}$: 3.5s to 8.0s) + Consecutive Streak Multipliers ($1.1\times$ to $1.5\times$). Incorrect: $-20\text{ pts}$. |
| **Real-Time Tech** | **Server-Sent Events (SSE)** | `text/event-stream` pushes room states, timer sync, teammate progress, and live leaderboard updates. Bypasses campus Wi-Fi WebSocket drops. |
| **Design Language** | **USAR-FOSS UFC Style (Two-Mode)** | Showcase Mode for Lobby/Board (Matter.js stickers, washi tape, Ransom letters) vs. Reflex Mode for Arena (60fps locked, custom tactile numpad with Thumb-Enter). |

---

## 3. Four Core System Panels

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      PANEL ECOSYSTEM OVERVIEW                          │
 ├───────────────────────────────────┬────────────────────────────────────┤
 │ 1. ADMIN PANEL (`/admin`)         │ 2. TEAM & STUDENT LOBBY (`/team`)  │
 │ • Open/Close Hackathon Window     │ • Enter Team Code & Roll Number    │
 │ • Granular Team Pause/Resume      │ • Live Connected Member Roster     │
 │ • Emergency [EXCUSE MEMBER] Action│ • Atomic "READY" Toggle Gate       │
 │ • Audit-Logged Re-attempt System  │ • Synchronized 3-2-1 Countdown     │
 │ • Live Anomaly Watchdog (<200ms)  │ • Teammate Status Ping Dots        │
 ├───────────────────────────────────┼────────────────────────────────────┤
 │ 3. SPRINT COMBAT ARENA (`/arena`) │ 4. PROJECTOR LEADERBOARD (`/live`) │
 │ • High-Performance Reflex Mode   │ • 4K Auditorium Projector View     │
 │ • High-Contrast Math Equations    │ • Live Team Average Scores via SSE │
 │ • Mobile Touch Numpad + Thumb-Enter│ • Real-time Rank Swaps via SSE    │
 │ • Universal Explicit Submit       │ • Zero Question Leak Guarantee     │
 │ • Non-Intrusive Teammate HUD      │ • Gold, Silver, Bronze Podiums     │
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

Every team's 15 questions contain the exact same count from each bucket. Numbers ending in `0` and double-`5` endings are eliminated to remove chunking bias, unordered pairs are deduplicated, and sets are generated in $\mathcal{O}(1)$ time targeting a gross sum in $[1650, 1750]$ via analytical residual partitioning. *(Full mathematical proof and algorithms in [MATH_ENGINE.md](MATH_ENGINE.md)).*

---

## 6. Server-Sent Events (SSE) Protocol

Instead of fragile WebSockets, this platform uses unidirectional SSE + REST POST:

* **Inbound REST Calls:**
  * `POST /api/team/join` — Register roll number in a team room.
  * `POST /api/team/ready` — Toggle member ready state.
  * `POST /api/sprint/submit` — Submit answer with `clientDeltaMs` and timestamp.
  * `POST /api/admin/teams/:teamCode/excuse-member` — Organizer recovery for hardware failure.
* **Outbound Realtime Streams:**
  * `GET /api/sse/team/:teamCode?token=x` — Broadcasts roster joins, ready toggles, countdown, start triggers, and teammate progress.
  * `GET /api/sse/leaderboard` — Broadcasts live **Team Average Scores** and podium updates to the auditorium projector (**Zero Question Leak Guarantee**).
  * `GET /api/sse/admin` — Broadcasts telemetry, active rooms, and anti-cheat alerts to organizers.

*(Full event schemas, headers, and payload structures in [SSE_PROTOCOL.md](SSE_PROTOCOL.md)).*

---

## 7. Pluggable Auth & Future Club OIDC Integration

The system uses an abstract `IAuthProvider` pattern:
* **Phase 1 (Active Now):** Frictionless local hackathon authentication via College Roll Number + Display Name + Team Code, with `ADMIN_SECRET` protecting the admin dashboard and mockable membership flags.
* **Phase 2 (Drop-in Ready):** When the USAR FOSS Club website (`fossclub.tech`) finishes its central OpenID Connect (OIDC) endpoints, Matiks will connect to `/api/auth/*` and `/api/dashboard/members`, validating verified club membership and team rosters before granting arena access. Switching between Phase 1 and Phase 2 requires changing a single `AUTH_MODE=club_oidc` environment flag without touching the core game engine.

---

## 8. Project Documentation Index

* **[PHASES.md](PHASES.md)** — Step-by-step engineering roadmap, phase deliverables, exit criteria, and dependency graph.
* **[ARCHITECTURE.md](ARCHITECTURE.md)** — Complete system topology, modular component structure, Mermaid sequence flows, state machines, and TypeScript data models.
* **[MEMORY.md](MEMORY.md)** — Architectural decision log, immutable rules, and technical context.
* **[DESIGN.md](DESIGN.md)** — Complete UFC design system specifications, color tokens, CSS primitives, two-mode rendering, and wireframes.
* **[AGENTS.md](AGENTS.md)** — Multi-agent roles, task division, and operational protocols.
* **[MATH_ENGINE.md](MATH_ENGINE.md)** — Mathematical taxonomy, carry-operation proofs, entropy filters, and test vectors.
* **[SSE_PROTOCOL.md](SSE_PROTOCOL.md)** — Server-Sent Events architecture, event names, and transport headers.

---

## 9. Current Status & Next Steps

All architectural upgrades, mathematical engines, design systems, protocol schemas, and requirement documents have been updated and frozen. **Code implementation has not yet been started**, awaiting user sign-off.
