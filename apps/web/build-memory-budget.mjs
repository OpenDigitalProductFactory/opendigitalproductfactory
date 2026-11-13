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

/**
 * Read the builder/container memory cap from environment when available.
 * Priority order (first valid wins):
 *  1. CGROUP_MEMORY_LIMIT_BYTES — kernel/container layer cgroup limit
 *  2. DPF_LOCAL_CI_BUILDER_MEMORY_BYTES — bounded-build runner's slot cap
 *
 * When neither is set, currentPageBuildBudget falls back to totalmem() and
 * process.constrainedMemory(), which may read host memory on misconfigured
 * containers and oversubscribe workers.
 */
export function builderMemoryCapFromEnv() {
  for (const name of ["CGROUP_MEMORY_LIMIT_BYTES", "DPF_LOCAL_CI_BUILDER_MEMORY_BYTES"]) {
    const value = Number(process.env[name]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

export function currentPageBuildBudget() {
  const builderCap = builderMemoryCapFromEnv();
  const limits = [
    builderCap,
    totalmem(),
    process.constrainedMemory?.(),
    process.availableMemory?.(),
  ].filter((value) => Number.isFinite(value) && value > 0);
  return pageBuildBudget({
    memoryBytes: limits.length ? Math.min(...limits) : 0,
    cpuCount: availableParallelism(),
  });
}
