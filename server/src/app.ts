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
  getTeamSnapshotHandler
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

import { requireAdminAuth } from './middleware/auth.js';

export function createApp(): express.Application {
  const app = express();

  // Middleware
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());

  // Health check
  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok', serverTime: Date.now() });
  });

  // Server-Sent Event Streams
  app.get('/api/sse/team/:teamCode', sseTeamHandler);
  app.get('/api/sse/leaderboard', sseLeaderboardHandler);
  app.get('/api/sse/admin', sseAdminHandler);

  // Inbound Team REST endpoints
  app.post('/api/team/create', createTeamHandler);
  app.post('/api/team/join', joinTeamHandler);
  app.post('/api/team/ready', readyToggleHandler);
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
