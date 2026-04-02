"use server";
// Shim — moved to lib/integrate/change-executor.ts (Phase 10 refactoring)
export { runHealthCheck, executeChangeItems } from "./integrate/change-executor";
export type { HealthCheckResult, ChangeItemResult, ExecutionResult } from "./integrate/change-executor";
