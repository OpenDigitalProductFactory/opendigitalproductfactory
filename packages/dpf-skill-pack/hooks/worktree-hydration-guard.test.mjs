import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { GUARD_MESSAGE, decide } from "./worktree-hydration-guard.mjs";

function fixture(name, readiness) {
  const root = mkdtempSync(join(tmpdir(), `dpf-hydration-${name}-`));
  const worktree = join(root, "dpf-worktrees", name);
  mkdirSync(worktree, { recursive: true });
  writeFileSync(join(worktree, ".git"), `gitdir: ${root}/repo/.git/worktrees/${name}\n`);
  if (readiness) {
    writeFileSync(
      join(worktree, ".dpf-worktree-readiness.json"),
      JSON.stringify({ schemaVersion: 1, state: readiness, reason: `${readiness}_test` }) + "\n",
    );
  }
  return { root, worktree };
}

function rootCloneFixture() {
  const root = mkdtempSync(join(tmpdir(), "dpf-root-"));
  mkdirSync(join(root, ".git"), { recursive: true });
  return root;
}

test("source-only worktree plus pnpm install is blocked", () => {
  const f = fixture("source-install", "source-only");
  try {
    const verdict = decide({ command: "pnpm install", cwd: f.worktree });
    assert.equal(verdict.action, "block");
    assert.equal(verdict.reason, GUARD_MESSAGE);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("source-only worktree plus pnpm --filter web build is blocked with local-CI guidance", () => {
  const f = fixture("source-build", "source-only");
  try {
    const verdict = decide({ command: "pnpm --filter web build", cwd: f.worktree });
    assert.equal(verdict.action, "block");
    assert.match(verdict.reason, /local-integration-ci/);
    assert.match(verdict.reason, /Do not hydrate this worktree/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("local-integration-ci text alone is not a bypass", () => {
  const f = fixture("comment-bypass", "source-only");
  try {
    assert.equal(
      decide({ command: "pnpm install # will use local-integration-ci later", cwd: f.worktree }).action,
      "block",
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("missing marker under ~/dpf-worktrees is treated as source-only and blocked", () => {
  const f = fixture("missing-marker");
  try {
    assert.equal(decide({ command: "pnpm i", cwd: f.worktree }).action, "block");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("root clone and canonical runner are allowed", () => {
  const root = rootCloneFixture();
  try {
    assert.equal(decide({ command: "pnpm install", cwd: root }).action, "allow");
    assert.equal(
      decide({ command: "pnpm --filter web build", cwd: "/tmp/topic", env: { DPF_CANONICAL_RUNNER: "1" } }).action,
      "allow",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compile-ready marker allows cheap source-local checks only", () => {
  const f = fixture("compile-ready", "compile-ready");
  try {
    assert.equal(decide({ command: "pnpm --filter web exec vitest run", cwd: f.worktree }).action, "allow");
    assert.equal(decide({ command: "pnpm --filter web typecheck", cwd: f.worktree }).action, "allow");
    assert.equal(decide({ command: "pnpm --filter web build", cwd: f.worktree }).action, "block");
    assert.equal(decide({ command: "pnpm install", cwd: f.worktree }).action, "block");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("explicit override allows but reports an audit warning", () => {
  const f = fixture("override", "source-only");
  try {
    const verdict = decide({
      command: "DPF_ALLOW_WORKTREE_HYDRATION=1 pnpm install",
      cwd: f.worktree,
    });
    assert.equal(verdict.action, "warn");
    assert.match(verdict.reason, /Emergency worktree hydration override/);
    assert.match(verdict.reason, /audit/i);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
