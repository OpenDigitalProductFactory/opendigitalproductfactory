import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, writeFileSync, chmodSync, mkdirSync, rmSync, readFileSync, realpathSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// High-fidelity proof of the real promote.sh against a real Git repo, faking
// only Docker and HTTP. The fake portal reports the stamped DPF_VERSION, so
// sha-verify exercises the production build-arg -> image -> endpoint contract.

const SCRIPT = resolve(__dirname, "../../../../scripts/promote.sh");
const REPO_ROOT = resolve(__dirname, "../../../..");
const MIGRATOR = join(REPO_ROOT, "scripts", "installer", "migrate-install-state.mjs");
const CATALOG = join(REPO_ROOT, "scripts", "capability-service-catalog.generated.json");
const gitBash = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");
const BASH_COMMAND = process.platform === "win32" && existsSync(gitBash) ? gitBash : "bash";
const BASH_OK = spawnSync(BASH_COMMAND, ["--version"], { encoding: "utf8" }).status === 0;
const GIT_OK = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;
const PROMOTE_TEST_TIMEOUT_MS = 30_000;

let bashDrivePrefix: string | undefined;

function toBashPath(value: string): string {
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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function gitInit(dir: string): string {
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
function makeFakeBin(root: string): string {
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
    # Model Docker's directory-copy semantics consistently on GNU/Linux and
    # Windows: copy the release directory contents into the already-created
    # destination, including the manifest consumed by sha256sum -c.
    mkdir -p "$destination"
    cp -R "$DPF_TEST_RELEASE_ASSETS"/. "$destination/"
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

function runPromote(opts: {
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
  const stateBytes = readFileSync(join(stateDir, "install-state.json"));
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
function makeScratch(): { root: string; source: string; backup: string; fakeBin: string; head: string } {
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

describe.skipIf(!BASH_OK || !GIT_OK)("promote.sh — real-script functional run", () => {
  it.each([
    { caller: "classic-store digest-bound caller", configDigest: `sha256:${"c".repeat(64)}`, engineImageId: `sha256:${"c".repeat(64)}`, platformArchitecture: "amd64", expectedStatus: 0 },
    { caller: "Docker Desktop containerd index-ID caller", configDigest: `sha256:${"c".repeat(64)}`, engineImageId: `sha256:${"a".repeat(64)}`, platformArchitecture: "amd64", expectedStatus: 0 },
    { caller: "modern index with cross-stratum config mismatch", configDigest: `sha256:${"c".repeat(64)}`, engineImageId: `sha256:${"a".repeat(64)}`, registryConfigDigest: `sha256:${"f".repeat(64)}`, platformArchitecture: "amd64", expectedStatus: 1 },
    { caller: "N-1 config-only Docker Desktop caller", configDigest: `sha256:${"c".repeat(64)}`, engineImageId: `sha256:${"a".repeat(64)}`, platformArchitecture: "amd64", frozenStrata: false, expectedStatus: 0 },
    { caller: "N-1 index absent from RepoDigests", configDigest: `sha256:${"c".repeat(64)}`, engineImageId: `sha256:${"a".repeat(64)}`, repoImageId: `sha256:${"f".repeat(64)}`, platformArchitecture: "amd64", frozenStrata: false, expectedStatus: 1 },
    { caller: "N-1 registry config mismatch", configDigest: `sha256:${"c".repeat(64)}`, engineImageId: `sha256:${"a".repeat(64)}`, registryConfigDigest: `sha256:${"f".repeat(64)}`, platformArchitecture: "amd64", frozenStrata: false, expectedStatus: 1 },
    { caller: "N-1 ambiguous platform index", configDigest: `sha256:${"c".repeat(64)}`, engineImageId: `sha256:${"a".repeat(64)}`, duplicatePlatform: true, platformArchitecture: "amd64", frozenStrata: false, expectedStatus: 1 },
    { caller: "partial modern packet", configDigest: `sha256:${"c".repeat(64)}`, engineImageId: `sha256:${"a".repeat(64)}`, platformArchitecture: "amd64", missingModernStratum: true, expectedStatus: 1 },
    { caller: "legacy bootstrap caller", configDigest: undefined, engineImageId: `sha256:${"c".repeat(64)}`, platformArchitecture: "amd64", expectedStatus: 0 },
    { caller: "unrecognized engine digest", configDigest: `sha256:${"c".repeat(64)}`, engineImageId: `sha256:${"f".repeat(64)}`, platformArchitecture: "amd64", expectedStatus: 1 },
    { caller: "wrong engine platform", configDigest: `sha256:${"c".repeat(64)}`, engineImageId: `sha256:${"a".repeat(64)}`, platformArchitecture: "amd64", enginePlatformArchitecture: "arm64", expectedStatus: 1 },
  ])("promotes a verified release into a source-free install for a $caller", ({ caller, configDigest, engineImageId, platformArchitecture, enginePlatformArchitecture, frozenStrata, missingModernStratum, repoImageId, registryConfigDigest, duplicatePlatform, expectedStatus }) => {
    const { root, source, backup, fakeBin } = makeScratch();
    const targetSha = "b".repeat(40);
    const installRoot = join(root, "canonical-install");
    const candidateAssets = join(root, "candidate-assets");
    const gitLog = join(root, "git.log");
    const dockerLog = join(root, "docker.log");
    try {
      rmSync(join(source, ".git"), { recursive: true, force: true });
      writeFileSync(join(source, "docker-compose.release.yml"), "services: {}\n");
      writeFileSync(join(source, ".install-mode"), "consumer\n");
      writeFileSync(join(source, ".env"), "KEEP_ME=yes\nDPF_IMAGE_TAG=v1.0.0\nGHCR_OWNER=opendigitalproductfactory\n");
      mkdirSync(installRoot, { recursive: true });
      mkdirSync(candidateAssets, { recursive: true });
      for (const relativePath of [
        "docker-compose.yml",
        "docker-compose.release.yml",
        "scripts/lib/resolve-capability-compose-profiles.mjs",
        "scripts/lib/govern-capability-compose-args.mjs",
        "scripts/lib/capability-state-hash.mjs",
        "scripts/capability-service-catalog.generated.json",
      ]) {
        const destination = join(candidateAssets, relativePath);
        mkdirSync(resolve(destination, ".."), { recursive: true });
        copyFileSync(join(source, relativePath), destination);
      }
      const assetFiles = readdirSync(candidateAssets, { recursive: true })
        .map(String)
        .filter(path => statSync(join(candidateAssets, path)).isFile())
        .sort();
      writeFileSync(join(candidateAssets, "SHA256SUMS"), assetFiles.map(path => {
        const normalized = path.replaceAll("\\", "/");
        return `${createHash("sha256").update(readFileSync(join(candidateAssets, path))).digest("hex")}  ./${normalized}`;
      }).join("\n") + "\n");
      const currentManaged = ["docker-compose.yml", "docker-compose.release.yml"];
      writeFileSync(join(source, ".verified-release-assets.sha256"), currentManaged.map(path => `${createHash("sha256").update(readFileSync(join(source, path))).digest("hex")}  ./${path}`).join("\n") + "\n");
      writeFileSync(join(source, ".verified-release-assets-version"), "v1.0.0");
      for (const relativePath of [...currentManaged, ".env", ".verified-release-assets.sha256", ".verified-release-assets-version"]) {
        copyFileSync(join(source, relativePath), join(installRoot, relativePath));
      }
      const statePath = join(backup, "state", "install-state.json");
      const existing = JSON.parse(readFileSync(statePath, "utf8"));
      writeFileSync(statePath, JSON.stringify({
        ...existing,
        schemaVersion: 2,
        installerVersion: "v1.0.0",
        lastSuccessfulInstallVersion: "v1.0.0",
        arch: "amd64",
        installPath: installRoot,
        installMode: "consumer",
        composeFiles: ["docker-compose.yml", "docker-compose.release.yml"],
        imageTag: "v1.0.0",
      }) + "\n");
      writeFileSync(join(fakeBin, "git"), '#!/bin/sh\nprintf "git invoked: %s\\n" "$*" >> "$GIT_LOG"\nexit 97\n');
      chmodSync(join(fakeBin, "git"), 0o755);

      const release = {
        tag: "v2.0.0", owner: "opendigitalproductfactory", channelDigest: `sha256:${"a".repeat(64)}`,
        platformManifestDigest: missingModernStratum ? undefined : `sha256:${"b".repeat(64)}`, configDigest, engineImageId, platformOs: "linux",
        platformArchitecture, enginePlatformArchitecture, frozenStrata, repoImageId, registryConfigDigest, duplicatePlatform, candidateAssets, gitLog,
      };
      const r = runPromote({ source, installRoot, backup, targetSha, fakeBin, dockerLog, composeEnvFile: join(installRoot, ".env"), release });
      expect(r.status, r.stderr).toBe(expectedStatus);
      if (expectedStatus !== 0) {
        expect(r.stderr).toMatch(/(?:missing required variables|not a pulled repository digest|could not resolve an immutable|resolved config digest .* does not match|does not match resolved (?:config\/platform\/channel identities|candidate linux\/amd64))/);
        return;
      }
      expect(existsSync(gitLog)).toBe(false);
      expect(r.stdout).toContain(`step=done target=${targetSha}`);
      if (caller.startsWith("N-1")) expect(r.stdout).toContain("step=release-identity mode=config-only");
      if (configDigest) {
        expect(r.stdout).not.toContain("mode=legacy-bootstrap");
      } else {
        expect(r.stdout).toContain("step=release-identity mode=legacy-bootstrap");
      }
      expect(readFileSync(join(installRoot, ".env"), "utf8")).toMatch(/^KEEP_ME=yes$/m);
      expect(readFileSync(join(installRoot, ".env"), "utf8")).toMatch(/^DPF_IMAGE_TAG=v2\.0\.0$/m);
      expect(readFileSync(join(installRoot, ".verified-release-assets-version"), "utf8").trim()).toBe("v2.0.0");
      expect(readFileSync(join(source, ".env"), "utf8")).toMatch(/^DPF_IMAGE_TAG=v1\.0\.0$/m);
      expect(readFileSync(join(source, ".verified-release-assets-version"), "utf8").trim()).toBe("v1.0.0");
      expect(JSON.parse(readFileSync(statePath, "utf8")).imageTag).toBe("v2.0.0");
      const calls = readFileSync(dockerLog, "utf8");
      expect(calls).toContain("pull portal postgres");
      expect(calls).toContain("pull sandbox");
      expect(calls).not.toContain("build portal postgres");
      expect(calls).not.toContain("build sandbox");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);
  it("stamps the source HEAD and sha-verify passes against a correctly-stamped portal", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    try {
      // Orchestrator passes the intended target; it equals HEAD here, so the
      // pre-swap identity assertion (stamp == built HEAD == target) holds and
      // the run completes cleanly through sha-verify + content-verify.
      const r = runPromote({ source, backup, targetSha: head, fakeBin });
      expect(r.status).toBe(0);
      // sha-verify completed against the SHA actually built (HEAD).
      expect(r.stdout).toContain(`step=done target=${head}`);
      expect(r.stderr).not.toContain("does not match promote target");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("sweeps dangling images and build cache after a successful promote", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    const dockerLog = join(root, "docker.log");
    try {
      const r = runPromote({ source, backup, targetSha: head, fakeBin, dockerLog });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("step=cleanup");
      const dockerCalls = readFileSync(dockerLog, "utf8");
      // Best-effort disk reclaim on the success path.
      // Dangling images: removed outright (superseded previous portal version).
      expect(dockerCalls).toContain("image prune -f");
      // Build cache: BOUNDED, not wiped — kept as a rebuild-speed asset under a cap.
      expect(dockerCalls).toContain("builder prune -f --keep-storage");
      // Conservative scope: never the destructive `-a` (would delete in-use tagged images).
      expect(dockerCalls).not.toContain("image prune -a");
      // Volumes are operator state — cleanup must never touch them.
      expect(dockerCalls).not.toContain("volume");
      // BI-9B7FC928: also reclaims the TAGGED ephemeral verify/compare/build-test
      // images that dangling-prune misses (the ~3.7 GB/upgrade leak). It queries
      // by exact ephemeral naming so the running dpf-portal image is never hit.
      expect(dockerCalls).toContain("images --filter reference=dpf-*-build-test");
      expect(dockerCalls).toContain("images --filter reference=dpf-*-build-compare");
      expect(dockerCalls).toContain("images --filter reference=dpf-*:verify");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("derives a -dirty stamp when the build source has uncommitted changes", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    try {
      writeFileSync(join(source, "Dockerfile"), "FROM scratch\n# changed\n"); // dirty a tracked file
      const r = runPromote({ source, backup, targetSha: `${head}-dirty`, fakeBin });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`step=done target=${head}-dirty`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("FAILS LOUD (does not deploy) when the build tree identity differs from the promote target", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    try {
      // Orchestrator's intended target ≠ what's on disk → the bytes about to be
      // deployed are not the bytes that were resolved. Spec §4.3 / BI-5B6C1C35:
      // stamp == built HEAD == target must hold pre-swap; a divergence is a hard
      // failure, NOT a warning that lets a mislabeled image ship.
      const r = runPromote({ source, backup, targetSha: "0000000000000000000000000000000000000000", fakeBin });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("does not match promote target");
      // It never reached the swap/verify steps — no image was recreated.
      expect(r.stdout).not.toContain(`step=done`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("FAILS LOUD when a -dirty build tree cannot equal the clean target SHA", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    try {
      // Uncommitted bytes in the build tree → stamp becomes `${head}-dirty`,
      // which can never equal the clean target `head`. Promoting uncommitted
      // bytes is never intended, so the script must refuse before building.
      writeFileSync(join(source, "Dockerfile"), "FROM scratch\n# uncommitted\n");
      const r = runPromote({ source, backup, targetSha: head, fakeBin });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("does not match promote target");
      expect(r.stdout).not.toContain("step=done");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("FAILS LOUD when the running portal reports an EMPTY /sha (DEPLOYED_SHA unpopulated)", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    try {
      // Model the BI-5B6C1C35 symptom: DEPLOYED_SHA never made it into the
      // running container, so /sha returns blank. The verify step must treat an
      // empty stamp as a hard failure (the runtime cannot prove its identity),
      // not retry-until-timeout then pass.
      const emptyShaBin = join(root, "bin-emptysha");
      mkdirSync(emptyShaBin, { recursive: true });
      writeFileSync(
        join(emptyShaBin, "docker"),
        '#!/bin/sh\ncase "$*" in\n  *"recover-human-principal-backfill-migration.mjs"*) printf "not-needed" ;;\n  *"recover-inventory-snapshot-migration.mjs"*) printf "not-needed" ;;\n  *"/app/.dpf-source-content-hash"*) printf "deadbeefhash" ;;\nesac\nexit 0\n',
      );
      // /sha → empty (the bug); other probes → ok.
      writeFileSync(
        join(emptyShaBin, "curl"),
        '#!/bin/sh\nfor a in "$@"; do url="$a"; done\ncase "$url" in\n  */sha) printf "" ;;\n  *) printf "ok" ;;\nesac\nexit 0\n',
      );
      chmodSync(join(emptyShaBin, "docker"), 0o755);
      chmodSync(join(emptyShaBin, "curl"), 0o755);

      const r = runPromote({ source, backup, targetSha: head, fakeBin: emptyShaBin });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("EMPTY deployed SHA");
      expect(r.stdout).not.toContain("step=done");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("passes the canonical install env file to docker compose when configured", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    try {
      const envFile = join(root, "install.env");
      const dockerLog = join(root, "docker.log");
      const hostStateDir = "C:/Users/operator/.dpf";
      writeFileSync(envFile, `AUTH_SECRET=test-secret\nDPF_STATE_DIR=${hostStateDir}\n`);

      const r = runPromote({ source, backup, targetSha: head, fakeBin, composeEnvFile: envFile, dockerLog });

      expect(r.status).toBe(0);
      const log = readFileSync(dockerLog, "utf8");
      expect(log).toContain(
        `compose --env-file ${toBashPath(envFile)} --project-directory ${toBashPath(source)}`,
      );
      expect(log).toContain("build portal");
      // BI-D9BAB4FA: migrations run from the freshly-built image, before the swap.
      expect(log).toContain("run --rm -T --no-deps --entrypoint sh portal -c cd /app && pnpm --filter @dpf/db exec prisma migrate deploy");
      expect(log).toContain("up -d --no-deps --force-recreate portal");
      // BI-86FC0336: seed runs the full entrypoint from the freshly swapped image, after the swap.
      expect(log).toContain("run --rm -T --no-deps --entrypoint /docker-entrypoint.sh portal");
      expect(log).toContain("exec -T portal cat /app/.dpf-source-content-hash");
      // BI-A8686CFC: the sandbox image is rebuilt + recreated the same way, so
      // Dockerfile.sandbox improvements (opencode agent, TTS env) actually reach
      // installed sandboxes instead of the promote chain only touching the portal.
      expect(log).toContain("build sandbox");
      expect(log).toContain("up -d --no-deps --force-recreate sandbox");
      const recreates = log.split(/\r?\n/).filter((line) => line.startsWith("recreate service="));
      expect(recreates.map((line) => line.match(/^recreate service=(\S+)/)?.[1]).sort()).toEqual(["portal", "sandbox", "sandbox-postgres"]);
      for (const recreate of recreates) {
        expect(recreate).toContain("DPF_STATE_DIR=<unset>");
        expect(recreate).toContain(`DPF_PROMOTER_STATE_DIR=${toBashPath(join(backup, "state"))}`);
        expect(recreate).toContain(`DPF_STATE_DIR_HOST=${hostStateDir}`);
        expect(recreate).toContain(`mount_source=${hostStateDir}`);
        expect(recreate).not.toContain("=/dpf-state");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("resolves the allowlisted snapshot failure before normal migrate deploy", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    const dockerLog = join(root, "docker.log");
    try {
      const r = runPromote({
        source,
        backup,
        targetSha: head,
        fakeBin,
        dockerLog,
        recoveryDecision: "recover",
      });

      expect(r.status).toBe(0);
      const calls = readFileSync(dockerLog, "utf8");
      const check = calls.indexOf("recover-inventory-snapshot-migration.mjs");
      const resolve = calls.indexOf(
        "prisma migrate resolve --rolled-back 20260728115900_snapshot_inventory_observation_facts",
      );
      const deploy = calls.indexOf("prisma migrate deploy");
      expect(check).toBeGreaterThanOrEqual(0);
      expect(resolve).toBeGreaterThan(check);
      expect(deploy).toBeGreaterThan(resolve);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("resolves the allowlisted human-principal failure before normal migrate deploy", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    const dockerLog = join(root, "docker.log");
    try {
      const r = runPromote({
        source,
        backup,
        targetSha: head,
        fakeBin,
        dockerLog,
        principalRecoveryDecision: "recover",
      });

      expect(r.status).toBe(0);
      const calls = readFileSync(dockerLog, "utf8");
      const check = calls.indexOf("recover-human-principal-backfill-migration.mjs");
      const resolve = calls.indexOf(
        "prisma migrate resolve --rolled-back 20260812110000_backfill_missing_human_principals",
      );
      const verify = calls.indexOf(
        "recover-human-principal-backfill-migration.mjs --verify-rolled-back",
      );
      const deploy = calls.indexOf("prisma migrate deploy");
      expect(check).toBeGreaterThanOrEqual(0);
      expect(resolve).toBeGreaterThan(check);
      expect(verify).toBeGreaterThan(resolve);
      expect(deploy).toBeGreaterThan(verify);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("stops before verification and deployment when principal rollback resolution fails", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    const dockerLog = join(root, "docker.log");
    try {
      const r = runPromote({
        source,
        backup,
        targetSha: head,
        fakeBin,
        dockerLog,
        principalRecoveryDecision: "recover",
        principalResolveFails: true,
      });

      expect(r.status).not.toBe(0);
      const calls = readFileSync(dockerLog, "utf8");
      expect(calls).toContain(
        "prisma migrate resolve --rolled-back 20260812110000_backfill_missing_human_principals",
      );
      expect(calls).not.toContain(
        "recover-human-principal-backfill-migration.mjs --verify-rolled-back",
      );
      expect(calls).not.toContain("prisma migrate deploy");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("stops before deployment when principal post-rollback verification fails", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    const dockerLog = join(root, "docker.log");
    try {
      const r = runPromote({
        source,
        backup,
        targetSha: head,
        fakeBin,
        dockerLog,
        principalRecoveryDecision: "recover",
        principalVerifyFails: true,
      });

      expect(r.status).not.toBe(0);
      const calls = readFileSync(dockerLog, "utf8");
      expect(calls).toContain(
        "recover-human-principal-backfill-migration.mjs --verify-rolled-back",
      );
      expect(calls).not.toContain("prisma migrate deploy");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("fails before migrate deploy when human-principal recovery cannot prove safety", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    const dockerLog = join(root, "docker.log");
    try {
      const r = runPromote({
        source,
        backup,
        targetSha: head,
        fakeBin,
        dockerLog,
        principalRecoveryDecision: "blocked",
      });

      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain(
        "human-principal migration recovery did not prove a safe state",
      );
      const calls = readFileSync(dockerLog, "utf8");
      expect(calls).toContain("recover-human-principal-backfill-migration.mjs");
      expect(calls).not.toContain("prisma migrate deploy");
      expect(calls).not.toContain("up -d --no-deps --force-recreate portal");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("fails before migrate deploy when snapshot recovery cannot prove safety", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    const dockerLog = join(root, "docker.log");
    try {
      const r = runPromote({
        source,
        backup,
        targetSha: head,
        fakeBin,
        dockerLog,
        recoveryDecision: "blocked",
      });

      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain(
        "inventory snapshot migration recovery did not prove a safe state",
      );
      const calls = readFileSync(dockerLog, "utf8");
      expect(calls).toContain("recover-inventory-snapshot-migration.mjs");
      expect(calls).not.toContain("prisma migrate deploy");
      expect(calls).not.toContain("up -d --no-deps --force-recreate portal");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  // BI-A8686CFC: a sandbox rebuild that fails AFTER the portal is verified must
  // NOT fail the whole promotion (the portal swap already happened and the
  // orchestrator died with it) — it emits a loud sandbox-refresh-failed marker
  // and still reaches step=done, rather than silently skipping the rebuild.
  it("keeps the promotion successful but marks sandbox-refresh-failed when the sandbox rebuild fails", () => {
    const { root, source, backup, head } = makeScratch();
    try {
      // A docker shim that fails ONLY on `compose ... build sandbox`, succeeds
      // otherwise (and still answers the content-hash probe so portal verifies).
      const bin = join(root, "failbin");
      mkdirSync(bin, { recursive: true });
      writeFileSync(
        join(bin, "docker"),
        '#!/bin/sh\n[ -n "$DOCKER_LOG" ] && printf "%s\\n" "$*" >> "$DOCKER_LOG"\ncase "$*" in\n  *"recover-human-principal-backfill-migration.mjs"*) printf "not-needed" ;;\n  *"recover-inventory-snapshot-migration.mjs"*) printf "not-needed" ;;\n  *"build sandbox"*) exit 1 ;;\n  *"/app/.dpf-source-content-hash"*) printf "deadbeefhash" ;;\nesac\nexit 0\n',
      );
      writeFileSync(
        join(bin, "curl"),
        '#!/bin/sh\nfor a in "$@"; do url="$a"; done\ncase "$url" in\n  */sha) printf "%s" "$DPF_VERSION" ;;\n  *) printf "ok" ;;\nesac\nexit 0\n',
      );
      chmodSync(join(bin, "docker"), 0o755);
      chmodSync(join(bin, "curl"), 0o755);

      const r = runPromote({ source, backup, targetSha: head, fakeBin: bin });

      expect(r.stdout).toContain("step=sandbox-refresh-failed");
      expect(r.stderr).toContain("dpf-sandbox rebuild/recreate failed");
      // The portal promotion still completes.
      expect(r.stdout).toContain(`step=done target=${head}`);
      expect(r.status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  // BET-5 (BI-A1E864A5): ensure-pgvector must detect pgvector image-agnostically
  // via pg_available_extensions. A container already on the pgvector image answers
  // the probe with "1", so the recreate is SKIPPED — no churn, no risk. (The
  // original bug probed a hard-coded control-file path that the Debian pgvector
  // image doesn't use, so the skip never fired and it recreated on every upgrade.)
  it("SKIPS the pgvector recreate when the image already provides vector (pg_available_extensions=1)", () => {
    const { root, source, backup, head } = makeScratch();
    try {
      const bin = join(root, "vecbin");
      mkdirSync(bin, { recursive: true });
      const dockerLog = join(root, "docker.log");
      // A docker shim whose `psql ... pg_available_extensions` probe reports vector
      // present ("1"); everything else behaves like the default fake.
      writeFileSync(
        join(bin, "docker"),
        '#!/bin/sh\n[ -n "$DOCKER_LOG" ] && printf "%s\\n" "$*" >> "$DOCKER_LOG"\ncase "$*" in\n  *"recover-human-principal-backfill-migration.mjs"*) printf "not-needed" ;;\n  *"recover-inventory-snapshot-migration.mjs"*) printf "not-needed" ;;\n  *pg_available_extensions*) printf "1" ;;\n  *"/app/.dpf-source-content-hash"*) printf "deadbeefhash" ;;\nesac\nexit 0\n',
      );
      writeFileSync(
        join(bin, "curl"),
        '#!/bin/sh\nfor a in "$@"; do url="$a"; done\ncase "$url" in\n  */sha) printf "%s" "$DPF_VERSION" ;;\n  *) printf "ok" ;;\nesac\nexit 0\n',
      );
      chmodSync(join(bin, "docker"), 0o755);
      chmodSync(join(bin, "curl"), 0o755);

      const r = runPromote({ source, backup, targetSha: head, fakeBin: bin, dockerLog });

      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`step=done target=${head}`);
      // The recreate marker never prints and no postgres/sandbox-postgres recreate runs.
      expect(r.stdout).not.toContain("ensure-pgvector-recreate");
      const log = readFileSync(dockerLog, "utf8");
      expect(log).not.toContain("force-recreate postgres");
      expect(log).not.toContain("force-recreate sandbox-postgres");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  // BET-5 (BI-A1E864A5): when a recreate IS needed, it must be host-bind-safe. The
  // promoter runs compose with --project-directory=/host-source, so the postgres
  // service's relative ./scripts/init-inngest-db.sh bind would resolve to an
  // unshareable /host-source path and strand the container. The fix recreates via an
  // extra override compose file (pins the pgvector image, resets volumes to the named
  // data volume only) — so the recreate line carries a SECOND `-f`, not the bare
  // base-only `up --force-recreate postgres` that dragged the host bind.
  it("recreates postgres onto pgvector host-bind-safe (via an override compose file)", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    try {
      const dockerLog = join(root, "docker.log");
      const r = runPromote({ source, backup, targetSha: head, fakeBin, dockerLog });

      expect(r.status).toBe(0);
      expect(r.stdout).toContain("step=ensure-pgvector-recreate");
      const log = readFileSync(dockerLog, "utf8");
      const pgLine = log.split("\n").find((l) => l.includes("force-recreate postgres"));
      expect(pgLine).toBeDefined();
      // Base compose contributes one `-f`; the host-bind-safe override adds a second.
      // A regression to the bare `up --force-recreate postgres` would carry only one.
      expect((pgLine!.match(/ -f /g) ?? []).length).toBeGreaterThanOrEqual(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);
});
