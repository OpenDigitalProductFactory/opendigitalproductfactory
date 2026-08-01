// scripts/check-tool-surface.test.mjs
//
// Plane-4 guard contract. Two things matter most here:
//   1. the count is SELF-VALIDATING — it refuses to report a number it cannot trust,
//      because a guard built on a quietly wrong measurement is worse than no guard;
//   2. it never forbids growth — tools are capability. It forbids SILENT growth.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import {
  countCoreTierTools,
  countPackTools,
  evaluateToolSurface,
  measureToolSurface,
  readNumericConstant,
} from "./check-tool-surface.mjs";

const PACK = `
export const examplePack = {
  definitions: [
    {
      name: "record_effort_context",
      description: "…",
      inputSchema: { type: "object" },
    },
    {
      name: "read_effort_context",
      description: "…",
      inputSchema: { type: "object" },
    },
  ],
};`;

// ── measurement ──

test("counts one tool per definition", () => {
  const c = countPackTools(PACK);
  assert.equal(c.byName, 2);
  assert.equal(c.bySchema, 2);
  assert.equal(c.agrees, true);
});

// Why inputSchema is authoritative, learned the hard way: public-web-design-pack.ts
// carries three extra `name:` fields inside JSON-RPC params where its handlers CALL
// another MCP server. Counting names reported 350 repo-wide; the true total is 347.
test("a name field in handler code is seen but does not inflate the count", () => {
  const withOutboundCall =
    PACK +
    '\nasync function handler() {\n' +
    '  return fetch(url, { body: JSON.stringify({ method: "tools/call", params: {\n' +
    '          name: "browse_open",\n' +
    "  } }) });\n}";
  const c = countPackTools(withOutboundCall);
  assert.equal(c.tools, 2, "still two real definitions");
  assert.ok(c.byName > c.bySchema, "the stray name is seen");
  assert.equal(c.agrees, true, "more names than schemas is normal, not a broken shape");
});

test("MORE schemas than names is the one impossible direction, and is flagged", () => {
  const broken = PACK.replace('      name: "read_effort_context",\n', "");
  const c = countPackTools(broken);
  assert.equal(c.agrees, false, "shape changed — the count can no longer be trusted");
});

test("a disagreement is reported as a refusal to report a number", () => {
  const r = evaluateToolSurface({
    measured: {},
    baseline: {},
    baseBaseline: {},
    disagreements: ["sneaky-pack.ts: 3 inputSchema fields exceed 2 name fields"],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /refuses to report a number/.test(e)));
});

test("reads the core tier size and named numeric constants", () => {
  const tier = `export const CORE_MCP_TOOL_NAMES: ReadonlySet<string> = new Set([\n  "a",\n  "b",\n  "c",\n]);`;
  assert.equal(countCoreTierTools(tier), 3);
  assert.equal(readNumericConstant("export const MAX_COWORKER_ATTACHED_TOOLS = 48;", "MAX_COWORKER_ATTACHED_TOOLS"), 48);
  assert.equal(readNumericConstant("export const ACCURACY_CLIFF_PRONE_MAX_CONTEXT = 32_768;", "ACCURACY_CLIFF_PRONE_MAX_CONTEXT"), 32768);
  assert.equal(readNumericConstant("nothing here", "MISSING"), null);
});

test("aggregates packs into flat baseline keys", () => {
  const { measured } = measureToolSurface({
    packSources: { "a.ts": PACK, "b.ts": PACK },
    tierSource: `CORE_MCP_TOOL_NAMES = new Set([\n  "a",\n])`,
    budgetSource: "export const MAX_COWORKER_ATTACHED_TOOLS = 48;",
    metricsSource: "export const LOCAL_TOOL_SELECTION_CLIFF = 15;",
  });
  assert.equal(measured["registry.toolDefinitions"], 4);
  assert.equal(measured["registry.packFiles"], 2);
  assert.equal(measured["dispatch.maxAttachedTools"], 48);
});

// ── growth is allowed; silence is not ──

test("silent growth past the baseline fails, and says growth is allowed", () => {
  const r = evaluateToolSurface({
    measured: { "registry.toolDefinitions": 360 },
    baseline: { "registry.toolDefinitions": { value: 350 } },
    baseBaseline: { "registry.toolDefinitions": { value: 350 } },
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /grew 350 -> 360 without re-baselining/.test(e)));
  assert.ok(r.errors.some((e) => /Growth is allowed/.test(e)), "must not read as a prohibition");
});

test("a raised baseline with a substantive reason passes and is surfaced", () => {
  const r = evaluateToolSurface({
    measured: { "registry.toolDefinitions": 360 },
    baseline: {
      "registry.toolDefinitions": {
        value: 360,
        reason: "Ten warehousing tools; the existing inventory pack cannot express dock scheduling.",
      },
    },
    baseBaseline: { "registry.toolDefinitions": { value: 350 } },
  });
  assert.equal(r.ok, true, r.errors.join("; "));
  assert.ok(r.justified.some((j) => /350 -> 360/.test(j)));
});

test("a token reason is rejected as theater", () => {
  const r = evaluateToolSurface({
    measured: { "registry.toolDefinitions": 360 },
    baseline: { "registry.toolDefinitions": { value: 360, reason: "added a tool" } },
    baseBaseline: { "registry.toolDefinitions": { value: 350 } },
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /attestation theater/.test(e)));
});

test("shrink passes and is nudged to be locked in", () => {
  const r = evaluateToolSurface({
    measured: { "registry.toolDefinitions": 340 },
    baseline: { "registry.toolDefinitions": { value: 350 } },
    baseBaseline: { "registry.toolDefinitions": { value: 350 } },
  });
  assert.equal(r.ok, true);
  assert.ok(r.notes.some((n) => /keep the gain/.test(n)));
});

test("a missing base comparison never fails closed", () => {
  const r = evaluateToolSurface({
    measured: { "registry.toolDefinitions": 360 },
    baseline: { "registry.toolDefinitions": { value: 360 } },
    baseBaseline: null,
  });
  assert.equal(r.ok, true);
});

// ── the committed baseline matches the real tree ──

test("the shipped baseline is in sync with the live registry, and is non-trivial", () => {
  const root = new URL("../", import.meta.url);
  const packsDir = new URL("apps/web/lib/mcp/packs/", root);
  const packSources = {};
  for (const f of readdirSync(packsDir)) {
    if (!f.endsWith(".ts") || f.includes(".test.")) continue;
    packSources[f] = readFileSync(new URL(f, packsDir), "utf8");
  }

  const { measured, disagreements } = measureToolSurface({
    packSources,
    tierSource: readFileSync(new URL("apps/web/lib/mcp/tool-tier.ts", root), "utf8"),
    budgetSource: readFileSync(new URL("apps/web/lib/actions/coworker-tool-budget.ts", root), "utf8"),
    metricsSource: readFileSync(new URL("apps/web/lib/tak/context-economy-metrics.ts", root), "utf8"),
  });

  assert.deepEqual(disagreements, [], "every pack must match the ToolDefinition shape");

  const baseline = JSON.parse(
    readFileSync(new URL("scripts/tool-surface-baseline.json", root), "utf8"),
  ).entries;
  const r = evaluateToolSurface({ measured, baseline, baseBaseline: baseline });
  assert.equal(r.ok, true, r.errors.join("; "));

  // Guards against a vacuous pass: this repo has hundreds of tools across dozens of
  // packs, so a measurement in the single digits means the parse silently broke.
  assert.ok(measured["registry.toolDefinitions"] > 100, "expected a real registry count");
  assert.ok(measured["registry.packFiles"] > 20, "expected many packs");
});
