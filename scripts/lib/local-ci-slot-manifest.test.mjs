import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, win32 } from "node:path";
import test from "node:test";

import {
  LOCAL_CI_DECLARED_CAPACITY,
  LOCAL_CI_SLOT_KEYS,
  assertLocalCiCleanupTarget,
  createLocalCiSlotManifest,
  localCiSlotEnvironment,
  resolveLocalCiRootClone,
} from "./local-ci-slot-manifest.mjs";

function fixture() {
  const hostRoot = mkdtempSync(join(tmpdir(), "dpf-local-ci-slot-manifest-"));
  const rootClone = join(hostRoot, "DPF");
  const gitCommonDir = join(rootClone, ".git");
  const candidateGitDir = join(gitCommonDir, "worktrees", "candidate");
  return { rootClone, gitCommonDir, candidateGitDir };
}

test("derives declared capacity from the closed physical slot manifest", () => {
  assert.deepEqual(LOCAL_CI_SLOT_KEYS, ["slot-0", "slot-1"]);
  assert.equal(LOCAL_CI_DECLARED_CAPACITY, 2);
});

test("normal and bare-common-dir repositories share one canonical root resolver", () => {
  const normal = fixture();
  assert.equal(resolveLocalCiRootClone(normal.gitCommonDir), normal.rootClone);

  const bareCommonDir = join(dirname(normal.rootClone), ".opendigitalproductfactory.git");
  assert.equal(resolveLocalCiRootClone(bareCommonDir), bareCommonDir);

  const gateManifest = createLocalCiSlotManifest({
    ...normal,
    rootClone: resolveLocalCiRootClone(bareCommonDir),
    gitCommonDir: bareCommonDir,
    slotKey: "slot-0",
  });
  const runnerManifest = createLocalCiSlotManifest({
    ...normal,
    rootClone: resolveLocalCiRootClone(bareCommonDir),
    gitCommonDir: bareCommonDir,
    slotKey: "slot-0",
  });
  assert.equal(gateManifest.scratch.workspace, runnerManifest.scratch.workspace);
  assert.equal(
    gateManifest.scratch.workspace,
    join(dirname(bareCommonDir), `${bareCommonDir.split(/[\\/]/).at(-1)}-worktrees`, ".local-ci-runner"),
  );
  assert.throws(
    () => createLocalCiSlotManifest({
      ...normal,
      rootClone: dirname(bareCommonDir),
      gitCommonDir: bareCommonDir,
      slotKey: "slot-0",
    }),
    /rootClone must match the canonical Git common-dir root/,
  );
});

test("Windows bare-common-dir layout does not grow a duplicate worktrees suffix", () => {
  const commonDir = String.raw`D:\DPF-worktrees\.opendigitalproductfactory.git`;
  assert.equal(resolveLocalCiRootClone(commonDir), win32.normalize(commonDir));
  assert.notEqual(
    resolveLocalCiRootClone(commonDir),
    String.raw`D:\DPF-worktrees`,
  );
});

test("POSIX common-dir paths retain POSIX separators", () => {
  assert.equal(
    resolveLocalCiRootClone("/tmp/dpf-worktrees/.opendigitalproductfactory.git"),
    "/tmp/dpf-worktrees/.opendigitalproductfactory.git",
  );
  assert.equal(resolveLocalCiRootClone("/tmp/dpf/.git"), "/tmp/dpf");
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
    (slot) => slot.builder.name,
    (slot) => slot.builder.container,
    (slot) => slot.evidence.controlPlane,
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
  assert.equal(manifest.postgres.hostPort, 15432);
});

test("the shared resource contract drives the server-visible slot binding", () => {
  const slot1 = createLocalCiSlotManifest({ ...fixture(), slotKey: "slot-1" });

  assert.deepEqual(
    {
      manifestVersion: slot1.schemaVersion,
      slotKey: slot1.slotKey,
      url: slot1.portal.url,
      ports: [slot1.portal.port, slot1.postgres.hostPort],
      cleanupCommand:
        `node scripts/local-ci-slot-cleanup.mjs --slot-key ${slot1.slotKey}`,
    },
    {
      manifestVersion: 1,
      slotKey: "slot-1",
      url: "http://localhost:3011",
      ports: [3011, 15433],
      cleanupCommand:
        "node scripts/local-ci-slot-cleanup.mjs --slot-key slot-1",
    },
  );
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
    DPF_LOCAL_CI_BUILDER_NAME: manifest.builder.name,
    DPF_LOCAL_CI_BUILDER_CONTAINER: manifest.builder.container,
    DPF_LOCAL_CI_BUILDER_POLICY_VERSION: "2",
    DPF_LOCAL_CI_BUILDER_MEMORY_BYTES: String(manifest.builder.memoryBytes),
    DPF_LOCAL_CI_BUILDER_CPU_QUOTA: String(manifest.builder.cpuQuota),
    DPF_LOCAL_CI_BUILDER_CPU_PERIOD: String(manifest.builder.cpuPeriod),
    DPF_LOCAL_CI_BUILDER_MAX_PARALLELISM: String(manifest.builder.maxParallelism),
    DPF_LOCAL_CI_CONTROL_PLANE_EVIDENCE_FILE: manifest.evidence.controlPlane,
  });
});

test("builder resources reserve capacity for the shared control plane", () => {
  const manifest = createLocalCiSlotManifest({ ...fixture(), slotKey: "slot-0" });

  assert.deepEqual(manifest.builder, {
    policyVersion: 2,
    name: "dpf-local-ci-buildkit-v2-0",
    container: "buildx_buildkit_dpf-local-ci-buildkit-v2-00",
    memoryBytes: 16 * 1024 ** 3,
    cpuQuota: 800_000,
    cpuPeriod: 100_000,
    maxParallelism: 4,
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
