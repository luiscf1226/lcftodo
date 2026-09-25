import { Suspense } from "react";
import { WeekBoard } from "../projects/[projectId]/WeekBoard";

// The inbox calendar: personal tasks that aren't in a project yet.
export default function InboxPage() {
  return (
    <Suspense>
      <WeekBoard />
    </Suspense>
  );
}
