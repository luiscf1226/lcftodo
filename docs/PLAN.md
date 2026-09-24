# LCF Todos — Team daily/weekly todos

A small, private, responsive web app for one team: sign up, create a team, create projects,
invite teammates, plan todos per day across a week, move them through statuses, and keep a
full, exportable history.

## Stack

| Layer    | Choice                                                                 |
| -------- | ---------------------------------------------------------------------- |
| Frontend | Next.js 16 (App Router) + React 19 + Tailwind CSS 4                    |
| Auth     | Clerk — sign-in/up, **Organizations = teams**, invitations, roles      |
| Backend  | Convex — database, realtime queries, mutations, auth via Clerk JWT     |
| Hosting  | Vercel (frontend) + Convex cloud (backend)                             |

## Core concepts

- **Team** — a Clerk Organization. Every piece of data is scoped to `orgId`, taken from the
  signed JWT, never from the client. Admins (`org:admin`) manage projects and members.
- **Project** — a list of work inside a team (name, color, description, archived flag).
- **Todo** — belongs to one project and one **day** (`YYYY-MM-DD`). Optional assignee.
- **Status** — `todo` → `doing` → `done`, or `not_done` ("didn't finish").
- **Activity** — append-only log of every change (created, edited, status change, moved,
  carried over, deleted). This is the history; nothing is lost when a todo is edited or deleted.

## Screens

| Route                     | What it does                                                               |
| ------------------------- | -------------------------------------------------------------------------- |
| `/`                       | Landing; sign in / sign up                                                 |
| `/sign-in`, `/sign-up`    | Clerk pages                                                                |
| `/app`                    | Onboarding if no team yet (create team / accept invite), else dashboard    |
| `/app` (dashboard)        | Today: my todos + team todos across projects, week progress                |
| `/app/projects`           | Project list with this-week progress; create project                      |
| `/app/projects/[id]`      | **Week board** Mon–Sun (stacked day list on mobile), add/edit/assign todos, change status, carry unfinished to next day, week navigation |
| `/app/history`            | Activity timeline + per-day stats, filters (project, member, status, date range), **export CSV/JSON** |
| `/app/team`               | Members, roles, invitations (Clerk `OrganizationProfile`)                  |

## Data model (Convex)

```
users     { clerkId, name, email?, imageUrl?, clerkUpdatedAt? }        by_clerkId
memberships { orgId, userId, role, active, membershipId?, updatedAt, … } by_org, by_org_user, by_user
membershipSync { orgId, ready, backfilledAt }                          by_org
tombstones { kind, clerkId }                                           by_kind_clerkId
projects  { orgId, name, description?, color, archived, createdBy }    by_org
todos     { orgId, projectId, title, notes?, date, status, assigneeId?,
            createdBy, order, completedAt?, carriedFrom? }             by_project_date, by_org_date
activity  { orgId, projectId, todoId?, actorId, action, todoTitle,
            from?, to?, date? }                                        by_org, by_project, by_todo
teamSettings { orgId, timeZone?, autoCarryOver, restrictedProjectAccess?, … }  by_org
projectMemberships { orgId, projectId, userId, grantedBy, grantedAt }  by_project_user, by_org_user, by_org
projectInvitations { orgId, invitationId, email, role, projectIds, status,
            invitedBy, expiresAt?, appliedAt?, acceptedUserId? }       by_org, by_invitation, by_org_email
```

## Authorization

`convex/lib/auth.ts#requireMember` reads the Clerk identity and the active organization
(`org_id` / `org_role` claims) on every query/mutation, and every document read or written is
checked against that `orgId`. Once a team's membership backfill has run, it also requires an
active synced `memberships` row and takes the role from it (see `README.md` → *Membership sync*).
Deleting projects is admin-only.

