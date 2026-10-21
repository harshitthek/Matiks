# MATIKS HACKATHON ENGINE — SERVER-SENT EVENTS (SSE) PROTOCOL SPECIFICATION

> **Document Version:** 2.0.0  
> **Protocol:** Server-Sent Events (`text/event-stream`) over HTTP/1.1 or HTTP/2  
> **Directionality:** Unidirectional Server $\rightarrow$ Client Streaming + REST Client $\rightarrow$ Server  
> **Network Guarantee:** Built for enterprise campus Wi-Fi resiliency, circular buffer replay, and multi-tab state recovery.

---

## 1. Network Architecture Overview

Instead of duplex WebSockets, this platform separates concerns into two clean transport channels:
1. **Inbound Commands (Client $\rightarrow$ Server REST):**
   * `POST /api/team/create` & `POST /api/team/join` — Create a team room or register roll number & name in an existing squad.
   * `POST /api/team/ready` — Toggle atomic member ready status.
   * `POST /api/team/leave` & `POST /api/team/reset` — Leave a squad (with automatic captain succession) or reset a completed sprint for a rematch.
   * `POST /api/sprint/submit` — Submit question answer with client timestamp & measured latency delta.
   * `POST /api/admin/stream-ticket` — Exchange `ADMIN_SECRET` for a 60-second single-use SSE stream ticket.
   * `POST /api/admin/teams/:teamCode/excuse-member` — Organizer recovery endpoint to excuse a member who suffered hardware failure.
   * `GET /api/admin/export/csv` & `GET /api/admin/export/json` — Download RFC-4180 formula-safe CSV standings and full JSON tournament reports.
2. **Outbound Push (Server $\rightarrow$ Client SSE):** High-throughput, low-latency Server-Sent Events (`EventSource`) streaming structured JSON messages with token/ticket query-parameter authentication and reference-counted multi-tab presence tracking.

```
       CLIENT (Browser / Projector)              SERVER (Node.js Express SSE Hub)
            │                                                 │
            │─── 1. GET /api/sse/team/:teamCode?token=x ─────>│ (Establishes EventStream)
            │<── :connected + event: team_snapshot ───────────│ (Immediate Snapshot + sprint_resume)
            │<── :keepalive (every 15s) ──────────────────────│
            │                                                 │
            │─── 2. POST /api/team/ready (REST) ─────────────>│ (Processes Ready State)
            │<── 200 OK { success: true } ────────────────────│
            │                                                 │
            │<── event: member_ready_changed ─────────────────│ (Broadcasts to all members)
            │<── event: countdown_tick (3, 2, 1) ─────────────│ (Synchronized Countdown)
            │<── event: sprint_start (Parallel Sessions) ─────│ (Launches Individual Sprints)
            │                                                 │
            │─── 3. POST /api/sprint/submit (REST) ──────────>│ (Computes Latency & Calibrated Score)
            │       { answer: 134, clientDeltaMs: 1240 }      │ (Validates |serverDelta - clientDelta| <= 350ms)
            │<── 200 OK { isCorrect: true, points: 184 } ────│
            │                                                 │
            │<── event: teammate_progress (Team SSE) ─────────│ (Pushes partner Q progress to HUD)
            │<── event: leaderboard_update (Global SSE) ──────│ (Pushes Macro Telemetry ONLY - No Leak)
```

---

## 2. SSE Server Configuration & Transport Headers

Every SSE endpoint MUST respond with the following HTTP headers:

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
Access-Control-Allow-Origin: *
```

### Keepalive Heartbeat
To prevent reverse proxies (Nginx, Cloudflare) and campus Wi-Fi stateful NAT routers from killing idle connections, the server emits a comment ping every 15 seconds:
```
:keepalive 1733918400000

