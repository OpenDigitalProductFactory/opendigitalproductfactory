import { beforeEach, describe, expect, it, vi } from "vitest";

const svc = vi.hoisted(() => ({
  spawnWorkThread: vi.fn(),
  cancelThread: vi.fn(),
  getThreadResult: vi.fn(),
  getChildThreads: vi.fn(),
}));
vi.mock("@/lib/actions/agent-coworker", () => ({
  spawnWorkThread: (...a: unknown[]) => svc.spawnWorkThread(...a),
  cancelThread: (...a: unknown[]) => svc.cancelThread(...a),
  getThreadResult: (...a: unknown[]) => svc.getThreadResult(...a),
  getChildThreads: (...a: unknown[]) => svc.getChildThreads(...a),
}));

import { workThreadPack } from "./work-thread-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "spawn_work_thread",
  "cancel_thread",
  "get_thread_result",
  "get_child_threads",
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("work-thread pack — registration", () => {
  it("exposes exactly the four work-thread tools with a handler each", () => {
    expect(workThreadPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(workThreadPack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of workThreadPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("grants mirror agent-grants: read tools need thread_read, mutating tools need thread_write", () => {
    expect(workThreadPack.grants.spawn_work_thread).toEqual(["thread_write"]);
    expect(workThreadPack.grants.cancel_thread).toEqual(["thread_write"]);
    expect(workThreadPack.grants.get_thread_result).toEqual(["thread_read"]);
    expect(workThreadPack.grants.get_child_threads).toEqual(["thread_read"]);

    expect(isToolAllowedByGrants("spawn_work_thread", ["thread_write"])).toBe(true);
    expect(isToolAllowedByGrants("cancel_thread", ["thread_write"])).toBe(true);
    expect(isToolAllowedByGrants("get_thread_result", ["thread_read"])).toBe(true);
    expect(isToolAllowedByGrants("get_child_threads", ["thread_read"])).toBe(true);
  });
});

describe("work-thread pack — handler behavior (delegation preserved)", () => {
  it("spawn_work_thread errors without caller thread context, before delegating", async () => {
    const res = await workThreadPack.handlers.spawn_work_thread({ objective: "do it" }, "u1", {});
    expect(res.success).toBe(false);
    expect(res.error).toBe("missing_threadId");
    expect(svc.spawnWorkThread).not.toHaveBeenCalled();
  });

  it("spawn_work_thread delegates with parent thread context and returns the child id", async () => {
    svc.spawnWorkThread.mockResolvedValue({ child: { id: "THR-CHILD" }, taskRunId: "TR-1" });
    const res = await workThreadPack.handlers.spawn_work_thread(
      { objective: "delegated work", title: "sub" },
      "actor-9",
      { threadId: "THR-PARENT", routeContext: "/build", agentId: "AGT-7" },
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("THR-CHILD");
    expect(res.data).toEqual({ child: { id: "THR-CHILD" }, taskRunId: "TR-1" });
    const [arg, uid] = svc.spawnWorkThread.mock.calls[0] as [Record<string, unknown>, string];
    expect(arg).toMatchObject({ parentThreadId: "THR-PARENT", objective: "delegated work", title: "sub", agentId: "AGT-7" });
    expect(uid).toBe("actor-9");
  });

  it("cancel_thread defaults to the current thread when no threadId param is given", async () => {
    svc.cancelThread.mockResolvedValue({ cancelled: true });
    const res = await workThreadPack.handlers.cancel_thread({}, "u1", { threadId: "THR-CUR" });
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("THR-CUR");
    expect(svc.cancelThread).toHaveBeenCalledWith({ threadId: "THR-CUR" }, "u1");
  });

  it("get_thread_result requires a threadId param and does not fall back to context", async () => {
    const res = await workThreadPack.handlers.get_thread_result({}, "u1", { threadId: "THR-CUR" });
    expect(res.success).toBe(false);
    expect(res.error).toBe("missing_threadId");
    expect(svc.getThreadResult).not.toHaveBeenCalled();
  });

  it("get_child_threads lists children of the current thread", async () => {
    svc.getChildThreads.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    const res = await workThreadPack.handlers.get_child_threads({}, "u1", { threadId: "THR-PARENT" });
    expect(res.success).toBe(true);
    expect(res.message).toContain("Found 2 child threads.");
    expect(svc.getChildThreads).toHaveBeenCalledWith({ parentThreadId: "THR-PARENT" }, "u1");
  });
});
