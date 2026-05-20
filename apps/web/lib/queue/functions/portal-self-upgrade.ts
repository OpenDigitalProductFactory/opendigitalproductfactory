import { cron } from "inngest";

import { inngest } from "../inngest-client";

export const PORTAL_SELF_UPGRADE_EVENT = "portal/self-upgrade.requested";
export const PORTAL_SELF_UPGRADE_CRON = "0 8 * * *";
export const PORTAL_SELF_UPGRADE_COMPLETION_CRON = "*/15 * * * *";

export const portalSelfUpgradeScheduled = inngest.createFunction(
  {
    id: "portal/self-upgrade-scheduled",
    retries: 0,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron(PORTAL_SELF_UPGRADE_CRON)],
  },
  async ({ step }) => {
    return step.run("run-portal-self-upgrade-scheduled", async () => {
      const { runSelfUpgradeCycle } = await import("@/lib/self-upgrade");
      return runSelfUpgradeCycle({ trigger: "scheduled" });
    });
  },
);

export const portalSelfUpgradeRequested = inngest.createFunction(
  {
    id: "portal/self-upgrade-requested",
    retries: 0,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [{ event: PORTAL_SELF_UPGRADE_EVENT }],
  },
  async ({ step }) => {
    return step.run("run-portal-self-upgrade-manual", async () => {
      const { runSelfUpgradeCycle } = await import("@/lib/self-upgrade");
      return runSelfUpgradeCycle({ trigger: "manual" });
    });
  },
);

export const portalSelfUpgradeCompletionSweep = inngest.createFunction(
  {
    id: "portal/self-upgrade-completion-sweep",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron(PORTAL_SELF_UPGRADE_COMPLETION_CRON)],
  },
  async ({ step }) => {
    return step.run("complete-portal-self-upgrade-runs", async () => {
      const { completePendingSelfUpgradeRuns } = await import("@/lib/self-upgrade/completion");
      return completePendingSelfUpgradeRuns();
    });
  },
);
