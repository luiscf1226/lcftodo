import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every team's local midnight falls in some UTC hour (including half/quarter-hour
// offsets), so an hourly run picks each team up shortly after its day rolls over (#22).
crons.hourly("nightly carry-over", { minuteUTC: 1 }, internal.teams.dispatchNightlyCarryOver);

// Daily digest emails and Slack summaries (#25). Hourly so every team gets its
// digest in its own local morning; `digestSends` keeps it once per member per day.
crons.hourly("daily digest", { minuteUTC: 7 }, internal.notifications.dispatchDaily, {});

export default crons;
