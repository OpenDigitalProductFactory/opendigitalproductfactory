import { execFileSync, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, writeFileSync, chmodSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Shared harness for the promote.sh functional suites: a real Git repo, a fake
// `docker` + `curl` on PATH, and the signed install-state envelope the script
// demands. Split out of promote-script-functional.test.ts when that file crossed
// the 800-LOC module ceiling; the cleanup suite lives in
// promote-script-cleanup.test.ts.

export const SCRIPT = resolve(__dirname, "../../../../scripts/promote.sh");
export const REPO_ROOT = resolve(__dirname, "../../../..");
const MIGRATOR = join(REPO_ROOT, "scripts", "installer", "migrate-install-state.mjs");
const CATALOG = join(REPO_ROOT, "scripts", "capability-service-catalog.generated.json");
const gitBash = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");
const BASH_COMMAND = process.platform === "win32" && existsSync(gitBash) ? gitBash : "bash";
export const BASH_OK = spawnSync(BASH_COMMAND, ["--version"], { encoding: "utf8" }).status === 0;
export const GIT_OK = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;
export const PROMOTE_TEST_TIMEOUT_MS = 30_000;

let bashDrivePrefix: string | undefined;

export function toBashPath(value: string): string {
  if (process.platform !== "win32") return value;
  const normalized = value.replace(/\\/g, "/");
  const drivePath = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (!drivePath) return normalized;

  const drive = drivePath[1].toLowerCase();
  const rest = drivePath[2];
  if (bashDrivePrefix === undefined) {
    const cwdDrive = /^([A-Za-z]):/.exec(process.cwd())?.[1]?.toLowerCase();
    const pwd = spawnSync(BASH_COMMAND, ["-lc", "pwd"], { encoding: "utf8" }).stdout.trim();
    bashDrivePrefix = cwdDrive && pwd.startsWith(`/mnt/${cwdDrive}/`) ? "/mnt" : "";
  }
  return `${bashDrivePrefix}/${drive}/${rest}`;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function gitInit(dir: string): string {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
  };
  execFileSync("git", ["init", "-b", "main", dir], { env });
  execFileSync("git", ["-C", dir, "config", "core.autocrlf", "false"], { env });
  execFileSync("git", ["-C", dir, "config", "core.eol", "lf"], { env });
  writeFileSync(join(dir, "Dockerfile"), "FROM scratch\n");
  writeFileSync(join(dir, "docker-compose.yml"), "services: {}\n");
  writeFileSync(join(dir, "docker-compose.macos.yml"), "services: {}\n");
  mkdirSync(join(dir, "scripts", "lib"), { recursive: true });
  copyFileSync(join(REPO_ROOT, "scripts", "lib", "resolve-capability-compose-profiles.mjs"), join(dir, "scripts", "lib", "resolve-capability-compose-profiles.mjs"));
  copyFileSync(join(REPO_ROOT, "scripts", "lib", "govern-capability-compose-args.mjs"), join(dir, "scripts", "lib", "govern-capability-compose-args.mjs"));
  copyFileSync(join(REPO_ROOT, "scripts", "lib", "capability-state-hash.mjs"), join(dir, "scripts", "lib", "capability-state-hash.mjs"));
  copyFileSync(join(REPO_ROOT, "scripts", "capability-service-catalog.generated.json"), join(dir, "scripts", "capability-service-catalog.generated.json"));
  execFileSync("git", ["-C", dir, "add", "-A"], { env });
  execFileSync("git", ["-C", dir, "-c", "commit.gpgsign=false", "commit", "-m", "seed"], { env });
  return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { env }).toString().trim();
}

