// BI-53C26E60 — resolveReviewerIdentity attributes a receipt to the acting
// agent's Principal and falls back to the human when the agent alias misses.
// That fallback was untested, and it is exactly where 71 unconverged agents
// turned every summoned reviewer into the artifact's own author.

import { describe, expect, it } from "vitest";

import { resolveReviewerIdentity } from "./reviewer-identity";

const AUTHOR = "PRN-author";

function aliasDb(rows: Array<{ aliasType: string; aliasValue: string; principalId: string }>) {
  return {
    principalAlias: {
      findMany: async (args: { where: { aliasType: string; aliasValue: string } }) =>
        rows
          .filter((r) => r.aliasType === args.where.aliasType && r.aliasValue === args.where.aliasValue)
          .map((r) => ({ principal: { principalId: r.principalId } })),
    },
  };
}

describe("resolveReviewerIdentity", () => {
  it("attributes to the coworker when its agent alias resolves", async () => {
    const db = aliasDb([{ aliasType: "agent", aliasValue: "AGT-WS-REVIEW", principalId: "PRN-agent" }]);

    const identity = await resolveReviewerIdentity(db, {
      reviewerUserId: "u1",
      reviewerAgentId: "AGT-WS-REVIEW",
    });

    expect(identity).toEqual({ principalId: "PRN-agent", kind: "coworker" });
  });

  // The live repro: AGT-WS-REVIEW had no agent alias, so a summoned coworker's
  // receipt landed on the delegating human.
  it("falls back to the human when the agent has no registered alias", async () => {
    const db = aliasDb([{ aliasType: "user", aliasValue: "u1", principalId: AUTHOR }]);

    const identity = await resolveReviewerIdentity(db, {
      reviewerUserId: "u1",
      reviewerAgentId: "AGT-WS-REVIEW",
    });

    expect(identity).toEqual({ principalId: AUTHOR, kind: "human" });
  });
});
