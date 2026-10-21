/**
 * MATIKS HACKATHON ENGINE — CRASH-SAFE DISK SNAPSHOT PERSISTENCE (statePersistence.ts)
 *
 * Atomically persists and restores tournament rooms, sprint sessions, leaderboard
 * standings, and immutable audit logs across server restarts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { roomManager, type PersistedTournamentState } from './roomManager.js';
import { onControlStateChanged } from '../store/controlState.js';

export class StatePersistenceService {
  private filePath: string;
  private saveTimer: NodeJS.Timeout | null = null;
  private enabled = false;
  private unsubscribeControl?: () => void;

  constructor(customFilePath?: string) {
    this.filePath =
      customFilePath ||
      process.env.STATE_SNAPSHOT_PATH ||
      path.join(process.cwd(), '.data', 'tournament-snapshot.json');
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public setFilePath(newPath: string): void {
    this.filePath = newPath;
  }

  /**
   * Enables automatic debounced disk snapshots whenever RoomManager state mutates.
   */
  public enableAutoSave(debounceMs = 250): void {
    this.enabled = true;
    this.unsubscribeControl?.();
    this.unsubscribeControl = onControlStateChanged(() => {
      if (this.enabled) this.scheduleSave(debounceMs);
    });
    roomManager.setPersistenceHook(() => {
      if (this.enabled) {
        this.scheduleSave(debounceMs);
      }
    });
  }

  /**
   * Disables automatic disk snapshots and clears any pending timer.
   */
  public disableAutoSave(): void {
    this.enabled = false;
    this.unsubscribeControl?.();
    this.unsubscribeControl = undefined;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    roomManager.setPersistenceHook(undefined);
  }

  /**
   * Schedules a coalesced disk write to avoid blocking the event loop during high-concurrency sprints.
   */
  public scheduleSave(delayMs = 250): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, delayMs);
    this.saveTimer.unref?.();
  }

  /**
   * Synchronously writes the current tournament snapshot to disk using an atomic temp-file rename.
   */
  public saveNow(): boolean {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }

      const snapshot = roomManager.exportStateSnapshot();
      const payload = JSON.stringify(snapshot, null, 2);
      const tempPath = `${this.filePath}.${process.pid}.tmp`;

      fs.writeFileSync(tempPath, payload, { encoding: 'utf-8', mode: 0o600 });
      try {
        fs.renameSync(tempPath, this.filePath);
      } catch {
        // Fallback on Windows if target is momentarily locked by antivirus/indexer
        fs.writeFileSync(this.filePath, payload, { encoding: 'utf-8', mode: 0o600 });
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // Ignore temp cleanup failure
        }
      }
      return true;
    } catch (err: unknown) {
      console.error('[StatePersistence] Failed to write tournament snapshot:', err);
      return false;
    }
  }

  /**
   * Validates structural integrity of a persisted tournament snapshot.
   */
  private isValidSnapshot(obj: unknown): obj is PersistedTournamentState {
    return (
      obj !== null &&
      typeof obj === 'object' &&
      (obj as PersistedTournamentState).version === 1 &&
      typeof (obj as PersistedTournamentState).savedAt === 'number' &&
      Array.isArray((obj as PersistedTournamentState).rooms) &&
      Array.isArray((obj as PersistedTournamentState).sessions) &&
      Array.isArray((obj as PersistedTournamentState).rollToTeamMap) &&
      Array.isArray((obj as PersistedTournamentState).auditLogs)
    );
  }

  /**
   * Reads and parses the tournament snapshot from disk without immediately applying it.
   */
  public readDiskSnapshot(): PersistedTournamentState | null {
    try {
      if (!fs.existsSync(this.filePath)) {
        return null;
      }
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!this.isValidSnapshot(parsed)) {
        console.warn('[StatePersistence] Disk snapshot failed structural validation, ignoring.');
        return null;
      }
      return parsed;
    } catch (err: unknown) {
      console.warn('[StatePersistence] Failed to read disk snapshot:', err);
      return null;
    }
  }

  /**
   * Loads the persisted tournament snapshot from disk if available and restores RoomManager state.
   */
  public loadFromDisk(): boolean {
    try {
      if (!fs.existsSync(this.filePath)) {
        return false;
      }

      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!this.isValidSnapshot(parsed)) {
        console.warn('[StatePersistence] Disk snapshot failed structural validation, ignoring.');
        return false;
      }

      roomManager.restoreStateSnapshot(parsed);
      return true;
    } catch (err: unknown) {
      console.error('[StatePersistence] Failed to load tournament snapshot from disk:', err);
      return false;
    }
  }

  /**
   * Deletes the snapshot file from disk.
   */
  public clearDiskSnapshot(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath);
      }
    } catch {
      // Ignore unlink errors
    }
  }
}

export const statePersistence = new StatePersistenceService();
