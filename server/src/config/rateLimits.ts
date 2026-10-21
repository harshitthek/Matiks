/**
 * MATIKS HACKATHON ENGINE — RATE LIMIT SETTINGS (rateLimits.ts)
 *
 * Every limit in one place, with the reasoning.
 *
 * Address limits are loose on purpose. A campus Wi-Fi puts a whole auditorium behind one NAT address, so 150 students signing in at the same
 * minute all look like one client. Those limits only stop a flood.
 *
 * What stops guessing is the per-identity limit: a handful of tries per roll number or email, however many addresses they come from.
 *
 * The admin login is the exception: there are only a few organizers, and it guards the keys to the contest, so it stays strict per address.
 */

export interface Limit {
  windowMs: number;
  max: number;
}

const MINUTE = 60_000;

export const LIMITS = {
  /** Public, cheap reads: the auth config and the OIDC callback. */
  config: { ip: { windowMs: MINUTE, max: 600 } },
  /** Player sign in (by roll number) and email check-in. */
  login: {
    ip: { windowMs: MINUTE, max: 600 },
    identity: { windowMs: 5 * MINUTE, max: 12 }
  },
  oidcExchange: { ip: { windowMs: MINUTE, max: 600 } },
  /** Looking up a club membership. The per-identifier limit stops hammering one student's record. */
  membership: {
    ip: { windowMs: MINUTE, max: 600 },
    identity: { windowMs: MINUTE, max: 20 }
  },
  adminLogin: { ip: { windowMs: MINUTE, max: 15 } },
  metrics: { ip: { windowMs: MINUTE, max: 120 } }
} satisfies Record<string, Record<string, Limit>>;

/**
 * The automated tests make thousands of requests from one address, so under NODE_ENV=test every cap is multiplied. The limiters still count
 * and still answer 429; the tests that care about a limit build their own limiter with the real numbers. This is read on every request, so a test
 * that switches NODE_ENV (to exercise production behaviour) gets the real caps.
 */
export const limitScale = (): number => (process.env.NODE_ENV === 'test' ? 1000 : 1);
export const scaled = (max: number) => (): number => max * limitScale();
