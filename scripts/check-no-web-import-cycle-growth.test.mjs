// Self-test for the web import-cycle ratchet (dependency-diet plan M11 step 2).
import test from "node:test";
import assert from "node:assert/strict";

import {
  STATIC_VALUE_CYCLE_BUDGET,
  buildImportGraph,
  classifyEdges,
  graphOfKinds,
  isProductionSource,
  largestCycle,
  resolveSpecifier,
  runCheck,
  runStaticValueCheck,
  stronglyConnectedComponents,
  validateBaseline,
} from "./check-no-web-import-cycle-growth.mjs";
import { loadPinnedGuardTypeScript } from "./lib/load-pinned-guard-typescript.mjs";

// Edge classification needs a real parser: the pinned guard TypeScript the
// guard itself runs on.
const ts = loadPinnedGuardTypeScript();

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

// ── Static-value mode: edge classification ─────────────────────────────────

/** kind of every edge from `from` to `to`, in source order */
function kindsBetween(files, from, to) {
  return classifyEdges(files, ts).filter((e) => e.from === from && e.to === to).map((e) => e.kind);
}

const TYPES = { path: "lib/types.ts", source: "export interface Shape { a: string }\nexport type Alias = number;\nexport const LIMIT = 3;\nexport class Box {}\nexport enum Mode { A }" };

test("classify: `import type` and inline type-only specifiers are type edges", () => {
  const files = [TYPES,
    { path: "lib/a.ts", source: 'import type { Box } from "./types";' },
    { path: "lib/b.ts", source: 'import { type LIMIT, type Box } from "./types";' },
  ];
  assert.deepEqual(kindsBetween(files, "lib/a.ts", "lib/types.ts"), ["type"]);
  assert.deepEqual(kindsBetween(files, "lib/b.ts", "lib/types.ts"), ["type"]);
});

test("classify: a named import is type only when every name is an interface or type alias", () => {
  const files = [TYPES,
    { path: "lib/a.ts", source: 'import { Shape, Alias } from "./types";' },
    { path: "lib/b.ts", source: 'import { Shape, LIMIT } from "./types";' },
    { path: "lib/c.ts", source: 'import { Box } from "./types"; export type B = Box;' },
    { path: "lib/d.ts", source: 'import { Mode } from "./types";' },
  ];
  assert.deepEqual(kindsBetween(files, "lib/a.ts", "lib/types.ts"), ["type"]);
  const [mixed] = classifyEdges(files, ts).filter((e) => e.from === "lib/b.ts");
  assert.equal(mixed.kind, "value");
  assert.deepEqual(mixed.names, ["LIMIT"], "the report names only the runtime bindings");
  assert.deepEqual(kindsBetween(files, "lib/c.ts", "lib/types.ts"), ["value"], "a class is value even when used only as a type");
  assert.deepEqual(kindsBetween(files, "lib/d.ts", "lib/types.ts"), ["value"]);
});

test("classify: side-effect, namespace and default imports are value edges", () => {
  const files = [TYPES,
    { path: "lib/def.ts", source: "export default function run() {}" },
    { path: "lib/a.ts", source: 'import "./types";' },
    { path: "lib/b.ts", source: 'import * as types from "./types";' },
    { path: "lib/c.ts", source: 'import run from "./def";' },
  ];
  assert.deepEqual(kindsBetween(files, "lib/a.ts", "lib/types.ts"), ["value"]);
  assert.deepEqual(kindsBetween(files, "lib/b.ts", "lib/types.ts"), ["value"]);
  assert.deepEqual(kindsBetween(files, "lib/c.ts", "lib/def.ts"), ["value"]);
});

test("classify: type names resolve through `export *`, named re-exports and re-exported imports", () => {
  const files = [TYPES,
    { path: "lib/star.ts", source: 'export * from "./types";' },
    { path: "lib/named.ts", source: 'export { Shape as Renamed, LIMIT } from "./star";' },
    { path: "lib/local.ts", source: 'import { Alias } from "./types";\nexport { Alias };' },
    { path: "lib/a.ts", source: 'import { Shape } from "./star";' },
    { path: "lib/b.ts", source: 'import { Renamed } from "./named";' },
    { path: "lib/c.ts", source: 'import { LIMIT } from "./named";' },
    { path: "lib/d.ts", source: 'import { Alias } from "./local";' },
  ];
  assert.deepEqual(kindsBetween(files, "lib/a.ts", "lib/star.ts"), ["type"]);
  assert.deepEqual(kindsBetween(files, "lib/b.ts", "lib/named.ts"), ["type"]);
  assert.deepEqual(kindsBetween(files, "lib/c.ts", "lib/named.ts"), ["value"]);
  assert.deepEqual(kindsBetween(files, "lib/d.ts", "lib/local.ts"), ["type"]);
});

