import { createRequire } from "node:module";
import { dirname, basename, isAbsolute, join, posix, relative, resolve, win32 } from "node:path";
import { resolveWorktreeBase } from "./worktree-base.mjs";

const require = createRequire(import.meta.url);
const SLOT_RESOURCE_MANIFEST = require(
  "../../apps/web/lib/nonprod/local-ci-slot-resources.json",
);

export const LOCAL_CI_SLOT_MANIFEST_SCHEMA_VERSION =
  SLOT_RESOURCE_MANIFEST.schemaVersion;
export const LOCAL_CI_SLOT_KEYS = Object.freeze(
  Object.keys(SLOT_RESOURCE_MANIFEST.slots),
);
export const LOCAL_CI_DECLARED_CAPACITY = LOCAL_CI_SLOT_KEYS.length;
const BUILDER_POLICY = Object.freeze(SLOT_RESOURCE_MANIFEST.builderPolicy);

const SLOT_RESOURCES = Object.freeze(
  Object.fromEntries(
    Object.entries(SLOT_RESOURCE_MANIFEST.slots)
      .map(([slotKey, resources]) => [slotKey, Object.freeze(resources)]),
  ),
);

function requireAbsolutePath(name, value) {
  if (!value || !isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path`);
  }
  return resolve(value);
}

/**
 * Resolve the repository root identity used by every local-CI caller.
 *
 * A normal clone reports `<clone>/.git` as its common directory, so the root
 * is the clone directory. A centrally-managed worktree fleet reports the bare
 * repository itself (for example `.opendigitalproductfactory.git`), which is
 * already the root identity. Keeping this here prevents the gate and runner
 * from independently guessing different scratch-worktree parents.
 *
 * @param {string} gitCommonDir
 */
export function resolveLocalCiRootClone(gitCommonDir) {
  // win32.isAbsolute('/tmp/repo') is also true, so POSIX must win for a
  // slash-rooted path. Drive-letter and UNC paths then fall through to win32.
  const pathApi = posix.isAbsolute(gitCommonDir)
    ? posix
    : win32.isAbsolute(gitCommonDir)
      ? win32
      : null;
  if (!pathApi) throw new Error("gitCommonDir must be an absolute path");
  const commonDir = pathApi.resolve(gitCommonDir);
  return pathApi.basename(commonDir).toLowerCase() === ".git"
    ? pathApi.dirname(commonDir)
    : commonDir;
}

/**
 * @typedef {object} LocalCiSlotManifest
 * @property {1} schemaVersion
 * @property {"slot-0"|"slot-1"} slotKey
 * @property {{workspace: string, integrationBranchPrefix: string}} scratch
 * @property {{path: string}} fence
 * @property {{project: string, sourceVolume: string}} compose
 * @property {{port: number, url: string}} portal
 * @property {{container: string, hostPort: number, database: string, volume: string, url: string}} postgres
 * @property {{convergenceLock: string, freshStore: string}} dependencies
 * @property {{build: string, log: string}} output
 * @property {{metadata: string, freshness: string, pending: string, state: string, artifact: string}} evidence
 * @property {{policyVersion: number, name: string, container: string, memoryBytes: number, cpuQuota: number, cpuPeriod: number, maxParallelism: number}} builder
 * @property {{scratchBoundary: string, composeProject: string, postgresContainer: string, postgresVolume: string}} cleanup
 */

/**
 * Resolve every mutable local-CI identity from one admitted slot key.
 *
 * Slot 0 intentionally keeps the existing scratch checkout and external ports
 * so rolling back to singleton mode needs no filesystem or data migration.
 * Slot 1 uses a sibling checkout; nesting under the legacy `.local-ci-runner`
 * path is unsafe because that path is itself a registered Git worktree.
 *
 * @param {{
 *   slotKey?: "slot-0"|"slot-1",
 *   rootClone: string,
 *   gitCommonDir?: string,
 *   candidateGitDir?: string,
 * }} input
 * @returns {LocalCiSlotManifest}
 */
export function createLocalCiSlotManifest(input) {
  const slotKey = input.slotKey ?? "slot-0";
  const resources = SLOT_RESOURCES[slotKey];
  if (!resources) {
    throw new Error(`unknown local-CI slot key: ${slotKey}`);
  }

  const rootClone = requireAbsolutePath("rootClone", input.rootClone);
  const gitCommonDir = requireAbsolutePath(
    "gitCommonDir",
    input.gitCommonDir ?? join(rootClone, ".git"),
  );
  const candidateGitDir = requireAbsolutePath(
    "candidateGitDir",
    input.candidateGitDir ?? gitCommonDir,
  );
  const canonicalRootClone = resolveLocalCiRootClone(gitCommonDir);
  if (resolve(rootClone) !== resolve(canonicalRootClone)) {
    throw new Error(
      `rootClone must match the canonical Git common-dir root: ${canonicalRootClone}`,
    );
  }
  // The platform owns this answer; this module no longer derives its own
  // (spec 2026-09-02-platform-owned-client-configuration-design §1).
  const { base: worktreeBase } = resolveWorktreeBase({ rootClone, env: process.env });
  const workspace = resources.ordinal === 0
    ? join(worktreeBase, ".local-ci-runner")
    : join(worktreeBase, `.local-ci-runner-${slotKey}`);
  const composeProject = `dpf-local-ci-${resources.ordinal}`;
  const postgresDatabase = `dpf_local_ci_${resources.ordinal}`;
  const postgresContainer = `dpf-local-ci-postgres-${resources.ordinal}`;
  const postgresVolume = `dpf-local-ci-postgres-${resources.ordinal}`;
  const evidenceSuffix = resources.ordinal === 0 ? "" : `-${slotKey}`;
  const builderName = `dpf-local-ci-buildkit-v${BUILDER_POLICY.version}-${resources.ordinal}`;

  return Object.freeze({
    schemaVersion: LOCAL_CI_SLOT_MANIFEST_SCHEMA_VERSION,
    slotKey,
    scratch: Object.freeze({
      workspace,
      integrationBranchPrefix: `local-integration/${slotKey}`,
    }),
    fence: Object.freeze({
      path: join(gitCommonDir, `dpf-local-ci-owner-${slotKey}.json`),
    }),
    compose: Object.freeze({
      project: composeProject,
      sourceVolume: `${composeProject}-source-code`,
    }),
    portal: Object.freeze({
      port: resources.portalPort,
      url: `http://localhost:${resources.portalPort}`,
    }),
    postgres: Object.freeze({
      container: postgresContainer,
      hostPort: resources.postgresPort,
      database: postgresDatabase,
      volume: postgresVolume,
      url: `postgresql://dpf:dpf_dev@127.0.0.1:${resources.postgresPort}/${postgresDatabase}`,
    }),
    dependencies: Object.freeze({
      convergenceLock: join(workspace, ".dpf-freshness-converge.lock"),
      freshStore: join(workspace, ".pnpm-fresh-store"),
    }),
    builder: Object.freeze({
      policyVersion: BUILDER_POLICY.version,
      name: builderName,
      container: `buildx_buildkit_${builderName}0`,
      memoryBytes: BUILDER_POLICY.memoryBytes,
      cpuQuota: BUILDER_POLICY.cpuQuota,
      cpuPeriod: BUILDER_POLICY.cpuPeriod,
      maxParallelism: BUILDER_POLICY.maxParallelism,
    }),
    output: Object.freeze({
      build: join(workspace, "apps", "web", ".next"),
      log: join(candidateGitDir, `dpf-local-ci-output${evidenceSuffix}.log`),
    }),
    evidence: Object.freeze({
      metadata: join(candidateGitDir, `dpf-local-ci-metadata${evidenceSuffix}.json`),
      freshness: join(candidateGitDir, `dpf-sandbox-freshness${evidenceSuffix}.json`),
      pending: join(candidateGitDir, `dpf-local-ci-pending-evidence${evidenceSuffix}.json`),
      state: join(candidateGitDir, `dpf-local-ci-gate${evidenceSuffix}.json`),
      artifact: join(candidateGitDir, `dpf-local-ci-artifact${evidenceSuffix}.json`),
      controlPlane: join(candidateGitDir, `dpf-local-ci-control-plane${evidenceSuffix}.json`),
    }),
    cleanup: Object.freeze({
      scratchBoundary: workspace,
      composeProject,
      postgresContainer,
      postgresVolume,
    }),
  });
}

