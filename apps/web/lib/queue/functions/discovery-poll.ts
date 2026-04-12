import { cron } from "inngest";
import { inngest } from "../inngest-client";

export const prometheusPoll = inngest.createFunction(
  { id: "ops/prometheus-poll", retries: 2, triggers: [cron("0 * * * *")] },
  async ({ step }) => {
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
    await step.run("run-sweep", async () => {
      const { runFullDiscoverySweep } = await import(
        "@/lib/operate/discovery-scheduler"
      );
      await runFullDiscoverySweep();
    });
  },
);
