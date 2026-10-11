/**
 * MATIKS HACKATHON ENGINE — LOCAL STANDALONE AUTH PROVIDER (localAuthProvider.ts)
 * 
 * Implements IAuthProvider for frictionless college hackathon onboarding:
 * - Instant roll-number based player onboarding with zero external redirects.
 * - Admin authentication verified via timingSafeEqual against ADMIN_SECRET.
 * - In-memory session tracking with fast O(1) token validation.
 * - Mockable club membership verification (UFC / FOSS prefix detection and mock hooks).
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  IAuthProvider,
  AuthUser,
  PlayerLoginCredentials,
  AdminLoginCredentials,
  AuthResult
} from '../../types/auth.js';
import { getAdminSecret } from '../../config/env.js';

interface SessionData {
  user: AuthUser;
  createdAt: number;
  expiresAt: number;
}

export class LocalHackathonAuthProvider implements IAuthProvider {
  public readonly providerName = 'local_hackathon';

  private sessions = new Map<string, SessionData>();
  private verifiedMembers = new Set<string>();
  private readonly sessionTtlMs = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    // Seed sample verified club members strictly in test environment
    if (process.env.NODE_ENV === 'test') {
      this.verifiedMembers.add('CS21045');
      this.verifiedMembers.add('EC21088');
      this.verifiedMembers.add('UFC-001');
      this.verifiedMembers.add('FOSS-001');
    }
  }

  /**
   * Generates a cryptographically strong 32-byte hex token.
   */
  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  private pruneExpiredSessions(): void {
    const now = Date.now();
    for (const [tok, sess] of this.sessions.entries()) {
      if (now > sess.expiresAt) {
        this.sessions.delete(tok);
      }
    }
  }

  /**
   * Authenticates a student participant and registers an active session.
   */
  public async loginPlayer(credentials: PlayerLoginCredentials): Promise<AuthResult> {
    if (this.sessions.size > 500) {
      this.pruneExpiredSessions();
    }
    const { rollNumber, name, teamCode } = credentials;
    const cleanRoll = rollNumber.trim().toUpperCase();
    const cleanName = name.trim();

    if (!cleanRoll || !cleanName) {
      throw new Error('Roll number and name are required for player login.');
    }

    const isClubMember = await this.validateClubMembership(cleanRoll);

    const user: AuthUser = {
      id: `local_${cleanRoll}`,
      rollNumber: cleanRoll,
      displayName: cleanName,
      isClubMember,
      teamCode: teamCode ? teamCode.trim().toUpperCase() : undefined,
      role: 'participant'
    };

    const token = this.generateToken();
    const now = Date.now();
    this.sessions.set(token, {
      user,
      createdAt: now,
      expiresAt: now + this.sessionTtlMs
    });

    return { user, token };
  }

  /**
   * Authenticates a hackathon administrator against the pre-shared secret.
   */
  public async loginAdmin(credentials: AdminLoginCredentials): Promise<AuthResult> {
    const { passcode } = credentials;
    if (!passcode || typeof passcode !== 'string') {
      throw new Error('Admin passcode is required.');
    }

    const adminSecret = getAdminSecret();
    const passBuf = Buffer.from(passcode);
    const secBuf = Buffer.from(adminSecret);

    const isValid = passBuf.length === secBuf.length && timingSafeEqual(passBuf, secBuf);
    if (!isValid) {
      throw new Error('Invalid admin credentials.');
    }

    const user: AuthUser = {
      id: 'local_admin',
      rollNumber: 'ADMIN',
      displayName: 'Hackathon Organizer',
      isClubMember: true,
      role: 'admin'
    };

    if (this.sessions.size > 500) {
      this.pruneExpiredSessions();
    }

    const token = this.generateToken();
    const now = Date.now();
    this.sessions.set(token, {
      user,
      createdAt: now,
      expiresAt: now + this.sessionTtlMs
    });

    return { user, token };
  }

  /**
   * Verifies an active session token.
   */
  public async verifySession(token: string): Promise<AuthUser | null> {
    if (!token || typeof token !== 'string') return null;

    const session = this.sessions.get(token);
    if (!session) return null;

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }

    return { ...session.user };
  }

  /**
   * Checks verified UFC club membership.
   * Recognizes UFC/FOSS prefixes strictly when NODE_ENV === 'test' and explicitly registered membership rolls.
   */
  public async validateClubMembership(identifier: string): Promise<boolean> {
    const clean = identifier.trim().toUpperCase();
    if (this.verifiedMembers.has(clean)) return true;
    if (process.env.NODE_ENV === 'test' && (clean.startsWith('UFC') || clean.startsWith('FOSS'))) {
      return true;
    }
    return false;
  }

  /**
   * Programmatically registers or revokes a student's mock club membership status (for testing).
   */
  public setMockClubMember(identifier: string, isMember: boolean): void {
    const clean = identifier.trim().toUpperCase();
    if (isMember) {
      this.verifiedMembers.add(clean);
    } else {
      this.verifiedMembers.delete(clean);
    }
  }

  /**
   * Clears active sessions and resets test memberships to initial seed.
   */
  public clear(): void {
    this.sessions.clear();
    this.verifiedMembers.clear();
    if (process.env.NODE_ENV === 'test') {
      this.verifiedMembers.add('CS21045');
      this.verifiedMembers.add('EC21088');
      this.verifiedMembers.add('UFC-001');
      this.verifiedMembers.add('FOSS-001');
    }
  }
}
