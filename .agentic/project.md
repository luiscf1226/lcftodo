# Project map — LCF Todos

## Stack

- Node.js project using npm (`package-lock.json`, lockfile v3).
- Next.js 16.3.6 App Router with React 19.2.8 and Tailwind CSS 4.
- Clerk provides authentication and Organizations; Convex provides data and realtime mutations.
- TypeScript is strict with bundler module resolution. Import aliases use `@/*` for `src/*`.

## Commands

| Purpose | Command | Verified result (2026-09-23) |
| --- | --- | --- |
| Development | `npm run dev` | UNVERIFIED: starts Next.js and Convex in parallel; needs configured Clerk and Convex environment. |
| Build | `npm run build` | PASSED with dummy public Clerk/Convex values and network access on 2026-09-23. Without those values, prerendering stops at the provider configuration check. |
| Lint | `npm run lint` | PASSED on 2026-09-23. |
| Tests | `npm test` | PASSED on 2026-09-23: 2 files and 11 tests. |

Dependencies were installed with `npm ci` on 2026-09-23. The build requires network access to Google Fonts unless the fonts are self-hosted.

## Layout

- `src/app/`: App Router pages. Authenticated screens are under `src/app/app/`; shared app shell is `src/app/app/AppShell.tsx`.
- `src/components/`: client-facing shared UI components, dialogs, cards, todo controls, and small hooks.
- `src/lib/`: presentation and utility code.
- `convex/`: schema, access control, queries, mutations, generated API types, and backend tests (`convex/todos.test.ts`).
- `docs/PLAN.md`: product scope and current tickets.

## Data and auth

- Convex data is defined in `convex/schema.ts`; its public functions are exported through `convex/_generated/api`.
- `convex/lib/auth.ts` reads the active Clerk organization from the JWT and scopes data to its `orgId`.
- The administrator role is exactly `org:admin`.
- Required environment-variable names: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`, `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, and `CLERK_JWT_ISSUER_DOMAIN` for Convex.

## Conventions

- Client components use the `"use client"` directive and Tailwind utility classes.
- Mutations are called with Convex `useMutation`; existing forms keep local `busy` and `error` state.
- UI semantic colors and reusable button/input classes are defined in `src/app/globals.css` and `src/lib/status.ts`.
- No CI workflow, PR template, or commit-message convention was found.

## Risks and parallel-work boundaries

- `src/app/app/projects/[projectId]/WeekBoard.tsx` and `src/app/app/history/page.tsx` contain several independent interactive flows and are high-conflict files.
- `src/components/TodoItem.tsx` is shared by the dashboard and week board; coordinate changes to it.
- Real browser verification requires Clerk and Convex credentials, which are not supplied in the repository.
- No automated frontend tests currently exist. Backend tests use Vitest with `convex-test` in an edge-runtime environment.

## Evidence norm

For UI changes, capture an authenticated live-browser before/after pair when a configured Clerk and Convex development environment is available. Otherwise, run the verified static checks after dependencies are installed and record the environment limitation in `.artifacts/<issue>/assertions.md`.
