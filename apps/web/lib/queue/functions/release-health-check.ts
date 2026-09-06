// apps/web/lib/queue/functions/release-health-check.ts
// BI-3630773C (EP-FULL-OBS) — poll the latest release stamp's verify-gate
// outcome and keep the operator notification + health-card state in sync.
//
// Two GitHub API reads per tick (runs list + jobs on a red run) — fits the
// anonymous 60/hr budget at the 15-minute cadence even with no token bound.

import { cron } from "inngest";

import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import { runReleaseHealthCheck } from "@/lib/release-health/runner";

export const releaseHealthCheck = inngest.createFunction(
  {
    id: "ops/release-health-check",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("12,27,42,57 * * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ops/release-health-check");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return await step.run("check-release-health", () => runReleaseHealthCheck());
  },
);
