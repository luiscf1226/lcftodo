"use client";

import { OrganizationProfile } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { ProjectAccessPanel } from "@/components/ProjectAccessPanel";
import { TeamSettings } from "@/components/TeamSettings";
import { TeamBackupExport } from "@/components/TeamBackupExport";

export default function TeamPage() {
  const me = useQuery(api.projectAccess.me, {});

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-2xl font-semibold">Team</h1>
      <p className="mb-5 text-sm text-muted">
        {me?.isAdmin
          ? "Invite people to selected projects, choose who sees what, and manage team settings."
          : "See your team and its settings."}
      </p>
      {me?.isAdmin && (
        <div className="mb-8">
          <ProjectAccessPanel />
        </div>
      )}
      {me && !me.isAdmin && me.restricted && (
        <p className="mb-5 card p-4 text-sm text-muted" role="status">
          {me.grantedProjects
            ? `You have access to ${me.grantedProjects} project${me.grantedProjects === 1 ? "" : "s"}. Ask a team admin if you need more.`
            : "You don't have access to any projects yet. Ask a team admin to add you to one."}
        </p>
      )}
      <TeamSettings />
      <TeamBackupExport />
      <OrganizationProfile
        path="/app/team"
        routing="path"
        appearance={{
          elements: { rootBox: "w-full", cardBox: "w-full max-w-none shadow-none border border-[var(--line)]" },
        }}
      />
    </div>
  );
}
