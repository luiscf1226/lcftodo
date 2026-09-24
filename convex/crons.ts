import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every team's local midnight falls in some UTC hour (including half/quarter-hour
// offsets), so an hourly run picks each team up shortly after its day rolls over (#22).
crons.hourly("nightly carry-over", { minuteUTC: 1 }, internal.teams.dispatchNightlyCarryOver);

export default crons;
