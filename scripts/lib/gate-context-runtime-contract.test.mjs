import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dockerfile = readFileSync(resolve(repoRoot, "Dockerfile"), "utf8");

function localImportClosure(entry) {
  const discovered = new Set();
  const visit = (absolutePath) => {
    if (discovered.has(absolutePath)) return;
    discovered.add(absolutePath);
    const source = readFileSync(absolutePath, "utf8");
    for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      visit(resolve(dirname(absolutePath), match[1]));
    }
  };
  visit(resolve(repoRoot, entry));
  // POSIX separators: these paths are matched against Dockerfile COPY lines,
  // which are always forward-slashed. On Windows `relative` returns
  // `scripts\gate-context.mjs`, so every assertion here failed on a Windows
  // checkout — the guard loop reported the image as missing files it packages
  // perfectly well.
  return [...discovered].map((path) => relative(repoRoot, path).replaceAll("\\", "/")).sort();
}

const runtimeSources = [
  ...localImportClosure("scripts/gate-context.mjs"),
  "scripts/module-size-baseline.txt",
  "scripts/prose-lint-baseline.json",
  "scripts/style-drift-baseline.json",
];

test("portal runner packages the canonical gate-context generator closure", () => {
  for (const source of runtimeSources) {
    assert.match(
      dockerfile,
      new RegExp(`^COPY ${source.replaceAll(".", "\\.")} `, "m"),
      `init stage does not package ${source}`,
    );
  }

  assert.match(dockerfile, /^COPY --from=init \/app\/scripts \.\/scripts$/m);
  assert.match(dockerfile, /^COPY --from=init \/app\/config\/ci-evidence-policy\.json \.\/config\/$/m);
  assert.match(dockerfile, /^COPY --from=init \/app\/config\/seed-content-paths\.json \.\/config\/$/m);
  assert.match(
    dockerfile,
    /^COPY --from=init \/app\/apps\/web\/lib\/ux-budget\/route-budget-baseline\.json \.\/apps\/web\/lib\/ux-budget\/$/m,
  );
});
