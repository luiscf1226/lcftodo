"use client";

import { useAuth } from "@clerk/nextjs";
import { useConvex } from "convex/react";
import { Download } from "lucide-react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { MAX_EXPORT_PAGE_SIZE, TEAM_EXPORT_TABLES, type TeamExportTable } from "../../convex/lib/constants";
import { download } from "@/lib/csv";
import { errorMessage } from "@/lib/errors";
import { collectPages } from "@/lib/export";

// users.byClerkIds resolves at most this many ids per call.
const USER_BATCH = 200;

/**
 * Admin-only "download everything" for the current team, all time, as JSON (#36).
 * The server re-checks the admin role on every page; hiding the button is only cosmetic.
 */
export function TeamBackupExport() {
  const { has, orgSlug } = useAuth();
  const convex = useConvex();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!has?.({ role: "org:admin" })) return null;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const tables = {} as Record<TeamExportTable, Record<string, unknown>[]>;
      for (const table of TEAM_EXPORT_TABLES) {
        tables[table] = await collectPages<Record<string, unknown>>((cursor) =>
          convex.query(api.backup.teamExportPage, {
            table,
            paginationOpts: { numItems: MAX_EXPORT_PAGE_SIZE, cursor },
          }),
        );
      }
      // Names for everyone who appears in the data (the server only returns this team's members).
      const ids = new Set<string>();
      for (const rows of Object.values(tables)) {
        for (const row of rows) {
          for (const key of [
            "userId",
            "actorId",
            "assigneeId",
            "createdBy",
            "authorId",
            "updatedBy",
            "grantedBy",
            "invitedBy",
            "acceptedUserId",
          ]) {
            if (typeof row[key] === "string") ids.add(row[key]);
          }
        }
      }
      const all = [...ids];
      const users = [];
      for (let i = 0; i < all.length; i += USER_BATCH) {
        users.push(...(await convex.query(api.users.byClerkIds, { clerkIds: all.slice(i, i + USER_BATCH) })));
      }
      const exportedAt = new Date().toISOString();
      const data = { format: "lcftodo-team-export", version: 1, exportedAt, team: orgSlug ?? null, users, ...tables };
      download(
        `lcftodo_team_${orgSlug ?? "export"}_${exportedAt.slice(0, 10)}.json`,
        JSON.stringify(data, null, 2),
        "application/json",
      );
    } catch (caught) {
      setError(errorMessage(caught, "Couldn’t export the team. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-surface px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold">Full team export</h2>
        <p className="text-sm text-muted">
          Admins only. Team settings, projects, todos, recurring series, comments, activity, memberships and project
          access, all time, as JSON.
        </p>
        {error && (
          <p className="mt-1 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
      <button className="btn-outline" disabled={busy} aria-busy={busy} onClick={() => void run()}>
        <Download className="size-4" /> {busy ? "Exporting…" : "Download JSON"}
      </button>
    </section>
  );
}
