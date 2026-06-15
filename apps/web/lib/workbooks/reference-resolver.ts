// Universal Grid & Workbooks — reference label hydration (EP-GRID-WORKBOOKS, Phase 2)
//
// A reference cell stores only referenceId + referenceType (the system-of-record
// identity). The human-readable label is resolved live from the target entity's
// adapter so it never goes stale (SoR-integral). This module batches + de-dupes
// that resolution for a set of reference cells.
//
// It imports only ./adapter statically; the platform adapters that own the target
// entities are registered via a runtime dynamic import so there is no load-time
// import cycle (custom-table-adapter → reference-resolver → platform-tables →
// workbook-service → custom-table-adapter).

import { gridRegistry } from "./adapter";
import type { GridRow } from "./types";

let registrationPromise: Promise<unknown> | null = null;

/** Ensure platform adapters (epic, digital_product, …) are registered before resolving. */
function ensurePlatformAdaptersRegistered(): Promise<unknown> {
  if (!registrationPromise) registrationPromise = import("./platform-tables");
  return registrationPromise;
}

export function referenceKey(referenceType: string, referenceId: string): string {
  return `${referenceType}:${referenceId}`;
}

/** De-dupe a list of references by type:id, dropping incomplete entries. Pure. */
export function collectUniqueReferences(
  refs: { referenceType: string; referenceId: string }[],
): Map<string, { type: string; id: string }> {
  const unique = new Map<string, { type: string; id: string }>();
  for (const r of refs) {
    if (!r.referenceId || !r.referenceType) continue;
    unique.set(referenceKey(r.referenceType, r.referenceId), {
      type: r.referenceType,
      id: r.referenceId,
    });
  }
  return unique;
}

/**
 * Resolve display labels for a batch of references, de-duped by type:id.
 * Returns a Map keyed by `referenceKey`. References whose target adapter is
 * unknown or cannot resolve are simply absent (caller falls back to the id).
 */
export async function resolveReferenceLabels(
  refs: { referenceType: string; referenceId: string }[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const unique = collectUniqueReferences(refs);
  if (unique.size === 0) return labels;

  // Only pay the registration import when a target adapter is not yet loaded.
  const types = new Set([...unique.values()].map((u) => u.type));
  if (![...types].every((t) => gridRegistry.has(t))) {
    await ensurePlatformAdaptersRegistered();
  }

  await Promise.all(
    [...unique.entries()].map(async ([key, { type, id }]) => {
      const adapter = gridRegistry.get(type);
      if (!adapter?.resolveReference) return;
      try {
        const res = await adapter.resolveReference(type, id);
        if (res) labels.set(key, res.label);
      } catch {
        // A dangling reference (target deleted) just renders as its id.
      }
    }),
  );
  return labels;
}

/**
 * Fetch the full target record for a batch of references (de-duped), used by
 * `lookup` columns to pull an arbitrary allow-listed field. Returns a Map keyed
 * by `referenceKey`; missing/dangling references are absent.
 */
export async function fetchReferenceRecords(
  refs: { referenceType: string; referenceId: string }[],
): Promise<Map<string, GridRow>> {
  const records = new Map<string, GridRow>();
  const unique = collectUniqueReferences(refs);
  if (unique.size === 0) return records;

  const types = new Set([...unique.values()].map((u) => u.type));
  if (![...types].every((t) => gridRegistry.has(t))) {
    await ensurePlatformAdaptersRegistered();
  }

  await Promise.all(
    [...unique.entries()].map(async ([key, { type, id }]) => {
      const adapter = gridRegistry.get(type);
      if (!adapter) return;
      try {
        const row = await adapter.getRow(type, id);
        if (row) records.set(key, row);
      } catch {
        // Dangling reference — lookup renders empty.
      }
    }),
  );
  return records;
}
