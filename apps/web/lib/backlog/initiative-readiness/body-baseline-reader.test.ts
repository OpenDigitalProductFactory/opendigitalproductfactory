import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ task: vi.fn(), item: vi.fn(), room: vi.fn(), rooms: vi.fn(), snapshots: vi.fn(), version: vi.fn(), source: vi.fn(), access: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { taskRun: { findUnique: mocks.task }, backlogItem: { findUnique: mocks.item },
  workroom: { findUnique: mocks.room, findMany: mocks.rooms }, contributorInventorySnapshot: { findMany: mocks.snapshots }, documentVersion: { findUnique: mocks.version } } }));
vi.mock("./baseline-source", () => ({ loadBaselineSourceForItem: mocks.source }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: async () => ({}) }));
vi.mock("@/lib/permissions", () => ({ can: () => true }));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({ resolveAgentWorkroomAccess: mocks.access }));
import { readInitiativeBodyVersion } from "./body-baseline-reader";
import { bodyBaselineDigest, bodyCriteriaVersion } from "./body-baseline-version";
import { createPullRequestObservation } from "@/lib/contributor-change-lanes/pull-request-observation";

const body = "## Acceptance\n- Verify canonical grants.";
const digest = bodyBaselineDigest(body);
const artifactRef = { kind: "document-version" as const, repositoryFullName: "owner/repo", versionId: "version-1", valueDigest: digest };
const binding = { itemId: "BI-CASE", gate: "objective-mapping", writerToolName: "record_initiative_evidence",
  expectedCurrentBaselineId: "baseline-1", eligibleEvidenceActivityIds: ["E-1"], artifactRef,
  workroomRef: { kind: "workroom-head", workroomId: "WC-CASE", repositoryFullName: "owner/repo", headSha: "a".repeat(40), branchName: "fix/case" } };
const scope = ["tool:record_initiative_evidence", "tool:read_source_at_version", "backlog-item:BI-CASE"];
const parameters = { repositoryFullName: "owner/repo", path: "initiative-body-version/version-1", version: "version-1", expectedBlobId: digest };
const context = { taskRunId: "TR-CASE", agentId: "AGT-REVIEWER" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.task.mockResolvedValue({ userId: "user", currentAgentId: context.agentId, status: "working", completedAt: null, archivedAt: null,
    authorityScope: scope, a2aMetadata: { initiativeReviewBinding: binding } });
  mocks.item.mockResolvedValue({ id: "row", itemId: "BI-CASE", body, organizationId: "org-1" });
  mocks.room.mockResolvedValue({ id: "room", backlogItemId: "BI-CASE", headSha: binding.workroomRef.headSha,
    headBranch: binding.workroomRef.branchName, repositoryFullName: "owner/repo", archivedAt: null });
  mocks.version.mockResolvedValue({ contentText: body, contentSha256: digest, document: {
    organizationId: "org-1", externalLocator: { origin: "item-body", subject: { kind: "backlog-item", id: "BI-CASE" } } } });
  mocks.source.mockResolvedValue({ baselineRows: [{ payload: {
    baselineId: "baseline-1", supersedesBaselineId: null, origin: "item-body", criteriaDigest: bodyCriteriaVersion(body)!.criteriaDigest,
    subject: { kind: "backlog-item", id: "BI-CASE" }, authoritySnapshot: { organizationId: "org-1" }, storageOrganizationId: "org-1",
    artifactRef, sourceIdentity: { repositoryFullName: "owner/repo", headSha: binding.workroomRef.headSha },
  } }] });
  mocks.access.mockResolvedValue({ decision: { level: "content" } });
});
describe("retained body immutable reader", () => {
  it.each([true, false])("reads archived delivered authors only with current content admission=%s", async admitted => {
    const room = { id: "room", capsuleId: "WC-CASE", backlogItemId: "BI-CASE",
      repositoryFullName: "owner/repo", headSha: binding.workroomRef.headSha, headBranch: binding.workroomRef.branchName,
      baseSha: "b".repeat(40), createdByPrincipalId: "author", status: "archived", pullRequestNumber: 6265,
      archivedAt: new Date("2026-10-16T06:00:00Z"), createdAt: new Date("2026-10-15T06:00:00Z") };
    mocks.room.mockResolvedValue(room);
    mocks.rooms.mockImplementation(async ({ where }) => where.archivedAt === null ? [] : [room]);
    mocks.snapshots.mockResolvedValue([{ payload: createPullRequestObservation({ repositoryFullName: "owner/repo",
      number: 6265, url: "https://github.com/owner/repo/pull/6265", title: "repair", headBranch: room.headBranch,
      headSha: room.headSha, state: "merged", isDraft: false, mergeStateStatus: null, mergeCommitSha: "c".repeat(40),
      mergedAt: "2026-10-16T05:00:00Z", providerUpdatedAt: "2026-10-16T05:00:00Z", observedAt: "2026-10-16T05:01:00Z" }) }]);
    mocks.access.mockResolvedValue({ decision: { level: admitted ? "content" : "none" } });
    const result = await readInitiativeBodyVersion(parameters, "user", context);
    expect(result.success).toBe(admitted);
    if (!admitted) expect(mocks.version).not.toHaveBeenCalled();
  });
  it("uses the canonical page contract for the exact authorized review", async () => {
    const result = await readInitiativeBodyVersion(parameters, "user", context);
    expect(result).toMatchObject({ success: true, data: { path: parameters.path, version: parameters.version,
      blobId: digest, content: body, hasMore: false, nextCursor: null } });
  });
  it("cannot be used as an unbound general document reader", async () => {
    expect(await readInitiativeBodyVersion(parameters, "user")).toMatchObject({ success: false, error: "immutable_review_binding_required" });
    expect(mocks.version).not.toHaveBeenCalled();
  });
  it("refuses cross-tenant retained documents even when their locator and digest look correct", async () => {
    mocks.version.mockResolvedValue({ contentText: body, contentSha256: digest, document: {
      organizationId: "org-other", externalLocator: { origin: "item-body", subject: { kind: "backlog-item", id: "BI-CASE" } } } });
    expect(await readInitiativeBodyVersion(parameters, "user", context)).toMatchObject({ success: false, error: "immutable_blob_mismatch" });
  });
  it("refuses revoked reviewer or delegating-person room admission before reading bytes", async () => {
    mocks.access.mockResolvedValue({ decision: { level: "none", reason: "not-admitted" } });
    expect(await readInitiativeBodyVersion(parameters, "user", context)).toMatchObject({ success: false, error: "workroom_access_denied" });
    expect(mocks.version).not.toHaveBeenCalled();
  });
  it.each([
    { userId: "other-user" }, { currentAgentId: "AGT-OTHER" }, { status: "completed" },
    { authorityScope: ["tool:read_source_at_version", "backlog-item:BI-CASE"] },
    { authorityScope: ["tool:record_initiative_evidence", "tool:read_source_at_version", "backlog-item:BI-OTHER"] },
  ])("refuses changed task authority %s", async (change) => {
    mocks.task.mockResolvedValue({ userId: "user", currentAgentId: context.agentId, status: "working", completedAt: null, archivedAt: null,
      authorityScope: scope, a2aMetadata: { initiativeReviewBinding: binding }, ...change });
    expect((await readInitiativeBodyVersion(parameters, "user", context)).success).toBe(false);
    expect(mocks.version).not.toHaveBeenCalled();
  });
});
