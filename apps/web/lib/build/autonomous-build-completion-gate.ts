import type { AutonomousPlaybookMode } from "@/lib/build/build-studio-config";

type Logger = Pick<Console, "log" | "error">;

type CompletionGateDeps = {
  getMode(): AutonomousPlaybookMode;
  resolve(buildId: string): Promise<{
    mayAct: boolean;
    eligibility: { blockers: string[] };
  }>;
};

async function defaultDeps(): Promise<CompletionGateDeps> {
  const { getAutonomousPlaybookMode } = await import(
    "@/lib/build/build-studio-config"
  );
  const { resolveAutonomousBuildPhaseEligibility } = await import(
    "@/lib/build/autonomous-build-phase-runtime"
  );
  return {
    getMode: getAutonomousPlaybookMode,
    resolve: (buildId) => resolveAutonomousBuildPhaseEligibility({
      buildId,
      checkpoint: "release",
      gateOutcome: "recommend",
      deliveryStatusOverride: "deployed",
    }),
  };
}

/**
 * Final autonomy recheck after delivery evidence exists but before a build is
 * mutated to complete. Shadow observes; enforce parks on withheld/unavailable
 * evidence; off preserves the legacy completion path.
 */
export async function mayCompleteAutonomousBuild(input: {
  buildId: string;
  logger?: Logger;
  deps?: CompletionGateDeps;
}): Promise<boolean> {
  const logger = input.logger ?? console;
  const deps = input.deps ?? await defaultDeps();
  const mode = deps.getMode();
  if (mode === "off") return true;
  try {
    const releaseGate = await deps.resolve(input.buildId);
    if (mode === "enforce" && !releaseGate.mayAct) {
      logger.log(
        `[auto-complete] ${input.buildId} parked at release: ${releaseGate.eligibility.blockers.join(", ")}`,
      );
      return false;
    }
    return true;
  } catch (error) {
    if (mode === "shadow") return true;
    logger.error(
      "[auto-complete] release eligibility failed closed for %s: %s",
      JSON.stringify(input.buildId),
      error instanceof Error
        ? JSON.stringify(error.message)
        : JSON.stringify(String(error)),
    );
    return false;
  }
}
