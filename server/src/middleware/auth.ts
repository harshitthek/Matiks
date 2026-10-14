/**
 * MATIKS HACKATHON ENGINE — AUTHENTICATION MIDDLEWARE (auth.ts)
 * 
 * Verifies admin passcodes for sensitive tournament controls, contest window toggles,
 * and hardware failure recovery endpoints.
 */

import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { isValidAdminToken } from '../config/env.js';
import { adminAuthService } from '../services/adminAuthService.js';
import { verifyAnySession } from '../services/auth/authProviderFactory.js';

declare global {
  namespace Express {
    interface Request {
      adminUser?: {
        organizerName: string;
        role: 'organizer' | 'superadmin';
      };
    }
  }
}

export async function requireAdminAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'];
  const adminHeader = req.headers['x-admin-token'] as string | undefined;

  let providedToken: string | undefined = adminHeader;

  if (!providedToken && authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      providedToken = authHeader.slice(7).trim();
    } else {
      providedToken = authHeader.trim();
    }
  }

  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

  // 1. Check if token is a valid signed session token
  const sessionPayload = adminAuthService.verifySessionToken(providedToken);
  if (sessionPayload) {
    req.adminUser = {
      organizerName: sessionPayload.organizerName,
      role: sessionPayload.role
    };
    next();
    return;
  }

  // 2. Check if token is an authenticated user session with admin privileges (Club OIDC SSO / Admin)
  if (providedToken) {
    const authUser = await verifyAnySession(providedToken);
    if (authUser) {
      if (authUser.role === 'admin' || authUser.is_admin || authUser.isAdmin) {
        req.adminUser = {
          organizerName: authUser.displayName || authUser.rollNumber || 'Organizer',
          role: 'organizer'
        };
        next();
        return;
      }
      res.status(403).json({
        error: 'FORBIDDEN_ADMIN_ACCESS',
        message: 'Administrator privileges (is_admin) required to perform this action.'
      });
      return;
    }
  }

  // 3. Check if token is the master ADMIN_SECRET (emergency bypass)
  if (isValidAdminToken(providedToken)) {
    adminAuthService.recordSuccess(clientIp);
    const rawOrganizer = req.headers['x-admin-id'] as string | undefined;
    req.adminUser = {
      organizerName: adminAuthService.sanitizeOrganizerName(rawOrganizer),
      role: 'superadmin'
    };
    next();
    return;
  }

  // Record failure and apply progressive tarpit delay on invalid master-secret candidates
  if (providedToken && !providedToken.startsWith('adm.')) {
    adminAuthService.recordFailure(clientIp);
    const delayMs = adminAuthService.getTarpitDelayMs(clientIp);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  res.status(401).json({
    error: 'UNAUTHORIZED_ADMIN_ACCESS',
    message: 'Valid admin session token or master secret is required to perform this action.'
  });
}

/**
 * Restricts access to the /metrics Prometheus exposition endpoint.
 * Accepts a configured METRICS_TOKEN, the master ADMIN_SECRET, or allows access
 * in test/development environments unless REQUIRE_METRICS_AUTH is explicitly set.
 */
export function requireMetricsAuth(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV === 'test' && !process.env.REQUIRE_METRICS_AUTH) {
    return next();
  }

  const authHeader = req.headers['authorization'];
  const metricsHeader = req.headers['x-metrics-token'] as string | undefined;
  const adminHeader = req.headers['x-admin-token'] as string | undefined;

  let candidate: string | undefined = metricsHeader || adminHeader;
  if (!candidate && authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      candidate = authHeader.slice(7).trim();
    } else {
      candidate = authHeader.trim();
    }
  }

  const configuredToken = process.env.METRICS_TOKEN?.trim();
  if (configuredToken && candidate) {
    const candBuf = Buffer.from(candidate);
    const tokenBuf = Buffer.from(configuredToken);
    if (candBuf.length === tokenBuf.length && timingSafeEqual(candBuf, tokenBuf)) {
      return next();
    }
  }

  if (isValidAdminToken(candidate)) {
    return next();
  }

  if (process.env.NODE_ENV === 'development' && !configuredToken && !process.env.REQUIRE_METRICS_AUTH) {
    return next();
  }

  res.status(401).setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8').send('# UNAUTHORIZED: Valid Bearer token or X-Metrics-Token required\n');
}

