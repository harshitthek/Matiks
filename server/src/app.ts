/**
 * MATIKS HACKATHON ENGINE — EXPRESS APPLICATION CONFIGURATION (app.ts)
 * 
 * Mounts REST routes, Server-Sent Event endpoints, CORS headers,
 * body parsers, and admin authorization middleware.
 */

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


const PRIVATE_LAN_ORIGIN_REGEX =
  /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

function createRateLimiter(windowMs: number, maxRequests: number): express.RequestHandler {
  const ipRequests = new Map<string, { count: number; resetAt: number }>();
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (process.env.NODE_ENV === 'test') {
      return next();
    }
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    if (ipRequests.size > 500) {
      for (const [key, val] of ipRequests.entries()) {
        if (now > val.resetAt) {
          ipRequests.delete(key);
        }
      }
    }

    const entry = ipRequests.get(ip);
    if (!entry || now > entry.resetAt) {
      ipRequests.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (entry.count >= maxRequests) {
      res.status(429).json({
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.'
      });
      return;
    }
    entry.count++;
    next();
  };
}

export function createApp(): express.Application {
  const app = express();

  // Rate limiters for sensitive unauthenticated endpoints
  const configLimiter = createRateLimiter(60 * 1000, 60);
  const adminLoginLimiter = createRateLimiter(60 * 1000, 15);
  const loginLimiter = createRateLimiter(60 * 1000, 30);
  const oidcExchangeLimiter = createRateLimiter(60 * 1000, 30);
  const membershipLimiter = createRateLimiter(60 * 1000, 60);
  const metricsLimiter = createRateLimiter(60 * 1000, 120);

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
    res.status(200).json({ status: 'ok', serverTime: Date.now() });
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
  app.post('/api/team/checkin-by-email', loginLimiter, checkinByEmailHandler);
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
