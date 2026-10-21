import type { SprintSession } from '../types/sse.js';

/** Active solve time; pauses and the submission transit grace never affect a tie-break. */
export function sessionElapsedSeconds(session: SprintSession, now = Date.now(), pausedAt?: number): number {
  const pauseMs = Math.max(0, session.expiresAt - session.startedAt - 120_000);
  const complete = session.completedQuestions >= 15 && session.submissions.length >= 15;
  if (session.isFinished && !complete) return 120;
  const last = session.submissions.at(-1);
  const end = complete ? (session.completedAt ?? last!.timestamp) : now;
  const currentPauseMs = !complete && pausedAt != null ? Math.max(0, now - pausedAt) : 0;
  return Math.min(120, Math.max(0, (end - session.startedAt - pauseMs - currentPauseMs) / 1000));
}
