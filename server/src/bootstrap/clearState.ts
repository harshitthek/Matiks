/**
 * MATIKS HACKATHON ENGINE — CLEAR THE SAVED GAME IN REDIS (clearState.ts)
 *
 * Run by an organizer between events (npm run state:clear -- --yes). Without --yes it only reports what Redis holds. It removes the saved
 * game (teams, sessions, audit trail, organizer settings) and the database write queue; it does not touch sign-in sessions or the lease.
 * Stop the server first: a running server would write its in-memory game straight back.
 */

import { gameStateMirror } from '../store/gameStateMirror.js';
import { getRedis, key, pingRedis, redisGuard } from '../store/redis.js';

const confirmed = process.argv.includes('--yes');

if (!getRedis() || !(await pingRedis())) {
  console.error('Redis is not configured or not reachable (set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN).');
  process.exit(1);
}

const holder = await redisGuard.run('clear.peek', (r) => r.get<string>(key('lease')));
if (holder) {
  console.error('A server currently holds the game lease. Stop it first, then run this again.');
  process.exit(1);
}

const rooms = await redisGuard.run('clear.peek', (r) => r.scard(key('rooms')));
const sessions = await redisGuard.run('clear.peek', (r) => r.scard(key('sessions')));
const audit = await redisGuard.run('clear.peek', (r) => r.llen(key('audit')));
const queued = await redisGuard.run('clear.peek', (r) => r.llen(key('outbox')));
const dead = await redisGuard.run('clear.peek', (r) => r.llen(key('outbox', 'dead')));
console.log(`Saved in Redis: ${rooms} teams, ${sessions} sessions, ${audit} audit entries, ${queued} database writes waiting, ${dead} dead-lettered.`);

if (!confirmed) {
  console.log('Nothing was removed. Add --yes to remove it.');
  process.exit(0);
}

await gameStateMirror.clear();
await redisGuard.run('clear.outbox', (r) => r.del(key('outbox'), key('outbox', 'dead')), 2);
console.log('Removed the saved game and the database write queue.');
