import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const promoter = readFileSync(resolve(root, "apps/web/lib/self-upgrade/promoter.ts"), "utf8");
const script = readFileSync(resolve(root, "scripts/promote.sh"), "utf8");
const contract = JSON.parse(readFileSync(resolve(root, "promoter-contract.json"), "utf8"));

test("promoter internal state path cannot override install env host interpolation", () => {
  const installEnv = { DPF_STATE_DIR: "C:\\Users\\operator\\.dpf" };
  const promoterContainerEnv = { DPF_PROMOTER_STATE_DIR: "/dpf-state" };
  const composeInterpolationEnv = { ...installEnv, ...promoterContainerEnv };

  assert.equal(composeInterpolationEnv.DPF_STATE_DIR, installEnv.DPF_STATE_DIR);
  assert.notEqual(composeInterpolationEnv.DPF_STATE_DIR, promoterContainerEnv.DPF_PROMOTER_STATE_DIR);
  assert.match(promoter, /DPF_PROMOTER_STATE_DIR=\/dpf-state/);
  assert.doesNotMatch(promoter, /["`]DPF_STATE_DIR=\/dpf-state/);
  assert.doesNotMatch(script, /\$\{DPF_STATE_DIR:-\/dpf-state\}/);
  assert.match(script, /force-recreate portal/);
  assert.match(script, /force-recreate sandbox/);
  assert.ok(contract.requiredEnvironment.includes("DPF_PROMOTER_STATE_DIR"));
  assert.ok(!contract.requiredEnvironment.includes("DPF_STATE_DIR"));
});
