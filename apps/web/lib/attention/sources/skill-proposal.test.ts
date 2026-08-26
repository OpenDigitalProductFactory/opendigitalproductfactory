import { describe, expect, it, vi } from "vitest";

import { loadSkillProposalItems, skillProposalToAttentionItem } from "./skill-proposal";

describe("skillProposalToAttentionItem (BI-2F9EE2E9)", () => {
  const row = {
    proposalId: "IP-SKL-7A9CA2C7",
    title: "Require an unfiltered hit count before recording any absence claim",
    targetSkillId: "dpf-verify-substrate-first",
    severity: "high",
    createdAt: new Date("2026-08-22T23:48:00Z"),
    submittedById: "user-1",
    agentId: "AGT-1",
  };

  it("names the skill and the decision in owner-legible language", () => {
    const item = skillProposalToAttentionItem(row);
    expect(item.source).toBe("skill-proposal");
    expect(item.title).toContain("dpf-verify-substrate-first");
    // The identifier is not the headline — a reviewer should not need to know
    // what IP-SKL-* means to understand there is a decision waiting.
    expect(item.title).not.toContain("IP-SKL-");
  });

  it("deep-links to the proposal, not to the catalog that cannot reach it", () => {
    const item = skillProposalToAttentionItem(row);
    // The catalog page has no route to a pending proposal; only ?skill= does.
    expect(item.deepLink).toBe(
      "/platform/ai/skills?skill=dpf-verify-substrate-first",
    );
    expect(item.actions[0]?.href).toBe(item.deepLink);
  });

  it("is addressed to the operator and awaits a human turn", () => {
    const item = skillProposalToAttentionItem(row);
    expect(item.audience.operator).toBe(true);
    expect(item.triage.residueReason).toBe("policy-approval");
    expect(item.id).toBe("skill-proposal:IP-SKL-7A9CA2C7");
  });

  it("loads only pending skill-category proposals that target a skill", async () => {
    type FindManyArgs = { where: { status: string; category: string; targetSkillId: unknown } };
    const findMany = vi.fn(async (_args: FindManyArgs) => [row]);
    const db = { improvementProposal: { findMany } } as never;

    const items = await loadSkillProposalItems(db);

    expect(items).toHaveLength(1);
    const where = findMany.mock.calls[0]![0].where;
    expect(where.status).toBe("proposed");
    expect(where.category).toBe("skill");
    expect(where.targetSkillId).toEqual({ not: null });
  });
});
