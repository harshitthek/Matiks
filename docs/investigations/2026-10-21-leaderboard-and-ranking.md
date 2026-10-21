# Leaderboard, ranking, and participation investigation

## Confirmed defects and fixes

| Defect | Reproduction | Fix |
| --- | --- | --- |
| Repeat attempts overwrite a result | Reset a finished team while the same window is open; it becomes ready for another sprint and its score becomes zero. | Claim each launched sprint in an immutable audit record tied to the window, team, and participating rolls. Guard reset, readiness/countdown, and launch. A new window permits another attempt; extending an open window does not. |
| Incorrect time tie-break | Members finish at 10s and 30s while the room is finalized at 60s; reported average was 60s instead of 20s. | Compute the mean of member completion times using server timestamps. Exclude pauses and transit grace; incomplete timed-out runs count as 120 seconds. Finished members are not affected by later pauses. |
| Negative scores | A wrong first answer made the session score -20. | Keep the wrong-answer penalty but floor the accumulated session score at zero, consistently with organizer deductions. Normalize legacy negative snapshots at restore. |
| Penalties disappear on SQL recovery | Persist score 800 after a -200 adjustment, with submission points totaling 1000; hydration restored 1000. | Stored adjusted scores are authoritative. Never take the larger of stored score and submission total. |
| Progress fabricated on restart | A finished session with one answer restored its member as 15/15. | Restore actual submission counts and retain the latest active-session reference, including finished runs. |
| Old runs corrupt restored timing | SQL contains multiple historical sprints for one team. Hydration used the earliest start and combined historical deadlines. | Rebuild the room from its latest sprint while retaining older sessions as history. |
| Low scorer can leave to increase team average | After a 500/0 team result, the zero-scoring member leaves; the average rose from 250 to 500. | Retain the scored roster slot and mark the member disconnected. Explicit organizer excusal remains the audited way to change the divisor. |
| Ineligible podium entries | With fewer than three eligible teams, waiting/disqualified teams filled medal positions. | Filter podium eligibility, label disqualifications, and add disqualification fields to CSV exports. Display fractional averages instead of rounding distinct scores to the same integer. |
| Ceremony announces before scores settle | Close a window with live sprints or delayed public standings. | Release current standings before the closed event; require a closed window, settled sprints, and eligible finished teams before ceremony. React to status changes even when the standings count is unchanged. |
| Window never closes without traffic | Let its deadline pass without requesting an API endpoint. | Schedule deadline closure, including restored windows. |
| Attempt claims lost when no teams remain | Dissolve all rooms, then recover using SQL. Hydration returned before reading audits/window. | Restore controls and audit-only states even when the team list is empty. |
| Unrelated SQL activity changes window/score/pause recovery | A window change, penalty, or pause reaches disk but its SQL write fails; another team's later SQL write makes the database globally newer. | Reconcile window, room, and session revisions independently; union audits from both sources and rebuild member score/progress from selected sessions. |
| Delayed answer retries undo penalties | Retry an older submission after a newer adjusted score has been saved. | Store the answer but conditionally update the parent score only when its revision is not newer. Preserve monotonic revisions for same-millisecond operations. |

## Persistence and compatibility

- Uses existing SQL `updatedAt` columns and the existing audit table. No database migration or production reset is required.
- Disk snapshots now include organizer controls. Redis uses its existing control metadata and audit stream.
- Team snapshots add `contestWindow.opensAt` and `contestWindow.hasParticipated`; existing clients can ignore these additive fields.
- A cancelled countdown does not consume an attempt. Reconnect and resume remain supported. Room recreation and changing teams do not erase a participating member's claim in the same window.
- Existing write-behind persistence remains; these changes do not introduce synchronous network writes into answer handling.

## Verification

- 19 server regression cases in `server/tests/leaderboardWindow.test.ts`, including mocked SQL and mixed-source boot recovery, were observed failing before their fixes and passing afterward.
- Three frontend presentation cases cover podium eligibility, ceremony settling, and fractional/nonnegative score display.
- The existing frontend test suite, server/client builds, and compatible backend persistence/math/admin/roster/outbox suites are checked alongside the new tests.
- Socket-dependent HTTP/live-network tests cannot run in this session because the sandbox denies listening sockets. They must still pass in CI or a normal local environment before deployment. Tests are not weakened to bypass that restriction.
- Frontend lint retains the two pre-existing authentication synchronization warnings. Vite retains its existing bundle-size warning.

See [the implementation plan](../superpowers/plans/2026-10-21-leaderboard-window-attempts.md) and ADR-23 in [MEMORY.md](../../MEMORY.md).
