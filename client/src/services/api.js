/**
 * MATIKS HACKATHON ENGINE — REST CLIENT (api.js)
 * 
 * Provides clean typed interactions with backend REST endpoints.
 */

const API_ORIGIN = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) ? import.meta.env.VITE_API_URL.replace(/\/$/, '') : '';
const BASE_URL = `${API_ORIGIN}/api`;

/**
 * Shared fetch helper that parses response defensively and formats errors.
 */
async function request(endpoint, options = {}) {
  const mergedHeaders = {
    'ngrok-skip-browser-warning': 'true',
    ...(options.headers || {})
  };
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: mergedHeaders
  });
  let data = null;
  const contentType = res.headers.get('content-type');

  if (contentType && contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } else {
    try {
      const text = await res.text();
      data = text ? { error: text } : null;
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const errorMsg = data?.message || data?.error || `HTTP ${res.status} (${res.statusText || 'Request failed'})`;
    const err = new Error(errorMsg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

/**
 * Creates a new squad room.
 */
export async function createTeam(teamName, targetSize, captainRoll, captainName, sessionToken, operatorMode) {
  const headers = { 'Content-Type': 'application/json' };
  if (sessionToken) {
    headers['x-session-token'] = sessionToken;
  }
  return request('/team/create', {
    method: 'POST',
    headers,
    body: JSON.stringify({ teamName, targetSize, captainRoll, captainName, sessionToken, operatorMode })
  });
}

/**
 * Joins an existing squad room.
 */
export async function joinTeam(teamCode, rollNumber, name, token, sessionToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['x-member-token'] = token;
  }
  if (sessionToken) {
    headers['x-session-token'] = sessionToken;
  }
  return request('/team/join', {
    method: 'POST',
    headers,
    body: JSON.stringify({ teamCode, rollNumber, name, token, sessionToken })
  });
}

/**
 * Leaves the current squad room and frees the roll number.
 */
export async function leaveTeam(teamCode, rollNumber, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['x-member-token'] = token;
  }
  return request('/team/leave', {
    method: 'POST',
    headers,
    body: JSON.stringify({ teamCode, rollNumber, token })
  });
}

/**
 * Resets a completed squad room for a new sprint round.
 */
export async function resetTeamSprint(teamCode, rollNumber, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['x-member-token'] = token;
  }
  return request('/team/reset', {
    method: 'POST',
    headers,
    body: JSON.stringify({ teamCode, rollNumber, token })
  });
}

/**
 * Locks the squad roster at the current member count (captain only).
 */
export async function lockRoster(teamCode, rollNumber, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['x-member-token'] = token;
  }
  return request('/team/lock-roster', {
    method: 'POST',
    headers,
    body: JSON.stringify({ teamCode, rollNumber, token })
  });
}

/**
 * Toggles a member's READY status lock.
 */
export async function toggleReady(teamCode, rollNumber, isReady, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['x-member-token'] = token;
  }
  return request('/team/ready', {
    method: 'POST',
    headers,
    body: JSON.stringify({ teamCode, rollNumber, isReady, token })
  });
}

/**
 * Retrieves the current team snapshot.
 */
export async function getTeamSnapshot(teamCode, token) {
  const headers = {};
  if (token) {
    headers['x-member-token'] = token;
  }
  return request(`/team/${encodeURIComponent(teamCode)}`, { headers });
}

/**
 * How an answer is re-sent when the network lets it down. Exported so tests can shorten the waits.
 * An attempt that gets no reply within `timeoutMs` is abandoned and tried again after the matching `backoffMs`.
 */
export const submitRetryPolicy = { attempts: 3, timeoutMs: 4000, backoffMs: [250, 600] };

const RETRYABLE_STATUSES = new Set([502, 503, 504]);

/** A network failure, a timeout, or a gateway error: the answer may or may not have reached the server. Anything else is a real answer. */
function isTransientFailure(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  if (err.status === undefined) return err.name === 'TypeError';
  return RETRYABLE_STATUSES.has(err.status);
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Submits an answer to the sprint session.
 *
 * It is safe to send the same answer again: the server answers a question it has already answered from the recorded result (`replayed: true`)
 * and never counts it twice. So when the reply is lost on a weak connection, the identical request is simply sent again, and the player
 * does not end up stuck on a question the server has already moved past. Only network failures, timeouts and gateway errors are retried; a
 * refusal from the server (a 400, for instance) is final.
 */
export async function submitAnswer(sessionId, questionIndex, answer, clientDeltaMs, clientTimestamp, memberToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (memberToken) {
    headers['x-member-token'] = memberToken;
  }
  // The body is built once, so every attempt carries the same timing and the server sees one answer, however many times it arrives.
  const options = {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sessionId,
      questionIndex,
      answer,
      clientDeltaMs,
      clientTimestamp,
      token: memberToken
    })
  };

  const { attempts, timeoutMs, backoffMs } = submitRetryPolicy;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await request('/sprint/submit', { ...options, signal: controller.signal });
    } catch (err) {
      lastError = err;
      if (!isTransientFailure(err) || attempt === attempts - 1) throw err;
      await pause(backoffMs[Math.min(attempt, backoffMs.length - 1)]);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

/**
 * Synchronizes client clock with authoritative server timestamp.
 */
export async function syncClientClock() {
  return request('/sprint/sync');
}

/**
 * Admin: Toggles the contest window open or closed.
 */
export async function toggleContestWindow(open, durationMinutes, ticker, adminToken) {
  return request('/admin/window/toggle', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': adminToken || ''
    },
    body: JSON.stringify({ open, durationMinutes, ticker })
  });
}

