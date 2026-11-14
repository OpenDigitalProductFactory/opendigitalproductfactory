import { describe, expect, it, vi } from "vitest";

import { castVote, ledgerFromOutboundVotes } from "./vote-budget";
import {
  outboundVotesFromResponses,
  overBudgetLinks,
  recordEcosystemVoteTally,
  tallyAfterInboundVote,
  votesFromResponses,
  VOTE_TALLY_ACTOR,
} from "./vote-tally";
import { outboundResponseRef, queueDemandResponse } from "@/lib/federation/demand-response";

const interest = (link: string, weight?: number) => ({
  federationLinkId: link,
  payload: { response: { responseKind: "interest", ...(weight ? { weight } : {}) } },
});

describe("votesFromResponses", () => {
  it("counts interest only, one voter per link, weight defaulting to 1", () => {
    expect(votesFromResponses("BI-1", [
      interest("link_a"),
      interest("link_b", 3),
      { federationLinkId: "link_c", payload: { response: { responseKind: "help-offer" } } },
    ])).toEqual([
      { ref: "BI-1", installationId: "link_a", weight: 1 },
      { ref: "BI-1", installationId: "link_b", weight: 3 },
    ]);
  });
});

describe("outboundVotesFromResponses", () => {
  it("reads this installation's sent interest votes with their weight and time", () => {
    expect(outboundVotesFromResponses([
      { localRecordRef: "response:m1:interest", payload: { envelope: { responseKind: "interest", weight: 2, createdAt: "2026-11-16T08:00:00.000Z" } } },
      { localRecordRef: "response:m2:help-offer", payload: { envelope: { responseKind: "help-offer", createdAt: "2026-11-16T08:00:00.000Z" } } },
      { localRecordRef: "response:m3:interest", payload: { envelope: { responseKind: "interest", createdAt: "not a date" } } },
    ])).toEqual([{ ref: "response:m1:interest", weight: 2, createdAt: new Date("2026-11-16T08:00:00.000Z") }]);
  });
});

const item = (overrides = {}) => ({
  id: "row-1",
  updatedAt: new Date("2026-11-10T00:00:00Z"),
  occurrenceCount: 1,
  reach: null as number | null,
  confidence: 0.8,
  jobSize: 3,
  effortSize: "medium",
  demandInputSource: null as string | null,
  ...overrides,
});

function tallyDb(found: ReturnType<typeof item> | null, rows: ReturnType<typeof interest>[], count = 1) {
  const updateMany = vi.fn().mockResolvedValue({ count });
  const activity = vi.fn().mockResolvedValue({});
  const db = {
    federatedRecordMirror: { findMany: vi.fn().mockResolvedValue(rows) },
    backlogItem: { findUnique: vi.fn().mockResolvedValue(found) },
    $transaction: async <T,>(fn: (tx: never) => Promise<T>) =>
      fn({ backlogItem: { updateMany }, backlogItemActivity: { create: activity } } as never),
  };
  return { db, updateMany, activity };
}

describe("recordEcosystemVoteTally", () => {
  const now = new Date("2026-11-16T09:00:00Z");

  it("writes the tally into the item's existing value inputs and rescores it", async () => {
    const { db, updateMany, activity } = tallyDb(item(), [interest("link_a", 3), interest("link_b", 3)]);
    const outcome = await recordEcosystemVoteTally(db, "BI-1", now);
    expect(outcome).toMatchObject({ written: true, voters: 2, reach: 3, impact: 3 });
    const args = updateMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      id: "row-1",
      OR: [{ demandInputSource: null }, { demandInputSource: "ai" }],
    });
    expect(args.data).toMatchObject({
      reach: 3, impact: 3, demandScoreFramework: "rice",
      demandInputSource: "ai", demandInputActorRef: VOTE_TALLY_ACTOR,
    });
    expect(args.data.demandScore).toBeGreaterThan(0);
    expect(activity.mock.calls[0][0].data.summary).toContain("2 installations weighed in");
  });

  it("leaves an item alone when a person set its inputs", async () => {
    const { db, updateMany } = tallyDb(item({ demandInputSource: "human" }), [interest("link_a")]);
    expect(await recordEcosystemVoteTally(db, "BI-1", now)).toEqual({ written: false, reason: "owner-set" });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("reports a concurrent change instead of overwriting it", async () => {
    const { db, activity } = tallyDb(item(), [interest("link_a")], 0);
    expect(await recordEcosystemVoteTally(db, "BI-1", now)).toEqual({ written: false, reason: "changed-concurrently" });
    expect(activity).not.toHaveBeenCalled();
  });

  it("does nothing for an unknown item or one with no interest", async () => {
    expect(await recordEcosystemVoteTally(tallyDb(null, []).db, "BI-x", now)).toEqual({ written: false, reason: "no-item" });
    expect(await recordEcosystemVoteTally(tallyDb(item(), []).db, "BI-1", now)).toEqual({ written: false, reason: "no-votes" });
  });
});