```

---

## 3. SSE Channels Directory

| Channel Path | Audience | Content / Scope |
| :--- | :--- | :--- |
| **`/api/sse/team/:teamCode?token=xxx`** | Connected members of a team | Room membership, ready status toggles, team member roster, synchronized countdown, `sprint_start`, `sprint_resume` state recovery, `room_paused`/`room_resumed`, and teammate progress HUD. |
| **`/api/sse/leaderboard`** | All active participants & Auditorium Projector | Real-time global rankings based on **Team Average Score**, podium shifts, contest window status. |
| **`/api/sse/admin?ticket=xxx`** | Hackathon Organizers / Admin Panel | Authenticated via single-use 60s ticket from `POST /api/admin/stream-ticket`. Streams room health, active sprint sessions, anomaly detection logs, and individual team pause/resume. |

---

## 4. Event Schemas & Message Specifications

### Channel A: `/api/sse/team/:teamCode`

#### 1. `event: team_snapshot`
Sent immediately when a member connects or reconnects to the team lobby, and whenever roster/room state changes. Multi-tab connections are reference-counted per member so closing one browser tab does not mark a still-connected student offline.
```json
event: team_snapshot
data: {
  "teamCode": "ZG-99",
  "teamName": "Zero Gravity",
  "targetSize": 3,
  "members": [
    { "rollNumber": "CS21045", "name": "Rohan Sharma", "isCaptain": true, "isReady": true, "connected": true },
    { "rollNumber": "EC21088", "name": "Priya Patel", "isCaptain": false, "isReady": true, "connected": true },
    { "rollNumber": "IT21019", "name": "Aarav Mehta", "isCaptain": false, "isReady": false, "connected": true }
  ],
  "allReady": false,
  "status": "AWAITING_READY",
  "isPaused": false,
  "contestWindow": { "isOpen": true, "closesAt": 1733922000000 }
}
```

#### 2. `event: member_ready_changed`
Broadcast when any member toggles their "READY" button.
```json
event: member_ready_changed
data: {
  "rollNumber": "IT21019",
  "isReady": true,
  "readyCount": 3,
  "targetSize": 3,
  "allReady": true
}
```

#### 3. `event: countdown_tick`
Broadcast when `allReady === true` and the contest window is open. Ticks synchronously across all team members' screens.
```json
event: countdown_tick
data: {
  "secondsRemaining": 3,
  "message": "GET READY!"
}
```

#### 4. `event: sprint_start`
Triggered at `T=0` of countdown. Launches parallel individual sessions for all members simultaneously with sanitized per-player question permutations.
```json
event: sprint_start
data: {
  "startedAt": 1733918450120,
  "durationSeconds": 120,
  "totalQuestions": 15,
  "sessions": {
    "CS21045": "sess_rohan_91a",
    "EC21088": "sess_priya_88b",
    "IT21019": "sess_aarav_33c"
  },
  "questionsByRollNumber": {
    "CS21045": [{ "id": 1, "a": 48, "b": 76, "carries": 2, "targetLatencySeconds": 8 }]
  }
}
```

#### 5. `event: sprint_resume`
Sent directly to a reconnecting member when their room is in `IN_SPRINT` status with an active unfinished session. Restores full progress, accuracy history (`submissions`), peak streak (`maxStreak`), and authoritative `remainingMs` across page refreshes or view navigation.
```json
event: sprint_resume
data: {
  "sessionId": "sess_priya_88b",
  "rollNumber": "EC21088",
  "startedAt": 1733918450120,
  "expiresAt": 1733918570120,
  "remainingMs": 84210,
  "isPaused": false,
  "questionIndex": 5,
  "currentScore": 840,
  "streak": 3,
  "maxStreak": 4,
  "submissions": [
    { "questionIndex": 0, "submittedAnswer": 124, "isCorrect": true, "latencyMs": 1120, "pointsAwarded": 186 }
  ],
  "questions": [{ "id": 1, "a": 48, "b": 76, "carries": 2, "targetLatencySeconds": 8 }]
}
```

#### 6. `event: teammate_progress`
Broadcast to team members whenever any teammate submits an answer, feeding the live Teammate HUD pills.
```json
event: teammate_progress
data: {
  "rollNumber": "EC21088",
  "name": "Priya Patel",
  "questionIndex": 8,
  "currentScore": 1420,
  "streak": 5
}
```

#### 7. `event: room_paused` & `event: room_resumed`
Broadcast when an organizer pauses or resumes an active sprint room, freezing the client timer and extending session `expiresAt` by the exact paused duration upon resume.

---

### Channel B: `/api/sse/leaderboard`

#### 1. `event: leaderboard_update`
Dispatched whenever any team's average score shifts (coalesced within a 50ms broadcast window under high concurrency).
```json
event: leaderboard_update
data: [
  {
    "rank": 1,
    "teamCode": "AR-12",
    "teamName": "AlgoRhythms",
    "teamAverageScore": 2540.33,
    "membersCount": 3,
    "activeMembersCount": 3,
    "averageTimeSeconds": 54.2,
    "memberBreakdown": [
      { "name": "Deepak", "score": 2680, "completedQuestions": 15, "isExcused": false },
      { "name": "Kavya", "score": 2510, "completedQuestions": 15, "isExcused": false },
      { "name": "Sahil", "score": 2431, "completedQuestions": 15, "isExcused": false }
    ],
    "status": "FINISHED"
  }
]
```

#### 2. `event: window_status`
Broadcast when admin opens or closes the hackathon contest window.
```json
event: window_status
data: {
  "isOpen": true,
  "opensAt": 1733916000000,
  "closesAt": 1733922000000,
  "serverTime": 1733918450000
}
```

> **Zero Question Leak Guarantee:** Under no circumstances does `/api/sse/leaderboard` broadcast arithmetic operands ($A, B$) or question solutions. Only macro rankings and average points are streamed to ensure complete anti-cheat integrity in the auditorium.

---

### Channel C: `/api/sse/admin?ticket=xxx`

To prevent exposing `ADMIN_SECRET` in URLs or proxy logs, the Admin Command Center first requests a short-lived (60s), single-use ticket via `POST /api/admin/stream-ticket` (passing `x-admin-token` in HTTP headers) and connects with `?ticket=...`.

#### 1. `event: admin_telemetry`
Coalesced session overview for organizers.
```json
event: admin_telemetry
data: {
  "activeRooms": 14,
  "activeSprinters": 42,
  "completedSprinters": 128,
  "windowOpen": true,
  "serverCpuPercent": 0,
  "rssMemoryMb": 68.4
}
```

#### 2. `event: anomaly_flag`
Fired immediately when the server anti-cheat middleware detects bot automation or abnormal latency.
```json
event: anomaly_flag
data: {
  "timestamp": 1733918520110,
  "teamCode": "ZG-99",
  "rollNumber": "IT21019",
  "name": "Aarav Mehta",
  "sessionId": "sess_aarav_33c",
  "questionIndex": 4,
  "clientDeltaMs": 110,
  "flagReason": "SUB_200MS_SPEED_ANOMALY"
}
```

---

## 5. Inbound REST Endpoint Specifications & Payloads

### 1. `POST /api/sprint/submit`
Used by students to submit their answer during the 2-minute sprint.
* **Payload:**
  ```json
  {
    "sessionId": "sess_priya_88b",
    "questionIndex": 4,
    "submittedAnswer": 134,
    "clientDeltaMs": 1240,
    "clientTimestamp": 1733918451240
  }
  ```
* **Validation Rules:**
  1. `clientDeltaMs >= 200`: If $< 200\text{ ms}$, flags `SUB_200MS_SPEED_ANOMALY`.
  2. Latency Jitter Tolerance: $| \text{serverDeltaMs} - \text{clientDeltaMs} | \le 350\text{ ms}$.
  3. Network Transit Grace: Submissions up to $+2.5\text{ s}$ past 120s are accepted (`now <= session.expiresAt + 2500`).
  4. Sequential progression: a question not yet reached (`questionIndex` ahead of the session) is refused.
* **Safe to send again (idempotent):** a question that has already been answered is never scored twice. The first answer stands, and sending the question again (same answer or not) returns the recorded result with `200 OK`:
  ```json
  { "success": true, "isCorrect": true, "pointsAwarded": 184, "currentScore": 184, "consecutiveStreak": 1,
    "completedQuestions": 1, "isFinished": false, "isAnomaly": false,
    "replayed": true, "answerMismatch": false }
  ```
  `answerMismatch` is `true` when the resent answer differs from the recorded one. A replay changes no score, writes nothing, and broadcasts no event, and it is checked after the member token (a replay still needs the player's own token). This is what lets the client re-send an answer whose reply was lost on a weak connection without leaving the player stuck. First-time responses carry neither field.

### 2. `POST /api/team/reset` & `POST /api/team/leave`
* `POST /api/team/reset`: Resets a completed squad room back to `AWAITING_READY` (or `LOBBY`) for a rematch while retaining the squad's `roomUsedPairKeys` so subsequent games never repeat questions.
* `POST /api/team/leave`: Removes a member from a squad, automatically promoting the next active member to Captain if the Captain leaves, or dissolving the room if empty.

### 3. `POST /api/admin/teams/:teamCode/excuse-member`
Used by hackathon organizers to recover a team from a member's hardware failure (dead battery, browser crash).
* **Payload:**
  ```json
  {
    "rollNumber": "IT21019",
    "reason": "Battery died at Question 6 during hackathon"
  }
  ```
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "teamCode": "ZG-99",
    "excusedMember": "IT21019",
    "activeMembersCount": 2,
    "newTeamAverageScore": 2400.0,
    "auditRecordId": "aud_excuse_9921"
  }
  ```

