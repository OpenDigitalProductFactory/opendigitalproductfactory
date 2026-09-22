// Contract: the pre-push gate's reader and pregate's writer must not drift.
//
// BI-A167CF8A. pregate writes SLOT-SCOPED gate records
// (dpf-local-ci-gate-slot-N.json). The hook used to stat an unslotted
// dpf-local-ci-gate.json, which is written by exactly one path — the override
// branch, as {gatePassed:false, skipped:true}. So the file the hook consulted
// for a PASS could never contain one: a genuine, evidence-backed pregate PASS
// was invisible, and the only way past a mandatory gate was the override.
//
// This reads the real hook and the real status script, in the spirit of the
// other conformance tests that assert on repository content.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hook = readFileSync(resolve(repoRoot, ".githooks/pre-push-gate"), "utf8");
const status = readFileSync(resolve(repoRoot, "scripts/pregate-status.mjs"), "utf8");

test("the hook decides PASS by delegating to the canonical slot-aware reader", () => {
  assert.match(
    hook,
    /node\s+scripts\/pregate-status\.mjs/,
    "pre-push-gate must ask scripts/pregate-status.mjs for the verdict rather than resolving gate records itself",
  );
});

test("the delegated verdict is consulted BEFORE the legacy unslotted lookup", () => {
  const delegation = hook.indexOf("node scripts/pregate-status.mjs");
  const legacy = hook.indexOf('if [ ! -f "$state_file" ]');

  assert.notEqual(delegation, -1, "delegation to pregate-status.mjs is missing");
  assert.notEqual(legacy, -1, "legacy unslotted fallback is missing");
  assert.ok(
    delegation < legacy,
    "the unslotted lookup is a fallback for trees without pregate-status.mjs; if it runs first it shadows every slot-scoped PASS, which is the original defect",
  );
});

test("the unslotted record is the override receipt, not a pass channel", () => {
  // The override branch is the only writer of the unslotted file, and it records
  // a non-pass. If that ever becomes a pass, a recorded skip would be
  // indistinguishable from verified work in the audit trail.
  assert.match(
    hook,
    /gatePassed:\s*false,\s*\n\s*skipped:\s*true/,
    "the override record must stay {gatePassed:false, skipped:true}",
  );
});

test("the canonical reader is slot-aware and PASS-gated on exit code", () => {
  // The hook now trusts this script's exit code, so both properties are
  // load-bearing: drop either and the hook silently mis-decides.
  assert.match(
    status,
    /createLocalCiSlotManifest/,
    "pregate-status.mjs must resolve records through the slot manifest",
  );
  assert.match(
    status,
    /exitCodeForVerdict/,
    "pregate-status.mjs must exit non-zero for any verdict that is not a PASS for the current HEAD",
  );
});

// BI-02E5F2A1: `gate-infrastructure-unavailable` is evidence-gated in the hook.
test("the hook allowlists gate-infrastructure-unavailable in its inline code set", () => {
  const inlineSet = hook.slice(hook.indexOf("const codes = new Set(["), hook.indexOf("]);", hook.indexOf("const codes = new Set([")));
  assert.match(inlineSet, /"gate-infrastructure-unavailable"/);
});

test("the hook captures the lease-claim failure BEFORE writing the override record, and refuses without the probe", () => {
  const probe = hook.indexOf("node scripts/pre-push-gate-infrastructure-probe.mjs");
  const writer = hook.indexOf("infrastructureEvidence = probe.evidence");
  assert.notEqual(probe, -1, "the hook must re-attempt the lease claim via the probe");
  assert.notEqual(writer, -1, "the record must embed the captured evidence");
  assert.ok(probe < writer, "evidence is captured before the record is written");
  assert.match(hook, /\[ ! -f "scripts\/pre-push-gate-infrastructure-probe\.mjs" \][\s\S]*?refusing/, "a checkout without the probe cannot capture evidence and must refuse the code");
  assert.match(hook, /gate-infrastructure-unavailable refused: no infrastructure failure was captured/);
});

test("the gate-infrastructure-unavailable record is gate-UNRUN, never a pass", () => {
  assert.match(hook, /record\.status = "gate-unrun";\s*\n\s*record\.gateUnrun = true;/);
  assert.match(hook, /gate-UNRUN recorded for/);
  assert.doesNotMatch(hook, /gatePassed:\s*true[\s\S]*infrastructureEvidence/, "the evidence path must not mint a pass");
});
