# CI

`.github/workflows/ci.yml` runs on every pull request and on every push to `main`.
It has a single job, `ci`. That job name is the required status check.

| Step      | Command             | What it does                                                        |
| --------- | ------------------- | ------------------------------------------------------------------- |
| Install   | `npm ci`            | Clean install from `package-lock.json` (npm cache via setup-node)    |
| Lint      | `npm run lint`      | ESLint                                                              |
| Typecheck | `npm run typecheck` | `next typegen`, then `tsc --noEmit` for the app and for `convex/`   |
| Test      | `npm test`          | Vitest (includes the `convex-test` backend tests)                   |
| Build     | `npm run build`     | `next build` with dummy public env vars                             |

Notes:

- `next typegen` must run before `tsc`. It generates the global `PageProps` / `LayoutProps`
  route types in `.next/types` and `next-env.d.ts` (both gitignored).
- `convex/tsconfig.json` includes `vite/client` types so `import.meta.glob` (used by
  `convex-test` in `convex/*.test.ts`) type-checks.
- `convex/_generated` is committed, so CI needs no Convex login or deployment.
- The build uses placeholder values for `NEXT_PUBLIC_CONVEX_URL` and
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. No secrets are needed. The build downloads
  Google Fonts (`next/font/google`), so it needs network access. GitHub-hosted
  runners have it.
- A new push to the same PR cancels the run that is still in progress.

## Run it locally

```bash
npm ci
npm run lint && npm run typecheck && npm test
NEXT_PUBLIC_CONVEX_URL=https://ci-placeholder-123.convex.cloud \
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk \
npm run build
```

Turbopack refuses a `node_modules` that is a symlink pointing outside the project.
Use a real install.

## E2E (Playwright)

`.github/workflows/e2e.yml` runs on every pull request, on pushes to `main`, and on demand
(`workflow_dispatch`). It has one job, `e2e`. It is **not** a required status check. Branch
protection requires only `ci`, and `e2e` must stay out of it (see below).

The suite (`e2e/core-flow.spec.ts`) walks the core flow in Chromium: sign in, create a team,
create a project, add todos, change status, carry over, check History, and download the todos CSV.
It uses the **Clerk dev instance** and the **Convex DEV deployment**. It never touches Convex prod.

How it works:

- `e2e/global-setup.ts` calls `clerkSetup()` from `@clerk/testing` to get a testing token, which
  gets past Clerk's bot protection. It then uses the Clerk Backend API to create a fresh user,
  `lcf-e2e-<runId>+clerk_test@example.com`. `+clerk_test` addresses never get real email.
- The test signs in with `clerk.signIn({ page, emailAddress })`, which uses a sign-in ticket, so
  no password or OTP is needed. The instance requires an organization, so Clerk shows its
  "Setup your organization" session task. The test creates a unique team there.
- Every name includes the run id, so parallel or repeated runs never collide.
- `e2e/global-teardown.ts` deletes the run's Clerk user and every team it belongs to. Setup also
  sweeps `lcf-e2e-*` users older than 2 hours that crashed runs left behind. Convex DEV rows are
  left in place. They belong to an organization that no longer exists.
- The first-run tutorial is closed automatically by a Playwright locator handler.
- In CI the app is built (`npm run build`) and served with `next start`. Locally the config runs
  `next dev`. Both use port 3100 (`E2E_PORT`).

### Required repository secrets

| Secret                              | Value                                                    | Required |
| ----------------------------------- | -------------------------------------------------------- | -------- |
| `CLERK_SECRET_KEY`                  | Clerk **dev** instance secret key (`sk_test_…`)          | yes      |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk dev instance publishable key (`pk_test_…`)         | yes      |
| `NEXT_PUBLIC_CONVEX_URL`            | Convex **DEV** deployment URL (`https://<dev>.convex.cloud`) | yes  |
| `CONVEX_DEV_DEPLOY_KEY`             | Convex **development** deploy key (`dev:…`)              | optional |

The suite refuses to run with a Clerk secret key that does not start with `sk_test_`.

Set them from `.env.local` without printing the values:

```bash
for n in CLERK_SECRET_KEY NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY NEXT_PUBLIC_CONVEX_URL; do
  grep "^$n=" .env.local | cut -d= -f2- | tr -d '\n' | gh secret set "$n"
done
```

If the three required secrets are missing, for example on a PR from a fork, which gets no
secrets, the job skips its steps with a notice and still passes.

**Convex functions on DEV.** The tests call whatever functions are deployed to the DEV
deployment. If DEV is behind `main`, tests fail with Convex `Server Error`s (for example a missing
`users:onboardingStatus`). You have two options:

- Push manually from an up-to-date checkout: `npx convex dev --once`.
- Set `CONVEX_DEV_DEPLOY_KEY`. The job then runs `npx convex deploy` with that dev key before the
  build, which pushes the branch's functions to DEV. The job rejects any key that does not start
  with `dev:`. Keep in mind that DEV is shared, so a PR run overwrites whatever functions are
  there. To mint a key: `npx convex deployment token create e2e-ci --deployment <dev-deployment-name> | gh secret set CONVEX_DEV_DEPLOY_KEY`.

### Run it locally

```bash
npm ci
npx playwright install chromium
# .env.local must hold the Clerk dev keys and the Convex DEV URL (NEXT_PUBLIC_CONVEX_URL)
npm run test:e2e                 # starts `next dev` on :3100, or reuses one already running there
npx playwright test --ui         # interactive
E2E_KEEP_DATA=1 npm run test:e2e # keep the user and team for debugging (setup sweeps them after 2h)
E2E_SERVER_LOGS=1 npm run test:e2e  # show Next.js server stderr
E2E_BASE_URL=http://localhost:3000 npm run test:e2e  # use a server you started yourself
```

Vitest ignores `e2e/**`, so `npm test` never picks up Playwright specs.

## Branch protection (manual, one-time)

Not applied automatically. Enable it **after** the workflow has run at least once on
`main`, so the `ci` check exists, and after the MVP PR has merged. Needs repo admin.

```bash
gh api -X PUT repos/luiscf1226/lcftodo/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "checks": [{ "context": "ci", "app_id": 15368 }]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
EOF
```

- Only `ci` is required. Do not add `e2e`. It depends on external dev services and is skipped
  on fork PRs.
- `checks[].context: "ci"` is the job name. `app_id: 15368` is GitHub Actions, which pins
  the check to Actions so no other app can satisfy it.
- `required_pull_request_reviews` makes every change go through a PR, so nobody can push
  to `main` directly. The approval count is 0 so a solo maintainer can still merge their
  own PRs. Raise it once the team has more reviewers.
- `enforce_admins: true` applies the rules to admins too.
- `strict: true` means a branch must be up to date with `main` before it can merge.

Verify:

```bash
gh api repos/luiscf1226/lcftodo/branches/main/protection \
  --jq '{checks: .required_status_checks.checks, admins: .enforce_admins.enabled, force: .allow_force_pushes.enabled, reviews: .required_pull_request_reviews.required_approving_review_count}'
```

Undo: `gh api -X DELETE repos/luiscf1226/lcftodo/branches/main/protection`
