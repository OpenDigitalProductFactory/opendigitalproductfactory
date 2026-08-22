export const SELF_UPGRADE_FUNCTION_ID_SCHEDULED = "ops/self-upgrade-scheduled";
export const SELF_UPGRADE_FUNCTION_ID_MANUAL = "ops/self-upgrade-manual";
export const SELF_UPGRADE_CRON = "0 * * * *";
export const SELF_UPGRADE_EVENT = "ops/self-upgrade.run";

export type SelfUpgradeRunEventData = {
  runId?: string;
  triggeredBy?: string;
  dryRun?: boolean;
  buildId?: string;
  /** Operator override: bypass the maintenance window and force quiescence. */
  force?: boolean;
  /** Per-attempt quiescence wait budget in milliseconds. */
  budgetMs?: number;
  /** Scheduled cron attempts are window- and interval-gated. */
  scheduled?: boolean;
  /** Agent requests are release-batch gated, but not interval throttled. */
  routine?: boolean;
};
