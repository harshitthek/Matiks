import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { rosterService } from '../src/services/rosterService.js';
import { roomManager } from '../src/services/roomManager.js';
import { windowManager } from '../src/services/windowManager.js';

describe('Event Roster Engine & CSV Import Suite', () => {
  beforeEach(() => {
    rosterService.clearRoster();
    windowManager.openWindow(120);
  });

  test('1. Parses consolidated roster CSV (team_name, email_1, email_2, ...)', () => {
    const csv = `team_name,email_1,email_2,email_3,email_4
bhavyabisht345,bhavya@example.com,,,
Zenophile,aryan@example.com,prem@example.com,ojas@example.com,
Ravagers,anuj@example.com,dhruv@example.com,parth@example.com,abhav@example.com`;

    const res = rosterService.loadRosterFromCsv(csv);
    assert.equal(res.teamsCount, 3);
    assert.equal(res.membersCount, 8);

    const publicList = rosterService.getPublicRoster();
    assert.equal(publicList.length, 3);

    const zenophile = publicList.find(t => t.teamName === 'Zenophile');
    assert.ok(zenophile);
    assert.equal(zenophile.targetSize, 3);
    assert.equal(zenophile.checkedInCount, 0);

    const solo = publicList.find(t => t.teamName === 'bhavyabisht345');
    assert.ok(solo);
    assert.equal(solo.targetSize, 1);
  });

  test('2. Parses Unstop multi-row format with names and candidate types', () => {
    const csv = `"Regn ID","Team Name / Candidate Name","Team Leader's Email / Candidate's Email","Candidate Type","Candidate's Name","Candidate's Email"
"REG-01","Zenophile","aryan@example.com","Team Leader","Aryan Bhardwaj","aryan@example.com"
"REG-01","Zenophile","aryan@example.com","Team Member","Prem Durgapal","prem@example.com"
"REG-01","Zenophile","aryan@example.com","Team Member","Ojas Pal","ojas@example.com"`;

    const res = rosterService.loadRosterFromCsv(csv);
    assert.equal(res.teamsCount, 1);
    assert.equal(res.membersCount, 3);

    const team = rosterService.findTeamByEmail('prem@example.com');
    assert.ok(team);
    assert.equal(team.teamName, 'Zenophile');

    const member = rosterService.findMemberByEmail('aryan@example.com');
    assert.ok(member);
    assert.equal(member.name, 'Aryan Bhardwaj');
    assert.equal(member.isLeader, true);
  });

  test('3. Email check-in automatically instantiates team room and assigns members', async () => {
    const csv = `team_name,email_1,email_2
AlphaSquad,player1@test.com,player2@test.com`;
    rosterService.loadRosterFromCsv(csv);

    // Player 1 check-in
    const p1 = await rosterService.checkinByEmail('player1@test.com', 'Alice');
    assert.ok(p1.memberToken);
    assert.equal(p1.teamName, 'AlphaSquad');
    assert.equal(p1.isCaptain, true);
    assert.equal(p1.targetSize, 2);

    const room = roomManager.getRoom(p1.teamCode);
    assert.ok(room);
    assert.equal(room.members.size, 1);
    assert.equal(room.status, 'LOBBY');

    // Player 2 check-in
    const p2 = await rosterService.checkinByEmail('player2@test.com', 'Bob');
    assert.ok(p2.memberToken);
    assert.equal(p2.teamCode, p1.teamCode);
    assert.equal(p2.isCaptain, false);

    // Room now reached capacity (2/2) -> transitions to AWAITING_READY
    assert.equal(room.members.size, 2);
    assert.equal(room.status, 'AWAITING_READY');

    // Reconnection of Player 1 returns existing member token
    const p1Reconnect = await rosterService.checkinByEmail('player1@test.com');
    assert.equal(p1Reconnect.memberToken, p1.memberToken);
    assert.equal(p1Reconnect.teamCode, p1.teamCode);
  });

  test('4. Unknown email not in CSV throws descriptive error', async () => {
    const csv = `team_name,email_1
SquadOne,allowed@test.com`;
    rosterService.loadRosterFromCsv(csv);

    await assert.rejects(
      async () => {
        await rosterService.checkinByEmail('intruder@attacker.com');
      },
      /not registered in any team/
    );
  });

  test('5. Reset member check-in allows student to re-enter', async () => {
    const csv = `team_name,email_1
SquadOne,student@test.com`;
    rosterService.loadRosterFromCsv(csv);

    const c1 = await rosterService.checkinByEmail('student@test.com', 'Sam');
    assert.ok(c1.memberToken);

    const resetSuccess = rosterService.resetMember('student@test.com');
    assert.equal(resetSuccess, true);

    const member = rosterService.findMemberByEmail('student@test.com');
    assert.equal(member?.checkedIn, false);
  });

  test('6. Check-in succeeds even when competition window is closed', async () => {
    windowManager.closeWindow();
    assert.equal(windowManager.isOpen(), false);

    const csv = `team_name,email_1
PreSprintSquad,earlybird@test.com`;
    rosterService.loadRosterFromCsv(csv);

    // Pre-sprint check-in must succeed
    const res = await rosterService.checkinByEmail('earlybird@test.com', 'Early Bird');
    assert.ok(res.memberToken);
    assert.equal(res.teamName, 'PreSprintSquad');
  });

  test('7. Sanitizes team codes starting with SIM to avoid collisions with simulated teams', () => {
    const csv = `team_name,email_1
Simulators,sim1@test.com
SIMSquad,sim2@test.com`;
    rosterService.loadRosterFromCsv(csv);

    const t1 = rosterService.findTeamByEmail('sim1@test.com');
    assert.ok(t1);
    assert.ok(!t1.teamCode.startsWith('SIM-'));
    assert.ok(!t1.teamCode.startsWith('SIM'));

    const t2 = rosterService.findTeamByEmail('sim2@test.com');
    assert.ok(t2);
    assert.ok(!t2.teamCode.startsWith('SIM-'));
    assert.ok(!t2.teamCode.startsWith('SIM'));
  });

  test('8. RoomManager rejects SIM- and SYSTEM custom team codes to protect simulator cleanup and system audit integrity', () => {
    assert.throws(() => {
      roomManager.createTeam(
        'Colliding Team',
        2,
        'ROLL_COLLIDE_1',
        'Collide User',
        true,
        undefined,
        'SIM-MALICIOUS'
      );
    }, /reserved/);

    assert.throws(() => {
      roomManager.createTeam(
        'System Pretender',
        2,
        'ROLL_COLLIDE_2',
        'Sys User',
        true,
        undefined,
        'SYSTEM'
      );
    }, /reserved/);

    assert.throws(() => {
      roomManager.createTeam(
        'Too Long Code Team',
        2,
        'ROLL_COLLIDE_3',
        'Long Code User',
        true,
        undefined,
        'TOOLONGCODE123'
      );
    }, /between 3 and 10 characters/);
  });
});
