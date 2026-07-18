// apps/web/lib/govern/data/coverage.ts
// BI-DG-002 (spec §6.1): total-coverage machinery over the live Prisma facts. PURE.
// A registry cannot declare itself complete — the denominator is generated
// INDEPENDENTLY from Prisma (and, in later waves, projection producers, PEP entry
// points, destructive handlers, and MDM domains). Every physical field must resolve to
// governed/inherited/not-applicable (a registered model's model-level default covers
// its ordinary fields) OR be named in the IMMUTABLE legacy baseline. A new or renamed
// physical model/field that is neither registered nor baselined is a build-failing
// violation; the baseline can only shrink.
//
// This module holds the algorithm and is unit-tested with synthetic schema facts. The
// real 495-model gate wires parsePrismaSchema
// (apps/web/lib/integrate/code-graph/extractors/prisma-schema-adapter.ts) to these
// functions; the immutable baseline is generated once from that same parser output so
// the two never disagree.

import type { DataAssetRegistry } from "./assets";
import type { LegacyCoverageBaseline } from "./legacy-coverage-baseline";

/** Minimal shape the coverage algorithm needs — satisfied by PrismaModelFact. */
export type SchemaModelFacts = {
  name: string;
  fields: readonly { name: string }[];
};

export type CoverageViolationReason = "unregistered-model" | "unresolved-field";

export type CoverageViolation = {
  model: string;
  field: string;
  reason: CoverageViolationReason;
};

export type CoverageReport = {
  totalFields: number;
  registeredFields: number;
  baselinedFields: number;
  violations: CoverageViolation[];
};

function baselineKey(model: string, field: string): string {
  return `${model}#${field}`;
}

/**
 * Compute coverage of the live schema against the registry + immutable baseline.
 * A field is accounted for when its model is registered (model default resolves it) or
 * when `(model, field)` is in the baseline. Everything else is a violation.
 */
export function computeCoverage(
  models: readonly SchemaModelFacts[],
  registry: DataAssetRegistry,
  baseline: LegacyCoverageBaseline,
): CoverageReport {
  const baselined = new Set(baseline.entries.map((e) => baselineKey(e.prismaModel, e.field)));

  let totalFields = 0;
  let registeredFields = 0;
  let baselinedFields = 0;
  const violations: CoverageViolation[] = [];

  for (const model of models) {
    const registered = registry.byPrismaModel.has(model.name);
    for (const field of model.fields) {
      totalFields += 1;
      if (registered) {
        registeredFields += 1;
        continue;
      }
      if (baselined.has(baselineKey(model.name, field.name))) {
        baselinedFields += 1;
        continue;
      }
      violations.push({
        model: model.name,
        field: field.name,
        reason: registry.byPrismaModel.has(model.name) ? "unresolved-field" : "unregistered-model",
      });
    }
  }

  return { totalFields, registeredFields, baselinedFields, violations };
}

/**
 * Assert full coverage: no unresolved new/changed fields. Every violation names the
 * exact model#field so a failing build points straight at the gap. Intended to be
 * called from the real-schema coverage test and the Data-Impact Gate.
 */
export function assertFullCoverage(report: CoverageReport): void {
  if (report.violations.length > 0) {
    const sample = report.violations
      .slice(0, 20)
      .map((v) => `${v.model}#${v.field} (${v.reason})`)
      .join(", ");
    throw new Error(
      `data-governance coverage gap: ${report.violations.length} unresolved field(s): ${sample}` +
        (report.violations.length > 20 ? " …" : ""),
    );
  }
}

/**
 * Enforce the ratchet: the live baseline may not exceed the frozen count captured when
 * the baseline was sealed. It can only shrink as coverage waves (BI-DG-015+) resolve
 * entries — never grow, transfer to a new object, or hide a changed object.
 */
export function assertBaselineDidNotGrow(
  baseline: LegacyCoverageBaseline,
  sealedCount: number,
): void {
  if (baseline.entries.length > sealedCount) {
    throw new Error(
      `legacy coverage baseline grew from ${sealedCount} to ${baseline.entries.length} — ` +
        `new/changed models must be resolved, never added to the immutable baseline`,
    );
  }
}
