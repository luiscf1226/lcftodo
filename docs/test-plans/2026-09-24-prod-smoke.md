# Production smoke test: 2026-09-24

This run was against **https://lcftodo.vercel.app** (Convex prod `rugged-seahorse-548`), after PR #60 was deployed. It covers #4 and the verify step of #42.

**Setup.** I made three throwaway users with the Clerk Backend API (`+clerk_test` emails) and signed each in with a one-time sign-in token, each in its own browser context. Clerk's sign-up CAPTCHA can't be driven by automation; the self-serve sign-up → `/onboarding` → create team path was checked separately, on the #59 branch locally.
- **Lead:** admin of team "Smoke4 Team".
- **Member:** `org:member` of the same team, added through the Clerk API.
- **Outsider:** admin of a different team, "Smoke4 Other".

| # | Step | Expected | Result |
|---|---|---|---|
| 1 | Lead signs in | Lands on Today in their team (onboarding tutorial shown) | ✅ |
| 2 | Lead creates projects "Alpha (shared)" and "Beta (lead only)" | Both listed | ✅ |
| 3 | Lead opens Team | Member listed, synced by the Clerk membership webhook with no manual backfill | ✅ |
| 4 | Lead restricts project access, grants Member → Alpha only | Setting and grant persist after a reload | ✅ |
| 5 | Member opens Projects | Sees **only Alpha** | ✅ |
| 6 | Member opens Beta's URL directly | "Project not found" | ✅ |
| 7 | Outsider opens Projects | "No projects yet" (none of the other team's data) | ✅ |
| 8 | Outsider opens Alpha's URL directly | "Project not found" | ✅ |
| 9 | Member opens Alpha's project menu | Only **Edit**: no Archive or Delete | ✅ |
| 10 | Lead opens Alpha's project menu | Edit, **Archive**, **Delete** | ✅ |
| 11 | Member quick-adds "Member smoke todo" in Alpha | Lead sees it on the board in real time | ✅ |

**Cleanup.** I deleted the test users and teams in Clerk; the webhooks tombstone them in Convex. Their two projects and one todo remain in prod as orphaned rows of a deleted team, and nobody can see them.

**Not covered:**
- Receiving an emailed invitation, because Resend and Clerk only deliver to verified addresses on the dev instance.
- Removing access with the member still signed in.
- Mobile layout.