/**
 * Produce the complete child-process/Compose handoff from the manifest.
 * Consumers may add run-specific values, but must not recompute slot identity.
 *
 * @param {LocalCiSlotManifest} manifest
 */
export function localCiSlotEnvironment(manifest) {
  return {
    COMPOSE_PROJECT_NAME: manifest.compose.project,
    DPF_LOCAL_CI_SOURCE_VOLUME: manifest.compose.sourceVolume,
    DPF_LOCAL_CI_SLOT_KEY: manifest.slotKey,
    DPF_LOCAL_CI_SLOT_MANIFEST_VERSION: String(manifest.schemaVersion),
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
    DPF_LOCAL_CI_BUILDER_POLICY_VERSION: String(manifest.builder.policyVersion),
    DPF_LOCAL_CI_BUILDER_MEMORY_BYTES: String(manifest.builder.memoryBytes),
    DPF_LOCAL_CI_BUILDER_CPU_QUOTA: String(manifest.builder.cpuQuota),
    DPF_LOCAL_CI_BUILDER_CPU_PERIOD: String(manifest.builder.cpuPeriod),
    DPF_LOCAL_CI_BUILDER_MAX_PARALLELISM: String(manifest.builder.maxParallelism),
    DPF_LOCAL_CI_CONTROL_PLANE_EVIDENCE_FILE: manifest.evidence.controlPlane,
  };
}

/**
 * Fail closed before a recursive cleanup can escape its admitted scratch slot.
 *
 * @param {LocalCiSlotManifest} manifest
 * @param {string} target
 */
export function assertLocalCiCleanupTarget(manifest, target) {
  const boundary = resolve(manifest.cleanup.scratchBoundary);
  const resolvedTarget = requireAbsolutePath("cleanup target", target);
  const displacement = relative(boundary, resolvedTarget);
  if (displacement.startsWith("..") || isAbsolute(displacement)) {
    throw new Error(
      `refusing cleanup outside ${manifest.slotKey} cleanup boundary: ${resolvedTarget}`,
    );
  }
  return resolvedTarget;
}
