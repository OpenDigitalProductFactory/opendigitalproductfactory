import { describe, expect, it, vi } from "vitest";

import {
  SharedMcpTaskWatcher,
  type McpTaskContinuation,
  type McpTaskContinuationStore,
} from "./shared-task-watcher";

function memoryStore(initial: McpTaskContinuation[] = []): McpTaskContinuationStore & {
  rows: Map<string, McpTaskContinuation>;
} {
  const rows = new Map(initial.map((row) => [row.taskId, row]));
  return {
    rows,
    list: async () => [...rows.values()],
    put: async (row) => { rows.set(row.taskId, row); },
    remove: async (taskId) => { rows.delete(taskId); },
  };
}

describe("SharedMcpTaskWatcher", () => {
  it("observes many tasks through one bounded tick without per-task timers", async () => {
    const store = memoryStore([
      { taskId: "TR-1", continuationRef: "C-1", nextPollAt: 0, pollIntervalMs: 1_000, attempts: 0 },
      { taskId: "TR-2", continuationRef: "C-2", nextPollAt: 0, pollIntervalMs: 1_000, attempts: 0 },
      { taskId: "TR-3", continuationRef: "C-3", nextPollAt: 0, pollIntervalMs: 1_000, attempts: 0 },
    ]);
    const getTask = vi.fn()
      .mockResolvedValueOnce({ taskId: "TR-1", status: "working", pollIntervalMs: 2_000 })
      .mockResolvedValueOnce({ taskId: "TR-2", status: "completed" });
    const wake = vi.fn().mockResolvedValue(undefined);
    const watcher = new SharedMcpTaskWatcher({
      store,
      getTask,
      wake,
      maxConcurrentResumptions: 2,
      now: () => 10_000,
      random: () => 0.5,
    });

    const result = await watcher.tick();

    expect(getTask).toHaveBeenCalledTimes(2);
    expect(wake).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "TR-2", continuationRef: "C-2" }),
      expect.objectContaining({ status: "completed" }),
    );
    expect(store.rows.has("TR-2")).toBe(false);
    expect(store.rows.get("TR-1")).toMatchObject({ attempts: 1, pollIntervalMs: 2_000 });
    expect(store.rows.has("TR-3")).toBe(true);
    expect(result).toMatchObject({ polled: 2, woken: 1, remaining: 2, queuedResumptions: 1 });
    expect(watcher.metrics()).toMatchObject({
      sharedWatcherCount: 1,
      activePollCount: 0,
      queuedResumptionCount: 1,
    });
  });

  it("wakes actionable input once and removes the continuation before delivery", async () => {
    const store = memoryStore([
      { taskId: "TR-I", continuationRef: "C-I", nextPollAt: 0, pollIntervalMs: 1_000, attempts: 0 },
    ]);
    const wake = vi.fn(async () => {
      expect(store.rows.has("TR-I")).toBe(false);
    });
    const watcher = new SharedMcpTaskWatcher({
      store,
      getTask: async () => ({ taskId: "TR-I", status: "input_required" }),
      wake,
      now: () => 10_000,
      random: () => 0,
    });

    await watcher.tick();
    expect(wake).toHaveBeenCalledOnce();
    expect(store.rows.size).toBe(0);
  });

  it("persists only a minimal continuation reference", async () => {
    const store = memoryStore();
    const watcher = new SharedMcpTaskWatcher({
      store,
      getTask: async () => ({ taskId: "TR-1", status: "working" }),
      wake: async () => undefined,
      now: () => 10_000,
      random: () => 0.5,
    });

    await watcher.watch({
      taskId: "TR-1",
      continuationRef: "C-1",
      pollIntervalMs: 2_000,
    });

    expect(store.rows.get("TR-1")).toEqual({
      taskId: "TR-1",
      continuationRef: "C-1",
      nextPollAt: 12_000,
      pollIntervalMs: 2_000,
      attempts: 0,
    });
    expect(JSON.stringify(store.rows.get("TR-1"))).not.toMatch(/bearer|prompt|model|connection/i);
  });

  it("backs off after a transient poll failure instead of hot-looping", async () => {
    const store = memoryStore([
      { taskId: "TR-E", continuationRef: "C-E", nextPollAt: 0, pollIntervalMs: 1_000, attempts: 0 },
    ]);
    const watcher = new SharedMcpTaskWatcher({
      store,
      getTask: async () => { throw new Error("temporary network failure"); },
      wake: async () => undefined,
      now: () => 10_000,
      random: () => 0.5,
    });

    await watcher.tick();
    expect(store.rows.get("TR-E")).toMatchObject({ attempts: 1, nextPollAt: 11_000 });
  });
});
