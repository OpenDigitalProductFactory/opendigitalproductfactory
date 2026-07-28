import { describe, expect, it, vi } from "vitest";

import {
  runResearchExecution,
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
    research: vi.fn(async () => ({
      text: "Findings: the market is fragmented.\n\n## Sources\n- [a](https://ex.com/a)",
      sources: [{ title: "a", url: "https://ex.com/a" }],
      empty: false,
    })),
    enrich: vi.fn(async () => ({ committed: [{ pageId: "wp_1", slug: "stances/market" }] })),
    ...over,
  };
  return { deps, updates };
}

const INPUT = {
  proposalId: "rp_1",
  organizationId: "org_1",
  digitalProductId: "digital-product-1",
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
      topic: "competitive-landscape",
    });

    // proposal updated to executed with a summary + executedAt
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: "executed" });
    expect(updates[0].executedAt).toBeTruthy();
    expect(updates[0].resultSummary).toContain("draft");
  });

  it("marks executed with no corpus write when research finds nothing", async () => {
    const { deps, updates } = makeDeps({
      research: vi.fn(async () => ({ text: "", sources: [], empty: true })),
    });
    const res = await runResearchExecution(INPUT, deps);

    expect(res.status).toBe("executed");
    expect(res.pagesCommitted).toBe(0);
    expect(deps.enrich).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({ status: "executed" });
    expect(updates[0].resultSummary.toLowerCase()).toContain("no findings");
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
