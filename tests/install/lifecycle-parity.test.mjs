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
