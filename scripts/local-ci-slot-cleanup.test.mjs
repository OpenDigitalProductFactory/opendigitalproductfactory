import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLocalCiSlotManifest } from "./lib/local-ci-slot-manifest.mjs";
import { createLocalCiCleanupPlan } from "./local-ci-slot-cleanup.mjs";

test("cleanup plans name only resources owned by their slot", () => {
  const hostRoot = mkdtempSync(join(tmpdir(), "dpf-local-ci-cleanup-"));
  const rootClone = join(hostRoot, "DPF");
  const gitCommonDir = join(rootClone, ".git");
  const candidateGitDir = join(gitCommonDir, "worktrees", "candidate");
  const slot0 = createLocalCiSlotManifest({
    slotKey: "slot-0",
    rootClone,
    gitCommonDir,
    candidateGitDir,
  });
  const slot1 = createLocalCiSlotManifest({
    slotKey: "slot-1",
    rootClone,
    gitCommonDir,
    candidateGitDir,
  });

  const plan0 = createLocalCiCleanupPlan(slot0, join(rootClone, "docker-compose.local-ci.yml"));
  const plan1 = createLocalCiCleanupPlan(slot1, join(rootClone, "docker-compose.local-ci.yml"));
  const serialized0 = JSON.stringify(plan0);
  const serialized1 = JSON.stringify(plan1);

  assert.match(serialized0, /dpf-local-ci-0/);
  assert.doesNotMatch(serialized0, /dpf-local-ci-1/);
  assert.match(serialized1, /dpf-local-ci-1/);
  assert.doesNotMatch(serialized1, /dpf-local-ci-0/);
  assert.notDeepEqual(plan0, plan1);
  assert.equal(plan0.commands[0].env.AUTH_SECRET, "local-ci-cleanup-not-used");
  assert.equal(plan0.commands[0].env.CREDENTIAL_ENCRYPTION_KEY.length, 64);
});
