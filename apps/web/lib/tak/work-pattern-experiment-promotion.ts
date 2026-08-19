import type { Prisma } from "@dpf/db";

import { isRecord } from "@/lib/shared/coerce";
import {
  parsePersistedWorkPatternExperimentExecution,
} from "@/lib/build/work-pattern-experiment-runtime";

import {
  activateWorkPattern,
  type WorkPatternActivationRequest,
  type WorkPatternActivationSnapshot,
} from "./work-pattern-activation";
import {
  resolveEffectiveWorkPatternLedger,
  type WorkPatternLedgerRow,
} from "./work-pattern-effective-ledger";
import {
  parseWorkPatternExperimentMetadata,
  type WorkPatternExperimentMetadataV1,
} from "./work-pattern-experiment-types";
import {
  parseWorkPatternOutcomeEvidence,
  type WorkPatternOutcomeEvidence,
} from "./work-pattern-outcome-evidence";

export type WorkPatternPromotionExperimentCell = {
  taskRunId: string;
  status: string;
  completedAt: Date | null;
  evidenceRows: Array<
    WorkPatternLedgerRow & {
      taskRunId: string | null;
      proposedDecision: unknown;
      outcome: unknown;
      observedAt: Date;
    }
  >;
};

export type WorkPatternPromotionExperimentRun = {
  parentTaskRunId: string;
  manifest: WorkPatternExperimentMetadataV1;
  cells: WorkPatternPromotionExperimentCell[];
};

export type WorkPatternPromotionCandidate = {
  snapshot: WorkPatternActivationSnapshot;
  request: WorkPatternActivationRequest;
};

type ParsedCell = {
  status: string;
  completedAt: Date | null;
  request: NonNullable<
    ReturnType<typeof parsePersistedWorkPatternExperimentExecution>
  >;
  success: boolean;
  actualProviderId: string;
  actualModelId: string;
  outcome: WorkPatternOutcomeEvidence;
};

type PromotionDb = {
  taskRun: {
    findUnique(args: object): Promise<unknown>;
    findMany(args: object): Promise<unknown[]>;
  };
  decisionShadowLedger: {
    findMany(args: object): Promise<unknown[]>;
  };
};

const REQUIRED_FACTORIAL_CELLS = [
  "control",
  "method",
  "model",
  "interaction",
] as const;

function parseCell(cell: WorkPatternPromotionExperimentCell): ParsedCell | null {
  const effectiveRows = resolveEffectiveWorkPatternLedger(cell.evidenceRows);
  const assignments = effectiveRows.filter((row) =>
    row.taskRunId === cell.taskRunId
    && isRecord(row.metadata)
    && row.metadata.observationKind === "assignment"
    && isRecord(row.proposedDecision)
  );
  const outcomes = effectiveRows.filter((row) =>
    row.taskRunId === cell.taskRunId
    && isRecord(row.metadata)
    && row.metadata.observationKind === "outcome"
    && isRecord(row.outcome)
  );
  if (assignments.length !== 1 || outcomes.length !== 1) return null;
  const effectiveAssignment = assignments[0];
  const effectiveOutcome = outcomes[0];
  const result = effectiveOutcome?.outcome;
  if (!isRecord(result)) return null;
  const request = parsePersistedWorkPatternExperimentExecution(
    effectiveAssignment?.proposedDecision,
  );
  const outcome = parseWorkPatternOutcomeEvidence(result?.outcomeEvidence);
  if (
    !request
    || !result
    || !outcome
    || typeof result.success !== "boolean"
    || typeof result.actualProviderId !== "string"
    || typeof result.actualModelId !== "string"
  ) {
    return null;
  }
  return {
    status: cell.status,
    completedAt: effectiveOutcome.observedAt,
    request,
    success: result.success,
    actualProviderId: result.actualProviderId,
    actualModelId: result.actualModelId,
    outcome,
  };
}

function buildEvidenceCleared(cell: ParsedCell, activityKey: string): boolean {
  const gate = cell.outcome.buildGate;
  const buildGatePassed =
    gate.unitTests === "pass"
    && (
      activityKey !== "build.implement"
      || gate.productionBuild === "pass"
    )
    && gate.uxVerification !== "fail"
    && gate.uxVerification !== "blocked"
    && gate.migration !== "fail"
    && gate.migration !== "blocked";
  return (
    cell.status === "completed"
    && cell.success
    && cell.outcome.completed
    && cell.outcome.review.decision === "pass"
    && cell.outcome.review.reproducedBlockingFindings === 0
    && buildGatePassed
    && cell.actualProviderId === cell.request.executionProfile.providerId
    && cell.actualModelId === cell.request.executionProfile.modelId
  );
}

