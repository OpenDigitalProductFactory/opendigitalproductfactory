import assert from "node:assert/strict";
import { test } from "node:test";

import { PROBES, probeGuard, runAllProbes, formatProbeReport } from "./guard-liveness-probe.mjs";

test("every probe payload is one the guard is REQUIRED to deny", () => {
  for (const p of PROBES) {
    const r = probeGuard(p);
    assert.equal(r.verdict, "deny-proven", `${p.script} did not deny: ${p.what} (${r.detail})`);
  }
});

test("root-clone-guard denies from a sibling-base worktree (BI-B49665EA regression)", () => {
  // The probe's cwd defaults to the hooks dir, which lives in a sibling-base
  // worktree. Before the fix this returned NOT-ENFORCING: the guard could not
  // derive the clone root outside .claude/worktrees, so `rm -rf <root>/apps`
  // was permitted from 88 of 99 live worktrees.
  const probe = PROBES.find((p) => p.script === "root-clone-guard.mjs");
  assert.ok(probe, "the root-clone probe must exist");
  assert.equal(probeGuard(probe).verdict, "deny-proven");
});

test("a guard that allows a must-deny payload is reported NOT-ENFORCING, not skipped", () => {
  const bogus = {
    script: "compose-guard.mjs",
    what: "a plainly harmless read the guard should allow",
    payload: { tool_name: "Bash", tool_input: { command: "echo hello" } },
  };
  assert.equal(probeGuard(bogus).verdict, "NOT-ENFORCING");
});

test("a missing guard script is reported, never treated as passing", () => {
  const r = probeGuard({ script: "no-such-guard.mjs", what: "x", payload: {} });
  assert.equal(r.verdict, "missing");
});

test("wired guards with no probe are reported UNPROBED rather than assumed working", () => {
  const results = runAllProbes();
  const unprobed = results.filter((r) => r.verdict === "UNPROBED");
  assert.ok(unprobed.length > 0, "there are still unprobed guards; they must be visible");
  for (const r of unprobed) assert.notEqual(r.verdict, "deny-proven");
});

test("the report states the Codex trust caveat — a local probe cannot prove the host runs the hook", () => {
  const text = formatProbeReport(runAllProbes()).join("\n");
  assert.match(text, /cannot prove the host runs it/);
  assert.match(text, /openai\/codex#21615/);
});

test("the report counts proven guards and never counts UNPROBED among them", () => {
  const results = runAllProbes();
  const text = formatProbeReport(results).join("\n");
  const proven = results.filter((r) => r.verdict === "deny-proven").length;
  assert.match(text, new RegExp(`${proven} of ${results.length} proven to deny`));
});
