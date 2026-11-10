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

// BI-1D04A29F: batch commands need stdin, and byte-counted batch output needs a Buffer.
test("input feeds stdin and binary returns a Buffer", () => {
  let seen;
  const exec = (_cmd, _args, options) => {
    seen = options;
    return Buffer.from("ok\n");
  };
  const out = gitText(["cat-file", "--batch"], { exec, input: "abc\n", binary: true });
  assert.ok(Buffer.isBuffer(out));
  assert.equal(seen.input, "abc\n");
  assert.equal(seen.stdio[0], "pipe");
  assert.equal(seen.encoding, undefined);
});

test("without input stdin stays ignored and output is utf8 text", () => {
  let seen;
  const exec = (_cmd, _args, options) => {
    seen = options;
    return " text \n";
  };
  assert.equal(gitText(["status"], { exec }), "text");
  assert.equal(seen.stdio[0], "ignore");
  assert.equal(seen.encoding, "utf8");
});

test("reads a tracked-file inventory beyond Node's 1 MiB default without ignoring explicit limits", () => {
  const cwd = mkdtempSync(join(tmpdir(), "dpf-git-inventory-"));
  try {
    assert.equal(runGit(["init", "--quiet"], { cwd }).ok, true);
    const blob = gitText(["hash-object", "-w", "--stdin"], { cwd, input: "" });
    // Virtual index entries need no worktree files. Each path component stays
    // within normal filesystem limits while the complete inventory exceeds 1 MiB.
    const directory = ["docs", "a".repeat(220), "b".repeat(220), "c".repeat(220)].join("/");
    const paths = Array.from({ length: 1700 }, (_, i) => `${directory}/fixture-${String(i).padStart(4, "0")}.md`);
    const expected = paths.join("\0") + "\0";
    assert.ok(Buffer.byteLength(expected) > 1024 * 1024);
    const input = paths.map(file => `100644 ${blob}\t${file}\n`).join("");
    assert.equal(runGit(["update-index", "--add", "--index-info"], { cwd, input }).ok, true);
    assert.equal(gitText(["ls-files", "-z"], { cwd, trim: false }), expected);
    const binary = runGit(["ls-files", "-z"], { cwd, binary: true });
    assert.equal(binary.ok, true);
    assert.ok(binary.stdout.equals(Buffer.from(expected)));
    const bounded = runGit(["ls-files", "-z"], { cwd, maxBuffer: 64 * 1024 });
    assert.equal(bounded.ok, false);
    assert.match(bounded.stderr, /ENOBUFS|maxBuffer/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
