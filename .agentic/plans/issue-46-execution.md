# Issue #46 execution plan

Status: #30 scope implemented and verified; ready for `pr-no-mistakes`.
Branch: `feat/membership-sync-30-a9c3`, isolated from `origin/main` at `49740c1`.
Task type: mixed (`create` project access and invitations, `modify` every project/todo/history authorization path, and `test` migration and two-user flows). The invoked skill requires one task type and one scope per execution.

## Ordered scopes

1. **#30 — active team membership source** (blocking prerequisite): Clerk membership webhook verification, backfill, and server-side active membership lookup. Owns `convex/schema.ts`, `convex/http.ts`, `convex/users.ts`, `convex/lib/auth.ts`, and backend tests. Done when removed users and changed roles are reflected in Convex and assignee/profile lookups cannot expose users from another team.
2. **#46A — project authorization**: project membership data, migration/default policy for existing teams, admin grant/revoke mutations, and checks across `convex/projects.ts`, `convex/todos.ts`, `convex/activity.ts`, and `convex/lib/auth.ts`. Done when two members with different projects cannot read/write each other's project through any query, mutation, or export. Depends on scope 1.
3. **#46B — invitation and setup flow**: Clerk invitation orchestration, pending project grants, acceptance linkage, admin controls, setup guidance, and member empty states. Owns `src/app/app/**`, `src/components/**`, invitation backend modules, and docs. Done when lead invites a new/existing person to selected projects and acceptance grants exactly those projects. Depends on scope 2.
4. **#46C — end-to-end verification**: backend authorization tests, authenticated lead and two-member browser smoke test, lint/typecheck/test/build evidence, docs/rollout. Depends on scopes 1–3 and real Clerk/Convex configuration (#2, #3).

Each scope should have its own sub-plan and branch or a serial baton. This worktree contains only the first approved scope (#30).

## First sub-plan: #30

Goal: make active Clerk organization membership, role, and user identity trustworthy inside Convex.

Approach:
- Verify Clerk webhook event payload/signature with the installed SDK and current official docs before writing an endpoint.
- Add membership rows and indexes; make create/update/delete idempotent and scope by Clerk organization ID.
- Add an admin-only backfill path for existing teams.
- Make assignee validation and profile lookup use active or historically authorized membership as appropriate, with tests for cross-team IDs and removal.
- Preserve current project access until #46A introduces project membership migration.

Evidence: failing-before and passing-after backend tests; `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`; record the environment needed for webhook and browser checks.

External prerequisites: Clerk/Convex credentials for live webhook and browser testing are not present in this checkout.

## #30 implementation status

- Implemented `memberships` and sync marker tables, signed Clerk webhook handling, profile sync, backfill, active assignee checks, and scoped profile lookups.
- Backend tests cover cross-team leakage, role/removal enforcement, webhook signature verification, profile events, backfill, and a removal during backfill.
- Final checks passed: 52 tests, lint, typecheck, and build. Evidence is in ignored `.artifacts/issue-30/`. Live Clerk delivery remains for deployment verification.
