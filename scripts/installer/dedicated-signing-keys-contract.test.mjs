// BI-F6929F50: every install path provisions DPF_ATTENTION_REACH_SECRET and
// DPF_DELEGATION_RECEIPT_SECRET, the HMAC keys attention reach links
// (apps/web/lib/attention/reach-link.ts) and coworker delegation receipts
// (apps/web/lib/coworker-service-catalog/delegation-receipt.ts) are signed with.
// Without them both fall back to AUTH_SECRET, so one secret signs sessions,
// links and receipts. Provisioned exactly where DPF_GPP_PERMIT_SECRET is
// (BI-8541D491, gpp-permit-secret-contract.test.mjs): compose passes them to the
// portal, the installers and setup scripts generate them when missing, and a
// self-upgrade adds them to an install that lacks them. A value already set is
// never rotated.
//
// Conformance over repository state plus behaviour of the real bash that writes
// installer and self-upgrade output.
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

const KEYS = ["DPF_ATTENTION_REACH_SECRET", "DPF_DELEGATION_RECEIPT_SECRET"];
const HEX64 = /^[0-9a-f]{64}$/;
const read = (path) => readFile(join(root, path), "utf8");

function envValue(text, key) {
  const lines = text.split(/\r?\n/).filter((line) => line.startsWith(`${key}=`));
  return lines.length ? lines.at(-1).slice(key.length + 1).replace(/^["']|["']$/g, "") : undefined;
}

test("base compose passes both keys and the receipt key id to the portal, optional like the permit key", async () => {
  const text = await read("docker-compose.yml");
  for (const key of [...KEYS, "DPF_DELEGATION_RECEIPT_KEY_ID"]) {
    // Optional, never required: an install without the key keeps signing with AUTH_SECRET.
    assert.match(text, new RegExp(`^ {6}${key}: \\$\\{${key}:-\\}$`, "m"), `portal must receive ${key}`);
  }
  // Same service as the permit key (the portal): no service header between them.
  const start = text.indexOf("DPF_GPP_PERMIT_SECRET: ${");
  const end = text.indexOf("DPF_DELEGATION_RECEIPT_KEY_ID: ${");
  assert.ok(start >= 0 && end > start, "the signing keys follow the permit key");
  assert.doesNotMatch(text.slice(start, end), /^ {2}[A-Za-z][\w-]*:\s*$/m, "the signing keys belong to the portal service");
});

test("the env examples declare both keys without a usable value", async () => {
  for (const path of [".env.example", ".env.docker.example"]) {
    const text = await read(path);
    for (const key of KEYS) {
      assert.ok(envValue(text, key)?.startsWith("<"), `${path} must declare ${key} as a placeholder the installers fill`);
    }
  }
});

test("every installer and setup script that writes an install .env generates both keys", async () => {
  const installSh = await read("install-dpf.sh");
  for (const key of KEYS) assert.match(installSh, new RegExp(`dpf_env_ensure_secret_hex ${key} \\.env 32`), `install-dpf.sh: ${key}`);
  const setupSh = await read("scripts/setup.sh");
  assert.match(setupSh, /for _env_file in apps\/web\/\.env\.local \.env; do\s+for _signing_key in DPF_ATTENTION_REACH_SECRET DPF_DELEGATION_RECEIPT_SECRET(?: [A-Z_]+)*; do\s+if \[ "\$\(dpf_env_ensure_secret_hex "\$_signing_key" "\$_env_file" 32\)" != "kept" \]/);
  const installPs1 = await read("install-dpf.ps1");
  assert.match(installPs1, /foreach \(\$signingKeyName in @\("DPF_ATTENTION_REACH_SECRET", "DPF_DELEGATION_RECEIPT_SECRET"(?:, "[A-Z_]+")*\)\)/);
  assert.match(installPs1, /-Key \$signingKeyName -Value \(New-RandomPassword 32\)/);
  const setupPs1 = await read("scripts/setup.ps1");
  assert.match(setupPs1, /foreach \(\$secretKey in @\("DPF_GIT_WEBHOOK_SECRET", "DPF_GPP_PERMIT_SECRET", "DPF_ATTENTION_REACH_SECRET", "DPF_DELEGATION_RECEIPT_SECRET"(?:, "[A-Z_]+")*\)\)/);
  const promote = await read("scripts/promote.sh");
  assert.match(promote, /for _signing_key in DPF_ATTENTION_REACH_SECRET DPF_DELEGATION_RECEIPT_SECRET(?: [A-Z_]+)*; do/);
  assert.match(promote, /_signing_key_value="\$\(node -e 'process\.stdout\.write\(require\("node:crypto"\)\.randomBytes\(32\)\.toString\("hex"\)\)'\)"/);
  const assets = await read("scripts/installer/install-release-assets.mjs");
  // BI-231A4BC7 adds keys to the same list; the list must keep these two.
  assert.match(assets, /export const DEDICATED_SIGNING_KEYS = Object\.freeze\(\[\s*"DPF_ATTENTION_REACH_SECRET",\s*"DPF_DELEGATION_RECEIPT_SECRET"[,\s"A-Z_]*\]\);/);
  assert.match(assets, /text = ensureDedicatedSigningKeys\(text, newline\);/);
});

test("installer output fills missing or placeholder keys, keeps real ones, and never prints them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-signing-keys-env-"));
  try {
    const real = "9".repeat(64);
    for (const key of KEYS) {
      const cases = {
        missing: "POSTGRES_USER=dpf\n",
        placeholder: `${key}="<generate a distinct value with: openssl rand -hex 32>"\n`,
        real: `${key}="${real}"\n`,
      };
      for (const [name, body] of Object.entries(cases)) {
        const file = join(dir, `${key}-${name}.env`);
        await writeFile(file, body);
        const result = runBash(`source scripts/installer/lib/prompts.sh
dpf_env_ensure_secret_hex ${key} "${bashPath(file)}" 32 '# Signing key (BI-F6929F50).'`);
        assert.equal(result.status, 0, result.stderr);
        const value = envValue(await readFile(file, "utf8"), key);
        if (name === "real") {
          assert.equal(value, real);
          assert.equal(result.stdout.trim(), "kept");
        } else {
          assert.match(value, HEX64, `${key} ${name}`);
          assert.ok(!result.stdout.includes(value) && !result.stderr.includes(value), `${key} ${name}: the key was printed`);
        }
      }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

function runBash(script, env = {}) {
  return spawnSync(bash, ["-c", script], { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" });
}

async function promoteFixture() {
  const dir = await mkdtemp(join(tmpdir(), "dpf-promote-signing-keys-"));
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
    PROMOTE_COMPOSE_PROJECT: "dpf-signing-keys-acceptance",
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
      for (const value of values) {
        assert.match(value, HEX64);
        // Only the harness prints it; promote.sh itself never does.
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

test("the promoter persists a generated key in place and leaves every other line alone", async () => {
  const f = await promoteFixture();
  try {
    const file = join(f.dir, "persist.env");
    await writeFile(file, "POSTGRES_USER=dpf\nAUTH_SECRET=keep");
    await promote(f, {
      envFile: "DPF_IMAGE_TAG=v1\n",
      after: KEYS.map((key) => `_inngest_env_write "${bashPath(file)}" ${key} "$${key}" "# Signing key ${key} (BI-F6929F50). Generated by the self-upgrade; never rotated."`).join("\n"),
    });
    const text = await readFile(file, "utf8");
    assert.match(text, new RegExp(`^POSTGRES_USER=dpf\\nAUTH_SECRET=keep\\n# Signing key ${KEYS[0]} [^\\n]*\\n${KEYS[0]}=[0-9a-f]{64}\\n# Signing key ${KEYS[1]} [^\\n]*\\n${KEYS[1]}=[0-9a-f]{64}\\n$`));
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
