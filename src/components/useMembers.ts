"use client";

import { useOrganization } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "../../convex/_generated/api";
import { SYSTEM_ACTOR_ID, SYSTEM_ACTOR_NAME } from "../../convex/lib/constants";

export type Member = { id: string; name: string; imageUrl?: string; role?: string };

// Current team members from Clerk, plus a lookup that also resolves people who
// have since left the team (from Convex's users table) so history stays readable.
export function useMembers(extraIds: string[] = []) {
  const { memberships } = useOrganization({ memberships: { infinite: true, pageSize: 100 } });

  const members = useMemo<Member[]>(
    () =>
      (memberships?.data ?? [])
        .filter((m) => m.publicUserData?.userId)
        .map((m) => {
          const u = m.publicUserData!;
          const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.identifier;
          return { id: u.userId!, name, imageUrl: u.imageUrl, role: m.role };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [memberships?.data],
  );

  const missing = useMemo(() => {
    const known = new Set([SYSTEM_ACTOR_ID, ...members.map((m) => m.id)]);
    return [...new Set(extraIds)].filter((id) => !known.has(id)).sort();
  }, [members, extraIds]);

  const former = useQuery(api.users.byClerkIds, missing.length ? { clerkIds: missing } : "skip");

  const byId = useMemo(() => {
    // Scheduled jobs (nightly carry-over, #22) act as "System".
    const map = new Map<string, Member>([[SYSTEM_ACTOR_ID, { id: SYSTEM_ACTOR_ID, name: SYSTEM_ACTOR_NAME }]]);
    for (const u of former ?? []) map.set(u.clerkId, { id: u.clerkId, name: u.name, imageUrl: u.imageUrl });
    for (const m of members) map.set(m.id, m);
    return map;
  }, [members, former]);

  const nameOf = (id?: string) => (id ? (byId.get(id)?.name ?? "Former member") : "");

  return { members, byId, nameOf };
}
