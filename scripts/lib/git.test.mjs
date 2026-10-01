// Tests for the shared git runner (plan 2026-09-08 §10.5 S1).
// Run: node --test scripts/lib/git.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GitCommandError, REPO_ROOT, gitText, gitTextOrNull, runGit } from "./git.mjs";

function failingExec(stdout, stderr, status) {
  return () => {
    const e = new Error("Command failed");
    e.stdout = stdout;
    e.stderr = stderr;
    e.status = status;
    throw e;
  };
}

test("runGit reports success with stdout", () => {
  const calls = [];
  const exec = (bin, args, options) => {
    calls.push({ bin, args, options });
    return "abc\n";
  };
  assert.deepEqual(runGit(["rev-parse", "HEAD"], { exec, cwd: "/w" }), { ok: true, stdout: "abc\n", stderr: "", status: 0 });
  assert.equal(calls[0].bin, "git");
  assert.deepEqual(calls[0].args, ["rev-parse", "HEAD"]);
  assert.equal(calls[0].options.cwd, "/w");
  assert.deepEqual(calls[0].options.stdio, ["ignore", "pipe", "pipe"]);
});

test("runGit never throws and keeps partial stdout on failure", () => {
  const r = runGit(["diff"], { exec: failingExec("partial", "fatal: bad ref", 128) });
  assert.deepEqual(r, { ok: false, stdout: "partial", stderr: "fatal: bad ref", status: 128 });
});

test("runGit defaults cwd to the repo root and passes limits through", () => {
  let seen;
  runGit(["status"], { exec: (_b, _a, o) => ((seen = o), ""), maxBuffer: 10, timeout: 5 });
  assert.equal(seen.cwd, REPO_ROOT);
  assert.equal(seen.maxBuffer, 10);
  assert.equal(seen.timeout, 5);
});

test("gitText trims by default, keeps output with trim:false, and throws on failure", () => {
  assert.equal(gitText(["x"], { exec: () => " a \n" }), "a");
  assert.equal(gitText(["x"], { exec: () => "a\n", trim: false }), "a\n");
  assert.throws(
    () => gitText(["show", "nope"], { exec: failingExec("", "fatal: nope", 128) }),
    (e) => e instanceof GitCommandError && e.status === 128 && /git show nope failed: fatal: nope/.test(e.message),
  );
});

test("gitTextOrNull returns null on failure", () => {
  assert.equal(gitTextOrNull(["x"], { exec: () => "v\n" }), "v");
  assert.equal(gitTextOrNull(["x"], { exec: failingExec("", "no", 1) }), null);
});

test("real git: runGit distinguishes a repo from a non-repo", () => {
  const dir = mkdtempSync(join(tmpdir(), "dpf-git-lib-"));
  try {
    assert.equal(runGit(["rev-parse", "--is-inside-work-tree"], { cwd: dir }).ok, false);
    assert.equal(gitTextOrNull(["rev-parse", "--is-inside-work-tree"], { cwd: dir }), null);
    assert.equal(gitText(["init", "-q"], { cwd: dir }), "");
    assert.equal(gitText(["rev-parse", "--is-inside-work-tree"], { cwd: dir }), "true");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
