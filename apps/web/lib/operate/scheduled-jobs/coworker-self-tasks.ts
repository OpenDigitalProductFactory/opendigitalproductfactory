// Proactivity → autonomous coworker self-tasks (BI-3F09BDD4, EP-B9DD37C7).
//
// The per-coworker Proactivity setting (quiet | balanced | assertive) is a promise
// about how hard a coworker works. Until now it only shaped the in-conversation
// prompt (the Initiative block) and notification cadence — an Assertive coworker
// that no one messaged still did nothing, so pages like /customer/marketing stayed
// empty. This wires the setting into the existing ScheduledAgentTask engine so an
// Assertive coworker self-drives a recurring, role-appropriate task without a human
// in the loop; the every-5-min agent-task-dispatch cron runs it.
//
// This is intentionally a small curated registry, NOT "every coworker gets a cron".
// A coworker earns an autonomous self-task only when there is a concrete,
// idempotent, non-destructive unit of work that is genuinely useful to run on a
// cadence. The seed entry is the Marketing Strategist producing/refreshing a
// campaign brief so the Campaigns page fills itself.

import { prisma } from "@dpf/db";
import type { ProactivityLevel } from "@/lib/proactivity/proactivity-types";
import { SCHEDULING_MAP } from "@/lib/operate/scheduled-jobs/scheduling-map";
import { occupiedTicks, deconflictCron } from "@/lib/operate/scheduled-jobs/scheduling-allocator";
import { computeNextCronRun } from "@/lib/operate/cron-next-run";

/**
 * A coworker self-task definition. `cadence` maps the two work-producing
 * proactivity levels to a cron expression; `quiet` never produces a task.
 * Balanced runs weekly, Assertive runs daily — the operator's setting picks
 * the intensity, the coworker does the same unit of work either way.
 */
export type CoworkerSelfTask = {
  title: string;
  /** The prompt the coworker runs on each tick. Must describe idempotent work. */
  prompt: string;
  /** Drives which coworker + which page-scoped tools the agentic loop attaches. */
  routeContext: string;
  cadence: {
    balanced: string;
    assertive: string;
  };
};

/**
 * Registry of coworkers that self-drive when their Proactivity is turned up.
 * Keyed by agentId (the interactive coworker slug, e.g. "marketing-specialist").
 */
export const COWORKER_SELF_TASKS: Record<string, CoworkerSelfTask> = {
  "marketing-specialist": {
    title: "Refresh the acquisition campaign brief",
    prompt: [
      "You are running as a scheduled, autonomous task — no human is watching this",
      "turn, so finish the work rather than asking questions.",
      "",
      "Goal: keep a current acquisition campaign brief on the Campaigns page so the",
      "marketing surface is never empty. Steps:",
      "1. Review the saved acquisition assumptions / ICP / positioning available to you",
      "   (org context, prior campaigns, product catalog).",
      "2. If there is NO active or recent campaign brief, create one with",
      "   create_marketing_campaign_brief: a focused brief for the most promising",
      "   segment, with objective, audience, channels, core message, and 3–5 concrete",
      "   next actions.",
      "3. If a recent brief already exists, do NOT duplicate it — instead refresh it",
      "   only if assumptions have changed, otherwise stop.",
      "Keep it grounded in real saved context; do not invent customers or numbers.",
    ].join("\n"),
    routeContext: "/customer/marketing",
    cadence: {
      // Weekly Monday and daily, both at 14:07 UTC — an off-peak minute the
      // allocator is unlikely to collide, and deconflictCron shifts it if it does.
      balanced: "7 14 * * 1",
      assertive: "7 14 * * *",
    },
  },
};

/** Deterministic per-(agent, owner) taskId so reconcile is idempotent. */
export function coworkerSelfTaskId(agentId: string, userId: string): string {
  return `self-${agentId}-${userId}`;
}

/** True when a taskId is a coworker self-task (see {@link coworkerSelfTaskId}). */
export function isCoworkerSelfTaskId(taskId: string): boolean {
  return taskId.startsWith("self-");
}

/**
 * A procedural tool the scheduled runner force-executes as a LAST-RESORT
 * guarantee when the coworker's own agentic loop finished the self-task without
 * calling it (e.g. a weak model fabricated "Done" with zero tool calls). This is
 * the same "required procedural tool" mechanism the discovery-triage daily task
 * uses — extended to coworker self-tasks so an Assertive coworker never leaves
 * its page empty.
 */
export type CoworkerSelfTaskProceduralTool = {
  /** Tool name to force, resolved via governed execute. */
  name: string;
  /**
   * Args for the forced fallback call. These are honest, generic placeholders —
   * the fallback only ever fires when the page is otherwise empty, and the
   * coworker (on a capable model) produces the real, contextual artifact itself.
   */
  args: Record<string, unknown>;
  /**
   * Recency guard for the forced fallback. The self-task's artifact tool (e.g.
   * create_marketing_campaign_brief → a plain prisma.create with NO write-time
   * dedup) would otherwise create a duplicate placeholder on every tick. Returns
   * true when a fresh artifact already exists — the coworker just created one
   * this run, or a recent run did — so the fallback MUST be skipped.
   */
  hasRecentArtifact: () => Promise<boolean>;
};

