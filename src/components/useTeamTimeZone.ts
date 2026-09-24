"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * The team's IANA time zone (#21), or undefined when the team hasn't set one
 * (or settings are still loading) — date helpers then use the browser's zone.
 */
export function useTeamTimeZone(): string | undefined {
  const settings = useQuery(api.teams.settings, {});
  return settings?.timeZone ?? undefined;
}
