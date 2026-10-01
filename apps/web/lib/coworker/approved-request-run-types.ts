// apps/web/lib/coworker/approved-request-run-types.ts
//
// The outcome contract of running an approved coworker request
// (approved-request-run.ts, BI-12E5DD91). Types only, no imports: the approval
// outcome store names these without importing the runner, which reaches the
// governed executor and the MCP tool registry (dependency-diet plan M11 step 2
// needs apps/web's all-imports graph acyclic).

export type ApprovedRequestRun =
  | { status: "executed"; message: string }
  | { status: "failed"; message: string }
  /** Not run here; the reason says why and what still can run it. */
  | { status: "not-run"; reason: ApprovedRequestNotRunReason; message: string };

export type ApprovedRequestNotRunReason =
  | "task-bound"
  | "not-approved"
  | "expired"
  | "no-pending-call"
  | "arguments-not-provable"
  | "credential-unavailable"
  | "consent-changed"
  | "scope-insufficient"
  | "task-not-waiting"
  | "task-waiting-again";