function comparable(left: ParsedCell, right: ParsedCell): boolean {
  const l = left.request;
  const r = right.request;
  return (
    l.pairKey === r.pairKey
    && l.fixtureKey === r.fixtureKey
    && l.oracleKey === r.oracleKey
    && l.oracleVersion === r.oracleVersion
    && l.resourcePolicyKey === r.resourcePolicyKey
    && l.executionProfile.sourceCommitSha === r.executionProfile.sourceCommitSha
    && l.executionProfile.taskCorpusKey === r.executionProfile.taskCorpusKey
    && l.executionProfile.taskCorpusVersion
      === r.executionProfile.taskCorpusVersion
  );
}

function costValue(outcome: WorkPatternOutcomeEvidence): number {
  if (outcome.execution.costUsd !== undefined) return outcome.execution.costUsd;
  if (
    outcome.execution.inputTokens !== undefined
    && outcome.execution.outputTokens !== undefined
  ) {
    return outcome.execution.inputTokens + outcome.execution.outputTokens;
  }
  return outcome.execution.toolCalls;
}

function relativeImprovement(baseline: number, candidate: number): number {
  if (!Number.isFinite(baseline) || !Number.isFinite(candidate) || baseline <= 0) {
    return 0;
  }
  return (baseline - candidate) / baseline;
}

function roundedMean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return Number(
    (values.reduce((sum, value) => sum + value, 0) / values.length)
      .toFixed(6),
  );
}

function hasCompleteFactorial(
  run: WorkPatternPromotionExperimentRun,
): boolean {
  const cells = run.cells.flatMap((cell) => {
    const parsed = parseCell(cell);
    return parsed ? [parsed] : [];
  });
  return run.manifest.methodVariants.every((method) =>
    run.manifest.modelVariants.every((model) =>
      cells.some((cell) =>
        cell.status === "completed"
        &&
        cell.request.methodVariantKey === method.methodVariantKey
        && cell.request.modelVariantKey === model.modelVariantKey)));
}

function latestEvidenceAt(
  cells: readonly ParsedCell[],
  fallback: Date,
): Date {
  const timestamps = cells
    .map((cell) => cell.completedAt?.getTime())
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)) : fallback;
}

