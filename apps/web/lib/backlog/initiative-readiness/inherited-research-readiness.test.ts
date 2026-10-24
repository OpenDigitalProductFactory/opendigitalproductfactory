import { describe, expect, it } from "vitest";
import { projectBacklogItemReadiness } from "./entry-adapter";
import { item, readyActivities, receipt, transitionObject } from "./entry-adapter.test-fixtures";
import type { CurrentDesignEvidence } from "./judged-design-artifact";

type Input = Parameters<typeof projectBacklogItemReadiness>[0];
function ownResearch(id = "child-research", decision = "pass") {
  const own = receipt(id, "research");
  return { ...own, payload: { ...own.payload, decision,
    subject: { kind: "backlog-item", id: "BI-CHILD" }, artifactDigest: "sha256:child-design",
    artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo",
      commitSha: "a".repeat(40), path: "docs/superpowers/specs/child.md", providerBlobId: "b".repeat(40) },
  } };
}
function project(overrides: Partial<Input> = {}) {
  return projectBacklogItemReadiness({
    item: { ...item, itemId: "BI-CHILD", workShape: "delivery-medium@1.0.0",
      body: "## Acceptance\n- Preserve the child's measured outcome." },
    activities: [ownResearch()], inheritedScope: { parentItemId: item.itemId,
      coverageActivityId: "parent-coverage", activities: readyActivities() },
    currentDesign: verified(), target: "implementation", transitionObject,
    authorization: "pass", capsuleIdentity: "pass", evaluatedAt: "2026-10-24T00:00:00.000Z", ...overrides,
  });
}
function verified(receiptId = "child-research", digest = "sha256:child-design"): CurrentDesignEvidence {
  return { state: "not-applicable", research: { state: "verified", receiptId, digest } };
}
function requirement(projection: ReturnType<typeof project>, code = "RESEARCH_REQUIRED") {
  return [...projection.decision.satisfied, ...projection.decision.unmet].find(row => row.code === code);
}

describe("inherited scope with child-owned research", () => {
  it("judges current child research against its own immutable artifact, preserving the parent's scope", () => {
    const projection = project();
    expect(projection.inheritedFrom).toBe(item.itemId);
    expect(projection.baselineId).toBe("baseline-1");
    expect(projection.planArtifactDigest).toBe("sha256:plan");
    expect(requirement(projection)?.state).toBe("pass");
    expect(projection.decision.verdict).toBe("allowed");
  });
  it("keeps all inherited design and plan requirements unchanged", () => {
    const before = project({ activities: [], currentDesign: { state: "not-applicable" },
      item: { ...item, itemId: "BI-CHILD" } });
    const after = project({ item: { ...item, itemId: "BI-CHILD" } });
    const remaining = (p: ReturnType<typeof project>) => [...p.decision.satisfied, ...p.decision.unmet]
      .filter(row => row.code !== "RESEARCH_REQUIRED").map(row => ({ code: row.code, state: row.state }));
    expect(remaining(after)).toEqual(remaining(before));
    expect(after.baselineId).toBe(before.baselineId);
    expect(after.planArtifactDigest).toBe(before.planArtifactDigest);
  });
  it.each([undefined, { state: "not-applicable" }, { state: "not-applicable", research: { state: "unavailable" } },
    verified("older-receipt"), verified("child-research", "sha256:changed")])(
    "does not revive an own receipt from inherited approval when its observation is %j", currentDesign => {
      const projection = project({ currentDesign: currentDesign as CurrentDesignEvidence | undefined });
      expect(requirement(projection)?.state).toBe("stale");
      expect(projection.decision.verdict).not.toBe("allowed");
    });
  it("keeps the latest current failure ahead of older own and parent passes", () => {
    const latest = { ...ownResearch("new-failure", "fail"), recordedAt: new Date("2026-10-24") };
    const projection = project({ activities: [ownResearch(), latest], currentDesign: verified(latest.id) });
    expect(projection.decision.blockers).toContainEqual(expect.objectContaining({ state: "fail", accountableRole: "design-author" }));
    expect(projection.decision.verdict).not.toBe("allowed");
  });
  it("keeps stale failure semantics when its artifact is no longer current", () => {
    expect(requirement(project({ activities: [ownResearch("child-research", "fail")],
      currentDesign: verified("child-research", "sha256:changed") }))?.state).toBe("stale");
  });
  it("does not fall back from a malformed latest own receipt", () => {
    const latest = { ...ownResearch("new-malformed"), recordedAt: new Date("2026-10-24"), payload: {} };
    expect(requirement(project({ activities: [ownResearch(), latest], currentDesign: verified() }))?.state).toBe("malformed");
  });
  it("uses the same descending receipt-id tie break for equal timestamps", () => {
    expect(requirement(project({ activities: [ownResearch("a-old"), ownResearch("z-current", "fail")],
      currentDesign: verified("a-old") }))?.state).toBe("stale");
  });
  it("retains parent research when no own receipt exists", () => {
    const projection = project({ activities: [], currentDesign: { state: "not-applicable" } });
    expect(requirement(projection)?.state).toBe("pass");
    expect(projection.decision.verdict).toBe("allowed");
  });
  it("explains unavailable current source without requesting duplicate parent research", () => {
    expect(requirement(project({ currentDesign: { state: "not-applicable", research: { state: "unavailable" } } }))?.nextAction)
      .toContain("Restore its Workroom source binding and provider access before recording more research");
  });
  it("preserves standalone research projection without a child observation", () => {
    const projection = project({ item, activities: readyActivities(), inheritedScope: null,
      currentDesign: { state: "not-applicable", research: { state: "unavailable" } } });
    expect(projection.inheritedFrom).toBeNull();
    expect(requirement(projection)?.state).toBe("pass");
  });
});
