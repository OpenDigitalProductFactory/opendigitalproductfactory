import { spawn } from "node:child_process";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import type { SelfUpgradeHostIdentity } from "./config";
import type { InstallStateMigrationHandoff } from "./preflight";
import {
  buildCandidatePromoterArtifactImage,
  resolveCandidatePromoterArtifact,
  type ResolvedPromoterArtifact,
} from "./promoter-artifact";
export {
  PROMOTER_CONTRACT_SCHEMA_VERSION,
  SELF_UPGRADE_CALLER_PROTOCOL_VERSION,
  validateResolvedPromoterArtifact,
  type ResolvedPromoterArtifact,
} from "./promoter-artifact";

/**
 * The promoter runs as a SIBLING container, never inside the portal.
 *
 * scripts/promote.sh rebuilds the portal image and runs
 * `docker compose up -d --force-recreate`, which recreates the portal
 * container. If the script ran inside the portal (the previous behavior:
 * `spawn("bash", "scripts/promote.sh")` against process.cwd()), the
 * recreate would kill the very process executing it mid-swap — and the
 * portal image (Alpine) ships neither bash nor the script, so it could
 * never run there at all.
 *
 * Instead we launch the dedicated promoter image (Dockerfile.promoter:
 * docker-cli + compose + git + promote.sh as ENTRYPOINT) as a separate
 * container via the docker socket the portal already mounts. The promoter
 * survives the portal recycle. This mirrors the `promoter` service +
 * `promoterImage` contract in docker-compose.yml / the self_upgrade config.
 *
 * Scope note: this fixes WHERE the promoter runs. The promote.sh apply
 * logic itself (real image rebuild, layer-aware L1–L4 ordering, rollback,
 * /sha verify) remains the Phase-5 work of the governed-upgrade-lifecycle
 * epic (BI-UPGRADE-011/012); see
 * docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md §5.5/§5.6.
 */

const DEFAULT_PROMOTER_IMAGE = "dpf-promoter";
// Where the host source tree is mounted inside the promoter container.
// Matches the `promoter` service's `:/host-source:ro` mount in
// docker-compose.yml so promote.sh sees the same path either way.
const PROMOTER_CONTAINER_SOURCE = "/host-source";
const PROMOTER_COMPOSE_ENV_FILE = "/install-env/.env";

export type ReadinessOwner = "bridge" | "portal" | "unavailable";
export type UpgradeReadinessMode = "enforced" | "legacy-bootstrap";

export type PromoterDockerRunner = (args: string[]) => Promise<PromoterResult>;
type PromoterTimeoutParams = { timeoutMs?: number } | PromoterParams;

function createPromoterDockerRunner(params: PromoterTimeoutParams): PromoterDockerRunner {
  return (args) => runProcessWithBudget("docker", args, {
    timeoutMs: resolvePromoterTimeoutMs(params),
  });
}

/** Build the candidate-owned local promoter from the prepared source tree. */
export async function buildCandidatePromoterImage(
  params: { sourcePath: string; targetSha: string; promoterImage?: string; timeoutMs?: number },
  runDocker?: PromoterDockerRunner,
): Promise<string> {
  return buildCandidatePromoterArtifactImage(
    params,
    runDocker ?? createPromoterDockerRunner(params),
  );
}

/** Pulls/inspects a target reference once and verifies its embedded contract. */
export async function resolvePromoterArtifact(
  params: { promoterImage?: string; candidateReference?: string; targetSha: string; callerProtocol?: number; timeoutMs?: number },
  runDocker?: PromoterDockerRunner,
): Promise<ResolvedPromoterArtifact> {
  return resolveCandidatePromoterArtifact(
    params,
    runDocker ?? createPromoterDockerRunner(params),
  );
}

export async function runPromoterReadiness(
  params: PromoterParams & { artifact: ResolvedPromoterArtifact },
): Promise<PromoterResult> {
  const { command, args } = buildPromoterReadinessCommand(params);
  return runProcessWithBudget(command, args, {
    timeoutMs: Math.min(resolvePromoterTimeoutMs(params), 5 * 60_000),
    containerName: params.containerName,
  });
}

export type VerifiedReleaseIdentity = {
  tag: string;
  ghcrOwner: string;
  channelDigest: string;
  platformManifestDigest: string;
  configDigest: string;
  platformOs: "linux";
  platformArchitecture: string;
};

