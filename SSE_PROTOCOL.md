# MATIKS HACKATHON ENGINE — SERVER-SENT EVENTS (SSE) PROTOCOL SPECIFICATION

> **Document Version:** 1.2.0  
> **Protocol:** Server-Sent Events (`text/event-stream`) over HTTP/1.1 or HTTP/2  
> **Directionality:** Unidirectional Server $\rightarrow$ Client Streaming + REST POST Client $\rightarrow$ Server  
> **Network Guarantee:** Built for enterprise campus Wi-Fi resiliency, zero WebSocket handshake drops.

---

## 1. Network Architecture Overview

Instead of duplex WebSockets, this platform separates concerns into two clean transport channels:
1. **Inbound Commands (Client $\rightarrow$ Server REST POST):**
   * `POST /api/team/join` — Register roll number & name in team lobby.
   * `POST /api/team/ready` — Toggle atomic member ready status.
   * `POST /api/sprint/submit` — Submit question answer with client timestamp & measured latency delta.
   * `POST /api/admin/teams/:teamCode/excuse-member` — Organizer recovery endpoint to excuse a member who suffered hardware failure.
2. **Outbound Push (Server $\rightarrow$ Client SSE):** High-throughput, low-latency Server-Sent Events (`EventSource`) streaming structured JSON messages with query-parameter authentication (`?token=...`).

```
       CLIENT (Browser / Projector)              SERVER (Node.js Express SSE Hub)
            │                                                 │
            │─── 1. GET /api/sse/team/:teamCode?token=x ─────>│ (Establishes EventStream)
            │<── :keepalive (every 15s) ──────────────────────│
            │                                                 │
            │─── 2. POST /api/team/ready (REST) ─────────────>│ (Processes Ready State)
            │<── 200 OK { success: true } ────────────────────│
            │                                                 │
            │<── event: member_ready ─────────────────────────│ (Broadcasts to all members)
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
:keepalive [timestamp=1733918400000]

```

---

## 3. SSE Channels Directory

| Channel Path | Audience | Content / Scope |
| :--- | :--- | :--- |
| **`/api/sse/team/:teamCode?token=xxx`** | Connected members of a team | Room membership, ready status toggles, team member roster, synchronized countdown, individual sprint sessions, teammate progress HUD. |
| **`/api/sse/leaderboard`** | All active participants & Auditorium Projector | Real-time global rankings based on **Team Average Score**, podium shifts, contest window status. |
| **`/api/sse/admin?token=admin_secret`** | Hackathon Organizers / Admin Panel | Room health, active sprint sessions, anomaly detection logs, individual team pause/resume. |

---

## 4. Event Schemas & Message Specifications

### Channel A: `/api/sse/team/:teamCode`

#### 1. `event: team_snapshot`
Sent immediately when a member connects or reconnects to the team lobby.
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
Triggered at `T=0` of countdown. Launches parallel individual sessions for all members simultaneously.
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
  }
}
```

#### 5. `event: teammate_progress`
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

---

### Channel B: `/api/sse/leaderboard`

#### 1. `event: leaderboard_update`
Dispatched whenever any team's average score shifts.
```json
event: leaderboard_update
data: [
  {
    "rank": 1,
    "teamCode": "AR-12",
    "teamName": "AlgoRhythms",
    "teamAverageScore": 2540.33,
    "membersCount": 3,
    "averageTimeSeconds": 54.2,
    "memberBreakdown": [
      { "name": "Deepak", "score": 2680 },
      { "name": "Kavya", "score": 2510 },
      { "name": "Sahil", "score": 2431 }
    ],
    "status": "FINISHED"
  },
  {
    "rank": 2,
    "teamCode": "ZG-99",
    "teamName": "Zero Gravity",
    "teamAverageScore": 2210.67,
    "membersCount": 3,
    "averageTimeSeconds": 62.4,
    "memberBreakdown": [
      { "name": "Rohan", "score": 2420 },
      { "name": "Priya", "score": 2380 },
      { "name": "Aarav", "score": 1832 }
    ],
    "status": "IN_SPRINT"
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

### Channel C: `/api/sse/admin?token=admin_secret`

#### 1. `event: admin_telemetry`
High-frequency session overview for organizers.
```json
event: admin_telemetry
data: {
  "activeRooms": 14,
  "activeSprinters": 42,
  "completedSprinters": 128,
  "windowOpen": true,
  "serverCpuPercent": 4.2,
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
  3. Network Transit Grace: Submissions up to $+2.5\text{ s}$ past 120s are accepted if `clientTimestamp <= sprintStartedAt + 120,000`.

### 2. `POST /api/admin/teams/:teamCode/excuse-member`
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
