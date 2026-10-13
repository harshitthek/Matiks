/**
 * MATIKS HACKATHON ENGINE — REALTIME SSE CLIENT (sse.js)
 * 
 * Implements browser EventSource subscription with:
 * 1. Automatic reconnection and token authentication
 * 2. 20-second heartbeat timeout watchdog (ADR-05)
 * 3. document.visibilitychange background-tab resync watchdog
 */

const API_ORIGIN = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) ? import.meta.env.VITE_API_URL.replace(/\/$/, '') : '';

export function connectTeamStream(teamCode, token, handlers = {}) {
  let eventSource = null;
  let keepaliveTimer = null;
  let isIntentionallyClosed = false;
  let retryTimeout = null;
  let retryAttempts = 0;
  let lastEventId = null;
  const BASE_RETRY_DELAY_MS = 1000;
  const MAX_RETRY_DELAY_MS = 15000;

  const resetKeepaliveWatchdog = () => {
    if (keepaliveTimer) clearTimeout(keepaliveTimer);
    // If no keepalive comment or message arrives within 25 seconds, reconnect
    keepaliveTimer = setTimeout(() => {
      console.warn('[SSE] Heartbeat timed out (>25s). Reconnecting stream...');
      reconnect();
    }, 25_000);
  };

  const updateEventId = (e) => {
    if (e?.lastEventId) {
      lastEventId = e.lastEventId;
    }
  };

  const init = () => {
    if (isIntentionallyClosed) return;

    if (retryTimeout) {
      clearTimeout(retryTimeout);
      retryTimeout = null;
    }
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    let url = `${API_ORIGIN}/api/sse/team/${encodeURIComponent(teamCode)}?token=${encodeURIComponent(token)}`;
    if (lastEventId) {
      url += `&lastEventId=${encodeURIComponent(lastEventId)}`;
    }
    eventSource = new EventSource(url);

    eventSource.onopen = () => {
      retryAttempts = 0;
      handlers.onConnectionChange?.(true);
      resetKeepaliveWatchdog();
    };

    eventSource.onerror = (err) => {
      console.warn('[SSE] EventSource connection error:', err);
      handlers.onConnectionChange?.(false);
      handlers.onError?.(err);
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (keepaliveTimer) {
        clearTimeout(keepaliveTimer);
        keepaliveTimer = null;
      }

      if (!isIntentionallyClosed) {
        if (retryTimeout) clearTimeout(retryTimeout);
        const delay = Math.min(BASE_RETRY_DELAY_MS * Math.pow(1.5, retryAttempts), MAX_RETRY_DELAY_MS);
        retryAttempts++;
        retryTimeout = setTimeout(() => {
          init();
        }, delay);
      }
    };

    // 1. Initial snapshot
    eventSource.addEventListener('team_snapshot', (e) => {
      updateEventId(e);
      resetKeepaliveWatchdog();
      try {
        const data = JSON.parse(e.data);
        handlers.onSnapshot?.(data);
      } catch (err) {
        console.error('[SSE] Failed to parse team_snapshot:', err);
      }
    });

    // 2. Member ready status change
    eventSource.addEventListener('member_ready_changed', (e) => {
      updateEventId(e);
      resetKeepaliveWatchdog();
      try {
        const data = JSON.parse(e.data);
        handlers.onMemberReady?.(data);
      } catch (err) {
        console.error('[SSE] Failed to parse member_ready_changed:', err);
      }
    });

    // 3. Synchronized countdown ticks (3, 2, 1)
    eventSource.addEventListener('countdown_tick', (e) => {
      updateEventId(e);
      resetKeepaliveWatchdog();
      try {
        const data = JSON.parse(e.data);
        handlers.onCountdownTick?.(data);
      } catch (err) {
        console.error('[SSE] Failed to parse countdown_tick:', err);
      }
    });

    // 4. Synchronized sprint launch
    eventSource.addEventListener('sprint_start', (e) => {
      updateEventId(e);
      resetKeepaliveWatchdog();
      try {
        const data = JSON.parse(e.data);
        handlers.onSprintStart?.(data);
      } catch (err) {
        console.error('[SSE] Failed to parse sprint_start:', err);
      }
    });

    // 5. Mid-sprint reconnection resume
    eventSource.addEventListener('sprint_resume', (e) => {
      updateEventId(e);
      resetKeepaliveWatchdog();
      try {
        const data = JSON.parse(e.data);
        handlers.onSprintResume?.(data);
      } catch (err) {
        console.error('[SSE] Failed to parse sprint_resume:', err);
      }
    });

    // 5b. Flash announcement banner
    eventSource.addEventListener('flash_announcement', (e) => {
      updateEventId(e);
      resetKeepaliveWatchdog();
      try {
        const data = JSON.parse(e.data);
        handlers.onFlashAnnouncement?.(data);
      } catch (err) {
        console.error('[SSE] Failed to parse flash_announcement:', err);
      }
    });

    // 6. Teammate progress HUD update
    eventSource.addEventListener('teammate_progress', (e) => {
      updateEventId(e);
      resetKeepaliveWatchdog();
      try {
        const data = JSON.parse(e.data);
        handlers.onTeammateProgress?.(data);
      } catch (err) {
        console.error('[SSE] Failed to parse teammate_progress:', err);
      }
    });

    // 7. Room pause/resume
    eventSource.addEventListener('room_paused', (e) => {
      updateEventId(e);
      resetKeepaliveWatchdog();
      handlers.onRoomPaused?.();
    });

    eventSource.addEventListener('room_resumed', (e) => {
      updateEventId(e);
      resetKeepaliveWatchdog();
      handlers.onRoomResumed?.();
    });

    // 8. Error / launch failure
    eventSource.addEventListener('sprint_error', (e) => {
      updateEventId(e);
      resetKeepaliveWatchdog();
      try {
        const data = JSON.parse(e.data);
        handlers.onSprintError?.(data);
      } catch (err) {
        console.error('[SSE] Failed to parse sprint_error:', err);
      }
    });

    // 9. Unrecoverable buffer gap / forced resynchronization
    eventSource.addEventListener('stream_resync', (e) => {
      updateEventId(e);
      resetKeepaliveWatchdog();
      try {
        const data = JSON.parse(e.data);
        handlers.onStreamResync?.(data);
      } catch (err) {
        console.error('[SSE] Failed to parse stream_resync:', err);
      }
    });
  };

  const reconnect = () => {
    retryAttempts = 0;
    if (retryTimeout) {
      clearTimeout(retryTimeout);
      retryTimeout = null;
    }
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    init();
  };

  // Background tab visibility watchdog (ADR-05)
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && !isIntentionallyClosed) {
      // Upon tab return, verify connection state
      if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
        reconnect();
      }
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);

  init();

  return {
    disconnect: () => {
      isIntentionallyClosed = true;
      retryAttempts = 0;
      if (keepaliveTimer) clearTimeout(keepaliveTimer);
      if (retryTimeout) clearTimeout(retryTimeout);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      handlers.onConnectionChange?.(false);
    },
    reconnect,
    getLastEventId: () => lastEventId
  };
}

