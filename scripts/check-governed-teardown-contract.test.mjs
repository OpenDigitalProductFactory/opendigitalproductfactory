import assert from "node:assert/strict";
import test from "node:test";

import { evaluateGovernedTeardownContract } from "./check-governed-teardown-contract.mjs";

const valid = {
  action: 'requireCapability("manage_platform"); runPostgresTrialRestore({ sourceBackupRunId: backup.runId });',
  component: 'mode: "pointer-hold" Press and hold Release to cancel',
  runner: 'timingSafeEqual removeTreeContentsNoFollow --project-name teardown_evidence_inside_source',
  promoterClosure: ['scripts/governed-teardown.mjs', 'scripts/salvage-sweep.mjs'],
  portalDockerfile: 'COPY scripts/governed-teardown.mjs /promoter/scripts/governed-teardown.mjs\nCOPY scripts/salvage-sweep.mjs /promoter/scripts/salvage-sweep.mjs',
  mcpSources: ['name: "request_self_upgrade"'],
};

test("accepts the governed host-handoff contract", () => {
  assert.deepEqual(evaluateGovernedTeardownContract(valid), []);
});

test("rejects a widened capability, typed confirmation, or MCP teardown verb", () => {
  const findings = evaluateGovernedTeardownContract({
    ...valid,
    action: valid.action.replace('manage_platform', 'view_operations'),
    component: '<input name="confirm" /> Type purge',
    mcpSources: [...valid.mcpSources, 'name: "teardown_installation"'],
  });
  assert.ok(findings.some((finding) => finding.includes("manage_platform")));
  assert.ok(findings.some((finding) => finding.includes("pointer-hold")));
  assert.ok(findings.some((finding) => finding.includes("MCP")));
});

test("rejects a runner that drops no-follow deletion or authentic signing", () => {
  const findings = evaluateGovernedTeardownContract({ ...valid, runner: "docker compose down" });
  assert.ok(findings.some((finding) => finding.includes("signature")));
  assert.ok(findings.some((finding) => finding.includes("no-follow")));
  assert.ok(findings.some((finding) => finding.includes("project-scoped")));
});
