/**
 * MATIKS HACKATHON ENGINE — REDIS-BACKED SHORT-LIVED STATE TESTS (redisAuthState.test.ts)
 *
 * With STATE_BACKEND=upstash, sign-in sessions, single-use tickets, the OIDC replay guard, admin attempt counters and rate-limit counts live in
 * Redis. Checked against a fake Redis:
 * 1. They survive a restart (a new process, with an empty local copy, still sees them) and are used up exactly once.
 * 2. When Redis fails, everything carries on from this process's own memory, and the circuit stays open so the game never waits on a dead Redis.
 * 3. Secrets (session tokens, OIDC states) never appear in a Redis key.
 * 4. Rate limit counts are shared between two "servers".
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { FakeRedis } from './helpers/fakeRedis.js';
import { installRedisForTests, redisGuard } from '../src/store/redis.js';
import { MemoryEphemeralStore, RedisEphemeralStore, useEphemeralStoreForTests } from '../src/store/ephemeralStore.js';
import { AuthSessionStore } from '../src/store/authSessions.js';
import { AdaptiveRateLimitStore } from '../src/store/rateLimitStore.js';
import { MemoryRateLimitStore } from '../src/middleware/rateLimit.js';
import { adminAuthService } from '../src/services/adminAuthService.js';
import { ClubOidcAuthProvider } from '../src/services/auth/clubOidcAuthProvider.js';
import { LocalHackathonAuthProvider } from '../src/services/auth/localAuthProvider.js';
import { issueAdminStreamTicketHandler, isValidAdminStreamTicket } from '../src/controllers/adminController.js';
import { metrics } from '../src/services/metrics.js';
import type { Request, Response } from 'express';

let redis: FakeRedis;

/** A new server process: empty local memory, the same Redis. */
const restart = () => useEphemeralStoreForTests(new RedisEphemeralStore(new MemoryEphemeralStore()));