/**
 * Connects to the public Auditorium Big-Screen Leaderboard SSE stream (/api/sse/leaderboard).
 * Zero Question Leak Guarantee (ADR-08): Macro telemetry only.
 */
export function connectLeaderboardStream(handlers = {}) {
  let eventSource = null;
  let keepaliveTimer = null;
  let isIntentionallyClosed = false;
  let retryTimeout = null;
  let retryAttempts = 0;
  let lastEventId = null;
  const BASE_RETRY_DELAY_MS = 1000;
  const MAX_RETRY_DELAY_MS = 15000;

  const resetKeepaliveWatchdog = () => {
    if (keepaliveTimer) clearTimeout(keepaliveTimer);
    keepaliveTimer = setTimeout(() => {
      console.warn('[SSE:Leaderboard] Heartbeat timed out (>25s). Reconnecting...');
      reconnect();
    }, 25_000);
  };

  const init = () => {
    if (isIntentionallyClosed) return;

    if (retryTimeout) {
      clearTimeout(retryTimeout);
      retryTimeout = null;
    }
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    let url = `${API_ORIGIN}/api/sse/leaderboard`;
    if (lastEventId) {
      url += `?lastEventId=${encodeURIComponent(lastEventId)}`;
    }
    eventSource = new EventSource(url);

    const markConnectionHealthy = () => {
      retryAttempts = 0;
      resetKeepaliveWatchdog();
    };

    eventSource.onopen = () => {
      handlers.onConnectionChange?.(true);
      resetKeepaliveWatchdog();
    };

    eventSource.onerror = (err) => {
      console.warn('[SSE:Leaderboard] Connection error:', err);
      handlers.onConnectionChange?.(false);
      handlers.onError?.(err);
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (keepaliveTimer) {
        clearTimeout(keepaliveTimer);
        keepaliveTimer = null;
      }

      if (!isIntentionallyClosed) {
        if (retryTimeout) clearTimeout(retryTimeout);
        const delay = Math.min(BASE_RETRY_DELAY_MS * Math.pow(1.5, retryAttempts), MAX_RETRY_DELAY_MS);
        retryAttempts++;
        retryTimeout = setTimeout(() => {
          init();
        }, delay);
      }
    };

    eventSource.addEventListener('leaderboard_update', (e) => {
      if (e?.lastEventId) lastEventId = e.lastEventId;
      markConnectionHealthy();
      try {
        const data = JSON.parse(e.data);
        handlers.onLeaderboardUpdate?.(data);
      } catch (err) {
        console.error('[SSE:Leaderboard] Parse error:', err);
      }
    });

    eventSource.addEventListener('window_status', (e) => {
      if (e?.lastEventId) lastEventId = e.lastEventId;
      markConnectionHealthy();
      try {
        const data = JSON.parse(e.data);
        handlers.onWindowStatus?.(data);
      } catch (err) {
        console.error('[SSE:Leaderboard] Window status parse error:', err);
      }
    });

    eventSource.addEventListener('stream_resync', (e) => {
      if (e?.lastEventId) lastEventId = e.lastEventId;
      markConnectionHealthy();
      try {
        const data = JSON.parse(e.data);
        handlers.onStreamResync?.(data);
      } catch (err) {
        console.error('[SSE:Leaderboard] Stream resync parse error:', err);
      }
    });

    eventSource.addEventListener('flash_announcement', (e) => {
      if (e?.lastEventId) lastEventId = e.lastEventId;
      markConnectionHealthy();
      try {
        const data = JSON.parse(e.data);
        handlers.onFlashAnnouncement?.(data);
      } catch (err) {
        console.error('[SSE:Leaderboard] Flash announcement parse error:', err);
      }
    });
  };

  const reconnect = () => {
    retryAttempts = 0;
    if (retryTimeout) {
      clearTimeout(retryTimeout);
      retryTimeout = null;
    }
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    init();
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && !isIntentionallyClosed) {
      if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
        reconnect();
      }
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  init();

  return {
    disconnect: () => {
      isIntentionallyClosed = true;
      retryAttempts = 0;
      if (keepaliveTimer) clearTimeout(keepaliveTimer);
      if (retryTimeout) clearTimeout(retryTimeout);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      handlers.onConnectionChange?.(false);
    },
    reconnect,
    getLastEventId: () => lastEventId
  };
}

