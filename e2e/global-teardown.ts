import { clerkBackend, deleteUserAndTeams, tryReadRunState } from "./support/clerk";

/**
 * Deletes this run's Clerk user and every team it created. Rows the run wrote to the Convex DEV
 * deployment stay behind, scoped to an organization id nobody can sign in to anymore.
 * Set E2E_KEEP_DATA=1 to keep the user and team around for debugging.
 */
export default async function globalTeardown() {
  if (process.env.E2E_KEEP_DATA) return;
  const state = tryReadRunState();
  if (!state) return;
  await deleteUserAndTeams(clerkBackend(), state.userId);
}
