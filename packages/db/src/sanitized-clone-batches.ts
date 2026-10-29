export type CloneRow = Record<string, unknown>;
export type CloneCursorClient = {
  query(sql: string): Promise<{ rows: CloneRow[] }>;
};
/** Counts and elapsed milliseconds only; never retain source rows. */
export type CloneFetchMetrics = { fetchMs: number; fetches: number; rows: number; batches: number };

/** A PostgreSQL cursor owns the read snapshot. Only one fetched batch can be
 * retained by this loop; destination backpressure prevents read-ahead. */
export async function copySanitizedCursorBatches(
  source: CloneCursorClient,
  selectSql: string,
  write: (rows: CloneRow[]) => Promise<void>,
  batchSize = 50,
  ownsSnapshot = true,
  metrics?: CloneFetchMetrics,
): Promise<void> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error("Sanitized clone batch size must be an integer from 1 to 500");
  }
  if (ownsSnapshot) await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await source.query(`DECLARE sanitized_clone_batch NO SCROLL CURSOR FOR ${selectSql}`);
    for (;;) {
      const started = performance.now();
      let result;
      try { result = await source.query(`FETCH FORWARD ${batchSize} FROM sanitized_clone_batch`); }
      finally {
        if (metrics) { metrics.fetches++; metrics.fetchMs += performance.now() - started; }
      }
      if (result.rows.length === 0) break;
      if (metrics) { metrics.batches++; metrics.rows += result.rows.length; }
      await write(result.rows);
      // Release references before the next fetch, including the final short batch.
      result.rows.length = 0;
    }
    await source.query("CLOSE sanitized_clone_batch");
    if (ownsSnapshot) await source.query("COMMIT");
  } catch (error) {
    try { if (ownsSnapshot) await source.query("ROLLBACK"); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Sanitized clone source snapshot cleanup failed");
    }
    throw error;
  }
}
