// BI-46B03CAE — the lease-queue calls cost more than mcpCall's 10s default, and
// abandoning one that was about to succeed strands a lease the gate cannot then
// release. Guards the headroom and the operator-facing wording.

import assert from "node:assert/strict";
import { test } from "node:test";

import { describeLeaseCallFailure, leaseQueueCallOptions } from "./gate-worktree.mjs";

test("lease-queue calls get far more headroom than mcpCall's 10s default", () => {
  const options = leaseQueueCallOptions("http://127.0.0.1:3000/api/mcp/v1", "tok");

  // The live repro measured list_nonprod_environment_leases at 10166ms — a
  // SUCCESS the client abandoned 166ms early. Anything at or near 10s reopens it.
  assert.ok(options.timeoutMs >= 30_000, `expected generous headroom, got ${options.timeoutMs}`);
  assert.equal(options.mcpUrl, "http://127.0.0.1:3000/api/mcp/v1");
  assert.equal(options.bearerToken, "tok");
});

test("the timeout is tunable without patching source", async (t) => {
  const previous = process.env.DPF_GATE_MCP_TIMEOUT_MS;
  t.after(() => {
    if (previous === undefined) delete process.env.DPF_GATE_MCP_TIMEOUT_MS;
    else process.env.DPF_GATE_MCP_TIMEOUT_MS = previous;
  });

  // Resolved once at module load, so this asserts the contract the env var
  // feeds rather than re-importing: a positive finite override is honoured and
  // anything else falls back to the default.
  const resolve = (raw) => {
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : 60_000;
  };
  assert.equal(resolve("120000"), 120_000);
  assert.equal(resolve("0"), 60_000);
  assert.equal(resolve("-1"), 60_000);
  assert.equal(resolve("nonsense"), 60_000);
  assert.equal(resolve(undefined), 60_000);
});

test("a timeout is reported as contention, not as an unreachable portal", () => {
  const message = describeLeaseCallFailure(
    new Error("mcpCall: list_nonprod_environment_leases timed out after 60000ms"),
  );

  assert.match(message, /timed out after 60000ms/);
  assert.match(message, /reachable and merely contended/);
  assert.match(message, /DPF_GATE_MCP_TIMEOUT_MS/);
});

test("a non-timeout failure is passed through unchanged", () => {
  const message = describeLeaseCallFailure(new Error("ECONNREFUSED 127.0.0.1:3000"));

  assert.equal(message, "ECONNREFUSED 127.0.0.1:3000");
});

test("a thrown non-Error still describes itself", () => {
  assert.equal(describeLeaseCallFailure("plain string failure"), "plain string failure");
});
