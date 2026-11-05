import { describe, expect, it } from "vitest";

import {
  SWEEP_RESOLUTION_PREFIX,
  buildRetirementPlan,
  classifyPeerDemandCopy,
  peerDemandMirrorId,
  retirementParams,
  selectionDigest,
  summarizeRetirementPlan,
  type CopyFacts,
} from "./peer-demand-intake-copies";

const MARKER = "[origin:ecosystem-peer-demand:fdm_0123456789abcdef01234567]";

function copy(overrides: Partial<CopyFacts> = {}): CopyFacts {
  return {
    id: "row-1",
    itemId: "BI-AAAA0001",
    title: "Peer item",
    status: "triaging",
    body: `Peer body\n\n${MARKER}`,
    resolution: null,
    claimedById: null,
    claimedByAgentId: null,
    claimStatus: null,
    activeBuildId: null,
    mirror: { syncStatus: "synced", disposition: "observed", link: { role: "same-org-peer", linkState: "trusted", revoked: false } },
    workroomCount: 0,
    evidenceLinkCount: 0,
    originatedBuildCount: 0,
    activities: [{ kind: "intake_origin", recordedById: null, originKind: "ecosystem-peer-demand" }],
    mutatingToolNames: [],
    workSyncTwinItemId: null,
    ...overrides,
  };
}

describe("peerDemandMirrorId", () => {
  it("reads the mirror id from the intake marker", () => {
    expect(peerDemandMirrorId(`x ${MARKER} y`)).toBe("fdm_0123456789abcdef01234567");
    expect(peerDemandMirrorId("[origin:federatedWork:inst:BI-1]")).toBeNull();
    expect(peerDemandMirrorId(null)).toBeNull();
  });
});

describe("classifyPeerDemandCopy — selector", () => {
  it("retires an untouched triaging copy of live same-org demand as discard when no twin exists", () => {
    expect(classifyPeerDemandCopy(copy())).toEqual({ kind: "retire", origin: "same-org-live", outcome: "discard", duplicateOfItemId: null });
  });

  it("retires as duplicate of the work-sync twin when one shares the title", () => {
    expect(classifyPeerDemandCopy(copy({ workSyncTwinItemId: "BI-TWIN0001" }))).toMatchObject({ outcome: "duplicate", duplicateOfItemId: "BI-TWIN0001" });
  });

  it("classifies revoked links ahead of withdrawn demand", () => {
    const revoked = copy({ mirror: { syncStatus: "withdrawn", disposition: "withdrawn", link: { role: "same-org-peer", linkState: "revoked", revoked: true } } });
    expect(classifyPeerDemandCopy(revoked)).toMatchObject({ kind: "retire", origin: "revoked-link" });
    const withdrawn = copy({ mirror: { syncStatus: "synced", disposition: "withdrawn", link: { role: "same-org-peer", linkState: "trusted", revoked: false } } });
    expect(classifyPeerDemandCopy(withdrawn)).toMatchObject({ kind: "retire", origin: "withdrawn-demand" });
  });

  it("treats a revoked or withdrawn cross-organization copy as in scope, but leaves live cross-org demand alone", () => {
    const crossOrg = { role: "manages", linkState: "trusted", revoked: false };
    expect(classifyPeerDemandCopy(copy({ mirror: { syncStatus: "synced", disposition: "observed", link: crossOrg } }))).toEqual({ kind: "out-of-scope", reason: "live-cross-organization-demand" });
    expect(classifyPeerDemandCopy(copy({ mirror: { syncStatus: "withdrawn", disposition: "withdrawn", link: crossOrg } }))).toMatchObject({ kind: "retire", origin: "withdrawn-demand" });
  });

  it("ignores items without the peer-demand marker", () => {
    expect(classifyPeerDemandCopy(copy({ body: "local item" }))).toMatchObject({ kind: "out-of-scope" });
  });

  it("keeps a copy whose mirror no longer resolves", () => {
    expect(classifyPeerDemandCopy(copy({ mirror: null }))).toMatchObject({ kind: "keep", origin: null, reasons: ["mirror-unresolved"] });
  });

  it("retires an open copy moved only by the automated triage drain", () => {
    const open = copy({ status: "open", activities: [
      { kind: "intake_origin", recordedById: null, originKind: "ecosystem-peer-demand" },
      { kind: "triage_assessment", recordedById: null, originKind: null },
      { kind: "demand_scored", recordedById: null, originKind: null },
      { kind: "federated_twin", recordedById: null, originKind: null },
    ] });
    expect(classifyPeerDemandCopy(open)).toMatchObject({ kind: "retire" });
  });
});

