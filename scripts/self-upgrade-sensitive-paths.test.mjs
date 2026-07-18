import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SELF_UPGRADE_SENSITIVE_PATH_RULES,
  classifySensitivePath,
  findUnownedLifecyclePaths,
} from "./self-upgrade-sensitive-paths.mjs";

const examples = {
  promoter: "Dockerfile.promoter",
  selfUpgrade: "apps/web/lib/self-upgrade/runner.ts",
  composeState: "scripts/installer/lib/state.sh",
  installer: "install-dpf.ps1",
  capabilities: "packages/db/data/capability-service-catalog.json",
  contract: "scripts/promoter-contract.schema.json",
  workflow: ".github/workflows/self-upgrade-acceptance.yml",
  harness: "scripts/test-n-minus-one-upgrade.mjs",
};

test("classifies every contract-owned path family", () => {
  for (const [family, path] of Object.entries(examples)) {
    assert.equal(classifySensitivePath(path)?.family, family, path);
  }
});

test("owns the checked-in root promoter manifest and schema", () => {
  assert.equal(classifySensitivePath("promoter-contract.json")?.family, "contract");
  assert.equal(classifySensitivePath("promoter-contract.schema.json")?.family, "contract");
});

test("normalizes Windows separators and ignores unrelated paths", () => {
  assert.equal(classifySensitivePath("apps\\web\\lib\\self-upgrade\\runner.ts")?.family, "selfUpgrade");
  assert.equal(classifySensitivePath("apps/web/components/button.tsx"), null);
});

test("rules have stable unique identifiers", () => {
  const ids = SELF_UPGRADE_SENSITIVE_PATH_RULES.map((rule) => rule.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(Boolean));
});

test("lifecycle policy inventory fails closed when a path has no sensitive owner", () => {
  assert.deepEqual(findUnownedLifecyclePaths([...Object.values(examples), "scripts/new-installer.sh"]), [
    "scripts/new-installer.sh",
  ]);
});

test("acceptance workflow is path-sensitive, nightly, least-privilege, bounded, and retains evidence", async () => {
  const workflow = await readFile(new URL("../.github/workflows/self-upgrade-acceptance.yml", import.meta.url), "utf8");
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /checks:\s*read/);
  assert.match(workflow, /packages:\s*read/);
  assert.match(workflow, /retention-days:\s*30/);
  assert.match(workflow, /timeout-minutes:/);
  assert.match(workflow, /if:\s*always\(\)/);
  assert.match(workflow, /Build candidate promoter with immutable contract identity/);
  assert.match(workflow, /Invalid state refuses before quiescence/);
  assert.match(workflow, /\.quiescenceBegan == false/);
});
