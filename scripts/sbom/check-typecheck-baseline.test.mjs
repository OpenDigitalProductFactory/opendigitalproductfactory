#!/usr/bin/env node
// Tests for the typecheck program ratchet (plan 2026-09-08 M11 step 4).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BUDGETED,
  analyzeProgram,
  countLines,
  evaluateBudgets,
  evaluateOutsideSources,
  excludePatternToRegExp,
  nextAcceptedSources,
  nextBudgets,
  outsideSourceOf,
  packageDeltas,
  packageOf,
  parseExtendedDiagnostics,
} from "./check-typecheck-baseline.mjs";

const EXCLUDE = ["node_modules", "scripts", "**/*.test.ts", "**/*.test.tsx", "e2e", "tests", "test-support", "vitest.config.ts"];

test("countLines counts line starts the way tsc's Lines of ... does", () => {
  assert.equal(countLines(""), 1);
  assert.equal(countLines("a"), 1);
  assert.equal(countLines("a\n"), 2);
  assert.equal(countLines("a\r\nb\rc\nd"), 4);
  assert.equal(countLines("a b c"), 3);
});

test("exclude patterns match the file or the directory and everything under it", () => {
  const tests = excludePatternToRegExp("tests");
  assert.ok(tests.test("tests"));
  assert.ok(tests.test("tests/a/b.ts"));
  assert.ok(!tests.test("lib/tests.ts"));
  const testFiles = excludePatternToRegExp("**/*.test.ts");
  assert.ok(testFiles.test("a.test.ts"));
  assert.ok(testFiles.test("lib/x/a.test.ts"));
  assert.ok(!testFiles.test("lib/x/a.test.tsx"));
  assert.ok(!testFiles.test("lib/x/atest.ts"));
  assert.ok(excludePatternToRegExp("./vitest.config.ts").test("vitest.config.ts"));
});

test("package and outside-source attribution", () => {
  assert.equal(packageOf("node_modules/.pnpm/next@16/node_modules/next/dist/x.d.ts"), "next");
  assert.equal(packageOf("node_modules/.pnpm/a@1/node_modules/@types/node/fs.d.ts"), "@types/node");
  assert.equal(outsideSourceOf("packages/db/src/client.ts"), "packages/db/src");
  assert.equal(outsideSourceOf("packages/db/src/deep/x/y.ts"), "packages/db/src");
  assert.equal(outsideSourceOf("scripts/lib/x.mjs"), "scripts");
  assert.equal(outsideSourceOf("packages/types/index.ts"), "packages/types");
});

test("analyzeProgram puts every checked line in exactly one bucket", () => {
  const lines = {
    "node_modules/typescript/lib/lib.es5.d.ts": 100,
    "node_modules/.pnpm/next@16/node_modules/next/index.d.ts": 40,
    "packages/db/generated/client.ts": 1000,
    "apps/web/.next/types/routes.d.ts": 7,
    "apps/web/lib/a.ts": 30,
    "apps/web/lib/a.test.ts": 20,
    "apps/web/scripts/tool.ts": 5,
    "packages/db/src/index.ts": 9,
    "scripts/lib/x.mjs": 3,
  };
  const r = analyzeProgram({ files: Object.keys(lines), linesOf: (f) => lines[f], excludePatterns: EXCLUDE });
  assert.deepEqual(r.totals, {
    files: 9,
    lines: 1214,
    project: 30,
    generated: 1007,
    outside: 12,
    excludedLines: 25,
    library: 100,
    external: 40,
    dependencyLines: 140,
  });
  const { files, lines: total, dependencyLines, ...buckets } = r.totals;
  assert.equal(files, 9);
  assert.equal(Object.values(buckets).reduce((a, b) => a + b, 0), total);
  assert.equal(dependencyLines, buckets.library + buckets.external);
  assert.deepEqual(r.outsideSources, { "packages/db/src": 9, scripts: 3 });
  assert.deepEqual(r.externalPackages, { next: 40 });
  assert.deepEqual(r.excludedFiles, ["apps/web/lib/a.test.ts", "apps/web/scripts/tool.ts"]);
});

