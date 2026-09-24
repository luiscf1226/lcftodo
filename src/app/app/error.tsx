"use client";

import { useEffect } from "react";
import { errorMessage } from "@/lib/errors";
import { ONBOARDING_PATH } from "@/lib/routes";

// Thrown by convex/lib/auth.ts requireMember when the token's team has no active membership,
// e.g. right after the user was removed from the team (before Clerk refreshes the session).
const NOT_A_MEMBER = "You must be signed in to a team.";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const lostTeam = error.message.includes(NOT_A_MEMBER);

  return (
    <div className="mx-auto mt-16 max-w-md card p-6 text-center" role="alert">
      <h1 className="text-lg font-semibold">{lostTeam ? "You're not on this team anymore" : "Something went wrong"}</h1>
      <p className="mt-1 text-sm text-pretty text-muted">
        {lostTeam
          ? "You may have been removed from this team. Pick another team, or create a new one."
          : errorMessage(error)}
      </p>
      <div className="mt-5 flex justify-center gap-2">
        {lostTeam ? (
          // Full navigation so the server and Clerk re-read the session (now without this team).
          <a href={ONBOARDING_PATH} className="btn-primary">
            Choose a team
          </a>
        ) : (
          <button type="button" onClick={retry} className="btn-primary">
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
