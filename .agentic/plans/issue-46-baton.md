# Baton — issue #46

Status: #30 complete and ready for `pr-no-mistakes`.
Progress: isolated worktree now on `feat/membership-sync-30-a9c3`. Added Clerk membership and profile webhook sync, one-off backfill, active membership checks, and tests. Left the main checkout's unrelated generated-file edit untouched.
Next: run `pr-no-mistakes` on the committed #30 branch. Later work on #46A–C uses separate scopes and branches.
Evidence: `.artifacts/issue-30/` (ignored locally) contains the failing-before capture, 52 passing tests, lint, typecheck, build, and assertions. Authenticated live delivery is untested without Clerk/Convex credentials.
