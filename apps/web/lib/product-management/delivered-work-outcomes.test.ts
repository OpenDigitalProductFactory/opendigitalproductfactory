import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EPIC_OBJECTIVE_SOURCE_KIND,
  PLATFORM_WORK_OBJECTIVE_SOURCE_KIND,
  computeDeliveredWorkHoldRate,
  deliveredWorkWindow,
  deliveryObservationSourceRef,
  isPlatformWorkScope,
} from "./delivered-work-outcomes";

const observedAt = new Date("2026-10-28T12:00:00.000Z");
const day = 24 * 60 * 60 * 1000;
const at = (daysAgo: number) => new Date(observedAt.getTime() - daysAgo * day);

describe("isPlatformWorkScope", () => {
  it("counts platform, common, unknown and unscoped work without a business Product", () => {
    for (const scopeKind of ["platform", "common", "unknown", null]) {
      expect(isPlatformWorkScope({ scopeKind, businessProductId: null })).toBe(true);
    }
  });

  it("leaves archetype-scoped and business-Product work to their own objectives", () => {
    expect(isPlatformWorkScope({ scopeKind: "archetype-leaf", businessProductId: null })).toBe(false);
    expect(isPlatformWorkScope({ scopeKind: "multi-archetype", businessProductId: null })).toBe(false);
    expect(isPlatformWorkScope({ scopeKind: "platform", businessProductId: "product-1" })).toBe(false);
  });
});

describe("deliveredWorkWindow", () => {
  it("is the cohort delivered between 90 and 14 days before the observation", () => {
    expect(deliveredWorkWindow(observedAt)).toEqual({ from: at(90), to: at(14) });
  });
});

describe("deliveryObservationSourceRef", () => {
  it("names one delivery, so a redelivery after a reopen is a new observation", () => {
    expect(deliveryObservationSourceRef("BI-1", new Date("2026-10-28T09:00:00.000Z")))
      .toBe("BI-1@2026-10-28T09:00:00.000Z");
  });
});

describe("computeDeliveredWorkHoldRate", () => {
  const delivered = (itemId: string, daysAgo: number, overrides: Record<string, unknown> = {}) => ({
    itemId,
    status: "done",
    deliveredAt: at(daysAgo),
    laterActivities: [] as { kind: string; recordedAt: Date; payload: unknown }[],
    ...overrides,
  });

  it("reports the share of matured deliveries that held, with the ones that did not", () => {
    const result = computeDeliveredWorkHoldRate([
      delivered("BI-A", 40),
      delivered("BI-B", 30),
      delivered("BI-C", 20, {
        status: "open",
        laterActivities: [{ kind: "status_change", recordedAt: at(10), payload: { from: "done", to: "open" } }],
      }),
    ]);

    expect(result).toEqual({
      numerator: 2,
      denominator: 3,
      value: 66.666667,
      notHeld: [{ itemId: "BI-C", reason: "reopened" }],
    });
  });

  it("does not count a delivery whose later evidence failed", () => {
    const result = computeDeliveredWorkHoldRate([
      delivered("BI-A", 40, {
        laterActivities: [{ kind: "evidence", recordedAt: at(35), payload: { evidenceKind: "test_fail" } }],
      }),
      delivered("BI-B", 30, {
        laterActivities: [{ kind: "evidence", recordedAt: at(25), payload: { evidenceKind: "test_pass" } }],
      }),
    ]);

    expect(result).toMatchObject({ numerator: 1, denominator: 2, value: 50 });
    expect(result?.notHeld).toEqual([{ itemId: "BI-A", reason: "failing-evidence" }]);
  });

  it("ignores reopen and failure rows recorded before the delivery they would contradict", () => {
    const result = computeDeliveredWorkHoldRate([
      delivered("BI-A", 40, {
        laterActivities: [
          { kind: "status_change", recordedAt: at(60), payload: { from: "done", to: "open" } },
          { kind: "evidence", recordedAt: at(50), payload: { evidenceKind: "test_fail" } },
        ],
      }),
    ]);

    expect(result).toMatchObject({ numerator: 1, denominator: 1, value: 100, notHeld: [] });
  });

  it("counts an item no longer done as not held even without a recorded reopen", () => {
    const result = computeDeliveredWorkHoldRate([delivered("BI-A", 40, { status: "retired" })]);

    expect(result).toMatchObject({ numerator: 0, denominator: 1, value: 0 });
    expect(result?.notHeld).toEqual([{ itemId: "BI-A", reason: "no-longer-done" }]);
  });

  it("returns null when no delivery has matured, rather than inventing a rate", () => {
    expect(computeDeliveredWorkHoldRate([])).toBeNull();
  });
});

describe("objective origin closed set", () => {
  it("matches the database CHECK, so a derived objective can always be written", () => {
    const migration = readFileSync(resolve(__dirname,
      "../../../../packages/db/prisma/migrations/20261028100000_product_objective_origin/migration.sql"), "utf8");
    const allowed = /"sourceKind" IN \(([^)]*)\)/.exec(migration)?.[1]
      ?.split(",").map((value) => value.trim().replaceAll("'", "")).sort();

    expect(allowed).toEqual([EPIC_OBJECTIVE_SOURCE_KIND, PLATFORM_WORK_OBJECTIVE_SOURCE_KIND].sort());
  });
});
