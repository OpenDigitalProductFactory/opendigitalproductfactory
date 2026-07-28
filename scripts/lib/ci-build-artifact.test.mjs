import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildArtifactDiscoveryVerdict,
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

describe("discovery termination", () => {
  const verdict = (runs, artifactsByRun = new Map()) =>
    buildArtifactDiscoveryVerdict({
      runs,
      artifactsByRun,
      headSha: SHA,
      eventName: "pull_request",
      artifactPrefix: "web-production-build",
    });

  const producer = (overrides) => ({
    id: 2,
    head_sha: SHA,
    event: "pull_request",
    run_number: 11,
    run_attempt: 1,
    status: "completed",
    ...overrides,
  });

  it("consumes an available artifact rather than waiting", () => {
    const result = verdict(
      [producer({})],
      new Map([[2, [{ id: 20, name: "web-production-build-2-1", expired: false }]]]),
    );
    assert.equal(result.decision, "found");
    assert.equal(result.selected.artifactName, "web-production-build-2-1");
  });

  // BI-149370BD: the reported defect — heavy=false CI completes without ever
  // publishing a build, and discovery burned the remaining ~609s regardless.
  it("abandons once every exact-tree producer is terminal without an artifact", () => {
    const result = verdict([producer({ status: "completed" })]);
    assert.equal(result.decision, "abandon");
    assert.match(result.reason, /terminal with no usable artifact/);
  });

  // Terminality is what settles this, not the conclusion: a failed or cancelled
  // producer will publish no artifact either, so waiting on one is dead time.
  it("abandons on terminal failed and cancelled producers", () => {
    for (const conclusion of ["failure", "cancelled", "timed_out", "success"]) {
      assert.equal(
        verdict([producer({ status: "completed", conclusion })]).decision,
        "abandon",
        `expected abandon for conclusion ${conclusion}`,
      );
    }
  });

  it("keeps waiting while an eligible producer is queued or in progress", () => {
    for (const status of ["queued", "waiting", "requested", "pending", "in_progress"]) {
      const result = verdict([producer({ status })]);
      assert.equal(result.decision, "wait", `expected wait for status ${status}`);
      assert.match(result.reason, /still active/);
    }
  });

  it("keeps waiting when no matching producer has appeared yet", () => {
    const result = verdict([
      producer({ id: 3, event: "push" }),
      producer({ id: 4, head_sha: "f".repeat(40) }),
    ]);
    assert.equal(result.decision, "wait");
    assert.match(result.reason, /has appeared yet/);
  });

  // A newer attempt still running must not be pre-empted by an older terminal
  // attempt that published nothing.
  it("keeps waiting for a later attempt even when an earlier one is terminal", () => {
    const result = verdict([
      producer({ id: 2, run_attempt: 1, status: "completed" }),
      producer({ id: 3, run_attempt: 2, status: "in_progress" }),
    ]);
    assert.equal(result.decision, "wait");
  });

  it("prefers a later attempt's artifact over an older terminal no-artifact attempt", () => {
    const result = verdict(
      [
        producer({ id: 2, run_number: 11, status: "completed" }),
        producer({ id: 3, run_number: 12, status: "completed" }),
      ],
      new Map([[3, [{ id: 30, name: "web-production-build-3-1", expired: false }]]]),
    );
    assert.equal(result.decision, "found");
    assert.equal(result.selected.runId, 3);
  });

  // Fail safe: an unrecognised/missing status must preserve bounded polling
  // rather than abandon reuse on a shape this code does not understand.
  it("treats an unknown or missing run status as still active", () => {
    assert.equal(verdict([producer({ status: undefined })]).decision, "wait");
    assert.equal(verdict([producer({ status: "some_future_status" })]).decision, "wait");
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
