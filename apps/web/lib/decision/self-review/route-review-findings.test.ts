import { describe, expect, it, vi } from "vitest";

import { applyAcceptedProposal, type WriteThroughDeps } from "@/lib/decision/resolution-write-through";
import { ok } from "@/lib/shared/action-result";

import type { ReviewLine } from "./measures";
import {
  NO_PANEL_DISSENT,
  describeRouting,
  ownerProfileIdForLine,
  reviewDomainClass,
  routeReviewFindings,
  type RoutingFacts,
} from "./route-review-findings";

type Created = { proposalId: string; profileId: string; domainClass: string; actionKind: string; dissent: unknown; draftPayload: Record<string, unknown>; summary: string };

/** A proposal store that records writes, so no Prisma is needed. */
function storeWith(existing: Record<string, string> = {}) {
  const created: Created[] = [];
  const seen = { ...existing };
  return {
    created,
    db: {
      decisionResolutionProposal: {
        findFirst: async ({ where }: { where: { proposalId: string } }) =>
          seen[where.proposalId] ? { status: seen[where.proposalId] } : null,
        create: async ({ data }: { data: Created }) => {
          created.push(data);
          seen[data.proposalId] = "proposed";
          return data;
        },
      },
    } as never,
  };
}

/** Enterprise architecture holds material awaiting a person's release. */
const HELD_EA: RoutingFacts = {
  heldMaterialProfileIds: new Set(["wsid-enterprise-architecture"]),
  openWeightProposalByDomainClass: new Map(),
};

function line(over: Partial<ReviewLine> = {}): ReviewLine {
  return {
    lineKey: "craft-fallback:enterprise-architecture",
    measureKey: "craft-fallback",
    scope: "wsid",
    professionKey: "enterprise-architecture",
    headline: "599 of 599 craft consults fell back to platform doctrine",
    evidence: { consults: 599, fallbacks: 599 },
    proposedAction: "confirm-material",
    ...over,
  };
}

describe("a finding reaches the scope that owns it", () => {
  it("addresses a craft finding to the craft's own profile, not the founder's", async () => {
    const { db, created } = storeWith();
    const summary = await routeReviewFindings({ db, lines: [line()], periodKey: "2026-W39", facts: HELD_EA });

    expect(summary.created).toBe(1);
    expect(created[0]?.profileId).toBe("wsid-enterprise-architecture");
    expect(created[0]?.actionKind).toBe("release_material");
  });

  it("addresses a platform finding to the platform profile", async () => {
    const { db, created } = storeWith();
    await routeReviewFindings({
      db,
      lines: [line({ scope: "wwmd", professionKey: null, proposedAction: "examine-weight", evidence: { domainClass: "plan-readiness" } })],
      periodKey: "2026-W39",
      facts: { ...HELD_EA, openWeightProposalByDomainClass: new Map([["plan-readiness", "WAP-1"]]) },
    });
    expect(created[0]?.profileId).toBe("mark-dpf-platform");
    expect(created[0]?.actionKind).toBe("adjust_weight");
  });

  it("addresses a business-stance finding to the organization profile", async () => {
    const { db, created } = storeWith();
    await routeReviewFindings({
      db,
      lines: [line({ scope: "wwwd", professionKey: null, proposedAction: "capture-stance", evidence: { sample: "Should we open on Sundays?" } })],
      periodKey: "2026-W39",
    });
    expect(created[0]?.profileId).toBe("dpf-organizational-principles");
    expect(created[0]?.actionKind).toBe("answer_gap");
  });

  it("refuses to invent an owner for a craft finding that names no craft", async () => {
    const { db, created } = storeWith();
    const summary = await routeReviewFindings({
      db,
      lines: [line({ professionKey: null })],
      periodKey: "2026-W39",
    });
    expect(summary.unroutable).toBe(1);
    expect(created).toHaveLength(0);
    expect(ownerProfileIdForLine(line({ professionKey: null }))).toBeNull();
  });
});

describe("re-running the review does not accumulate cards", () => {
  it("counts an unresolved finding as already open rather than creating a second", async () => {
    const { db, created } = storeWith();
    await routeReviewFindings({ db, lines: [line()], periodKey: "2026-W39", facts: HELD_EA });
    const second = await routeReviewFindings({ db, lines: [line()], periodKey: "2026-W40", facts: HELD_EA });

    expect(created).toHaveLength(1);
    expect(second.created).toBe(0);
    expect(second.alreadyOpen).toBe(1);
  });

  it("does not reopen a question the owner already ruled on", async () => {
    const id = `DRP-g-wsid-enterprise-architecture-review:craft-fallback:enterprise-architecture`;
    const { db, created } = storeWith({ [id]: "accepted" });
    const summary = await routeReviewFindings({ db, lines: [line()], periodKey: "2026-W40", facts: HELD_EA });

    expect(created).toHaveLength(0);
    expect(summary.alreadyRuled).toBe(1);
  });

  it("namespaces the domain class so it cannot collide with a real decision class", () => {
    expect(reviewDomainClass(line())).toBe("review:craft-fallback:enterprise-architecture");
    expect(reviewDomainClass(line({ professionKey: null, scope: "wwmd" }))).toBe("review:craft-fallback");
    expect(reviewDomainClass(line())).not.toBe("architecture-tradeoff");
  });
});

