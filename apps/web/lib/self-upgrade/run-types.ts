// apps/web/lib/self-upgrade/run-types.ts
//
// Shared self-upgrade run / quiescence shapes. Split out (BI-D77BF495) so the
// co-located SelfUpgradeTriggerControl (owns the trigger/force/abort actions)
// and the SelfUpgradeClient Advanced detail panel (read-only run history,
// activity, recovery point) describe the SAME server data without redefining
// it twice and risking drift.

export type LatestRun = {
  runId: string;
  status: string;
  trigger: string | null;
  currentSha: string | null;
  targetSha: string | null;
  deployedSha: string | null;
  reason: string | null;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  completionEvidence?: unknown;
  failureLog: string | null;
  createdAt: Date | string;
};

export type QuiescenceBlockerLine = {
  surface: string;
  label: string;
  kind: "hard" | "soft";
  count: number;
  estimatedWaitMs: number | null;
  sampleAgent?: string | null;
  sampleTitle?: string | null;
  oldestSignalAt?: string | null;
  stale?: boolean;
};

export type QuiescenceActivity = {
  level: "normal" | "draining" | "swapping";
  runId: string | null;
  enteredAt: string;
  run: {
    runId: string;
    status: string;
    trigger: string;
    targetVersion: string | null;
    targetBundleHash: string | null;
    deferSurface: string | null;
    deferReason: string | null;
    budgetMs: number | null;
    drainStartedAt: string | null;
    lastHeartbeatAt: string | null;
  } | null;
  blockersCapturedAt: string | null;
  blockers: QuiescenceBlockerLine[];
};