describe('Matiks Hackathon — Redis-backed short-lived state', () => {
  beforeEach(() => {
    process.env.STATE_BACKEND = 'upstash';
    redis = new FakeRedis();
    installRedisForTests(redis);
    restart();
    metrics.redisErrorsTotal.reset();
  });

  afterEach(() => {
    delete process.env.STATE_BACKEND;
    installRedisForTests(null);
    useEphemeralStoreForTests(null);
    redisGuard.reset();
  });

  test('1. A sign-in session survives a restart, and the token itself is never a Redis key', async () => {
    const provider = new LocalHackathonAuthProvider();
    const { token, user } = await provider.loginPlayer({ rollNumber: 'cs21045', name: 'Rohan' });
    assert.equal((await provider.verifySession(token))?.rollNumber, 'CS21045');

    restart();
    const afterRestart = await new LocalHackathonAuthProvider().verifySession(token);
    assert.equal(afterRestart?.id, user.id);
    assert.equal((await new LocalHackathonAuthProvider().verifySession('not-a-real-token'))?.id, undefined);

    for (const k of redis.keysWithPrefix('')) {
      assert.equal(k.includes(token), false, 'a session token must never be part of a Redis key');
    }
  });

  test('2. A session expires with its time to live', async () => {
    let now = 5_000_000;
    redis.now = () => now;
    const store = new AuthSessionStore('sess:test');
    const realNow = Date.now;
    Date.now = () => now;
    try {
      await store.save('tok-1', { user: { id: 'u', rollNumber: 'R', displayName: 'N', isClubMember: false, role: 'participant' }, createdAt: now, expiresAt: now + 1000 });
      assert.ok(await store.load('tok-1'));
      now += 1500;
      restart();
      assert.equal(await store.load('tok-1'), null);
    } finally {
      Date.now = realNow;
    }
  });

  test('3. An admin stream ticket works once, even across a restart, and is not a Redis key itself', async () => {
    let issued = '';
    const res = {
      status() {
        return this;
      },
      json(body: { ticket: string }) {
        issued = body.ticket;
      }
    };
    await issueAdminStreamTicketHandler({} as Request, res as unknown as Response);
    assert.ok(issued);
    for (const k of redis.keysWithPrefix('')) assert.equal(k.includes(issued), false);

    restart();
    assert.equal(await isValidAdminStreamTicket(issued), true, 'valid after a restart');
    assert.equal(await isValidAdminStreamTicket(issued), false, 'and only once');
    assert.equal(await isValidAdminStreamTicket('made-up'), false);
  });

  test('4. A spent OIDC state cannot be replayed through another server or after a restart', async () => {
    const config = { issuerUrl: 'https://oidc.fossclub.tech', clientSecret: 'super_secret_key_123' };
    const serverA = new ClubOidcAuthProvider(config);
    const state = new URL(serverA.getAuthUrl()).searchParams.get('state')!;

    assert.equal(await serverA.validateState(state), true);
    assert.equal(await serverA.validateState(state), false, 'replay against the same server');

    restart();
    const serverB = new ClubOidcAuthProvider(config); // a fresh process: nothing remembered locally
    assert.equal(await serverB.validateState(state), false, 'replay against a restarted or second server');

    for (const k of redis.keysWithPrefix('')) assert.equal(k.includes(state), false, 'the state must not be a Redis key');
  });

  test('5. Admin login attempt counts survive a restart and a success clears them', async () => {
    const ip = '203.0.113.9';
    await adminAuthService.recordFailure(ip);
    await adminAuthService.recordFailure(ip);
    restart();
    assert.equal(await adminAuthService.getTarpitDelayMs(ip), 500);
    await adminAuthService.recordSuccess(ip);
    assert.equal(await adminAuthService.getTarpitDelayMs(ip), 0);
  });

  test('6. Rate limit counts are shared between two servers, and a window ends on its own', async () => {
    let now = 1_000_000;
    redis.now = () => now;
    const realNow = Date.now;
    Date.now = () => now;
    try {
      const a = new AdaptiveRateLimitStore();
      const b = new AdaptiveRateLimitStore();
      for (let i = 0; i < 3; i++) await a.hit('login:x', 60_000);
      for (let i = 0; i < 2; i++) await b.hit('login:x', 60_000);
      const sixth = await a.hit('login:x', 60_000);
      assert.equal(sixth.count, 6, 'hits from both servers add up');
      assert.ok(sixth.resetAt > now && sixth.resetAt <= now + 60_000);

      now += 60_001;
      assert.equal((await b.hit('login:x', 60_000)).count, 1, 'the window must reset');
    } finally {
      Date.now = realNow;
    }
  });

  test('7. When Redis fails, everything carries on in memory and the circuit stops asking', async () => {
    const provider = new LocalHackathonAuthProvider();
    const { token } = await provider.loginPlayer({ rollNumber: 'CS21045', name: 'Rohan' });

    redis.failWith = new Error('connection refused');

    // Reads and writes still work, from this process's own copy
    assert.equal((await provider.verifySession(token))?.rollNumber, 'CS21045');
    const second = await provider.loginPlayer({ rollNumber: 'EC21088', name: 'Priya' });
    assert.equal((await provider.verifySession(second.token))?.rollNumber, 'EC21088');

    // A single-use ticket is still single use (within this process)
    let ticket = '';
    await issueAdminStreamTicketHandler({} as Request, { status() { return this; }, json(b: { ticket: string }) { ticket = b.ticket; } } as unknown as Response);
    assert.equal(await isValidAdminStreamTicket(ticket), true);
    assert.equal(await isValidAdminStreamTicket(ticket), false);

    // The limiter falls back to counting here
    const limiter = new AdaptiveRateLimitStore(new MemoryRateLimitStore());
    assert.equal((await limiter.hit('k', 1000)).count, 1);
    assert.equal((await limiter.hit('k', 1000)).count, 2);

    // The circuit opened after the first failure, so later calls do not touch Redis at all
    const callsWhileOpen = redis.count();
    for (let i = 0; i < 10; i++) await provider.verifySession(token);
    assert.equal(redis.count(), callsWhileOpen, 'an open circuit must not send more commands');
    assert.ok(metrics.redisErrorsTotal.get({ op: 'eph.set' }) >= 1);

    // And once Redis is back and the circuit has been given a chance, it is used again
    redis.failWith = null;
    redisGuard.reset();
    const before = redis.count();
    await provider.loginPlayer({ rollNumber: 'IT21019', name: 'Aarav' });
    assert.ok(redis.count() > before);
  });

  test('8. With STATE_BACKEND unset, Redis is never touched', async () => {
    delete process.env.STATE_BACKEND;
    useEphemeralStoreForTests(null);
    const provider = new LocalHackathonAuthProvider();
    const { token } = await provider.loginPlayer({ rollNumber: 'CS21045', name: 'Rohan' });
    assert.ok(await provider.verifySession(token));
    await adminAuthService.recordFailure('198.51.100.4');
    assert.equal(redis.count(), 0);
  });
});
