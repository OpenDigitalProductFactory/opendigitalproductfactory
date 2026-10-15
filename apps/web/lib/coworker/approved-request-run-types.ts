// apps/web/lib/coworker/approved-request-run-types.ts
//
// The outcome contract of running an approved coworker request
// (approved-request-run.ts, BI-12E5DD91). Types only, no imports: the approval
// outcome store names these without importing the runner, which reaches the
// governed executor and the MCP tool registry (dependency-diet plan M11 step 2
// needs apps/web's all-imports graph acyclic).

export type ApprovedRequestRun =
  /** `entityId`: what the run created, when the handler names it (BI-C8EC05C9). */
  | { status: "executed"; message: string; entityId?: string }
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

/**
 * The platform runner's result (approved-request-run.ts, BI-C8EC05C9): an
 * ordinary run, or `settled` when this exact approved call already ran and
 * its recorded outcome is the answer. It never runs twice.
 */
export type PlatformRequestRun =
  | ApprovedRequestRun
  | { status: "settled"; outcome: "executed" | "failed"; message: string; entityId?: string };
