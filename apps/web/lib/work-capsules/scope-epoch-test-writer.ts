/** Isolated process-lifetime laboratory, never a runtime admission endpoint.
 * Exercises the production admission locks with real PostgreSQL and process
 * death. Its effect row is a lab marker, not a scope claim or command receipt;
 * it does not qualify Docker, loaded production bytes or writer immutability. */
import { Pool } from "pg";
import { lockScopeEpochEnrollmentAdmission } from "./scope-epoch-enrollment.server";

const schema = process.env.DPF_SCOPE_PROCESS_SCHEMA ?? "";
const slotUrl = process.env.DATABASE_URL ?? "";
const slot = (() => { try { return /^\/dpf_local_ci_[01]$/.test(new URL(slotUrl).pathname) ? slotUrl : ""; } catch { return ""; } })();
const url = process.env.DPF_JOBS_TEST_DATABASE_URL?.trim() || slot;
if (!url || !/^dpf_scope_process_[a-f0-9]{32}$/.test(schema) || !process.send) {
  throw new Error("An isolated test database, schema and parent IPC channel are required");
}
async function main() {
const pool = new Pool({ connectionString: url, max: 1 });
const client = await pool.connect();
const next = () => new Promise<unknown>(resolve => process.once("message", resolve));
try {
  await client.query("BEGIN");
  await client.query(`SET LOCAL search_path TO "${schema}"`);
  await lockScopeEpochEnrollmentAdmission({
    $executeRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const text = parts.reduce((sql, part, index) => sql + (index ? `$${index}` : "") + part, "");
      await client.query(text, values);
    },
    selfUpgradeRun: { findFirst: async () => (await client.query("SELECT id FROM \"SelfUpgradeRun\" WHERE status IN ('pending','queued','running') LIMIT 1")).rows[0] ?? null },
    runtimeCapabilityTransition: { findFirst: async () => (await client.query("SELECT id FROM \"RuntimeCapabilityTransition\" WHERE status IN ('pending','applying','host_applied','compensating') OR (status='rollback_failed' AND failure->>'recoveryRequired'='true') LIMIT 1")).rows[0] ?? null },
  } as never);
  process.send!({ stage: "locked" });
  if (await next() !== "write") throw new Error("Unexpected lab command");
  await client.query('INSERT INTO "Effects" (id) VALUES (1)');
  process.send!({ stage: "written" });
  if (await next() !== "commit") throw new Error("Unexpected lab command");
  await client.query("COMMIT");
  process.send!({ stage: "committed" });
} finally {
  await client.query("ROLLBACK").catch(() => {});
  client.release();
  await pool.end();
  process.disconnect?.();
}
}
void main().catch(() => { process.exitCode = 1; if (process.connected) process.disconnect?.(); });
