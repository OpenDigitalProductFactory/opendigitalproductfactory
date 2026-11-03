import { describe, expect, it, vi } from "vitest";
import { completionInputBinding, readCompletionInput, retainCompletionInput, publicCompletionActivityPayload } from "./completion-input-context";

const item = { id: "row", itemId: "BI-1", status: "awaiting-acceptance", body: "## Acceptance\n- Verify repair.",
  title: "Repair", workType: "bug", type: "product", source: "user-request", scopeKind: "platform",
  organizationId: null, digitalProductId: null, epicId: null, archetypeCategories: [], archetypeIds: [],
  claimedAt: null, createdAt: new Date("2026-10-31T00:00:00Z") };
const room = { capsuleId: "WC-1", repositoryFullName: "org/repo", headBranch: "fix/repair",
  baseSha: "a".repeat(40), headSha: "b".repeat(40) };
const baseline = { baselineId: "B-1", origin: "item-body", artifactRef: { kind: "document-version", versionId: "V-1" } };
const input = { item, room, baseline, shape: "delivery-medium@1.0.0", editPaths: ["a.ts"] };
const binding = completionInputBinding(input)!;
const manifest = { workClass: "implementation", evidenceActivityIds: ["E-1"], useActiveBuildEvidence: false,
  ux: { disposition: "not-applicable", reason: "No user-facing change." },
  migration: { disposition: "not-applicable", reason: "No schema or persisted format change." } };
function payload() {
  return { schemaVersion: 1, subject: { kind: "backlog-item", id: item.itemId }, target: "completion",
    verdict: "input-required", enforcementState: "enforced",
    authoritySnapshot: { decision: "allow", actionKey: "update_backlog_item_status" },
    completionInputContext: retainCompletionInput(binding, manifest) };
}
function db(rows: unknown[]) {
  return { backlogItemActivity: { findMany: vi.fn(async () => rows.slice(0, 1).map(payload => ({ payload }))) } };
}
describe("current completion input context", () => {
  it("keeps the input context out of public activity projections", () => {
    const row = payload();
    expect(publicCompletionActivityPayload(row)).not.toHaveProperty("completionInputContext");
    expect(publicCompletionActivityPayload(row)).toMatchObject({ verdict: "input-required" });
    expect(publicCompletionActivityPayload(null)).toBeNull();
  });
  it("retains submitted classifications, not a verdict", async () => {
    const client = db([payload()]);
    expect(await readCompletionInput(client, item, binding)).toEqual(manifest);
    expect(client.backlogItemActivity.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 1, where: { backlogItemId: item.id, kind: "initiative_readiness_decision" } }));
  });
  it.each([
    { ...input, item: { ...item, body: "Changed scope" } },
    { ...input, item: { ...item, organizationId: "another-org" } },
    { ...input, item: { ...item, workType: "feature" } },
    { ...input, room: { ...room, capsuleId: "WC-NEW" } },
    { ...input, room: { ...room, headSha: "c".repeat(40) } },
    { ...input, baseline: { ...baseline, baselineId: "B-2" } },
    { ...input, editPaths: ["b.ts"] },
    { ...input, shape: "delivery-large@1.0.0" },
  ])("rejects changed source or scope binding %#", async changed => {
    expect(await readCompletionInput(db([payload()]), item, completionInputBinding(changed))).toBeUndefined();
  });
  it.each([null, {}, { ...payload(), completionInputContext: null },
    { ...payload(), subject: { kind: "backlog-item", id: "BI-OTHER" } },
    { ...payload(), authoritySnapshot: { decision: "deny", actionKey: "update_backlog_item_status" } },
    { ...payload(), completionInputContext: { ...payload().completionInputContext, schemaVersion: 2 } },
  ])("never falls through a malformed latest attempt to older inputs %#", async latest => {
    expect(await readCompletionInput(db([latest, payload()]), item, binding)).toBeUndefined();
  });
  it("does not retain unbounded rationale or invalid inputs", () => {
    expect(retainCompletionInput(binding, null)).toBeNull();
    expect(retainCompletionInput(binding, { ...manifest, ux: { disposition: "not-applicable", reason: "x".repeat(40_000) } })).toBeNull();
  });
  it("does not apply the new reuse lane to other shapes or missing immutable sources", () => {
    expect(completionInputBinding({ ...input, room: null })).toBeNull();
    expect(completionInputBinding({ ...input, room: { ...room, headSha: "short" } })).toBeNull();
    expect(completionInputBinding({ ...input, item: { ...item, status: "done" } })).toBeNull();
    expect(completionInputBinding({ ...input, baseline: { ...baseline, origin: "spec" } })).toBeNull();
  });
});
