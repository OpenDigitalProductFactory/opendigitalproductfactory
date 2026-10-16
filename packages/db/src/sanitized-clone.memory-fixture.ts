// Child-process regression: total input exceeds the former 4 GiB heap while
// the process has a 384 MiB heap. PostgreSQL integration is tested separately.
import { createHash } from "node:crypto";
import { copySanitizedCursorBatches } from "./sanitized-clone-batches";
import { sanitizeConfidentialRow } from "./sanitized-clone";

void (async () => {
  const rowBytes = 512 * 1024;
  let remaining = 9000;
  let totalBytes = 0;
  let totalRows = 0;
  let peakHeap = 0;
  const source = { async query(sql: string) {
    if (!sql.startsWith("FETCH")) return { rows: [] };
    const count = Math.min(remaining, 50);
    remaining -= count;
    const rows = [];
    for (let i = 0; i < count; i++) rows.push({ id: String(remaining + i), name: "Confidential name", payload: JSON.parse(JSON.stringify({ text: "x".repeat(rowBytes) })), embedding: null });
    return { rows };
  } };
  const hash = createHash("sha256");
  await copySanitizedCursorBatches(source, "SELECT id, name, payload, NULL AS embedding FROM large_fixture", async rows => {
    for (let i = 0; i < rows.length; i++) rows[i] = sanitizeConfidentialRow(rows[i]!, Number(rows[i]!.id));
    // Equivalent destination serialization/backpressure; no retained writes.
    for (const row of rows) {
      if (!String(row.name).startsWith("Dev User") || row.embedding !== null) throw new Error("unsanitized payload");
      const payload = JSON.stringify(row.payload);
      hash.update(payload);
      totalBytes += payload.length;
      totalRows++;
    }
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
  });
  console.log(JSON.stringify({ totalBytes, totalRows, peakHeap, digest: hash.digest("hex") }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
