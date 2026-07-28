import type { AutonomyLevel } from "@/lib/autonomy/trust-graduation";
import type {
  AutonomousBuildCheckpoint,
  AutonomousBuildEligibility,
} from "@/lib/build/autonomous-build-eligibility";
import {
  createAutonomousBuildExecutionProfileRef,
  readAutonomousBuildEligibilitySnapshot,
  type AutonomousBuildExecutionProfileRefV1,
} from "@/lib/build/autonomous-build-eligibility-reader";
import { readBuildPrDeliveryState } from "@/lib/build/build-pr-delivery-state";
import type { DecisionOutcomeType } from "@/lib/decision-perspective/types";
import {
  deriveDeliverableSensitivity,
  getModelTier,
  type DeliverableSensitivity,
} from "@/lib/explore/build-process-matrix";
import { normalizeVerificationOutput } from "@/lib/build/verification-output";
import type { WorkPatternBindingRecord } from "@/lib/tak/work-pattern-binding-reader";

export type AutonomousBuildPhaseRuntimeRecord = {
  checkpoint: AutonomousBuildCheckpoint;
  mode: "off" | "shadow" | "enforce";
  evaluatedAt: string;
  heartbeatAt: string | null;
  eligibility: AutonomousBuildEligibility;
  executionProfileRef: AutonomousBuildExecutionProfileRefV1 | null;
};

type RuntimeBuildRow = {
  id?: string;
  title: string;
  description: string | null;
  kind: string;
  plan: unknown;
  verificationOut: unknown;
  buildExecState: unknown;
  workspaceState: unknown;
};

type RuntimeSelection = {
  status: "selected" | "blocked";
  selected: {
    providerId: string;
    modelId: string | null;
  } | null;
};