describe("classifyPeerDemandCopy — local work is kept for individual review", () => {
  const cases: Array<[string, Partial<CopyFacts>, string]> = [
    ["moved past open", { status: "awaiting-acceptance" }, "status:awaiting-acceptance"],
    ["retired by someone else", { status: "retired", resolution: "Merged by hand" }, "status:retired"],
    ["claimed", { claimedByAgentId: "AGT-1" }, "claimed"],
    ["active claim status", { claimStatus: "active" }, "claimed"],
    ["active build", { activeBuildId: "FB-1" }, "build"],
    ["originated build", { originatedBuildCount: 1 }, "build"],
    ["workroom", { workroomCount: 1 }, "workroom"],
    ["demand evidence", { evidenceLinkCount: 2 }, "demand-evidence"],
    ["person activity", { activities: [{ kind: "wip_admission", recordedById: "user-1", originKind: null }] }, "person-activity"],
    ["evidence activity", { activities: [{ kind: "evidence", recordedById: null, originKind: null }] }, "work-activity:evidence"],
    ["absorbed local intake", { activities: [{ kind: "intake_origin", recordedById: null, originKind: "tool-defect" }] }, "absorbed-local-intake:tool-defect"],
    ["tool edits", { mutatingToolNames: ["update_backlog_item", "update_backlog_item"] }, "tool-edits:update_backlog_item"],
    ["foreign work-sync marker", { body: `${MARKER}\n[origin:federatedWork:did_peer:BI-9]` }, "foreign-work-sync-marker"],
  ];
  for (const [name, overrides, reason] of cases) {
    it(`keeps: ${name}`, () => {
      const result = classifyPeerDemandCopy(copy(overrides));
      expect(result.kind).toBe("keep");
      expect(result.kind === "keep" ? result.reasons : []).toContain(reason);
    });
  }
});

describe("idempotency and the approval digest", () => {
  it("recognises items this sweep already retired", () => {
    const done = copy({ status: "retired", resolution: `${SWEEP_RESOLUTION_PREFIX} Copy filed by …` });
    expect(classifyPeerDemandCopy(done)).toEqual({ kind: "already-retired" });
  });

  it("keeps the digest stable as items move from to-retire to already-retired", () => {
    const before = buildRetirementPlan([
      { itemId: "BI-2", title: "b", status: "triaging", classification: classifyPeerDemandCopy(copy({ itemId: "BI-2" })) },
      { itemId: "BI-1", title: "a", status: "triaging", classification: classifyPeerDemandCopy(copy({ itemId: "BI-1" })) },
    ]);
    const after = buildRetirementPlan([
      { itemId: "BI-1", title: "a", status: "retired", classification: { kind: "already-retired" } },
      { itemId: "BI-2", title: "b", status: "retired", classification: { kind: "already-retired" } },
    ]);
    expect(after.digest).toBe(before.digest);
    expect(after.toRetire).toHaveLength(0);
    expect(before.toRetire.map((r) => r.itemId)).toEqual(["BI-1", "BI-2"]);
  });

  it("changes the digest when an item gains local work", () => {
    const a = selectionDigest(["BI-1", "BI-2"]);
    expect(selectionDigest(["BI-2", "BI-1", "BI-1"])).toBe(a);
    expect(selectionDigest(["BI-1"])).not.toBe(a);
  });
});

describe("retirementParams", () => {
  it("cites the fix, the decision and the reversal path", () => {
    const params = retirementParams("BI-1", { kind: "retire", origin: "revoked-link", outcome: "duplicate", duplicateOfItemId: "BI-TWIN" });
    expect(params).toMatchObject({ itemId: "BI-1", outcome: "duplicate", duplicateOfId: "BI-TWIN" });
    const rationale = String(params.rationale);
    expect(rationale.startsWith(SWEEP_RESOLUTION_PREFIX)).toBe(true);
    for (const ref of ["BI-C7D95F7E", "DI-F7294B768E8D", "BI-TWIN", "update_backlog_item_status", "revoked"]) expect(rationale).toContain(ref);
    const discard = retirementParams("BI-2", { kind: "retire", origin: "same-org-live", outcome: "discard", duplicateOfItemId: null });
    expect(discard).not.toHaveProperty("duplicateOfId");
  });
});

describe("summarizeRetirementPlan", () => {
  it("reports exact counts by category, kept reasons and bounded samples", () => {
    const rows = [
      copy({ itemId: "BI-1" }),
      copy({ itemId: "BI-2", workSyncTwinItemId: "BI-T" }),
      copy({ itemId: "BI-3", mirror: { syncStatus: "withdrawn", disposition: "withdrawn", link: { role: "same-org-peer", linkState: "trusted", revoked: false } } }),
      copy({ itemId: "BI-4", claimedById: "u" }),
      copy({ itemId: "BI-5", status: "open", workroomCount: 1 }),
      copy({ itemId: "BI-6", body: "local" }),
    ];
    const plan = buildRetirementPlan(rows.map((f) => ({ itemId: f.itemId, title: f.title, status: f.status, classification: classifyPeerDemandCopy(f) })));
    const summary = summarizeRetirementPlan(plan, { sampleSize: 1 });
    expect(summary.scanned).toBe(6);
    expect(summary.outOfScope).toBe(1);
    expect(summary.toRetire).toEqual({
      total: 3,
      byOrigin: { "same-org-live": 2, "withdrawn-demand": 1 },
      byStatus: { triaging: 3 },
      byOutcome: { discard: 2, duplicate: 1 },
    });
    expect(summary.keptForReview.total).toBe(2);
    expect(summary.keptForReview.byReason).toEqual({ claimed: 1, workroom: 1 });
    expect(summary.keptForReview.byStatus).toEqual({ open: 1, triaging: 1 });
    expect(summary.samples["same-org-live"]).toHaveLength(1);
    expect(summary.selectionDigest).toBe(plan.digest);
  });
});
