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

export {
  GOVERNANCE_PROFILES,
  resolveBudget,
  deriveGovernanceProfile,
  type ProfileBudget,
} from "./governance-profiles";

export { startHeartbeat, noteActivity, stopHeartbeat } from "./heartbeat";

export { Sequential, type Step } from "./primitives/sequential";
export { Parallel, type ParallelOpts } from "./primitives/parallel";
export { Loop, type LoopStep, type LoopOpts } from "./primitives/loop";
export { Branch, type BranchSpec, type BranchOpts } from "./primitives/branch";
