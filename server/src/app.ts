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
  resetTeamSprintHandler
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
  clearSimulatedTeamsHandler
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
  verifyMembershipHandler
} from './controllers/authController.js';

import { requireAdminAuth } from './middleware/auth.js';

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

  // Trust reverse proxy (Nginx, Cloudflare, ALB) for accurate client IP and protocol detection
  app.set('trust proxy', 1);

  // CORS configuration with explicit trusted origins allowlist
  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,https://matiks.fossclub.tech,https://fossclub.tech,https://www.fossclub.tech')
    .split(',')
    .map(s => s.trim());

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV === 'test') {
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

  // Authentication REST endpoints (Pluggable Local & Club OIDC)
  app.get('/api/auth/config', configLimiter, getAuthConfigHandler);
  app.post('/api/auth/login', loginLimiter, loginPlayerHandler);
  app.post('/api/auth/admin-login', adminLoginLimiter, loginAdminHandler);
  app.get('/api/auth/me', getMeHandler);
  app.post('/api/auth/oidc/exchange', oidcExchangeLimiter, exchangeOidcCodeHandler);
  app.get('/api/auth/verify-membership/:identifier', membershipLimiter, verifyMembershipHandler);

  // Server-Sent Event Streams
  app.get('/api/sse/team/:teamCode', sseTeamHandler);
  app.get('/api/sse/leaderboard', sseLeaderboardHandler);
  app.get('/api/sse/admin', sseAdminHandler);

  // Inbound Team REST endpoints
  app.post('/api/team/create', createTeamHandler);
  app.post('/api/team/join', joinTeamHandler);
  app.post('/api/team/ready', readyToggleHandler);
  app.post('/api/team/leave', leaveTeamHandler);
  app.post('/api/team/reset', resetTeamSprintHandler);
  app.get('/api/team/:teamCode', getTeamSnapshotHandler);

  // Inbound Sprint REST endpoints
  app.post('/api/sprint/submit', submitAnswerHandler);
  app.get('/api/sprint/sync', syncClientClockHandler);

  // Inbound Admin REST endpoints (protected)
  app.post('/api/admin/window/toggle', requireAdminAuth, toggleWindowHandler);
  app.post('/api/admin/teams/:teamCode/excuse-member', requireAdminAuth, excuseMemberHandler);
  app.post('/api/admin/teams/:teamCode/pause', requireAdminAuth, pauseTeamHandler);
  app.post('/api/admin/teams/:teamCode/resume', requireAdminAuth, resumeTeamHandler);
  app.get('/api/admin/audit-logs', requireAdminAuth, getAuditLogsHandler);
  app.get('/api/admin/telemetry', requireAdminAuth, getTelemetryHandler);
  app.get('/api/admin/rooms', requireAdminAuth, getAllRoomsHandler);
  app.post('/api/admin/stream-ticket', requireAdminAuth, issueAdminStreamTicketHandler);
  app.post('/api/admin/simulate-teams', requireAdminAuth, simulateTeamsHandler);
  app.post('/api/admin/clear-simulated-teams', requireAdminAuth, clearSimulatedTeamsHandler);

  return app;
}
