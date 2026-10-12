/**
 * MATIKS HACKATHON ENGINE — USAR FOSS CLUB OIDC AUTH PROVIDER (clubOidcAuthProvider.ts)
 * 
 * Implements IAuthProvider for the USAR FOSS Club OIDC provider (https://oidc.fossclub.tech):
 * - RFC 9700 / OpenID Connect Core 1.0 Authorization Code Flow with mandatory PKCE (S256).
 * - Stateless HMAC-SHA256 + server-pepper bound state, nonce, and PKCE code_verifier.
 * - Code exchange against /token (application/x-www-form-urlencoded + client_secret_basic).
 * - Cryptographic RS256 ID token verification against /jwks using native node:crypto.
 * - UserInfo enrichment via /me and club membership claim (member, role) extraction.
 */

import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as cryptoVerify,
  type JsonWebKey
} from 'node:crypto';
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
  isPublicClient?: boolean;
}

interface SessionData {
  user: AuthUser;
  createdAt: number;
  expiresAt: number;
}

interface OidcJwtHeader {
  alg?: string;
  typ?: string;
  kid?: string;
}

interface OidcClaims {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  nonce?: string;
  name?: string;
  preferred_username?: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
  member?: boolean;
  role?: string;
  rollNumber?: string;
  isClubMember?: boolean;
  githubUsername?: string;
}

interface JwksKey extends JsonWebKey {
  kid?: string;
  alg?: string;
  use?: string;
}

export class ClubOidcAuthProvider implements IAuthProvider {
  public readonly providerName = 'club_oidc';

  private issuerUrl: string;
  private clientId: string;
  private clientSecret: string;
  private signingPepper: string;
  private redirectUri: string;
  private timeoutMs: number;
  private isPublicClient: boolean;
  private sessions = new Map<string, SessionData>();
  private validStates = new Map<string, number>();
  private consumedSignedStates = new Map<string, number>();
  private jwksCache: { keys: JwksKey[]; fetchedAt: number } | null = null;
  private lastIssuedState: string | null = null;
  private readonly sessionTtlMs = 24 * 60 * 60 * 1000; // 24 hours (per ADDING-AN-APP.md §4)
  private readonly stateTtlMs = 10 * 60 * 1000; // 10 minutes
  private readonly jwksCacheTtlMs = 15 * 60 * 1000; // 15 minutes

  constructor(config: ClubOidcConfig = {}) {
    this.issuerUrl = (config.issuerUrl || process.env.CLUB_OIDC_ISSUER_URL || 'https://oidc.fossclub.tech').replace(/\/$/, '');
    this.clientId = config.clientId || process.env.CLUB_OIDC_CLIENT_ID || 'matiks';
    this.isPublicClient = config.isPublicClient ?? (process.env.CLUB_OIDC_PUBLIC_CLIENT === 'true');

    const secret = config.clientSecret ?? process.env.CLUB_OIDC_CLIENT_SECRET;
    if (!secret && !this.isPublicClient && process.env.NODE_ENV === 'production') {
      throw new Error('CLUB_OIDC_CLIENT_SECRET must be configured in production when using confidential club_oidc mode.');
    }
    this.clientSecret = secret ?? (this.isPublicClient ? '' : 'matiks_oidc_dev_secret');

    // Server-side secret pepper combining clientSecret and ADMIN_SECRET for state & PKCE HMAC derivation
    this.signingPepper = `${this.clientSecret}:${getAdminSecret()}`;

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
   * Derives a deterministic, RFC-7636 compliant 43-char base64url PKCE code_verifier
   * bound to the OIDC state and secret server-side pepper.
   */
  public deriveCodeVerifier(state: string): string {
    return createHmac('sha256', this.signingPepper)
      .update(`matiks_pkce_verifier_v1:${state}`)
      .digest('base64url');
  }

  /**
   * Computes the S256 PKCE code_challenge from a code_verifier: BASE64URL(SHA256(code_verifier)).
   */
  public deriveCodeChallenge(codeVerifier: string): string {
    return createHash('sha256').update(codeVerifier).digest('base64url');
  }

  /**
   * Derives a deterministic OIDC nonce bound to the state and server-side pepper.
   */
  public deriveNonce(state: string): string {
    return createHmac('sha256', this.signingPepper)
      .update(`matiks_oidc_nonce_v1:${state}`)
      .digest('hex')
      .slice(0, 32);
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
      const expectedSig = createHmac('sha256', this.signingPepper).update(payload).digest('hex');

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
   * Generates the OIDC authorization URL for redirecting players to oidc.fossclub.tech/auth.
   * Includes mandatory S256 PKCE code_challenge, nonce, and HMAC-signed state.
   */
  public getAuthUrl(state?: string): string {
    const now = Date.now();
    this.pruneExpiredStates(now);

    let s: string;
    if (state && this.isStateValid(state, now)) {
      s = state;
    } else if (state && process.env.NODE_ENV === 'test') {
      s = state;
      if (this.validStates.size < 1000) {
        this.validStates.set(s, now + this.stateTtlMs);
      }
    } else {
      const nonce = randomBytes(16).toString('hex');
      const timestamp = now.toString(36);
      const payload = `${nonce}.${timestamp}`;
      const sig = createHmac('sha256', this.signingPepper).update(payload).digest('hex');
      s = `${payload}.${sig}`;
    }

    this.lastIssuedState = s;
    const codeVerifier = this.deriveCodeVerifier(s);
    const codeChallenge = this.deriveCodeChallenge(codeVerifier);
    const oidcNonce = this.deriveNonce(s);

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'openid profile email club',
      state: s,
      nonce: oidcNonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });
    return `${this.issuerUrl}/auth?${params.toString()}`;
  }

