/**
 * MATIKS HACKATHON ENGINE — DATABASE PURGE & RESET SCRIPT (empty_db.ts)
 *
 * Empties all tables in PostgreSQL via Prisma and clears local tournament
 * state snapshots on disk to prepare a clean environment for production hackathon rounds.
 */

import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';

const prisma = new PrismaClient();

async function main() {
  console.log('--- PURGING MATIKS POSTGRESQL & LOCAL SNAPSHOT STATE ---');

  // 1. Fetch current counts before deletion
  const [beforeTeams, beforeMembers, beforeSessions, beforeSubs, beforeStandings, beforeAudits, beforeWindows] =
    await Promise.all([
      prisma.team.count(),
      prisma.teamMember.count(),
      prisma.sprintSession.count(),
      prisma.questionSubmission.count(),
      prisma.leaderboardStanding.count(),
      prisma.auditLog.count(),
      prisma.tournamentWindow.count()
    ]);

  console.log('Record counts BEFORE purge:');
  console.table({
    teams: beforeTeams,
    members: beforeMembers,
    sessions: beforeSessions,
    submissions: beforeSubs,
    standings: beforeStandings,
    auditLogs: beforeAudits,
    windows: beforeWindows
  });

  // 2. Perform transactional deletion in dependency order
  console.log('Executing database transaction to delete all records...');
  await prisma.$transaction([
    prisma.questionSubmission.deleteMany({}),
    prisma.sprintSession.deleteMany({}),
    prisma.leaderboardStanding.deleteMany({}),
    prisma.teamMember.deleteMany({}),
    prisma.team.deleteMany({}),
    prisma.auditLog.deleteMany({}),
    prisma.tournamentWindow.deleteMany({})
  ]);

  // 3. Reset disk snapshot file
  const snapshotPath = path.resolve('.data/tournament-snapshot.json');
  if (fs.existsSync(snapshotPath)) {
    const emptySnapshot = {
      rooms: {},
      sessions: {},
      leaderboard: [],
      auditLogs: [],
      clearedAt: new Date().toISOString()
    };
    fs.writeFileSync(snapshotPath, JSON.stringify(emptySnapshot, null, 2), 'utf8');
    console.log(`Reset snapshot file at: ${snapshotPath}`);
  }

  // 4. Clean out audit session dump files in .data/audits
  const auditsDir = path.resolve('.data/audits');
  if (fs.existsSync(auditsDir)) {
    const auditFiles = fs.readdirSync(auditsDir);
    let deletedCount = 0;
    for (const f of auditFiles) {
      if (f.endsWith('.json')) {
        fs.unlinkSync(path.join(auditsDir, f));
        deletedCount++;
      }
    }
    console.log(`Purged ${deletedCount} audit telemetry dump files from ${auditsDir}`);
  }

  // 5. Verify counts AFTER purge
  const [afterTeams, afterMembers, afterSessions, afterSubs, afterStandings, afterAudits, afterWindows] =
    await Promise.all([
      prisma.team.count(),
      prisma.teamMember.count(),
      prisma.sprintSession.count(),
      prisma.questionSubmission.count(),
      prisma.leaderboardStanding.count(),
      prisma.auditLog.count(),
      prisma.tournamentWindow.count()
    ]);

  console.log('Record counts AFTER purge:');
  console.table({
    teams: afterTeams,
    members: afterMembers,
    sessions: afterSessions,
    submissions: afterSubs,
    standings: afterStandings,
    auditLogs: afterAudits,
    windows: afterWindows
  });

  const totalRemaining =
    afterTeams + afterMembers + afterSessions + afterSubs + afterStandings + afterAudits + afterWindows;

  if (totalRemaining === 0) {
    console.log('✅ DATABASE AND LOCAL CACHE ARE COMPLETELY EMPTY AND CLEAN.');
  } else {
    console.warn(`⚠️ Warning: ${totalRemaining} records remain in database.`);
  }
}

main()
  .catch((err) => {
    console.error('Failed to empty database:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
