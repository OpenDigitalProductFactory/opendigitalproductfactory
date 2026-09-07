import { describe, expect, it } from "vitest";

import {
  groupDelegatedWorkers,
  rollUpNamedWorkers,
  selectWorkerPage,
  WORKER_PROGRESS_FRESH_WINDOW_MS,
  type WorkerSessionInput,
} from "./worker-rollup";

const NOW = new Date("2026-09-07T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function session(over: Partial<WorkerSessionInput> & { workerId: string }): WorkerSessionInput {
  return {
    displayName: `Worker ${over.workerId}`,
    executorKind: "claude",
    state: "working",
    currentTask: null,
    lastProgressAt: ago(1_000),
    ...over,
  };
}

describe("rollUpNamedWorkers", () => {
  it("keeps one identity across surfaces instead of a row per connection", () => {
    const workers = rollUpNamedWorkers([
      session({ workerId: "w1", executorKind: "claude" }),
      session({ workerId: "w1", executorKind: "codex" }),
      session({ workerId: "w1", executorKind: "grok" }),
    ], NOW);
    expect(workers).toHaveLength(1);
    expect(workers[0]!.executorKinds).toEqual(["claude", "codex", "grok"]);
  });

  it("describes the worker from its freshest observation", () => {
    const workers = rollUpNamedWorkers([
      session({ workerId: "w1", currentTask: "old task", lastProgressAt: ago(60_000) }),
      session({ workerId: "w1", currentTask: "Checking invoice matching", lastProgressAt: ago(1_000), executorKind: "codex" }),
    ], NOW);
    expect(workers[0]!.currentTask).toBe("Checking invoice matching");
    expect(workers[0]!.lastProgressAt).toBe(ago(1_000).toISOString());
  });

  it("will not report working without a recent observation", () => {
    const [stale] = rollUpNamedWorkers([
      session({ workerId: "w1", state: "working", lastProgressAt: ago(WORKER_PROGRESS_FRESH_WINDOW_MS + 1_000) }),
    ], NOW);
    expect(stale!.state).toBe("idle");

    const [none] = rollUpNamedWorkers([session({ workerId: "w2", state: "working", lastProgressAt: null })], NOW);
    expect(none!.state).toBe("unknown");
  });

  it("keeps waiting and idle as reported, since they are not claims about now", () => {
    const workers = rollUpNamedWorkers([
      session({ workerId: "a", state: "waiting", lastProgressAt: null }),
      session({ workerId: "b", state: "idle", lastProgressAt: null }),
    ], NOW);
    expect(workers.map((w) => `${w.workerId}:${w.state}`).sort()).toEqual(["a:waiting", "b:idle"]);
  });

  it("distinguishes a root worker from one whose delegator was never recorded", () => {
    const workers = rollUpNamedWorkers([
      session({ workerId: "root", delegatedByWorkerId: null }),
      session({ workerId: "orphan" }),
    ], NOW);
    expect(workers.find((w) => w.workerId === "root")!.parentage).toEqual({ kind: "root" });
    expect(workers.find((w) => w.workerId === "orphan")!.parentage).toEqual({ kind: "unknown" });
  });

  it("counts direct subagents on the delegating worker", () => {
    const workers = rollUpNamedWorkers([
      session({ workerId: "planner", delegatedByWorkerId: null }),
      session({ workerId: "s1", delegatedByWorkerId: "planner" }),
      session({ workerId: "s2", delegatedByWorkerId: "planner" }),
    ], NOW);
    expect(workers.find((w) => w.workerId === "planner")!.subagentCount).toBe(2);
  });

  it("collapses conflicting delegators to unknown rather than picking one", () => {
    const [worker] = rollUpNamedWorkers([
      session({ workerId: "w", delegatedByWorkerId: "a" }),
      session({ workerId: "w", delegatedByWorkerId: "b", executorKind: "codex" }),
    ], NOW);
    expect(worker!.parentage).toEqual({ kind: "unknown" });
  });

  it("prefers a recorded parent over an unrecorded observation of the same worker", () => {
    const [worker] = rollUpNamedWorkers([
      session({ workerId: "w" }),
      session({ workerId: "w", delegatedByWorkerId: "planner", executorKind: "codex" }),
    ], NOW);
    expect(worker!.parentage).toEqual({ kind: "delegated", byWorkerId: "planner" });
  });

  it("orders attention first, then recency, then id", () => {
    const workers = rollUpNamedWorkers([
      session({ workerId: "idle-1", state: "idle", lastProgressAt: null }),
      session({ workerId: "work-old", state: "working", lastProgressAt: ago(5_000) }),
      session({ workerId: "wait-1", state: "waiting", lastProgressAt: null }),
      session({ workerId: "work-new", state: "working", lastProgressAt: ago(1_000) }),
    ], NOW);
    expect(workers.map((w) => w.workerId)).toEqual(["wait-1", "work-new", "work-old", "idle-1"]);
  });
});

