import { describe, expect, it, vi } from "vitest";

import {
  ARBITRATION_ACTIVITY_KIND,
  planDecisionNotices,
  runEcosystemArbitrationCycle,
  sendEcosystemDecisionNotices,
  summarizeArbitration,
  type ArbitrationItemRow,
  type DecisionCandidateRow,
} from "./arbitration-cycle";

const NOW = new Date("2026-11-12T12:00:00Z");

function item(over: Partial<ArbitrationItemRow>): ArbitrationItemRow {
  return {
    id: `cuid-${over.itemId}`,
    itemId: "BI-X",
    title: "An ecosystem item",
    workType: "feature",
    demandScore: null,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    activities: [],
    ...over,
  };
}

function rankingDb(rows: ArbitrationItemRow[]) {
  const create = vi.fn().mockResolvedValue({});
  const findMany = vi.fn().mockResolvedValue(rows);
  return { db: { backlogItem: { findMany }, backlogItemActivity: { create } }, create, findMany };
}

describe("runEcosystemArbitrationCycle", () => {
  it("ranks open ecosystem items by score and records each position with its reason", async () => {
    const { db, create, findMany } = rankingDb([
      item({ itemId: "BI-LOW", demandScore: 2 }),
      item({ itemId: "BI-HIGH", demandScore: 9 }),
    ]);

    const result = await runEcosystemArbitrationCycle(db, NOW);

    expect(findMany.mock.calls[0][0].where).toEqual({
      lifecycleTags: { has: "ecosystem-inbound" }, status: { in: ["triaging", "open", "deferred"] },
    });
    expect(result.top.map((entry) => entry.itemId)).toEqual(["BI-HIGH", "BI-LOW"]);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].data).toMatchObject({
      backlogItemId: "cuid-BI-HIGH",
      kind: ARBITRATION_ACTIVITY_KIND,
      payload: { rank: 1, of: 2 },
    });
    expect(create.mock.calls[0][0].data.summary).toContain("position 1 of 2: score 9");
  });

  it("records nothing when an item's position and reason are unchanged", async () => {
    const { db, create } = rankingDb([
      item({ itemId: "BI-ONLY", demandScore: 4,
        activities: [{ payload: { rank: 1, rationale: "score 4 · still unanswered" } }] }),
    ]);

    const result = await runEcosystemArbitrationCycle(db, NOW);

    expect(create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ranked: 1, recorded: 0 });
  });

  it("never writes the item itself, so a priority a person set survives", async () => {
    const { db } = rankingDb([item({ itemId: "BI-A", demandScore: 1 })]);
    await runEcosystemArbitrationCycle(db, NOW);
    expect(Object.keys(db.backlogItem)).toEqual(["findMany"]);
  });
});

const ENVELOPES = new Map([["fdm_peer1", { envelopeId: "env-1", originInstallationId: "did_origin" }]]);

function decisionRow(over: Partial<DecisionCandidateRow>): DecisionCandidateRow {
  return {
    itemId: "BI-P1",
    title: "Invoices show the wrong tax",
    status: "in-progress",
    body: "Reported by a peer.\n\n[origin:ecosystem-peer-demand:fdm_peer1]",
    activities: [],
    ...over,
  };
}