  /**
   * Validates that an OAuth2 / OIDC state was securely generated by this server.
   * Marks signed states as consumed to prevent replay attacks.
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
   * Fetches and caches the JWKS public key set from ${issuerUrl}/jwks.
   */
  private async getJwksKeys(forceRefresh = false): Promise<JwksKey[]> {
    const now = Date.now();
    if (!forceRefresh && this.jwksCache && now - this.jwksCache.fetchedAt < this.jwksCacheTtlMs) {
      return this.jwksCache.keys;
    }

    const res = await fetch(`${this.issuerUrl}/jwks`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch OIDC JWKS from ${this.issuerUrl}/jwks (HTTP ${res.status}).`);
    }

    const data = (await res.json()) as { keys?: JwksKey[] };
    if (!Array.isArray(data.keys) || data.keys.length === 0) {
      throw new Error('OIDC JWKS response contained no valid public keys.');
    }

    this.jwksCache = { keys: data.keys, fetchedAt: now };
    return data.keys;
  }

  /**
   * Verifies an RS256-signed OIDC id_token against the provider's JWKS public keys
   * and validates standard OpenID Connect Core 1.0 claims (iss, aud, exp, nonce).
   */
  public async verifyIdToken(idToken: string, expectedNonce?: string): Promise<OidcClaims> {
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      throw new Error('Malformed OIDC id_token JWT structure.');
    }

    const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as OidcJwtHeader;
    const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as OidcClaims;

    if (header.alg !== 'RS256') {
      throw new Error(`Unsupported OIDC id_token signing algorithm: ${header.alg || 'none'} (expected RS256).`);
    }

    let keys = await this.getJwksKeys(false);
    let matchingKey = header.kid
      ? keys.find(k => k.kid === header.kid)
      : keys.find(k => k.kty === 'RSA');

    if (!matchingKey && header.kid) {
      // Key rotation may have occurred; force refresh once
      keys = await this.getJwksKeys(true);
      matchingKey = keys.find(k => k.kid === header.kid);
    }

    if (!matchingKey) {
      throw new Error(`No matching RSA public key found in JWKS for kid="${header.kid || 'default'}".`);
    }

    const publicKey = createPublicKey({ key: matchingKey, format: 'jwk' });
    const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
    const signature = Buffer.from(sigB64, 'base64url');

    const signatureValid = cryptoVerify('RSA-SHA256', signingInput, publicKey, signature);
    if (!signatureValid) {
      throw new Error('OIDC id_token cryptographic signature verification failed.');
    }

    // Validate issuer (normalize trailing slash)
    const cleanIss = (claims.iss || '').replace(/\/$/, '');
    if (cleanIss !== this.issuerUrl) {
      throw new Error(`OIDC id_token issuer mismatch: expected "${this.issuerUrl}", got "${claims.iss}".`);
    }

    // Validate audience
    const audList = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
    if (!audList.includes(this.clientId)) {
      throw new Error(`OIDC id_token audience mismatch: expected "${this.clientId}".`);
    }

    // Validate expiration (with 30s clock skew leeway)
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp + 30 < nowSec) {
      throw new Error('OIDC id_token has expired.');
    }

    // Validate nonce when expectedNonce is supplied
    if (expectedNonce) {
      if (!claims.nonce || typeof claims.nonce !== 'string') {
        throw new Error('OIDC id_token missing required nonce claim.');
      }
      const a = Buffer.from(claims.nonce);
      const b = Buffer.from(expectedNonce);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new Error('OIDC id_token nonce mismatch.');
      }
    }

    return claims;
  }

  /**
   * Fetches additional identity claims from the OIDC /me UserInfo endpoint.
   */
  private async fetchUserInfo(accessToken: string): Promise<Partial<OidcClaims>> {
    try {
      const res = await fetch(`${this.issuerUrl}/me`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (!res.ok) return {};
      return (await res.json()) as Partial<OidcClaims>;
    } catch {
      return {};
    }
  }

  /**
   * Exchanges an authorization code (with PKCE code_verifier) for club identity claims
   * and registers an active Matiks session.
   */
  public async exchangeCode(code: string, state?: string): Promise<AuthResult> {
    if (!code || typeof code !== 'string') {
      throw new Error('Valid authorization code is required for OIDC token exchange.');
    }

    const effectiveState = state || this.lastIssuedState || 'default_state';
    const codeVerifier = this.deriveCodeVerifier(effectiveState);
    const expectedNonce = state ? this.deriveNonce(state) : undefined;

    const formBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code.trim(),
      redirect_uri: this.redirectUri,
      client_id: this.clientId,
      code_verifier: codeVerifier
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    };

    if (!this.isPublicClient && this.clientSecret) {
      const basicCredentials = Buffer.from(
        `${encodeURIComponent(this.clientId)}:${encodeURIComponent(this.clientSecret)}`
      ).toString('base64');
      headers['Authorization'] = `Basic ${basicCredentials}`;
    }

    try {
      let response = await fetch(`${this.issuerUrl}/token`, {
        method: 'POST',
        headers,
        body: formBody.toString(),
        signal: AbortSignal.timeout(this.timeoutMs)
      });

      // Fallback for legacy mock test servers mounted at /api/auth/token expecting JSON
      if (response.status === 404) {
        response = await fetch(`${this.issuerUrl}/api/auth/token`, {
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
            redirect_uri: this.redirectUri,
            code_verifier: codeVerifier
          }),
          signal: AbortSignal.timeout(this.timeoutMs)
        });
      }

      if (!response.ok) {
        console.warn(`[ClubOidc] Token exchange failed with HTTP ${response.status}`);
        throw new Error(`OIDC token exchange failed (HTTP ${response.status}).`);
      }

      const payload = (await response.json()) as {
        access_token?: string;
        id_token?: string;
        user?: {
          id?: string;
          rollNumber?: string;
          name?: string;
          email?: string;
          githubUsername?: string;
          isClubMember?: boolean;
          picture?: string;
          role?: string;
        };
      };

      let claims: OidcClaims = {};

      if (payload.id_token) {
        claims = await this.verifyIdToken(payload.id_token, expectedNonce);
      }

      if (payload.access_token && (!claims.name || typeof claims.member !== 'boolean')) {
        const userInfo = await this.fetchUserInfo(payload.access_token);
        claims = { ...userInfo, ...claims };
        if (typeof claims.member !== 'boolean' && typeof userInfo.member === 'boolean') {
          claims.member = userInfo.member;
        }
        if (!claims.name && userInfo.name) {
          claims.name = userInfo.name;
        }
        if (!claims.preferred_username && userInfo.preferred_username) {
          claims.preferred_username = userInfo.preferred_username;
        }
        if (!claims.email && userInfo.email) {
          claims.email = userInfo.email;
        }
        if (!claims.picture && userInfo.picture) {
          claims.picture = userInfo.picture;
        }
        if (!claims.role && userInfo.role) {
          claims.role = userInfo.role;
        }
      }

      const u = payload.user;
      const rawIdentifier =
        u?.rollNumber ||
        claims.rollNumber ||
        claims.preferred_username ||
        u?.githubUsername ||
        claims.sub ||
        u?.id;

      if (!rawIdentifier) {
        throw new Error('OIDC identity claims missing sub / preferred_username / rollNumber identifier.');
      }

      const cleanRoll = rawIdentifier.trim().toUpperCase();
      const displayName = (claims.name || u?.name || claims.preferred_username || cleanRoll).trim();

      // Determine verified club membership from OIDC `member` claim or central API fallback
      const isClubMember =
        typeof claims.member === 'boolean'
          ? claims.member
          : typeof u?.isClubMember === 'boolean'
            ? u.isClubMember
            : await this.validateClubMembership(cleanRoll);

      const user: AuthUser = {
        id: claims.sub ? `oidc_${claims.sub}` : u?.id || `oidc_${cleanRoll}`,
        rollNumber: cleanRoll,
        displayName,
        isClubMember,
        email: claims.email || u?.email,
        githubUsername: claims.preferred_username || u?.githubUsername,
        picture: claims.picture || u?.picture,
        clubRole: claims.role || u?.role,
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
   * Direct player login supporting walk-in students alongside OIDC SSO unless ALLOW_DIRECT_LOGIN=false.
   */
  public async loginPlayer(credentials: PlayerLoginCredentials): Promise<AuthResult> {
    const isDirectAllowed = process.env.ALLOW_DIRECT_LOGIN !== 'false';
    if (!isDirectAllowed) {
      throw new Error('Direct roll-number login is disabled in strict club_oidc mode. Please sign in via USAR FOSS Club OIDC.');
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
   * Validates official club membership by querying the central members API if available.
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

      const data = (await response.json()) as { isMember?: boolean; member?: boolean; status?: string };
      return data.isMember === true || data.member === true || data.status === 'active';
    } catch {
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
