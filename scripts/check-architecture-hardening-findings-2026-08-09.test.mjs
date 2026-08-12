/**
 * Structural verification for the 2026-08-09 portal architecture hardening
 * findings document (analysis-only deliverable). Asserts the shipped markdown
 * artifact has the required sections and that three material code claims in the
 * findings still match primary source.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const findingsPath = join(
  root,
  "docs/architecture/2026-08-09-portal-architecture-hardening-findings.md",
);

const REQUIRED_HEADINGS = [
  "## 1. Purpose",
  "## 2. Method",
  "## 3. Evidence base & prior-review lineage",
  "## 5. Quality-dimension findings",
  "### 5.1 Stability",
  "### 5.2 Scalability",
  "### 5.3 Reliability",
  "### 5.4 Upgradeability",
  "### 5.5 Supportability",
  "## 6. Best-in-class comparison",
  "## 7. Architectural drift inventory",
  "## 8. Prioritized hardening recommendations",
  "## 9. Assumed / limits",
  "## 10. Spot-check claims",
];

test("findings document exists and is analysis-only", async () => {
  const body = await readFile(findingsPath, "utf8");
  assert.match(body, /analysis-only/i);
  assert.match(body, /Non-implementation/i);
  assert.match(body, /does \*\*not\*\* change production behavior/i);
  assert.doesNotMatch(body, /IMPLEMENTED IN THIS PR/i);
});

test("findings document covers required architecture-review sections", async () => {
  const body = await readFile(findingsPath, "utf8");
  for (const heading of REQUIRED_HEADINGS) {
    assert.ok(body.includes(heading), `missing required heading: ${heading}`);
  }
  // Required quality concerns from the objective
  for (const word of [
    "stability",
    "scalability",
    "reliability",
    "upgradeability",
    "supportability",
  ]) {
    assert.match(body, new RegExp(word, "i"), `missing quality concern: ${word}`);
  }
  // Best-in-class lenses already used in prior DPF reviews
  assert.match(body, /ISO\/IEC 25010/);
  assert.match(body, /Twelve-Factor|12factor/i);
  // Prior lineage
  assert.match(body, /2026-06-22-platform-adequacy-architecture-review/);
  assert.match(body, /2026-07-27-platform-adequacy-roadmap-backlog-map/);
  // Prefer mapping to existing owners
  assert.match(body, /EP-413F2602/);
  assert.match(body, /BI-C1C706F1/);
  assert.match(body, /BI-903F5A94/);
});

test("spot-check: archetype readiness claim helper exists in source", async () => {
  const readiness = await readFile(
    join(root, "packages/storefront-templates/src/archetype-readiness.ts"),
    "utf8",
  );
  assert.match(readiness, /export const ARCHETYPE_READINESS_TIERS/);
  assert.match(readiness, /export function evaluateArchetypeReadinessClaim/);
  assert.match(readiness, /sole-platform-ready/);

  const findings = await readFile(findingsPath, "utf8");
  assert.match(findings, /archetype-readiness\.ts/);
  assert.match(findings, /evaluateArchetypeReadinessClaim/);
});

test("spot-check: federation demand-response still documents silent take 1000 cliff", async () => {
  const demand = await readFile(
    join(root, "apps/web/lib/federation/demand-response.ts"),
    "utf8",
  );
  assert.match(demand, /take:\s*1_000/);

  const findings = await readFile(findingsPath, "utf8");
  assert.match(findings, /demand-response\.ts/);
  assert.match(findings, /1_000|1000/);
});

test("spot-check: OTel export remains feature-flagged (observability posture)", async () => {
  const otel = await readFile(
    join(root, "apps/web/lib/gear-interface/otel-exporter.ts"),
    "utf8",
  );
  assert.match(otel, /DPF_GEAR_OTEL_EXPORT/);
  assert.match(otel, /isOtelExportEnabled/);

  const findings = await readFile(findingsPath, "utf8");
  assert.match(findings, /DPF_GEAR_OTEL_EXPORT/);
});

test("spot-check: application-boundary debt baseline is cited with exceptions", async () => {
  const registryRaw = await readFile(
    join(root, "scripts/application-boundaries.json"),
    "utf8",
  );
  const registry = JSON.parse(registryRaw);
  assert.ok(Array.isArray(registry.exceptions));
  assert.ok(
    registry.exceptions.length >= 1,
    "expected accepted reverse-import exceptions in registry",
  );

  const findings = await readFile(findingsPath, "utf8");
  assert.match(findings, /application-boundaries/);
  assert.match(findings, new RegExp(String(registry.exceptions.length)));
});
