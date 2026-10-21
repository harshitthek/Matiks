/**
 * MATIKS HACKATHON ENGINE — RATE LIMITING (rateLimit.ts)
 *
 * A small, store-backed fixed-window limiter. Each limiter counts hits under a key that the caller chooses, so a route can be limited by
 * address, by the identity in the request (a roll number, an email), or both.
 *
 * Two properties matter for a hackathon:
 *  - an address is not a person: a campus Wi-Fi puts hundreds of students behind one NAT address, so limiting by address alone locks out the
 *    room. Address limits here are generous floods guards, and the limit that stops guessing is the per-identity one;
 *  - a limiter that cannot reach its store lets the request through (and says so), because the game must not stop because a counter did.
 *
 * The counting lives behind `RateLimitStore`, so a shared store (Redis) can replace the in-memory one without touching the routes.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { metrics } from '../services/metrics.js';
import { AdaptiveRateLimitStore, MemoryRateLimitStore, type RateLimitHit, type RateLimitStore } from '../store/rateLimitStore.js';

export { MemoryRateLimitStore };
export type { RateLimitHit, RateLimitStore };

export interface LimiterOptions {
  /** Short, fixed name. It is a metric label, so it must never come from user input. */
  name: string;
  windowMs: number;
  /** The most hits allowed per key in a window. A function is read on every request, so it can follow the environment. */
  max: number | (() => number);
  /** The key to count under, or null to leave this request unlimited by this limiter (for example, no identity in the body). */
  key: (req: Request) => string | null;
  store?: RateLimitStore;
}

export function createRateLimiter(options: LimiterOptions): RequestHandler {
  // Unless a store is given, count in Redis when it is on and healthy, and in this process's memory otherwise
  const store = options.store ?? new AdaptiveRateLimitStore();

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = options.key(req);
    if (key === null) return next();

    const max = typeof options.max === 'function' ? options.max() : options.max;
    let hit: RateLimitHit;
    try {
      hit = await store.hit(`${options.name}:${key}`, options.windowMs);
    } catch (err) {
      console.warn(`[RateLimit] ${options.name}: store unavailable, letting the request through:`, err);
      return next();
    }

    const resetSeconds = Math.max(0, Math.ceil((hit.resetAt - Date.now()) / 1000));
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - hit.count)));
    res.setHeader('RateLimit-Reset', String(resetSeconds));

    if (hit.count > max) {
      metrics.rateLimitedTotal.inc({ limiter: options.name });
      res.setHeader('Retry-After', String(Math.max(1, resetSeconds)));
      res.status(429).json({
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.'
      });
      return;
    }
    next();
  };
}

/** Runs the limiters in order. The request goes on only if every one of them lets it through. */
export function allOf(...limiters: RequestHandler[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    let index = 0;
    const step = (err?: unknown): void => {
      if (err) return next(err);
      if (res.headersSent) return;
      const limiter = limiters[index++];
      if (!limiter) return next();
      void Promise.resolve(limiter(req, res, step)).catch(next);
    };
    step();
  };
}

/* ------------------------------------------------------------------------------------------------ keys */

const MAX_KEY_LENGTH = 128;
const clean = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().toLowerCase().slice(0, MAX_KEY_LENGTH) : null;

/** The address the proxy saw. Behind a campus NAT many people share one, so use it for flood guards, not for stopping guessing. */
export const byIp = (req: Request): string => req.ip || req.socket.remoteAddress || 'unknown';

/** The first of these body fields that holds a string, normalised, or null when none does. */
export const byBodyField =
  (...fields: string[]) =>
  (req: Request): string | null => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    for (const field of fields) {
      const value = clean(body[field]);
      if (value) return value;
    }
    return null;
  };

/** A URL parameter, normalised, or null when it is absent. */
export const byParam =
  (name: string) =>
  (req: Request): string | null => {
    const raw = req.params[name];
    return clean(Array.isArray(raw) ? raw[0] : raw);
  };
