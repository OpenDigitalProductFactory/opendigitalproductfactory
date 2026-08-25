import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { couldBeDocumentationFiles } from "./documentation-evidence-lane.mjs";

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
