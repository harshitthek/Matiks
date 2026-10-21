/**
 * MATIKS HACKATHON ENGINE — AUTHENTICATION REST CONTROLLER (authController.ts)
 * 
 * Provides REST endpoints for pluggable auth strategy:
 * - GET  /api/auth/config: Returns active auth mode ('local' | 'club_oidc') and OIDC login URL.
 * - POST /api/auth/login: Student roll-number authentication.
 * - POST /api/auth/admin-login: Admin passcode verification.
 * - GET  /api/auth/me: Active session verification and profile retrieval.
 * - POST /api/auth/oidc/exchange: OAuth2 authorization code exchange.
 * - GET  /api/auth/verify-membership/:identifier: Verified UFC club membership check.
 */

import type { Request, Response } from 'express';
import {
  getAuthProvider,
  getClubOidcProvider,
  verifyAnySession
} from '../services/auth/authProviderFactory.js';
import { roomManager } from '../services/roomManager.js';
import { windowManager } from '../services/windowManager.js';
import { isAllowedClientOrigin, getAllowedOrigins } from '../config/corsOrigins.js';
import { rosterService } from '../services/rosterService.js';
import { ephemeral, hashed } from '../store/ephemeralStore.js';




function extractBearerToken(req: Request): string | undefined {
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }
    return authHeader.trim();
  }
  return (req.headers['x-member-token'] as string) || (req.headers['x-admin-token'] as string);
}

function extractCookie(req: Request, name: string): string | null {
  const cookieHeader = req.headers['cookie'];
  if (!cookieHeader || typeof cookieHeader !== 'string') return null;
  const match = cookieHeader
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith(`${name}=`));
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice(name.length + 1));
  } catch {
    return null;
  }
}


const STATE_ORIGIN_TTL_MS = 10 * 60 * 1000;
const stateOriginName = (state: string) => `oidc:origin:${hashed(state)}`;

export async function getAuthConfigHandler(req: Request, res: Response): Promise<void> {
  const primaryProvider = getAuthProvider();
  const forceOidc =
    req.query['oidc'] === 'true' ||
    req.query['oidc'] === '1' ||
    req.query['force'] === 'true' ||
    req.query['force'] === '1';
  const urlProvider = (!primaryProvider.getAuthUrl && forceOidc)
    ? getClubOidcProvider()
    : primaryProvider;

  let authUrl: string | null = null;
  let state: string | null = null;

  const existingStateCookie = extractCookie(req, 'matiks_oidc_state');

  const queryOrigin = typeof req.query['origin'] === 'string' ? req.query['origin'].trim().replace(/\/+$/, '') : undefined;
  const headerOrigin = typeof req.headers['x-client-origin'] === 'string' ? req.headers['x-client-origin'].trim().replace(/\/+$/, '') : undefined;

  const candidateOrigin =
    (queryOrigin && isAllowedClientOrigin(queryOrigin) ? queryOrigin : undefined) ||
    (headerOrigin && isAllowedClientOrigin(headerOrigin) ? headerOrigin : undefined) ||
    (typeof req.headers.origin === 'string' && req.headers.origin.trim().replace(/\/+$/, '')) ||
    (typeof req.headers.referer === 'string' && (() => {
      try {
        return new URL(req.headers.referer).origin.replace(/\/+$/, '');
      } catch {
        return null;
      }
    })()) || undefined;

  const trustedOrigin = candidateOrigin && isAllowedClientOrigin(candidateOrigin) ? candidateOrigin : undefined;

  const shouldGenerateUrl = forceOidc || primaryProvider.providerName === 'club_oidc';
  if (shouldGenerateUrl && urlProvider.getAuthUrl) {
    authUrl = urlProvider.getAuthUrl(existingStateCookie || undefined, trustedOrigin);
    if (authUrl) {
      try {
        const parsed = new URL(authUrl);
        state = parsed.searchParams.get('state');
      } catch {
        state = null;
      }
    }
  }

  if (state && state !== existingStateCookie) {
    const isSecure = process.env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https';
    const sameSite = isSecure ? 'None' : 'Lax';
    res.setHeader(
      'Set-Cookie',
      `matiks_oidc_state=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=600${isSecure ? '; Secure; Partitioned' : ''}`
    );
  }

  const embeddedOrigin = state && urlProvider.extractOriginFromState ? urlProvider.extractOriginFromState(state) : null;
  if (state && trustedOrigin && embeddedOrigin !== trustedOrigin) {
    // Remembered in the shared short-lived store, so the callback can find it even after a restart
    await ephemeral().set(stateOriginName(state), trustedOrigin, STATE_ORIGIN_TTL_MS);
  }


  res.status(200).json({
    mode: primaryProvider.providerName === 'club_oidc' ? 'club_oidc' : 'local',
    providerName: primaryProvider.providerName,
    oidcIssuer: process.env.CLUB_OIDC_ISSUER_URL || 'https://oidc.fossclub.tech',
    authUrl,
    state,
    hasActiveRoster: rosterService.isRosterActive(),
    rosterTeamsCount: rosterService.getRoster().length,
    roundOperatorMode: roomManager.getRoundOperatorModeOverride(),
    emergencyWalkIn: windowManager.isEmergencyWalkInEnabled(),
    windowOpen: windowManager.isOpen(),
    contestWindow: windowManager.getConfig()
  });
}

