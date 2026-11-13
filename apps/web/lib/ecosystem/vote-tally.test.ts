import { describe, expect, it, vi } from "vitest";

import { outboundVotesFromResponses, recordEcosystemVoteTally, votesFromResponses, VOTE_TALLY_ACTOR } from "./vote-tally";

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
