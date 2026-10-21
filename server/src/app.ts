/**
 * MATIKS HACKATHON ENGINE — EXPRESS APPLICATION CONFIGURATION (app.ts)
 * 
 * Mounts REST routes, Server-Sent Event endpoints, CORS headers,
 * body parsers, and admin authorization middleware.
 */

import { gameStateMirror } from './store/gameStateMirror.js';
import { redisEnabled, redisGuard } from './store/redis.js';
import express from 'express';
import cors from 'cors';

import {
  createTeamHandler,
  joinTeamHandler,
  readyToggleHandler,
  getTeamSnapshotHandler,
  leaveTeamHandler,
  resetTeamSprintHandler,
  lockRosterHandler,
  checkinByEmailHandler,
  getPublicRosterHandler
} from './controllers/teamController.js';

import {
  submitAnswerHandler,
  syncClientClockHandler
} from './controllers/sprintController.js';

import {
  toggleWindowHandler,
  excuseMemberHandler,
  pauseTeamHandler,
  resumeTeamHandler,
  getAuditLogsHandler,
  getTelemetryHandler,
  getAllRoomsHandler,
  issueAdminStreamTicketHandler,
  simulateTeamsHandler,
  clearSimulatedTeamsHandler,
  exportTournamentCsvHandler,
  exportTournamentJsonHandler,
  setStreamDelayHandler,
  getStreamDelayHandler,
  flushLeaderboardHandler,
  getSessionReplayHandler,
  listSessionReplaysHandler,
  exportPlayerAuditsCsvHandler,
  adminLoginHandler,
  emergencyPauseAllHandler,
  emergencyResumeAllHandler,
  flashBroadcastHandler,
  kickMemberHandler,
  dissolveRoomHandler,
  disqualifyTeamHandler,
  reinstateTeamHandler,
  adjustScoreHandler,
  getRoundModeHandler,
  setRoundModeHandler,
  setEmergencyWalkInHandler,
  uploadRosterCsvHandler,
  getAdminRosterHandler,
  loadRosterPresetHandler,
  resetRosterMemberHandler,
  clearRosterHandler
} from './controllers/adminController.js';

import {
  sseTeamHandler,
  sseLeaderboardHandler,
  sseAdminHandler
} from './controllers/sseController.js';

import {
  getAuthConfigHandler,
  loginPlayerHandler,
  loginAdminHandler,
  getMeHandler,
  exchangeOidcCodeHandler,
  verifyMembershipHandler,
  redirectOidcCallbackHandler
} from './controllers/authController.js';

import { requireAdminAuth, requireMetricsAuth } from './middleware/auth.js';
import { requestLoggingMiddleware } from './config/logger.js';
import { metrics, metricsMiddleware } from './services/metrics.js';
import { isAllowedClientOrigin } from './config/corsOrigins.js';
import { LIMITS, scaled } from './config/rateLimits.js';
import { allOf, byBodyField, byIp, byParam, createRateLimiter } from './middleware/rateLimit.js';


const PRIVATE_LAN_ORIGIN_REGEX =
  /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

