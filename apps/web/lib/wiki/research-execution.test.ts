import { describe, expect, it, vi } from "vitest";

import {
  runResearchExecution,
  type ResearchOutcome,
  type ResearchExecutionDeps,
} from "./research-execution";

type Row = Record<string, any>;
function makeDeps(over: Partial<ResearchExecutionDeps> = {}): {
  deps: ResearchExecutionDeps;
  updates: Row[];
} {
  const updates: Row[] = [];
  const deps: ResearchExecutionDeps = {
    db: {
      researchProposal: {
        update: vi.fn(async (args: any) => {
          updates.push(args.data);
          return args.data;
        }),
      },
    },
    research: vi.fn(async (): Promise<ResearchOutcome> => ({
      text: "Findings: the market is fragmented.\n\n## Sources\n- [a](https://ex.com/a)",
      sources: [
        {
          title: "a",
          url: "https://ex.com/a",
          retrievedAt: new Date("2026-07-28T20:00:00.000Z"),
        },
      ],
      empty: false,
      emptyReason: null,
      confidence: "low",
      comparison: { kind: "first-run", baselineReviewedAt: null },
    })),
    baseline: vi.fn(async () => null),
    enrich: vi.fn(async () => ({ committed: [{ pageId: "wp_1", slug: "stances/market" }] })),
    ...over,
  };
  return { deps, updates };
}

const INPUT = {
  proposalId: "rp_1",
  organizationId: "org_1",
  digitalProductId: "digital-product-1",
  productLineId: null,
  businessProductId: null,
  topic: "competitive-landscape",
  query: "HVAC competitors",
};

describe("runResearchExecution", () => {
  it("runs research, enriches the corpus, and marks the proposal executed", async () => {
    const { deps, updates } = makeDeps();
    const res = await runResearchExecution(INPUT, deps);

    expect(res.status).toBe("executed");
    expect(res.pagesCommitted).toBe(1);

    // enrich called as research-trust with proposal provenance
    const enrichArg = (deps.enrich as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(enrichArg).toMatchObject({
      organizationId: "org_1",
      trust: "researched",
      provenance: { sourceType: "research" },
    });
    expect(enrichArg.provenance.sourceRef).toMatchObject({
      proposalId: "rp_1",
      digitalProductId: "digital-product-1",
      productLineId: null,
      businessProductId: null,
      topic: "competitive-landscape",
      confidence: "low",
      comparisonKind: "first-run",
      retrievedAt: "2026-07-28T20:00:00.000Z",
    });

    // proposal updated to executed with a summary + executedAt
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: "executed" });
    expect(updates[0].executedAt).toBeTruthy();
    expect(updates[0].resultSummary).toContain("draft");
  });

  it("marks executed with no corpus write when research finds nothing", async () => {
    const { deps, updates } = makeDeps({
      research: vi.fn(async (): Promise<ResearchOutcome> => ({
        text: "",
        sources: [],
        empty: true,
        emptyReason: "no-results",
        confidence: "low",
        comparison: { kind: "first-run", baselineReviewedAt: null },
      })),
    });
    const res = await runResearchExecution(INPUT, deps);

    expect(res.status).toBe("executed");
    expect(res.pagesCommitted).toBe(0);
    expect(deps.enrich).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({ status: "executed" });
    expect(updates[0].resultSummary.toLowerCase()).toContain("no findings");
    expect(updates[0].metadata).toMatchObject({
      evidence: {
        sourceUrls: [],
        confidence: "low",
        emptyReason: "no-results",
        comparisonKind: "first-run",
        committedPageIds: [],
      },
    });
  });

  it("uses only the latest reviewed matching-scope source as the comparison baseline", async () => {
    const reviewedAt = new Date("2026-07-20T00:00:00.000Z");
    const { deps } = makeDeps({
      baseline: vi.fn(async () => ({
        proposalId: "rp_previous",
        sourceKey: "research-previous",
        text: "Previous reviewed findings",
        retrievedAt: new Date("2026-07-19T00:00:00.000Z"),
        reviewedAt,
        sourceUrls: ["https://ex.com/previous"],
      })),
    });

    await runResearchExecution(
      {
        ...INPUT,
        digitalProductId: null,
        businessProductId: "product-1",
      },
      deps,
    );

    expect(deps.baseline).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        businessProductId: "product-1",
        topic: "competitive-landscape",
      }),
    );
    expect(deps.research).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewedBaseline: {
          text: "Previous reviewed findings",
          reviewedAt,
        },
      }),
    );
  });

  it("records provider unavailability distinctly from a valid empty search", async () => {
    const { deps, updates } = makeDeps({
      research: vi.fn(async (): Promise<ResearchOutcome> => ({
        text: "",
        sources: [],
        empty: true,
        emptyReason: "provider-unavailable",
        confidence: "low",
        comparison: { kind: "first-run", baselineReviewedAt: null },
      })),
    });

    const result = await runResearchExecution(INPUT, deps);

    expect(result.summary).toContain("provider unavailable");
    expect(updates[0].metadata).toMatchObject({
      evidence: { emptyReason: "provider-unavailable" },
    });
  });

  it("marks the proposal failed (fail-open) when research throws", async () => {
    const { deps, updates } = makeDeps({
      research: vi.fn(async () => { throw new Error("brave down"); }),
    });
    const res = await runResearchExecution(INPUT, deps);

    expect(res.status).toBe("failed");
    expect(updates[0]).toMatchObject({ status: "failed" });
    expect(updates[0].resultSummary).toContain("brave down");
  });

  it("marks the proposal failed when enrichment throws", async () => {
    const { deps, updates } = makeDeps({
      enrich: vi.fn(async () => { throw new Error("ollama down"); }),
    });
    const res = await runResearchExecution(INPUT, deps);

    expect(res.status).toBe("failed");
    expect(updates[0]).toMatchObject({ status: "failed" });
  });
});
