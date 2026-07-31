import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createEvidenceReceipt,
  evidenceArtifactDiscoveryVerdict,
  receiptChecksum,
  validateEvidenceReceipt,
} from "./ci-evidence-receipt.mjs";

const NOW = Date.parse("2026-07-30T23:00:00.000Z");

function fixtureInput() {
  return {
    repository: "OpenDigitalProductFactory/opendigitalproductfactory",
    source: {
      commitSha: "a".repeat(40),
      treeSha: "b".repeat(40),
    },
    workflow: {
      eventName: "merge_group",
      runId: "30590378765",
      runAttempt: "1",
      workflowPath: ".github/workflows/ci.yml",
      workflowFingerprint: "c".repeat(64),
    },
    planner: {
      planDigest: "d".repeat(64),
      implementationFingerprint: "e".repeat(64),
    },
    mergePolicy: {
      manifestFingerprint: "f".repeat(64),
      requiredContexts: ["DCO", "Merge Readiness", "UX Route Budget Sweep"],
    },
    toolchain: {
      runnerOs: "Linux",
      nodeMajor: 24,
      packageManager: "pnpm@10.33.2",
      lockfileSha256: "1".repeat(64),
      setupFingerprint: "2".repeat(64),
    },
    gates: {
      changes: "success",
      typecheck: "success",
      "test-web": "success",
      "test-packages": "success",
      "unit-tests": "success",
      build: "success",
      "ux-route-sweep-runtime": "success",
      "ux-route-sweep": "success",
      "exact-tree-evidence-shadow": "skipped",
    },
    artifacts: [
      {
        name: "ci-evidence-plan-30590378765-1",
        digest: `sha256:${"3".repeat(64)}`,
        sizeInBytes: 8124,
      },
      {
        name: "web-production-build-30590378765-1",
        digest: `sha256:${"4".repeat(64)}`,
        sizeInBytes: 4_812_345,
      },
    ],
    createdAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 24 * 60 * 60_000).toISOString(),
  };
}

function expectedFrom(input) {
  return {
    repository: input.repository,
    sourceCommitSha: input.source.commitSha,
    treeSha: input.source.treeSha,
    sourceRunId: input.workflow.runId,
    workflowPath: input.workflow.workflowPath,
    workflowFingerprint: input.workflow.workflowFingerprint,
    plannerImplementationFingerprint: input.planner.implementationFingerprint,
    mergePolicyManifestFingerprint: input.mergePolicy.manifestFingerprint,
    mergePolicyRequiredContexts: input.mergePolicy.requiredContexts,
    toolchain: input.toolchain,
    gateIds: Object.keys(input.gates),
    artifacts: input.artifacts,
    sourceChecks: input.mergePolicy.requiredContexts.map((name) => ({
      name,
      status: "completed",
      conclusion: "success",
    })),
  };
}

