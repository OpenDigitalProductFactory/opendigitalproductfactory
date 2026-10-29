import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { copySanitizedCursorBatches } from "./sanitized-clone-batches";

describe("bounded sanitized cursor copy", () => {
  it("reports aggregate fetch counts without retaining confidential payloads", async () => {
    let remaining = 51;
    const metrics = { fetchMs: 0, fetches: 0, rows: 0, batches: 0 };
    const source = { async query(sql: string) {
      if (!sql.startsWith("FETCH")) return { rows: [] };
      const count = Math.min(remaining, 50); remaining -= count;
      return { rows: Array.from({ length: count }, () => ({ payload: "PRIVATE-ROW-VALUE" })) };
    } };
    await copySanitizedCursorBatches(source, "SELECT payload FROM fixture", async () => {}, 50, true, metrics);
    expect(metrics).toMatchObject({ fetches: 3, batches: 2, rows: 51 });
    expect(metrics.fetchMs).toBeGreaterThan(0);
    expect(JSON.stringify(metrics)).not.toContain("PRIVATE-ROW-VALUE");
  });
  it("finishes each JSON/vector batch before reading another and releases its source snapshot", async () => {
    const events: string[] = [];
    let remaining = 1001;
    const source = { async query(sql: string) {
      events.push(sql);
      if (!sql.startsWith("FETCH")) return { rows: [] };
      const count = Math.min(remaining, 50);
      remaining -= count;
      return { rows: Array.from({ length: count }, (_, i) => ({ id: String(remaining + i), payload: { text: "x".repeat(32000) }, vector: null })) };
    } };
    let copied = 0;
    await copySanitizedCursorBatches(source, "SELECT id, payload, NULL AS vector FROM fixture", async rows => {
      expect(rows.length).toBeLessThanOrEqual(50);
      expect(rows.every(row => row.vector === null)).toBe(true);
      copied += rows.length;
      events.push("written");
    }, 50);
    expect(copied).toBe(1001);
    for (let i = 0; i < events.length; i++) {
      if (events[i] === "written") expect(events[i - 1]).toMatch(/^FETCH FORWARD 50/);
    }
    expect(events[0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(events.at(-1)).toBe("COMMIT");
  });

  it("rolls back and stops on a failed destination write", async () => {
    const events: string[] = [];
    const source = { async query(sql: string) { events.push(sql); return { rows: sql.startsWith("FETCH") ? [{ id: "1" }] : [] }; } };
    await expect(copySanitizedCursorBatches(source, "SELECT id FROM fixture", async () => { throw new Error("destination failed"); })).rejects.toThrow("destination failed");
    expect(events.at(-1)).toBe("ROLLBACK");
    expect(events.filter(sql => sql.startsWith("FETCH"))).toHaveLength(1);
    expect(events).not.toContain("COMMIT");
  });

  it("rejects unbounded or invalid fetch sizes before reading", async () => {
    const source = { query: async () => { throw new Error("must not query"); } };
    for (const size of [0, -1, Infinity, NaN, 501]) {
      await expect(copySanitizedCursorBatches(source, "SELECT 1", async () => {}, size)).rejects.toThrow("batch size");
    }
  });
});

it("processes more than 4 GiB JSON/vector-shaped input under a 384 MiB heap", () => {
  const child = spawnSync(process.execPath, ["--max-old-space-size=384", "--import", "tsx", fileURLToPath(new URL("./sanitized-clone.memory-fixture.ts", import.meta.url))],
    { encoding: "utf8", timeout: 120000 });
  expect(child.status, child.stderr).toBe(0);
  const result = JSON.parse(child.stdout.trim().split("\n").at(-1)!);
  expect(result.totalBytes).toBeGreaterThan(4 * 1024 ** 3);
  expect(result.totalRows).toBe(9000);
  expect(result.peakHeap).toBeLessThan(384 * 1024 ** 2);
}, 125000);
