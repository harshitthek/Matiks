/**
 * MATIKS HACKATHON ENGINE — LEADERBOARD PRIORITY QUEUE (leaderboardManager.ts)
 * 
 * Manages sorted tournament standings based on Team Average Score (descending)
 * with combined completion time tie-breakers. Enforces the Zero Question Leak
 * Guarantee across all broadcasts.
 */

import type { LeaderboardEntry } from '../types/sse.js';
import { sseHub } from './sseHub.js';

export class LeaderboardManager {
  private entries = new Map<string, LeaderboardEntry>();
  private broadcastTimeout: NodeJS.Timeout | null = null;
  private pendingBroadcast = false;

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
   * Zero Question Leak Guarantee: Only macro metrics and member scores are streamed.
   */
  public broadcastLeaderboard(): void {
    if (this.broadcastTimeout) {
      clearTimeout(this.broadcastTimeout);
      this.broadcastTimeout = null;
    }
    this.pendingBroadcast = false;
    const sorted = this.getLeaderboard();
    sseHub.broadcast('leaderboard', 'leaderboard_update', sorted);
    sseHub.broadcast('admin', 'leaderboard_update', sorted);
  }

  /**
   * Clears all leaderboard entries (for test resets or tournament wipe).
   */
  public clear(): void {
    if (this.broadcastTimeout) {
      clearTimeout(this.broadcastTimeout);
      this.broadcastTimeout = null;
    }
    this.pendingBroadcast = false;
    this.entries.clear();
    this.broadcastLeaderboard();
  }
}

// Singleton Leaderboard Manager
export const leaderboardManager = new LeaderboardManager();
