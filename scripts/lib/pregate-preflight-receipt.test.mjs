import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identifyGuardExecution, readGuardInputStamp, runWithGuardReceipt } from "./pregate-preflight-receipt.mjs";
import { runPreflight } from "./pregate-preflight.mjs";
import { resolveGuardBash } from "./guard-bash.mjs";
import * as guardReceipts from "./pregate-preflight-receipt.mjs";

test("abrupt controller loss reconciles actual persisted progress without a child verdict", { timeout: 20000 }, async t => {
  const f = fixture({ after() {} });
  const moduleUrl = new URL("./pregate-preflight-receipt.mjs", import.meta.url).href;
  const code = `import {runWithGuardReceipt} from ${JSON.stringify(moduleUrl)};
    await runWithGuardReceipt({directory:process.argv[1],stage:'preflight',
      identify:()=>({head:'abrupt-fixture'}),passed:r=>r.ok,
      execute:async({progress})=>{progress({guardId:'real-fixture',phase:'started'});
        process.send('persisted'); await new Promise(()=>{});}});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code, f.options.directory],
    { stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, "exit");
      child.kill("SIGKILL");
      await Promise.race([exit, once(child, "exit", { signal: AbortSignal.timeout(5000) })]);
    }
    rmSync(f.options.directory, { recursive: true, force: true });
  });
  const [message] = await Promise.race([once(child, "message"), once(child, "exit").then(() => { throw new Error("fixture exited before durable progress"); })]);
  assert.equal(message, "persisted");
  const { readdirSync } = await import("node:fs");
  const path = join(f.options.directory, readdirSync(f.options.directory).find(name => name.endsWith(".json")));
  const before = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(before.status, "running");
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  assert.equal(readFileSync(path, "utf8").includes('"status": "running"'), true);
  assert.equal(typeof guardReceipts.reconcileGuardReceipt, "function", "supported abrupt-loss reconciliation is missing");
  const result = guardReceipts.reconcileGuardReceipt({ directory: f.options.directory, stage: "preflight" });
  assert.equal(result.status, "inconclusive");
  const after = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(after.identity, before.identity);
  assert.deepEqual(after.observations, before.observations);
  assert.equal(after.lastHeartbeatAt, before.lastHeartbeatAt);
  assert.equal(after.result, undefined);
  assert.equal(after.recovery.reason, "controller-absent-child-outcome-unknown");
  assert.equal(result.newAttemptAllowed, false);
  assert.deepEqual(guardReceipts.reconcileGuardReceipt({ directory: f.options.directory, stage: "preflight" }).receipt, after);
  await assert.rejects(runWithGuardReceipt({...f.options, identify:()=>({head:'abrupt-fixture'})}), /original|ownership|already running/);
});

function abandonedFixture(t) {
  const f = fixture(t);
  const key = createHash("sha256").update(JSON.stringify("preflight")).digest("hex");
  const path = join(f.options.directory, `${key}.json`);
  const lock = join(f.options.directory, `${key}.lock`);
  const owner = { schema: "dpf-local-convergence-lock/v1", token: "original-attempt", pid: 765432,
    processIdentity: "fixture:birth", acquiredAt: new Date(1000).toISOString() };
  const receipt = { schemaVersion: 1, stage: "preflight", identity: { head: "original" }, owner,
    status: "running", hostPid: owner.pid, startedAt: owner.acquiredAt, lastHeartbeatAt: owner.acquiredAt,
    completedAt: null, observations: [{ guardId: "guard", childPid: 765433 }] };
  mkdirSync(lock);
  const writeOwner = value => writeFileSync(join(lock, "owner.json"), JSON.stringify(value));
  const writeReceipt = value => writeFileSync(path, JSON.stringify(value));
  writeOwner(owner); writeReceipt(receipt);
  return { ...f, path, lock, owner, receipt, writeOwner, writeReceipt,
    input: { directory: f.options.directory, stage: "preflight", probe: () => ({ status: "absent" }), lockOptions: f.options.lockOptions } };
}

for (const status of ["live", "unknown"]) test(`reconciliation preserves ${status} original controller`, t => {
  const f = abandonedFixture(t);
  const before = readFileSync(f.path, "utf8");
  const result = guardReceipts.reconcileGuardReceipt({ ...f.input, probe: () => ({ status }) });
  assert.equal(result.status, status === "live" ? "running" : "unknown");
  assert.equal(readFileSync(f.path, "utf8"), before);
  assert.equal(result.newAttemptAllowed, false);
});

for (const change of ["legacy", "foreign-token", "foreign-birth", "probe-throws", "mutation-lock"])
  test(`reconciliation cannot mutate ${change} ownership`, t => {
    const f = abandonedFixture(t);
    if (change === "legacy") f.writeReceipt({ ...f.receipt, owner: undefined });
    if (change === "foreign-token") f.writeOwner({ ...f.owner, token: "replacement" });
    if (change === "foreign-birth") f.writeOwner({ ...f.owner, processIdentity: "replacement" });
    if (change === "probe-throws") f.input.probe = () => { throw new Error("unreadable"); };
    if (change === "mutation-lock") mkdirSync(f.lock.replace(/\.lock$/, ".write.lock"));
    const before = readFileSync(f.path, "utf8");
    const result = guardReceipts.reconcileGuardReceipt(f.input);
    assert.equal(result.status, "unknown");
    assert.equal(readFileSync(f.path, "utf8"), before);
    assert.equal(result.newAttemptAllowed, false);
  });

for (const replacement of ["terminal", "receipt", "owner", "mutation-owner"])
  test(`reconciliation rechecks ${replacement} after its process probe`, t => {
    const f = abandonedFixture(t);
    let probes = 0;
    f.input.probe = () => {
      if (++probes === 2) {
        if (replacement === "terminal") f.writeReceipt({ ...f.receipt, status: "passed", result: { ok: true } });
        if (replacement === "receipt") f.writeReceipt({ ...f.receipt, identity: { head: "new-source" } });
        if (replacement === "owner") f.writeOwner({ ...f.owner, token: "late-owner" });
        if (replacement === "mutation-owner") writeFileSync(join(f.lock.replace(/\.lock$/, ".write.lock"), "owner.json"), JSON.stringify({ ...f.owner, token: "other-writer" }));
      }
      return { status: "absent" };
    };
    const result = guardReceipts.reconcileGuardReceipt(f.input);
    const after = JSON.parse(readFileSync(f.path, "utf8"));
    assert.equal(after.recovery, undefined);
    assert.notEqual(result.status, "inconclusive");
    assert.equal(after.status, replacement === "terminal" ? "passed" : "running");
  });

test("an unchanged abandoned attempt settles once while preserving its foreign execution lock", t => {
  const f = abandonedFixture(t);
  const result = guardReceipts.reconcileGuardReceipt(f.input);
  assert.equal(result.status, "inconclusive");
  const bytes = readFileSync(f.path, "utf8");
  assert.deepEqual(result.receipt.observations, f.receipt.observations);
  assert.deepEqual(JSON.parse(readFileSync(join(f.lock, "owner.json"), "utf8")), f.owner);
  assert.equal(guardReceipts.reconcileGuardReceipt(f.input).status, "inconclusive");
  assert.equal(readFileSync(f.path, "utf8"), bytes);
  assert.match(result.nextAction, /child outcome.*descendant ownership/);
});

for (const replacement of ["receipt", "owner"]) test(`late completion cannot overwrite changed ${replacement}`, async t => {
  const f = fixture(t);
  f.options.execute = async () => {
    const { readdirSync } = await import("node:fs");
    const path = join(f.options.directory, readdirSync(f.options.directory).find(name => name.endsWith(".json")));
    const current = JSON.parse(readFileSync(path, "utf8"));
    if (replacement === "receipt") writeFileSync(path, JSON.stringify({ ...current, status: "inconclusive", recovery: { reason: "replacement" } }));
    else writeFileSync(join(path.replace(/\.json$/, ".lock"), "owner.json"), JSON.stringify({ ...current.owner, token: "foreign-owner" }));
    return { ok: true, entries: [{ status: "passed" }] };
  };
  await assert.rejects(runWithGuardReceipt(f.options), /ownership changed/);
  const { readdirSync } = await import("node:fs");
  const receipt = JSON.parse(readFileSync(join(f.options.directory, readdirSync(f.options.directory).find(name => name.endsWith(".json"))), "utf8"));
  if (replacement === "receipt") assert.equal(receipt.recovery.reason, "replacement");
  assert.equal(receipt.status, replacement === "receipt" ? "inconclusive" : "running");
});

test("status projects host recovery separately from the canonical gate verdict", async t => {
  const f = abandonedFixture(t);
  const { collectHostPreflightStatus, projectGateStatus } = await import("../pregate-status.mjs");
  const key = createHash("sha256").update(JSON.stringify("pregate-preflight")).digest("hex");
  const path = join(f.options.directory, `${key}.json`);
  writeFileSync(path, JSON.stringify({ ...f.receipt, stage: "pregate-preflight", owner: undefined }));
  const before = readFileSync(path, "utf8");
  const host = collectHostPreflightStatus({ worktreePath: f.options.directory }, { directory: f.options.directory });
  assert.equal(host.status, "unknown");
  assert.equal(host.lastProgress.childPid, 765433);
  assert.equal(host.accountableOwner.pid, f.owner.pid);
  assert.equal(readFileSync(path, "utf8"), before, "default status is read-only");
  const projection = projectGateStatus({ verdict: "NO-RECORD", reason: "no integration attempt", slot: null },
    { worktreePath: f.options.directory, headBranch: "fix/fixture", headSha: "original" }, host);
  assert.equal(projection.verdict, "NO-RECORD");
  assert.equal(projection.hostPreflight.status, "unknown");
  assert.equal(projection.hostPreflight.newAttemptAllowed, false);
});

test("concurrent independent observers cannot replace a settled receipt", { timeout: 20000 }, async t => {
  const f = abandonedFixture({ after() {} });
  // The fake original is probed as absent only in this isolated fixture.
  // Both real observer processes still acquire the actual mutation lock.
  const moduleUrl = new URL("./pregate-preflight-receipt.mjs", import.meta.url).href;
  const code = `import {reconcileGuardReceipt} from ${JSON.stringify(moduleUrl)};
    process.on('message',()=>{const r=reconcileGuardReceipt({directory:process.argv[1],stage:'preflight',probe:()=>({status:'absent'})});process.send(r.status);process.disconnect();});process.send('ready');`;
  const observers = [0, 1].map(() => spawn(process.execPath, ["--input-type=module", "-e", code, f.options.directory],
    { stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true }));
  t.after(async () => {
    for (const child of observers) if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, "exit", { signal: AbortSignal.timeout(5000) }); child.kill("SIGKILL"); await exit;
    }
    rmSync(f.options.directory, { recursive: true, force: true });
  });
  await Promise.all(observers.map(child => once(child, "message")));
  const results = observers.map(child => once(child, "message"));
  const exits = observers.map(child => once(child, "exit"));
  for (const child of observers) child.send("go");
  const statuses = (await Promise.all(results)).map(([status]) => status);
  await Promise.all(exits);
  assert.ok(statuses.includes("inconclusive"));
  assert.ok(statuses.every(status => ["inconclusive", "unknown"].includes(status)));
  const bytes = readFileSync(f.path, "utf8");
  assert.equal(JSON.parse(bytes).status, "inconclusive");
  assert.equal(guardReceipts.reconcileGuardReceipt(f.input).status, "inconclusive");
  assert.equal(readFileSync(f.path, "utf8"), bytes);
});

test("legacy successful receipt has no strong owner and cannot be reused", async t => {
  const f = fixture(t);
  await runWithGuardReceipt(f.options);
  const { readdirSync } = await import("node:fs");
  const path = join(f.options.directory, readdirSync(f.options.directory).find(name => name.endsWith(".json")));
  const prior = JSON.parse(readFileSync(path, "utf8"));
  delete prior.owner;
  writeFileSync(path, JSON.stringify(prior));
  assert.equal((await runWithGuardReceipt(f.options)).reused, false);
  assert.equal(f.calls(), 2);
});

test("an unreadable retained receipt is unknown and cannot start another execution", async t => {
  const f = abandonedFixture(t);
  writeFileSync(f.path, "{incomplete");
  const result = guardReceipts.reconcileGuardReceipt(f.input);
  assert.equal(result.status, "unknown");
  assert.equal(readFileSync(f.path, "utf8"), "{incomplete");
  await assert.rejects(runWithGuardReceipt({ ...f.options, identify: () => null }), /unreadable/);
  assert.equal(f.calls(), 0);
});

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
  env = { ...env, DPF_FIXTURE_INPUT: "changed" };
  assert.equal((await runWithGuardReceipt(f.options)).reused, false, "environment still invalidates reuse");
  writeFileSync(join(cwd, "untracked"), "changed");
  assert.equal(f.options.identify(), null, "dirty source cannot inherit a pass");
  rmSync(join(cwd, "untracked"));
  commit("metadata changed with identical tree");
  assert.equal(f.options.identify(), null, "even same-tree commit metadata differs from the admitted candidate");
  assert.equal((await runWithGuardReceipt(f.options)).identityVerified, false);
});
