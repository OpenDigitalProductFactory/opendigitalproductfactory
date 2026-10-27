// BI-D4144471 — one approval hands a person's set of rooms to a new assistant
// (design 2026-10-21-executor-takeover-design.md §3.3).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fingerprintCoworkerInput } from "@/lib/govern/authority/coworker-authority-decision";
import {
  BATCH_HANDOVER_MAX_ROOMS,
  batchHandoverPlanDigest,
  runBatchExecutorHandover,
  storedExecutorCheckpoint,
} from "./batch-executor-handover";
import type { CapsuleDb } from "./work-capsule-store-types";
import type { ToolResult } from "@/lib/mcp-tool-types";

type Room = { capsuleId: string; executorKind: string | null; leaseHolderPrincipalId: string | null; workspaceState: unknown };

const checkpoint = { nextAction: "Open the PR", headSha: "abc", recordedAt: "2026-10-27T00:00:00.000Z", recordedByPrincipalId: "assistant-old" };

function fakeDb(rooms: Room[]) {
  return { workroom: { findMany: vi.fn(async () => rooms.map((room) => ({ ...room }))) } } as unknown as CapsuleDb & {
    workroom: { findMany: ReturnType<typeof vi.fn> };
  };
}

const roomsFixture = (): Room[] => [
  { capsuleId: "WC-B", executorKind: "codex-desktop", leaseHolderPrincipalId: "human-alice", workspaceState: {} },
  { capsuleId: "WC-A", executorKind: "claude-desktop", leaseHolderPrincipalId: "assistant-old", workspaceState: { executorCheckpoint: checkpoint } },
];

