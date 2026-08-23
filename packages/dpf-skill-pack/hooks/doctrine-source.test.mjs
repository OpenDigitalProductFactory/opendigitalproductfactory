import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveDoctrine, pointerImportsRulebook, doctrineDelivery } from "./lib/doctrine-source.mjs";

/** A root clone + a linked worktree whose own rulebook copy is deliberately different. */
function makePair({ pointer, worktreeRulebook = "# stale worktree rules\n" } = {}) {
  const base = mkdtempSync(join(tmpdir(), "dpf-doc-"));
  const root = join(base, "root");
  const wt = join(base, "wt");
  mkdirSync(root);
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, "AGENTS.md"), "# CURRENT rules from the root clone\n");
  mkdirSync(wt);
  writeFileSync(join(wt, ".git"), "gitdir: elsewhere\n");
  if (worktreeRulebook !== null) writeFileSync(join(wt, "AGENTS.md"), worktreeRulebook);
  if (pointer !== undefined) writeFileSync(join(wt, "CLAUDE.md"), pointer);
  return { root, wt };
}

const gitFor = (wt, root) => (args) => {
  if (args[1] === "--show-toplevel") return wt;
  if (args[1] === "--git-common-dir") return join(root, ".git");
  return null;
};

test("the rulebook resolves from the ROOT CLONE, not the worktree's stale copy", () => {
  const { root, wt } = makePair({ pointer: "prose\n" });
  const r = resolveDoctrine({ cwd: wt, git: gitFor(wt, root) });
  assert.equal(r.ok, true);
  assert.equal(r.source, "root-clone");
  assert.match(r.text, /CURRENT rules from the root clone/);
  assert.equal(r.worktreeDiffers, true, "must report that the worktree copy was behind");
});

test("falls back to the worktree when the root clone is unreachable", () => {
  const { wt } = makePair({ pointer: "prose\n" });
  const git = (args) => (args[1] === "--show-toplevel" ? wt : null);
  const r = resolveDoctrine({ cwd: wt, git });
  assert.equal(r.source, "worktree");
  assert.match(r.text, /stale worktree rules/);
});

test("no rulebook anywhere is reported as not ok, never as a silent pass", () => {
  const { root, wt } = makePair({ pointer: "prose\n", worktreeRulebook: null });
  const git = (args) => (args[1] === "--show-toplevel" ? wt : null);
  const r = resolveDoctrine({ cwd: wt, git });
  assert.equal(r.ok, false);
  assert.equal(r.text, null);
  void root;
});

test("an @AGENTS.md line is an import; a prose link is not", () => {
  const a = makePair({ pointer: "# DPF\n\n@AGENTS.md\n" });
  assert.equal(pointerImportsRulebook({ cwd: a.wt, git: gitFor(a.wt, a.root) }).imports, true);
  const b = makePair({ pointer: "Read [/AGENTS.md](AGENTS.md) before any work.\n" });
  assert.equal(pointerImportsRulebook({ cwd: b.wt, git: gitFor(b.wt, b.root) }).imports, false);
});

test("a conformant pointer needs NO injection — the rulebook is not carried twice", () => {
  const { root, wt } = makePair({ pointer: "@AGENTS.md\n" });
  const d = doctrineDelivery({ cwd: wt, git: gitFor(wt, root) });
  assert.equal(d.mode, "pointer");
  assert.equal(d.needsInjection, false);
  assert.equal(d.loaded, true);
});

test("a stale pointer triggers injection and reports doctrine as loaded", () => {
  const { root, wt } = makePair({ pointer: "Read [/AGENTS.md](AGENTS.md).\n" });
  const d = doctrineDelivery({ cwd: wt, git: gitFor(wt, root) });
  assert.equal(d.mode, "injected");
  assert.equal(d.needsInjection, true);
  assert.equal(d.loaded, true);
  assert.equal(d.resolved.source, "root-clone");
});

test("a missing CLAUDE.md with a reachable rulebook still delivers doctrine", () => {
  const { root, wt } = makePair({ pointer: undefined });
  const d = doctrineDelivery({ cwd: wt, git: gitFor(wt, root) });
  assert.equal(d.pointer.present, false);
  assert.equal(d.loaded, true);
  assert.equal(d.mode, "injected");
});
