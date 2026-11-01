import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ room: vi.fn(), access: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { workroom: { findFirst: mocks.room } } }));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({ resolveAgentWorkroomAccess: mocks.access }));
import { resolveWorkroomReadSource } from "./backlog-workroom-read-source";
const args = { workroomId: "WC-EXACT", userId: "human", agentId: "assistant", itemId: "BI-ITEM", itemRowId: "item-row" };
const room = { id: "room-row", capsuleId: "WC-EXACT", backlogItemId: "BI-ITEM", status: "ready", archivedAt: null,
  repositoryFullName: "org/repo", headBranch: "codex/fix", baseSha: "a".repeat(40), headSha: "b".repeat(40) };
beforeEach(() => { vi.clearAllMocks(); mocks.room.mockResolvedValue({ ...room }); mocks.access.mockResolvedValue({ decision: { level: "action" } }); });
describe("exact room readiness source", () => {
  it("uses only persisted identity after joint human and assistant action access", async () => {
    const result = await resolveWorkroomReadSource(args);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected selected source");
    expect(result.source).toEqual({ workroomId: room.capsuleId, repositoryFullName: room.repositoryFullName,
      headBranch: room.headBranch, baseSha: room.baseSha, headSha: room.headSha });
    expect(mocks.access).toHaveBeenCalledWith({ userId: "human", agentId: "assistant", workroomId: "room-row", requested: "action" });
    expect(await result.isCurrent()).toBe(true);
  });
  it.each([{ workroomId: "" }, { workroomId: 7 }, { userId: undefined }, { agentId: null }])("refuses missing actor or selector %j", async change => {
    expect((await resolveWorkroomReadSource({ ...args, ...change })).ok).toBe(false);
  });
  it.each([{ backlogItemId: "BI-FOREIGN" }, { capsuleId: "WC-FOREIGN" }, { headSha: "short" },
    { baseSha: null }, { repositoryFullName: "" }, { headBranch: "" }, { archivedAt: new Date() },
    ...["archived", "abandoned", "superseded", "complete"].map(status => ({ status }))])("refuses invalid persisted binding %j", async change => {
    mocks.room.mockResolvedValue({ ...room, ...change });
    expect((await resolveWorkroomReadSource(args)).ok).toBe(false);
  });
  it("refuses content-only access", async () => {
    mocks.access.mockResolvedValue({ decision: { level: "content" } });
    expect((await resolveWorkroomReadSource(args)).ok).toBe(false);
  });
  it.each(["headSha", "baseSha", "headBranch", "backlogItemId", "id"])("refuses changed %s after provider reads", async key => {
    const result = await resolveWorkroomReadSource(args);
    if (!result.ok) throw new Error("Expected selected source");
    mocks.room.mockResolvedValue({ ...room, [key]: key.endsWith("Sha") ? "c".repeat(40) : "changed" });
    expect(await result.isCurrent()).toBe(false);
  });
  it("rechecks access before returning a packet", async () => {
    const result = await resolveWorkroomReadSource(args);
    if (!result.ok) throw new Error("Expected selected source");
    mocks.access.mockResolvedValue({ decision: { level: "none" } });
    expect(await result.isCurrent()).toBe(false);
  });
});
