# Leaderboard and window participation implementation plan

**Goal:** Correct ranking and restore behavior, prevent negative scores, and allow each team/member one started sprint per contest window.

**Approved rules:** An attempt is consumed at sprint launch. Reconnect/resume is allowed. A new window permits a new attempt; extending an open window does not. Ranking uses mean score, mean active member completion time excluding pauses, then team name. Only eligible finished teams receive winner medals.

**Architecture:** Keep the existing single-writer game engine. Store participation as immutable SPRINT_STARTED audit events with the window opening identity, team and member rolls. Existing disk/Redis/SQL audit persistence retains the claim even if a room is deleted. Include organizer controls in disk snapshots, restore SQL window identity, and retain session timing in the existing fields. No database migration.

**Tech stack:** TypeScript, Node test runner, Express, Prisma, React/Vite.

- [ ] Add regression tests and reproduce failures for attempt guards, window extension/reopening, snapshot restore, timing, negative scoring, and SQL hydration.
- [ ] Implement server guards at reset, ready/countdown, and launch; persist window controls and claims. Preserve independent windows and cancelled countdown behavior.
- [ ] Correct score floor, completion time, hydration of the latest sprint and penalties, and deterministic ranking.
- [ ] Fix winner eligibility/ceremony settling, decimal score display, and replay controls in the frontend; add service tests for display selection.
- [ ] Run focused regressions, compatible existing suites, both builds, lint, and whitespace checks. Document verified results and remaining sandbox limits.

Ruling: Scores stop at zero unless the user requests signed scores. Wrong answers retain their -20 point penalty but cannot put a session below zero; saved adjusted scores remain authoritative after restart.
