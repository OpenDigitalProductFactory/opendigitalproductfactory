// BI-231A4BC7: every install path provisions DPF_SELF_UPGRADE_TARGET_BINDING_SECRET
// and DPF_DELIVERY_TASK_CURSOR_SECRET, the HMAC keys self-upgrade target
// bindings (apps/web/lib/self-upgrade/target-binding.ts) and delivery task hub
// cursors (apps/web/lib/work-capsules/delivery-task-hub-store.ts) are signed
// with. Both readers fall back to AUTH_SECRET, and no install path writes either
// key, so the session secret signs both on every install. Provisioned exactly
// where the BI-F6929F50 keys are (dedicated-signing-keys-contract.test.mjs):
// compose passes them to the portal only, the installers and setup scripts
// generate them when missing, and a self-upgrade adds them to an install that
// lacks them. A value already set is never rotated.
//
// The sandbox service receives the live AUTH_SECRET (docker-compose.yml) and runs
// agent-authored code, so these keys must never be passed to it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
const bashPath = (path) => process.platform === "win32"
  ? resolve(path).replace(/^([A-Za-z]):\\/, (_, drive) => `/${drive.toLowerCase()}/`).replaceAll("\\", "/")
  : resolve(path);

const KEYS = ["DPF_SELF_UPGRADE_TARGET_BINDING_SECRET", "DPF_DELIVERY_TASK_CURSOR_SECRET"];
const HEX64 = /^[0-9a-f]{64}$/;
const read = (path) => readFile(join(root, path), "utf8");

