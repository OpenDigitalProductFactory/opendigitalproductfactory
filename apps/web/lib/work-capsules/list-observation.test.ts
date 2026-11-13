import { describe, expect, it, vi } from "vitest";
import { listWorkroomObservation } from "./list-observation";
import { WorkroomObservations } from "./observation-pages";
import { clampToolResultForModel } from "@/lib/tak/tool-result-budget";
vi.mock("./handler-actor", () => ({ workCapsuleActor: vi.fn(async () => ({ principalId: "human-u", agentPrincipalId: "assistant" })) }));

const context = { userContext: { userId: "u", platformRole: "HR-000", isSuperuser: true } };
const fixture = () => Array.from({ length: 251 }, (_, i) => ({
  capsuleId: `WC-${i}`, title: "Room", status: "ready", source: "external-adoption", executorKind: "codex-desktop",
  leaseHolderPrincipalId: "u", executorRef: "session", updatedAt: new Date(),
  leaseExpiresAt: i === 200 ? new Date(0) : new Date(Date.now() + 3600000),
  repositoryFullName: "o/r", headBranch: "fix/r", baseSha: "a", headSha: "b", taskRun: null,
}));

describe("Workroom observation loading and transport", () => {
  it("constrains OAuth observations and their totals to the human and assistant", async () => {
    const tx = { $executeRawUnsafe: vi.fn(), workroom: { findMany: vi.fn().mockResolvedValue([]) }, featureBuild: { findMany: vi.fn().mockResolvedValue([]) } };
    const db = { $transaction: vi.fn(async (fn: (arg: typeof tx) => Promise<unknown>) => fn(tx)) };
    const result = await listWorkroomObservation(db as never, {}, "u", { ...context, authSource: "oauth", agentId: "claude" }, new WorkroomObservations());
    expect((result.data as any).page.ownershipScope).toBe("caller-visible");
    expect(tx.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [
      { OR: [{ leaseHolderPrincipalId: "human-u" }, { createdByPrincipalId: "human-u" }, { requestedByPrincipalId: "human-u" }] },
      { OR: [{ leaseHolderPrincipalId: "assistant" }, { createdByPrincipalId: "assistant" }, { requestedByPrincipalId: "assistant" }] },
    ] } }));
  });
  it("finds the person's room by PR or branch even when another assistant created it, disclosing only the handover (BI-679D2BF6)", async () => {
    const own = { ...fixture()[0], capsuleId: "WC-OWN", createdByPrincipalId: "assistant", requestedByPrincipalId: "human-u", pullRequestNumber: 6275 };
    const other = { ...fixture()[1], capsuleId: "WC-CODEX", title: "Secret title", worktreePath: "/private/path",
      leaseHolderPrincipalId: "human-u", createdByPrincipalId: "codex-assistant", requestedByPrincipalId: "human-u", pullRequestNumber: 6275 };
    const tx = { $executeRawUnsafe: vi.fn(), workroom: { findMany: vi.fn().mockResolvedValue([own, other]) }, featureBuild: { findMany: vi.fn().mockResolvedValue([]) } };
    const db = { $transaction: vi.fn(async (fn: (arg: typeof tx) => Promise<unknown>) => fn(tx)) };
    const result = await listWorkroomObservation(db as never, { pullRequestNumber: 6275 }, "u",
      { ...context, authSource: "oauth", agentId: "AGT-EXT-CLAUDE" }, new WorkroomObservations());
    expect(tx.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { pullRequestNumber: 6275, AND: [
      { OR: [{ leaseHolderPrincipalId: "human-u" }, { createdByPrincipalId: "human-u" }, { requestedByPrincipalId: "human-u" }] },
    ] } }));
    const rows = (result.data as any).capsules;
    expect(rows.find((r: any) => r.capsuleId === "WC-OWN")).not.toHaveProperty("admission");
    const handover = rows.find((r: any) => r.capsuleId === "WC-CODEX");
    expect(handover).toMatchObject({ capsuleId: "WC-CODEX", status: "ready", admission: "handover-required", pullRequestNumber: 6275,
      handover: { tool: "reassign_workroom_executor", arguments: { capsuleId: "WC-CODEX", toExecutorKind: "claude-desktop" } } });
    expect(JSON.stringify(handover)).not.toMatch(/Secret title|\/private\/path/);
  });

  it("filters by branch and keeps both principals for an unfiltered OAuth listing", async () => {
    const tx = { $executeRawUnsafe: vi.fn(), workroom: { findMany: vi.fn().mockResolvedValue([]) }, featureBuild: { findMany: vi.fn().mockResolvedValue([]) } };
    const db = { $transaction: vi.fn(async (fn: (arg: typeof tx) => Promise<unknown>) => fn(tx)) };
    await listWorkroomObservation(db as never, { headBranch: "codex/external-client-verification" }, "u", { ...context, authSource: "oauth", agentId: "claude" }, new WorkroomObservations());
    expect(tx.workroom.findMany.mock.calls[0][0].where).toMatchObject({ headBranch: "codex/external-client-verification" });
    expect(tx.workroom.findMany.mock.calls[0][0].where.AND).toHaveLength(1);
    await listWorkroomObservation(db as never, { pullRequestNumber: -1, headBranch: " " }, "u", { ...context, authSource: "oauth", agentId: "claude" }, new WorkroomObservations());
    expect(tx.workroom.findMany.mock.calls[1][0].where).not.toHaveProperty("pullRequestNumber");
    expect(tx.workroom.findMany.mock.calls[1][0].where.AND).toHaveLength(2);
  });

  it("filters stale rooms before paging and takes one read-only consistent observation", async () => {
    const source = fixture();
    const tx = { $executeRawUnsafe: vi.fn(), workroom: { findMany: vi.fn().mockResolvedValue(source) }, featureBuild: { findMany: vi.fn().mockResolvedValue([]) } };
    const db = { $transaction: vi.fn(async (fn: (arg: typeof tx) => Promise<unknown>) => fn(tx)) };
    const result = await listWorkroomObservation(db as never, { staleOnly: true, limit: 1 }, "u", context, new WorkroomObservations());
    expect(result.success).toBe(true);
    expect((result.data as any).capsules.map((r: any) => r.capsuleId)).toEqual(["WC-200"]);
    expect((result.data as any).page).toMatchObject({ populationCount: 1, nextCursor: null, ownershipScope: "installation" });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith("SET TRANSACTION READ ONLY");
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", timeout: 5000, maxWait: 1000 });
    expect(tx.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10001, orderBy: [{ updatedAt: "desc" }, { capsuleId: "asc" }] }));
  });

  it("native and external serialized forms retain identical complete typed pages and cursors", () => {
    const result = new WorkroomObservations().capture(fixture(), { principal: "u", authority: "a", filters: {} });
    const native = clampToolResultForModel(result);
    expect(native.truncated).toBe(false);
    expect(JSON.parse(native.text.slice(native.text.indexOf("\n") + 1))).toEqual(result.data);
    const external = JSON.stringify(result, null, 2);
    expect(external.length).toBeLessThanOrEqual(4000);
    expect(JSON.parse(external).data).toEqual(result.data);
  });

  it("requires trusted context and returns typed restart guidance for lost observations", async () => {
    expect(await listWorkroomObservation({} as never, {}, "u")).toMatchObject({ success: false, error: "authority_context_required" });
    expect(await listWorkroomObservation({} as never, { cursor: "invalid" }, "u", context)).toMatchObject({
      success: false, error: "invalid_cursor", data: { page: { disposition: "restart-required" } },
    });
  });

  it("refuses a page exceeding a smaller caller cap without returning a misleading text prefix", () => {
    const result = new WorkroomObservations().capture(fixture(), { principal: "u", authority: "a", filters: {} });
    const output = clampToolResultForModel(result, { maxChars: 300 });
    expect(JSON.parse(output.text)).toMatchObject({ success: false, error: "page_budget_too_small" });
    expect(output.text.length).toBeLessThanOrEqual(300);
  });

  it("preserves typed restart guidance for native agents without exposing unrelated error data", async () => {
    const result = await listWorkroomObservation({} as never, { cursor: "invalid", status: "ready" }, "u", context);
    const output = clampToolResultForModel(result);
    expect(JSON.parse(output.text)).toMatchObject({ success: false, error: "invalid_cursor",
      data: { page: { version: 1, disposition: "restart-required" }, recovery: { toolName: "list_workrooms", arguments: { status: "ready" } } } });
    const tiny = clampToolResultForModel(result, { maxChars: 300 });
    expect(JSON.parse(tiny.text)).toMatchObject({ success: false, error: "page_budget_too_small" });
    expect(tiny.text.length).toBeLessThanOrEqual(300);
  });
});
