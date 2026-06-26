import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

const MAX_PER_RUN = 25;

/**
 * Scheduled backlog triage drain (BI-5076EA95).
 *
 * Hourly, drains items sitting in status="triaging" by asking an LLM to decide
 * each one and auto-applying only confident BUILD decisions (reversible,
 * non-destructive). Everything else is left for the operator / Scrum Master.
 * Core logic + safety gate live in lib/operate/backlog-triage-drain.ts (unit
 * tested); this wrapper only wires prisma + the LLM caller.
 *
 * Gated by gateAtEntry (skips while the portal is draining for upgrade) and by
 * the master DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED flag (it is registered in
 * scheduledFunctions).
 */
export const backlogTriageDrain = inngest.createFunction(
  { id: "ops/backlog-triage-drain", retries: 1, triggers: [cron("23 * * * *")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    const result = await step.run("drain-triaging-queue", async () => {
      const { prisma } = await import("@dpf/db");
      const {
        runBacklogTriageDrain,
        buildTriageDrainPrompt,
        TRIAGE_DRAIN_SYSTEM_PROMPT,
      } = await import("@/lib/operate/backlog-triage-drain");

      // LLM caller — strong-enough model for triage judgment. If no model is
      // available, every decide() throws → all items are left for the operator.
      let routeAndCall:
        | typeof import("@/lib/inference/routed-inference").routeAndCall
        | undefined;
      try {
        ({ routeAndCall } = await import("@/lib/inference/routed-inference"));
      } catch {
        routeAndCall = undefined;
      }

      return runBacklogTriageDrain({
        getTriagingItems: () =>
          prisma.backlogItem.findMany({
            where: { status: "triaging" },
            orderBy: { createdAt: "asc" },
            take: MAX_PER_RUN,
            select: {
              itemId: true,
              title: true,
              body: true,
              type: true,
              workType: true,
              // Author intent: load the existing size + proposed outcome so the
              // drain preserves a deliberate effortSize instead of overwriting it
              // with a blind re-estimate (BI-TRIAGE-SIZE-OVERWRITE).
              effortSize: true,
              proposedOutcome: true,
            },
          }),

        decide: async (item) => {
          if (!routeAndCall) throw new Error("no-llm");
          const resp = await routeAndCall(
            [{ role: "user" as const, content: buildTriageDrainPrompt(item) }],
            TRIAGE_DRAIN_SYSTEM_PROMPT,
            "internal",
            { taskType: "triage", budgetClass: "balanced", effort: "medium", persistDecision: false },
          );
          return resp.content;
        },

        applyBuild: async (itemId, effortSize, rationale) => {
          await prisma.backlogItem.update({
            where: { itemId },
            data: {
              status: "open",
              triageOutcome: "build",
              effortSize,
              resolution: rationale,
            },
          });
        },
      });
    });

    await step.run("record-job-run", async () => {
      const { recordJobRun } = await import("@/lib/operate/discovery-scheduler");
      await recordJobRun("backlog-triage-drain", "ok");
    });

    console.log(
      `[backlog-triage-drain] considered=${result.considered} ` +
        `autoBuilt=${result.autoBuilt} leftForOperator=${result.leftForOperator}`,
    );
    return result;
  },
);