export type PromoterParams = {
  /** HOST path of the install tree; bind-mounted into the promoter. */
  hostInstallPath: string;
  /** Git SHA to promote to. */
  targetSha: string;
  /** In-container path the promoter writes its pre-swap backup to. */
  backupPath: string;
  /** Health URL the promoter curls after the swap. */
  healthUrl: string;
  /** Promoter image tag. Defaults to "dpf-promoter". */
  promoterImage?: string;
  /** HOST path for the backups volume; mounted to /backups when provided. */
  backupHostPath?: string;
  /** HOST path to the canonical install .env; mounted read-only for compose interpolation. */
  composeEnvFileHostPath?: string;
  /**
   * The platform-correct compose chain the install was created with (relative
   * filenames, e.g. ["docker-compose.yml", "docker-compose.linux.yml",
   * "docker-compose.edge.yml"]). Passed to promote.sh as PROMOTE_COMPOSE_FILES so
   * the portal is recreated with the SAME overlays the install uses. When empty,
   * promote.sh falls back to base-only — never a platform overlay, so it can't
   * force macOS/Linux env onto the wrong host (the TTS-on-Windows defect).
   */
  composeFiles?: string[];
  /** Compose project name (COMPOSE_PROJECT_NAME). Defaults to "dpf" in promote.sh. */
  composeProject?: string;
  dryRun?: boolean;
  /**
   * Deterministic `docker run --name` for the promoter container. Lets the
   * timeout path (and the watchdog backstop) `docker rm -f` a hung promoter by
   * name — without it, docker assigns a random name and a stalled build can't be
   * targeted for cleanup (SUR-756751D1). Convention: `dpf-promoter-<runId>`.
   */
  containerName?: string;
  /**
   * Hard wall-clock budget for the promoter subprocess, ms. On expiry runPromoter
   * kills the child, force-removes the container, and resolves nonzero with a
   * `[promoter-timeout]` excerpt instead of awaiting forever. Defaults to
   * DPF_PROMOTER_TIMEOUT_MS or 25 min — generous vs a normal ~7-min swap, and
   * under the 30-min DB watchdog so the orchestrator fails cleanly first.
   */
  timeoutMs?: number;
  /** Selects the fail-closed runtime capability transition entrypoint. */
  runtimeCapabilityTransitionId?: string;
  runtimeCapabilityEnvelope?: string;
  runtimeCapabilitySignature?: string;
  /** Host file containing only the transition HMAC secret; mounted read-only. */
  runtimeCapabilitySecretFileHostPath?: string;
  stateDirHostPath?: string;
  runtimeCapabilityProfiles?: string[];
  /** Reserve/release the durable host authority marker without applying. */
  runtimeTransitionAuthorityOperation?: "reserve" | "release" | "reconcile" | "rotate-secret";
  /** Opaque lease token returned by reserve; mandatory for release. */
  runtimeTransitionAuthorityToken?: string;
  /** DB-active transition ids used only by startup reconciliation. */
  runtimeTransitionActiveIds?: string[];
  hostIdentity?: SelfUpgradeHostIdentity;
  installStateMigrationEnvelope?: string;
  installStateMigrationSignature?: string;
  installStateMigrationRunId?: string;
  /** Exact portal-verified carrier retained for orchestration identity/audit. */
  installStateMigrationHandoff?: InstallStateMigrationHandoff;
  /** Verified registry release promoted without a source checkout/build. */
  release?: VerifiedReleaseIdentity;
};

export type PromoterResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

const RUNTIME_TRANSITION_ID = /^RCT-[A-Za-z0-9-]{1,48}$/;
const RUNTIME_TRANSITION_TOKEN = /^[a-f0-9]{64}$/;
const RUNTIME_TRANSITION_ENVELOPE = /^[A-Za-z0-9_-]{16,65536}$/;
const RUNTIME_HOST_PATH_SEGMENT = /^[A-Za-z0-9._ -]+$/;
const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const REGISTRY_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,253}[A-Za-z0-9])?$/;
const IMAGE_CONFIG_DIGEST = /^sha256:[a-f0-9]{64}$/;
const RELEASE_PLATFORM_ARCHITECTURE = /^(?:amd64|arm64)$/;

function isSafeRuntimeHostPath(value: string): boolean {
  if (value.length < 2 || value.length > 1024 || /[\0\r\n]/.test(value)) return false;
  const normalized = value.replaceAll("\\", "/");
  const absoluteBody = normalized.startsWith("/")
    ? normalized.slice(1)
    : /^[A-Za-z]:\//.test(normalized)
      ? normalized.slice(3)
      : "";
  if (!absoluteBody) return false;
  const segments = absoluteBody.split("/");
  return segments.every((segment) => segment !== ".." && RUNTIME_HOST_PATH_SEGMENT.test(segment));
}

