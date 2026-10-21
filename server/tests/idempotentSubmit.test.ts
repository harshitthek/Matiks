/**
 * MATIKS HACKATHON ENGINE — IDEMPOTENT ANSWER SUBMISSION TESTS (idempotentSubmit.test.ts)
 *
 * A phone on a weak connection can lose the reply to an answer that did count. Sending the same answer again must give back the recorded
 * result, count nothing twice, and leave the player able to carry on. Checked at the room manager and through the HTTP endpoint.
 */

import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createApp } from '../src/app.js';
import { roomManager } from '../src/services/roomManager.js';
import { leaderboardManager } from '../src/services/leaderboardManager.js';
import { windowManager } from '../src/services/windowManager.js';
import { sseHub } from '../src/services/sseHub.js';
import { metrics } from '../src/services/metrics.js';

/** A one-player team, already past the 3-2-1 and in its sprint. */
async function startSoloSprint(rollNumber: string) {
  const { teamCode, memberToken } = roomManager.createTeam('Retry Squad', 1, rollNumber, 'Solo');
  roomManager.toggleReady(teamCode, rollNumber, true, memberToken);
  await new Promise((resolve) => setTimeout(resolve, 3400));
  const room = roomManager.getRoom(teamCode)!;
  assert.equal(room.status, 'IN_SPRINT');
  const member = room.members.get(rollNumber)!;
  const session = roomManager.getSession(member.activeSessionId!)!;
  return { teamCode, token: memberToken, session };
}

