/**
 * MATIKS HACKATHON ENGINE — ADMIN AUTHENTICATION SERVICE (adminAuthService.ts)
 * 
 * Provides stateless HMAC-SHA256 signed admin session tokens, named organizer identity
 * attribution, sliding token renewal, and progressive exponential tarpit rate-limiting
 * to defend against brute-force attacks across shared campus NAT networks.
 */

import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { getAdminSecret, isValidAdminToken } from '../config/env.js';
import { ephemeral } from '../store/ephemeralStore.js';

export interface AdminSessionPayload {
  organizerName: string;
  issuedAt: number;
  expiresAt: number;
  role: 'organizer' | 'superadmin';
  sessionId: string;
}

export interface AdminAuthResult {
  success: boolean;
  token?: string;
  payload?: AdminSessionPayload;
  error?: string;
  tarpitMs?: number;
}

const DEFAULT_SESSION_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours
const TARPIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_TARPIT_DELAY_MS = 5000; // Max 5s tarpit per attempt

class AdminAuthService {

  /**
   * Sanitizes organizer name for safe storage and logging.
   */
  public sanitizeOrganizerName(rawName?: string): string {
    if (!rawName || typeof rawName !== 'string') return 'Organizer';
    const trimmed = rawName.trim().slice(0, 32);
    const cleaned = trimmed.replace(/[^a-zA-Z0-9 _-]/g, '');
    return cleaned.length >= 2 ? cleaned : 'Organizer';
  }

  private failKey(clientIp: string): string {
    return `admin:fail:${clientIp}`;
  }

  /**
   * Calculates progressive tarpit delay for an IP based on recent failed attempts. The count lives in the shared short-lived store (Redis when
   * it is on), so restarting the server does not hand an attacker a clean slate.
   */
  public async getTarpitDelayMs(clientIp: string): Promise<number> {
    const count = Number((await ephemeral().get(this.failKey(clientIp))) ?? 0);
    if (!count || count <= 0) return 0;

    switch (count) {
      case 1:
        return 200;
      case 2:
        return 500;
      case 3:
        return 1500;
      case 4:
        return 3000;
      default:
        return MAX_TARPIT_DELAY_MS;
    }
  }

  /**
   * Records a failed authentication attempt for an IP. Failures are counted over a 15-minute window that starts with the first one.
   */
  public async recordFailure(clientIp: string): Promise<void> {
    await ephemeral().incr(this.failKey(clientIp), TARPIT_WINDOW_MS);
  }

  /**
   * Clears failure count for an IP on successful authentication.
   */
  public async recordSuccess(clientIp: string): Promise<void> {
    await ephemeral().del(this.failKey(clientIp));
  }

  /**
   * Issues a stateless signed session token for an organizer.
   */
  public issueSessionToken(
    organizerName: string,
    role: 'organizer' | 'superadmin' = 'organizer',
    durationMs: number = DEFAULT_SESSION_DURATION_MS
  ): string {
    const now = Date.now();
    const payload: AdminSessionPayload = {
      organizerName: this.sanitizeOrganizerName(organizerName),
      issuedAt: now,
      expiresAt: now + durationMs,
      role,
      sessionId: randomUUID()
    };

    const payloadJson = JSON.stringify(payload);
    const payloadBase64 = Buffer.from(payloadJson, 'utf8').toString('base64url');
    const signature = this.computeSignature(payloadBase64);

    return `adm.${payloadBase64}.${signature}`;
  }

  /**
   * Verifies and decodes a signed admin session token.
   */
  public verifySessionToken(tokenString?: string): AdminSessionPayload | null {
    if (!tokenString || typeof tokenString !== 'string') return null;
    const parts = tokenString.split('.');
    if (parts.length !== 3 || parts[0] !== 'adm') return null;

    const payloadBase64 = parts[1];
    const signatureCandidate = parts[2];

    if (!payloadBase64 || !signatureCandidate) return null;

    const expectedSignature = this.computeSignature(payloadBase64);
    const sigBuf = Buffer.from(signatureCandidate, 'base64url');
    const expBuf = Buffer.from(expectedSignature, 'base64url');

    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    try {
      const payloadJson = Buffer.from(payloadBase64, 'base64url').toString('utf8');
      const payload: AdminSessionPayload = JSON.parse(payloadJson);

      if (
        !payload ||
        typeof payload !== 'object' ||
        typeof payload.organizerName !== 'string' ||
        typeof payload.expiresAt !== 'number'
      ) {
        return null;
      }

      if (Date.now() > payload.expiresAt) {
        return null; // Expired
      }

      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Authenticates an organizer with progressive tarpit execution.
   */
  public async loginOrganizer(
    secretCandidate: string | undefined,
    organizerName: string | undefined,
    clientIp: string
  ): Promise<AdminAuthResult> {
    const tarpitMs = await this.getTarpitDelayMs(clientIp);
    if (tarpitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, tarpitMs));
    }

    if (!isValidAdminToken(secretCandidate)) {
      await this.recordFailure(clientIp);
      return {
        success: false,
        error: 'INVALID_ADMIN_CREDENTIALS',
        tarpitMs
      };
    }

    await this.recordSuccess(clientIp);
    const sanitizedName = this.sanitizeOrganizerName(organizerName);
    const token = this.issueSessionToken(sanitizedName, 'superadmin');
    const payload = this.verifySessionToken(token)!;

    return {
      success: true,
      token,
      payload,
      tarpitMs
    };
  }

  /**
   * Refreshes a valid session token if more than 15 minutes have passed since issue.
   */
  public renewSessionToken(existingToken: string): string | null {
    const payload = this.verifySessionToken(existingToken);
    if (!payload) return null;

    const now = Date.now();
    // Only renew if active and not already recently reissued
    if (now - payload.issuedAt > 15 * 60 * 1000) {
      return this.issueSessionToken(payload.organizerName, payload.role);
    }
    return existingToken;
  }

  /**
   * Computes HMAC-SHA256 signature for Base64 payload.
   */
  private computeSignature(payloadBase64: string): string {
    const secret = getAdminSecret();
    return createHmac('sha256', secret)
      .update(payloadBase64)
      .digest('base64url');
  }

  /**
   * Diagnostic helper for testing.
   */
  public resetTarpitForTesting(): void {
    ephemeral().clearLocal('admin:fail:');
  }
}

export const adminAuthService = new AdminAuthService();
