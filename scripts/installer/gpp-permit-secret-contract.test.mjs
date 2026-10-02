// BI-8541D491: every install path provisions DPF_GPP_PERMIT_SECRET, the HMAC
// key GPP permits are signed with (apps/web/lib/gpp/permit-handle.ts). Without
// it every permit is minted unsigned and no binding can be enforced. The key is
// provisioned exactly where DPF_GIT_WEBHOOK_SECRET is (BI-C26D5DC5): compose
// passes it to the portal, the installers and setup scripts generate it when
// missing, and a self-upgrade adds it to an install that lacks it. A value
// already set is never rotated.
//
// Conformance over repository state plus behaviour of the real bash that writes
// installer and self-upgrade output. Patterned on inngest-keys-contract.test.mjs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
const bashPath = (path) => process.platform === "win32"
  ? resolve(path).replace(/^([A-Za-z]):\\/, (_, drive) => `/${drive.toLowerCase()}/`).replaceAll("\\", "/")
  : resolve(path);

const KEY = "DPF_GPP_PERMIT_SECRET";
const KEY_ID = "DPF_GPP_PERMIT_KEY_ID";
const HEX64 = /^[0-9a-f]{64}$/;
const read = (path) => readFile(join(root, path), "utf8");

function envValue(text, key) {
  const lines = text.split(/\r?\n/).filter((line) => line.startsWith(`${key}=`));
  return lines.length ? lines.at(-1).slice(key.length + 1).replace(/^["']|["']$/g, "") : undefined;
}

test("base compose passes the permit key and its id to the portal, optional like the webhook secret", async () => {
  const text = await read("docker-compose.yml");
  assert.match(text, /^ {6}DPF_GIT_WEBHOOK_SECRET: \$\{DPF_GIT_WEBHOOK_SECRET:-\}$/m);
  // Optional, never required: an install without the key records `unsigned`.
  assert.match(text, new RegExp(`^ {6}${KEY}: \\$\\{${KEY}:-\\}$`, "m"), "portal must receive DPF_GPP_PERMIT_SECRET");
  assert.match(text, new RegExp(`^ {6}${KEY_ID}: \\$\\{${KEY_ID}:-\\}$`, "m"), "portal must receive DPF_GPP_PERMIT_KEY_ID");
  // Same service as the webhook secret (the portal): no service header between them.
  const start = text.indexOf("DPF_GIT_WEBHOOK_SECRET: ${");
  const end = text.indexOf(`${KEY_ID}: \${`);
  assert.ok(start >= 0 && end > start, "the permit key follows the webhook secret");
  assert.doesNotMatch(text.slice(start, end), /^ {2}[A-Za-z][\w-]*:\s*$/m, "the permit key belongs to the portal service");
});

test("the env examples declare the permit key without a usable value", async () => {
  for (const path of [".env.example", ".env.docker.example"]) {
    const value = envValue(await read(path), KEY);
    assert.ok(value?.startsWith("<"), `${path} must declare ${KEY} as a placeholder the installers fill`);
  }
});

test("every installer and setup script that writes an install .env generates the permit key", async () => {
  assert.match(await read("install-dpf.sh"), /dpf_env_ensure_secret_hex DPF_GPP_PERMIT_SECRET \.env 32/);
  const setupSh = await read("scripts/setup.sh");
  assert.match(setupSh, /for _env_file in apps\/web\/\.env\.local \.env; do\s+if \[ "\$\(dpf_env_ensure_secret_hex DPF_GPP_PERMIT_SECRET "\$_env_file" 32\)" != "kept" \]/);
  assert.match(await read("install-dpf.ps1"), /-Key "DPF_GPP_PERMIT_SECRET" -Value \(New-RandomPassword 32\)/);
  const setupPs1 = await read("scripts/setup.ps1");
  assert.match(setupPs1, /foreach \(\$secretKey in @\("DPF_GIT_WEBHOOK_SECRET", "DPF_GPP_PERMIT_SECRET"\)\)/);
  assert.match(setupPs1, /\[System\.Security\.Cryptography\.RandomNumberGenerator\]::Create\(\)\.GetBytes\(\$secretBytes\)/);
  const promote = await read("scripts/promote.sh");
  assert.match(promote, /_gpp_permit_value="\$\(node -e 'process\.stdout\.write\(require\("node:crypto"\)\.randomBytes\(32\)\.toString\("hex"\)\)'\)"/);
  const assets = await read("scripts/installer/install-release-assets.mjs");
  assert.match(assets, /text = ensureGppPermitSecret\(text, newline\);/);
});

test("no install path provisions the attention-reach or delegation-receipt secrets", async () => {
  for (const path of ["install-dpf.sh", "install-dpf.ps1", "scripts/setup.sh", "scripts/setup.ps1", "scripts/promote.sh",
    "scripts/installer/install-release-assets.mjs", "docker-compose.yml", ".env.example", ".env.docker.example"]) {
    const text = await read(path);
    for (const other of ["DPF_ATTENTION_REACH_SECRET", "DPF_DELEGATION_RECEIPT_SECRET"]) {
      assert.ok(!text.includes(other), `${path} must not provision ${other} (out of scope for BI-8541D491)`);
    }
  }
});

function runBash(script, env = {}) {
  return spawnSync(bash, ["-c", script], { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" });
}

test("installer output fills a missing or placeholder permit key, keeps a real one, and never prints it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-gpp-permit-env-"));
  try {
    const real = "9".repeat(64);
    const cases = {
      missing: "POSTGRES_USER=dpf\n",
      placeholder: `${KEY}="<generate a distinct value with: openssl rand -hex 32>"\n`,
      real: `${KEY}="${real}"\n`,
    };
    for (const [name, body] of Object.entries(cases)) {
      const file = join(dir, `${name}.env`);
      await writeFile(file, body);
      const result = runBash(`source scripts/installer/lib/prompts.sh
dpf_env_ensure_secret_hex ${KEY} "${bashPath(file)}" 32 '# GPP permit signing key (BI-8541D491).'`);
      assert.equal(result.status, 0, result.stderr);
      const value = envValue(await readFile(file, "utf8"), KEY);
      if (name === "real") {
        assert.equal(value, real);
        assert.equal(result.stdout.trim(), "kept");
      } else {
        assert.match(value, HEX64, `${name}: permit key`);
        assert.ok(!result.stdout.includes(value) && !result.stderr.includes(value), `${name}: the key was printed`);
      }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

async function promoteFixture() {
  const dir = await mkdtemp(join(tmpdir(), "dpf-promote-gpp-permit-"));
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
// runs `after` in the same shell so it sees the resolved values and helpers.
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
    PROMOTE_COMPOSE_PROJECT: "dpf-gpp-permit-acceptance",
    INNGEST_SIGNING_KEY: "1".repeat(64),
    INNGEST_EVENT_KEY: "2".repeat(64),
  };
  delete env[KEY];
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

const PRINT_KEY = `printf 'permit=%s\\n' "\${${KEY}:-}"`;
const printedKey = (stdout) => stdout.match(/^permit=(.*)$/m)?.[1];

test("a self-upgrade generates the permit key for an install that lacks it, before any compose command runs", async () => {
  const f = await promoteFixture();
  try {
    for (const envFile of ["DPF_IMAGE_TAG=v1\n", `${KEY}="<generate a distinct value with: openssl rand -hex 32>"\n`]) {
      const result = await promote(f, { envFile, after: PRINT_KEY });
      const value = printedKey(result.stdout);
      assert.match(value, HEX64);
      // Only the harness prints it; promote.sh itself never does.
      assert.equal(result.stdout.split(value).length, 2, "promote.sh printed the generated key");
      assert.ok(!result.stderr.includes(value), "promote.sh printed the generated key to stderr");
    }
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("a self-upgrade never rotates an existing permit key, quoted or not", async () => {
  const f = await promoteFixture();
  try {
    const real = "8".repeat(64);
    for (const envFile of [`${KEY}=${real}\n`, `${KEY}="${real}"\n`, `${KEY}='${real}'\n`]) {
      const value = printedKey((await promote(f, { envFile, after: PRINT_KEY })).stdout);
      // Not exported: compose reads the install .env value unchanged.
      assert.equal(value, "", `an existing key was replaced for ${JSON.stringify(envFile)}`);
    }
    const fromProcess = printedKey((await promote(f, {
      envFile: "DPF_IMAGE_TAG=v1\n", processEnv: { [KEY]: real }, after: PRINT_KEY,
    })).stdout);
    assert.equal(fromProcess, real, "a value already in the promoter environment wins");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("the promoter persists a generated permit key in place and leaves every other line alone", async () => {
  const f = await promoteFixture();
  try {
    const file = join(f.dir, "persist.env");
    await writeFile(file, "POSTGRES_USER=dpf\nAUTH_SECRET=keep");
    await promote(f, {
      envFile: "DPF_IMAGE_TAG=v1\n",
      after: `_inngest_env_write "${bashPath(file)}" ${KEY} "$${KEY}" "$_GPP_PERMIT_COMMENT"`,
    });
    const text = await readFile(file, "utf8");
    assert.match(text, new RegExp(`^POSTGRES_USER=dpf\\nAUTH_SECRET=keep\\n# Signing key for GPP permits \\(BI-8541D491\\)[^\\n]*\\n${KEY}=[0-9a-f]{64}\\n$`));
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
