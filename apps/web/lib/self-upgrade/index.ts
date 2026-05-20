import { loadSelfUpgradeConfig, type SelfUpgradeConfig } from "./config";
import { getUpgradeVersionState, type UpgradeVersionState } from "./version";
import { startSelfUpgradePromoter, type PromoterStartResult } from "./promoter";
import {
  createSelfUpgradeRun,
  markSelfUpgradeRunSkipped,
  markSelfUpgradeRunStarted,
} from "./store";
import { notifySelfUpgradeEvent } from "./notification";

export { loadSelfUpgradeConfig, SELF_UPGRADE_CONFIG_KEY, SelfUpgradeConfigSchema } from "./config";
export { getUpgradeVersionState, compareUpgradeVersions, buildRemoteHeadCommand } from "./version";
export { buildPromoterDockerArgs, startSelfUpgradePromoter } from "./promoter";
export {
  completeMergedShipBuilds,
  completePendingSelfUpgradeRuns,
  completeSelfUpgradeRun,
} from "./completion";

type SelfUpgradeTrigger = "manual" | "scheduled";

type SelfUpgradeRun = {
  runId: string;
};

type LoadedSelfUpgradeConfig = Partial<SelfUpgradeConfig> & { enabled: boolean };

type SelfUpgradeDeps = {
  loadConfig?: () => Promise<LoadedSelfUpgradeConfig>;
  getVersionState?: (config: LoadedSelfUpgradeConfig) => Promise<UpgradeVersionState>;
  createRun?: (input: {
    trigger: SelfUpgradeTrigger;
    config: Partial<SelfUpgradeConfig>;
    versionState: UpgradeVersionState;
  }) => Promise<SelfUpgradeRun>;
  markRunSkipped?: (input: {
    trigger: SelfUpgradeTrigger;
    reason: string;
    versionState?: UpgradeVersionState;
  }) => Promise<void>;
  markRunStarted?: (input: { runId: string; promoter: PromoterStartResult }) => Promise<void>;
  startPromoter?: (
    config: Partial<SelfUpgradeConfig>,
    runId: string,
    targetSha?: string | null,
  ) => Promise<PromoterStartResult>;
  notify?: (event: {
    type: "started" | "completed" | "failed" | "skipped";
    runId?: string;
    trigger?: string;
    currentSha?: string | null;
    targetSha?: string | null;
    reason?: string;
    containerName?: string;
  }) => Promise<void> | void;
};

export type SelfUpgradeCycleResult =
  | { status: "skipped"; reason: string; runId?: string }
  | { status: "started"; runId: string; reason?: string };

export async function runSelfUpgradeCycle(
  input: { trigger: SelfUpgradeTrigger },
  deps: SelfUpgradeDeps = {},
): Promise<SelfUpgradeCycleResult> {
  const config = await (deps.loadConfig ?? loadSelfUpgradeConfig)();
  const notify = deps.notify ?? notifySelfUpgradeEvent;

  if (!config.enabled) {
    const markSkipped = deps.markRunSkipped ?? markSelfUpgradeRunSkipped;
    await markSkipped({ trigger: input.trigger, reason: "disabled" });
    await notify({ type: "skipped", trigger: input.trigger, reason: "disabled" });
    return { status: "skipped", reason: "disabled" };
  }

  const loadVersionState =
    deps.getVersionState ??
    ((loadedConfig: LoadedSelfUpgradeConfig) =>
      getUpgradeVersionState(loadedConfig as SelfUpgradeConfig));
  const versionState = await loadVersionState(config);
  if (versionState.upToDate) {
    const markSkipped = deps.markRunSkipped ?? markSelfUpgradeRunSkipped;
    await markSkipped({ trigger: input.trigger, reason: "up-to-date", versionState });
    await notify({ type: "skipped", trigger: input.trigger, reason: "up-to-date" });
    return { status: "skipped", reason: "up-to-date" };
  }

  if (!versionState.comparable) {
    const markSkipped = deps.markRunSkipped ?? markSelfUpgradeRunSkipped;
    await markSkipped({ trigger: input.trigger, reason: versionState.reason, versionState });
    await notify({ type: "skipped", trigger: input.trigger, reason: versionState.reason });
    return { status: "skipped", reason: versionState.reason };
  }

  const createRun = deps.createRun ?? createSelfUpgradeRun;
  const run = await createRun({
    trigger: input.trigger,
    config,
    versionState,
  });

  const startPromoter =
    deps.startPromoter ??
    ((loadedConfig, runId, targetSha) =>
      startSelfUpgradePromoter(loadedConfig as SelfUpgradeConfig, runId, targetSha));
  const promoter = await startPromoter(config, run.runId, versionState.targetSha);
  const markStarted = deps.markRunStarted ?? markSelfUpgradeRunStarted;
  await markStarted({ runId: run.runId, promoter });
  await notify({
    type: "started",
    trigger: input.trigger,
    runId: run.runId,
    currentSha: versionState.currentSha,
    targetSha: versionState.targetSha,
    containerName: promoter.containerName,
  });

  return { status: "started", runId: run.runId };
}