export async function loginPlayerHandler(req: Request, res: Response): Promise<void> {
  try {
    const { rollNumber, name, teamCode } = req.body;

    if (!rollNumber || typeof rollNumber !== 'string' || !name || typeof name !== 'string') {
      res.status(400).json({
        error: 'INVALID_CREDENTIALS',
        message: 'rollNumber and name are required non-empty strings.'
      });
      return;
    }

    const provider = getAuthProvider();
    const result = await provider.loginPlayer({
      rollNumber,
      name,
      teamCode: typeof teamCode === 'string' ? teamCode : undefined
    });

    res.status(200).json({
      success: true,
      ...result
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Login failed';
    res.status(400).json({ error: 'LOGIN_FAILED', message });
  }
}

export async function loginAdminHandler(req: Request, res: Response): Promise<void> {
  try {
    const { passcode } = req.body;

    if (!passcode || typeof passcode !== 'string') {
      res.status(400).json({
        error: 'INVALID_CREDENTIALS',
        message: 'passcode is required.'
      });
      return;
    }

    const provider = getAuthProvider();
    const result = await provider.loginAdmin({ passcode });

    res.status(200).json({
      success: true,
      ...result
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Admin login failed';
    res.status(401).json({ error: 'ADMIN_AUTH_FAILED', message });
  }
}

export async function getMeHandler(req: Request, res: Response): Promise<void> {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Session token is required.'
      });
      return;
    }

    const user = await verifyAnySession(token);

    if (!user) {
      res.status(401).json({
        error: 'INVALID_SESSION',
        message: 'Session is invalid or has expired.'
      });
      return;
    }

    res.status(200).json({
      success: true,
      user
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Session verification failed';
    res.status(500).json({ error: 'SERVER_ERROR', message });
  }
}

export async function exchangeOidcCodeHandler(req: Request, res: Response): Promise<void> {
  try {
    const { code, state } = req.body;

    if (!code || typeof code !== 'string') {
      res.status(400).json({
        error: 'INVALID_CODE',
        message: 'Authorization code is required.'
      });
      return;
    }

    const cookieState = extractCookie(req, 'matiks_oidc_state');
    const headerState = typeof req.headers['x-client-state'] === 'string' ? req.headers['x-client-state'] : undefined;
    const clientState = [headerState, cookieState].find(
      (s) => typeof s === 'string' && s === state
    ) ?? headerState ?? cookieState;

    const primaryProvider = getAuthProvider();
    const isStateValid = typeof state === 'string' && getClubOidcProvider().isStateValid(state);
    const provider = (!primaryProvider.exchangeCode && (clientState || isStateValid))
      ? getClubOidcProvider()
      : primaryProvider;

    if (!provider.exchangeCode) {
      res.status(400).json({
        error: 'OIDC_UNSUPPORTED',
        message: 'Active auth provider does not support OIDC code exchange.'
      });
      return;
    }

    if (!provider.validateState) {
      res.status(400).json({
        error: 'OIDC_STATE_VALIDATION_UNSUPPORTED',
        message: 'Active auth provider does not support OIDC state validation.'
      });
      return;
    }

    if (!clientState) {
      res.status(400).json({
        error: 'INVALID_OIDC_STATE',
        message: 'Client session state is missing. Please initiate sign-in from your browser.'
      });
      return;
    }

    if (clientState !== state) {
      res.status(400).json({
        error: 'INVALID_OIDC_STATE',
        message: 'OIDC state parameter does not match client session state.'
      });
      return;
    }

    if (!state || typeof state !== 'string' || !(await provider.validateState(state))) {
      res.status(400).json({
        error: 'INVALID_OIDC_STATE',
        message: 'Valid OIDC state parameter is required and must not be expired.'
      });
      return;
    }

    const result = await provider.exchangeCode(code, state);

    const isSecure = process.env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https';
    const sameSite = isSecure ? 'None' : 'Lax';
    res.setHeader(
      'Set-Cookie',
      `matiks_oidc_state=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0${isSecure ? '; Secure; Partitioned' : ''}`
    );

    res.status(200).json({
      success: true,
      ...result
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Code exchange failed';
    res.status(400).json({ error: 'OIDC_EXCHANGE_FAILED', message });
  }
}

export async function verifyMembershipHandler(req: Request, res: Response): Promise<void> {
  try {
    const rawId = req.params['identifier'];
    const identifier = Array.isArray(rawId) ? rawId[0] : rawId;

    if (!identifier) {
      res.status(400).json({
        error: 'INVALID_IDENTIFIER',
        message: 'Student identifier or roll number is required.'
      });
      return;
    }

    const provider = getAuthProvider();
    const isClubMember = await provider.validateClubMembership(identifier);

    res.status(200).json({
      identifier,
      isClubMember
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Membership verification failed';
    res.status(500).json({ error: 'VERIFICATION_ERROR', message });
  }
}

function resolveClientBaseUrl(req?: Request): string {
  // 1. Validate request origin against trusted allowlist if present
  if (req?.headers.origin && typeof req.headers.origin === 'string') {
    const origin = req.headers.origin.trim().replace(/\/+$/, '');
    if (isAllowedClientOrigin(origin)) {
      return origin;
    }
  }

  // 2. Validate request referer against trusted allowlist if present
  if (req?.headers.referer && typeof req.headers.referer === 'string') {
    try {
      const parsed = new URL(req.headers.referer);
      const origin = parsed.origin.replace(/\/+$/, '');
      if (isAllowedClientOrigin(origin)) {
        return origin;
      }
    } catch {
      // Ignore malformed referer
    }
  }

  // 3. Explicit environment variable if allowed
  const explicitOrigin = process.env.CLIENT_ORIGIN?.trim();
  if (explicitOrigin && isAllowedClientOrigin(explicitOrigin)) {
    return explicitOrigin.replace(/\/+$/, '');
  }

  // 4. First allowed client origin
  const firstCorsOrigin = (process.env.CORS_ORIGINS?.trim() ? getAllowedOrigins({ forRedirect: true }) : [])
    .find(s => s.startsWith('https://') || (process.env.NODE_ENV !== 'production' && s.startsWith('http://')));
  if (firstCorsOrigin) {
    return firstCorsOrigin.replace(/\/+$/, '');
  }

  const allowed = getAllowedOrigins({ forRedirect: true });
  const secureAllowed = allowed.find(s => s.startsWith('https://') || (process.env.NODE_ENV !== 'production' && s.startsWith('http://')));
  if (secureAllowed) {
    return secureAllowed.replace(/\/+$/, '');
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('CLIENT_ORIGIN environment variable is required in production.');
  }
  return 'http://localhost:5173';
}

export async function redirectOidcCallbackHandler(req: Request, res: Response): Promise<void> {
  try {
    const rawState = req.query['state'];
    const state = typeof rawState === 'string' ? rawState.trim() : undefined;
    let boundOrigin: string | undefined;

    // 1. Recover bound origin directly from authenticated state (stateless, tamper-proof, multi-worker safe)
    if (state) {
      const primaryProvider = getAuthProvider();
      const oidcProvider = primaryProvider.providerName === 'club_oidc'
        ? primaryProvider
        : getClubOidcProvider();

      if (oidcProvider.extractOriginFromState) {
        const originFromState = oidcProvider.extractOriginFromState(state);
        if (originFromState && isAllowedClientOrigin(originFromState)) {
          boundOrigin = originFromState;
        }
      }

      // 2. Fallback if the state was generated without an embedded origin: the one remembered when it was issued (read once, then gone)
      if (!boundOrigin) {
        const remembered = await ephemeral().getdel(stateOriginName(state));
        if (remembered && isAllowedClientOrigin(remembered)) {
          boundOrigin = remembered;
        }
      }
    }

    // 3. Handle query origin parameter:
    // The state-bound origin is authoritative; query origin cannot override it.
    // If query origin contradicts the state-bound origin, reject immediately to prevent redirect diversion.
    const rawQueryOrigin = req.query['origin'];
    if (typeof rawQueryOrigin === 'string') {
      const queryOrigin = rawQueryOrigin.trim().replace(/\/+$/, '');
      if (isAllowedClientOrigin(queryOrigin)) {
        if (!boundOrigin) {
          boundOrigin = queryOrigin;
        } else if (boundOrigin !== queryOrigin) {
          res.status(400).json({
            error: 'ORIGIN_MISMATCH',
            message: 'Query origin does not match state-bound origin.'
          });
          return;
        }
      }
    }

    const clientBaseUrl = boundOrigin || resolveClientBaseUrl(req);
    const params = new URLSearchParams();
    for (const key of ['code', 'state', 'error', 'error_description']) {
      const val = req.query[key];
      if (typeof val === 'string' && val.trim()) {
        params.set(key, val.trim());
      }
    }
    const queryString = params.toString();
    res.redirect(302, queryString ? `${clientBaseUrl}/?${queryString}` : `${clientBaseUrl}/`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid client origin configuration';
    res.status(500).json({ error: 'SERVER_CONFIG_ERROR', message });
  }
}


