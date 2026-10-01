// Self-test for check-fixture-copied-script-imports.mjs.
//
// Proves the guard catches the two 2026-09-25 regressions in
// tests/release/pregate-node-gate-contract.test.mjs, does not fire on a fully
// copied closure, and passes against the live repo.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ALLOWLIST,
  findFixtureCopies,
  findMissingFixtureImports,
} from "./check-fixture-copied-script-imports.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(new URL(import.meta.url))), "..");
const FAKE_ROOT = "/repo";
const TEST_FILE = "tests/release/fixture.test.mjs";

// Keys go through path.resolve, as the guard's own paths do: on Windows
// path.join("/repo", rel) gives "\repo\..." while path.resolve gives
// "D:\repo\...", so a join-keyed map silently matched nothing there.
/** In-memory repo: map of repo-relative path -> source (directories are implied). */
function fakeIo(files) {
  const repoRoot = path.resolve(FAKE_ROOT);
  const abs = new Map(Object.entries(files).map(([rel, src]) => [path.resolve(repoRoot, rel), src]));
  return {
    repoRoot,
    readSource: (p) => abs.get(path.resolve(p)) ?? null,
    isDirectory: (p) => {
      const dir = path.resolve(p);
      return !abs.has(dir) && [...abs.keys()].some((k) => k.startsWith(dir + path.sep));
    },
  };
}

const header = [
  'import { cpSync, mkdtempSync } from "node:fs";',
  'import { join } from "node:path";',
  'const repoRoot = fileURLToPath(new URL("../..", import.meta.url));',
  'const temp = mkdtempSync("x");',
];
const copyLine = (rel) =>
  `cpSync(join(repoRoot, ${rel.split("/").map((s) => JSON.stringify(s)).join(", ")}), join(temp, ${rel
    .split("/")
    .map((s) => JSON.stringify(s))
    .join(", ")}));`;

const REPO = {
  "scripts/lib/gate-resume-pin.mjs": 'import { runGit } from "./git.mjs";\nimport fs from "node:fs";\nimport x from "yaml";\n',
  "scripts/lib/git.mjs": 'import { spawnSync } from "node:child_process";\n',
  "scripts/lib/sandbox-freshness.mjs": 'import {\n  parseImporters,\n  unquote,\n} from "./pnpm-lock.mjs";\n',
  "scripts/lib/pnpm-lock.mjs": "export const unquote = (s) => s;\n",
};

test("regression: gate-resume-pin.mjs copied without git.mjs is reported", () => {
  const source = [...header, copyLine("scripts/lib/gate-resume-pin.mjs")].join("\n");
  const violations = findMissingFixtureImports([{ file: TEST_FILE, source }], fakeIo(REPO), {});
  assert.deepEqual(violations, [
    {
      testFile: TEST_FILE,
      importer: "scripts/lib/gate-resume-pin.mjs",
      importerDest: "scripts/lib/gate-resume-pin.mjs",
      specifier: "./git.mjs",
      missing: "scripts/lib/git.mjs",
    },
  ]);
});

test("a multi-line import (sandbox-freshness.mjs -> pnpm-lock.mjs) is reported", () => {
  const source = [...header, copyLine("scripts/lib/sandbox-freshness.mjs")].join("\n");
  const violations = findMissingFixtureImports([{ file: TEST_FILE, source }], fakeIo(REPO), {});
  assert.deepEqual(
    violations.map((v) => v.missing),
    ["scripts/lib/pnpm-lock.mjs"],
  );
});

test("a fully copied closure passes; builtins and bare packages are ignored", () => {
  const source = [
    ...header,
    copyLine("scripts/lib/gate-resume-pin.mjs"),
    copyLine("scripts/lib/git.mjs"),
    // Multi-line call, as the real fixture writes its JSON copy.
    "cpSync(\n  join(repoRoot, \"scripts\", \"lib\", \"sandbox-freshness.mjs\"),\n  join(temp, \"scripts\", \"lib\", \"sandbox-freshness.mjs\"),\n);",
    copyLine("scripts/lib/pnpm-lock.mjs"),
  ].join("\n");
  assert.deepEqual(findMissingFixtureImports([{ file: TEST_FILE, source }], fakeIo(REPO), {}), []);
});

test("copies in one file form one set, across separate tests", () => {
  const source = [
    ...header,
    'test("a", () => {', copyLine("scripts/lib/gate-resume-pin.mjs"), "});",
    'test("b", () => {', copyLine("scripts/lib/git.mjs"), "});",
  ].join("\n");
  assert.deepEqual(findMissingFixtureImports([{ file: TEST_FILE, source }], fakeIo(REPO), {}), []);
});

test("a named source binding and a literal-array loop are both recognised", () => {
  const source = [
    ...header,
    'const pinScript = join(repoRoot, "scripts", "lib", "gate-resume-pin.mjs");',
    'cpSync(pinScript, join(temp, "scripts", "lib", "gate-resume-pin.mjs"));',
    'const LIB = fileURLToPath(new URL("../../scripts/lib", import.meta.url));',
    'for (const f of ["sandbox-freshness.mjs", "pnpm-lock.mjs"]) {',
    '  copyFileSync(join(LIB, f), join(temp, "scripts", "lib", f));',
    "}",
  ].join("\n");
  const copies = findFixtureCopies(source, path.join(FAKE_ROOT, TEST_FILE));
  assert.deepEqual(
    copies.map((c) => c.dest),
    ["scripts/lib/gate-resume-pin.mjs", "scripts/lib/sandbox-freshness.mjs", "scripts/lib/pnpm-lock.mjs"],
  );
  assert.deepEqual(
    findMissingFixtureImports([{ file: TEST_FILE, source }], fakeIo(REPO), {}).map((v) => v.missing),
    ["scripts/lib/git.mjs"],
  );
});

test("a copied directory covers the modules beneath it", () => {
  const source = [
    ...header,
    copyLine("scripts/lib/gate-resume-pin.mjs"),
    'cpSync(join(repoRoot, "scripts", "lib"), join(temp, "scripts", "lib"), { recursive: true });',
  ].join("\n");
  assert.deepEqual(findMissingFixtureImports([{ file: TEST_FILE, source }], fakeIo(REPO), {}), []);
});

test("an allowlisted omission is not reported", () => {
  const source = [...header, copyLine("scripts/lib/gate-resume-pin.mjs")].join("\n");
  const allow = { [`${TEST_FILE}|scripts/lib/gate-resume-pin.mjs|./git.mjs`]: "test proves the missing-module path" };
  assert.deepEqual(findMissingFixtureImports([{ file: TEST_FILE, source }], fakeIo(REPO), allow), []);
});

test("the allowlist stays closed and justified", () => {
  for (const [key, reason] of Object.entries(ALLOWLIST)) {
    assert.match(key, /^[^|]+\.test\.mjs\|[^|]+\|\.\.?\//, `malformed allowlist key ${key}`);
    assert.ok(reason.trim().length >= 20, `allowlist entry ${key} needs a real reason`);
  }
});

// Conformance: reads the live repo, so it is registered with conformanceTest().
test("the checked-in fixtures copy every module their copies statically import", () => {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", "check-fixture-copied-script-imports.mjs")], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[fixture-script-imports\] OK/);
});
