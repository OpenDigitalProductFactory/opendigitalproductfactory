import { describe, expect, it, vi } from "vitest";
import { listWorkroomObservation } from "./list-observation";
import { WorkroomObservations } from "./observation-pages";
import { clampToolResultForModel } from "@/lib/tak/tool-result-budget";

const context = { userContext: { userId: "u", platformRole: "HR-000", isSuperuser: true } };
const fixture = () => Array.from({ length: 251 }, (_, i) => ({
  capsuleId: `WC-${i}`, title: "Room", status: "ready", source: "external-adoption", executorKind: "codex-desktop",
  leaseHolderPrincipalId: "u", executorRef: "session", updatedAt: new Date(),
  leaseExpiresAt: i === 200 ? new Date(0) : new Date(Date.now() + 3600000),
  repositoryFullName: "o/r", headBranch: "fix/r", baseSha: "a", headSha: "b", taskRun: null,
}));

describe("Workroom observation loading and transport", () => {
  it("filters stale rooms before paging and takes one read-only consistent observation", async () => {
    const source = fixture();
    const tx = { $executeRawUnsafe: vi.fn(), workroom: { findMany: vi.fn().mockResolvedValue(source) }, featureBuild: { findMany: vi.fn().mockResolvedValue([]) } };
    const db = { $transaction: vi.fn(async (fn: (arg: typeof tx) => Promise<unknown>) => fn(tx)) };
    const result = await listWorkroomObservation(db as never, { staleOnly: true, limit: 1 }, "u", context, new WorkroomObservations());
    expect(result.success).toBe(true);
    expect((result.data as any).capsules.map((r: any) => r.capsuleId)).toEqual(["WC-200"]);
    expect((result.data as any).page).toMatchObject({ populationCount: 1, nextCursor: null });
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
