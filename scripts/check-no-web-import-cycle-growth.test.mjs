// Self-test for the web import-cycle ratchet (dependency-diet plan M11 step 2).
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildImportGraph,
  isProductionSource,
  largestCycle,
  resolveSpecifier,
  runCheck,
  validateBaseline,
} from "./check-no-web-import-cycle-growth.mjs";

// Minimal stand-in for ts.preProcessFile: every quoted specifier after `from`
// or inside `import(...)`. The real guard uses the pinned guard TypeScript.
const fakeTs = {
  preProcessFile(source) {
    const importedFiles = [];
    for (const m of source.matchAll(/(?:from\s+|import\(\s*)"([^"]+)"/g)) importedFiles.push({ fileName: m[1] });
    return { importedFiles };
  },
};

function baseline(overrides = {}) {
  return { version: 1, owner: "platform-architecture", expiry: "2099-01-01", largestCycle: 2, members: ["lib/a.ts", "lib/b.ts"], ...overrides };
}

test("production-source filter drops tests and declaration files", () => {
  assert.equal(isProductionSource("lib/a.ts"), true);
  assert.equal(isProductionSource("app/page.tsx"), true);
  assert.equal(isProductionSource("lib/a.test.ts"), false);
  assert.equal(isProductionSource("lib/a.spec.tsx"), false);
  assert.equal(isProductionSource("types/x.d.ts"), false);
  assert.equal(isProductionSource("lib/a.mjs"), false);
});

test("specifiers resolve through the @/ alias, relative paths, index files and .js suffixes", () => {
  const known = new Set(["lib/a.ts", "lib/b/index.ts", "components/C.tsx"]);
  assert.equal(resolveSpecifier("lib/x.ts", "@/lib/a", known), "lib/a.ts");
  assert.equal(resolveSpecifier("lib/x.ts", "./b", known), "lib/b/index.ts");
  assert.equal(resolveSpecifier("lib/deep/x.ts", "../a.js", known), "lib/a.ts");
  assert.equal(resolveSpecifier("lib/x.ts", "@/components/C", known), "components/C.tsx");
  assert.equal(resolveSpecifier("lib/x.ts", "react", known), null);
});

test("type-only imports count: a cycle closed only by `import type` is still a cycle", () => {
  const graph = buildImportGraph([
    { path: "lib/a.ts", source: 'import { b } from "./b";' },
    { path: "lib/b.ts", source: 'import type { A } from "@/lib/a";' },
    { path: "lib/leaf.ts", source: 'export type Leaf = string;' },
  ], fakeTs);
  assert.deepEqual(largestCycle(graph), ["lib/a.ts", "lib/b.ts"]);
});

test("inline import() type queries and dynamic imports count", () => {
  const graph = buildImportGraph([
    { path: "lib/a.ts", source: 'export const load = () => import("./b");' },
    { path: "lib/b.ts", source: 'export type X = import("./c").C;' },
    { path: "lib/c.ts", source: 'import "./a"; import { a } from "./a";' },
  ], fakeTs);
  assert.deepEqual(largestCycle(graph), ["lib/a.ts", "lib/b.ts", "lib/c.ts"]);
});

test("an acyclic graph has no cycle", () => {
  const graph = buildImportGraph([
    { path: "lib/a.ts", source: 'import type { T } from "./types";' },
    { path: "lib/types.ts", source: "export type T = number;" },
  ], fakeTs);
  assert.deepEqual(largestCycle(graph), []);
});

test("ratchet: growth fails and names the entrants; equal or smaller passes", () => {
  const grown = runCheck({ cycle: ["lib/a.ts", "lib/b.ts", "lib/c.ts"], baseline: baseline() });
  assert.equal(grown.ok, false);
  assert.deepEqual(grown.entrants, ["lib/c.ts"]);

  const same = runCheck({ cycle: ["lib/a.ts", "lib/b.ts"], baseline: baseline() });
  assert.equal(same.ok, true);
  assert.equal(same.shrunk, 0);

  const swapped = runCheck({ cycle: ["lib/a.ts", "lib/z.ts"], baseline: baseline() });
  assert.equal(swapped.ok, true, "size is the budget; membership is reported, not frozen");

  const shrunk = runCheck({ cycle: [], baseline: baseline() });
  assert.equal(shrunk.ok, true);
  assert.equal(shrunk.shrunk, 2);
});

test("baseline must carry an owned, unexpired budget and a numeric size", () => {
  assert.deepEqual(validateBaseline(baseline()), []);
  assert.ok(validateBaseline(baseline({ owner: "" })).length > 0);
  assert.ok(validateBaseline(baseline({ expiry: "2000-01-01" })).length > 0);
  assert.ok(validateBaseline(baseline({ largestCycle: "134" })).length > 0);
  assert.ok(validateBaseline(baseline({ members: undefined })).length > 0);
  assert.equal(runCheck({ cycle: [], baseline: baseline({ owner: "" }) }).ok, false);
});
