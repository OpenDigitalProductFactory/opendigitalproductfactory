import { resolveScheduledOwnerUserId } from "@/lib/queue/scheduled-owner";
import { isRecord } from "@/lib/shared/coerce";

import {
  workPatternCellKey,
  workPatternExperimentChildTaskRunId,
  workPatternExperimentDefinitionKey,
  workPatternExperimentLedgerId,
  workPatternExperimentParentTaskRunId,
  workPatternExperimentRunId,
  type WorkPatternExperimentDefinitionIdentity,
} from "./work-pattern-experiment-identity";
import {
  canTransitionWorkPatternExperiment,
  experimentLifecycleToTaskStatus,
  parseWorkPatternExperimentMetadata,
  type WorkPatternExperimentLifecycle,
  type WorkPatternExperimentMetadataV1,
} from "./work-pattern-experiment-types";

export type WorkPatternCellMetadata = {
  schemaVersion: 1;
  experimentRunId: string;
  experimentDefinitionKey: string;
  cellKey: string;
  pairKey: string;
  methodVariantKey: string;
  modelVariantKey: string;
  attempt: number;
};

export type WorkPatternStoredTaskRun = {
  id: string;
  taskRunId: string;
  userId: string;
  buildId?: string | null;
  initiatingAgentId: string | null;
  currentAgentId: string | null;
  parentTaskRunId: string | null;
  routeContext: string | null;
  title: string;
  objective: string;
  source: string;
  status: string;
  authorityScope: unknown;
  a2aMetadata: {
    workPatternExperiment?: WorkPatternExperimentMetadataV1;
    workPatternExperimentCell?: WorkPatternCellMetadata;
    [key: string]: unknown;
  };
  repeatedPatternKey: string | null;
};

export type WorkPatternTaskRunCreate = Omit<WorkPatternStoredTaskRun, "id">;