export type AutonomousBuildPhaseRuntimeDeps = {
  loadBuild(buildId: string): Promise<RuntimeBuildRow | null>;
  getMode(): "off" | "shadow" | "enforce";
  getSelection(input: {
    modelTier: "local" | "robust";
    sensitivity: "internal" | "confidential";
  }): Promise<RuntimeSelection | null>;
  getRegulatory(): Promise<{
    ceiling: AutonomyLevel;
    humanControlRequired: boolean;
  }>;
  getSandboxState(
    build: RuntimeBuildRow,
  ): Promise<"ready" | "drift" | "unavailable">;
  listBindings(agentId: string): Promise<WorkPatternBindingRecord[]>;
  recordEvaluation(
    buildId: string,
    record: AutonomousBuildPhaseRuntimeRecord,
  ): Promise<void>;
  now(): Date;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function planSensitivity(
  build: RuntimeBuildRow,
): DeliverableSensitivity {
  const plan = record(build.plan);
  const value = plan.deliverableSensitivity;
  if (value === "low" || value === "elevated" || value === "high") return value;
  return deriveDeliverableSensitivity({
    text: `${build.title}\n${build.description ?? ""}`,
    workType: build.kind,
  });
}

function effortSize(build: RuntimeBuildRow): string {
  const plan = record(build.plan);
  return typeof plan.processSize === "string" ? plan.processSize : "medium";
}

function oracleState(
  checkpoint: AutonomousBuildCheckpoint,
  verificationOut: unknown,
): "green" | "red" | "unavailable" {
  if (
    checkpoint !== "review"
    && checkpoint !== "ship"
    && checkpoint !== "pr"
    && checkpoint !== "release"
  ) {
    return "green";
  }
  const parsed = normalizeVerificationOutput(verificationOut);
  if (
    parsed.typecheckPassed === null
    || parsed.testsFailed === null
  ) {
    return "unavailable";
  }
  return parsed.typecheckPassed && parsed.testsFailed === 0 ? "green" : "red";
}

function recoveryBudgetExhausted(buildExecState: unknown): boolean {
  const recovery = record(record(buildExecState).autonomousRecovery);
  return (
    Array.isArray(recovery.emittedEscalationKeys)
    && recovery.emittedEscalationKeys.length > 0
  );
}

async function defaultDeps(): Promise<AutonomousBuildPhaseRuntimeDeps> {
  const { prisma } = await import("@dpf/db");
  return {
    loadBuild: async (buildId) => {
      const build = await prisma.featureBuild.findUnique({
        where: { buildId },
        select: {
          title: true,
          id: true,
          description: true,
          kind: true,
          plan: true,
          verificationOut: true,
          buildExecState: true,
        },
      });
      if (!build) return null;
      const capsule = await prisma.workCapsule.findFirst({
        where: { featureBuildId: build.id },
        select: { workspaceState: true },
        orderBy: { updatedAt: "desc" },
      });
      return { ...build, workspaceState: capsule?.workspaceState ?? null };
    },
    getMode: () => {
      const value = process.env.DPF_BUILD_AUTONOMOUS_PLAYBOOK_MODE
        ?.trim()
        .toLowerCase();
      return value === "shadow" || value === "enforce" ? value : "off";
    },
    getSelection: async ({ modelTier, sensitivity }) => {
      const { getBuildStudioConfig } = await import(
        "@/lib/integrate/build-studio-config"
      );
      const selection = (await getBuildStudioConfig({
        modelTier,
        sensitivity,
      })).selection;
      return selection
        ? {
            status: selection.status,
            selected: selection.selected
              ? {
                  providerId: selection.selected.providerId,
                  modelId: selection.selected.modelId,
                }
              : null,
          }
        : null;
    },
    getRegulatory: async () => {
      const { resolveRuntimeRegulatoryAutonomyCeiling } = await import(
        "@/lib/autonomy/regulatory-autonomy-runtime"
      );
      const runtime = await resolveRuntimeRegulatoryAutonomyCeiling(
        prisma as never,
        {
          activityClass: "build.implement",
        },
      );
      return {
        ceiling: runtime.resolution.ceiling,
        humanControlRequired: runtime.resolution.humanControlRequired,
      };
    },
    getSandboxState: async (build) => {
      const state = record(build.buildExecState);
      if (
        typeof state.error === "string"
        && state.error.includes("blocked_sandbox_drift")
      ) {
        return "drift";
      }
      const { isSandboxAvailable } = await import(
        "@/lib/integrate/sandbox/build-branch"
      );
      return await isSandboxAvailable() ? "ready" : "unavailable";
    },
    listBindings: async (agentId) => {
      const { listWorkPatternBindingsForAgent } = await import(
        "@/lib/tak/work-pattern-binding-reader"
      );
      return listWorkPatternBindingsForAgent(agentId);
    },
    recordEvaluation: async (buildId, evaluation) => {
      const current = await prisma.featureBuild.findUnique({
        where: { buildId },
        select: { buildExecState: true },
      });
      const buildExecState = record(current?.buildExecState);
      await prisma.featureBuild.update({
        where: { buildId },
        data: {
          buildExecState: {
            ...buildExecState,
            autonomousCustody: evaluation,
          },
        },
      });
      await prisma.buildActivity.create({
        data: {
          buildId,
          tool: evaluation.mode === "shadow"
            ? "autonomous_playbook_shadow"
            : "autonomous_playbook_gate",
          summary:
            `${evaluation.checkpoint}: ${evaluation.eligibility.eligible ? "eligible" : "ineligible"}; `
            + `next=${evaluation.eligibility.nextGovernedAction}; `
            + `blockers=${evaluation.eligibility.blockers.join(",") || "none"}.`,
        },
      });
      if (evaluation.executionProfileRef) {
        const taskRun = await prisma.taskRun.findFirst({
          where: {
            buildId,
            status: { in: ["submitted", "working", "input-required"] },
          },
          select: { id: true, a2aMetadata: true },
          orderBy: { createdAt: "desc" },
        });
        if (taskRun) {
          const a2aMetadata = record(taskRun.a2aMetadata);
          await prisma.taskRun.update({
            where: { id: taskRun.id },
            data: {
              a2aMetadata: {
                ...a2aMetadata,
                workPattern: {
                  ...record(a2aMetadata.workPattern),
                  executionProfileRef: evaluation.executionProfileRef,
                },
              },
            },
          });
        }
      }
    },
    now: () => new Date(),
  };
}

export async function resolveAutonomousBuildPhaseEligibility(
  input: {
    buildId: string;
    checkpoint: AutonomousBuildCheckpoint;
    gateOutcome: DecisionOutcomeType;
    sensitivityOverride?: DeliverableSensitivity;
    deliveryStatusOverride?: import(
      "@/lib/build/build-pr-delivery-state"
    ).BuildPrDeliveryStatus | null;
  },
  deps?: AutonomousBuildPhaseRuntimeDeps,
): Promise<{
  mode: "off" | "shadow" | "enforce";
  observationEligible: boolean;
  mayAct: boolean;
  eligibility: AutonomousBuildEligibility;
  executionProfileRef: AutonomousBuildExecutionProfileRefV1 | null;
}> {
  const runtime = deps ?? await defaultDeps();
  const build = await runtime.loadBuild(input.buildId);
  if (!build) throw new Error(`autonomous_build_missing:${input.buildId}`);

  const mode = runtime.getMode();
  const sensitivity = input.sensitivityOverride ?? planSensitivity(build);
  const size = effortSize(build);
  const modelTier = getModelTier(build.kind, size, {
    qualityFirst: true,
    sensitivity,
  });
  const modelProfileId =
    modelTier === "robust" ? "frontier-coding" : "local-coding";
  const [selection, regulatory, sandboxState] = await Promise.all([
    runtime.getSelection({
      modelTier,
      sensitivity: sensitivity === "high" ? "confidential" : "internal",
    }),
    runtime.getRegulatory(),
    runtime.getSandboxState(build),
  ]);
  const delivery = readBuildPrDeliveryState(build.workspaceState);
  const snapshot = await readAutonomousBuildEligibilitySnapshot({
    agentId: "build-specialist",
    bindingScope: {
      activityKey: "build.implement",
      installScope: "dpf_dogfood",
      taskCorpusKey: "dpf-repository",
      modelProfileId,
      now: runtime.now(),
      freshnessWindowMs: 30 * 24 * 60 * 60 * 1000,
    },
    eligibility: {
      checkpoint: input.checkpoint,
      sensitivity,
      workType: build.kind,
      effortSize: size,
      gateOutcome: input.gateOutcome,
      oracles: oracleState(input.checkpoint, build.verificationOut),
      providerReady:
        selection?.status === "selected" && selection.selected != null,
      sandboxState,
      regulatory,
      recoveryBudgetExhausted: recoveryBudgetExhausted(
        build.buildExecState,
      ),
      deliveryStatus:
        input.deliveryStatusOverride === undefined
          ? delivery?.status ?? null
          : input.deliveryStatusOverride,
    },
  }, { listBindings: runtime.listBindings });
  const executionProfileRef =
    snapshot.eligibility.eligible
    && snapshot.binding
    && selection?.selected
      ? createAutonomousBuildExecutionProfileRef({
          binding: snapshot.binding,
          modelProfileId,
          providerId: selection.selected.providerId,
          modelId: selection.selected.modelId,
        })
      : null;
  const now = runtime.now().toISOString();
  await runtime.recordEvaluation(input.buildId, {
    checkpoint: input.checkpoint,
    mode,
    evaluatedAt: now,
    heartbeatAt:
      mode === "enforce" && snapshot.eligibility.eligible ? now : null,
    eligibility: snapshot.eligibility,
    executionProfileRef,
  });

  return {
    mode,
    observationEligible: snapshot.eligibility.eligible,
    mayAct: mode === "enforce" && snapshot.eligibility.eligible,
    eligibility: snapshot.eligibility,
    executionProfileRef,
  };
}
