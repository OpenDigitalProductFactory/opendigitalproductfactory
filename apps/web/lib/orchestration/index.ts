// apps/web/lib/orchestration/index.ts
// Public surface of the orchestration module.
// See: docs/superpowers/specs/2026-04-29-orchestration-primitives-design.md

export type {
  GovernanceProfile,
  RunContext,
  Outcome,
  Evidence,
  ExhaustionReason,
  CancellationReason,
  OrchestrationError,
  TerminalStatus,
} from "./types";

export { assertNever } from "./assert-never";