/**
 * Connects to the Organizer Command Center Telemetry SSE stream (/api/sse/admin).
 */
export function connectAdminStream(adminToken, handlers = {}) {
  let eventSource = null;
  let keepaliveTimer = null;
  let isIntentionallyClosed = false;
  let retryTimeout = null;
  let retryAttempts = 0;
  let connectionGen = 0;
  let lastEventId = null;
  const BASE_RETRY_DELAY_MS = 1000;
  const MAX_RETRY_DELAY_MS = 15000;

  const resetKeepaliveWatchdog = () => {
    if (keepaliveTimer) clearTimeout(keepaliveTimer);
    keepaliveTimer = setTimeout(() => {
      console.warn('[SSE:Admin] Heartbeat timed out (>25s). Reconnecting...');
      reconnect();
    }, 25_000);
  };

  const markConnectionHealthy = () => {
    retryAttempts = 0;
    resetKeepaliveWatchdog();
  };

  const scheduleRetry = () => {
    if (isIntentionallyClosed) return;
    if (retryTimeout) clearTimeout(retryTimeout);
    const delay = Math.min(BASE_RETRY_DELAY_MS * Math.pow(1.5, retryAttempts), MAX_RETRY_DELAY_MS);
    retryAttempts++;
    retryTimeout = setTimeout(() => {
      init();
    }, delay);
  };

  const init = async () => {
    if (isIntentionallyClosed) return;

    if (retryTimeout) {
      clearTimeout(retryTimeout);
      retryTimeout = null;
    }
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    const currentGen = ++connectionGen;
    let ticket = null;

    try {
      const ticketRes = await fetch('/api/admin/stream-ticket', {
        method: 'POST',
        headers: { 'x-admin-token': adminToken || '' }
      });
      if (ticketRes.status === 401 || ticketRes.status === 403) {
        handlers.onConnectionChange?.(false);
        handlers.onError?.({ status: ticketRes.status });
        return;
      }
      if (ticketRes.ok) {
        const ticketData = await ticketRes.json();
        ticket = ticketData?.ticket;
      }
    } catch (err) {
      console.warn('[SSE:Admin] Ticket retrieval error:', err);
    }

    if (isIntentionallyClosed || currentGen !== connectionGen) return;

    if (!ticket) {
      console.warn('[SSE:Admin] Failed to acquire stream ticket. Retrying with backoff...');
      scheduleRetry();
      return;
    }

    let url = `${API_ORIGIN}/api/sse/admin?ticket=${encodeURIComponent(ticket)}`;
    if (lastEventId) {
      url += `&lastEventId=${encodeURIComponent(lastEventId)}`;
    }
    eventSource = new EventSource(url);

    eventSource.onopen = () => {
      handlers.onConnectionChange?.(true);
      resetKeepaliveWatchdog();
    };

    eventSource.onerror = (err) => {
      console.warn('[SSE:Admin] Connection error:', err);
      handlers.onConnectionChange?.(false);
      handlers.onError?.(err);
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (keepaliveTimer) {
        clearTimeout(keepaliveTimer);
        keepaliveTimer = null;
      }

      scheduleRetry();
    };

    eventSource.addEventListener('admin_telemetry', (e) => {
      if (e?.lastEventId) lastEventId = e.lastEventId;
      markConnectionHealthy();
      try {
        const data = JSON.parse(e.data);
        handlers.onTelemetry?.(data);
      } catch (err) {
        console.error('[SSE:Admin] Telemetry parse error:', err);
      }
    });

    eventSource.addEventListener('leaderboard_update', (e) => {
      if (e?.lastEventId) lastEventId = e.lastEventId;
      markConnectionHealthy();
      try {
        const data = JSON.parse(e.data);
        handlers.onLeaderboardUpdate?.(data);
      } catch (err) {
        console.error('[SSE:Admin] Leaderboard parse error:', err);
      }
    });

    eventSource.addEventListener('window_status', (e) => {
      if (e?.lastEventId) lastEventId = e.lastEventId;
      markConnectionHealthy();
      try {
        const data = JSON.parse(e.data);
        handlers.onWindowStatus?.(data);
      } catch (err) {
        console.error('[SSE:Admin] Window status parse error:', err);
      }
    });

    eventSource.addEventListener('room_snapshot', (e) => {
      if (e?.lastEventId) lastEventId = e.lastEventId;
      markConnectionHealthy();
      try {
        const data = JSON.parse(e.data);
        handlers.onRoomSnapshot?.(data);
      } catch (err) {
        console.error('[SSE:Admin] Room snapshot parse error:', err);
      }
    });

    eventSource.addEventListener('anomaly_flag', (e) => {
      if (e?.lastEventId) lastEventId = e.lastEventId;
      markConnectionHealthy();
      try {
        const data = JSON.parse(e.data);
        handlers.onAnomalyFlag?.(data);
      } catch (err) {
        console.error('[SSE:Admin] Anomaly flag parse error:', err);
      }
    });

    eventSource.addEventListener('stream_resync', (e) => {
      if (e?.lastEventId) lastEventId = e.lastEventId;
      markConnectionHealthy();
      try {
        const data = JSON.parse(e.data);
        handlers.onStreamResync?.(data);
        handlers.onFullRefreshNeeded?.(data);
      } catch (err) {
        console.error('[SSE:Admin] Stream resync parse error:', err);
      }
    });

    eventSource.addEventListener('admin_action_broadcast', (e) => {
      if (e?.lastEventId) lastEventId = e.lastEventId;
      markConnectionHealthy();
      try {
        const data = JSON.parse(e.data);
        handlers.onAdminAction?.(data);
      } catch (err) {
        console.error('[SSE:Admin] Admin action broadcast parse error:', err);
      }
    });

    eventSource.addEventListener('flash_announcement', (e) => {
      if (e?.lastEventId) lastEventId = e.lastEventId;
      markConnectionHealthy();
      try {
        const data = JSON.parse(e.data);
        handlers.onFlashAnnouncement?.(data);
      } catch (err) {
        console.error('[SSE:Admin] Flash announcement parse error:', err);
      }
    });
  };

  const reconnect = () => {
    connectionGen++;
    retryAttempts = 0;
    if (retryTimeout) {
      clearTimeout(retryTimeout);
      retryTimeout = null;
    }
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    init();
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && !isIntentionallyClosed) {
      if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
        reconnect();
      }
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  init();

  return {
    disconnect: () => {
      connectionGen++;
      isIntentionallyClosed = true;
      retryAttempts = 0;
      if (keepaliveTimer) clearTimeout(keepaliveTimer);
      if (retryTimeout) clearTimeout(retryTimeout);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      handlers.onConnectionChange?.(false);
    },
    reconnect,
    getLastEventId: () => lastEventId
  };
}
