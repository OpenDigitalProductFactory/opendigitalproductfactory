import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { planWorktree, safeWorktreeName, verifiedBindingSource } from "./worktree-create.mjs";

// ── planWorktree: canonical sibling base, per-OS ──────────────────────────────

test("Windows root -> sibling D:/DPF-worktrees/<name> off the same drive", () => {
  const p = planWorktree({ mainRoot: "D:/DPF", worktreeName: "quizzical-fermat-04968d" });
  assert.deepEqual(p, {
    base: "D:/DPF-worktrees",
    target: "D:/DPF-worktrees/quizzical-fermat-04968d",
    branch: "quizzical-fermat-04968d",
  });
});

test("backslash root is normalized to forward slashes", () => {
  const p = planWorktree({ mainRoot: "D:\\DPF", worktreeName: "fix-thing" });
  assert.equal(p.target, "D:/DPF-worktrees/fix-thing");
});

test("POSIX root -> ~/dpf-worktrees-style sibling", () => {
  const p = planWorktree({ mainRoot: "/home/dev/dpf", worktreeName: "feat-x" });
  assert.deepEqual(p, {
    base: "/home/dev/dpf-worktrees",
    target: "/home/dev/dpf-worktrees/feat-x",
    branch: "feat-x",
  });
});

test("trailing slash on the root is ignored", () => {
  const p = planWorktree({ mainRoot: "D:/DPF/", worktreeName: "x" });
  assert.equal(p.base, "D:/DPF-worktrees");
});

test("returns null when the name is empty or the root has no parent dir", () => {
  assert.equal(planWorktree({ mainRoot: "D:/DPF", worktreeName: "" }), null);
  assert.equal(planWorktree({ mainRoot: "D:/DPF", worktreeName: "../.." }), null);
  assert.equal(planWorktree({ mainRoot: "noslash", worktreeName: "x" }), null);
  assert.equal(planWorktree({ mainRoot: "", worktreeName: "x" }), null);
});

// ── safeWorktreeName: single safe segment + branch ────────────────────────────

test("safeWorktreeName collapses path separators and strips traversal", () => {
  assert.equal(safeWorktreeName("feat/foo"), "feat-foo");
  assert.equal(safeWorktreeName("a/../b"), "a-b");
  assert.equal(safeWorktreeName("..\\..\\evil"), "evil");
  assert.equal(safeWorktreeName("/abs/path"), "abs-path");
});

test("safeWorktreeName keeps safe chars and trims edge dashes", () => {
  assert.equal(safeWorktreeName("good_name.1"), "good_name.1");
  assert.equal(safeWorktreeName("we!rd@chars"), "we-rd-chars");
  assert.equal(safeWorktreeName("--x--"), "x");
  assert.equal(safeWorktreeName(""), "");
  assert.equal(safeWorktreeName(null), "");
});

