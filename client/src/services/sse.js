/**
 * MATIKS HACKATHON ENGINE — REALTIME SSE CLIENT (sse.js)
 * 
 * Implements browser EventSource subscription with:
 * 1. Automatic reconnection and token authentication
 * 2. 20-second heartbeat timeout watchdog (ADR-05)
 * 3. document.visibilitychange background-tab resync watchdog
 */

export function connectTeamStream(teamCode, token, handlers = {}) {
  let eventSource = null;
  let keepaliveTimer = null;
  let isIntentionallyClosed = false;
  let retryTimeout = null;
  let retryAttempts = 0;
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

    const url = `/api/sse/team/${encodeURIComponent(teamCode)}?token=${encodeURIComponent(token)}`;
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
      resetKeepaliveWatchdog();
      try {
        const data = JSON.parse(e.data);
        handlers.onSprintResume?.(data);
      } catch (err) {
        console.error('[SSE] Failed to parse sprint_resume:', err);
      }
    });

    // 6. Teammate progress HUD update
    eventSource.addEventListener('teammate_progress', (e) => {
      resetKeepaliveWatchdog();
      try {
        const data = JSON.parse(e.data);
        handlers.onTeammateProgress?.(data);
      } catch (err) {
        console.error('[SSE] Failed to parse teammate_progress:', err);
      }
    });

    // 7. Room pause/resume
    eventSource.addEventListener('room_paused', () => {
      resetKeepaliveWatchdog();
      handlers.onRoomPaused?.();
    });

    eventSource.addEventListener('room_resumed', () => {
      resetKeepaliveWatchdog();
      handlers.onRoomResumed?.();
    });

    // 8. Error / launch failure
    eventSource.addEventListener('sprint_error', (e) => {
      resetKeepaliveWatchdog();
      try {
        const data = JSON.parse(e.data);
        handlers.onSprintError?.(data);
      } catch (err) {
        console.error('[SSE] Failed to parse sprint_error:', err);
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
    reconnect
  };
}
