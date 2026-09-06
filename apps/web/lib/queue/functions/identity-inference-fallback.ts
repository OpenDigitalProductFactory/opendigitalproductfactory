// AI identity-resolution fallback (EP-ASSET-INTELLIGENCE, spec §4.2/§8).
//
// Turns the pure @dpf/db AI-fallback engine into a governed autonomous loop: a weekly
// cron pass over the unresolved InventoryEntity tail plus a manual "run now" event for
// the admin Scheduled Jobs surface. Quiescence-gated (skips during a self-upgrade
// drain) and honors the ScheduledJob.enabled kill switch inside the runner. The
// batching + per-run inference budget cost guardrail lives in the engine + runner.

import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import {
  IDENTITY_INFERENCE_CRON,
  IDENTITY_INFERENCE_REQUESTED_EVENT,
  IDENTITY_INFERENCE_SCHEDULED_INNGEST_ID,
  IDENTITY_INFERENCE_REQUESTED_INNGEST_ID,
} from "@/lib/asset-intelligence/identity-inference-constants";

export const identityInferenceFallbackScheduled = inngest.createFunction(
  {
    id: IDENTITY_INFERENCE_SCHEDULED_INNGEST_ID,
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron(IDENTITY_INFERENCE_CRON)],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, IDENTITY_INFERENCE_SCHEDULED_INNGEST_ID);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("identity-inference-fallback", async () => {
      const { runIdentityInferenceFallbackJob } = await import(
        "@/lib/asset-intelligence/identity-inference-runner"
      );
      return runIdentityInferenceFallbackJob();
    });
  },
);

// Manual one-shot trigger for the admin "run now" action; supports an optional smaller
// scan limit for a quick poll.
export const identityInferenceFallbackRequested = inngest.createFunction(
  {
    id: IDENTITY_INFERENCE_REQUESTED_INNGEST_ID,
    retries: 1,
    triggers: [{ event: IDENTITY_INFERENCE_REQUESTED_EVENT }],
  },
  async ({ event, step }) => {
    const scanLimit = (event.data as { scanLimit?: number } | undefined)?.scanLimit;
    return step.run("identity-inference-fallback-manual", async () => {
      const { runIdentityInferenceFallbackJob } = await import(
        "@/lib/asset-intelligence/identity-inference-runner"
      );
      return runIdentityInferenceFallbackJob(
        typeof scanLimit === "number" ? { scanLimit } : {},
      );
    });
  },
);
