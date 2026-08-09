export type McpTaskContinuation = {
  taskId: string;
  continuationRef: string;
  nextPollAt: number;
  pollIntervalMs: number;
  attempts: number;
};

export type McpTaskSnapshot = {
  taskId: string;
  status: string;
  pollIntervalMs?: number | null;
  [key: string]: unknown;
};

export type McpTaskContinuationStore = {
  list(): Promise<McpTaskContinuation[]>;
  put(reference: McpTaskContinuation): Promise<void>;
  remove(taskId: string): Promise<void>;
};

export type McpTaskWatcherMetrics = {
  sharedWatcherCount: 1;
  activePollCount: number;
  queuedResumptionCount: number;
};

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MAX_POLL_INTERVAL_MS = 60_000;
const WAKE_STATUSES = new Set(["completed", "failed", "cancelled", "input_required"]);

function boundedPollInterval(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_POLL_INTERVAL_MS;
  return Math.min(MAX_POLL_INTERVAL_MS, Math.max(250, Math.trunc(value)));
}

/**
 * One storage-backed watcher for every suspended task in a client process.
 *
 * It deliberately owns no interval or per-task timer: the host invokes tick()
 * from its existing scheduler. Each tick reloads minimal continuation records,
 * reauthenticates through the injected tasks/get caller, and bounds concurrent
 * resumptions. Model context, bearer material, open streams, and callbacks are
 * never persisted with a task.
 */
export class SharedMcpTaskWatcher {
  private activePollCount = 0;
  private queuedResumptionCount = 0;
  private readonly store: McpTaskContinuationStore;
  private readonly getTask: (taskId: string) => Promise<McpTaskSnapshot>;
  private readonly wake: (
    reference: Pick<McpTaskContinuation, "taskId" | "continuationRef">,
    task: McpTaskSnapshot,
  ) => Promise<void>;
  private readonly maxConcurrentResumptions: number;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(options: {
    store: McpTaskContinuationStore;
    getTask: (taskId: string) => Promise<McpTaskSnapshot>;
    wake: (
      reference: Pick<McpTaskContinuation, "taskId" | "continuationRef">,
      task: McpTaskSnapshot,
    ) => Promise<void>;
    maxConcurrentResumptions?: number;
    now?: () => number;
    random?: () => number;
  }) {
    this.store = options.store;
    this.getTask = options.getTask;
    this.wake = options.wake;
    this.maxConcurrentResumptions = Math.max(
      1,
      Math.trunc(options.maxConcurrentResumptions ?? 4),
    );
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  metrics(): McpTaskWatcherMetrics {
    return {
      sharedWatcherCount: 1,
      activePollCount: this.activePollCount,
      queuedResumptionCount: this.queuedResumptionCount,
    };
  }

  async watch(input: {
    taskId: string;
    continuationRef: string;
    pollIntervalMs?: number | null;
  }): Promise<void> {
    const pollIntervalMs = boundedPollInterval(input.pollIntervalMs);
    await this.store.put({
      taskId: input.taskId,
      continuationRef: input.continuationRef,
      nextPollAt: this.now() + pollIntervalMs,
      pollIntervalMs,
      attempts: 0,
    });
  }

  private nextDelay(reference: McpTaskContinuation, task?: McpTaskSnapshot): number {
    const base = boundedPollInterval(task?.pollIntervalMs ?? reference.pollIntervalMs);
    const backedOff = Math.min(MAX_POLL_INTERVAL_MS, base * (2 ** Math.min(reference.attempts, 5)));
    const jitter = 0.8 + Math.min(1, Math.max(0, this.random())) * 0.4;
    return Math.max(250, Math.trunc(backedOff * jitter));
  }

  private async poll(reference: McpTaskContinuation): Promise<boolean> {
    this.activePollCount += 1;
    try {
      const task = await this.getTask(reference.taskId);
      if (WAKE_STATUSES.has(task.status)) {
        // Remove before delivery so concurrent ticks cannot double-wake. The
        // continuation reference is the idempotency key if delivery must retry.
        await this.store.remove(reference.taskId);
        try {
          await this.wake(
            { taskId: reference.taskId, continuationRef: reference.continuationRef },
            task,
          );
          return true;
        } catch (error) {
          await this.store.put({
            ...reference,
            attempts: reference.attempts + 1,
            nextPollAt: this.now() + this.nextDelay(reference, task),
          });
          throw error;
        }
      }

      const pollIntervalMs = boundedPollInterval(task.pollIntervalMs ?? reference.pollIntervalMs);
      await this.store.put({
        ...reference,
        pollIntervalMs,
        attempts: reference.attempts + 1,
        nextPollAt: this.now() + this.nextDelay(reference, task),
      });
      return false;
    } catch {
      await this.store.put({
        ...reference,
        attempts: reference.attempts + 1,
        nextPollAt: this.now() + this.nextDelay(reference),
      });
      return false;
    } finally {
      this.activePollCount = Math.max(0, this.activePollCount - 1);
    }
  }

  async tick(): Promise<{
    polled: number;
    woken: number;
    remaining: number;
    queuedResumptions: number;
  }> {
    const now = this.now();
    const due = (await this.store.list())
      .filter((reference) => reference.nextPollAt <= now)
      .sort((a, b) => a.nextPollAt - b.nextPollAt);
    const selected = due.slice(0, this.maxConcurrentResumptions);
    this.queuedResumptionCount = Math.max(0, due.length - selected.length);
    const results = await Promise.all(selected.map((reference) => this.poll(reference)));
    const remaining = (await this.store.list()).length;
    return {
      polled: selected.length,
      woken: results.filter(Boolean).length,
      remaining,
      queuedResumptions: this.queuedResumptionCount,
    };
  }
}
