// Shim — moved to lib/explore/feature-build-types.ts (Phase 8 refactoring)
export * from "./explore/feature-build-types";

/**
 * Phase gate — implemented in lib/explore/build-process-matrix.ts and
 * re-exported here so every import site that reaches checkPhaseGate via
 * @/lib/feature-build-types keeps working. It is re-exported from this shim,
 * not from lib/explore/feature-build-types.ts, because the matrix imports
 * that module's helpers: a re-export there closed a module load-order cycle
 * (spec 2026-09-30 §4.2).
 */
export { checkPhaseGate } from "./explore/build-process-matrix";
