/**
 * MATIKS HACKATHON ENGINE — RATE LIMITING TESTS (rateLimit.test.ts)
 *
 * The limits that matter at a hackathon, checked with their real numbers:
 * 1. A whole auditorium behind one campus Wi-Fi address can sign in without being locked out.
 * 2. Guessing one roll number or email is stopped, however many tries and wherever they come from.
 * 3. A flood from one address is still stopped, and windows reset.
 * 4. The limiter answers with standard headers, counts what it refuses, and fails open when its store is down.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Request, RequestHandler, Response } from 'express';

import { LIMITS } from '../src/config/rateLimits.js';
import { allOf, byBodyField, byIp, byParam, createRateLimiter, MemoryRateLimitStore, type RateLimitStore } from '../src/middleware/rateLimit.js';
import { metrics } from '../src/services/metrics.js';
import { createApp } from '../src/app.js';

/** The login limiters, built with the real numbers (not the scaled-up ones the rest of the suite runs under). */
function loginChain(store?: { ip: RateLimitStore; identity: RateLimitStore }): RequestHandler {
  return allOf(
    createRateLimiter({ name: 'login_ip', windowMs: LIMITS.login.ip.windowMs, max: LIMITS.login.ip.max, key: byIp, store: store?.ip }),
    createRateLimiter({
      name: 'login_roll',
      windowMs: LIMITS.login.identity.windowMs,
      max: LIMITS.login.identity.max,
      key: byBodyField('rollNumber'),
      store: store?.identity
    })
  );
}

interface Outcome {
  /** The status the limiter answered with, or null if it let the request through. */
  status: number | null;
  headers: Record<string, string>;
  body?: unknown;
}

async function send(handler: RequestHandler, req: { ip?: string; body?: unknown; params?: Record<string, string> }): Promise<Outcome> {
  const headers: Record<string, string> = {};
  const outcome: Outcome = { status: null, headers };
  let done: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => (done = resolve));

  const res = {
    headersSent: false,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return this;
    },
    status(code: number) {
      outcome.status = code;
      return this;
    },
    json(body: unknown) {
      outcome.body = body;
      res.headersSent = true;
      done();
      return this;
    }
  };
  const fakeReq = { ip: req.ip ?? '10.0.0.1', socket: { remoteAddress: req.ip ?? '10.0.0.1' }, body: req.body ?? {}, params: req.params ?? {} };

  await new Promise<void>((resolve) => {
    handler(fakeReq as unknown as Request, res as unknown as Response, () => {
      done();
      resolve();
    });
    void finished.then(resolve);
  });
  return outcome;
}

