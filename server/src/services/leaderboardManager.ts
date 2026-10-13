/**
 * MATIKS HACKATHON ENGINE — LEADERBOARD PRIORITY QUEUE (leaderboardManager.ts)
 * 
 * Manages sorted tournament standings based on Team Average Score (descending)
 * with combined completion time tie-breakers. Enforces the Zero Question Leak
 * Guarantee across all broadcasts.
 */

import type { LeaderboardEntry } from '../types/sse.js';
import { sseHub } from './sseHub.js';

const MAX_STREAM_DELAY_MS = 300_000; // 5 minutes maximum delay
const MAX_DELAYED_QUEUE_SIZE = 100;

function resolveInitialStreamDelayMs(): number {
  const raw = process.env.LEADERBOARD_STREAM_DELAY_MS;
  if (raw !== undefined && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.min(MAX_STREAM_DELAY_MS, Math.max(0, Math.floor(parsed)));
    }
  }
  return process.env.NODE_ENV === 'test' ? 0 : 5000;
}

export class LeaderboardManager {
  private entries = new Map<string, LeaderboardEntry>();
  private broadcastTimeout: NodeJS.Timeout | null = null;
  private delayedLeaderboardTimeout: NodeJS.Timeout | null = null;
  private delayedQueue: Array<{ enqueuedAt: number; data: LeaderboardEntry[] }> = [];
  private lastPublicSnapshot: LeaderboardEntry[] = [];
  private hasReleasedPublicSnapshot = false;
  private pendingBroadcast = false;
  private streamDelayMs = resolveInitialStreamDelayMs();
  private postCloseLive = false;

  /**
   * Controls whether public leaderboard broadcasts bypass streamDelayMs after the
   * contest window closes (preventing delayed queued snapshots from reordering the podium).
   */
  public setPostCloseLive(live: boolean): void {
    this.postCloseLive = live;
    if (live) {
      this.flush();
    }
  }

  /**
   * Sets the anti-screen-peeking delay (in milliseconds) for the public leaderboard SSE stream.
   * Admin streams always remain zero-delay (0ms).
   * Clamped to [0, 300_000] ms.
   * If switching to 0ms, immediately flushes live standings.
   * If changing between positive delays, reconciles queued snapshots and reschedules drainage.
   */
  public setStreamDelayMs(delayMs: number): void {
    if (!Number.isFinite(delayMs)) return;
    const newDelay = Math.min(MAX_STREAM_DELAY_MS, Math.max(0, Math.floor(delayMs)));
    const prevDelay = this.streamDelayMs;
    this.streamDelayMs = newDelay;

    if (newDelay === 0) {
      this.flush();
      return;
    }

    if (newDelay !== prevDelay && this.delayedQueue.length > 0) {
      if (this.delayedLeaderboardTimeout) {
        clearTimeout(this.delayedLeaderboardTimeout);
        this.delayedLeaderboardTimeout = null;
      }
      this.drainReadySnapshots();
      if (this.delayedQueue.length > 0) {
        this.scheduleQueueDrain();
      }
    }
  }

  /**
   * Deep copies leaderboard entries and nested memberBreakdown arrays to isolate queued snapshots.
   */
  private cloneSnapshot(entries: LeaderboardEntry[]): LeaderboardEntry[] {
    return entries.map((item) => ({
      ...item,
      memberBreakdown: item.memberBreakdown.map((m) => ({ ...m }))
    }));
  }

  /**
   * Returns current anti-screen-peeking delay in milliseconds.
   */
  public getStreamDelayMs(): number {
    return this.streamDelayMs;
  }

  /**
   * Returns the current public-safe leaderboard snapshot.
   * When anti-peeking delay is active, returns the last released delayed snapshot
   * to ensure reconnecting or refreshing clients do not receive un-delayed standings.
   */
  public getPublicLeaderboard(): LeaderboardEntry[] {
    if (this.streamDelayMs <= 0) {
      return this.cloneSnapshot(this.getLeaderboard());
    }
    return this.hasReleasedPublicSnapshot ? this.cloneSnapshot(this.lastPublicSnapshot) : [];
  }

