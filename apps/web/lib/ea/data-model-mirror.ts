// Data-model mirror — EP-DATA-ARCH Phase 2 (BI-2167A734).
//
// Deterministic, idempotent projection of the Prisma data model into the EA
// substrate: one `data_object` EaElement per model, one EaRelationship per
// Prisma relation (carrying cardinality + FK metadata in `properties`). The
// mirror owns factual structure; the Data Architect steward (Phase 4) adds
// judgment on top without mutating mirror-owned rows.
//
// Identity is a stable source key stored in `properties.sourceKey` (and, for
// elements, `infraCiKey`):
//   element      prisma:model:<ModelName>
//   relationship prisma:relation:<FromModel>:<fieldName>:<ToModel>
//
// The core diff (`planMirror`) is pure and fully unit-tested; DB/Neo4j writes
// are a thin applier layered on top.

import type {
  PrismaSchemaFacts,
  PrismaModelFact,
  PrismaRelationFact,
} from "../integrate/code-graph/extractors/prisma-schema-adapter";
import { DATA_ASSET_REGISTRY, lookupAssetByPrismaModel } from "../govern/data/assets";

export const DATA_MODEL_MIRROR_VERSION = "data-model-mirror-v1";
export const MODEL_SOURCE_KEY_PREFIX = "prisma:model:";
export const RELATION_SOURCE_KEY_PREFIX = "prisma:relation:";

export function modelSourceKey(modelName: string): string {
  return `${MODEL_SOURCE_KEY_PREFIX}${modelName}`;
}

export function relationSourceKey(relation: {
  fromModel: string;
  fieldName: string;
  toModel: string;
}): string {
  return `${RELATION_SOURCE_KEY_PREFIX}${relation.fromModel}:${relation.fieldName}:${relation.toModel}`;
}

// ---------------------------------------------------------------------------
// Desired state (derived purely from parsed Prisma facts)
// ---------------------------------------------------------------------------

export type DesiredElement = {
  sourceKey: string;
  name: string;
  properties: Record<string, unknown>;
  /** Stable signature of mutable content; drives change detection. */
  descriptor: string;
};

export type DesiredRelationship = {
  sourceKey: string;
  fromSourceKey: string;
  toSourceKey: string;
  properties: Record<string, unknown>;
  descriptor: string;
};

function modelElementProperties(model: PrismaModelFact): Record<string, unknown> {
  return {
    sourceKey: modelSourceKey(model.name),
    mirror: DATA_MODEL_MIRROR_VERSION,
    model: model.name,
    mappedTable: model.mappedTable,
    isIgnored: model.isIgnored,
    fieldCount: model.fields.length,
    fields: model.fields.map((field) => ({
      name: field.name,
      type: field.rawType,
      kind: field.kind,
      isList: field.isList,
      isRequired: field.isRequired,
      isId: field.isId,
      isUnique: field.isUnique,
      mappedColumn: field.mappedColumn,
    })),
  };
}

function relationProperties(relation: PrismaRelationFact): Record<string, unknown> {
  return {
    sourceKey: relationSourceKey(relation),
    mirror: DATA_MODEL_MIRROR_VERSION,
    cardinality: relation.cardinality,
    fieldName: relation.fieldName,
    relationName: relation.relationName,
    fkFields: relation.fkFields,
    references: relation.references,
    isFkIndexed: relation.isFkIndexed,
  };
}

/** Stable, order-independent signature of a record's mutable content. */
function signature(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.keys(val as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = (val as Record<string, unknown>)[key];
          return acc;
        }, {});
    }
    return val;
  });
}

/**
 * BI-DG-002 (spec §6.1): project the logical asset/classification onto the model's
 * mirror element — no second ERD. Only models registered in the data-control spine
 * carry a `governance` block; unregistered models (still in the legacy coverage
 * baseline) carry none until a coverage wave classifies them.
 */
