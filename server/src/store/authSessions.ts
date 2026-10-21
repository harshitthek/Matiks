/**
 * MATIKS HACKATHON ENGINE — SIGN-IN SESSIONS (authSessions.ts)
 *
 * A signed-in player's or organizer's session, found by its token. The token is the secret, so it is never used as a Redis key: the key is
 * a hash of it. With Redis on, sessions survive a server restart (a redeploy mid-event no longer signs everyone out); with it off, they live in
 * memory as they always did.
 */

import type { AuthUser } from '../types/auth.js';
import { ephemeral, hashed } from './ephemeralStore.js';

export interface StoredSession {
  user: AuthUser;
  createdAt: number;
  expiresAt: number;
}

export class AuthSessionStore {
  constructor(private readonly namespace: string) {}

  private name(token: string): string {
    return `${this.namespace}:${hashed(token)}`;
  }

  async save(token: string, session: StoredSession): Promise<void> {
    const ttlMs = Math.max(1, session.expiresAt - Date.now());
    await ephemeral().set(this.name(token), JSON.stringify(session), ttlMs);
  }

  async load(token: string): Promise<StoredSession | null> {
    const raw = await ephemeral().get(this.name(token));
    if (!raw) return null;
    try {
      const session = JSON.parse(raw) as StoredSession;
      if (!session?.user || typeof session.expiresAt !== 'number') return null;
      if (Date.now() > session.expiresAt) {
        await ephemeral().del(this.name(token));
        return null;
      }
      return session;
    } catch {
      return null;
    }
  }

  async remove(token: string): Promise<void> {
    await ephemeral().del(this.name(token));
  }

  /** Forgets this process's copies (tests, and resetting a provider). */
  clearLocal(): void {
    ephemeral().clearLocal(`${this.namespace}:`);
  }
}
