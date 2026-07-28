import { inngest } from "../inngest-client";

type ExperimentQueueCell = {
  taskRunId: string;
  status: string;
  a2aMetadata?: unknown;
};

export type RunWorkPatternExperimentDeps = {
  loadCells: (parentTaskRunId: string) => Promise<ExperimentQueueCell[]>;
  executeCell: (cell: ExperimentQueueCell) => Promise<unknown>;
  analyze: (
    parentTaskRunId: string,
    cells: ExperimentQueueCell[],
  ) => Promise<unknown> | unknown;
  promote: (
    parentTaskRunId: string,
  ) => Promise<unknown> | unknown;
  continueReplicates?: (
    parentTaskRunId: string,
    promotionResult: unknown,
  ) => Promise<unknown> | unknown;
  transition: (
    parentTaskRunId: string,
    lifecycle: "running" | "analyzing" | "completed",
  ) => Promise<unknown> | unknown;
};

const TERMINAL = new Set(["completed", "failed", "canceled", "rejected", "archived"]);

export async function runWorkPatternExperiment(
  input: { parentTaskRunId: string },
  deps: RunWorkPatternExperimentDeps,
): Promise<{ executed: number }> {
  await deps.transition(input.parentTaskRunId, "running");
  const cells = await deps.loadCells(input.parentTaskRunId);
  let executed = 0;
  for (const cell of cells) {
    if (TERMINAL.has(cell.status)) continue;
    await deps.executeCell(cell);
    executed += 1;
  }
  await deps.transition(input.parentTaskRunId, "analyzing");
  await deps.analyze(input.parentTaskRunId, await deps.loadCells(input.parentTaskRunId));
  const promotionResult = await deps.promote(input.parentTaskRunId);
  await deps.transition(input.parentTaskRunId, "completed");
  await deps.continueReplicates?.(input.parentTaskRunId, promotionResult);
  return { executed };
}

export async function enqueueWorkPatternExperiment(
  experimentRunId: string,
  parentTaskRunId: string,
) {
  return inngest.send({
    id: `work-pattern-experiment:${experimentRunId}`,
    name: "build/work-pattern-experiment.run",
    data: { parentTaskRunId },
  });
}