test("classify: re-exports — `export *` and value re-exports are value; `export type` is type", () => {
  const files = [TYPES,
    { path: "lib/a.ts", source: 'export * from "./types";' },
    { path: "lib/b.ts", source: 'export { LIMIT } from "./types";' },
    { path: "lib/c.ts", source: 'export { Shape } from "./types";' },
    { path: "lib/d.ts", source: 'export type { Box } from "./types";' },
    { path: "lib/e.ts", source: 'export type * from "./types";' },
  ];
  assert.deepEqual(kindsBetween(files, "lib/a.ts", "lib/types.ts"), ["value"]);
  assert.deepEqual(kindsBetween(files, "lib/b.ts", "lib/types.ts"), ["value"]);
  assert.deepEqual(kindsBetween(files, "lib/c.ts", "lib/types.ts"), ["type"]);
  assert.deepEqual(kindsBetween(files, "lib/d.ts", "lib/types.ts"), ["type"]);
  assert.deepEqual(kindsBetween(files, "lib/e.ts", "lib/types.ts"), ["type"]);
});

test("classify: import() in expression position is dynamic; import(\"x\").T is type", () => {
  const files = [TYPES,
    { path: "lib/a.ts", source: 'export async function load() { return (await import("./types")).LIMIT; }' },
    { path: "lib/b.ts", source: 'export type S = import("./types").Shape;' },
  ];
  assert.deepEqual(kindsBetween(files, "lib/a.ts", "lib/types.ts"), ["dynamic"]);
  assert.deepEqual(kindsBetween(files, "lib/b.ts", "lib/types.ts"), ["type"]);
});

test("static-value mode: only value edges close a load-order cycle", () => {
  // hub <-> adapter: value both ways (the load-order cycle).
  // hub <-> typed: closed only by type edges. typed <-> lazy: closed only by a dynamic import().
  const files = [
    { path: "lib/hub.ts", source: 'import "./adapter";\nimport type { typed } from "./typed";\nexport class HubError extends Error {}\nexport interface HubShape { a: 1 }' },
    { path: "lib/adapter.ts", source: 'import { HubError } from "./hub";\nexport const run = () => new HubError();' },
    { path: "lib/typed.ts", source: 'import { HubShape } from "./hub";\nexport const typed = 1;\nexport const later = () => import("./lazy");' },
    { path: "lib/lazy.ts", source: 'import { typed } from "./typed";\nexport const lazy = typed;' },
  ];
  const edges = classifyEdges(files, ts);
  const paths = files.map((f) => f.path);
  assert.deepEqual(
    stronglyConnectedComponents(graphOfKinds(paths, edges, ["value", "type", "dynamic"])),
    [["lib/adapter.ts", "lib/hub.ts", "lib/lazy.ts", "lib/typed.ts"]],
  );
  const valueComponents = stronglyConnectedComponents(graphOfKinds(paths, edges, ["value"]));
  assert.deepEqual(valueComponents, [["lib/adapter.ts", "lib/hub.ts"]]);

  const failed = runStaticValueCheck({ components: valueComponents, edges });
  assert.equal(STATIC_VALUE_CYCLE_BUDGET, 0);
  assert.equal(failed.ok, false);
  assert.equal(failed.files, 2);
  assert.deepEqual(
    failed.components[0].edges.map((e) => `${e.from}->${e.to}:${e.names.join(",")}`),
    ["lib/hub.ts->lib/adapter.ts:", "lib/adapter.ts->lib/hub.ts:HubError"],
  );
});

test("static-value mode: moving the shared class to a leaf clears the cycle", () => {
  const files = [
    { path: "lib/hub-error.ts", source: "export class HubError extends Error {}" },
    { path: "lib/hub.ts", source: 'import "./adapter";\nexport { HubError } from "./hub-error";' },
    { path: "lib/adapter.ts", source: 'import { HubError } from "./hub-error";\nexport const run = () => new HubError();' },
  ];
  const edges = classifyEdges(files, ts);
  const components = stronglyConnectedComponents(graphOfKinds(files.map((f) => f.path), edges, ["value"]));
  assert.deepEqual(components, []);
  assert.deepEqual(runStaticValueCheck({ components, edges }), { ok: true, files: 0, components: [] });
});