test("the node_modules exclude never hides a dependency", () => {
  const r = analyzeProgram({ files: ["apps/web/node_modules/x/index.d.ts"], linesOf: () => 4, excludePatterns: EXCLUDE });
  assert.equal(r.totals.external, 4);
  assert.equal(r.totals.excludedLines, 0);
});

test("parseExtendedDiagnostics keeps the recorded keys as numbers", () => {
  const parsed = parseExtendedDiagnostics([
    "Files:                         8223",
    "Lines of TypeScript:        2591410",
    "Memory used:               5483611K",
    "Check time:                 140.85s",
    "I/O Read time:                0.97s",
    "src/a.ts(1,2): error TS2322: Type 'x' is not assignable",
  ]);
  assert.deepEqual(parsed, { Files: 8223, "Lines of TypeScript": 2591410, "Memory used": 5483611, "Check time": 140.85 });
});

test("only the lines no diff explains are budgeted", () => {
  assert.deepEqual(BUDGETED, ["dependencyLines", "excludedLines"]);
});

test("dependency growth inside 1% warns, past it fails; excluded lines have no tolerance", () => {
  const budgets = { dependencyLines: 10_000, excludedLines: 0 };
  const inside = evaluateBudgets({ dependencyLines: 10_100, excludedLines: 0 }, budgets);
  assert.deepEqual(inside.over, []);
  assert.deepEqual(inside.tolerated, [{ key: "dependencyLines", current: 10_100, budget: 10_000, ceiling: 10_100 }]);
  const past = evaluateBudgets({ dependencyLines: 10_101, excludedLines: 1 }, budgets);
  assert.deepEqual(past.over.map((o) => o.key), ["dependencyLines", "excludedLines"]);
  const smaller = evaluateBudgets({ dependencyLines: 9_000, excludedLines: 0 }, budgets);
  assert.deepEqual(smaller.under, [{ key: "dependencyLines", current: 9_000, budget: 10_000 }]);
});

test("a baseline without budgets never fails", () => {
  assert.deepEqual(evaluateBudgets({ dependencyLines: 1e9, excludedLines: 1e9 }, undefined), { over: [], tolerated: [], under: [] });
});

test("--update-baseline ratchets down only; --raise-budget moves to current", () => {
  const totals = { dependencyLines: 500, excludedLines: 3 };
  assert.deepEqual(nextBudgets(totals, { dependencyLines: 600, excludedLines: 0 }), { dependencyLines: 500, excludedLines: 0 });
  assert.deepEqual(nextBudgets(totals, { dependencyLines: 600, excludedLines: 0 }, { raise: true }), totals);
  assert.deepEqual(nextBudgets(totals, undefined), totals);
});

test("a new outside source fails; a gone one is reported; the accepted set only shrinks without a reason", () => {
  const current = { "packages/db/src": 9, "packages/new/src": 4 };
  assert.deepEqual(evaluateOutsideSources(current, ["packages/db/src", "scripts"]), { added: ["packages/new/src"], gone: ["scripts"] });
  assert.deepEqual(nextAcceptedSources(current, ["packages/db/src", "scripts"]), ["packages/db/src"]);
  assert.deepEqual(nextAcceptedSources(current, ["packages/db/src"], { raise: true }), ["packages/db/src", "packages/new/src"]);
  assert.deepEqual(nextAcceptedSources(current, undefined), ["packages/db/src", "packages/new/src"]);
});

test("packageDeltas lists the largest growth first", () => {
  assert.deepEqual(packageDeltas({ a: 10, b: 50, c: 1 }, { a: 10, b: 20, d: 5 }), [
    { name: "b", delta: 30 },
    { name: "c", delta: 1 },
    { name: "d", delta: -5 },
  ]);
});
