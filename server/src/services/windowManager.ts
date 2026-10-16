/**
 * MATIKS HACKATHON ENGINE — CONTEST WINDOW MANAGER (windowManager.ts)
 * 
 * Manages the global hackathon competition window, countdown cutoffs,
 * announcement tickers, and authoritative server clock synchronization.
 */

import type { ContestWindowConfig, WindowStatusEvent } from '../types/sse.js';
import { sseHub } from './sseHub.js';
import { leaderboardManager } from './leaderboardManager.js';

export class WindowManager {
  private config: ContestWindowConfig;
  private onOpenCallbacks: Array<() => void> = [];
  private onCloseCallbacks: Array<() => void> = [];
  private emergencyWalkInEnabled: boolean = false;

  constructor(defaultOpen = false, initialMinutes = 120) {
    const now = Date.now();
    this.config = {
      isOpen: defaultOpen,
      opensAt: defaultOpen ? now : 0,
      closesAt: defaultOpen ? now + initialMinutes * 60 * 1000 : 0,
      durationMinutes: defaultOpen ? initialMinutes : 0,
      announcementTicker: defaultOpen
        ? '⚡ Welcome to Matiks Hackathon Math Sprint! Assemble your teams and lock READY.'
        : '⚡ Contest window is currently closed. Awaiting organizer to open competition window.',
      emergencyWalkIn: false
    };
  }

  /**
   * Registers a callback triggered whenever the contest window is opened.
   */
  public onOpen(cb: () => void): void {
    this.onOpenCallbacks.push(cb);
  }

  /**
   * Registers a callback triggered whenever the contest window is closed.
   */
  public onClose(cb: () => void): void {
    this.onCloseCallbacks.push(cb);
  }

  /**
   * Returns whether the contest window is currently open and within time boundaries.
   */
  public isOpen(): boolean {
    if (!this.config.isOpen) return false;
    if (Date.now() > this.config.closesAt) {
      this.closeWindow();
      return false;
    }
    return true;
  }

  /**
   * Returns current window configuration.
   */
  public getConfig(): ContestWindowConfig {
    return { ...this.config, emergencyWalkIn: this.emergencyWalkInEnabled };
  }

  /**
   * Returns whether emergency walk-in bypass is enabled.
   */
  public isEmergencyWalkInEnabled(): boolean {
    return this.emergencyWalkInEnabled;
  }

  /**
   * Toggles emergency walk-in bypass mode.
   */
  public setEmergencyWalkIn(enabled: boolean): boolean {
    this.emergencyWalkInEnabled = enabled;
    this.config.emergencyWalkIn = enabled;
    this.broadcastStatus();
    return this.emergencyWalkInEnabled;
  }

  /**
   * Opens the competition window for a given duration in minutes.
   */
  public openWindow(durationMinutes = 120, ticker?: string): ContestWindowConfig {
    const now = Date.now();
    const defaultOpenTicker = '⚡ Welcome to Matiks Hackathon Math Sprint! Assemble your teams and lock READY.';
    const currentTicker = this.config.announcementTicker || '';
    const effectiveTicker = ticker ?? (currentTicker.includes('closed') ? defaultOpenTicker : (this.config.announcementTicker ?? defaultOpenTicker));

    this.config = {
      isOpen: true,
      opensAt: now,
      closesAt: now + durationMinutes * 60 * 1000,
      durationMinutes,
      announcementTicker: effectiveTicker,
      emergencyWalkIn: this.emergencyWalkInEnabled
    };

    leaderboardManager.setPostCloseLive(false);
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
    const wasOpen = this.config.isOpen;
    this.config.isOpen = false;
    const defaultClosedTicker = '⚡ Contest window is currently closed. Awaiting organizer to open competition window.';
    const currentTicker = this.config.announcementTicker || '';
    if (!currentTicker || currentTicker.includes('Welcome') || currentTicker.includes('READY')) {
      this.config.announcementTicker = defaultClosedTicker;
    }
    this.broadcastStatus();
    leaderboardManager.setPostCloseLive(true);
    if (wasOpen) {
      for (const cb of this.onCloseCallbacks) {
        try {
          cb();
        } catch {
          // Ignore listener error
        }
      }
    }
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
      announcementTicker: this.config.announcementTicker,
      emergencyWalkIn: this.emergencyWalkInEnabled
    };
    sseHub.broadcast('leaderboard', 'window_status', eventPayload);
    sseHub.broadcast('admin', 'window_status', eventPayload);
  }
}

// Singleton Window Manager (defaults to closed on boot; requires organizer to open window)
export const windowManager = new WindowManager(false);

