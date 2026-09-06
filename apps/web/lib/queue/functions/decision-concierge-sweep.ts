// The cadence behind the decision concierge (BI-C62127B9).
//
// A scheduled pass and a manual "run now", both quiescence-gated and both
// single-flight: two overlapping sweeps would race for the same decisions and
// spend panels twice on one question.

import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import {
  CONCIERGE_SWEEP_CRON,
  CONCIERGE_SWEEP_REQUESTED_EVENT,
  CONCIERGE_SWEEP_REQUESTED_INNGEST_ID,
  CONCIERGE_SWEEP_SCHEDULED_INNGEST_ID,
} from "@/lib/decision/concierge-sweep-constants";

async function runPass(limitOverride?: number) {
  const { prisma } = await import("@dpf/db");
  const { runConciergeSweepJob } = await import("@/lib/decision/concierge-sweep-runner");

  // The sweep is a steward acting for the install's owner; panels are
  // attributed to that person, not to an anonymous system identity.
  const owner = await prisma.user.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!owner) return { skipped: true, reason: "no-owner" };

  return runConciergeSweepJob({
    userId: owner.id,
    ...(typeof limitOverride === "number" ? { limits: { maxPanels: limitOverride } } : {}),
  });
}

export const decisionConciergeSweepScheduled = inngest.createFunction(
  {
    id: CONCIERGE_SWEEP_SCHEDULED_INNGEST_ID,
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron(CONCIERGE_SWEEP_CRON)],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, CONCIERGE_SWEEP_SCHEDULED_INNGEST_ID);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("decision-concierge-sweep", () => runPass());
  },
);

export const decisionConciergeSweepRequested = inngest.createFunction(
  {
    id: CONCIERGE_SWEEP_REQUESTED_INNGEST_ID,
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [{ event: CONCIERGE_SWEEP_REQUESTED_EVENT }],
  },
  async ({ event, step }) => {
    const gate = await gateAtEntry(step, CONCIERGE_SWEEP_REQUESTED_INNGEST_ID);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    const raw = (event.data as { maxPanels?: unknown } | undefined)?.maxPanels;
    const limit = typeof raw === "number" && raw > 0 ? Math.floor(raw) : undefined;
    return step.run("decision-concierge-sweep", () => runPass(limit));
  },
);
