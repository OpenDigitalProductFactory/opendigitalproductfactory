import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

describe("CI evidence planner workflow wiring", () => {
  it("uses the shared planner as the change-scope authority", () => {
    assert.match(
      workflow,
      /node scripts\/ci-evidence-plan\.mjs[\s\S]*--github-output "\$GITHUB_OUTPUT"/,
    );
    assert.doesNotMatch(
      workflow,
      /node scripts\/ci-change-scope\.mjs --github-output/,
    );
  });

  it("publishes the shadow plan without changing stable required contexts", () => {
    assert.match(workflow, /name: Upload shadow evidence plan/);
    assert.match(workflow, /uses: actions\/upload-artifact@v7/);
    assert.match(workflow, /name: ci-evidence-plan-/);
    assert.match(workflow, /evidence_plan_digest/);
    assert.match(workflow, /evidence_tier/);
    assert.match(workflow, /name: Typecheck/);
    assert.match(workflow, /name: Production Build/);
    assert.match(workflow, /name: Unit Tests/);
  });
});