describe("receiver-side weekly budget", () => {
  const now = new Date("2026-11-16T09:00:00Z");

  it("names a peer whose weighted votes this week cost more than the budget", () => {
    // 4² + 4² = 32 credits > 16.
    expect([...overBudgetLinks([interest("link_greedy", 4), interest("link_greedy", 4), interest("link_fair", 3)])])
      .toEqual(["link_greedy"]);
  });

  it("counts an over-budget peer's vote as plain interest and says so on the item", async () => {
    const itemRows = [interest("link_greedy", 4), interest("link_fair", 1)];
    const weekRows = [interest("link_greedy", 4), interest("link_greedy", 4), interest("link_greedy", 4)];
    const { db, activity } = tallyDb(item(), itemRows);
    db.federatedRecordMirror.findMany.mockReset()
      .mockResolvedValueOnce(itemRows)
      .mockResolvedValueOnce(weekRows);
    const outcome = await recordEcosystemVoteTally(db, "BI-1", now);
    expect(outcome).toMatchObject({ written: true, voters: 2, overBudgetVoters: 1, impact: 1 });
    expect(db.federatedRecordMirror.findMany.mock.calls[1][0].where).toMatchObject({
      federationLinkId: { in: ["link_greedy"] }, updatedAt: { gte: expect.any(Date) },
    });
    expect(activity.mock.calls[0][0].data.summary).toContain("over this week's vote budget");
  });
});

describe("tallyAfterInboundVote", () => {
  it("retries once when it loses a concurrent write, then counts the vote", async () => {
    const { db, updateMany } = tallyDb(item(), [interest("link_a")]);
    updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    const warn = vi.fn();
    expect(await tallyAfterInboundVote(db, "BI-1", { warn })).toMatchObject({ written: true });
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it("says so, with the reason, when the vote still is not counted", async () => {
    const warn = vi.fn();
    await tallyAfterInboundVote(tallyDb(item(), [interest("link_a")], 0).db, "BI-1", { warn });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not counted: changed-concurrently"));
    await tallyAfterInboundVote(tallyDb(null, []).db, "BI-x", { warn });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not counted: no-item"));
  });

  it("stays quiet when a person set the item's inputs — that is not a lost vote", async () => {
    const warn = vi.fn();
    await tallyAfterInboundVote(tallyDb(item({ demandInputSource: "human" }), [interest("link_a")]).db, "BI-1", { warn });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("the budget ledger reads what the sender writes", () => {
  it("recognises a re-weight of the same item, so it refunds instead of double-charging", async () => {
    // Write through the real sender, then read back through the real ledger.
    const created: Array<{ data: { localRecordRef: string; payload: unknown } }> = [];
    const db = {
      federatedRecordMirror: {
        findUnique: vi.fn(async (args: { where: { mirrorId?: string } }) => (args.where.mirrorId
          ? { mirrorId: "fdm_peer", canonicalSide: "peer", federationLinkId: "link_1", syncStatus: "synced",
            payload: { envelope: { envelopeId: "env-1", originInstallationId: "did_o", originRecordRef: "BI-O" } } }
          : null)),
        create: vi.fn(async (args: { data: { localRecordRef: string; payload: unknown } }) => { created.push(args); }),
        update: vi.fn(),
      },
      federationLink: { findUnique: vi.fn().mockResolvedValue({ linkId: "link_1", linkState: "trusted", revokedAt: null, quarantinedAt: null }) },
      job: { create: vi.fn(), upsert: vi.fn(), findFirst: vi.fn() },
    };
    const now = new Date("2026-11-17T10:00:00Z");
    try {
      await queueDemandResponse(db as never, { mirrorId: "fdm_peer", kind: "interest", weight: 3,
        identity: { projectionSecret: "test-secret" }, now } as never);
    } catch {
      // Scheduling delivery is outside this contract; the mirror row is what matters.
    }
    expect(created).toHaveLength(1);
    const row = created[0].data;
    expect(row.localRecordRef).toBe(outboundResponseRef("fdm_peer", "interest"));

    const ledger = ledgerFromOutboundVotes("did_self", outboundVotesFromResponses([row]), now);
    // Re-weighting the same item to 4 refunds the 9 already spent: 16 - 0 + 16 = fits exactly.
    expect(castVote(ledger, { ref: outboundResponseRef("fdm_peer", "interest"), weight: 4 }).accepted).toBe(true);
  });
});

