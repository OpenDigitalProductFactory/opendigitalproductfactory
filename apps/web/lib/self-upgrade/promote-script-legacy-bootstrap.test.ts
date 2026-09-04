import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../../..");
const SCRIPT = join(REPO_ROOT, "scripts", "promote.sh");
const MIGRATOR = join(REPO_ROOT, "scripts", "installer", "migrate-install-state.mjs");
const CATALOG = join(REPO_ROOT, "scripts", "capability-service-catalog.generated.json");
const gitBash = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");
const BASH = process.platform === "win32" && existsSync(gitBash) ? gitBash : "bash";
const BASH_OK = spawnSync(BASH, ["--version"]).status === 0;
const TARGET_SHA = "b".repeat(40);
const RELEASE_TAG = "v2.0.0";
const OWNER = "opendigitalproductfactory";
const TEST_TIMEOUT_MS = 30_000;

let bashDrivePrefix: string | undefined;
function bashPath(value: string): string {
  if (process.platform !== "win32") return value;
  const normalized = value.replaceAll("\\", "/");
  const drive = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (!drive) return normalized;
  if (bashDrivePrefix === undefined) {
    const cwdDrive = /^([A-Za-z]):/.exec(process.cwd())?.[1]?.toLowerCase();
    const pwd = spawnSync(BASH, ["-lc", "pwd"], { encoding: "utf8" }).stdout.trim();
    bashDrivePrefix = cwdDrive && pwd.startsWith(`/mnt/${cwdDrive}/`) ? "/mnt" : "";
  }
  return `${bashDrivePrefix}/${drive[1].toLowerCase()}/${drive[2]}`;
}

function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

type Fixture = {
  root: string;
  source: string;
  backup: string;
  fakeBin: string;
  candidateAssets: string;
  dockerLog: string;
  gitLog: string;
  statePath: string;
};

function writeFakeTools(root: string): string {
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "docker"), `#!/bin/sh
[ -n "\${DOCKER_LOG:-}" ] && printf '%s\\n' "$*" >> "$DOCKER_LOG"
case "$*" in
  *".Id"*) printf "%s" "$DPF_TEST_RELEASE_CONFIG_DIGEST" ;;
  *"org.opencontainers.image.version"*) printf "%s" "$DPF_TEST_RELEASE_TAG" ;;
  *"org.opencontainers.image.revision"*) printf "%s" "$DPF_TEST_RELEASE_SHA" ;;
  "create "*) printf "candidate-container" ;;
  "cp candidate-container:/dpf-release-assets/. "*)
    for destination in "$@"; do :; done
    cp -R "$DPF_TEST_RELEASE_ASSETS"/. "$destination"
    ;;
  *"recover-human-principal-backfill-migration.mjs --verify-rolled-back"*) printf "verified" ;;
  *"recover-human-principal-backfill-migration.mjs"*) printf "not-needed" ;;
  *"recover-inventory-snapshot-migration.mjs --verify-rolled-back"*) printf "verified" ;;
  *"recover-inventory-snapshot-migration.mjs"*) printf "not-needed" ;;
  *"/app/.dpf-source-content-hash"*) printf "deadbeefhash" ;;
esac
exit 0
`);
  writeFileSync(join(bin, "curl"), '#!/bin/sh\nfor a in "$@"; do url="$a"; done\ncase "$url" in */sha) printf "%s" "$DPF_VERSION" ;; *) printf "ok" ;; esac\n');
  writeFileSync(join(bin, "jq"), `#!/bin/sh
if [ "\${1:-}" = "-r" ]; then
  node -e 'const fs=require("node:fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));for(const f of v.requiredFiles??[])console.log(f)' "$3"
else
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);process.stdout.write(JSON.stringify({...v,stage:"preflight",result:"ready",quiescenceBegan:false,failures:[]}))})'
fi
`);
  writeFileSync(join(bin, "git"), '#!/bin/sh\nprintf "git invoked: %s\\n" "$*" >> "$GIT_LOG"\nexit 97\n');
  for (const name of ["docker", "curl", "jq", "git"]) chmodSync(join(bin, name), 0o755);
  return bin;
}

