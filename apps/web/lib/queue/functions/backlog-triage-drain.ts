import { cron } from "inngest";
import { FEDERATED_WORK_ORIGIN_MARKER_SQL_PREFIX } from "@dpf/db/federated-work-contract";
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
 * Step shape — one Inngest step per item, NOT one step for the whole batch:
 * each step is its own portal HTTP request/response, so a single slow LLM call
 * (up to MAX_PER_RUN of them, sequential) can never hold one request open past
 * Inngest's response-header timeout. The old single "drain-triaging-queue" step
 * ran all 25 LLM calls inline and routinely tripped that timeout, which left
 * orphaned queue items ("run not found in state store") and retry storms
 * (BI-C8164664 context). Per-item steps also make each item's apply idempotent
 * on replay — Inngest memoises a completed step and never re-runs it.
 *
 * Gated by gateAtEntry (skips while the portal is draining for upgrade) and by
 * the master DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED flag (it is registered in
 * scheduledFunctions).
 */
export const backlogTriageDrain = inngest.createFunction(
  { id: "ops/backlog-triage-drain", retries: 1, triggers: [cron("23 * * * *")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ops/backlog-triage-drain");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    // Step 1 — fetch the bounded batch. DB-only, so it returns response headers
    // immediately; the slow LLM work is deferred to the per-item steps below.
    const items = await step.run("fetch-triaging-items", async () => {
      const { prisma } = await import("@dpf/db");
      return prisma.backlogItem.findMany({
        where: {
          status: "triaging",
          // A work-sync mirror is triaged by the installation that owns it;
          // triaging the copy here would fork the record (BI-FF8A57EF). A row
          // with no body is owned: NOT-contains alone is NULL for a NULL column.
          OR: [{ body: null }, { NOT: { body: { contains: FEDERATED_WORK_ORIGIN_MARKER_SQL_PREFIX } } }],
        },
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
      });
    });

    // Steps 2..N — one per item. Each does exactly one LLM decide + (maybe) one
    // apply, so a single request only ever waits on one model call.
    let autoBuilt = 0;
    let leftForOperator = 0;
    for (const item of items) {
      const outcome = await step.run(`triage-item-${item.itemId}`, async () => {
        const { prisma } = await import("@dpf/db");
        const { triageOneItem, buildTriageDrainPrompt, TRIAGE_DRAIN_SYSTEM_PROMPT } =
          await import("@/lib/operate/backlog-triage-drain");

        // LLM caller — strong-enough model for triage judgment. If no model is
        // available, decide() throws → the item is left for the operator.
        let routeAndCall:
          | typeof import("@/lib/inference/routed-inference").routeAndCall
          | undefined;
        try {
          ({ routeAndCall } = await import("@/lib/inference/routed-inference"));
        } catch {
          routeAndCall = undefined;
        }

        const { recordTriageDecision } = await import("@/lib/operate/backlog-triage-ledger");

        return triageOneItem(item, {
          decide: async (it) => {
            if (!routeAndCall) throw new Error("no-llm");
            const resp = await routeAndCall(
              [{ role: "user" as const, content: buildTriageDrainPrompt(it) }],
              TRIAGE_DRAIN_SYSTEM_PROMPT,
              "internal",
              // NB: `persistDecision: false` suppresses RouteDecisionLog — the
              // model-ROUTING telemetry. It is not a governance opt-out and
              // never was; governance is the DecisionInteraction row written by
              // recordDecision below (BI-BB2E585C).
              { taskType: "triage", budgetClass: "balanced", effort: "medium", persistDecision: false },
            );
            return resp.content;
          },
          // Fail-closed governance gate: no ledger row, no mutation.
          recordDecision: async (it, decision, appliedEffortSize) => {
            const outcome = await recordTriageDecision({
              db: prisma,
              item: it,
              decision,
              appliedEffortSize,
              effortSizeFromAuthor: it.effortSize === appliedEffortSize,
            });
            return outcome.recorded;
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
      if (outcome === "auto-built") autoBuilt++;
      else leftForOperator++;
    }

    const result = { considered: items.length, autoBuilt, leftForOperator };

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