function validateRuntimeTransitionCommandInputs(params: PromoterParams): void {
  if (params.runtimeCapabilityTransitionId && !RUNTIME_TRANSITION_ID.test(params.runtimeCapabilityTransitionId)) {
    throw new Error("invalid_runtime_transition_id");
  }
  for (const id of params.runtimeTransitionActiveIds ?? []) {
    if (!RUNTIME_TRANSITION_ID.test(id)) throw new Error("invalid_runtime_transition_id");
  }
  if (params.runtimeTransitionAuthorityToken && !RUNTIME_TRANSITION_TOKEN.test(params.runtimeTransitionAuthorityToken)) {
    throw new Error("invalid_runtime_transition_authority_token");
  }
  for (const path of [params.stateDirHostPath, params.runtimeCapabilitySecretFileHostPath]) {
    if (path && !isSafeRuntimeHostPath(path)) throw new Error("invalid_runtime_transition_host_path");
  }
  if (params.runtimeCapabilityEnvelope && !RUNTIME_TRANSITION_ENVELOPE.test(params.runtimeCapabilityEnvelope)) {
    throw new Error("invalid_runtime_transition_envelope");
  }
  if (params.runtimeCapabilitySignature && !RUNTIME_TRANSITION_TOKEN.test(params.runtimeCapabilitySignature)) {
    throw new Error("invalid_runtime_transition_signature");
  }
  if (params.installStateMigrationEnvelope && !RUNTIME_TRANSITION_ENVELOPE.test(params.installStateMigrationEnvelope)) throw new Error("invalid_install_state_migration_envelope");
  if (params.installStateMigrationSignature && !RUNTIME_TRANSITION_TOKEN.test(params.installStateMigrationSignature)) throw new Error("invalid_install_state_migration_signature");
  if (params.release && (
    !RELEASE_TAG.test(params.release.tag) ||
    !REGISTRY_OWNER.test(params.release.ghcrOwner) ||
    !IMAGE_CONFIG_DIGEST.test(params.release.channelDigest) ||
    !IMAGE_CONFIG_DIGEST.test(params.release.platformManifestDigest) ||
    !IMAGE_CONFIG_DIGEST.test(params.release.configDigest) ||
    params.release.platformOs !== "linux" ||
    !RELEASE_PLATFORM_ARCHITECTURE.test(params.release.platformArchitecture)
  )) {
    throw new Error("invalid_release_identity");
  }
}

/**
 * Pure builder for the `docker run` invocation that launches the promoter
 * container. Separated from runPromoter so it can be unit-tested without
 * spawning a process. Returns the command and argv exactly as spawned.
 */
