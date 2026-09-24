"use client";

import { useEffect, useState } from "react";
import { dayStartMs, shiftDays, todayKey } from "@/lib/dates";
import { useTeamTimeZone } from "./useTeamTimeZone";

/**
 * Today's date key in the team's time zone (#21; the browser's zone until the team sets one)
 * that stays current: it re-checks when the tab regains focus or becomes visible (timers are
 * throttled in background tabs) and at the team's midnight, so a page left open overnight
 * doesn't keep treating yesterday as "today".
 */
export function useToday() {
  const timeZone = useTeamTimeZone();
  // Bumped to re-read the clock; `today` itself is derived so a zone change applies immediately.
  const [, setClock] = useState(0);
  const today = todayKey(timeZone);

  useEffect(() => {
    const refresh = () => setClock((n) => n + 1);
    const onVisibility = () => document.visibilityState === "visible" && refresh();
    // A second past the next midnight in the team's zone, to stay clear of clock jitter.
    const untilMidnight = dayStartMs(shiftDays(today, 1), timeZone) - Date.now() + 1000;
    const timer = window.setTimeout(refresh, Math.max(untilMidnight, 1000));
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // Re-arm the midnight timer each time the day or the team zone changes.
  }, [today, timeZone]);

  return today;
}