// A brief created within this window counts as "recent", so the forced fallback
// stands down. Wider than the daily assertive cadence so a single placeholder is
// never re-created tick-over-tick; the coworker's own (capable-model) briefs land
// well inside it and suppress the fallback entirely.
const RECENT_CAMPAIGN_BRIEF_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

/**
 * Required-tool guarantee for a coworker self-task, keyed by agentId. Null when
 * the coworker's self-task has no procedural guarantee (the loop's own output is
 * sufficient). Mirrors getRequiredProceduralToolForScheduledTask for the curated
 * self-task registry above.
 */
export function coworkerSelfTaskRequiredTool(
  agentId: string,
): CoworkerSelfTaskProceduralTool | null {
  if (agentId === "marketing-specialist") {
    return {
      name: "create_marketing_campaign_brief",
      // Honest, generic placeholder. Only reached when the marketing page has no
      // recent brief AND the coworker's loop failed to produce one — so a clearly
      // provisional brief beats an empty Campaigns page. required: title, objective.
      args: {
        title: "Acquisition campaign brief (needs refresh)",
        objective:
          "Provisional acquisition brief created automatically because the Campaigns page had no recent brief. Refresh with a segment-specific objective, audience, and channel mix.",
        notes:
          "Auto-generated fallback so the Campaigns page is not empty. The Marketing Strategist should replace this with a grounded, ICP-specific brief on its next run.",
      },
      hasRecentArtifact: async () => {
        const since = new Date(Date.now() - RECENT_CAMPAIGN_BRIEF_WINDOW_MS);
        const recent = await prisma.marketingCampaignBrief.findFirst({
          where: { createdAt: { gte: since } },
          select: { briefId: true },
        });
        return recent !== null;
      },
    };
  }

  return null;
}

export type ReconcileSelfTaskResult =
  | { ok: true; action: "none" | "removed" | "scheduled"; taskId?: string; schedule?: string };

/**
 * Bring the coworker's autonomous self-task in line with `level`:
 *   - no registry entry for this coworker → nothing to do;
 *   - quiet → deactivate any existing self-task (coworker goes silent);
 *   - balanced → weekly cadence; assertive → daily cadence (upsert, de-conflicted).
 *
 * Idempotent: keyed on a deterministic taskId, so flipping the setting back and
 * forth never piles up duplicate schedules. userId-parameterized and not a
 * "use server" export, so the caller must have already authorized `userId`.
 */
export async function reconcileCoworkerSelfTask(
  userId: string,
  agentId: string,
  level: ProactivityLevel,
): Promise<ReconcileSelfTaskResult> {
  const entry = COWORKER_SELF_TASKS[agentId];
  if (!entry) return { ok: true, action: "none" };

  const taskId = coworkerSelfTaskId(agentId, userId);

  // Quiet (or any non-producing level) → stand the coworker down.
  if (level === "quiet") {
    await prisma.scheduledAgentTask.updateMany({
      where: { taskId },
      data: { isActive: false },
    });
    await prisma.scheduledJob
      .update({ where: { jobId: taskId }, data: { schedule: "disabled" } })
      .catch(() => {});
    return { ok: true, action: "removed", taskId };
  }

  const baseCron = level === "assertive" ? entry.cadence.assertive : entry.cadence.balanced;
  const now = new Date();

  // De-conflict against the canonical scheduling map and other live tasks
  // (excluding this task's own row so a re-save doesn't collide with itself).
  const liveTasks = await prisma.scheduledAgentTask.findMany({
    where: { isActive: true, taskId: { not: taskId } },
    select: { schedule: true },
  });
  const occupied = occupiedTicks([
    ...SCHEDULING_MAP.map((e) => e.cron),
    ...liveTasks.map((t) => t.schedule),
  ]);
  const { cron: schedule } = deconflictCron(baseCron, occupied);
  const nextRunAt = computeNextCronRun(schedule, now);

  await prisma.scheduledAgentTask.upsert({
    where: { taskId },
    create: {
      taskId,
      agentId,
      title: entry.title,
      prompt: entry.prompt,
      routeContext: entry.routeContext,
      schedule,
      timezone: "UTC",
      ownerUserId: userId,
      nextRunAt,
      isActive: true,
    },
    update: {
      title: entry.title,
      prompt: entry.prompt,
      routeContext: entry.routeContext,
      schedule,
      nextRunAt,
      isActive: true,
    },
  });

  await prisma.scheduledJob.upsert({
    where: { jobId: taskId },
    create: { jobId: taskId, name: `Agent: ${entry.title}`, schedule, nextRunAt },
    update: { name: `Agent: ${entry.title}`, schedule, nextRunAt },
  });

  return { ok: true, action: "scheduled", taskId, schedule };
}
