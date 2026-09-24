import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import { getMember, requireMember, type Member } from "./lib/auth";
import { carryOverDay } from "./lib/carryOver";
import { SYSTEM_ACTOR_ID } from "./lib/constants";
import { checkDate } from "./lib/validate";
import { addDaysToKey, dateKeyInZone, isValidTimeZone } from "./lib/timezone";

async function settingsFor(ctx: QueryCtx, orgId: string): Promise<Doc<"teamSettings"> | null> {
  return await ctx.db
    .query("teamSettings")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .unique();
}

/** The caller's team settings. `timeZone: null` means "not set; use the browser's zone". */
export const settings = query({
  args: {},
  handler: async (ctx) => {
    const member = await getMember(ctx);
    if (!member) return null;
    const row = await settingsFor(ctx, member.orgId);
    return {
      timeZone: row?.timeZone ?? null,
      autoCarryOver: row?.autoCarryOver ?? false,
      canEdit: member.isAdmin,
    };
  },
});

export const updateSettings = mutation({
  args: { timeZone: v.string(), autoCarryOver: v.boolean() },
  handler: async (ctx, { timeZone, autoCarryOver }) => {
    const member = await requireMember(ctx);
    if (!member.isAdmin) throw new Error("Only team admins can change team settings.");
    const zone = timeZone.trim();
    if (!isValidTimeZone(zone)) throw new Error("Unknown time zone.");

    const existing = await settingsFor(ctx, member.orgId);
    const today = dateKeyInZone(Date.now(), zone);
    // Only carry days that end after the setting is on: turning it on (or changing
    // the zone) mid-day must not immediately carry yesterday's work. Never move the
    // marker backwards, so a zone change can't make the same day run twice.
    const armed = autoCarryOver && existing?.autoCarryOver && existing.timeZone === zone;
    const previous = existing?.lastAutoCarryDate;
    const lastAutoCarryDate = armed ? previous : previous && previous > today ? previous : today;

    const fields = {
      timeZone: zone,
      autoCarryOver,
      lastAutoCarryDate,
      updatedBy: member.userId,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("teamSettings", { orgId: member.orgId, ...fields });
  },
});

/**
 * Hourly cron entry point (#22): finds teams with nightly carry-over on whose
 * local day has advanced since the last run, and schedules one carry-over per team.
 * Comparing days (instead of "is it hour 0?") also covers zones where a DST jump
 * skips local midnight, and missed cron runs.
 */
export const dispatchNightlyCarryOver = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const enabled = await ctx.db
      .query("teamSettings")
      .withIndex("by_autoCarryOver", (q) => q.eq("autoCarryOver", true))
      .collect();
    let scheduled = 0;
    for (const row of enabled) {
      if (!row.timeZone || !isValidTimeZone(row.timeZone)) continue;
      const today = dateKeyInZone(now, row.timeZone);
      if (row.lastAutoCarryDate && row.lastAutoCarryDate >= today) continue;
      await ctx.scheduler.runAfter(0, internal.teams.carryOverTeam, { orgId: row.orgId, date: today });
      scheduled++;
    }
    return scheduled;
  },
});

/**
 * Carries the team's unfinished todos from the day before `date` to `date`,
 * attributed to "System". Idempotent: records `date` as done and skips if it
 * already ran for that day (or a later one).
 */
export const carryOverTeam = internalMutation({
  args: { orgId: v.string(), date: v.string() },
  handler: async (ctx, { orgId, date }) => {
    checkDate(date);
    const row = await settingsFor(ctx, orgId);
    if (!row?.autoCarryOver) return 0;
    if (row.lastAutoCarryDate && row.lastAutoCarryDate >= date) return 0;
    await ctx.db.patch(row._id, { lastAutoCarryDate: date });

    const system: Member = { userId: SYSTEM_ACTOR_ID, orgId, isAdmin: false };
    const from = addDaysToKey(date, -1);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    let carried = 0;
    for (const project of projects) {
      // Archived and deleting projects are read-only (#16, #18).
      if (project.archived || project.deleting) continue;
      carried += await carryOverDay(ctx, system, project, from);
    }
    return carried;
  },
});
