// Self-test for check-dockerfile-copied-script-imports.mjs (BI-9B490215).
//
// The guard exists because a green PR can still ship an unbuildable image, so
// the self-test has to prove three things: it catches the real regression, it
// does not fire on the patterns the Dockerfile legitimately uses, and it passes
// against the actual checked-in Dockerfile.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  findMissingCopiedImports,
  logicalLines,
  parseStages,
  staticRelativeImports,
  visiblePaths,
} from "./check-dockerfile-copied-script-imports.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
);

test("collapses backslash continuations and drops comments", () => {
  const lines = logicalLines("# note\nCOPY a.mjs \\\n     b.mjs \\\n     ./scripts/\n\nRUN x\n");
  assert.deepEqual(lines, ["COPY a.mjs b.mjs ./scripts/", "RUN x"]);
});

test("resolves COPY destinations against the stage WORKDIR", () => {
  const stages = parseStages("FROM node AS deps\nWORKDIR /app\nCOPY scripts/x.mjs ./scripts/\n");
  assert.equal(stages[0].copies[0].imagePath, "/app/scripts/x.mjs");
});

test("a rename-style COPY (dest without trailing slash) keeps the destination name", () => {
  const stages = parseStages("FROM node AS r\nCOPY scripts/lib/a.mjs /promoter/scripts/lib/a.mjs\n");
  assert.equal(stages[0].copies[0].imagePath, "/promoter/scripts/lib/a.mjs");
});

test("a stage sees what the stage it is built FROM copied", () => {
  const stages = parseStages(
    "FROM node AS deps\nWORKDIR /app\nCOPY scripts/lib/dep.mjs ./scripts/lib/\nFROM deps AS build\nCOPY scripts/main.mjs ./scripts/\n",
  );
  const visible = visiblePaths(stages, "build");
  assert.ok(visible.has("/app/scripts/lib/dep.mjs"));
  assert.ok(visible.has("/app/scripts/main.mjs"));
});

test("reads static imports but ignores dynamic ones", () => {
  const specs = staticRelativeImports(
    [
      "import { a } from './lib/a.mjs';",
      "export { b } from '../lib/b.mjs';",
      "import './lib/side-effect.mjs';",
      "import fs from 'node:fs';",
      "const { c } = await import('./lib/c.mjs');",
    ].join("\n"),
  );
  assert.deepEqual(specs.sort(), ["../lib/b.mjs", "./lib/a.mjs", "./lib/side-effect.mjs"]);
});

// The measured regression: set-hooks-path.mjs gained a top-level import of
// ./lib/hooks-dir.mjs, which no COPY line delivered.
test("catches a copied script whose static import is never copied", () => {
  const dockerfile = "FROM node AS deps\nWORKDIR /app\nCOPY scripts/set-hooks-path.mjs ./scripts/\n";
  const violations = findMissingCopiedImports(dockerfile, (src) =>
    src === "scripts/set-hooks-path.mjs"
      ? "import { resolveHooksDir } from './lib/hooks-dir.mjs';\n"
      : null,
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].missing, "/app/scripts/lib/hooks-dir.mjs");
  assert.equal(violations[0].stage, "deps");
});

test("passes once the imported file is copied too", () => {
  const dockerfile =
    "FROM node AS deps\nWORKDIR /app\nCOPY scripts/set-hooks-path.mjs ./scripts/\nCOPY scripts/lib/hooks-dir.mjs ./scripts/lib/\n";
  const violations = findMissingCopiedImports(dockerfile, (src) =>
    src === "scripts/set-hooks-path.mjs"
      ? "import { resolveHooksDir } from './lib/hooks-dir.mjs';\n"
      : "export const x = 1;\n",
  );
  assert.deepEqual(violations, []);
});

test("does not flag a dynamic import — it degrades inside try/catch instead of failing the build", () => {
  const dockerfile = "FROM node AS deps\nWORKDIR /app\nCOPY scripts/set-hooks-path.mjs ./scripts/\n";
  const violations = findMissingCopiedImports(dockerfile, (src) =>
    src === "scripts/set-hooks-path.mjs"
      ? "try { const m = await import('./lib/ensure-pre-push-hook.mjs'); } catch {}\n"
      : null,
  );
  assert.deepEqual(violations, []);
});

test("does not flag artifacts lifted from another stage", () => {
  const dockerfile =
    "FROM node AS build\nWORKDIR /app\nFROM node AS runner\nWORKDIR /app\nCOPY --from=build /app/scripts/gen.mjs ./scripts/\n";
  const violations = findMissingCopiedImports(dockerfile, () => "import './lib/nope.mjs';\n");
  assert.deepEqual(violations, []);
});

test("the checked-in Dockerfile satisfies the invariant", () => {
  const dockerfilePath = path.join(REPO_ROOT, "Dockerfile");
  const violations = findMissingCopiedImports(readFileSync(dockerfilePath, "utf8"), (src) => {
    const abs = path.join(REPO_ROOT, src);
    return existsSync(abs) ? readFileSync(abs, "utf8") : null;
  });
  assert.deepEqual(
    violations.map((v) => `${v.stage}: ${v.importer} -> ${v.missing}`),
    [],
  );
});
