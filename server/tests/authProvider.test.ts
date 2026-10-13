/**
 * MATIKS HACKATHON ENGINE — PLUGGABLE AUTH PROVIDER TEST SUITE (authProvider.test.ts)
 * 
 * Verifies Phase 7: Pluggable Club OIDC Adapter Strategy:
 * 1. LocalHackathonAuthProvider (instant roll-number onboarding, admin secret verification, session tracking, membership checks).
 * 2. ClubOidcAuthProvider (OIDC authorization URL, code exchange, central club member lookup, network timeout resiliency).
 * 3. AuthProviderFactory (environment mode switching, test injection, singleton lifecycle).
 * 4. Express REST API endpoints (/api/auth/config, /api/auth/login, /api/auth/admin-login, /api/auth/me, /api/auth/verify-membership).
 */

import { test, describe, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { LocalHackathonAuthProvider } from '../src/services/auth/localAuthProvider.js';
import { ClubOidcAuthProvider } from '../src/services/auth/clubOidcAuthProvider.js';
import {
  getAuthProvider,
  setAuthProvider,
  resetAuthProviderInstances
} from '../src/services/auth/authProviderFactory.js';
import { createApp } from '../src/app.js';
import { getAdminSecret } from '../src/config/env.js';

describe('Matiks Hackathon — Phase 7: Pluggable Auth & Club OIDC Adapter', () => {
  const originalAuthMode = process.env.AUTH_MODE;

  beforeEach(() => {
    resetAuthProviderInstances();
    process.env.AUTH_MODE = 'local';
  });

  afterEach(() => {
    resetAuthProviderInstances();
  });

  after(() => {
    if (originalAuthMode === undefined) {
      delete process.env.AUTH_MODE;
    } else {
      process.env.AUTH_MODE = originalAuthMode;
    }
  });

  describe('1. LocalHackathonAuthProvider Contract', () => {
    test('Participant login generates active session and roll-number identity', async () => {
      const provider = new LocalHackathonAuthProvider();
      assert.equal(provider.providerName, 'local_hackathon');

      const result = await provider.loginPlayer({
        rollNumber: 'CS22010',
        name: 'Aarav Patel',
        teamCode: 'ZG-42'
      });

      assert.ok(result.token);
      assert.equal(result.user.rollNumber, 'CS22010');
      assert.equal(result.user.displayName, 'Aarav Patel');
      assert.equal(result.user.teamCode, 'ZG-42');
      assert.equal(result.user.role, 'participant');
      assert.equal(result.user.isClubMember, false);

      // Verify active session token retrieval
      const sessionUser = await provider.verifySession(result.token);
      assert.ok(sessionUser);
      assert.equal(sessionUser?.rollNumber, 'CS22010');
      assert.equal(sessionUser?.displayName, 'Aarav Patel');

      // Invalid token returns null
      const badSession = await provider.verifySession('invalid_token_123');
      assert.equal(badSession, null);
    });

    test('Rejects invalid participant login credentials', async () => {
      const provider = new LocalHackathonAuthProvider();

      await assert.rejects(
        () => provider.loginPlayer({ rollNumber: '', name: 'Test' }),
        /Roll number and name are required/
      );

      await assert.rejects(
        () => provider.loginPlayer({ rollNumber: 'CS22010', name: '  ' }),
        /Roll number and name are required/
      );
    });

    test('Admin authentication verifies against ADMIN_SECRET', async () => {
      const provider = new LocalHackathonAuthProvider();
      const adminSecret = getAdminSecret();

      // Successful admin login
      const result = await provider.loginAdmin({ passcode: adminSecret });
      assert.ok(result.token);
      assert.equal(result.user.role, 'admin');
      assert.equal(result.user.rollNumber, 'ADMIN');

      // Admin session retrieval
      const adminUser = await provider.verifySession(result.token);
      assert.ok(adminUser);
      assert.equal(adminUser?.role, 'admin');

      // Invalid passcode rejection
      await assert.rejects(
        () => provider.loginAdmin({ passcode: 'wrong_secret' }),
        /Invalid admin credentials/
      );
    });

    test('Club membership verification recognizes seeded rolls and prefixes', async () => {
      const provider = new LocalHackathonAuthProvider();

      // Seeded rolls
      assert.equal(await provider.validateClubMembership('CS21045'), true);
      assert.equal(await provider.validateClubMembership('EC21088'), true);

      // Club prefixes
      assert.equal(await provider.validateClubMembership('UFC-042'), true);
      assert.equal(await provider.validateClubMembership('FOSS-999'), true);

      // Non-member student
      assert.equal(await provider.validateClubMembership('IT22099'), false);

      // Dynamic mock membership hook
      provider.setMockClubMember('IT22099', true);
      assert.equal(await provider.validateClubMembership('IT22099'), true);

      provider.setMockClubMember('IT22099', false);
      assert.equal(await provider.validateClubMembership('IT22099'), false);
    });
  });

  describe('2. ClubOidcAuthProvider Integration & Resiliency (oidc.fossclub.tech)', () => {
    test('Constructs compliant oidc.fossclub.tech authorization URL with S256 PKCE and club scope', () => {
      const provider = new ClubOidcAuthProvider({
        issuerUrl: 'https://oidc.fossclub.tech',
        clientId: 'matiks',
        redirectUri: 'http://localhost:5173/auth/callback'
      });

      const authUrl = provider.getAuthUrl('test_state_123');
      const parsed = new URL(authUrl);

      assert.equal(parsed.origin, 'https://oidc.fossclub.tech');
      assert.equal(parsed.pathname, '/auth');
      assert.equal(parsed.searchParams.get('client_id'), 'matiks');
      assert.equal(parsed.searchParams.get('redirect_uri'), 'http://localhost:5173/auth/callback');
      assert.equal(parsed.searchParams.get('response_type'), 'code');
      assert.equal(parsed.searchParams.get('state'), 'test_state_123');
      assert.equal(parsed.searchParams.get('scope'), 'openid profile email club');
      assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');

      const expectedVerifier = provider.deriveCodeVerifier('test_state_123');
      const expectedChallenge = provider.deriveCodeChallenge(expectedVerifier);
      assert.equal(parsed.searchParams.get('code_challenge'), expectedChallenge);
      assert.equal(parsed.searchParams.get('nonce'), provider.deriveNonce('test_state_123'));
    });

    test('Generates cryptographically signed HMAC states with replay protection and tamper resistance', () => {
      const provider = new ClubOidcAuthProvider({
        issuerUrl: 'https://oidc.fossclub.tech',
        clientSecret: 'super_secret_key_123'
      });

      // 1. Calling getAuthUrl() without explicit state generates signed state: nonce.timestamp.sig
      const authUrl = provider.getAuthUrl();
      const parsed = new URL(authUrl);
      const state = parsed.searchParams.get('state');
      assert.ok(state);
      assert.equal(state.split('.').length, 3);

      // 2. State validates successfully on first verification
      assert.equal(provider.validateState(state), true);

      // 3. Replay attack: reusing the same state immediately fails
      assert.equal(provider.validateState(state), false);

      // 4. Tamper attack: modifying payload or signature fails
      const tampered = state.slice(0, -4) + 'abcd';
      assert.equal(provider.validateState(tampered), false);

      // 5. Unrecognized or invalid format states fail
      assert.equal(provider.validateState('random_unsigned_string'), false);
    });

    test('Verifies RS256 id_token via /jwks, enforces S256 PKCE at /token, and maps /me claims', async () => {
      const { generateKeyPairSync, createSign, createHash } = await import('node:crypto');
      const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const publicJwk = publicKey.export({ format: 'jwk' });
      const kid = 'test-key-2026';

      let capturedAuthHeader = '';
      let capturedCodeVerifier = '';
      let mockIssuer = '';
      let expectedNonceForTest = '';

      function signJwt(payload: Record<string, unknown>, keyToSign = privateKey): string {
        const headerB64 = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
        const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
        const signer = createSign('RSA-SHA256');
        signer.update(`${headerB64}.${payloadB64}`);
        const sigB64 = signer.sign(keyToSign).toString('base64url');
        return `${headerB64}.${payloadB64}.${sigB64}`;
      }

      const mockOidcServer = http.createServer((req, res) => {
        if (req.method === 'GET' && req.url === '/jwks') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            keys: [{ ...publicJwk, kid, use: 'sig', alg: 'RS256' }]
          }));
        } else if (req.method === 'POST' && req.url === '/token') {
          capturedAuthHeader = req.headers['authorization'] || '';
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            const params = new URLSearchParams(body);
            const code = params.get('code');
            capturedCodeVerifier = params.get('code_verifier') || '';

            if (code === 'valid_pkce_code') {
              const nowSec = Math.floor(Date.now() / 1000);
              const idToken = signJwt({
                iss: mockIssuer,
                sub: 'usr_998877',
                aud: 'matiks',
                iat: nowSec,
                exp: nowSec + 600,
                nonce: expectedNonceForTest,
                preferred_username: 'harshitthek',
                email: 'harshit@fossclub.tech',
                member: true,
                role: 'core'
              });
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                access_token: 'access_tok_live_123',
                id_token: idToken,
                token_type: 'Bearer',
                expires_in: 600
              }));
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'invalid_grant' }));
            }
          });
        } else if (req.method === 'GET' && req.url === '/me') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            sub: 'usr_998877',
            name: 'Harshit K',
            preferred_username: 'harshitthek',
            picture: 'https://avatars.githubusercontent.com/u/1?v=4',
            member: true,
            role: 'core'
          }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise<void>((resolve) => mockOidcServer.listen(0, resolve));
      const port = (mockOidcServer.address() as AddressInfo).port;
      mockIssuer = `http://127.0.0.1:${port}`;

      try {
        const provider = new ClubOidcAuthProvider({
          issuerUrl: mockIssuer,
          clientId: 'matiks',
          clientSecret: 'secret_xyz_999',
          redirectUri: 'http://localhost:5173/auth/callback',
          timeoutMs: 2000
        });

        const authUrl = provider.getAuthUrl();
        const parsedAuth = new URL(authUrl);
        const state = parsedAuth.searchParams.get('state')!;
        const codeChallenge = parsedAuth.searchParams.get('code_challenge')!;
        expectedNonceForTest = parsedAuth.searchParams.get('nonce')!;

        const result = await provider.exchangeCode('valid_pkce_code', state);

        // Verify client_secret_basic Authorization header
        const expectedBasic = Buffer.from('matiks:secret_xyz_999').toString('base64');
        assert.equal(capturedAuthHeader, `Basic ${expectedBasic}`);

        // Verify PKCE S256: SHA256(capturedCodeVerifier) === codeChallenge
        const recomputedChallenge = createHash('sha256').update(capturedCodeVerifier).digest('base64url');
        assert.equal(recomputedChallenge, codeChallenge);

        // Verify mapped AuthUser claims from RS256 id_token + /me
        assert.equal(result.user.id, 'oidc_usr_998877');
        assert.equal(result.user.rollNumber, 'HARSHITTHEK');
        assert.equal(result.user.displayName, 'Harshit K');
        assert.equal(result.user.githubUsername, 'harshitthek');
        assert.equal(result.user.email, 'harshit@fossclub.tech');
        assert.equal(result.user.isClubMember, true);
        assert.equal(result.user.clubRole, 'core');

        // Verify missing nonce claim is rejected when expectedNonce is supplied
        const missingNonceJwt = signJwt({
          iss: mockIssuer,
          sub: 'usr_998877',
          aud: 'matiks',
          exp: Math.floor(Date.now() / 1000) + 600
        });
        await assert.rejects(
          () => provider.verifyIdToken(missingNonceJwt, expectedNonceForTest),
          /missing required nonce claim/
        );

        // Verify forged RS256 signature is rejected
        const attackerKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
        const forgedJwt = signJwt({
          iss: mockIssuer,
          sub: 'attacker',
          aud: 'matiks',
          exp: Math.floor(Date.now() / 1000) + 600
        }, attackerKey);
        await assert.rejects(
          () => provider.verifyIdToken(forgedJwt),
          /cryptographic signature verification failed/
        );
      } finally {
        await new Promise<void>((resolve) => mockOidcServer.close(() => resolve()));
      }
    });

    test('Exchanges authorization code against legacy mock central OIDC provider', async () => {
      // Create mock OIDC server
      const mockServer = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/api/auth/token') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            const parsed = JSON.parse(body);
            if (parsed.code === 'valid_mock_code') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                access_token: 'mock_access_token_xyz',
                user: {
                  id: 'ufc_user_42',
                  rollNumber: 'CS21045',
                  name: 'Rohan Sharma',
                  email: 'rohan@fossclub.tech',
                  githubUsername: 'rohansharma',
                  isClubMember: true
                }
              }));
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Code invalid or expired' }));
            }
          });
        } else if (req.method === 'GET' && req.url?.startsWith('/api/members/')) {
          const id = decodeURIComponent(req.url.replace('/api/members/', ''));
          const isMember = id === 'CS21045' || id.startsWith('UFC');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ identifier: id, isMember, status: isMember ? 'active' : 'inactive' }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise<void>((resolve) => mockServer.listen(0, resolve));
      const mockPort = (mockServer.address() as AddressInfo).port;
      const mockIssuerUrl = `http://127.0.0.1:${mockPort}`;

      try {
        const provider = new ClubOidcAuthProvider({
          issuerUrl: mockIssuerUrl,
          clientId: 'matiks_test',
          clientSecret: 'secret_test',
          redirectUri: 'http://localhost:5173/auth/callback',
          timeoutMs: 1000
        });

        // 1. Successful code exchange
        const authResult = await provider.exchangeCode('valid_mock_code');
        assert.ok(authResult.token);
        assert.equal(authResult.user.rollNumber, 'CS21045');
        assert.equal(authResult.user.displayName, 'Rohan Sharma');
        assert.equal(authResult.user.email, 'rohan@fossclub.tech');
        assert.equal(authResult.user.githubUsername, 'rohansharma');
        assert.equal(authResult.user.isClubMember, true);

        // Verify active session works
        const verifiedUser = await provider.verifySession(authResult.token);
        assert.ok(verifiedUser);
        assert.equal(verifiedUser?.rollNumber, 'CS21045');

        // 2. Invalid code exchange failure
        await assert.rejects(
          () => provider.exchangeCode('bad_code_456'),
          /Club OIDC authentication failed/
        );

        // 3. Central member query verification
        const memberValid = await provider.validateClubMembership('CS21045');
        assert.equal(memberValid, true);

        const nonMember = await provider.validateClubMembership('UNKNOWN99');
        assert.equal(nonMember, false);
      } finally {
        await new Promise<void>((resolve) => mockServer.close(() => resolve()));
      }
    });

    test('Gracefully handles network timeout without throwing unhandled exceptions', async () => {
      // Point to unrouted / non-listening port with short timeout
      const provider = new ClubOidcAuthProvider({
        issuerUrl: 'http://127.0.0.1:59999',
        timeoutMs: 150
      });

      // Member check falls back to false
      const result = await provider.validateClubMembership('TEST_ROLL');
      assert.equal(result, false);

      // Exchange code reports clear timeout failure
      await assert.rejects(
        () => provider.exchangeCode('timeout_code'),
        /Club OIDC authentication failed/
      );
    });
  });

  describe('3. AuthProviderFactory Switching & DI', () => {
    test('Default mode instantiates LocalHackathonAuthProvider', () => {
      delete process.env.AUTH_MODE;
      const provider = getAuthProvider();
      assert.equal(provider.providerName, 'local_hackathon');
    });

    test('AUTH_MODE=club_oidc instantiates ClubOidcAuthProvider', () => {
      process.env.AUTH_MODE = 'club_oidc';
      const provider = getAuthProvider();
      assert.equal(provider.providerName, 'club_oidc');
    });

    test('Allows test injection via setAuthProvider', () => {
      const mockProvider = {
        providerName: 'custom_mock',
        loginPlayer: async () => ({
          user: { id: 'm1', rollNumber: 'M001', displayName: 'Mock', isClubMember: false, role: 'participant' as const },
          token: 'mock_token'
        }),
        loginAdmin: async () => ({
          user: { id: 'm_admin', rollNumber: 'ADMIN', displayName: 'Admin', isClubMember: true, role: 'admin' as const },
          token: 'mock_admin'
        }),
        verifySession: async () => null,
        validateClubMembership: async () => true
      };

      setAuthProvider(mockProvider);
      assert.equal(getAuthProvider().providerName, 'custom_mock');

      resetAuthProviderInstances();
      assert.equal(getAuthProvider().providerName, 'local_hackathon');
    });
  });

  describe('4. REST API Authentication Endpoints', () => {
    test('GET /api/auth/config returns current auth mode and provider', async () => {
      const app = createApp();
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as AddressInfo).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        const res = await fetch(`${baseUrl}/api/auth/config`);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.mode, 'local');
        assert.equal(data.providerName, 'local_hackathon');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    test('POST /api/auth/login and GET /api/auth/me workflow', async () => {
      const app = createApp();
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as AddressInfo).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        // 1. Missing credentials returns 400
        const badRes = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rollNumber: '' })
        });
        assert.equal(badRes.status, 400);

        // 2. Successful login returns token and user
        const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rollNumber: 'CS21045',
            name: 'Rohan Sharma',
            teamCode: 'ALPHA'
          })
        });
        assert.equal(loginRes.status, 200);
        const loginData = await loginRes.json();
        assert.equal(loginData.success, true);
        assert.ok(loginData.token);
        assert.equal(loginData.user.rollNumber, 'CS21045');
        assert.equal(loginData.user.isClubMember, true); // Seeded club member

        // 3. GET /api/auth/me with Bearer token
        const meRes = await fetch(`${baseUrl}/api/auth/me`, {
          headers: { Authorization: `Bearer ${loginData.token}` }
        });
        assert.equal(meRes.status, 200);
        const meData = await meRes.json();
        assert.equal(meData.success, true);
        assert.equal(meData.user.rollNumber, 'CS21045');

        // 4. GET /api/auth/me without token returns 401
        const unauthRes = await fetch(`${baseUrl}/api/auth/me`);
        assert.equal(unauthRes.status, 401);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    test('POST /api/auth/admin-login authenticates organizer passcode', async () => {
      const app = createApp();
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as AddressInfo).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        // Wrong passcode returns 401
        const wrongRes = await fetch(`${baseUrl}/api/auth/admin-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passcode: 'incorrect_passcode' })
        });
        assert.equal(wrongRes.status, 401);

        // Correct passcode returns 200 with admin token
        const rightRes = await fetch(`${baseUrl}/api/auth/admin-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passcode: getAdminSecret() })
        });
        assert.equal(rightRes.status, 200);
        const rightData = await rightRes.json();
        assert.equal(rightData.success, true);
        assert.equal(rightData.user.role, 'admin');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    test('GET /api/auth/verify-membership/:identifier checks club membership', async () => {
      const app = createApp();
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as AddressInfo).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        const ufcRes = await fetch(`${baseUrl}/api/auth/verify-membership/UFC-888`);
        assert.equal(ufcRes.status, 200);
        const ufcData = await ufcRes.json();
        assert.equal(ufcData.isClubMember, true);

        const guestRes = await fetch(`${baseUrl}/api/auth/verify-membership/GUEST01`);
        assert.equal(guestRes.status, 200);
        const guestData = await guestRes.json();
        assert.equal(guestData.isClubMember, false);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    test('Team creation and join propagates verified session isClubMember status', async () => {
      const app = createApp();
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as AddressInfo).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        // 1. Authenticate seeded UFC club member
        const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rollNumber: 'CS21045', name: 'Rohan Sharma' })
        });
        const loginData = await loginRes.json();
        assert.equal(loginData.user.isClubMember, true);
        const sessionToken = loginData.token;

        // 2. Create team with session token -> isClubMember should be true
        const createRes = await fetch(`${baseUrl}/api/team/create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionToken}`
          },
          body: JSON.stringify({
            teamName: 'VerifiedSquad',
            targetSize: 2,
            captainRoll: 'CS21045',
            captainName: 'Rohan Sharma'
          })
        });
        assert.equal(createRes.status, 201);
        const createData = await createRes.json();
        const capt = createData.snapshot.members.find((m: { rollNumber: string }) => m.rollNumber === 'CS21045');
        assert.equal(capt.isClubMember, true);

        // 3. Non-authenticated member joins without session -> isClubMember should be false
        const joinRes = await fetch(`${baseUrl}/api/team/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            teamCode: createData.teamCode,
            rollNumber: 'GUEST99',
            name: 'Unverified Guest'
          })
        });
        assert.equal(joinRes.status, 200);
        const joinData = await joinRes.json();
        const guest = joinData.snapshot.members.find((m: { rollNumber: string }) => m.rollNumber === 'GUEST99');
        assert.equal(guest.isClubMember, false);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    test('POST /api/auth/oidc/exchange enforces state validation and client cookie binding', async () => {
      const app = createApp();
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as AddressInfo).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        // 1. Under default local auth, OIDC exchange returns 400 OIDC_UNSUPPORTED
        const unsupportedRes = await fetch(`${baseUrl}/api/auth/oidc/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: 'test_code', state: 'test_state' })
        });
        assert.equal(unsupportedRes.status, 400);
        const unsupportedData = await unsupportedRes.json();
        assert.equal(unsupportedData.error, 'OIDC_UNSUPPORTED');

        // 2. Inject mock OIDC provider supporting state validation & code exchange
        const validTestState = 'sec_state_456';
        let validatedStateArg: string | null = null;
        let exchangedCodeArg: string | null = null;

        const mockOidc = {
          providerName: 'club_oidc',
          getAuthUrl: () => `https://fossclub.tech/oauth/authorize?client_id=matiks&state=${validTestState}`,
          validateState: (s: string) => {
            validatedStateArg = s;
            return s === validTestState;
          },
          exchangeCode: async (code: string) => {
            exchangedCodeArg = code;
            if (code !== 'valid_auth_code') throw new Error('Invalid code');
            return {
              user: {
                id: 'oidc_user_1',
                rollNumber: 'CS21045',
                displayName: 'Rohan Sharma',
                isClubMember: true,
                role: 'participant' as const
              },
              token: 'oidc_jwt_token_xyz'
            };
          },
          loginPlayer: async () => { throw new Error('Not implemented'); },
          loginAdmin: async () => { throw new Error('Not implemented'); },
          verifySession: async () => null,
          validateClubMembership: async () => true
        };

        setAuthProvider(mockOidc);

        // 3. GET /api/auth/config returns state and sets HttpOnly cookie
        const configRes = await fetch(`${baseUrl}/api/auth/config`);
        assert.equal(configRes.status, 200);
        const configData = await configRes.json();
        assert.equal(configData.state, validTestState);

        const setCookieHeader = configRes.headers.get('set-cookie');
        assert.ok(setCookieHeader);
        assert.ok(setCookieHeader.includes('matiks_oidc_state=sec_state_456'));
        assert.ok(setCookieHeader.includes('HttpOnly'));

        // 4. POST /api/auth/oidc/exchange with missing state cookie returns 400
        const noCookieRes = await fetch(`${baseUrl}/api/auth/oidc/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: 'valid_auth_code', state: validTestState })
        });
        assert.equal(noCookieRes.status, 400);
        const noCookieData = await noCookieRes.json();
        assert.equal(noCookieData.error, 'INVALID_OIDC_STATE');
        assert.equal(noCookieData.message, 'Client session state cookie is missing.');

        // 5. POST /api/auth/oidc/exchange with state mismatch against cookie returns 400
        const mismatchRes = await fetch(`${baseUrl}/api/auth/oidc/exchange`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: 'matiks_oidc_state=sec_state_456'
          },
          body: JSON.stringify({ code: 'valid_auth_code', state: 'tampered_state' })
        });
        assert.equal(mismatchRes.status, 400);
        const mismatchData = await mismatchRes.json();
        assert.equal(mismatchData.error, 'INVALID_OIDC_STATE');

        // 6. POST /api/auth/oidc/exchange with matching state and valid code succeeds
        const successRes = await fetch(`${baseUrl}/api/auth/oidc/exchange`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: 'matiks_oidc_state=sec_state_456'
          },
          body: JSON.stringify({ code: 'valid_auth_code', state: validTestState })
        });
        assert.equal(successRes.status, 200);
        const successData = await successRes.json();
        assert.equal(successData.success, true);
        assert.equal(successData.user.rollNumber, 'CS21045');
        assert.equal(successData.user.isClubMember, true);
        assert.equal(successData.token, 'oidc_jwt_token_xyz');
        assert.equal(validatedStateArg, validTestState);
        assert.equal(exchangedCodeArg, 'valid_auth_code');

        // Cookie is cleared upon successful exchange
        const clearedCookieHeader = successRes.headers.get('set-cookie');
        assert.ok(clearedCookieHeader);
        assert.ok(clearedCookieHeader.includes('Max-Age=0'));
      } finally {
        resetAuthProviderInstances();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe('5. OIDC Admin Claims & requireAdminAuth Integration', () => {
    test('ClubOidcAuthProvider maps is_admin claim and organizer roles to admin role', async () => {
      const mockServer = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/api/auth/token') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            access_token: 'mock_token',
            user: {
              id: 'ufc_admin_1',
              rollNumber: 'HARSHIT',
              name: 'Harshit Lead',
              email: 'harshit@fossclub.tech',
              isClubMember: true,
              is_admin: true,
              role: 'admin'
            }
          }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise<void>((resolve) => mockServer.listen(0, resolve));
      const port = (mockServer.address() as AddressInfo).port;

      try {
        const provider = new ClubOidcAuthProvider({
          issuerUrl: `http://127.0.0.1:${port}`,
          clientId: 'matiks',
          clientSecret: 'secret_123',
          timeoutMs: 1000
        });

        const authResult = await provider.exchangeCode('valid_code');
        assert.equal(authResult.user.role, 'admin');
        assert.equal(authResult.user.is_admin, true);
        assert.equal(authResult.user.isAdmin, true);
      } finally {
        await new Promise<void>((resolve) => mockServer.close(() => resolve()));
      }
    });

    test('ADMIN_ROLL_NUMBERS grants is_admin privileges via OIDC exchangeCode while participant login remains unprivileged', async () => {
      const prevAdminRolls = process.env.ADMIN_ROLL_NUMBERS;
      process.env.ADMIN_ROLL_NUMBERS = 'SUPERADMIN1,TESTLEAD';

      const mockServer = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/api/auth/token') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            access_token: 'mock_token',
            user: {
              id: 'ufc_user_admin_roll',
              rollNumber: 'SUPERADMIN1',
              name: 'Super Admin',
              email: 'superadmin@example.com',
              isClubMember: true
            }
          }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise<void>((resolve) => mockServer.listen(0, resolve));
      const port = (mockServer.address() as AddressInfo).port;

      try {
        const oidcProvider = new ClubOidcAuthProvider({
          issuerUrl: `http://127.0.0.1:${port}`,
          clientId: 'matiks',
          clientSecret: 'secret_123',
          timeoutMs: 1000
        });

        // OIDC exchange elevates roll in ADMIN_ROLL_NUMBERS to admin
        const res = await oidcProvider.exchangeCode('code_admin_roll');
        assert.equal(res.user.role, 'admin');
        assert.equal(res.user.is_admin, true);
        assert.equal(res.user.isAdmin, true);

        // Unauthenticated loginPlayer never elevates privileges
        const localProvider = new LocalHackathonAuthProvider();
        const unauthRes = await localProvider.loginPlayer({
          rollNumber: 'SUPERADMIN1',
          name: 'Super Admin Impersonator'
        });
        assert.equal(unauthRes.user.role, 'participant');
        assert.equal(unauthRes.user.is_admin, false);

        const normalRes = await localProvider.loginPlayer({
          rollNumber: 'STUDENT99',
          name: 'Normal Student'
        });
        assert.equal(normalRes.user.role, 'participant');
        assert.equal(normalRes.user.is_admin, false);
      } finally {
        await new Promise<void>((resolve) => mockServer.close(() => resolve()));
        if (prevAdminRolls === undefined) {
          delete process.env.ADMIN_ROLL_NUMBERS;
        } else {
          process.env.ADMIN_ROLL_NUMBERS = prevAdminRolls;
        }
      }
    });

    test('ADMIN_ROLL_NUMBERS does not grant admin via preferred_username alone without explicit rollNumber claim', async () => {
      const prevAdminRolls = process.env.ADMIN_ROLL_NUMBERS;
      process.env.ADMIN_ROLL_NUMBERS = 'TESTLEAD';

      const mockServer = http.createServer((req, res) => {
        if (req.method === 'POST' && (req.url === '/token' || req.url === '/api/auth/token')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            access_token: 'mock_token'
          }));
        } else if (req.method === 'GET' && (req.url === '/me' || req.url === '/api/auth/me')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            preferred_username: 'TESTLEAD',
            name: 'Test Lead',
            member: true
          }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise<void>((resolve) => mockServer.listen(0, resolve));
      const port = (mockServer.address() as AddressInfo).port;

      try {
        const oidcProvider = new ClubOidcAuthProvider({
          issuerUrl: `http://127.0.0.1:${port}`,
          clientId: 'matiks',
          clientSecret: 'secret_123',
          timeoutMs: 1000
        });

        const res = await oidcProvider.exchangeCode('code_lead');
        assert.equal(res.user.role, 'participant');
        assert.equal(res.user.is_admin, false);
        assert.equal(res.user.isAdmin, false);
      } finally {
        await new Promise<void>((resolve) => mockServer.close(() => resolve()));
        if (prevAdminRolls === undefined) {
          delete process.env.ADMIN_ROLL_NUMBERS;
        } else {
          process.env.ADMIN_ROLL_NUMBERS = prevAdminRolls;
        }
      }
    });

    test('requireAdminAuth accepts session tokens with is_admin and rejects non-admin with 403', async () => {
      const app = createApp();
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as AddressInfo).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        const provider = getAuthProvider();

        // 1. Participant login
        const participantLogin = await provider.loginPlayer({
          rollNumber: 'REGULAR01',
          name: 'Regular Player'
        });

        // 2. Admin login
        const adminLogin = await provider.loginAdmin({
          passcode: getAdminSecret()
        });

        // 3. Participant accessing /api/admin/telemetry gets 403 Forbidden
        const participantRes = await fetch(`${baseUrl}/api/admin/telemetry`, {
          headers: { Authorization: `Bearer ${participantLogin.token}` }
        });
        assert.equal(participantRes.status, 403);
        const participantBody = await participantRes.json();
        assert.equal(participantBody.error, 'FORBIDDEN_ADMIN_ACCESS');

        // 4. Admin accessing /api/admin/telemetry gets 200 OK
        const adminRes = await fetch(`${baseUrl}/api/admin/telemetry`, {
          headers: { Authorization: `Bearer ${adminLogin.token}` }
        });
        assert.equal(adminRes.status, 200);
        const adminBody = await adminRes.json();
        assert.ok(adminBody.activeRooms !== undefined);

        // 5. Invalid token gets 401 Unauthorized
        const invalidRes = await fetch(`${baseUrl}/api/admin/telemetry`, {
          headers: { Authorization: 'Bearer totally_invalid_token' }
        });
        assert.equal(invalidRes.status, 401);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });
});

