// Self-test for the URL.pathname filesystem guard (BI-5CC4159D).
//
// Pure fixtures only: the guard's repository sweep is proven by running it in
// the source profile, and this file must not itself read the repository (that
// would make it a conformance assertion, BI-7B249AFE).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  findUrlPathnameUses,
  isAllowlisted,
  scanRepository,
  stripComments,
} from "./check-no-url-pathname-fs.mjs";

test("flags the raw form that failed every Windows gate", () => {
  // apps/web/lib/tools/integration-settings-href.test.ts as added by #5247.
  const src = `const INTEGRATIONS_DIR = new URL("../../app/(shell)/platform/tools/integrations/", import.meta.url).pathname;`;
  const findings = findUrlPathnameUses(src);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 1);
});

test("flags the hand-rolled drive-letter workaround too", () => {
  const src = `const repoRoot = new URL("..", import.meta.url).pathname.replace(/^\\/([A-Za-z]:)/, "$1");`;
  assert.equal(findUrlPathnameUses(src).length, 1);
});

test("stays silent on fileURLToPath, the fix", () => {
  const src = `
    import { fileURLToPath } from "node:url";
    const here = fileURLToPath(new URL("./x", import.meta.url));
    const dir = path.dirname(fileURLToPath(import.meta.url));
  `;
  assert.deepEqual(findUrlPathnameUses(src), []);
});

test("stays silent on an unrelated URL pathname", () => {
  // Parsing a request URL is not a filesystem path.
  const src = `const route = new URL(request.url).pathname;`;
  assert.deepEqual(findUrlPathnameUses(src), []);
});

test("ignores the string inside line and block comments", () => {
  const src = `
    // \`new URL("../.githooks/", import.meta.url).pathname\` is NOT a filesystem path
    /* On Windows new URL(import.meta.url).pathname is "/D:/..." and
       every path built from it is unopenable. */
    const ok = fileURLToPath(import.meta.url);
  `;
  assert.deepEqual(findUrlPathnameUses(src), []);
});

test("reports the real line number after comment stripping", () => {
  const src = [
    "/* header",
    "   comment */",
    "const a = 1;",
    `const b = new URL(".", import.meta.url).pathname;`,
  ].join("\n");
  assert.deepEqual(findUrlPathnameUses(src).map((f) => f.line), [4]);
});

test("does not treat // inside a string as a comment", () => {
  const src = `const url = "https://example.test"; const p = new URL(".", import.meta.url).pathname;`;
  assert.equal(findUrlPathnameUses(src).length, 1);
  assert.match(stripComments(src), /https:\/\/example\.test/);
});

test("allowlist matches with either path separator", () => {
  assert.ok(isAllowlisted("scripts/lib/hooks-dir.mjs"));
  assert.ok(isAllowlisted("scripts\\lib\\hooks-dir.mjs"));
  assert.ok(!isAllowlisted("scripts/lib/other.mjs"));
});

test("sweeps a tree, skips node_modules, honours the allowlist", () => {
  const root = mkdtempSync(join(tmpdir(), "url-pathname-guard-"));
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
  mkdirSync(join(root, "allowed"), { recursive: true });
  writeFileSync(join(root, "src", "bad.test.ts"), `const d = new URL(".", import.meta.url).pathname;\n`);
  writeFileSync(join(root, "src", "good.mjs"), `const d = fileURLToPath(import.meta.url);\n`);
  writeFileSync(join(root, "node_modules", "dep", "index.js"), `new URL(".", import.meta.url).pathname;\n`);
  writeFileSync(join(root, "allowed", "doc.mjs"), `// new URL(".", import.meta.url).pathname is a trap\nconst x = new URL(".", import.meta.url).pathname;\n`);
  writeFileSync(join(root, "README.md"), `new URL(".", import.meta.url).pathname\n`);

  const offenders = scanRepository(root, { allowlist: ["allowed/doc.mjs"] });
  assert.deepEqual(offenders.map((o) => o.file), ["src/bad.test.ts"]);
  assert.deepEqual(offenders[0].findings.map((f) => f.line), [1]);
});
