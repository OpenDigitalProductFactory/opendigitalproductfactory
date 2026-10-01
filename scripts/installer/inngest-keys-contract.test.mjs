// BI-3267763F: no install may run Inngest on the signing or event key that was
// published in this repository as a compose default. Portal and inngest verify
// each other with that pair, so a public value let anyone who could reach
// /api/inngest forge signed function invocations.
//
// Conformance over repository state (compose, env examples, installers) plus
// behaviour of the real bash that writes installer and self-upgrade output.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
const bashPath = (path) => process.platform === "win32"
  ? resolve(path).replace(/^([A-Za-z]):\\/, (_, drive) => `/${drive.toLowerCase()}/`).replaceAll("\\", "/")
  : resolve(path);

const PUBLIC_KEYS = ["abcdef0123456789", "deadbeefcafebabe"];
const KEYS = ["INNGEST_SIGNING_KEY", "INNGEST_EVENT_KEY"];
const HEX64 = /^[0-9a-f]{64}$/;
const read = (path) => readFile(join(root, path), "utf8");

function envValue(text, key) {
  const lines = text.split(/\r?\n/).filter((line) => line.startsWith(`${key}=`));
  return lines.length ? lines.at(-1).slice(key.length + 1).replace(/^["']|["']$/g, "") : undefined;
}

test("no compose file carries a default Inngest key", async () => {
  const files = (await readdir(root)).filter((name) => /^docker-compose.*\.ya?ml$/.test(name));
  assert.ok(files.includes("docker-compose.yml"));
  for (const name of files) {
    const text = await read(name);
    for (const literal of PUBLIC_KEYS) assert.ok(!text.includes(literal), `${name} still carries the public Inngest key ${literal}`);
    for (const key of KEYS) {
      for (const match of text.matchAll(new RegExp(`\\$\\{${key}(:?[-?=+])?`, "g"))) {
        assert.ok(match[1] === ":?" || match[1] === "?", `${name}: \${${key}} must fail fast when unset, not fall back (${match[0]})`);
      }
    }
  }
  const base = await read("docker-compose.yml");
  for (const key of KEYS) {
    assert.equal((base.match(new RegExp(`\\$\\{${key}:\\?`, "g")) ?? []).length, 2, `${key} is required by both the portal and inngest services`);
  }
});

test("the env examples declare both keys without a usable value", async () => {
  for (const path of [".env.example", ".env.docker.example"]) {
    const text = await read(path);
    for (const literal of PUBLIC_KEYS) assert.ok(!text.includes(literal), `${path} carries ${literal}`);
    for (const key of KEYS) {
      const value = envValue(text, key);
      assert.ok(value?.startsWith("<"), `${path} must declare ${key} as a placeholder the installers fill`);
    }
  }
});

test("every installer that writes an install .env generates both keys", async () => {
  const sh = await read("install-dpf.sh");
  assert.match(sh, /for _inngest_key in INNGEST_SIGNING_KEY INNGEST_EVENT_KEY; do\s+if \[ "\$\(dpf_env_ensure_secret_hex "\$_inngest_key" \.env 32/);
  const setupSh = await read("scripts/setup.sh");
  assert.match(setupSh, /for _inngest_key in INNGEST_SIGNING_KEY INNGEST_EVENT_KEY; do\s+if \[ "\$\(dpf_env_ensure_secret_hex "\$_inngest_key" \.env 32\)"/);
  for (const path of ["install-dpf.ps1", "scripts/setup.ps1"]) {
    const text = await read(path);
    assert.match(text, /foreach \(\$inngestKey in @\("INNGEST_SIGNING_KEY", "INNGEST_EVENT_KEY"\)\)/, `${path} must ensure both keys`);
    for (const literal of PUBLIC_KEYS) assert.ok(text.includes(`"${literal}"`), `${path} must treat ${literal} as missing`);
  }
  assert.match(await read("install-dpf.ps1"), /-Key \$inngestKey -Value \(New-RandomPassword 32\)/);
  const fresh = await read("scripts/fresh-install.ps1");
  for (const key of KEYS) assert.match(fresh, new RegExp(`^${key}=\\$inngest`, "m"));
});

function runBash(script, env = {}) {
  return spawnSync(bash, ["-c", script], { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" });
}

test("installer output replaces a missing, placeholder or public key and keeps a real one", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-inngest-env-"));
  try {
    const real = "7".repeat(64);
    const cases = {
      missing: "POSTGRES_USER=dpf\n",
      placeholder: 'INNGEST_SIGNING_KEY="<generate a distinct value with: openssl rand -hex 32>"\nINNGEST_EVENT_KEY="<generate a distinct value with: openssl rand -hex 32>"\n',
      public: "INNGEST_SIGNING_KEY=abcdef0123456789\nINNGEST_EVENT_KEY=deadbeefcafebabe\n", // gitleaks:allow — the old public compose default this test refuses, not a credential (BI-3267763F)
      real: `INNGEST_SIGNING_KEY=${real}\nINNGEST_EVENT_KEY=${real}\n`,
    };
    for (const [name, body] of Object.entries(cases)) {
      const file = join(dir, `${name}.env`);
      await writeFile(file, body);
      const result = runBash(`source scripts/installer/lib/prompts.sh
for k in INNGEST_SIGNING_KEY INNGEST_EVENT_KEY; do dpf_env_ensure_secret_hex "$k" "$1" 32; done`.replace("$1", bashPath(file)));
      assert.equal(result.status, 0, result.stderr);
      const text = await readFile(file, "utf8");
      for (const literal of PUBLIC_KEYS) assert.ok(!text.includes(literal), `${name}: installer output still carries ${literal}`);
      const signing = envValue(text, "INNGEST_SIGNING_KEY");
      const event = envValue(text, "INNGEST_EVENT_KEY");
      if (name === "real") {
        assert.equal(signing, real);
        assert.equal(event, real);
        assert.deepEqual(result.stdout.trim().split(/\s+/), ["kept", "kept"]);
      } else {
        assert.match(signing, HEX64, `${name}: signing key`);
        assert.match(event, HEX64, `${name}: event key`);
        assert.notEqual(signing, event, "the two keys are generated independently");
      }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

async function promoteFixture() {
  const dir = await mkdtemp(join(tmpdir(), "dpf-promote-inngest-"));
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
    PROMOTE_COMPOSE_PROJECT: "dpf-inngest-acceptance",
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
  return result.stdout;
}

const PRINT_KEYS = `printf 'signing=%s\\nevent=%s\\n' "$INNGEST_SIGNING_KEY" "$INNGEST_EVENT_KEY"`;
const printed = (stdout) => ({
  signing: stdout.match(/^signing=(.*)$/m)?.[1],
  event: stdout.match(/^event=(.*)$/m)?.[1],
});

test("a self-upgrade replaces a missing or public Inngest key before any compose command runs", async () => {
  const f = await promoteFixture();
  try {
    for (const envFile of ["DPF_IMAGE_TAG=v1\n", "INNGEST_SIGNING_KEY=abcdef0123456789\nINNGEST_EVENT_KEY=deadbeefcafebabe\n"]) { // gitleaks:allow — the old public compose default this test refuses, not a credential (BI-3267763F)
      const keys = printed(await promote(f, { envFile, after: PRINT_KEYS }));
      assert.match(keys.signing, HEX64);
      assert.match(keys.event, HEX64);
    }
    const fromProcess = printed(await promote(f, {
      envFile: "DPF_IMAGE_TAG=v1\n",
      processEnv: { INNGEST_SIGNING_KEY: "abcdef0123456789", INNGEST_EVENT_KEY: "deadbeefcafebabe" }, // gitleaks:allow — the old public compose default this test refuses, not a credential (BI-3267763F)
      after: PRINT_KEYS,
    }));
    assert.match(fromProcess.signing, HEX64, "a public value in the promoter environment is replaced too");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("a self-upgrade never rotates a real Inngest key", async () => {
  const f = await promoteFixture();
  try {
    const signing = "3".repeat(64);
    const event = "4".repeat(64);
    const keys = printed(await promote(f, { envFile: `INNGEST_SIGNING_KEY="${signing}"\nINNGEST_EVENT_KEY=${event}\n`, after: PRINT_KEYS }));
    assert.deepEqual(keys, { signing, event });
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("the promoter persists a generated key in place and leaves every other line alone", async () => {
  const f = await promoteFixture();
  try {
    const file = join(f.dir, "persist.env");
    await writeFile(file, "POSTGRES_USER=dpf\nINNGEST_SIGNING_KEY=abcdef0123456789\nAUTH_SECRET=keep\n"); // gitleaks:allow — the old public compose default this test refuses, not a credential (BI-3267763F)
    await promote(f, {
      envFile: "DPF_IMAGE_TAG=v1\n",
      after: `_inngest_env_write "${bashPath(file)}" INNGEST_SIGNING_KEY "$INNGEST_SIGNING_KEY"
_inngest_env_write "${bashPath(file)}" INNGEST_EVENT_KEY "$INNGEST_EVENT_KEY"`,
    });
    const text = await readFile(file, "utf8");
    assert.match(text, /^POSTGRES_USER=dpf\nINNGEST_SIGNING_KEY=[0-9a-f]{64}\nAUTH_SECRET=keep\n/);
    assert.match(envValue(text, "INNGEST_EVENT_KEY"), HEX64);
    for (const literal of PUBLIC_KEYS) assert.ok(!text.includes(literal));
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("inngest is recreated with the portal only when its running keys differ", async () => {
  const f = await promoteFixture();
  try {
    const signing = "5".repeat(64);
    const event = "6".repeat(64);
    // A docker stand-in: `compose ps -q inngest` names a container, and
    // `inspect` reports the env the test hands it through RUNNING_ENV.
    await writeFile(join(f.bin, "docker"), `#!/usr/bin/env bash
case "$1" in
  compose) printf 'inngest-container\\n' ;;
  inspect) printf '%b' "$RUNNING_ENV" ;;
esac
`);
    await chmod(join(f.bin, "docker"), 0o755);
    const check = `if _inngest_keys_drifted; then echo drift=yes; else echo drift=no; fi`;
    const envFile = `INNGEST_SIGNING_KEY=${signing}\nINNGEST_EVENT_KEY=${event}\n`;
    const aligned = await promote(f, { envFile, processEnv: { RUNNING_ENV: `PATH=/bin\\nINNGEST_SIGNING_KEY=${signing}\\nINNGEST_EVENT_KEY=${event}\\n` }, after: check });
    assert.match(aligned, /^drift=no$/m);
    const stale = await promote(f, { envFile, processEnv: { RUNNING_ENV: "INNGEST_SIGNING_KEY=abcdef0123456789\\nINNGEST_EVENT_KEY=deadbeefcafebabe\\n" }, after: check });
    assert.match(stale, /^drift=yes$/m);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
