// Tests for the pre-push DCO sign-off gate (BI: pre-push completion gate).
//
// The gate's contract: every commit in the PR payload (origin/main..HEAD,
// MERGE commits included) must carry a Signed-off-by trailer. The failure it
// exists to catch is an unsigned commit — classically a corrupted or
// auto-generated merge commit (PR #4189) that only turns the PR red after the
// push, in CI. It must ALSO stay honest when the host cannot compute the range
// (missing base ref): a warn (exit 2), never a false pass and never a hard fail
// of a genuine offline fork.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { isSignedOff, findUnsignedCommits, resolvePushRange } from "./lib/dco-signoff.mjs";
import { parseArgs, evaluateDcoPush, main } from "./pre-push-dco-check.mjs";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dcoCli = join(repoRoot, "scripts", "pre-push-dco-check.mjs");

const US = "\x1f";
const RS = "\x1e";

// A fake git executor driven by a { [joinedArgs]: {status, stdout, stderr} } map
// or a function. Lets us assert range behavior without spawning git.
function fakeGit(handler) {
  return (args) => {
    const key = args.join(" ");
    const res = typeof handler === "function" ? handler(args) : handler[key];
    if (!res) return { status: 128, stdout: "", stderr: `unexpected git ${key}` };
    return { status: 0, stdout: "", stderr: "", ...res };
  };
}

function logRecord({ sha, subject, body, authorName = "A", authorEmail = "a@b.co" }) {
  return `${sha}${US}${subject}${US}${authorName}${US}${authorEmail}${US}${body}${RS}`;
}

// ---------------------------------------------------------------------------
// isSignedOff — the shared predicate
// ---------------------------------------------------------------------------

test("isSignedOff: matches a trailer line with a value", () => {
  assert.equal(
    isSignedOff("feat: x\n\nSigned-off-by: A B <a@b.co>", {
      authorName: "A B",
      authorEmail: "a@b.co",
    }),
    true,
  );
});

test("isSignedOff: rejects a trailer belonging to a different identity", () => {
  assert.equal(
    isSignedOff("feat: x\n\nSigned-off-by: Bot User <bot@example.com>", {
      authorName: "A B",
      authorEmail: "a@b.co",
    }),
    false,
  );
});

test("isSignedOff: case-insensitive and mid-message", () => {
  assert.equal(
    isSignedOff("wip\n\nsigned-off-by: A B <a@b.co>\n", {
      authorName: "A B",
      authorEmail: "a@b.co",
    }),
    true,
  );
});

test("isSignedOff: missing trailer is unsigned", () => {
  assert.equal(isSignedOff("fix: unsigned"), false);
});

test("isSignedOff: empty / nullish body is unsigned", () => {
  assert.equal(isSignedOff(""), false);
  assert.equal(isSignedOff(undefined), false);
  assert.equal(isSignedOff(null), false);
});

test("isSignedOff: a bare trailer with no value does not count", () => {
  assert.equal(isSignedOff("fix\n\nSigned-off-by:"), false);
  assert.equal(isSignedOff("fix\n\nSigned-off-by:   "), false);
});

test("isSignedOff: does not match the words appearing inside prose", () => {
  // Only a line that STARTS with the trailer counts, so a mention buried in a
  // sentence is not a false pass.
  assert.equal(isSignedOff("This commit is not Signed-off-by anyone really"), false);
});

// ---------------------------------------------------------------------------
// findUnsignedCommits — range scanning, merges included
// ---------------------------------------------------------------------------

test("findUnsignedCommits: returns only unsigned commits, newest first", () => {
  const git = fakeGit(() => ({
    stdout:
      logRecord({ sha: "aaa", subject: "signed", body: "Signed-off-by: A <a@b.co>" }) +
      logRecord({ sha: "bbb", subject: "unsigned merge", body: "corrupted \\ message" }),
  }));
  const unsigned = findUnsignedCommits("origin/main..HEAD", { git });
  assert.equal(unsigned.length, 1);
  assert.equal(unsigned[0].sha, "bbb");
  assert.equal(unsigned[0].subject, "unsigned merge");
});

