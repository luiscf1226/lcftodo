# Deploy runbook

Stack: **Vercel** (Next.js) + **Convex** (backend) + **Clerk** (auth, Organizations = teams).

## Current production status (2026-09-24)

Live at **https://lcftodo.vercel.app**. Every merge to `main` deploys Convex prod and then Next.js.

| Piece | State |
|---|---|
| Clerk | App `lcftodo`, **development instance** (`closing-bullfrog-7604.clerk.accounts.dev`). Organizations are on with *Membership required*. The Convex integration adds the `aud=convex` claim. The session token also carries `name`, `email`, `picture`, `org_id` and `org_role`. |
| Clerk webhook | Svix endpoint pointing at `https://rugged-seahorse-548.convex.site/clerk-webhook`. It sends `user.*`, `organizationMembership.*`, `organizationInvitation.accepted` and `.revoked`. |
| Convex | Project `lcftodo`: dev `vibrant-salmon-106`, prod `rugged-seahorse-548`. Prod env vars: `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `RESEND_API_KEY`, `NOTIFICATIONS_SIGNING_SECRET`, `APP_URL`. |
| Vercel | Production has `CONVEX_DEPLOY_KEY` (deploy-only) plus the Clerk vars. Preview has the dev `NEXT_PUBLIC_CONVEX_URL` plus the Clerk vars. |
| GitHub | Branch protection on `main` requires `ci`. The E2E job runs on every PR (secrets documented in `docs/CI.md`). A nightly encrypted prod backup runs (see `docs/BACKUPS.md`). |
| Email | Resend sends from `onboarding@resend.dev` until a domain is verified. Until then, only the Resend account owner receives mail. |

**Still open:** a production Clerk instance and a custom domain (step 6, #5). That same domain also unblocks Resend for teammates. Sentry (#35) is deferred.

## How CI/CD works

| Event | GitHub Actions (`ci`) | Vercel |
|---|---|---|
| PR opened / pushed | lint, typecheck, tests, build | Preview deploy (frontend only, uses the **dev** Convex deployment) |
| Merge to `main` | same checks | Production deploy: `npx convex deploy` (functions + schema + indexes) then `next build` |

The build entry point is `scripts/vercel-build.sh`, set as `buildCommand` in `vercel.ts`. Preview
builds never deploy Convex, so PR code can't change production data or functions.

## One-time setup (~20 min)

### 1. Clerk (dashboard.clerk.com)
Start with the **development instance** — it works on `*.vercel.app` with no custom domain. Switch
to a production instance later (step 6).

1. Create an application (email + Google is fine).
2. **Configure → Organizations**: enable. Turn on **Membership required** so every user must
   create or join a team (see #31). Users without a team get a *pending* session; `src/proxy.ts`
   sends them to `/onboarding`, which completes Clerk's `choose-organization` task.
3. **Integrations → Convex**: activate. Copy the **Frontend API URL**
   (`https://<name>.clerk.accounts.dev`) — this is `CLERK_JWT_ISSUER_DOMAIN`.
4. **Configure → Sessions → Customize session token**, add:
   ```json
   { "name": "{{user.full_name}}", "email": "{{user.primary_email_address}}", "picture": "{{user.image_url}}" }
   ```
   Without this, teammates show as "Unknown" with no avatar.
5. **API keys**: copy the publishable key (`pk_test_…`) and secret key (`sk_test_…`).

### 2. Convex (dashboard.convex.dev)
```bash
npx convex login
npx convex dev --once --configure new       # creates the project + dev deployment
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<name>.clerk.accounts.dev
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<name>.clerk.accounts.dev --prod
```
Then set up the Clerk webhook, `CLERK_WEBHOOK_SECRET`/`CLERK_SECRET_KEY`, and the membership
backfill on both deployments: see `README.md` → *Membership sync*.
Then in the dashboard: **Production deployment → Settings → Generate Production Deploy Key**.
Also note the dev deployment URL (`https://<dev-name>.convex.cloud`, in `.env.local`).

### 3. Vercel
```bash
vercel link --yes --project lcftodo
vercel git connect
```
Environment variables (`vercel env add NAME <environment>`):

| Name | Production | Preview |
|---|---|---|
| `CONVEX_DEPLOY_KEY` | prod deploy key | — |
| `NEXT_PUBLIC_CONVEX_URL` | — (set by `convex deploy`) | dev deployment URL |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_test_…` | `pk_test_…` |
| `CLERK_SECRET_KEY` | `sk_test_…` | `sk_test_…` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` | `/sign-up` |

### 4. First deploy
```bash
vercel --prod
```
After that, every merge to `main` deploys automatically.

### 5. Verify (#31, #4) — last run: [2026-09-24 smoke test](test-plans/2026-09-24-prod-smoke.md)
1. Open the production URL, sign up, create a team.
2. Invite a second account; both see the same projects and todos.
3. A third account in another team sees none of it.
4. Member can't archive/delete; admin can.

### 6. Later: production Clerk instance
Needs a domain you own. Create the production instance in Clerk, repeat steps 1.2–1.5 there, add
the DNS records Clerk shows, swap the Vercel **Production** keys to `pk_live_…`/`sk_live_…`, and
set `CLERK_JWT_ISSUER_DOMAIN` on the **prod** Convex deployment to the new Frontend API URL. Redo
the *Membership sync* webhook and secrets for the production instance.

## Branch protection (#32)
After CI has run once on `main`, run the command in `docs/CI.md`.

## Rollback
- Frontend: Vercel dashboard → Deployments → promote the previous deployment.
- Backend: revert the commit and merge; `convex deploy` runs again. Schema changes must stay
  backward compatible (optional fields, additive indexes).