describe('Matiks Hackathon — Rate Limiting', () => {
  beforeEach(() => {
    metrics.rateLimitedTotal.reset();
  });

  test('1. An auditorium behind one campus Wi-Fi address signs in without being locked out', async () => {
    const chain = loginChain();
    let refused = 0;
    for (let i = 0; i < 150; i++) {
      const r = await send(chain, { ip: '203.0.113.7', body: { rollNumber: `EC21${String(i).padStart(3, '0')}` } });
      if (r.status === 429) refused++;
    }
    assert.equal(refused, 0, '150 different students from one address must all get through in the same minute');
  });

  test('2. Guessing one roll number is stopped, from one address or from many, and does not affect anyone else', async () => {
    const chain = loginChain();
    const roll = { rollNumber: 'CS21045' };

    for (let i = 0; i < LIMITS.login.identity.max; i++) {
      assert.equal((await send(chain, { ip: '198.51.100.1', body: roll })).status, null, `attempt ${i + 1} must be allowed`);
    }
    const blocked = await send(chain, { ip: '198.51.100.1', body: roll });
    assert.equal(blocked.status, 429);
    assert.deepEqual(blocked.body, { error: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Please try again later.' });

    // The same roll number from a different address is still the same target
    assert.equal((await send(chain, { ip: '198.51.100.99', body: roll })).status, 429);
    // The roll number is matched without regard to case or surrounding spaces
    assert.equal((await send(chain, { ip: '198.51.100.2', body: { rollNumber: '  cs21045 ' } })).status, 429);
    // Someone else on the same address is untouched
    assert.equal((await send(chain, { ip: '198.51.100.1', body: { rollNumber: 'IT21019' } })).status, null);
  });

  test('3. A flood from one address is stopped, and the window resets', async () => {
    let now = 1_000_000;
    const stores = { ip: new MemoryRateLimitStore(() => now), identity: new MemoryRateLimitStore(() => now) };
    const chain = loginChain(stores);

    for (let i = 0; i < LIMITS.login.ip.max; i++) {
      assert.equal((await send(chain, { ip: '192.0.2.50', body: { rollNumber: `R${i}` } })).status, null);
    }
    assert.equal((await send(chain, { ip: '192.0.2.50', body: { rollNumber: 'R-next' } })).status, 429);
    // Another address is unaffected
    assert.equal((await send(chain, { ip: '192.0.2.51', body: { rollNumber: 'R-other' } })).status, null);

    now += LIMITS.login.ip.windowMs + 1;
    assert.equal((await send(chain, { ip: '192.0.2.50', body: { rollNumber: 'R-after' } })).status, null, 'the window must reset');
  });

  test('4. Answers with standard headers, counts what it refuses, and tells the client when to come back', async () => {
    const limiter = createRateLimiter({ name: 'unit', windowMs: 30_000, max: 2, key: byIp });
    const first = await send(limiter, { ip: '10.1.1.1' });
    assert.equal(first.status, null);
    assert.equal(first.headers['ratelimit-limit'], '2');
    assert.equal(first.headers['ratelimit-remaining'], '1');

    await send(limiter, { ip: '10.1.1.1' });
    const refused = await send(limiter, { ip: '10.1.1.1' });
    assert.equal(refused.status, 429);
    assert.equal(refused.headers['ratelimit-remaining'], '0');
    assert.ok(Number(refused.headers['retry-after']) >= 1 && Number(refused.headers['retry-after']) <= 30);
    assert.equal(metrics.rateLimitedTotal.get({ limiter: 'unit' }), 1);
  });

  test('5. Fails open when its store is unavailable, so a broken counter never stops the game', async () => {
    const brokenStore: RateLimitStore = {
      hit() {
        throw new Error('store down');
      }
    };
    const limiter = createRateLimiter({ name: 'unit_broken', windowMs: 1000, max: 1, key: byIp, store: brokenStore });
    const warn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => void warnings.push(args);
    try {
      for (let i = 0; i < 5; i++) {
        assert.equal((await send(limiter, { ip: '10.2.2.2' })).status, null);
      }
    } finally {
      console.warn = warn;
    }
    assert.equal(warnings.length, 5, 'each skipped check must be reported, not hidden');
  });

  test('6. A request with no identity is left to the other limiters, and allOf stops at the first refusal', async () => {
    const calls: string[] = [];
    const counting = (name: string, verdict: 'pass' | 'refuse'): RequestHandler => (_req, res, next) => {
      calls.push(name);
      if (verdict === 'refuse') {
        res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED' });
        return;
      }
      next();
    };
    const chain = allOf(counting('a', 'pass'), counting('b', 'refuse'), counting('c', 'pass'));
    const r = await send(chain, {});
    assert.equal(r.status, 429);
    assert.deepEqual(calls, ['a', 'b'], 'limiters after the one that refused must not run');

    const identityOnly = createRateLimiter({ name: 'unit_identity', windowMs: 1000, max: 1, key: byBodyField('rollNumber') });
    for (let i = 0; i < 3; i++) {
      assert.equal((await send(identityOnly, { body: {} })).status, null, 'no rollNumber in the body means this limiter does not apply');
    }
    assert.equal(byParam('identifier')({ params: { identifier: ' UFC2026 ' } } as unknown as Request), 'ufc2026');
    assert.equal(byParam('identifier')({ params: {} } as unknown as Request), null);
  });

  test('7. The in-memory store forgets expired windows and never grows without bound', () => {
    let now = 0;
    const store = new MemoryRateLimitStore(() => now, 5);
    for (let i = 0; i < 20; i++) store.hit(`k${i}`, 60_000);
    assert.ok(store.size() <= 5, 'a flood of distinct keys must not grow the table past its cap');

    now = 10 * 60_000;
    for (let i = 0; i < 1100; i++) store.hit(`z${i}`, 1_000); // trips the periodic prune
    assert.ok(store.size() <= 5);
    assert.equal(store.hit('fresh', 1000).count, 1);
    assert.equal(store.hit('fresh', 1000).count, 2);
  });

  test('8. Through the real app in production mode: a roll number is limited, other students and other addresses are not', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const app = createApp();
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const login = (rollNumber: string) =>
        fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rollNumber, name: 'Tester' })
        });

      const statuses: number[] = [];
      for (let i = 0; i < LIMITS.login.identity.max + 1; i++) statuses.push((await login('GUESSME1')).status);
      assert.ok(statuses.slice(0, LIMITS.login.identity.max).every((s) => s !== 429));
      assert.equal(statuses[LIMITS.login.identity.max], 429);

      // 60 other students from the same (loopback) address are not affected
      for (let i = 0; i < 60; i++) {
        assert.notEqual((await login(`OTHER${i}`)).status, 429);
      }
    } finally {
      await new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
      if (prevEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevEnv;
    }
  });
});
