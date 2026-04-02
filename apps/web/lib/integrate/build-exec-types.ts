// apps/web/lib/build-exec-types.ts
// Types for the checkpoint-based build execution pipeline.

export type BuildExecStep =
  | "pending"
  | "sandbox_created"
  | "workspace_initialized"
  | "db_ready"
  | "deps_installed"
  | "code_generated"
  | "tests_run"
  | "complete"
  | "failed";

export type BuildExecutionState = {
  step: BuildExecStep;
  failedAt?: string;
  error?: string;
  retryCount: number;
  containerId?: string;
  dbContainerId?: string;
  neo4jContainerId?: string;
  qdrantContainerId?: string;
  networkId?: string;
  hostPort?: number;
  startedAt: string;
  completedAt?: string;
};

export const STEP_ORDER: BuildExecStep[] = [
  "pending",
  "sandbox_created",
  "workspace_initialized",
  "db_ready",
  "deps_installed",
  "code_generated",
  "tests_run",
  "complete",
];

export const STEP_LABELS: Record<BuildExecStep, string> = {
  pending: "Pending",
  sandbox_created: "Creating sandbox...",
  workspace_initialized: "Copying project...",
  db_ready: "Initializing database...",
  deps_installed: "Installing dependencies...",
  code_generated: "Generating code...",
  tests_run: "Running tests...",
  complete: "Complete",
  failed: "Failed",
};

export const MAX_RETRIES: Record<BuildExecStep, number> = {
  pending: 0,
  sandbox_created: 3,
  workspace_initialized: 2,
  db_ready: 3,
  deps_installed: 2,
  code_generated: 2,
  tests_run: 0,
  complete: 0,
  failed: 0,
};

export const RETRY_DELAYS_MS = [2000, 4000, 8000];

export function initialExecState(): BuildExecutionState {
  return {
    step: "pending",
    retryCount: 0,
    startedAt: new Date().toISOString(),
  };
}
