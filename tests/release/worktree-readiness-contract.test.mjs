import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const repoRoot = new URL("../..", import.meta.url);
const seedScript = new URL("../../scripts/seed-worktree-mcp.sh", import.meta.url);
const syncScript = new URL("../../scripts/sync-mcp-worktrees.sh", import.meta.url);

function readRepo(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
  });
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result;
}

function createRepoWithWorktree(name = "topic") {
  const root = mkdtempSync(join(tmpdir(), "dpf-worktree-readiness-"));
  const origin = join(root, "origin.git");
  const repo = join(root, "repo");
  const worktree = join(root, name);

  run("git", ["init", "--bare", origin], { cwd: root });
  run("git", ["clone", origin, repo], { cwd: root });
  run("git", ["config", "user.email", "test@example.com"], { cwd: repo });
  run("git", ["config", "user.name", "test"], { cwd: repo });
  mkdirSync(join(repo, ".vscode"), { recursive: true });
  writeFileSync(join(repo, ".mcp.json"), '{"mcpServers":{"dpf":{"url":"http://127.0.0.1:3000/api/mcp/v1"}}}\n');
  writeFileSync(join(repo, ".vscode", "mcp.json"), '{"servers":{"dpf":{"url":"http://127.0.0.1:3000/api/mcp/v1"}}}\n');
  writeFileSync(join(repo, "README.md"), "# test\n");
  run("git", ["add", "README.md"], { cwd: repo });
  run("git", ["commit", "-m", "initial"], { cwd: repo });
  run("git", ["worktree", "add", worktree, "-b", `feat/${name}`], { cwd: repo });

  return { root, repo, worktree };
}

function readReadiness(worktree) {
  return JSON.parse(readFileSync(join(worktree, ".dpf-worktree-readiness.json"), "utf8"));
}

test("seed-worktree-mcp.sh writes MCP config, Compose isolation, and source-only readiness", () => {
  const fixture = createRepoWithWorktree("seed-topic");
  try {
    run("sh", [seedScript.pathname, fixture.worktree]);

    assert.equal(readFileSync(join(fixture.worktree, ".mcp.json"), "utf8"), readFileSync(join(fixture.repo, ".mcp.json"), "utf8"));
    assert.equal(
      readFileSync(join(fixture.worktree, ".vscode", "mcp.json"), "utf8"),
      readFileSync(join(fixture.repo, ".vscode", "mcp.json"), "utf8"),
    );
    assert.match(readFileSync(join(fixture.worktree, ".env"), "utf8"), /^COMPOSE_PROJECT_NAME=dpf-seed-topic$/m);

    const readiness = readReadiness(fixture.worktree);
    assert.equal(readiness.schemaVersion, 1);
    assert.equal(readiness.state, "source-only");
    assert.equal(readiness.reason, "node_modules_missing");
    assert.equal(readiness.checks.nodeModulesPresent, false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("seed-worktree-mcp.sh preserves a custom non-root COMPOSE_PROJECT_NAME", () => {
  const fixture = createRepoWithWorktree("custom-compose");
  try {
    writeFileSync(join(fixture.worktree, ".env"), "COMPOSE_PROJECT_NAME=dpf-custom\n");

    run("sh", [seedScript.pathname, fixture.worktree]);

    assert.equal(readFileSync(join(fixture.worktree, ".env"), "utf8"), "COMPOSE_PROJECT_NAME=dpf-custom\n");
    assert.equal(readReadiness(fixture.worktree).state, "source-only");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("sync-mcp-worktrees.sh refreshes linked worktrees and stamps readiness markers", () => {
  const fixture = createRepoWithWorktree("sync-topic");
  try {
    mkdirSync(join(fixture.repo, "scripts"), { recursive: true });
    copyFileSync(syncScript.pathname, join(fixture.repo, "scripts", "sync-mcp-worktrees.sh"));

    run("sh", [join(fixture.repo, "scripts", "sync-mcp-worktrees.sh")]);

    assert.match(readFileSync(join(fixture.worktree, ".env"), "utf8"), /^COMPOSE_PROJECT_NAME=dpf-sync-topic$/m);
    assert.equal(readReadiness(fixture.worktree).reason, "node_modules_missing");
    assert.equal(readFileSync(join(fixture.worktree, ".mcp.json"), "utf8"), readFileSync(join(fixture.repo, ".mcp.json"), "utf8"));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("PowerShell worktree sync/seed scripts retain readiness-marker parity", () => {
  const seedPs1 = readRepo("scripts/seed-worktree-mcp.ps1");
  const syncPs1 = readRepo("scripts/sync-mcp-worktrees.ps1");

  for (const [path, contents] of [
    ["scripts/seed-worktree-mcp.ps1", seedPs1],
    ["scripts/sync-mcp-worktrees.ps1", syncPs1],
  ]) {
    assert.match(contents, /\.dpf-worktree-readiness\.json/, `${path} must write the readiness marker`);
    assert.match(contents, /compile-ready/, `${path} must preserve compile-ready classification`);
    assert.match(contents, /source-only/, `${path} must preserve source-only classification`);
    assert.match(contents, /node_modules_missing/, `${path} must report missing node_modules`);
    assert.match(contents, /pnpm_corepack_missing/, `${path} must report missing package manager`);
  }

  assert.match(syncPs1, /Copy-WorktreeFile/, "sync script should copy MCP files portably");
  assert.doesNotMatch(syncPs1, /fsutil\s+hardlink/i, "sync script must not regress to D-drive-only hardlinks");
});
