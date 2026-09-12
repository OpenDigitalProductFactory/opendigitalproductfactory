// BI-FFCFCCE0 — `pregate -- --finalize-evidence` resolved its record before
// admission, so it always read slot-0's UNSLOTTED `dpf-local-ci-gate.json`
// while `pregate:status` reconciles across every `dpf-local-ci-gate-slot-*.json`.
// A real pending PASS recorded on slot-1 was therefore unfinalizable, and the
// two commands disagreed about which record was authoritative.

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { resolveFinalizeSlot } from "./gate-worktree.mjs";
import { createLocalCiSlotManifest } from "./lib/local-ci-slot-manifest.mjs";
import { writeLocalCiGateState } from "./lib/local-ci-gate-state.mjs";

const BRANCH = "fix/principle-decide-requires-option-id";
const SHA = "04f681eae8d6c3f19a0d3d6e5c9c9b1f2a3b4c5d";

function fixture() {
  const rootClone = mkdtempSync(join(tmpdir(), "dpf-finalize-slot-"));
  const gitCommonDir = join(rootClone, ".git");
  const candidateGitDir = join(gitCommonDir, "worktrees", "candidate");
  mkdirSync(candidateGitDir, { recursive: true });
  return { rootClone, gitCommonDir, candidateGitDir };
}

function manifestFor(slotKey, paths) {
  return createLocalCiSlotManifest({ slotKey, ...paths });
}

test("a pending PASS on slot-1 is found, not refused because slot-0 is empty", () => {
  const paths = fixture();
  const slot1 = manifestFor("slot-1", paths);
  writeFileSync(
    slot1.evidence.pending,
    `${JSON.stringify({ branch: BRANCH, sha: SHA, recordArgs: {} }, null, 2)}\n`,
  );

  const resolved = resolveFinalizeSlot({ branch: BRANCH, sha: SHA, ...paths, defaultSlotKey: "slot-0" });

  assert.equal(resolved.manifest.slotKey, "slot-1");
  assert.equal(resolved.matchedBy, "pending");
});

test("a published PASS on slot-1 is found when no pending record exists", () => {
  const paths = fixture();
  const slot1 = manifestFor("slot-1", paths);
  writeLocalCiGateState(slot1.evidence.state, {
    branch: BRANCH,
    sha: SHA,
    gatePassed: true,
    leaseId: "NPEL-50DF305E6C",
    evidenceId: "cmtv4u0220h4301qn5r8le9ev",
    status: "passed",
    expiresAt: "2026-09-11T06:00:00.000Z",
    resilience: null,
    leaseEvents: [],
  });

  const resolved = resolveFinalizeSlot({ branch: BRANCH, sha: SHA, ...paths, defaultSlotKey: "slot-0" });

  assert.equal(resolved.manifest.slotKey, "slot-1");
  assert.equal(resolved.matchedBy, "published-pass");
});

test("a record for another candidate does not claim the finalize, and the refusal can name every path searched", () => {
  const paths = fixture();
  const slot1 = manifestFor("slot-1", paths);
  writeLocalCiGateState(slot1.evidence.state, {
    branch: BRANCH,
    sha: "f".repeat(40),
    gatePassed: true,
    leaseId: "NPEL-OTHER",
    evidenceId: "E-other",
    status: "passed",
    expiresAt: "2026-09-11T06:00:00.000Z",
    resilience: null,
    leaseEvents: [],
  });

  const resolved = resolveFinalizeSlot({ branch: BRANCH, sha: SHA, ...paths, defaultSlotKey: "slot-0" });

  assert.equal(resolved.matchedBy, "none");
  assert.equal(resolved.manifest.slotKey, "slot-0");
  // Both slots' pending AND state paths are reported, so an operator reading the
  // refusal can tell a missing record from one the gate failed to look for.
  for (const slotKey of ["slot-0", "slot-1"]) {
    const manifest = manifestFor(slotKey, paths);
    assert.ok(resolved.searched.includes(manifest.evidence.pending), `${slotKey} pending`);
    assert.ok(resolved.searched.includes(manifest.evidence.state), `${slotKey} state`);
  }
});
