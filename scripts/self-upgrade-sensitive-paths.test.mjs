import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { readPromoterBuildContextSources } from "./lib/promoter-build-context-sources.mjs";
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
  promoterClosure: "scripts/capability-service-catalog.generated.json",
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

test("every file baked into the promoter image is self-upgrade sensitive", async () => {
  // The promoter image IS the upgrade mechanism, so its inputs are the exact set
  // whose change can wedge an install. Deriving them from the staged closure
  // means a newly baked file cannot silently escape the acceptance gate.
  // (Dockerfile.promoter deliberately copies directories rather than files, so
  // the closure — not the Dockerfile — is what enumerates them: BI-A04D61B9.)
  const baked = await readPromoterBuildContextSources(new URL("..", import.meta.url).pathname);
  assert.ok(baked.length >= 15, `expected the promoter closure, parsed ${baked.length} staged inputs`);
  assert.deepEqual(findUnownedLifecyclePaths(baked), [], "a file baked into the promoter image must trigger the self-upgrade acceptance gate");
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
  assert.match(workflow, /Signed promotion rollback restores exact legacy state/);
  assert.match(workflow, /promote-install-state-rollback\.test\.mjs/);
  // BI-55A30F8B: the promoter must keep a pre-existing install's LAN exposure
  // through the portal swap, which happens before the installer writes the key.
  assert.match(workflow, /Promotion keeps a pre-existing install's LAN exposure through the portal swap/);
  assert.match(workflow, /promote-host-bind-address\.test\.mjs/);
  assert.match(workflow, /Invalid state refuses before quiescence/);
  assert.match(workflow, /\.quiescenceBegan == false/);
  // BI-AA6FBAD0: readiness must be proven against the shape every live install
  // actually has - schemaVersion 2 carrying the PREVIOUS release's catalog hash.
  // A v1 fixture is unversioned for capability purposes and skips every
  // capability check, which is why the gate could not see the wedge.
  assert.match(workflow, /Readiness migrates a v2 install carrying the previous catalog hash/);
  assert.match(workflow, /capabilityCatalogHash/);
  // BI-A04D61B9: building the candidate from its OWN context proves nothing
  // about the pairing an upgrade actually uses — an N-1 caller's staged context
  // against a candidate-owned Dockerfile.
  assert.match(workflow, /Candidate promoter is buildable by an N-1 caller's staged context/);
  assert.match(workflow, /requiredFiles/);
});
