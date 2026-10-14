import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ source: vi.fn() }));
vi.mock("./baseline-source", () => ({ loadBaselineSourceForItem: mocks.source }));
import { ensureItemBodyBaseline } from "./body-baseline-persistence";
const body = "## Acceptance\n- Verify canonical grants.";
const item = { id: "row", itemId: "BI-CASE", body, organizationId: null };
const args = { item: item as never, profile: "fix" as const, effectiveShape: "medium",
  actor: { actorType: "agent" as const, actorRef: "AGT-AUTHOR", humanContextRef: "user", agentContextRef: "AGT-AUTHOR" },
  authority: { actionKey: "update_backlog_item_status", objectRef: "BI-CASE", rationale: {}, organizationId: null,
    authoritySnapshot: { decision: "allow" as const, effectiveHumanCapability: "manage_backlog", effectiveAgentGrant: "backlog_write",
      tokenScope: "organization", organizationId: "platform", actionKey: "update_backlog_item_status", policyVersion: "authority-v1" } } };
let history: Array<{ payload: unknown; recordedAt: Date }>;
let tx: ReturnType<typeof database>;
function database() {
  return { workroom: { findMany: vi.fn().mockResolvedValue([{ capsuleId: "WC-CASE", repositoryFullName: "owner/repo", headSha: "a".repeat(40), createdByPrincipalId: "owner" }]) },
    principalAlias: { findMany: vi.fn().mockResolvedValue([{ principalId: "owner" }]) },
    organization: { findFirst: vi.fn().mockResolvedValue({ id: "storage-org" }) },
    document: { create: vi.fn().mockResolvedValue({ id: "doc" }), update: vi.fn() },
    documentVersion: { create: vi.fn().mockResolvedValue({ id: "version" }) },
    backlogItemActivity: { create: vi.fn(async ({ data }) => { history.push({ payload: data.payload, recordedAt: new Date() }); return data; }) },
    initiativeArtifactRetentionPin: { create: vi.fn() } };
}
beforeEach(() => { history = []; tx = database(); mocks.source.mockImplementation(async () => ({ origin: "own", baselineRows: history })); });
describe("body criteria capture in the authorized subject transaction", () => {
  it("retains criteria and source identity, with no acceptance or spec approval receipt", async () => {
    await ensureItemBodyBaseline(tx as never, args);
    expect(tx.documentVersion.create).toHaveBeenCalledOnce();
    expect(tx.backlogItemActivity.create).toHaveBeenCalledOnce();
    const payload = tx.backlogItemActivity.create.mock.calls[0]![0].data.payload;
    expect(payload).toMatchObject({ origin: "item-body", artifactRef: { kind: "document-version", versionId: "version" },
      sourceIdentity: { headSha: "a".repeat(40) }, approvalReceiptId: null, objectiveStatements: [],
      acceptanceStatements: [{ acceptanceId: "AC-BODY-001", artifactAnchor: "line:2" }] });
    expect(tx.initiativeArtifactRetentionPin.create).toHaveBeenCalledOnce();
  });
  it("makes unchanged retries idempotent and explicitly supersedes changed criteria", async () => {
    await ensureItemBodyBaseline(tx as never, args);
    await ensureItemBodyBaseline(tx as never, args);
    expect(tx.documentVersion.create).toHaveBeenCalledOnce();
    const firstId = (history[0]!.payload as { baselineId: string }).baselineId;
    await ensureItemBodyBaseline(tx as never, { ...args, item: { ...item, body: "## Acceptance\n- Verify revocations." } as never });
    expect(tx.documentVersion.create).toHaveBeenCalledTimes(2);
    expect(history[1]!.payload).toMatchObject({ supersedesBaselineId: firstId });
  });
  it.each([
    { effectiveShape: "large" }, { effectiveShape: "small" },
    { authority: { ...args.authority, organizationId: "another-org" } },
    { authority: { ...args.authority, authoritySnapshot: { ...args.authority.authoritySnapshot, effectiveAgentGrant: "file_read" } } },
  ])("refuses inappropriate shape or authority without writing a snapshot", async (change) => {
    await ensureItemBodyBaseline(tx as never, { ...args, ...change });
    expect(tx.documentVersion.create).not.toHaveBeenCalled();
  });
  it.each(["inherited", "approved"])("preserves %s scope", async (origin) => {
    mocks.source.mockResolvedValue({ origin: origin === "inherited" ? "inherited" : "own",
      baselineRows: origin === "approved" ? [{ payload: { baselineId: "approved", supersedesBaselineId: null, approvalReceiptId: "receipt" } }] : [] });
    await ensureItemBodyBaseline(tx as never, args);
    expect(tx.documentVersion.create).not.toHaveBeenCalled();
  });
  it("fails closed on malformed history and ambiguous ownership", async () => {
    mocks.source.mockResolvedValue({ origin: "own", baselineRows: [{ payload: { baselineId: "broken" } }] });
    await ensureItemBodyBaseline(tx as never, args);
    expect(tx.documentVersion.create).not.toHaveBeenCalled();
    mocks.source.mockResolvedValue({ origin: "own", baselineRows: [] });
    tx.workroom.findMany.mockResolvedValue([]);
    await ensureItemBodyBaseline(tx as never, args);
    expect(tx.documentVersion.create).not.toHaveBeenCalled();
  });
});
