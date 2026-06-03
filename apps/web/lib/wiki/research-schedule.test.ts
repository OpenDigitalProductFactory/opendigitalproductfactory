import { describe, expect, it, vi } from "vitest";

import {
  proposeScheduledResearch,
  STANDARD_RESEARCH_TOPICS,
  type ProposeScheduledResearchDeps,
} from "./research-schedule";

type Row = Record<string, any>;
function makeDeps(orgs: Row[], over: Partial<ProposeScheduledResearchDeps> = {}): {
  deps: ProposeScheduledResearchDeps;
  proposeCalls: Row[];
} {
  const proposeCalls: Row[] = [];
  const deps: ProposeScheduledResearchDeps = {
    db: {
      businessContext: { findMany: vi.fn(async () => orgs) },
    },
    propose: vi.fn(async (input: any) => {
      proposeCalls.push(input);
      // First time created, dedup thereafter (per org+topic)
      const prior = proposeCalls.filter(
        (c) => c.organizationId === input.organizationId && c.topic === input.topic,
      ).length;
      return { proposalId: `rp_${proposeCalls.length}`, created: prior === 1 };
    }),
    ...over,
  };
  return { deps, proposeCalls };
}

describe("proposeScheduledResearch", () => {
  it("proposes every standard topic for each org with a business context", async () => {
    const { deps, proposeCalls } = makeDeps([
      { organizationId: "org_1", industry: "healthcare-wellness", description: "dental" },
      { organizationId: "org_2", industry: null, description: "We sell coffee." },
    ]);

    const res = await proposeScheduledResearch(deps);

    // 2 orgs × N topics
    expect(proposeCalls).toHaveLength(2 * STANDARD_RESEARCH_TOPICS.length);
    expect(res.orgs).toBe(2);
    expect(res.proposed).toBe(2 * STANDARD_RESEARCH_TOPICS.length);
    expect(res.deduped).toBe(0);

    // proposedBy = schedule; query mentions the org context
    expect(proposeCalls[0]).toMatchObject({ organizationId: "org_1", proposedBy: "schedule" });
    expect(proposeCalls[0].query.toLowerCase()).toContain("healthcare-wellness");
    // org_2 has no industry → falls back to description
    const org2 = proposeCalls.find((c) => c.organizationId === "org_2");
    expect(org2).toBeDefined();
    expect(org2!.query).toContain("We sell coffee.");
  });

  it("counts dedups when proposeResearch coalesces to an existing pending proposal", async () => {
    const { deps } = makeDeps([{ organizationId: "org_1", industry: "retail-goods", description: null }], {
      // Always reports "already pending" → deduped
      propose: vi.fn(async () => ({ proposalId: "rp_x", created: false })),
    });
    const res = await proposeScheduledResearch(deps);
    expect(res.proposed).toBe(0);
    expect(res.deduped).toBe(STANDARD_RESEARCH_TOPICS.length);
  });

  it("proposes nothing when no org has a business context", async () => {
    const { deps, proposeCalls } = makeDeps([]);
    const res = await proposeScheduledResearch(deps);
    expect(res.orgs).toBe(0);
    expect(proposeCalls).toHaveLength(0);
  });
});
