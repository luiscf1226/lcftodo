"use client";

import { addDays, startOfDay } from "date-fns";
import { useEffect, useState } from "react";
import { todayKey } from "@/lib/dates";

/**
 * Today's date key that stays current: it re-checks when the tab regains focus or becomes
 * visible (timers are throttled in background tabs) and at local midnight, so a page left open
 * overnight doesn't keep treating yesterday as "today".
 */
export function useToday() {
  const [today, setToday] = useState(todayKey);

  useEffect(() => {
    const refresh = () => setToday(todayKey());
    const onVisibility = () => document.visibilityState === "visible" && refresh();
    // A second past midnight, to stay clear of clock jitter.
    const untilMidnight = startOfDay(addDays(new Date(), 1)).getTime() - Date.now() + 1000;
    const timer = window.setTimeout(refresh, untilMidnight);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // Re-arm the midnight timer each time the day changes.
  }, [today]);

  return today;
}
