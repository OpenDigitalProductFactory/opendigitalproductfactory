import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", () => ({ prisma: {} }));

import type { InitiativeReadinessDecision } from "./types";
import { readinessRequirement } from "./readiness-guidance";
import { buildStudioOwedRoutes, type BuildStudioOwedRoutesPorts } from "./build-studio-owed-routes";

const decision: InitiativeReadinessDecision = {
  decisionId: "IRD-1", policyVersion: "initiative-readiness.v3",
  subject: { kind: "backlog-item", id: "BI-BS" },
  transitionObject: { kind: "work-capsule", id: "WC-BS", expectedVersion: "claim.v1", targetState: "implementation" },
  profile: "feature", target: "implementation", verdict: "input-required", satisfied: [],
  unmet: [
    readinessRequirement({ code: "SPEC_APPROVAL_REQUIRED", state: "missing", accountableRole: "design-checklist-reviewer" }),
    readinessRequirement({ code: "PLAN_COVERAGE_REQUIRED", state: "missing", accountableRole: "portfolio-management" }),
  ],
  blockers: [], evaluatedAt: "2026-10-02T20:00:00.000Z",
};

const dispatch = {
  available: true as const, buildId: "FB-1", itemId: "BI-BS",
  dispatchContext: { workroomId: "WC-BS", repositoryFullName: "o/r", branchName: "build/FB-1", headSha: "sha256:design" },
  canonicalArtifact: { resolved: true as const, kind: "feature-build-revision" as const, revisionId: "rev_1", valueDigest: "sha256:design", buildId: "FB-1" },
  planArtifact: null,
};

function ports(overrides: Partial<BuildStudioOwedRoutesPorts> = {}): BuildStudioOwedRoutesPorts {
  return {
    loadImplementationDecision: vi.fn(async () => decision),
    resolveDispatch: vi.fn(async () => dispatch),
    loadCurrentBaselineId: vi.fn(async () => null),
    resolveRecovery: vi.fn(async () => ({
      reviewerRoutes: [
        { independent: true, workroomId: "WC-BS", gate: "spec-approval", requestCoworker: { requestKey: "k1" } },
        { independent: false, workroomId: "WC-BS", gate: "research", requestCoworker: { requestKey: "k2" } },
      ],
      escalations: [], unroutable: [],
    }) as never),
    ...overrides,
  };
}

describe("buildStudioOwedRoutes (BI-926A7E90 PR-3)", () => {
  it("routes only the design-phase gates, bound to the revision, and keeps only independent routes", async () => {
    const p = ports();
    const result = await buildStudioOwedRoutes({ itemId: "BI-BS", capsuleId: "WC-BS", authorAgentId: "AGT-WS-BUILD", ports: p });
    expect(result).toEqual({ ok: true, routes: [{ workroomId: "WC-BS", requestCoworker: { requestKey: "k1" } }] });
    expect(p.resolveRecovery).toHaveBeenCalledWith(expect.objectContaining({
      currentAgentId: "AGT-WS-BUILD",
      dispatchContext: dispatch.dispatchContext,
      canonicalArtifact: dispatch.canonicalArtifact,
      expectedCurrentBaselineId: null,
      decision: expect.objectContaining({ unmet: [expect.objectContaining({ code: "SPEC_APPROVAL_REQUIRED" })] }),
    }));
  });

  it("owes nothing when the decision is allowed or has no design review left", async () => {
    expect(await buildStudioOwedRoutes({ itemId: "BI-BS", capsuleId: "WC-BS", authorAgentId: "AGT-WS-BUILD",
      ports: ports({ loadImplementationDecision: vi.fn(async () => ({ ...decision, verdict: "allowed" as const, unmet: [] })) }) }))
      .toEqual({ ok: true, routes: [] });
    expect(await buildStudioOwedRoutes({ itemId: "BI-BS", capsuleId: "WC-BS", authorAgentId: "AGT-WS-BUILD",
      ports: ports({ loadImplementationDecision: vi.fn(async () => ({ ...decision, unmet: [decision.unmet[1]!] })) }) }))
      .toEqual({ ok: true, routes: [] });
  });

  it("names the reason when the room cannot become a dispatch context or the decision is unavailable", async () => {
    expect(await buildStudioOwedRoutes({ itemId: "BI-BS", capsuleId: "WC-BS", authorAgentId: "AGT-WS-BUILD",
      ports: ports({ resolveDispatch: vi.fn(async () => ({ available: false as const, reason: "no-accepted-design" as const })) }) }))
      .toEqual({ ok: false, reason: "no-accepted-design" });
    expect(await buildStudioOwedRoutes({ itemId: "BI-BS", capsuleId: "WC-BS", authorAgentId: "AGT-WS-BUILD",
      ports: ports({ loadImplementationDecision: vi.fn(async () => null) }) }))
      .toEqual({ ok: false, reason: "implementation-decision-unavailable" });
  });
});