export function deriveWorkPatternPromotionCandidates(input: {
  sourceExperimentTaskRunId: string;
  orchestratingAgentId: string;
  runs: readonly WorkPatternPromotionExperimentRun[];
  regulatoryHumanControlRequired: boolean;
  now?: Date;
}): WorkPatternPromotionCandidate[] {
  const sourceRun =
    input.runs.find(
      (run) => run.parentTaskRunId === input.sourceExperimentTaskRunId,
    )
    ?? input.runs.at(-1);
  if (!sourceRun) return [];
  const manifest = sourceRun.manifest;
  const baselineMethod = manifest.methodVariants[0];
  const candidateMethods = manifest.methodVariants.slice(1);
  if (!baselineMethod || candidateMethods.length === 0) return [];

  return candidateMethods.flatMap((candidateMethod) =>
    manifest.modelVariants.flatMap((model) => {
      const validPairs: Array<{
        baseline: ParsedCell;
        candidate: ParsedCell;
      }> = [];
      const observedCells: ParsedCell[] = [];
      const observedCandidates: ParsedCell[] = [];
      let invalidPairCount = 0;
      for (const run of input.runs) {
        const cells = run.cells.flatMap((cell) => {
          const parsed = parseCell(cell);
          return parsed ? [parsed] : [];
        });
        observedCells.push(...cells);
        const baseline = cells.find((cell) =>
          cell.request.methodVariantKey === baselineMethod.methodVariantKey
          && cell.request.modelVariantKey === model.modelVariantKey);
        const candidate = cells.find((cell) =>
          cell.request.methodVariantKey === candidateMethod.methodVariantKey
          && cell.request.modelVariantKey === model.modelVariantKey);
        if (candidate) observedCandidates.push(candidate);
        if (
          !baseline
          || !candidate
          || !comparable(baseline, candidate)
          || !buildEvidenceCleared(baseline, manifest.activityKey)
          || !buildEvidenceCleared(candidate, manifest.activityKey)
        ) {
          invalidPairCount += 1;
        } else {
          validPairs.push({ baseline, candidate });
        }
      }
      const sourceCell =
        validPairs.at(-1)?.candidate
        ?? sourceRun.cells.flatMap((cell) => {
          const parsed = parseCell(cell);
          return parsed
            && parsed.request.methodVariantKey === candidateMethod.methodVariantKey
            && parsed.request.modelVariantKey === model.modelVariantKey
            ? [parsed]
            : [];
        })[0];
      if (!sourceCell) return [];

      const allFactorial = input.runs.length > 0
        && input.runs.every(hasCompleteFactorial);
      const speedDeltas = validPairs.map(({ baseline, candidate }) =>
        relativeImprovement(
          baseline.outcome.execution.durationMs,
          candidate.outcome.execution.durationMs,
        ));
      const costDeltas = validPairs.map(({ baseline, candidate }) =>
        relativeImprovement(
          costValue(baseline.outcome),
          costValue(candidate.outcome),
        ));
      const evidenceCells = validPairs.flatMap((pair) => [
        pair.baseline,
        pair.candidate,
      ]);
      const freshnessAt = latestEvidenceAt(
        evidenceCells.length > 0 ? evidenceCells : observedCells,
        new Date(0),
      );
      const snapshot: WorkPatternActivationSnapshot = {
        agentId: input.orchestratingAgentId,
        patternKey: manifest.patternKey,
        baselinePatternVersion: baselineMethod.patternVersion,
        patternVersion: candidateMethod.patternVersion,
        sourceExperimentTaskRunId: input.sourceExperimentTaskRunId,
        source: {
          installScope: sourceCell.request.executionProfile.installScope,
          ...(sourceCell.request.executionProfile.organizationId
            ? {
                organizationId:
                  sourceCell.request.executionProfile.organizationId,
              }
            : {}),
          taskCorpusKey: manifest.taskCorpusKey,
          modelProfileId: model.modelProfileId,
        },
        portableCanonicalCorpus: null,
        corroborations: [],
        candidateEvidence: {
          patternKey: manifest.patternKey,
          patternVersion: candidateMethod.patternVersion,
          methodVariantKey: candidateMethod.methodVariantKey,
          modelProfileId: model.modelProfileId,
          taskCorpusKey: manifest.taskCorpusKey,
          taskCorpusVersion: manifest.taskCorpusVersion,
          oracleKey: manifest.oracleKey,
          oracleVersion: manifest.oracleVersion,
          promotionPolicyKey: manifest.promotionPolicyKey,
          promotionPolicyVersion: manifest.promotionPolicyVersion,
        },
        promotionEvidence: {
          activityKey: manifest.activityKey,
          riskClass: manifest.riskClass,
          validPairCount: validPairs.length,
          invalidPairCount,
          completedCellKeys: allFactorial
            ? [...REQUIRED_FACTORIAL_CELLS]
            : [],
          freshnessAt,
          rollbackBindingId: null,
          objectiveDeltas: {
            correctness: 0,
            security: 0,
            migrationSafety: 0,
            customerImpact: 0,
            speed: roundedMean(speedDeltas),
            cost: roundedMean(costDeltas),
          },
          commandmentGateRegression: observedCandidates.some(
            (candidate) =>
              candidate.outcome.failureClass === "commandment_gate_regression",
          ),
          criticalFindingReproduced: observedCandidates.some(
            (candidate) =>
              candidate.outcome.review.reproducedBlockingFindings > 0,
          ),
          regulatoryHumanControlRequired:
            input.regulatoryHumanControlRequired,
          activeBindingHealthRegression: false,
        },
        intrinsicGrantKeys: [],
      };
      const request: WorkPatternActivationRequest = {
        patternKey: snapshot.patternKey,
        patternVersion: snapshot.patternVersion,
        sourceExperimentTaskRunId: snapshot.sourceExperimentTaskRunId,
        requestedScope: {
          installScopes: [snapshot.source.installScope],
          organizationIds: snapshot.source.organizationId
            ? [snapshot.source.organizationId]
            : [],
          taskCorpusKeys: [snapshot.source.taskCorpusKey],
          modelProfileIds: [snapshot.source.modelProfileId],
        },
        grants: [],
        now: input.now ?? new Date(),
      };
      return [{ snapshot, request }];
    }),
  );
}

