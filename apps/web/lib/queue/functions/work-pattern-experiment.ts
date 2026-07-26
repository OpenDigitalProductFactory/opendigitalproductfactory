import { inngest } from "../inngest-client";

type ExperimentQueueCell = {
  taskRunId: string;
  status: string;
};

export type RunWorkPatternExperimentDeps = {
  loadCells: (parentTaskRunId: string) => Promise<ExperimentQueueCell[]>;
  executeCell: (cell: ExperimentQueueCell) => Promise<unknown>;
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
  await deps.transition(input.parentTaskRunId, "completed");
  return { executed };
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
              select: { taskRunId: true, status: true },
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
          transition: (taskRunId, lifecycle) =>
            transitionWorkPatternExperiment(taskRunId, lifecycle, { persistence }),
        },
      );
    });
  },
);
