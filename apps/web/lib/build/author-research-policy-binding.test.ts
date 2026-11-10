import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@dpf/db";
import { digestBuildArtifactValue } from "./build-artifact-provenance";
import { describeResearchAttestation } from "./ideate-research-receipt";
import { resolveAuthorResearchPolicyBinding } from "./author-research-policy-binding";
import { requiresBuildStartApproval } from "./build-start-approval";

const authority = vi.hoisted(() => ({ human: vi.fn(), capabilities: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: authority.human }));
vi.mock("@/lib/permissions", () => ({ getGrantedCapabilities: authority.capabilities }));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({ resolveAgentWorkroomAccess: authority.access }));

function fixture() {
  const value = { problemStatement: "Preserve research", existingFunctionalityAudit: "Inspected canonical source", reusePlan: "Reuse existing policy" };
  const revision = { id: "revision-1", value, valueDigest: digestBuildArtifactValue(value),
    field: "designDoc", status: "accepted", savedByUserId: "user-author", savedByAgentId: null,
    build: { buildId: "FB-AUTHOR", createdById: "user-author", originator: { itemId: "BI-AUTHOR" },
      originatingBacklogItemId: "internal-row", draftApprovedAt: null, abandonedAt: null, artifactRevisions: [{ id: "revision-1" }] } };
  const room = { id: "room-row", capsuleId: "WC-AUTHOR", executorKind: "build-studio", executorRef: "FB-AUTHOR", status: "working",
    scopeClaims: [], participants: [{ principalId: "agent-row", roles: ["contributor"] }] };
  const agent = { status: "active", archived: false, sensitivity: "internal", governanceProfile: null,
    toolGrants: [{ grantKey: "initiative_evidence_write" }], toolGrantRevocations: [] as { grantKey: string }[] };
  const db = { buildArtifactRevision: { findUnique: vi.fn(async () => revision) },
    workroom: { findUnique: vi.fn(async () => room), findFirst: vi.fn(async () => ({ id: room.id })) }, agent: { findFirst: vi.fn(async () => agent) },
    principalAlias: { findMany: vi.fn(async () => [{ principal: { principalId: "principal-author" } }]),
      findFirst: vi.fn(async () => ({ principalId: "agent-row" })) } };
  const params = { itemId: "BI-AUTHOR", gate: "research", decision: "pass",
    artifactRef: { kind: "feature-build-revision", revisionId: revision.id },
    reason: describeResearchAttestation(value), findings: [], resolvedFindingRefs: [] };
  const args = { toolName: "record_initiative_evidence", params, userId: "user-author", agentId: "AGT-WS-BUILD",
    itemId: "BI-AUTHOR", routeContext: "/build/work/WC-AUTHOR" };
  return { args, db, revision, room, agent, resolve: () => resolveAuthorResearchPolicyBinding(args, db as unknown as Prisma.TransactionClient) };
}

beforeEach(() => {
  authority.human.mockResolvedValue({ userId: "user-author", platformRole: "admin", isSuperuser: false });
  authority.capabilities.mockReturnValue(["manage_backlog"]);
  authority.access.mockResolvedValue({ decision: { level: "action" } });
});

describe("canonical author research policy binding", () => {
  it("binds current accepted bytes, actual creator/saver and exact admitted room while preserving unknown agent", async () => {
    const f = fixture();
    const binding = await f.resolve();
    expect(binding).toMatchObject({ itemId: "BI-AUTHOR", revisionId: "revision-1", authorUserId: "user-author",
      authorPrincipalId: "principal-author", authorAgentId: null, workroomId: "WC-AUTHOR" });
    expect(binding?.contentDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(authority.access).toHaveBeenCalledWith({ userId: "user-author", agentId: "AGT-WS-BUILD", workroomId: "room-row", requested: "action" }, f.db);
    expect(f.revision.build.draftApprovedAt).toBeNull();
    expect(requiresBuildStartApproval(f.revision.build, "ideate", "plan")).toBe(true);
    expect(requiresBuildStartApproval(f.revision.build, "plan", "build")).toBe(true);
  });

  it.each(["other-creator", "other-saver", "stale-revision", "foreign-subject", "foreign-room", "closed-room", "bad-digest",
    "no-research", "unknown-author", "inactive-human", "capability-removed", "participant-removed", "grant-revoked", "restricted", "unavailable",
    "objective-mapping", "failed-verdict", "findings", "wrong-reason", "other-tool", "superseded-room", "observer"])("refuses %s without supplying policy authority", async (kind) => {
    const f = fixture();
    if (kind === "other-creator") f.revision.build.createdById = "other";
    if (kind === "other-saver") f.revision.savedByUserId = "other";
    if (kind === "stale-revision") f.revision.build.artifactRevisions[0]!.id = "newer";
    if (kind === "foreign-subject") f.revision.build.originator.itemId = "other";
    if (kind === "foreign-room") f.room.executorRef = "other";
    if (kind === "closed-room") f.room.status = "completed";
    if (kind === "bad-digest") f.revision.valueDigest = "forged";
    if (kind === "no-research") { f.revision.value.existingFunctionalityAudit = ""; f.revision.value.reusePlan = ""; }
    if (kind === "unknown-author") f.db.principalAlias.findMany.mockResolvedValue([]);
    if (kind === "inactive-human") authority.human.mockResolvedValue(null);
    if (kind === "capability-removed") authority.capabilities.mockReturnValue([]);
    if (kind === "participant-removed") authority.access.mockResolvedValue({ decision: { level: "none" } });
    if (kind === "grant-revoked") f.agent.toolGrantRevocations.push({ grantKey: "initiative_evidence_write" });
    if (kind === "restricted") f.agent.sensitivity = "restricted";
    if (kind === "unavailable") f.db.buildArtifactRevision.findUnique.mockRejectedValue(new Error("unavailable"));
    if (kind === "objective-mapping") Object.assign(f.args.params, { operation: "objective-mapping" });
    if (kind === "failed-verdict") f.args.params.decision = "fail";
    if (kind === "findings") Object.assign(f.args.params, { findings: [{ issue: "open" }] });
    if (kind === "wrong-reason") f.args.params.reason = "Caller claims research";
    if (kind === "other-tool") f.args.toolName = "record_initiative_design_review";
    if (kind === "superseded-room") f.db.workroom.findFirst.mockResolvedValue({ id: "new-room" });
    if (kind === "observer") f.room.participants[0]!.roles = ["observer"];
    expect(await f.resolve()).toBeNull();
  });

  it("rechecks revocation and participation after the original judgment", async () => {
    const f = fixture();
    expect(await f.resolve()).not.toBeNull();
    f.agent.toolGrantRevocations.push({ grantKey: "initiative_evidence_write" });
    expect(await f.resolve()).toBeNull();
    f.agent.toolGrantRevocations.length = 0;
    authority.access.mockResolvedValue({ decision: { level: "none" } });
    expect(await f.resolve()).toBeNull();
  });
});
