import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identifyGuardExecution, readGuardInputStamp, runWithGuardReceipt } from "./pregate-preflight-receipt.mjs";
import { runPreflight } from "./pregate-preflight.mjs";
import { resolveGuardBash } from "./guard-bash.mjs";

test("dependency bytes and metadata use an opened descriptor, closed after reading", () => {
  const closed = [];
  const stat = { dev: 1, ino: 2, size: 3, mtimeMs: 4, ctimeMs: 5, isFile: () => true };
  const fs = { realpathSync: () => "/shared/input", statSync: () => stat,
    openSync: () => 42, fstatSync: fd => { assert.equal(fd, 42); return stat; },
    readFileSync: fd => { assert.equal(fd, 42, "must read the inspected descriptor, never reopen by path"); return Buffer.from("abc"); },
    closeSync: fd => { closed.push(fd); },
  };
  assert.equal(readGuardInputStamp("/linked/input", fs).path, "/shared/input");
  assert.ok(closed.length > 0);
  assert.ok(closed.every(fd => fd === 42));
});

test("non-regular dependency inputs are rejected before reading", () => {
  let closed = false;
  const fs = { realpathSync: () => "/input", openSync: () => 42,
    statSync: () => ({ isFile: () => false }), fstatSync: () => ({ isFile: () => false }),
    readFileSync: () => { throw new Error("must not read a directory"); }, closeSync: () => { closed = true; },
  };
  assert.throws(() => readGuardInputStamp("/input", fs), /regular file/);
  assert.equal(closed, true);
});

for (const failure of ["mutated", "replaced", "retargeted", "unreadable", "disappeared"]) {
  test(`dependency ${failure} during inspection rejects identity and closes descriptors`, () => {
    const opened = [];
    const closed = [];
    let reads = 0;
    let paths = 0;
    const stat = { dev: 1, ino: 2, size: 3, mtimeMs: 4, ctimeMs: 5, isFile: () => true };
    const fs = {
      realpathSync: () => { paths++; return failure === "retargeted" && paths > 1 ? "/new-target" : "/input"; },
      openSync: () => {
        if (failure === "disappeared" && opened.length) throw Object.assign(new Error("disappeared"), { code: "ENOENT" });
        const fd = 42 + opened.length; opened.push(fd); return fd;
      },
      fstatSync: fd => failure === "mutated" && reads ? { ...stat, mtimeMs: 6 } : failure === "replaced" && fd === 43 ? { ...stat, ino: 3 } : stat,
      readFileSync: () => { reads++; if (failure === "unreadable") throw new Error("unreadable"); return Buffer.from("abc"); },
      closeSync: fd => { closed.push(fd); },
    };
    assert.throws(() => readGuardInputStamp("/input", fs), /changed|unreadable|disappeared/);
    assert.deepEqual(closed.sort(), opened.sort());
  });
}

test("a shared dependency junction retains its resolved regular-file identity", t => {
  const f = fixture(t);
  const target = join(f.options.directory, "shared");
  const link = join(f.options.directory, "linked");
  mkdirSync(target);
  writeFileSync(join(target, "input"), "abc");
  symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
  assert.deepEqual(readGuardInputStamp(join(link, "input")), readGuardInputStamp(join(target, "input")));
  assert.throws(() => readGuardInputStamp(target));
});

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
  const execution = await runWithGuardReceipt(f.options);
  assert.equal(execution.identityVerified, false);
  f.options.execute = execute;
  assert.equal((await runWithGuardReceipt(f.options)).reused, false);
});