export function buildPromoterCommand(
  params: PromoterParams,
): { command: string; args: string[] } {
  validateRuntimeTransitionCommandInputs(params);
  const image =
    params.promoterImage && params.promoterImage.length > 0
      ? params.promoterImage
      : DEFAULT_PROMOTER_IMAGE;

  // The promoter runs in its own container, so the portal's "localhost" health
  // URL is unreachable (that loopback is the promoter's own). Rewrite it to
  // host.docker.internal so curl hits the portal's published host port — the
  // new portal that the promoter just recreated.
  const healthUrl = params.healthUrl.replace(
    /\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/,
    "//host.docker.internal",
  );

  const args = [
    "run",
    "--rm",
    // Reach the recreated portal's published host port for health/sha verify.
    "--add-host",
    "host.docker.internal:host-gateway",
  ];

  // Deterministic name so a hung promoter can be force-removed by the timeout
  // path / watchdog. `--rm` still auto-cleans a clean exit; the name only
  // matters when the build stalls and never closes.
  if (params.containerName && params.containerName.length > 0) {
    args.push("--name", params.containerName);
  }

  args.push(
    // Sibling-container control: the promoter drives the daemon to rebuild
    // and recreate the portal.
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock",
    // Host source tree (read-only): build context + backup source.
    "-v",
    `${params.hostInstallPath}:${PROMOTER_CONTAINER_SOURCE}${params.release ? "" : ":ro"}`,
  );

  if (params.backupHostPath && params.backupHostPath.length > 0) {
    args.push("-v", `${params.backupHostPath}:/backups`);
  }

  if (params.composeEnvFileHostPath && params.composeEnvFileHostPath.length > 0) {
    args.push("-v", `${params.composeEnvFileHostPath}:${PROMOTER_COMPOSE_ENV_FILE}:ro`);
  }

  // promote.sh resolves the install's governed capability projection before
  // every portal rebuild, including ordinary self-upgrades. Mount lifecycle
  // state for every mode rather than only transition-authority calls.
  if (params.stateDirHostPath) {
    args.push("-v", `${params.stateDirHostPath}:/dpf-state`, "-e", "DPF_PROMOTER_STATE_DIR=/dpf-state");
  }
  if (params.hostIdentity) args.push("-e", `DPF_HOST_PLATFORM=${params.hostIdentity.platform}`, "-e", `DPF_HOST_ARCH=${params.hostIdentity.arch}`, "-e", `DPF_HOST_IDENTITY_PROVENANCE=${params.hostIdentity.provenance}`);

  args.push(
    "-e",
    `PROMOTE_SOURCE=${PROMOTER_CONTAINER_SOURCE}`,
    "-e",
    `PROMOTE_TARGET_SHA=${params.targetSha}`,
    "-e",
    `PROMOTE_BACKUP_PATH=${params.backupPath}`,
    "-e",
    `PROMOTE_HEALTH_URL=${healthUrl}`,
  );

  if (params.release) {
    args.push(
      "-e",
      "DPF_PROMOTION_MODE=release",
      "-e",
      `DPF_RELEASE_TAG=${params.release.tag}`,
      "-e",
      `DPF_RELEASE_CHANNEL_DIGEST=${params.release.channelDigest}`,
      "-e",
      `DPF_RELEASE_PLATFORM_MANIFEST_DIGEST=${params.release.platformManifestDigest}`,
      "-e",
      `DPF_RELEASE_CONFIG_DIGEST=${params.release.configDigest}`,
      "-e",
      `DPF_RELEASE_PLATFORM_OS=${params.release.platformOs}`,
      "-e",
      `DPF_RELEASE_PLATFORM_ARCHITECTURE=${params.release.platformArchitecture}`,
      "-e",
      `GHCR_OWNER=${params.release.ghcrOwner}`,
    );
  }

  if (params.composeEnvFileHostPath && params.composeEnvFileHostPath.length > 0) {
    args.push("-e", `PROMOTE_COMPOSE_ENV_FILE=${PROMOTER_COMPOSE_ENV_FILE}`);
  }

  // Recreate the portal with the install's recorded platform chain. promote.sh
  // splits PROMOTE_COMPOSE_FILES on whitespace, so a space-joined list is the
  // contract. Omitted when empty so promote.sh applies its base-only fallback.
  if (params.composeFiles && params.composeFiles.length > 0) {
    args.push("-e", `PROMOTE_COMPOSE_FILES=${params.composeFiles.join(" ")}`);
  }

  args.push("-e", `PROMOTE_COMPOSE_PROJECT=${params.composeProject || "dpf"}`);

  if (params.runtimeTransitionAuthorityOperation) {
    if (!params.stateDirHostPath || (!["reconcile", "rotate-secret"].includes(params.runtimeTransitionAuthorityOperation) && !params.runtimeCapabilityTransitionId) ||
      (params.runtimeTransitionAuthorityOperation === "release" && !params.runtimeTransitionAuthorityToken)) throw new Error("runtime_transition_authority_protocol_incomplete");
    if (params.runtimeTransitionAuthorityOperation === "reconcile") args.push("-e", `DPF_ACTIVE_RUNTIME_TRANSITION_IDS=${(params.runtimeTransitionActiveIds ?? []).join(",")}`);
  } else if (params.runtimeCapabilityTransitionId) {
    if (!params.stateDirHostPath || !params.runtimeCapabilityEnvelope || !params.runtimeCapabilitySignature || !params.runtimeCapabilitySecretFileHostPath) {
      throw new Error("runtime_transition_protocol_incomplete");
    }
    args.push("-v", `${params.runtimeCapabilitySecretFileHostPath}:/run/secrets/dpf-runtime-transition:ro`);
    args.push("-e", `DPF_RUNTIME_TRANSITION_ENVELOPE=${params.runtimeCapabilityEnvelope}`,
      "-e", `DPF_RUNTIME_TRANSITION_SIGNATURE=${params.runtimeCapabilitySignature}`);
  }
  if (params.installStateMigrationEnvelope || params.installStateMigrationSignature) {
    if (!params.stateDirHostPath || !params.installStateMigrationEnvelope || !params.installStateMigrationSignature || !params.installStateMigrationRunId) throw new Error("install_state_migration_protocol_incomplete");
    args.push("-v", `${params.stateDirHostPath}/runtime-transition.secret:/run/secrets/dpf-runtime-transition:ro`, "-e", `DPF_INSTALL_STATE_MIGRATION_ENVELOPE=${params.installStateMigrationEnvelope}`, "-e", `DPF_INSTALL_STATE_MIGRATION_SIGNATURE=${params.installStateMigrationSignature}`, "-e", `DPF_SELF_UPGRADE_RUN_ID=${params.installStateMigrationRunId}`, "-e", `DPF_PROMOTER_DIGEST=${image}`);
  }

  args.push(image);
  if (params.runtimeTransitionAuthorityOperation) {
    if (params.runtimeTransitionAuthorityOperation === "rotate-secret") args.push("--runtime-transition-secret-rotation");
    else args.push("--runtime-transition-authority", params.runtimeTransitionAuthorityOperation);
    if (params.runtimeCapabilityTransitionId) args.push(params.runtimeCapabilityTransitionId);
    if (params.runtimeTransitionAuthorityToken) args.push(params.runtimeTransitionAuthorityToken);
  } else if (params.runtimeCapabilityTransitionId) {
    args.push("--runtime-capability-transition", params.runtimeCapabilityTransitionId);
  } else {
    args.push("--self-upgrade");
  }

  if (params.dryRun) args.push("--dry-run");

  return { command: "docker", args };
}

