import { describe, expect, it } from "vitest";

import { projectBacklogItemReadiness } from "./entry-adapter";
import { baseline, item, readyActivities, receipt, transitionObject } from "./entry-adapter.test-fixtures";
import { judgedDesignDigest } from "./judged-design-artifact";
import { resolveInitiativeReviewerRecovery } from "@/lib/tak/initiative-readiness-tool-grants";

// BI-4592CF69 (observed on BI-D4BB5AE3, 2026-10-07/08): spec approval minted a
// baseline on blob A. The spec was then shortened without touching its OBJ/AC
// manifest (blob B at a new head). Reviewer routes sent research and the
// architecture review to the head, and both receipts on B passed, yet readiness
// called them stale against A. Router and evaluator named different artifacts.

const later = (offsetMs: number) => new Date(Date.now() + offsetMs);

function onDigest(id: string, gateKey: string, digest: string, at: Date, decision: "pass" | "fail" = "pass") {
  const base = receipt(id, gateKey);
  return { ...base, recordedAt: at, payload: { ...base.payload, artifactDigest: digest, decision } };
}

type Activities = Parameters<typeof projectBacklogItemReadiness>[0]["activities"];

function project(activities: Activities, target: "plan" | "implementation" = "implementation") {
  return projectBacklogItemReadiness({
    item,
    activities,
    target,
    transitionObject,
    authorization: "pass",
    capsuleIdentity: "pass",
    evaluatedAt: "2026-10-14T00:00:00.000Z",
  }).decision;
}

const codes = (entries: ReadonlyArray<{ code: string; state: string }>) =>
  entries.map((entry) => `${entry.code}:${entry.state}`);

