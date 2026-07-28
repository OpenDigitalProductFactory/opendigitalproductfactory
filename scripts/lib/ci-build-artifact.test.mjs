import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createBuildArtifactReceipt,
  selectBuildArtifact,
  validateArchiveEntries,
  validateBuildArtifactReceipt,
} from "./ci-build-artifact.mjs";

const SHA = "a".repeat(40);
const TREE = "b".repeat(40);
const DIGEST = "c".repeat(64);
const PAYLOAD = "d".repeat(64);
const ENVIRONMENT = "f".repeat(64);
const TOOLCHAIN = {
  arch: "x64",
  lockfileSha256: "e".repeat(64),
  next: "16.2.9",
  node: "v24.4.1",
  os: "linux",
  packageManager: "pnpm@10.33.2",
};

function receipt(overrides = {}) {
  return createBuildArtifactReceipt({
    repository: "OpenDigitalProductFactory/opendigitalproductfactory",
    commitSha: SHA,
    treeSha: TREE,
    eventName: "pull_request",
    runId: "123",
    runAttempt: "2",
    plannerDigest: DIGEST,
    toolchain: TOOLCHAIN,
    environmentFingerprint: ENVIRONMENT,
    payloadSha256: PAYLOAD,
    payloadSizeBytes: 42,
    createdAt: "2026-07-28T00:00:00.000Z",
    expiresAt: "2026-07-29T00:00:00.000Z",
    ...overrides,
  });
}

const expected = {
  repository: "OpenDigitalProductFactory/opendigitalproductfactory",
  commitSha: SHA,
  treeSha: TREE,
  eventName: "pull_request",
  sourceRunId: "123",
  toolchain: TOOLCHAIN,
  environmentFingerprint: ENVIRONMENT,
  payloadSha256: PAYLOAD,
  payloadSizeBytes: 42,
};

describe("exact-tree production-build receipt", () => {
  it("accepts a complete, unexpired exact identity", () => {
    assert.deepEqual(
      validateBuildArtifactReceipt(receipt(), expected, Date.parse("2026-07-28T01:00:00.000Z")),
      { ok: true, reasons: [] },
    );
  });

  it("fails closed for a different tree even when the commit matches", () => {
    const result = validateBuildArtifactReceipt(
      receipt(),
      { ...expected, treeSha: "f".repeat(40) },
      Date.parse("2026-07-28T01:00:00.000Z"),
    );
    assert.equal(result.ok, false);
    assert.match(result.reasons.join("\n"), /tree SHA mismatch/);
  });

  it("rejects toolchain, checksum, size, source-run, and expiry drift", () => {
    const result = validateBuildArtifactReceipt(
      receipt(),
      {
        ...expected,
        sourceRunId: "456",
        toolchain: { ...TOOLCHAIN, next: "16.3.0" },
        environmentFingerprint: "1".repeat(64),
        payloadSha256: "0".repeat(64),
        payloadSizeBytes: 43,
      },
      Date.parse("2026-07-30T00:00:00.000Z"),
    );
    assert.equal(result.ok, false);
    assert.match(result.reasons.join("\n"), /source run mismatch/);
    assert.match(result.reasons.join("\n"), /toolchain mismatch/);
    assert.match(result.reasons.join("\n"), /build environment mismatch/);
    assert.match(result.reasons.join("\n"), /payload checksum mismatch/);
    assert.match(result.reasons.join("\n"), /payload size mismatch/);
    assert.match(result.reasons.join("\n"), /expired/);
  });

  it("rejects incomplete or non-success evidence", () => {
    const complete = receipt();
    const incomplete = {
      ...complete,
      workflow: { ...complete.workflow },
      build: { ...complete.build, result: "failure" },
    };
    delete incomplete.workflow.plannerDigest;
    delete incomplete.environmentFingerprint;
    const result = validateBuildArtifactReceipt(
      incomplete,
      expected,
      Date.parse("2026-07-28T01:00:00.000Z"),
    );
    assert.equal(result.ok, false);
    assert.match(result.reasons.join("\n"), /planner digest/);
    assert.match(result.reasons.join("\n"), /build environment/);
    assert.match(result.reasons.join("\n"), /successful build/);
  });
});

describe("artifact discovery", () => {
  it("selects the newest non-expired artifact from an exact SHA/event run", () => {
    const selected = selectBuildArtifact({
      runs: [
        { id: 2, head_sha: SHA, event: "pull_request", run_number: 11, run_attempt: 1 },
        { id: 3, head_sha: SHA, event: "push", run_number: 12, run_attempt: 1 },
        { id: 4, head_sha: "f".repeat(40), event: "pull_request", run_number: 13, run_attempt: 1 },
      ],
      artifactsByRun: new Map([
        [2, [
          { id: 20, name: "web-production-build-2-1", expired: false },
          { id: 21, name: "other", expired: false },
        ]],
      ]),
      headSha: SHA,
      eventName: "pull_request",
      artifactPrefix: "web-production-build",
    });
    assert.deepEqual(selected, {
      artifactId: 20,
      artifactName: "web-production-build-2-1",
      runId: 2,
      runAttempt: 1,
    });
  });

  it("does not reuse expired or wrong-prefix artifacts", () => {
    assert.equal(selectBuildArtifact({
      runs: [{ id: 2, head_sha: SHA, event: "merge_group", run_number: 11, run_attempt: 1 }],
      artifactsByRun: new Map([[2, [
        { id: 20, name: "web-production-build-2-1", expired: true },
        { id: 21, name: "ci-evidence-plan-2-1", expired: false },
      ]]]),
      headSha: SHA,
      eventName: "merge_group",
      artifactPrefix: "web-production-build",
    }), null);
  });
});

describe("archive inventory", () => {
  it("accepts only a rooted Next.js build with BUILD_ID", () => {
    assert.deepEqual(validateArchiveEntries([
      ".next/",
      ".next/standalone/version.json",
      ".next/standalone/apps/web/.next/BUILD_ID",
      ".next/standalone/apps/web/server.js",
      ".next/static/chunks/app.js",
    ]), { ok: true, reasons: [] });
  });

  it("rejects traversal, unrelated roots, and missing BUILD_ID", () => {
    const result = validateArchiveEntries([
      "../escape",
      "/absolute",
      "public/index.html",
      ".next/standalone/apps/web/server.js",
    ]);
    assert.equal(result.ok, false);
    assert.match(result.reasons.join("\n"), /unsafe archive path/);
    assert.match(result.reasons.join("\n"), /outside \.next/);
    assert.match(result.reasons.join("\n"), /BUILD_ID/);
    assert.match(result.reasons.join("\n"), /version\.json/);
  });
});
