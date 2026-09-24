# Issue #17 assertions

- **Menus can dismiss on a pointer press outside their container:** passed static verification in `useDismissibleMenu`.
- **Menus can dismiss on Escape and restore focus to their trigger:** passed static verification in `useDismissibleMenu`.
- **Project and Export menu markup and selection behavior:** delegated to their owners, which consume the shared hook.

`npm test` and `npm run lint` passed on `team-b-frontend`. Authenticated browser verification is untested because Clerk and Convex are not configured in this workspace.
