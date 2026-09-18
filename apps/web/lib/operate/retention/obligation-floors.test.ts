import { describe, expect, it } from "vitest";

import {
  RETENTION_FLOOR_OBLIGATIONS,
  planRetentionFloorObligations,
  regulationCoversArchetypes,
} from "@dpf/db/seed-retention-floor-obligations";

import { INDUSTRY_RETENTION_FLOORS } from "./industry-floors";
import { foldObligationFloors, loadObligationFloors, NO_OBLIGATION_FLOORS } from "./obligation-floors";
import { resolveEffectiveRetentionDays } from "./industry-floors";
import { RETENTION_FLOOR_BUCKETS } from "./policies";

const reg = (regulationId: string, name = regulationId, jurisdiction: string | null = "us") => ({
  regulationId,
  name,
  jurisdiction,
});

describe("foldObligationFloors (pure)", () => {
  it("takes the LONGEST minimum per bucket across obligations", () => {
    const { byBucket } = foldObligationFloors([
      { obligationId: "OBL-A", title: "three years", retentionMinimumDays: 1095, retentionFloorBuckets: ["audit"], regulation: reg("R1") },
      { obligationId: "OBL-B", title: "seven years", retentionMinimumDays: 2555, retentionFloorBuckets: ["audit"], regulation: reg("R2") },
      { obligationId: "OBL-C", title: "one year telemetry", retentionMinimumDays: 365, retentionFloorBuckets: ["telemetry"], regulation: reg("R3") },
    ]);
    expect(byBucket).toEqual({ audit: 2555, telemetry: 365 });
  });

  it("treats an obligation that names no bucket as binding EVERY bucket", () => {
    const { byBucket } = foldObligationFloors([
      { obligationId: "OBL-ALL", title: "records", retentionMinimumDays: 730, retentionFloorBuckets: [], regulation: reg("R1") },
    ]);
    for (const bucket of RETENTION_FLOOR_BUCKETS) expect(byBucket[bucket]).toBe(730);
  });

  it("ignores an unknown bucket name rather than trusting it", () => {
    const { byBucket } = foldObligationFloors([
      { obligationId: "OBL-X", title: "typo", retentionMinimumDays: 900, retentionFloorBuckets: ["audit", "nonsense"], regulation: reg("R1") },
    ]);
    expect(byBucket).toEqual({ audit: 900 });
  });

  it("skips a null, zero or negative minimum instead of producing a zero floor", () => {
    const { byBucket, sources } = foldObligationFloors([
      { obligationId: "OBL-N", title: "silent", retentionMinimumDays: null, retentionFloorBuckets: ["audit"], regulation: reg("R1") },
      { obligationId: "OBL-Z", title: "zero", retentionMinimumDays: 0, retentionFloorBuckets: ["audit"], regulation: reg("R2") },
      { obligationId: "OBL-M", title: "negative", retentionMinimumDays: -5, retentionFloorBuckets: ["audit"], regulation: reg("R3") },
    ]);
    expect(byBucket).toEqual({});
    expect(sources).toEqual([]);
  });

  it("cites the regulator behind every floor, longest first", () => {
    const { sources } = foldObligationFloors([
      { obligationId: "OBL-S", title: "short", retentionMinimumDays: 365, retentionFloorBuckets: ["audit"], regulation: reg("R-SHORT", "Short Rule", "us") },
      { obligationId: "OBL-L", title: "long", retentionMinimumDays: 2555, retentionFloorBuckets: ["audit"], regulation: reg("R-LONG", "Long Rule", "eu") },
    ]);
    expect(sources.map((s) => [s.obligationId, s.regulationName, s.jurisdiction, s.days])).toEqual([
      ["OBL-L", "Long Rule", "eu", 2555],
      ["OBL-S", "Short Rule", "us", 365],
    ]);
  });
});

