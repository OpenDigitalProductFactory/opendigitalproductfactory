// apps/web/lib/build-exec-types.ts
// Types for the checkpoint-based build execution pipeline.

import type { SandboxSourceCurrencySnapshot } from "./sandbox/sandbox-source-currency";

export type BuildExecStep =
  | "pending"
  | "slot_queued"        // transient — emitted only; never persisted as a checkpoint
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
  sourceCurrency?: SandboxSourceCurrencySnapshot | null;
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
  slot_queued: "Waiting for sandbox slot…",
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
  slot_queued: 0,   // not a real step — never retried
  sandbox_created: 3,
  workspace_initialized: 2,
  db_ready: 3,
  deps_installed: 2,
  code_generated: 2,
  // tests_run is the dispatch slot that runs stepComplete (the diff/commit
  // capture step). Diff extraction can fail transiently when the sandbox is
  // mid-rebuild or the index lock is briefly held — give it retry budget so
  // a one-off hiccup doesn't strand an otherwise-complete build.
  tests_run: 2,
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
