import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadLeasePaths, pathHasLease } from "./worktree-janitor.mjs";

// BI-E5C1ED0A — the janitor crashed on every UNATTENDED run.
//
// loadLeasePaths() returned the raw response STRING on success but `new Set()`
// on each failure path. pathHasLease() guards only on falsiness, and an empty
// Set is truthy, so it fell through to Set.includes(...) — not a function —
// and took the whole run down. The failure paths (no bearer token, portal
// unreachable, curl missing) are exactly the scheduled/CI case, which is why
// this survived: an interactive run with a live token took the string path.
describe("worktree janitor lease payload", () => {
  it("returns a string, never a Set, when no bearer token is configured", () => {
    const saved = process.env.DPF_MCP_BEARER_TOKEN;
    delete process.env.DPF_MCP_BEARER_TOKEN;
    try {
      const payload = loadLeasePaths();
      assert.equal(typeof payload, "string", "unauthenticated lease lookup must yield a string");
      assert.ok(!(payload instanceof Set), "must not return a Set — pathHasLease calls .includes()");
    } finally {
      if (saved === undefined) delete process.env.DPF_MCP_BEARER_TOKEN;
      else process.env.DPF_MCP_BEARER_TOKEN = saved;
    }
  });

  it("does not throw when the lease lookup could not run", () => {
    const saved = process.env.DPF_MCP_BEARER_TOKEN;
    delete process.env.DPF_MCP_BEARER_TOKEN;
    try {
      assert.doesNotThrow(() => pathHasLease(loadLeasePaths(), "/Users/x/dpf-worktrees/thing"));
      assert.equal(pathHasLease(loadLeasePaths(), "/Users/x/dpf-worktrees/thing"), false);
    } finally {
      if (saved === undefined) delete process.env.DPF_MCP_BEARER_TOKEN;
      else process.env.DPF_MCP_BEARER_TOKEN = saved;
    }
  });

  it("still detects a leased path inside a raw payload", () => {
    const payload = JSON.stringify({ result: { leases: [{ path: "/Users/x/dpf-worktrees/leased" }] } });
    assert.equal(pathHasLease(payload, "/Users/x/dpf-worktrees/leased"), true);
    assert.equal(pathHasLease(payload, "/Users/x/dpf-worktrees/other"), false);
  });

  it("treats an empty payload as no lease rather than an error", () => {
    assert.equal(pathHasLease("", "/any/path"), false);
  });
});