export function createApp(): express.Application {
  const app = express();

  // Rate limiters for the unauthenticated endpoints (see config/rateLimits.ts for why address limits are loose and identity limits are not)
  const ipLimiter = (name: string, limit: { windowMs: number; max: number }) =>
    createRateLimiter({ name, windowMs: limit.windowMs, max: scaled(limit.max), key: byIp });
  const identityLimiter = (name: string, limit: { windowMs: number; max: number }, key: (req: express.Request) => string | null) =>
    createRateLimiter({ name, windowMs: limit.windowMs, max: scaled(limit.max), key });

  const configLimiter = ipLimiter('config', LIMITS.config.ip);
  const adminLoginLimiter = ipLimiter('admin_login', LIMITS.adminLogin.ip);
  const loginLimiter = allOf(
    ipLimiter('login_ip', LIMITS.login.ip),
    identityLimiter('login_roll', LIMITS.login.identity, byBodyField('rollNumber'))
  );
  const checkinLimiter = allOf(
    ipLimiter('checkin_ip', LIMITS.login.ip),
    identityLimiter('checkin_email', LIMITS.login.identity, byBodyField('email'))
  );
  const oidcExchangeLimiter = ipLimiter('oidc_exchange', LIMITS.oidcExchange.ip);
  const membershipLimiter = allOf(
    ipLimiter('membership_ip', LIMITS.membership.ip),
    identityLimiter('membership_id', LIMITS.membership.identity, byParam('identifier'))
  );
  const metricsLimiter = ipLimiter('metrics', LIMITS.metrics.ip);

  // Trust reverse proxy (Nginx, Cloudflare, ALB) for accurate client IP and protocol detection
  app.set('trust proxy', 1);

  // Structured NDJSON logging and low-cardinality Prometheus metrics telemetry
  app.use(requestLoggingMiddleware);
  app.use(metricsMiddleware);

  // CORS configuration using centralized allowlist and origin verification
  app.use(
    cors({
      origin: (origin, callback) => {
        const allowLan =
          process.env.NODE_ENV !== 'production' &&
          (process.env.NODE_ENV === 'development' || process.env.ALLOW_LAN_ORIGINS === 'true');

        if (
          !origin ||
          process.env.NODE_ENV === 'test' ||
          isAllowedClientOrigin(origin, { forRedirect: false }) ||
          (allowLan && PRIVATE_LAN_ORIGIN_REGEX.test(origin))
        ) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      credentials: true
    })
  );

  app.use(express.json());

  // Health check
  app.get('/api/health', (_req, res) => {
    const wantsRedis = process.env.STATE_BACKEND === 'upstash' && redisEnabled();
    const mirror = gameStateMirror.status;
    res.status(200).json({
      status: 'ok',
      serverTime: Date.now(),
      state: {
        backend: wantsRedis ? 'upstash' : 'memory',
        redis: !wantsRedis ? 'off' : redisGuard.isHealthy() ? 'ok' : 'down',
        saving: wantsRedis && mirror.enabled && mirror.holdsLease && mirror.lastError === '',
        lastSavedAt: wantsRedis ? mirror.lastFlushAt : 0
      }
    });
  });

  // Prometheus Metrics exposition
  app.get('/metrics', metricsLimiter, requireMetricsAuth, (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(200).send(metrics.getMetricsSnapshot());
  });

  // Authentication REST endpoints (Pluggable Local & Club OIDC)
  app.get('/api/auth/config', configLimiter, getAuthConfigHandler);
  app.post('/api/auth/login', loginLimiter, loginPlayerHandler);
  app.post('/api/auth/admin-login', adminLoginLimiter, loginAdminHandler);
  app.get('/api/auth/me', getMeHandler);
  app.post('/api/auth/oidc/exchange', oidcExchangeLimiter, exchangeOidcCodeHandler);
  app.get('/api/auth/callback/fossclub', configLimiter, redirectOidcCallbackHandler);
  app.get('/api/auth/verify-membership/:identifier', membershipLimiter, verifyMembershipHandler);

  // Server-Sent Event Streams
  app.get('/api/sse/team/:teamCode', sseTeamHandler);
  app.get('/api/sse/leaderboard', sseLeaderboardHandler);
  app.get('/api/sse/admin', sseAdminHandler);

  // Inbound Team REST endpoints
  app.get('/api/teams/roster', getPublicRosterHandler);
  app.post('/api/team/checkin-by-email', checkinLimiter, checkinByEmailHandler);
  app.post('/api/team/create', createTeamHandler);
  app.post('/api/team/join', joinTeamHandler);
  app.post('/api/team/ready', readyToggleHandler);
  app.post('/api/team/leave', leaveTeamHandler);
  app.post('/api/team/reset', resetTeamSprintHandler);
  app.post('/api/team/lock-roster', lockRosterHandler);
  app.get('/api/team/:teamCode', getTeamSnapshotHandler);

  // Inbound Sprint REST endpoints
  app.post('/api/sprint/submit', submitAnswerHandler);
  app.get('/api/sprint/sync', syncClientClockHandler);

  // Inbound Admin REST endpoints (protected)
  app.post('/api/admin/login', adminLoginLimiter, adminLoginHandler);
  app.post('/api/admin/window/toggle', requireAdminAuth, toggleWindowHandler);
  app.post('/api/admin/teams/:teamCode/excuse-member', requireAdminAuth, excuseMemberHandler);
  app.post('/api/admin/teams/:teamCode/pause', requireAdminAuth, pauseTeamHandler);
  app.post('/api/admin/teams/:teamCode/resume', requireAdminAuth, resumeTeamHandler);
  app.post('/api/admin/teams/:teamCode/kick-member', requireAdminAuth, kickMemberHandler);
  app.post('/api/admin/teams/:teamCode/dissolve', requireAdminAuth, dissolveRoomHandler);
  app.post('/api/admin/teams/:teamCode/disqualify', requireAdminAuth, disqualifyTeamHandler);
  app.post('/api/admin/teams/:teamCode/reinstate', requireAdminAuth, reinstateTeamHandler);
  app.post('/api/admin/teams/:teamCode/adjust-score', requireAdminAuth, adjustScoreHandler);
  app.post('/api/admin/emergency/pause-all', requireAdminAuth, emergencyPauseAllHandler);
  app.post('/api/admin/emergency/resume-all', requireAdminAuth, emergencyResumeAllHandler);
  app.post('/api/admin/broadcast', requireAdminAuth, flashBroadcastHandler);
  app.get('/api/admin/roster', requireAdminAuth, getAdminRosterHandler);
  app.post('/api/admin/roster/upload', requireAdminAuth, uploadRosterCsvHandler);
  app.post('/api/admin/roster/load-preset', requireAdminAuth, loadRosterPresetHandler);
  app.post('/api/admin/roster/reset-member', requireAdminAuth, resetRosterMemberHandler);
  app.delete('/api/admin/roster', requireAdminAuth, clearRosterHandler);
  app.get('/api/admin/round-mode', requireAdminAuth, getRoundModeHandler);
  app.post('/api/admin/round-mode', requireAdminAuth, setRoundModeHandler);
  app.post('/api/admin/emergency-walk-in', requireAdminAuth, setEmergencyWalkInHandler);
  app.get('/api/admin/audit-logs', requireAdminAuth, getAuditLogsHandler);
  app.get('/api/admin/telemetry', requireAdminAuth, getTelemetryHandler);
  app.get('/api/admin/rooms', requireAdminAuth, getAllRoomsHandler);
  app.post('/api/admin/stream-ticket', requireAdminAuth, issueAdminStreamTicketHandler);
  app.post('/api/admin/simulate-teams', requireAdminAuth, simulateTeamsHandler);
  app.post('/api/admin/clear-simulated-teams', requireAdminAuth, clearSimulatedTeamsHandler);
  app.get('/api/admin/export/csv', requireAdminAuth, exportTournamentCsvHandler);
  app.get('/api/admin/export/json', requireAdminAuth, exportTournamentJsonHandler);
  app.get('/api/admin/stream-delay', requireAdminAuth, getStreamDelayHandler);
  app.post('/api/admin/stream-delay', requireAdminAuth, setStreamDelayHandler);
  app.post('/api/admin/flush-leaderboard', requireAdminAuth, flushLeaderboardHandler);
  app.get('/api/admin/replays', requireAdminAuth, listSessionReplaysHandler);
  app.get('/api/admin/replay/:sessionId', requireAdminAuth, getSessionReplayHandler);
  app.get('/api/admin/export/player-audits-csv', requireAdminAuth, exportPlayerAuditsCsvHandler);

  return app;
}
