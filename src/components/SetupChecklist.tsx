"use client";

import clsx from "clsx";
import { useQuery } from "convex/react";
import { Check, X } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { api } from "../../convex/_generated/api";

const storageKey = (orgId: string) => `lcftodos:setup-dismissed:${orgId}`;
const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};

/**
 * First-run guidance for a new team admin (#46): team → first project → invite people to
 * selected projects → assign the first todo. Progress comes from Convex, so it resumes on any
 * device; it disappears once everything is done or the admin dismisses it for this team.
 * The general product tour lives in OnboardingTutorial.
 */
export function SetupChecklist({ orgId }: { orgId: string }) {
  const status = useQuery(api.projectAccess.setupStatus, {});
  const stored = useSyncExternalStore(subscribe, () => window.localStorage.getItem(storageKey(orgId)), () => "1");
  const [dismissed, setDismissed] = useState(false);

  if (!status || dismissed || stored) return null;
  const steps = [
    { done: true, label: "Create your team", href: null },
    { done: status.hasProject, label: "Create your first project", href: "/app/projects" },
    { done: status.hasInvited, label: "Invite people to selected projects", href: "/app/team" },
    { done: status.hasAssigned, label: "Assign someone a todo", href: null },
  ];
  if (steps.every((s) => s.done)) return null;
  const doneCount = steps.filter((s) => s.done).length;

  const dismiss = () => {
    window.localStorage.setItem(storageKey(orgId), "1");
    setDismissed(true);
  };

  return (
    <section className="card mb-6 p-4" aria-labelledby="setup-heading">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 id="setup-heading" className="font-medium">Set up your team</h2>
          <p className="text-sm text-muted">{doneCount} of {steps.length} done</p>
        </div>
        <button type="button" className="btn-ghost p-1.5 text-muted" onClick={dismiss} aria-label="Hide setup checklist" title="Hide">
          <X className="size-4" />
        </button>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2">
        {steps.map((step, i) => (
          <li key={step.label} className="flex items-center gap-2 text-sm">
            <span
              className={clsx(
                "grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-medium",
                step.done ? "bg-emerald-500 text-white" : "bg-surface-2 text-muted",
              )}
              aria-hidden
            >
              {step.done ? <Check className="size-3" /> : i + 1}
            </span>
            {!step.done && step.href ? (
              <Link href={step.href} className="font-medium text-accent hover:underline">{step.label}</Link>
            ) : (
              <span className={clsx(step.done && "text-muted line-through")}>{step.label}</span>
            )}
            <span className="sr-only">{step.done ? "(done)" : "(to do)"}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
