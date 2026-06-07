import { describe, expect, it, vi } from "vitest";

import {
  listPendingResearchProposals,
  type ResearchProposalClient,
} from "./research-proposal";

describe("listPendingResearchProposals", () => {
  it("returns the org's pending proposals, newest first", async () => {
    const findMany = vi.fn(async (_args: unknown) => [
      { proposalId: "rp_2", topic: "market-size", query: "q2", proposedBy: "schedule", proposedAt: new Date() },
      { proposalId: "rp_1", topic: "competitive-landscape", query: "q1", proposedBy: "gap-detection", proposedAt: new Date() },
    ]);
    const db = { researchProposal: { findMany } } as unknown as ResearchProposalClient;

    const res = await listPendingResearchProposals("org_1", { db });

    expect(res).toHaveLength(2);
    expect(res[0].proposalId).toBe("rp_2");
    // queries the right org + pending, ordered desc
    const arg = findMany.mock.calls[0][0] as any;
    expect(arg.where).toMatchObject({ organizationId: "org_1", status: "pending" });
    expect(arg.orderBy).toMatchObject({ proposedAt: "desc" });
  });
});
