/**
 * MATIKS HACKATHON ENGINE — ENTRYPOINT (index.ts)
 * 
 * Boots the Express server and binds to designated HTTP port.
 */

import { createApp } from './app.js';
import { restoreTournamentState } from './bootstrap/restoreState.js';
import { gameStateMirror, LeaseHeldError } from './store/gameStateMirror.js';
import { sseHub } from './services/sseHub.js';
import { statePersistence } from './services/statePersistence.js';
import { databaseService } from './services/databaseService.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

if (process.env.NODE_ENV !== 'test') {
  try {
    const report = await restoreTournamentState();
    console.log(`State backend: ${report.backend}; restored ${report.teams} teams from ${report.source}.`);
    if (report.backend === 'upstash') databaseService.startOutboxRetries();
  } catch (err) {
    if (err instanceof LeaseHeldError) {
      console.error(
        `FATAL: another Matiks server already holds the game-state lease on this Redis${err.holder ? ` (${err.holder})` : ''}. ` +
          'Two servers must not run the same game. Stop the other one, or give this one its own REDIS_KEY_PREFIX.'
      );
      process.exit(1);
    }
    throw err;
  }
}

const app = createApp();

const server = app.listen(PORT, (err?: Error) => {
  if (err) {
    console.error(`Failed to start Matiks Hackathon Server:`, err);
    process.exit(1);
  }
  console.log(`⚡ Matiks Hackathon Server listening on http://localhost:${PORT}`);
});

server.on('error', (err: Error) => {
  console.error(`Server error encountered:`, err);
  process.exit(1);
});

async function handleShutdown(): Promise<void> {
  console.log('Shutting down Matiks Hackathon Server...');
  if (process.env.NODE_ENV !== 'test') {
    statePersistence.saveNow();
    await gameStateMirror.shutdown();
    databaseService.stopOutboxRetries();
  }
  const flushTimeout = new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 3000);
    t.unref?.();
  });
  await Promise.race([databaseService.flushPendingWrites(), flushTimeout]);
  await databaseService.disconnect();
  sseHub.destroy();
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);
