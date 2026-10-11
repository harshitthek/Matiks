/**
 * MATIKS HACKATHON ENGINE — USAR FOSS CLUB OIDC AUTH PROVIDER (clubOidcAuthProvider.ts)
 * 
 * Implements IAuthProvider for central club website integration (fossclub.tech):
 * - OAuth2 / OIDC Authorization Code Flow.
 * - Code exchange against /api/auth/token endpoint.
 * - Central club membership verification via /api/dashboard/members or /api/members/:id.
 * - Robust error handling with timeout and network resiliency.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  IAuthProvider,
  AuthUser,
  PlayerLoginCredentials,
  AdminLoginCredentials,
  AuthResult
} from '../../types/auth.js';
import { getAdminSecret } from '../../config/env.js';

export interface ClubOidcConfig {
  issuerUrl?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  timeoutMs?: number;
}

interface SessionData {
  user: AuthUser;
  createdAt: number;
  expiresAt: number;
}

export class ClubOidcAuthProvider implements IAuthProvider {
  public readonly providerName = 'club_oidc';

  private issuerUrl: string;
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private timeoutMs: number;
  private sessions = new Map<string, SessionData>();
  private validStates = new Map<string, number>();
  private consumedSignedStates = new Map<string, number>();
  private readonly sessionTtlMs = 24 * 60 * 60 * 1000; // 24 hours
  private readonly stateTtlMs = 10 * 60 * 1000; // 10 minutes

  constructor(config: ClubOidcConfig = {}) {
    this.issuerUrl = (config.issuerUrl || process.env.CLUB_OIDC_ISSUER_URL || 'https://www.fossclub.tech').replace(/\/$/, '');
    this.clientId = config.clientId || process.env.CLUB_OIDC_CLIENT_ID || 'matiks_hackathon';

    const secret = config.clientSecret || process.env.CLUB_OIDC_CLIENT_SECRET;
    if (!secret && process.env.NODE_ENV === 'production') {
      throw new Error('CLUB_OIDC_CLIENT_SECRET must be configured in production when using club_oidc mode.');
    }
    this.clientSecret = secret || 'matiks_oidc_dev_secret';

    this.redirectUri = config.redirectUri || process.env.CLUB_OIDC_REDIRECT_URI || 'http://localhost:5173/auth/callback';
    this.timeoutMs = config.timeoutMs || 5000;
  }

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

  private pruneExpiredStates(now: number): void {
    for (const [key, exp] of this.validStates.entries()) {
      if (now > exp) {
        this.validStates.delete(key);
      }
    }
    for (const [key, exp] of this.consumedSignedStates.entries()) {
      if (now > exp) {
        this.consumedSignedStates.delete(key);
      }
    }
  }

  /**
   * Checks whether an OIDC state is syntactically valid, untampered, unexpired, and unconsumed.
   */
  public isStateValid(state: string, now: number = Date.now()): boolean {
    if (!state || typeof state !== 'string') return false;
    const parts = state.split('.');
    if (parts.length === 3) {
      const [nonce, timestampStr, sig] = parts;
      if (!nonce || !timestampStr || !sig) return false;
      if (!/^[0-9a-f]{64}$/i.test(sig)) return false;

      const payload = `${nonce}.${timestampStr}`;
      const expectedSig = createHmac('sha256', this.clientSecret).update(payload).digest('hex');

      const sigBuf = Buffer.from(sig, 'hex');
      const expectedBuf = Buffer.from(expectedSig, 'hex');
      if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
        return false;
      }

      const timestamp = parseInt(timestampStr, 36);
      if (Number.isNaN(timestamp)) return false;
      if (now < timestamp || now - timestamp > this.stateTtlMs) {
        return false;
      }

      if (this.consumedSignedStates.has(state)) {
        return false;
      }
      return true;
    }

    const expiresAt = this.validStates.get(state);
    if (!expiresAt) return false;
    return now <= expiresAt;
  }

  /**
   * Generates the OAuth2 / OIDC authorization URL for redirecting players to fossclub.tech.
   * Emits cryptographically HMAC-signed states to prevent in-flight state eviction DoS.
   * Reuses an existing valid state if provided, avoiding unnecessary state churning.
   */
  public getAuthUrl(state?: string): string {
    const now = Date.now();
    this.pruneExpiredStates(now);

    let s: string;
    if (state && this.isStateValid(state, now)) {
      s = state;
    } else if (state && process.env.NODE_ENV === 'test') {
      s = state;
      // Cap custom test state map at 1,000 without evicting active in-flight states
      if (this.validStates.size < 1000) {
        this.validStates.set(s, now + this.stateTtlMs);
      }
    } else {
      const nonce = randomBytes(16).toString('hex');
      const timestamp = now.toString(36);
      const payload = `${nonce}.${timestamp}`;
      const sig = createHmac('sha256', this.clientSecret).update(payload).digest('hex');
      s = `${payload}.${sig}`;
    }

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'openid profile email members',
      state: s
    });
    return `${this.issuerUrl}/oauth/authorize?${params.toString()}`;
  }

  /**
   * Validates that an OAuth2 / OIDC state was securely generated by this server.
   * Verifies cryptographic HMAC signatures and expiration without relying on evictable shared state.
   */
  public validateState(state: string): boolean {
    if (!state || typeof state !== 'string') return false;
    const now = Date.now();
    this.pruneExpiredStates(now);

    if (!this.isStateValid(state, now)) {
      return false;
    }

    const parts = state.split('.');
    if (parts.length === 3) {
      const timestampStr = parts[1];
      const timestamp = parseInt(timestampStr!, 36);
      this.consumedSignedStates.set(state, timestamp + this.stateTtlMs);
      return true;
    }

    this.validStates.delete(state);
    return true;
  }

  /**
   * Exchanges an authorization code for club identity claims and registers an active session.
   */
  public async exchangeCode(code: string): Promise<AuthResult> {
    if (!code || typeof code !== 'string') {
      throw new Error('Valid authorization code is required for OIDC token exchange.');
    }

    const tokenEndpoint = `${this.issuerUrl}/api/auth/token`;

    try {
      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code: code.trim(),
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: this.redirectUri
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });

      if (!response.ok) {
        console.warn(`[ClubOidc] Token exchange failed with HTTP ${response.status}`);
        throw new Error(`OIDC token exchange failed (HTTP ${response.status}).`);
      }

      const payload = (await response.json()) as {
        access_token?: string;
        user?: {
          id?: string;
          rollNumber?: string;
          name?: string;
          email?: string;
          githubUsername?: string;
          isClubMember?: boolean;
        };
      };

      const u = payload.user;
      if (!u || !u.rollNumber) {
        throw new Error('OIDC identity claims missing rollNumber identifier.');
      }

      const cleanRoll = u.rollNumber.trim().toUpperCase();
      const displayName = u.name?.trim() || cleanRoll;

      // Verify club membership against central member API
      const isClubMember = typeof u.isClubMember === 'boolean'
        ? u.isClubMember
        : await this.validateClubMembership(cleanRoll);

      const user: AuthUser = {
        id: u.id || `oidc_${cleanRoll}`,
        rollNumber: cleanRoll,
        displayName,
        isClubMember,
        email: u.email,
        githubUsername: u.githubUsername,
        role: 'participant'
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown OIDC exchange error';
      throw new Error(`Club OIDC authentication failed: ${msg}`);
    }
  }

  /**
   * Standalone fallback / direct player login supporting local credentials under OIDC mode.
   */
  public async loginPlayer(credentials: PlayerLoginCredentials): Promise<AuthResult> {
    const isDirectAllowed = process.env.ALLOW_DIRECT_LOGIN === 'true' || process.env.NODE_ENV === 'test';
    if (!isDirectAllowed) {
      throw new Error('Direct roll-number login is disabled in club_oidc mode. Please authenticate via USAR FOSS Club OIDC SSO.');
    }

    const { rollNumber, name, teamCode } = credentials;
    const cleanRoll = rollNumber.trim().toUpperCase();
    const cleanName = name.trim();

    if (!cleanRoll || !cleanName) {
      throw new Error('Roll number and name are required for player login.');
    }

    // Direct roll-number logins cannot be treated as verified club members without central OIDC authentication
    const user: AuthUser = {
      id: `oidc_${cleanRoll}`,
      rollNumber: cleanRoll,
      displayName: cleanName,
      isClubMember: false,
      teamCode: teamCode ? teamCode.trim().toUpperCase() : undefined,
      role: 'participant'
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
      id: 'oidc_admin',
      rollNumber: 'ADMIN',
      displayName: 'Hackathon Organizer (OIDC Mode)',
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
   * Validates official club membership by querying the USAR FOSS Club central members API.
   */
  public async validateClubMembership(identifier: string): Promise<boolean> {
    const clean = identifier.trim().toUpperCase();
    const endpoint = `${this.issuerUrl}/api/members/${encodeURIComponent(clean)}`;

    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'x-client-id': this.clientId
        },
        signal: AbortSignal.timeout(this.timeoutMs)
      });

      if (!response.ok) {
        return false;
      }

      const data = (await response.json()) as { isMember?: boolean; status?: string };
      return data.isMember === true || data.status === 'active';
    } catch {
      // Network unreachable or timeout -> fall back to safe false without crashing
      return false;
    }
  }

  /**
   * Clears active sessions (useful for test resets).
   */
  public clear(): void {
    this.sessions.clear();
  }
}