test("findUnsignedCommits: rejects a present trailer that does not match %an <%ae>", () => {
  const git = fakeGit(() => ({
    stdout: logRecord({
      sha: "ccc",
      subject: "wrong signer",
      authorName: "Human Author",
      authorEmail: "human@example.com",
      body: "Signed-off-by: Automation Bot <bot@example.com>",
    }),
  }));
  const unsigned = findUnsignedCommits("origin/main..HEAD", { git });
  assert.equal(unsigned.length, 1);
  assert.equal(unsigned[0].authorName, "Human Author");
  assert.equal(unsigned[0].authorEmail, "human@example.com");
});

test("findUnsignedCommits: empty range yields no commits", () => {
  const git = fakeGit(() => ({ stdout: "" }));
  assert.deepEqual(findUnsignedCommits("origin/main..HEAD", { git }), []);
});

test("findUnsignedCommits: falsy range short-circuits without calling git", () => {
  let called = false;
  const git = () => {
    called = true;
    return { status: 0, stdout: "" };
  };
  assert.deepEqual(findUnsignedCommits("", { git }), []);
  assert.equal(called, false);
});

test("findUnsignedCommits: throws when git cannot enumerate the range", () => {
  const git = fakeGit(() => ({ status: 128, stderr: "fatal: bad revision" }));
  assert.throws(() => findUnsignedCommits("nope..HEAD", { git }), /bad revision/);
});

// ---------------------------------------------------------------------------
// resolvePushRange — base-ref resolution
// ---------------------------------------------------------------------------

test("resolvePushRange: explicit range wins and needs no base", () => {
  const r = resolvePushRange({ explicitRange: "A..B", git: () => ({ status: 128 }) });
  assert.deepEqual(r, { range: "A..B", baseResolved: true });
});

test("resolvePushRange: computes base..HEAD when base resolves", () => {
  const git = fakeGit({ "rev-parse --verify --quiet origin/main^{commit}": { status: 0 } });
  const r = resolvePushRange({ baseRef: "origin/main", head: "HEAD", git });
  assert.deepEqual(r, { range: "origin/main..HEAD", baseResolved: true });
});

test("resolvePushRange: reports unresolved base without inventing a range", () => {
  const git = fakeGit({ "rev-parse --verify --quiet origin/main^{commit}": { status: 1 } });
  const r = resolvePushRange({ baseRef: "origin/main", git });
  assert.deepEqual(r, { range: null, baseResolved: false });
});

// ---------------------------------------------------------------------------
// parseArgs / evaluateDcoPush — CLI verdict
// ---------------------------------------------------------------------------

test("parseArgs: supports spaced and = forms", () => {
  assert.deepEqual(parseArgs(["--base", "x", "--head", "y", "--range", "a..b"]), {
    base: "x",
    head: "y",
    range: "a..b",
  });
  assert.deepEqual(parseArgs(["--base=x", "--range=a..b"]), {
    base: "x",
    head: "HEAD",
    range: "a..b",
  });
});

test("evaluateDcoPush: code 0 when all commits signed", () => {
  const git = fakeGit({
    "rev-parse --verify --quiet origin/main^{commit}": { status: 0 },
    "log --pretty=format:%H\x1f%s\x1f%an\x1f%ae\x1f%b\x1e origin/main..HEAD": {
      stdout: logRecord({ sha: "aaa", subject: "signed", body: "Signed-off-by: A <a@b.co>" }),
    },
  });
  const v = evaluateDcoPush({ argv: [], env: {}, git });
  assert.equal(v.code, 0);
  assert.equal(v.range, "origin/main..HEAD");
});

test("evaluateDcoPush: code 1 lists unsigned commits", () => {
  const git = fakeGit({
    "rev-parse --verify --quiet origin/main^{commit}": { status: 0 },
    "log --pretty=format:%H\x1f%s\x1f%an\x1f%ae\x1f%b\x1e origin/main..HEAD": {
      stdout: logRecord({ sha: "deadbeef", subject: "unsigned", body: "no trailer" }),
    },
  });
  const v = evaluateDcoPush({ argv: [], env: {}, git });
  assert.equal(v.code, 1);
  assert.equal(v.unsigned.length, 1);
  assert.equal(v.unsigned[0].sha, "deadbeef");
});

test("evaluateDcoPush: code 2 when base ref unresolved and no explicit range", () => {
  const git = fakeGit({
    "rev-parse --verify --quiet origin/main^{commit}": { status: 1 },
  });
  const v = evaluateDcoPush({ argv: [], env: {}, git });
  assert.equal(v.code, 2);
  assert.equal(v.range, null);
});

