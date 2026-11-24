import { describe, expect, it, vi } from "vitest";
vi.mock("@dpf/db", () => ({ prisma: {} }));
import { parseExecutorHarnessRef } from "./executor-harness-ref";
import { claimBacklogItemForWork, persistExecutorHarness } from "./claim-backlog-item-handler";
import type { CapsuleDb } from "./work-capsule-store-types";

// BI-75AB446B: T3 Code exports T3CODE_THREAD_ID to every session it starts, and
// nothing recorded it. The claim now carries the harness's own references so a
// room can be found from its thread. They describe; they never authorize.
const THREAD = "0f0ea8be-7956-4ad7-9aa6-407c52c8ffa4";

describe("the harness's own references on a claim (BI-75AB446B)", () => {
  it("reads nothing when the caller sends nothing", () => {
    expect(parseExecutorHarnessRef(undefined)).toEqual({ ok: true, data: null });
  });
  it("keeps the thread, project, environment and provider instance it is given", () => {
    expect(parseExecutorHarnessRef({ threadId: THREAD, projectId: "723aff25", environmentId: "20439db4", providerInstanceId: "claudeAgent" }))
      .toEqual({ ok: true, data: { threadId: THREAD, projectId: "723aff25", environmentId: "20439db4", providerInstanceId: "claudeAgent" } });
  });
  it("accepts the thread ids T3 mints for delegated and launched threads", () => {
    for (const threadId of ["thread:delegated-task:command%3Amcp%3A39a5b051%3Adelegate-task%3Agate2", `mcp:launch:${"a".repeat(64)}`, "import:claudeAgent:e781fd4e"]) {
      expect(parseExecutorHarnessRef({ threadId })).toEqual({ ok: true, data: { threadId } });
    }
  });
  it.each([
    ["not an object", "thread"],
    ["no thread id", { projectId: "p" }],
    ["an empty thread id", { threadId: " " }],
    ["a thread id with spaces", { threadId: "a b" }],
    ["an over-long value", { threadId: "a".repeat(257) }],
    ["a non-string field", { threadId: THREAD, projectId: 7 }],
    ["an unknown field", { threadId: THREAD, token: "x" }],
  ])("refuses %s", (_name, harnessRef) => {
    const result = parseExecutorHarnessRef(harnessRef);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: expect.stringContaining("T3CODE_THREAD_ID") });
  });

  it("the claim refuses a malformed reference before it touches the room", async () => {
    const result = await claimBacklogItemForWork({
      params: { itemId: "BI-ONE", worktreePath: "/w", branchName: "fix/x", sessionRef: "s", provider: "claude", harness: "t3-code", harnessRef: { threadId: "a b" } },
      userId: "u", context: undefined, db: {} as CapsuleDb, resolveActor: vi.fn() });
    expect(result).toMatchObject({ success: false, error: "invalid_harness_ref" });
  });
  it("the claim refuses a reference sent without a harness", async () => {
    const result = await claimBacklogItemForWork({
      params: { itemId: "BI-ONE", worktreePath: "/w", branchName: "fix/x", sessionRef: "s", provider: "claude", harnessRef: { threadId: THREAD } },
      userId: "u", context: undefined, db: {} as CapsuleDb, resolveActor: vi.fn() });
    expect(result).toMatchObject({ success: false, error: "harness_ref_requires_harness" });
  });

  const room = (workspaceState: unknown) => {
    const update = vi.fn();
    const db = { workroom: { findUnique: vi.fn(async () => ({ workspaceState })), update } } as unknown as CapsuleDb;
    return { db, update };
  };
  it("stores the reference beside the harness label, keeping the session id as executorRef", async () => {
    const { db, update } = room({ executorCheckpoint: { nextAction: "x" } });
    await persistExecutorHarness(db, "WC-1", "t3-code", "client-session", { threadId: THREAD, projectId: "723aff25" });
    expect(update).toHaveBeenCalledWith({ where: { capsuleId: "WC-1" }, data: { workspaceState: {
      executorCheckpoint: { nextAction: "x" },
      executorHarness: expect.objectContaining({ harness: "t3-code", executorRef: "client-session", ref: { threadId: THREAD, projectId: "723aff25" } }) } } });
  });
  it("a later claim by the same session that omits the reference keeps the recorded one", async () => {
    const { db, update } = room({ executorHarness: { harness: "t3-code", executorRef: "client-session", recordedAt: "t", ref: { threadId: THREAD } } });
    await persistExecutorHarness(db, "WC-1", "t3-code", "client-session");
    expect(update.mock.calls[0]![0].data.workspaceState.executorHarness.ref).toEqual({ threadId: THREAD });
  });
  it("a claim by another session does not inherit the previous session's reference", async () => {
    const { db, update } = room({ executorHarness: { harness: "t3-code", executorRef: "old-session", recordedAt: "t", ref: { threadId: THREAD } } });
    await persistExecutorHarness(db, "WC-1", "t3-code", "new-session");
    expect(update.mock.calls[0]![0].data.workspaceState.executorHarness).not.toHaveProperty("ref");
  });
});
