import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { evaluateCheckAll } from "./derived-artifacts-gate.mjs";
import { DERIVED_ARTIFACTS } from "./lib/derived-artifacts-registry.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
const indexPath = "apps/web/lib/docs/doc-index.generated.json";
const entry = DERIVED_ARTIFACTS.find(row => row.id === "doc-index");

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "dpf-doc-index-contract-"));
  t.after(() => {
    const target = resolve(root);
    assert.ok(target.startsWith(`${resolve(tmpdir())}${sep}`));
    assert.ok(basename(target).startsWith("dpf-doc-index-contract-"));
    rmSync(target, { recursive: true, force: true });
  });
  for (const relative of ["scripts/gen-doc-index.mjs", "scripts/check-doc-links.mjs", "apps/web/lib/docs/doc-link-resolver.mjs"]) {
    mkdirSync(dirname(join(root, relative)), { recursive: true });
    cpSync(join(repo, relative), join(root, relative));
  }
  mkdirSync(join(root, "docs/user-guide"), { recursive: true });
  for (const name of ["a", "m", "z"]) page(root, name);
  return root;
}
function page(root, name, heading = name) {
  writeFileSync(join(root, `docs/user-guide/${name}.md`), `# ${heading}\n`);
}
function run(root, script, args = []) {
  const result = spawnSync(process.execPath, [join(root, script), ...args], { cwd: root, encoding: "utf8" });
  assert.ifError(result.error);
  return result;
}
function generate(root) {
  const result = run(root, "scripts/gen-doc-index.mjs");
  assert.equal(result.status, 0, result.stderr);
  return readFileSync(join(root, indexPath), "utf8");
}
function check(root) {
  return run(root, entry.check[1], entry.check.slice(2));
}

test("independent page additions merge into the exact generated index", t => {
  const root = fixture(t);
  const base = generate(root);
  page(root, "b");
  const left = generate(root);
  unlinkSync(join(root, "docs/user-guide/b.md"));
  page(root, "y");
  const right = generate(root);
  const files = [left, base, right].map((text, i) => {
    const path = join(root, `merge-${i}.json`);
    writeFileSync(path, text);
    return path;
  });
  const merged = spawnSync("git", ["merge-file", "-p", ...files], { encoding: "utf8" });
  assert.ifError(merged.error);
  assert.equal(merged.status, 0, merged.stderr);
  page(root, "b");
  writeFileSync(join(root, indexPath), merged.stdout);
  const result = check(root);
  assert.equal(result.status, 0, result.stderr);
  const index = JSON.parse(merged.stdout);
  assert.equal(Object.keys(index.pages).length, 5);
  assert.equal(Object.hasOwn(index, "pageCount"), false);
  const reader = run(root, "scripts/check-doc-links.mjs");
  assert.equal(reader.status, 0, reader.stderr);
  assert.match(reader.stdout, /against 5 indexed pages/);
});

for (const mutation of ["deleted", "renamed", "heading changed"]) {
  test(`strict generator and registered gate reject a ${mutation} document`, t => {
    const root = fixture(t);
    generate(root);
    if (mutation === "deleted") unlinkSync(join(root, "docs/user-guide/m.md"));
    if (mutation === "renamed") renameSync(join(root, "docs/user-guide/m.md"), join(root, "docs/user-guide/n.md"));
    if (mutation === "heading changed") page(root, "m", "Changed anchor");
    const result = check(root);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /is stale/);
    for (const mergeQueue of [false, true]) {
      const [classification] = evaluateCheckAll([entry], () => result.status === 0, { mergeQueue });
      assert.equal(classification.ok, false);
      assert.equal(classification.tolerated, false);
    }
    generate(root);
    assert.equal(check(root).status, 0);
  });
}
