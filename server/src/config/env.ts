/**
 * MATIKS HACKATHON ENGINE — ENVIRONMENT CONFIGURATION (env.ts)
 * 
 * Centralized, validated environment configuration variables.
 * Enforces presence of sensitive credentials in production.
 */

import { timingSafeEqual } from 'node:crypto';

export function getAdminSecret(): string {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || secret.trim().length === 0) {
    if (process.env.NODE_ENV !== 'production') {
      return 'hackathon_admin_secret';
    }
    throw new Error('FATAL: ADMIN_SECRET environment variable is required and must not be empty.');
  }
  const trimmed = secret.trim();
  if (process.env.NODE_ENV === 'production' && trimmed === 'hackathon_admin_secret') {
    throw new Error('FATAL: ADMIN_SECRET must not use the default development secret in production.');
  }
  return trimmed;
}

export const ADMIN_SECRET = getAdminSecret();

export function isValidAdminToken(candidate?: string): boolean {
  if (!candidate || typeof candidate !== 'string') return false;
  const candBuf = Buffer.from(candidate);
  const secretBuf = Buffer.from(ADMIN_SECRET);

  if (candBuf.length !== secretBuf.length) return false;
  return timingSafeEqual(candBuf, secretBuf);
}
