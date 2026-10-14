import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGatePlan } from "./pr-readiness/core.mjs";
import { classifyChangedFiles } from "./ci-change-scope.mjs";

const guard = (id, inputs) => ({ id, name: id, inputs, commands: [["node", [`scripts/${id}.mjs`]]] });
const profiles = { source: [guard("code", ["code"]), guard("docs", ["docs"]), guard("shared", ["code", "docs"]), guard("undeclared")], workspace: [], "pull-request": [] };

test("PR readiness uses CI scope for an AGENTS.md-only change", () => {
  const changeScope = classifyChangedFiles(["AGENTS.md"]);
  assert.equal(changeScope.docsOnly, true);
  assert.deepEqual(buildGatePlan({ profiles, changeScope }).map(gate => gate.name), ["docs", "shared", "undeclared"]);
});

test("mixed and unknown changes retain every guard", () => {
  for (const changeScope of [null, classifyChangedFiles([]), classifyChangedFiles(["AGENTS.md", "apps/web/lib/example.ts"])]) {
    assert.deepEqual(buildGatePlan({ profiles, changeScope }).map(gate => gate.name), ["code", "docs", "shared", "undeclared"]);
  }
});
