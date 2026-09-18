// scripts/pregate-fence-safety.test.mjs
//
// BI-1281A164. Two operating rules that lived only in one AI client's local
// memory, encoded here so nobody has to remember either one.
//
// Both were learned by destroying something. The first killed a gate that was
// exporting its image, because every pregate entry point claims the same
// worktree fence and a stale status line said it was safe to finalize. The
// second burned a full lease and Docker build on a record the pre-push hook
// then refused, because the record keys to the SHA at lease claim rather than
// to the code the build compiled.
//
// The guards are pure so the policy is testable without a git tree or a lease.

import assert from "node:assert/strict";
import test from "node:test";

import { shouldRefuseWhileGateRunning, shouldRefuseDirtyTree } from "./pregate.mjs";

test("refuses any fence-taking invocation while a gate runs in this worktree", () => {
  const record = { status: "running", slot: "slot-0", sha: "abcdef0123456789" };

  for (const args of [[], ["--finalize-evidence"], ["--resume"], ["--dry-run"]]) {
    const verdict = shouldRefuseWhileGateRunning({ args, buildRecord: record });
    assert.equal(verdict.refuse, true, `expected refusal for ${JSON.stringify(args)}`);
  }
});

test("names the running slot and commit so the caller can find the live gate", () => {
  const verdict = shouldRefuseWhileGateRunning({
    args: ["--finalize-evidence"],
    buildRecord: { status: "running", slot: "slot-0", sha: "abcdef0123456789" },
  });

  assert.match(verdict.reason, /slot-0/);
  assert.match(verdict.reason, /abcdef012345/);
  // The caller's next move has to be in the message, or they reach for the
  // thing that caused the incident.
  assert.match(verdict.reason, /read-only/);
  assert.match(verdict.reason, /finalize-evidence/);
});

test("lets help through, and lets every invocation through when no gate is running", () => {
  assert.equal(
    shouldRefuseWhileGateRunning({
      args: ["--help"],
      buildRecord: { status: "running", slot: "slot-0" },
    }).refuse,
    false,
  );

  for (const status of ["passed", "failed", "queued", undefined]) {
    assert.equal(
      shouldRefuseWhileGateRunning({ args: [], buildRecord: { status } }).refuse,
      false,
      `expected no refusal for status=${status}`,
    );
  }
});

test("fails open when the build record cannot be measured", () => {
  // A guard that cannot measure must not block a legitimate gate.
  assert.equal(shouldRefuseWhileGateRunning({ args: [] }).refuse, false);
  assert.equal(shouldRefuseWhileGateRunning({ args: [], buildRecord: null }).refuse, false);
});

test("refuses a real gate run on a dirty tree, because the record would key to the base commit", () => {
  const verdict = shouldRefuseDirtyTree({
    args: [],
    porcelain: " M apps/web/lib/a.ts\n?? scripts/new.mjs\n",
  });

  assert.equal(verdict.refuse, true);
  assert.match(verdict.reason, /2 uncommitted change/);
  // The failure is a stale record key, not a bad build — say so, or the reader
  // concludes the gate is broken and reaches for the push override.
  assert.match(verdict.reason, /lease claim/);
  assert.match(verdict.reason, /Commit first/);
  assert.match(verdict.reason, /override/);
});

test("does not refuse invocations that build nothing", () => {
  const porcelain = " M apps/web/lib/a.ts\n";

  for (const args of [["--finalize-evidence"], ["--dry-run"], ["--help"], ["-h"]]) {
    assert.equal(
      shouldRefuseDirtyTree({ args, porcelain }).refuse,
      false,
      `expected no refusal for ${JSON.stringify(args)}`,
    );
  }
});

test("treats a clean or unmeasurable tree as nothing to refuse on", () => {
  assert.equal(shouldRefuseDirtyTree({ args: [], porcelain: "" }).refuse, false);
  assert.equal(shouldRefuseDirtyTree({ args: [], porcelain: "   \n  \n" }).refuse, false);
  assert.equal(shouldRefuseDirtyTree({ args: [] }).refuse, false);
});
