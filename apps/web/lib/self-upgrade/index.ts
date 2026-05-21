export * from "./config";
export * from "./version";
export * from "./run-store";
export * from "./promoter";
export * from "./completion";
export * from "./notifications";

// ─── Legacy orchestrator API ─────────────────────────────────────────────────
// Kept for backward compatibility with portal-self-upgrade.ts until it is
// updated to use the new runSelfUpgrade / Inngest function directly.

export type SelfUpgradeCycleResult =
  | { status: "skipped"; reason: string; runId?: string }
  | { status: "started"; runId: string; reason?: string };

/** @deprecated Use the selfUpgradeScheduled/selfUpgradeManual Inngest functions instead */
export async function runSelfUpgradeCycle(
  _input: { trigger: "manual" | "scheduled" },
): Promise<SelfUpgradeCycleResult> {
  // Stub — callers should migrate to the new Inngest-based self-upgrade.
  return { status: "skipped", reason: "use-inngest-function" };
}