/** Readiness always launches the previously resolved immutable artifact. */
export function buildPromoterReadinessCommand(
  params: PromoterParams & { artifact: ResolvedPromoterArtifact },
): { command: string; args: string[] } {
  const command = buildPromoterCommand({ ...params, promoterImage: params.artifact.digest });
  const socketIndex = command.args.indexOf("/var/run/docker.sock:/var/run/docker.sock");
  if (socketIndex > 0 && command.args[socketIndex - 1] === "-v") {
    command.args.splice(socketIndex - 1, 2);
  }
  const stateIndex = command.args.findIndex((arg) => arg.endsWith(":/dpf-state"));
  if (stateIndex >= 0) command.args[stateIndex] = `${command.args[stateIndex]}:ro`;
  const backupsIndex = command.args.findIndex((arg) => arg.endsWith(":/backups"));
  if (backupsIndex >= 0) command.args[backupsIndex] = `${command.args[backupsIndex]}:ro`;
  const imageIndex = command.args.indexOf(params.artifact.digest);
  if (imageIndex < 0) throw new Error("promoter_readiness_image_unavailable");
  command.args.splice(imageIndex, 0, "-e", "DPF_PROMOTER_DOCKER_PREFLIGHT=ready");
  const modeIndex = command.args.lastIndexOf("--self-upgrade");
  if (modeIndex < 0) throw new Error("promoter_readiness_mode_unavailable");
  command.args[modeIndex] = "--readiness";
  return command;
}

/**
 * Whether the promoter image is present on the daemon.
 *
 * A self-upgrade can never complete a swap without it, so the orchestrator
 * checks this BEFORE draining the portal — otherwise it drains, burns the full
 * quiescence budget, then fails at `docker run` because there's no `dpf-promoter`
 * image, leaving the portal needlessly cycled (the live BI-A3930CD7 cluster
 * symptom). Returns false when the image is absent OR docker itself is
 * unreachable (the portal can't promote either way). Never throws.
 *
 * dryRun never swaps, so callers skip this check on the dry-run path.
 */
export async function isPromoterAvailable(promoterImage?: string): Promise<boolean> {
  const image =
    promoterImage && promoterImage.length > 0 ? promoterImage : DEFAULT_PROMOTER_IMAGE;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const child = spawn("docker", ["image", "inspect", image], { env: { ...process.env } });
      // Drain stdio so the child can exit cleanly; we only care about the code.
      child.stdout?.on("data", () => {});
      child.stderr?.on("data", () => {});
      child.on("close", (code: number | null) => finish(code === 0));
      child.on("error", () => finish(false));
    } catch {
      finish(false);
    }
  });
}

/**
 * The just-in-time promoter build recipe. The build inputs are baked into the
 * portal image at `/promoter/` (see Dockerfile `COPY … /promoter/*`), laid out
 * to mirror the repo root — `Dockerfile` (the portal build),
 * `Dockerfile.promoter`, and `scripts/promote.sh`. Building from a temp dir with
 * that layout lets the same `Dockerfile.promoter` build the promoter image from
 * inside the portal container, with no host clone. This is the exact recipe the
 * promotion path has used (apps/web/lib/actions/promotions.ts); it now lives
 * here so the self-upgrade auto-heal and the governed repair tool share it.
 *
 * The script is a fixed constant — no interpolation — so it is safe to run via
 * `sh -c` without shell-injection risk.
 */
