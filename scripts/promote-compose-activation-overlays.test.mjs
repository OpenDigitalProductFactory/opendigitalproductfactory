// BI-B422ED03 (D1 of BI-C54E691E): the promoter composes from the chain the
// install recorded at install time. Overlays switched on later through .env
// markers (bootstrap-organization-pki writes DPF_ORGANIZATION_TRUST_ENABLED=1)
// never reached it, so portal-tls lay outside every self-upgrade and #6020's
// reaping init never arrived (live, 2026-10-06). promote.sh must append the
// marker-activated overlays from the target tree's activation-overlays.txt,
// the same table the installers read.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
const bashPath = (path) => process.platform === "win32"
  ? resolve(path).replace(/^([A-Za-z]):\\/, (_, drive) => `/${drive.toLowerCase()}/`).replaceAll("\\", "/")
  : resolve(path);

const OVERLAYS = `# marker  overlay files (applied in this order)
DPF_ORGANIZATION_TRUST_ENABLED docker-compose.organization-trust.yml docker-compose.tls.yml
DPF_EDGE_ACTION_DISPATCH_CONFIGURED docker-compose.edge-actions.yml
`;

async function fixture({ overlays = OVERLAYS, files = ["docker-compose.organization-trust.yml", "docker-compose.tls.yml", "docker-compose.edge-actions.yml"] } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "dpf-promote-overlays-"));
  const source = join(dir, "source");
  const stateDir = join(dir, "state");
  const bin = join(dir, "bin");
  await Promise.all([mkdir(join(source, "scripts", "lib"), { recursive: true }), mkdir(join(source, "scripts", "installer", "lib"), { recursive: true }), mkdir(stateDir), mkdir(bin)]);
  await writeFile(join(source, "scripts/lib/resolve-capability-compose-profiles.mjs"),
    `process.stdout.write(JSON.stringify({composeProfiles:[],requiredServices:[]}) + "\\n");\n`);
  if (overlays !== null) await writeFile(join(source, "scripts/installer/lib/activation-overlays.txt"), overlays);
  for (const file of ["docker-compose.yml", "docker-compose.macos.yml", ...files]) await writeFile(join(source, file), "services: {}\n");
  await writeFile(join(stateDir, "install-state.json"), `${JSON.stringify({
    schemaVersion: 1, installerVersion: "acceptance-v1", platform: "macos", arch: "arm64",
    installPath: "/opt/dpf", stateDir: "/dpf-state", composeProjectName: "dpf",
  })}\n`);
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
  const harnessPath = join(dir, "harness.sh");
  await writeFile(harnessPath, `source "$1" --self-upgrade --dry-run\nprintf 'chain=%s\\n' "\${_compose_files[*]}"\n`);
  return { dir, source, stateDir, bin, sha, harnessPath };
}

