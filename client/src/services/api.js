/**
 * MATIKS HACKATHON ENGINE — REST CLIENT (api.js)
 * 
 * Provides clean typed interactions with backend REST endpoints.
 */

const BASE_URL = '/api';

/**
 * Shared fetch helper that parses response defensively and formats errors.
 */
async function request(endpoint, options = {}) {
  const res = await fetch(`${BASE_URL}${endpoint}`, options);
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
export async function createTeam(teamName, targetSize, captainRoll, captainName) {
  return request('/team/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamName, targetSize, captainRoll, captainName })
  });
}

/**
 * Joins an existing squad room.
 */
export async function joinTeam(teamCode, rollNumber, name, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['x-member-token'] = token;
  }
  return request('/team/join', {
    method: 'POST',
    headers,
    body: JSON.stringify({ teamCode, rollNumber, name, token })
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
 * Submits an answer to the sprint session.
 */
export async function submitAnswer(sessionId, questionIndex, answer, clientDeltaMs, clientTimestamp, memberToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (memberToken) {
    headers['x-member-token'] = memberToken;
  }
  return request('/sprint/submit', {
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
  });
}
