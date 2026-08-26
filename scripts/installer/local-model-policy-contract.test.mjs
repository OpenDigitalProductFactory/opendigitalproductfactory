import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const repoRoot = new URL("../../", import.meta.url);

function read(path) {
  return readFileSync(new URL(path, repoRoot), "utf8");
}

test("fresh-install model tiers come from one curated policy", () => {
  const policy = JSON.parse(read("scripts/installer/local-model-policy.json"));

  assert.equal(policy.modelHeadroomGb, 5);
  assert.ok(policy.tiers.length >= 4);
  assert.ok(policy.tiers.every((tier) => tier.model.startsWith("ai/")));
  assert.deepEqual(
    policy.tiers.map((tier) => tier.weightsGb),
    [...policy.tiers].map((tier) => tier.weightsGb).sort((a, b) => b - a),
  );
  assert.equal(policy.tiers.find((tier) => tier.model === "ai/qwen3-coder")?.weightsGb, 16);
});

test("the web policy, host detector, and Windows installer consume the canonical policy", () => {
  const webPolicy = read("apps/web/lib/inference/local-model-policy.ts");
  const hostDetector = read("scripts/detect-hardware-host.ts");
  const windowsInstaller = read("install-dpf.ps1");

  assert.match(webPolicy, /local-model-policy\.json/);
  assert.match(hostDetector, /local-model-policy\.json/);
  assert.match(windowsInstaller, /local-model-policy\.json/);

  for (const source of [webPolicy, hostDetector, windowsInstaller]) {
    assert.doesNotMatch(source, /hf\.co\/ggml-org\/Qwen3\.8-27B/);
    assert.doesNotMatch(source, /sha256:66c4f325/);
  }
});

test("the default install policy cannot reintroduce mutable third-party model references", () => {
  const policy = JSON.parse(read("scripts/installer/local-model-policy.json"));
  const external = policy.tiers.filter((tier) => !tier.model.startsWith("ai/"));

  assert.deepEqual(external, []);
});
