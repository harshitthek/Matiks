# MATIKS HACKATHON ENGINE — MULTI-AGENT SPECIFICATION (AGENTS.md)

> **Document Version:** 1.2.0  
> **Purpose:** Defines the specialized subagent personas, responsibilities, architectural boundaries, and handoff protocols for engineering, validating, and maintaining the Matiks Hackathon Mini-Game.

---

## 1. Agent Architecture & Delegation Topology

The development and deployment of the Matiks Hackathon system is partitioned across 7 specialized engineering agents. Each agent owns a well-defined domain with strict interfaces.

```
                            ┌────────────────────────┐
                            │    ORCHESTRATOR AGENT   │
                            │  (Architecture & Flow) │
                            └───────────┬────────────┘
                                        │
     ┌──────────────────┬───────────────┼───────────────┬──────────────────┐
     ▼                  ▼               ▼               ▼                  ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ MathEngine   │ │ RealtimeSSE  │ │ TeamSync     │ │ FrontendUI   │ │ SecurityQA   │
│ Agent        │ │ Agent        │ │ Agent        │ │ Agent (UFC)  │ │ Agent        │
├──────────────┤ ├──────────────┤ ├──────────────┤ ├──────────────┤ ├──────────────┤
│ 4-Bucket     │ │ SSE Stream   │ │ Ready State  │ │ Neo-Brutalist│ │ Latency Verif│
│ Generator    │ │ Broadcast    │ │ 3-2-1 Lock   │ │ Sticker UI   │ │ Anti-Cheat   │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

---

## 2. Agent Role Directory & Boundaries

### 1. `OrchestratorAgent` (System Architect)
* **Objective:** Ensures cross-component synchronization, dependency management, and adherence to hackathon deadlines.
* **Responsibilities:**
  * Enforces the immutable rules outlined in `MEMORY.md`.
  * Verifies data contracts between REST endpoints and SSE event streams.
  * Ensures that no luck-based variance occurs in generated math sets.
* **Handoff Artifacts:** Architecture specifications, system configuration schema.

---

### 2. `MathEngineAgent` (Calculation & Fairness Specialist)
* **Objective:** Mathematically guarantee that every team receives 15 questions with strictly equivalent cognitive difficulty.
* **Responsibilities:**
  * Implements the 4-Bucket Carry Taxonomy ($A, B \in [10, 99]$):
    * 3 Questions: No Carry ($A \pmod{10} + B \pmod{10} < 10 \land A+B < 100$).
    * 4 Questions: Ones Carry ($A \pmod{10} + B \pmod{10} \ge 10 \land A+B < 100$).
    * 4 Questions: Tens/Century Carry ($A \pmod{10} + B \pmod{10} < 10 \land A+B \ge 100$).
    * 4 Questions: Double Carry ($A \pmod{10} + B \pmod{10} \ge 10 \land A+B \ge 100$).
  * Enforces anti-chunking filters (no 0-endings, no double-5 endings, no commutative duplicates).
  * Implements the deterministic $\mathcal{O}(1)$ residual-targeted blueprint algorithm to hit the $[1650, 1750]$ sum window in $<1\text{ ms}$.
  * Computes deterministic answer verification keys.
* **Deliverables:** `mathEngine.ts`, `carryTaxonomy.test.ts`.

---

### 3. `RealtimeAgent` (Server-Sent Events & Networking Hub)
* **Objective:** Deliver reliable, unidirectional event streaming that survives campus Wi-Fi disconnects and firewall restrictions.
* **Responsibilities:**
  * Configures `text/event-stream` headers (`Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`).
  * Manages active client connections across 3 distinct SSE channels:
    * `/api/sse/team/:teamCode`: Room membership, ready status, start signal, teammate HUD progress.
    * `/api/sse/leaderboard`: Real-time score swaps and podium updates (Zero Question Leak Guarantee).
    * `/api/sse/admin`: Room telemetry, sub-200ms anomaly alerts, and active session oversight.
  * Implements 15-second keep-alive heartbeat pings (`:keepalive\n\n`) to prevent proxy timeout disconnects.
  * Implements automatic client-side reconnection buffering via browser `EventSource`.
* **Deliverables:** `sseHub.ts`, `sseTypes.ts`.

---

### 4. `TeamSyncAgent` (State Machine & Synchronization Controller)
* **Objective:** Ensure the entire team is logged in and in a verified "READY" state before launching the 2-minute sprint, and handle hardware disconnect recovery.
* **Responsibilities:**
  * Implements the team lifecycle state machine:
    $$\text{LOBBY} \longrightarrow \text{MEMBERS\_JOINING} \longrightarrow \text{AWAITING\_READY} \longrightarrow \text{ALL\_READY} \longrightarrow \text{COUNTDOWN} \longrightarrow \text{SPRINT}$$
  * Manages atomic room locks so the sprint cannot trigger if even one member is unready.
  * Synchronizes the 3-second countdown broadcast so all members transition to Question 1 on the exact same millisecond.
  * Manages team scoring aggregation (aggregate team score, member speed contributions).
  * Executes the `[EXCUSE MEMBER]` recovery logic, dynamically adjusting the score divisor while maintaining the audit trail.
* **Deliverables:** `teamManager.ts`, `roomStateMachine.ts`.

---

### 5. `FrontendUIAgent` (UFC Design System & Tactile Experience)
* **Objective:** Translate the USAR-FOSS Club Website (`USAR-FOSS/ufc_website`) design system into an immersive competitive math interface.
* **Responsibilities:**
  * Embeds the exact color palette (`--ink: #090c0a`, `--signal: #2ee58f`, `--amber: #f5a623`, `--ember: #ff6b5e`, `--butter: #ffe36e`).
  * Replicates the chunky neo-brutalist tactile sticker buttons (`.btn`) with 2.5px solid borders, hard drop shadows, hover rotation, and disc arrow transitions.
  * Implements the SVG procedural film grain overlay (`.grain`).
  * Implements **Universal Explicit Submit** (`Spacebar`/`Enter` on desktop; oversized green `ENTER ↵` Thumb-Enter on mobile touch numpad).
  * Designs the 4 core views:
    1. Student & Team Lobby (`/team/:teamCode`).
    2. 2-Minute Sprint Arena with touch Numpad (`/arena/:sessionId`).
    3. Admin Command Center (`/admin`).
    4. Auditorium Big-Screen Leaderboard (`/leaderboard`).
