// apps/web/lib/gpp/shape-language/ratification-report.ts
//
// The gate ratification report builder: property R of spec §7.4 ("every new
// typed field L1 drops is listed by shape, stage and value"). Design:
// docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §7.2 (ratification table), §7.4 (R), §10 step 2; plan: docs/superpowers/
// plans/2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3a-3,
// BI-6DA17863). PR-3b-5 writes the report to
// apps/web/lib/gpp/generated/gate-ratification-report.json; PR-3a-4 snapshot-
// tests it over the registry.
//
// For each definition the builder runs the same path L1 checks —
// lowerToDefinition(decompile(S).document) — and lists, from legacy.ts's own
// field list, every field the legacy projection drops. It also lists every
// governed stage with the status of its decisionScope in the table (ratified,
// proposed, or unlisted), and the subset still awaiting ratification. Rows are
// sorted by shape, then stage, then field (code-unit order), so the output
// does not depend on input order. Pure: no I/O, no clock.
//
// OFFLINE TOOLING in Phase 3a: nothing in the running app imports this module.

import type { WorkShapeDefinition } from "@/lib/work-management/work-shapes";

import { decompile } from "./decompile";
import { lowerToDefinition } from "./emit";
import { GATE_RATIFICATION, type GateRatificationEntry } from "./gate-ratification";
import { legacyDroppedFields } from "./legacy";

export type RatificationScopeStatus = "ratified" | "proposed" | "unlisted";

export type RatificationReportDroppedField = {
  /** `<key>@<version>`. */
  shape: string;
  /** Stage key, or null for a shape-level field. */
  stage: string | null;
  field: string;
  value: unknown;
};

export type RatificationReportGovernedStage = {
  shape: string;
  stage: string;
  decisionScope: string;
  status: RatificationScopeStatus;
};

export type GateRatificationReport = {
  /** Every additive typed field L1's legacy projection drops. */
  dropped: RatificationReportDroppedField[];
  /** Every governed-decision stage and the table status of its scope. */
  governedStages: RatificationReportGovernedStage[];
  /** The governed stages whose scope is not ratified: these shapes are not migratable yet. */
  awaitingRatification: RatificationReportGovernedStage[];
};

function byCodeUnit(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Shape, then stage (a shape-level row, stage null, sorts first as ""), then field. */
function byShapeStageField(
  left: { shape: string; stage: string | null; field?: string },
  right: { shape: string; stage: string | null; field?: string },
): number {
  return (
    byCodeUnit(left.shape, right.shape)
    || byCodeUnit(left.stage ?? "", right.stage ?? "")
    || byCodeUnit(left.field ?? "", right.field ?? "")
  );
}

function scopeStatus(
  decisionScope: string,
  table: Readonly<Record<string, GateRatificationEntry>>,
): RatificationScopeStatus {
  if (!Object.hasOwn(table, decisionScope)) return "unlisted";
  return table[decisionScope].status;
}

export function buildRatificationReport(
  definitions: readonly WorkShapeDefinition[],
  table: Readonly<Record<string, GateRatificationEntry>> = GATE_RATIFICATION,
): GateRatificationReport {
  const dropped: RatificationReportDroppedField[] = [];
  const governedStages: RatificationReportGovernedStage[] = [];

  for (const definition of definitions) {
    const shape = `${definition.key}@${definition.version}`;
    const lowered = lowerToDefinition(decompile(definition, { ratification: table }).document);
    for (const row of legacyDroppedFields(lowered)) dropped.push({ shape, ...row });
    for (const stage of definition.stages) {
      if (stage.advance.kind !== "governed-decision") continue;
      const { decisionScope } = stage.advance;
      governedStages.push({ shape, stage: stage.key, decisionScope, status: scopeStatus(decisionScope, table) });
    }
  }

  dropped.sort(byShapeStageField);
  governedStages.sort(byShapeStageField);
  return {
    dropped,
    governedStages,
    awaitingRatification: governedStages.filter((row) => row.status !== "ratified"),
  };
}
