import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fetchOriginMainSharedSafe, withSharedGitFetchLock } from "./git-fetch-shared-safe.mjs";
import { acquireLocalConvergenceLock, releaseLocalConvergenceLock } from "./local-convergence-lock.mjs";
import { scrubGitRepoLocationEnv } from "./git-hook-env.mjs";

const env = { ...scrubGitRepoLocationEnv(process.env), GIT_AUTHOR_NAME: "DPF Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "DPF Test", GIT_COMMITTER_EMAIL: "test@example.invalid" };
const git = (cwd, args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const lockName = "dpf-git-fetch.lock";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "dpf-fetch-serialization-"));
  const remote = join(dir, "remote.git"), seed = join(dir, "seed"), first = join(dir, "first"), second = join(dir, "second");
  git(dir, ["init", "--bare", remote]);
  git(dir, ["clone", remote, seed]);
  writeFileSync(join(seed, "value"), "one");
  git(seed, ["add", "value"]); git(seed, ["commit", "-m", "initial"]); git(seed, ["branch", "-M", "main"]); git(seed, ["push", "origin", "main"]);
  git(dir, ["clone", "--branch", "main", remote, first]);
  git(first, ["worktree", "add", "-b", "second", second]);
  writeFileSync(join(seed, "value"), "two"); git(seed, ["commit", "-am", "advance"]); git(seed, ["push", "origin", "main"]);
  return { dir, first, second, advanced: git(seed, ["rev-parse", "HEAD"]), common: git(first, ["rev-parse", "--path-format=absolute", "--git-common-dir"]) };
}

test("linked worktree processes serialize real fetches through the same common directory", { timeout: 15000 }, async () => {
  const f = fixture();
  try {
    const worker = join(f.dir, "worker.mjs");
    writeFileSync(worker, `import {execFileSync} from 'node:child_process';
import {writeFileSync,existsSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {fetchOriginMainSharedSafe} from ${JSON.stringify(new URL("./git-fetch-shared-safe.mjs", import.meta.url).href)};
const [cwd,dir,common,id]=process.argv.slice(2);
const wait=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
writeFileSync(join(dir,'ready'+id),'');const deadline=Date.now()+8000;
while(!existsSync(join(dir,'go'))){if(Date.now()>deadline)throw Error('barrier timeout');wait(5)}
const git=args=>{let fd;if(args[0]==='fetch'){fd=openSync(join(common,'test-ref-update'),'wx');wait(200)}try{return execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']})}finally{if(fd!==undefined){closeSync(fd);unlinkSync(join(common,'test-ref-update'))}}};
try{fetchOriginMainSharedSafe(git);writeFileSync(join(dir,'result'+id),'ok')}catch(e){writeFileSync(join(dir,'result'+id),e.message);process.exitCode=1}
`);
    const children = [f.first, f.second].map((cwd, id) => spawn(process.execPath, [worker, cwd, f.dir, f.common, String(id)], { env, stdio: "pipe", timeout: 10000 }));
    const exits = children.map(child => new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); }));
    const deadline = Date.now() + 8000;
    while (![0, 1].every(id => existsSync(join(f.dir, `ready${id}`)))) {
      assert.ok(Date.now() < deadline, "workers must reach barrier");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    writeFileSync(join(f.dir, "go"), "");
    const statuses = await Promise.all(exits);
    assert.deepEqual([0, 1].map(id => readFileSync(join(f.dir, `result${id}`), "utf8")), ["ok", "ok"]);
    assert.deepEqual(statuses, [0, 0]);
    assert.equal(git(f.first, ["rev-parse", "origin/main"]), f.advanced);
    assert.equal(git(f.second, ["rev-parse", "origin/main"]), f.advanced);
    assert.equal(git(f.first, ["rev-parse", "--is-shallow-repository"]), "false");
    assert.equal(existsSync(join(f.common, lockName)), false);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test("foreign lock remains intact and times out without any fetch, including from a linked worktree", () => {
  const f = fixture();
  try {
    const path = join(f.common, lockName);
    const owned = acquireLocalConvergenceLock({ path, reconcileStale: false });
    assert.equal(owned.status, "acquired");
    let fetches = 0;
    const run = args => { if (args[0] === "fetch") fetches++; return git(f.second, args); };
    assert.throws(() => fetchOriginMainSharedSafe(run, { lockTimeoutMs: 30, lockPollMs: 5 }), /timed out.*shared Git fetch/i);
    assert.equal(fetches, 0);
    assert.equal(JSON.parse(readFileSync(join(path, "owner.json"))).token, owned.owner.token);
    releaseLocalConvergenceLock({ path, token: owned.owner.token });
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test("real fetch failure releases only own lock and does not mask the failure", () => {
  const f = fixture();
  try {
    git(f.first, ["remote", "set-url", "origin", join(f.dir, "missing.git")]);
    assert.throws(() => fetchOriginMainSharedSafe(args => git(f.first, args)), /missing|repository|access/i);
    assert.equal(existsSync(join(f.common, lockName)), false);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test("a foreign lock in one clone does not block a different clone", () => {
  const f = fixture();
  try {
    const other = join(f.dir, "independent");
    git(f.dir, ["clone", "--branch", "main", join(f.dir, "remote.git"), other]);
    const path = join(f.common, lockName);
    const owned = acquireLocalConvergenceLock({ path, reconcileStale: false });
    assert.equal(owned.status, "acquired");
    assert.equal(fetchOriginMainSharedSafe(args => git(other, args), { lockTimeoutMs: 30 }).mode, "full-fetch");
    assert.equal(JSON.parse(readFileSync(join(path, "owner.json"))).token, owned.owner.token);
    releaseLocalConvergenceLock({ path, token: owned.owner.token });
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test("legacy owner uncertainty is retained rather than reclaimed", () => {
  const f = fixture();
  try {
    const path = join(f.common, lockName);
    mkdirSync(path);
    assert.throws(() => fetchOriginMainSharedSafe(args => git(f.first, args), { lockTimeoutMs: 20 }), /timed out/);
    assert.equal(existsSync(path), true);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test("lost cleanup ownership fails closed and never hides an original operation error", () => {
  const f = fixture();
  try {
    const ownerPath = join(f.common, lockName, "owner.json");
    const replaceOwner = () => {
      const owner = JSON.parse(readFileSync(ownerPath));
      writeFileSync(ownerPath, JSON.stringify({ ...owner, token: "fixture-successor" }));
    };
    assert.throws(() => withSharedGitFetchLock(args => git(f.first, args), replaceOwner), /ownership changed/);
    assert.equal(JSON.parse(readFileSync(ownerPath)).token, "fixture-successor");
    // Only disposable fixture state is removed here, never a real shared lock.
    rmSync(join(f.common, lockName), { recursive: true });
    const original = new Error("original fetch refusal");
    assert.throws(() => withSharedGitFetchLock(args => git(f.first, args), () => { replaceOwner(); throw original; }), error => error === original);
    assert.equal(JSON.parse(readFileSync(ownerPath)).token, "fixture-successor");
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test("missing common directory and invalid wait bounds never dispatch a fetch", () => {
  let fetches = 0;
  const fake = args => { if (args[0] === "fetch") fetches++; return ""; };
  assert.throws(() => fetchOriginMainSharedSafe(fake), /absolute common directory/);
  for (const options of [{ lockTimeoutMs: Infinity }, { lockTimeoutMs: -1 }, { lockTimeoutMs: 60001 }, { lockPollMs: 0 }]) {
    assert.throws(() => fetchOriginMainSharedSafe(fake, options), /invalid.*bounds/);
  }
  assert.equal(fetches, 0);
});