export const workPatternExperimentRun = inngest.createFunction(
  {
    id: "build/work-pattern-experiment",
    retries: 2,
    concurrency: [{ key: "event.data.parentTaskRunId", limit: 1 }],
    triggers: [{ event: "build/work-pattern-experiment.run" }],
  },
  async ({ event, step }) => {
    const parentTaskRunId = String(event.data.parentTaskRunId ?? "");
    if (!parentTaskRunId) throw new Error("missing_work_pattern_experiment_parent");

    return step.run("execute-work-pattern-experiment", async () => {
      const { prisma } = await import("@dpf/db");
      const {
        createPrismaWorkPatternExperimentPersistence,
        transitionWorkPatternExperiment,
      } = await import("@/lib/tak/work-pattern-experiment-store");
      const persistence = createPrismaWorkPatternExperimentPersistence(prisma as never);
      const parent = await prisma.taskRun.findUnique({
        where: { taskRunId: parentTaskRunId },
        select: { id: true },
      });
      if (!parent) throw new Error("work_pattern_experiment_parent_not_found");

      return runWorkPatternExperiment(
        { parentTaskRunId },
        {
          loadCells: () =>
            prisma.taskRun.findMany({
              where: { parentTaskRunId: parent.id },
              select: { taskRunId: true, status: true, a2aMetadata: true },
              orderBy: { createdAt: "asc" },
            }),
          // Dispatch wiring is intentionally fail-closed until each stored
          // child carries a validated execution request. The action seam that
          // creates those requests is delivered with the review scheduler.
          executeCell: async (cell) => {
            const row = await prisma.taskRun.findUnique({
              where: { taskRunId: cell.taskRunId },
              select: { a2aMetadata: true },
            });
            const metadata = row?.a2aMetadata as {
              workPatternExperimentCell?: {
                executionRequest?: unknown;
              };
            } | null;
            const executionRequest =
              metadata?.workPatternExperimentCell?.executionRequest;
            if (!executionRequest) {
              throw new Error(
                `missing_work_pattern_experiment_execution_request:${cell.taskRunId}`,
              );
            }
            const { executePersistedWorkPatternExperimentCell } = await import(
              "@/lib/integrate/work-pattern-experiment-runtime"
            );
            return executePersistedWorkPatternExperimentCell(
              cell.taskRunId,
              executionRequest,
            );
          },
          analyze: async (taskRunId, cells) => {
            const parentRow = await prisma.taskRun.findUnique({
              where: { taskRunId },
              select: { a2aMetadata: true },
            });
            const { isRecord } = await import("@/lib/shared/coerce");
            const {
              analyzeWorkPatternExperimentCells,
            } = await import("@/lib/tak/work-pattern-experiment-projection");
            const {
              parseWorkPatternExperimentMetadata,
            } = await import("@/lib/tak/work-pattern-experiment-types");
            const {
              parsePersistedWorkPatternExperimentExecution,
            } = await import("@/lib/integrate/work-pattern-experiment-runtime");
            const parentMetadata = isRecord(parentRow?.a2aMetadata)
              ? parentRow.a2aMetadata
              : {};
            const manifest = parseWorkPatternExperimentMetadata(
              parentMetadata.workPatternExperiment,
            );
            if (!manifest) {
              throw new Error(`invalid_work_pattern_experiment_parent:${taskRunId}`);
            }
            const observations = cells.flatMap((cell) => {
              if (!isRecord(cell.a2aMetadata)) return [];
              const cellMetadata = isRecord(
                cell.a2aMetadata.workPatternExperimentCell,
              )
                ? cell.a2aMetadata.workPatternExperimentCell
                : null;
              const result = isRecord(
                cell.a2aMetadata.workPatternExperimentResult,
              )
                ? cell.a2aMetadata.workPatternExperimentResult
                : null;
              const request = parsePersistedWorkPatternExperimentExecution(
                cellMetadata?.executionRequest,
              );
              if (
                !cellMetadata
                || !result
                || !request
                || typeof result.success !== "boolean"
                || typeof result.actualProviderId !== "string"
                || typeof result.actualModelId !== "string"
              ) {
                return [];
              }
              return [{
                status: cell.status,
                pairKey: request.pairKey,
                methodVariantKey: request.methodVariantKey,
                modelVariantKey: request.modelVariantKey,
                success: result.success,
                requestedProviderId: request.executionProfile.providerId,
                requestedModelId: request.executionProfile.modelId,
                actualProviderId: result.actualProviderId,
                actualModelId: result.actualModelId,
                fixtureKey: request.fixtureKey,
                sourceCommitSha: request.executionProfile.sourceCommitSha,
                taskCorpusKey: request.executionProfile.taskCorpusKey,
                taskCorpusVersion: request.executionProfile.taskCorpusVersion,
                oracleKey: request.oracleKey,
                oracleVersion: request.oracleVersion,
                resourcePolicyKey: request.resourcePolicyKey,
              }];
            });
            await prisma.taskRun.update({
              where: { taskRunId },
              data: {
                a2aMetadata: {
                  ...parentMetadata,
                  workPatternExperimentProjection:
                    analyzeWorkPatternExperimentCells(manifest, observations),
                } as never,
              },
            });
          },
          promote: async (taskRunId) => {
            const {
              promoteCompletedWorkPatternExperiment,
            } = await import("@/lib/tak/work-pattern-experiment-promotion");
            return promoteCompletedWorkPatternExperiment(taskRunId);
          },
          continueReplicates: async (taskRunId, promotionResult) => {
            const {
              scheduleNextWorkPatternExperimentReplicate,
            } = await import("@/lib/tak/work-pattern-experiment-scheduler");
            return scheduleNextWorkPatternExperimentReplicate({
              parentTaskRunId: taskRunId,
              promotionResult,
            });
          },
          transition: (taskRunId, lifecycle) =>
            transitionWorkPatternExperiment(taskRunId, lifecycle, { persistence }),
        },
      );
    });
  },
);