function governanceProperties(modelName: string): Record<string, unknown> {
  const asset = lookupAssetByPrismaModel(DATA_ASSET_REGISTRY, modelName);
  if (!asset) return {};
  return {
    governance: {
      assetId: asset.id,
      domain: asset.domain,
      sensitivity: asset.sensitivity,
      categories: asset.categories,
      criticality: asset.criticality,
      lifecycleClass: asset.lifecycleClass,
      projectionClass: asset.projectionClass,
      masterDataDomain: asset.masterDataDomain ?? null,
      classificationState: asset.classification.state,
      classificationSource: asset.classification.source,
    },
  };
}

export function buildDesiredState(facts: PrismaSchemaFacts): {
  elements: DesiredElement[];
  relationships: DesiredRelationship[];
} {
  const elements: DesiredElement[] = facts.models.map((model) => {
    const properties = { ...modelElementProperties(model), ...governanceProperties(model.name) };
    return {
      sourceKey: modelSourceKey(model.name),
      name: model.name,
      properties,
      descriptor: signature({ name: model.name, properties }),
    };
  });

  const modelNames = new Set(facts.models.map((model) => model.name));
  const relationships: DesiredRelationship[] = facts.relations
    // Only mirror relations whose endpoints are both mirrored models.
    .filter((relation) => modelNames.has(relation.fromModel) && modelNames.has(relation.toModel))
    .map((relation) => {
      const properties = relationProperties(relation);
      return {
        sourceKey: relationSourceKey(relation),
        fromSourceKey: modelSourceKey(relation.fromModel),
        toSourceKey: modelSourceKey(relation.toModel),
        properties,
        descriptor: signature(properties),
      };
    });

  return { elements, relationships };
}

// ---------------------------------------------------------------------------
// Existing state (read from the EA substrate, DB-agnostic shape)
// ---------------------------------------------------------------------------

export type ExistingMirrorRow = {
  id: string;
  sourceKey: string;
  descriptor: string;
  /** True once a row has been marked removed by a prior reconcile. */
  removed: boolean;
};

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export type MirrorElementOp =
  | { kind: "create"; desired: DesiredElement }
  | { kind: "update"; id: string; desired: DesiredElement }
  | { kind: "revive"; id: string; desired: DesiredElement }
  | { kind: "remove"; id: string; sourceKey: string };

export type MirrorRelationshipOp =
  | { kind: "create"; desired: DesiredRelationship }
  | { kind: "update"; id: string; desired: DesiredRelationship }
  | { kind: "revive"; id: string; desired: DesiredRelationship }
  | { kind: "remove"; id: string; sourceKey: string };

export type DuplicateConflict = {
  scope: "element" | "relationship";
  sourceKey: string;
  ids: string[];
};

export type MirrorPlan = {
  elementOps: MirrorElementOp[];
  relationshipOps: MirrorRelationshipOp[];
  duplicates: DuplicateConflict[];
  /** True when a duplicate source key blocks safe writes. */
  blocked: boolean;
  /** True when any structural change exists (drives snapshot-on-delta). */
  material: boolean;
};

function indexBySourceKey(rows: ExistingMirrorRow[]): {
  byKey: Map<string, ExistingMirrorRow>;
  duplicates: Map<string, string[]>;
} {
  const grouped = new Map<string, ExistingMirrorRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.sourceKey);
    if (list) list.push(row);
    else grouped.set(row.sourceKey, [row]);
  }
  const byKey = new Map<string, ExistingMirrorRow>();
  const duplicates = new Map<string, string[]>();
  for (const [sourceKey, list] of grouped) {
    if (list.length > 1) {
      duplicates.set(sourceKey, list.map((row) => row.id));
    }
    byKey.set(sourceKey, list[0]);
  }
  return { byKey, duplicates };
}