// Run the copied package entry point, not a source-tree import that can find
// ../../../scripts by accident. All Git, home and MCP state is fixture-owned.
async function packagedFixture(t, { reply, source = true, helper = true, legacyHelper = false, disconnect = false, drift = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "dpf-packaged-birth-"));
  const root = join(directory, "source checkout #1");
  const pack = join(directory, "package copy #1");
  const home = join(directory, "home");
  const emptyHooks = join(directory, "empty-hooks");
  for (const path of [root, pack, home, emptyHooks]) mkdirSync(path, { recursive: true });
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const copy = (relative, destination) => {
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(repoRoot, relative), destination);
  };
  copy("packages/dpf-skill-pack/hooks/worktree-create.mjs", join(pack, "hooks/worktree-create.mjs"));
  if (source) {
    copy("packages/dpf-skill-pack/toolchain-version.json", join(root, "packages/dpf-skill-pack/toolchain-version.json"));
    writeFileSync(join(root, "AGENTS.md"), "# DPF source fixture\n");
  }
  if (helper) {
    for (const relative of ["scripts/lib/workroom-bind.mjs", "scripts/lib/mcp-client.mjs", "scripts/lib/git.mjs",
      "scripts/lib/mcp-credential.mjs", "scripts/lib/mcp-host-trust.mjs", "scripts/lib/foreground-gate-process.mjs", "scripts/lib/resolve-compose-install-context.mjs",
      "scripts/lib/script-argv.mjs", "packages/dpf-skill-pack/scripts/lib/client-credentials-exchange.mjs"]) {
      // Keep this literal copy loop visible to the shared fixture-import closure guard.
      mkdirSync(dirname(join(root, relative)), { recursive: true });
      copyFileSync(join(repoRoot, relative), join(root, relative));
    }
    if (legacyHelper) writeFileSync(join(root, "scripts/lib/workroom-bind.mjs"),
      "export function bindWorktreeToWorkroom() { throw new Error('legacy helper must not run'); }\n");
  }
  const gitConfig = join(home, "gitconfig");
  writeFileSync(gitConfig, "");
  const gitEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))),
    HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args) => execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", timeout: 10000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: gitEnv,
  }).trim();
  const remote = join(directory, "remotes/OpenDigitalProductFactory/opendigitalproductfactory.git");
  mkdirSync(dirname(remote), { recursive: true });
  git("init", "--quiet", "--bare", "--initial-branch=main", "--template", emptyHooks, remote);
  git("init", "--quiet", "--initial-branch=main", "--template", emptyHooks);
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "core.hooksPath", emptyHooks);
  writeFileSync(join(root, "fixture.txt"), "fixture\n");
  git("add", "."); git("commit", "--quiet", "-m", "source fixture");
  git("remote", "add", "origin", pathToFileURL(remote).href);
  git("push", "--quiet", "-u", "origin", "main");
  const sha = git("rev-parse", "HEAD");
  const calls = [];
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const rpc = JSON.parse(raw);
    calls.push(rpc.params);
    if (disconnect) { request.destroy(); return; }
    const args = rpc.params.arguments;
    if (drift) git("-C", args.worktreePath, "commit", "--quiet", "--allow-empty", "-m", "source moved during admission");
    const answer = reply?.(args) ?? { success: true, data: { capsule: {
      ...args, capsuleId: "WC-COLD-FIXTURE", leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
    } } };
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id,
      result: { content: [{ type: "text", text: JSON.stringify(answer) }] } }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    const absolute = resolve(directory);
    assert.ok(absolute.startsWith(resolve(tmpdir()) + sep), "cleanup must remain inside fixture temp root");
    rmSync(absolute, { recursive: true, force: true, maxRetries: 3 });
  });
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(?:DPF_MCP_|DPF_SESSION_REF$|CODEX_SESSION_ID$|CODEX_THREAD_ID$|CLAUDE_SESSION_ID$|GIT_)/i.test(key)));
  Object.assign(env, { HOME: home, USERPROFILE: home,
    GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: "1",
    DPF_MCP_CLIENT_CREDENTIALS_FILE: join(home, "absent-client.json"),
    DPF_MCP_BEARER_TOKEN: "fixture-only", DPF_MCP_ENDPOINT: `http://127.0.0.1:${server.address().port}/api/mcp/v1`,
    DPF_SESSION_REF: "fixture-session" });
  const run = (worktreeName = "cold-package") => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(pack, "hooks/worktree-create.mjs")], {
      cwd: root, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], timeout: 20000,
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.stdin.end(JSON.stringify({ base_path: root, worktree_name: worktreeName }));
  });
  const target = planWorktree({ mainRoot: root, worktreeName: "cold-package" }).target;
  const markerPath = () => join(git("-C", target, "rev-parse", "--path-format=absolute", "--git-dir"), "dpf-workroom-claim.json");
  return { directory, root, remote, pack, git, target, sha, calls, run, markerPath };
}

