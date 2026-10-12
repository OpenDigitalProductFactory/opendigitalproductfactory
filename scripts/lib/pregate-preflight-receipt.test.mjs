import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identifyGuardExecution, runWithGuardReceipt } from "./pregate-preflight-receipt.mjs";
import { runPreflight } from "./pregate-preflight.mjs";
import { resolveGuardBash } from "./guard-bash.mjs";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "dpf-guard-reuse-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let calls = 0;
  let identity = { tree: "tree", head: "head", base: "base", policy: "v1", toolchain: "node", commands: "plan", environment: "env" };
  let now = 1000;
  const options = { directory, stage: "preflight", identify: () => identity, now: () => now,
    lockOptions: { processIdentity: () => "fixture-owner", processAlive: () => true },
    execute: async () => { calls++; return { ok: true, entries: [{ status: "passed" }] }; },
    passed: result => result.ok && result.entries.every(entry => entry.status === "passed"),
  };
  return { options, calls: () => calls, identity: value => { identity = value; }, current: () => identity, time: value => { now = value; } };
}

test("an unchanged successful execution is reused without executing guards", async t => {
  const f = fixture(t);
  assert.equal((await runWithGuardReceipt(f.options)).reused, false);
  const second = await runWithGuardReceipt(f.options);
  assert.equal(second.reused, true);
  assert.equal(second.executedAt, new Date(1000).toISOString());
  assert.equal(f.calls(), 1);
});

test("every identity component invalidates reuse", async t => {
  const f = fixture(t);
  await runWithGuardReceipt(f.options);
  for (const key of Object.keys(f.current())) {
    f.identity({ ...f.current(), [key]: "changed" });
    assert.equal((await runWithGuardReceipt(f.options)).reused, false, key);
  }
  assert.equal(f.calls(), 8);
});

test("expiration and unknown or dirty identity cannot reuse a pass", async t => {
  const f = fixture(t);
  await runWithGuardReceipt(f.options);
  f.time(1000 + 60 * 60 * 1000);
  assert.equal((await runWithGuardReceipt(f.options)).reused, false);
  f.identity(null);
  assert.equal((await runWithGuardReceipt(f.options)).reused, false);
  assert.equal((await runWithGuardReceipt(f.options)).reused, false);
  assert.equal(f.calls(), 4);
});

for (const status of ["failed", "skipped_environment", "runner_failed"]) {
  test(`${status} is never cached as PASS`, async t => {
    const f = fixture(t);
    f.options.execute = async () => ({ ok: status !== "failed", entries: [{ status }] });
    await runWithGuardReceipt(f.options);
    assert.equal((await runWithGuardReceipt(f.options)).reused, false);
  });
}

test("identity drift while running prevents publication of reusable evidence", async t => {
  const f = fixture(t);
  const execute = f.options.execute;
  f.options.execute = async () => { const result = await execute(); f.identity({ ...f.current(), tree: "new" }); return result; };
  await runWithGuardReceipt(f.options);
  f.options.execute = execute;
  assert.equal((await runWithGuardReceipt(f.options)).reused, false);
});

test("concurrent caller reports busy and never starts duplicate execution", async t => {
  const f = fixture(t);
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const execute = f.options.execute;
  f.options.execute = async () => { await held; return execute(); };
  const first = runWithGuardReceipt(f.options);
  await assert.rejects(runWithGuardReceipt(f.options), /already running/);
  release();
  await first;
  assert.equal((await runWithGuardReceipt(f.options)).reused, true);
  assert.equal(f.calls(), 1);
});

test("thrown execution releases only its own claim, without caching a pass", async t => {
  const f = fixture(t);
  const execute = f.options.execute;
  f.options.execute = async () => { throw new Error("runner died"); };
  await assert.rejects(runWithGuardReceipt(f.options), /runner died/);
  f.options.execute = execute;
  assert.equal((await runWithGuardReceipt(f.options)).reused, false);
});

test("precommit never shares fixed diagnostic logs across worktrees", () => {
  const hook = readFileSync(new URL("../../.githooks/pre-commit", import.meta.url), "utf8");
  assert.doesNotMatch(hook, /\/tmp\/pre-commit-(?:tc|prisma)\.log/);
  assert.match(hook, /mktemp -d/);
  assert.match(hook, /\$DPF_PRECOMMIT_LOG_DIR\/typecheck\.log/);
});

test("actual preflight executor results satisfy reuse without a second command", async t => {
  const f = fixture(t);
  let commands = 0;
  f.options.execute = () => runPreflight({ env: {}, plan: [{ id: "fixture", name: "Fixture", commands: [["node", ["check.mjs"]]] }], execute: () => { commands++; return { exitCode: 0, output: "ok" }; } });
  assert.equal((await runWithGuardReceipt(f.options)).reused, false);
  assert.equal((await runWithGuardReceipt(f.options)).reused, true);
  assert.equal(commands, 1);
});

test("real repository identity changes on metadata, main, plan, environment and dirty files", t => {
  const f = fixture(t);
  const cwd = f.options.directory;
  const git = args => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(["init", "-b", "main"]);
  git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "initial"]);
  git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  const input = { cwd, plan: ["command"], env: { ...process.env } };
  const first = identifyGuardExecution(input);
  assert.ok(first, "the real pinned pnpm/Git environment must be identifiable");
  assert.deepEqual(identifyGuardExecution(input), first);
  assert.notDeepEqual(identifyGuardExecution({ ...input, plan: ["other-command"] }), first);
  assert.notDeepEqual(identifyGuardExecution({ ...input, env: { ...input.env, CI: "receipt-fixture" } }), first);
  git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "metadata"]);
  const metadata = identifyGuardExecution(input);
  assert.equal(metadata.tree, first.tree);
  assert.notEqual(metadata.head, first.head, "commit-sensitive guards must be fresh");
  git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  assert.notEqual(identifyGuardExecution(input).base, first.base);
  writeFileSync(join(cwd, "untracked.txt"), "dirty");
  assert.equal(identifyGuardExecution(input), null);
});

test("real hook diagnostic allocation is unique and cleans its own files", () => {
  const hook = readFileSync(new URL("../../.githooks/pre-commit", import.meta.url), "utf8");
  const allocation = hook.split("\n").filter(line => line.startsWith("DPF_PRECOMMIT_LOG_DIR=") || line.startsWith("trap ")).join("\n");
  const bash = resolveGuardBash();
  const script = `${allocation}\nprintf fixture > "$DPF_PRECOMMIT_LOG_DIR/typecheck.log"\nprintf '%s\\n' "$DPF_PRECOMMIT_LOG_DIR"\ncat "$DPF_PRECOMMIT_LOG_DIR/typecheck.log"`;
  const run = () => spawnSync(bash, ["-c", script], { encoding: "utf8", windowsHide: true });
  const first = run();
  const second = run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.notEqual(first.stdout.split("\n")[0], second.stdout.split("\n")[0]);
  assert.ok(first.stdout.endsWith("fixture"));
  const gone = spawnSync(bash, ["-c", 'test ! -e "$1" && test ! -e "$2"', "fixture", first.stdout.split("\n")[0], second.stdout.split("\n")[0]], { encoding: "utf8" });
  assert.equal(gone.status, 0, gone.stderr);
});
