/**
 * MATIKS HACKATHON ENGINE — CONTEST WINDOW MANAGER (windowManager.ts)
 * 
 * Manages the global hackathon competition window, countdown cutoffs,
 * announcement tickers, and authoritative server clock synchronization.
 */

import type { ContestWindowConfig, WindowStatusEvent } from '../types/sse.js';
import { sseHub } from './sseHub.js';
import { leaderboardManager } from './leaderboardManager.js';
import { controlStateChanged, type ControlState } from '../store/controlState.js';

export class WindowManager {
  private config: ContestWindowConfig;
  private onOpenCallbacks: Array<() => void> = [];
  private onCloseCallbacks: Array<() => void> = [];
  private emergencyWalkInEnabled: boolean = false;
  private closingTimer: NodeJS.Timeout | null = null;

  private scheduleClose(): void {
    if (this.closingTimer) clearTimeout(this.closingTimer);
    this.closingTimer = null;
    if (!this.config.isOpen) return;
    // Node timeouts are limited to a signed 32-bit delay; reschedule long windows in chunks.
    const delay = Math.max(0, this.config.closesAt - Date.now());
    this.closingTimer = setTimeout(() => {
      this.closingTimer = null;
      if (Date.now() >= this.config.closesAt) this.closeWindow();
      else this.scheduleClose();
    }, Math.min(delay, 2_147_483_647));
    this.closingTimer.unref?.();
  }

  private saveWindow(): void {
    this.config.updatedAt = Math.max(Date.now(), (this.config.updatedAt ?? 0) + 1);
    controlStateChanged();
  }

  constructor(defaultOpen = false, initialMinutes = 120) {
    const now = Date.now();
    this.config = {
      isOpen: defaultOpen,
      opensAt: defaultOpen ? now : 0,
      closesAt: defaultOpen ? now + initialMinutes * 60 * 1000 : 0,
      durationMinutes: defaultOpen ? initialMinutes : 0,
      updatedAt: now,
      announcementTicker: defaultOpen
        ? '⚡ Welcome to Matiks Hackathon Math Sprint! Assemble your teams and lock READY.'
        : '⚡ Contest window is currently closed. Awaiting organizer to open competition window.',
      emergencyWalkIn: false
    };
    this.scheduleClose();
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
    if (Date.now() >= this.config.closesAt) {
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
    this.saveWindow();
    return this.emergencyWalkInEnabled;
  }

  /**
   * Opens the competition window for a given duration in minutes.
   */
  public openWindow(durationMinutes = 120, ticker?: string): ContestWindowConfig {
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) throw new Error('Window duration must be a positive finite number.');
    const now = Date.now();
    const wasOpen = this.isOpen();
    const opening = wasOpen ? this.config.opensAt : Math.max(now, this.config.opensAt + 1);
    const defaultOpenTicker = '⚡ Welcome to Matiks Hackathon Math Sprint! Assemble your teams and lock READY.';
    const currentTicker = this.config.announcementTicker || '';
    const effectiveTicker = ticker ?? (currentTicker.includes('closed') ? defaultOpenTicker : (this.config.announcementTicker ?? defaultOpenTicker));

    this.config = {
      isOpen: true,
      opensAt: opening,
      closesAt: now + durationMinutes * 60 * 1000,
      durationMinutes,
      updatedAt: this.config.updatedAt,
      announcementTicker: effectiveTicker,
      emergencyWalkIn: this.emergencyWalkInEnabled
    };

    leaderboardManager.setPostCloseLive(false);
    this.scheduleClose();
    this.broadcastStatus();
    this.saveWindow();
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
    if (this.closingTimer) clearTimeout(this.closingTimer);
    this.closingTimer = null;
    const wasOpen = this.config.isOpen;
    this.config.isOpen = false;
    const defaultClosedTicker = '⚡ Contest window is currently closed. Awaiting organizer to open competition window.';
    const currentTicker = this.config.announcementTicker || '';
    if (!currentTicker || currentTicker.includes('Welcome') || currentTicker.includes('READY')) {
      this.config.announcementTicker = defaultClosedTicker;
    }
    // A delayed snapshot must not trigger a ceremony before the current active teams arrive.
    leaderboardManager.setPostCloseLive(true);
    this.broadcastStatus();
    this.saveWindow();
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
    this.saveWindow();
  }

  /**
   * What an organizer has set, for saving across a restart.
   */
  public exportControlState(): ControlState {
    return {
      window: { ...this.config, emergencyWalkIn: this.emergencyWalkInEnabled },
      emergencyWalkIn: this.emergencyWalkInEnabled,
      streamDelayMs: leaderboardManager.getStreamDelayMs()
    };
  }

  /**
   * Puts back what an organizer had set before a restart. A window that was open stays open until its original closing time; one whose
   * time has passed, or that was closed, stays closed.
   */
  public restoreControlState(state: ControlState): void {
    const saved = state.window;
    const stillOpen = saved.isOpen && typeof saved.closesAt === 'number' && saved.closesAt > Date.now();
    this.emergencyWalkInEnabled = Boolean(state.emergencyWalkIn);
    this.config = {
      ...this.config,
      isOpen: stillOpen,
      opensAt: saved.opensAt,
      closesAt: saved.closesAt,
      durationMinutes: saved.durationMinutes,
      updatedAt: saved.updatedAt ?? saved.opensAt,
      announcementTicker: saved.announcementTicker ?? this.config.announcementTicker,
      emergencyWalkIn: this.emergencyWalkInEnabled
    };
    // Live (no delay) only once a window that was really opened has closed, as after an organizer closes it
    leaderboardManager.setPostCloseLive(!stillOpen && saved.opensAt > 0);
    if (typeof state.streamDelayMs === 'number') {
      leaderboardManager.setStreamDelayMs(state.streamDelayMs);
    }
    this.scheduleClose();
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