export type WorkPatternExperimentPersistenceSession = {
  listTaskRuns: (repeatedPatternKey: string) => Promise<WorkPatternStoredTaskRun[]>;
  findTaskRun: (taskRunId: string) => Promise<WorkPatternStoredTaskRun | null>;
  createTaskRun: (data: WorkPatternTaskRunCreate) => Promise<WorkPatternStoredTaskRun>;
  updateTaskRun: (
    taskRunId: string,
    data: Partial<Pick<WorkPatternStoredTaskRun, "status" | "a2aMetadata">>,
  ) => Promise<WorkPatternStoredTaskRun>;
  upsertLedger: (
    ledgerId: string,
    create: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
};

export type WorkPatternExperimentPersistence = WorkPatternExperimentPersistenceSession & {
  withDefinitionLock: <T>(
    definitionKey: string,
    work: (session: WorkPatternExperimentPersistenceSession) => Promise<T>,
  ) => Promise<T>;
};

export type WorkPatternExperimentStoreDeps = {
  persistence: WorkPatternExperimentPersistence;
  resolveOwnerUserId?: () => Promise<string>;
};

export type WorkPatternExperimentInput = {
  definition: WorkPatternExperimentDefinitionIdentity;
  activityKey: string;
  riskClass: WorkPatternExperimentMetadataV1["riskClass"];
  pairKey: string;
  cells: Array<{ methodVariantKey: string; modelVariantKey: string }>;
  orchestratingAgentId: string;
  buildId?: string;
  replicate?: number;
};

const TERMINAL_TASK_STATUSES = new Set([
  "completed",
  "failed",
  "canceled",
  "rejected",
  "archived",
]);

function patternStorageKey(definitionKey: string): string {
  return `work-pattern-experiment:${definitionKey}`;
}

function manifestFrom(row: WorkPatternStoredTaskRun): WorkPatternExperimentMetadataV1 | null {
  return parseWorkPatternExperimentMetadata(row.a2aMetadata.workPatternExperiment);
}

function childMetadataFrom(row: WorkPatternStoredTaskRun): WorkPatternCellMetadata | null {
  const value = row.a2aMetadata.workPatternExperimentCell;
  if (
    !isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.experimentRunId !== "string"
    || typeof value.experimentDefinitionKey !== "string"
    || typeof value.cellKey !== "string"
    || typeof value.pairKey !== "string"
    || typeof value.methodVariantKey !== "string"
    || typeof value.modelVariantKey !== "string"
    || typeof value.attempt !== "number"
    || !Number.isInteger(value.attempt)
    || value.attempt <= 0
  ) {
    return null;
  }
  return value as WorkPatternCellMetadata;
}

function nextReplicate(
  parents: readonly WorkPatternStoredTaskRun[],
  requested: number | undefined,
): number {
  const manifests = parents
    .map((row) => ({ row, manifest: manifestFrom(row) }))
    .filter(
      (entry): entry is { row: WorkPatternStoredTaskRun; manifest: WorkPatternExperimentMetadataV1 } =>
        entry.manifest !== null,
    );
  if (requested !== undefined) {
    if (!Number.isInteger(requested) || requested <= 0) throw new Error("invalid_replicate");
    return requested;
  }
  const resumable = manifests
    .filter(({ manifest }) => !["completed", "cancelled"].includes(manifest.lifecycle))
    .sort((left, right) => right.manifest.replicate - left.manifest.replicate)[0];
  if (resumable) return resumable.manifest.replicate;
  return Math.max(0, ...manifests.map(({ manifest }) => manifest.replicate)) + 1;
}

function assertNonEmpty(value: string, error: string): void {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(error);
}

export async function createOrResumeWorkPatternExperiment(
  input: WorkPatternExperimentInput,
  deps: WorkPatternExperimentStoreDeps,
): Promise<{
  parent: WorkPatternStoredTaskRun;
  manifest: WorkPatternExperimentMetadataV1;
  children: WorkPatternStoredTaskRun[];
  scheduledChildTaskRunIds: string[];
}> {
  assertNonEmpty(input.orchestratingAgentId, "missing_orchestrating_agent");
  assertNonEmpty(input.activityKey, "missing_activity_key");
  assertNonEmpty(input.pairKey, "missing_pair_key");
  if (input.cells.length === 0) throw new Error("missing_experiment_cells");

  // Resolve the accountable human before entering the write transaction so a
  // missing install owner cannot leave a partial manifest.
  const userId = await (deps.resolveOwnerUserId ?? resolveScheduledOwnerUserId)();
  const definitionKey = workPatternExperimentDefinitionKey(input.definition);
  const repeatedPatternKey = patternStorageKey(definitionKey);

  return deps.persistence.withDefinitionLock(definitionKey, async (session) => {
    const existing = await session.listTaskRuns(repeatedPatternKey);
    const parents = existing.filter((row) => row.parentTaskRunId === null);
    const replicate = nextReplicate(parents, input.replicate);
    const experimentRunId = workPatternExperimentRunId(definitionKey, replicate);
    const parentTaskRunId = workPatternExperimentParentTaskRunId(experimentRunId);
    const requiredCells = input.cells.map((cell) => ({
      ...cell,
      cellKey: workPatternCellKey(cell),
    }));
    if (new Set(requiredCells.map((cell) => cell.cellKey)).size !== requiredCells.length) {
      throw new Error("duplicate_experiment_cell");
    }

    const manifest: WorkPatternExperimentMetadataV1 = {
      schemaVersion: 1,
      experimentDefinitionKey: definitionKey,
      experimentRunId,
      replicate,
      patternKey: input.definition.patternKey,
      activityKey: input.activityKey,
      riskClass: input.riskClass,
      methodVariants: input.definition.methodVariants,
      modelVariants: input.definition.modelVariants,
      requiredCellKeys: requiredCells.map((cell) => cell.cellKey),
      taskCorpusKey: input.definition.taskCorpusKey,
      taskCorpusVersion: input.definition.taskCorpusVersion,
      oracleKey: input.definition.oracleKey,
      oracleVersion: input.definition.oracleVersion,
      promotionPolicyKey: input.definition.promotionPolicyKey,
      promotionPolicyVersion: input.definition.promotionPolicyVersion,
      installScope: input.definition.installScope,
      lifecycle: "planned",
    };

    let parent = await session.findTaskRun(parentTaskRunId);
    if (!parent) {
      parent = await session.createTaskRun({
        taskRunId: parentTaskRunId,
        userId,
        buildId: input.buildId ?? null,
        initiatingAgentId: input.orchestratingAgentId,
        currentAgentId: input.orchestratingAgentId,
        parentTaskRunId: null,
        routeContext: "build-studio/work-pattern-experiment",
        title: `Work-pattern experiment ${experimentRunId}`,
        objective: `Evaluate ${input.definition.patternKey} across governed factorial cells.`,
        source: input.buildId ? "build" : "proactive",
        status: experimentLifecycleToTaskStatus("planned"),
        authorityScope: [],
        a2aMetadata: { workPatternExperiment: manifest },
        repeatedPatternKey,
      });
    }
    const storedManifest = manifestFrom(parent);
    if (!storedManifest) throw new Error("invalid_stored_work_pattern_experiment_manifest");
    if (parent.status !== experimentLifecycleToTaskStatus(storedManifest.lifecycle)) {
      throw new Error("work_pattern_experiment_status_divergence");
    }

    const children: WorkPatternStoredTaskRun[] = [];
    const scheduledChildTaskRunIds: string[] = [];
    for (const cell of requiredCells) {
      const taskRunId = workPatternExperimentChildTaskRunId({
        experimentRunId,
        cellKey: cell.cellKey,
        pairKey: input.pairKey,
        attempt: 1,
      });
      let child = await session.findTaskRun(taskRunId);
      if (!child) {
        const cellMetadata: WorkPatternCellMetadata = {
          schemaVersion: 1,
          experimentRunId,
          experimentDefinitionKey: definitionKey,
          cellKey: cell.cellKey,
          pairKey: input.pairKey,
          methodVariantKey: cell.methodVariantKey,
          modelVariantKey: cell.modelVariantKey,
          attempt: 1,
        };
        child = await session.createTaskRun({
          taskRunId,
          userId,
          buildId: input.buildId ?? null,
          initiatingAgentId: input.orchestratingAgentId,
          currentAgentId: input.orchestratingAgentId,
          parentTaskRunId: parent.id,
          routeContext: "build-studio/work-pattern-experiment-cell",
          title: `Experiment cell ${cell.cellKey}`,
          objective: `Execute ${cell.cellKey} for ${experimentRunId}.`,
          source: input.buildId ? "build" : "proactive",
          status: "submitted",
          authorityScope: [],
          a2aMetadata: { workPatternExperimentCell: cellMetadata },
          repeatedPatternKey,
        });
      }
      children.push(child);
      if (!TERMINAL_TASK_STATUSES.has(child.status)) {
        scheduledChildTaskRunIds.push(child.taskRunId);
      }
    }

    return { parent, manifest: storedManifest, children, scheduledChildTaskRunIds };
  });
}

export async function createWorkPatternExperimentRetry(
  input: { parentTaskRunId: string; cellKey: string; pairKey: string },
  deps: WorkPatternExperimentStoreDeps,
): Promise<WorkPatternStoredTaskRun> {
  const userId = await (deps.resolveOwnerUserId ?? resolveScheduledOwnerUserId)();
  const parent = await deps.persistence.findTaskRun(input.parentTaskRunId);
  if (!parent) throw new Error("work_pattern_experiment_parent_not_found");
  const manifest = manifestFrom(parent);
  if (!manifest) throw new Error("invalid_stored_work_pattern_experiment_manifest");

  return deps.persistence.withDefinitionLock(
    manifest.experimentDefinitionKey,
    async (session) => {
      const rows = await session.listTaskRuns(
        patternStorageKey(manifest.experimentDefinitionKey),
      );
      const prior = rows
        .filter((row) => row.parentTaskRunId === parent.id)
        .map((row) => ({ row, metadata: childMetadataFrom(row) }))
        .filter(
          (entry): entry is { row: WorkPatternStoredTaskRun; metadata: WorkPatternCellMetadata } =>
            entry.metadata?.cellKey === input.cellKey
            && entry.metadata.pairKey === input.pairKey,
        )
        .sort((left, right) => right.metadata.attempt - left.metadata.attempt);
      const source = prior[0];
      if (!source) throw new Error("work_pattern_experiment_cell_not_found");
      const attempt = source.metadata.attempt + 1;
      const taskRunId = workPatternExperimentChildTaskRunId({
        experimentRunId: manifest.experimentRunId,
        cellKey: input.cellKey,
        pairKey: input.pairKey,
        attempt,
      });
      const existing = await session.findTaskRun(taskRunId);
      if (existing) return existing;
      const { id: _priorRowId, ...retrySource } = source.row;
      return session.createTaskRun({
        ...retrySource,
        taskRunId,
        userId,
        parentTaskRunId: parent.id,
        status: "submitted",
        a2aMetadata: {
          workPatternExperimentCell: { ...source.metadata, attempt },
        },
      });
    },
  );
}

export async function transitionWorkPatternExperiment(
  parentTaskRunId: string,
  lifecycle: WorkPatternExperimentLifecycle,
  deps: Pick<WorkPatternExperimentStoreDeps, "persistence">,
): Promise<WorkPatternStoredTaskRun> {
  const parent = await deps.persistence.findTaskRun(parentTaskRunId);
  if (!parent) throw new Error("work_pattern_experiment_parent_not_found");
  const initialManifest = manifestFrom(parent);
  if (!initialManifest) throw new Error("invalid_stored_work_pattern_experiment_manifest");
  return deps.persistence.withDefinitionLock(
    initialManifest.experimentDefinitionKey,
    async (session) => {
      const current = await session.findTaskRun(parentTaskRunId);
      if (!current) throw new Error("work_pattern_experiment_parent_not_found");
      const manifest = manifestFrom(current);
      if (!manifest) throw new Error("invalid_stored_work_pattern_experiment_manifest");
      if (current.status !== experimentLifecycleToTaskStatus(manifest.lifecycle)) {
        throw new Error("work_pattern_experiment_status_divergence");
      }
      if (!canTransitionWorkPatternExperiment(manifest.lifecycle, lifecycle)) {
        throw new Error(
          `illegal_work_pattern_experiment_transition:${manifest.lifecycle}:${lifecycle}`,
        );
      }
      return session.updateTaskRun(parentTaskRunId, {
        status: experimentLifecycleToTaskStatus(lifecycle),
        a2aMetadata: {
          ...current.a2aMetadata,
          workPatternExperiment: { ...manifest, lifecycle },
        },
      });
    },
  );
}

export async function recordWorkPatternExperimentEvidence(
  input: {
    experimentRunId: string;
    childTaskRunId: string;
    observationKind: string;
    sequence: number;
    orchestratingAgentId: string;
    activityType: string;
    riskClass: string;
    proposedDecision: unknown;
    actualDecision?: unknown;
    outcome?: unknown;
    metadata?: Record<string, unknown>;
    correction?: {
      supersedesLedgerId: string;
      invalidationReason: string;
    };
  },
  deps: Pick<WorkPatternExperimentStoreDeps, "persistence">,
): Promise<Record<string, unknown>> {
  assertNonEmpty(input.orchestratingAgentId, "missing_orchestrating_agent");
  if (input.correction) {
    assertNonEmpty(input.correction.supersedesLedgerId, "missing_superseded_ledger_id");
    assertNonEmpty(input.correction.invalidationReason, "missing_invalidation_reason");
  }
  const ledgerId = workPatternExperimentLedgerId(input);
  return deps.persistence.upsertLedger(ledgerId, {
    ledgerId,
    agentId: input.orchestratingAgentId,
    activityType: input.activityType,
    riskClass: input.riskClass,
    autonomyLevel: "shadow",
    proposedDecision: input.proposedDecision,
    ...(input.actualDecision !== undefined ? { actualDecision: input.actualDecision } : {}),
    ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
    sourceKind: "work-pattern-experiment",
    taskRunId: input.childTaskRunId,
    metadata: {
      experimentRunId: input.experimentRunId,
      observationKind: input.observationKind,
      sequence: input.sequence,
      ...(input.metadata ?? {}),
      ...(input.correction ?? {}),
    },
  });
}

type PrismaLike = {
  $transaction: <T>(
    work: (tx: PrismaLikeTransaction) => Promise<T>,
    options?: { isolationLevel: "Serializable" },
  ) => Promise<T>;
  taskRun: PrismaLikeTaskRun;
  decisionShadowLedger: {
    upsert: (args: unknown) => Promise<Record<string, unknown>>;
  };
};

type PrismaLikeTaskRun = {
  findMany: (args: unknown) => Promise<WorkPatternStoredTaskRun[]>;
  findUnique: (args: unknown) => Promise<WorkPatternStoredTaskRun | null>;
  create: (args: unknown) => Promise<WorkPatternStoredTaskRun>;
  update: (args: unknown) => Promise<WorkPatternStoredTaskRun>;
};

type PrismaLikeTransaction = Omit<PrismaLike, "$transaction"> & {
  $executeRaw: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
};

function prismaSession(client: Omit<PrismaLike, "$transaction">): WorkPatternExperimentPersistenceSession {
  return {
    listTaskRuns: (repeatedPatternKey) =>
      client.taskRun.findMany({ where: { repeatedPatternKey } }),
    findTaskRun: (taskRunId) =>
      client.taskRun.findUnique({ where: { taskRunId } }),
    createTaskRun: (data) =>
      client.taskRun.create({ data }),
    updateTaskRun: (taskRunId, data) =>
      client.taskRun.update({
        where: { taskRunId },
        data,
      }),
    upsertLedger: (ledgerId, create) =>
      client.decisionShadowLedger.upsert({
        where: { ledgerId },
        create,
        update: {},
      }),
  };
}

export function createPrismaWorkPatternExperimentPersistence(
  client: PrismaLike,
): WorkPatternExperimentPersistence {
  const root = prismaSession(client);
  return {
    ...root,
    withDefinitionLock: (definitionKey, work) =>
      client.$transaction(async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${definitionKey}, 0))
        `;
        return work(prismaSession(tx));
      }, { isolationLevel: "Serializable" }),
  };
}