describe("planDecisionNotices", () => {
  it("accepts an item that moved into work, addressed to its submitter", () => {
    const { notices, withheld } = planDecisionNotices([decisionRow({})], ENVELOPES, new Set());
    expect(withheld).toEqual([]);
    expect(notices).toEqual([{
      itemId: "BI-P1",
      clusterId: "ecosystem:BI-P1:accepted",
      decision: "accepted",
      message: 'Taken into work: "Invoices show the wrong tax".',
      member: { envelopeId: "env-1", originInstallationId: "did_origin", mirrorRefs: ["fdm_peer1"] },
    }]);
  });

  it("rejects a retired item with the recorded reason", () => {
    const { notices } = planDecisionNotices([decisionRow({
      status: "retired",
      activities: [{ payload: { to: "retired", outcome: "wont-fix", reason: "Tax rules are configured per install." } }],
    })], ENVELOPES, new Set());
    expect(notices[0]).toMatchObject({
      decision: "rejected",
      message: 'Declined: "Invoices show the wrong tax". Tax rules are configured per install.',
    });
  });

  it("withholds a retirement that carries no reason — a bare verdict is not closure", () => {
    const { notices, withheld } = planDecisionNotices([decisionRow({
      status: "retired", activities: [{ payload: { to: "retired", outcome: "wont-fix", reason: null, rationale: "  " } }],
    })], ENVELOPES, new Set());
    expect(notices).toEqual([]);
    expect(withheld).toEqual([{ itemId: "BI-P1", reason: "retired without a recorded reason" }]);
  });

  it("sends each decision once", () => {
    const sent = new Set(["disposition:ecosystem:BI-P1:accepted:env-1"]);
    expect(planDecisionNotices([decisionRow({})], ENVELOPES, sent).notices).toEqual([]);
  });

  it("ignores items that are not peer demand or not yet decided", () => {
    const { notices, withheld } = planDecisionNotices([
      decisionRow({ itemId: "BI-ISSUE", body: "[origin:ecosystem-upstream-issue:owner/repo#4]" }),
      decisionRow({ itemId: "BI-OPEN", status: "open" }),
    ], ENVELOPES, new Set());
    expect(notices).toEqual([]);
    expect(withheld).toEqual([]);
  });

  it("names an item whose submitted demand is no longer held", () => {
    const { withheld } = planDecisionNotices([decisionRow({ body: "[origin:ecosystem-peer-demand:fdm_gone]" })],
      ENVELOPES, new Set());
    expect(withheld).toEqual([{ itemId: "BI-P1", reason: "the submitted demand is no longer held here" }]);
  });
});

describe("sendEcosystemDecisionNotices", () => {
  it("queues owed notices through the disposition writeback and skips ones already sent", async () => {
    const mirrorFind = vi.fn()
      .mockResolvedValueOnce([{ mirrorId: "fdm_peer1", payload: { envelope: { envelopeId: "env-1", originInstallationId: "did_origin" } } }])
      .mockResolvedValueOnce([]);
    const queue = vi.fn().mockResolvedValue({ queued: 1 });
    const db = {
      backlogItem: { findMany: vi.fn().mockResolvedValue([decisionRow({})]) },
      federatedRecordMirror: { findMany: mirrorFind },
    };

    const result = await sendEcosystemDecisionNotices(db, {
      queue,
      decodeEnvelope: (payload) => (payload as { envelope: { envelopeId: string; originInstallationId: string } }).envelope,
    }, NOW);

    expect(mirrorFind.mock.calls[1][0].where).toEqual({
      recordType: "demand-disposition", canonicalSide: "local",
      localRecordRef: { in: ["disposition:ecosystem:BI-P1:accepted:env-1"] },
    });
    expect(queue).toHaveBeenCalledWith(expect.objectContaining({
      clusterId: "ecosystem:BI-P1:accepted", decision: "accepted", now: NOW,
    }));
    expect(result).toEqual({ sent: 1, withheld: [] });
  });

  it("does nothing when no decided item came from a peer", async () => {
    const queue = vi.fn();
    const db = {
      backlogItem: { findMany: vi.fn().mockResolvedValue([]) },
      federatedRecordMirror: { findMany: vi.fn() },
    };
    expect(await sendEcosystemDecisionNotices(db, { queue, decodeEnvelope: () => null }, NOW))
      .toEqual({ sent: 0, withheld: [] });
    expect(db.federatedRecordMirror.findMany).not.toHaveBeenCalled();
  });
});

describe("summarizeArbitration", () => {
  it("reads as one line an operator can act on", () => {
    expect(summarizeArbitration(
      { ranked: 3, recorded: 1, top: [{ itemId: "BI-A", rank: 1, rationale: "score 9" }] },
      { sent: 1, withheld: [{ itemId: "BI-R", reason: "retired without a recorded reason" }] },
    )).toBe("Ecosystem queue: 3 ranked, 1 moved. Top: 1. BI-A (score 9). 1 submitter notice(s) sent; "
      + "1 withheld (BI-R: retired without a recorded reason).");
  });
});
