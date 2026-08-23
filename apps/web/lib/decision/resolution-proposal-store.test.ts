import { beforeEach, describe, expect, it } from "vitest";

import {
  buildProposalId,
  createResolutionProposal,
  expireProposalsForResolvedInteractions,
  getOpenProposalForInteraction,
  isProposalActionKind,
  isTerminal,
  listOpenProposals,
  ruleResolutionProposal,
  type ProposalClient,
} from "./resolution-proposal-store";

type Row = Record<string, unknown> & { proposalId: string; status: string };

/** In-memory stand-in with the conditional-update semantics the store relies on. */
function fakeDb(seed: Row[] = []): ProposalClient & { rows: Row[] } {
  const rows: Row[] = [...seed];
  const matches = (row: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, want]) => {
      const have = row[key];
      if (want && typeof want === "object" && "in" in (want as Record<string, unknown>)) {
        return (want as { in: unknown[] }).in.includes(have);
      }
      return have === want;
    });

  return {
    rows,
    decisionResolutionProposal: {
      async findFirst({ where }: { where: Record<string, unknown> }) {
        return rows.find((r) => matches(r, where)) ?? null;
      },
      async findMany({ where }: { where: Record<string, unknown> }) {
        return rows.filter((r) => matches(r, where));
      },
      async create({ data }: { data: Row }) {
        // The DB default; the store never sets it on create.
        rows.push({ lifecycle: "active", ...data, createdAt: new Date() });
        return data;
      },
      async updateMany({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) {
        let count = 0;
        for (const row of rows) {
          if (!matches(row, where)) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      },
    },
  };
}

const BASE = {
  scopeKind: "interaction" as const,
  interactionId: "row-1",
  profileId: "org-perspective-1",
  actionKind: "answer_gap" as const,
  draftPayload: { answer: "We decline third-party catalog ingest without a signed DPA." },
  summary: "Decline the ingest until a data agreement exists",
  dissent: [],
};

describe("vocabulary", () => {
  it("treats anything past proposed as settled", () => {
    expect(isTerminal("proposed")).toBe(false);
    for (const s of ["accepted", "amended", "rejected"]) {
      expect(isTerminal(s)).toBe(true);
    }
  });

  it("rejects an action kind with no write path behind it", () => {
    expect(isProposalActionKind("answer_gap")).toBe(true);
    expect(isProposalActionKind("publish-everything")).toBe(false);
  });
});

describe("buildProposalId", () => {
  it("keys an interaction proposal by the decision and a cluster proposal by profile+domain", () => {
    expect(buildProposalId({ scopeKind: "interaction", interactionId: "row-1", profileId: "p" }))
      .toBe("DRP-i-row-1");
    expect(
      buildProposalId({ scopeKind: "gap_cluster", profileId: "p", domainClass: "plan-readiness" }),
    ).toBe("DRP-g-p-plan-readiness");
  });
});

describe("createResolutionProposal", () => {
  let db: ReturnType<typeof fakeDb>;
  beforeEach(() => {
    db = fakeDb();
  });

  it("refuses a scope that names no target", async () => {
    expect(await createResolutionProposal(db, { ...BASE, interactionId: null })).toEqual({
      ok: false,
      error: "invalid-scope",
    });
    expect(
      await createResolutionProposal(db, { ...BASE, scopeKind: "gap_cluster", domainClass: null }),
    ).toEqual({ ok: false, error: "invalid-scope" });
  });

  it("writes one proposal and refuses to pile a second onto the same decision", async () => {
    expect(await createResolutionProposal(db, BASE)).toEqual({ ok: true, data: { proposalId: "DRP-i-row-1" } });
    expect(await createResolutionProposal(db, BASE)).toEqual({ ok: false, error: "already-open" });
    expect(db.rows).toHaveLength(1);
  });

  it("will not reopen a question a human already ruled on", async () => {
    await createResolutionProposal(db, BASE);
    await ruleResolutionProposal(db, {
      proposalId: "DRP-i-row-1",
      ruling: "reject",
      ruledByUserId: "user-1",
    });
    expect(await createResolutionProposal(db, BASE)).toEqual({ ok: false, error: "already-ruled" });
  });

  it("records an empty dissent list as a fact, not as an absence", async () => {
    await createResolutionProposal(db, { ...BASE, dissent: [] });
    expect(db.rows[0]!.dissent).toEqual([]);
  });
});

describe("ruleResolutionProposal", () => {
  let db: ReturnType<typeof fakeDb>;
  beforeEach(async () => {
    db = fakeDb();
    await createResolutionProposal(db, BASE);
  });

  it("returns the draft payload to write through when accepted as written", async () => {
    const result = await ruleResolutionProposal(db, {
      proposalId: "DRP-i-row-1",
      ruling: "accept",
      ruledByUserId: "user-1",
    });
    expect(result).toMatchObject({ ok: true, data: { status: "accepted", payload: BASE.draftPayload } });
    expect(db.rows[0]!.acceptedPayload).toBeNull();
  });

  it("returns the EDITED payload when amended, and keeps the original draft for comparison", async () => {
    const amendedPayload = { answer: "Decline, and tell the scout to ask before the next sweep." };
    const result = await ruleResolutionProposal(db, {
      proposalId: "DRP-i-row-1",
      ruling: "amend",
      ruledByUserId: "user-1",
      amendedPayload,
    });
    expect(result).toMatchObject({ ok: true, data: { status: "amended", payload: amendedPayload } });
    expect(db.rows[0]!.acceptedPayload).toEqual(amendedPayload);
    expect(db.rows[0]!.draftPayload).toEqual(BASE.draftPayload);
  });

  it("refuses an amendment with nothing to amend to", async () => {
    expect(
      await ruleResolutionProposal(db, {
        proposalId: "DRP-i-row-1",
        ruling: "amend",
        ruledByUserId: "user-1",
      }),
    ).toEqual({ ok: false, error: "amend-needs-payload" });
    expect(db.rows[0]!.status).toBe("proposed");
  });

  it("keeps the rejection reason, because a rejection is doctrine too", async () => {
    await ruleResolutionProposal(db, {
      proposalId: "DRP-i-row-1",
      ruling: "reject",
      ruledByUserId: "user-1",
      note: "We already answered this in the vendor policy.",
    });
    expect(db.rows[0]!.status).toBe("rejected");
    expect(db.rows[0]!.rulingNote).toBe("We already answered this in the vendor policy.");
  });

  it("lets the first ruling win when two land at once", async () => {
    const first = await ruleResolutionProposal(db, {
      proposalId: "DRP-i-row-1",
      ruling: "accept",
      ruledByUserId: "user-1",
    });
    const second = await ruleResolutionProposal(db, {
      proposalId: "DRP-i-row-1",
      ruling: "reject",
      ruledByUserId: "user-2",
    });
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: "already-ruled" });
    expect(db.rows[0]!.status).toBe("accepted");
    expect(db.rows[0]!.ruledByUserId).toBe("user-1");
  });

  it("reports a missing proposal instead of inventing one", async () => {
    expect(
      await ruleResolutionProposal(db, {
        proposalId: "DRP-i-nope",
        ruling: "accept",
        ruledByUserId: "user-1",
      }),
    ).toEqual({ ok: false, error: "not-found" });
  });
});