describe("exact-tree CI evidence receipt", () => {
  it("creates and validates a complete successful merge-group receipt", () => {
    const input = fixtureInput();
    const receipt = createEvidenceReceipt(input);
    const result = validateEvidenceReceipt({
      receipt,
      expected: expectedFrom(input),
      checksum: receiptChecksum(receipt),
      now: NOW + 60_000,
    });

    assert.equal(receipt.schemaVersion, 1);
    assert.equal(receipt.kind, "dpf-github-ci-evidence");
    assert.equal(receipt.result, "success");
    assert.deepEqual(result, { ok: true, reasons: [] });
  });

  it("refuses to create evidence when any gate is non-terminal or red", () => {
    for (const result of ["failure", "cancelled", "in_progress", "missing"]) {
      const input = fixtureInput();
      input.gates.typecheck = result;
      assert.throws(
        () => createEvidenceReceipt(input),
        /cannot attest incomplete CI gates: typecheck=/,
      );
    }
  });

  it("fails closed for every receipt identity and completeness mismatch", () => {
    const cases = [
      ["repository", (expected) => { expected.repository = "other/repository"; }, /repository mismatch/],
      ["source commit", (expected) => { expected.sourceCommitSha = "0".repeat(40); }, /source commit SHA mismatch/],
      ["tree", (expected) => { expected.treeSha = "9".repeat(40); }, /tree SHA mismatch/],
      ["source run", (expected) => { expected.sourceRunId = "42"; }, /source run mismatch/],
      ["workflow path", (expected) => { expected.workflowPath = "other.yml"; }, /workflow path mismatch/],
      ["workflow fingerprint", (expected) => { expected.workflowFingerprint = "8".repeat(64); }, /workflow fingerprint mismatch/],
      ["planner", (expected) => { expected.plannerImplementationFingerprint = "7".repeat(64); }, /planner fingerprint mismatch/],
      ["merge policy", (expected) => { expected.mergePolicyManifestFingerprint = "6".repeat(64); }, /merge-policy fingerprint mismatch/],
      ["required contexts", (expected) => { expected.mergePolicyRequiredContexts = ["Merge Readiness"]; }, /required-context set mismatch/],
      ["toolchain", (expected) => { expected.toolchain = { ...expected.toolchain, nodeMajor: 26 }; }, /toolchain mismatch/],
      ["gate set", (expected) => { expected.gateIds = expected.gateIds.filter((id) => id !== "typecheck"); }, /gate set mismatch/],
      ["artifact digest", (expected) => {
        expected.artifacts = expected.artifacts.map((artifact, index) => index === 0
          ? { ...artifact, digest: `sha256:${"5".repeat(64)}` }
          : artifact);
      }, /artifact inventory mismatch/],
    ];

    for (const [label, mutate, reason] of cases) {
      const input = fixtureInput();
      const receipt = createEvidenceReceipt(input);
      const expected = expectedFrom(input);
      mutate(expected);
      const result = validateEvidenceReceipt({
        receipt,
        expected,
        checksum: receiptChecksum(receipt),
        now: NOW + 60_000,
      });
      assert.equal(result.ok, false, label);
      assert.match(result.reasons.join("\n"), reason, label);
    }
  });

  it("rejects malformed, tampered, expired, future, and non-merge-group evidence", () => {
    assert.deepEqual(validateEvidenceReceipt({
      receipt: null,
      expected: expectedFrom(fixtureInput()),
      checksum: "0".repeat(64),
      now: NOW,
    }), { ok: false, reasons: ["receipt is not an object"] });

    const input = fixtureInput();
    const receipt = createEvidenceReceipt(input);
    assert.match(validateEvidenceReceipt({
      receipt,
      expected: expectedFrom(input),
      checksum: "0".repeat(64),
      now: NOW,
    }).reasons.join("\n"), /receipt checksum mismatch/);
    assert.match(validateEvidenceReceipt({
      receipt,
      expected: expectedFrom(input),
      checksum: receiptChecksum(receipt),
      now: Date.parse(receipt.expiresAt) + 1,
    }).reasons.join("\n"), /evidence expired/);
    assert.match(validateEvidenceReceipt({
      receipt,
      expected: expectedFrom(input),
      checksum: receiptChecksum(receipt),
      now: Date.parse(receipt.createdAt) - 5 * 60_000 - 1,
    }).reasons.join("\n"), /evidence was created in the future/);

    const wrongEvent = structuredClone(receipt);
    wrongEvent.workflow.eventName = "push";
    assert.match(validateEvidenceReceipt({
      receipt: wrongEvent,
      expected: expectedFrom(input),
      checksum: receiptChecksum(wrongEvent),
      now: NOW,
    }).reasons.join("\n"), /source event must be merge_group/);

    const duplicateGate = structuredClone(receipt);
    duplicateGate.gates.push(structuredClone(duplicateGate.gates[0]));
    assert.match(validateEvidenceReceipt({
      receipt: duplicateGate,
      expected: expectedFrom(input),
      checksum: receiptChecksum(duplicateGate),
      now: NOW,
    }).reasons.join("\n"), /duplicate gate evidence/);

    for (const sourceChecks of [
      expectedFrom(input).sourceChecks.filter((check) => check.name !== "DCO"),
      expectedFrom(input).sourceChecks.map((check) =>
        check.name === "DCO" ? { ...check, conclusion: "failure" } : check),
      expectedFrom(input).sourceChecks.map((check) =>
        check.name === "DCO" ? { ...check, status: "in_progress", conclusion: null } : check),
    ]) {
      const expected = expectedFrom(input);
      expected.sourceChecks = sourceChecks;
      assert.match(validateEvidenceReceipt({
        receipt,
        expected,
        checksum: receiptChecksum(receipt),
        now: NOW,
      }).reasons.join("\n"), /required context DCO is not successful/);
    }
  });
});

describe("exact-tree receipt discovery", () => {
  const artifact = {
    id: 99,
    name: `ci-evidence-${"b".repeat(40)}`,
    expired: false,
    created_at: "2026-07-30T23:10:00Z",
    workflow_run: { id: 123 },
  };

  it("selects only a completed successful merge-group producer", () => {
    assert.deepEqual(evidenceArtifactDiscoveryVerdict({
      artifacts: [artifact],
      runsById: new Map([[123, {
        id: 123,
        event: "merge_group",
        status: "completed",
        conclusion: "success",
      }]]),
      artifactName: artifact.name,
    }), {
      decision: "found",
      artifactId: 99,
      artifactName: artifact.name,
      sourceRunId: 123,
      reason: "found successful merge-group evidence in run 123",
    });
  });

  it("fails full when evidence is absent, expired, non-terminal, red, or from another event", () => {
    const cases = [
      ["absent", [], new Map()],
      ["expired", [{ ...artifact, expired: true }], new Map([[123, { event: "merge_group", status: "completed", conclusion: "success" }]])],
      ["active", [artifact], new Map([[123, { event: "merge_group", status: "in_progress", conclusion: null }]])],
      ["red", [artifact], new Map([[123, { event: "merge_group", status: "completed", conclusion: "failure" }]])],
      ["wrong event", [artifact], new Map([[123, { event: "push", status: "completed", conclusion: "success" }]])],
    ];
    for (const [label, artifacts, runsById] of cases) {
      const result = evidenceArtifactDiscoveryVerdict({
        artifacts,
        runsById,
        artifactName: artifact.name,
      });
      assert.equal(result.decision, "exhaustive", label);
    }
  });
});
