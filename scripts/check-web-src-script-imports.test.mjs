// Self-test for check-web-src-script-imports.mjs (BI-PIR-53d2c42d).
//
// Proves the guard catches the measured regression (a top-level prom-client
// import in lib/operate/metrics reached from the boot-time wiki re-embed and the
// approval probe), honours a guarded optional require only where it is listed,
// derives its entries from the invoking files, and passes on the checked-in tree.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  KNOWN_VIOLATIONS,
  MIN_ENTRY_SCRIPTS,
  MIN_MODULES_WALKED,
  classifyViolations,
  deriveEntryScripts,
  findUnresolvableImports,
  packageNameOf,
  runtimeDependencySet,
  runtimeImports,
  scriptsInvokedBy,
} from "./check-web-src-script-imports.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(new URL(import.meta.url))), "..");
const METRICS = "apps/web/lib/operate/metrics.ts";
const realRead = (rel) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

test("derives web-src script entries from invoker text, skipping @dpf/db scripts", () => {
  const text = [
    "pnpm --filter @dpf/db exec tsx scripts/sync-provider-registry.ts",
    "if ! pnpm --filter web exec tsx scripts/reembed-wiki-store.ts; then",
    'for t in /app/node_modules/.bin/tsx; do exec "$t" scripts/issue-mcp-token.ts "$@"; done',
    "pnpm --filter web exec tsx apps/web/scripts/issue-edge-bootstrap-token.ts",
  ].join("\n");
  assert.deepEqual(scriptsInvokedBy(text).sort(), [
    "apps/web/scripts/issue-edge-bootstrap-token.ts",
    "apps/web/scripts/issue-mcp-token.ts",
    "apps/web/scripts/reembed-wiki-store.ts",
  ]);
});

test("the checked-in invokers yield the scripts the image runs from web-src", () => {
  const entries = deriveEntryScripts(REPO_ROOT);
  for (const required of [
    "apps/web/scripts/reembed-wiki-store.ts",
    "apps/web/scripts/approval-convergence-probe.ts",
    "apps/web/scripts/issue-mcp-token.ts",
  ]) {
    assert.ok(entries.includes(required), `${required} missing from ${entries.join(", ")}`);
  }
  assert.ok(entries.length >= MIN_ENTRY_SCRIPTS);
});

test("runtime imports skip type-only imports and comments, keep dynamic and require", () => {
  const src = [
    'import type { A } from "type-only-pkg";',
    'import { type B, type C } from "all-type-pkg";',
    'import { type D, e } from "mixed-pkg";',
    'export { f } from "./reexport";',
    'import "side-effect";',
    '// import x from "commented-out";',
    'const m = await import("lazy-pkg");',
    'const p = require("required-pkg");',
  ].join("\n");
  assert.deepEqual(
    runtimeImports(src).map((i) => `${i.kind}:${i.specifier}`).sort(),
    ["dynamic:lazy-pkg", "require:required-pkg", "static:./reexport", "static:mixed-pkg", "static:side-effect"],
  );
  assert.equal(packageNameOf("@scope/name/sub"), "@scope/name");
  assert.equal(packageNameOf("pkg/sub/path"), "pkg");
});

test("web-src resolves only the root importer's direct deps; @dpf/db's deps stay private", () => {
  const { projects, packages } = runtimeDependencySet(REPO_ROOT);
  assert.ok(projects.has("@dpf/db"));
  assert.ok(projects.has("@dpf/validators"));
  assert.ok(packages.has("tsx"));
  // Installed for packages/db only, under the isolated layout: invisible to web-src.
  assert.ok(!packages.has("pg"));
  assert.ok(!packages.has("zod"));
  assert.ok(!packages.has("prom-client"));
  assert.ok(!packages.has("next"));
});

test("catches the measured regression: a top-level prom-client import in lib/operate/metrics", () => {
  const readSource = (rel) =>
    rel === METRICS ? 'import { Registry } from "prom-client";\nexport const r = new Registry();\n' : realRead(rel);
  const { violations } = findUnresolvableImports({ root: REPO_ROOT, readSource });
  const { fresh } = classifyViolations(violations);
  const hits = fresh.filter((v) => v.file === METRICS && v.specifier === "prom-client");
  assert.equal(hits.length, 1, JSON.stringify(fresh, null, 2));
  assert.equal(hits[0].chain.at(-1), METRICS);
  assert.ok(hits[0].chain[0].startsWith("apps/web/scripts/"));
});

test("a guarded optional require passes only in the file that is listed for it", () => {
  const listed = findUnresolvableImports({ root: REPO_ROOT });
  assert.ok(!listed.violations.some((v) => v.specifier === "prom-client"));

  const readSource = (rel) =>
    rel === "apps/web/scripts/issue-mcp-token.ts"
      ? `${realRead(rel)}\nconst pc = require("prom-client");\n`
      : realRead(rel);
  const unlisted = findUnresolvableImports({ root: REPO_ROOT, readSource });
  assert.ok(
    unlisted.violations.some(
      (v) => v.file === "apps/web/scripts/issue-mcp-token.ts" && v.specifier === "prom-client" && v.kind === "require",
    ),
  );
});

test("the ratchet fails on stale KNOWN_VIOLATIONS entries", () => {
  const { stale, fresh } = classifyViolations([], { "a.ts -> gone": "fixed" });
  assert.deepEqual(stale, ["a.ts -> gone"]);
  assert.deepEqual(fresh, []);
});

test("passes on the checked-in tree with no new or stale violations", () => {
  const { entries, modulesWalked, violations } = findUnresolvableImports({ root: REPO_ROOT });
  const { fresh, stale } = classifyViolations(violations);
  assert.ok(entries.length >= MIN_ENTRY_SCRIPTS);
  assert.ok(modulesWalked >= MIN_MODULES_WALKED, `walked ${modulesWalked}`);
  assert.deepEqual(fresh, []);
  assert.deepEqual(stale, []);
  assert.ok(Object.keys(KNOWN_VIOLATIONS).length > 0);
});
