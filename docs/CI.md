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
