import { describe, expect, it, vi } from "vitest";

import {
  computeWeeklyReview,
  reviewPeriodKey,
} from "./decision-engine-review-task";
import { loadReviewWindow, REVIEW_WINDOW_DAYS } from "./load-review-window";

/**
 * The review must run on a cadence and answer the founder's question without a
 * human remembering to ask it (BI-19CEC4B4): how many decisions were made, and
 * where missing corpus or weights need examining.
 *
 * These tests drive the executor's pure half over a stubbed ledger. There is no
 * model in the run, so the same ledger always yields the same lines — the
 * property that lets a fixture stand in for the live install.
 */

const NOW = new Date("2026-09-22T06:00:00Z");

function ledgerRow(over: Record<string, unknown> = {}) {
  return {
    interactionId: "DI-1",
    profileId: "mark-dpf-platform",
    gateKey: "kernel-consult",
    routeContext: "mcp:principle_decide",
    domainClass: "kernel-consult",
    outcomeType: "recommend",
    riskTier: "medium",
    question: "Should we split the ledger?",
    gateFallbackUsed: false,
    outcomePayload: null,
    recommendedOptionId: null,
    chosenOptionId: null,
    sensitivityUnstable: null,
    sensitivity: null,
    createdAt: NOW,
    ...over,
  };
}

function stubDb(rows: Array<Record<string, unknown>>, materials: Array<{ profileId: string; count: number }> = []) {
  return {
    decisionInteraction: { findMany: vi.fn().mockResolvedValue(rows) },
    decisionPerspectiveProfile: {
      findMany: vi.fn().mockResolvedValue([
        { profileId: "mark-dpf-platform", kind: "platform" },
        { profileId: "org-perspective-x", kind: "organization" },
        { profileId: "wsid-enterprise-architecture", kind: "profession" },
      ]),
    },
    perspectiveMaterial: {
      groupBy: vi.fn().mockResolvedValue(
        materials.map((m) => ({ profileId: m.profileId, _count: { _all: m.count } })),
      ),
    },
  };
}

describe("the review window", () => {
  it("reads one week, bounded, and only material the gate can actually read", async () => {
    const db = stubDb([]);
    await loadReviewWindow(db, { now: NOW });

    const call = db.decisionInteraction.findMany.mock.calls[0]![0] as {
      where: { createdAt: { gte: Date; lte: Date } };
      take: number;
    };
    const spanDays = (NOW.getTime() - call.where.createdAt.gte.getTime()) / 86_400_000;
    expect(spanDays).toBe(REVIEW_WINDOW_DAYS);
    expect(call.take).toBeGreaterThan(0);

    // Draft or unpromoted material would make a starved profile look fed.
    const materialCall = db.perspectiveMaterial.groupBy.mock.calls[0]![0] as {
      where: { reviewStatus: string; promotionState: string };
    };
    expect(materialCall.where).toEqual({ reviewStatus: "approved", promotionState: "promoted" });
  });

  it("joins each row to its profile kind so scope is read from the profile, not guessed", async () => {
    const db = stubDb([ledgerRow({ profileId: "org-perspective-x" })]);
    const { rows } = await loadReviewWindow(db, { now: NOW });
    expect(rows[0]?.profileKind).toBe("organization");
  });

  it("treats an unknown profile as platform rather than dropping the row", async () => {
    const db = stubDb([ledgerRow({ profileId: "who-knows" })]);
    const { rows } = await loadReviewWindow(db, { now: NOW });
    expect(rows[0]?.profileKind).toBe("platform");
  });
});

describe("the weekly run", () => {
  it("is idempotent per ISO week, so two ticks are one review", () => {
    const monday = new Date("2026-09-21T06:00:00Z");
    const wednesday = new Date("2026-09-23T23:00:00Z");
    const nextMonday = new Date("2026-09-28T06:00:00Z");
    expect(reviewPeriodKey(monday)).toBe(reviewPeriodKey(wednesday));
    expect(reviewPeriodKey(nextMonday)).not.toBe(reviewPeriodKey(monday));
  });

  it("reports the craft fallback the founder asked about, from the ledger alone", async () => {
    const db = stubDb(
      Array.from({ length: 30 }, (_, i) => ledgerRow({
        interactionId: `DI-${i}`,
        profileId: "mark-dpf-platform",
        gateKey: "profession",
        routeContext: "reviewDesignDoc",
        domainClass: "architecture-tradeoff",
        outcomeType: "defer",
        gateFallbackUsed: true,
        outcomePayload: { professionKey: "enterprise-architecture" },
      })),
      [{ profileId: "mark-dpf-platform", count: 6 }],
    );

    const { lines } = await computeWeeklyReview({ db, now: NOW });
    const fallback = lines.find((l) => l.measureKey === "craft-fallback");

    expect(fallback).toMatchObject({
      scope: "wsid",
      professionKey: "enterprise-architecture",
      proposedAction: "publish-craft-page",
    });
    expect(fallback?.evidence.consults).toBe(30);
  });

  it("produces the same lines twice over the same ledger", async () => {
    const rows = [ledgerRow(), ledgerRow({ interactionId: "DI-2" })];
    const first = await computeWeeklyReview({ db: stubDb(rows), now: NOW });
    const second = await computeWeeklyReview({ db: stubDb(rows), now: NOW });
    expect(second.lines.map((l) => l.lineKey)).toEqual(first.lines.map((l) => l.lineKey));
    expect(second.periodKey).toBe(first.periodKey);
  });

  it("says something about an empty week rather than nothing at all", async () => {
    const { lines } = await computeWeeklyReview({ db: stubDb([]), now: NOW });
    // No decisions is itself a finding: the agreement measure reports that no
    // scope has a graded decision, which is how the engine's silence surfaces.
    expect(lines.every((l) => l.measureKey === "agreement")).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });
});