test("a cold copied package binds through the source checkout with exact observed SHAs and session", async t => {
  const f = await packagedFixture(t);
  const result = await f.run();
  assert.equal(result.code, 0, result.stderr);
  assert.equal(realpathSync.native(result.stdout), realpathSync.native(f.target), "stdout contains only the created path");
  assert.equal(f.calls.length, 1, result.stderr);
  assert.equal(f.calls[0].name, "adopt_worktree");
  assert.deepEqual({ ...f.calls[0].arguments, title: undefined, objective: undefined, activityKind: undefined }, {
    title: undefined, objective: undefined, activityKind: undefined,
    repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory", headBranch: "cold-package",
    worktreePath: realpathSync.native(f.target).replaceAll("\\", "/"), baseBranch: "main", baseSha: f.sha, headSha: f.sha,
    executorKind: "claude-desktop", sessionRef: "fixture-session", decisionScope: "wwmd", portfolioRole: "foundational",
  });
  assert.equal(JSON.parse(readFileSync(f.markerPath(), "utf8")).capsuleId, "WC-COLD-FIXTURE");
});

for (const scenario of ["foreign-source", "missing-helper", "unsupported-helper", "denied", "conflicting-head", "transport-failure", "source-drift"]) {
  test(`copied package keeps ${scenario} explicit without caching a claim or corrupting stdout`, async t => {
    const f = await packagedFixture(t, {
      source: scenario !== "foreign-source", helper: scenario !== "missing-helper",
      legacyHelper: scenario === "unsupported-helper",
      disconnect: scenario === "transport-failure", drift: scenario === "source-drift",
      reply: scenario === "denied" ? () => ({ success: false, error: "not-authorized", message: "Fixture refusal" })
        : scenario === "conflicting-head" ? args => ({ success: true, data: { capsule: {
          ...args, capsuleId: "WC-COLD-FIXTURE", headSha: "0".repeat(40), leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
        } } }) : undefined,
    });
    const result = await f.run();
    assert.equal(result.code, 0, result.stderr);
    assert.equal(realpathSync.native(result.stdout), realpathSync.native(f.target));
    assert.equal(existsSync(f.markerPath()), false, result.stderr);
    assert.match(result.stderr, /binding unavailable|NOT bound|binding failed/);
    assert.equal(f.calls.length, ["denied", "conflicting-head", "transport-failure", "source-drift"].includes(scenario) ? 1 : 0, result.stderr);
  });
}

test("source validation refuses conflicting branch, nested path, non-Git and foreign repository before import", async t => {
  const f = await packagedFixture(t);
  const binding = { mainRoot: f.root, worktreePath: f.root, branch: "main", headSha: f.sha };
  assert.equal(verifiedBindingSource(binding), realpathSync.native(join(f.root, "scripts/lib/workroom-bind.mjs")));
  assert.throws(() => verifiedBindingSource({ ...binding, branch: "other" }), /conflicts/);
  assert.throws(() => verifiedBindingSource({ ...binding, headSha: "0".repeat(40) }), /conflicts/);
  assert.throws(() => verifiedBindingSource({ ...binding, worktreePath: join(f.root, "packages") }), /conflicts/);
  assert.throws(() => verifiedBindingSource({ ...binding, worktreePath: f.pack }), /git .*failed|Command failed/);
  assert.throws(() => verifiedBindingSource({ ...binding, mainRoot: f.remote }), /conflicts/);
  assert.equal(f.calls.length, 0);
});

test("source validation does not follow a binder junction outside the verified checkout", async t => {
  const f = await packagedFixture(t);
  const original = resolve(f.root, "scripts/lib");
  const outside = resolve(f.directory, "outside-lib");
  for (const path of [original, outside]) assert.ok(path.startsWith(resolve(f.directory) + sep));
  renameSync(original, outside);
  symlinkSync(outside, original, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => verifiedBindingSource({ mainRoot: f.root, worktreePath: f.root, branch: "main", headSha: f.sha }), /escapes/);
  assert.equal(f.calls.length, 0);
});
