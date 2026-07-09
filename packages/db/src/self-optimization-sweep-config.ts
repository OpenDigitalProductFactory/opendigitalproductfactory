// packages/db/src/self-optimization-sweep-config.ts
// Self-optimization engine: shared identity for the weekly consolidation
// sweep (the standing discipline: re-measure bet blast radius, reconcile
// consolidation-parity conformance, surface stalled bets). Imported by the
// seed (packages/db) and the scheduler branch (apps/web) so both agree on
// the task id. The deterministic handler lives in apps/web's scheduler
// (executeScheduledAgentTask early-branches on this task id and runs
// runSelfOptimizationSweep without an LLM loop), mirroring the SysML
// projection reconcile.

export const SELF_OPTIMIZATION_SWEEP_TASK_ID = "self-optimization-sweep-weekly";
export const SELF_OPTIMIZATION_SWEEP_AGENT_ID = "AGT-WS-EA"; // Enterprise Architect
export const SELF_OPTIMIZATION_SWEEP_TASK_TITLE = "Self-Optimization Sweep (weekly)";
export const SELF_OPTIMIZATION_SWEEP_ROUTE_CONTEXT = "/ea/capabilities";
export const SELF_OPTIMIZATION_SWEEP_SCHEDULE = "0 5 * * 1"; // 05:00 UTC Mondays (after the nightly parity jobs)
export const SELF_OPTIMIZATION_SWEEP_DEFAULT_TIMEZONE = "UTC";
export const SELF_OPTIMIZATION_SWEEP_SCHEDULED_JOB_NAME = "Self-Optimization Sweep Weekly";
export const SELF_OPTIMIZATION_SWEEP_PROMPT =
  "Re-measure the consolidation-bet registry against the live code graph and backlog, reconcile the " +
  "consolidation-parity conformance issues, and record the sweep summary. Deterministic — runs without an LLM loop.";
