"use client";

import { OrganizationSwitcher, UserButton, useOrganization } from "@clerk/nextjs";
import clsx from "clsx";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { CircleHelp, FolderKanban, History, LayoutDashboard, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../../convex/_generated/api";
import { OnboardingTutorial } from "@/components/OnboardingTutorial";
import { ToastViewport } from "@/components/ToastViewport";
import { SearchButton, TodoSearch } from "@/components/TodoSearch";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ONBOARDING_PATH } from "@/lib/routes";

const NAV = [
  { href: "/app", label: "Today", icon: LayoutDashboard },
  { href: "/app/projects", label: "Projects", icon: FolderKanban },
  { href: "/app/history", label: "History", icon: History },
  { href: "/app/team", label: "Team", icon: Users },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { organization, isLoaded } = useOrganization();
  const { isAuthenticated } = useConvexAuth();
  const storeUser = useMutation(api.users.store);

  useEffect(() => {
    if (isAuthenticated) void storeUser();
  }, [isAuthenticated, storeUser]);

  // First-run tutorial: shown on every visit until the user checks it off (persisted in Convex).
  // Closing without checking only hides it until the next visit. Nothing shows while loading.
  const onboarding = useQuery(api.users.onboardingStatus, isAuthenticated ? {} : "skip");
  const [tutorialDismissed, setTutorialDismissed] = useState(false);
  const [tutorialRequested, setTutorialRequested] = useState(false);
  const tutorialOpen = tutorialRequested || (onboarding?.completed === false && !tutorialDismissed);
  const closeTutorial = () => {
    setTutorialRequested(false);
    setTutorialDismissed(true);
  };
  const openTutorial = () => setTutorialRequested(true);

  const isActive = (href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));

  // No active team: the session is pending (new user, or removed from their only team). Team setup
  // lives on the onboarding page, which never redirects back here without a team, so this can't loop.
  const needsTeam = isLoaded && !organization;
  useEffect(() => {
    if (needsTeam) router.replace(ONBOARDING_PATH);
  }, [needsTeam, router]);

  if (needsTeam) {
    return (
      <main className="grid min-h-dvh place-items-center p-4 text-sm text-muted" aria-live="polite">
        Taking you to team setup…
      </main>
    );
  }

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface p-3 md:flex">
        <Link href="/app" className="mb-4 flex items-center gap-2 px-2 py-1 font-semibold">
          <span className="grid size-7 place-items-center rounded-lg bg-accent text-accent-fg">✓</span>
          LCF Todos
        </Link>
        <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/app" afterCreateOrganizationUrl="/app" appearance={{ elements: { rootBox: "w-full", organizationSwitcherTrigger: "w-full justify-between" } }} />
        <div className="mt-4">
          <SearchButton />
        </div>
        <nav className="mt-2 flex flex-col gap-0.5">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm",
                isActive(href) ? "bg-surface-2 font-medium text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              <Icon className="size-4" /> {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-3 px-1">
          <button
            type="button"
            onClick={openTutorial}
            className="-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
          >
            <CircleHelp className="size-4" /> Tutorial
          </button>
          <div className="flex items-center justify-between gap-2 px-1.5 text-xs text-muted">
            Theme <ThemeToggle />
          </div>
          <UserButton showName />
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur md:hidden">
        <div className="min-w-0 flex-1 overflow-hidden">
          <OrganizationSwitcher
            hidePersonal
            afterSelectOrganizationUrl="/app"
            afterCreateOrganizationUrl="/app"
            appearance={{ elements: { rootBox: "max-w-full", organizationSwitcherTrigger: "max-w-full" } }}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <SearchButton compact />
          <button type="button" onClick={openTutorial} className="btn-ghost p-1.5 text-muted" aria-label="Open tutorial" title="Tutorial">
            <CircleHelp className="size-5" />
          </button>
          <ThemeToggle compact />
          <UserButton />
        </div>
      </header>

      <main className="min-w-0 px-4 pt-5 pb-24 sm:px-6 md:pb-10 lg:px-8">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={clsx("flex flex-col items-center gap-0.5 py-2 text-[11px]", isActive(href) ? "text-accent" : "text-muted")}
          >
            <Icon className="size-5" /> {label}
          </Link>
        ))}
      </nav>
      <OnboardingTutorial open={tutorialOpen} completed={onboarding?.completed ?? false} onClose={closeTutorial} />
      <TodoSearch />
      <ToastViewport />
    </div>
  );
}