describe("reads and expiry", () => {
  it("shows an open proposal on its decision and drops it once ruled", async () => {
    const db = fakeDb();
    await createResolutionProposal(db, BASE);
    expect(await getOpenProposalForInteraction(db, "row-1")).not.toBeNull();
    expect(await listOpenProposals(db)).toHaveLength(1);

    await ruleResolutionProposal(db, {
      proposalId: "DRP-i-row-1",
      ruling: "accept",
      ruledByUserId: "user-1",
    });
    expect(await getOpenProposalForInteraction(db, "row-1")).toBeNull();
    expect(await listOpenProposals(db)).toHaveLength(0);
  });

  it("retires the ROW when the decision was settled elsewhere, without claiming anyone ruled", async () => {
    const db = fakeDb();
    await createResolutionProposal(db, BASE);
    await createResolutionProposal(db, { ...BASE, interactionId: "row-2" });

    expect(await expireProposalsForResolvedInteractions(db, [])).toBe(0);
    expect(await expireProposalsForResolvedInteractions(db, ["row-1"])).toBe(1);

    expect(db.rows[0]!.lifecycle).toBe("retired");
    expect(db.rows[0]!.lifecycleReason).toBe("decision resolved elsewhere");
    // Still `proposed`: nobody ever ruled on it.
    expect(db.rows[0]!.status).toBe("proposed");
    expect(db.rows[0]!.ruledByUserId).toBeUndefined();
    expect(db.rows[1]!.lifecycle).toBe("active");
  });

  it("does not touch a ruled proposal when retiring stale ones", async () => {
    const db = fakeDb();
    await createResolutionProposal(db, BASE);
    await ruleResolutionProposal(db, {
      proposalId: "DRP-i-row-1",
      ruling: "reject",
      ruledByUserId: "user-1",
    });
    expect(await expireProposalsForResolvedInteractions(db, ["row-1"])).toBe(0);
    expect(db.rows[0]!.status).toBe("rejected");
  });
});
