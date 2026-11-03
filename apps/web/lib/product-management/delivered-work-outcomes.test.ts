import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { OUTCOME_SOURCES } from "@/lib/backlog/intake-outcome";

import {
  EPIC_OBJECTIVE_SOURCE_KIND,
  ITEM_OUTCOME_RESULT_FOR_EVENT,
  PLATFORM_WORK_OBJECTIVE_SOURCE_KIND,
  classifyItemOutcomeActivity,
  isPlatformWorkScope,
  itemOutcomeSourceRef,
  itemOutcomeValue,
  outcomeDigest,
} from "./delivered-work-outcomes";

const deliveredAt = new Date("2026-10-28T12:00:00.000Z");
const after = new Date("2026-10-29T12:00:00.000Z");
const before = new Date("2026-10-27T12:00:00.000Z");
const done = { status: "done", completedAt: deliveredAt };

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

describe("an item event's result (BI-8DE5429B)", () => {
  it("delivery achieves the item's outcome, a reopen regresses it, failing evidence while done does not achieve it", () => {
    expect(ITEM_OUTCOME_RESULT_FOR_EVENT).toEqual({
      delivered: "achieved", reopened: "regressed", "failing-evidence": "not-achieved",
    });
  });

  it("is 100 when achieved and 0 otherwise, so the roll-up is the mean of the items", () => {
    expect(itemOutcomeValue("achieved")).toBe(100);
    expect(itemOutcomeValue("not-achieved")).toBe(0);
    expect(itemOutcomeValue("regressed")).toBe(0);
  });

  it("is identified by item, event and the fact behind it, so each event is recorded once", () => {
    expect(itemOutcomeSourceRef("BI-1", "reopened", "act-9")).toBe("BI-1:reopened:act-9");
    expect(itemOutcomeSourceRef("BI-1", "delivered", deliveredAt.toISOString()))
      .not.toBe(itemOutcomeSourceRef("BI-1", "delivered", after.toISOString()));
  });

  it("digests the outcome text it measured, ignoring surrounding space", () => {
    expect(outcomeDigest(" Finance sees invoices. ")).toBe(outcomeDigest("Finance sees invoices."));
    expect(outcomeDigest("A")).not.toBe(outcomeDigest("B"));
  });
});

describe("classifyItemOutcomeActivity", () => {
  it("reads a status change out of done as a reopen", () => {
    expect(classifyItemOutcomeActivity(
      { kind: "status_change", recordedAt: after, payload: { from: "done", to: "open" } },
      { status: "open", completedAt: null },
    )).toBe("reopened");
    expect(classifyItemOutcomeActivity(
      { kind: "status_change", recordedAt: after, payload: { from: "in-progress", to: "done" } }, done,
    )).toBeNull();
  });

  it("reads failing evidence as not achieved only after delivery and while still done", () => {
    const failing = { kind: "evidence", recordedAt: after, payload: { evidenceKind: "ux_fail" } };
    expect(classifyItemOutcomeActivity(failing, done)).toBe("failing-evidence");
    expect(classifyItemOutcomeActivity({ ...failing, recordedAt: before }, done)).toBeNull();
    expect(classifyItemOutcomeActivity(failing, { status: "open", completedAt: null })).toBeNull();
    expect(classifyItemOutcomeActivity({ ...failing, payload: { evidenceKind: "ux_verified" } }, done)).toBeNull();
  });
});

describe("closed sets match the database CHECKs", () => {
  it("objective origins", () => {
    const migration = readFileSync(resolve(__dirname,
      "../../../../packages/db/prisma/migrations/20261028100000_product_objective_origin/migration.sql"), "utf8");
    const allowed = /"sourceKind" IN \(([^)]*)\)/.exec(migration)?.[1]
      ?.split(",").map((value) => value.trim().replaceAll("'", "")).sort();

    expect(allowed).toEqual([EPIC_OBJECTIVE_SOURCE_KIND, PLATFORM_WORK_OBJECTIVE_SOURCE_KIND].sort());
  });

  it("outcome sources", () => {
    const migration = readFileSync(resolve(__dirname,
      "../../../../packages/db/prisma/migrations/20261028210000_backlog_item_outcome/migration.sql"), "utf8");
    const allowed = /"outcomeSource" IN \(([^)]*)\)/.exec(migration)?.[1]
      ?.split(",").map((value) => value.trim().replaceAll("'", "")).sort();

    expect(allowed).toEqual([...OUTCOME_SOURCES].sort());
  });
});
