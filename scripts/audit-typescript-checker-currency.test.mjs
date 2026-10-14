// scripts/audit-typescript-checker-currency.test.mjs (BI-D2FE6931)
// Node built-in test runner: node --test scripts/audit-typescript-checker-currency.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessCurrency, normalizeRegistryVersion, parsePinnedTs7, renderMarkdown } from "./audit-typescript-checker-currency.mjs";

test("reads the pin from the root typescript7 alias", () => {
  assert.equal(parsePinnedTs7({ devDependencies: { typescript7: "npm:typescript@7.0.2" } }), "7.0.2");
  assert.equal(parsePinnedTs7({ devDependencies: { typescript7: "^7.0.2" } }), null, "only an exact npm alias is a pin");
  assert.equal(parsePinnedTs7({ devDependencies: {} }), null);
});

test("the repository's own root package.json carries a readable pin", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(parsePinnedTs7(pkg) ?? "", /^7\.\d+\.\d+$/);
});

test("classifies the pin against npm's latest", () => {
  assert.equal(assessCurrency({ pinned: "7.0.2", latest: "7.0.2" }).status, "current");
  assert.equal(assessCurrency({ pinned: "7.0.2", latest: "7.0.3" }).status, "behind");
  assert.equal(assessCurrency({ pinned: "7.0.2", latest: "7.1.0" }).status, "behind");
  assert.equal(assessCurrency({ pinned: "7.0.2", latest: "8.0.0" }).status, "new-major");
  assert.equal(assessCurrency({ pinned: "7.1.0", latest: "7.0.9" }).status, "ahead");
  assert.equal(assessCurrency({ pinned: null, latest: "7.0.2" }).status, "unknown");
  assert.equal(assessCurrency({ pinned: "7.0.2", latest: null }).status, "unknown");
});

test("a behind report names the exact bump command", () => {
  const md = renderMarkdown(assessCurrency({ pinned: "7.0.2", latest: "7.0.3" }));
  assert.match(md, /\*\*behind\*\*/);
  assert.match(md, /pnpm add -w -D typescript7@npm:typescript@7\.0\.3/);
});

test("only a plain release version from the registry reaches the report", () => {
  assert.equal(normalizeRegistryVersion("7.0.3"), "7.0.3");
  assert.equal(normalizeRegistryVersion("7.0.3-beta.1"), null);
  assert.equal(normalizeRegistryVersion("7.0.3\n# injected"), null);
  assert.equal(normalizeRegistryVersion("<img src=x>"), null);
  assert.equal(normalizeRegistryVersion(7), null);
  assert.equal(normalizeRegistryVersion(undefined), null);
});
