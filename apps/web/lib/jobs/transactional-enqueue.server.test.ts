import { describe, expect, it, vi } from "vitest";

import { enqueueOwnedPostgresJob, type OwnedJobEvent, type TransactionalJobDb } from "./transactional-enqueue.server";

const event = { id: "revocation-1", name: "protected/authority.revoked", data: { revision: 7 } };
const functionId = "protected-authority-floor";
const input = { functionId, event, now: new Date("2026-11-25T18:00:00Z"), selection: { engine: "postgres" as const, functions: new Set([functionId]) } };

function txFixture(existing?: OwnedJobEvent) {
  let record = existing;
  const query = vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    if (!parts.join("?").includes('INSERT INTO "JobEvent"')) return record ? [{ name: record.name, data: record.data }] : [];
    if (record) return [];
    record = { id: String(values[0]), name: String(values[1]), data: JSON.parse(String(values[2])) };
    return [{ id: record.id }];
  });
  const execute = vi.fn(async () => 0);
  const tx: TransactionalJobDb = { $queryRaw: async <T>(strings: TemplateStringsArray, ...values: unknown[]) =>
    await query(strings, ...values) as T, $executeRaw: execute };
  return { tx, query, execute, row: () => record };
}

describe("owned Postgres transactional job enqueue", () => {
  it("inserts into the existing engine using the caller's transaction and exact event identity", async () => {
    const f = txFixture();
    await expect(enqueueOwnedPostgresJob(f.tx, input)).resolves.toBe("inserted");
    expect(f.row()).toEqual(event);
    expect(f.execute).toHaveBeenCalledTimes(1);
    await expect(enqueueOwnedPostgresJob(f.tx, input)).resolves.toBe("replay");
    expect(f.execute).toHaveBeenCalledTimes(1);
  });

  it("refuses a changed payload under the same id", async () => {
    const f = txFixture(event);
    await expect(enqueueOwnedPostgresJob(f.tx, { ...input, event: { ...event, data: { revision: 8 } } }))
      .rejects.toThrow("owned-job-content-conflict");
    expect(f.row()).toEqual(event);
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("holds before writing unless this function is routed to owned Postgres", async () => {
    const f = txFixture();
    for (const selection of [{ engine: "inngest" as const }, { engine: "postgres" as const, functions: new Set(["another"]) }]) {
      await expect(enqueueOwnedPostgresJob(f.tx, { ...input, selection })).rejects.toThrow("owned-job-routing-unavailable");
    }
    expect(f.query).not.toHaveBeenCalled();
  });
});