/** Fake `docker` and `curl` on PATH. */
export function makeFakeBin(root: string): string {
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  // docker: `build`/`up` are no-ops; any `cat /app/.dpf-source-content-hash`
  // (the content-verify guard — step 3 `docker run` and step 7
  // `docker compose exec`) returns a single stable hash so built==running.
  writeFileSync(
    join(bin, "docker"),
    `#!/bin/sh
env_file=
take_env_file=0
for arg in "$@"; do
  if [ "$take_env_file" = 1 ]; then env_file="$arg"; take_env_file=0; continue; fi
  if [ "$arg" = "--env-file" ]; then take_env_file=1; fi
done
[ -n "$DOCKER_LOG" ] && printf '%s\\n' "$*" >> "$DOCKER_LOG"
case "$*" in
  *".Id"*) printf "%s" "\${DPF_TEST_RELEASE_ENGINE_ID:-$DPF_TEST_RELEASE_CONFIG_DIGEST}" ;;
  *".RepoDigests"*) printf "%s@%s\n" "$DPF_TEST_RELEASE_REPO" "\${DPF_TEST_RELEASE_REPO_ID:-$DPF_TEST_RELEASE_ENGINE_ID}" ;;
  *".Os"*) printf "%s" "\${DPF_TEST_RELEASE_OS:-linux}" ;;
  *".Architecture"*) printf "%s" "\${DPF_TEST_RELEASE_ARCHITECTURE:-amd64}" ;;
  *"buildx imagetools inspect"*"--raw"*) case "$*" in *"@$DPF_TEST_RELEASE_PLATFORM_MANIFEST_DIGEST"*) printf '{"config":{"digest":"%s"}}' "\${DPF_TEST_RELEASE_REGISTRY_CONFIG_DIGEST:-$DPF_TEST_RELEASE_CONFIG_DIGEST}" ;; *) if [ "\${DPF_TEST_DUPLICATE_PLATFORM:-no}" = yes ]; then printf '{"manifests":[{"digest":"%s","platform":{"os":"%s","architecture":"%s"}},{"digest":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","platform":{"os":"%s","architecture":"%s"}}]}' "$DPF_TEST_RELEASE_PLATFORM_MANIFEST_DIGEST" "$DPF_TEST_RELEASE_OS" "$DPF_TEST_RELEASE_ARCHITECTURE" "$DPF_TEST_RELEASE_OS" "$DPF_TEST_RELEASE_ARCHITECTURE"; else printf '{"manifests":[{"digest":"%s","platform":{"os":"%s","architecture":"%s"}}]}' "$DPF_TEST_RELEASE_PLATFORM_MANIFEST_DIGEST" "$DPF_TEST_RELEASE_OS" "$DPF_TEST_RELEASE_ARCHITECTURE"; fi ;; esac ;;
  *"org.opencontainers.image.version"*) printf "%s" "$DPF_TEST_RELEASE_TAG" ;;
  *"org.opencontainers.image.revision"*) printf "%s" "$DPF_TEST_RELEASE_SHA" ;;
  "create "*) printf "candidate-container" ;;
  "cp candidate-container:/dpf-release-assets/. "*)
    for destination in "$@"; do :; done
    # Match Docker's directory-copy semantics on both platforms.
    mkdir -p "$destination"; cp -R "$DPF_TEST_RELEASE_ASSETS"/. "$destination/"
    ;;
  *"recover-human-principal-backfill-migration.mjs --verify-rolled-back"*)
    [ "\${DPF_TEST_PRINCIPAL_VERIFY_FAIL:-no}" = "yes" ] && exit 1
    printf "verified"
    ;;
  *"prisma migrate resolve --rolled-back 20260812110000_backfill_missing_human_principals"*)
    [ "\${DPF_TEST_PRINCIPAL_RESOLVE_FAIL:-no}" = "yes" ] && exit 1
    ;;
  *"recover-human-principal-backfill-migration.mjs"*)
    [ "\${DPF_TEST_PRINCIPAL_RECOVERY_DECISION:-not-needed}" = "blocked" ] && exit 1
    if [ "\${DPF_TEST_PRINCIPAL_RECOVERY_DECISION:-not-needed}" = "recover" ]; then
      printf "recover:11111111-1111-4111-8111-111111111111"
    else
      printf "not-needed"
    fi
    ;;
  *"recover-inventory-snapshot-migration.mjs --verify-rolled-back"*) printf "verified" ;;
  *"recover-inventory-snapshot-migration.mjs"*)
    [ "\${DPF_TEST_RECOVERY_DECISION:-not-needed}" = "blocked" ] && exit 1
    if [ "\${DPF_TEST_RECOVERY_DECISION:-not-needed}" = "recover" ]; then
      printf "recover:11111111-1111-4111-8111-111111111111"
    else
      printf "not-needed"
    fi
    ;;
  *"up -d --no-deps --force-recreate portal"*|*"up -d --no-deps --force-recreate sandbox"*)
    service=
    for service in "$@"; do :; done
    effective_state_dir="$(sed -n 's/^DPF_STATE_DIR=//p' "$env_file" | tail -n 1)"
    printf 'recreate service=%s DPF_STATE_DIR=%s DPF_PROMOTER_STATE_DIR=%s DPF_STATE_DIR_HOST=%s mount_source=%s\\n' \
      "$service" "\${DPF_STATE_DIR-<unset>}" "\${DPF_PROMOTER_STATE_DIR-<unset>}" "$effective_state_dir" "$effective_state_dir" >> "$DOCKER_LOG"
    ;;
  *"/app/.dpf-source-content-hash"*) printf "deadbeefhash" ;;
  "ps -a --format "*) [ -n "\${DPF_TEST_IMAGES_IN_USE:-}" ] && printf '%s\n' "$DPF_TEST_IMAGES_IN_USE" ;;
  *"images --filter reference=ghcr.io/"*"/dpf-portal:v* --format "*) [ -n "\${DPF_TEST_PORTAL_VERSION_TAGS:-}" ] && printf '%s\n' "$DPF_TEST_PORTAL_VERSION_TAGS" ;;
esac
exit 0
`,
  );
  // For any URL ending in /sha, report the stamped DPF_VERSION (inherited from
  // the script's exported env) — modelling a correctly-stamped portal. Other
  // health probes just succeed.
  writeFileSync(
    join(bin, "curl"),
    '#!/bin/sh\nfor a in "$@"; do url="$a"; done\ncase "$url" in\n  */sha) printf "%s" "$DPF_VERSION" ;;\n  *) printf "ok" ;;\nesac\nexit 0\n',
  );
  chmodSync(join(bin, "docker"), 0o755);
  chmodSync(join(bin, "curl"), 0o755);
  return bin;
}

