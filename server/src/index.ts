/**
 * MATIKS HACKATHON ENGINE — ENTRYPOINT (index.ts)
 * 
 * Boots the Express server and binds to designated HTTP port.
 */

import { createApp } from './app.js';
import { sseHub } from './services/sseHub.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
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

function handleShutdown(): void {
  console.log('Shutting down Matiks Hackathon Server...');
  sseHub.destroy();
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);
