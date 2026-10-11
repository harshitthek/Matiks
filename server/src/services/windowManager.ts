/**
 * MATIKS HACKATHON ENGINE — CONTEST WINDOW MANAGER (windowManager.ts)
 * 
 * Manages the global hackathon competition window, countdown cutoffs,
 * announcement tickers, and authoritative server clock synchronization.
 */

import type { ContestWindowConfig, WindowStatusEvent } from '../types/sse.js';
import { sseHub } from './sseHub.js';

export class WindowManager {
  private config: ContestWindowConfig;
  private onOpenCallbacks: Array<() => void> = [];

  constructor(initialMinutes = 120) {
    const now = Date.now();
    this.config = {
      isOpen: true, // Default open for hackathon operation
      opensAt: now,
      closesAt: now + initialMinutes * 60 * 1000,
      durationMinutes: initialMinutes,
      announcementTicker: '⚡ Welcome to Matiks Hackathon Math Sprint! Assemble your teams and lock READY.'
    };
  }

  /**
   * Registers a callback triggered whenever the contest window is opened.
   */
  public onOpen(cb: () => void): void {
    this.onOpenCallbacks.push(cb);
  }

  /**
   * Returns whether the contest window is currently open and within time boundaries.
   */
  public isOpen(): boolean {
    if (!this.config.isOpen) return false;
    if (Date.now() > this.config.closesAt) {
      this.config.isOpen = false;
      return false;
    }
    return true;
  }

  /**
   * Returns current window configuration.
   */
  public getConfig(): ContestWindowConfig {
    return { ...this.config };
  }

  /**
   * Opens the competition window for a given duration in minutes.
   */
  public openWindow(durationMinutes = 120, ticker?: string): ContestWindowConfig {
    const now = Date.now();
    this.config = {
      isOpen: true,
      opensAt: now,
      closesAt: now + durationMinutes * 60 * 1000,
      durationMinutes,
      announcementTicker: ticker ?? this.config.announcementTicker
    };

    this.broadcastStatus();
    for (const cb of this.onOpenCallbacks) {
      try {
        cb();
      } catch {
        // Ignore listener error
      }
    }
    return this.getConfig();
  }

  /**
   * Closes the competition window immediately.
   */
  public closeWindow(): ContestWindowConfig {
    this.config.isOpen = false;
    this.broadcastStatus();
    return this.getConfig();
  }

  /**
   * Updates the live marquee announcement ticker.
   */
  public setTicker(ticker: string): void {
    this.config.announcementTicker = ticker;
    this.broadcastStatus();
  }

  /**
   * Broadcasts the authoritative window status to the leaderboard and admin channels.
   */
  public broadcastStatus(): void {
    const eventPayload: WindowStatusEvent = {
      isOpen: this.isOpen(),
      opensAt: this.config.opensAt,
      closesAt: this.config.closesAt,
      serverTime: Date.now(),
      announcementTicker: this.config.announcementTicker
    };
    sseHub.broadcast('leaderboard', 'window_status', eventPayload);
    sseHub.broadcast('admin', 'window_status', eventPayload);
  }
}

// Singleton Window Manager
export const windowManager = new WindowManager();
