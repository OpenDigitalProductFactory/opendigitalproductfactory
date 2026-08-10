import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkTestInventoryCoverage,
  collectInventoryTestPaths,
  evaluateTestInventoryCoverage,
  normalizeRepoPath,
  parseAllowlist,
} from "./ci-policy-test-inventory.mjs";

describe("ci-policy-test-inventory", () => {
  it("normalizeRepoPath collapses Windows separators", () => {
    assert.equal(
      normalizeRepoPath("scripts\\lib\\foo.test.mjs"),
      "scripts/lib/foo.test.mjs",
    );
  });

  it("parseAllowlist ignores comments and blanks", () => {
    const set = parseAllowlist(
      "# reason\n\nscripts/foo.test.mjs\n  scripts/bar.test.mjs  \n",
    );
    assert.deepEqual([...set].sort(), [
      "scripts/bar.test.mjs",
      "scripts/foo.test.mjs",
    ]);
  });

  it("collectInventoryTestPaths includes known hand-listed tests", () => {
    const inv = collectInventoryTestPaths();
    assert.ok(inv.has("scripts/ci-policy-guards.test.mjs"));
    assert.ok(inv.has("scripts/lib/pregate-console.test.mjs"));
    assert.ok(
      inv.has("packages/dpf-skill-pack/hooks/pregate-invocation-guard.test.mjs"),
    );
  });

  it("fails when a discovered test is neither inventory nor allowlist", () => {
    const result = evaluateTestInventoryCoverage({
      discovered: [
        "scripts/ci-policy-guards.test.mjs",
        "scripts/lib/__coverage-probe.test.mjs",
      ],
      inventory: new Set(["scripts/ci-policy-guards.test.mjs"]),
      allowlist: new Set(),
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, ["scripts/lib/__coverage-probe.test.mjs"]);
    assert.match(result.messages.join("\n"), /__coverage-probe\.test\.mjs/);
  });

  it("passes when the probe is listed in inventory", () => {
    const result = evaluateTestInventoryCoverage({
      discovered: [
        "scripts/ci-policy-guards.test.mjs",
        "scripts/lib/__coverage-probe.test.mjs",
      ],
      inventory: new Set([
        "scripts/ci-policy-guards.test.mjs",
        "scripts/lib/__coverage-probe.test.mjs",
      ]),
      allowlist: new Set(),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.missing, []);
  });

  it("passes when the probe is on the deliberate allowlist", () => {
    const result = evaluateTestInventoryCoverage({
      discovered: ["scripts/lib/__coverage-probe.test.mjs"],
      inventory: new Set(),
      allowlist: new Set(["scripts/lib/__coverage-probe.test.mjs"]),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.missing, []);
  });

  it("fails when allowlist still carries a path that is now inventory-listed", () => {
    const result = evaluateTestInventoryCoverage({
      discovered: ["scripts/lib/pregate-console.test.mjs"],
      inventory: new Set(["scripts/lib/pregate-console.test.mjs"]),
      allowlist: new Set(["scripts/lib/pregate-console.test.mjs"]),
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.staleAllowlist, [
      "scripts/lib/pregate-console.test.mjs",
    ]);
  });

  it("live tree satisfies inventory + allowlist (no silent holes)", () => {
    // Integration-style: if this fails, a new *.test.mjs landed without either
    // a node --test entry or an allowlist decision.
    const result = checkTestInventoryCoverage(process.cwd());
    assert.equal(
      result.ok,
      true,
      result.messages.join("\n") || "inventory coverage failed",
    );
  });
});