test("a cached hit revalidates shared main before reporting reused PASS", async t => {
  const f = fixture(t);
  await runWithGuardReceipt(f.options);
  let reads = 0;
  const original = f.current();
  f.options.identify = () => ++reads === 1 ? original : { ...original, base: "new-main" };
  const result = await runWithGuardReceipt(f.options);
  assert.equal(result.reused, false);
  assert.equal(f.calls(), 2);
  assert.ok(reads >= 2);
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

test("interrupted execution persists a terminal inconclusive outcome and keeps its last progress", async t => {
  const f = fixture(t);
  f.options.execute = async ({ progress } = {}) => {
    progress?.({ guardId: "hanging-guard", phase: "started" });
    throw new Error("runner interrupted");
  };
  await assert.rejects(runWithGuardReceipt(f.options), /runner interrupted/);
  const { readdirSync } = await import("node:fs");
  const path = join(f.options.directory, readdirSync(f.options.directory).find(name => name.endsWith(".json")));
  const receipt = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(receipt.status, "inconclusive");
  assert.equal(receipt.error.message, "runner interrupted");
  assert.equal(receipt.observations.at(-1).guardId, "hanging-guard");
  assert.ok(receipt.completedAt);
});

test("guard progress is durable before the command completes", async t => {
  const f = fixture(t);
  const { readdirSync } = await import("node:fs");
  f.options.execute = async ({ progress }) => {
    progress({ guardId: "slow-guard", phase: "started" });
    const path = join(f.options.directory, readdirSync(f.options.directory).find(name => name.endsWith(".json")));
    const receipt = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(receipt.status, "running");
    assert.equal(receipt.observations.at(-1).guardId, "slow-guard");
    return { ok: true, entries: [{ status: "passed" }] };
  };
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
  assert.deepEqual(identifyGuardExecution({ ...input, env: { ...input.env, CODEX_TOOL_CALL_ID: "another-observability-call" } }), first,
    "a per-call tracing identifier does not change executed guard inputs");
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

test("pinned readiness source survives shared-main movement but never candidate or environment drift", async t => {
  const f = fixture(t);
  const cwd = f.options.directory;
  const git = args => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const commit = message => git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", message]);
  git(["init", "-b", "main"]);
  commit("base");
  const baseSha = git(["rev-parse", "HEAD"]);
  git(["update-ref", "refs/remotes/origin/main", baseSha]);
  commit("candidate");
  const headSha = git(["rev-parse", "HEAD"]);
  const source = { baseSha, headSha };
  let env = { ...process.env };
  f.options.directory = join(cwd, ".git", "receipts");
  f.options.identify = () => identifyGuardExecution({ cwd, plan: ["guard"], source, env });
  let calls = 0;
  f.options.execute = async () => {
    calls++;
    git(["update-ref", "refs/remotes/origin/main", headSha]);
    return { ok: true, entries: [{ status: "passed" }] };
  };
  const result = await runWithGuardReceipt(f.options);
  assert.equal(result.identityVerified, true, "unrelated shared-ref motion must not discard checks of the pinned pair");
  assert.equal(f.options.identify().base, baseSha);
  assert.equal((await runWithGuardReceipt(f.options)).reused, true);
  assert.equal(calls, 1);
  const originalIdentify = f.options.identify;
  f.options.identify = () => identifyGuardExecution({ cwd, plan: ["guard"], source: { baseSha: headSha, headSha }, env });
  assert.equal((await runWithGuardReceipt(f.options)).reused, false, "a newly selected main never inherits checks of the old base");
  f.options.identify = originalIdentify;
  assert.equal((await runWithGuardReceipt(f.options)).reused, false, "restore a receipt for the original source pair");
  assert.equal((await runWithGuardReceipt(f.options)).reused, true, "confirm that exact source and environment can reuse before changing only environment");
  env = { ...env, CI: "changed" };
  assert.equal((await runWithGuardReceipt(f.options)).reused, false, "a guard-result environment input still invalidates reuse");
  writeFileSync(join(cwd, "untracked"), "changed");
  assert.equal(f.options.identify(), null, "dirty source cannot inherit a pass");
  rmSync(join(cwd, "untracked"));
  commit("metadata changed with identical tree");
  assert.equal(f.options.identify(), null, "even same-tree commit metadata differs from the admitted candidate");
  assert.equal((await runWithGuardReceipt(f.options)).identityVerified, false);
});
