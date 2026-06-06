import { spawn } from "node:child_process";

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
};

export type PromoterResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

/**
 * Pure builder for the `docker run` invocation that launches the promoter
 * container. Separated from runPromoter so it can be unit-tested without
 * spawning a process. Returns the command and argv exactly as spawned.
 */
export function buildPromoterCommand(
  params: PromoterParams,
): { command: string; args: string[] } {
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
    // Sibling-container control: the promoter drives the daemon to rebuild
    // and recreate the portal.
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock",
    // Host source tree (read-only): build context + backup source.
    "-v",
    `${params.hostInstallPath}:${PROMOTER_CONTAINER_SOURCE}:ro`,
  ];

  if (params.backupHostPath && params.backupHostPath.length > 0) {
    args.push("-v", `${params.backupHostPath}:/backups`);
  }

  if (params.composeEnvFileHostPath && params.composeEnvFileHostPath.length > 0) {
    args.push("-v", `${params.composeEnvFileHostPath}:${PROMOTER_COMPOSE_ENV_FILE}:ro`);
  }

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

  if (params.composeEnvFileHostPath && params.composeEnvFileHostPath.length > 0) {
    args.push("-e", `PROMOTE_COMPOSE_ENV_FILE=${PROMOTER_COMPOSE_ENV_FILE}`);
  }

  // Recreate the portal with the install's recorded platform chain. promote.sh
  // splits PROMOTE_COMPOSE_FILES on whitespace, so a space-joined list is the
  // contract. Omitted when empty so promote.sh applies its base-only fallback.
  if (params.composeFiles && params.composeFiles.length > 0) {
    args.push("-e", `PROMOTE_COMPOSE_FILES=${params.composeFiles.join(" ")}`);
  }

  if (params.composeProject && params.composeProject.length > 0) {
    args.push("-e", `PROMOTE_COMPOSE_PROJECT=${params.composeProject}`);
  }

  args.push(
    image,
    "--self-upgrade",
  );

  if (params.dryRun) args.push("--dry-run");

  return { command: "docker", args };
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

export async function runPromoter(params: PromoterParams): Promise<PromoterResult> {
  const { command, args } = buildPromoterCommand(params);

  return new Promise((done, reject) => {
    const child = spawn(command, args, { env: { ...process.env } });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk;
    });

    child.on("close", (code: number | null) => {
      done({ exitCode: code ?? 1, stdout, stderr });
    });

    child.on("error", reject);
  });
}