function envValue(text, key) {
  const lines = text.split(/\r?\n/).filter((line) => line.startsWith(`${key}=`));
  return lines.length ? lines.at(-1).slice(key.length + 1).replace(/^["']|["']$/g, "") : undefined;
}

function serviceBlock(compose, name) {
  const start = compose.search(new RegExp(`^ {2}${name}:\\s*$`, "m"));
  assert.ok(start >= 0, `compose has a ${name} service`);
  const rest = compose.slice(start + 1);
  const next = rest.search(/^ {2}[A-Za-z][\w-]*:\s*$/m);
  return next < 0 ? rest : rest.slice(0, next);
}

test("base compose passes both keys to the portal, optional, and never to the sandbox", async () => {
  const text = await read("docker-compose.yml");
  const portal = serviceBlock(text, "portal");
  const sandbox = serviceBlock(text, "sandbox");
  for (const key of KEYS) {
    // Optional, never required: an install without the key keeps signing with AUTH_SECRET.
    assert.ok(new RegExp(`^ {6}${key}: \\$\\{${key}:-\\}$`, "m").test(portal), `portal must receive ${key}`);
    assert.ok(!sandbox.includes(key), `the sandbox runs agent-authored code and must not receive ${key}`);
  }
});

test("the env examples declare both keys without a usable value", async () => {
  for (const path of [".env.example", ".env.docker.example"]) {
    const text = await read(path);
    for (const key of KEYS) {
      assert.ok(envValue(text, key)?.startsWith("<"), `${path} must declare ${key} as a placeholder the installers fill`);
    }
  }
});

test("every installer, setup script and the promoter names both keys", async () => {
  for (const path of [
    "install-dpf.sh",
    "install-dpf.ps1",
    "scripts/setup.sh",
    "scripts/setup.ps1",
    "scripts/promote.sh",
    "scripts/installer/install-release-assets.mjs",
  ]) {
    const text = await read(path);
    for (const key of KEYS) assert.ok(text.includes(key), `${path} must provision ${key}`);
  }
});

test("release-mode asset install fills both keys when missing and never replaces a real one", async () => {
  const assets = await import(pathToFileURL(join(root, "scripts/installer/install-release-assets.mjs")).href);
  for (const key of KEYS) {
    assert.ok(assets.DEDICATED_SIGNING_KEYS.includes(key), `DEDICATED_SIGNING_KEYS must include ${key}`);
  }
  const filled = assets.ensureDedicatedSigningKeys("POSTGRES_USER=dpf\n", "\n", {});
  for (const key of KEYS) assert.match(envValue(filled, key) ?? "", HEX64, `${key} generated`);
  const exported = assets.ensureDedicatedSigningKeys("POSTGRES_USER=dpf\n", "\n",
    Object.fromEntries(KEYS.map((key) => [key, "7".repeat(64)])));
  for (const key of KEYS) assert.equal(envValue(exported, key), "7".repeat(64), `${key}: the value promote.sh exported is persisted`);
  const real = "9".repeat(64);
  const kept = assets.ensureDedicatedSigningKeys(KEYS.map((key) => `${key}=${real}`).join("\n") + "\n", "\n", {});
  for (const key of KEYS) assert.equal(envValue(kept, key), real, `${key} must never be rotated`);
});

function runBash(script, env = {}) {
  return spawnSync(bash, ["-c", script], { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" });
}

async function promoteFixture() {
  const dir = await mkdtemp(join(tmpdir(), "dpf-promote-binding-keys-"));
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
  return { dir, source, stateDir, bin, sha };
}

// Sources promote.sh in dry-run mode (every resolution step, no Docker), then
// runs `after` in the same shell so it sees the resolved values.
async function promote(f, { envFile, processEnv = {}, after }) {
  const harness = join(f.dir, "harness.sh");
  await writeFile(harness, `source "$1" --self-upgrade --dry-run\n${after}\n`);
  const env = {
    ...process.env,
    PATH: `${bashPath(f.bin)}:/usr/local/bin:/usr/bin:/bin`,
    DPF_PROMOTER_STATE_DIR: bashPath(f.stateDir),
    PROMOTE_SOURCE: bashPath(f.source),
    PROMOTE_TARGET_SHA: f.sha,
    PROMOTE_BACKUP_PATH: bashPath(join(f.dir, "backup")),
    PROMOTE_HEALTH_URL: "http://acceptance.invalid/api/health",
    PROMOTE_COMPOSE_PROJECT: "dpf-binding-keys-acceptance",
    INNGEST_SIGNING_KEY: "1".repeat(64),
    INNGEST_EVENT_KEY: "2".repeat(64),
  };
  for (const key of KEYS) delete env[key];
  Object.assign(env, processEnv);
  if (envFile !== undefined) {
    const path = join(f.dir, "install.env");
    await writeFile(path, envFile);
    env.PROMOTE_COMPOSE_ENV_FILE = bashPath(path);
  }
  const result = spawnSync(bash, [bashPath(harness), bashPath(join(root, "scripts/promote.sh"))], { cwd: root, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

const PRINT_KEYS = KEYS.map((key) => `printf '${key}=%s\\n' "\${${key}:-}"`).join("\n");
const printed = (stdout, key) => stdout.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1];

test("a self-upgrade generates both keys for an install that lacks them, distinct, and never prints them", async () => {
  const f = await promoteFixture();
  try {
    const placeholders = KEYS.map((key) => `${key}="<generate a distinct value with: openssl rand -hex 32>"`).join("\n");
    for (const envFile of ["DPF_IMAGE_TAG=v1\n", `${placeholders}\n`]) {
      const result = await promote(f, { envFile, after: PRINT_KEYS });
      const values = KEYS.map((key) => printed(result.stdout, key));
      for (const [index, value] of values.entries()) {
        assert.match(value ?? "", HEX64, `${KEYS[index]} for ${JSON.stringify(envFile)}`);
        assert.equal(result.stdout.split(value).length, 2, "promote.sh printed a generated key");
        assert.ok(!result.stderr.includes(value), "promote.sh printed a generated key to stderr");
      }
      assert.notEqual(values[0], values[1], "each key gets its own value");
    }
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("a self-upgrade never rotates an existing key, quoted or not", async () => {
  const f = await promoteFixture();
  try {
    const real = "8".repeat(64);
    for (const quote of ["", '"', "'"]) {
      const envFile = KEYS.map((key) => `${key}=${quote}${real}${quote}`).join("\n") + "\n";
      const result = await promote(f, { envFile, after: PRINT_KEYS });
      for (const key of KEYS) {
        // Not exported: compose reads the install .env value unchanged.
        assert.equal(printed(result.stdout, key), "", `${key} was replaced for ${JSON.stringify(envFile)}`);
      }
    }
    const processEnv = Object.fromEntries(KEYS.map((key) => [key, real]));
    const fromProcess = await promote(f, { envFile: "DPF_IMAGE_TAG=v1\n", processEnv, after: PRINT_KEYS });
    for (const key of KEYS) assert.equal(printed(fromProcess.stdout, key), real, "a value already in the promoter environment wins");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("installer output fills missing or placeholder keys, keeps real ones, and never prints them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-binding-keys-env-"));
  try {
    const installSh = await read("install-dpf.sh");
    for (const key of KEYS) {
      assert.ok(new RegExp(`dpf_env_ensure_secret_hex ${key} \\.env 32`).test(installSh), `install-dpf.sh must generate ${key} with dpf_env_ensure_secret_hex`);
      const file = join(dir, `${key}.env`);
      await writeFile(file, "POSTGRES_USER=dpf\n");
      const result = runBash(`source scripts/installer/lib/prompts.sh
dpf_env_ensure_secret_hex ${key} "${bashPath(file)}" 32 '# Signing key (BI-231A4BC7).'`);
      assert.equal(result.status, 0, result.stderr);
      const value = envValue(await readFile(file, "utf8"), key);
      assert.match(value ?? "", HEX64);
      assert.ok(!result.stdout.includes(value) && !result.stderr.includes(value), `${key}: the key was printed`);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
