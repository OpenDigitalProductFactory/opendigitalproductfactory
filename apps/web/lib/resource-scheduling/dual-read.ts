// W19 vertical clone collapse — dual-read merge (BI-99C76A90, architecture
// pass 2026-08-16 §3.2-c).
//
// EXPAND-phase read semantics over the unified resource-scheduling family:
// a reader consults BOTH the unified table and its legacy clone table, and a
// unified row that mirrors a clone row (same sourceRef) WINS — the clone row is
// suppressed. Until the operator-reviewed backfill runs, the unified tables are
// empty and dual-read degenerates to exactly the legacy read (which is what the
// characterization suites pin). After backfill, the same merge makes the
// unified rows authoritative without a read-path flip.

export interface DualReadMerge<U> {
  rows: U[];
  /** Unified rows returned as-is. */
  unifiedCount: number;
  /** Legacy rows adapted because no unified mirror exists yet. */
  adaptedCount: number;
  /** Legacy rows suppressed because a unified row already mirrors them. */
  mirroredCount: number;
}

/**
 * Merge unified rows with adapted legacy rows, deduping on sourceRef.
 * Deterministic: unified rows keep their order, adapted legacy rows follow in
 * legacy order.
 */
export function mergeDualRead<U extends { sourceRef: string | null }, L>(input: {
  unified: U[];
  legacy: L[];
  legacySourceRef: (row: L) => string;
  adapt: (row: L) => U;
}): DualReadMerge<U> {
  const mirrored = new Set<string>();
  for (const row of input.unified) {
    if (row.sourceRef) mirrored.add(row.sourceRef);
  }
  const rows: U[] = [...input.unified];
  let adaptedCount = 0;
  let mirroredCount = 0;
  for (const legacyRow of input.legacy) {
    if (mirrored.has(input.legacySourceRef(legacyRow))) {
      mirroredCount += 1;
      continue;
    }
    rows.push(input.adapt(legacyRow));
    adaptedCount += 1;
  }
  return { rows, unifiedCount: input.unified.length, adaptedCount, mirroredCount };
}
