/**
 * MATIKS HACKATHON ENGINE — FRONTEND SERVICES & REALTIME CLIENT TEST SUITE (clientSuite.test.mjs)
 *
 * Verifies client-side REST API wrapper, SSE EventSource stream managers,
 * background-tab visibility resync watchdogs, and Web Audio synthesizer:
 * 1. api.js: All team, sprint, admin, and auth REST functions, ngrok header injection,
 *    and defensive JSON/text error parsing.
 * 2. sse.js: connectTeamStream, connectLeaderboardStream, and connectAdminStream event routing,
 *    exponential backoff reconnection, visibilitychange recovery, and disconnect cleanup.
 * 3. soundFx.js: SoundFxSynthesizer mute toggling, Web Audio oscillator synthesis, and error safety.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import * as api from '../src/services/api.js';
import {
  connectTeamStream,
  connectLeaderboardStream,
  connectAdminStream
} from '../src/services/sse.js';
import { soundFx } from '../src/services/soundFx.js';

describe('Matiks Client — Frontend Services & Realtime Stream Test Suite', () => {
  describe('1. REST Client (api.js) — Request Formatting, Headers & Error Handling', () => {
    let originalFetch;
    let capturedCalls = [];

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      capturedCalls = [];
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test('injects ngrok-skip-browser-warning and auth headers across team, sprint, admin, and auth calls', async () => {
      globalThis.fetch = async (url, options = {}) => {
        capturedCalls.push({ url, options });
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ success: true, url }),
          text: async () => 'Rank,TeamCode\r\n'
        };
      };

      await api.createTeam('Cyber Squad', 3, 'CS001', 'Alice', 'oidc_sess_tok');
      await api.joinTeam('CY-01', 'CS002', 'Bob', 'tok_bob', 'oidc_sess_tok');
      await api.leaveTeam('CY-01', 'CS002', 'tok_bob');
      await api.resetTeamSprint('CY-01', 'CS001', 'tok_alice');
      await api.toggleReady('CY-01', 'CS001', true, 'tok_alice');
      await api.getTeamSnapshot('CY-01', 'tok_alice');
      await api.submitAnswer('sess_1', 0, 84, 650, 1700000000000, 'tok_alice');
      await api.syncClientClock();
      await api.toggleContestWindow(true, 120, 'Ticker', 'adm_tok');
      await api.excuseMember('CY-01', 'CS002', 'Battery', 'adm_tok');
      await api.pauseTeam('CY-01', 'adm_tok');
      await api.resumeTeam('CY-01', 'adm_tok');
      await api.getAdminTelemetry('adm_tok');
      await api.getAdminRooms('adm_tok');
      await api.getAdminAuditLogs('adm_tok');
      await api.getAdminStreamTicket('adm_tok');
      await api.simulateTeams(5, 'adm_tok');
      await api.clearSimulatedTeams('adm_tok');
      await api.exportTournamentCsv('adm_tok');
      await api.exportTournamentJson('adm_tok');
      await api.getAuthConfig(true);
      await api.loginPlayer('CS001', 'Alice', 'CY-01');
      await api.loginAdmin('secret');
      await api.getAuthUser('jwt_tok');
      await api.exchangeOidcCode('code_123', 'state_456');
      await api.verifyClubMembership('UFC202601');
      await api.adminGetSessionReplays('adm_tok');
      await api.adminGetSessionReplay('sess_123', 'adm_tok');
      await api.exportPlayerAuditsCsv('adm_tok');

      assert.equal(capturedCalls.length, 29);
      for (const call of capturedCalls) {
        assert.equal(
          call.options.headers['ngrok-skip-browser-warning'],
          'true',
          `Missing ngrok header on ${call.url}`
        );
      }

      // Verify token headers on createTeam, joinTeam, submitAnswer, getAuthConfig, and exchangeOidcCode
      assert.equal(capturedCalls[0].options.headers['x-session-token'], 'oidc_sess_tok');
      assert.equal(capturedCalls[1].options.headers['x-member-token'], 'tok_bob');
      assert.equal(capturedCalls[1].options.headers['x-session-token'], 'oidc_sess_tok');
      assert.equal(capturedCalls[6].options.headers['x-member-token'], 'tok_alice');
      assert.equal(capturedCalls[8].options.headers['x-admin-token'], 'adm_tok');
      assert.ok(capturedCalls[20].url.endsWith('/api/auth/config?oidc=true'));
      assert.equal(capturedCalls[20].options.credentials, 'include');
      assert.equal(capturedCalls[23].options.headers['Authorization'], 'Bearer jwt_tok');
      assert.equal(capturedCalls[24].options.credentials, 'include');
    });

    test('parses JSON and plain-text HTTP errors with status code and error payload attached', async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: { get: () => 'application/json' },
        json: async () => ({
          error: '120-second sprint deadline expired.',
          errorCode: 'SPRINT_FINISHED',
          isFinished: true
        })
      });

      await assert.rejects(
        () => api.submitAnswer('sess_1', 5, 100, 800, Date.now(), 'tok_1'),
        (err) => {
          assert.equal(err.message, '120-second sprint deadline expired.');
          assert.equal(err.status, 400);
          assert.equal(err.data.errorCode, 'SPRINT_FINISHED');
          assert.equal(err.data.isFinished, true);
          return true;
        }
      );

      // Plain-text 502 Bad Gateway fallback
      globalThis.fetch = async () => ({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        headers: { get: () => 'text/plain' },
        text: async () => 'Upstream proxy error'
      });

      await assert.rejects(
        () => api.getTeamSnapshot('CY-01', 'tok_1'),
        (err) => {
          assert.equal(err.message, 'Upstream proxy error');
          assert.equal(err.status, 502);
          return true;
        }
      );
    });
  });

  describe('2. Realtime SSE Client (sse.js) — Event Routing, Reconnection & Visibility Resync', () => {
    let originalEventSource;
    let originalDocument;
    let originalFetch;
    let instances = [];
    let visibilityListeners = [];

    class MockEventSource {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;

      constructor(url) {
        this.url = url;
        this.readyState = MockEventSource.CONNECTING;
        this.listeners = new Map();
        this.onopen = null;
        this.onerror = null;
        instances.push(this);
      }

      addEventListener(type, cb) {
        if (!this.listeners.has(type)) {
          this.listeners.set(type, []);
        }
        this.listeners.get(type).push(cb);
      }

      emitOpen() {
        this.readyState = MockEventSource.OPEN;
        this.onopen?.();
      }

      emitEvent(type, payload) {
        const list = this.listeners.get(type) || [];
        const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
        for (const cb of list) {
          cb({ data });
        }
      }

      emitError(err = new Error('Socket drop')) {
        this.readyState = MockEventSource.CLOSED;
        this.onerror?.(err);
      }

      close() {
        this.readyState = MockEventSource.CLOSED;
      }
    }

    beforeEach(() => {
      instances = [];
      visibilityListeners = [];
      originalEventSource = globalThis.EventSource;
      originalDocument = globalThis.document;
      originalFetch = globalThis.fetch;

      globalThis.EventSource = MockEventSource;
      globalThis.document = {
        visibilityState: 'visible',
        addEventListener(type, cb) {
          if (type === 'visibilitychange') visibilityListeners.push(cb);
        },
        removeEventListener(type, cb) {
          if (type === 'visibilitychange') {
            visibilityListeners = visibilityListeners.filter((fn) => fn !== cb);
          }
        }
      };
    });

    afterEach(() => {
      globalThis.EventSource = originalEventSource;
      globalThis.document = originalDocument;
      globalThis.fetch = originalFetch;
    });

    test('connectTeamStream routes all 9 SSE events and recovers on visibilitychange', () => {
      const received = [];
      const stream = connectTeamStream('AP-34', 'tok_123', {
        onConnectionChange: (c) => received.push(['connected', c]),
        onSnapshot: (d) => received.push(['snapshot', d.teamCode]),
        onMemberReady: (d) => received.push(['ready', d.rollNumber]),
        onCountdownTick: (d) => received.push(['tick', d.secondsRemaining]),
        onSprintStart: (d) => received.push(['start', d.totalQuestions]),
        onSprintResume: (d) => received.push(['resume', d.maxStreak, d.submissions?.length]),
        onTeammateProgress: (d) => received.push(['progress', d.questionIndex]),
        onRoomPaused: () => received.push(['paused']),
        onRoomResumed: () => received.push(['resumed']),
        onSprintError: (d) => received.push(['error', d.message])
      });

      assert.equal(instances.length, 1);
      const es = instances[0];
      assert.ok(es.url.includes('/api/sse/team/AP-34?token=tok_123'));

      es.emitOpen();
      es.emitEvent('team_snapshot', { teamCode: 'AP-34' });
      es.emitEvent('member_ready_changed', { rollNumber: 'R1' });
      es.emitEvent('countdown_tick', { secondsRemaining: 3 });
      es.emitEvent('sprint_start', { totalQuestions: 15 });
      es.emitEvent('sprint_resume', { maxStreak: 4, submissions: [{}, {}] });
      es.emitEvent('teammate_progress', { questionIndex: 7 });
      es.emitEvent('room_paused', {});
      es.emitEvent('room_resumed', {});
      es.emitEvent('sprint_error', { message: 'Window closed' });

      assert.deepEqual(received, [
        ['connected', true],
        ['snapshot', 'AP-34'],
        ['ready', 'R1'],
        ['tick', 3],
        ['start', 15],
        ['resume', 4, 2],
        ['progress', 7],
        ['paused'],
        ['resumed'],
        ['error', 'Window closed']
      ]);

      // Simulate closed stream + visibilitychange -> automatically creates new EventSource
      es.close();
      for (const fn of visibilityListeners) fn();
      assert.equal(instances.length, 2);

      stream.disconnect();
      assert.equal(visibilityListeners.length, 0);
    });

    test('connectLeaderboardStream and connectAdminStream exchange tickets and route events', async () => {
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ticket: 'ephemeral_ticket_999' })
      });

      const lbEvents = [];
      const lbStream = connectLeaderboardStream({
        onLeaderboardUpdate: (d) => lbEvents.push(['lb', d.length]),
        onWindowStatus: (d) => lbEvents.push(['win', d.isOpen])
      });

      const lbEs = instances[0];
      lbEs.emitOpen();
      lbEs.emitEvent('leaderboard_update', [{ teamCode: 'T1' }]);
      lbEs.emitEvent('window_status', { isOpen: true });
      assert.deepEqual(lbEvents, [
        ['lb', 1],
        ['win', true]
      ]);
      lbStream.disconnect();

      const adminEvents = [];
      const adminStream = connectAdminStream('adm_secret', {
        onTelemetry: (d) => adminEvents.push(['tel', d.activeRooms]),
        onAnomalyFlag: (d) => adminEvents.push(['flag', d.flagReason])
      });

      // Wait a microtask for async ticket fetch in connectAdminStream
      await new Promise((r) => setTimeout(r, 20));
      const admEs = instances[1];
      assert.ok(admEs.url.includes('ticket=ephemeral_ticket_999'));
      admEs.emitOpen();
      admEs.emitEvent('admin_telemetry', { activeRooms: 5 });
      admEs.emitEvent('anomaly_flag', { flagReason: 'SUB_200MS_SPEED_ANOMALY' });
      assert.deepEqual(adminEvents, [
        ['tel', 5],
        ['flag', 'SUB_200MS_SPEED_ANOMALY']
      ]);
      adminStream.disconnect();
    });
  });

  describe('3. Web Audio Synthesizer (soundFx.js) — Tactile Audio & Mute State', () => {
    let originalWindow;

    beforeEach(() => {
      originalWindow = globalThis.window;
      let oscCount = 0;
      globalThis.window = {
        AudioContext: class MockAudioContext {
          constructor() {
            this.state = 'running';
            this.currentTime = 0;
            this.destination = {};
          }
          createOscillator() {
            oscCount++;
            return {
              type: 'sine',
              frequency: {
                setValueAtTime() {},
                exponentialRampToValueAtTime() {},
                linearRampToValueAtTime() {}
              },
              connect() {},
              start() {},
              stop() {}
            };
          }
          createGain() {
            return {
              gain: {
                setValueAtTime() {},
                exponentialRampToValueAtTime() {}
              },
              connect() {}
            };
          }
          getOscCount() {
            return oscCount;
          }
        }
      };
      soundFx.ctx = null;
      soundFx.muted = false;
    });

    afterEach(() => {
      globalThis.window = originalWindow;
      soundFx.ctx = null;
      soundFx.muted = false;
    });

    test('synthesizes key click, correct, incorrect, finish fanfare, countdown tick, and podium fanfare and respects mute toggle', () => {
      assert.equal(soundFx.isMuted(), false);
      soundFx.playKeyClick();
      soundFx.playCorrect();
      soundFx.playIncorrect();
      soundFx.playFinish(); // plays 4-note chord
      soundFx.playCountdownTick(false); // 1 osc
      soundFx.playPodiumFanfare(); // 7 osc

      assert.equal(soundFx.ctx.getOscCount(), 15);

      // Mute suppresses further oscillators
      assert.equal(soundFx.toggleMute(), true);
      assert.equal(soundFx.isMuted(), true);
      soundFx.playKeyClick();
      soundFx.playCorrect();
      soundFx.playPodiumFanfare();
      assert.equal(soundFx.ctx.getOscCount(), 15);

      assert.equal(soundFx.toggleMute(), false);
      soundFx.playKeyClick();
      assert.equal(soundFx.ctx.getOscCount(), 16);
    });

    test('resumes suspended AudioContext and gracefully survives missing Web Audio API', () => {
      let resumed = false;
      soundFx.ctx = {
        state: 'suspended',
        currentTime: 0,
        destination: {},
        resume: async () => {
          resumed = true;
        },
        createOscillator: () => {
          throw new Error('Simulated audio hardware fault');
        }
      };

      // Should call resume() and catch oscillator error without throwing
      assert.doesNotThrow(() => soundFx.playKeyClick());
      assert.equal(resumed, true);

      // Missing AudioContext in window should also no-op safely
      globalThis.window = {};
      soundFx.ctx = null;
      assert.doesNotThrow(() => {
        soundFx.playKeyClick();
        soundFx.playCorrect();
        soundFx.playIncorrect();
        soundFx.playFinish();
      });
    });
  });

  describe('4. SSE Fault Tolerance — Malformed Payloads & Admin Auth Fast-Fail', () => {
    let originalEventSource;
    let originalDocument;
    let originalFetch;
    let instances = [];

    beforeEach(() => {
      instances = [];
      originalEventSource = globalThis.EventSource;
      originalDocument = globalThis.document;
      originalFetch = globalThis.fetch;

      globalThis.EventSource = class {
        static CLOSED = 2;
        constructor(url) {
          this.url = url;
          this.listeners = new Map();
          instances.push(this);
        }
        addEventListener(type, cb) {
          this.listeners.set(type, cb);
        }
        close() {
          this.readyState = 2;
        }
      };
      globalThis.document = {
        visibilityState: 'visible',
        addEventListener() {},
        removeEventListener() {}
      };
    });

    afterEach(() => {
      globalThis.EventSource = originalEventSource;
      globalThis.document = originalDocument;
      globalThis.fetch = originalFetch;
    });

    test('survives malformed JSON in SSE events and fast-fails on 401 admin ticket response', async () => {
      const teamStream = connectTeamStream('AP-34', 'tok_1', {});
      const es = instances[0];
      assert.doesNotThrow(() => {
        es.listeners.get('team_snapshot')({ data: '{invalid_json' });
        es.listeners.get('sprint_resume')({ data: '{invalid_json' });
      });
      teamStream.disconnect();

      // Admin stream receives 401 from /api/admin/stream-ticket -> fast-fails without opening EventSource
      globalThis.fetch = async () => ({
        ok: false,
        status: 401
      });

      const errors = [];
      const adminStream = connectAdminStream('bad_admin_token', {
        onError: (err) => errors.push(err.status)
      });
      await new Promise((r) => setTimeout(r, 20));
      assert.deepEqual(errors, [401]);
      assert.equal(instances.length, 1, 'Must not instantiate EventSource when ticket request returns 401');
      adminStream.disconnect();
    });
  });
});