describe("groupDelegatedWorkers", () => {
  it("groups subagents under the worker that delegated them", () => {
    const groups = groupDelegatedWorkers(rollUpNamedWorkers([
      session({ workerId: "planner", delegatedByWorkerId: null }),
      session({ workerId: "s1", delegatedByWorkerId: "planner" }),
      session({ workerId: "s2", delegatedByWorkerId: "planner" }),
    ], NOW));
    const planner = groups.find((g) => g.parent?.workerId === "planner")!;
    expect(planner.members.map((m) => m.workerId).sort()).toEqual(["s1", "s2"]);
  });

  it("keeps unrecorded parentage in its own labelled group", () => {
    const groups = groupDelegatedWorkers(rollUpNamedWorkers([
      session({ workerId: "root", delegatedByWorkerId: null }),
      session({ workerId: "mystery" }),
    ], NOW));
    const unknown = groups.find((g) => g.unknownParentage)!;
    expect(unknown.parent).toBeNull();
    expect(unknown.members.map((m) => m.workerId)).toEqual(["mystery"]);
  });

  it("does not promote a child to root when its parent is not visible", () => {
    const groups = groupDelegatedWorkers(rollUpNamedWorkers([
      session({ workerId: "child", delegatedByWorkerId: "hidden-by-authorization" }),
    ], NOW));
    const unknown = groups.find((g) => g.unknownParentage)!;
    expect(unknown.members.map((m) => m.workerId)).toEqual(["child"]);
    expect(groups.some((g) => g.parent?.workerId === "child")).toBe(false);
  });

  it("gives a mid-chain delegator its own group", () => {
    const groups = groupDelegatedWorkers(rollUpNamedWorkers([
      session({ workerId: "top", delegatedByWorkerId: null }),
      session({ workerId: "mid", delegatedByWorkerId: "top" }),
      session({ workerId: "leaf", delegatedByWorkerId: "mid" }),
    ], NOW));
    expect(groups.find((g) => g.parent?.workerId === "mid")!.members.map((m) => m.workerId)).toEqual(["leaf"]);
  });
});

describe("selectWorkerPage", () => {
  const hundred = rollUpNamedWorkers(
    Array.from({ length: 100 }, (_, i) => session({
      workerId: `agent-${String(i).padStart(3, "0")}`,
      displayName: `Agent ${i}`,
      delegatedByWorkerId: i === 0 ? null : "agent-000",
      currentTask: i % 10 === 0 ? "Reconciling ledger" : `Step ${i}`,
      lastProgressAt: ago(i * 100),
    })),
    NOW,
  );

  it("pages a hundred agents without hiding them behind a number", () => {
    expect(hundred).toHaveLength(100);
    let cursor: string | null = null;
    let pages = 0;
    const seen = new Set<string>();
    do {
      const page: ReturnType<typeof selectWorkerPage> = selectWorkerPage({ workers: hundred, pageSize: 20, cursor });
      expect(page.workers.length).toBeLessThanOrEqual(20);
      for (const w of page.workers) seen.add(w.workerId);
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 20);
    expect(seen.size).toBe(100);
    expect(pages).toBe(5);
  });

  it("reports how many matched so a page can say twelve of a hundred", () => {
    const page = selectWorkerPage({ workers: hundred, pageSize: 20 });
    expect(page.matched).toBe(100);
    expect(page.partial).toBe(true);
  });

  it("finds a worker among a hundred by name or by what it is doing", () => {
    expect(selectWorkerPage({ workers: hundred, query: "Agent 42" }).matched).toBe(1);
    expect(selectWorkerPage({ workers: hundred, query: "reconciling ledger" }).matched).toBe(10);
  });

  it("reports a complete page as not partial", () => {
    const page = selectWorkerPage({ workers: hundred.slice(0, 3), pageSize: 20 });
    expect(page.partial).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("keeps the delegating worker's subagent count truthful at a hundred", () => {
    expect(hundred.find((w) => w.workerId === "agent-000")!.subagentCount).toBe(99);
  });
});