describe("what is deliberately not auto-filed", () => {
  it("counts a defect for a human to file rather than filing it every week", async () => {
    const { db, created } = storeWith();
    const summary = await routeReviewFindings({
      db,
      lines: [line({ proposedAction: "file-defect" })],
      periodKey: "2026-W39",
    });
    expect(created).toHaveLength(0);
    expect(summary.needsDefectFiled).toBe(1);
    expect(summary.routed[0]?.outcome).toBe("needs-defect-filed");
  });

  it("skips a line with nothing to decide", async () => {
    const { db, created } = storeWith();
    const summary = await routeReviewFindings({
      db,
      lines: [line({ proposedAction: "no-action" })],
      periodKey: "2026-W39",
    });
    expect(created).toHaveLength(0);
    expect(summary.routed).toHaveLength(0);
  });
});

/**
 * The schema is explicit that "nobody dissented" and "nobody asked" must never
 * read the same on the card. A deterministic measure convenes no panel, so an
 * empty array would claim agreement that was never sought.
 */
describe("a measurement does not masquerade as a verdict", () => {
  it("records that no panel was convened rather than an empty dissent list", async () => {
    const { db, created } = storeWith();
    await routeReviewFindings({ db, lines: [line()], periodKey: "2026-W39", facts: HELD_EA });

    expect(created[0]?.dissent).toEqual([...NO_PANEL_DISSENT]);
    expect(created[0]?.dissent).not.toEqual([]);
    expect(JSON.stringify(created[0]?.dissent)).toContain("measurement, not a verdict");
  });

  it("carries the evidence and the period into the draft, so the card is readable alone", async () => {
    const { db, created } = storeWith();
    await routeReviewFindings({ db, lines: [line()], periodKey: "2026-W39", facts: HELD_EA });

    expect(created[0]?.draftPayload).toMatchObject({
      source: "decision-engine-review",
      periodKey: "2026-W39",
      measureKey: "craft-fallback",
      evidence: { consults: 599, fallbacks: 599 },
    });
    expect(created[0]?.summary).toContain("2026-W39");
  });
});

describe("the routing outcome is legible without a database query", () => {
  it("names every bucket", async () => {
    const { db } = storeWith();
    const summary = await routeReviewFindings({
      db,
      lines: [line(), line({ lineKey: "x", proposedAction: "file-defect" })],
      periodKey: "2026-W39",
      facts: HELD_EA,
    });
    expect(describeRouting(summary)).toBe(
      "1 created, 0 already open, 0 already ruled, 1 needing a defect filed, 0 unroutable, 0 nominated to a craft coworker, 0 reported",
    );
  });
});

