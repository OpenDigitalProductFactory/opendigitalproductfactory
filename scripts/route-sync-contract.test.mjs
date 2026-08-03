// scripts/route-sync-contract.test.mjs — BI-206DAB95
// Ensures the single contributor command for route-derived artifacts stays wired.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

test("pnpm route:sync regenerates all four route companions", () => {
  const script = pkg.scripts?.["route:sync"];
  assert.ok(script, "package.json must define scripts.route:sync");
  assert.match(script, /build:route-manifest/);
  assert.match(script, /build:route-shells/);
  assert.match(script, /build:route-audience/);
  assert.match(script, /gen-doc-index/);
});

test("contributor runbook documents route:sync and base-drift trap", () => {
  const doc = readFileSync(
    "docs/architecture/contributor-procedure-runbook.md",
    "utf8",
  );
  assert.match(doc, /pnpm route:sync/);
  assert.match(doc, /BI-206DAB95/);
  assert.match(doc, /Base-drift trap/i);
});
