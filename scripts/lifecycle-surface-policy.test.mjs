import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { activeLifecycleFiles, assertHostStateWiring, auditLifecycleSurfaces, formatAuditFailure, legacyExceptions, promoterCopyInputs } from "./lifecycle-surface-policy.mjs";
import { classifySensitivePath } from "./self-upgrade-sensitive-paths.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("active lifecycle surfaces contain no retired runtime operations", async () => {
  const result = await auditLifecycleSurfaces(root);
  assert.deepEqual(result.violations, [], formatAuditFailure(result, root));
  assert.deepEqual(result.stale, [], formatAuditFailure(result, root));
  assert.equal(result.remediationCount, 0, `expected zero remediation entries, found ${result.remediationCount}`);
});

test("lifecycle inventory is exact and contains no duplicates", () => {
  assert.equal(new Set(activeLifecycleFiles).size, activeLifecycleFiles.length);
  assert.equal(new Set(legacyExceptions.map((entry) => entry.id)).size, legacyExceptions.length);
  for (const entry of legacyExceptions) {
    assert.ok(entry.reason && entry.supportedSourceFloor && entry.removalMilestone);
  }
});

test("promoter COPY inputs are derived from its Dockerfile", async () => {
  const dockerfile = await readFile(resolve(root, "Dockerfile.promoter"), "utf8");
  const inputs = promoterCopyInputs(dockerfile);
  assert.ok(inputs.includes("scripts/promote.sh"));
  assert.ok(inputs.includes("scripts/installer/install-state.schema.json"));
  assert.equal(new Set(inputs).size, inputs.length);
});

test("compose wires the resolved host state into portal and promoter", async () => {
  const compose = await readFile(resolve(root, "docker-compose.yml"), "utf8");
  assert.deepEqual(assertHostStateWiring(compose), []);
});

test("upgrade-sensitive lifecycle entrypoints are owned by the N-1 classifier", () => {
  const runtimeEntrypoints = activeLifecycleFiles.filter((path) => /^(?:install-dpf|uninstall-dpf|dpf-reinstall|scripts\/(?:fresh-install|setup|verify-install|installer\/))/.test(path));
  assert.deepEqual(runtimeEntrypoints.filter((path) => !classifySensitivePath(path)), []);
});
