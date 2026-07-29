import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  LOCAL_CI_AUTOMATIC_CAPACITY,
  LOCAL_CI_SLOT_KEYS,
  assertLocalCiCleanupTarget,
  createLocalCiSlotManifest,
  localCiSlotEnvironment,
} from "./local-ci-slot-manifest.mjs";

function fixture() {
  const hostRoot = mkdtempSync(join(tmpdir(), "dpf-local-ci-slot-manifest-"));
  const rootClone = join(hostRoot, "DPF");
  const gitCommonDir = join(rootClone, ".git");
  const candidateGitDir = join(gitCommonDir, "worktrees", "candidate");
  return { rootClone, gitCommonDir, candidateGitDir };
}

test("declares two physical slots while automatic admission remains singleton", () => {
  assert.deepEqual(LOCAL_CI_SLOT_KEYS, ["slot-0", "slot-1"]);
  assert.equal(LOCAL_CI_AUTOMATIC_CAPACITY, 1);
});

test("slot manifests are versioned and every mutable identity is isolated", () => {
  const paths = fixture();
  const slots = LOCAL_CI_SLOT_KEYS.map((slotKey) =>
    createLocalCiSlotManifest({ ...paths, slotKey }),
  );

  for (const manifest of slots) {
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.slotKey.startsWith("slot-"), true);
    assert.equal(manifest.cleanup.scratchBoundary, manifest.scratch.workspace);
  }

  const identities = [
    (slot) => slot.scratch.workspace,
    (slot) => slot.scratch.integrationBranchPrefix,
    (slot) => slot.fence.path,
    (slot) => slot.compose.project,
    (slot) => slot.compose.sourceVolume,
    (slot) => slot.portal.port,
    (slot) => slot.portal.url,
    (slot) => slot.postgres.container,
    (slot) => slot.postgres.hostPort,
    (slot) => slot.postgres.database,
    (slot) => slot.postgres.volume,
    (slot) => slot.postgres.url,
    (slot) => slot.dependencies.convergenceLock,
    (slot) => slot.dependencies.freshStore,
    (slot) => slot.output.build,
    (slot) => slot.output.log,
    (slot) => slot.evidence.metadata,
    (slot) => slot.evidence.freshness,
    (slot) => slot.evidence.pending,
    (slot) => slot.evidence.state,
    (slot) => slot.evidence.artifact,
  ];

  for (const identity of identities) {
    assert.equal(
      new Set(slots.map(identity)).size,
      slots.length,
      `identity must be unique: ${identity(slots[0])}`,
    );
  }
});

test("slot-0 preserves the proven singleton external ports", () => {
  const manifest = createLocalCiSlotManifest({ ...fixture(), slotKey: "slot-0" });

  assert.equal(manifest.portal.port, 3010);
  assert.equal(manifest.portal.url, "http://localhost:3010");
  assert.equal(manifest.postgres.hostPort, 54329);
});

test("slot environment is derived from the manifest without hidden arithmetic", () => {
  const manifest = createLocalCiSlotManifest({ ...fixture(), slotKey: "slot-1" });
  const env = localCiSlotEnvironment(manifest);

  assert.deepEqual(env, {
    COMPOSE_PROJECT_NAME: manifest.compose.project,
    DPF_LOCAL_CI_SOURCE_VOLUME: manifest.compose.sourceVolume,
    DPF_LOCAL_CI_SLOT_KEY: "slot-1",
    DPF_LOCAL_CI_SLOT_MANIFEST_VERSION: "1",
    DPF_LOCAL_CI_WORKSPACE: manifest.scratch.workspace,
    DPF_LOCAL_SANDBOX_FENCE_PATH: manifest.fence.path,
    DPF_LOCAL_CI_URL: manifest.portal.url,
    DPF_LOCAL_CI_PORT: String(manifest.portal.port),
    DPF_LOCAL_CI_POSTGRES_CONTAINER: manifest.postgres.container,
    DPF_LOCAL_CI_POSTGRES_PORT: String(manifest.postgres.hostPort),
    DPF_LOCAL_CI_POSTGRES_DATABASE: manifest.postgres.database,
    DPF_LOCAL_CI_POSTGRES_VOLUME: manifest.postgres.volume,
    DPF_LOCAL_CI_TEST_DATABASE_URL: manifest.postgres.url,
    DPF_LOCAL_CI_FRESHNESS_LOCK: manifest.dependencies.convergenceLock,
    DPF_LOCAL_CI_FRESH_STORE: manifest.dependencies.freshStore,
    DPF_LOCAL_CI_METADATA_FILE: manifest.evidence.metadata,
    DPF_LOCAL_CI_FRESHNESS_REPORT_FILE: manifest.evidence.freshness,
    DPF_LOCAL_CI_ARTIFACT_FILE: manifest.evidence.artifact,
    DPF_LOCAL_CI_OUTPUT_FILE: manifest.output.log,
    DPF_LOCAL_CI_BUILD_OUTPUT: manifest.output.build,
  });
});

test("cleanup containment rejects peer-slot and broad targets", () => {
  const paths = fixture();
  const slot0 = createLocalCiSlotManifest({ ...paths, slotKey: "slot-0" });
  const slot1 = createLocalCiSlotManifest({ ...paths, slotKey: "slot-1" });

  assert.equal(
    assertLocalCiCleanupTarget(slot0, join(slot0.scratch.workspace, "apps", "web", ".next")),
    join(slot0.scratch.workspace, "apps", "web", ".next"),
  );
  assert.throws(
    () => assertLocalCiCleanupTarget(slot0, slot1.scratch.workspace),
    /outside slot-0 cleanup boundary/,
  );
  assert.throws(
    () => assertLocalCiCleanupTarget(slot0, paths.rootClone),
    /outside slot-0 cleanup boundary/,
  );
});

test("unknown slot keys fail closed", () => {
  assert.throws(
    () => createLocalCiSlotManifest({ ...fixture(), slotKey: "slot-9" }),
    /unknown local-CI slot key/,
  );
});
