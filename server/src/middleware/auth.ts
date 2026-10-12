/**
 * MATIKS HACKATHON ENGINE — AUTHENTICATION MIDDLEWARE (auth.ts)
 * 
 * Verifies admin passcodes for sensitive tournament controls, contest window toggles,
 * and hardware failure recovery endpoints.
 */

import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { isValidAdminToken } from '../config/env.js';

export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
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

  if (!isValidAdminToken(providedToken)) {
    res.status(401).json({
      error: 'UNAUTHORIZED_ADMIN_ACCESS',
      message: 'Valid admin token or secret is required to perform this action.'
    });
    return;
  }

  next();
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

