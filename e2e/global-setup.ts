import { randomBytes } from "node:crypto";
import { clerkSetup } from "@clerk/testing/playwright";
import { clerkBackend, E2E_EMAIL_PREFIX, sweepStaleUsers, writeRunState } from "./support/clerk";

/**
 * Runs once in the Playwright main process, so the env vars clerkSetup() sets
 * (CLERK_FAPI, CLERK_TESTING_TOKEN) are inherited by the test workers.
 */
export default async function globalSetup() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL)
    throw new Error("NEXT_PUBLIC_CONVEX_URL (the Convex DEV deployment) is required.");
  await clerkSetup({ dotenv: false }); // playwright.config.ts already loaded .env.local

  const clerk = clerkBackend();
  await sweepStaleUsers(clerk, 2 * 60 * 60 * 1000);

  // A fresh user per run. `+clerk_test` addresses never receive real email.
  const runId = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const email = `${E2E_EMAIL_PREFIX}${runId}+clerk_test@example.com`;
  const user = await clerk.users.createUser({
    emailAddress: [email],
    password: `E2e-${randomBytes(12).toString("hex")}!`,
    firstName: "E2E",
    lastName: `Runner ${runId}`,
    skipPasswordChecks: true,
  });
  writeRunState({ runId, userId: user.id, email });
}