* **Deliverables:** React components, Tailwind styling, tactile button CSS primitives.

---

### 6. `SecurityAgent` (Anti-Cheat & Validation Watchdog)
* **Objective:** Protect competition integrity in a competitive hackathon environment.
* **Responsibilities:**
  * Server-side timestamp validation: verifies answer latency $\Delta t$ with a $\pm 350\text{ ms}$ packet jitter window.
  * Grants a $+2.5\text{ s}$ network transit grace cutoff for submissions timestamped before the $120.0\text{ s}$ deadline.
  * Sub-200ms anomaly detection: automatically flags automated bot scripts or client script injection.
  * Enforces one-attempt-per-roll-number lockouts.
  * Guarantees zero equation/answer leak over public SSE channels.
  * Admin authorization gate for window open/close, excuse actions, and emergency reset actions.
* **Deliverables:** `antiCheatMiddleware.ts`, `validationRules.ts`.

---

### 7. `QATesterAgent` (Load & Chaos Testing Specialist)
* **Objective:** Validate stability under simulated high-concurrency hackathon conditions.
* **Responsibilities:**
  * Runs concurrent load simulation: 50 teams (150 simulated students) joining, toggling ready, and submitting answers simultaneously.
  * Tests network jitter and packet loss scenarios on SSE streams.
  * Verifies that total time limit of 120s is strictly enforced to the exact millisecond across all clients.
* **Deliverables:** `loadTest.ts`, `chaosNetworkTest.ts`.

---

## 3. Inter-Agent Communication & Task Protocols

1. **Rule Precedence:** No agent may alter the 2-minute timer, the 15-question count, the 2-digit addition scope, or the SSE architectural mandate without an updated ADR in `MEMORY.md`.
2. **Schema Uniformity:** All payload definitions must match `SSE_PROTOCOL.md` exactly.
3. **Design Fidelity:** The `FrontendUIAgent` must verify all color hexes, button borders, and font stacks against `DESIGN.md` (derived from `USAR-FOSS/ufc_website`).
