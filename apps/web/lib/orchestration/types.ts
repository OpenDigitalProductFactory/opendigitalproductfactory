// apps/web/lib/orchestration/types.ts
// Core type contracts for the orchestration runtime.
// See: docs/superpowers/specs/2026-04-29-orchestration-primitives-design.md §Type Contracts

export type GovernanceProfile =
  | "economy"
  | "balanced"
  | "high-assurance"
  | "document-authority"
  | "system";

export type RunContext = {
  runId: string;
  userId: string;
  threadId?: string;
  taskRunId?: string;
  agentId?: string;
  governanceProfile: GovernanceProfile;
  parentRunId?: string;
  routeContext?: string;
};

export type ExhaustionReason =
  | "max_attempts"
  | "deadline"
  | "token_budget"
  | "sandbox_unavailable"
  | "no_more_strategies";

export type CancellationReason = "user_cancelled" | "upstream_cancelled";

export type Evidence = {
  attemptNumber: number;
  startedAt: string;
  endedAt: string;
  summary: string;
  outcome: "succeeded" | "failed" | "cancelled";
  detail?: unknown;
};

export type OrchestrationError = {
  name: string;
  message: string;
  cause?: unknown;
};

export type Outcome<T> =
  | { status: "succeeded"; value: T; evidence: Evidence[] }
  | { status: "failed"; error: OrchestrationError; evidence: Evidence[] }
  | { status: "exhausted"; reason: ExhaustionReason; evidence: Evidence[]; attempts: number }
  | { status: "cancelled"; reason: CancellationReason; evidence: Evidence[]; attempts: number };

export type TerminalStatus = Outcome<unknown>["status"];
