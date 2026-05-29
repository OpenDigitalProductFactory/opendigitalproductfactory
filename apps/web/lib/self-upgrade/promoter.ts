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

  const args = [
    "run",
    "--rm",
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

  args.push(
    "-e",
    `PROMOTE_SOURCE=${PROMOTER_CONTAINER_SOURCE}`,
    "-e",
    `PROMOTE_TARGET_SHA=${params.targetSha}`,
    "-e",
    `PROMOTE_BACKUP_PATH=${params.backupPath}`,
    "-e",
    `PROMOTE_HEALTH_URL=${params.healthUrl}`,
    image,
    "--self-upgrade",
  );

  if (params.dryRun) args.push("--dry-run");

  return { command: "docker", args };
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
