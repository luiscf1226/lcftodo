import { Suspense } from "react";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { WeekBoard } from "./WeekBoard";

export default async function ProjectPage({ params }: PageProps<"/app/projects/[projectId]">) {
  const { projectId } = await params;
  return (
    <Suspense>
      <WeekBoard projectId={projectId as Id<"projects">} />
    </Suspense>
  );
}
