/**
 * MATIKS HACKATHON ENGINE — AUTHENTICATION MIDDLEWARE (auth.ts)
 * 
 * Verifies admin passcodes for sensitive tournament controls, contest window toggles,
 * and hardware failure recovery endpoints.
 */

import type { Request, Response, NextFunction } from 'express';
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
