import { describe, expect, it } from "vitest";
import {
  PRODUCT_OBJECTIVE_STATUSES,
  PRODUCT_OBJECTIVE_REVIEW_CADENCES,
  PRODUCT_OBJECTIVE_WORK_CONTRIBUTION_KINDS,
  PRODUCT_OUTCOME_MEASURE_KINDS,
  PRODUCT_OUTCOME_SOURCE_KINDS,
  deriveObjectivePosture,
  isObjectiveReviewDue,
  validateObjectiveContract,
  validateObjectiveStatusTransition,
} from "./outcomes";

describe("product outcome canonical values", () => {
  it("keeps the minimum lifecycle, measure, contribution, and evidence vocabularies closed", () => {
    expect(PRODUCT_OBJECTIVE_STATUSES).toEqual([
      "draft",
      "active",
      "closed",
      "archived",
    ]);
    expect(PRODUCT_OUTCOME_MEASURE_KINDS).toEqual([
      "number",
      "percentage",
      "currency",
      "duration",
      "qualitative",
    ]);
    expect(PRODUCT_OBJECTIVE_WORK_CONTRIBUTION_KINDS).toEqual([
      "demand",
      "funded-bet",
      "delivery",
      "release",
    ]);
    expect(PRODUCT_OUTCOME_SOURCE_KINDS).toEqual([
      "manual",
      "product-sold",
      "booking",
      "order",
      "subscription",
      "fulfillment",
      "crm",
      "finance",
      "analytics",
      "delivery",
      "research",
    ]);
    expect(PRODUCT_OBJECTIVE_REVIEW_CADENCES).toEqual([
      "weekly",
      "monthly",
      "quarterly",
      "custom",
    ]);
  });
});

describe("validateObjectiveContract", () => {
  it("accepts quantitative and qualitative contracts without forcing OKR vocabulary", () => {
    expect(
      validateObjectiveContract({
        measureKind: "percentage",
        measureUnit: "%",
        baselineValue: 42,
        targetValue: 60,
        baselineNarrative: null,
        targetNarrative: null,
      }),
    ).toEqual({ ok: true });
    expect(
      validateObjectiveContract({
        measureKind: "qualitative",
        measureUnit: null,
        baselineValue: null,
        targetValue: null,
        baselineNarrative: "Guests mention uncertainty about event packages.",
        targetNarrative: "Guests can confidently choose an event package.",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects incompatible fields instead of inventing a comparable baseline", () => {
    expect(
      validateObjectiveContract({
        measureKind: "qualitative",
        measureUnit: null,
        baselineValue: 0,
        targetValue: null,
        baselineNarrative: null,
        targetNarrative: "Customers describe the experience as clear.",
      }),
    ).toMatchObject({ ok: false, code: "qualitative-numeric-value" });
    expect(
      validateObjectiveContract({
        measureKind: "currency",
        measureUnit: null,
        baselineValue: 100,
        targetValue: 150,
        baselineNarrative: null,
        targetNarrative: null,
      }),
    ).toMatchObject({ ok: false, code: "unit-required" });
  });
});

describe("deriveObjectivePosture", () => {
  it("derives progress for increase, decrease, and maintain targets", () => {
    expect(
      deriveObjectivePosture({
        measureKind: "number",
        measureUnit: "bookings/week",
        baselineValue: 10,
        targetValue: 20,
        targetNarrative: null,
        latestObservation: {
          numericValue: 15,
          narrative: null,
          measureKind: "number",
          measureUnit: "bookings/week",
        },
      }),
    ).toMatchObject({
      availability: "available",
      direction: "increase",
      state: "improving",
      progress: 0.5,
    });
    expect(
      deriveObjectivePosture({
        measureKind: "duration",
        measureUnit: "minutes",
        baselineValue: 30,
        targetValue: 10,
        targetNarrative: null,
        latestObservation: {
          numericValue: 18,
          narrative: null,
          measureKind: "duration",
          measureUnit: "minutes",
        },
      }),
    ).toMatchObject({
      availability: "available",
      direction: "decrease",
      state: "improving",
      progress: 0.6,
    });
    expect(
      deriveObjectivePosture({
        measureKind: "percentage",
        measureUnit: "%",
        baselineValue: 95,
        targetValue: 95,
        targetNarrative: null,
        latestObservation: {
          numericValue: 95,
          narrative: null,
          measureKind: "percentage",
          measureUnit: "%",
        },
      }),
    ).toMatchObject({
      availability: "available",
      direction: "maintain",
      state: "on-target",
      progress: 1,
    });
  });

  it("keeps missing, incompatible, and qualitative evidence honest", () => {
    expect(
      deriveObjectivePosture({
        measureKind: "number",
        measureUnit: "covers/night",
        baselineValue: null,
        targetValue: 80,
        targetNarrative: null,
        latestObservation: {
          numericValue: 50,
          narrative: null,
          measureKind: "number",
          measureUnit: "covers/night",
        },
      }),
    ).toMatchObject({
      availability: "insufficient-evidence",
      reason: "baseline-missing",
    });
    expect(
      deriveObjectivePosture({
        measureKind: "currency",
        measureUnit: "USD",
        baselineValue: 1000,
        targetValue: 1500,
        targetNarrative: null,
        latestObservation: {
          numericValue: 1200,
          narrative: null,
          measureKind: "currency",
          measureUnit: "GBP",
        },
      }),
    ).toMatchObject({
      availability: "incompatible",
      reason: "measure-contract-changed",
    });
    expect(
      deriveObjectivePosture({
        measureKind: "qualitative",
        measureUnit: null,
        baselineValue: null,
        targetValue: null,
        targetNarrative: "Clients say the consultation set clear expectations.",
        latestObservation: {
          numericValue: null,
          narrative: "Three reviewed interviews describe expectations as clear.",
          measureKind: "qualitative",
          measureUnit: null,
        },
      }),
    ).toMatchObject({
      availability: "qualitative",
      state: "review-needed",
    });
  });
});

describe("objective review and lifecycle invariants", () => {
  it("marks only active objectives with elapsed review dates as due", () => {
    const now = new Date("2026-07-28T12:00:00.000Z");
    expect(
      isObjectiveReviewDue(
        { status: "active", reviewAt: new Date("2026-07-27T12:00:00.000Z") },
        now,
      ),
    ).toBe(true);
    expect(
      isObjectiveReviewDue(
        { status: "closed", reviewAt: new Date("2026-07-27T12:00:00.000Z") },
        now,
      ),
    ).toBe(false);
  });

  it("permits only the governed lifecycle transitions", () => {
    expect(validateObjectiveStatusTransition("draft", "active")).toEqual({
      ok: true,
    });
    expect(validateObjectiveStatusTransition("active", "closed")).toEqual({
      ok: true,
    });
    expect(validateObjectiveStatusTransition("closed", "active")).toMatchObject({
      ok: false,
      code: "illegal-status-transition",
    });
    expect(validateObjectiveStatusTransition("archived", "active")).toMatchObject({
      ok: false,
      code: "illegal-status-transition",
    });
  });
});