async function loadPromotionCandidates(
  db: PromotionDb,
  sourceExperimentTaskRunId: string,
  now = new Date(),
): Promise<WorkPatternPromotionCandidate[]> {
  const source = await db.taskRun.findUnique({
    where: { taskRunId: sourceExperimentTaskRunId },
    select: {
      repeatedPatternKey: true,
      currentAgentId: true,
      initiatingAgentId: true,
      a2aMetadata: true,
    },
  });
  if (!isRecord(source) || typeof source.repeatedPatternKey !== "string") {
    throw new Error("work_pattern_promotion_source_not_found");
  }
  const sourceManifest = parseWorkPatternExperimentMetadata(
    isRecord(source.a2aMetadata)
      ? source.a2aMetadata.workPatternExperiment
      : null,
  );
  const orchestratingAgentId =
    typeof source.currentAgentId === "string"
      ? source.currentAgentId
      : typeof source.initiatingAgentId === "string"
        ? source.initiatingAgentId
        : null;
  if (!sourceManifest || !orchestratingAgentId) {
    throw new Error("invalid_work_pattern_promotion_source");
  }

  const parentRows = await db.taskRun.findMany({
    where: {
      repeatedPatternKey: source.repeatedPatternKey,
      parentTaskRunId: null,
    },
    select: { id: true, taskRunId: true, a2aMetadata: true },
    orderBy: { createdAt: "asc" },
  });
  const runs: WorkPatternPromotionExperimentRun[] = [];
  for (const row of parentRows) {
    if (!isRecord(row) || typeof row.id !== "string" || typeof row.taskRunId !== "string") {
      continue;
    }
    const manifest = parseWorkPatternExperimentMetadata(
      isRecord(row.a2aMetadata)
        ? row.a2aMetadata.workPatternExperiment
        : null,
    );
    if (
      !manifest
      || manifest.experimentDefinitionKey
        !== sourceManifest.experimentDefinitionKey
    ) {
      continue;
    }
    const childRows = await db.taskRun.findMany({
      where: { parentTaskRunId: row.id },
      select: {
        taskRunId: true,
        status: true,
        completedAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    const childTaskRunIds = childRows.flatMap((child) =>
      isRecord(child) && typeof child.taskRunId === "string"
        ? [child.taskRunId]
        : []
    );
    const rawEvidenceRows = childTaskRunIds.length > 0
      ? await db.decisionShadowLedger.findMany({
          where: {
            sourceKind: "work-pattern-experiment",
            taskRunId: { in: childTaskRunIds },
          },
          select: {
            ledgerId: true,
            taskRunId: true,
            proposedDecision: true,
            outcome: true,
            metadata: true,
            observedAt: true,
          },
          orderBy: { observedAt: "asc" },
        })
      : [];
    const evidenceRows = rawEvidenceRows.flatMap((evidence) =>
      isRecord(evidence)
      && typeof evidence.ledgerId === "string"
      && (
        typeof evidence.taskRunId === "string"
        || evidence.taskRunId === null
      )
      && evidence.observedAt instanceof Date
        ? [{
            ledgerId: evidence.ledgerId,
            taskRunId: evidence.taskRunId,
            proposedDecision: evidence.proposedDecision,
            outcome: evidence.outcome,
            metadata: evidence.metadata,
            observedAt: evidence.observedAt,
          }]
        : []
    );
    runs.push({
      parentTaskRunId: row.taskRunId,
      manifest,
      cells: childRows.flatMap((child) =>
        isRecord(child)
        && typeof child.taskRunId === "string"
        && typeof child.status === "string"
          ? [{
              taskRunId: child.taskRunId,
              status: child.status,
              completedAt:
                child.completedAt instanceof Date ? child.completedAt : null,
              evidenceRows: evidenceRows.filter(
                (evidence) => evidence.taskRunId === child.taskRunId,
              ),
            }]
          : []),
    });
  }
  const { resolveRuntimeRegulatoryAutonomyCeiling } = await import(
    "@/lib/autonomy/regulatory-autonomy-runtime"
  );
  const regulatory = await resolveRuntimeRegulatoryAutonomyCeiling(
    db as never,
    { activityClass: sourceManifest.activityKey },
  );
  return deriveWorkPatternPromotionCandidates({
    sourceExperimentTaskRunId,
    orchestratingAgentId,
    runs,
    regulatoryHumanControlRequired:
      regulatory.resolution.humanControlRequired,
    now,
  });
}

export async function promoteCompletedWorkPatternExperiment(
  sourceExperimentTaskRunId: string,
): Promise<{ decisions: Array<Awaited<ReturnType<typeof activateWorkPattern>>> }> {
  const [{ prisma }, { createPrismaWorkPatternActivationPersistence }] =
    await Promise.all([
      import("@dpf/db"),
      import("./work-pattern-activation-persistence"),
    ]);
  const initial = await loadPromotionCandidates(
    prisma as unknown as PromotionDb,
    sourceExperimentTaskRunId,
  );
  const decisions = [];
  for (const candidate of initial) {
    const modelProfileId = candidate.snapshot.source.modelProfileId;
    const patternVersion = candidate.snapshot.patternVersion;
    const persistence = createPrismaWorkPatternActivationPersistence(
      async (tx: Prisma.TransactionClient) => {
        const refreshed = await loadPromotionCandidates(
          tx as unknown as PromotionDb,
          sourceExperimentTaskRunId,
        );
        const match = refreshed.find((entry) =>
          entry.snapshot.patternVersion === patternVersion
          && entry.snapshot.source.modelProfileId === modelProfileId);
        if (!match) throw new Error("work_pattern_promotion_snapshot_stale");
        return match.snapshot;
      },
    );
    decisions.push(
      await activateWorkPattern(candidate.request, { persistence }),
    );
  }
  return { decisions };
}
