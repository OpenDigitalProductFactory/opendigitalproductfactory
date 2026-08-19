// Data Architecture steward — EP-DATA-ARCH Phase 4 (BI-6E5BF91F).
//
// The WWMD-mandated intelligence layer (opt-coworker-hybrid): deterministic
// drift detectors run over the parsed Prisma facts and produce stable,
// idempotent findings that the applier writes as EaConformanceIssue rows. The
// detectors run BEFORE any LLM enrichment (which proposes domain grouping and
// relationship semantics on top, never mutating mirror-owned structure).
//
// This module is pure and fully unit-tested; the DB writer lives in
// data-architecture-steward-apply.ts.

import type {
  PrismaSchemaFacts,
  PrismaRelationFact,
} from "../build/code-graph/extractors/prisma-schema-adapter";

export const STEWARD_VERSION = "data-architecture-steward-v1";

export type DriftSeverity = "error" | "warn" | "info";

export type DriftFinding = {
  issueType: string;
  /** Stable per-finding key — drives idempotent upsert (one open issue per key). */
  issueKey: string;
  severity: DriftSeverity;
  message: string;
  /** Mirror source key of the primary subject (prisma:model:<Name>), if any. */
  targetSourceKey: string | null;
  details: Record<string, unknown>;
};

const MODEL_KEY_PREFIX = "prisma:model:";
function modelKey(name: string): string {
  return `${MODEL_KEY_PREFIX}${name}`;
}

function relationName(relation: PrismaRelationFact): string | null {
  return relation.relationName ?? null;
}

/** A relation has an inverse if the target model declares a relation back to it. */
function hasInverse(relation: PrismaRelationFact, all: PrismaRelationFact[]): boolean {
  return all.some(
    (other) =>
      other !== relation &&
      other.fromModel === relation.toModel &&
      other.toModel === relation.fromModel &&
      relationName(other) === relationName(relation),
  );
}

// ── Detectors (each pure: facts -> findings) ───────────────────────────────

export function detectFkWithoutIndex(facts: PrismaSchemaFacts): DriftFinding[] {
  return facts.relations
    .filter((relation) => relation.fkFields.length > 0 && !relation.isFkIndexed)
    .map((relation) => ({
      issueType: "fk-without-index",
      issueKey: `fk-without-index:${relation.fromModel}.${relation.fkFields.join("+")}`,
      severity: "warn" as DriftSeverity,
      message: `Foreign key ${relation.fromModel}.${relation.fkFields.join(", ")} (→ ${relation.toModel}) has no covering index.`,
      targetSourceKey: modelKey(relation.fromModel),
      details: {
        fromModel: relation.fromModel,
        toModel: relation.toModel,
        fkFields: relation.fkFields,
        cardinality: relation.cardinality,
      },
    }));
}

export function detectMissingInverseRelation(facts: PrismaSchemaFacts): DriftFinding[] {
  return facts.relations
    // Only flag the owning (FK-holding) side to avoid double-reporting.
    .filter((relation) => relation.fkFields.length > 0 && !hasInverse(relation, facts.relations))
    .map((relation) => ({
      issueType: "missing-inverse-relation",
      issueKey: `missing-inverse:${relation.fromModel}.${relation.fieldName}`,
      severity: "warn" as DriftSeverity,
      message: `Relation ${relation.fromModel}.${relation.fieldName} (→ ${relation.toModel}) has no inverse relation on ${relation.toModel}.`,
      targetSourceKey: modelKey(relation.fromModel),
      details: { fromModel: relation.fromModel, toModel: relation.toModel, fieldName: relation.fieldName },
    }));
}

export function detectOrphanModels(facts: PrismaSchemaFacts): DriftFinding[] {
  const connected = new Set<string>();
  for (const relation of facts.relations) {
    connected.add(relation.fromModel);
    connected.add(relation.toModel);
  }
  return facts.models
    .filter((model) => !model.isIgnored && !connected.has(model.name))
    .map((model) => ({
      issueType: "orphan-model",
      issueKey: `orphan-model:${model.name}`,
      severity: "info" as DriftSeverity,
      message: `Model ${model.name} has no relations to any other model.`,
      targetSourceKey: modelKey(model.name),
      details: { model: model.name },
    }));
}

export function detectIgnoredModels(facts: PrismaSchemaFacts): DriftFinding[] {
  return facts.models
    .filter((model) => model.isIgnored)
    .map((model) => ({
      issueType: "ignored-model",
      issueKey: `ignored-model:${model.name}`,
      severity: "info" as DriftSeverity,
      message: `Model ${model.name} is @@ignore'd and excluded from the Prisma client.`,
      targetSourceKey: modelKey(model.name),
      details: { model: model.name },
    }));
}

const DETECTORS = [
  detectFkWithoutIndex,
  detectMissingInverseRelation,
  detectOrphanModels,
  detectIgnoredModels,
];

/** Run all deterministic drift detectors and return the combined findings. */
export function detectDrift(facts: PrismaSchemaFacts): DriftFinding[] {
  return DETECTORS.flatMap((detector) => detector(facts));
}

export type DriftSummary = Record<string, number>;

export function summarizeFindings(findings: DriftFinding[]): DriftSummary {
  return findings.reduce<DriftSummary>((acc, finding) => {
    acc[finding.issueType] = (acc[finding.issueType] ?? 0) + 1;
    return acc;
  }, {});
}
