import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { canReuseBuildReceipt } from "./local-ci-bounded-build.mjs";

const source = readFileSync(new URL("./local-ci-bounded-build.mjs", import.meta.url), "utf8");
const integrationSource = readFileSync(new URL("./local-integration-ci.mjs", import.meta.url), "utf8");

test("production build writes a durable stage receipt before and during Docker work", () => {
  assert.match(source, /createStageReceiptWriter/);
  assert.match(source, /stage:\s*"production-build"/);
  assert.match(source, /stageReceipt\.start/);
  assert.match(source, /onSample:\s*\(sample\)\s*=>\s*stageReceipt\.heartbeat/);
  assert.match(source, /canonicalStageReceiptStatus\(finalStatus\)/);
  assert.match(source, /stageReceipt\.complete\(receiptStatus/);
  assert.match(source, /\.build\.json/);
});

test("production build reuses a passed receipt only when the image ID still matches", () => {
  const identity = {
    candidateSha: "candidate-a",
    integrationTreeSha: "tree-a",
    imageTag: "dpf-local-ci:tree-a",
    command: "docker buildx build",
  };
  const receipt = {
    schemaVersion: 1,
    stage: "production-build",
    identity,
    status: "passed",
    artifact: { imageTag: identity.imageTag, imageId: "sha256:image-a" },
  };
  let inspected = 0;
  assert.equal(canReuseBuildReceipt({
    receipt,
    identity,
    resolveImageId: () => {
      inspected += 1;
      return "sha256:image-a";
    },
  }), true);
  assert.equal(inspected, 1);
  assert.equal(canReuseBuildReceipt({
    receipt,
    identity: { ...identity, integrationTreeSha: "tree-b" },
    resolveImageId: () => {
      inspected += 1;
      return "sha256:image-a";
    },
  }), false);
  assert.equal(inspected, 1, "an identity mismatch must not inspect Docker");
  assert.equal(canReuseBuildReceipt({
    receipt,
    identity,
    resolveImageId: () => "sha256:image-b",
  }), false);
  assert.equal(canReuseBuildReceipt({
    receipt: { ...receipt, artifact: null },
    identity,
    resolveImageId: () => {
      inspected += 1;
      return "sha256:image-a";
    },
  }), false);
  assert.equal(inspected, 1, "a receipt without an artifact ID must not inspect Docker");
});

test("local-integration metadata carries the durable production-build receipt", () => {
  assert.match(integrationSource, /DPF_LOCAL_CI_BUILD_RECEIPT_FILE/);
  assert.match(integrationSource, /productionBuild:\s*buildDiagnostics/);
});