function diffElements(
  desired: DesiredElement[],
  existing: ExistingMirrorRow[],
): { ops: MirrorElementOp[]; duplicates: DuplicateConflict[] } {
  const { byKey, duplicates } = indexBySourceKey(existing);
  const ops: MirrorElementOp[] = [];
  const desiredKeys = new Set(desired.map((entry) => entry.sourceKey));

  for (const entry of desired) {
    const match = byKey.get(entry.sourceKey);
    if (!match) {
      ops.push({ kind: "create", desired: entry });
    } else if (match.removed) {
      ops.push({ kind: "revive", id: match.id, desired: entry });
    } else if (match.descriptor !== entry.descriptor) {
      ops.push({ kind: "update", id: match.id, desired: entry });
    }
  }

  for (const row of existing) {
    if (!desiredKeys.has(row.sourceKey) && !row.removed) {
      ops.push({ kind: "remove", id: row.id, sourceKey: row.sourceKey });
    }
  }

  const conflicts: DuplicateConflict[] = [...duplicates.entries()].map(([sourceKey, ids]) => ({
    scope: "element",
    sourceKey,
    ids,
  }));
  return { ops, duplicates: conflicts };
}

function diffRelationships(
  desired: DesiredRelationship[],
  existing: ExistingMirrorRow[],
): { ops: MirrorRelationshipOp[]; duplicates: DuplicateConflict[] } {
  const { byKey, duplicates } = indexBySourceKey(existing);
  const ops: MirrorRelationshipOp[] = [];
  const desiredKeys = new Set(desired.map((entry) => entry.sourceKey));

  for (const entry of desired) {
    const match = byKey.get(entry.sourceKey);
    if (!match) {
      ops.push({ kind: "create", desired: entry });
    } else if (match.removed) {
      ops.push({ kind: "revive", id: match.id, desired: entry });
    } else if (match.descriptor !== entry.descriptor) {
      ops.push({ kind: "update", id: match.id, desired: entry });
    }
  }

  for (const row of existing) {
    if (!desiredKeys.has(row.sourceKey) && !row.removed) {
      ops.push({ kind: "remove", id: row.id, sourceKey: row.sourceKey });
    }
  }

  const conflicts: DuplicateConflict[] = [...duplicates.entries()].map(([sourceKey, ids]) => ({
    scope: "relationship",
    sourceKey,
    ids,
  }));
  return { ops, duplicates: conflicts };
}

/**
 * Pure reconcile diff. Given the desired state (from Prisma facts) and the
 * existing mirror rows, produce the minimal set of create/update/revive/remove
 * operations. Idempotent: re-running against an already-reconciled state yields
 * an empty, non-material plan. If any source key maps to more than one active
 * row, the plan is `blocked` (the applier writes a conformance issue and stops).
 */
export function planMirror(
  facts: PrismaSchemaFacts,
  existing: { elements: ExistingMirrorRow[]; relationships: ExistingMirrorRow[] },
): MirrorPlan {
  const desired = buildDesiredState(facts);
  const elementDiff = diffElements(desired.elements, existing.elements);
  const relationshipDiff = diffRelationships(desired.relationships, existing.relationships);

  const duplicates = [...elementDiff.duplicates, ...relationshipDiff.duplicates];
  const blocked = duplicates.length > 0;

  const material =
    !blocked && (elementDiff.ops.length > 0 || relationshipDiff.ops.length > 0);

  return {
    elementOps: blocked ? [] : elementDiff.ops,
    relationshipOps: blocked ? [] : relationshipDiff.ops,
    duplicates,
    blocked,
    material,
  };
}

export type MirrorChangeSummary = {
  created: number;
  updated: number;
  revived: number;
  removed: number;
};

export function summarizePlan(plan: MirrorPlan): MirrorChangeSummary {
  const count = (
    ops: Array<{ kind: string }>,
    kind: string,
  ): number => ops.filter((op) => op.kind === kind).length;
  return {
    created: count(plan.elementOps, "create") + count(plan.relationshipOps, "create"),
    updated: count(plan.elementOps, "update") + count(plan.relationshipOps, "update"),
    revived: count(plan.elementOps, "revive") + count(plan.relationshipOps, "revive"),
    removed: count(plan.elementOps, "remove") + count(plan.relationshipOps, "remove"),
  };
}

export function describeChange(summary: MirrorChangeSummary): string {
  return [
    `${summary.created} added`,
    `${summary.updated} updated`,
    `${summary.revived} revived`,
    `${summary.removed} removed`,
  ].join(", ");
}
