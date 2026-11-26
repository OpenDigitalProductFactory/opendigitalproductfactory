import { describe, expect, it, vi } from "vitest";

const tuple = {
  systemIdentifier: "7391584902012345678",
  databaseOid: "16384",
  databaseName: "dpf",
  postmasterStartEpoch: "1795679812.123456",
};
const proof = {
  schemaVersion: 1, leaseId: "NPEL-fixture", runtimeId: "fixture-runtime", sourceSha: "a".repeat(40),
  containerId: "fixture-container", volumeName: "fixture_dev_pgdata",
  productionSystemIdentifier: "7391584902012340000", database: tuple,
};
const binding = { leaseId: proof.leaseId, runtimeId: proof.runtimeId, sourceSha: proof.sourceSha };

type FixtureTransaction = { $queryRawUnsafe: (sql: string) => Promise<unknown> };
type PublicationSnapshot = { status: string; progressPayload: Record<string, unknown> };
type ProofModule = {
  publishPreviewDatabaseAttestation: (input: {
    proof: typeof proof;
    binding: typeof binding;
    read: () => Promise<PublicationSnapshot>;
    compareAndSet: (snapshot: PublicationSnapshot, payload: Record<string, unknown>) => Promise<boolean>;
  }) => Promise<boolean>;
  matchesPreviewDatabase: (input: {
    tx: FixtureTransaction; proof: typeof proof | null; binding: typeof binding;
  }) => Promise<boolean>;
  authorizePreviewSetup: () => boolean;
};

async function reader(): Promise<ProofModule> {
  const candidates = import.meta.glob("./preview-db-attestation.ts");
  const load = candidates["./preview-db-attestation.ts"];
  expect(load, "lease-owner database attestation module is not implemented").toBeTypeOf("function");
  if (!load) throw new Error("missing preview database attestation module");
  return await load() as ProofModule;
}

