// apps/web/lib/deliberation/bootstrapped-task-run.ts
//
// Identity of a TaskRun the deliberation orchestrator created because the
// caller supplied none. Exactly one writer settles such a run (BI-D208E70C):
// the orchestrator when it dispatched the branches itself, otherwise the async
// runner (queue/functions/deliberation-run.ts) — whatever routeContext the
// caller passed. Before this, the orchestrator settled the run, the runner
// re-marked it working, and only closed it again when routeContext was
// literally "deliberation"; every /build review deliberation leaked.

/** Business-id prefix the orchestrator stamps on a run it bootstrapped. */
export const BOOTSTRAPPED_TASK_RUN_PREFIX = "deliberation-";

export function isBootstrappedDeliberationTaskRunId(taskRunId: string): boolean {
  return taskRunId.startsWith(BOOTSTRAPPED_TASK_RUN_PREFIX);
}
