"use client";

import clsx from "clsx";
import { useMutation, useQuery } from "convex/react";
import { CheckCheck } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { api } from "../../../../convex/_generated/api";
import { Empty, PageHeader, Skeleton } from "@/components/PageHeader";
import { showToast } from "@/components/ToastViewport";
import { useMembers } from "@/components/useMembers";
import { errorMessage } from "@/lib/errors";

export default function NotificationsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader title="Notifications" subtitle="What was assigned to you, and how you get told about it." />
      <Inbox />
      <EmailSettings />
      <SlackSettings />
    </div>
  );
}

function Inbox() {
  const items = useQuery(api.notifications.list, {});
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const actorIds = useMemo(() => (items ?? []).map((n) => n.actorId), [items]);
  const { nameOf } = useMembers(actorIds);
  const unread = items?.filter((n) => !n.read).length ?? 0;

  return (
    <section aria-labelledby="inbox-heading">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="inbox-heading" className="font-medium">
          Inbox
        </h2>
        {unread > 0 && (
          <button className="btn-ghost text-sm" onClick={() => markAllRead().catch((e) => showToast(errorMessage(e)))}>
            <CheckCheck className="size-4" /> Mark all read
          </button>
        )}
      </div>
      {items === undefined ? (
        <Skeleton className="h-24" />
      ) : items.length === 0 ? (
        <Empty title="Nothing yet" body="You'll see a notification here when a teammate assigns you a todo." />
      ) : (
        <ul className="divide-y divide-line card">
          {items.map((n) => (
            <li key={n._id} className={clsx("flex items-start gap-3 px-4 py-3 text-sm", n.read && "text-muted")}>
              <span
                aria-hidden
                className={clsx("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-accent")}
              />
              <div className="min-w-0 flex-1">
                <p>
                  <span className="font-medium">{nameOf(n.actorId) || "A teammate"}</span> assigned you{" "}
                  <span className="font-medium">{n.todoTitle}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {n.projectName} · due {n.date}
                </p>
              </div>
              {!n.read && (
                <button
                  className="btn-ghost shrink-0 px-2 py-1 text-xs"
                  onClick={() => markRead({ notificationId: n._id }).catch((e) => showToast(errorMessage(e)))}
                >
                  Mark read<span className="sr-only">: {n.todoTitle}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-2">
      <input
        type="checkbox"
        className="mt-1 size-4 accent-[var(--accent)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  );
}

function EmailSettings() {
  const prefs = useQuery(api.notifications.myPrefs, {});
  const update = useMutation(api.notifications.updateMyPrefs);
  const save = (change: { emailDigest?: boolean; emailAssigned?: boolean }) =>
    update(change).catch((e) => showToast(errorMessage(e)));

  return (
    <section aria-labelledby="email-heading">
      <h2 id="email-heading" className="mb-2 font-medium">
        Email
      </h2>
      {prefs === undefined ? (
        <Skeleton className="h-24" />
      ) : prefs === null ? null : (
        <div className="card px-4 py-2">
          {!prefs.hasEmail && (
            <p className="py-2 text-xs text-muted">
              We don&apos;t have an email address for you yet, so no emails will be sent.
            </p>
          )}
          <Toggle
            label="Daily digest"
            hint="Every morning (team time): your todos for today, overdue work and what didn't finish yesterday."
            checked={prefs.emailDigest}
            onChange={(emailDigest) => save({ emailDigest })}
          />
          <Toggle
            label="Assigned to me"
            hint="An email when a teammate assigns you a todo. You'll still see it in the inbox above."
            checked={prefs.emailAssigned}
            onChange={(emailAssigned) => save({ emailAssigned })}
          />
        </div>
      )}
    </section>
  );
}

function SlackSettings() {
  const settings = useQuery(api.notifications.slackSettings, {});
  const update = useMutation(api.notifications.updateSlack);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  if (settings === undefined) return <Skeleton className="h-24" />;
  if (settings === null) return null;

  const save = async (change: { webhookUrl?: string; postAssignments?: boolean; postDigest?: boolean }) => {
    setSaving(true);
    try {
      await update({
        postAssignments: change.postAssignments ?? settings.postAssignments,
        postDigest: change.postDigest ?? settings.postDigest,
        ...(change.webhookUrl !== undefined ? { webhookUrl: change.webhookUrl } : {}),
      });
      if (change.webhookUrl !== undefined) {
        setUrl("");
        showToast(change.webhookUrl ? "Slack webhook saved." : "Slack webhook removed.");
      }
    } catch (e) {
      showToast(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim()) void save({ webhookUrl: url.trim() });
  };

  return (
    <section aria-labelledby="slack-heading">
      <h2 id="slack-heading" className="mb-2 font-medium">
        Slack
      </h2>
      <div className="space-y-3 card px-4 py-3">
        <p className="text-sm text-muted">
          {settings.configured
            ? "This team posts to a Slack channel through an incoming webhook."
            : "Post team updates to a Slack channel with an incoming webhook."}
          {!settings.canEdit && " Only team admins can change this."}
        </p>
        {settings.canEdit && (
          <>
            <form onSubmit={onSubmit} className="flex flex-wrap gap-2">
              <label htmlFor="slack-url" className="sr-only">
                Slack incoming webhook URL
              </label>
              <input
                id="slack-url"
                className="input min-w-0 flex-1"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  settings.configured
                    ? "Webhook saved — paste a new URL to replace it"
                    : "https://hooks.slack.com/services/..."
                }
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <button type="submit" className="btn-primary" disabled={saving || !url.trim()}>
                Save
              </button>
              {settings.configured && (
                <button
                  type="button"
                  className="btn-outline"
                  disabled={saving}
                  onClick={() => void save({ webhookUrl: "" })}
                >
                  Remove
                </button>
              )}
            </form>
            <div>
              <Toggle
                label="Assignments"
                hint="Post when someone assigns a todo to a teammate."
                checked={settings.postAssignments}
                disabled={saving}
                onChange={(postAssignments) => void save({ postAssignments })}
              />
              <Toggle
                label="Daily summary"
                hint="Post the team's counts for the day every morning."
                checked={settings.postDigest}
                disabled={saving}
                onChange={(postDigest) => void save({ postDigest })}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
