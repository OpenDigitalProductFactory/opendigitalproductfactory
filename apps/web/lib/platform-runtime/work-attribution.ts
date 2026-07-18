export const ACTIVE_TASK_RUN_STATES = ["submitted", "working", "input-required", "auth-required", "quiescing"] as const;
export const ACTIVE_WORK_CAPSULE_STATES = ["claimed", "working", "review", "blocked"] as const;
export const ACTIVE_BUILD_PHASES = ["ideate", "plan", "build", "review"] as const;

export type RuntimeWorkGuard = "build-studio-active" | `task-run:${string}` | `work-capsule:${string}`;

export interface WorkAttributionStore {
  countActiveFeatureBuilds(): Promise<number>;
  countActiveTaskRuns(source: string, states: readonly string[]): Promise<number>;
  countActiveWorkCapsules(source: string, states: readonly string[]): Promise<number>;
}

export function isRuntimeWorkGuard(value: string): value is RuntimeWorkGuard {
  return /^(build-studio-active|task-run:[a-z0-9-]+|work-capsule:[a-z0-9-]+)$/.test(value);
}

export async function countAttributedWork(guards: readonly string[], store: WorkAttributionStore) {
  for (const guard of guards) if (!isRuntimeWorkGuard(guard)) throw new Error(`invalid_runtime_work_guard:${guard}`);
  const blockingCounts: Record<string, number> = {};
  for (const guard of guards) {
    if (guard === "build-studio-active") blockingCounts[guard] = await store.countActiveFeatureBuilds();
    else if (guard.startsWith("task-run:")) blockingCounts[guard] = await store.countActiveTaskRuns(guard.slice("task-run:".length), ACTIVE_TASK_RUN_STATES);
    else blockingCounts[guard] = await store.countActiveWorkCapsules(guard.slice("work-capsule:".length), ACTIVE_WORK_CAPSULE_STATES);
  }
  return { total: Object.values(blockingCounts).reduce((sum, count) => sum + count, 0), blockingCounts };
}

type PrismaWorkAttributionClient = {
  featureBuild: { count(args: unknown): Promise<number> };
  taskRun: { count(args: unknown): Promise<number> };
  workCapsule: { count(args: unknown): Promise<number> };
};

export function createPrismaWorkAttributionStore(prisma: PrismaWorkAttributionClient): WorkAttributionStore {
  return {
    countActiveFeatureBuilds: () => prisma.featureBuild.count({ where: { abandonedAt: null, phase: { in: [...ACTIVE_BUILD_PHASES] } } }),
    countActiveTaskRuns: (source, states) => prisma.taskRun.count({ where: { source, status: { in: [...states] } } }),
    countActiveWorkCapsules: (source, states) => prisma.workCapsule.count({ where: { source, status: { in: [...states] } } }),
  };
}