  /**
   * Registers or updates a team's standing in the leaderboard.
   * If immediate is true, broadcasts synchronously; otherwise coalesces within 50ms window.
   */
  public updateTeam(entry: Omit<LeaderboardEntry, 'rank'>, immediate = false): void {
    this.entries.set(entry.teamCode, {
      ...entry,
      rank: 0 // Will be calculated dynamically
    });
    if (immediate) {
      this.broadcastLeaderboard();
    } else {
      this.scheduleBroadcast();
    }
  }

  /**
   * Removes a team from the leaderboard.
   */
  public removeTeam(teamCode: string, immediate = true): void {
    if (this.entries.delete(teamCode)) {
      if (immediate) {
        this.broadcastLeaderboard();
      } else {
        this.scheduleBroadcast();
      }
    }
  }

  /**
   * Coalesces high-frequency leaderboard updates to prevent blocking the event loop
   * with massive socket writes under 100+ concurrent clients.
   */
  private scheduleBroadcast(): void {
    if (this.pendingBroadcast) return;
    this.pendingBroadcast = true;
    this.broadcastTimeout = setTimeout(() => {
      this.pendingBroadcast = false;
      this.broadcastTimeout = null;
      this.broadcastLeaderboard();
    }, 50);
  }

  /**
   * Returns sorted leaderboard entries with assigned ranks.
   * Primary sort: teamAverageScore (descending).
   * Secondary sort: averageTimeSeconds (ascending, faster is better).
   */
  public getLeaderboard(): LeaderboardEntry[] {
    const list = Array.from(this.entries.values());

    list.sort((a, b) => {
      // Disqualified teams always rank at the absolute bottom
      const disqA = a.isDisqualified ? 1 : 0;
      const disqB = b.isDisqualified ? 1 : 0;
      if (disqA !== disqB) {
        return disqA - disqB;
      }

      // Primary: Status group priority (racing and finished teams rank above WAITING teams)
      const priorityA = a.status === 'WAITING' ? 1 : 0;
      const priorityB = b.status === 'WAITING' ? 1 : 0;
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }

      // Secondary: Score descending
      if (b.teamAverageScore !== a.teamAverageScore) {
        return b.teamAverageScore - a.teamAverageScore;
      }
      // Tertiary: Time ascending (faster completion ranks higher)
      if (a.averageTimeSeconds !== b.averageTimeSeconds) {
        return a.averageTimeSeconds - b.averageTimeSeconds;
      }
      // Quaternary: Team name alphabetical stability
      return a.teamName.localeCompare(b.teamName);
    });

