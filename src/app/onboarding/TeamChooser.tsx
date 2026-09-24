"use client";

import { OrganizationList, SignOutButton, TaskChooseOrganization } from "@clerk/nextjs";
import { useState } from "react";
import { APP_HOME_PATH } from "@/lib/routes";

/**
 * Picks the Clerk component once, on mount. Completing the task makes Clerk refresh the page while
 * it is still finishing (activating the team, then navigating), so the server's view of the session
 * changes mid-flight; swapping components at that point would abort the flow.
 */
export function TeamChooser({ pending }: { pending: boolean }) {
  const [showTask] = useState(pending);

  if (showTask) {
    // Completes Clerk's choose-organization session task, which activates the session.
    // Its copy ("Set up your team", ...) comes from lib/clerkLocalization.
    return <TaskChooseOrganization redirectUrlComplete={APP_HOME_PATH} />;
  }

  // Active session without a usable team (e.g. a stale token right after being removed from one):
  // the same choice, through the plain organization list.
  return (
    <>
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a team</h1>
        <p className="mt-1 text-sm text-pretty text-muted">
          Pick one of your teams, or create a new one. You can switch teams any time.
        </p>
      </div>
      <OrganizationList
        hidePersonal
        afterCreateOrganizationUrl={APP_HOME_PATH}
        afterSelectOrganizationUrl={APP_HOME_PATH}
      />
      <SignOutButton>
        <button type="button" className="btn-ghost text-muted">
          Sign out
        </button>
      </SignOutButton>
    </>
  );
}
