// BI-55A30F8B: the promoter recreates the portal (step 4) before the installer
// writes DPF_HOST_BIND_ADDRESS into the install .env (step 7). Compose then
// binds every published port to 127.0.0.1 and a LAN-serving install goes dark
// for the rest of the promotion. promote.sh must mirror the installer's
// pre-existing-install rule (BI-FEE77B68) before any compose command runs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
const bashPath = (path) => process.platform === "win32"
  ? resolve(path).replace(/^([A-Za-z]):\\/, (_, drive) => `/${drive.toLowerCase()}/`).replaceAll("\\", "/")
  : resolve(path);

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "dpf-promote-bind-"));
  const source = join(dir, "source");
  const stateDir = join(dir, "state");
  const bin = join(dir, "bin");
  await Promise.all([mkdir(join(source, "scripts", "lib"), { recursive: true }), mkdir(stateDir), mkdir(bin)]);
  await writeFile(join(source, "scripts/lib/resolve-capability-compose-profiles.mjs"),
    `process.stdout.write(JSON.stringify({composeProfiles:[],requiredServices:[]}) + "\\n");\n`);
  await writeFile(join(stateDir, "install-state.json"), `${JSON.stringify({
    schemaVersion: 1, installerVersion: "acceptance-v1", platform: "linux", arch: "amd64",
    installPath: "/opt/dpf", stateDir: "/dpf-state", composeProjectName: "dpf",
  })}\n`);
  // The same node shim the rollback acceptance uses: Git Bash hands POSIX
  // paths to a Windows node, which cannot open them.
  await writeFile(join(bin, "node"), `#!/usr/bin/env bash
converted=()
for arg in "$@"; do
  case "$arg" in /[a-zA-Z]/*) arg="$(cygpath -w "$arg")" ;; esac
  converted+=("$arg")
done
if [[ "\${DPF_PROMOTER_STATE_DIR:-}" == /[a-zA-Z]/* ]]; then export DPF_PROMOTER_STATE_DIR="$(cygpath -w "$DPF_PROMOTER_STATE_DIR")"; fi
exec '${bashPath(process.execPath)}' "\${converted[@]}"
`);
  await chmod(join(bin, "node"), 0o755);
  spawnSync("git", ["init", "-q", source]);
  spawnSync("git", ["-C", source, "config", "user.email", "test@example.com"]);
  spawnSync("git", ["-C", source, "config", "user.name", "Test"]);
  spawnSync("git", ["-C", source, "add", "."]);
  spawnSync("git", ["-C", source, "commit", "-q", "-m", "fixture"]);
  const sha = spawnSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  // Source the promoter in dry-run mode, then report the bind address the
  // compose commands would have inherited. Dry-run runs every resolution
  // step and touches no Docker.
  const harnessPath = join(dir, "harness.sh");
  await writeFile(harnessPath, `source "$1" --self-upgrade --dry-run\nprintf 'bind=%s\\n' "\${DPF_HOST_BIND_ADDRESS:-unset}"\n`);
  return { dir, source, stateDir, bin, sha, harnessPath };
}

async function promote(f, { envFile, processEnv } = {}) {
  const env = {
    ...process.env,
    PATH: `${bashPath(f.bin)}:/usr/local/bin:/usr/bin:/bin`,
    DPF_PROMOTER_STATE_DIR: bashPath(f.stateDir),
    PROMOTE_SOURCE: bashPath(f.source),
    PROMOTE_TARGET_SHA: f.sha,
    PROMOTE_BACKUP_PATH: bashPath(join(f.dir, "backup")),
    PROMOTE_HEALTH_URL: "http://acceptance.invalid/api/health",
    PROMOTE_COMPOSE_PROJECT: "dpf-bind-acceptance",
    ...processEnv,
  };
  delete env.DPF_HOST_BIND_ADDRESS;
  if (processEnv?.DPF_HOST_BIND_ADDRESS) env.DPF_HOST_BIND_ADDRESS = processEnv.DPF_HOST_BIND_ADDRESS;
  if (envFile !== undefined) {
    const path = join(f.dir, "install.env");
    await writeFile(path, envFile);
    env.PROMOTE_COMPOSE_ENV_FILE = bashPath(path);
  }
  const result = spawnSync(bash, [bashPath(f.harnessPath), bashPath(join(root, "scripts/promote.sh"))], { cwd: root, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const bind = result.stdout.match(/^bind=(.*)$/m)?.[1];
  return { bind, preserved: /step=host-bind-address-preserved/.test(result.stdout) };
}

test("an install .env that predates DPF_HOST_BIND_ADDRESS keeps its LAN exposure through the portal swap", async () => {
  const f = await fixture();
  try {
    const run = await promote(f, { envFile: "DPF_IMAGE_TAG=v2026.09.05-previous.1\nGHCR_OWNER=opendigitalproductfactory\n" });
    assert.equal(run.bind, "0.0.0.0");
    assert.equal(run.preserved, true, "the promoter must say it preserved the exposure");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("an install .env that already carries DPF_HOST_BIND_ADDRESS is respected as written", async () => {
  const f = await fixture();
  try {
    const run = await promote(f, { envFile: "DPF_IMAGE_TAG=v1\nDPF_HOST_BIND_ADDRESS=127.0.0.1\n" });
    assert.equal(run.bind, "unset", "compose reads the value from --env-file; the promoter must not override it");
    assert.equal(run.preserved, false);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("an operator-set DPF_HOST_BIND_ADDRESS in the promoter environment wins", async () => {
  const f = await fixture();
  try {
    const run = await promote(f, { envFile: "DPF_IMAGE_TAG=v1\n", processEnv: { DPF_HOST_BIND_ADDRESS: "127.0.0.1" } });
    assert.equal(run.bind, "127.0.0.1");
    assert.equal(run.preserved, false);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("no env file, or an empty one, is a fresh install and keeps the compose loopback default", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await promote(f), { bind: "unset", preserved: false });
    assert.deepEqual(await promote(f, { envFile: "\n" }), { bind: "unset", preserved: false });
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
