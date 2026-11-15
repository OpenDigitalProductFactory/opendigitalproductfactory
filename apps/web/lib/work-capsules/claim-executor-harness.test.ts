import { describe, expect, it, vi } from "vitest";
vi.mock("@dpf/db", () => ({ prisma: {} }));
import { claimBacklogItemForWork, isHarnessOnlyProvider, persistExecutorHarness } from "./claim-backlog-item-handler";
import type { CapsuleDb } from "./work-capsule-store-types";

// BI-53BED66C: the T3 trial (BI-4DE79C8D) found providerToExecutorKind("t3")
// returned "human". The harness is not the authenticated client; it is named
// separately and a harness-only provider is refused with the remedy.
const params = { itemId: "BI-ONE", worktreePath: "/w", branchName: "fix/x", sessionRef: "01a1d330-thread" };
const call = (extra: Record<string, unknown>) => claimBacklogItemForWork({ params: { ...params, ...extra }, userId: "u", context: undefined,
  db: {} as CapsuleDb, resolveActor: vi.fn() });

describe("T3 Code is named as the harness, not disguised (BI-53BED66C)", () => {
  it.each(["t3", "T3", "t3-code", "t3_code", "t3 code"])("refuses provider %s with the remedy", async (provider) => {
    const result = await call({ provider });
    expect(result).toMatchObject({ success: false, error: "provider_harness_only" });
    expect(result.message).toContain('harness "t3-code"');
  });
  it("refuses an unknown harness", async () => {
    expect(await call({ provider: "codex", harness: "other" })).toMatchObject({ success: false, error: "invalid_harness" });
  });
  it("does not treat a real client as a harness", () => {
    expect(isHarnessOnlyProvider("codex")).toBe(false);
    expect(isHarnessOnlyProvider("claude")).toBe(false);
  });
  it("records the harness against the session that ran it, keeping other room state", async () => {
    const update = vi.fn();
    const db = { workroom: { findUnique: vi.fn(async () => ({ workspaceState: { executorCheckpoint: { nextAction: "x" } } })), update } } as unknown as CapsuleDb;
    await persistExecutorHarness(db, "WC-1", "t3-code", "01a1d330-thread");
    expect(update).toHaveBeenCalledWith({ where: { capsuleId: "WC-1" }, data: { workspaceState: {
      executorCheckpoint: { nextAction: "x" }, executorHarness: expect.objectContaining({ harness: "t3-code", executorRef: "01a1d330-thread" }) } } });
  });
});
