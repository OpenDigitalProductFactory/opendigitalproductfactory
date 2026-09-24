import { describe, expect, it } from "vitest";

import type { ReviewLine } from "./measures";
import {
  NO_PANEL_DISSENT,
  describeRouting,
  ownerProfileIdForLine,
  reviewDomainClass,
  routeReviewFindings,
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
    const summary = await routeReviewFindings({ db, lines: [line()], periodKey: "2026-W39" });

    expect(summary.created).toBe(1);
    expect(created[0]?.profileId).toBe("wsid-enterprise-architecture");
    expect(created[0]?.actionKind).toBe("release_material");
  });

  it("addresses a platform finding to the platform profile", async () => {
    const { db, created } = storeWith();
    await routeReviewFindings({
      db,
      lines: [line({ scope: "wwmd", professionKey: null, proposedAction: "examine-weight" })],
      periodKey: "2026-W39",
    });
    expect(created[0]?.profileId).toBe("mark-dpf-platform");
    expect(created[0]?.actionKind).toBe("adjust_weight");
  });

  it("addresses a business-stance finding to the organization profile", async () => {
    const { db, created } = storeWith();
    await routeReviewFindings({
      db,
      lines: [line({ scope: "wwwd", professionKey: null, proposedAction: "capture-stance" })],
      periodKey: "2026-W39",
    });
    expect(created[0]?.profileId).toBe("dpf-organizational-principles");
    expect(created[0]?.actionKind).toBe("amend_stance");
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
    await routeReviewFindings({ db, lines: [line()], periodKey: "2026-W39" });
    const second = await routeReviewFindings({ db, lines: [line()], periodKey: "2026-W40" });

    expect(created).toHaveLength(1);
    expect(second.created).toBe(0);
    expect(second.alreadyOpen).toBe(1);
  });

  it("does not reopen a question the owner already ruled on", async () => {
    const id = `DRP-g-wsid-enterprise-architecture-review:craft-fallback:enterprise-architecture`;
    const { db, created } = storeWith({ [id]: "accepted" });
    const summary = await routeReviewFindings({ db, lines: [line()], periodKey: "2026-W40" });

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
    await routeReviewFindings({ db, lines: [line()], periodKey: "2026-W39" });

    expect(created[0]?.dissent).toEqual([...NO_PANEL_DISSENT]);
    expect(created[0]?.dissent).not.toEqual([]);
    expect(JSON.stringify(created[0]?.dissent)).toContain("measurement, not a verdict");
  });

  it("carries the evidence and the period into the draft, so the card is readable alone", async () => {
    const { db, created } = storeWith();
    await routeReviewFindings({ db, lines: [line()], periodKey: "2026-W39" });

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
    });
    expect(describeRouting(summary)).toBe(
      "1 created, 0 already open, 0 already ruled, 1 needing a defect filed, 0 unroutable",
    );
  });
});
