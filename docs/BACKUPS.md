# Backups and restore (#36)

History is the product, so production data is snapshotted every night and a restore has been
drilled on the dev deployment. We are on the Convex **free plan**, so there are no dashboard
scheduled backups. Instead a GitHub Actions workflow takes the snapshot with the Convex CLI.

| What | Where | Retention |
| --- | --- | --- |
| Nightly prod snapshot (`npx convex export`), gpg-encrypted | GitHub Actions artifact from [`.github/workflows/backup.yml`](../.github/workflows/backup.yml) | 30 days (the artifact's `retention-days`) |
| Manual snapshot | `npx convex export --prod --path …` from a laptop, or the Convex dashboard (Settings → Snapshots / Backups) | wherever you keep it |
| Team-level JSON export (admins) | App → **Team** → *Full team export* | downloaded by the admin |

The nightly workflow runs at 07:17 UTC and can also be run by hand (Actions → **Backup** → *Run
workflow*). It is not a required status check: a failed or skipped backup never blocks a PR. If
a secret is missing it skips with a notice and a job summary saying which secret is missing.

## Operator setup (one-time)

The Vercel `CONVEX_DEPLOY_KEY` only has `deployment:deploy`. Don't widen it. Create a separate
key that can only take and download backups.

1. **Convex dashboard** → project → **Production** deployment → **Settings** → **Deploy Keys** →
   *Generate a deploy key*.
   - Name: `github-backup`.
   - Permissions: **`deployment:backups:create`**, **`deployment:backups:view`** and
     **`deployment:backups:download`** (the *Backups* group, see
     [role actions](https://docs.convex.dev/team-management/role-actions#backups)). `npx convex
     export` asks the deployment to create a snapshot export, watches its status, then downloads
     the zip. If the first run fails with a permission error, also grant
     **`deployment:data:view`**. These are all read-only for your data. Do **not** grant
     `deployment:backups:import`, `deployment:data:write` or `deployment:deploy`.
2. **GitHub** → luiscf1226/lcftodo → Settings → Secrets and variables → Actions → *New repository
   secret*:
   - `CONVEX_BACKUP_DEPLOY_KEY`: the key from step 1 (it starts with `prod:`).
   - `BACKUP_ENCRYPTION_PASSPHRASE`: a long random passphrase, for example `openssl rand -base64 32`.
     **Store it in your password manager as well.** Without it the artifacts cannot be decrypted.
3. Actions → **Backup** → *Run workflow*. Check that the run is green, the summary lists document
   counts per table, and an artifact named `convex-prod-<timestamp>` is attached.

Why encrypt: this repository is **public**, and any signed-in GitHub user can download the
artifacts of a public repository. The workflow encrypts the snapshot (gpg, AES-256) before upload
and deletes the plaintext zip. It never uploads an unencrypted snapshot.

To rotate: generate a new key or passphrase, update the secret, then delete the old deploy key in
the dashboard. Old artifacts still need the old passphrase.

## Restore runbook

> **Never import into production to "try something".** Rehearse on a dev deployment first. Every
> command below takes `--deployment <name>` (or `--prod`). With neither, the CLI targets the dev
> deployment in `.env.local` (`CONVEX_DEPLOYMENT`). Read the CLI's change summary before confirming.

### 1. Get the snapshot

```sh
# Pick a run (or use the Actions UI → run → Artifacts → download).
gh run list --workflow backup.yml --limit 20
gh run download <run-id> --dir restore/          # → restore/convex-prod-<ts>/convex-prod-<ts>.zip.gpg

gpg --batch --pinentry-mode loopback --passphrase-fd 0 \
  --output restore/snapshot.zip --decrypt restore/convex-prod-*/convex-prod-*.zip.gpg \
  <<< "$BACKUP_ENCRYPTION_PASSPHRASE"

unzip -l restore/snapshot.zip                   # one <table>/documents.jsonl per table
```

The zip holds `<table>/documents.jsonl` (one document per line, with the original `_id` and
`_creationTime`) and `<table>/generated_schema.jsonl` for every table. `_tables/` is metadata.
The drill below confirmed that an import keeps `_id` and `_creationTime`, so references such as
`todos.projectId` and `activity.todoId` still resolve after a restore.

### 2. Choose the import mode

| Flag | Effect | Use when |
| --- | --- | --- |
| `--replace` | Every table **in the import** is emptied and refilled. Tables not in the file are untouched. | Normal restore. Import a trimmed zip to limit what gets replaced. |
| `--append` | Adds documents and keeps existing ones. Fails on `_id` collisions. | Putting back rows that were deleted, while the rest of the table has changed since. |
| `--replace-all` | The deployment ends up exactly as in the zip. Tables missing from the zip are **cleared or deleted**. | Full disaster recovery only. |
| `-y` | Skips the confirmation prompt shown when documents will be deleted. | Scripts. Leave it off by hand so you read the summary. |

Caveats:
- **Writes made after the snapshot are lost** in every table you `--replace`. Pause writes first
  (dashboard → Settings → *Pause deployment*), or restore only the damaged tables.
- The import is validated against the **deployed schema**. If the schema changed since the
  snapshot (for example a new required field), deploy code that accepts the old shape first, or
  fix the JSONL before importing.
- Imports run in the background. Interrupting the CLI does not cancel an import that has started.
- Restoring `projects`, `todos` and `activity` without `memberships`, `membershipSync` and `users`
  is usually right: those three are mirrored from Clerk, which stays the source of truth.
  `projectMemberships` (per-project access grants, #46) reference `projects`. If you restore
  projects, restore it too.

### 3a. Full restore (whole deployment)

```sh
npx convex import --deployment <name> --replace-all restore/snapshot.zip
```

### 3b. Restore some tables from the zip

```sh
cd restore && mkdir s && unzip -q snapshot.zip -d s && cd s
zip -qr ../subset.zip todos activity            # only the tables to put back
npx convex import --deployment <name> --replace ../subset.zip
```

### 3c. Restore a single table

```sh
npx convex import --deployment <name> --table todos --replace restore/s/todos/documents.jsonl
# or, to put back rows that were deleted without touching the rest of the table:
npx convex import --deployment <name> --table todos --append deleted-rows.jsonl
```

To restore one team only, filter the JSONL first, for example
`jq -c 'select(.orgId == "org_…")' s/todos/documents.jsonl > team-todos.jsonl`, then `--append`
the rows that are missing.

### 4. Verify

```sh
npx convex run --deployment <name> --inline-query '
const out = {};
for (const t of ["projects", "todos", "activity", "memberships", "users"]) out[t] = (await ctx.db.query(t).collect()).length;
return out;'
```

Compare these counts with `wc -l s/<table>/documents.jsonl` and with the counts in the backup
run's job summary. Then open the app and check History for the affected projects.

## Restore drill: 2026-09-23, dev deployment `vibrant-salmon-106`

Run on **dev only**. Production was not touched. The dev deployment is shared with other
in-flight work (it already had `comments`, `recurrences` and other tables from other branches),
so the drill used its own team (`org_drill36`) and restored only the tables it had damaged.

```sh
# Identity for convex run: an admin of a throwaway team.
ID='{"subject":"user_drill36","name":"Drill Admin","org_id":"org_drill36","org_role":"org:admin","tokenIdentifier":"drill|user_drill36","issuer":"drill"}'
R="npx convex run --deployment vibrant-salmon-106 --codegen disable --typecheck disable"

# 1. Seed data through the real mutations (these also write activity rows).
$R --identity "$ID" projects:create '{"name":"Backup drill","color":"#6366f1"}'   # → j97f67nk…f03pc
$R --identity "$ID" todos:create '{"projectId":"j97f67nk…f03pc","title":"Drill todo 1","date":"2026-09-23"}'  # ×3

# 2. Snapshot.
npx convex export --deployment vibrant-salmon-106 --path /tmp/drill36/dev-drill-snapshot.zip
#   ✔ Created snapshot export at timestamp 1790221846065819324
#   ✔ Downloaded snapshot export to /tmp/drill36/dev-drill-snapshot.zip

# 3. Disaster: delete the project. This cascades to its todos and logs "project_deleted".
$R --identity "$ID" projects:remove '{"projectId":"j97f67nk…f03pc"}'

# 4a. Single-table restore of projects.
unzip -q dev-drill-snapshot.zip -d snap
npx convex import --deployment vibrant-salmon-106 --table projects --replace -y snap/projects/documents.jsonl
#   projects | create 1 | delete 0 of 0   ✔ Added 1 documents to table "projects".

# 4b. Trimmed-zip restore of todos + activity.
(cd snap && zip -qr ../restore-subset.zip todos activity)
npx convex import --deployment vibrant-salmon-106 --replace -y restore-subset.zip
#   activity | create 4 | delete 5 of 5
#   todos    | create 3 | delete 0 of 0   ✔ Added 7 documents.
```

Counts from the inline count query in step 4 of the runbook. "drill" means rows with `orgId = org_drill36`:

| Table | Snapshot (step 2) | After disaster (step 3) | After restore (step 4) | Match |
| --- | --- | --- | --- | --- |
| projects | 1 | 0 | 1 | yes |
| todos | 3 | 0 | 3 | yes |
| activity | 4 | 5 (+`project_deleted`) | 4 | yes |
| users (not restored) | 2 | 2 | 3 | untouched (someone signed up during the drill, and that row survived because `users` was not in the import) |

The restored todos kept their original `_id`, `projectId` and `_creationTime`
(`jd73rcfb…f0wm1`, `jd761wr5…f0c59`, `jd7cqr6e…f10vf` → project `j97f67nk…f03pc`). Afterwards
the drill project was deleted again with `projects:remove` to clean up dev. A few `org_drill36`
activity rows remain on dev; they are harmless.

Lessons:
- On a shared deployment, restore **only the damaged tables** (trimmed zip or `--table`).
  `--replace-all` would have wiped the new `users` row.
- `npx convex export` works on the free plan through the CLI. Only *scheduled* backups need a paid plan.
- The CLI needs a logged-in session (`npx convex login`) or a `CONVEX_DEPLOY_KEY` for the target.

## Admin JSON export (in-app)

Team admins see **Team → Full team export → Download JSON**. It pages through
`backup.teamExportPage` (1,000 rows per call) for `teamSettings`, `projects`, `todos`, `recurrences`, `comments`, `activity`,
`memberships`, `projectMemberships` and `projectInvitations`, all time, then resolves names with `users.byClerkIds`. The server checks the admin
role on every page, using the synced membership role once the team's membership backfill is done.
Every read goes through an index keyed on the caller's `orgId`, so another team's rows are never
read. Coverage is in `convex/backup.test.ts`. This export is for a team's own records and is not
an importable Convex snapshot. Use the nightly snapshot for disaster recovery.

When a new team-scoped table is added, add it to `TEAM_EXPORT_TABLES` in
`convex/lib/constants.ts`, give it a `by_org` index, and add a case to `convex/backup.ts`. The
switch there is exhaustive, so typecheck fails until the case exists.
