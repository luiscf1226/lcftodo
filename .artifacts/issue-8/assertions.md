# Issue #8 assertions

- **Shared mutation errors can be normalized consistently:** passed static verification. `errorMessage` provides a safe fallback and removes Convex's `Uncaught Error:` prefix.
- **A mutation failure can be announced without inline duplication:** passed static verification. `showToast(message)` dispatches to the authenticated app's mounted `ToastViewport`.
- **The app shell mounts one accessible toast live region:** passed static verification. The viewport uses `aria-live="polite"` and its individual messages use `role="status"`.
- **Route error and loading UI:** delegated to the owner of `src/app/app/error.tsx` and `loading.tsx`.
- **Status, quick-add, carry, and archive failure handling:** delegated to their owning interactive surfaces, which can call the shared API.

Verification run on `team-b-frontend`:

- `npm test` — passed (2 files, 11 tests).
- `npm run lint` — passed.
- `npm run build` — blocked because `next/font` could not reach Google Fonts in the sandbox.
- Authenticated browser verification — untested; the repository has no configured Clerk and Convex environment.