function makeFixture(): Fixture {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "dpf-legacy-bootstrap-"));
  const source = join(root, "source-free-install");
  const backup = join(root, "backup");
  const stateDir = join(backup, "state");
  const candidateAssets = join(root, "candidate-assets");
  mkdirSync(join(source, "scripts", "lib"), { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(candidateAssets, { recursive: true });
  writeFileSync(join(source, "docker-compose.yml"), "services: {}\n");
  writeFileSync(join(source, "docker-compose.release.yml"), "services: {}\n");
  writeFileSync(join(source, ".install-mode"), "consumer\n");
  writeFileSync(join(source, ".env"), `KEEP_ME=yes\nDPF_IMAGE_TAG=v1.0.0\nGHCR_OWNER=${OWNER}\n`);
  for (const relativePath of [
    "scripts/lib/resolve-capability-compose-profiles.mjs",
    "scripts/lib/govern-capability-compose-args.mjs",
    "scripts/lib/capability-state-hash.mjs",
    "scripts/capability-service-catalog.generated.json",
  ]) {
    const destination = join(source, relativePath);
    mkdirSync(resolve(destination, ".."), { recursive: true });
    copyFileSync(join(REPO_ROOT, relativePath), destination);
  }
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
  const assetFiles = readdirSync(candidateAssets, { recursive: true }).map(String)
    .filter(path => statSync(join(candidateAssets, path)).isFile()).sort();
  writeFileSync(join(candidateAssets, "SHA256SUMS"), assetFiles.map(path =>
    `${createHash("sha256").update(readFileSync(join(candidateAssets, path))).digest("hex")}  ./${path.replaceAll("\\", "/")}`,
  ).join("\n") + "\n");
  for (const relativePath of ["docker-compose.yml", "docker-compose.release.yml"]) {
    const digest = createHash("sha256").update(readFileSync(join(source, relativePath))).digest("hex");
    writeFileSync(join(source, ".verified-release-assets.sha256"), `${digest}  ./${relativePath}\n`, { flag: "a" });
  }
  writeFileSync(join(source, ".verified-release-assets-version"), "v1.0.0");

  const statePath = join(stateDir, "install-state.json");
  writeFileSync(statePath, JSON.stringify({
    schemaVersion: 1,
    installerVersion: "functional",
    platform: "linux",
    arch: "amd64",
    installPath: source,
    stateDir: "/dpf-state",
    composeProjectName: "dpf",
  }));
  execFileSync(process.execPath, [MIGRATOR, "--state", statePath, "--catalog", CATALOG,
    "--host-platform", "linux", "--host-arch", "amd64", "--write"]);
  const existing = JSON.parse(readFileSync(statePath, "utf8"));
  writeFileSync(statePath, JSON.stringify({
    ...existing,
    schemaVersion: 2,
    installerVersion: "v1.0.0",
    lastSuccessfulInstallVersion: "v1.0.0",
    installPath: source,
    installMode: "consumer",
    composeFiles: ["docker-compose.yml", "docker-compose.release.yml"],
    imageTag: "v1.0.0",
  }) + "\n");
  writeFileSync(join(stateDir, "runtime-transition.secret"), "s".repeat(32));
  return {
    root,
    source,
    backup,
    candidateAssets,
    statePath,
    fakeBin: writeFakeTools(root),
    dockerLog: join(root, "docker.log"),
    gitLog: join(root, "git.log"),
  };
}

function runCandidate(fixture: Fixture, options: {
  readiness?: boolean;
  candidateSha?: string;
  pulledPortalTag?: string;
} = {}) {
  const stateDir = join(fixture.backup, "state");
  const contract = join(stateDir, "promoter-contract.test.json");
  writeFileSync(contract, JSON.stringify({ requiredFiles: [] }));
  const exports = [
    "unset DPF_STATE_DIR DPF_PROMOTION_MODE DPF_RELEASE_TAG DPF_RELEASE_CONFIG_DIGEST GHCR_OWNER",
    `export PATH=${quote(bashPath(fixture.fakeBin))}:"$PATH"`,
    `export PROMOTE_SOURCE=${quote(bashPath(fixture.source))}`,
    `export PROMOTE_INSTALL_ROOT=${quote(bashPath(fixture.source))}`,
    `export PROMOTE_TARGET_SHA=${TARGET_SHA}`,
    `export PROMOTE_BACKUP_PATH=${quote(bashPath(fixture.backup))}`,
    `export DPF_PROMOTER_STATE_DIR=${quote(bashPath(stateDir))}`,
    `export DPF_RUNTIME_TRANSITION_SECRET_FILE=${quote(bashPath(join(stateDir, "runtime-transition.secret")))}`,
    "export DPF_SELF_UPGRADE_RUN_ID=SUR-LEGACY-BOOTSTRAP",
    `export DPF_PROMOTER_DIGEST=sha256:${"d".repeat(64)}`,
    "export PROMOTE_HEALTH_URL=http://127.0.0.1:9/api/health",
    "export PROMOTE_COMPOSE_PROJECT=dpf-legacy-bootstrap",
    "export PROMOTE_COMPOSE_FILES='docker-compose.yml docker-compose.release.yml'",
    `export DPF_CANDIDATE_SOURCE_SHA=${options.candidateSha ?? TARGET_SHA}`,
    `export DPF_CANDIDATE_RELEASE_TAG=${RELEASE_TAG}`,
    `export DPF_CANDIDATE_RELEASE_OWNER=${OWNER}`,
    `export DPF_TEST_RELEASE_SHA=${TARGET_SHA}`,
    `export DPF_TEST_RELEASE_TAG=${options.pulledPortalTag ?? RELEASE_TAG}`,
    `export DPF_TEST_RELEASE_CONFIG_DIGEST=sha256:${"c".repeat(64)}`,
    `export DPF_TEST_RELEASE_ASSETS=${quote(bashPath(fixture.candidateAssets))}`,
    `export DOCKER_LOG=${quote(bashPath(fixture.dockerLog))}`,
    `export GIT_LOG=${quote(bashPath(fixture.gitLog))}`,
    ...(options.readiness ? [
      "export DPF_PROMOTER_DOCKER_PREFLIGHT=ready",
      `export DPF_PROMOTER_CONTRACT=${quote(bashPath(contract))}`,
    ] : []),
  ];
  // Dockerfile.promoter normalizes the packaged entrypoint to 0755. Reproduce
  // that image invariant for the duration of the real-script fixture, then
  // restore the checkout mode so the test never leaves the worktree dirty.
  const originalMode = statSync(SCRIPT).mode;
  chmodSync(SCRIPT, originalMode | 0o111);
  try {
    return spawnSync(BASH, ["-lc", `${exports.join("\n")}\nexec bash ${quote(bashPath(SCRIPT))} ${options.readiness ? "--readiness" : "--self-upgrade"}`], { encoding: "utf8" });
  } finally {
    chmodSync(SCRIPT, originalMode);
  }
}

describe.skipIf(!BASH_OK)("promote.sh candidate-owned legacy bootstrap", () => {
  it("returns ready with the packaged adapter for a validated consumer install", () => {
    const fixture = makeFixture();
    try {
      rmSync(join(fixture.source, "scripts", "lib", "resolve-capability-compose-profiles.mjs"));
      const result = runCandidate(fixture, { readiness: true });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain('"result":"ready"');
      expect(result.stdout).not.toContain("capability_projection_failed");
      expect(result.stdout).not.toContain("/host-source/scripts/lib/resolve-capability-compose-profiles.mjs");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);

  it("promotes without Git and records the candidate release identity", () => {
    const fixture = makeFixture();
    try {
      const result = runCandidate(fixture);
      expect(result.status, result.stderr).toBe(0);
      expect(existsSync(fixture.gitLog)).toBe(false);
      expect(result.stdout).toContain(`step=done target=${TARGET_SHA}`);
      expect(result.stdout).toContain("step=release-identity mode=legacy-bootstrap");
      expect(JSON.parse(readFileSync(fixture.statePath, "utf8")).imageTag).toBe(RELEASE_TAG);
      expect(readFileSync(join(fixture.source, ".env"), "utf8")).toMatch(/^DPF_IMAGE_TAG=v2\.0\.0$/m);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);

  it("rejects candidate source identity that differs from the promotion target", () => {
    const fixture = makeFixture();
    try {
      const result = runCandidate(fixture, { candidateSha: "a".repeat(40) });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("candidate release source");
      expect(result.stderr).toContain("does not match promote target");
      expect(existsSync(fixture.gitLog)).toBe(false);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);

  it("rejects a pulled portal whose version label differs from the candidate tag", () => {
    const fixture = makeFixture();
    try {
      const result = runCandidate(fixture, { pulledPortalTag: "v2.0.0-repacked" });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("release portal version v2.0.0-repacked does not match release tag v2.0.0");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);
});
