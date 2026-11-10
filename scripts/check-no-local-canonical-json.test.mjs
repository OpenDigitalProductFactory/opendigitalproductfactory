// Tests for the local canonical-JSON ratchet (plan 2026-09-08 §10.5 S4).
// Run: node --test scripts/check-no-local-canonical-json.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  ALLOWLIST,
  CANONICAL,
  findCanonicalizers,
  findStaleAllowlist,
  isExcludedFile,
  maskSource,
  scanRepo,
} from "./check-no-local-canonical-json.mjs";

function withTree(files, fn) {
  const root = mkdtempSync(join(tmpdir(), "canonical-json-guard-"));
  try {
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), body);
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const kinds = (source) => findCanonicalizers(source).map((hit) => hit.kind);

test("flags a string-building walker (function declaration)", () => {
  const source = [
    "function stableJson(value: unknown): string {",
    "  if (Array.isArray(value)) return `[${value.map(stableJson).join(\",\")}]`;",
    "  if (value && typeof value === \"object\") {",
    "    const row = value as Record<string, unknown>;",
    "    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stableJson(row[key])}`).join(\",\")}}`;",
    "  }",
    "  return JSON.stringify(value);",
    "}",
  ].join("\n");
  assert.deepEqual(findCanonicalizers(source).map((hit) => [hit.line, hit.kind]), [[1, "recursive"]]);
});

test("flags a rebuilding walker whose result the file stringifies", () => {
  const source = [
    "function canonicalize(value: unknown): unknown {",
    "  if (Array.isArray(value)) return value.map(canonicalize);",
    "  if (!value || typeof value !== \"object\") return value;",
    "  return Object.fromEntries(",
    "    Object.entries(value as Record<string, unknown>)",
    "      .sort(([left], [right]) => left.localeCompare(right))",
    "      .map(([key, entry]) => [key, canonicalize(entry)]),",
    "  );",
    "}",
    "export const digest = (v: unknown) => hash(JSON.stringify(canonicalize(v)));",
  ].join("\n");
  assert.deepEqual(kinds(source), ["recursive"]);
});

test("flags a one-line const arrow walker in a script", () => {
  const source = "const stable = (v) => Array.isArray(v) ? v.map(stable) : v && typeof v === \"object\" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v;\n"
    + "const bytes = (v) => `${JSON.stringify(stable(v), null, 2)}\\n`;\n";
  assert.deepEqual(kinds(source), ["recursive"]);
});

test("flags a key sort after an intervening .filter()", () => {
  const source = [
    "export function canonicalJson(value) {",
    "  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(\",\")}]`;",
    "  const entries = Object.entries(value).filter(([, e]) => e !== undefined).sort(([a], [b]) => (a < b ? -1 : 1));",
    "  return `{${entries.map(([k, e]) => `${JSON.stringify(k)}:${canonicalJson(e)}`).join(\",\")}}`;",
    "}",
  ].join("\n");
  assert.deepEqual(kinds(source), ["recursive"]);
});

test("flags JSON.stringify with a key-sorting replacer (array or function)", () => {
  assert.deepEqual(kinds("const s = JSON.stringify(record, Object.keys(record).sort());"), ["replacer"]);
  const replacerFn = [
    "return JSON.stringify(value, (_key, val) => {",
    "  if (val && typeof val === \"object\" && !Array.isArray(val)) {",
    "    const sorted = {};",
    "    for (const k of Object.keys(val).sort()) sorted[k] = val[k];",
    "    return sorted;",
    "  }",
    "  return val;",
    "});",
  ].join("\n");
  assert.deepEqual(kinds(replacerFn), ["replacer"]);
});

test("does not flag a one-level sort for a report or a file on disk", () => {
  assert.deepEqual(kinds("const sorted = Object.fromEntries(Object.keys(counts).sort().map((k) => [k, counts[k]]));\nwrite(JSON.stringify(sorted, null, 2));"), []);
  assert.deepEqual(kinds("for (const name of Object.keys(contexts).sort()) console.log(JSON.stringify(name));"), []);
});

test("does not flag a recursive key sort that produces no JSON", () => {
  const markdown = [
    "function renderValue(value) {",
    "  if (Array.isArray(value)) return value.map(renderValue).join(\"\\n\");",
    "  return Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, c]) => `- ${k}: ${renderValue(c)}`).join(\"\\n\");",
    "}",
  ].join("\n");
  assert.deepEqual(kinds(markdown), []);
});

test("does not flag imports of the homes, or patterns in comments and strings", () => {
  assert.deepEqual(kinds('import { canonicalJson } from "@dpf/integration-shared/canonical-json";\nconst h = canonicalJson(x);'), []);
  assert.deepEqual(kinds("// function stable(v) { return JSON.stringify(Object.keys(v).sort().map(stable)); }"), []);
  assert.deepEqual(kinds('const help = "JSON.stringify(v, Object.keys(v).sort())";'), []);
  assert.deepEqual(kinds("const help = `JSON.stringify(v, Object.keys(v).sort())`;"), []);
});

test("maskSource keeps offsets and newlines, and template expressions stay code", () => {
  const source = 'const a = "x // y"; // note\nconst b = `t ${f(1)} u`; /* c */ const r = /["]/;\n';
  const masked = maskSource(source);
  assert.equal(masked.length, source.length);
  assert.equal(masked.split("\n").length, source.split("\n").length);
  assert.ok(masked.includes("f(1)"));
  assert.ok(!masked.includes("note"));
  assert.ok(!masked.includes("x // y"));
  assert.ok(masked.includes("const r"));
});

test("excludes tests, specs and declaration files", () => {
  assert.equal(isExcludedFile("a.test.ts"), true);
  assert.equal(isExcludedFile("a.spec.tsx"), true);
  assert.equal(isExcludedFile("a.test.mjs"), true);
  assert.equal(isExcludedFile("a.d.ts"), true);
  assert.equal(isExcludedFile("a.ts"), false);
  assert.equal(isExcludedFile("a.mjs"), false);
  assert.equal(isExcludedFile("README.md"), true);
});

test("scanRepo flags a new copy, skips the homes, tests and node_modules", () => {
  const copy = "export const h = (v) => JSON.stringify(v, Object.keys(v).sort());\n";
  withTree({
    "apps/web/lib/new-copy.ts": copy,
    "apps/web/lib/new-copy.test.ts": copy,
    "packages/x/node_modules/dep/index.js": copy,
    "packages/integration-shared/src/canonical-json.ts": copy,
    "scripts/lib/canonical-json.mjs": copy,
    "services/y/src/other.ts": copy,
  }, (root) => {
    const files = scanRepo(root).map((v) => v.file).sort();
    assert.deepEqual(files, ["apps/web/lib/new-copy.ts", "services/y/src/other.ts"]);
  });
});

test("the two homes are the integration-shared module and the scripts/lib module", () => {
  assert.deepEqual([...CANONICAL].sort(), [
    "packages/integration-shared/src/canonical-json.ts",
    "scripts/lib/canonical-json.mjs",
  ]);
});

test("every allowlist entry names its difference from the home", () => {
  for (const [file, reason] of ALLOWLIST) {
    assert.ok(reason.length >= 40, `${file}: reason too short`);
    assert.match(reason, /localeCompare|code-unit|replacer|top level|test support/, `${file}: reason must state the key-order difference`);
  }
});

test("repo: no canonicaliser outside the homes and the allowlist, and no stale entry", () => {
  assert.deepEqual(scanRepo(), []);
  assert.deepEqual(findStaleAllowlist(), []);
});
