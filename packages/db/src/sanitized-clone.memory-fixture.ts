// Child-process regression: total input exceeds the former 4 GiB heap while
// the process has a 384 MiB heap. PostgreSQL integration is tested separately.
import { createHash } from "node:crypto";
import { copySanitizedCursorBatches, withSanitizedCursorBatches } from "./sanitized-clone-batches";
import { sanitizeConfidentialRow, createSanitizedCloneWriter } from "./sanitized-clone";
import { buildSanitizedInsertStatements } from "./sanitized-clone-sql";

void (async () => {
  const rowBytes = 512 * 1024;
  let remaining = 9000;
  let totalBytes = 0;
  let totalRows = 0;
  let peakHeap = 0;
  let maxTransactionRows = 0;
  const mode = process.argv.includes("--streamed") ? "streamed" : "direct";
  const source = { async query(sql: string) {
    if (!sql.startsWith("FETCH")) return { rows: [] };
    const count = Math.min(remaining, 50);
    remaining -= count;
    const rows = [];
    for (let i = 0; i < count; i++) rows.push({ id: String(remaining + i), name: "Confidential name", payload: JSON.parse(JSON.stringify({ text: "x".repeat(rowBytes) })), embedding: null });
    return { rows };
  } };
  const hash = createHash("sha256");
  const types = new Map([
    ["id", { dataType: "text", udtName: "text" }],
    ["name", { dataType: "text", udtName: "text" }],
    ["payload", { dataType: "jsonb", udtName: "jsonb" }],
    ["embedding", { dataType: "text", udtName: "text" }],
  ]);
  const transform = (rows: Array<Record<string, unknown>>) => {
    for (let i = 0; i < rows.length; i++) rows[i] = sanitizeConfidentialRow(rows[i]!, Number(rows[i]!.id));
    if (rows.some(row => !String(row.name).startsWith("Dev User") || row.embedding !== null)) throw new Error("unsanitized payload");
  };
  const consumeValues = (values: readonly unknown[]) => {
    for (let index = 2; index < values.length; index += 4) {
      const payload = values[index] as string;
      hash.update(payload); totalBytes += payload.length; totalRows++;
    }
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
  };
  if (mode === "streamed") {
    const client = { $transaction: async (write: (tx: unknown) => Promise<void>) => {
      let rows = 0;
      await write({
        $queryRawUnsafe: async () => [...types].map(([columnName, info]) => ({ columnName, ...info })),
        $executeRawUnsafe: async (sql: string, ...values: unknown[]) => {
          if (sql.startsWith("INSERT")) { consumeValues(values); rows += values.length / 4; }
          return 1;
        },
      });
      maxTransactionRows = Math.max(maxTransactionRows, rows);
    } };
    const metrics = { fetchMs: 0, fetches: 0, rows: 0, batches: 0, sanitizeMs: 0, transactionAttempts: 0, transactionMs: 0 };
    const writer = createSanitizedCloneWriter(client as never);
    await withSanitizedCursorBatches(source, "SELECT id, name, payload, NULL AS embedding FROM large_fixture",
      next => writer.copyBatches("Fixture", next, transform, metrics), 50, true, metrics);
  } else await copySanitizedCursorBatches(source, "SELECT id, name, payload, NULL AS embedding FROM large_fixture", async rows => {
    transform(rows);
    // Exercise actual bounded statement serialization/backpressure, retaining no writes.
    for (const statement of buildSanitizedInsertStatements("Fixture", rows, types)) {
      consumeValues(statement.values);
    }
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
  });
  console.log(JSON.stringify({ mode, totalBytes, totalRows, peakHeap, maxTransactionRows, digest: hash.digest("hex") }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