describe("preview database proof", () => {
  const wrongCluster = { ...tuple, systemIdentifier: "7391584902012345679" };
  const liveOverride = { ...tuple, systemIdentifier: proof.productionSystemIdentifier };
  it.each([
    ["same name and OID on another cluster or recreated volume", wrongCluster],
    ["another database on the same cluster", { ...tuple, databaseOid: "16385" }],
    ["postmaster restart", { ...tuple, postmasterStartEpoch: "1795679813.123456" }],
    ["the production cluster via the live DB override", liveOverride],
  ] as const)("refuses a write on %s", async (_name, actual) => {
    const { matchesPreviewDatabase } = await reader();
    const tx = { $queryRawUnsafe: vi.fn(async () => [actual]) };
    const write = vi.fn();
    if (await matchesPreviewDatabase({ tx, proof, binding })) write();
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses an owner proof that names the production cluster even if the transaction matches it", async () => {
    const { matchesPreviewDatabase } = await reader();
    const tx = { $queryRawUnsafe: vi.fn(async () => [tuple]) };
    expect(await matchesPreviewDatabase({
      tx, binding, proof: { ...proof, productionSystemIdentifier: tuple.systemIdentifier },
    })).toBe(false);
  });

  it("holds on an unreadable catalog proof", async () => {
    const { matchesPreviewDatabase } = await reader();
    const tx = { $queryRawUnsafe: vi.fn(async () => { throw new Error("permission denied"); }) };
    expect(await matchesPreviewDatabase({ tx, binding, proof })).toBe(false);
  });

  it("refuses missing proof and a replaced runtime before probing the transaction", async () => {
    const { matchesPreviewDatabase } = await reader();
    const tx = { $queryRawUnsafe: vi.fn(async () => [tuple]) };
    expect(await matchesPreviewDatabase({ tx, binding, proof: null })).toBe(false);
    expect(await matchesPreviewDatabase({ tx, binding: { ...binding, runtimeId: "replacement" }, proof })).toBe(false);
    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("refuses the root pooled client without issuing a query", async () => {
    const { matchesPreviewDatabase } = await reader();
    const pooled = { $queryRawUnsafe: vi.fn(async () => [tuple]), $transaction: vi.fn() };
    expect(await matchesPreviewDatabase({ tx: pooled, binding, proof })).toBe(false);
    expect(pooled.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("qualifies catalog functions and preserves the pinned epoch representation", async () => {
    const { matchesPreviewDatabase } = await reader();
    const tx = { $queryRawUnsafe: vi.fn(async (_sql: string) => [tuple]) };
    expect(await matchesPreviewDatabase({ tx, binding, proof })).toBe(true);
    const sql = tx.$queryRawUnsafe.mock.calls[0]?.[0];
    expect(sql).toContain("pg_catalog.pg_control_system()");
    expect(sql).toContain("pg_catalog.current_database()");
    expect(sql).toContain("extract(epoch from pg_catalog.pg_postmaster_start_time())::numeric::text");
  });

  it.each([
    ["checkpoint", "submitted", "waiting"],
    ["non-expiry settle", "completed", "terminal"],
  ])("rechecks publication after a %s wins the payload CAS", async (_writer, status, state) => {
    const { publishPreviewDatabaseAttestation } = await reader();
    const snapshot = { status: "completed", progressPayload: { nonprodLeaseWait: { state: "admitted" } } };
    const latest = { status, progressPayload: { nonprodLeaseWait: { state } } };
    const read = vi.fn().mockResolvedValueOnce(snapshot).mockResolvedValue(latest);
    const compareAndSet = vi.fn().mockResolvedValue(false);
    expect(await publishPreviewDatabaseAttestation({ proof, binding, read, compareAndSet })).toBe(false);
    expect(compareAndSet).toHaveBeenCalledExactlyOnceWith(snapshot, expect.objectContaining({
      nonprodPreviewDatabaseAttestation: proof,
    }));
    expect(read).toHaveBeenCalledTimes(2);
    expect(latest.progressPayload).not.toHaveProperty("nonprodPreviewDatabaseAttestation");
  });

  it("does not authorize setup without the follow-on verified installation join", async () => {
    const { authorizePreviewSetup } = await reader();
    expect(authorizePreviewSetup()).toBe(false);
  });
});

// Explicit fixture only. Never fall back to the portal DATABASE_URL.
const disposableUrl = process.env.DPF_PREVIEW_ATTESTATION_TEST_DATABASE_URL;
it.skipIf(!disposableUrl)("compares identity and writes on the same disposable backend and transaction", async () => {
  const url = new URL(disposableUrl!);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.port
    || !/^\/dpf_preview_attestation_[a-f0-9]{12,32}$/.test(url.pathname)) {
    throw new Error("Expected a loopback throwaway preview-attestation PostgreSQL database");
  }
  const { Client } = await import("pg");
  const client = new Client({ connectionString: url.href });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("CREATE TEMP TABLE preview_attestation_write (v integer) ON COMMIT DROP");
    const actual = (await client.query<typeof tuple>(`
      SELECT system_identifier::text AS "systemIdentifier", d.oid::text AS "databaseOid",
             d.datname::text AS "databaseName",
             extract(epoch from pg_catalog.pg_postmaster_start_time())::numeric::text AS "postmasterStartEpoch"
      FROM pg_catalog.pg_control_system() CROSS JOIN pg_catalog.pg_database AS d
      WHERE d.datname = pg_catalog.current_database()
    `)).rows[0]!;
    const witnessSql = 'pg_catalog.pg_backend_pid() AS pid, pg_catalog.txid_current()::text AS txid';
    let guardWitness: { pid: number; txid: string } | undefined;
    const tx = { $queryRawUnsafe: async (sql: string) => {
      const result = await client.query<typeof tuple & { pid: number; txid: string }>(
        `SELECT attested.*, ${witnessSql} FROM (${sql.trim().replace(/;$/, "")}) AS attested`,
      );
      const row = result.rows[0];
      if (row) guardWitness = { pid: row.pid, txid: row.txid };
      return result.rows;
    } };
    const { matchesPreviewDatabase } = await reader();
    expect(await matchesPreviewDatabase({ tx, proof: { ...proof, database: actual }, binding })).toBe(true);
    const write = await client.query(`INSERT INTO preview_attestation_write VALUES (1) RETURNING ${witnessSql}`);
    expect(guardWitness).toBeDefined();
    expect(write.rows[0]).toEqual(guardWitness);
  } finally {
    try { await client.query("ROLLBACK"); } finally { await client.end(); }
  }
});

it("refuses an older observation approved after a newer proof, preserving exact decimal order", async () => {
  const { previewProofChange } = await import("./preview-db-attestation");
  const older = { ...proof, database: { ...proof.database, postmasterStartEpoch: "1795679812.123455" } };
  const equalButDifferent = { ...proof, containerId: "new-container" };
  expect(previewProofChange(proof, older)).toBe("stale");
  expect(previewProofChange(proof, equalButDifferent)).toBe("stale");
  expect(previewProofChange(older, proof)).toBe("replace");
  expect(previewProofChange(proof, proof)).toBe("unchanged");
});
