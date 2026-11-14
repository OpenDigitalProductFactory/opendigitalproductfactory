/** Real child-process/PG lock lifetime evidence. This complements the actual
 * claim-writer PG tests; lab markers do not attest scope/receipt atomicity,
 * deployed Docker identity or loaded-writer immutability. */
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const slotUrl = process.env.DATABASE_URL ?? "";
const slot = (() => { try { return /^\/dpf_local_ci_[01]$/.test(new URL(slotUrl).pathname) ? slotUrl : ""; } catch { return ""; } })();
const url = process.env.DPF_JOBS_TEST_DATABASE_URL?.trim() || slot;
const schema = `dpf_scope_process_${randomUUID().replaceAll("-", "")}`;
const children = new Set<ChildProcess>();
const phase = (child: ChildProcess, stage: string) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => finish(new Error(`Child did not reach ${stage}`)), 15_000);
  const message = (value: unknown) => { if ((value as { stage?: string })?.stage === stage) finish(); };
  const exit = () => finish(new Error(`Child exited before ${stage}`));
  function finish(error?: Error) { clearTimeout(timer); child.off("message", message); child.off("exit", exit); child.off("error", finish); error ? reject(error) : resolve(); }
  child.on("message", message); child.once("exit", exit); child.once("error", finish);
});

describe.skipIf(!url)("scope admission locks across real process death", () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 3 });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query('CREATE TABLE "SelfUpgradeRun" (id TEXT, status TEXT); CREATE TABLE "RuntimeCapabilityTransition" (id TEXT, status TEXT, failure JSONB); CREATE TABLE "Effects" (id INT PRIMARY KEY)');
  });
  beforeEach(async () => { await pool.query('TRUNCATE "Effects"'); });
  afterAll(async () => {
    for (const child of children) { const ended = once(child, "exit"); child.kill("SIGKILL"); await ended; }
    if (pool) { try { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await pool.end(); } }
  });
  const start = () => {
    const child = fork(fileURLToPath(new URL("./scope-epoch-test-writer.ts", import.meta.url)), [], {
      execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"],
      env: { ...process.env, DPF_SCOPE_PROCESS_SCHEMA: schema,
        TSX_TSCONFIG_PATH: fileURLToPath(new URL("../../tsconfig.json", import.meta.url)) },
    });
    children.add(child); child.once("exit", () => children.delete(child));
    return child;
  };
  const locks = async (expected: boolean) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '5s'");
      for (const name of ["runtime-capability-transition", "self-upgrade-admission"]) {
        const result = await client.query(expected
          ? "SELECT pg_advisory_xact_lock(hashtext($1)), true AS acquired"
          : "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired", [name]);
        expect(result.rows[0].acquired).toBe(expected);
      }
    } finally { await client.query("ROLLBACK"); client.release(); }
  };
  for (const stage of ["locked", "written"]) it(`aborts and releases both locks when the child dies at ${stage}`, async () => {
    const child = start(); await phase(child, "locked");
    if (stage === "written") { const written = phase(child, "written"); child.send("write"); await written; }
    await locks(false);
    const ended = once(child, "exit"); child.kill("SIGKILL"); await ended;
    expect((await pool.query('SELECT count(*)::int AS count FROM "Effects"')).rows[0].count).toBe(0);
    await locks(true);
  });
  it("retains both locks through the real commit and publishes the marker once", async () => {
    const child = start(); await phase(child, "locked");
    const written = phase(child, "written"); child.send("write"); await written;
    await locks(false);
    expect((await pool.query('SELECT count(*)::int AS count FROM "Effects"')).rows[0].count).toBe(0);
    const committed = phase(child, "committed"), ended = once(child, "exit"); child.send("commit");
    await committed; await ended;
    expect((await pool.query('SELECT count(*)::int AS count FROM "Effects"')).rows[0].count).toBe(1);
    await locks(true);
  });
});
