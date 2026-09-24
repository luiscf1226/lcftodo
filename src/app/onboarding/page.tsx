import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";
import { APP_HOME_PATH } from "@/lib/routes";
import { TeamChooser } from "./TeamChooser";

export const metadata: Metadata = { title: "Configura tu equipo · LCF Todos" };

// Reached by signed-in users without an active team: right after sign-up, after accepting an
// invite into a session that has no team yet, or after being removed from their only team.
// Signed-out visitors never get here (src/proxy.ts sends them to sign-in).
export default async function OnboardingPage() {
  const { sessionStatus, orgId } = await auth({ treatPendingAsSignedOut: false });
  // Already on a team, e.g. Clerk refreshing this page right after the task completed.
  if (sessionStatus === "active" && orgId) redirect(APP_HOME_PATH);

  return (
    <main className="flex min-h-dvh flex-col items-center px-4 pt-[max(env(safe-area-inset-top),1.25rem)] pb-10">
      <header className="flex w-full max-w-md items-center justify-between">
        <span className="flex items-center gap-2 font-semibold">
          <span className="grid size-7 place-items-center rounded-lg bg-accent text-accent-fg">✓</span>
          LCF Todos
        </span>
        <ThemeToggle />
      </header>

      <div className="mt-10 flex w-full max-w-md flex-1 flex-col items-center gap-6">
        <TeamChooser pending={sessionStatus === "pending"} />
      </div>
    </main>
  );
}