// BI-1A2FD647: every card the review writes must survive being accepted. The
// Phase 3 tests proved proposals were WRITTEN; nothing proved one could be RULED
// ON, and all four action kinds were refused on accept.
describe("a written proposal can be accepted end to end", () => {
  function acceptDeps(): WriteThroughDeps & { calls: Record<string, unknown[]> } {
    const calls: Record<string, unknown[]> = {};
    const record = (name: string) => (input: unknown) => {
      (calls[name] ??= []).push(input);
    };
    return {
      calls,
      captureAnswer: async (input) => { record("captureAnswer")(input); return { draftCount: 1 }; },
      adoptOption: async (input) => { record("adoptOption")(input); },
      ruleWeight: async (input) => { record("ruleWeight")(input); return { applied: true }; },
      recordNoChange: async (input) => { record("recordNoChange")(input); },
      releaseHeldMaterial: async (input) => { record("releaseHeldMaterial")(input); return ok(3); },
    };
  }

  const facts: RoutingFacts = {
    heldMaterialProfileIds: new Set(["wsid-enterprise-architecture"]),
    openWeightProposalByDomainClass: new Map([["plan-readiness", "WAP-7"]]),
  };
  const emitted = [
    line(),
    line({ lineKey: "agreement:wwmd/plan-readiness", measureKey: "agreement", scope: "wwmd", professionKey: null, proposedAction: "examine-weight", evidence: { domainClass: "plan-readiness" } }),
    line({ lineKey: "repeat:wwwd", measureKey: "repeat-escalation", scope: "wwwd", professionKey: null, proposedAction: "capture-stance", evidence: { sample: "Should we open on Sundays?" } }),
  ];

  it("routes each emitted kind with the payload its write-through reads, and accepting it changes what it promised", async () => {
    const { db, created } = storeWith();
    await routeReviewFindings({ db, lines: emitted, periodKey: "2026-W39", facts });
    expect(created.map((c) => c.actionKind).sort()).toEqual(["adjust_weight", "answer_gap", "release_material"]);

    for (const proposal of created) {
      const deps = acceptDeps();
      // An answer is the owner's to write; they amend the draft's answer field.
      const payload = proposal.actionKind === "answer_gap"
        ? { ...proposal.draftPayload, answer: "Closed on Sundays; staff rest day." }
        : proposal.draftPayload;
      const result = await applyAcceptedProposal(deps, {
        actionKind: proposal.actionKind as never,
        payload,
        interactionRowId: null,
      });
      expect(result, proposal.actionKind).toMatchObject({ ok: true });
    }
  });

  it("names the exact thing each accept changes", async () => {
    const { db, created } = storeWith();
    await routeReviewFindings({ db, lines: emitted, periodKey: "2026-W39", facts });
    const byKind = Object.fromEntries(created.map((c) => [c.actionKind, c.draftPayload]));
    expect(byKind.release_material).toMatchObject({ profileId: "wsid-enterprise-architecture" });
    expect(byKind.adjust_weight).toMatchObject({ weightProposalId: "WAP-7" });
    expect(byKind.answer_gap).toMatchObject({ question: "Should we open on Sundays?" });
  });

  it("refuses an answer_gap accepted without an answer, rather than recording an empty one", async () => {
    const { db, created } = storeWith();
    await routeReviewFindings({ db, lines: [emitted[2]!], periodKey: "2026-W39", facts });
    const result = await applyAcceptedProposal(acceptDeps(), {
      actionKind: "answer_gap",
      payload: created[0]!.draftPayload,
      interactionRowId: null,
    });
    expect(result.ok).toBe(false);
  });
});

// Growing a craft corpus is not destructive, irreversible or regulated, so it is
// the craft coworker's job (founder doctrine 2026-09-24), not a card for a person.
describe("a craft corpus gap goes to the craft's coworker, not a person's queue", () => {
  it("nominates a craft with nothing held instead of writing a card", async () => {
    const { db, created } = storeWith();
    const nominateCorpusGap = vi.fn().mockResolvedValue({ nominated: true, needId: "CWN-9" });
    const summary = await routeReviewFindings({
      db,
      lines: [line({ proposedAction: "publish-craft-page", evidence: { domainClass: "architecture-tradeoff" } }), line({ lineKey: "starvation:wsid-x" })],
      periodKey: "2026-W39",
      facts: { ...HELD_EA, heldMaterialProfileIds: new Set(), nominateCorpusGap },
    });
    expect(created).toHaveLength(0);
    expect(summary.nominated).toBe(2);
    expect(nominateCorpusGap).toHaveBeenCalledWith(expect.objectContaining({
      professionKey: "enterprise-architecture",
      domainClass: "architecture-tradeoff",
    }));
    expect(summary.routed[0]?.outcome).toBe("nominated:CWN-9");
  });

  it("counts an already-open gap as nominated, and reports when no nominator is available", async () => {
    const { db } = storeWith();
    const open = await routeReviewFindings({
      db,
      lines: [line({ proposedAction: "publish-craft-page" })],
      periodKey: "2026-W39",
      facts: { ...HELD_EA, nominateCorpusGap: async () => ({ nominated: false, reason: "duplicate-open-need", needId: "CWN-1" }) },
    });
    expect(open.nominated).toBe(1);

    const none = await routeReviewFindings({ db, lines: [line({ proposedAction: "publish-craft-page" })], periodKey: "2026-W39" });
    expect(none.reported).toBe(1);
    expect(none.routed[0]?.outcome).toBe("reported:nomination unavailable");
  });

  it("writes no card it cannot back: no weight proposal, no recorded question, or platform doctrine", async () => {
    const { db, created } = storeWith();
    const summary = await routeReviewFindings({
      db,
      lines: [
        line({ lineKey: "a", scope: "wwmd", professionKey: null, proposedAction: "examine-weight", evidence: { domainClass: "plan-readiness" } }),
        line({ lineKey: "b", scope: "wwwd", professionKey: null, proposedAction: "capture-stance", evidence: {} }),
        line({ lineKey: "c", scope: "wwmd", professionKey: null, proposedAction: "confirm-material" }),
      ],
      periodKey: "2026-W39",
    });
    expect(created).toHaveLength(0);
    expect(summary.reported).toBe(3);
  });
});
