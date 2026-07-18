// scripts/check-data-impact.test.mjs
// BI-DG-003: permanent red/green fixtures for the Data-Impact Gate (spec §6.9).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyChangedSurfaces,
  runGate,
  validateException,
  validateManifest,
} from "./check-data-impact.mjs";

const FIXTURES = new URL("../docs/testing/fixtures/data-impact/", import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8"));
const NOW = "2026-07-17T00:00:00Z";

// ── red manifests fail for their intended reason ──
test("unregistered model change fails for missing asset + lifecycle", () => {
  const errors = validateManifest(load("red-unregistered-model.data-impact.json"));
  assert.ok(errors.some((e) => /assetId/.test(e)));
  assert.ok(errors.some((e) => /lifecycleDisposition/.test(e)));
});

test("sensitive field without field policy fails", () => {
  const errors = validateManifest(load("red-sensitive-field-no-policy.data-impact.json"));
  assert.ok(errors.some((e) => /sensitive\/subject\/prohibited field needs a governed fieldPolicy/.test(e)));
});

test("uncontracted projection fails for missing contract/cleanup/reconciliation", () => {
  const errors = validateManifest(load("red-uncontracted-projection.data-impact.json"));
  assert.ok(errors.some((e) => /derivedContractId/.test(e)));
  assert.ok(errors.some((e) => /cleanup test/.test(e)));
  assert.ok(errors.some((e) => /reconciliation test/.test(e)));
});

test("new MDM domain without publish/lifecycle contract fails", () => {
  const errors = validateManifest(load("red-mdm-no-contract.data-impact.json"));
  assert.ok(errors.some((e) => /publish contract/.test(e)));
  assert.ok(errors.some((e) => /lifecycle contract/.test(e)));
});

test("destructive executor without a hold check fails", () => {
  const errors = validateManifest(load("red-destructive-no-hold.data-impact.json"));
  assert.ok(errors.some((e) => /must check legal holds/.test(e)));
});

// ── green fixtures pass ──
test("complete manifest passes with no errors", () => {
  assert.deepEqual(validateManifest(load("green-complete-manifest.data-impact.json")), []);
});

test("structured unexpired exception passes", () => {
  assert.deepEqual(
    validateException(load("green-exception.data-impact-exception.json"), { now: NOW }),
    [],
  );
});

// ── exception guardrails ──
test("expired exception is rejected", () => {
  const ex = { ...load("green-exception.data-impact-exception.json"), expiry: "2020-01-01" };
  assert.ok(validateException(ex, { now: NOW }).some((e) => /expiry must be in the future/.test(e)));
});

test("exception cannot permit prohibited storage or waive asset/lifecycle coverage", () => {
  const ex = { ...load("green-exception.data-impact-exception.json"), waives: ["prohibited-storage", "asset-coverage"] };
  const errors = validateException(ex, { now: NOW });
  assert.ok(errors.some((e) => /prohibited storage/.test(e)));
  assert.ok(errors.some((e) => /asset\/lifecycle coverage/.test(e)));
});

// ── surface classification + gate flow ──
test("classifies persistent surfaces by content, not just a registry file touch", () => {
  assert.deepEqual(classifyChangedSurfaces(["packages/db/prisma/schema.prisma"]), ["schema"]);
  assert.deepEqual(
    classifyChangedSurfaces(["packages/db/prisma/migrations/2026_x/migration.sql"]),
    ["migration"],
  );
  assert.deepEqual(classifyChangedSurfaces(["apps/web/lib/mdm/domain-registry.ts"]), ["mdm-domain"]);
  assert.deepEqual(classifyChangedSurfaces(["README.md", "apps/web/app/page.tsx"]), []);
});

test("gate demands a manifest when a persistent surface changes without one", () => {
  const result = runGate({ changed: ["packages/db/prisma/schema.prisma"] });
  assert.equal(result.ok, false);
  assert.match(result.message, /require a DataImpactManifest/);
});

test("gate passes when the changed surface carries a complete manifest", () => {
  const result = runGate({
    changed: ["packages/db/prisma/schema.prisma", "changes/widget.data-impact.json"],
    readFile: () => readFileSync(new URL("green-complete-manifest.data-impact.json", FIXTURES), "utf8"),
  });
  assert.equal(result.ok, true);
});

test("gate is a no-op when no persistent surface changed", () => {
  assert.equal(runGate({ changed: ["README.md"] }).ok, true);
});
