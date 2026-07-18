import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSafeComposeCommand, assertSafeSandboxPath } from "./fixtures/assert-safe-sandbox.mjs";
import { captureDockerCommand } from "./fixtures/fake-docker.mjs";
import { readFile as readSource } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = (path) => readSource(resolve(repoRoot, path), "utf8");

test("fixture safety captures an allowed simulated production start", async () => {
  const root = await mkdtemp(join(tmpdir(), "dpf-lifecycle-"));
  const capture = join(root, "docker.jsonl");
  captureDockerCommand(["compose", "-p", "dpf", "up", "-d", "postgres", `${join(root, "state")}:/dpf-state`], { sandboxRoot: root, captureFile: capture });
  assert.deepEqual(JSON.parse((await readFile(capture, "utf8")).trim()), ["compose", "-p", "dpf", "up", "-d", "postgres", `${join(root, "state")}:/dpf-state`]);
});

test("fixture safety refuses production destructive cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "dpf-lifecycle-"));
  assert.throws(() => assertSafeComposeCommand(["compose", "-p", "dpf", "down", "--volumes"], root), /isolated dpf-test project/);
});

test("fixture safety permits isolated destructive cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "dpf-lifecycle-"));
  assert.deepEqual(assertSafeComposeCommand(["compose", "-p", "dpf-test-a1", "down", "--volumes"], root), { project: "dpf-test-a1", destructive: true });
});

test("fixture safety refuses paths outside its resolved sandbox", async () => {
  const root = await mkdtemp(join(tmpdir(), "dpf-lifecycle-"));
  await writeFile(join(root, "sentinel"), "safe");
  assert.throws(() => assertSafeSandboxPath(join(root, "..", "escape"), root), /escapes fixture sandbox/);
  assert.throws(() => assertSafeSandboxPath(root, root), /escapes fixture sandbox/);
});

test("production and contributor setup use the PostgreSQL-only lifecycle", async () => {
  for (const path of ["install-dpf.ps1", "install-dpf.sh", "scripts/fresh-install.ps1", "scripts/setup.sh"]) {
    const text = await source(path);
    assert.doesNotMatch(text, /neo4j|qdrant|\b(?:7474|7687|6333)\b/i, path);
  }
  assert.match(await source("scripts/setup.sh"), /docker compose up -d postgres/);
});

test("reinstall preserves lifecycle state by default and requires explicit reset", async () => {
  const bash = await source("dpf-reinstall.sh");
  assert.match(bash, /DPF_KEEP_STATE=1/);
  assert.match(bash, /--reset-state\)\s+DPF_KEEP_STATE=0/);
  assert.doesNotMatch(await source("dpf-reinstall.ps1"), /neo4j|qdrant/i);
});

test("uninstall and diagnostics do not address retired services", async () => {
  for (const path of ["uninstall-dpf.ps1", "uninstall-dpf.sh", "scripts/installer/lib/doctor.sh", "scripts/verify-install-windows.ps1", "scripts/verify-install-edge.sh"]) {
    assert.doesNotMatch(await source(path), /neo4j|qdrant|\b(?:7474|7687|6333)\b/i, path);
  }
});

test("lifecycle adapters use schema v2 and delegate migration to the canonical Node migrator", async () => {
  const bash = await source("scripts/installer/lib/state.sh");
  const powershell = await source("scripts/installer/lib/state.ps1");
  assert.match(bash, /DPF_STATE_SCHEMA_VERSION=2/);
  assert.match(powershell, /DPF_STATE_SCHEMA_VERSION = 2/);
  assert.match(bash, /migrate-install-state\.mjs/);
  assert.match(powershell, /migrate-install-state\.mjs/);
  assert.doesNotMatch(bash, /dpf_state_write schemaVersion/);
  assert.doesNotMatch(powershell, /Set-DpfStateValue[^\n]*schemaVersion/i);
});

test("Bash platform detection canonicalizes MSYS Windows and refuses unknown identity", async () => {
  const platform = await source("scripts/installer/lib/platform.sh");
  assert.match(platform, /MINGW\*\|MSYS\*\|CYGWIN\*\) DPF_PLATFORM="win32"/);
  assert.match(platform, /x86_64\|amd64\)\s+DPF_ARCH="amd64"/);
  assert.match(platform, /unsupported host platform:[^\n]+>&2; return 1/);
  assert.match(platform, /unsupported host architecture:[^\n]+>&2; return 1/);
});

test("installers persist canonical host identity and Compose passes it to the portal", async () => {
  const bashInstaller = await source("install-dpf.sh");
  const windowsInstaller = await source("install-dpf.ps1");
  const compose = await source("docker-compose.yml");
  const envExample = await source(".env.example");
  for (const key of ["DPF_HOST_PLATFORM", "DPF_HOST_ARCH"]) {
    assert.match(bashInstaller, new RegExp(`${key}=`));
    assert.match(windowsInstaller, new RegExp(`${key}=`));
    assert.match(compose, new RegExp(`${key}: \\` + `\${${key}:-`));
    assert.match(envExample, new RegExp(`^${key}=`, "m"));
  }
  assert.match(bashInstaller, /DPF_HOST_PLATFORM=\$DPF_PLATFORM/);
  assert.match(bashInstaller, /DPF_HOST_ARCH=\$DPF_ARCH/);
  assert.match(windowsInstaller, /DPF_HOST_PLATFORM=win32/);
  assert.match(windowsInstaller, /DPF_HOST_ARCH=\$hostArch/);
});

test("agent toolchain bootstrap changes only its owned install-state property", async () => {
  assert.match(await source("scripts/dpf-bootstrap-agent-toolchain.sh"), /dpf_state_write_json "agentToolchain"/);
  assert.match(await source("scripts/dpf-bootstrap-agent-toolchain.ps1"), /Set-DpfStateValue -Key "agentToolchain"/);
});