Project access (#46): `canReadProject` / `requireProjectAccess` / `accessibleProjectIds` in the
same file gate every project, todo, activity/history and export function. Admins see all
projects. A team without `teamSettings.restrictedProjectAccess` (the default, and every team that
existed before #46) keeps open access; once an admin restricts it, members need a
`projectMemberships` grant, and anything else is indistinguishable from "not found". Assignees must
be active members with access to the project; losing access keeps the historical assignee on
existing todos (admin reassigns) and carry-over copies are left unassigned. Invitation grants
(`projectInvitations`) are applied exactly once from the Clerk webhook. New modules that expose
project data (e.g. search) must use these helpers. See `README.md` → *Project access and invitations*.

## Milestones

1. **Foundation** — Next + Clerk + Convex wiring, proxy protection, schema, auth helper. ✅
2. **Teams** — onboarding (create/join team), team switcher, members & invites page. ✅
3. **Projects** — list, create, edit, archive, delete (admin). ✅
4. **Week board** — per-day todos, statuses, assignee, edit, delete, carry-over, week nav, responsive. ✅
5. **Dashboard** — today view, my todos, week stats. ✅
6. **History & export** — activity log, filters, per-day stats, CSV/JSON export. ✅
7. **Ship** — Clerk + Convex prod config, deploy to Vercel. ⏳ (see tickets T-01…T-04)

## Setup checklist (one-time)

See `README.md` → *Setup*.

## Tickets — what's missing

Status as of 2026-09-23: code builds, lint/typecheck clean, 9 backend tests pass.
**Not yet run end-to-end with a real Clerk app.** Priorities: **P0** = needed before the team
uses it, **P1** = should have soon, **P2** = nice to have.

### P0 — Ship blockers

| ID | Ticket | Acceptance criteria |
| -- | ------ | ------------------- |
| T-01 | **Configure Clerk** | Organizations on, "require membership" on, personal accounts off; Convex integration (or `convex` JWT template with `org_id`/`org_role`); keys in `.env.local`. |
| T-02 | **Link a real Convex project** | `npx convex dev` replaces the temporary local deployment; `CLERK_JWT_ISSUER_DOMAIN` set on dev and prod. |
| T-03 | **End-to-end smoke test** | Sign up → create team → invite 2nd user → accept → both see the same project → add/assign/status/carry → History shows it → CSV/JSON download opens in Excel/Sheets. Check on phone width. |
| T-04 | **Deploy** | Vercel project + `npx convex deploy`; prod Clerk instance + domain; env vars set; invite the team. |
| T-05 | **Bug: bad `?week=` crashes the week board** | `/app/projects/<id>?week=abc` falls back to this week instead of throwing `Invalid time value`. |
| T-06 | **Bug: History spins forever when From > To** | Invalid range shows an inline message (or swaps dates) instead of an endless skeleton. |
| T-07 | **Surface mutation errors** | Status toggle, quick add, carry, archive show a toast/inline error on failure (today they fail silently); add `error.tsx` + `loading.tsx` for `/app`. |
| T-08 | **Commit & open PR** | Initial app committed on a branch; PR to `main`. |

### P1 — Should have

| ID | Ticket | Acceptance criteria |
| -- | ------ | ------------------- |
| T-10 | **Per-person stats** | History has a "People" view: per member, todos assigned / done / didn't finish / completion % for the range; included in export. |
| T-11 | **Add todo from Today** | "New todo" on the dashboard with a project picker (defaults to last used project). |
| T-12 | **Quick-add with assignee** | Quick-add supports assigning (e.g. `@name` or a small picker) without opening the full dialog. |
| T-13 | **Drag & drop** | Drag todos between days (records a `moved` activity) and reorder within a day (uses `order`). Keyboard alternative. |
| T-14 | **Consistent History filters** | "Person" filter means the same thing in both tabs (today: assignee in Day-by-day, actor in Activity log). Add a `by_org_actor` index so filtered activity pages aren't sparse. |
| T-15 | **Bounded queries** | `todos.listForTeam` paginated or capped by range (e.g. ≤ 366 days); `activity.exportRange` warns when it hits the 5,000-row cap instead of truncating silently. |
| T-16 | **Large project delete** | Delete projects in batches (scheduled mutation) so big projects don't hit Convex transaction limits. |
| T-17 | **Menus close properly** | Project menu and Export menu close on outside click and `Esc`. |
| T-18 | **Archived projects are read-only** | Todos in archived projects can't be created/edited/status-changed (server-enforced), UI shows it. |
| T-19 | **Profile sync** ✅ (#30) | Clerk `user.updated` webhook → Convex `users` so name/avatar changes show without the user re-logging in. |
| T-20 | **E2E tests** | Playwright covering the T-03 flow using Clerk testing tokens; runs in CI. |

### P2 — Nice to have

| ID | Ticket | Acceptance criteria |
| -- | ------ | ------------------- |
| T-30 | **Auto carry-over** | Optional nightly cron per team: open todos from yesterday roll to today automatically. |
| T-31 | **Recurring todos** | Daily / weekdays / weekly templates generate todos per day. |
| T-32 | **Comments on todos** | Threaded comments in the todo dialog, logged in history. |
| T-33 | **Notifications** | Email/Slack daily digest ("your todos today") and "assigned to you". |
| T-34 | **Search** | Search todo titles/notes across projects (Convex search index). |
| T-35 | **Theme toggle & PWA** | Light/dark/system switch; installable on phones (manifest + icons). |
| T-36 | **Excel export** | `.xlsx` with sheets for todos, activity, per-person stats. |
| T-37 | **Timezone setting per team** | Team timezone used for "today", exports and cron. |
