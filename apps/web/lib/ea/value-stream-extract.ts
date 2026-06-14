// apps/web/lib/ea/value-stream-extract.ts
//
// Pure extractor for the IT4IT value-stream SysML projection (Parity Engine).
// Projects the value-stream taxonomy (already auto-extracted from the IT4IT
// functional-criteria workbook into EaReferenceModelElement) into the SysML
// notation, so SysML requirements/parts can trace to value streams and the
// operating-model dimension is represented in the systems model. Runtime-safe: the
// source is a Postgres table, read by the reconcile shell; this module is pure
// (takes the rows) and testable. SysML mapping:
//   - value_stream        → part_definition (vstream:vs:<slug>)
//   - value_stream_stage  → part_usage      (vstream:stage:<slug>), contained by its stream
//   - package contains the streams; each stream contains its stages

import type { SysmlDesiredModel } from "./sysml-model-seed";

export const VALUE_STREAM_PACKAGE_KEY = "vstream:pkg";

export interface ValueStreamRow {
  kind: string; // "value_stream" | "value_stream_stage"
  slug: string;
  name: string;
  /** For a stage: the slug of its parent value_stream (resolved by the reconcile). */
  parentSlug: string | null;
}

export function buildValueStreamModel(rows: ValueStreamRow[]): SysmlDesiredModel {
  const elements: SysmlDesiredModel["elements"] = [];
  const relationships: SysmlDesiredModel["relationships"] = [];

  elements.push({
    sysmlKey: VALUE_STREAM_PACKAGE_KEY,
    typeSlug: "package",
    name: "IT4IT Value Streams",
    description:
      "Live SysML projection of the IT4IT value-stream taxonomy, derived from the EaReferenceModelElement IT4IT model so it cannot drift from the reference data.",
    properties: { sourceKey: "packages/db/src/seed-ea-reference-models.ts (IT4IT)" },
  });

  const streamKeys = new Set<string>();
  for (const r of rows) {
    if (r.kind !== "value_stream") continue;
    const key = `vstream:vs:${r.slug}`;
    streamKeys.add(r.slug);
    elements.push({
      sysmlKey: key,
      typeSlug: "part_definition",
      name: r.name,
      description: `IT4IT value stream: ${r.name}.`,
      properties: { sourceKey: `it4it:value_stream:${r.slug}`, slug: r.slug },
    });
    relationships.push({ fromKey: VALUE_STREAM_PACKAGE_KEY, toKey: key, relSlug: "contains" });
  }

  for (const r of rows) {
    if (r.kind !== "value_stream_stage") continue;
    const key = `vstream:stage:${r.slug}`;
    elements.push({
      sysmlKey: key,
      typeSlug: "part_usage",
      name: r.name,
      description: `Value-stream stage: ${r.name}.`,
      properties: { sourceKey: `it4it:value_stream_stage:${r.slug}`, slug: r.slug, parent: r.parentSlug },
    });
    // Contain the stage under its parent stream when known, else under the package.
    const parentKey = r.parentSlug && streamKeys.has(r.parentSlug) ? `vstream:vs:${r.parentSlug}` : VALUE_STREAM_PACKAGE_KEY;
    relationships.push({ fromKey: parentKey, toKey: key, relSlug: "contains" });
  }

  return {
    elements,
    relationships,
    elementTypeSlugs: ["package", "part_definition", "part_usage"],
    relTypeSlugs: ["contains"],
    view: {
      name: "IT4IT Value Streams — Live Projection",
      description: "Live, system-maintained projection of the IT4IT value-stream taxonomy.",
      viewpointName: "System Decomposition & Interfaces",
      scopeRef: "value-streams",
    },
    softRemovePrefix: "vstream:",
  };
}
