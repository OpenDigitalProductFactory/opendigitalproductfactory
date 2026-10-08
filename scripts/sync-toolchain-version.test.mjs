// BI-52934B3E — the pack version has one source and every manifest follows it.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { SOURCE, TARGETS, expectedValue, syncToolchainVersion } from "./sync-toolchain-version.mjs";

function fixtureRepo(packVersion, versions) {
  const root = mkdtempSync(join(tmpdir(), "toolchain-version-"));
  const write = (file, value) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  };
  write(SOURCE, { packVersion, floor: { minPackVersion: null, graceStartsAt: null } });
  for (const name of ["claude", "grok", "antigravity"]) {
    write(`packages/dpf-skill-pack/.${name}-plugin/plugin.json`, { name: "dpf-platform", version: versions.plugin });
  }
  write("packages/dpf-skill-pack/.codex-plugin/plugin.json", { name: "dpf-platform", version: versions.codex });
  write(".claude-plugin/marketplace.json", {
    name: "dpf-platform-local",
    metadata: { description: "x", version: versions.metadata },
    plugins: [{ name: "other", version: "9.9.9" }, { name: "dpf-platform", version: versions.plugin }],
  });
  return root;
}

test("a repo in sync reports no drift and writes nothing", () => {
  const root = fixtureRepo("0.3.0", { plugin: "0.3.0", codex: "0.3.0+codex.abc", metadata: "0.3.0" });
  const before = readFileSync(join(root, ".claude-plugin/marketplace.json"), "utf8");
  assert.deepEqual(syncToolchainVersion({ root, write: true }).drift, []);
  assert.equal(readFileSync(join(root, ".claude-plugin/marketplace.json"), "utf8"), before);
});

test("--check reports every drifted manifest, including stale marketplace metadata", () => {
  const root = fixtureRepo("0.3.0", { plugin: "0.2.8", codex: "0.2.8+codex.abc", metadata: "0.1.0" });
  const { drift } = syncToolchainVersion({ root, write: false });
  assert.equal(drift.length, TARGETS.length);
  assert.ok(drift.some((entry) => entry.file === ".claude-plugin/marketplace.json" && entry.current === "0.1.0"));
});

test("sync rewrites only the version values and keeps the Codex cache suffix and other plugins", () => {
  const root = fixtureRepo("0.3.0", { plugin: "0.2.8", codex: "0.2.8+codex.abc", metadata: "0.2.8" });
  syncToolchainVersion({ root, write: true });
  const codex = JSON.parse(readFileSync(join(root, "packages/dpf-skill-pack/.codex-plugin/plugin.json"), "utf8"));
  assert.equal(codex.version, "0.3.0+codex.abc");
  const market = JSON.parse(readFileSync(join(root, ".claude-plugin/marketplace.json"), "utf8"));
  assert.equal(market.metadata.version, "0.3.0");
  assert.equal(market.plugins.find((p) => p.name === "dpf-platform").version, "0.3.0");
  assert.equal(market.plugins.find((p) => p.name === "other").version, "9.9.9");
  assert.deepEqual(syncToolchainVersion({ root, write: false }).drift, []);
});

test("a malformed source version is refused rather than propagated", () => {
  const root = fixtureRepo("0.3", { plugin: "0.3.0", codex: "0.3.0", metadata: "0.3.0" });
  assert.throws(() => syncToolchainVersion({ root }), /MAJOR\.MINOR\.PATCH/);
});

test("expectedValue keeps a suffix only where the target asks for it", () => {
  assert.equal(expectedValue("0.2.8+codex.x", "0.3.0", true), "0.3.0+codex.x");
  assert.equal(expectedValue("0.2.8+codex.x", "0.3.0", false), "0.3.0");
  assert.equal(expectedValue("0.2.8", "0.3.0", true), "0.3.0");
});
