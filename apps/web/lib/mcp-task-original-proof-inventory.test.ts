import { describe, expect, it, vi } from "vitest";
import { collectOriginalProofInventory, reconcileOriginalProofInventory, ORIGINAL_PROOF_INVENTORY_LIMIT } from "./mcp-task-original-proof-inventory";

const at = new Date("2026-10-18T21:06:45Z");
function fixture() {
  return { taskRowId: "row-original", taskRunId: "TR-ORIGINAL", userId: "human", ports: {
    artifacts: vi.fn(async (): Promise<unknown[]> => []), tools: vi.fn(async (): Promise<unknown[]> => []),
    approvals: vi.fn(async (): Promise<unknown[]> => []), operations: vi.fn(async (): Promise<unknown[]> => []),
  } };
}

describe("bounded original proof inventory", () => {
  it("reports empty observations with explicit producer gaps, not a complete empty effect set", async () => {
    const result = await collectOriginalProofInventory(fixture());
    expect(result.inventory).toMatchObject({ status: "observed", captureComplete: false, settlement: "unknown",
      counts: { taskArtifacts: 0, toolExecutions: 0, approvalEnvelopes: 0, asyncOperations: 0 } });
    expect(result.inventory.missingEvidence).toHaveLength(6);
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses row identity for artifact/operation relations and semantic identity for tools/approvals", async () => {
    const input = fixture();
    input.ports.artifacts.mockResolvedValue([{ id: "artifact", taskRunId: input.taskRowId, createdAt: at }]);
    input.ports.operations.mockResolvedValue([{ id: "operation", taskRunId: input.taskRowId, createdAt: at }]);
    input.ports.tools.mockResolvedValue([{ id: "tool", taskRunId: input.taskRunId, userId: input.userId, createdAt: at }]);
    input.ports.approvals.mockResolvedValue([{ id: "approval", taskRunId: input.taskRunId, delegatingUserId: input.userId, createdAt: at }]);
    expect((await collectOriginalProofInventory(input)).inventory.counts)
      .toEqual({ taskArtifacts: 1, toolExecutions: 1, approvalEnvelopes: 1, asyncOperations: 1 });
    input.ports.artifacts.mockResolvedValue([{ id: "artifact", taskRunId: input.taskRunId, createdAt: at }]);
    expect((await collectOriginalProofInventory(input)).inventory).toMatchObject({ status: "binding-mismatch" });
  });

  it.each(["artifacts", "tools", "approvals", "operations"] as const)("withholds partial observations after %s failure or overflow", async family => {
    const input = fixture();
    input.ports[family].mockRejectedValue(new Error("private provider output"));
    let result = await collectOriginalProofInventory(input);
    expect(result.inventory.status).toBe("unavailable");
    expect(result.inventory).not.toHaveProperty("counts");
    expect(JSON.stringify(result)).not.toContain("private provider output");
    input.ports[family].mockResolvedValue(Array.from({ length: ORIGINAL_PROOF_INVENTORY_LIMIT + 1 }, () => ({})));
    result = await collectOriginalProofInventory(input);
    expect(result.inventory.status).toBe("over-budget");
    expect(result.inventory).not.toHaveProperty("counts");
  });

  it.each(["task", "actor", "duplicate", "time"])("withholds %s mismatches", async change => {
    const input = fixture();
    const row = { id: "tool", taskRunId: input.taskRunId, userId: input.userId, createdAt: at };
    input.ports.tools.mockResolvedValue(change === "duplicate" ? [row, row]
      : [{ ...row, ...(change === "task" ? { taskRunId: "TR-OTHER" } : {}),
        ...(change === "actor" ? { userId: "foreign" } : {}), ...(change === "time" ? { createdAt: new Date(NaN) } : {}) }]);
    expect((await collectOriginalProofInventory(input)).inventory.status).toBe("binding-mismatch");
  });

  it("does not turn printable claims or completed operations into closure or replay authority", async () => {
    const input = fixture();
    input.ports.operations.mockResolvedValue([{ id: "operation", taskRunId: input.taskRowId, createdAt: at,
      status: "completed", childClosure: "verified", captureComplete: true, secret: "not returned" }]);
    const result = await collectOriginalProofInventory(input);
    expect(result.inventory).toMatchObject({ captureComplete: false, settlement: "unknown" });
    expect(result.inventory).not.toHaveProperty("replayAllowed");
    expect(JSON.stringify(result)).not.toContain("not returned");
  });

  it("withholds counts if an approval arrives during collection without updating the task", async () => {
    const input = fixture();
    const before = await collectOriginalProofInventory(input);
    input.ports.approvals.mockResolvedValue([{ id: "late", taskRunId: input.taskRunId, delegatingUserId: input.userId, createdAt: at }]);
    const after = await collectOriginalProofInventory(input);
    expect(reconcileOriginalProofInventory(before, after)).toMatchObject({ status: "changed", captureComplete: false });
    expect(reconcileOriginalProofInventory(before, after)).not.toHaveProperty("counts");
    expect(reconcileOriginalProofInventory(before, before).status).toBe("observed");
  });

  it("preserves an unavailable second read instead of returning the first inventory", async () => {
    const input = fixture();
    const before = await collectOriginalProofInventory(input);
    input.ports.artifacts.mockRejectedValue(new Error("unavailable"));
    expect(reconcileOriginalProofInventory(before, await collectOriginalProofInventory(input)).status).toBe("unavailable");
  });

  it("detects a changed operation timestamp even when its id, status and count stay the same", async () => {
    const input = fixture();
    const operation = { id: "operation", taskRunId: input.taskRowId, createdAt: at, updatedAt: at, status: "pending" };
    input.ports.operations.mockResolvedValue([operation]);
    const before = await collectOriginalProofInventory(input);
    input.ports.operations.mockResolvedValue([{ ...operation, updatedAt: new Date(at.getTime() + 1) }]);
    expect(reconcileOriginalProofInventory(before, await collectOriginalProofInventory(input)).status).toBe("changed");
  });
});
