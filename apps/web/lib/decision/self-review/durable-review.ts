/** Frozen review protocol. Caller serializes each logical run; writes are durable
 * before effects and complete() publishes the result reference atomically.
 * An interrupted intent requires destination reconciliation, never blind retry. */
export interface FrozenReviewStore {
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
  complete(): Promise<void>;
}
export type FrozenMeasurement<L> = { lines: L[]; coverage?: unknown };
export async function runFrozenReview<L extends { key: string }, R>(
  store: FrozenReviewStore,
  measure: () => Promise<L[] | FrozenMeasurement<L>>,
  route: (line: L) => Promise<R>,
  recovery: { reconcile?: (line: L) => Promise<R | undefined>; prepare?: (line: L) => Promise<unknown>; retryAfterRollback?: (line: L) => Promise<boolean> } = {},
): Promise<{ lines: L[]; routing: R[]; coverage?: unknown }> {
  const completed = await store.read("result") as { lines: L[]; routing: R[]; coverage?: unknown } | undefined;
  if (completed) { await store.complete(); return completed; }
  let measurement = await store.read("measurement") as L[] | FrozenMeasurement<L> | undefined;
  if (!measurement) { measurement = await measure(); await store.write("measurement", measurement); }
  const lines = Array.isArray(measurement) ? measurement : measurement.lines;
  const routing: R[] = [];
  for (const line of lines) {
    const prior = await store.read(`routed:${line.key}`) as { result: R } | undefined;
    if (prior) { routing.push(prior.result); continue; }
    const priorIntent = await store.read(`intent:${line.key}`) as { destination?: unknown } | undefined;
    if (priorIntent) {
      const observed = await recovery.reconcile?.(line);
      if (observed !== undefined) {
        await store.write(`routed:${line.key}`, { result: observed });
        routing.push(observed);
        continue;
      }
      if (!await recovery.retryAfterRollback?.(line)) throw new Error(`Review destination reconciliation required: ${line.key}`);
    }
    const destination = priorIntent ? priorIntent.destination ?? null : await recovery.prepare?.(line) ?? null;
    await store.write(`intent:${line.key}`, { finding: line, destination, destinationState: "unconfirmed" });
    const result = await route(line);
    await store.write(`routed:${line.key}`, { result });
    routing.push(result);
  }
  const result = { lines, routing, ...(!Array.isArray(measurement) && measurement.coverage !== undefined ? { coverage: measurement.coverage } : {}) };
  await store.write("result", result);
  await store.complete();
  return result;
}
