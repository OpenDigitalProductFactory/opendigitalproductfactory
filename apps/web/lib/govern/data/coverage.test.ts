// apps/web/lib/govern/data/coverage.test.ts
import { describe, expect, it } from "vitest";
import {
  assertBaselineDidNotGrow,
  assertFullCoverage,
  computeCoverage,
  type SchemaModelFacts,
} from "./coverage";
import { buildAssetRegistry, type DataAssetDefinition } from "./assets";
import type { LegacyCoverageBaseline } from "./legacy-coverage-baseline";

const MODELS: SchemaModelFacts[] = [
  { name: "Registered", fields: [{ name: "a" }, { name: "b" }] },
  { name: "Legacy", fields: [{ name: "x" }] },
  { name: "New", fields: [{ name: "y" }] },
];

const registeredAsset: DataAssetDefinition = {
  id: "data:registered",
  physical: { prismaModel: "Registered" },
  domain: "operational",
  ownerRole: "platform-owner",
  stewardRole: "data-steward",
  categories: ["operational"],
  sensitivity: "internal",
  criticality: "standard",
  subjectLocators: [],
  lifecycleClass: "operational",
  purposeCapabilities: ["service-delivery"],
  residencyClass: "local-only",
  projectionClass: "structure",
  classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-07-17" },
  fields: [],
};

const registry = buildAssetRegistry([registeredAsset]);

const baseline: LegacyCoverageBaseline = {
  entries: [
    {
      prismaModel: "Legacy",
      field: "x",
      owner: "data-steward",
      risk: "low",
      remediationBI: "BI-DG-015",
      deadline: "2026-12-31",
    },
  ],
};

describe("computeCoverage", () => {
  it("accounts registered fields, baselined fields, and flags the rest", () => {
    const report = computeCoverage(MODELS, registry, baseline);
    expect(report.totalFields).toBe(4);
    expect(report.registeredFields).toBe(2); // Registered.a, Registered.b (model default)
    expect(report.baselinedFields).toBe(1); // Legacy.x
    expect(report.violations).toEqual([
      { model: "New", field: "y", reason: "unregistered-model" },
    ]);
  });

  it("assertFullCoverage throws and names the exact gap", () => {
    const report = computeCoverage(MODELS, registry, baseline);
    expect(() => assertFullCoverage(report)).toThrow(/New#y/);
  });

  it("treats a whole-model (*) baseline entry as covering every field of that model", () => {
    const wholeModelBaseline: LegacyCoverageBaseline = {
      entries: [
        {
          prismaModel: "New",
          field: "*",
          owner: "data-steward",
          risk: "medium",
          remediationBI: "BI-DG-015",
          deadline: "2027-06-30",
        },
        ...baseline.entries,
      ],
    };
    const report = computeCoverage(MODELS, registry, wholeModelBaseline);
    expect(report.violations).toEqual([]);
    expect(report.baselinedFields).toBe(2); // Legacy.x + New.y (whole-model)
  });

  it("passes once the new model is registered", () => {
    const reg2 = buildAssetRegistry([
      registeredAsset,
      { ...registeredAsset, id: "data:new", physical: { prismaModel: "New" } },
    ]);
    const report = computeCoverage(MODELS, reg2, baseline);
    expect(report.violations).toEqual([]);
    expect(() => assertFullCoverage(report)).not.toThrow();
  });
});

describe("baseline ratchet", () => {
  it("permits an unchanged or shrunk baseline", () => {
    expect(() => assertBaselineDidNotGrow(baseline, 1)).not.toThrow();
    expect(() => assertBaselineDidNotGrow({ entries: [] }, 1)).not.toThrow();
  });

  it("forbids the baseline growing past its sealed count", () => {
    const grown: LegacyCoverageBaseline = {
      entries: [
        ...baseline.entries,
        {
          prismaModel: "New",
          field: "y",
          owner: "x",
          risk: "low",
          remediationBI: "BI-DG-016",
          deadline: "2026-12-31",
        },
      ],
    };
    expect(() => assertBaselineDidNotGrow(grown, 1)).toThrow(/grew/);
  });
});
