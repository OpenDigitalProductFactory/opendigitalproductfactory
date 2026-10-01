// Tests for the hand-rolled argv ratchet (plan 2026-09-08 §10.5 S2).
// Run: node --test scripts/check-no-hand-rolled-argv.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ALLOWLIST, findHandRolledArgv, findStaleAllowlist, scanRepo } from "./check-no-hand-rolled-argv.mjs";

const rules = (body) => findHandRolledArgv(body).map((hit) => hit.rule);

test("flags process.argv indexing, searching and iteration", () => {
  assert.deepEqual(rules("const target = process.argv[2];"), ["argv-index"]);
  assert.deepEqual(rules("const v = process.argv[i + 1];"), ["argv-index"]);
  assert.deepEqual(rules('const i = process.argv.indexOf("--base");'), ["argv-walk"]);
  assert.deepEqual(rules("for (const arg of process.argv) {}"), ["argv-loop"]);
  assert.deepEqual(rules("process.argv.slice(2).forEach((arg) => arg);"), ["argv-walk"]);
  assert.deepEqual(rules("const first = process.argv.slice(2)[0];"), ["argv-slice-index"]);
  // Split over lines, as a chained filter usually is.
  assert.deepEqual(rules('const s = process.argv\n  .filter((a) => a.startsWith("--sibling="));'), ["argv-walk"]);
});

test("flags flag lookups on a local argv copy", () => {
  assert.deepEqual(rules('const i = args.indexOf("--base");'), ["local-flag-lookup"]);
  assert.deepEqual(rules("if (arg === \"--out\") out = argv[++i];"), ["local-value-consume"]);
  assert.deepEqual(rules("const flag = args.shift();"), ["local-value-consume"]);
  // A property named argv is not a local copy.
  assert.deepEqual(rules('const i = options.argv.indexOf("--base");'), []);
});

test("flags a named parser only when the file does not use node:util parseArgs", () => {
  const loop = "function parseArgs(argv) {\n  const out = {};\n  return out;\n}\n";
  assert.deepEqual(rules(loop), ["hand-rolled-parser"]);
  assert.deepEqual(rules("export function parseHostResourceArgs(argv) {}"), ["hand-rolled-parser"]);
  assert.deepEqual(rules("function parseArguments(argv) {}"), ["hand-rolled-parser"]);
  assert.deepEqual(rules("export function parseCliArgs(args) {}"), ["hand-rolled-parser"]);
  const adapter = `import { parseArgs as utilParseArgs } from "node:util";\n${loop}`;
  assert.deepEqual(rules(adapter), []);
  assert.deepEqual(rules(`import { promisify, parseArgs } from "node:util";\n${loop}`), []);
});

test("ignores the entry-module check, whole-argv hand-offs, presence checks and comments", () => {
  assert.deepEqual(rules("if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {}"), []);
  assert.deepEqual(rules("main(process.argv.slice(2));"), []);
  assert.deepEqual(rules('const json = process.argv.includes("--json");'), []);
  assert.deepEqual(rules("const args = new Set(process.argv.slice(2));"), []);
  assert.deepEqual(rules("// const v = process.argv[2];"), []);
  assert.deepEqual(rules(' * const i = args.indexOf("--base");'), []);
  // Other arrays and other names are not argv.
  assert.deepEqual(rules('const i = composeArgs.indexOf("-f");'), []);
  assert.deepEqual(rules("const x = items[++i];"), []);
  assert.deepEqual(rules("function parsePackagePath(value) {}"), []);
});

test("scans only non-test scripts and reports stale allowlist entries", () => {
  const root = mkdtempSync(join(tmpdir(), "dpf-argv-guard-"));
  try {
    mkdirSync(join(root, "scripts", "lib"), { recursive: true });
    writeFileSync(join(root, "scripts", "bad.mjs"), "const v = process.argv[2];\n");
    writeFileSync(join(root, "scripts", "bad.test.mjs"), "const v = process.argv[2];\n");
    writeFileSync(join(root, "scripts", "lib", "good.mjs"), "main(process.argv.slice(2));\n");
    assert.deepEqual(scanRepo(root).map((v) => `${v.file}:${v.line}:${v.rule}`), ["scripts/bad.mjs:1:argv-index"]);
    // None of the real allowlisted files exist in the fixture, so all are stale.
    assert.deepEqual(findStaleAllowlist(root), [...ALLOWLIST.keys()]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repo: no hand-rolled argument parsing outside the allowlist; allowlist not stale", () => {
  assert.deepEqual(scanRepo(), []);
  assert.deepEqual(findStaleAllowlist(), []);
});
