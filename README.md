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

1. `npx convex deploy` (set `CLERK_JWT_ISSUER_DOMAIN` on the prod deployment to your
   **production** Clerk Frontend API URL).
2. Import the repo in Vercel. Build command: `npx convex deploy --cmd 'npm run build'`.
   Env vars: `CONVEX_DEPLOY_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`.
