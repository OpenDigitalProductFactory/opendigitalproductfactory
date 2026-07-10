// apps/web/lib/governance/reconcile-keyed-findings.ts — EP-8DC217EB BET-12
//
// The generic keyed-findings reconcile loop shared by the governance finding
// streams. A detector emits a set of stable-keyed findings; this helper owns the
// create-new / update-changed / auto-resolve-absent contract against a set of
// currently-open rows, so each stream does not re-implement the same fragile
// persistence loop.
//
// It is deliberately storage-agnostic: the caller supplies the row loader, the
// key extractors, the change comparator, and the create/update/resolve writers.
// `ea/conformance-issue-reconciler.ts` is the first thin adapter over it; the
// other streams (wiki-lint, assurance, security) can plug in later without
// touching this loop.

/** A finding carries a stable per-stream key; everything else is stream-specific. */
export interface KeyedFinding {
  key: string;
}

export interface ReconcileKeyedFindingsOptions<TRow, TFinding extends KeyedFinding> {
  /** Load the currently-open rows this reconcile should consider. */
  loadOpen: () => Promise<TRow[]>;
  /** Stable key for an existing row; a null key skips the row (it can't be matched). */
  keyOf: (row: TRow) => string | null;
  /** Desired findings, each with a stable `key`. */
  findings: TFinding[];
  /** True when a matched row differs from its finding and needs an update. */
  hasChanged: (row: TRow, finding: TFinding) => boolean;
  /** Persist a brand-new finding (no matching open row). */
  create: (finding: TFinding) => Promise<unknown>;
  /** Update the matched row to reflect the (changed) finding. */
  update: (row: TRow, finding: TFinding) => Promise<unknown>;
  /** Resolve an open row whose key is no longer among the findings. */
  resolve: (row: TRow) => Promise<unknown>;
}

export interface ReconcileKeyedFindingsResult {
  created: number;
  updated: number;
  resolved: number;
}

/**
 * Reconcile a set of stable-keyed findings against the currently-open rows:
 * create findings with no open row, update matched rows whose content changed,
 * and resolve open rows whose key vanished from the findings.
 */
export async function reconcileKeyedFindings<TRow, TFinding extends KeyedFinding>(
  opts: ReconcileKeyedFindingsOptions<TRow, TFinding>,
): Promise<ReconcileKeyedFindingsResult> {
  const existing = await opts.loadOpen();

  const existingByKey = new Map<string, TRow>();
  for (const row of existing) {
    const key = opts.keyOf(row);
    if (key) existingByKey.set(key, row);
  }

  const findingKeys = new Set(opts.findings.map((f) => f.key));
  let created = 0;
  let updated = 0;
  let resolved = 0;

  for (const finding of opts.findings) {
    const match = existingByKey.get(finding.key);
    if (!match) {
      await opts.create(finding);
      created += 1;
    } else if (opts.hasChanged(match, finding)) {
      await opts.update(match, finding);
      updated += 1;
    }
  }

  for (const [key, row] of existingByKey) {
    if (!findingKeys.has(key)) {
      await opts.resolve(row);
      resolved += 1;
    }
  }

  return { created, updated, resolved };
}

/**
 * Deterministic JSON string with object keys sorted recursively, so two payloads
 * that differ only in key order compare equal. Shared change-detection primitive
 * for adapters that diff a stored JSON blob against a freshly-derived one.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(stableize(value));
}

function stableize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stableize(item)]),
  );
}
