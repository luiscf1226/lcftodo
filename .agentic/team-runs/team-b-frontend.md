# Team B frontend run

Date: 2026-09-23. Branch: `team-b-frontend` from `origin/team-todo-clerk-convex`.

| Track | Owner | Ordered issues | Owned surface | State |
| --- | --- | --- | --- | --- |
| B1 shared | `b1_shared` | #8, #17, then TodoDialog support for #11 | Shared components except TodoItem; app error/loading/shell | Active |
| B2 week | `b2_week` | #6, relevant #34, #12, then #17/#8 wiring | WeekBoard, TodoItem, dates utility/test | Wave 1 ready for review |
| B3 history/today | `b3_history_today` | #7, #10, #11, relevant #34, then #17 wiring | History and Today pages | Active |

## Dependencies

- #18 UI controls wait for Team A's archived-project server guard.
- #13 drag and drop waits for Team A's `todos.move` mutation.
- #14 History labels and #15 range/export messages wait for Team A's query changes.
- #34 deleted-project History filter needs a team-scoped query for project options derived from activity.
- #26 search screen needs an org-scoped bounded `todos.search` query with project/date fields for result links.
- #23 recurring todo UI needs recurrence rules, occurrence/series edit scope, and an idempotent visible-week materialization API.
- Wave 3 #27 theme/PWA is assigned to B1; #28 Excel export to B3. #26, #24, #23 await backend contracts.

## Evidence and decisions

- GitHub issue bodies read on 2026-09-23 with `gh issue list`.
- `npm ci` succeeded in this worktree.
- B2 reports #6/#34/#12 plus #8/#17 board wiring complete. `npm test` passed 11/11; scoped ESLint passed. Leader repeated the test run (11/11) and reviewed the board diff.
- Independent B2 review found midnight refresh and zero-denominator bugs in B3's in-progress work. B3 is correcting both. Deleted-project History options remain dependent on Team A.
- This runtime shares one filesystem across agents. File ownership above prevents overlapping edits; the leader owns branch operations and integration.