/**
 * Admin: Excuses a member whose device crashed or disconnected ([EXCUSE MEMBER]).
 */
export async function excuseMember(teamCode, rollNumber, reason, adminToken) {
  return request(`/admin/teams/${encodeURIComponent(teamCode)}/excuse-member`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': adminToken || ''
    },
    body: JSON.stringify({ rollNumber, reason })
  });
}

/**
 * Admin: Pauses a team room sprint.
 */
export async function pauseTeam(teamCode, adminToken) {
  return request(`/admin/teams/${encodeURIComponent(teamCode)}/pause`, {
    method: 'POST',
    headers: {
      'x-admin-token': adminToken || ''
    }
  });
}

/**
 * Admin: Resumes a paused team room sprint.
 */
export async function resumeTeam(teamCode, adminToken) {
  return request(`/admin/teams/${encodeURIComponent(teamCode)}/resume`, {
    method: 'POST',
    headers: {
      'x-admin-token': adminToken || ''
    }
  });
}

/**
 * Admin: Fetches live telemetry stats.
 */
export async function getAdminTelemetry(adminToken) {
  return request('/admin/telemetry', {
    headers: {
      'x-admin-token': adminToken || ''
    }
  });
}

/**
 * Admin: Fetches all active rooms and their member snapshots.
 */
export async function getAdminRooms(adminToken) {
  return request('/admin/rooms', {
    headers: {
      'x-admin-token': adminToken || ''
    }
  });
}

/**
 * Admin: Fetches immutable audit logs.
 */
export async function getAdminAuditLogs(adminToken) {
  return request('/admin/audit-logs', {
    headers: {
      'x-admin-token': adminToken || ''
    }
  });
}

/**
 * Admin: Obtains an ephemeral single-use ticket to connect to the SSE admin stream.
 */
export async function getAdminStreamTicket(adminToken) {
  return request('/admin/stream-ticket', {
    method: 'POST',
    headers: {
      'x-admin-token': adminToken || ''
    }
  });
}

/**
 * Admin: Generates 5 simulated teams to verify 4K projector rank swap animations.
 */
export async function simulateTeams(count = 5, adminToken) {
  return request('/admin/simulate-teams', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': adminToken || ''
    },
    body: JSON.stringify({ count })
  });
}

/**
 * Admin: Clears simulated demo teams from leaderboard and memory.
 */
export async function clearSimulatedTeams(adminToken) {
  return request('/admin/clear-simulated-teams', {
    method: 'POST',
    headers: {
      'x-admin-token': adminToken || ''
    }
  });
}

/**
 * Admin: Exports sorted tournament leaderboard standings as an RFC-4180 CSV string.
 */
export async function exportTournamentCsv(adminToken) {
  const res = await fetch(`${BASE_URL}/admin/export/csv`, {
    headers: {
      'ngrok-skip-browser-warning': 'true',
      'x-admin-token': adminToken || ''
    }
  });
  const text = await res.text();
  if (!res.ok) {
    let errorMsg = `HTTP ${res.status} (${res.statusText || 'Export failed'})`;
    try {
      const parsed = JSON.parse(text);
      errorMsg = parsed?.message || parsed?.error || errorMsg;
    } catch {
      if (text) errorMsg = text;
    }
    const err = new Error(errorMsg);
    err.status = res.status;
    throw err;
  }
  return text;
}

/**
 * Admin: Exports full tournament report (standings, rooms, telemetry, and audit logs) as JSON.
 */
export async function exportTournamentJson(adminToken) {
  return request('/admin/export/json', {
    headers: {
      'x-admin-token': adminToken || ''
    }
  });
}

/**
 * Auth: Fetches active authentication configuration, OIDC URL, and server-generated state.
 */
