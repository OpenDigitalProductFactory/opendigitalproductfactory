import { cron } from "@/lib/jobs/triggers";
import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";
import { TRIAGE_CALL_BUDGET_MS, TRIAGE_RUN_BUDGET_MS, type AssessmentOutcome } from "@/lib/operate/backlog-triage-assessment";

const MAX_PER_RUN = 25;

/** BI-E3FBB0C4: per-item durable steps, with persisted eligibility and bounded inference. */
export const backlogTriageDrain = jobs.createFunction(
  { id: "ops/backlog-triage-drain", retries: 1, triggers: [cron("23 * * * *")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ops/backlog-triage-drain");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    const batch = await step.run("fetch-eligible-triaging-items", async () => {
      const { selectTriageBatch } = await import("@/lib/operate/backlog-triage-repository");
      return { ...await selectTriageBatch(MAX_PER_RUN, new Date()), startedAt: Date.now() };
    });
    const counts: Partial<Record<AssessmentOutcome, number>> = {};
    let budgetStopped = false;
    let attempted = 0;
    let visited = 0;
    for (const item of batch.items) {
      const result = await step.run(`assess-item-${item.itemId}`, async () => {
        // Budget checks belong inside the checkpoint, so replaying completed
        // steps cannot turn an earlier completed assessment into a budget skip.
        if (Date.now() - batch.startedAt >= TRIAGE_RUN_BUDGET_MS) return { outcome: "budget" as const };
        const { prisma } = await import("@dpf/db");
        const { beginTriage, applyTriageBuild } = await import("@/lib/operate/backlog-triage-repository");
        const started = await beginTriage(item.itemId, item.fingerprint, item.updatedAt, new Date());
        if (!started) return { outcome: "changed" as const, called: false as const };
        const { assessTriageItem } = await import("@/lib/operate/backlog-triage-assessment");
        const { buildTriageDrainPrompt, TRIAGE_DRAIN_SYSTEM_PROMPT } = await import("@/lib/operate/backlog-triage-drain");
        const { recordTriageDecision } = await import("@/lib/operate/backlog-triage-ledger");
        const assessment = await assessTriageItem(started.row, {
          decide: async it => {
            const { routeAndCall } = await import("@/lib/inference/routed-inference");
            const response = await routeAndCall(
              [{ role: "user", content: buildTriageDrainPrompt(it) }], TRIAGE_DRAIN_SYSTEM_PROMPT, "internal",
              { taskType: "triage", budgetClass: "balanced", effort: "medium", persistDecision: true, maxDurationMs: TRIAGE_CALL_BUDGET_MS, routeContext: "cron:ops/backlog-triage-drain" },
            );
            return response.content;
          },
          recordDecision: async (it, decision, appliedEffortSize) => (await recordTriageDecision({ db: prisma, item: it, decision, appliedEffortSize, effortSizeFromAuthor: it.effortSize === appliedEffortSize })).recorded,
          callBudgetMs: Math.min(TRIAGE_CALL_BUDGET_MS, Math.max(1, TRIAGE_RUN_BUDGET_MS - (Date.now() - batch.startedAt))),
          applyBuild: async (_id, size, rationale) => applyTriageBuild(started.row, started.claim, size, rationale),
        });
        return { outcome: assessment.outcome, called: true as const, assessment, activityId: started.activityId, fingerprint: started.fingerprint, attempts: started.attempts, backlogItemId: started.row.id, claim: started.claim };
      });
      if (result.outcome === "budget") { budgetStopped = true; break; }
      if (result.called) {
        // Checkpoint the judgment/apply before persisting its projection. A DB
        // reporting retry must never repeat completed inference or mutation.
        await step.run(`finish-item-${item.itemId}`, async () => {
          const { finishTriage } = await import("@/lib/operate/backlog-triage-repository");
          await finishTriage(result.activityId, result.fingerprint, result.attempts, result.outcome, new Date(), result.assessment.rationale, result.backlogItemId, result.claim);
        });
      }
      visited++;
      if (result.called) attempted++;
      counts[result.outcome] = (counts[result.outcome] ?? 0) + 1;
      // An unavailable model/ledger should not spend another 24 calls proving
      // the same outage. Persisted per-item retries resume after backoff.
      if (result.outcome === "model-error" || result.outcome === "ledger-error") break;
    }
    const errors = (counts["model-error"] ?? 0) + (counts["invalid-response"] ?? 0) + (counts["ledger-error"] ?? 0) + (counts["apply-error"] ?? 0);
    const review = (counts["needs-review"] ?? 0) + (counts["low-confidence"] ?? 0);
    const remaining = batch.items.length - visited;
    const changed = counts.changed ?? 0;
    const result = { attempted, autoBuilt: counts["auto-built"] ?? 0, review, errors, held: batch.held, changed, remaining, budgetStopped, counts };
    await step.run("record-job-run", async () => {
      const { recordJobRun } = await import("@/lib/operate/discovery-scheduler");
      const errorKinds = ["model-error", "invalid-response", "ledger-error", "apply-error"] as const;
      const errorSummary = errorKinds.filter(kind => counts[kind]).map(kind => `${counts[kind]} ${kind}`).join(", ");
      const summary = `${result.attempted} assessed; ${result.autoBuilt} advanced; ${review} need review; ${errors} errors${errorSummary ? ` (${errorSummary})` : ""}; ${batch.held} unchanged or waiting; ${changed} changed; ${remaining} not assessed${budgetStopped ? "; budget reached" : ""}`;
      await recordJobRun("backlog-triage-drain", errors ? "error" : budgetStopped ? "budget-limited" : review ? "needs-review" : attempted ? "ok" : "idle", errors ? summary : undefined, { summary, details: result, cursor: batch.cursor });
    });
    console.log("[backlog-triage-drain]", JSON.stringify(result));
    return result;
  },
);
