/**
 * Test Environment Setup
 * Executed before any test files are loaded.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import { windowManager } from '../src/services/windowManager.js';

process.env.NODE_ENV = 'test';
process.env.ADMIN_SECRET = 'hackathon_admin_secret';
process.env.AUTH_MODE = 'local';
process.env.LOAD_TEST_MAX_LATENCY_MS = process.env.LOAD_TEST_MAX_LATENCY_MS || '150';
delete process.env.CORS_ORIGINS;
process.env.AUDIT_LOG_DIR =
  process.env.AUDIT_LOG_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'matiks-test-audits-'));

// Ensure competition window is open by default in test execution environments
windowManager.openWindow(120);

