#!/usr/bin/env node
// Tests for the derived-artifact registry driver (BI-48768E05). All tests
// exercise the pure planning/decision functions with injected fakes — no
// git or subprocess calls, so they run instantly and deterministically.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  planRegenerate,
  evaluatePushExemption,
  evaluateCheckAll,
  resolveDerivedArtifactInvocation,
} from "./derived-artifacts-gate.mjs";

const DOC_INDEX = {
  id: "doc-index",
  sourceGlobs: ["docs/**/*.md"],
  artifactPaths: ["apps/web/lib/docs/doc-index.generated.json"],
  generate: ["node", "scripts/gen-doc-index.mjs"],
  check: ["node", "scripts/gen-doc-index.mjs", "--check"],
};

const DIAGRAMS = {
  id: "doc-diagrams",
  sourceGlobs: ["docs/user-guide/**/*.md"],
  artifactPaths: ["docs/user-guide/assets/diagrams/**"],
  generate: ["node", "scripts/render-doc-diagrams.mjs"],
  check: ["node", "scripts/render-doc-diagrams.mjs", "--check"],
  requiresBinary: "mmdc",
};

const SBOM = {
  id: "sbom-baseline",
  sourceGlobs: ["pnpm-lock.yaml"],
  artifactPaths: ["sbom/baseline.json"],
  generate: ["node", "scripts/sbom/check-sbom-drift.mjs", "--update-baseline"],
  check: ["node", "scripts/sbom/check-sbom-drift.mjs"],
  autoStage: false,
};

test("derived-artifact commands resolve pnpm through ComSpec on Windows", () => {
  assert.deepEqual(
    resolveDerivedArtifactInvocation(["pnpm", "--filter", "web", "run", "check:route-manifest"], {
      platform: "win32",
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    }),
    {
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "pnpm --filter web run check:route-manifest"],
    },
  );
});

// ── planRegenerate ───────────────────────────────────────────────────────────

test("planRegenerate is empty when nothing staged touches a registered source", () => {
  const plan = planRegenerate(["src/unrelated.ts"], [DOC_INDEX]);
  assert.deepEqual(plan, []);
});

test("planRegenerate regenerates when a source is staged and no special-casing applies", () => {
  const plan = planRegenerate(["docs/foo.md"], [DOC_INDEX]);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].entry.id, "doc-index");
  assert.equal(plan[0].action, "regenerate");
});

test("planRegenerate skips (without failing) when requiresBinary is unavailable", () => {
  const plan = planRegenerate(["docs/user-guide/foo.md"], [DIAGRAMS], () => false);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].action, "skip-missing-binary");
});

test("planRegenerate regenerates when requiresBinary IS available", () => {
  const plan = planRegenerate(["docs/user-guide/foo.md"], [DIAGRAMS], () => true);
  assert.equal(plan[0].action, "regenerate");
});

test("planRegenerate marks autoStage:false entries as advisory, never auto-regenerated", () => {
  const plan = planRegenerate(["pnpm-lock.yaml"], [SBOM]);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].action, "advisory");
});

test("planRegenerate handles multiple affected entries independently", () => {
  const plan = planRegenerate(["docs/foo.md", "pnpm-lock.yaml"], [DOC_INDEX, SBOM]);
  const byId = Object.fromEntries(plan.map((p) => [p.entry.id, p.action]));
  assert.equal(byId["doc-index"], "regenerate");
  assert.equal(byId["sbom-baseline"], "advisory");
});

// ── evaluatePushExemption ───────────────────────────────────────────────────

test("evaluatePushExemption: non-docs runtime change is never exempt", () => {
  const result = evaluatePushExemption(["apps/web/app/page.tsx"], [DOC_INDEX], () => true);
  assert.equal(result.exempt, false);
  assert.equal(result.reason, "non-docs runtime changes present");
});

test("evaluatePushExemption: docs-only diff touching no registered artifact is exempt", () => {
  const result = evaluatePushExemption(["README.md"], [DOC_INDEX], () => true);
  assert.equal(result.exempt, true);
});

test("evaluatePushExemption: docs diff touching a registered artifact is exempt IFF the check passes", () => {
  const fresh = evaluatePushExemption(["docs/foo.md"], [DOC_INDEX], () => true);
  assert.equal(fresh.exempt, true);

  const stale = evaluatePushExemption(["docs/foo.md"], [DOC_INDEX], () => false);
  assert.equal(stale.exempt, false);
  assert.deepEqual(stale.staleArtifacts, ["doc-index"]);
});

test("evaluatePushExemption: this is the exact #3284 regression scenario, now caught", () => {
  // #3284 added a docs page without regenerating doc-index.generated.json.
  // Under the OLD path-regex rule this was unconditionally exempt (docs-only
  // diff). The registry-driven rule requires the artifact's check to pass.
  const result = evaluatePushExemption(
    ["docs/marketing/dpf-market-vision.md"],
    [DOC_INDEX],
    () => false, // doc-index.generated.json was NOT regenerated — check fails
  );
  assert.equal(result.exempt, false);
});

test("evaluatePushExemption: a non-docs file change still gates even if a doc artifact is also touched", () => {
  const result = evaluatePushExemption(["docs/foo.md", "packages/db/schema.prisma"], [DOC_INDEX], () => true);
  assert.equal(result.exempt, false);
  assert.equal(result.reason, "non-docs runtime changes present");
});

// BI-AC48D79F: pre-commit auto-stages registered artifact JSON next to the
// docs source. Those outputs used to trip "non-docs runtime changes present"
// and made the freshness branch unreachable.
test("evaluatePushExemption: a docs diff plus its fresh registered artifact is exempt (BI-AC48D79F)", () => {
  const result = evaluatePushExemption(
    ["docs/foo.md", "apps/web/lib/docs/doc-index.generated.json"],
    [DOC_INDEX],
    () => true,
  );
  assert.equal(result.exempt, true);
  assert.match(result.reason, /fresh|docs diff/i);
});

test("evaluatePushExemption: a docs diff plus a STALE registered artifact is not exempt (BI-AC48D79F)", () => {
  const result = evaluatePushExemption(
    ["docs/foo.md", "apps/web/lib/docs/doc-index.generated.json"],
    [DOC_INDEX],
    () => false,
  );
  assert.equal(result.exempt, false);
  assert.deepEqual(result.staleArtifacts, ["doc-index"]);
});

// ── evaluateCheckAll ─────────────────────────────────────────────────────────

test("evaluateCheckAll reports every entry's check result", () => {
  const results = evaluateCheckAll([DOC_INDEX, SBOM], (entry) => entry.id === "doc-index");
  assert.deepEqual(
    results.map((r) => [r.entry.id, r.ok]),
    [
      ["doc-index", true],
      ["sbom-baseline", false],
    ],
  );
});
