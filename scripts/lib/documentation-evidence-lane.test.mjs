import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  couldBeDocumentationFiles,
  createPreAdmissionGateIdentity,
  repositorySlugFromRemote,
} from "./documentation-evidence-lane.mjs";

describe("couldBeDocumentationFiles", () => {
  it("admits documentation plus its generated index", () => {
    assert.equal(couldBeDocumentationFiles([
      "docs/operations/gates.md",
      "apps/web/lib/docs/doc-index.generated.json",
    ]), true);
  });

  it("rejects runtime, policy, empty, and executable-standard changes", () => {
    for (const files of [
      [],
      ["scripts/gate-worktree.mjs"],
      ["config/ci-evidence-policy.json"],
      ["docs/architecture/four-portfolio-archetype-ai-workforce-operating-standard.md"],
    ]) {
      assert.equal(couldBeDocumentationFiles(files), false, files.join(", "));
    }
  });
});

describe("pre-admission immutable gate identity", () => {
  it("maps the planner and toolchain outputs without using caller identity", () => {
    assert.deepEqual(createPreAdmissionGateIdentity({
      repository: "OpenDigitalProductFactory/OpenDigitalProductFactory",
      plan: {
        headTreeSha: "a".repeat(40),
        digest: "b".repeat(64),
      },
      toolchainFingerprint: "c".repeat(64),
    }), {
      repository: "OpenDigitalProductFactory/OpenDigitalProductFactory",
      integrationTreeSha: "a".repeat(40),
      evidencePlanDigest: "b".repeat(64),
      toolchainFingerprint: "c".repeat(64),
      gateKind: "local-integration-ci",
    });
  });

  it("normalizes supported GitHub origin URL shapes", () => {
    assert.equal(
      repositorySlugFromRemote("git@github.com:OpenDigitalProductFactory/opendigitalproductfactory.git"),
      "OpenDigitalProductFactory/opendigitalproductfactory",
    );
    assert.equal(
      repositorySlugFromRemote("https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git"),
      "OpenDigitalProductFactory/opendigitalproductfactory",
    );
  });
});