async function chain(f, { recorded = "docker-compose.yml docker-compose.macos.yml", envFile, processEnv = {} } = {}) {
  const env = {
    ...process.env,
    PATH: `${bashPath(f.bin)}:/usr/local/bin:/usr/bin:/bin`,
    DPF_PROMOTER_STATE_DIR: bashPath(f.stateDir),
    PROMOTE_SOURCE: bashPath(f.source),
    PROMOTE_TARGET_SHA: f.sha,
    PROMOTE_BACKUP_PATH: bashPath(join(f.dir, "backup")),
    PROMOTE_HEALTH_URL: "http://acceptance.invalid/api/health",
    PROMOTE_COMPOSE_PROJECT: "dpf-overlay-acceptance",
    PROMOTE_COMPOSE_FILES: recorded,
    ...processEnv,
  };
  delete env.DPF_ORGANIZATION_TRUST_ENABLED;
  delete env.DPF_EDGE_ACTION_DISPATCH_CONFIGURED;
  Object.assign(env, processEnv);
  if (envFile !== undefined) {
    const path = join(f.dir, "install.env");
    await writeFile(path, envFile);
    env.PROMOTE_COMPOSE_ENV_FILE = bashPath(path);
  }
  const result = spawnSync(bash, [bashPath(f.harnessPath), bashPath(join(root, "scripts/promote.sh"))], { cwd: root, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return { files: result.stdout.match(/^chain=(.*)$/m)?.[1].split(" ").filter(Boolean), stdout: result.stdout };
}

const BASE = ["docker-compose.yml", "docker-compose.macos.yml"];

test("an install whose TLS was enabled after install gets the TLS overlays in its upgrade chain", async () => {
  const f = await fixture();
  try {
    const run = await chain(f, { envFile: "DPF_ORGANIZATION_TRUST_ENABLED=1\n" });
    assert.deepEqual(run.files, [...BASE, "docker-compose.organization-trust.yml", "docker-compose.tls.yml"]);
    assert.match(run.stdout, /step=compose-activation-overlays .*docker-compose\.tls\.yml/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("both markers add their overlays in table order, and the process environment counts too", async () => {
  const f = await fixture();
  try {
    const run = await chain(f, { envFile: "DPF_EDGE_ACTION_DISPATCH_CONFIGURED=1\n", processEnv: { DPF_ORGANIZATION_TRUST_ENABLED: "1" } });
    assert.deepEqual(run.files, [...BASE, "docker-compose.organization-trust.yml", "docker-compose.tls.yml", "docker-compose.edge-actions.yml"]);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("no marker, a marker not set to 1, or an overlay already recorded leaves the chain as recorded", async () => {
  const f = await fixture();
  try {
    assert.deepEqual((await chain(f, { envFile: "DPF_IMAGE_TAG=v1\n" })).files, BASE);
    assert.deepEqual((await chain(f, { envFile: "DPF_ORGANIZATION_TRUST_ENABLED=0\n" })).files, BASE);
    const recorded = "docker-compose.yml docker-compose.organization-trust.yml docker-compose.tls.yml";
    assert.deepEqual((await chain(f, { recorded, envFile: "DPF_ORGANIZATION_TRUST_ENABLED=1\n" })).files, recorded.split(" "));
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("a target tree without the table or without the overlay file changes nothing", async () => {
  const noTable = await fixture({ overlays: null });
  const noFile = await fixture({ files: [] });
  try {
    assert.deepEqual((await chain(noTable, { envFile: "DPF_ORGANIZATION_TRUST_ENABLED=1\n" })).files, BASE);
    assert.deepEqual((await chain(noFile, { envFile: "DPF_ORGANIZATION_TRUST_ENABLED=1\n" })).files, BASE);
  } finally {
    await rm(noTable.dir, { recursive: true, force: true });
    await rm(noFile.dir, { recursive: true, force: true });
  }
});

test("release installs carry the activation table where the promoter reads it", async () => {
  // In release mode promote.sh composes from the release assets, so the table
  // must ship at <assets>/scripts/installer/lib/activation-overlays.txt; without
  // it the TLS overlays would silently fall out of every release-mode upgrade.
  const { readFile } = await import("node:fs/promises");
  const dockerfile = await readFile(join(root, "Dockerfile"), "utf8");
  const releaseCopy = dockerfile.split("\n").find((line) => line.includes("/dpf-release-assets/scripts/installer/lib/") && line.includes("cp "));
  assert.ok(releaseCopy, "no release-assets copy into scripts/installer/lib");
  assert.match(releaseCopy, /scripts\/installer\/lib\/activation-overlays\.txt/);
});

test("every installer/lib file the release assets copy is COPYed into the build stage first (BI-B55CCFAA)", async () => {
  // #6060 named activation-overlays.txt in the release-assets cp but never
  // COPYed it into the stage, so every self-upgrade prebuild failed with a
  // missing file (SUR-8CE880A6). The cp can only copy what a COPY brought in.
  const { readFile } = await import("node:fs/promises");
  const dockerfile = await readFile(join(root, "Dockerfile"), "utf8");
  const releaseCopy = dockerfile.split("\n").filter((line) => line.includes("/dpf-release-assets/scripts/installer/lib/") && line.includes("cp "));
  const named = new Set(releaseCopy.flatMap((line) => [...line.matchAll(/scripts\/installer\/lib\/[^\s/]+/g)].map((m) => m[0])));
  assert.ok(named.size > 0, "no installer/lib files found in the release-assets copy");
  const copied = new Set([...dockerfile.matchAll(/^COPY (scripts\/installer\/lib\/[^\s]+) /gm)].map((m) => m[1]));
  const missing = [...named].filter((file) => !copied.has(file));
  assert.deepEqual(missing, [], `release assets copy files no COPY brings into the stage: ${missing.join(", ")}`);
});
