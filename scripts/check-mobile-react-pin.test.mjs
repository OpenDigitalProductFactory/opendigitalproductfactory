import { test } from "node:test";
import assert from "node:assert/strict";
import { findReactPinDrift, readReactOverride } from "./check-mobile-react-pin.mjs";

const YAML = `packages:
  - "."
overrides:
  # comment
  react: 19.2.3
  react-dom: 19.2.3
  'brace-expansion@<=5.0.8': '5.0.9'
onlyBuiltDependencies:
  - react: 1.0.0
`;

test("reads overrides.react and ignores keys outside overrides", () => {
  assert.equal(readReactOverride(YAML), "19.2.3");
  assert.equal(readReactOverride("packages:\n  - '.'\n"), null);
});

test("aligned declarations report no drift", () => {
  const pkg = { dependencies: { react: "19.2.3" }, devDependencies: { "react-test-renderer": "19.2.3" } };
  assert.deepEqual(findReactPinDrift(pkg, "19.2.3"), []);
});

test("a patch bump of react or react-test-renderer is drift", () => {
  const pkg = { dependencies: { react: "19.2.8" }, devDependencies: { "react-test-renderer": "19.2.8" } };
  assert.deepEqual(findReactPinDrift(pkg, "19.2.3"), [
    { field: "dependencies", name: "react", declared: "19.2.8" },
    { field: "devDependencies", name: "react-test-renderer", declared: "19.2.8" },
  ]);
});

test("a range is drift too: the pin is exact", () => {
  assert.equal(findReactPinDrift({ dependencies: { react: "^19.2.3" } }, "19.2.3").length, 1);
});
