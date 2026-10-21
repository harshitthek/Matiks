import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectPodium, canStartCeremony, formatLeaderboardScore } from '../src/services/leaderboardPresentation.js';

const entry = (teamCode, rank, status = 'FINISHED', extra = {}) => ({ teamCode, rank, status, activeMembersCount: 1, ...extra });
test('podium excludes disqualified, waiting, and zero-active-member teams', () => {
  const rows = [entry('DQ', 1, 'FINISHED', { isDisqualified: true }), entry('WAIT', 2, 'WAITING'), entry('EMPTY', 3, 'FINISHED', { activeMembersCount: 0 }), entry('WIN', 4), entry('LIVE', 5, 'IN_SPRINT')];
  assert.deepEqual(selectPodium(rows).map(e => e.teamCode), ['WIN', 'LIVE']);
  assert.deepEqual(selectPodium(rows, true).map(e => e.teamCode), ['WIN']);
});
test('ceremony waits for closed window and settled sprints, including updates without a length change', () => {
  const closed = { isOpen: false, opensAt: 100 };
  assert.equal(canStartCeremony([entry('DONE', 1)], { ...closed, isOpen: true }), false);
  assert.equal(canStartCeremony([entry('LIVE', 1, 'IN_SPRINT')], closed), false);
  assert.equal(canStartCeremony([entry('LIVE', 1)], closed), true);
  assert.equal(canStartCeremony([entry('WAIT', 1, 'WAITING')], closed), false);
  assert.equal(canStartCeremony([entry('DQ', 1, 'FINISHED', { isDisqualified: true })], closed), false);
  assert.equal(canStartCeremony([entry('DONE', 1)], { isOpen: false, opensAt: 0 }), false);
});
test('score display retains fractional differences and never displays a negative score', () => {
  assert.notEqual(formatLeaderboardScore(100.25), formatLeaderboardScore(100.75));
  assert.equal(formatLeaderboardScore(-20), formatLeaderboardScore(0));
});
