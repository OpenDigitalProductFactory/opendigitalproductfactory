import { beforeEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ room: vi.fn(), item: vi.fn(), access: vi.fn(), lock: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { workroom: { findFirst: io.room }, backlogItem: { findFirst: io.item }, $queryRaw: io.lock } }));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({ resolveAgentWorkroomAccess: io.access }));
import { prepareWorkroomRepositorySource, prepareSourceInquiryResearch } from "./workroom-repository-source";
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

// BI-CAP-EB412C95: author research must not need a fabricated write identity.
describe("source inquiry author research", () => {
  it("admits an exact immutable research target for an actor-admitted read-only room", async () => {
    io.room.mockResolvedValue({ ...room, headBranch: null, baseSha: null, headSha: null,
      scopeClaims: [{ workShape: "source-inquiry@1.0.0" }] });
    const result = await prepareSourceInquiryResearch({ ...args,
      artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: room.repositoryFullName, commitSha: "c".repeat(40), path: "package.json", providerBlobId: "d".repeat(40) } });
    expect(result).not.toBeNull();
    expect(io.access).toHaveBeenCalled();
    expect(await result?.admissionGuard(undefined as never)).toBe(true);
  });
});

describe("read-only research authority boundaries", () => {
  const locator = { kind: "repo-blob-at-commit" as const, repositoryFullName: room.repositoryFullName,
    commitSha: "c".repeat(40), path: "package.json", providerBlobId: "d".repeat(40) };
  const inquiry = { ...room, headBranch: null, baseSha: null, headSha: null,
    scopeClaims: [{ workShape: "source-inquiry@1.0.0" }] };
  it.each([{ scopeClaims: [] }, { headBranch: "write" }, { headSha: "a".repeat(40) },
    { repositoryFullName: "foreign/repo" }, { backlogItemId: null }, { status: "archived" }])(
    "refuses invalid inquiry %j", async change => {
      io.room.mockResolvedValue({ ...inquiry, ...change });
      expect(await prepareSourceInquiryResearch({ ...args, artifactRef: locator })).toBeNull();
    });
  it.each(["access", "shape", "subject", "source"])("refuses changed %s during publication", async change => {
    io.room.mockResolvedValue(inquiry);
    const result = await prepareSourceInquiryResearch({ ...args, artifactRef: locator });
    expect(result).not.toBeNull();
    if (change === "access") io.access.mockResolvedValue({ decision: { level: "content" } });
    if (change === "shape") io.room.mockResolvedValue({ ...inquiry, scopeClaims: [] });
    if (change === "subject") io.item.mockResolvedValue({ id: "other", itemId: "BI-OTHER" });
    if (change === "source") io.room.mockResolvedValue({ ...inquiry, repositoryFullName: "other/repo" });
    expect(await result?.inquiryAdmission.isCurrent()).toBe(false);
    expect(await result?.admissionGuard(undefined as never)).toBe(false);
  });
  it("does not change generic delivery source admission", async () => {
    io.room.mockResolvedValue(inquiry);
    expect(await prepareWorkroomRepositorySource(args)).toBeNull();
  });
});

it("rechecks actor access on the supplied publication transaction, not global state", async () => {
  io.room.mockResolvedValue({ ...room, headBranch: null, baseSha: null, headSha: null,
    scopeClaims: [{ workShape: "source-inquiry@1.0.0" }] });
  const tx = { workroom: { findFirst: io.room }, backlogItem: { findFirst: io.item }, $queryRaw: io.lock };
  io.access.mockImplementation(async (_input, store) => ({ decision: { level: store === tx ? "none" : "action" } }));
  const result = await prepareSourceInquiryResearch({ ...args, artifactRef: {
    kind: "repo-blob-at-commit", repositoryFullName: room.repositoryFullName, commitSha: "c".repeat(40),
    path: "package.json", providerBlobId: "d".repeat(40) } });
  expect(result).not.toBeNull();
  expect(await result?.admissionGuard(tx as never)).toBe(false);
  expect(io.access).toHaveBeenLastCalledWith(expect.objectContaining({ requested: "action" }), tx);
});
