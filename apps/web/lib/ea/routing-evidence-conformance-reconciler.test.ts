import { describe, expect, it, vi } from "vitest";
import type { RoutingEvidenceConformanceProjection } from "@/lib/ai-operations-map/routing-evidence-conformance";
import { reconcileRoutingEvidenceConformance } from "./routing-evidence-conformance-reconciler";

function projection(findings: RoutingEvidenceConformanceProjection["findings"]): RoutingEvidenceConformanceProjection {
  return {
    schemaVersion: "ai-routing-evidence/v1",
    designRevision: "2026-07-26.1",
    window: {
      start: "2026-07-27T00:00:00.000Z",
      end: "2026-07-27T01:00:00.000Z",
    },
    coverage: {
      totalDecisions: 1,
      attributedDecisions: 1,
      tracedDecisions: 0,
      correlatedDecisions: 0,
      uncorrelatedDecisions: 0,
      unevidencedDecisions: 1,
      screenCoveredDecisions: 0,
      designBoundDecisions: 0,
      preInstrumentationDecisions: 0,
      instrumentedSince: null,
      unprovenDesignDecisions: 1,
      staleDesignDecisions: 0,
      attributionRate: 1,
      traceRate: 0,
      correlationRate: 0,
      screenCoverageRate: 0,
      designBindingRate: 0,
    },
    metrics: {
      decisionVolume: 1,
      adapterAttempts: 0,
      successfulAttempts: 0,
      errorAttempts: 0,
      fallbackAttempts: 0,
      excludedCandidates: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyP50Ms: null,
      latencyP95Ms: null,
      capacityLimitedProviders: 0,
      latestEvidenceAt: null,
      evidenceAgeSeconds: null,
    },
    providerMetrics: [],
    findings,
  };
}

function db(open: Array<Record<string, unknown>> = []) {
  return {
    eaConformanceIssue: {
      findMany: vi.fn().mockResolvedValue(open),
      create: vi.fn().mockResolvedValue({ id: "created" }),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

describe("reconcileRoutingEvidenceConformance", () => {
  it("creates a stable aggregate issue without transaction content", async () => {
    const client = db();
    const result = await reconcileRoutingEvidenceConformance(
      client as never,
      projection([{
        issueKey: "ai-routing-design-unproven",
        issueType: "ai-routing-design-unproven",
        severity: "warn",
        message: "1 routing decision lacks design provenance.",
        count: 1,
        architectureStageId: "rank-quality-time-cost",
        ownerAction: "none-historical",
        nextAction: "Nothing to do.",
      }]),
    );

    expect(result).toEqual({ created: 1, updated: 0, resolved: 0 });
    expect(client.eaConformanceIssue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        issueType: "ai-routing-design-unproven",
        detailsJson: expect.objectContaining({
          issueKey: "ai-routing-design-unproven",
          count: 1,
          designRevision: "2026-07-26.1",
        }),
      }),
    });
    expect(JSON.stringify(client.eaConformanceIssue.create.mock.calls)).not.toContain("prompt");
  });

  it("resolves an open finding when the projection no longer emits it", async () => {
    const client = db([{
      id: "issue-1",
      issueType: "ai-routing-design-unproven",
      message: "old",
      severity: "warn",
      detailsJson: { issueKey: "ai-routing-design-unproven" },
    }]);

    const result = await reconcileRoutingEvidenceConformance(client as never, projection([]));

    expect(result).toEqual({ created: 0, updated: 0, resolved: 1 });
    expect(client.eaConformanceIssue.update).toHaveBeenCalledWith({
      where: { id: "issue-1" },
      data: { status: "resolved" },
    });
  });
});