export function runPromote(opts: {
  source: string;
  installRoot?: string;
  backup: string;
  targetSha: string;
  fakeBin: string;
  composeEnvFile?: string;
  dockerLog?: string;
  recoveryDecision?: "recover" | "not-needed" | "blocked";
  principalRecoveryDecision?: "recover" | "not-needed" | "blocked";
  principalResolveFails?: boolean;
  principalVerifyFails?: boolean;
  /** Newest-first `repo:tag` list the shim returns for the dpf-portal version-tag query. */
  portalVersionTags?: string[];
  /** `repo:tag` refs the shim reports as referenced by a container (`docker ps -a`). */
  imagesInUse?: string[];
  imageKeep?: number;
  release?: {
    tag: string; owner: string; channelDigest?: string; platformManifestDigest?: string;
    configDigest?: string; engineImageId?: string; platformOs?: string; frozenStrata?: boolean; repoImageId?: string; registryConfigDigest?: string; duplicatePlatform?: boolean;
    platformArchitecture?: string; enginePlatformArchitecture?: string;
    candidateAssets: string; gitLog: string;
  };
}): { status: number | null; stdout: string; stderr: string } {
  const stateDir = join(opts.backup, "state");
  const secret = "s".repeat(32);
  const secretPath = join(stateDir, "runtime-transition.secret");
  writeFileSync(secretPath, secret);
  // Use the canonical migrator: a real projection hash differs from sourceHash,
  // and the fixture must exercise that CAS binding (BI-AA6FBAD0).
  const projection = JSON.parse(execFileSync(process.execPath, [MIGRATOR,
    "--state", join(stateDir, "install-state.json"), "--catalog", CATALOG,
    "--host-platform", "linux", "--host-arch", "amd64"], { encoding: "utf8" })) as { sourceHash: string; projectionHash: string };
  const envelope = {
    kind: "install-state-migration", version: 1, runId: "SUR-FUNCTIONAL",
    promoterDigest: `sha256:${"d".repeat(64)}`,
    sourceHash: projection.sourceHash,
    projectionHash: projection.projectionHash,
    fromSchemaVersion: 2, toSchemaVersion: 2,
    hostIdentity: { platform: "linux", arch: "amd64", provenance: "explicit" },
    issuedAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const canonical = (value: unknown): string => Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`
      : JSON.stringify(value) ?? "null";
  const signature = createHmac("sha256", secret).update(canonical(envelope)).digest("hex");
  const exports = [
    "unset DPF_STATE_DIR",
    `export PATH=${shellQuote(toBashPath(opts.fakeBin))}:"$PATH"`,
    `export PROMOTE_SOURCE=${shellQuote(toBashPath(opts.source))}`,
    ...(opts.installRoot ? [`export PROMOTE_INSTALL_ROOT=${shellQuote(toBashPath(opts.installRoot))}`] : []),
    `export PROMOTE_TARGET_SHA=${shellQuote(opts.targetSha)}`,
    `export PROMOTE_BACKUP_PATH=${shellQuote(toBashPath(opts.backup))}`,
    `export DPF_PROMOTER_STATE_DIR=${shellQuote(toBashPath(join(opts.backup, "state")))}`,
    `export DPF_RUNTIME_TRANSITION_SECRET_FILE=${shellQuote(toBashPath(secretPath))}`,
    "export DPF_SELF_UPGRADE_RUN_ID='SUR-FUNCTIONAL'",
    `export DPF_PROMOTER_DIGEST=${shellQuote(envelope.promoterDigest)}`,
    `export DPF_INSTALL_STATE_MIGRATION_ENVELOPE=${shellQuote(Buffer.from(JSON.stringify(envelope)).toString("base64url"))}`,
    `export DPF_INSTALL_STATE_MIGRATION_SIGNATURE=${shellQuote(signature)}`,
    "export PROMOTE_HEALTH_URL='http://127.0.0.1:9/api/health'",
    "export PROMOTE_COMPOSE_PROJECT='dpf-functest'",
    ...(opts.recoveryDecision
      ? [`export DPF_TEST_RECOVERY_DECISION=${shellQuote(opts.recoveryDecision)}`]
      : []),
    ...(opts.principalRecoveryDecision
      ? [`export DPF_TEST_PRINCIPAL_RECOVERY_DECISION=${shellQuote(opts.principalRecoveryDecision)}`]
      : []),
    ...(opts.principalResolveFails ? ["export DPF_TEST_PRINCIPAL_RESOLVE_FAIL=yes"] : []),
    ...(opts.principalVerifyFails ? ["export DPF_TEST_PRINCIPAL_VERIFY_FAIL=yes"] : []),
    ...(opts.composeEnvFile
      ? [`export PROMOTE_COMPOSE_ENV_FILE=${shellQuote(toBashPath(opts.composeEnvFile))}`]
      : []),
    ...(opts.dockerLog ? [`export DOCKER_LOG=${shellQuote(toBashPath(opts.dockerLog))}`] : []),
    ...(opts.portalVersionTags ? [`export DPF_TEST_PORTAL_VERSION_TAGS=${shellQuote(opts.portalVersionTags.join("\n"))}`] : []),
    ...(opts.imagesInUse ? [`export DPF_TEST_IMAGES_IN_USE=${shellQuote(opts.imagesInUse.join("\n"))}`] : []),
    ...(opts.imageKeep !== undefined ? [`export PROMOTE_IMAGE_KEEP=${opts.imageKeep}`] : []),
    ...(opts.release ? [
      "export DPF_PROMOTION_MODE=release",
      `export DPF_RELEASE_TAG=${shellQuote(opts.release.tag)}`,
      ...(opts.release.configDigest
        ? [`export DPF_RELEASE_CONFIG_DIGEST=${shellQuote(opts.release.configDigest)}`]
        : ["unset DPF_RELEASE_CONFIG_DIGEST"]),
      ...(opts.release.frozenStrata === false || !opts.release.configDigest ? ["unset DPF_RELEASE_CHANNEL_DIGEST DPF_RELEASE_PLATFORM_MANIFEST_DIGEST DPF_RELEASE_PLATFORM_OS DPF_RELEASE_PLATFORM_ARCHITECTURE"] : [`export DPF_RELEASE_CHANNEL_DIGEST=${shellQuote(opts.release.channelDigest ?? "")}`, `export DPF_RELEASE_PLATFORM_MANIFEST_DIGEST=${shellQuote(opts.release.platformManifestDigest ?? "")}`, `export DPF_RELEASE_PLATFORM_OS=${shellQuote(opts.release.platformOs ?? "linux")}`, `export DPF_RELEASE_PLATFORM_ARCHITECTURE=${shellQuote(opts.release.platformArchitecture ?? "amd64")}`]),
      `export GHCR_OWNER=${shellQuote(opts.release.owner)}`,
      `export DPF_TEST_RELEASE_SHA=${shellQuote(opts.targetSha)}`,
      `export DPF_TEST_RELEASE_TAG=${shellQuote(opts.release.tag)}`,
      `export DPF_TEST_RELEASE_CONFIG_DIGEST=${shellQuote(opts.release.configDigest ?? `sha256:${"c".repeat(64)}`)}`,
      `export DPF_TEST_RELEASE_ENGINE_ID=${shellQuote(opts.release.engineImageId ?? opts.release.configDigest ?? `sha256:${"c".repeat(64)}`)}`,
      `export DPF_TEST_RELEASE_REPO_ID=${shellQuote(opts.release.repoImageId ?? "")}`, `export DPF_TEST_RELEASE_REGISTRY_CONFIG_DIGEST=${shellQuote(opts.release.registryConfigDigest ?? "")}`,
      `export DPF_TEST_DUPLICATE_PLATFORM=${opts.release.duplicatePlatform ? "yes" : "no"}`,
      `export DPF_TEST_RELEASE_REPO=ghcr.io/${shellQuote(opts.release.owner)}/dpf-portal`,
      `export DPF_TEST_RELEASE_PLATFORM_MANIFEST_DIGEST=${shellQuote(opts.release.platformManifestDigest ?? `sha256:${"b".repeat(64)}`)}`,
      `export DPF_TEST_RELEASE_OS=${shellQuote(opts.release.platformOs ?? "linux")}`,
      `export DPF_TEST_RELEASE_ARCHITECTURE=${shellQuote(opts.release.enginePlatformArchitecture ?? opts.release.platformArchitecture ?? "amd64")}`,
      `export DPF_TEST_RELEASE_ASSETS=${shellQuote(toBashPath(opts.release.candidateAssets))}`,
      `export GIT_LOG=${shellQuote(toBashPath(opts.release.gitLog))}`,
      "export PROMOTE_COMPOSE_FILES='docker-compose.yml docker-compose.release.yml'",
    ] : []),
  ];
  const r = spawnSync(BASH_COMMAND, ["-lc", `${exports.join("\n")}\nexec bash ${shellQuote(toBashPath(SCRIPT))} --self-upgrade`], {
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Scratch root with a clean git source dir (src/) + isolated bin/ and backup/. */
export function makeScratch(): { root: string; source: string; backup: string; fakeBin: string; head: string } {
  // macOS exposes /var as a symlink to /private/var. Use the canonical parent
  // so the production state-path escape guard sees the same path before and
  // after realpath resolution.
  const root = mkdtempSync(join(realpathSync(tmpdir()), "dpf-promote-"));
  const source = join(root, "src");
  mkdirSync(source, { recursive: true });
  const head = gitInit(source);
  const fakeBin = makeFakeBin(root);
  const backup = join(root, "backup");
  const stateDir = join(backup, "state");
  mkdirSync(stateDir, { recursive: true });
  // Produce state through the canonical legacy migrator so capability closure
  // cannot drift from the runtime resolver.
  writeFileSync(join(stateDir, "install-state.json"), JSON.stringify({
    schemaVersion: 1, installerVersion: "functional", platform: "linux", arch: "amd64",
    installPath: "/opt/dpf", stateDir: "/dpf-state", composeProjectName: "dpf",
  }));
  execFileSync(process.execPath, [MIGRATOR, "--state", join(stateDir, "install-state.json"),
    "--catalog", CATALOG, "--host-platform", "linux", "--host-arch", "amd64", "--write"], { encoding: "utf8" });
  return { root, source, backup, fakeBin, head };
}
