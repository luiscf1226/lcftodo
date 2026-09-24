# LCF Todos

Team todo app: sign up, create a team, create projects, invite teammates, plan todos per
day across the week, track them as **To do / Doing / Done / Didn't finish**, and keep a full
history you can export to CSV or JSON.

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
Subscribe to `organizationMembership.created`, `.updated`, `.deleted` and
`user.created`, `.updated`, `.deleted`. In the **Convex deployment environment**
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

### 3. Run

```bash
npm run dev               # Next.js + Convex together → http://localhost:3000
npm test                  # backend tests (convex-test)
```

## How it works

- Every Convex function reads the active team from the signed Clerk token
  (`convex/lib/auth.ts`) — teams can never see each other's data.
- `activity` is an append-only log; deleting a todo or project keeps its history.
- *Carry* on a day moves unfinished todos to the next day and marks the originals
  *Didn't finish*, so slippage stays visible in History.
- Invite teammates from **Team** (Clerk's organization profile: members, invitations, roles).
  Only admins can delete projects.

## Deploy

Vercel + Convex + Clerk, deployed from `main` on every merge. One-time account setup,
env vars and rollback: see [`docs/DEPLOY.md`](docs/DEPLOY.md).
