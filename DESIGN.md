# MATIKS HACKATHON ENGINE — DESIGN SYSTEM & MOVEMENT SPECIFICATION

> **Document Version:** 1.2.0  
> **Reference Production Website:** [https://www.fossclub.tech/](https://www.fossclub.tech/)  
> **Source Codebase:** [USAR-FOSS/ufc_website](https://github.com/USAR-FOSS/ufc_website.git)  
> **Aesthetic Archetype:** Neo-Brutalist Cyber-Editorial / Open-Source Hacker Brutalism  
> **Core Architecture:** **Two-Mode Rendering Engine** (Showcase Mode for Lobby/Leaderboard vs. Reflex Mode for 2-Minute Arena)

---

## 1. Visual Identity & Two-Mode Rendering Philosophy

The Matiks Hackathon Mini-Game faithfully implements the design language of the **USAR FOSS Club website (`fossclub.tech`)**.

To ensure **zero frame drops on budget mobile devices** during a high-stakes 2-minute speed calculation sprint, the UI is split into two distinct rendering modes:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       TWO-MODE RENDERING SYSTEM                                        │
├───────────────────────────────────────────────────┬────────────────────────────────────────────────────┤
│            SHOWCASE MODE (Lobby & Board)          │            REFLEX MODE (2-Minute Arena)            │
├───────────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ • Full UFC aesthetic richness                     │ • 60fps locked rendering performance               │
│ • Draggable Matter.js 2D physics stickers         │ • Zero physics libraries in memory                 │
│ • Scissor-cut Ransom Note spring drop-ins         │ • GPU-accelerated translate3d transforms           │
│ • Slanted washi tape strips & procedural grain    │ • Virtual keyboard suppressed (inputMode="none")   │
│ • Crossing ribbon marquee tickers                 │ • Tactile on-screen numpad with Thumb-Enter        │
│ • Live radar ping dots on member roster           │ • Crisp green perimeter flash & horizontal shake   │
└───────────────────────────────────────────────────┴────────────────────────────────────────────────────┘
```

---

## 2. Design Tokens & Color Palette

All color tokens are derived directly from `src/components/home/home.css` of `ufc_website`:

```css
:root {
  /* Surfaces & Ink */
  --ink: #090c0a;            /* Deep dark background (dark green-black) */
  --ink-2: #0f1411;          /* Card containers, inputs, lobby panels */
  --ink-3: #161d18;          /* Elevated surfaces, hover states */
  
  /* Text & Lines */
  --text: #e8ece3;           /* Primary text color (soft off-white) */
  --text-dim: #aab5ac;       /* Secondary captions, subtitles */
  --line: rgba(232, 236, 227, 0.12); /* Subtle borders */
  --line-bold: rgba(232, 236, 227, 0.28); /* Card borders */
  
  /* Signal Highlights */
  --signal: #2ee58f;         /* Primary neon accent (active state, ready, correct answer) */
  --signal-deep: #0b874f;    /* Dark forest signal for badges & borders */
  --amber: #f5a623;          /* Warning, timer alert (<30s) */
  --ember: #ff6b5e;          /* Incorrect answer shake, danger, admin stop */
  --butter: #ffe36e;         /* Team captain badge, bonus points indicator */
  --pink: #ffb3cf;           /* Secondary badges, washi tape */
  --lilac: #c7b3ff;          /* Roll number chips, secondary tags */
  --sky: #9bd7ff;            /* Speed score multipliers */
  --cream: #f7f2e4;          /* High contrast sticker buttons */
  --paper: #ecefe4;          /* Inverted light accents */
  
  /* Typography Variables */
  --font-display: 'Bricolage Grotesque', -apple-system, sans-serif;
  --font-body: 'DM Sans', -apple-system, sans-serif;
  --font-editorial: 'Fraunces', Georgia, serif;
  --font-code: 'Space Mono', 'JetBrains Mono', monospace;
  --f-hand: 'Caveat', 'Comic Sans MS', cursive;
  --f-pixel: 'Pixelify Sans', monospace;
}
```

---

## 3. Typography Hierarchy & Pairings

| Role | Font Family | Attributes / CSS | Usage in Matiks |
| :--- | :--- | :--- | :--- |
| **Hero Display** | `Bricolage Grotesque` | Weight: 800, Tracking: `-0.028em`, Tight leading | Math equation numbers (`58 + 76`), Big Rank #1, Screen headers |
| **Editorial Wonk** | `Fraunces` | Italic Serif, `"SOFT" 100, "WONK" 1`, Tracking: `-0.015em` | Emphasized keywords (e.g. *"Solve with **zero** luck"*, podium ranks `01`, `02`) |
| **Telemetry & Clock**| `Space Mono` | Weight: 700, Mono tabular numbers, Tracking: `0.1em` | Countdown clock (`01:58.42`), Score counters (`+184 pts`), Roll numbers |
| **Body Sans** | `DM Sans` | Weight: 400 / 500, Text-wrap: pretty | Descriptions, team member rosters, rules |
| **Pixel Accent** | `Pixelify Sans` | Monospace pixelated glyphs, Uppercase | Rank badges (`01`, `02`), Status pills (`READY`, `LIVE`, `FREE!`) |
| **Handwritten** | `Caveat` | Cursive handwriting, Rotated $-2^\circ$ to $-6^\circ$ | Micro-notes (e.g. *"all teammates must ready up!"*, arrow doodles) |

---

## 4. Movement, Physics & Micro-Interactions (From `fossclub.tech`)

### A. Scissor-Cut Ransom Note Animation (`Ransom`)
* **3-2-1 Team Countdown:** The synchronized countdown drops $\mathbf{3} \to \mathbf{2} \to \mathbf{1} \to \mathbf{START!}$ onto the screen as giant scissor-cut paper tiles using spring physics (`stiffness: 150, damping: 13, delay: i * 0.07`).
* Each tile has randomized ragged `clip-path` polygons and distinct pastel backgrounds (`#ffe36e`, `#ffb3cf`, `#9af2c6`, `#9bd7ff`).

### B. Chunky Tactile Sticker Buttons (`.btn`)
* $2.5\text{px}$ solid border, $4\text{px}$ hard offset shadow.
* Hover: `translate(-3px, -3px) rotate(-1.2deg)` with shadow expanding to $8\text{px}$. Internal arrow circle (`.disc`) rotates $-45^\circ$.
* Active press: `translate(3px, 3px) rotate(0.5deg)` compressing into the shadow with $1\text{px}$ remaining.

### C. Washi Tape Strips (`.tape`)
Slanted decorative tape holding containers and badges:
```css
.tape {
  position: absolute;
  height: 28px;
  width: 80px;
  background: var(--tape, var(--butter));
  opacity: 0.88;
  clip-path: polygon(0% 4%, 100% 0%, 98% 96%, 2% 100%);
  pointer-events: none;
}
```

### D. Procedural Film Grain Overlay (`.grain`)
```css
.grain::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.035;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
}
```

---

## 5. View-by-View Implementation Blueprint

### 1. Student & Team Panel (`/team/:teamCode`) — *Showcase Mode*
* **Team Room Card:** 
  * Chunky $2.5\text{px}$ ink border, $7\text{px}$ hard offset shadow, butter tape in top corner.
  * Monospace eyebrow: `§ 01 // TEAM LOBBY`.
  * Connected roster showing each teammate's roll number, name, and live radar ping dot (`.ping-dot`).
  * "READY" Toggle: Button transitions from `.btn-ghost` (`[CLICK TO READY]`) to solid `.btn-signal` (`[✓ READY LOCKED]`).
* **Synchronized Countdown Overlay:**
  * When all members are ready, screen dims and the countdown displays using **Ransom** tiles:
    $$\mathbf{3} \longrightarrow \mathbf{2} \longrightarrow \mathbf{1} \longrightarrow \mathbf{START!}$$

```
┌────────────────────────────────────────────────────────────────────────┐
│ [● SSE LIVE]  § 01 // MATIKS SPEED SPRINT           TEAM: ZERO_GRAVITY │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   TEAM LOBBY: ZERO_GRAVITY (Code: #ZG-99)                              │
│   Contest Window: ACTIVE [Closes in 42m 18s]                           │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ ROSTER (3 / 3 CONNECTED)                         STATUS: WAITING│   │
│   ├────────────────────────────────────────────────────────────────┤   │
│   │ [●] Rohan Sharma (CS21045)     [CAPTAIN]     [✓ READY] (Green) │   │
│   │ [●] Priya Patel (EC21088)      [MEMBER]      [✓ READY] (Green) │   │
│   │ [●] Aarav Mehta (IT21019)      [MEMBER]      [⏳ CLICK TO READY]│   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ ⚠️ ALL TEAM MEMBERS MUST BE IN "READY" STATE TO UNLOCK SPRINT   │   │
│   │ All teammates play individually at the same time. Team score   │   │
│   │ is the AVERAGE of all members' scores!                         │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│           [ I AM READY NOW! (Sticker Button with Disc Arrow) ]         │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

### 2. The 2-Minute Sprint Arena (`/arena/:sessionId`) — *Reflex Mode (60fps)*
* **Device-Adaptive Input Architecture (Universal Explicit Submit):**
  * **Mobile Phones:** Virtual keyboard completely suppressed via `inputMode="none"`. Players interact strictly via the tactile on-screen numpad. An oversized neon green **Thumb-Enter (`ENTER ↵`)** sits next to `0`. Every single answer requires explicit submission via this button (auto-submit on 3 digits is strictly disabled to prevent muscle memory disruption across 2-digit and 3-digit sums).
  * **Laptops/Desktops:** Global `keydown` listeners capture physical numerical keys and `Enter` or `Spacebar` (Zetamac / speed math esport standard).
* **Live Teammate HUD:**
  * Non-intrusive top pills showing partners' live progress without covering the math:
    ```
    [ Rohan 🟢 Q8 • 1,240 pts ]  [ Priya 🟢 Q9 • 1,480 pts ]  [ Aarav 🟡 Q6 • 980 pts ]
    ```
* **Visual Hit Feedback:**
  * **Correct Answer:** Screen perimeter flashes signal green (`#2ee58f`), floating badge pops up (`+184 PTS`), score ticker increments smoothly.
  * **Wrong Answer:** Screen shakes horizontally ($-6\text{px} \leftrightarrow +6\text{px}$), input border turns ember red (`#ff6b5e`), displays `-20 PTS`.
  * **Last 30 Seconds:** Timer turns amber (`#f5a623`) with a pulsing heartbeat scale animation.

```
┌────────────────────────────────────────────────────────────────────────┐
│  TEAM: ZERO_GRAVITY       § 02 // SPRINT ARENA        SCORE: 1,420 PTS │
│  HUD: [Rohan: Q8 • 1240 🟢] [Priya: Q9 • 1480 🟢] [Aarav: Q6 • 980 🟡]  │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   PROGRESS: [████████████░░░░░░░░]  Q 08 / 15     TIMER: [ 01:24.4 ]   │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                                                                │   │
│   │                  58 + 76 = [ 134 ]                             │   │
│   │                                                                │   │
│   │            (Input Box with Neon Signal Border)                 │   │
│   │                                                                │   │
│   │      [ +184 PTS! (FAST +1.3s) 🔥 STREAK x1.25 ]               │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│                 TACTILE NUMPAD WITH OVERSIZED THUMB-ENTER              │
│                 ┌───────┬───────┬───────┐                              │
│                 │   1   │   2   │   3   │                              │
│                 ├───────┼───────┼───────┤                              │
│                 │   4   │   5   │   6   │                              │
│                 ├───────┼───────┼───────┤                              │
│                 │   7   │   8   │   9   │                              │
│                 ├───────┼───────┼───────┤                              │
│                 │ CLEAR │   0   │ENTER ↵│ (Oversized Green Thumb-Enter)│
│                 └───────┴───────┴───────┘                              │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

### 3. Auditorium Projector Leaderboard (`/leaderboard`) — *Showcase Mode*
* **Designed for 4K Stage Projectors:** High contrast readability from across the hall.
* **Team Average Display:** Primary score shown is the **Team Average Score**, with expandable badges showing individual members' contributions.
* **Top 3 Podium Cards:**
  * **#1 Gold:** Butter gold header (`#ffe36e`), Fraunces serif `01`, crown icon, Team Average in Space Mono.
  * **#2 Silver:** Cream header (`#f7f2e4`), Fraunces serif `02`.
  * **#3 Bronze:** Amber header (`#f5a623`), Fraunces serif `03`.
* **Framer Motion SSE Rank Swaps:** Live rank shifts animate smoothly via layout animations (`layoutId`).
* **Zero Question Leak Guarantee:** Stream strictly excludes equation operands and answer keys; only macro metrics are broadcast.

---

### 4. Admin Command Control Center (`/admin`) — *Showcase Mode*
* **Granular Team Recovery:** Individual `[PAUSE]` and `[RESUME]` buttons per team, freezing their server timer during network issues.
* **Hardware Failure Recovery (`[EXCUSE MEMBER]`):** Modal to excuse a teammate who suffered a dead battery/device crash, excluding them from the divisor with an audit justification.
* **Audit Flagging:** Teams granted re-attempts or excuse actions are flagged with `REATTEMPT_GRANTED` or `EXCUSE_MEMBER` in the audit log.
* **Test Simulation Mode:** A `[SIMULATE 5 TEAMS]` button allowing organizers to test the projector before opening the window.
