// apps/web/lib/govern/data/coverage.live.test.ts
// BI-DG-002 (spec §6.1): the REAL coverage gate over the live Prisma schema. Generates
// the denominator INDEPENDENTLY via parsePrismaSchema (not from the registry) and
// asserts every model is registered or named in the immutable legacy baseline. A new or
// renamed model that is neither registered nor baselined fails this test — and the build.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parsePrismaSchema } from "@/lib/integrate/code-graph/extractors/prisma-schema-adapter";
import { DATA_ASSET_REGISTRY } from "./assets";
import {
  assertBaselineDidNotGrow,
  assertFullCoverage,
  computeCoverage,
} from "./coverage";
import { LEGACY_COVERAGE_BASELINE, SEALED_BASELINE_COUNT } from "./legacy-coverage-baseline";

const schemaPath = fileURLToPath(
  new URL("../../../../../packages/db/prisma/schema.prisma", import.meta.url),
);
const facts = parsePrismaSchema(readFileSync(schemaPath, "utf8"));

describe("live data-governance coverage gate", () => {
  it("has a real denominator generated from the live schema", () => {
    expect(facts.models.length).toBeGreaterThan(100);
  });

  it("accounts for every live Prisma model as registered or baselined", () => {
    const report = computeCoverage(facts.models, DATA_ASSET_REGISTRY, LEGACY_COVERAGE_BASELINE);
    // Names the exact unresolved model#field if this ever fails.
    expect(() => assertFullCoverage(report)).not.toThrow();
  });

  it("keeps the legacy baseline within its sealed count (shrink-only ratchet)", () => {
    expect(() =>
      assertBaselineDidNotGrow(LEGACY_COVERAGE_BASELINE, SEALED_BASELINE_COUNT),
    ).not.toThrow();
    expect(LEGACY_COVERAGE_BASELINE.entries.length).toBeLessThanOrEqual(SEALED_BASELINE_COUNT);
  });
});
