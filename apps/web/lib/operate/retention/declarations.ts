// EP-A33A5C61 slice 4d — the retention sweep READS its policies from the
// Postgres catalog. Nothing in apps/web declares a window any more.
//
// Source of truth: `/// @dpf` tags in packages/db/prisma/schema (parsed and
// carried into `COMMENT ON TABLE` by packages/db/scripts/apply-model-metadata-
// comments.ts at every portal boot). This module turns those declarations into
// the executor's PurgePolicy / RetainedDataset shapes, merging the small set of
// BEHAVIOURAL overrides (partitions, extra predicates, cascade-correct custom
// handlers) that a table-level tag cannot express — see RETENTION_OVERRIDES in
// policies.ts.
//
// Fallback: if the catalog carries no dpf: comments at all (a database the
// applier has not touched yet), the schema files shipped with the app are
// parsed directly, so a sweep never silently runs with zero policies.

import { readFileSync } from "node:fs";
import { basename } from "node:path";

import {
  parseCatalogCommentWithModel,
  parseModelMetadataSources,
  type DataCategoryTag,
  type ModelMetadata,
} from "@dpf/db/model-metadata";
import { listCanonicalPrismaSchemaFiles } from "@dpf/db/schema-source";

import {
  RETENTION_OVERRIDES,
  type PurgePolicy,
  type RetainedDataset,
  type RetentionFloorBucket,
  type RetentionOverride,
} from "./policies";

export type ModelDeclaration = { model: string; table: string; metadata: ModelMetadata };

const delegateFor = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);

/**
 * Floor bucket = the axis industry floors key on. Derived from the tag's
 * DataCategory list: an audit trail is anything carrying `security-audit`,
 * chat is anything carrying `content`, everything else is telemetry.
 */
export function floorBucket(metadata: Pick<ModelMetadata, "categories" | "lifecycle">): RetentionFloorBucket {
  const cats = new Set<DataCategoryTag>(metadata.categories ?? []);
  if (cats.has("security-audit") || cats.has("authorization") || metadata.lifecycle === "security-audit") return "audit";
  if (cats.has("content")) return "chat";
  return "telemetry";
}

type CatalogReader = {
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
};

/** Read every dpf: table comment from the connected database. */
export async function readDeclarationsFromCatalog(db: CatalogReader): Promise<ModelDeclaration[]> {
  const rows = await db.$queryRawUnsafe<Array<{ table: string; comment: string | null }>>(
    `SELECT c.relname AS "table", obj_description(c.oid, 'pg_class') AS "comment"
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p')
        AND obj_description(c.oid, 'pg_class') LIKE 'dpf:%'`,
  );
  const out: ModelDeclaration[] = [];
  for (const row of rows) {
    const parsed = parseCatalogCommentWithModel(row.comment);
    if (!parsed?.model) continue;
    out.push({ model: parsed.model, table: row.table, metadata: parsed.metadata });
  }
  return out;
}

/** Parse the schema files shipped with the app (fallback and tests). */
export function readDeclarationsFromSchemaFiles(): ModelDeclaration[] {
  const parsed = parseModelMetadataSources(
    listCanonicalPrismaSchemaFiles().map((file) => ({ file: basename(file), source: readFileSync(file, "utf8") })),
  );
  return parsed.entries.map((e) => ({ model: e.model, table: e.table, metadata: e.metadata }));
}

export async function loadModelDeclarations(db: CatalogReader, log: (m: string) => void = () => {}): Promise<ModelDeclaration[]> {
  try {
    const fromCatalog = await readDeclarationsFromCatalog(db);
    if (fromCatalog.length > 0) return fromCatalog;
    log("catalog carries no dpf: comments yet — falling back to the schema files");
  } catch (err) {
    log(`catalog read failed (${err instanceof Error ? err.message : String(err)}) — falling back to the schema files`);
  }
  return readDeclarationsFromSchemaFiles();
}

/**
 * Purge policies = every declaration with a purge window, expanded by its
 * override (partitions become one policy each; extraWhere / customPurge are
 * attached). Pure.
 */
export function buildPurgePolicies(
  declarations: readonly ModelDeclaration[],
  overrides: Readonly<Record<string, RetentionOverride>> = RETENTION_OVERRIDES,
): PurgePolicy[] {
  const policies: PurgePolicy[] = [];
  for (const d of declarations) {
    if (d.metadata.retention.kind !== "purge") continue;
    const delegate = delegateFor(d.model);
    const override = overrides[delegate];
    const base = {
      model: delegate,
      category: floorBucket(d.metadata),
      timestampField: override?.timestampField ?? d.metadata.timeAxis ?? "createdAt",
      baseRetentionDays: d.metadata.retention.days,
    };
    if (override?.partitions?.length) {
      for (const p of override.partitions) {
        policies.push({
          ...base,
          label: `${d.model} — ${p.label}`,
          extraWhere: p.extraWhere,
          baseRetentionDays: p.days ?? base.baseRetentionDays,
        });
      }
      continue;
    }
    policies.push({
      ...base,
      label: d.model,
      ...(override?.extraWhere ? { extraWhere: override.extraWhere } : {}),
      ...(override?.customPurge ? { customPurge: override.customPurge } : {}),
    });
  }
  return policies;
}

/** Retained datasets = every declaration with retention=retained. Pure. */
export function buildRetainedDatasets(declarations: readonly ModelDeclaration[]): RetainedDataset[] {
  return declarations
    .filter((d) => d.metadata.retention.kind === "retained")
    .map((d) => ({
      model: delegateFor(d.model),
      label: d.model,
      regulatoryBasis: d.metadata.basis ?? "declared retained in the schema",
      minRetentionYears: d.metadata.minYears === "permanent" ? Number.POSITIVE_INFINITY : (d.metadata.minYears ?? 0),
    }));
}

/**
 * Every override must point at a model the schema declares purgeable —
 * otherwise a behavioural rule would silently apply to nothing. Pure; used by
 * the retention test suite against the real schema.
 */
export function orphanOverrides(
  declarations: readonly ModelDeclaration[],
  overrides: Readonly<Record<string, RetentionOverride>> = RETENTION_OVERRIDES,
): string[] {
  const purgeable = new Set(declarations.filter((d) => d.metadata.retention.kind === "purge").map((d) => delegateFor(d.model)));
  return Object.keys(overrides).filter((k) => !purgeable.has(k));
}
