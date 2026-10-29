export type CloneRow = Record<string, unknown>;
export type CloneCursorClient = {
  query(sql: string): Promise<{ rows: CloneRow[] }>;
};
/** Counts and elapsed milliseconds only; never retain source rows. */
export type CloneFetchMetrics = { fetchMs: number; fetches: number; rows: number; batches: number };
export type CloneBatchReader = () => Promise<CloneRow[] | null>;

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
  return withSanitizedCursorBatches(source, selectSql, async next => {
    for (let rows = await next(); rows !== null; rows = await next()) {
      await write(rows);
      rows.length = 0;
    }
  }, batchSize, ownsSnapshot, metrics);
}

/** The consumer must finish and release each batch before fetching another,
 * and must reach EOF before this scope may commit its read-only snapshot. */
export async function withSanitizedCursorBatches(
  source: CloneCursorClient,
  selectSql: string,
  consume: (next: CloneBatchReader) => Promise<void>,
  batchSize = 50,
  ownsSnapshot = true,
  metrics?: CloneFetchMetrics,
): Promise<void> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error("Sanitized clone batch size must be an integer from 1 to 500");
  }
  if (ownsSnapshot) await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const outstanding: { rows: CloneRow[] | null } = { rows: null };
  let exhausted = false;
  try {
    await source.query(`DECLARE sanitized_clone_batch NO SCROLL CURSOR FOR ${selectSql}`);
    await consume(async () => {
      if (outstanding.rows?.length) throw new Error("Release the previous sanitized clone batch before fetching another");
      if (exhausted) return null;
      const started = performance.now();
      let result;
      try { result = await source.query(`FETCH FORWARD ${batchSize} FROM sanitized_clone_batch`); }
      finally {
        if (metrics) { metrics.fetches++; metrics.fetchMs += performance.now() - started; }
      }
      if (result.rows.length === 0) { exhausted = true; return null; }
      if (metrics) { metrics.batches++; metrics.rows += result.rows.length; }
      outstanding.rows = result.rows;
      return result.rows;
    });
    if (!exhausted) throw new Error("Sanitized clone cursor was not fully consumed");
    await source.query("CLOSE sanitized_clone_batch");
    if (ownsSnapshot) await source.query("COMMIT");
  } catch (error) {
    try { if (ownsSnapshot) await source.query("ROLLBACK"); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Sanitized clone source snapshot cleanup failed");
    }
    throw error;
  } finally { if (outstanding.rows) outstanding.rows.length = 0; }
}
