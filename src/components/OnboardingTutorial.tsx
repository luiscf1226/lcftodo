"use client";

import clsx from "clsx";
import { useMutation } from "convex/react";
import {
  ArrowLeft,
  ArrowRight,
  CircleHelp,
  CornerDownRight,
  FolderKanban,
  History,
  LayoutDashboard,
  Palette,
  Sparkles,
  SquarePen,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import { errorMessage } from "@/lib/errors";
import { STATUS_META, STATUSES } from "@/lib/status";
import { Modal } from "./Modal";

const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="rounded border border-line bg-surface-2 px-1 py-px font-mono text-[11px] text-fg">{children}</kbd>
);

type Step = { title: string; icon: LucideIcon; body: ReactNode };

const STEPS: Step[] = [
  {
    title: "Welcome to LCF Todos",
    icon: Sparkles,
    body: (
      <>
        <p>Plan your team&apos;s work day by day, see what got done, and carry over what didn&apos;t.</p>
        <p>This quick tour takes about a minute and shows you where everything lives.</p>
      </>
    ),
  },
  {
    title: "Today",
    icon: LayoutDashboard,
    body: (
      <>
        <p>
          <strong>Today</strong> is your home screen: today&apos;s todos, anything overdue, and a count of this
          week&apos;s todos by status.
        </p>
        <p>
          Switch between <strong>My todos</strong> and <strong>Whole team</strong> at the top. Click any todo to edit
          its title, notes, day, or assignee.
        </p>
      </>
    ),
  },
  {
    title: "Quick-add bar",
    icon: SquarePen,
    body: (
      <>
        <p>
          Type in the bar at the top of Today and press <Kbd>Enter</Kbd>. The input stays focused, so you can add todos
          one after another.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Paste a multi-line list to create one todo per line.</li>
          <li>
            Press <Kbd>/</Kbd> or <Kbd>n</Kbd> anywhere on Today to jump to the bar.
          </li>
          <li>Pick the project next to the input, or open more options for the day, assignee, and notes.</li>
        </ul>
      </>
    ),
  },
  {
    title: "Projects and the week board",
    icon: FolderKanban,
    body: (
      <>
        <p>
          Group work into color-coded <strong>Projects</strong>. Each project opens a <strong>week board</strong> with a
          column for every day from Monday to Sunday.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Move between weeks with the arrows, or jump to a date.</li>
          <li>Add todos straight into a day and filter the board by assignee.</li>
          <li>Edit, archive, or delete a project from its menu.</li>
        </ul>
      </>
    ),
  },
  {
    title: "Statuses and carry-over",
    icon: CornerDownRight,
    body: (
      <>
        <p>Every todo has a status. Change it from the pill on the todo.</p>
        <ul className="flex flex-wrap gap-2" aria-label="Statuses">
          {STATUSES.map((s) => (
            <li
              key={s}
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                STATUS_META[s].pill,
              )}
            >
              <span className={clsx("size-1.5 rounded-full", STATUS_META[s].dot)} aria-hidden />
              {STATUS_META[s].label}
            </li>
          ))}
        </ul>
        <p>
          At the end of a day, <strong>Carry</strong> on the week board moves unfinished todos to the next day and marks
          the originals as didn&apos;t finish.
        </p>
      </>
    ),
  },
  {
    title: "History",
    icon: History,
    body: (
      <>
        <p>
          <strong>History</strong> shows what your team planned, finished, and missed. Filter by date range, project, or
          person, and switch between the Days, People, and Activity views.
        </p>
        <p>
          Use <strong>Export</strong> to download the current view as CSV, Excel, or JSON.
        </p>
      </>
    ),
  },
  {
    title: "Your team",
    icon: Users,
    body: (
      <>
        <p>
          Everything you see belongs to the current team. Switch teams, or create a new one, from the team switcher at
          the top of the sidebar.
        </p>
        <p>
          Open <strong>Team</strong> to invite teammates by email, manage roles, and edit team settings.
        </p>
        <p>
          Admins can invite people to selected projects and restrict project access, so each member only sees the
          projects they&apos;re added to. New admins get a setup checklist on <strong>Today</strong>.
        </p>
      </>
    ),
  },
  {
    title: "Make it yours",
    icon: Palette,
    body: (
      <>
        <p>
          Use the <strong>Theme</strong> menu to choose Light, Dark, or System, which follows your device.
        </p>
        <p>
          You can reopen this tour from <strong>Tutorial</strong> in the sidebar, or with the{" "}
          <CircleHelp className="inline size-3.5 align-[-2px]" aria-label="help" /> button on mobile.
        </p>
      </>
    ),
  },
];

/**
 * First-run tour. Only a Finish with the checkbox ticked persists completion (in Convex, so it
 * follows the user across devices). Closing or skipping just hides it until the next visit.
 */
export function OnboardingTutorial({
  open,
  completed,
  onClose,
}: {
  open: boolean;
  completed: boolean;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Getting started">
      <Tutorial completed={completed} onClose={onClose} />
    </Modal>
  );
}

function Tutorial({ completed, onClose }: { completed: boolean; onClose: () => void }) {
  const completeOnboarding = useMutation(api.users.completeOnboarding);
  const [index, setIndex] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const checkboxId = useId();
  const stepLabelId = useId();

  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;
  const Icon = step.icon;

  // Move focus to the new step's heading so keyboard and screen reader users follow along.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [index]);

  async function finish() {
    if (!dontShowAgain || completed) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await completeOnboarding();
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, "Couldn't save that. Try again."));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p id={stepLabelId} className="text-xs font-medium text-muted" aria-live="polite">
        Step {index + 1} of {STEPS.length}
      </p>
      <ol className="flex gap-1.5" aria-labelledby={stepLabelId}>
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            aria-current={i === index ? "step" : undefined}
            className={clsx("h-1.5 flex-1 rounded-full transition-colors", i <= index ? "bg-accent" : "bg-surface-2")}
          >
            <span className="sr-only">
              {s.title}
              {i < index ? " (seen)" : ""}
            </span>
          </li>
        ))}
      </ol>

      <section className="min-h-52 space-y-3 text-sm leading-relaxed text-muted [&_strong]:font-medium [&_strong]:text-fg">
        <h3
          ref={headingRef}
          tabIndex={-1}
          className="flex items-center gap-2 text-base font-semibold text-fg outline-none"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-accent" aria-hidden>
            <Icon className="size-4" />
          </span>
          {step.title}
        </h3>
        {step.body}
      </section>

      {isLast && !completed && (
        <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
          <input
            id={checkboxId}
            type="checkbox"
            className="mt-0.5 size-4 accent-accent"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
          />
          <label htmlFor={checkboxId} className="text-sm text-fg">
            I&apos;ve finished the tutorial — don&apos;t show again
          </label>
        </div>
      )}
      {isLast && completed && (
        <p className="text-sm text-muted">You&apos;ve already finished the tutorial. Reopen it anytime.</p>
      )}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        {index === 0 ? (
          <button type="button" className="btn-ghost text-muted" onClick={onClose}>
            Skip for now
          </button>
        ) : (
          <button type="button" className="btn-ghost" onClick={() => setIndex(index - 1)} disabled={busy}>
            <ArrowLeft className="size-4" /> Back
          </button>
        )}
        {isLast ? (
          <button type="button" className="btn-primary" onClick={() => void finish()} disabled={busy}>
            {busy ? "Saving…" : "Finish"}
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={() => setIndex(index + 1)} data-autofocus>
            Next <ArrowRight className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
