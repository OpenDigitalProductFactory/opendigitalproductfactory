// scripts/check-ci-node-qualified.test.mjs (BI-2FAE2E5C)
// Node built-in test runner: node --test scripts/check-ci-node-qualified.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCiNodeQualified, findFloatingNodeVersions, parseNodeVersionPin } from "./check-ci-node-qualified.mjs";

const qualification = { component: "@opendigitalproductfactory/dpf-workroom", supportedNodeVersions: ["24.16.0", "24.22.0", "24.22.1"] };

test("only an exact X.Y.Z release is a pin", () => {
  assert.equal(parseNodeVersionPin("24.22.1\n"), "24.22.1");
  assert.equal(parseNodeVersionPin("v24.22.1"), "24.22.1");
  assert.equal(parseNodeVersionPin("24"), null);
  assert.equal(parseNodeVersionPin("24.x"), null);
  assert.equal(parseNodeVersionPin("lts/*"), null);
  assert.equal(parseNodeVersionPin(""), null);
});

test("a setup-node major-only pin on the pinned major floats with the runner image", () => {
  const yml = "      - uses: actions/setup-node@v7\n        with:\n          node-version: 24\n";
  assert.deepEqual(findFloatingNodeVersions(yml, "24"), [{ line: 3, value: "24" }]);
  assert.deepEqual(findFloatingNodeVersions("          node-version: '24.x'\n", "24").map(f => f.value), ["24.x"]);
  assert.deepEqual(findFloatingNodeVersions("          node-version-file: .node-version\n", "24"), []);
  // Another major is a deliberate, separate toolchain choice, not drift from this pin.
  assert.deepEqual(findFloatingNodeVersions("          node-version: 22\n", "24"), []);
});

test("refuses a runner Node outside the vendored qualification (the 24.22.2 break)", () => {
  const result = checkCiNodeQualified({ pinText: "24.22.2", qualifications: [{ path: "q.json", json: qualification }], workflows: [] });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /24\.22\.2.*not in.*supportedNodeVersions/);
});

test("refuses a missing or non-exact pin", () => {
  for (const pinText of [null, "24"]) {
    const result = checkCiNodeQualified({ pinText, qualifications: [{ path: "q.json", json: qualification }], workflows: [] });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /\.node-version/);
  }
});

test("refuses a workflow that floats past the pin", () => {
  const result = checkCiNodeQualified({ pinText: "24.22.1", qualifications: [{ path: "q.json", json: qualification }],
    workflows: [{ path: ".github/workflows/x.yml", text: "          node-version: 24\n" }] });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /x\.yml:1.*node-version-file: \.node-version/);
});

test("accepts a qualified exact pin that every workflow reads", () => {
  const result = checkCiNodeQualified({ pinText: "24.22.1\n", qualifications: [{ path: "q.json", json: qualification }],
    workflows: [{ path: ".github/workflows/x.yml", text: "          node-version-file: .node-version\n" }] });
  assert.deepEqual(result, { ok: true, pin: "24.22.1", errors: [] });
});

test("the repository itself pins a qualified Node that every workflow reads", async () => {
  const { loadRepositoryInputs } = await import("./check-ci-node-qualified.mjs");
  const inputs = await loadRepositoryInputs(new URL("..", import.meta.url));
  assert(inputs.qualifications.length > 0, "a vendored qualification declares supportedNodeVersions");
  const result = checkCiNodeQualified(inputs);
  assert.deepEqual(result.errors, []);
});
