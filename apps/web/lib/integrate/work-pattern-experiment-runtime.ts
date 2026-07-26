import { createHash } from "node:crypto";

import { isRecord } from "@/lib/shared/coerce";
import {
  parseWorkPatternExecutionProfile,
  type WorkPatternExecutionProfile,
} from "@/lib/tak/work-pattern-experiment-types";

import {
  executeWorkPatternExperimentCell,
  type WorkPatternExperimentCellRequest,
} from "./work-pattern-experiment-adapter";

type ReplayMessage = {
  role: "user" | "assistant";
  content: string;
};

type HermeticInferenceFixture = {
  schemaVersion: 1;
  kind: "inference-replay-v1";
  messages: ReplayMessage[];
  systemPrompt: string;
  methodInstructions: Record<string, string>;
  oracle: {
    kind: "exact" | "contains";
    expected: string;
  };
};

type RuntimeContext = {
  taskRun: {
    taskRunId: string;
    currentAgentId: string | null;
    initiatingAgentId: string | null;
    a2aMetadata: unknown;
  };
  fixtureParts: unknown;
};

export type PersistedWorkPatternRuntimeDeps = {
  loadContext: (
    taskRunId: string,
    fixtureKey: string,
  ) => Promise<RuntimeContext | null>;
  infer: (input: {
    messages: ReplayMessage[];
    systemPrompt: string;
    profile: WorkPatternExecutionProfile;
    agentId: string;
  }) => Promise<{
    content: string;
    providerId: string;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
  }>;
  updateTaskRun: (input: {
    taskRunId: string;
    status: "working" | "completed" | "failed";
    a2aMetadata: Record<string, unknown>;
  }) => Promise<void>;
  recordEvidence: (input: {
    experimentRunId: string;
    childTaskRunId: string;
    observationKind: "assignment" | "outcome";
    sequence: number;
    orchestratingAgentId: string;
    activityType: string;
    riskClass: string;
    proposedDecision: unknown;
    actualDecision?: unknown;
    outcome?: unknown;
    metadata?: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
};

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parsePersistedWorkPatternExperimentExecution(
  value: unknown,
): WorkPatternExperimentCellRequest | null {
  if (!isRecord(value)) return null;
  const executionProfile = parseWorkPatternExecutionProfile(value.executionProfile);
  const requiredStrings = [
    "experimentRunId",
    "childTaskRunId",
    "cellKey",
    "pairKey",
    "methodVariantKey",
    "modelVariantKey",
    "fixtureKey",
    "oracleKey",
    "oracleVersion",
    "resourcePolicyKey",
  ] as const;
  if (
    !executionProfile
    || requiredStrings.some((field) => !nonEmptyString(value[field]))
  ) {
    return null;
  }
  return {
    experimentRunId: value.experimentRunId as string,
    childTaskRunId: value.childTaskRunId as string,
    cellKey: value.cellKey as string,
    pairKey: value.pairKey as string,
    methodVariantKey: value.methodVariantKey as string,
    modelVariantKey: value.modelVariantKey as string,
    executionProfile,
    fixtureKey: value.fixtureKey as string,
    oracleKey: value.oracleKey as string,
    oracleVersion: value.oracleVersion as string,
    resourcePolicyKey: value.resourcePolicyKey as string,
  };
}

function parseFixture(value: unknown): HermeticInferenceFixture | null {
  if (
    !isRecord(value)
    || value.schemaVersion !== 1
    || value.kind !== "inference-replay-v1"
    || !Array.isArray(value.messages)
    || value.messages.length === 0
    || !nonEmptyString(value.systemPrompt)
    || !isRecord(value.methodInstructions)
    || !isRecord(value.oracle)
    || !["exact", "contains"].includes(String(value.oracle.kind))
    || !nonEmptyString(value.oracle.expected)
  ) {
    return null;
  }
  const messages: ReplayMessage[] = [];
  for (const message of value.messages) {
    if (
      !isRecord(message)
      || !["user", "assistant"].includes(String(message.role))
      || !nonEmptyString(message.content)
    ) {
      return null;
    }
    messages.push({
      role: message.role as ReplayMessage["role"],
      content: message.content,
    });
  }
  const methodInstructions: Record<string, string> = {};
  for (const [digest, instruction] of Object.entries(value.methodInstructions)) {
    if (!nonEmptyString(digest) || !nonEmptyString(instruction)) return null;
    methodInstructions[digest] = instruction;
  }
  return {
    schemaVersion: 1,
    kind: "inference-replay-v1",
    messages,
    systemPrompt: value.systemPrompt,
    methodInstructions,
    oracle: {
      kind: value.oracle.kind as HermeticInferenceFixture["oracle"]["kind"],
      expected: value.oracle.expected,
    },
  };
}

function oraclePasses(fixture: HermeticInferenceFixture, content: string): boolean {
  const actual = content.trim();
  const expected = fixture.oracle.expected.trim();
  return fixture.oracle.kind === "exact"
    ? actual === expected
    : actual.includes(expected);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function defaultDeps(): Promise<PersistedWorkPatternRuntimeDeps> {
  const { prisma } = await import("@dpf/db");
  const {
    createPrismaWorkPatternExperimentPersistence,
    recordWorkPatternExperimentEvidence,
  } = await import("@/lib/tak/work-pattern-experiment-store");
  const persistence = createPrismaWorkPatternExperimentPersistence(prisma as never);
  return {
    loadContext: async (taskRunId, fixtureKey) => {
      const [taskRun, artifact] = await Promise.all([
        prisma.taskRun.findUnique({
          where: { taskRunId },
          select: {
            taskRunId: true,
            currentAgentId: true,
            initiatingAgentId: true,
            a2aMetadata: true,
          },
        }),
        prisma.taskArtifact.findUnique({
          where: { artifactId: fixtureKey },
          select: { parts: true },
        }),
      ]);
      return taskRun && artifact
        ? { taskRun, fixtureParts: artifact.parts }
        : null;
    },
    infer: async ({ messages, systemPrompt, profile, agentId }) => {
      const { routeAndCall } = await import("@/lib/routed-inference");
      const result = await routeAndCall(
        messages,
        systemPrompt,
        "internal",
        {
          taskType: profile.activityKey,
          preferredProviderId: profile.providerId,
          preferredModelId: profile.modelId,
          agentId,
          persistDecision: true,
        },
      );
      return {
        content: result.content,
        providerId: result.providerId,
        modelId: result.modelId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      };
    },
    updateTaskRun: async ({ taskRunId, status, a2aMetadata }) => {
      await prisma.taskRun.update({
        where: { taskRunId },
        data: {
          status,
          a2aMetadata: a2aMetadata as never,
          lastHeartbeatAt: status === "working" ? new Date() : null,
          ...(status === "completed" || status === "failed"
            ? { completedAt: new Date() }
            : {}),
        },
      });
    },
    recordEvidence: (input) =>
      recordWorkPatternExperimentEvidence(input, { persistence }),
  };
}

/**
 * Executes the first evidence-cleared autonomous lane: immutable inference
 * replay fixtures. Mutable code workspaces and live/customer side effects are
 * outside this executor and therefore fail closed at fixture parsing.
 */
export async function executePersistedWorkPatternExperimentCell(
  taskRunId: string,
  value: unknown,
  injected?: PersistedWorkPatternRuntimeDeps,
) {
  const request = parsePersistedWorkPatternExperimentExecution(value);
  if (!request || request.childTaskRunId !== taskRunId) {
    throw new Error(`invalid_work_pattern_experiment_execution_request:${taskRunId}`);
  }
  if (request.executionProfile.environmentKey !== "shadow") {
    throw new Error(`work_pattern_experiment_authority_ceiling:${taskRunId}`);
  }

  const deps = injected ?? await defaultDeps();
  const context = await deps.loadContext(taskRunId, request.fixtureKey);
  const fixture = context ? parseFixture(context.fixtureParts) : null;
  if (!context || !fixture) {
    throw new Error(`work_pattern_experiment_fixture_unavailable:${request.fixtureKey}`);
  }
  const agentId = context.taskRun.currentAgentId ?? context.taskRun.initiatingAgentId;
  if (!agentId) throw new Error(`work_pattern_experiment_orchestrator_unavailable:${taskRunId}`);
  const instruction =
    fixture.methodInstructions[request.executionProfile.promptOrSkillDigest];
  if (!instruction) {
    throw new Error(
      `work_pattern_experiment_method_unavailable:${request.executionProfile.promptOrSkillDigest}`,
    );
  }

  const existingMetadata = isRecord(context.taskRun.a2aMetadata)
    ? context.taskRun.a2aMetadata
    : {};
  await deps.updateTaskRun({
    taskRunId,
    status: "working",
    a2aMetadata: existingMetadata,
  });
  await deps.recordEvidence({
    experimentRunId: request.experimentRunId,
    childTaskRunId: taskRunId,
    observationKind: "assignment",
    sequence: 0,
    orchestratingAgentId: agentId,
    activityType: request.executionProfile.activityKey,
    riskClass: request.executionProfile.riskClass,
    proposedDecision: {
      cellKey: request.cellKey,
      executionProfile: request.executionProfile,
      fixtureKey: request.fixtureKey,
      oracleKey: request.oracleKey,
      oracleVersion: request.oracleVersion,
      resourcePolicyKey: request.resourcePolicyKey,
    },
  });

  let inferenceContent = "";
  let inputTokens = 0;
  let outputTokens = 0;
  const result = await executeWorkPatternExperimentCell(request, {
    prepareWorkspace: async () => ({
      workspaceId: `${request.childTaskRunId}:${request.executionProfile.sourceCommitSha}`,
      workdir: `artifact://${request.fixtureKey}`,
    }),
    dispatch: async () => {
      const inference = await deps.infer({
        messages: fixture.messages,
        systemPrompt: `${fixture.systemPrompt}\n\n${instruction}`,
        profile: request.executionProfile,
        agentId,
      });
      inferenceContent = inference.content;
      inputTokens = inference.inputTokens;
      outputTokens = inference.outputTokens;
      return {
        success: true,
        providerId: inference.providerId,
        modelId: inference.modelId,
        filesChanged: [],
        toolCalls: 1,
        toolFailures: 0,
      };
    },
    verify: async () => ({
      unitTests: oraclePasses(fixture, inferenceContent) ? "pass" : "fail",
      productionBuild: "not-run",
      uxVerification: "not-applicable",
      migration: "not-applicable",
    }),
  });

  const compactResult = {
    success: result.success,
    actualProviderId: result.actualProviderId,
    actualModelId: result.actualModelId,
    workspaceId: result.workspaceId,
    outputDigest: digest(inferenceContent),
    inputTokens,
    outputTokens,
    buildGate: result.buildGate,
  };
  await deps.recordEvidence({
    experimentRunId: request.experimentRunId,
    childTaskRunId: taskRunId,
    observationKind: "outcome",
    sequence: 1,
    orchestratingAgentId: agentId,
    activityType: request.executionProfile.activityKey,
    riskClass: request.executionProfile.riskClass,
    proposedDecision: { cellKey: request.cellKey },
    actualDecision: {
      actualProviderId: result.actualProviderId,
      actualModelId: result.actualModelId,
    },
    outcome: compactResult,
  });
  await deps.updateTaskRun({
    taskRunId,
    status: result.success ? "completed" : "failed",
    a2aMetadata: {
      ...existingMetadata,
      workPatternExperimentResult: compactResult,
    },
  });
  return result;
}
