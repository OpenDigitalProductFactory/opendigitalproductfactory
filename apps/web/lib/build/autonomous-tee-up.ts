import {
  evaluateAutonomousBuildEligibility,
  type AutonomousBuildEligibility,
} from "@/lib/build/autonomous-build-eligibility";

export type AutonomousTeeUpStart = {
  mode: "off" | "shadow" | "enforce";
  eligibility: AutonomousBuildEligibility | null;
};

export type AutonomousTeeUpItem = {
  title: string;
  body: string | null;
  effortSize: string | null;
  workType?: string | null;
};

export function shouldAutoApproveGovernedDraft(input: {
  governedBacklogEnabled: boolean;
  hasBody: boolean;
  autonomousStart?: AutonomousTeeUpStart;
}): boolean {
  if (!input.governedBacklogEnabled || !input.hasBody) return false;
  if (
    input.autonomousStart == null
    || input.autonomousStart.mode === "off"
    || input.autonomousStart.mode === "shadow"
  ) {
    return true;
  }
  return (
    input.autonomousStart.eligibility?.eligible === true
    && input.autonomousStart.eligibility.nextGovernedAction === "auto-start"
  );
}

export async function resolveAutonomousTeeUpStart(input: {
  item: AutonomousTeeUpItem;
  db: unknown;
}): Promise<AutonomousTeeUpStart> {
  const { item } = input;
  const { getAutonomousPlaybookMode, getBuildStudioConfig } = await import(
    "@/lib/integrate/build-studio-config"
  );
  const mode = getAutonomousPlaybookMode();
  if (mode === "off") return { mode, eligibility: null };

  try {
    const {
      deriveDeliverableSensitivity,
      getModelTier,
    } = await import("@/lib/explore/build-process-matrix");
    const sensitivity = deriveDeliverableSensitivity({
      text: `${item.title}\n${item.body ?? ""}`,
      workType: item.workType,
    });
    const modelTier = getModelTier(item.workType, item.effortSize, {
      qualityFirst: true,
      sensitivity,
    });
    const modelProfileId =
      modelTier === "robust" ? "frontier-coding" : "local-coding";
    const config = await getBuildStudioConfig({
      modelTier,
      sensitivity: sensitivity === "high" ? "confidential" : "internal",
    });
    const { resolveRuntimeRegulatoryAutonomyCeiling } = await import(
      "@/lib/autonomy/regulatory-autonomy-runtime"
    );
    const regulatory = await resolveRuntimeRegulatoryAutonomyCeiling(
      input.db as never,
      { activityClass: "build.implement" },
    );
    const { readAutonomousBuildEligibility } = await import(
      "@/lib/build/autonomous-build-eligibility-reader"
    );
    const selection = config.selection;
    const eligibility = await readAutonomousBuildEligibility({
      agentId: "build-specialist",
      bindingScope: {
        activityKey: "build.implement",
        installScope: "dpf_dogfood",
        taskCorpusKey: "dpf-repository",
        modelProfileId,
        freshnessWindowMs: 30 * 24 * 60 * 60 * 1000,
      },
      eligibility: {
        checkpoint: "intake",
        sensitivity,
        workType: item.workType,
        effortSize: item.effortSize,
        gateOutcome: "recommend",
        oracles: "green",
        providerReady:
          selection?.status === "selected" && selection.selected != null,
        sandboxState: "ready",
        regulatory: {
          ceiling: regulatory.resolution.ceiling,
          humanControlRequired:
            regulatory.resolution.humanControlRequired,
        },
        recoveryBudgetExhausted: false,
        deliveryStatus: null,
      },
    });
    return { mode, eligibility };
  } catch {
    return {
      mode,
      eligibility: evaluateAutonomousBuildEligibility({
        checkpoint: "intake",
        sensitivity: "high",
        workType: item.workType,
        effortSize: item.effortSize,
        gateOutcome: "escalate",
        oracles: "unavailable",
        attribution: null,
        providerReady: false,
        sandboxState: "unavailable",
        regulatory: { ceiling: "propose", humanControlRequired: true },
        recoveryBudgetExhausted: false,
        deliveryStatus: null,
      }),
    };
  }
}
