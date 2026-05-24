import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

export const prometheusPoll = inngest.createFunction(
  { id: "ops/prometheus-poll", retries: 2, triggers: [cron("0 * * * *")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    await step.run("poll-targets", async () => {
      const { runPrometheusTargetCheck } = await import(
        "@/lib/operate/discovery-scheduler"
      );
      await runPrometheusTargetCheck();
    });
  },
);

export const fullDiscoverySweep = inngest.createFunction(
  {
    id: "ops/full-discovery-sweep",
    retries: 2,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("0 * * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    await step.run("run-sweep", async () => {
      const { runFullDiscoverySweep } = await import(
        "@/lib/operate/discovery-scheduler"
      );
      await runFullDiscoverySweep();
    });
  },
);