    return list.map((item, index) => ({
      ...item,
      rank: index + 1
    }));
  }

  /**
   * Broadcasts the sanitized leaderboard array to the public leaderboard and admin channels.
   * Admin stream receives updates immediately (0ms).
   * Public leaderboard stream respects streamDelayMs anti-screen-peeking FIFO queue.
   * Zero Question Leak Guarantee: Only macro metrics and member scores are streamed.
   */
  public broadcastLeaderboard(): void {
    if (this.broadcastTimeout) {
      clearTimeout(this.broadcastTimeout);
      this.broadcastTimeout = null;
    }
    this.pendingBroadcast = false;
    const sorted = this.getLeaderboard();

    // Admin stream is ALWAYS authoritative and immediate (0ms delay)
    sseHub.broadcast('admin', 'leaderboard_update', sorted);

    if (this.streamDelayMs <= 0 || this.postCloseLive) {
      this.clearDelayedQueue();
      const snapshot = this.cloneSnapshot(sorted);
      this.lastPublicSnapshot = snapshot;
      this.hasReleasedPublicSnapshot = true;
      sseHub.broadcast('leaderboard', 'leaderboard_update', snapshot);
    } else {
      const snapshot = this.cloneSnapshot(sorted);
      const enqueuedAt = Date.now();
      const last = this.delayedQueue[this.delayedQueue.length - 1];

      // Coalesce high-frequency snapshots within 100ms without pushing release timestamp forward
      if (last && enqueuedAt - last.enqueuedAt < 100) {
        last.data = snapshot;
      } else {
        if (this.delayedQueue.length >= MAX_DELAYED_QUEUE_SIZE) {
          // Find adjacent pair with minimum time delta across delay window to preserve release cadence
          let minDelta = Infinity;
          let minIndex = 1;
          for (let i = 1; i < this.delayedQueue.length - 1; i++) {
            const delta = this.delayedQueue[i + 1].enqueuedAt - this.delayedQueue[i].enqueuedAt;
            if (delta < minDelta) {
              minDelta = delta;
              minIndex = i;
            }
          }
          this.delayedQueue.splice(minIndex, 1);
        }
        this.delayedQueue.push({ enqueuedAt, data: snapshot });
      }
      this.scheduleQueueDrain();
    }
  }

  /**
   * Drains and broadcasts any queued snapshots that have satisfied their delay requirement.
   */
  private drainReadySnapshots(): void {
    const now = Date.now();
    let latestReady: LeaderboardEntry[] | null = null;

    while (
      this.delayedQueue.length > 0 &&
      this.delayedQueue[0].enqueuedAt + this.streamDelayMs <= now
    ) {
      latestReady = this.delayedQueue.shift()!.data;
    }

    if (latestReady) {
      this.lastPublicSnapshot = latestReady;
      this.hasReleasedPublicSnapshot = true;
      sseHub.broadcast('leaderboard', 'leaderboard_update', latestReady);
    }
  }

  /**
   * Schedules next item release from the delayed broadcast queue.
   * Ensures ongoing delivery during rapid continuous updates without timer starvations.
   */
  private scheduleQueueDrain(): void {
    if (this.delayedLeaderboardTimeout !== null || this.delayedQueue.length === 0) {
      return;
    }

    const nextItem = this.delayedQueue[0];
    const targetEmitAt = nextItem.enqueuedAt + this.streamDelayMs;
    const delay = Math.min(
      2147483647,
      Math.max(0, targetEmitAt - Date.now())
    );

    this.delayedLeaderboardTimeout = setTimeout(() => {
      this.delayedLeaderboardTimeout = null;
      this.drainReadySnapshots();

      if (this.delayedQueue.length > 0) {
        this.scheduleQueueDrain();
      }
    }, delay);
    this.delayedLeaderboardTimeout.unref?.();
  }

  private clearDelayedQueue(): void {
    if (this.delayedLeaderboardTimeout) {
      clearTimeout(this.delayedLeaderboardTimeout);
      this.delayedLeaderboardTimeout = null;
    }
    this.delayedQueue = [];
  }

  /**
   * Immediately flushes current leaderboard to both channels without delay.
   * Used on tournament window close or manual organizer ceremony reveal.
   */
  public flush(): void {
    if (this.broadcastTimeout) {
      clearTimeout(this.broadcastTimeout);
      this.broadcastTimeout = null;
    }
    this.clearDelayedQueue();
    this.pendingBroadcast = false;
    const sorted = this.getLeaderboard();
    const snapshot = this.cloneSnapshot(sorted);
    this.lastPublicSnapshot = snapshot;
    this.hasReleasedPublicSnapshot = true;
    sseHub.broadcast('leaderboard', 'leaderboard_update', snapshot);
    sseHub.broadcast('admin', 'leaderboard_update', sorted);
  }

  /**
   * Clears all leaderboard entries (for test resets or tournament wipe).
   * Immediately clears public and admin displays without delay.
   */
  public clear(): void {
    if (this.broadcastTimeout) {
      clearTimeout(this.broadcastTimeout);
      this.broadcastTimeout = null;
    }
    this.clearDelayedQueue();
    this.pendingBroadcast = false;
    this.postCloseLive = false;
    this.entries.clear();
    this.lastPublicSnapshot = [];
    this.hasReleasedPublicSnapshot = false;
    sseHub.broadcast('leaderboard', 'leaderboard_update', []);
    sseHub.broadcast('admin', 'leaderboard_update', []);
  }
}

// Singleton Leaderboard Manager
export const leaderboardManager = new LeaderboardManager();
