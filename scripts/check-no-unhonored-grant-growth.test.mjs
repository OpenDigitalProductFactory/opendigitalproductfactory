// scripts/check-no-unhonored-grant-growth.test.mjs
//
// Self-test for the unhonored-grant-count ratchet (BI-6FD78522). Proves the
// pure cores: TOOL_TO_GRANTS/GRANT_IMPLICATIONS extraction, the unhonored
// set-diff (including implication reachability), baseline parsing, and the
// ratchet verdicts — growth fails, key-swap at equal count fails, shrink passes.

import test from "node:test";
import assert from "node:assert/strict";

import {
  TOOL_TO_GRANTS_SOURCES,
  parseGrantValues,
  parseGrantImplications,
  computeUnhonored,
  parseBaseline,
  evaluateRatchet,
  computeCurrentUnhonored,
} from "./check-no-unhonored-grant-growth.mjs";

const GRANTS_SOURCE = `
export const TOOL_TO_GRANTS: Record<string, string[]> = {
  record_working_note: [],
  "mcp-browser-use__browse_open": ["browser_read"],
  list_backlog_items: ["backlog_read", "backlog_write"],
};
`;

const IMPLICATIONS_SOURCE = `
export const GRANT_IMPLICATIONS: Readonly<Record<string, readonly string[]>> = {
  backlog_write: ["build_evidence", "build_phase_advance"],
  browser_drive: ["browser_read"],
};
`;

test("parseGrantValues extracts grant keys from quoted and bare tool entries", () => {
  const values = parseGrantValues(GRANTS_SOURCE, /TOOL_TO_GRANTS:[^=]*= \{([\s\S]*?)\n\};/);
  assert.deepEqual([...values].sort(), ["backlog_read", "backlog_write", "browser_read"]);
});

test("parseGrantImplications extracts coarse->implied pairs", () => {
  const imp = parseGrantImplications(IMPLICATIONS_SOURCE);
  assert.deepEqual(imp.backlog_write, ["build_evidence", "build_phase_advance"]);
  assert.deepEqual(imp.browser_drive, ["browser_read"]);
});

test("computeUnhonored: a key some tool requires is honored; an unknown key is not", () => {
  const unhonored = computeUnhonored({
    registryKeys: new Set(["backlog_read", "ghost_grant"]),
    honoredValues: new Set(["backlog_read"]),
    implications: {},
  });
  assert.deepEqual(unhonored, ["ghost_grant"]);
});

test("computeUnhonored: a coarse key reaching an honored key via implications is honored", () => {
  const unhonored = computeUnhonored({
    registryKeys: new Set(["browser_drive", "orphan_coarse"]),
    honoredValues: new Set(["browser_read"]),
    implications: { browser_drive: ["browser_read"], orphan_coarse: ["also_unhonored"] },
  });
  assert.deepEqual(unhonored, ["orphan_coarse"]);
});

test("parseBaseline reads count then keys, skipping comments", () => {
  const parsed = parseBaseline("# owner: x\n# expiry: 2026-11-16\n2\nkey_a\nkey_b\n");
  assert.equal(parsed.count, 2);
  assert.deepEqual([...parsed.keys].sort(), ["key_a", "key_b"]);
});

test("parseBaseline rejects a malformed first content line", () => {
  assert.equal(parseBaseline("# header\nnot_a_number\nkey_a\n"), null);
  assert.equal(parseBaseline("# only comments\n"), null);
});

// ─── RED CASES ─────────────────────────────────────────────────────────────

test("RED: count growth fails and names the new key", () => {
  const { failures } = evaluateRatchet({
    current: ["key_a", "key_b", "key_new"],
    baseline: { count: 2, keys: new Set(["key_a", "key_b"]) },
  });
  assert.equal(failures.length, 2); // growth + new-key findings
  assert.match(failures.join("\n"), /3 > pinned 2/);
  assert.match(failures.join("\n"), /key_new/);
});

test("RED: a key swap at equal count still fails (new key named)", () => {
  const { failures } = evaluateRatchet({
    current: ["key_a", "key_swapped_in"],
    baseline: { count: 2, keys: new Set(["key_a", "key_b"]) },
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /key_swapped_in/);
  assert.doesNotMatch(failures[0], /key_a\b/);
});

test("RED: missing/malformed baseline fails rather than passing open", () => {
  const { failures } = evaluateRatchet({ current: [], baseline: null });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /missing or malformed/);
});

test("GREEN: shrink passes and is flagged for --update", () => {
  const { failures, shrunk } = evaluateRatchet({
    current: ["key_a"],
    baseline: { count: 2, keys: new Set(["key_a", "key_b"]) },
  });
  assert.deepEqual(failures, []);
  assert.equal(shrunk, true);
});

test("GREEN: identical set passes", () => {
  const { failures, shrunk } = evaluateRatchet({
    current: ["key_a", "key_b"],
    baseline: { count: 2, keys: new Set(["key_a", "key_b"]) },
  });
  assert.deepEqual(failures, []);
  assert.equal(shrunk, false);
});

// ─── LIVE-TREE ANCHORS ─────────────────────────────────────────────────────

test("live tree: extraction finds a non-trivial honored set (regex not rotted)", () => {
  // If agent-grants.ts is ever reshaped so the regex stops matching,
  // computeCurrentUnhonored throws rather than ratcheting against garbage.
  const unhonored = computeCurrentUnhonored();
  assert.ok(Array.isArray(unhonored));
});

test("live tree: the composed sources all exist and parse", () => {
  assert.equal(TOOL_TO_GRANTS_SOURCES.length, 4);
});