export const PROMOTER_JIT_BUILD_SCRIPT =
  "BDIR=$(mktemp -d) && trap 'rm -rf \"$BDIR\"' EXIT && " +
  "cp /promoter/Dockerfile \"$BDIR/Dockerfile\" && " +
  "cp /promoter/Dockerfile.promoter \"$BDIR/Dockerfile.promoter\" && " +
  "cp /promoter/promoter-contract.json \"$BDIR/promoter-contract.json\" && " +
  "mkdir -p \"$BDIR/scripts\" && mkdir -p \"$BDIR/scripts/installer\" && mkdir -p \"$BDIR/scripts/lib\" && " +
  "cp /promoter/scripts/promote.sh \"$BDIR/scripts/promote.sh\" && " +
  "cp /promoter/scripts/governed-teardown.mjs \"$BDIR/scripts/governed-teardown.mjs\" && " +
  "cp /promoter/scripts/salvage-sweep.mjs \"$BDIR/scripts/salvage-sweep.mjs\" && " +
  "cp /promoter/scripts/apply-runtime-capability-transition.mjs \"$BDIR/scripts/apply-runtime-capability-transition.mjs\" && " +
  "cp /promoter/scripts/runtime-transition-authority.mjs \"$BDIR/scripts/runtime-transition-authority.mjs\" && " +
  "cp /promoter/scripts/rotate-runtime-transition-secret.mjs \"$BDIR/scripts/rotate-runtime-transition-secret.mjs\" && " +
  "cp /promoter/scripts/lib/transition-signing.mjs \"$BDIR/scripts/lib/transition-signing.mjs\" && " +
  "cp /promoter/scripts/promoter-migration-envelope.mjs \"$BDIR/scripts/promoter-migration-envelope.mjs\" && " +
  "cp /promoter/scripts/installer/validate-install-state.mjs \"$BDIR/scripts/installer/validate-install-state.mjs\" && " +
  "cp /promoter/scripts/installer/migrate-install-state.mjs \"$BDIR/scripts/installer/migrate-install-state.mjs\" && " +
  "cp /promoter/scripts/installer/resolve-host-identity.mjs \"$BDIR/scripts/installer/resolve-host-identity.mjs\" && " +
  "cp /promoter/scripts/installer/install-state-transaction.mjs \"$BDIR/scripts/installer/install-state-transaction.mjs\" && " +
  "cp /promoter/scripts/installer/install-release-assets.mjs \"$BDIR/scripts/installer/install-release-assets.mjs\" && " +
  "cp /promoter/scripts/installer/install-state-lock-contract.json \"$BDIR/scripts/installer/install-state-lock-contract.json\" && " +
  "cp /promoter/scripts/installer/install-state-schema-registry.mjs \"$BDIR/scripts/installer/install-state-schema-registry.mjs\" && " +
  "cp /promoter/scripts/installer/install-state.schema.json \"$BDIR/scripts/installer/install-state.schema.json\" && " +
  "cp /promoter/scripts/installer/install-state.v1.schema.json \"$BDIR/scripts/installer/install-state.v1.schema.json\" && " +
  "cp /promoter/scripts/installer/install-state.v2.schema.json \"$BDIR/scripts/installer/install-state.v2.schema.json\" && " +
  "cp /promoter/scripts/lib/resolve-capability-compose-profiles.mjs \"$BDIR/scripts/lib/resolve-capability-compose-profiles.mjs\" && " +
  "cp /promoter/scripts/lib/govern-capability-compose-args.mjs \"$BDIR/scripts/lib/govern-capability-compose-args.mjs\" && " +
  "cp /promoter/scripts/lib/capability-state-hash.mjs \"$BDIR/scripts/lib/capability-state-hash.mjs\" && " +
  "cp /promoter/scripts/capability-service-catalog.generated.json \"$BDIR/scripts/capability-service-catalog.generated.json\" && " +
  "tar -C \"$BDIR\" -c . | docker buildx build --load -t dpf-promoter -f Dockerfile.promoter -";

/**
 * Whether the configured promoter image can be built here from the portal's
 * baked-in `/promoter/` files. Only the default local `dpf-promoter` tag is —
 * a custom or registry-qualified image (e.g. `ghcr.io/acme/dpf-promoter:v1`) is
 * a pull-based deployment the operator owns, not something we synthesise and
 * mis-tag locally. Pure so it is unit-testable without a daemon.
 */
export function isJitBuildablePromoterImage(promoterImage?: string): boolean {
  const image =
    promoterImage && promoterImage.length > 0 ? promoterImage : DEFAULT_PROMOTER_IMAGE;
  return image === DEFAULT_PROMOTER_IMAGE;
}

export type EnsurePromoterResult = {
  /** True when the image is present on the daemon after this call. */
  ok: boolean;
  /** The image was already present; no build was attempted. */
  alreadyPresent: boolean;
  /** A build ran and succeeded during this call. */
  built: boolean;
  /** Why `ok` is false, when it is. */
  skipReason?: "custom-image" | "build-failed";
  /** Trailing build stderr (truncated) when a build failed. */
  detail?: string;
};

/**
 * What ensurePromoterImage should do, given whether an image is already present
 * and whether it is JIT-buildable. Pure so the load-bearing rule is unit-tested
 * without docker.
 *
 * - `rebuild`: JIT-buildable dpf-promoter — ALWAYS rebuild from the portal's
 *   freshly-baked /promoter/ layout, EVEN when a stale image is present. The
 *   promoter bakes promote.sh as its ENTRYPOINT (Dockerfile.promoter), so a
 *   present-but-outdated image runs an OLD promote.sh and silently skips newer
 *   steps — the BI-8843BD48 bug that let a stale promoter drop BI-A8686CFC's
 *   sandbox-refresh on installs whose promoter image predated the fix. The image
 *   is tiny (docker CLI + compose + git + the script), so rebuilding every call
 *   is negligible and correct-by-construction beats staleness detection.
 * - `use-present`: a custom/registry image that exists — used as-is (we can't
 *   synthesise someone else's tag locally).
 * - `cannot-build`: a custom/registry image that is missing — left to the
 *   operator's pull.
 */
