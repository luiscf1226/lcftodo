# LCF Todos

Team todo app: sign up, create a team, create projects, invite teammates, plan todos per
day across the week, track them as **Por hacer / En progreso / Hecho / Sin terminar**, and keep a full
history (day by day, per person, activity log) you can export to CSV, Excel (.xlsx) or JSON.
Find any todo by title with **⌘K / Ctrl+K**.

The interface, Clerk sign-in screens and notifications are in Spanish. Pick a light
(**Claro**), dark (**Oscuro**) or **Sistema** theme from the **Tema** control.

Stack: **Next.js 16** · **Clerk** (auth + Organizations = teams) · **Convex** (backend) · Tailwind 4.
Product plan: [`docs/PLAN.md`](docs/PLAN.md).

## Setup

### 1. Clerk

1. In the [Clerk dashboard](https://dashboard.clerk.com) open your application.
2. **Organizations → Settings**: enable Organizations. Recommended: turn on
   *Require organization membership* so new sign-ups are asked to create/join a team,
   and turn off *personal accounts*.
3. **Integrations → Convex**: activate the integration and copy the **Frontend API URL**
   (e.g. `https://your-app.clerk.accounts.dev`).
   *Alternative:* **JWT templates → New → Convex** (name must be `convex`) and add these claims:
   ```json
   { "org_id": "{{org.id}}", "org_role": "{{org.role}}" }
   ```
4. Copy your API keys into `.env.local` (see `.env.example`).

### 2. Convex

```bash
npm install
npx convex dev            # log in, create a project; writes CONVEX_* to .env.local
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://your-app.clerk.accounts.dev
```

### Membership sync (required before assigning teammates)

In Clerk, add a webhook endpoint at `https://<deployment>.convex.site/clerk-webhook`.
Subscribe to `organizationMembership.created`, `.updated`, `.deleted`,
`user.created`, `.updated`, `.deleted`, and `organizationInvitation.accepted`,
`organizationInvitation.revoked` (project invitations, see below). In the **Convex deployment environment**
(dev and prod separately), set `CLERK_WEBHOOK_SECRET` to that endpoint's signing
secret and `CLERK_SECRET_KEY` to the matching Clerk instance's secret key. Keep
both values out of the repository. The `.site` webhook URL differs from the
`.cloud` URL used by the browser.

For each existing team, run the one-time `memberships:backfill` action as a team
admin. The action reads all Clerk organization membership pages twice and
reconciles Convex before enabling membership-based access checks. If the member
list changes between reads, it fails without enabling them; rerun it. A Convex operator can run:

```bash
npx convex run memberships:backfill '{}' --identity '{"subject":"user_...","org_id":"org_...","org_role":"org:admin"}'
```

Use `--prod` for the production deployment. New teams should also run it once
after setup. Until then, the app uses the signed organization claim for team
access, while assignee validation requires a synced membership row. If Clerk has
not delivered its webhook yet, run the backfill before assigning work.

After a successful backfill, Convex checks the synced active membership and role
on every team query and mutation. A removed member's stale session token then
stops granting access. Webhook delivery is asynchronous, so revocation takes
effect when Clerk delivers the signed membership event. Monitor failed webhook
attempts in Clerk and retry them after resolving configuration issues.

### Project access and invitations

Admins manage access from **Equipo** (Team):

- **Open vs. restricted access.** Every team starts (and every team that existed before
  this feature stays) on *open* access: every member sees every project, exactly as before.
  An admin turns on *Restringir acceso*; from then on non-admin members only see projects
  they're granted — in Proyectos, Hoy, boards, Historial, exports, and every Convex call
  (direct ids behave as "not found"). Admins always see everything. When restricting, the
  admin can seed grants from existing work (projects each member created or has todos in
  during the last year) so nobody silently loses their current work. Turning restriction off
  restores open access; grants are kept for next time.
- **Invite to selected projects.** The admin enters an email, a role and projects. Convex
  re-checks the admin role and every project id, then creates a Clerk organization
  invitation with `CLERK_SECRET_KEY` (the invitee creates and owns their credentials).
  The project grants are stored with Clerk's invitation id and applied exactly once when
  Clerk sends `organizationInvitation.accepted` (fallback: `organizationMembership.created`
  for the same email). Inviting someone already on the team grants the projects directly;
  inviting a pending email again adds projects to that invitation. Admins can resend
  (revokes the old Clerk invitation and sends a new one), revoke, and refresh statuses
  (Clerk does not send a webhook for expiry).
- **Grant/revoke and removal.** Admins toggle each member's projects and can remove people
  from the team (Clerk membership + every grant, effective immediately).
- **Assignees** must be active members with access to the todo's project. When access is
  removed, existing todos keep the historical assignee (history stays accurate) but leave
  that person's lists, since they can no longer read the project; carry-over leaves the new
  copy (and new recurring occurrences) unassigned, and an admin reassigns from the board.

Optional Convex env var: `APP_URL` (e.g. `https://todos.example.com`). When set,
invitation emails link to `${APP_URL}/sign-up`; otherwise Clerk's hosted pages are used.

New admins see a setup checklist on **Hoy** (Today) (team → first project → invite → assign);
the general product tour (**Tutorial**) is unchanged.

### 3. Run

```bash
npm run dev               # Next.js + Convex together → http://localhost:3000
npm test                  # backend tests (convex-test)
```

## How it works

- Every Convex function reads the active team from the signed Clerk token
  (`convex/lib/auth.ts`) — teams can never see each other's data. After the
  membership backfill, it also requires an active synced membership.
- `activity` is an append-only log; deleting a todo or project keeps its history.
- A todo can be created **without a project** (`todos.projectId` is optional): it is personal —
  only its creator can read or change it (`canAccessTodo` in `convex/lib/auth.ts`) — and lives on the
  **Bandeja** (`/app/inbox`), a week calendar with the same create and drag & drop as a project board.
  Opening it and choosing a project moves it there (`todos.update` with `projectId`; comments follow it,
  it can then be assigned, and a `project_changed` entry lands in that project's history). Personal
  todos have no assignee, comments, repeat, activity entries or carry-over, and a todo cannot go back
  to "no project".
- Search (`convex/search.ts`) uses the `todos.search_title` search index, filtered by
  the caller's team, and links each result to its project week.
- *Pasar* on a day moves unfinished todos to the next day and marks the originals
  *Sin terminar*, so slippage stays visible in History.
- Project reads and writes go through `canReadProject` / `requireProjectAccess`
  (`convex/lib/auth.ts`), which apply the open/restricted policy above.
- Invite teammates to selected projects from **Equipo**; Clerk's organization profile below
  it still handles roles and team settings. Only admins can delete projects.

## Deploy

Vercel + Convex + Clerk, deployed from `main` on every merge. One-time account setup,
env vars and rollback: see [`docs/DEPLOY.md`](docs/DEPLOY.md).

Nightly encrypted prod backups, the restore runbook and the admin JSON export: see
[`docs/BACKUPS.md`](docs/BACKUPS.md).