export async function getAuthConfig(forceOidc = false) {
  const params = new URLSearchParams();
  if (forceOidc) params.set('oidc', 'true');
  const clientOrigin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
  if (clientOrigin) {
    params.set('origin', clientOrigin);
  }
  const query = params.toString() ? `?${params.toString()}` : '';
  const headers = clientOrigin ? { 'x-client-origin': clientOrigin } : {};
  return request(`/auth/config${query}`, {
    credentials: 'include',
    headers
  });
}

/**
 * Auth: Direct player roll-number login.
 */
export async function loginPlayer(rollNumber, name, teamCode) {
  return request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rollNumber, name, teamCode })
  });
}

/**
 * Auth: Admin secret passcode login.
 */
export async function loginAdmin(passcode) {
  return request('/auth/admin-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode })
  });
}

/**
 * Auth: Retrieves authenticated user profile from active session token.
 */
export async function getAuthUser(token) {
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return request('/auth/me', { headers });
}

export const getAuthMe = getAuthUser;

/**
 * Auth: Exchanges central USAR FOSS Club OIDC authorization code.
 */
export async function exchangeOidcCode(code, state, clientState) {
  const headers = { 'Content-Type': 'application/json' };
  if (clientState) {
    headers['x-client-state'] = clientState;
  }
  return request('/auth/oidc/exchange', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ code, state })
  });
}

/**
 * Auth: Verifies whether a student identifier or roll number is an official UFC club member.
 */
export async function verifyClubMembership(identifier) {
  return request(`/auth/verify-membership/${encodeURIComponent(identifier)}`);
}

/**
 * Admin: Gets current anti-screen-peeking stream delay.
 */
export async function adminGetStreamDelay(adminToken) {
  return request('/admin/stream-delay', {
    headers: {
      'x-admin-token': adminToken || ''
    }
  });
}

/**
 * Admin: Sets anti-screen-peeking stream delay in milliseconds.
 */
export async function adminSetStreamDelay(delayMs, adminToken) {
  return request('/admin/stream-delay', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': adminToken || ''
    },
    body: JSON.stringify({ delayMs })
  });
}

/**
 * Admin: Immediately flushes pending delayed leaderboard broadcasts to stage screen.
 */
export async function adminFlushLeaderboard(adminToken) {
  return request('/admin/flush-leaderboard', {
    method: 'POST',
    headers: {
      'x-admin-token': adminToken || ''
    }
  });
}

/**
 * Admin: Fetches summary list of all available sprint session replays.
 */
export async function adminGetSessionReplays(adminToken) {
  return request('/admin/replays', {
    headers: {
      'x-admin-token': adminToken || ''
    }
  });
}

/**
 * Admin: Fetches full question-by-question chronology and timing diagnostics for a sprint session.
 */
export async function adminGetSessionReplay(sessionId, adminToken) {
  return request(`/admin/replay/${encodeURIComponent(sessionId)}`, {
    headers: {
      'x-admin-token': adminToken || ''
    }
  });
}

/**
 * Admin: Exports per-player audit chronology as an RFC-4180 CSV string.
 */
export async function exportPlayerAuditsCsv(adminToken) {
  const res = await fetch(`${BASE_URL}/admin/export/player-audits-csv`, {
    headers: {
      'ngrok-skip-browser-warning': 'true',
      'x-admin-token': adminToken || '',
      ...(adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {})
    }
  });
  const text = await res.text();
  if (!res.ok) {
    let errorMsg = `HTTP ${res.status} (${res.statusText || 'Export failed'})`;
    try {
      const parsed = JSON.parse(text);
      errorMsg = parsed?.message || parsed?.error || errorMsg;
    } catch {
      if (text) errorMsg = text;
    }
    const err = new Error(errorMsg);
    err.status = res.status;
    throw err;
  }
  return text;
}

/**
 * Admin: Authenticate organizer with secret and organizer name, returning signed HMAC session token.
 */
export async function adminLogin(secret, organizerName) {
  return request('/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, organizerName })
  });
}

/**
 * Admin: Emergency halt all active sprints simultaneously.
 */
export async function adminEmergencyPauseAll(adminToken) {
  return request('/admin/emergency/pause-all', {
    method: 'POST',
    headers: {
      'x-admin-token': adminToken || '',
      ...(adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {})
    }
  });
}

/**
 * Admin: Emergency unfreeze all paused sprints with synchronized countdown.
 */
export async function adminEmergencyResumeAll(adminToken) {
  return request('/admin/emergency/resume-all', {
    method: 'POST',
    headers: {
      'x-admin-token': adminToken || '',
      ...(adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {})
    }
  });
}

/**
 * Admin: Broadcast high-priority flash banner to all live rooms.
 */