test("evaluateDcoPush: DPF_PREPUSH_BASE_REF overrides default base", () => {
  const git = fakeGit({
    "rev-parse --verify --quiet accepted-base^{commit}": { status: 0 },
    "log --pretty=format:%H\x1f%s\x1f%an\x1f%ae\x1f%b\x1e accepted-base..HEAD": { stdout: "" },
  });
  const v = evaluateDcoPush({ argv: [], env: { DPF_PREPUSH_BASE_REF: "accepted-base" }, git });
  assert.equal(v.code, 0);
  assert.equal(v.range, "accepted-base..HEAD");
});

// ---------------------------------------------------------------------------
// main — exit-code contract via injected streams (no subprocess)
// ---------------------------------------------------------------------------

function captureMain({ argv = [], env = {} }) {
  const out = [];
  const err = [];
  // main() resolves the range from the real git repo at process.cwd(); callers
  // chdir into a throwaway repo before invoking this.
  const code = main({
    argv,
    env,
    out: { write: (s) => out.push(s) },
    err: { write: (s) => err.push(s) },
  });
  return { code, out: out.join(""), err: err.join("") };
}

test("main: prints unsigned list to stderr and returns 1 (real repo)", () => {
  const dir = makeRepo();
  try {
    git(dir, "checkout", "-q", "-b", "topic");
    git(dir, "commit", "-q", "--allow-empty", "-m", "feat: forgot");
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const r = captureMain({ argv: ["--base", "main"] });
      assert.equal(r.code, 1, r.out + r.err);
      assert.match(r.err, /missing a DCO sign-off/);
    } finally {
      process.chdir(cwd);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// End-to-end: run the real CLI against a throwaway git repo. This is the
// functional proof that an unsigned MERGE commit (PR #4189's failure) is
// blocked at pre-push time, and a fully-signed history passes.
// ---------------------------------------------------------------------------

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "dco-gate-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "dev@example.com");
  git(dir, "config", "user.name", "Dev Example");
  git(dir, "config", "commit.gpgsign", "false");
  git(dir, "commit", "-q", "--allow-empty", "-m", "root\n\nSigned-off-by: Dev Example <dev@example.com>");
  return dir;
}

function runCli(cwd, ...args) {
  const r = spawnSync(process.execPath, [dcoCli, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

test("e2e: signed branch passes (code 0)", () => {
  const dir = makeRepo();
  try {
    git(dir, "checkout", "-q", "-b", "topic");
    git(dir, "commit", "-q", "--allow-empty", "-m", "feat: signed\n\nSigned-off-by: Dev Example <dev@example.com>");
    const r = runCli(dir, "--base", "main");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /all commits in main\.\.HEAD carry a DCO sign-off/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("e2e: unsigned regular commit is blocked (code 1)", () => {
  const dir = makeRepo();
  try {
    git(dir, "checkout", "-q", "-b", "topic");
    git(dir, "commit", "-q", "--allow-empty", "-m", "feat: forgot signoff");
    const r = runCli(dir, "--base", "main");
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.err, /missing a DCO sign-off/);
    assert.match(r.err, /feat: forgot signoff/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("e2e: unsigned MERGE commit is blocked (reproduces PR #4189)", () => {
  const dir = makeRepo();
  try {
    // Build a side branch, then merge it with --no-ff and a message that carries
    // NO Signed-off-by trailer — exactly the corrupted merge PR #4189 pushed.
    git(dir, "checkout", "-q", "-b", "side");
    git(dir, "commit", "-q", "--allow-empty", "-m", "side work\n\nSigned-off-by: Dev Example <dev@example.com>");
    git(dir, "checkout", "-q", "main");
    git(dir, "checkout", "-q", "-b", "topic");
    git(dir, "commit", "-q", "--allow-empty", "-m", "topic work\n\nSigned-off-by: Dev Example <dev@example.com>");
    git(dir, "merge", "-q", "--no-ff", "--no-edit", "side", "-m", "Merge side \\ into topic");
    const r = runCli(dir, "--base", "main");
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.err, /Merge side/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("e2e: unresolved base ref warns (code 2), does not hard-fail", () => {
  const dir = makeRepo();
  try {
    const r = runCli(dir, "--base", "origin/main");
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.err, /does not resolve/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