export function decidePromoterEnsureAction(
  present: boolean,
  jitBuildable: boolean,
): "rebuild" | "use-present" | "cannot-build" {
  if (jitBuildable) return "rebuild";
  return present ? "use-present" : "cannot-build";
}

/**
 * Make the promoter image current, (re)building it just-in-time from the inputs
 * baked into the portal.
 *
 * This is the self-heal for the `promoter-unavailable` self-upgrade skip and the
 * body of the governed `repair_promoter_image` tool: instead of stranding a
 * non-technical operator with a `docker build` command, the platform builds the
 * image itself. For the JIT-buildable `dpf-promoter` it ALWAYS rebuilds so the
 * promoter never runs a stale baked promote.sh (BI-8843BD48); a custom/registry
 * image is used as-is when present and left to the operator's pull when missing.
 * Never throws (mirrors `isPromoterAvailable`); failures surface via `ok:false`
 * + `skipReason` so callers decide whether to skip, fall back, or report.
 */
export async function ensurePromoterImage(
  promoterImage?: string,
): Promise<EnsurePromoterResult> {
  const present = await isPromoterAvailable(promoterImage);
  const action = decidePromoterEnsureAction(
    present,
    isJitBuildablePromoterImage(promoterImage),
  );

  if (action === "use-present") {
    return { ok: true, alreadyPresent: true, built: false };
  }
  // A custom/registry image can't be synthesised locally — leave it to the
  // operator's pull, and report cleanly so the caller keeps the skip.
  if (action === "cannot-build") {
    return { ok: false, alreadyPresent: false, built: false, skipReason: "custom-image" };
  }

  // action === "rebuild": always refresh the JIT-buildable promoter image.
  return await new Promise<EnsurePromoterResult>((resolve) => {
    let settled = false;
    const finish = (r: EnsurePromoterResult): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    try {
      const child = spawn("sh", ["-c", PROMOTER_JIT_BUILD_SCRIPT], {
        env: { ...process.env },
      });
      let stderr = "";
      child.stdout?.on("data", () => {});
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk;
      });
      child.on("close", (code: number | null) => {
        if (code === 0) {
          finish({ ok: true, alreadyPresent: false, built: true });
        } else {
          finish({
            ok: false,
            alreadyPresent: false,
            built: false,
            skipReason: "build-failed",
            detail: stderr.trim().slice(-1500) || undefined,
          });
        }
      });
      child.on("error", (err: Error) => {
        finish({
          ok: false,
          alreadyPresent: false,
          built: false,
          skipReason: "build-failed",
          detail: err.message,
        });
      });
    } catch (err) {
      finish({
        ok: false,
        alreadyPresent: false,
        built: false,
        skipReason: "build-failed",
        detail: getErrorMessage(err),
      });
    }
  });
}

/** Exit code runPromoter reports when it kills a promoter that blew its budget. */
export const PROMOTER_TIMEOUT_EXIT_CODE = 124; // GNU `timeout` convention.

// The already-running sentinel lives in a PURE sibling module so server bundle
// entrypoints (the Inngest orchestrator) can import it statically without
// pulling this Docker-spawning module into the bundle (BI-98AF1066). Re-exported
// here for runPromoter's own use and the unit tests that import from ./promoter.
export { PROMOTER_ALREADY_RUNNING_EXIT_CODE } from "./promoter-exit-codes";
import { PROMOTER_ALREADY_RUNNING_EXIT_CODE } from "./promoter-exit-codes";

export type PromoterContainerState =
  | "running" // an active promoter is building this run right now
  | "present" // a container with the name exists but is not running (dead corpse)
  | "absent"; // no such container

/**
 * Classify `docker inspect -f '{{.State.Running}}' <name>` output. Pure so the
 * mapping is unit-testable without a daemon. A nonzero exit is docker's "no such
 * object" — absent. `true` is a live build; anything else (e.g. `false` for an
 * exited container `--rm` never cleaned) is present-but-dead.
 */
export function interpretContainerInspect(
  exitCode: number,
  stdout: string,
): PromoterContainerState {
  if (exitCode !== 0) return "absent";
  return stdout.trim() === "true" ? "running" : "present";
}

/**
 * Decide how to launch given the state of a same-named container. Pure.
 * - running  → `defer`: another dispatch of this runId is already building; a
 *   second `docker run --name` would collide and false-fail that healthy build.
 * - present  → `reclaim`: a dead corpse holds the name (crash/daemon restart
 *   left it, `--rm` never fired); force-remove it, then launch fresh.
 * - absent   → `launch`: nothing in the way.
 */