describe('Matiks Hackathon — Idempotent Answer Submission', () => {
  beforeEach(() => {
    roomManager.clear();
    leaderboardManager.clear();
    windowManager.openWindow(120);
    metrics.sprintSubmissionReplaysTotal.reset();
  });

  after(() => {
    roomManager.clear();
    leaderboardManager.clear();
  });

  test('1. Sending the same answer again returns the recorded result and counts nothing twice', async () => {
    const { session, token, teamCode } = await startSoloSprint('RT21001');

    const first = roomManager.submitAnswer(session.sessionId, 0, session.questions[0].answer, 1200, Date.now(), token);
    assert.equal(first.isCorrect, true);
    assert.equal('replayed' in first, false, 'a first submission must look exactly as it did before');

    const scoreAfterFirst = session.currentScore;
    const teamAverage = leaderboardManager.getLeaderboard().find((e) => e.teamCode === teamCode)!.teamAverageScore;
    let broadcasts = 0;
    const realBroadcast = sseHub.broadcast.bind(sseHub);
    sseHub.broadcast = ((...args: Parameters<typeof sseHub.broadcast>) => {
      broadcasts++;
      return realBroadcast(...args);
    }) as typeof sseHub.broadcast;

    try {
      const again = roomManager.submitAnswer(session.sessionId, 0, session.questions[0].answer, 4000, Date.now(), token) as typeof first & {
        replayed?: boolean;
        answerMismatch?: boolean;
      };

      assert.equal(again.replayed, true);
      assert.equal(again.answerMismatch, false);
      assert.equal(again.isCorrect, first.isCorrect);
      assert.equal(again.pointsAwarded, first.pointsAwarded);
      assert.equal(again.currentScore, first.currentScore);
      assert.equal(again.consecutiveStreak, first.consecutiveStreak);
      assert.equal(again.completedQuestions, 1);
      assert.equal(again.isFinished, false);
    } finally {
      sseHub.broadcast = realBroadcast;
    }

    assert.equal(session.currentScore, scoreAfterFirst, 'the score must not move');
    assert.equal(session.submissions.length, 1, 'no second submission may be recorded');
    assert.equal(session.completedQuestions, 1);
    assert.equal(broadcasts, 0, 'a replay must not push events to teammates, the projector or the organizers');
    assert.equal(leaderboardManager.getLeaderboard().find((e) => e.teamCode === teamCode)!.teamAverageScore, teamAverage);
    assert.equal(metrics.sprintSubmissionReplaysTotal.get(), 1);
  });

  test('2. A different answer for a question already answered gets the recorded result, flagged, and changes nothing', async () => {
    const { session, token } = await startSoloSprint('RT21002');
    const q0 = session.questions[0];

    const first = roomManager.submitAnswer(session.sessionId, 0, q0.answer, 1500, Date.now(), token);
    assert.equal(first.isCorrect, true);

    const wrongSecondTime = roomManager.submitAnswer(session.sessionId, 0, q0.answer + 1, 1500, Date.now(), token) as typeof first & {
      replayed?: boolean;
      answerMismatch?: boolean;
    };
    assert.equal(wrongSecondTime.replayed, true);
    assert.equal(wrongSecondTime.answerMismatch, true);
    assert.equal(wrongSecondTime.isCorrect, true, 'the first answer stands');
    assert.equal(wrongSecondTime.currentScore, first.currentScore);
    assert.equal(session.submissions.length, 1);
  });

  test('3. The player is never left stuck: after a lost reply, the next question still goes through', async () => {
    const { session, token } = await startSoloSprint('RT21003');
    roomManager.submitAnswer(session.sessionId, 0, session.questions[0].answer, 1300, Date.now(), token);

    // The reply was lost, so the client sends question 0 again and gets the recorded result...
    const replay = roomManager.submitAnswer(session.sessionId, 0, session.questions[0].answer, 1300, Date.now(), token) as { replayed?: boolean };
    assert.equal(replay.replayed, true);

    // ...and then carries on with question 1, which is accepted normally
    await new Promise((resolve) => setTimeout(resolve, 450));
    const next = roomManager.submitAnswer(session.sessionId, 1, session.questions[1].answer, 600, Date.now(), token);
    assert.equal(next.completedQuestions, 2);
    assert.equal(session.submissions.length, 2);
  });

  test('4. The checks that protect the contest still hold: a wrong token, a skipped question and an unknown session are refused', async () => {
    const { session, token } = await startSoloSprint('RT21004');
    roomManager.submitAnswer(session.sessionId, 0, session.questions[0].answer, 1300, Date.now(), token);

    // A replay still needs the player's own token
    assert.throws(
      () => roomManager.submitAnswer(session.sessionId, 0, session.questions[0].answer, 1300, Date.now(), 'not-the-token'),
      /Unauthorized/
    );
    // Skipping ahead is still refused (only already-answered questions are replayed)
    assert.throws(() => roomManager.submitAnswer(session.sessionId, 5, 1, 1300, Date.now(), token), /Invalid question index/);
    // A negative or fractional index is never treated as a replay
    assert.throws(() => roomManager.submitAnswer(session.sessionId, -1, 1, 1300, Date.now(), token), /Invalid question index/);
    assert.throws(() => roomManager.submitAnswer(session.sessionId, 0.5, 1, 1300, Date.now(), token), /Invalid question index/);
    assert.throws(() => roomManager.submitAnswer('no-such-session', 0, 1, 1300, Date.now(), token), /not found/);
  });

  test('5. Through HTTP: the same request twice gives two 200s, the second marked as a replay', async () => {
    const { session, token } = await startSoloSprint('RT21005');
    const app = createApp();
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const body = JSON.stringify({
        sessionId: session.sessionId,
        questionIndex: 0,
        answer: session.questions[0].answer,
        clientDeltaMs: 1250,
        clientTimestamp: Date.now()
      });
      const post = () =>
        fetch(`${baseUrl}/api/sprint/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-member-token': token },
          body
        });

      const a = await post();
      const aData = await a.json();
      assert.equal(a.status, 200);
      assert.equal(aData.success, true);
      assert.equal(aData.replayed, undefined);

      const b = await post();
      const bData = await b.json();
      assert.equal(b.status, 200);
      assert.equal(bData.replayed, true);
      assert.equal(bData.currentScore, aData.currentScore);
      assert.equal(bData.pointsAwarded, aData.pointsAwarded);
      assert.equal(session.submissions.length, 1);
    } finally {
      await new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
    }
  });

  test('6. After the sprint is over, an answer already given can still be asked for, but nothing new is accepted', async () => {
    const { session, token } = await startSoloSprint('RT21006');

    // Answer all 15 questions, waiting out the anti-cheat floor between each
    for (let i = 0; i < session.questions.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 230));
      roomManager.submitAnswer(session.sessionId, i, session.questions[i].answer, 400, Date.now(), token);
    }
    assert.equal(session.isFinished, true);
    const finalScore = session.currentScore;

    const replayLast = roomManager.submitAnswer(session.sessionId, 14, session.questions[14].answer, 400, Date.now(), token) as {
      replayed?: boolean;
      isFinished: boolean;
    };
    assert.equal(replayLast.replayed, true);
    assert.equal(replayLast.isFinished, true, 'the last question\'s replay tells the client the sprint is over');

    const replayFirst = roomManager.submitAnswer(session.sessionId, 0, session.questions[0].answer, 400, Date.now(), token) as {
      replayed?: boolean;
      isFinished: boolean;
    };
    assert.equal(replayFirst.replayed, true);
    assert.equal(replayFirst.isFinished, false);

    assert.throws(() => roomManager.submitAnswer(session.sessionId, 15, 1, 400, Date.now(), token), /already finished/);
    assert.equal(session.currentScore, finalScore);
    assert.equal(session.submissions.length, 15);
  });
});