describe("the design a gate judges (BI-4592CF69)", () => {
  function withCurrent(currentDesign: { state: "verified"; digest: string } | { state: "unavailable" }, activities: Activities = readyActivities()) {
    return projectBacklogItemReadiness({
      item, activities, target: "plan", transitionObject,
      authorization: "pass", capsuleIdentity: "pass", evaluatedAt: "2026-10-16T00:00:00.000Z",
      ...{ currentDesign },
    }).decision;
  }

  it("discovers an unreviewed amendment while every historical gate still passes", () => {
    const decision = withCurrent({ state: "verified", digest: "sha256:unreviewed-head" });
    expect(codes([...decision.unmet, ...decision.blockers])).toContain("SPEC_APPROVAL_REQUIRED:stale");
    expect(codes([...decision.unmet, ...decision.blockers])).toContain("OBJECTIVE_BASELINE_REQUIRED:stale");
    expect(decision.verdict).not.toBe("allowed");
  });

  it("does not invalidate identical design bytes merely because its commit changed", () => {
    expect(withCurrent({ state: "verified", digest: "sha256:design" }).verdict).toBe("allowed");
  });

  it("uses verified restored baseline bytes instead of a later historical amendment receipt", () => {
    const decision = withCurrent({ state: "verified", digest: "sha256:design" }, [
      ...readyActivities(), onDigest("r-older-amendment", "architecture-review", "sha256:shortened", later(60_000)),
    ]);
    expect(codes([...decision.unmet, ...decision.blockers])).not.toContain("SPEC_APPROVAL_REQUIRED:stale");
    expect(codes([...decision.unmet, ...decision.blockers])).not.toContain("OBJECTIVE_BASELINE_REQUIRED:stale");
  });

  it("cannot report old all-pass evidence as current when the source is unavailable", () => {
    const decision = withCurrent({ state: "unavailable" });
    expect(decision.verdict).not.toBe("allowed");
    expect([...decision.blockers, ...decision.unmet].some(entry => entry.code === "CANONICAL_DESIGN_REQUIRED" && entry.state === "missing")).toBe(true);
  });

  it("also blocks the medium plan gate that owes a baseline rather than a design review", () => {
    const decision = projectBacklogItemReadiness({
      item: { ...item, workShape: "delivery-medium@1.0.0" }, activities: readyActivities(), target: "plan",
      transitionObject, authorization: "pass", capsuleIdentity: "pass", evaluatedAt: "2026-10-16T00:00:00.000Z",
      ...{ currentDesign: { state: "unavailable" as const } },
    }).decision;
    expect(decision.verdict).not.toBe("allowed");
    expect([...decision.unmet, ...decision.blockers]).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "OBJECTIVE_BASELINE_REQUIRED", state: "missing" }),
    ]));
  });

  it("counts receipts recorded on the shortened spec at the head the routes named", () => {
    const decision = project([
      ...readyActivities(),
      onDigest("r-research-short", "research", "sha256:shortened", later(60_000)),
      onDigest("r-architecture-short", "architecture-review", "sha256:shortened", later(61_000)),
    ]);
    const owed = codes([...decision.unmet, ...decision.blockers]);
    expect(owed).not.toContain("RESEARCH_REQUIRED:stale");
    const architecture = [...decision.satisfied, ...decision.unmet].find((entry) => entry.accountableRole === "architecture-reviewer");
    expect(architecture?.state).toBe("pass");
    expect(decision.satisfied.map((entry) => entry.code)).toContain("RESEARCH_REQUIRED");
    // Reviews recorded only on the earlier design no longer judge the current one.
    expect(decision.unmet.find((entry) => entry.accountableRole === "data-reviewer")?.state).toBe("stale");
    // The gate is not weakened: the changed design still owes its approval,
    // which is the only door that re-binds the baseline.
    expect(owed).toContain("SPEC_APPROVAL_REQUIRED:stale");
    expect(owed).toContain("OBJECTIVE_BASELINE_REQUIRED:stale");
    expect(decision.verdict).toBe("input-required");
  });

  it("routes no review the evaluation would then call stale", async () => {
    const decision = project([
      ...readyActivities(),
      onDigest("r-research-short", "research", "sha256:shortened", later(60_000)),
      onDigest("r-architecture-short", "architecture-review", "sha256:shortened", later(61_000)),
    ]);
    const grants = ["initiative_design_review", "initiative_architecture_review", "initiative_evidence_write",
      "initiative_data_review", "initiative_ux_review", "initiative_security_review", "initiative_compliance_review",
      "initiative_domain_review", "file_read"];
    const recovery = await resolveInitiativeReviewerRecovery({
      decision,
      currentAgentId: "AGT-AUTHOR",
      db: { agentToolGrant: { findMany: async () => grants.map((grantKey) => ({
        grantKey, agent: { agentId: "AGT-REVIEWER", displayName: "Reviewer", status: "active", archived: false, lifecycleStage: "production" },
      })) } },
      dispatchContext: { workroomId: "WC-1", repositoryFullName: "org/repo", branchName: "feat/x", headSha: "a".repeat(40) },
      canonicalArtifact: { resolved: true, path: "docs/superpowers/specs/x.md", providerBlobId: "b".repeat(40) },
      expectedCurrentBaselineId: "baseline-1",
    });
    const gates = recovery.reviewerRoutes.map((route) => route.gate);
    // The receipts already on the head count, so they are not asked for again.
    expect(gates).not.toContain("research");
    expect(gates).not.toContain("architecture-review");
    // The approval of the head design is routed, superseding the current baseline.
    const approval = recovery.reviewerRoutes.find((route) => route.gate === "spec-approval");
    expect(approval?.requestCoworker.initiativeReviewBinding?.expectedCurrentBaselineId).toBe("baseline-1");
    expect(approval?.requestCoworker.initiativeReviewBinding?.artifactRef).toMatchObject({ commitSha: "a".repeat(40), providerBlobId: "b".repeat(40) });
  });

  it("passes once the approval of the shortened spec supersedes the baseline", () => {
    const successor = {
      id: "baseline-row-2",
      kind: "initiative_scope_baseline",
      gateKey: null,
      recordedAt: later(120_000),
      payload: { ...baseline, baselineId: "baseline-2", supersedesBaselineId: "baseline-1", artifactDigest: "sha256:shortened", approvalReceiptId: "r-approval-2" },
    };
    const decision = project([
      ...readyActivities(),
      onDigest("r-research-short", "research", "sha256:shortened", later(60_000)),
      onDigest("r-architecture-short", "architecture-review", "sha256:shortened", later(61_000)),
      ...["data-review", "ux-fit-review", "security-review", "compliance-review", "domain-review"].map((gate, index) => {
        const recorded = onDigest(`r-${gate}-short`, gate, "sha256:shortened", later(62_000 + index));
        return { ...recorded, payload: { ...recorded.payload, decision: "not-applicable" } };
      }),
      onDigest("r-approval-2", "spec-approval", "sha256:shortened", later(119_000)),
      successor,
    ], "plan");
    expect(codes([...decision.unmet, ...decision.blockers])).toEqual([]);
    expect(decision.verdict).toBe("allowed");
  });

  it("returns to the baselined design when its bytes are restored at the head", () => {
    const decision = project([
      ...readyActivities(),
      onDigest("r-architecture-short", "architecture-review", "sha256:shortened", later(60_000)),
      onDigest("r-research-restored", "research", "sha256:design", later(61_000)),
    ]);
    const owed = codes([...decision.unmet, ...decision.blockers]);
    expect(owed).toContain("REVIEW_REQUIRED:stale");
    expect(owed).not.toContain("SPEC_APPROVAL_REQUIRED:stale");
    expect(decision.satisfied.map((entry) => entry.code)).toContain("RESEARCH_REQUIRED");
  });

  it("keeps a failed approval of the changed design a failure, not a stale receipt", () => {
    const decision = project([
      ...readyActivities(),
      onDigest("r-research-short", "research", "sha256:shortened", later(60_000)),
      onDigest("r-approval-short", "spec-approval", "sha256:shortened", later(61_000), "fail"),
    ]);
    expect(codes(decision.blockers)).toContain("REVIEW_FAILED:fail");
  });

  it("names one digest for every caller", () => {
    const current = { artifactDigest: "sha256:design", recordedAt: new Date("2026-10-01T00:00:00.000Z") };
    const activities = [
      onDigest("r-plan", "plan-review", "sha256:plan-v2", later(30_000)),
      onDigest("r-arch", "architecture-review", "sha256:shortened", later(10_000)),
    ];
    expect(judgedDesignDigest({ baseline: current, activities, planDigest: "sha256:plan-v2" }))
      .toEqual({ baselineDigest: "sha256:design", judgedDigest: "sha256:shortened", amended: true });
    expect(judgedDesignDigest({ baseline: current, activities: [], planDigest: null }))
      .toEqual({ baselineDigest: "sha256:design", judgedDigest: "sha256:design", amended: false });
    expect(judgedDesignDigest({ baseline: null, activities, planDigest: null }))
      .toEqual({ baselineDigest: null, judgedDigest: null, amended: false });
  });
});
