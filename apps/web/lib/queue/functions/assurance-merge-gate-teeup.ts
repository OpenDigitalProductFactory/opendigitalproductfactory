import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

// Assurance remediation lane P2.2 (BI-204EE70B) — the WWMD merge gate, running
// LIVE but DARK by default. Off-hours, budget-capped: it reads ready remediation
// PRs, runs each through the patch-only-auto gate, and ESCALATES the non-auto ones
// (files an issue report). It does NOT merge: auto-merge actuation is gated behind
// `DPF_ASSURANCE_AUTOMERGE_ENABLED` (default off) AND the armAutoMerge adapter is a
// throwing stub until P2.2b implements it + the cooldown/OSV verifiers and verifies
// against a real PR. So while dark this lane does only reads + escalation.
//
// Cron :47 (a free minute, off the contention ticks); only acts in the 02:00–06:00
// UTC off-hours window (shared with the P1 promote lane).
export const assuranceMergeGateScheduled = inngest.createFunction(
  {
    id: "assurance/merge-gate-scheduled",
    retries: 2,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("47 * * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "assurance/merge-gate-scheduled");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("assurance-merge-gate", async () => {
      const { prisma } = await import("@dpf/db");
      const { isAssuranceRemediationWindowOpen, resolveRemediationBudget } = await import(
        "@/lib/assurance/remediation-teeup"
      );
      const { runRemediationMergeGate } = await import("@/lib/assurance/remediation-merge-orchestrator");
      const { createLiveMergeGateAdapters } = await import("@/lib/assurance/remediation-merge-live");
      const { envFlagEnabled } = await import("@/lib/runtime/env-flags");

      const now = new Date();
      if (!isAssuranceRemediationWindowOpen(now)) {
        return { skipped: true, reason: "outside-off-hours-window" };
      }

      const actuationEnabled = envFlagEnabled(process.env, "DPF_ASSURANCE_AUTOMERGE_ENABLED");
      const adapters = await createLiveMergeGateAdapters({ prisma, actuationEnabled });
      return runRemediationMergeGate({ adapters, budget: resolveRemediationBudget() });
    });
  },
);
