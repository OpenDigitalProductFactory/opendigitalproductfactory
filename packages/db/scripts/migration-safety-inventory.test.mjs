import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as guard from "./migration-safety-guard.mjs";

const prefix = "packages/db/prisma/migrations";
function repository(t) {
  const root = mkdtempSync(join(tmpdir(), "dpf-migration-inventory-"));
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + "/") || resolve(root).startsWith(resolve(tmpdir()) + "\\"));
    rmSync(root, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "--quiet");
  git("config", "user.name", "Migration inventory fixture");
  git("config", "user.email", "fixture@example.invalid");
  const add = name => {
    const path = `${prefix}/${name}/migration.sql`;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), 'ALTER TABLE "Example" ADD COLUMN note text;\n');
    return path;
  };
  const old = add("old with spaces");
  git("add", ".");
  git("commit", "--quiet", "-m", "fixture baseline");
  return { root, git, add, old, base: git("rev-parse", "HEAD").trim() };
}

test("new candidates preserve path-presence semantics across index changes", t => {
  const f = repository(t);
  const added = f.add("new with spaces");
  const untracked = f.add("untracked");
  f.git("add", added);
  assert.deepEqual(guard.collectNewMigrationFiles(f.root, f.base), [added]);
  mkdirSync(join(f.root, prefix, "renamed old"));
  f.git("mv", f.old, `${prefix}/renamed old/migration.sql`);
  assert.deepEqual(guard.collectNewMigrationFiles(f.root, f.base).sort(), [added, `${prefix}/renamed old/migration.sql`].sort());
  f.git("rm", "-f", added);
  assert.deepEqual(guard.collectNewMigrationFiles(f.root, f.base), [`${prefix}/renamed old/migration.sql`]);
  assert.ok(!guard.collectNewMigrationFiles(f.root, f.base).includes(untracked));
});

test("an unstaged deletion remains tracked but is not a new historical path", t => {
  const f = repository(t);
  rmSync(join(f.root, f.old));
  assert.deepEqual(guard.collectNewMigrationFiles(f.root, f.base), []);
});

test("an unavailable base is an invocation failure, never an empty passing inventory", t => {
  const f = repository(t);
  assert.throws(() => guard.collectNewMigrationFiles(f.root, "missing-base"), /missing-base/);
});

test("a large historical inventory requires only two Git subprocess calls", () => {
  const history = Array.from({ length: 1000 }, (_, i) => `${prefix}/history-${i}/migration.sql`);
  const added = `${prefix}/new/migration.sql`;
  const calls = [];
  const git = (command, args) => {
    calls.push({ command, args });
    return (args[0] === "ls-files" ? [...history, added] : history).join("\0") + "\0";
  };
  assert.deepEqual(guard.collectNewMigrationFiles("fixture", "base", git), [added]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.command === "git" && call.args.includes("-z")));
});

test("the CLI preserves tightening checks and fails unreadable bases with exit 2", t => {
  const f = repository(t);
  const script = join(f.root, "packages/db/scripts/migration-safety-guard.mjs");
  mkdirSync(dirname(script), { recursive: true });
  copyFileSync(fileURLToPath(new URL("./migration-safety-guard.mjs", import.meta.url)), script);
  const run = base => spawnSync(process.execPath, [script, base], { cwd: f.root, encoding: "utf8" });
  assert.equal(run(f.base).status, 0);
  const invalid = run("missing-base");
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /Migration inventory failed/);
  assert.doesNotMatch(invalid.stdout, /No unattested/);
  const risky = f.add("risky");
  writeFileSync(join(f.root, risky), 'ALTER TABLE "Example" ALTER COLUMN note SET NOT NULL;\n');
  f.git("add", risky);
  assert.equal(run(f.base).status, 1);
  writeFileSync(join(f.root, risky), '-- @migration-safety: reviewed: fixture proves attestation unchanged\nALTER TABLE "Example" ALTER COLUMN note SET NOT NULL;\n');
  assert.equal(run(f.base).status, 0);
});