export async function adminFlashBroadcast(message, priority = 'emergency', adminToken) {
  return request('/admin/broadcast', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': adminToken || '',
      ...(adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {})
    },
    body: JSON.stringify({ message, priority })
  });
}

/**
 * Admin: Kick a disruptive or phantom member from a pre-sprint room (LOBBY/AWAITING_READY).
 */
export async function adminKickMember(teamCode, rollNumber, adminToken) {
  return request(`/admin/teams/${encodeURIComponent(teamCode)}/kick-member`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': adminToken || '',
      ...(adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {})
    },
    body: JSON.stringify({ rollNumber })
  });
}

/**
 * Admin: Dissolve an abandoned or invalid pre-sprint room.
 */
export async function adminDissolveRoom(teamCode, reason, adminToken) {
  return request(`/admin/teams/${encodeURIComponent(teamCode)}/dissolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': adminToken || '',
      ...(adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {})
    },
    body: JSON.stringify({ reason })
  });
}

/**
 * Admin: Disqualify a team and sink them to the bottom of standings.
 */
export async function adminDisqualifyTeam(teamCode, reason, adminToken) {
  return request(`/admin/teams/${encodeURIComponent(teamCode)}/disqualify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': adminToken || '',
      ...(adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {})
    },
    body: JSON.stringify({ reason })
  });
}

/**
 * Admin: Reinstate a disqualified team to active standings.
 */
export async function adminReinstateTeam(teamCode, adminToken) {
  return request(`/admin/teams/${encodeURIComponent(teamCode)}/reinstate`, {
    method: 'POST',
    headers: {
      'x-admin-token': adminToken || '',
      ...(adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {})
    }
  });
}

/**
 * Admin: Manually adjust team score with mandatory audit justification.
 */
export async function adminAdjustScore(teamCode, scoreDelta, reason, adminToken) {
  return request(`/admin/teams/${encodeURIComponent(teamCode)}/adjust-score`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': adminToken || '',
      ...(adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {})
    },
    body: JSON.stringify({ deltaPoints: scoreDelta, reason })
  });
}

/**
 * Admin: Retrieve the active tournament round operator mode ('add' | 'sub' | 'mixed').
 */
export async function adminGetRoundMode(adminToken) {
  return request('/admin/round-mode', {
    headers: {
      'x-admin-token': adminToken || '',
      ...(adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {})
    }
  });
}

/**
 * Admin: Set tournament round operator mode for subsequent rooms and rematches.
 */
export async function adminSetRoundMode(mode, adminToken) {
  return request('/admin/round-mode', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': adminToken || '',
      ...(adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {})
    },
    body: JSON.stringify({ operatorMode: mode })
  });
}

/**
 * Admin: Toggle emergency walk-in entry bypass (when OIDC service is inaccessible).
 */
export async function adminSetEmergencyWalkIn(enabled, adminToken) {
  return request('/admin/emergency-walk-in', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': adminToken || '',
      ...(adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {})
    },
    body: JSON.stringify({ enabled })
  });
}





/**
 * Public: Get the public registered teams list from the active event roster.
 */
export async function getPublicRoster() {
  return request('/teams/roster');
}

/**
 * Public: Check into pre-assigned squad using verified/registered email.
 */
export async function checkinByEmail(email, name) {
  return request('/team/checkin-by-email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, name })
  });
}

/**
 * Admin: Upload custom event roster CSV.
 */
export async function adminUploadRosterCsv(csvText, adminToken) {
  return request('/admin/roster/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': adminToken || '',
      ...(adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {})
    },
    body: JSON.stringify({ csv: csvText })
  });
}

/**
 * Admin: Load server-side preset CSV ('competition-roster' or 'final-selected-teams').
 */
export async function adminLoadRosterPreset(preset, adminToken) {
  return request('/admin/roster/load-preset', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': adminToken || '',
      ...(adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {})
    },
    body: JSON.stringify({ preset })
  });
}

/**
 * Admin: Retrieve full roster with participant emails and check-in status.
 */
export async function adminGetRoster(adminToken) {
  return request('/admin/roster', {
    headers: {
      'x-admin-token': adminToken || '',
      ...(adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {})
    }
  });
}

/**
 * Admin: Reset a participant's check-in status.
 */
export async function adminResetRosterMember(email, adminToken) {
  return request('/admin/roster/reset-member', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': adminToken || '',
      ...(adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {})
    },
    body: JSON.stringify({ email })
  });
}

/**
 * Admin: Clear event roster.
 */
export async function adminClearRoster(adminToken) {
  return request('/admin/roster', {
    method: 'DELETE',
    headers: {
      'x-admin-token': adminToken || '',
      ...(adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {})
    }
  });
}