export function decidePromoterLaunch(
  state: PromoterContainerState,
): "defer" | "reclaim" | "launch" {
  if (state === "running") return "defer";
  if (state === "present") return "reclaim";
  return "launch";
}

/**
 * Inspect a promoter container by name. Never throws: resolves "absent" when
 * docker is unreachable or no such container exists, so the launch path treats
 * an inspect failure as "nothing in the way" and proceeds normally.
 */
export async function inspectPromoterContainerState(
  name: string,
): Promise<PromoterContainerState> {
  if (!name) return "absent";
  return new Promise((resolve) => {
    try {
      const child = spawn("docker", ["inspect", "-f", "{{.State.Running}}", name], {
        env: { ...process.env },
      });
      let stdout = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk;
      });
      child.stderr?.on("data", () => {});
      child.on("close", (code: number | null) =>
        resolve(interpretContainerInspect(code ?? 1, stdout)),
      );
      child.on("error", () => resolve("absent"));
    } catch {
      resolve("absent");
    }
  });
}

/** Default hard budget for the promoter subprocess: 25 min (env-overridable). */
export function resolvePromoterTimeoutMs(params: PromoterTimeoutParams): number {
  if (typeof params.timeoutMs === "number" && params.timeoutMs > 0) return params.timeoutMs;
  const env = Number(process.env.DPF_PROMOTER_TIMEOUT_MS);
  if (Number.isFinite(env) && env > 0) return env;
  return 25 * 60 * 1000;
}

/**
 * Force-remove a promoter container by name. Best-effort: the timeout path uses
 * it to stop a build that stalled and never closed (killing the local `docker
 * run` client does NOT stop the daemon-side build/container). Never throws.
 */
export async function forceRemovePromoterContainer(name: string): Promise<void> {
  if (!name) return;
  await new Promise<void>((resolve) => {
    try {
      const child = spawn("docker", ["rm", "-f", name], { env: { ...process.env } });
      child.stdout?.on("data", () => {});
      child.stderr?.on("data", () => {});
      child.on("close", () => resolve());
      child.on("error", () => resolve());
    } catch {
      resolve();
    }
  });
}

/**
 * Spawn a process under a hard wall-clock budget. On expiry: kill the child,
 * force-remove `containerName` (so a daemon-side build actually stops — killing
 * the local client does not), and resolve nonzero with a `[promoter-timeout]`
 * marker. Separated from runPromoter so the timeout path is unit-testable with a
 * cheap hanging command instead of a real `docker run`.
 */
export async function runProcessWithBudget(
  command: string,
  args: string[],
  opts: { timeoutMs: number; containerName?: string },
): Promise<PromoterResult> {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { env: { ...process.env }, shell: false });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const mins = Math.round(opts.timeoutMs / 60000);
      stderr += `\n[promoter-timeout] promoter did not finish within ${mins}m — killed and container force-removed.`;
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      void forceRemovePromoterContainer(opts.containerName ?? "").finally(() => {
        done({ exitCode: PROMOTER_TIMEOUT_EXIT_CODE, stdout, stderr });
      });
    }, opts.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk;
    });

    child.on("close", (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done({ exitCode: code ?? 1, stdout, stderr });
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

export async function runPromoter(params: PromoterParams): Promise<PromoterResult> {
  // Idempotency guard (SUR-E2BF265E). The container name is deterministic
  // (`dpf-promoter-<runId>`), so a concurrent or retried dispatch of the SAME
  // run reaching here would issue a second `docker run --name <name>` and hit
  // "The container name is already in use" — recorded by the orchestrator as a
  // build FAILURE even though the first promoter is still healthily building.
  const name = params.containerName;
  if (name) {
    const action = decidePromoterLaunch(await inspectPromoterContainerState(name));
    if (action === "defer") {
      return {
        exitCode: PROMOTER_ALREADY_RUNNING_EXIT_CODE,
        stdout: "",
        stderr: `[promoter-already-running] a promoter container named ${name} is already building this run; deferring to it instead of launching a duplicate.`,
      };
    }
    if (action === "reclaim") {
      // A prior promoter for this run exists but is no longer running — a
      // crash/daemon-restart corpse `--rm` never cleaned. Remove it so the fresh
      // launch below doesn't collide on the name.
      await forceRemovePromoterContainer(name);
    }
  }
  const { command, args } = buildPromoterCommand(params);
  // Hard wall-clock bound. Without it a stalled `docker build` (SUR-756751D1: an
  // `apk add` fetch that crawled for 52 min) never closes, so `await runPromoter`
  // blocks the orchestrator until the 30-min DB watchdog — and the orphaned
  // container keeps building, risking a late unexpected swap.
  return runProcessWithBudget(command, args, {
    timeoutMs: resolvePromoterTimeoutMs(params),
    containerName: params.containerName,
  });
}