describe("loadObligationFloors (IO boundary)", () => {
  it("scopes to the applicable regulations when applicability is known", async () => {
    const seen: Record<string, unknown>[] = [];
    const db = { obligation: { findMany: async (args: Record<string, unknown>) => { seen.push(args); return []; } } };
    await loadObligationFloors(db, ["reg-db-1", "reg-db-2"]);
    expect((seen[0].where as { regulationId?: unknown }).regulationId).toEqual({ in: ["reg-db-1", "reg-db-2"] });
  });

  it("considers EVERY stated minimum when applicability cannot be resolved — floors only lengthen", async () => {
    const seen: Record<string, unknown>[] = [];
    const db = { obligation: { findMany: async (args: Record<string, unknown>) => { seen.push(args); return []; } } };
    const logged: string[] = [];
    await loadObligationFloors(db, null, (m) => logged.push(m));
    expect((seen[0].where as { regulationId?: unknown }).regulationId).toBeUndefined();
  });

  it("returns no floors and never throws when the compliance plane is unreadable", async () => {
    const db = { obligation: { findMany: async () => { throw new Error("compliance offline"); } } };
    const logged: string[] = [];
    await expect(loadObligationFloors(db, ["r"], (m) => logged.push(m))).resolves.toEqual(NO_OBLIGATION_FLOORS);
    expect(logged.join(" ")).toContain("base windows apply");
  });
});

describe("effective retention with derived floors", () => {
  const policy = { category: "audit" as const, baseRetentionDays: 365 };

  it("lengthens to the obligation floor when it exceeds base and industry", () => {
    expect(resolveEffectiveRetentionDays(policy, null, 0, { audit: 2555 })).toBe(2555);
  });

  it("never shortens: a longer base or industry floor still wins", () => {
    expect(resolveEffectiveRetentionDays({ category: "audit", baseRetentionDays: 3000 }, null, 0, { audit: 2555 })).toBe(3000);
    expect(resolveEffectiveRetentionDays(policy, "banking-financial-services", 0, { audit: 30 })).toBe(2555);
  });

  it("leaves the base in place for a bucket no obligation binds", () => {
    expect(resolveEffectiveRetentionDays({ category: "telemetry", baseRetentionDays: 90 }, null, 0, { audit: 2555 })).toBe(90);
  });
});

// THE SAFETY PROOF. The legacy INDUSTRY_RETENTION_FLOORS table stays in the
// max() until the derived obligations demonstrably cover every row it encodes.
// This test is that demonstration: when it passes with no gaps, the table can be
// deleted in a follow-up without any install's window getting shorter.
describe("parity with the legacy industry table (BI-69C29492)", () => {
  it("declares a floor obligation at least as long as every hardcoded row", () => {
    const gaps: string[] = [];
    for (const [industry, buckets] of Object.entries(INDUSTRY_RETENTION_FLOORS)) {
      for (const [bucket, days] of Object.entries(buckets)) {
        const covering = RETENTION_FLOOR_OBLIGATIONS.filter(
          (f) => f.archetypes.includes(industry) && f.retentionFloorBuckets.includes(bucket) && f.retentionMinimumDays >= (days as number),
        );
        if (covering.length === 0) gaps.push(`${industry}/${bucket} >= ${days}d`);
      }
    }
    expect(gaps, "every legacy floor must be expressible as an obligation before the table is deleted").toEqual([]);
  });

  it("attaches each floor to a regulation whose applicability already names its archetype", () => {
    const regulations = [
      { id: "db-bank", regulationId: "REG-US-BSA-AML", applicability: { archetypes: ["banking-financial-services"] } },
      { id: "db-prof", regulationId: "REG-US-PROF", applicability: { archetypes: ["professional-services"] } },
      { id: "db-health", regulationId: "REG-US-HEALTH", applicability: { archetypes: ["healthcare-wellness"] } },
      { id: "db-public", regulationId: "REG-US-PUBLIC", applicability: { archetypes: ["public-sector"] } },
    ];
    const { attached, unattached } = planRetentionFloorObligations(regulations);
    expect(unattached).toEqual([]);
    expect(attached).toHaveLength(RETENTION_FLOOR_OBLIGATIONS.length);
  });

  it("reports an unattached floor rather than inventing a regulation for it", () => {
    const { attached, unattached } = planRetentionFloorObligations([
      { id: "db-bank", regulationId: "REG-US-BSA-AML", applicability: { archetypes: ["banking-financial-services"] } },
    ]);
    expect(attached.length).toBeGreaterThan(0);
    expect(unattached.map((f) => f.reference)).toContain("retention/floor/healthcare-wellness");
  });

  it("matches archetypes only against a declared applicability list", () => {
    expect(regulationCoversArchetypes({ archetypes: ["public-sector"] }, ["public-sector"])).toBe(true);
    expect(regulationCoversArchetypes({ archetypes: ["retail"] }, ["public-sector"])).toBe(false);
    expect(regulationCoversArchetypes({ jurisdictions: ["us"] }, ["public-sector"])).toBe(false);
    expect(regulationCoversArchetypes(null, ["public-sector"])).toBe(false);
  });
});
