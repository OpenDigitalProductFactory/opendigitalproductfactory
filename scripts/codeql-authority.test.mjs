import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const codeqlWorkflow = readFileSync(".github/workflows/codeql.yml", "utf8");
const inflowWorkflow = readFileSync(
  ".github/workflows/security-inflow-gate.yml",
  "utf8",
);

describe("CodeQL authority contract", () => {
  it("makes the repository advanced workflow blocking for every supported language", () => {
    for (const language of [
      "actions",
      "javascript-typescript",
      "python",
      "go",
    ]) {
      assert.match(codeqlWorkflow, new RegExp(`- language: ${language}\\b`));
    }

    assert.doesNotMatch(codeqlWorkflow, /continue-on-error:\s*true/);
    assert.doesNotMatch(codeqlWorkflow, /activation requires|Until that toggle/i);
  });

  it("runs the security inflow gate after the authoritative workflow", () => {
    assert.match(
      inflowWorkflow,
      /workflow_run:[\s\S]*workflows:\s*\["CodeQL Advanced"\]/,
    );
    assert.doesNotMatch(inflowWorkflow, /default-setup/);
  });
});
