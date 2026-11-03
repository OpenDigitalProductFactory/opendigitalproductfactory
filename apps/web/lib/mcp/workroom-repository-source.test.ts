import { beforeEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ room: vi.fn(), item: vi.fn(), access: vi.fn(), lock: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { workroom: { findFirst: io.room }, backlogItem: { findFirst: io.item }, $queryRaw: io.lock } }));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({ resolveAgentWorkroomAccess: io.access }));
import { prepareWorkroomRepositorySource } from "./workroom-repository-source";
const room = { id: "room-row", capsuleId: "WC-COMPONENT", backlogItemId: "item-row", status: "ready", archivedAt: null,
  createdByPrincipalId: "principal-owner",
  repositoryFullName: "OpenDigitalProductFactory/dpf-workroom", headBranch: "codex/component", baseSha: "a".repeat(40), headSha: "b".repeat(40) };
const args = { workroomId: room.capsuleId, itemId: "BI-COMPONENT", userId: "human", agentId: "assistant" };
beforeEach(() => { vi.clearAllMocks(); io.room.mockResolvedValue({ ...room });
  io.item.mockResolvedValue({ id: "item-row", itemId: "BI-COMPONENT" });
  io.access.mockResolvedValue({ decision: { level: "action" } }); io.lock.mockResolvedValue([]); });
describe("public repository Workroom source admission", () => {
  it("derives identity from the persisted item and actor-admitted room", async () => {
    const result = await prepareWorkroomRepositorySource(args);
    expect(result?.sourceAdmission).toMatchObject({ itemId: "BI-COMPONENT", workroomId: room.capsuleId,
      repositoryFullName: room.repositoryFullName, branchName: room.headBranch, headSha: room.headSha });
    expect(await result?.sourceAdmission.isCurrent()).toBe(true);
    expect(await result?.admissionGuard()).toBe(true);
    expect(io.lock).toHaveBeenCalledTimes(2);
  });
  it.each([{ itemId: "BI-FOREIGN" }, { userId: undefined }, { agentId: null }, { workroomId: undefined }])(
    "refuses a wrong subject or missing actor/selector %j", async change => {
      expect(await prepareWorkroomRepositorySource({ ...args, ...change })).toBeNull();
    });
  it("does not turn content-only access into source admission", async () => {
    io.access.mockResolvedValue({ decision: { level: "content" } });
    expect(await prepareWorkroomRepositorySource(args)).toBeNull();
  });
  it.each(["headSha", "headBranch", "repositoryFullName", "backlogItemId", "createdByPrincipalId"])("refuses moved %s at receipt publication", async key => {
    const result = await prepareWorkroomRepositorySource(args);
    io.room.mockResolvedValue({ ...room, [key]: key === "headSha" ? "c".repeat(40) : "foreign" });
    expect(await result?.sourceAdmission.isCurrent()).toBe(false);
    expect(await result?.admissionGuard()).toBe(false);
  });
  it("rechecks revoked actor access at publication", async () => {
    const result = await prepareWorkroomRepositorySource(args);
    io.access.mockResolvedValue({ decision: { level: "none" } });
    expect(await result?.admissionGuard()).toBe(false);
  });
});