### 4. `GET /api/admin/export/csv` & `GET /api/admin/export/json`
Authenticated organizer endpoints returning downloadable tournament standings (`Content-Disposition: attachment`). CSV cells are sanitized against spreadsheet formula injection (`=`, `+`, `-`, `@`, `\t`, `\r`) while preserving negative numeric values.

---

## 6. Client Reconnection & Resiliency Watchdog

```javascript
// Resilient Client Implementation with Visibility Watchdog
const token = getSessionToken();
const eventSource = new EventSource(`/api/sse/team/${teamCode}?token=${token}`);

let lastPing = Date.now();

eventSource.addEventListener('message', () => {
  lastPing = Date.now();
});

// Watchdog: Force reconnect if keepalive packet missing > 20s
const watchdog = setInterval(() => {
  if (Date.now() - lastPing > 20000) {
    console.warn("SSE connection timed out. Forcing reconnection...");
    eventSource.close();
    reconnectSSE();
  }
}, 5000);

// Background Tab Sleep Recovery: Resync authoritative clock on tab return
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    fetch(`/api/sprint/sync?token=${token}`)
      .then(res => res.json())
      .then(syncData => updateClientClock(syncData));
  }
});
```

---

## 7. `Last-Event-ID` Monotonic Circular Buffer Replay

