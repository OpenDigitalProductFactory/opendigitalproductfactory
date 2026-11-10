import { totalmem, availableParallelism } from "node:os";

const GiB = 1024 ** 3;

// Admission budgets, not a claim about a worker's measured peak or V8 limit.
// Keep page rendering serial within each worker; compilation also needs memory.
export function pageBuildBudget({ memoryBytes, cpuCount }) {
  const workers = Number.isFinite(memoryBytes) && memoryBytes > 0
    && Number.isFinite(cpuCount) && cpuCount > 0
    ? Math.max(1, Math.min(2, Math.floor(cpuCount), Math.floor(memoryBytes / (8 * GiB))))
    : 1;
  return { cpus: workers, staticGenerationMaxConcurrency: 1 };
}

export function currentPageBuildBudget() {
  const limits = [totalmem(), process.constrainedMemory?.(), process.availableMemory?.()]
    .filter((value) => Number.isFinite(value) && value > 0);
  return pageBuildBudget({
    memoryBytes: limits.length ? Math.min(...limits) : 0,
    cpuCount: availableParallelism(),
  });
}
