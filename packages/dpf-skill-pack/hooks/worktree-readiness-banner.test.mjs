import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const hook = join(here, "worktree-readiness-banner.mjs");
const repoRoot = join(here, "..", "..", "..");

function runHook(cwd) {
  const r = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ hook_event_name: "SessionStart", cwd }),
    encoding: "utf8",
    env: { ...process.env, DPF_GUARDS_WORKSPACE_ANY: "1" },
  });
  return { status: r.status, stdout: r.stdout.trim() };
}

/**
 * A worktree-shaped tree that is DPF-recognisable (packages/dpf-skill-pack) and
 * carries the real probe, but has no node_modules — the observed condition.
 */
function makeSourceOnlyTree() {
  const dir = mkdtempSync(join(tmpdir(), "dpf-readiness-"));
  mkdirSync(join(dir, "packages", "dpf-skill-pack"), { recursive: true });
  mkdirSync(join(dir, "scripts", "lib"), { recursive: true });
  writeFileSync(
    join(dir, "scripts", "lib", "bootstrap-worktree-deps.mjs"),
    readFileSync(join(repoRoot, "scripts", "lib", "bootstrap-worktree-deps.mjs"), "utf8"),
  );
  return dir;
}

test("announces SOURCE-ONLY and names the missing pieces and what they forbid", () => {
  const dir = makeSourceOnlyTree();
  const r = runHook(dir);
  assert.equal(r.status, 0);
  const context = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.match(context, /SOURCE-ONLY/);
  assert.match(context, /root node_modules/);
  assert.match(context, /apps\/web\/node_modules/);
  assert.match(context, /packages\/db\/generated/);
  assert.match(context, /'next' is not recognized/, "must name the symptom the operator will actually see");
  assert.match(context, /do not claim a gate you cannot run/i);
});

test("an EMPTY apps/web/node_modules still reports as missing", () => {
  // The exact observed shape: the directory exists with zero entries.
  const dir = makeSourceOnlyTree();
  mkdirSync(join(dir, "apps", "web", "node_modules"), { recursive: true });
  const context = JSON.parse(runHook(dir).stdout).hookSpecificOutput.additionalContext;
  assert.match(context, /apps\/web\/node_modules \(empty\)/);
});

test("the banner is READ-ONLY — it creates nothing under node_modules", () => {
  const dir = makeSourceOnlyTree();
  runHook(dir);
  assert.equal(existsSync(join(dir, "node_modules")), false, "the hook must never provision");
  assert.equal(existsSync(join(dir, "apps", "web", "node_modules")), false);
});

test("the escape hatch silences it", () => {
  const dir = makeSourceOnlyTree();
  const r = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ hook_event_name: "SessionStart", cwd: dir }),
    encoding: "utf8",
    env: { ...process.env, DPF_GUARDS_WORKSPACE_ANY: "1", DPF_SKIP_WORKTREE_READINESS_BANNER: "1" },
  });
  assert.equal(r.stdout.trim(), "");
});

test("stays out of non-DPF workspaces", () => {
  const dir = mkdtempSync(join(tmpdir(), "not-dpf-"));
  const r = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ hook_event_name: "SessionStart", cwd: dir }),
    encoding: "utf8",
    env: { ...process.env, DPF_GUARDS_WORKSPACE_ANY: "" },
  });
  assert.equal(r.stdout.trim(), "");
});

test("fails open on an unreadable payload rather than breaking session start", () => {
  const r = spawnSync(process.execPath, [hook], {
    input: "{not json",
    encoding: "utf8",
    env: { ...process.env, DPF_GUARDS_WORKSPACE_ANY: "1" },
  });
  assert.equal(r.status, 0);
});
