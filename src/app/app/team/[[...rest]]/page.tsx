"use client";

import { OrganizationProfile } from "@clerk/nextjs";
import { TeamSettings } from "@/components/TeamSettings";

export default function TeamPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-2xl font-semibold">Team</h1>
      <p className="mb-5 text-sm text-muted">Invite teammates by email, manage roles, and edit team settings.</p>
      <TeamSettings />
      <OrganizationProfile
        path="/app/team"
        routing="path"
        appearance={{ elements: { rootBox: "w-full", cardBox: "w-full max-w-none shadow-none border border-[var(--line)]" } }}
      />
    </div>
  );
}