describe("batch executor handover", () => {
  let rooms: Room[];
  let handOverOne: ReturnType<typeof vi.fn<(params: Record<string, unknown>) => Promise<ToolResult>>>;
  beforeEach(() => {
    rooms = roomsFixture();
    handOverOne = vi.fn(async (params: Record<string, unknown>) => ({ success: true, entityId: params.capsuleId as string, message: "ok" }));
  });
  const run = (params: Record<string, unknown>) => runBatchExecutorHandover({ params, db: fakeDb(rooms), handOverOne });

  it("dry-runs by default and returns each room with a stable plan digest", async () => {
    const first = await run({ capsuleIds: ["WC-B", "WC-A"], toExecutorKind: "claude-desktop" });
    const second = await run({ capsuleIds: ["WC-A", "WC-B"], toExecutorKind: "claude-desktop", dryRun: true });
    expect(first).toMatchObject({
      success: true,
      data: {
        dryRun: true,
        rooms: [
          { capsuleId: "WC-A", fromExecutorKind: "claude-desktop", expectedLeaseHolderPrincipalId: "assistant-old", checkpoint },
          { capsuleId: "WC-B", fromExecutorKind: "codex-desktop", expectedLeaseHolderPrincipalId: "human-alice", checkpoint: null },
        ],
      },
    });
    expect(first.data?.planDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(second.data?.planDigest).toBe(first.data?.planDigest);
    expect(handOverOne).not.toHaveBeenCalled();
  });

  it("hands over every room when the digest matches, each with its own checkpoint", async () => {
    const plan = await run({ capsuleIds: ["WC-A", "WC-B"], toExecutorKind: "claude-desktop" });
    const result = await run({
      capsuleIds: ["WC-A", "WC-B"], toExecutorKind: "claude-desktop", dryRun: false,
      planDigest: plan.data?.planDigest, reason: "Codex session ended.",
    });
    expect(result).toMatchObject({ success: true, data: { handedOver: 2, skipped: 0 } });
    expect(handOverOne).toHaveBeenCalledTimes(2);
    expect(handOverOne).toHaveBeenCalledWith(expect.objectContaining({
      capsuleId: "WC-A", toExecutorKind: "claude-desktop", expectedLeaseHolderPrincipalId: "assistant-old",
      reason: "Codex session ended.", handoffManifest: { checkpoint },
    }));
    expect(handOverOne).toHaveBeenCalledWith(expect.objectContaining({
      capsuleId: "WC-B", expectedLeaseHolderPrincipalId: "human-alice", handoffManifest: { checkpoint: null },
    }));
  });

  it("skips and reports a room whose lease holder changed after the digest was checked", async () => {
    const plan = await run({ capsuleIds: ["WC-A", "WC-B"], toExecutorKind: "claude-desktop" });
    handOverOne.mockImplementation(async (params) => params.capsuleId === "WC-B"
      ? { success: false, error: "lease_holder_changed", message: "changed", data: { actualLeaseHolderPrincipalId: "bob" } }
      : { success: true, message: "ok" });
    const result = await run({ capsuleIds: ["WC-A", "WC-B"], toExecutorKind: "claude-desktop", dryRun: false, planDigest: plan.data?.planDigest });
    expect(result).toMatchObject({
      success: true,
      data: { handedOver: 1, skipped: 1, rooms: [{ capsuleId: "WC-A", outcome: "handed-over" }, { capsuleId: "WC-B", outcome: "skipped", error: "lease_holder_changed" }] },
    });
  });

  it("refuses the whole call when the rooms changed since the dry run", async () => {
    const plan = await run({ capsuleIds: ["WC-A", "WC-B"], toExecutorKind: "claude-desktop" });
    rooms[0]!.leaseHolderPrincipalId = "someone-else";
    const result = await run({ capsuleIds: ["WC-A", "WC-B"], toExecutorKind: "claude-desktop", dryRun: false, planDigest: plan.data?.planDigest });
    expect(result).toMatchObject({ success: false, error: "handover_plan_changed" });
    expect(result.message).toMatch(/run the dry run again/);
    expect(handOverOne).not.toHaveBeenCalled();
  });

  it("requires the plan digest to apply", async () => {
    const result = await run({ capsuleIds: ["WC-A"], toExecutorKind: "claude-desktop", dryRun: false });
    expect(result).toMatchObject({ success: false, error: "invalid_input" });
    expect(handOverOne).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", { capsuleIds: [] }],
    ["over the limit", { capsuleIds: Array.from({ length: BATCH_HANDOVER_MAX_ROOMS + 1 }, (_, i) => `WC-${i}`) }],
    ["duplicated", { capsuleIds: ["WC-A", "WC-A"] }],
    ["not strings", { capsuleIds: ["WC-A", 7] }],
    ["mixed with capsuleId", { capsuleIds: ["WC-A"], capsuleId: "WC-B" }],
    ["mixed with a handoff phase", { capsuleIds: ["WC-A"], phase: "request" }],
  ])("refuses a %s set", async (_label, extra) => {
    const result = await run({ toExecutorKind: "claude-desktop", ...extra });
    expect(result).toMatchObject({ success: false, error: "invalid_input" });
  });

  it("refuses a set naming a room that does not exist", async () => {
    const result = await run({ capsuleIds: ["WC-A", "WC-MISSING"], toExecutorKind: "claude-desktop" });
    expect(result).toMatchObject({ success: false, error: "workroom_not_found" });
  });

  it("binds one approval to exactly that set and plan", () => {
    const base = { capsuleIds: ["WC-A", "WC-B"], toExecutorKind: "claude-desktop", dryRun: false, planDigest: "d1" };
    expect(fingerprintCoworkerInput(base)).not.toBe(fingerprintCoworkerInput({ ...base, capsuleIds: ["WC-A", "WC-C"] }));
    expect(fingerprintCoworkerInput(base)).not.toBe(fingerprintCoworkerInput({ ...base, planDigest: "d2" }));
  });

  it("digests the sorted tuples, independent of input order", () => {
    const a = { capsuleId: "WC-A", fromExecutorKind: "x", expectedLeaseHolderPrincipalId: null };
    const b = { capsuleId: "WC-B", fromExecutorKind: null, expectedLeaseHolderPrincipalId: "p" };
    expect(batchHandoverPlanDigest([a, b])).toBe(batchHandoverPlanDigest([b, a]));
    expect(batchHandoverPlanDigest([a, b])).not.toBe(batchHandoverPlanDigest([a, { ...b, expectedLeaseHolderPrincipalId: "q" }]));
  });

  it("reads the stored checkpoint defensively", () => {
    expect(storedExecutorCheckpoint({ executorCheckpoint: checkpoint })).toEqual(checkpoint);
    expect(storedExecutorCheckpoint({})).toBeNull();
    expect(storedExecutorCheckpoint(null)).toBeNull();
    expect(storedExecutorCheckpoint({ executorCheckpoint: ["not", "a", "record"] })).toBeNull();
  });
});
