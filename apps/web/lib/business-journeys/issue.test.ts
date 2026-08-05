// Issue routing for the journey watchdog (BI-E105303D, BI-04CC2090).
//
// The distinction under test is the whole point of BI-04CC2090: a `failed`
// journey is a claim about the BUSINESS, an `unverifiable` one is a claim about
// the WATCHDOG. Only the first may ever open a `journey_failure` row, and only
// the first may ever be red.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { reconcileJourneyIssues, journeyUnverifiableIssueKey } from "./issue";
import type { JourneyResult, UnverifiableReason } from "./types";

type Upsert = { where: { issueKey: string }; create: Record<string, unknown> };
type UpdateMany = { where: Record<string, unknown>; data: Record<string, unknown> };

function makeDb() {
  return {
    portfolioQualityIssue: {
      upsert: vi.fn(async (_args: Upsert) => ({})),
      updateMany: vi.fn(async (_args: UpdateMany) => ({ count: 1 })),
    },
  };
}

function journey(over: Partial<JourneyResult> = {}): JourneyResult {
  return {
    journeyId: "storefront-booking",
    outcome: "Customers can book a time with you",
    businessImpact: "They cannot book.",
    revenueBearing: true,
    status: "failed",
    achievedDepth: null,
    uncheckedDepths: [],
    steps: [],
    durationMs: 0,
    ...over,
  };
}

function unverifiable(
  journeyId: string,
  reason: UnverifiableReason = "no-public-address",
): JourneyResult {
  return journey({ journeyId, status: "unverifiable", unverifiableReason: reason });
}

function upsertsOf(db: ReturnType<typeof makeDb>): Upsert[] {
  return db.portfolioQualityIssue.upsert.mock.calls.map(([args]) => args);
}

function resolvedKeysOf(db: ReturnType<typeof makeDb>): string[] {
  return db.portfolioQualityIssue.updateMany.mock.calls
    .map(([args]) => args)
    .filter((a) => a.data.status === "resolved")
    .map((a) => String(a.where.issueKey));
}

describe("reconcileJourneyIssues", () => {
  let db: ReturnType<typeof makeDb>;
  const now = () => new Date(0);

  beforeEach(() => {
    db = makeDb();
  });

  it("opens a journey_failure row for a journey that genuinely failed", async () => {
    await reconcileJourneyIssues(db, [journey()], "run_1", now);

    const opened = upsertsOf(db);
    expect(opened).toHaveLength(1);
    expect(opened[0].create.issueType).toBe("journey_failure");
    expect(opened[0].create.summary).toBe("Customers can book a time with you — not working");
  });

  it("never opens a journey_failure row for a journey it could not check", async () => {
    await reconcileJourneyIssues(db, [unverifiable("storefront-booking")], "run_1", now);

    const types = upsertsOf(db).map((u) => u.create.issueType);
    expect(types).not.toContain("journey_failure");
  });

  it("never says 'not working' about a journey it could not check", async () => {
    await reconcileJourneyIssues(db, [unverifiable("storefront-booking")], "run_1", now);

    for (const u of upsertsOf(db)) {
      expect(String(u.create.summary)).not.toContain("not working");
    }
  });

  it("resolves the stale failure row an earlier build opened for it", async () => {
    // The regression that shipped: four error rows saying "not working" on
    // evidence that never reached the business. The next run must retire them.
    await reconcileJourneyIssues(db, [unverifiable("storefront-booking")], "run_1", now);

    expect(resolvedKeysOf(db)).toContain("journey-failure:storefront-booking");
  });

  it("does not go silent — it raises a warn-level row instead", async () => {
    await reconcileJourneyIssues(db, [unverifiable("storefront-booking")], "run_1", now);

    const raised = upsertsOf(db).filter((u) => u.create.issueType === "journey_unverifiable");
    expect(raised).toHaveLength(1);
    // Never `error`: a missing setting is not an outage.
    expect(raised[0].create.severity).toBe("warn");
  });

  it("groups journeys blocked by one cause into a single row", async () => {
    await reconcileJourneyIssues(
      db,
      [
        unverifiable("storefront-front-door"),
        unverifiable("storefront-booking"),
        unverifiable("customer-sign-in"),
        unverifiable("storefront-checkout"),
      ],
      "run_1",
      now,
    );

    const raised = upsertsOf(db).filter((u) => u.create.issueType === "journey_unverifiable");
    // One missing setting is ONE thing to fix, not four copies of one sentence.
    expect(raised).toHaveLength(1);
    expect(raised[0].where.issueKey).toBe(journeyUnverifiableIssueKey("no-public-address"));

    const details = raised[0].create.details as { blockedJourneys: unknown[] };
    expect(details.blockedJourneys).toHaveLength(4);
  });

  it("keeps genuinely different causes apart", async () => {
    await reconcileJourneyIssues(
      db,
      [
        unverifiable("storefront-booking", "no-public-address"),
        unverifiable("customer-sign-in", "no-organization-slug"),
      ],
      "run_1",
      now,
    );

    const keys = upsertsOf(db)
      .filter((u) => u.create.issueType === "journey_unverifiable")
      .map((u) => u.where.issueKey);
    expect(keys).toHaveLength(2);
    expect(keys).toContain(journeyUnverifiableIssueKey("no-public-address"));
    expect(keys).toContain(journeyUnverifiableIssueKey("no-organization-slug"));
  });

  it("resolves an unverifiable row once its cause is gone", async () => {
    await reconcileJourneyIssues(db, [journey({ status: "passed" })], "run_1", now);

    expect(resolvedKeysOf(db)).toContain(journeyUnverifiableIssueKey("no-public-address"));
    expect(resolvedKeysOf(db)).toContain(journeyUnverifiableIssueKey("no-organization-slug"));
  });

  it("leaves a real failure red while another journey is merely uncheckable", async () => {
    await reconcileJourneyIssues(
      db,
      [journey({ journeyId: "storefront-checkout" }), unverifiable("storefront-booking")],
      "run_1",
      now,
    );

    const failure = upsertsOf(db).filter((u) => u.create.issueType === "journey_failure");
    expect(failure).toHaveLength(1);
    expect(failure[0].where.issueKey).toBe("journey-failure:storefront-checkout");
  });
});
