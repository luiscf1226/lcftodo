"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { showToast } from "./ToastViewport";
import { errorMessage } from "@/lib/errors";

/**
 * Makes sure the occurrences of every recurring todo exist for the visible range (#23).
 * Runs when the range changes and whenever a series is created, edited or stopped (the
 * `recurrences.list` subscription changes). Generation is idempotent on the server.
 */
export function useRecurringTodos(from: string, to: string, projectId?: Id<"projects">) {
  const series = useQuery(api.recurrences.list, projectId ? { projectId } : {});
  const ensure = useMutation(api.recurrences.ensureOccurrences);
  // Only fields that affect which days get generated.
  const key = series?.length ? JSON.stringify(series.map((r) => [r._id, r.rule, r.startDate])) : null;

  useEffect(() => {
    if (!key) return;
    ensure({ from, to, projectId }).catch((error) => {
      showToast(errorMessage(error, "No se pudieron crear las tareas recurrentes de esta semana."));
    });
  }, [key, from, to, projectId, ensure]);
}
