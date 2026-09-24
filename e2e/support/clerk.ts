import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClerkClient } from "@clerk/backend";

/** Every user this suite creates matches this pattern, so stale ones can be swept safely. */
export const E2E_EMAIL_PREFIX = "lcf-e2e-";
const E2E_EMAIL_PATTERN = /^lcf-e2e-[a-z0-9-]+\+clerk_test@example\.com$/;

const STATE_FILE = path.join(__dirname, "..", ".state", "run.json");

export type RunState = { runId: string; userId: string; email: string };

export function clerkBackend() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is required for the E2E suite.");
  if (!secretKey.startsWith("sk_test_")) {
    throw new Error("Refusing to run E2E against a non-development Clerk instance (expected an sk_test_ key).");
  }
  return createClerkClient({ secretKey });
}

export function writeRunState(state: RunState) {
  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function readRunState(): RunState {
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as RunState;
}

export function tryReadRunState(): RunState | null {
  try {
    return readRunState();
  } catch {
    return null;
  }
}

type Clerk = ReturnType<typeof clerkBackend>;

/** Deletes every organization the user belongs to (all of them are E2E teams), then the user. */
export async function deleteUserAndTeams(clerk: Clerk, userId: string) {
  const memberships = await clerk.users.getOrganizationMembershipList({ userId, limit: 100 });
  for (const membership of memberships.data) {
    await clerk.organizations.deleteOrganization(membership.organization.id).catch((error: unknown) => {
      console.warn(`[e2e] could not delete organization ${membership.organization.id}:`, error);
    });
  }
  await clerk.users.deleteUser(userId);
}

/** Removes leftovers from crashed or killed runs that are older than `olderThanMs`. */
export async function sweepStaleUsers(clerk: Clerk, olderThanMs: number) {
  const users = await clerk.users.getUserList({ query: E2E_EMAIL_PREFIX, limit: 100 });
  const cutoff = Date.now() - olderThanMs;
  for (const user of users.data) {
    const emails = user.emailAddresses.map((e) => e.emailAddress);
    if (user.createdAt > cutoff || emails.length === 0 || !emails.every((e) => E2E_EMAIL_PATTERN.test(e))) continue;
    await deleteUserAndTeams(clerk, user.id).catch((error: unknown) => {
      console.warn(`[e2e] could not sweep stale user ${user.id}:`, error);
    });
  }
}