To survive Wi-Fi packet loss without triggering expensive full-state roundtrips, the SSE Hub implements monotonic 64-bit sequence tagging and circular buffer replay:

1. **Monotonic IDs:** Every SSE data event is prefixed with a composite `epoch:seq` ID (`id: <epoch>:<seq>\n`).
2. **In-Memory Ring Buffer:** Retains the last $K = 100$ events per channel.
3. **Reconnection Header & Query Param:** When `EventSource` reconnects or reloads, it sends the full `epoch:seq` string via `Last-Event-ID: <epoch>:<seq>` or `?lastEventId=<epoch>:<seq>` (a bare `<seq>` number is also accepted for legacy clients, skipping epoch validation).
4. **Replay Dispatch:** If the requested sequence number is within the retained buffer and the epoch matches, the server immediately pushes missed events $[ \text{lastEventId} + 1, \text{latest} ]$.
5. **Epoch Desynchronization Protection:** The server boots with a process epoch (`Math.floor(Date.now() / 1000)` Unix seconds at startup). If the server restarts (causing an epoch mismatch) or the client's `lastEventId` falls outside the retained buffer, the server emits `event: stream_resync` instructing the client to fetch a fresh full snapshot.

---

## 8. Anti-Screen-Peeking Delay Queue & Observability

### Public Leaderboard Delay Queue
* **Purpose:** Prevents students near stage projectors from peeking at opponents' active streaks to gauge risk/pace.
* **Mechanism:** Public `/api/sse/leaderboard` streams through a sliding FIFO queue with configurable delay (`LEADERBOARD_STREAM_DELAY_MS`, default 5000ms).
* **Instant Flush:** The moment the contest window is closed or enters the 3-second settling freeze, the delayed queue is instantly flushed to display authoritative final standings for the podium reveal.

### Production Observability Endpoints
* `GET /metrics`: Prometheus text exposition endpoint. Authentication is enforced in production (`NODE_ENV=production`) or when `REQUIRE_METRICS_AUTH=true` (and whenever `METRICS_TOKEN` is configured outside `NODE_ENV=test`) via constant-time `METRICS_TOKEN` / `ADMIN_SECRET` verification (`Authorization: Bearer <token>` or `x-metrics-token`), and remains open for local scraping in development (when `METRICS_TOKEN` is unset) and test environments. Exposes active SSE connections, submission counters, latency histograms (SSE streams excluded to protect percentiles), and room states.
* `GET /api/admin/replay/:sessionId`: Streams millisecond-by-millisecond question submission telemetry from disk audits into the admin dispute inspector modal.
